/**
 * MarkingField: a text-first field whose ENTIRE value is the marking, nothing
 * else.
 *
 * Progressive enhancement of a native text input or textarea. The original
 * control stays authoritative for form values, events and bindings. A text
 * input uses an owned, unnamed textarea so long markings wrap; an existing
 * textarea is its own editor. At rest a painted layer shows category colors,
 * while the editable textarea stays keyboard and accessibility reachable.
 *
 * What typing, Enter, Tab, Escape and blur do is the composer's commit table,
 * identical across the field family. This field supplies only its shape (the
 * text is the whole marking), where the composer opens from, and how the
 * committed value is displayed. A blur whose draft does not read completely
 * keeps the draft visible, marked invalid, instead of painting the old value
 * over it: the typed text stays on screen and nothing is stored.
 *
 * Built on {@link ComponentBase} rather than MarkedFieldBase: that base exists
 * for MarkedInput's "one embedded marking inside larger free text" shape. The
 * base's enhancedInput always remains the original control; only the private
 * host getter selects the owned wrapping editor for presentation.
 */

import type { Fix, SchemeMetaView } from '@ezclassify/types';
import { ComponentBase, type ComponentOptions } from './component-base';
import { teardownAfterWrite } from './teardown-write';
import { returnToField } from './component-base-readonly';
import { getMountHost } from '../mount-host-registry';
import { resolveMarkingColor } from '../color-resolver';
import { COMPONENT_CSS } from './component-utils';
import { heightAtLeastFloor } from './dom-helpers';
import { ensureStatusMark, setStatusMarkFixes } from './status-mark';
import {
    ensureFieldDrawer,
    setFieldDrawerOrientation,
    syncFieldDrawerTheme,
} from './field-chrome-drawer';
import {
    ensureFavoritesButton,
    schemeOffersPresets,
    type FavoritesConfig,
    type FavoritesPanel,
    type FavoritesPanelHost,
} from './favorites-panel';
import { t } from '../i18n';
import { fixAssertions } from './rule-errors';
import { flattenTree, type TokenNode } from '../token-tree/token-tree';
import {
    ComposerController,
    type CommitOutcome,
} from './composer/composer-controller';
import { ComposerView, accessibleLabel } from './composer/composer-view';
import markingFieldCss from './marking-field.css?inline';

/**
 * Enhances a native text input or textarea whose `.value` is the complete
 * rendered marking. No leading/trailing free text, no chips.
 */
export class MarkingField extends ComponentBase {
    static readonly CSS: string = COMPONENT_CSS + markingFieldCss;

    private wrap!: HTMLDivElement;
    private editor: HTMLTextAreaElement | null = null;
    private releaseEditor: (() => void) | null = null;
    private forwarding = false;
    private syncEditorState: (() => void) | null = null;
    private display!: HTMLDivElement;
    /** The ★ drawer hosting the status mark + favorites button. */
    private drawer!: HTMLElement;
    /** Whether the composer is open below the field (the drawer's edge). */
    private composerBelow = false;
    private favoritesPanel: FavoritesPanel | null = null;
    private controller!: ComposerController;
    private view!: ComposerView;
    /** True while the host textarea is the visible, editable surface. */
    private hasFocus = false;
    /**
     * True from the start of a mount-time host correction until its write
     * lands. The write dispatches the host's native `input` event, which must
     * not read as typing.
     */
    private _committing = false;
    /** Whether setup() added aria-label itself (destroy() undoes only that). */
    private _addedAriaLabel = false;
    /**
     * The host's own `rows` content attribute before setup() overwrote it with
     * the JS-sized floor (`host.rows = 1`), or null if the author never set
     * one. destroy() restores what the author wrote.
     */
    private _originalRows: string | null = null;
    /** The theme MutationObserver installed by {@link installThemeObserver}. */
    private _themeObserver: MutationObserver | null = null;

    private boundFocus!: () => void;
    private boundDisplayMouseDown!: (e: MouseEvent) => void;

    /** The value is the WHOLE marking: same format role as TagInput. */
    protected override resolveDefaultFormatId(meta: SchemeMetaView): string {
        return meta.defaultWholeRenderFormat ?? meta.defaultRenderFormat ?? '';
    }

    /** Editable presentation; enhancedInput remains the authoritative control. */
    private get host(): HTMLTextAreaElement {
        return (
            this.editor ??
            (this.enhancedInput as unknown as HTMLTextAreaElement)
        );
    }

    protected override clearButtonMount(): HTMLElement {
        this.wrap.classList.add('ez-has-clear');
        return this.wrap;
    }

    protected override hasClearValue(): boolean {
        return (
            super.hasClearValue() ||
            !!this.host.value ||
            this.controller.isDirty()
        );
    }

    protected override discardDraft(): void {
        this.controller.discard();
    }

    protected setup(): void {
        this.resolveCorrectHost();
        const native = this.enhancedInput;
        if (
            !native ||
            (native.tagName !== 'TEXTAREA' &&
                !(native.tagName === 'INPUT' && native.type === 'text'))
        ) {
            throw new Error('MarkingField requires a textarea or text input.');
        }
        this.injectComponentStyles(markingFieldCss);

        this.wrap = document.createElement('div');
        this.wrap.className = 'marking-field-wrap';
        native.parentNode?.insertBefore(this.wrap, native);
        this.wrap.appendChild(native);
        if (native.tagName === 'INPUT') this.createInputEditor(native);
        const host = this.host;

        host.classList.add('marking-field-host');
        host.setAttribute('autocomplete', 'off');
        host.setAttribute('spellcheck', 'false');
        // rows=1 is the JS-sized floor (matches .marking-field-display's
        // min-height): syncHostHeight() grows the textarea to fit its content.
        this._originalRows = host.hasAttribute('rows')
            ? host.getAttribute('rows')
            : null;
        host.rows = 1;
        // A consumer <label for="..."> already targets this element, so only
        // fall back to the generic label when neither exists.
        if (!host.hasAttribute('aria-label') && host.labels?.length === 0) {
            host.setAttribute('aria-label', t('aria.markingInput'));
            this._addedAriaLabel = true;
        }
        if (this.options.placeholder)
            host.placeholder = this.options.placeholder;

        this.display = document.createElement('div');
        this.display.className = 'marking-field-display';
        this.display.setAttribute('aria-hidden', 'true');
        this.wrap.appendChild(this.display);

        // Mirror the host's own box styling onto the display (host-first
        // design: see styles.css's header comment) so the painted display
        // always matches the host's border, padding, and colors.
        const capturedStyles = this.captureAndMirrorStyles();
        this.installThemeObserver();
        this.syncHostHeight();

        this.controller = new ComposerController({
            port: this.composerPort('whole'),
            shape: 'whole',
            announce: (text) => this.view?.announce(text),
        });
        this.view = new ComposerView({
            controller: this.controller,
            committedValidity: () => this.valueValidationMessage,
            input: host,
            anchor: this.wrap,
            bounds: (this.options.root as HTMLElement | undefined) ?? this.wrap,
            label: () =>
                accessibleLabel(
                    this.enhancedInput ?? host,
                    t('aria.markingInput'),
                ),
            css:
                this.options.injectStyles === false
                    ? undefined
                    : COMPONENT_CSS + markingFieldCss,
            singleLine: true,
            placeholder: this.options.placeholder ?? host.placeholder,
            describeConcept: this.shouldShowTooltip()
                ? (conceptId, categoryId) =>
                      this.resolveConceptDescription(conceptId, categoryId)
                : undefined,
            onPlacement: (open, side) => {
                this.composerBelow = open && side === 'below';
                this.setEditorOpen(open);
                this.syncDrawerOrientation();
            },
            onDraft: (text) => {
                if (this.editor) this.enhancedInput!.value = text;
                if (this.hasFocus || this.controller.snapshot().invalid) {
                    this.syncHostHeight();
                }
            },
            onBlurCommit: (outcome) => this.rest(outcome),
        });
        if (this.editor) this.wireInputEditor();
        this.container.appendChild(this.view.announcer);
        this.wrap.insertAdjacentElement('afterend', this.view.note);

        // The status mark + ★ favorites button live in a small drawer attached
        // to the field's bottom-right edge, mirroring to the top while the
        // composer opens below (onPlacement above).
        this.drawer = ensureFieldDrawer(this.wrap, { root: this.options.root });
        syncFieldDrawerTheme(this.drawer, {
            borderColor: capturedStyles.borderColor,
            backgroundColor: capturedStyles.backgroundColor,
            marginTop: capturedStyles.marginTop,
            marginBottom: capturedStyles.marginBottom,
        });
        ensureStatusMark(this.drawer, {
            shape: 'chrome',
            root: this.options.root,
            shouldShowTooltip: () => this.options.tooltips !== false,
        });
        // The value read at init may already carry fixes the engine applied.
        setStatusMarkFixes(this.drawer, this.getAppliedFixes());
        if (
            this.options.favorites ||
            schemeOffersPresets(this.scheme, this.options.scope)
        ) {
            this.favoritesPanel = ensureFavoritesButton(
                this.drawer,
                this.favoritesHost(this.options.favorites),
            );
        }

        this.boundFocus = () => this.setEditingMode(true);
        this.boundDisplayMouseDown = (e) => this.onDisplayMouseDown(e);
        host.addEventListener('focus', this.boundFocus);
        this.display.addEventListener('mousedown', this.boundDisplayMouseDown);

        this.syncEditorState?.();
        this.setEditingMode(document.activeElement === host);
        if (!this.hasFocus) this.paintTokens();
    }

    /**
     * Build presentation without copying the host's identity or scanner
     * bindings.
     */
    private createInputEditor(native: HTMLInputElement): void {
        const editor = (this.editor = document.createElement('textarea'));
        editor.className = native.className;
        editor.value = native.value;
        editor.defaultValue = native.defaultValue;
        this.wrap.appendChild(editor);
        const hidden = native.hidden;
        const hadClass = native.classList.contains('marking-field-native');
        native.hidden = true;
        native.classList.add('marking-field-native');
        const focus = Object.getOwnPropertyDescriptor(native, 'focus');
        Object.defineProperty(native, 'focus', {
            configurable: true,
            value: (options?: FocusOptions) => editor.focus(options),
        });
        this.releaseEditor = () => {
            native.hidden = hidden;
            if (!hadClass) native.classList.remove('marking-field-native');
            if (!native.className) native.removeAttribute('class');
            if (focus) Object.defineProperty(native, 'focus', focus);
            else delete (native as unknown as { focus?: unknown }).focus;
        };
    }

    /** Forward native form interaction once; drafts remain native form values. */
    private wireInputEditor(): void {
        const native = this.enhancedInput!;
        const editor = this.editor!;
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
                const value =
                    name === 'placeholder'
                        ? (this.options.placeholder ??
                          native.getAttribute(name))
                        : native.getAttribute(name);
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
            const locked = editor.matches(':disabled') || editor.readOnly;
            if (this.drawer) this.drawer.inert = locked;
            if (locked) this.controller.close();
        };
        this.syncEditorState = sync;
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
        ) {
            if (parent.tagName === 'FIELDSET')
                observer.observe(parent, {
                    attributes: true,
                    attributeFilter: ['disabled'],
                });
        }
        cleanups.push(() => observer.disconnect());
        let hostValidity = native.validity.customError
            ? native.validationMessage
            : '';
        const validityDescriptor = Object.getOwnPropertyDescriptor(
            native,
            'setCustomValidity',
        );
        const writeValidity = native.setCustomValidity.bind(native);
        // Host validation stays live beneath the composer's temporary error.
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
        syncValidity();
        cleanups.push(() => {
            validityObserver.disconnect();
            if (validityDescriptor)
                Object.defineProperty(
                    native,
                    'setCustomValidity',
                    validityDescriptor,
                );
            else delete (native as Partial<HTMLInputElement>).setCustomValidity;
            writeValidity(hostValidity);
        });
        // A native text input strips line breaks. Let it sanitize a paste
        // before the shared composer reads the editor's input event.
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
                this.forwarding = true;
                try {
                    native.dispatchEvent(new Event(type, { bubbles: true }));
                } finally {
                    this.forwarding = false;
                }
            });
            on(native, type, () => {
                if (
                    !this.forwarding &&
                    !this._committing &&
                    native.value !== this._lastRendered
                )
                    void this.setValue(native.value);
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
        for (const label of Array.from(native.labels ?? [])) {
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
        }
        on(native, 'invalid', (event) => {
            event.preventDefault();
            editor.focus();
        });
        if (native.form)
            on(native.form, 'reset', (event) => {
                queueMicrotask(() => {
                    if (this._destroyed || event.defaultPrevented) return;
                    const value = native.value;
                    this.controller.close();
                    this.controller.escape();
                    native.value = value;
                    void this.setValue(value);
                });
            });
        const release = this.releaseEditor!;
        this.releaseEditor = () => {
            for (const cleanup of cleanups) cleanup();
            this.syncEditorState = null;
            release();
        };
    }

    protected render(): void {
        if (!this.engine || !this.scheme) return;
        // A commit or an external value change landed: a draft that matched
        // the old value follows the new one.
        this.controller?.syncCommitted();
        if (this.hasFocus || this.controller?.snapshot().invalid) {
            this.syncHostHeight();
        } else {
            this.paintTokens();
        }
        setStatusMarkFixes(this.drawer, this.getAppliedFixes());
        if (this.favoritesPanel) {
            this.favoritesPanel.updateHost(
                this.favoritesHost(this.options.favorites),
            );
            this.favoritesPanel.syncStar();
        }
    }

    /**
     * Favorites context for this field: apply REPLACES the marking, exactly
     * `setValue()` (process the favorite through this field's own scheme/
     * format, adopt the result). Rebuilt on every render so the panel's
     * closures never capture stale assertions/rendered state. `config` is
     * undefined for a presets-only mount (no host favorites wiring); the panel
     * itself tolerates that and runs read-only.
     */
    private favoritesHost(
        config: FavoritesConfig | undefined,
    ): FavoritesPanelHost {
        return {
            root: this.options.root,
            schemeId: this.schemeId,
            scope: this.options.scope,
            formatId: this.formatId,
            scheme: this.scheme,
            config,
            read: (marking) =>
                Promise.resolve(
                    this.callValidate(marking, {
                        outputFormat: this.formatId,
                        context: this.getProcessingContext(),
                    }),
                ),
            applyPreset: (presetId) =>
                this.callApplyPreset(presetId, this.formatId),
            getCurrent: () => ({
                // What the result row shows while a draft is open, the
                // committed value otherwise.
                rendered:
                    this.controller.snapshot().reading?.rendered ??
                    this._lastRendered,
                valid:
                    this.assertions.length > 0 &&
                    !this.container.hasAttribute('data-ezclassify-invalid'),
            }),
            onApply: (marking) => void this.setValue(marking),
            focusField: () => this.host.focus(),
        };
    }

    /**
     * Put the ★ drawer on the edge nothing else is using: the top while the
     * composer opens below the field or the error list shows under it (the
     * drawer must never cover what the user is being asked to fix), the bottom
     * otherwise.
     */
    private syncDrawerOrientation(): void {
        if (!this.drawer) return;
        setFieldDrawerOrientation(
            this.drawer,
            this.composerBelow || this.hasVisibleValidationErrors()
                ? 'top'
                : 'bottom',
        );
    }

    protected override onRuleErrorsChanged(): void {
        this.view?.refreshValidity();
        this.syncDrawerOrientation();
    }

    /**
     * Return the complete uncommitted marking, or null when no complete draft
     * exists.
     */
    pendingDraft(): string | null {
        if (this._destroyed || !this.controller?.isDirty()) return null;
        // Only a draft that reads completely, and as the marking it reads to:
        // typed text the engine has not accepted is never kept as a marking.
        return this.controller.completeReading()?.rendered ?? null;
    }

    /** Also read an open draft again, so its fix rows account for the parts. */
    override refreshParts(): void {
        super.refreshParts();
        if (this.coversParts && !this._destroyed)
            void this.controller?.refreshContext();
    }

    destroy(): void {
        teardownAfterWrite(
            this,
            this.controller?.isDirty() ? () => this.controller.commit() : null,
            () => this.teardown(),
        );
    }

    private teardown(): void {
        this.destroyClearButton();
        this.removeRuleErrors();
        this._destroyed = true;
        this.releaseEditor?.();
        this.releaseEditor = null;
        this.view.destroy();
        this.controller.dispose();
        this.host.removeEventListener('focus', this.boundFocus);
        this.display.removeEventListener(
            'mousedown',
            this.boundDisplayMouseDown,
        );
        this._themeObserver?.disconnect();
        this._themeObserver = null;
        this.favoritesPanel?.destroy();
        this.favoritesPanel = null;

        // Undo the enhancement: a host that unmounts this component gets back
        // a plain, visible, unmarked <textarea>.
        this.host.classList.remove(
            'marking-field-host',
            'marking-field-host--resting',
        );
        this.host.removeAttribute('autocomplete');
        this.host.removeAttribute('spellcheck');
        this.host.style.removeProperty('height');
        if (this._originalRows !== null) {
            this.host.setAttribute('rows', this._originalRows);
        } else {
            this.host.removeAttribute('rows');
        }
        if (this._addedAriaLabel) this.host.removeAttribute('aria-label');

        // Only a host still inside the field goes back in its place. A host the
        // page removed itself stays removed: putting it back would bring it
        // (and whatever it holds) back into the page, where the scanner would
        // mount a new field on it.
        const native = this.enhancedInput!;
        if (this.wrap.parentNode && native.parentNode === this.wrap) {
            this.wrap.parentNode.insertBefore(native, this.wrap);
        }
        this.editor?.remove();
        this.editor = null;
        this.wrap.remove();
        if (!this.container.contains(native)) this.container.innerHTML = '';
    }

    /**
     * Bind the exact registered native control, never the first sibling input.
     * Seed its own value before the base's post-setup write can touch it; the
     * subsequent read must not reuse another field's assertions.
     */
    private resolveCorrectHost(): void {
        const correctHost = getMountHost(this.container) as
            HTMLInputElement | undefined;
        if (!correctHost || correctHost === this.enhancedInput) return;
        this.enhancedInput = correctHost;
        // Seed _lastRendered/assertions from the CORRECT host's own value
        // synchronously, before returning, so the base's post-setup
        // `enhancedInput.value = this._lastRendered` write
        // (component-base-readonly.ts, right after setup() returns) is a
        // no-op. Without this, that line runs in the gap between this method
        // returning and setValue()'s microtask landing below, overwriting the
        // just-corrected host with the WRONG (previous) host's stale rendered
        // value; setValue's own write-back then sees a real difference and
        // dispatches a spurious bubbling `input` event on a field the user
        // never touched. Clearing assertions rather than reusing the previous
        // host's is deliberate: painting the previous host's concepts on this
        // one would show the wrong data, which is worse than a brief blank
        // paint until the reprocess below lands.
        this.assertions = [];
        this._lastRendered = correctHost.value;
        this._committing = true;
        void this.setValue(correctHost.value).catch(() => {
            this._committing = false;
        });
    }

    // --- Focus / rest: swap between the editable host and the painted display ---

    /**
     * Switch between the editable host (plain text, no colors) and the painted
     * display. The host is never `display:none`: it stays mounted, in the tab
     * order, and in the accessibility tree at all times.
     */
    private setEditingMode(editing: boolean): void {
        this.hasFocus = editing;
        this.showHost(editing);
    }

    /**
     * Show the host textarea (editing, or an invalid draft at rest) or the
     * painted display.
     */
    private showHost(visible: boolean): void {
        this.host.classList.toggle('marking-field-host--resting', !visible);
        this.display.style.display = visible ? 'none' : '';
        if (visible) {
            // Back in normal flow, the textarea's height must already match
            // its (possibly wrapped) content.
            this.syncHostHeight();
        } else {
            // Clear the inline height syncHostHeight() left behind: with
            // top+bottom+height the absolutely positioned resting host keeps
            // the stale height instead of stretching to the display (CSS2.1
            // 10.6.4).
            this.host.style.height = '';
        }
    }

    /**
     * The composer finished a blur commit. A stored or unchanged value rests on
     * the painted display; an invalid draft stays visible as typed.
     */
    private rest(outcome: CommitOutcome): void {
        if (this._destroyed || document.activeElement === this.host) return;
        this.hasFocus = false;
        if (outcome === 'invalid') {
            this.showHost(true);
            return;
        }
        this.showHost(false);
        this.paintTokens();
    }

    /**
     * Click anywhere on the painted display: back to edit mode, caret near the
     * click, composer open.
     */
    private onDisplayMouseDown(e: MouseEvent): void {
        if (this.host.matches(':disabled') || this.host.readOnly) return;
        e.preventDefault();
        const caretIndex = this.clickToCaretIndex(e.clientX, e.clientY);
        this.setEditingMode(true);
        this.host.focus();
        this.host.setSelectionRange(caretIndex, caretIndex);
        void this.view.open('pointer');
    }

    /**
     * A pressed fix makes the marking it leaves the field's value: what it
     * keeps and adds is the author's new marking, written once. The list under
     * the field answers the committed value, so with a draft open past it the
     * fix is out of date; the draft is committed instead, the way leaving the
     * field commits it, and the list then offers the fixes for it. (A fix row
     * in the composer itself answers the draft and applies directly.)
     */
    protected override ruleFixHandler(): (fix: Fix) => void {
        return (fix) => void this.applyRuleFix(fix);
    }

    private async applyRuleFix(fix: Fix): Promise<void> {
        if (this._destroyed || this._committing) return;
        if (this.controller.isDirty()) {
            await this.controller.commit();
            return;
        }
        this.assertions = fixAssertions(fix);
        this.reprocess();
    }

    /**
     * A read that raised wrote nothing, so the write the guard waits for never
     * lands: release it here, or the field would stay mid-commit for good.
     */
    protected override showReadFailure(error: unknown): void {
        super.showReadFailure(error);
        this._committing = false;
    }

    /** The editable surface is the host textarea, outside the mount. */
    protected override focusAfterFix(pointerType?: string): void {
        returnToField(this.host, this.wrap, pointerType);
    }

    /**
     * A pick writes the marking into the host as the draft, so by the time a
     * commit stores it the host may already hold exactly that text, and the
     * write-back (which dispatches `input` only when it changes the host) finds
     * nothing to do. The value still changed: tell the host form, the same as
     * any commit that changes it.
     */
    protected override async storeComposerReading(
        ...args: Parameters<ComponentBase['storeComposerReading']>
    ): Promise<void> {
        const rendered = this._lastRendered;
        const hostText = this.host.value;
        await super.storeComposerReading(...args);
        if (
            this._lastRendered !== rendered &&
            hostText === this._lastRendered
        ) {
            this.view.muteInput(() =>
                this.enhancedInput!.dispatchEvent(
                    new Event('input', { bubbles: true }),
                ),
            );
        }
    }

    /**
     * Release the mount-correction guard once its write lands, and keep a dirty
     * draft on screen when an external value arrives underneath it.
     */
    protected override onAssertionsChanged(): void {
        if (!this.view) {
            super.onAssertionsChanged();
            this._committing = false;
            return;
        }
        this.forwarding = true;
        try {
            this.view.muteInput(() => super.onAssertionsChanged());
        } finally {
            this.forwarding = false;
        }
        this._committing = false;
        if (
            this.controller.isDirty() &&
            this.host.value !== this.controller.draftText
        ) {
            this.host.value = this.controller.draftText;
        }
        if (this.editor) this.enhancedInput!.value = this.host.value;
        if (this.hasFocus) this.syncHostHeight();
    }

    // --- Host/display box: style mirroring + auto-grow height ---

    /**
     * Snapshot the host's own layout-affecting computed styles and mirror them
     * onto the display div. The theme observer re-reads getComputedStyle
     * directly on its own trigger rather than consuming this method's return
     * value; the snapshot is only needed once, at mount.
     */
    private captureAndMirrorStyles(): Record<string, string> {
        const layoutProps = [
            'marginTop',
            'marginBottom',
            'minHeight',
            'padding',
            'borderWidth',
            'borderStyle',
            'borderColor',
            'borderRadius',
            'font',
            'lineHeight',
            'color',
            'backgroundColor',
        ] as const;
        const csLive = window.getComputedStyle(
            this.editor ? this.enhancedInput! : this.host,
        );
        const captured: Record<string, string> = {};
        for (const p of layoutProps) {
            captured[p] = (csLive as unknown as Record<string, string>)[p];
        }
        // The display's own stylesheet floor, read before the host's values
        // are written over it.
        this.display.style.minHeight = '';
        const floor = window.getComputedStyle(this.display).minHeight;
        for (const p of layoutProps) {
            (this.display.style as unknown as Record<string, string>)[p] =
                captured[p];
            if (this.editor)
                (this.editor.style as unknown as Record<string, string>)[p] =
                    captured[p];
        }
        if (this.editor) this.holdSingleLineHeight(this.editor, csLive, floor);
        return captured;
    }

    /**
     * Give a text input host the single-line height every field in the family
     * shares, on both layers the field swaps between. A host whose own box is
     * shorter is padded equally above and below, so its line sits centered and
     * focusing never moves it; a host that is already taller keeps its own
     * padding and height. Only the owned editor of a text input is sized: a
     * textarea host is the author's own editing surface.
     *
     * @param editor - The owned editor over the native input.
     * @param host - The native input's computed style.
     * @param floor - The display's stylesheet `min-height` (computed).
     */
    private holdSingleLineHeight(
        editor: HTMLTextAreaElement,
        host: CSSStyleDeclaration,
        floor: string,
    ): void {
        const minHeight = heightAtLeastFloor(host.minHeight, floor);
        if (minHeight === host.minHeight) return;
        for (const layer of [this.display, editor]) {
            layer.style.minHeight = minHeight;
            layer.style.paddingTop = `max(${host.paddingTop}, calc((${minHeight} - 1lh) / 2 - ${host.borderTopWidth}))`;
            layer.style.paddingBottom = `max(${host.paddingBottom}, calc((${minHeight} - 1lh) / 2 - ${host.borderBottomWidth}))`;
        }
    }

    /**
     * Watch the document root for theme attribute changes and re-sync the
     * display's color/background to match the re-themed (still-invisible) host.
     * Same technique as MarkedFieldBase.installThemeObserver.
     */
    private installThemeObserver(): void {
        if (typeof MutationObserver === 'undefined') return;
        this._themeObserver?.disconnect();
        const observer = new MutationObserver(() => {
            // Input-specific host theme selectors remain authoritative when
            // the visible editor is an owned textarea.
            const captured = this.captureAndMirrorStyles();
            syncFieldDrawerTheme(this.drawer, {
                borderColor: captured.borderColor,
                backgroundColor: captured.backgroundColor,
                marginTop: captured.marginTop,
                marginBottom: captured.marginBottom,
            });
            if (this.hasFocus) this.syncHostHeight();
        });
        observer.observe(document.documentElement, {
            attributes: true,
            attributeFilter: [
                'data-color-scheme',
                'data-theme',
                'data-bs-theme',
                'class',
            ],
        });
        this._themeObserver = observer;
    }

    /**
     * Grow the textarea to fit its (wrapped) content instead of showing an
     * internal scrollbar. The classic auto-grow-textarea technique: collapse to
     * 'auto' first so scrollHeight reports the content's real height (a
     * taller-than-needed previous height would otherwise pin scrollHeight at
     * that old value), then set height to that. A no-op while resting: the host
     * is absolutely positioned and stretched to the wrap via inset:0 then (see
     * .marking-field-host--resting), so its own height is irrelevant until it
     * is next visible.
     *
     * ScrollHeight is content + padding only; it never includes the border,
     * even though `.marking-field-host` is box-sizing: border-box (so the
     * height this sets IS expected to cover the border, same as the box any
     * author-supplied CSS thinks it's sizing). Setting height to scrollHeight
     * directly under border-box comes up border-width short and the last line
     * clips silently: overflow:hidden on the host means no scrollbar ever
     * reveals it. Add the actual measured border back in.
     */
    private syncHostHeight(): void {
        this.host.style.height = 'auto';
        const cs = getComputedStyle(this.host);
        const borders =
            parseFloat(cs.borderTopWidth) + parseFloat(cs.borderBottomWidth);
        this.host.style.height = this.host.scrollHeight + borders + 'px';
    }

    // --- At-rest paint: per-token category colors from the token tree ---

    private paintTokens(): void {
        this.display.innerHTML = '';
        if (!this._lastRendered) {
            const placeholder = this.host.placeholder;
            if (placeholder) {
                this.display.setAttribute('data-placeholder', placeholder);
            } else {
                this.display.removeAttribute('data-placeholder');
            }
            return;
        }
        this.display.removeAttribute('data-placeholder');
        // The rendered marking IS the paint. Anything the token tree does not
        // claim is emitted verbatim as plain text, so the display's text can
        // only ever be this exact string.
        const text = this._lastRendered;
        const tokens = this.resolveTokenSpans(text);
        // Text the engine could not read is flagged where the engine's
        // recognition of the value places it.
        const unread = this.unreadSpans.filter(
            (run) =>
                !tokens.some((t) => run.start < t.end && run.end > t.start),
        );
        const spans = [
            ...tokens,
            ...unread.map((run) => ({ ...run, token: null })),
        ].sort((a, b) => a.start - b.start);
        let cursor = 0;
        for (const span of spans) {
            if (span.start > cursor) {
                this.display.appendChild(
                    document.createTextNode(text.slice(cursor, span.start)),
                );
            }
            const piece = text.slice(span.start, span.end);
            if (span.token) this.paintToken(piece, span.token);
            else this.paintUnread(piece);
            cursor = span.end;
        }
        if (cursor < text.length) {
            this.display.appendChild(
                document.createTextNode(text.slice(cursor)),
            );
        }
    }

    /**
     * Locate each token's label inside the rendered marking, left to right.
     *
     * The token tree is a SECOND derivation of the marking's structure, built
     * from the assertions rather than from the engine's renderer, and the two
     * do not agree character for character: the tree has no notion of a field's
     * per-value affix (CUI's "SP-"), sorts a category by concept position where
     * the format may sort alphabetically, and substitutes a space for a
     * within-category separator it cannot derive from a level. So the tree is
     * used for what it genuinely knows (which concept a run of characters
     * belongs to) and never for the string itself. Everything outside a matched
     * label (separators, prefixes, ordering gaps) is painted from the rendered
     * string verbatim, which is what keeps the display's text identical to the
     * value the field holds.
     *
     * Matching is a single left-to-right pass: at each offset the longest
     * unclaimed label that starts there wins, and each token is claimed once,
     * so a label repeated in two categories paints both occurrences. A match
     * must not abut an alphanumeric character on either side: a short label
     * ("SI", "G") must never paint a fragment of some longer word in a
     * free-text value. A label the renderer spelled differently simply goes
     * unmatched: it paints as plain text, uncolored, still present.
     *
     * The one piece of structure the tree does get to claim is a token's own
     * per-value affix (`each`, CUI's "SP-" or a parenthesized value), because
     * the format writes it around ONE value rather than between two: the
     * parentheses of "(NOFORN)" belong to that value the way its letters do,
     * and painting them outside the span leaves the underline starting after
     * the parenthesis and the concept tooltip not covering it. The string stays
     * the authority even so. The affix is claimed only where the rendered text
     * literally carries it immediately against the matched label, and never
     * back past a span already painted, so a runtime that suppressed the
     * framing or a format that writes it elsewhere costs nothing but the
     * decoration.
     */
    private resolveTokenSpans(
        text: string,
    ): { start: number; end: number; token: TokenNode }[] {
        const unclaimed = flattenTree(this.getTokenTree())
            .map((flat) => flat.node)
            .filter((node) => node.label.length > 0);
        const spans: { start: number; end: number; token: TokenNode }[] = [];
        const isWordChar = (ch: string | undefined): boolean =>
            ch !== undefined && /[A-Za-z0-9]/.test(ch);
        let index = 0;
        while (index < text.length) {
            let best = -1;
            for (let i = 0; i < unclaimed.length; i++) {
                const label = unclaimed[i].label;
                if (!text.startsWith(label, index)) continue;
                if (isWordChar(text[index - 1])) continue;
                if (isWordChar(text[index + label.length])) continue;
                if (best < 0 || label.length > unclaimed[best].label.length) {
                    best = i;
                }
            }
            if (best < 0) {
                index++;
                continue;
            }
            const [token] = unclaimed.splice(best, 1);
            let start = index;
            let end = index + token.label.length;
            const prefix = token.each?.prefix;
            const suffix = token.each?.suffix;
            if (
                prefix !== undefined &&
                prefix.length > 0 &&
                start - prefix.length >= 0 &&
                text.startsWith(prefix, start - prefix.length)
            ) {
                start -= prefix.length;
            }
            if (
                suffix !== undefined &&
                suffix.length > 0 &&
                text.startsWith(suffix, end)
            ) {
                end += suffix.length;
            }
            spans.push({ start, end, token });
            index = end;
        }
        return spans;
    }

    /** Paint author text the engine could not read, flagged as such. */
    private paintUnread(text: string): void {
        const span = document.createElement('span');
        span.className = 'marking-field-unread';
        span.textContent = text;
        this.display.appendChild(span);
    }

    private paintToken(label: string, token: TokenNode): void {
        const span = document.createElement('span');
        span.className = 'marking-field-token';
        let underline = false;
        if (token.conceptId) {
            const concept = this.scheme.concepts.find(
                (c) => c.id === token.conceptId,
            );
            const authority = resolveMarkingColor(
                { colorFrom: this.colorFrom },
                [
                    {
                        conceptId: token.conceptId,
                        categoryId: token.categoryId,
                        color: concept?.color,
                    },
                ],
                this.scheme,
            );
            const colors =
                this.options.colorMap?.[token.conceptId] ?? authority;
            // At-rest paint is an underline, not a filled background: the token
            // keeps normal foreground text and only the underline carries the
            // category color, so this is the sole color property a token needs.
            // Set on the outer span (inherited down to the word runs
            // paintTokenLabel creates below) rather than duplicated per run.
            span.style.setProperty(
                '--ez-token-underline',
                colors?.background ?? this.getCategoryColor(token.categoryId),
            );
            this.attachConceptTooltip(span, token.conceptId, token.categoryId);
            underline = true;
        }
        this.paintTokenLabel(span, label, underline);
        this.display.appendChild(span);
    }

    /**
     * Render a token's label as alternating word runs and whitespace, so the
     * underline (marking-field-token-run, marking-field.css) only ever wraps
     * real characters. A multi-word label like "STATE ASSESSMENT STAFF" or "ON
     * HOLD" would otherwise sit in the token span as ONE text node with an
     * internal space; under `white-space: pre-wrap`, a wrap point that lands on
     * that space (including the space stranded after an earlier word had to
     * hard-break, see marking-field.css) still paints under it: a
     * category-colored underline fragment with no glyph beneath, an isolated
     * dash after a word such as "ON". Splitting the label so whitespace is
     * always a plain, undecorated text node (and every non-whitespace run gets
     * its own decorated span) keeps the paint tight to actual glyphs regardless
     * of where the line wraps. Skipped for a token with no conceptId
     * (underline=false): plain text, no run spans needed.
     */
    private paintTokenLabel(
        container: HTMLElement,
        label: string,
        underline: boolean,
    ): void {
        for (const part of label.split(/(\s+)/)) {
            if (part === '') continue;
            if (underline && !/^\s+$/.test(part)) {
                const run = document.createElement('span');
                run.className = 'marking-field-token-run';
                run.textContent = part;
                container.appendChild(run);
            } else {
                container.appendChild(document.createTextNode(part));
            }
        }
    }

    /**
     * Resolve the click point on the painted display to a character offset in
     * the host's value. The display's text nodes reconstruct exactly what the
     * token tree rendered (which is `_lastRendered`), so walking them in order
     * gives an offset into that same string. This relies on the display only
     * ever being clickable at rest, and `commitAndRest()` reconciling
     * `host.value` to `_lastRendered` before every rest-time paint, so the two
     * strings are guaranteed equal whenever this runs. Falls back to
     * end-of-text when point-to-caret APIs are unavailable or the point misses
     * the display (e.g. a click past the last token).
     */
    private clickToCaretIndex(x: number, y: number): number {
        const withCaret = document as Document & {
            caretRangeFromPoint?: (x: number, y: number) => Range | null;
            caretPositionFromPoint?: (
                x: number,
                y: number,
            ) => { offsetNode: Node; offset: number } | null;
        };
        let node: Node | null = null;
        let offset = 0;
        if (typeof withCaret.caretRangeFromPoint === 'function') {
            const range = withCaret.caretRangeFromPoint(x, y);
            if (range) {
                node = range.startContainer;
                offset = range.startOffset;
            }
        } else if (typeof withCaret.caretPositionFromPoint === 'function') {
            const pos = withCaret.caretPositionFromPoint(x, y);
            if (pos) {
                node = pos.offsetNode;
                offset = pos.offset;
            }
        }
        if (!node || !this.display.contains(node))
            return this.host.value.length;

        let total = 0;
        const walker = document.createTreeWalker(
            this.display,
            NodeFilter.SHOW_TEXT,
        );
        let current = walker.nextNode();
        while (current) {
            if (current === node) return total + offset;
            total += current.textContent?.length ?? 0;
            current = walker.nextNode();
        }
        return total;
    }
}

/** Options accepted by MarkingField (no additions beyond the shared surface). */
export type MarkingFieldOptions = ComponentOptions;
