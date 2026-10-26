/**
 * Enhances a native text input containing one inline marking and free text. An
 * owned, unnamed textarea provides wrapping and caret hit testing over the
 * display. The original input remains the form control and event target; plain
 * Enter is blocked and pasted newlines become spaces.
 */

import type {
    Assertion,
    Change,
    Fix,
    ValidationError,
    Warning,
} from '@ezclassify/types';
import type {
    ComponentOptions,
    ComponentEngineSource,
} from './component-base-readonly';
import {
    isAddressableSchemeEngine,
    returnToField,
    partsOption,
} from './component-base-readonly';
import { getMountHost } from '../mount-host-registry';
import { InlineMarkingEditor } from './inline-marking-editor';
import { accessibleLabel } from './composer/composer-view';
import { takenFromWhole, withStatedAssertions } from '../assertion-identity';
import { t } from '../i18n';
import { revealClearOfPinned } from './composer/composer-placement';
import { replacesStated } from './composer/composer-controller';
import {
    ensureStatusMark,
    recordAppliedFixes,
    setStatusMarkFixes,
} from './status-mark';
import { cleanupTooltipForRoot } from './tooltip-manager';
import {
    NO_RULE_ERRORS,
    RuleErrorList,
    placeUnderField,
    readFailureReport,
    ruleErrorsFrom,
    type RuleErrorReport,
} from './rule-errors';
import {
    ensureFavoritesButton,
    schemeOffersPresets,
    type FavoritesPanel,
} from './favorites-panel';
import {
    extractInner as extractInnerLogic,
    matchLeadingMark,
    markAttention,
} from './marked-text-area-logic';
import {
    MarkedFieldBase,
    type MarkedFieldClassNames,
} from './marked-field-base';
import markedInputCss from './marked-input.css?inline';

/** Caller-facing options for MarkedInput. */
export interface MarkedInputOptions extends ComponentOptions {
    /**
     * Format identifier for engine parsing and rendering. Defaults to the
     * scheme's part format.
     */
    formatId?: string;
}

/**
 * Enhances a single-line <input> with an inline part marking chip and picker.
 * The input's `.value` is the full marked string (e.g. "(U) report title") at
 * all times; that is the consumer surface. Structured assertions are maintained
 * internally and exposed via `getAssertions()` or `options.onChange`.
 */
export class MarkedInput extends MarkedFieldBase<HTMLTextAreaElement> {
    protected readonly componentLabel = 'MarkedInput';
    protected readonly css = markedInputCss;
    protected readonly hintSuffix = ` ${t('hint.toSetMarking')}`;
    protected readonly hintActionKey = 'hint.setMarking' as const;
    protected readonly classNames: MarkedFieldClassNames = {
        wrap: 'marked-input-wrap',
        display: 'marked-input-display',
        footer: 'marked-input-footer',
        kbHint: 'marked-input-kb-hint',
        touchAdd: 'marked-input-touch-add',
        hintChrome: 'marked-input-hint-chrome',
        pickerActive: 'marked-input-picker-active',
    };

    protected override options: MarkedInputOptions = {};
    private nativeInput!: HTMLInputElement;
    private releaseInputEditor: (() => void) | null = null;
    private forwardingInput = false;

    /** Readability alias for the owned wrapping editor. */
    private get input(): HTMLTextAreaElement {
        return this.host;
    }

    private assertions: Assertion[] = [];
    private rendered = '';
    /**
     * Whether the current leading mark is valid. False when the engine reports
     * part-level validation errors or when the typed mark does not round-trip
     * through the engine (tokens silently dropped). Drives the invalid chip
     * treatment in renderDisplay.
     */
    private valid = true;
    /** Human-readable messages behind `valid === false`. */
    private errors: string[] = [];
    /** The engine's warnings for the mark; they never make it invalid. */
    private warnings: readonly string[] = [];
    /** The rule errors under the field, created on the first one. */
    private ruleErrorList: RuleErrorList | null = null;
    /** Set by destroy() so a fix still settling in the engine never writes. */
    private destroyed = false;
    /**
     * Character position in input.value where the marking ends (after closing
     * delimiter).
     */
    private markEnd = 0;
    /**
     * True only when the user has actually edited the marking since the last
     * external update via setAssertions(). Guards emitChange() in
     * syncFromInput() so focus → picker auto-open → blur never re-publishes a
     * format-mismatched part string to the shared store. Set by onInput() and
     * onPickerChange(); cleared by setAssertions() and after each
     * emitChange().
     */
    private _userEdited = false;
    /**
     * The values taken from the whole that the field last published, as a
     * signature. A whole that changes them is a change to what the part reads
     * as, though the author edited nothing.
     */
    private _publishedTaken = '';
    /**
     * Fixes the engine applied while producing the field's current marking,
     * deduplicated by rule (Enhancement Status Indicator state). Cleared when
     * the marking is removed or replaced.
     */
    private _appliedFixes = new Map<string, Change>();
    /** What the mark held when {@link _appliedFixes} was last written. */
    private _fixesHeld: readonly Assertion[] = [];
    private favoritesPanel: FavoritesPanel | null = null;
    /**
     * Bound `paste` handler: the owned editor is a `<textarea>`, and a paste
     * containing newlines would otherwise land them straight in `.value`,
     * breaking the single-logical-line contract onKeydown's Enter guard
     * maintains. Not on {@link MarkedFieldBase}: MarkedTextArea is a genuine
     * multi-line field and pasting real line breaks into it is correct.
     */
    private boundPaste!: (e: ClipboardEvent) => void;

    /** Saved picker assertions from the last close (see base type). */

    async init(
        container: HTMLDivElement,
        engineOrContext?: ComponentEngineSource | null,
        options?: MarkedInputOptions,
    ): Promise<void> {
        this.options = options ?? {};
        this.bindEngine(container, engineOrContext, options?.formatId);

        this.injectStyle();

        this.host = this.resolveHost();
        const input = this.input;

        // Capture the input's current styles before making it invisible.
        // window.getComputedStyle() returns a live CSSStyleDeclaration, snapshot
        // the values into a plain object NOW, before any DOM mutations move the
        // input or add classes that change its computed styles (e.g. adding
        // marked-input-native would make color:transparent, poisoning the snapshot
        // if we read the live object after that class is applied). The base helper
        // does the snapshot + mirror once the display exists.
        //
        // The native input owns the field's visible box: its paint and its whole
        // edge, the same edge MarkingField and TagInput take from their native
        // inputs, so the family reads as one set of controls. The owned
        // textarea can't stand in for it: its own edge is a textarea's (a
        // browser's default input and textarea borders differ) and input-only
        // host rules never reach it.
        const nativeBoxProps = [
            'color',
            'backgroundColor',
            'borderColor',
            'borderWidth',
            'borderStyle',
            'borderRadius',
        ] as const;
        const readNativeBox = () => {
            const style = window.getComputedStyle(this.nativeInput);
            return Object.fromEntries(
                nativeBoxProps.map((p) => [p, style[p]]),
            ) as Record<(typeof nativeBoxProps)[number], string>;
        };
        const authoredBox = readNativeBox();
        // Insert wrapper, then move input inside it.
        this.wrap = document.createElement('div');
        this.wrap.className = this.classNames.wrap;
        this.nativeInput.parentNode?.insertBefore(this.wrap, this.nativeInput);
        this.wrap.appendChild(this.nativeInput);
        this.wrap.appendChild(input);
        this.wireInputEditor();

        input.classList.add('marked-input-native');
        input.setAttribute('autocomplete', 'off');
        input.setAttribute('spellcheck', 'false');

        // Display div: the sole visible layer.
        this.display = document.createElement('div');
        this.display.className = this.classNames.display;
        this.display.setAttribute('aria-hidden', 'true');

        // Mirror class-on layout metrics, then the native input's box. The
        // capture layer takes the same edge width so a click over the display
        // resolves to the same character in both layers.
        const capturedStyles = this.captureAndMirrorStyles();
        const mirrorNativeBox = (box: typeof authoredBox) => {
            for (const p of nativeBoxProps) {
                capturedStyles[p] = box[p];
                this.display.style[p] = box[p];
            }
            input.style.borderWidth = box.borderWidth;
            input.style.borderStyle = box.borderStyle;
        };
        mirrorNativeBox(authoredBox);

        // Re-sync color/background/border when the host changes theme.
        this.installThemeObserver(
            capturedStyles,
            'marked-input-native',
            this.nativeInput,
        );

        this.wrap.insertBefore(this.display, input);
        // The owned textarea supplies wrapping/font metrics. Native input CSS
        // remains authoritative for the visible box, including late styles and
        // theme changes; the editor's transparent capture layer is never paint.
        const editorLayoutProps = ['padding', 'font', 'lineHeight'] as const;

        // Re-read the host's computed styles one frame after mount to catch host
        // stylesheets that load async after component init. Without this, the
        // display div can show a stale border weight if `input[data-ezclassify-controller]`
        // rules applied after getComputedStyle() ran above.
        if (typeof requestAnimationFrame !== 'undefined') {
            requestAnimationFrame(() => {
                if (!this.wrap.isConnected) return;
                const csLive = window.getComputedStyle(input);
                for (const p of editorLayoutProps) {
                    (this.display.style as unknown as Record<string, string>)[
                        p
                    ] = (csLive as unknown as Record<string, string>)[p];
                }
                mirrorNativeBox(readNativeBox());
            });
        }

        this.appendFooter();

        // The field's single status mark (starless "enhanced" until the
        // engine applies a fix), in the footer's trailing chrome slot.
        ensureStatusMark(this.hintChrome, {
            shape: 'chrome',
            root: this.container,
            shouldShowTooltip: () => this.shouldShowTooltip(),
        });
        // The ★ mounts on host favorites wiring OR scheme-declared presets
        // (ensureFavoritesButton owns the OR); an undefined `config` runs the
        // panel read-only, "From the scheme" only.
        if (
            this.options.favorites ||
            schemeOffersPresets(this.scheme, this.options.scope)
        ) {
            this.favoritesPanel = ensureFavoritesButton(this.hintChrome, {
                root: this.container,
                schemeId: this.schemeId,
                scope: this.options.scope,
                formatId: this.scanFormat,
                scheme: this.scheme,
                config: this.options.favorites,
                read: (marking) => this.readForFavorites(marking),
                applyPreset: (presetId) =>
                    this.callApplyPreset(presetId, this.scanFormat),
                getCurrent: () => ({
                    rendered: this.rendered,
                    valid: this.valid && !!this.rendered,
                }),
                onApply: (marking) => void this.applyFavorite(marking),
                focusField: () => this.input.focus(),
            });
            this.favoritesPanel?.syncStar();
        }

        this.boundInput = () => this.onInput();
        this.boundKeydown = (e) => this.onKeydown(e);
        this.boundPaste = (e) => this.onPaste(e);
        this.boundDocKeydown = (e) => this.onDocKeydown(e);
        this.boundDocClick = (e) => this.onDocClick(e);
        this.boundSelectionChange = () => this.onSelectionChange();

        this.input.addEventListener('input', this.boundInput);
        this.input.addEventListener('keydown', this.boundKeydown);
        this.input.addEventListener('paste', this.boundPaste);
        // Focus keeps the native edge, as MarkingField and TagInput do; the
        // inset ring in marked-input.css is the focus affordance.
        this.input.addEventListener('focus', () => {
            this.hasFocus = true;
            this.renderDisplay();
        });
        this.input.addEventListener('blur', () => {
            this.hasFocus = false;
            // The theme observer holds the edge color while focused; catch up
            // with the active theme's edge now.
            this.display.style.borderColor = capturedStyles.borderColor;
            if (!this.picker) this.renderDisplay();
        });
        // Click near the marking chip opens the picker. A drag-selection whose
        // endpoint lands in the chip is NOT a chip click: bail so text
        // selection across the mark survives (progressive-enhancement rule:
        // never trap the native interaction).
        this.input.addEventListener('mouseup', (event: MouseEvent) => {
            if (!this.hasFocus || this.picker) return;
            requestAnimationFrame(() => {
                if (this.picker) return;
                if (this.input.selectionStart !== this.input.selectionEnd)
                    return;
                // The native input is the transparent hit target above the
                // display. Browser caret placement does not reliably map a
                // click on the styled chip back to a character inside the
                // leading mark (padding, proportional fonts, zoom, and host
                // styles can all shift it). Hit-test the visible chip itself
                // before falling back to the native caret position.
                const chip = this.display.querySelector<HTMLElement>(
                    '.marked-input-chip:not(.marked-input-chip--editing)',
                );
                if (chip) {
                    const rect = chip.getBoundingClientRect();
                    // Half-open hit test: left/top belong to the chip; right/bottom do not.
                    // Use the visible chip bounds before falling back to the caret offset.
                    // The boundary check in marked-input.spec.ts covers fractional layout.
                    const hitChip =
                        event.clientX >= rect.left &&
                        event.clientX < rect.right &&
                        event.clientY >= rect.top &&
                        event.clientY < rect.bottom;
                    if (hitChip) {
                        void this.openPicker();
                        return;
                    }
                }
                // markEnd is the first offset after the marking's own closing delimiter.
                // A caret at that offset belongs to free text, so use a strict upper
                // bound here and in onSelectionChange.
                const cursorPos = this.input.selectionStart ?? 0;
                const closeCooldown =
                    performance.now() - this._lastCloseTime < 200;
                if (
                    this.markEnd > 0 &&
                    cursorPos < this.markEnd &&
                    !closeCooldown
                ) {
                    void this.openPicker();
                }
            });
        });
        document.addEventListener('keydown', this.boundDocKeydown, true);
        document.addEventListener('mousedown', this.boundDocClick);

        await this.syncFromInput();
        this.renderDisplay();

        // Register selectionchange after the initial sync completes so it doesn't
        // fire during the browser's layout pass triggered by DOM manipulation above.
        document.addEventListener('selectionchange', this.boundSelectionChange);
    }

    /**
     * Resolve the native host DETERMINISTICALLY from this container's own host
     * element (set by createMountContainer). A parent-wide query would bind the
     * FIRST matching element in the shared parent, so two bare sibling
     * marked-inputs would both capture the first one. Only fall back to a query
     * when there is no recorded host (defensive).
     *
     * The original text input remains the form control. An owned, unnamed
     * textarea supplies wrapping and caret hit testing for its single logical
     * line; it has no id, name, or scanner binding of its own.
     */
    protected resolveHost(): HTMLTextAreaElement {
        const registered = getMountHost(this.container);
        const native =
            registered ??
            this.container.querySelector(
                'input[type="text"], input:not([type])',
            ) ??
            this.container.parentElement?.querySelector(
                'input[type="text"], input:not([type])',
            );
        if (!(native instanceof HTMLInputElement) || native.type !== 'text')
            throw new Error(
                'MarkedInput requires a native <input type="text"> element',
            );
        this.nativeInput = native;
        const editor = document.createElement('textarea');
        editor.className = native.className;
        editor.value = native.value;
        editor.defaultValue = native.defaultValue;
        return editor;
    }

    /** Preserve the original form field while the owned editor wraps its text. */
    private wireInputEditor(): void {
        const native = this.nativeInput;
        const editor = this.input;
        const cleanups: Array<() => void> = [];
        const on = (
            target: EventTarget,
            type: string,
            listener: EventListener,
            capture = false,
        ) => {
            target.addEventListener(type, listener, capture);
            cleanups.push(() =>
                target.removeEventListener(type, listener, capture),
            );
        };
        const hidden = native.hidden;
        native.hidden = true;
        const focus = Object.getOwnPropertyDescriptor(native, 'focus');
        Object.defineProperty(native, 'focus', {
            configurable: true,
            value: (options?: FocusOptions) => editor.focus(options),
        });
        const attributes = [
            'disabled',
            'readonly',
            'required',
            'placeholder',
            'tabindex',
            'title',
            'minlength',
            'maxlength',
            'form',
            'aria-describedby',
            'aria-required',
            'aria-label',
            'aria-labelledby',
        ];
        const sync = () => {
            for (const name of attributes) {
                const value = native.getAttribute(name);
                if (value === null) editor.removeAttribute(name);
                else editor.setAttribute(name, value);
            }
            const label = accessibleLabel(native, t('aria.markingInput'));
            editor.removeAttribute('aria-label');
            editor.removeAttribute('aria-labelledby');
            editor.setAttribute(
                label.id ? 'aria-labelledby' : 'aria-label',
                native.getAttribute('aria-labelledby') ??
                    label.id ??
                    label.text,
            );
            if (editor.matches(':disabled') || editor.readOnly)
                void this.closePicker();
        };
        sync();
        const observer = new MutationObserver(sync);
        observer.observe(native, {
            attributes: true,
            attributeFilter: attributes,
        });
        for (
            let parent = native.parentElement;
            parent;
            parent = parent.parentElement
        )
            if (parent.tagName === 'FIELDSET')
                observer.observe(parent, {
                    attributes: true,
                    attributeFilter: ['disabled'],
                });
        cleanups.push(() => observer.disconnect());
        let hostValidity = native.validity.customError
            ? native.validationMessage
            : '';
        const validity = Object.getOwnPropertyDescriptor(
            native,
            'setCustomValidity',
        );
        const writeValidity = native.setCustomValidity.bind(native);
        const syncValidity = () =>
            writeValidity(
                editor.validity.customError
                    ? editor.validationMessage
                    : hostValidity,
            );
        Object.defineProperty(native, 'setCustomValidity', {
            configurable: true,
            value: (message: string) => {
                hostValidity = String(message);
                syncValidity();
            },
        });
        const validityObserver = new MutationObserver(syncValidity);
        validityObserver.observe(editor, {
            attributes: true,
            attributeFilter: ['aria-invalid'],
        });
        cleanups.push(() => {
            validityObserver.disconnect();
            if (validity)
                Object.defineProperty(native, 'setCustomValidity', validity);
            else delete (native as Partial<HTMLInputElement>).setCustomValidity;
            writeValidity(hostValidity);
        });
        on(
            editor,
            'input',
            () => {
                native.value = editor.value;
                editor.value = native.value;
            },
            true,
        );
        for (const type of ['input', 'change']) {
            on(editor, type, (event) => {
                event.stopPropagation();
                native.value = editor.value;
                this.forwardingInput = true;
                try {
                    native.dispatchEvent(new Event(type, { bubbles: true }));
                } finally {
                    this.forwardingInput = false;
                }
            });
            on(native, type, () => {
                if (this.forwardingInput || native.value === editor.value)
                    return;
                editor.value = native.value;
                this.onInput();
            });
        }
        on(
            editor,
            'keydown',
            (event) => {
                if (editor.matches(':disabled') || editor.readOnly)
                    event.stopImmediatePropagation();
            },
            true,
        );
        for (const label of Array.from(native.labels ?? []))
            on(label, 'click', (event) => {
                if (
                    event.target instanceof Element &&
                    event.target.closest(
                        'a[href], button, input, select, textarea, [contenteditable]',
                    )
                )
                    return;
                event.preventDefault();
                editor.focus();
            });
        on(native, 'invalid', (event) => {
            event.preventDefault();
            editor.focus();
        });
        if (native.form)
            on(native.form, 'reset', (event) =>
                queueMicrotask(() => {
                    if (this.destroyed || event.defaultPrevented) return;
                    this.destroyPicker();
                    this.setValue(native.value);
                }),
            );
        this.releaseInputEditor = () => {
            for (const cleanup of cleanups) cleanup();
            native.hidden = hidden;
            if (focus) Object.defineProperty(native, 'focus', focus);
            else delete (native as unknown as { focus?: unknown }).focus;
        };
    }

    protected override setHostValue(value: string, notify = true): void {
        this.nativeInput.value = value;
        super.setHostValue(this.nativeInput.value, notify);
    }

    /** Touch "Add marking" → same as Cmd/Ctrl+Enter: open the picker. */
    protected triggerAddMarking(): void {
        if (!this.picker) void this.openPicker();
    }

    getAssertions(): Assertion[] {
        return [...this.assertions];
    }

    setAssertions(assertions: Assertion[]): void {
        // External update: reset user-edit flag so the subsequent renderDisplay
        // pass in apply() does not accidentally trigger a store publish.
        this._userEdited = false;
        this.assertions = [...assertions];
        const freeText = this.getFreeText();

        if (assertions.length === 0) {
            // Mirrors syncFromInput's cleared-mark path: no marking means no
            // basis for an invalid chip, regardless of what the field showed before.
            // Bump scanSeq FIRST: this synchronous clear must invalidate any
            // process() call already in flight below, or that call's deferred
            // `apply` still matches the (unbumped) seq it captured and lands
            // after this return, silently reviving the marking this call just
            // cleared, which on a classification field is a data-integrity
            // failure.
            ++this.scanSeq;
            this.rendered = '';
            this.valid = true;
            this.errors = [];
            this.showRuleErrors([], []);
            this.setHostValue(freeText, false);
            this.updateMarkEnd();
            this.renderDisplay();
            return;
        }

        // Re-derive validity for this assertion set with process('', {assertions}),
        // the same call syncFromInput uses for saved picker assertions. External
        // store pushes must update the displayed marking and its validity together.
        const mySeq = ++this.scanSeq;
        const apply = (result: {
            rendered: string;
            errors: ValidationError[];
            proposedFixes?: Fix[];
            warnings?: Warning[];
            assertionsBeforeRepair?: Assertion[];
        }) => {
            if (mySeq !== this.scanSeq) return;
            const r = result.rendered;
            this.rendered = r;
            const partErrors = result.errors ?? [];
            this.valid = partErrors.length === 0;
            this.errors = partErrors.map((e) => e.message);
            this.showRuleErrors(
                partErrors,
                result.proposedFixes ?? [],
                result.warnings,
            );
            if (r) {
                // One wrapper, so the part can be found again in the body text.
                const marking = this.wrapRendered(r);
                // External state reflection: write silently (notify=false);
                // the change originated outside this field.
                this.setHostValue(
                    this.joinMarkingAndText(marking, freeText),
                    false,
                );
            } else {
                this.setHostValue(freeText, false);
            }
            this.updateMarkEnd();
            this.renderDisplay();
            // Don't call emitChange() here. setAssertions is called by the store
            // subscription (wireMarkedInputStore) to reflect external state; not a
            // user edit. User-initiated changes go through syncFromInput → emitChange.
            // Calling emitChange here re-publishes the component's short-format render
            // back to the store, which processes it with the default (long) parser and
            // produces validation errors for tokens it can't recognize, corrupting
            // the shared marking's valid flag.
        };

        const result =
            this.schemeAddressing && isAddressableSchemeEngine(this.engine)
                ? this.engine.process(
                      '',
                      this.schemeId,
                      this.markOptions({
                          outputFormat: this.scanFormat,
                          assertions,
                      }),
                  )
                : this.engine.process(
                      '',
                      this.markOptions({
                          outputFormat: this.scanFormat,
                          assertions,
                      }),
                  );

        void Promise.resolve(result)
            .then(apply)
            .catch((error: unknown) => {
                if (mySeq === this.scanSeq)
                    this.showReport(readFailureReport(error));
            });
    }

    setValue(value: string): void {
        this.setHostValue(value, false);
        void this.syncFromInput();
    }

    /**
     * The parts this field's whole covers changed: read the mark again so its
     * errors and fixes account for them, or the open editor's draft when there
     * is one.
     */
    refreshParts(): void {
        if (!this.options.resolveParts || this.destroyed) return;
        if (this.picker) this.picker.refreshContext();
        else void this.syncFromInput();
    }

    /**
     * The whole this mark is a part of changed: read the mark again against it,
     * or the open editor's draft when there is one.
     */
    refreshWhole(): void {
        if (!this.options.resolveContext || this.destroyed) return;
        if (this.picker) this.picker.refreshContext();
        else void this.syncFromInput({ wholeChanged: true });
    }

    /** See `ComponentInstance.coversParts`. */
    get coversParts(): boolean {
        return this.options.resolveParts !== undefined;
    }

    /**
     * Process options for this field's own mark: the parts it covers when it
     * holds a whole, and the whole's context when it is a part (read at call
     * time, the way MarkedTextArea reads its portions), so a part is compared
     * with its whole.
     */
    private markOptions<T extends object>(options: T) {
        const context = this.options.resolveContext?.();
        // Values taken from a whole are never sent back: the engine takes them
        // again from the whole supplied here.
        const stated = withStatedAssertions<{ assertions?: Assertion[] }>(
            options,
        ) as T;
        const withContext = context ? { ...stated, context } : stated;
        return (
            partsOption(this.options.resolveParts, withContext) ?? withContext
        );
    }

    getRendered(): string {
        return this.rendered;
    }

    destroy(): void {
        this.destroyAfterDraft(() => this.teardown());
    }

    protected override finishClose(): void {
        super.finishClose();
        this.ruleErrorList?.setSuppressed(false);
    }

    protected async commitOpenEditor(): Promise<void> {
        if (!this.picker) return;
        const outcome = await this.picker.commit();
        if (outcome === 'invalid') return;
        this.finishPicker();
        await this.syncFromInput();
    }

    private teardown(): void {
        this.destroyed = true;
        if (!this.host || !this.wrap) return;
        this.disconnectThemeObserver();
        cleanupTooltipForRoot(this.container);
        this.destroyPicker();
        this.favoritesPanel?.destroy();
        this.favoritesPanel = null;
        this.input.removeEventListener('input', this.boundInput);
        this.input.removeEventListener('keydown', this.boundKeydown);
        this.input.removeEventListener('paste', this.boundPaste);
        document.removeEventListener('keydown', this.boundDocKeydown, true);
        document.removeEventListener('mousedown', this.boundDocClick);
        document.removeEventListener(
            'selectionchange',
            this.boundSelectionChange,
        );
        // A host the page removed itself stays removed (see MarkingField).
        this.releaseInputEditor?.();
        this.releaseInputEditor = null;
        if (this.wrap.parentNode && this.nativeInput.parentNode === this.wrap)
            this.wrap.parentNode.insertBefore(this.nativeInput, this.wrap);
        this.wrap.remove();
        this.ruleErrorList?.remove();
        this.ruleErrorList = null;
        this.container.innerHTML = '';
    }

    /**
     * Show the leading mark's rule errors under the field, then a button for
     * each way to fix it the engine proposed (see rule-errors.ts).
     */
    private showRuleErrors(
        errors: readonly ValidationError[],
        proposedFixes: readonly Fix[],
        warnings: readonly Warning[] = [],
    ): void {
        this.showReport(ruleErrorsFrom(errors, proposedFixes, warnings));
    }

    /**
     * Show a report under the field: the rule errors, warnings and fixes of a
     * read, or why the read failed.
     */
    private showReport(ruleErrors: RuleErrorReport): void {
        this.warnings = ruleErrors.warnings;
        if (
            ruleErrors.messages.length === 0 &&
            ruleErrors.warnings.length === 0
        ) {
            this.ruleErrorList?.update(NO_RULE_ERRORS, null);
            return;
        }
        if (!this.ruleErrorList) {
            this.ruleErrorList = new RuleErrorList(
                this.input.ownerDocument,
                (pointerType) =>
                    returnToField(this.input, this.wrap, pointerType),
            );
            this.ruleErrorList.setSuppressed(!!this.picker);
        }
        placeUnderField(this.ruleErrorList.element, this.input, this.container);
        this.ruleErrorList.update(ruleErrors, (fix) => {
            void this.applyRuleFix(fix);
        });
    }

    /**
     * A pressed fix is a user edit of the leading mark. The engine proved the
     * fix as the text it gives, in this field's format, so that text is written
     * into the host the way a picker commit is, and the one read that follows
     * settles it, so the store and any host listener see it.
     */
    private async applyRuleFix(fix: Fix): Promise<void> {
        // The list reports the committed mark; while the picker is open the
        // editor owns a newer one, and the picker's own commit wins.
        if (
            this.picker ||
            this.destroyed ||
            this.input.matches(':disabled') ||
            this.input.readOnly
        )
            return;
        const marking = this.wrapRendered(fix.rendered);
        this._editorAssertions = null;
        this._userEdited = true;
        this.setHostValue(
            marking
                ? this.joinMarkingAndText(marking, this.getFreeText())
                : this.getFreeText(),
        );
        await this.syncFromInput();
    }

    /**
     * Join a template-wrapped marking with the field's free text. Templates
     * usually end in a space ("({marking}) ") which acts as the separator, but
     * some schemes declare "({marking})" with none; without this guard every
     * external update glues the text to the closing delimiter ("(U)quarterly
     * report").
     */
    private joinMarkingAndText(
        wrappedMarking: string,
        freeText: string,
    ): string {
        if (!freeText) return wrappedMarking;
        return /\s$/.test(wrappedMarking)
            ? wrappedMarking + freeText
            : wrappedMarking + ' ' + freeText;
    }

    /** Text in input.value after the marking (stripped of one leading space). */
    private getFreeText(): string {
        const v = this.input.value;
        if (!v || this.markEnd <= 0) return v;
        const tail = v.slice(this.markEnd);
        return tail.startsWith(' ') ? tail.slice(1) : tail;
    }

    /** Extract the inner content from a wrapped marking string like "(U)" → "U". */
    private extractInner(marking: string): string {
        return extractInnerLogic(marking, this.embeddedPatterns);
    }

    /**
     * Sync markEnd with the current input value by re-matching the embedded
     * pattern.
     */
    private updateMarkEnd(): void {
        const v = this.input.value;
        if (!v || !this.embeddedStyle) {
            this.markEnd = 0;
            return;
        }
        // Minimal leading match: a greedy scheme pattern (e.g. a `\((.+)\)`
        // wrapper) would otherwise span to a later prose paren like "(a)".
        this.markEnd = matchLeadingMark(v, this.embeddedStyle.pattern).length;
    }

    /** Return the marking string at position 0 (e.g. "(U)"), or empty. */
    private getMarkString(): string {
        const v = this.input.value;
        if (!v || !this.embeddedStyle) return '';
        return matchLeadingMark(v, this.embeddedStyle.pattern);
    }

    /**
     * Parse the current input value via the engine; updates assertions +
     * rendered.
     */
    private async syncFromInput(
        options: { wholeChanged?: boolean } = {},
    ): Promise<void> {
        if (this.picker) return;
        this.updateMarkEnd();
        const mark = this.getMarkString();
        if (!mark) ++this.scanSeq;

        if (!mark) {
            this.assertions = [];
            this.rendered = '';
            this.valid = true;
            this.errors = [];
            this.showRuleErrors([], []);
            // No marking left: back to the starless "enhanced" state.
            this._appliedFixes.clear();
            this._fixesHeld = [];
            this.updateStatusMark();
            this.renderDisplay();
            // Emit only when the USER cleared a previously-marked value (e.g. deleted
            // the "(S)" prefix). That has to reach the store so a self-publishing
            // marked-input drops out of the page aggregate, otherwise the banner
            // stays stuck on the deleted marking. We do NOT emit on the frequent
            // non-user empty syncs (init with a blank input, picker open/close); those
            // leave _userEdited false and would otherwise race the store's seed pass.
            if (this._userEdited) {
                this._userEdited = false;
                this.emitChange();
            }
            return;
        }

        const mySeq = ++this.scanSeq;
        const inner = this.extractInner(mark);

        let result: {
            assertions: Assertion[];
            rendered: string;
            errors: ValidationError[];
            appliedFixes: Change[];
            proposedFixes?: Fix[];
            warnings?: Warning[];
            assertionsBeforeRepair?: Assertion[];
        };
        const savedAssertions = this._editorAssertions;
        this._editorAssertions = null;
        const usedSavedAssertions = !!(
            savedAssertions &&
            savedAssertions.marking === mark &&
            savedAssertions.assertions.length > 0
        );

        try {
            if (usedSavedAssertions) {
                result = await Promise.resolve(
                    this.schemeAddressing &&
                        isAddressableSchemeEngine(this.engine)
                        ? this.engine.process(
                              '',
                              this.schemeId,
                              this.markOptions({
                                  outputFormat: this.scanFormat,
                                  assertions: savedAssertions!.assertions,
                              }),
                          )
                        : this.engine.process(
                              '',
                              this.markOptions({
                                  outputFormat: this.scanFormat,
                                  assertions: savedAssertions!.assertions,
                              }),
                          ),
                );
            } else {
                result = await Promise.resolve(
                    this.schemeAddressing &&
                        isAddressableSchemeEngine(this.engine)
                        ? this.engine.process(
                              inner,
                              this.schemeId,
                              this.markOptions({
                                  outputFormat: this.scanFormat,
                              }),
                          )
                        : this.engine.process(
                              inner,
                              this.markOptions({
                                  outputFormat: this.scanFormat,
                              }),
                          ),
                );
            }
        } catch (error) {
            // The engine raised instead of reading the mark. Leave the
            // assertions and rendered value as they were and say why.
            if (mySeq === this.scanSeq)
                this.showReport(readFailureReport(error));
            return;
        }

        if (mySeq !== this.scanSeq) return;

        this.assertions = result.assertions;
        this.rendered = result.rendered;
        this.recordMarkFixes(result.assertions, result.appliedFixes);

        // Validity: surface part-level engine errors, and catch silent
        // token drops. The engine ignores tokens it cannot parse WITHOUT
        // reporting an error, so a typo inside the mark ("HxOLD") would
        // otherwise downgrade the marking while still reading as valid. When
        // the parse came from text (not trusted picker assertions) and the
        // round-trip render differs from what was typed with no repair rule
        // explaining the change, flag the mark invalid rather than silently
        // publishing the downgraded form.
        const partErrors = result.errors ?? [];
        this.valid = partErrors.length === 0;
        this.errors = partErrors.map((e) => e.message);
        this.showRuleErrors(
            partErrors,
            result.proposedFixes ?? [],
            result.warnings,
        );
        // Fail closed on unrecognized tokens: a typo inside the mark (e.g.
        // "HxOLD") parses to a REDUCED assertion set, so publishing it would
        // silently downgrade the shared marking. Keep the last published state
        // until the mark reads clean again; the invalid chip and its error
        // title tell the user what to fix.
        const roundTripFailed = partErrors.some(
            (e) => e.constraintId === '_unmatched_token',
        );

        this.renderDisplay();
        // Only emit when the user actually changed the marking. syncFromInput()
        // also runs when the picker opens and closes without any user interaction
        // (e.g. focus → cursor enters chip area → picker auto-opens → blur).
        // Emitting in those cases re-publishes the part-format rendered string
        // to the store, which processes it with the default (long-form) format
        // and drops categories whose short tokens don't round-trip; wiping the
        // full marking. _userEdited is set by onInput() and onPickerChange();
        // cleared by setAssertions() (external update) and after each emit.
        if (this._userEdited && !roundTripFailed) {
            this._userEdited = false;
            this.emitChange();
        } else if (
            options.wholeChanged &&
            !roundTripFailed &&
            takenSignature(this.assertions) !== this._publishedTaken
        ) {
            // The mark stands for values its whole now holds differently (or
            // only now has): publish what the part reads as against it.
            this.emitChange();
        }
    }

    /**
     * Record the fixes behind the marking the mark now holds. A marking that
     * drops something the recorded one stated replaces it (a marking typed or
     * pasted over the mark, a later editing session, a favorite, a pressed
     * fix), the same rule a composer commit follows (see `replacesStated`): the
     * old fixes no longer describe the mark, so the record starts over with
     * this read's. A marking that only adds to it, or the same marking read
     * again, keeps them.
     *
     * @param holds - What the mark holds after this read
     * @param fixes - The fixes the engine applied to produce it
     */
    private recordMarkFixes(
        holds: readonly Assertion[],
        fixes: readonly Change[] | undefined,
    ): void {
        if (replacesStated(this._fixesHeld, holds)) this._appliedFixes.clear();
        this._fixesHeld = holds;
        recordAppliedFixes(this._appliedFixes, fixes);
        this.updateStatusMark();
    }

    /** Reflect the applied-fix record on the field's single status mark. */
    private updateStatusMark(): void {
        setStatusMarkFixes(this.hintChrome, [...this._appliedFixes.values()]);
    }

    /**
     * Strip newlines before they reach the owned editor. That editor is a
     * `<textarea>`, which accepts a pasted "\n" straight into `.value`; this
     * field's value is one single logical line (onKeydown blocks a typed Enter
     * for the same reason), so a paste has to be sanitized the same way. Runs
     * INSTEAD OF the default paste action (rather than reading back `.value`
     * after the browser's own paste lands) so the insertion point is exact even
     * with a non-collapsed selection: `document.execCommand` is deprecated, so
     * this does the insert by hand and dispatches the native `input` event
     * itself for onInput() to pick up.
     */
    private onPaste(e: ClipboardEvent): void {
        // A caret paste landing inside the marking region would corrupt the
        // token exactly like a typed keystroke there: onKeydown already guards
        // printable keys with the same `collapsed && s < markEnd` check (see
        // its comment) because the async auto-open, mouseup RAF or
        // selectionchange, has not had a chance to fire yet, so raw text would
        // land straight inside "(S//NF)" and the engine silently drops the
        // mangled tokens. Paste has no keydown equivalent to hook (Cmd+V isn't
        // a length-1 printable key), so without this guard a paste would bypass
        // the protection typed keys have. Route into the picker instead: same
        // policy as onKeydown, right down to leaving a non-collapsed selection
        // that overlaps the marking to the native edit (a
        // select-all-then-paste replace is a legitimate edit there too).
        const s = this.input.selectionStart ?? this.input.value.length;
        const selEnd = this.input.selectionEnd ?? this.input.value.length;
        const collapsed = s === selEnd;
        if (!this.picker && this.markEnd > 0 && collapsed && s < this.markEnd) {
            e.preventDefault();
            const afterMark =
                this.markEnd + (this.input.value[this.markEnd] === ' ' ? 1 : 0);
            this.input.setSelectionRange(afterMark, afterMark);
            void this.openPicker({ openList: false });
            return;
        }

        const text = e.clipboardData?.getData('text/plain');
        if (text === undefined || !/[\r\n]/.test(text)) return;
        e.preventDefault();
        // A run of newlines collapses to one space rather than vanishing:
        // "line one\nline two" pasted in becomes "line one line two", not
        // "line oneline two".
        const sanitized = text.replace(/\r\n|\r|\n/g, ' ');
        this.input.setRangeText(sanitized, s, selEnd, 'end');
        this.input.dispatchEvent(new Event('input', { bubbles: true }));
    }

    private onInput(): void {
        // Ignore the component's own setHostValue dispatch; the originating
        // code path already ran the sync it needed.
        if (this._selfDispatch) return;
        this._userEdited = true;
        this._editorAssertions = null;
        this.updateMarkEnd();
        this.renderDisplay();
        void this.syncFromInput();
    }

    protected renderDisplay(): void {
        const v = this.input.value;
        const selStart = this.hasFocus ? (this.input.selectionStart ?? -1) : -1;
        const selEnd = this.hasFocus ? (this.input.selectionEnd ?? -1) : -1;
        const hasSelection = selStart >= 0 && selStart !== selEnd;

        this.display.innerHTML = '';

        // Append a text run, wrapping any part inside the active selection in
        // a highlight span (same shape as MarkedTextArea.renderDisplay).
        const appendText = (str: string, startOffset: number) => {
            if (str.length === 0) return;
            if (!hasSelection) {
                this.display.appendChild(document.createTextNode(str));
                return;
            }
            const absEnd = startOffset + str.length;
            const overlapStart = Math.max(startOffset, selStart);
            const overlapEnd = Math.min(absEnd, selEnd);
            if (overlapStart >= overlapEnd) {
                this.display.appendChild(document.createTextNode(str));
                return;
            }
            const before = str.slice(0, overlapStart - startOffset);
            const selected = str.slice(
                overlapStart - startOffset,
                overlapEnd - startOffset,
            );
            const after = str.slice(overlapEnd - startOffset);
            if (before)
                this.display.appendChild(document.createTextNode(before));
            const selSpan = document.createElement('span');
            selSpan.className = 'marked-input-selection';
            selSpan.textContent = selected;
            this.display.appendChild(selSpan);
            if (after) this.display.appendChild(document.createTextNode(after));
        };

        const mark = this.getMarkString();
        // Picker may be active even when the input has no mark yet (opening on an empty field).
        // In that case render the picker mount as an empty editing chip so the picker is visible.
        const pickerOnly = !mark && this.picker && this.pickerMount;

        if ((mark && this.markEnd > 0) || pickerOnly) {
            // Render the chip (or inline editor when picker is active).
            if (this.picker && this.pickerMount) {
                const editorChip = document.createElement('span');
                editorChip.className =
                    'marked-input-chip marked-input-chip--editing';
                const openDelim = this.template.slice(0, 1);
                editorChip.appendChild(document.createTextNode(openDelim));
                editorChip.appendChild(this.pickerMount);
                editorChip.appendChild(document.createTextNode(')'));
                this.display.appendChild(editorChip);
            } else {
                const chip = document.createElement('span');
                const warned = this.valid && this.warnings.length > 0;
                chip.className = !this.valid
                    ? 'marked-input-chip marked-input-chip--invalid'
                    : warned
                      ? 'marked-input-chip marked-input-chip--warning'
                      : 'marked-input-chip';
                if (!this.valid && this.errors.length > 0) {
                    chip.setAttribute(
                        'title',
                        markAttention('invalid', this.errors).tooltip,
                    );
                } else if (warned) {
                    chip.setAttribute(
                        'title',
                        markAttention('warning', this.warnings).tooltip,
                    );
                } else if (this.valid) {
                    this.attachSegmentTooltip(chip, this.assertions);
                }
                chip.dataset.start = '0';
                chip.dataset.end = String(this.markEnd);
                // Selection can span into the chip (e.g. select-all): render
                // the overlapping slice highlighted so selection is visible.
                if (hasSelection && selStart < this.markEnd && selEnd > 0) {
                    const overlapStart = Math.max(0, selStart);
                    const overlapEnd = Math.min(this.markEnd, selEnd);
                    if (overlapStart > 0)
                        chip.appendChild(
                            document.createTextNode(
                                mark.slice(0, overlapStart),
                            ),
                        );
                    const selSpan = document.createElement('span');
                    selSpan.className = 'marked-input-selection';
                    selSpan.textContent = mark.slice(overlapStart, overlapEnd);
                    chip.appendChild(selSpan);
                    if (overlapEnd < this.markEnd)
                        chip.appendChild(
                            document.createTextNode(mark.slice(overlapEnd)),
                        );
                } else {
                    chip.textContent = mark;
                }
                this.display.appendChild(chip);
            }

            // Text part after the marking (v.slice(markEnd) = " some text").
            const rawTail = v.slice(this.markEnd);
            // Preserve the leading space so the text starts visually after the chip.
            const displayTail = rawTail || ' ';

            // While the picker is open the editing chip owns the sole caret
            // (rendered inside the chip above). Suppress the tail synthetic
            // caret so the field never shows two carets at once: openPicker()
            // assigns this.picker before this render, and the input stays
            // focused until picker.focus() runs, so without this guard the tail
            // caret would be drawn and then never cleared (blur skips re-render
            // while a picker exists).
            if (hasSelection) {
                appendText(displayTail, this.markEnd);
            } else if (
                this.hasFocus &&
                !this.picker &&
                selStart >= this.markEnd
            ) {
                const relCaret = selStart - this.markEnd;
                const before = displayTail.slice(0, relCaret);
                const after = displayTail.slice(relCaret);
                if (before)
                    this.display.appendChild(document.createTextNode(before));
                const caretEl = document.createElement('span');
                caretEl.className = 'marked-input-caret';
                this.display.appendChild(caretEl);
                if (after)
                    this.display.appendChild(document.createTextNode(after));
            } else {
                if (displayTail)
                    this.display.appendChild(
                        document.createTextNode(displayTail),
                    );
            }
        } else {
            // No marking: render raw value with caret at cursor position.
            if (!v) {
                if (this.hasFocus) {
                    this.display.appendChild(this.makeCaret());
                }
            } else if (hasSelection) {
                appendText(v, 0);
            } else {
                const caretOffset = selStart >= 0 ? selStart : v.length;
                if (caretOffset > 0)
                    this.display.appendChild(
                        document.createTextNode(v.slice(0, caretOffset)),
                    );
                if (this.hasFocus) this.display.appendChild(this.makeCaret());
                if (caretOffset < v.length)
                    this.display.appendChild(
                        document.createTextNode(v.slice(caretOffset)),
                    );
            }
        }

        this.favoritesPanel?.syncStar();
        this.exposePickerInDisplay();
    }

    /**
     * The free text the open editing session writes its mark in front of,
     * captured when the editor opens (and after each commit).
     */
    private _pickerFreeText = '';

    private makeCaret(): HTMLSpanElement {
        const el = document.createElement('span');
        el.className = 'marked-input-caret';
        return el;
    }

    /**
     * Open the inline editor on the leading mark.
     *
     * @param options - Opening intent from the host field.
     * @param options.fromTyped - True for the keyboard shortcut on a field with
     *   no mark yet. The field's placeholder asks for exactly that flow ("type
     *   a marking, then Ctrl+Enter"), so the text in front of the caret is the
     *   marking the user typed: it becomes the editor's draft and is read, not
     *   left behind as free text with an empty mark in front of it. The rest of
     *   the text stays free text.
     * @param options.openList - False when the caret moving into the mark
     *   opened the editor: that is not a request for suggestions.
     */
    private async openPicker({
        fromTyped = false,
        openList = true,
    } = {}): Promise<void> {
        this.destroyPicker();
        const openSeq = this.pickerOpenSeq;

        // Escape cancels the edit: snapshot the value + caret to restore.
        this._pickerCancelSnapshot = {
            value: this.input.value,
            caret: this.input.selectionStart ?? this.input.value.length,
        };

        const mark = this.getMarkString();
        const inner = mark ? this.extractInner(mark) : '';
        this._pickerFreeText = this.getFreeText();
        let draft: string | undefined;
        if (!mark && fromTyped) {
            const caret = this.input.selectionEnd ?? this.input.value.length;
            draft = this.input.value.slice(0, caret).trim() || undefined;
            if (draft) {
                this._pickerFreeText = this.input.value
                    .slice(caret)
                    .trimStart();
            }
        }

        const mount = document.createElement('span');
        mount.className = 'marked-input-picker-mount';
        mount.style.display = 'inline';

        const picker = new InlineMarkingEditor();
        await picker.init(
            mount as unknown as HTMLDivElement,
            this.engineSource,
            inner,
            {
                openList,
                formatId: this.scanFormat,
                scope: this.options.scope,
                resolveParts: this.options.resolveParts,
                resolveContext: this.options.resolveContext,
                assertions:
                    this.assertions.length > 0 ? this.assertions : undefined,
                draft,
                schemeId: this.schemeId,
                tooltips: this.options.tooltips,
                tooltipConceptProperty: this.options.tooltipConceptProperty,
                onChange: () => this.onPickerChange(),
                onExit: (_direction, fromSheet) => {
                    // The editor already committed; leave the marking with
                    // the caret just past it. After the phone sheet, focus
                    // stays off the field, which would bring the keyboard
                    // back up.
                    this.finishPicker();
                    if (!fromSheet) this.input.focus();
                    const afterMark =
                        this.markEnd +
                        (this.input.value[this.markEnd] === ' ' ? 1 : 0);
                    this.input.setSelectionRange(afterMark, afterMark);
                    void this.syncFromInput();
                },
                onBlurCommit: (outcome) => {
                    // An invalid draft stays mounted and marked; anything
                    // else was stored (or unchanged) and the editor closes.
                    if (outcome === 'invalid' || this.picker !== picker) return;
                    this.finishPicker();
                    this.afterClose();
                },
                onCancel: () => this.escapeClosePicker(),
                // The favorites button stamps onto the open segment, so
                // focus moving to it must not close the editor first.
                isFieldChrome: (node) =>
                    !!this.favoritesPanel?.button.contains(node),
                label: () =>
                    accessibleLabel(this.input, t('aria.markingInput')),
                root: this.container,
            },
        );

        if (openSeq !== this.pickerOpenSeq) {
            // A newer open (or a teardown) happened while this one awaited.
            picker.destroy();
            return;
        }
        this.picker = picker;
        this.pickerMount = mount;
        // The editor's list carries the mark's report: one list, not two.
        this.ruleErrorList?.setSuppressed(true);
        this.container.classList.add(this.classNames.pickerActive);
        this.renderDisplay();
        picker.focus();
        // The picker can auto-open with the field scrolled to the viewport's
        // edge (clipped editor, unreachable suggestions). Bring it into view.
        revealClearOfPinned(this.wrap);
    }

    /**
     * Apply a favorite: REPLACE the leading part mark, preserving whatever free
     * text follows it. Mirrors `onPickerChange`'s host-value write, but the
     * marking comes from the favorites panel's `read()` call instead of the
     * (possibly not even open) inline picker.
     */
    private async applyFavorite(marking: string): Promise<void> {
        const result = await this.readForFavorites(marking);
        this._userEdited = true;
        this._editorAssertions = null;
        this.assertions = result.assertions;
        this.rendered = result.rendered.trim();
        this.recordMarkFixes(result.assertions, result.appliedFixes);
        const freeText = this.getFreeText();
        if (this.rendered) {
            const full = this.wrapRendered(this.rendered);
            this.setHostValue(this.joinMarkingAndText(full, freeText));
        } else {
            this.setHostValue(freeText);
        }
        // Tear down an open inline picker WITHOUT its normal "write picker
        // content back" step: the lines above already wrote the applied
        // favorite as the field's final value, and closePicker() re-reading
        // the picker's own (untouched) content would clobber it right back
        // with whatever marking was open before the favorite was applied.
        this.finishClose();
        this.updateMarkEnd();
        this.renderDisplay();
        this.input.focus();
        const afterMark =
            this.markEnd + (this.input.value[this.markEnd] === ' ' ? 1 : 0);
        this.input.setSelectionRange(afterMark, afterMark);
    }

    /**
     * The editor committed a value: write it into the host as the leading mark
     * in front of the free text the editing session started with.
     */
    private onPickerChange(): void {
        if (!this.picker) return;
        this._userEdited = true;
        const rendered = this.picker.getRendered().trim();
        const freeText = this._pickerFreeText;

        if (rendered) {
            const full = this.wrapRendered(rendered);
            // User-driven picker edit: hosts observing ordinary input events
            // must see it (Host Form Contract).
            this.setHostValue(this.joinMarkingAndText(full, freeText));
        } else {
            this.setHostValue(freeText);
        }

        this.updateMarkEnd();
        // Later commits in this session keep the free text that follows the
        // mark now written.
        this._pickerFreeText = this.getFreeText();
        this.renderDisplay();
        this.picker.focus();
    }

    /**
     * Close the editor through the composer's commit: a draft that does not
     * read completely stays open and marked invalid instead of being dropped.
     */
    protected async closePicker(): Promise<void> {
        if (!this.picker) return;
        const outcome = await this.picker.commit();
        if (outcome === 'invalid') return;
        this.finishPicker();
    }

    /** Close an editor whose value is already committed. */
    private finishPicker(): void {
        // Save the picker's assertions so syncFromInput can skip re-parsing the
        // rendered text (rendering round-trips are not always lossless).
        if (this.picker) {
            // Commit path: fixes the engine applied inside the editor belong
            // to the committed value, so they join the field's mark record.
            // (Escape-cancel never reaches here and discards them.)
            this.recordMarkFixes(
                this.picker.getAssertions(),
                this.picker.getAppliedFixes(),
            );
            const rendered = this.picker.getRendered().trim();
            // Wrapped as the field writes it, to match what getMarkString() sees.
            const wrappedRendered = this.wrapRendered(rendered).trimEnd();
            this._editorAssertions = {
                marking: wrappedRendered,
                assertions: this.picker.getAssertions(),
            };
        }

        this.finishClose();
        this.renderDisplay();
    }

    private onKeydown(e: KeyboardEvent): void {
        if (this.picker && e.key === 'Escape') {
            e.preventDefault();
            this.escapeClosePicker();
            return;
        }

        if (!this.picker && e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            void this.openPicker({ fromTyped: true });
            return;
        }

        // The owned editor is a <textarea>, but the field's VALUE is one single logical
        // line: a plain Enter (with or without Shift) must never insert the
        // newline a real textarea would otherwise give it. Ctrl/Cmd+Enter is
        // handled above and already returns before reaching here; every other
        // Enter falls through to this guard.
        if (e.key === 'Enter') {
            e.preventDefault();
            return;
        }

        // A printable keystroke with the caret inside the marking region would
        // corrupt the token before the async auto-open (mouseup RAF /
        // selectionchange) gets a chance to fire; the engine then silently
        // drops the mangled token and the marking downgrades. Route the edit
        // into the picker instead. A non-collapsed selection is left alone:
        // replacing a selected range is a legitimate native edit.
        if (
            !this.picker &&
            this.markEnd > 0 &&
            e.key.length === 1 &&
            !e.ctrlKey &&
            !e.metaKey &&
            !e.altKey
        ) {
            const s = this.input.selectionStart ?? 0;
            const collapsed = s === (this.input.selectionEnd ?? 0);
            if (collapsed && s < this.markEnd) {
                e.preventDefault();
                const afterMark =
                    this.markEnd +
                    (this.input.value[this.markEnd] === ' ' ? 1 : 0);
                this.input.setSelectionRange(afterMark, afterMark);
                void this.openPicker({ openList: false });
            }
        }
    }

    /** Caret target just past the marking (one space accounted for). */
    protected captureCaretTarget(): number {
        return this.markEnd + (this.input.value[this.markEnd] === ' ' ? 1 : 0);
    }

    /** Place the caret just past the marking after a host-level Escape close. */
    protected restoreCaretAfterEscape(target: number | null): void {
        const afterMark = target ?? this.markEnd;
        this.input.setSelectionRange(afterMark, afterMark);
    }

    protected afterClose(): void {
        void this.syncFromInput();
    }

    /** Reset mark-position state after an Escape cancel restored the value. */
    protected afterCancel(_valueRestored: boolean): void {
        this.updateMarkEnd();
        this.renderDisplay();
    }

    private onSelectionChange(): void {
        if (!this.hasFocus || this._inSelectionChange) return;
        this._inSelectionChange = true;
        try {
            this.renderDisplay();
            const cursorPos = this.input.selectionStart ?? 0;
            // A real selection (Ctrl+A, Shift+Home, mouse drag) must survive:
            // collapsing it to open the picker would make select-and-copy
            // impossible (the textarea variant has the same guard).
            const hasSelection =
                this.input.selectionStart !== this.input.selectionEnd;
            const closeCooldown = performance.now() - this._lastCloseTime < 200;
            // If the cursor drifts into the marking region (0..markEnd), push it
            // to the end of the mark and open the picker, same logic as MTA's
            // auto-open when cursor enters a segment.
            if (
                !hasSelection &&
                this.markEnd > 0 &&
                cursorPos < this.markEnd &&
                !this.picker &&
                !closeCooldown
            ) {
                const afterMark =
                    this.markEnd +
                    (this.input.value[this.markEnd] === ' ' ? 1 : 0);
                this.input.setSelectionRange(afterMark, afterMark);
                void this.openPicker({ openList: false });
            }
        } finally {
            this._inSelectionChange = false;
        }
    }

    private emitChange(): void {
        this._publishedTaken = takenSignature(this.assertions);
        this.options.onChange?.(this.assertions, this.rendered);
        const detail = { rendered: this.rendered, assertions: this.assertions };
        this.nativeInput.dispatchEvent(
            new CustomEvent('ezclassify:change', { bubbles: true, detail }),
        );
        this.container.dispatchEvent(
            new CustomEvent('ezclassify:change', { bubbles: true, detail }),
        );
    }
}

/** A signature of the values in `assertions` taken from a whole. */
function takenSignature(assertions: readonly Assertion[]): string {
    return assertions
        .filter(takenFromWhole)
        .map((one) => `${one.categoryId}\u0000${one.conceptId}`)
        .sort()
        .join('\u0001');
}
