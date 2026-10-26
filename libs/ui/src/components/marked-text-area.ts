/**
 * MarkedTextArea: progressively enhances a <textarea> whose value contains
 * inline markings (e.g. "(U) Para one.\n\n(S) Para two."). The textarea
 * captures all keyboard/mouse input but is fully invisible. A display div
 * renders styled text with marking chips, a blinking caret, and selection
 * highlights; all in one text flow, so there is zero drift between cursor and
 * text.
 *
 * Press Ctrl+Enter (Cmd+Enter on Mac) to open the marking picker. If the caret
 * is inside an existing marking, the picker edits it. Otherwise a new marking
 * template is inserted.
 *
 * Shared scaffolding (engine binding, theme sync, footer, picker close/destroy,
 * doc-level Escape/outside-click handlers) lives in {@link MarkedFieldBase};
 * this subclass supplies the multi-line, many-segment specifics.
 */

import type {
    Assertion,
    ProcessResult,
    Change,
    ProcessingContext,
    ValidationError,
} from '@ezclassify/types';
import type { ComponentEngineSource } from './component-base-readonly';
import type { ComponentOptions } from './component-base-readonly';
import { isAddressableSchemeEngine } from './component-base-readonly';
import { HiddenAssertionField } from './hidden-assertion-field';
import { InlineMarkingEditor } from './inline-marking-editor';
import { accessibleLabel } from './composer/composer-view';
import { assertionFactKey, withoutTakenFromWhole } from '../assertion-identity';
import { t } from '../i18n';
import { createAnnouncer } from './accessibility-helpers';
import { getMountHost } from '../mount-host-registry';
import { wholeSettled } from '../whole-read-gate';
import { revealClearOfPinned } from './composer/composer-placement';
import { replacesMarks } from './composer/composer-controller';
import {
    ensureStatusMark,
    recordAppliedFixes,
    setStatusMarkError,
    setStatusMarkFixes,
} from './status-mark';
import {
    ensureFavoritesButton,
    schemeOffersPresets,
    type FavoritesPanel,
} from './favorites-panel';
import {
    attachTooltip,
    cleanupTooltipForRoot,
    hideTooltip,
    showTooltip,
} from './tooltip-manager';
import {
    MarkedFieldBase,
    type MarkedFieldClassNames,
} from './marked-field-base';
import markedCss from './marked-text-area.css?inline';
import type { EzClassifyState } from '../store/ezclassify-store';
import {
    projectEntrySpans,
    reconcileEntryIds,
    rebaseEntrySpans,
    rebaseOffset,
    textEdit,
    type MarkingEntrySpan,
} from './marked-text-area-entries';

import {
    extractInner as extractInnerLogic,
    applyRepairs as applyRepairsLogic,
    fixesNeedingCorrection,
    keepLeadingPartMarks,
    matchLeadingMark,
    markAttention,
    type MarkAttention,
    paragraphNumber,
} from './marked-text-area-logic';

/** One marking found in the textarea plus the body text that follows it. */
export interface MarkedSegment {
    /** Stable store entry identity, absent for unrecognized source text. */
    entryId?: string;
    /**
     * Loaded source cannot be replaced while recognition or a safe correction
     * is unresolved.
     */
    preserveSource?: boolean;
    /**
     * A contextual read raised; only a successful reread clears this
     * diagnostic.
     */
    readFailure?: string;
    /**
     * Source recognition/correction is unresolved independently of a thrown
     * contextual read.
     */
    sourceUnresolved?: boolean;
    /**
     * Character offset of the marking's opening delimiter in the textarea
     * value.
     */
    start: number;
    /** Character offset just past the marking's closing delimiter. */
    end: number;
    /** The literal marking string including delimiters (e.g. "(U)"). */
    marking: string;
    /** Engine assertions for the marking. */
    assertions: Assertion[];
    /** Rendered marking (format matches scan output). */
    rendered: string;
    /** Body text from end of this marking to the start of the next (trimmed). */
    text: string;
    /** Whether this marking is valid according to the engine. */
    valid: boolean;
    /** Validation error messages. */
    errors: string[];
    /**
     * The engine's warnings for the marking. A warning never makes it invalid;
     * the chip shows it in the warning color.
     */
    warnings?: string[];
    /** The validation errors as the engine reported them. */
    validationErrors: ValidationError[];
    /** True if the engine applied repair rules to this marking. */
    repaired: boolean;
    /**
     * Safe engine fixes detected on load but deliberately deferred until the
     * author opens and commits this marking.
     */
    pendingFixes?: Change[];
}

/** Caller-facing options for MarkedTextArea. */
export interface MarkedTextAreaOptions extends ComponentOptions {
    /** The host binds ordered entries; hidden children are projection-only. */
    entryStoreManaged?: boolean;
    /** Resolve the whole/banner marking at call time for part-of context. */
    resolveContext?: () => ProcessingContext | undefined;
    /** Format identifier used by engine.scan for part parsing. */
    scanFormat?: string;
    /**
     * Format identifier applied to each hidden child field. Defaults to
     * scanFormat.
     */
    hiddenFormat?: string;
    /**
     * Marking id the hidden part fields declare themselves part-of. Per
     * binding-model §16, each hidden field is its own marking object with
     * `part-of=<this id>`, where `<this id>` is the textarea's marking-id; not
     * the page-level rollup. The textarea retains its own page-level `part-of`
     * independently.
     */
    partOfId?: string;
    /** Called to register a hidden field in the forms context. */
    registerHiddenField?: (el: HTMLElement) => HiddenAssertionField | null;
    /** Called to unregister a hidden field from the forms context. */
    unregisterHiddenField?: (el: HTMLElement) => void;
    /**
     * Called when what the field's last scan read changes: whether it read the
     * whole text, and whether it read the first portion at all. Called with
     * both `true` when the field goes away having reported otherwise. The
     * runtime records the field as an incomplete contributor to its rollups and
     * flags a marking bound to an unread first portion.
     *
     * @internal
     */
    onScanCompleteness?: (complete: boolean, firstPortionRead: boolean) => void;
}

/** Numbers each field's incomplete-scan notice, so its id is unique. */
let scanNoticeCount = 0;

/**
 * Enhances a textarea with inline marking validation. The textarea is
 * invisible; a display div renders styled text with chips, caret, and
 * selection.
 */
export class MarkedTextArea extends MarkedFieldBase<HTMLTextAreaElement> {
    /**
     * The textarea aggregates the part markings it owns; it has no whole
     * marking of its own, so the rollup must never offer it a whole
     * correction.
     */
    readonly authorsWhole = false;
    protected readonly componentLabel = 'MarkedTextArea';
    protected readonly css = markedCss;
    protected readonly hintSuffix = ` ${t('hint.toAddMarking')}`;
    protected readonly hintActionKey = 'hint.addMarking' as const;
    protected readonly classNames: MarkedFieldClassNames = {
        wrap: 'marked-textarea-wrap',
        display: 'marked-textarea-display',
        footer: 'marked-textarea-footer',
        kbHint: 'marked-textarea-kb-hint',
        touchAdd: 'marked-textarea-touch-add',
        hintChrome: 'marked-textarea-hint-chrome',
        pickerActive: 'marked-textarea-picker-active',
    };

    protected override options: MarkedTextAreaOptions = {};

    /** Alias kept for readability against the host element. */
    private get textarea(): HTMLTextAreaElement {
        return this.host;
    }

    private popup!: HTMLDivElement;
    private hiddenRoot!: HTMLDivElement;

    private segments: MarkedSegment[] = [];
    /**
     * Committed portions past where an incomplete scan stopped whose mark an
     * edit rewrote or removed. Nothing has read what replaced them, so they
     * keep what they committed, and their place in the rollups, until a
     * complete scan replaces them. They have no mark in the text, so each sits
     * at an empty anchor where its mark was and is not displayed.
     */
    private heldPortions: MarkedSegment[] = [];
    private hiddenFields: (HiddenAssertionField | null)[] = [];
    private hiddenContainers: HTMLDivElement[] = [];
    private hiddenGeneration = 0;
    private entryWriteSeq = 0;
    private entryOrder: readonly string[] = [];
    private emptyEntries: Array<MarkingEntrySpan & { entryId: string }> = [];
    private applyingEntryState = false;

    private activeRange: { start: number; end: number } | null = null;
    /**
     * Segment index the cursor was last inside: used to detect enter/leave
     * transitions.
     */
    private activeSegmentIndex = -1;
    private favoritesPanel: FavoritesPanel | null = null;
    /**
     * Caret position snapshotted on every focused selectionchange. The
     * favorites panel applies "stamp at caret" against THIS, not the live
     * `textarea.selectionStart`: Tab-ing from the textarea to the ★ button
     * blurs the field, but the caret position the user meant to stamp at is the
     * one they left behind, not wherever the DOM selection happens to report
     * once focus has moved on.
     */
    private _lastCaret = 0;

    /**
     * Resolved in init(), after bindEngine(), from the options or the resolved
     * scan format. It stays an empty string until then; the constructor never
     * sets it.
     */
    private hiddenFormat = '';
    private partOfId: string | undefined;
    private targetIdPrefix = 'para-';

    /**
     * Display-size observer; stored so destroy() can disconnect it. Without
     * that, repeated mount/unmount in SPA hosts accumulates live observers
     * holding detached DOM.
     */
    private _resizeObserver: ResizeObserver | null = null;

    /**
     * Fixes the engine applied across the textarea's markings, deduplicated by
     * rule. Drives the field's single status mark (per the Enhancement Status
     * Indicator contract there is one mark per field, never one star per
     * repaired segment). Cleared when the textarea empties or a marking in it
     * is replaced.
     */
    private _appliedFixes = new Map<string, Change>();
    /**
     * What each marking held when {@link _appliedFixes} was last written, one
     * entry per marking, in no particular order.
     */
    private _fixesHeld: readonly (readonly Assertion[])[] = [];
    /**
     * Whether the last scan offered the whole text to recognition. A scan that
     * stops early (a region cap, a work budget) returns the markings it reached
     * and nothing past them, which reads exactly like prose with no markings
     * left in it. The field says so instead: its status mark shows an error,
     * the textarea is invalid, and its rollups are flagged stale.
     */
    private scanComplete = true;
    /**
     * Whether the last scan read the first portion. A scan that stops before
     * any portion leaves the first one, and any marking bound to it, unread.
     */
    private firstPortionRead = true;
    /** The completeness last reported to validity and the runtime. */
    private reportedScanComplete = true;
    /**
     * Whether the last scan failed outright. The next edit scans again even
     * when it returns the text to what the last successful scan read, since
     * only a scan that lands can clear the error the failure raised.
     */
    private scanFailed = false;
    /** The first-portion reading last reported to the runtime. */
    private reportedFirstPortionRead = true;
    /** The custom validity message this field set, so it clears only its own. */
    private scanValidity: string | null = null;
    /**
     * The visible statement of an incomplete scan, beside the field. The status
     * mark's color is not the only signal: this says it in words, and the
     * textarea is described by it while it shows.
     */
    private scanNotice!: HTMLDivElement;
    /** Speaks the incomplete-scan error when it appears. */
    private scanAnnouncer!: HTMLDivElement;

    private syncTimer: ReturnType<typeof setTimeout> | null = null;
    private static readonly SYNC_DEBOUNCE_MS = 300;
    private lastScannedText = '';
    private lastMarkingStrings: string[] = [];
    /** Set once the field is torn down; a late whole change reads nothing. */
    private tornDown = false;
    /**
     * True when the next scan follows a user edit. Initial and externally
     * supplied values are parsed and validated without rewriting them; safe
     * engine repairs become eligible only after the user edits a marking.
     */
    private userEditPending = false;
    /**
     * The textarea value the current `this.segments` positions were computed
     * from. `this.segments` is refreshed by a DEBOUNCED scan, so while the user
     * types it lags the live value by up to `SYNC_DEBOUNCE_MS`. Comparing this
     * against the live value tells the caret-driven auto-open whether the
     * segment offsets can be trusted (see `onSelectionChange`). The single-line
     * marked-input has no such lag because its mark position updates
     * synchronously on every input, which is why it never mis-opens the
     * picker.
     */
    private lastSegmentedText = '';

    async init(
        container: HTMLDivElement,
        engineOrContext?: ComponentEngineSource | null,
        options?: MarkedTextAreaOptions,
    ): Promise<void> {
        this.options = options ?? {};
        this.bindEngine(container, engineOrContext, options?.scanFormat);
        this.hiddenFormat = options?.hiddenFormat ?? this.scanFormat;
        this.partOfId = options?.partOfId;

        this.injectStyle();

        this.host = this.resolveHost();
        const textarea = this.textarea;

        // Capture textarea styles BEFORE making it invisible
        const capturedStyles = this.captureAndMirrorStylesPreHide();
        const hadFocus = document.activeElement === textarea;
        textarea.focus({ preventScroll: true });
        const focusBorderColor = window.getComputedStyle(textarea).borderColor;
        if (!hadFocus) textarea.blur();

        this.wrap = document.createElement('div');
        this.wrap.className = this.classNames.wrap;
        textarea.parentNode?.insertBefore(this.wrap, textarea);
        this.wrap.appendChild(textarea);

        textarea.classList.add('marked-textarea-input');
        textarea.setAttribute('spellcheck', 'false');
        textarea.setAttribute('autocomplete', 'off');
        textarea.setAttribute('autocorrect', 'off');
        textarea.setAttribute('autocapitalize', 'off');

        // Display div: the sole visible layer
        this.display = document.createElement('div');
        this.display.className = this.classNames.display;
        this.display.setAttribute('aria-hidden', 'true');

        // Apply initial styles from the pre-hide snapshot
        const layoutProps = [
            'padding',
            'borderWidth',
            'borderStyle',
            'borderColor',
            'borderRadius',
            'font',
            'fontFamily',
            'fontSize',
            'fontStyle',
            'fontVariant',
            'fontWeight',
            'fontStretch',
            'lineHeight',
            'letterSpacing',
            'wordSpacing',
            'tabSize',
            'textIndent',
            'textAlign',
            'textTransform',
            'direction',
            'color',
            'backgroundColor',
        ] as const;
        for (const p of layoutProps) {
            (this.display.style as unknown as Record<string, string>)[p] =
                capturedStyles[p];
        }
        if (textarea.style.height)
            this.display.style.height = textarea.style.height;
        if (textarea.style.minHeight)
            this.display.style.minHeight = textarea.style.minHeight;

        // Re-sync color/background when the host changes theme so the display
        // div matches the themed appearance in both light and dark modes.
        this.installThemeObserver(capturedStyles, 'marked-textarea-input');

        this.wrap.insertBefore(this.display, textarea);

        // Resize handle
        const resizeHandle = document.createElement('div');
        resizeHandle.className = 'marked-textarea-resize-handle';
        this.initResize(resizeHandle);
        this.wrap.appendChild(resizeHandle);

        this.popup = document.createElement('div');
        this.popup.className = 'marked-textarea-popup';
        this.popup.setAttribute('role', 'listbox');
        this.popup.setAttribute('aria-label', 'Marking suggestions');
        this.popup.hidden = true;
        this.wrap.appendChild(this.popup);

        this.hiddenRoot = document.createElement('div');
        this.hiddenRoot.className = 'marked-textarea-hidden-fields';
        container.appendChild(this.hiddenRoot);

        // Keyboard hint + touch "Add marking" + trailing chrome footer.
        this.appendFooter();

        this.scanNotice = document.createElement('div');
        this.scanNotice.className = 'marked-textarea-scan-notice';
        this.scanNotice.id = `ez-scan-notice-${++scanNoticeCount}`;
        this.scanNotice.hidden = true;
        const noticeIcon = document.createElement('span');
        noticeIcon.className = 'marked-textarea-scan-notice__icon';
        noticeIcon.setAttribute('aria-hidden', 'true');
        noticeIcon.textContent = '\u26a0';
        const noticeText = document.createElement('span');
        noticeText.className = 'marked-textarea-scan-notice__text';
        this.scanNotice.append(noticeIcon, noticeText);
        // In the field's own container, which directly follows the wrapper:
        // the runtime finds a textarea from its container by that adjacency.
        this.scanAnnouncer = createAnnouncer();
        container.prepend(this.scanNotice, this.scanAnnouncer);

        // The field's single status mark (starless "enhanced" until the
        // engine applies a fix), in the footer's trailing chrome slot.
        ensureStatusMark(this.hintChrome, {
            shape: 'chrome',
            root: this.container,
            shouldShowTooltip: () => this.shouldShowTooltip(),
        });
        // The ★ mounts on host favorites wiring OR scheme-declared presets
        // (ensureFavoritesButton owns the OR); an undefined `config` runs the
        // panel read-only, "From the scheme" only: caret-scoped stamping
        // (onKeydown's Ctrl+Shift+Enter path below) still works against those
        // presets with no provider wired.
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
                getCurrent: () => this.currentFavoritesMarking(),
                onApply: (marking) => void this.applyFavorite(marking),
                focusField: () => this.textarea.focus(),
            });
            this.favoritesPanel?.syncStar();
        }

        this.boundInput = () => this.onTextareaInput();
        this.boundKeydown = (e) => this.onKeydown(e);
        this.boundDocKeydown = (e) => this.onDocKeydown(e);
        this.boundDocClick = (e) => this.onDocClick(e);
        this.boundSelectionChange = () => this.onSelectionChange();
        this.textarea.addEventListener('input', this.boundInput);
        this.textarea.addEventListener('keydown', this.boundKeydown);
        this.textarea.addEventListener('focus', () => {
            this.hasFocus = true;
            this.display.style.borderColor = focusBorderColor;
            this.renderDisplay();
        });
        this.textarea.addEventListener('blur', () => {
            this.hasFocus = false;
            this.display.style.borderColor = capturedStyles.borderColor;
            if (!this.picker) this.renderDisplay();
            // Trigger sync on blur so deferred repairs (skipped while cursor was
            // inside a marking) get applied now that the user has moved away.
            // Skip sync when the picker is open: it manages content independently.
            // Sync runs after the picker closes via onPickerChange → syncFromTextarea.
            if (!this.picker) void this.syncFromTextarea();
        });
        // Click on textarea: check if the click overlaps a chip in the display
        // div and open the inline editor for that marking
        this.textarea.addEventListener('mouseup', () => {
            if (!this.hasFocus || this.picker) return;
            // After mouseup, selectionStart is set. Check if it's inside a segment.
            requestAnimationFrame(() => {
                if (this.picker) return;
                const cursorPos = this.textarea.selectionStart;
                const hasSelection =
                    this.textarea.selectionStart !== this.textarea.selectionEnd;
                if (hasSelection) return;
                const segIdx = this.segments.findIndex(
                    (s) => cursorPos > s.start && cursorPos < s.end,
                );
                if (segIdx >= 0 && segIdx !== this.activeSegmentIndex) {
                    this.activeSegmentIndex = segIdx;
                    const seg = this.segments[segIdx];
                    void this.openPicker(seg.start, seg.end);
                }
            });
        });
        this.textarea.addEventListener('scroll', () => {
            this.display.scrollTop = this.textarea.scrollTop;
            this.display.scrollLeft = this.textarea.scrollLeft;
        });
        document.addEventListener('keydown', this.boundDocKeydown, true);
        document.addEventListener('mousedown', this.boundDocClick);
        document.addEventListener('selectionchange', this.boundSelectionChange);
        if (typeof ResizeObserver !== 'undefined') {
            this._resizeObserver = new ResizeObserver(() => {
                // Skip re-render if the picker is open: renderDisplay() calls
                // display.innerHTML = '' which detaches the pickerMount and blurs the
                // inline editor input. The display is already correctly rendered with
                // the picker mounted; skipping here has no visual cost.
                if (!this.picker) this.renderDisplay();
            });
            this._resizeObserver.observe(this.display);
        }
        document.fonts?.ready.then(() => this.renderDisplay());

        await this.syncFromTextarea();
    }

    /** Resolve the host textarea from this container (or its parent). */
    protected resolveHost(): HTMLTextAreaElement {
        const host = getMountHost(this.container);
        const textarea =
            (host?.tagName === 'TEXTAREA'
                ? (host as HTMLTextAreaElement)
                : undefined) ??
            this.container.querySelector<HTMLTextAreaElement>('textarea') ??
            this.container.parentElement?.querySelector<HTMLTextAreaElement>(
                'textarea',
            );
        if (!textarea) {
            throw new Error(
                'MarkedTextArea requires a <textarea> element in the enhanced container or its parent.',
            );
        }
        return textarea;
    }

    /**
     * Snapshot the textarea's layout styles. The base helper mirrors them onto
     * the display, but the textarea also copies height/minHeight separately in
     * init, so it only needs the captured map here (no display yet).
     */
    private captureAndMirrorStylesPreHide(): Record<string, string> {
        const csBeforeHide = window.getComputedStyle(this.host);
        const capturedStyles: Record<string, string> = {};
        const layoutProps = [
            'padding',
            'borderWidth',
            'borderStyle',
            'borderColor',
            'borderRadius',
            'font',
            'fontFamily',
            'fontSize',
            'fontStyle',
            'fontVariant',
            'fontWeight',
            'fontStretch',
            'lineHeight',
            'letterSpacing',
            'wordSpacing',
            'tabSize',
            'textIndent',
            'textAlign',
            'textTransform',
            'direction',
            'color',
            'backgroundColor',
        ] as const;
        for (const p of layoutProps) {
            capturedStyles[p] = (
                csBeforeHide as unknown as Record<string, string>
            )[p];
        }
        return capturedStyles;
    }

    /**
     * Touch "Add marking" → drive the existing keydown path (focus + caret to
     * end
     *
     * - Synthetic Ctrl+Enter) so the behavior stays identical to the keyboard
     *   shortcut by construction.
     */
    protected triggerAddMarking(): void {
        if (this.picker) return;
        this.textarea.focus();
        const end = this.textarea.value.length;
        this.textarea.setSelectionRange(end, end);
        this.textarea.dispatchEvent(
            new KeyboardEvent('keydown', {
                key: 'Enter',
                ctrlKey: true,
                bubbles: true,
                cancelable: true,
            }),
        );
    }

    /**
     * Hidden children carry the assertions; parent returns none to avoid
     * double-counting in rollup.
     */
    getAssertions(): Assertion[] {
        return [];
    }

    setAssertions(_assertions: Assertion[]): void {
        // A scalar union cannot identify a paragraph. Entry-aware hosts use
        // applyEntryStates with stable IDs instead of guessing a target.
    }

    setValue(value: string): void {
        this.userEditPending = false;
        this.textarea.value = value;
        void this.syncFromTextarea();
    }

    getRendered(): string {
        return '';
    }

    /**
     * The whole these markings belong to changed: read every marking again
     * against it, so what each shows about the whole follows it (see
     * `ComponentInstance.refreshWhole`). An open editor refreshes its draft and
     * available options immediately.
     */
    refreshWhole(): void {
        if (this.tornDown || !this.options.resolveContext) return;
        if (this.picker) {
            this.picker.refreshContext();
            return;
        }
        this.lastMarkingStrings = [];
        this.lastScannedText = '';
        void this.syncFromTextarea();
    }

    /** Ordered marking identities; empty entries retain their source anchors. */
    getEntryIds(): readonly string[] {
        return [
            ...this.committedPortions().filter((segment) => segment.entryId),
            ...this.emptyEntries,
        ]
            .sort(
                (a, b) =>
                    a.start - b.start ||
                    this.entryOrder.indexOf(a.entryId!) -
                        this.entryOrder.indexOf(b.entryId!),
            )
            .map((entry) => entry.entryId!);
    }

    /**
     * Reflect committed entry markings without treating the parent union as a
     * paragraph edit. Prose belongs to its source span, never to rendered
     * state. False means a live user draft or changed source made this read
     * stale.
     */
    async applyEntryStates(
        entries: readonly { entryId: string; state: EzClassifyState }[],
        current: () => boolean = () => true,
    ): Promise<boolean> {
        if (
            this.tornDown ||
            this.picker ||
            this.textarea.value !== this.lastSegmentedText ||
            // A held portion has no mark in the text to write a state into,
            // and the text past the cut is unread; a complete scan settles
            // the body before store states are reflected into it again.
            this.heldPortions.length > 0
        )
            return false;
        const text = this.textarea.value;
        if (
            JSON.stringify(this.getEntryIds()) ===
                JSON.stringify(entries.map((entry) => entry.entryId)) &&
            entries.every(({ entryId, state }) => {
                const segment = this.segments.find(
                    (one) => one.entryId === entryId,
                );
                return (
                    segment &&
                    JSON.stringify(segment.assertions) ===
                        JSON.stringify(state.assertions) &&
                    segment.valid === state.valid &&
                    JSON.stringify(segment.validationErrors) ===
                        JSON.stringify(state.errors)
                );
            })
        )
            return true;
        const seq = ++this.entryWriteSeq;
        const own = [
            ...this.segments.filter(
                (segment): segment is MarkedSegment & { entryId: string } =>
                    !!segment.entryId,
            ),
            ...this.emptyEntries,
        ].sort((a, b) => a.start - b.start);
        const existing = new Map(
            this.segments
                .filter((segment) => segment.entryId)
                .map((segment) => [segment.entryId!, segment]),
        );
        if (
            this.segments.some(
                (segment) =>
                    segment.entryId &&
                    segment.preserveSource &&
                    !entries.some((entry) => entry.entryId === segment.entryId),
            )
        ) {
            this.textarea.setAttribute(
                'data-ezclassify-entry-conflict',
                'unresolved-source',
            );
            return false;
        }
        const facts = (assertions: readonly Assertion[]) =>
            JSON.stringify(assertions.map(assertionFactKey).sort());
        if (
            entries.some(({ entryId, state }) => {
                const previous = existing.get(entryId);
                return (
                    previous?.preserveSource &&
                    (!previous.readFailure || previous.sourceUnresolved) &&
                    facts(previous.assertions) !== facts(state.assertions)
                );
            })
        ) {
            this.textarea.setAttribute(
                'data-ezclassify-entry-conflict',
                'unresolved-source',
            );
            return false;
        }
        if (
            this.textarea.getAttribute('data-ezclassify-entry-conflict') ===
            'unresolved-source'
        )
            this.textarea.removeAttribute('data-ezclassify-entry-conflict');
        const successfulReads = new Map<string, ProcessResult>();
        const rendered = await Promise.all(
            entries.map(async ({ entryId, state }) => {
                const previous = existing.get(entryId);
                if (
                    previous &&
                    facts(previous.assertions) === facts(state.assertions)
                )
                    return { entryId, marking: previous.marking };
                if (previous?.readFailure) {
                    // An ordinary entry commit cannot prove a contextual read
                    // succeeded. A replacement must actually read in this
                    // textarea's current whole context before its token changes.
                    const options = {
                        outputFormat: this.hiddenFormat,
                        context: this.options.resolveContext?.(),
                    };
                    const read = await Promise.resolve(
                        this.schemeAddressing &&
                            isAddressableSchemeEngine(this.engine)
                            ? this.engine.process(
                                  state.assertions,
                                  this.schemeId,
                                  options,
                              )
                            : this.engine.process(state.assertions, options),
                    );
                    successfulReads.set(entryId, read);
                }
                if (
                    state.stale ||
                    (!state.valid &&
                        (state.assertions.length || state.rendered))
                )
                    return { entryId, marking: previous?.marking ?? '' };
                if (!state.assertions.length) return { entryId, marking: '' };
                const result = await Promise.resolve(
                    this.schemeAddressing &&
                        isAddressableSchemeEngine(this.engine)
                        ? this.engine.render(
                              state.assertions,
                              this.hiddenFormat,
                              this.schemeId,
                          )
                        : this.engine.render(
                              state.assertions,
                              this.hiddenFormat,
                          ),
                );
                return {
                    entryId,
                    marking: this.wrapRendered(result.rendered).trimEnd(),
                };
            }),
        );
        if (
            this.tornDown ||
            !current() ||
            seq !== this.entryWriteSeq ||
            text !== this.textarea.value ||
            this.picker
        )
            return false;
        const projected = projectEntrySpans(text, own, rendered);
        const states = new Map(
            entries.map((entry) => [entry.entryId, entry.state]),
        );
        const preserved = this.segments
            .filter((segment) => !segment.entryId)
            .flatMap((segment) => {
                const mapping = projected.bodyMappings.find(
                    (range) =>
                        segment.start >= range.start &&
                        segment.end <= range.end,
                );
                if (!mapping) return [];
                const delta = mapping.projectedStart - mapping.start;
                return [
                    {
                        ...segment,
                        start: segment.start + delta,
                        end: segment.end + delta,
                    },
                ];
            });
        this.entryOrder = entries.map((entry) => entry.entryId);
        this.emptyEntries = projected.spans.filter(
            (span) => span.start === span.end,
        );
        this.segments = [
            ...preserved,
            ...projected.spans
                .filter((span) => span.start !== span.end)
                .map((span): MarkedSegment => {
                    const state = states.get(span.entryId)!;
                    const previous = existing.get(span.entryId);
                    const read = successfulReads.get(span.entryId);
                    const readFailure = read
                        ? undefined
                        : previous?.readFailure;
                    const errors = (read?.errors ?? state.errors).map(
                        (error) => error.message,
                    );
                    if (readFailure) errors.push(readFailure);
                    return {
                        ...span,
                        marking: projected.text.slice(span.start, span.end),
                        assertions: state.assertions.map((a) => ({ ...a })),
                        rendered: state.rendered,
                        text: previous?.text ?? '',
                        valid:
                            (read?.valid ?? state.valid) &&
                            !state.stale &&
                            !readFailure,
                        errors,
                        validationErrors: read?.errors ?? state.errors,
                        readFailure,
                        sourceUnresolved: previous?.sourceUnresolved,
                        warnings: previous?.warnings,
                        repaired: false,
                        preserveSource: read
                            ? !read.valid || previous?.sourceUnresolved
                            : previous?.preserveSource,
                    };
                }),
        ].sort((a, b) => a.start - b.start);
        ++this.scanSeq;
        this.lastScannedText = projected.text;
        this.lastSegmentedText = projected.text;
        this.lastMarkingStrings = this.segments
            .filter((segment) => segment.entryId)
            .map((segment) => segment.marking);
        this.applyingEntryState = true;
        try {
            this.setHostValue(projected.text);
            this.renderDisplay();
            this.updateStatusMark();
            this.syncHiddenFields();
            this.emitTextChange();
        } finally {
            this.applyingEntryState = false;
        }
        return true;
    }

    /**
     * Every portion the field has committed, including any held past an
     * incomplete scan's cut that has no mark in the text. The runtime publishes
     * these, so a portion nobody has read again keeps its place in the store.
     *
     * @internal
     */
    getCommittedPortions(): MarkedSegment[] {
        return this.committedPortions().map((s) => ({
            ...s,
            assertions: [...s.assertions],
        }));
    }

    /** Return the current per-marking segments including body text. */
    getSegments(): MarkedSegment[] {
        return this.segments.map((s) => ({
            ...s,
            assertions: [...s.assertions],
        }));
    }

    destroy(): void {
        this.destroyAfterDraft(() => this.teardown());
    }

    protected async commitOpenEditor(): Promise<void> {
        if (!this.picker) return;
        this._explicitClose = true;
        await this.closePicker();
        if (!this.picker) await this.syncFromTextarea();
    }

    private teardown(): void {
        this.tornDown = true;
        if (this.syncTimer) clearTimeout(this.syncTimer);
        this._resizeObserver?.disconnect();
        this._resizeObserver = null;
        this.disconnectThemeObserver();
        cleanupTooltipForRoot(this.container);
        this.destroyPicker();
        this.favoritesPanel?.destroy();
        this.favoritesPanel = null;
        this.textarea.removeEventListener('input', this.boundInput);
        this.textarea.removeEventListener('keydown', this.boundKeydown);
        document.removeEventListener('keydown', this.boundDocKeydown, true);
        document.removeEventListener('mousedown', this.boundDocClick);
        document.removeEventListener(
            'selectionchange',
            this.boundSelectionChange,
        );
        for (const f of this.hiddenFields) f?.destroy();
        this.hiddenFields = [];
        this.hiddenContainers = [];
        // A host the page removed itself stays removed (see MarkingField).
        if (this.wrap.parentNode && this.textarea.parentNode === this.wrap)
            this.wrap.parentNode.insertBefore(this.textarea, this.wrap);
        this.wrap.remove();
        this.container.innerHTML = '';
        // Last, so nothing above is skipped if the store refuses the call. The
        // restored textarea is no longer checked by this field: it keeps none
        // of this field's verdicts, and the rollups stop counting a field
        // that is gone.
        this.scanComplete = true;
        this.firstPortionRead = true;
        this.reportScanCompleteness();
    }

    private onTextareaInput(): void {
        // Ignore the component's own setHostValue dispatch; the originating
        // code path already handles rendering and syncing.
        if (this._selfDispatch) return;
        // User typing directly in the textarea bypasses the inline editor.
        // Clear any saved editor assertions so the sync re-parses from text
        // instead of applying stale assertions from a previously-edited part.
        this._editorAssertions = null;
        this.userEditPending = true;
        this.renderDisplay();
        this.emitTextChange();
        this.scheduleSync();
    }

    private scheduleSync(): void {
        if (this.syncTimer) clearTimeout(this.syncTimer);
        if (this.textarea.value === this.lastScannedText && !this.scanFailed)
            return;
        this.syncTimer = setTimeout(() => {
            this.syncTimer = null;
            void this.syncFromTextarea();
        }, MarkedTextArea.SYNC_DEBOUNCE_MS);
    }

    private async syncFromTextarea(): Promise<void> {
        // While the inline picker is open, the empty "()" template won't be
        // recognized by the engine scan, so the scan would clear the segment list
        // and call renderDisplay(), which tears down and re-mounts the pickerMount
        // causing the editor input to lose focus. Skip the scan entirely; the
        // picker owns its own state; the final sync runs when the picker closes.
        if (this.tornDown || this.picker) return;
        const text = this.textarea.value;
        if (text === this.lastScannedText && !this.scanFailed) return;
        const userInitiated = this.userEditPending;
        this.userEditPending = false;
        const previousScannedText = this.lastScannedText;
        const previousSegments = this.segments;
        const previousHeld = this.heldPortions;
        const previousSegmentedText = this.lastSegmentedText;
        this.lastScannedText = text;
        const mySeq = ++this.scanSeq;
        // Empty text has no markings to read. Clear its published children even
        // when a remote adapter is unavailable, and invalidate the prior scan.
        if (!text) {
            this.segments = [];
            this.heldPortions = [];
            this.emptyEntries = [];
            this.lastMarkingStrings = [];
            this.lastSegmentedText = '';
            this._editorAssertions = null;
            this._appliedFixes.clear();
            this._fixesHeld = [];
            this.activeRange = null;
            this.activeSegmentIndex = -1;
            this.scanComplete = true;
            this.firstPortionRead = true;
            this.scanFailed = false;
            this.renderDisplay();
            this.updateStatusMark();
            this.syncHiddenFields();
            this.reportScanCompleteness();
            this.emitTextChange();
            return;
        }
        // A new edit may arrive before its debounced scan advances scanSeq.
        const isCurrent = () =>
            !this.tornDown &&
            mySeq === this.scanSeq &&
            this.textarea.value === text;
        let scanOutcome;
        try {
            scanOutcome = await Promise.resolve(
                this.schemeAddressing && isAddressableSchemeEngine(this.engine)
                    ? this.engine.scan(text, this.schemeId, {
                          outputFormat: this.scanFormat,
                      })
                    : this.engine.scan(text, {
                          outputFormat: this.scanFormat,
                      }),
            );
        } catch (error) {
            // The scan never landed, so the display still shows the previous
            // text's marks. Put the bookkeeping back where it was, guarded so a
            // late failure cannot undo a newer scan, and this text is scanned
            // again on the next edit instead of being treated as done.
            if (isCurrent() && this.lastScannedText === text) {
                this.lastScannedText = previousScannedText;
                this.scanFailed = true;
                // Fail closed: a scan that never answered read none of this
                // text. The portions committed before stay, and the field says
                // the text is unchecked until a scan reads all of it.
                this.scanComplete = false;
                this.firstPortionRead = false;
                this.updateStatusMark();
                this.reportScanCompleteness();
            }
            console.error('[MarkedTextArea] scan failed:', error);
            return;
        }
        if (!isCurrent()) return;
        this.scanFailed = false;
        // Fail closed: an outcome that does not say it read to the end is
        // treated as one that did not. Held until this pass renders, so a scan
        // that is superseded or repaired never shows its verdict.
        const complete = scanOutcome.limits?.status === 'complete';
        // How far the scan read. A scan reports no offset for where it
        // stopped, so the end of the last marking it returned stands in: it
        // read at least that far, and everything after it is treated as unread.
        const readTo = complete
            ? text.length
            : scanOutcome.results.reduce(
                  (furthest, result) => Math.max(furthest, result.end),
                  0,
              );

        // Filter to wrapped (embedded) markings only, then drop any that are not a
        // line-leading part mark. The engine scans the whole field with the
        // scheme's parenthesis wrapper pattern, so prose citations/abbreviations
        // (e.g. "see section (a) below") match alongside the field's real leading
        // "(U)". A marked field carries one leading mark per line; mid-line wrapped
        // tokens are prose, not markings.
        const embedded = keepLeadingPartMarks(
            scanOutcome.results.filter((r) => r.wrapped),
            text,
        );

        // Re-process only markings that changed since the last scan to get
        // repair results (autofixes, validation with context). Unchanged
        // markings reuse the scan result directly; no extra engine calls.
        // Read against a settled whole: when this edit also changed the whole,
        // reading now would compare the marks with whichever whole answered
        // first.
        await wholeSettled(this.textarea);
        if (!isCurrent()) return;
        const ctx = this.options.resolveContext?.();
        const prevMarkings = this.lastMarkingStrings;
        const changedIndices: number[] = [];
        for (let i = 0; i < embedded.length; i++) {
            if (
                i >= prevMarkings.length ||
                embedded[i].marking !== prevMarkings[i]
            ) {
                changedIndices.push(i);
            }
        }
        this.lastMarkingStrings = embedded.map((r) => r.marking);

        // Process changed markings in parallel.
        // If the inline editor just closed, use its saved assertions instead of
        // re-parsing the rendered text; the text parser may not round-trip
        // correctly for all marking formats (e.g. joint markings).
        const savedAssertions = this._editorAssertions;
        this._editorAssertions = null;

        const readMarking = (marking: string) => {
            // Use saved assertions if they match this marking
            const stated =
                savedAssertions &&
                savedAssertions.marking === marking &&
                savedAssertions.assertions.length > 0
                    ? savedAssertions.assertions
                    : null;
            const input = stated ? '' : this.extractInner(marking);
            const options = {
                outputFormat: this.scanFormat,
                // The engine takes a whole's values again from `ctx`.
                ...(stated
                    ? { assertions: withoutTakenFromWhole(stated) }
                    : {}),
                context: ctx,
            };
            return Promise.resolve(
                this.schemeAddressing && isAddressableSchemeEngine(this.engine)
                    ? this.engine.process(input, this.schemeId, options)
                    : this.engine.process(input, options),
            );
        };

        const processedResults = new Map<
            number,
            Awaited<ReturnType<typeof this.engine.process>>
        >();
        // Markings the engine raised on instead of reading, with the reason.
        // One such marking keeps what the scan found and shows why; it never
        // stops the rest of the field from reading, or the field from mounting.
        const readFailures = new Map<number, string>();
        if (changedIndices.length > 0) {
            const results = await Promise.all(
                changedIndices.map(async (idx) => {
                    try {
                        const result = await readMarking(embedded[idx].marking);
                        return { idx, result };
                    } catch (error) {
                        readFailures.set(
                            idx,
                            error instanceof Error
                                ? error.message
                                : String(error),
                        );
                        return null;
                    }
                }),
            );
            if (!isCurrent()) return;
            for (const read of results) {
                if (read) processedResults.set(read.idx, read.result);
            }
        }

        this.recordMarksHeld(
            embedded.map(
                (r, i) => (processedResults.get(i) ?? r.result).assertions,
            ),
        );
        // An emptied field returns to the starless "enhanced" state.
        if (!text.trim()) this._appliedFixes.clear();

        let previousSegmentIndex = 0;
        const previousReadFailures = prevMarkings.map((marking) => {
            // Recognized spans can lack an entry ID after a failed empty read.
            // Walk in source order, skipping only additional unrecognized spans.
            while (previousSegmentIndex < previousSegments.length) {
                const previous = previousSegments[previousSegmentIndex++];
                if (previous.marking === marking) return previous.readFailure;
            }
            return undefined;
        });
        this.segments = embedded.map((r, i) => {
            const nextStart = embedded[i + 1]?.start ?? text.length;
            const bodyText = text
                .slice(r.end, nextStart)
                .replace(/^\s+|\s+$/g, '');
            const processed = processedResults.get(i);
            const res = processed ?? r.result;
            // Only corrections that would change the field flag it; once one
            // does, every applied fix travels with the repair it records.
            const corrections = userInitiated
                ? []
                : fixesNeedingCorrection(
                      res.appliedFixes,
                      this.omittedFromFieldFormat(res),
                  );
            const unappliedFixes = corrections.length > 0;
            if (userInitiated)
                recordAppliedFixes(this._appliedFixes, res.appliedFixes);
            const errors = res.errors.map((e) => e.message);
            if (unappliedFixes) {
                errors.push(
                    ...corrections.map(
                        (fix) =>
                            `Loaded marking needs correction: ${fix.message}`,
                    ),
                );
            }
            const failure =
                readFailures.get(i) ??
                (!changedIndices.includes(i)
                    ? previousReadFailures[i]
                    : undefined);
            if (failure !== undefined) errors.push(failure);
            const warnings = [
                ...new Set((res.warnings ?? []).map((w) => w.message)),
            ];
            const sourceUnresolved =
                !res.valid ||
                res.recognition?.status !== 'complete' ||
                unappliedFixes;
            return {
                start: r.start,
                end: r.end,
                marking: r.marking,
                assertions: res.assertions,
                rendered: res.rendered,
                text: bodyText,
                valid: errors.length === 0,
                errors,
                warnings,
                validationErrors: res.errors,
                repaired: userInitiated && res.appliedFixes.length > 0,
                pendingFixes: unappliedFixes ? res.appliedFixes : [],
                readFailure: failure,
                sourceUnresolved,
                preserveSource: failure !== undefined || sourceUnresolved,
            };
        });

        // Flag line-leading wrapper matches the engine scan did NOT return.
        // scan() silently drops wrapped text it cannot parse at all (e.g.
        // "(junkxyz)"), which left junk that READS like a marking rendered as
        // ordinary unmarked prose: no chip, invisible to validation and
        // rollup. For a marking product that is the worst kind of silent
        // state, so surface those spans as invalid assertion-free segments:
        // the display gives them the invalid-chip treatment and the picker
        // can open on them for correction.
        // Past where an incomplete scan stopped, nothing was read, so nothing
        // there is unrecognized; the field-level error covers it.
        const unrecognized = this.findUnrecognizedLeadingMarks(text, readTo);
        if (unrecognized.length > 0) {
            this.segments = [...this.segments, ...unrecognized].sort(
                (a, b) => a.start - b.start,
            );
        }
        // Past where an incomplete scan stopped, the portions committed before
        // are kept rather than retired: dropping them would lower the rollups
        // on the strength of text nobody read. Each keeps its entry, its facts
        // and its place in the rollups until a complete scan replaces it.
        const { kept, held } = complete
            ? { kept: [], held: [] }
            : this.portionsPastCut(
                  previousSegmentedText,
                  previousSegments,
                  previousHeld,
                  text,
                  readTo,
              );
        this.heldPortions = held;
        if (kept.length > 0) {
            this.segments = [...this.segments, ...kept].sort(
                (a, b) => a.start - b.start,
            );
            this.segments.forEach((segment, index) => {
                const next = this.segments[index + 1]?.start ?? text.length;
                segment.text = text
                    .slice(segment.end, next)
                    .replace(/^\s+|\s+$/g, '');
            });
        }

        const owned = this.segments.filter(
            (segment) => segment.valid || segment.assertions.length > 0,
        );
        const ids = reconcileEntryIds(
            previousSegmentedText,
            previousSegments,
            text,
            owned,
            () =>
                `${this.textarea.id || this.partOfId || this.targetIdPrefix}-entry-${++this.hiddenGeneration}`,
        );
        owned.forEach((segment, index) => {
            segment.entryId = ids[index];
            const previous = previousSegments.find(
                (old) =>
                    old.entryId === segment.entryId &&
                    old.marking === segment.marking,
            );
            if (
                previous &&
                !changedIndices.some(
                    (changed) => embedded[changed]?.start === segment.start,
                )
            ) {
                // A body-only edit must not turn structured store state into a
                // fresh text projection that drops captured or suppressed facts.
                segment.assertions = previous.assertions;
            }
        });
        // Empty tokens still own their body. Keep their anchors through edits
        // outside the anchor; retire one replaced by an explicitly typed mark.
        this.emptyEntries = rebaseEntrySpans(
            previousSegmentedText,
            this.emptyEntries,
            text,
        ).filter(
            (span): span is MarkingEntrySpan & { entryId: string } =>
                !!span.entryId &&
                !owned.some((segment) => segment.start === span.start),
        );

        // Segment offsets now map onto `text`. Record it so a caret-driven
        // auto-open can tell whether they still match the live value.
        this.lastSegmentedText = text;

        // Apply autofixes: patch textarea if the repaired rendered differs from what was typed.
        // If repairs were applied, a follow-up scan runs and will call renderDisplay; skip
        // rendering here to avoid displaying stale segment positions against the patched text.
        const repaired = userInitiated && (await this.applyRepairs());
        if (repaired) return;

        // If no markings changed and the count is the same as before, only the
        // body text between markings changed. Re-render the display and emit a
        // text-change event, but skip syncHiddenFields, nothing in the hidden
        // fields / rollup / parent-child validation can have changed, and firing
        // that chain would trigger dozens of redundant engine calls.
        // Portions kept past an incomplete scan's cut, or dropped when a
        // complete scan replaces them, change the set even when every scanned
        // marking reads the same.
        const markingsUnchanged =
            changedIndices.length === 0 &&
            embedded.length === prevMarkings.length &&
            this.committedPortions()
                .filter((segment) => segment.entryId)
                .map((segment) => segment.entryId)
                .join('\n') ===
                this.hiddenContainers.map((box) => box.id).join('\n');
        this.scanComplete = complete;
        this.firstPortionRead = complete || embedded.length > 0;
        this.renderDisplay();
        this.updateStatusMark();
        if (!markingsUnchanged) {
            this.syncHiddenFields();
        }
        // After the portions' publishes start, so the rollups it recomputes
        // wait for them rather than run over the previous portions.
        this.reportScanCompleteness();
        this.emitTextChange();
    }

    /**
     * What a segment's mark says about itself: its broken rules, or its
     * warnings when it is valid. Null for a valid mark with nothing to say.
     */
    private attentionOf(seg: MarkedSegment): MarkAttention | null {
        if (!seg.valid && seg.errors.length > 0)
            return markAttention('invalid', seg.errors);
        if (seg.valid && (seg.warnings?.length ?? 0) > 0)
            return markAttention('warning', seg.warnings!);
        return null;
    }

    /**
     * The field's markings now hold `marks`. When one of them was replaced (a
     * marking typed or pasted over, a later editing session, a favorite over an
     * open marking) rather than only added to, the fix record describes a
     * marking the field no longer holds: it starts over, the same rule a
     * composer commit follows (see `replacesMarks`), and the fixes of the
     * current reads refill it. Adding, moving or extending a marking keeps it.
     *
     * The record is one per field, so replacing one marking also drops what was
     * said about the others; the next read records their repairs again.
     *
     * @param marks - What each marking in the field holds now
     */
    private recordMarksHeld(marks: readonly (readonly Assertion[])[]): void {
        if (replacesMarks(this._fixesHeld, marks)) this._appliedFixes.clear();
        this._fixesHeld = marks;
    }

    /**
     * What the field's markings hold once the marking that starts at `start`
     * holds `holds` instead (or in addition, for a marking not yet scanned).
     */
    private marksWith(
        start: number,
        holds: readonly Assertion[],
    ): (readonly Assertion[])[] {
        return [
            ...this.segments
                .filter((segment) => segment.start !== start)
                .map((segment) => segment.assertions),
            holds,
        ];
    }

    /**
     * Reflect the applied-fix record, and whether the last scan read the whole
     * text, on the field's single status mark.
     */
    private updateStatusMark(): void {
        setStatusMarkFixes(this.hintChrome, [...this._appliedFixes.values()]);
        setStatusMarkError(
            this.hintChrome,
            this.scanComplete ? null : t('mark.scanIncomplete'),
        );
    }

    /**
     * Carry a change in scan completeness to the textarea's native validity and
     * to the runtime, which flags the field's rollups. An incomplete scan makes
     * the textarea invalid until a complete one clears it; a message the host
     * set itself is left alone.
     */
    private reportScanCompleteness(): void {
        if (
            this.scanComplete === this.reportedScanComplete &&
            this.firstPortionRead === this.reportedFirstPortionRead
        )
            return;
        const completenessChanged =
            this.scanComplete !== this.reportedScanComplete;
        this.reportedScanComplete = this.scanComplete;
        this.reportedFirstPortionRead = this.firstPortionRead;
        if (completenessChanged) this.showScanNotice(!this.scanComplete);
        this.options.onScanCompleteness?.(
            this.scanComplete,
            this.firstPortionRead,
        );
    }

    /**
     * Show or clear the incomplete-scan error on the textarea: its native
     * validity, `aria-invalid`, the visible notice that describes it, and one
     * polite announcement when the error appears.
     */
    private showScanNotice(show: boolean): void {
        const describedBy = (
            this.textarea.getAttribute('aria-describedby') ?? ''
        )
            .split(/\s+/)
            .filter((id) => id && id !== this.scanNotice.id);
        if (show) {
            this.scanValidity = t('mark.scanIncomplete');
            this.textarea.setCustomValidity(this.scanValidity);
            this.textarea.setAttribute('aria-invalid', 'true');
            this.scanNotice.lastElementChild!.textContent = this.scanValidity;
            this.scanNotice.hidden = false;
            describedBy.push(this.scanNotice.id);
            // Spoken a frame later so the live region registers the change; an
            // error that cleared in the meantime is not spoken at all.
            const message = this.scanValidity;
            this.scanAnnouncer.textContent = '';
            requestAnimationFrame(() => {
                if (this.scanValidity === message && !this.tornDown)
                    this.scanAnnouncer.textContent = message;
            });
        } else {
            if (
                this.scanValidity !== null &&
                this.textarea.validationMessage === this.scanValidity
            )
                this.textarea.setCustomValidity('');
            this.scanValidity = null;
            this.textarea.removeAttribute('aria-invalid');
            this.scanNotice.hidden = true;
            this.scanAnnouncer.textContent = '';
        }
        if (describedBy.length > 0)
            this.textarea.setAttribute(
                'aria-describedby',
                describedBy.join(' '),
            );
        else this.textarea.removeAttribute('aria-describedby');
    }

    /**
     * The portions committed before this scan that sit past where it stopped,
     * moved onto the current text. A portion whose mark the edit left in place
     * is kept where its mark now is. One whose mark the edit rewrote or removed
     * is held: nothing has read what replaced it, so it keeps what it committed
     * at an empty anchor where its mark was. Portions held by an earlier scan
     * stay held while they remain past the cut.
     *
     * @param before - The text the previous portions were read from
     * @param previous - Those portions
     * @param previousHeld - Portions an earlier incomplete scan held
     * @param after - The text just scanned
     * @param readTo - Where the scan stopped reading in `after`
     */
    private portionsPastCut(
        before: string,
        previous: readonly MarkedSegment[],
        previousHeld: readonly MarkedSegment[],
        after: string,
        readTo: number,
    ): { kept: MarkedSegment[]; held: MarkedSegment[] } {
        const edit = textEdit(before, after);
        const rebased = new Map(
            rebaseEntrySpans(before, previous, after).map((span) => [
                span.entryId!,
                span,
            ]),
        );
        const kept: MarkedSegment[] = [];
        const held: MarkedSegment[] = [];
        const hold = (portion: MarkedSegment) => {
            const anchor = rebaseOffset(edit, portion.start);
            if (anchor >= readTo)
                held.push({ ...portion, start: anchor, end: anchor });
        };
        for (const portion of previous) {
            if (!portion.entryId) continue;
            const span = rebased.get(portion.entryId);
            if (span && after.slice(span.start, span.end) === portion.marking) {
                if (span.start >= readTo)
                    kept.push({ ...portion, start: span.start, end: span.end });
            } else hold(portion);
        }
        previousHeld.forEach(hold);
        return { kept, held };
    }

    /**
     * Every portion the field has committed, in text order: the ones in the
     * text and the ones held past an incomplete scan's cut.
     */
    private committedPortions(): MarkedSegment[] {
        if (this.heldPortions.length === 0) return this.segments;
        return [...this.segments, ...this.heldPortions].sort(
            (a, b) => a.start - b.start,
        );
    }

    /**
     * Find line-leading spans that match the scheme's wrapper pattern but are
     * not covered by any scanned segment: wrapped text the engine could not
     * parse as a marking. Returned as invalid, assertion-free segments.
     *
     * @param text - The text that was scanned
     * @param readTo - Where the scan stopped reading; spans starting there or
     *   later were never offered to recognition
     */
    private findUnrecognizedLeadingMarks(
        text: string,
        readTo: number,
    ): MarkedSegment[] {
        const pattern = this.embeddedStyle?.pattern;
        if (!pattern || !text) return [];
        const out: MarkedSegment[] = [];
        const knownStarts = new Set(this.segments.map((seg) => seg.start));
        let lineStart = 0;
        for (;;) {
            const nl = text.indexOf('\n', lineStart);
            const lineEnd = nl === -1 ? text.length : nl;
            const mark = matchLeadingMark(
                text.slice(lineStart, lineEnd),
                pattern,
            );
            if (mark && lineStart < readTo && !knownStarts.has(lineStart)) {
                out.push({
                    start: lineStart,
                    end: lineStart + mark.length,
                    marking: mark,
                    assertions: [],
                    rendered: '',
                    text: '',
                    valid: false,
                    errors: [
                        'Unrecognized marking: not matched to any known concept',
                    ],
                    validationErrors: [],
                    repaired: false,
                });
            }
            if (nl === -1) break;
            lineStart = nl + 1;
        }
        return out;
    }

    /**
     * Extract the inner content from a wrapped marking using the profile's
     * embedded pattern.
     */
    private extractInner(marking: string): string {
        return extractInnerLogic(marking, this.embeddedPatterns);
    }

    /**
     * Concepts in a result that the field's own format leaves out of its
     * rendering, so no text in this field can ever carry them. Every read here
     * writes `rendered` in that format, so the result's own assessment says.
     */
    private omittedFromFieldFormat(result: {
        assessment: { omitted: Array<{ conceptId: string }> };
    }): Set<string> {
        return new Set(result.assessment.omitted.map((o) => o.conceptId));
    }

    /**
     * Patch the textarea when repair changed any marking's rendered form.
     * Returns true if patched.
     */
    private async applyRepairs(): Promise<boolean> {
        // Don't auto-repair markings while the author is actively navigating
        // inside the textarea. Once focus has left the field (including an
        // editor click-out commit), the stale textarea caret must not defer the
        // repair.
        const cursorPos = this.textarea.selectionStart;
        const safeSegments = this.segments.filter(
            (seg) =>
                !this.hasFocus ||
                !(cursorPos > seg.start && cursorPos < seg.end),
        );

        const template = this.template;
        const result = applyRepairsLogic(
            safeSegments,
            this.textarea.value,
            template,
            this.embeddedStyle?.pattern,
        );

        if (result.patched) {
            const caret = this.textarea.selectionStart + result.drift;
            // Auto-repair changes the field value: hosts observing ordinary
            // input events must see it (Host Form Contract).
            this.setHostValue(result.value);
            this.textarea.setSelectionRange(caret, caret);
            this.lastScannedText = '';
            await this.syncFromTextarea();
            return true;
        }
        return false;
    }

    /**
     * Key of the last painted display state. document-level selectionchange
     * fires far more often than the caret actually moves (focus churn, other
     * fields, render-triggered churn); repainting the whole display on each
     * event is two full O(text) rebuilds per keystroke on top of the input
     * handler's own render. Skip the repaint when nothing it draws changed.
     */
    private _lastPaintKey = '';

    private paintKey(): string {
        return [
            this.textarea.value,
            this.hasFocus ? this.textarea.selectionStart : -1,
            this.hasFocus ? this.textarea.selectionEnd : -1,
            this.picker ? 1 : 0,
            // NUL delimiter: it cannot occur in the textarea value, so distinct
            // states never collide into one key. Written as an escape so the
            // source stays plain text (a literal NUL makes the file read as
            // binary to grep and other tools).
        ].join('\u0000');
    }

    private onSelectionChange(): void {
        if (!this.hasFocus || this._inSelectionChange) return;
        this._inSelectionChange = true;
        try {
            if (this.paintKey() !== this._lastPaintKey) this.renderDisplay();

            const cursorPos = this.textarea.selectionStart;
            const hasSelection =
                this.textarea.selectionStart !== this.textarea.selectionEnd;
            // Snapshot for the favorites panel's "stamp at caret": a collapsed
            // caret only (a real selection has no single insertion point, so
            // the last collapsed position stands).
            if (!hasSelection) this._lastCaret = cursorPos;

            // Don't auto-open a picker immediately after one was just closed,
            // the cursor restoration from closePicker fires selectionchange and
            // stale segments could cause an unwanted re-open.
            const closeCooldown = performance.now() - this._lastCloseTime < 200;

            // Auto-open/close the inline editor when cursor enters/leaves a
            // marking. Drive this ONLY from segment offsets that still match the
            // live value. `this.segments` is refreshed by a debounced scan, so
            // while the user types it lags the text; a keystroke that shifts the
            // text (e.g. inserting a character ahead of a marking) briefly leaves
            // the caret "inside" a stale segment and would pop the editor over
            // text the user is actively typing, stealing the keystrokes that
            // follow. Suppressing the transition while the segments are stale
            // makes typing accumulate uninterrupted; a deliberate caret move
            // (click, arrow) after the scan settles still opens the picker.
            const segmentsFresh =
                this.textarea.value === this.lastSegmentedText;
            if (!hasSelection && segmentsFresh) {
                const segIdx = this.segments.findIndex(
                    (s) => cursorPos > s.start && cursorPos < s.end,
                );
                if (segIdx !== this.activeSegmentIndex) {
                    if (this.activeSegmentIndex >= 0 && this.picker) {
                        const nextSegmentIndex = segIdx;
                        this._explicitClose = true;
                        this.activeSegmentIndex = -1;
                        void this.closePicker().then(async () => {
                            await this.syncFromTextarea();
                            if (
                                nextSegmentIndex >= 0 &&
                                this.hasFocus &&
                                !this.picker
                            ) {
                                const next = this.segments[nextSegmentIndex];
                                if (next) {
                                    this.activeSegmentIndex = nextSegmentIndex;
                                    await this.openPicker(
                                        next.start,
                                        next.end,
                                        false,
                                    );
                                }
                            }
                            this.favoritesPanel?.syncStar();
                        });
                        return;
                    }
                    this.activeSegmentIndex = segIdx;
                    if (segIdx >= 0 && !closeCooldown) {
                        const seg = this.segments[segIdx];
                        void this.openPicker(seg.start, seg.end, false);
                    }
                }
            }
            // Sync the favorites star AFTER activeSegmentIndex is settled for
            // this tick (not before, which would read the previous caret
            // move's segment): the star's fill is caret-scoped and must never
            // lag one selectionchange behind the actual caret.
            this.favoritesPanel?.syncStar();
            // If any segment has a pending repair and the cursor is no longer inside
            // it, schedule a sync so the deferred repair applies.
            const hasDeferredRepair = this.segments.some(
                (seg) =>
                    seg.repaired &&
                    !(cursorPos > seg.start && cursorPos < seg.end),
            );
            if (hasDeferredRepair) this.scheduleSync();
        } finally {
            this._inSelectionChange = false;
        }
    }

    /** Render the full display: text with marking chips, caret, and selection. */
    protected renderDisplay(): void {
        const text = this.textarea.value;
        const selStart = this.hasFocus ? this.textarea.selectionStart : -1;
        const selEnd = this.hasFocus ? this.textarea.selectionEnd : -1;
        const hasSelection = selStart !== selEnd && selStart >= 0;

        hideTooltip(this.container);
        this.display.innerHTML = '';

        let cursor = 0;

        // While a portion's editor is open, that paragraph (its mark and its
        // text up to the end of its line) sits in one highlighted run, so a
        // long document still shows which portion the editor's list is for.
        // Everything else is appended straight to the display.
        let into: HTMLElement = this.display;
        const leaveParagraph = () => {
            into = this.display;
        };

        const appendRun = (str: string, startOffset: number) => {
            if (str.length === 0) return;
            if (into !== this.display) {
                const nl = str.indexOf('\n');
                if (nl >= 0) {
                    appendRun(str.slice(0, nl), startOffset);
                    leaveParagraph();
                    appendRun(str.slice(nl), startOffset + nl);
                    return;
                }
            }
            appendText(str, startOffset);
        };

        const appendText = (str: string, startOffset: number) => {
            if (str.length === 0) return;
            if (!hasSelection) {
                into.appendChild(document.createTextNode(str));
                return;
            }
            const absStart = startOffset;
            const absEnd = startOffset + str.length;
            let localCursor = 0;
            if (absStart < selStart && selStart < absEnd) {
                const beforeLen = selStart - absStart;
                into.appendChild(
                    document.createTextNode(str.slice(0, beforeLen)),
                );
                localCursor = beforeLen;
            }
            const overlapStart = Math.max(absStart, selStart);
            const overlapEnd = Math.min(absEnd, selEnd);
            if (overlapStart < overlapEnd) {
                const selSpan = document.createElement('span');
                selSpan.className = 'marked-textarea-selection';
                const sliceStart = overlapStart - absStart;
                const sliceEnd = overlapEnd - absStart;
                if (sliceStart > localCursor) {
                    into.appendChild(
                        document.createTextNode(
                            str.slice(localCursor, sliceStart),
                        ),
                    );
                }
                selSpan.textContent = str.slice(sliceStart, sliceEnd);
                into.appendChild(selSpan);
                localCursor = sliceEnd;
            }
            if (localCursor < str.length) {
                into.appendChild(
                    document.createTextNode(str.slice(localCursor)),
                );
            }
        };

        const appendChip = (seg: MarkedSegment) => {
            const chipText = text.slice(seg.start, seg.end);
            const chip = document.createElement('span');
            const warning = seg.valid && (seg.warnings?.length ?? 0) > 0;
            chip.className = !seg.valid
                ? 'marked-textarea-chip marked-textarea-chip--invalid'
                : warning
                  ? 'marked-textarea-chip marked-textarea-chip--warning'
                  : 'marked-textarea-chip';
            chip.dataset.start = String(seg.start);
            chip.dataset.end = String(seg.end);

            // A mark with something to say (broken rules, or a warning on a
            // valid marking) is a button: hover or focus gives the reason,
            // activating it opens the editor, whose list shows the errors,
            // the warnings and the ways to fix that portion.
            const attention = this.attentionOf(seg);
            if (attention) {
                chip.tabIndex = 0;
                chip.setAttribute('role', 'button');
                chip.setAttribute('aria-label', attention.label);
                // The tooltip sits outside the field, lined up with the mark,
                // so it never covers the paragraph it describes.
                attachTooltip(
                    chip,
                    () => attention.tooltip,
                    this.container,
                    () => this.shouldShowTooltip(),
                    undefined,
                    undefined,
                    () => ({ clearOf: this.wrap }),
                );
                const openMark = (event: Event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    this.textarea.setSelectionRange(
                        seg.start + 1,
                        seg.start + 1,
                    );
                    this.activeSegmentIndex = this.segments.indexOf(seg);
                    void this.openPicker(seg.start, seg.end);
                };
                chip.addEventListener('mousedown', openMark);
                chip.addEventListener('keydown', (event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                        openMark(event);
                    }
                });
            } else if (seg.valid) {
                this.attachSegmentTooltip(chip, seg.assertions);
            }

            const caretInChip =
                !hasSelection && selStart > seg.start && selStart < seg.end;

            if (hasSelection) {
                const overlapStart = Math.max(seg.start, selStart);
                const overlapEnd = Math.min(seg.end, selEnd);
                if (overlapStart < overlapEnd) {
                    if (seg.start < overlapStart) {
                        chip.appendChild(
                            document.createTextNode(
                                chipText.slice(0, overlapStart - seg.start),
                            ),
                        );
                    }
                    const selSpan = document.createElement('span');
                    selSpan.className = 'marked-textarea-selection';
                    selSpan.textContent = chipText.slice(
                        overlapStart - seg.start,
                        overlapEnd - seg.start,
                    );
                    chip.appendChild(selSpan);
                    if (overlapEnd < seg.end) {
                        chip.appendChild(
                            document.createTextNode(
                                chipText.slice(overlapEnd - seg.start),
                            ),
                        );
                    }
                } else {
                    chip.textContent = chipText;
                }
            } else if (caretInChip) {
                const caretOffset = selStart - seg.start;
                chip.appendChild(
                    document.createTextNode(chipText.slice(0, caretOffset)),
                );
                const caretEl = document.createElement('span');
                caretEl.className = 'marked-textarea-caret';
                chip.appendChild(caretEl);
                chip.appendChild(
                    document.createTextNode(chipText.slice(caretOffset)),
                );
            } else {
                chip.textContent = chipText;
            }

            // If the inline editor is active for this segment, mount it inline
            // instead of the static chip; the editor sits in the text flow
            if (
                this.picker &&
                this.activeRange &&
                seg.start === this.activeRange.start &&
                seg.end === this.activeRange.end
            ) {
                // Wrap the editor in a chip-styled span so the delimiters and
                // border-radius match a resting chip's shape. The FILL does
                // not carry over: marked-text-area.css's `--editing`
                // modifier clears `.marked-textarea-chip`'s solid background,
                // since that background reuses the same accent-tinted token
                // the design system's own real selection/highlight states
                // draw from (--ez-color-surface-active): painting it behind
                // a still-empty, freshly-inserted template read as a stray
                // selection sitting on the open delimiter, not as "you're
                // editing this."
                const editorChip = document.createElement('span');
                editorChip.className =
                    'marked-textarea-chip marked-textarea-chip--editing';
                const openDelim = this.template.slice(0, 1);
                const closeDelim = ')';
                editorChip.appendChild(document.createTextNode(openDelim));
                if (this.pickerMount) {
                    editorChip.appendChild(this.pickerMount);
                }
                editorChip.appendChild(document.createTextNode(closeDelim));
                const paragraph = document.createElement('span');
                paragraph.className = 'marked-textarea-active-paragraph';
                this.display.appendChild(paragraph);
                paragraph.appendChild(editorChip);
                into = paragraph;
            } else {
                // Click on a chip opens the inline editor for that marking.
                // The chip is in the display div (z-index 1) under the textarea
                // (z-index 2). We use mousedown on the textarea and check if the
                // click position overlaps a chip's bounding box.
                chip.dataset.segStart = String(seg.start);
                chip.dataset.segEnd = String(seg.end);
                this.display.appendChild(chip);
            }

            // Repaired segments carry no per-segment star: the field's single
            // status mark carries the repaired state, per the Enhancement
            // Status Indicator contract.

            // Error tooltip when the hidden textarea caret is inside an invalid
            // marking. The visible chip owns the usual hover/focus path; this
            // keeps keyboard/caret navigation equivalent.
            const caretNearChip =
                this.hasFocus &&
                !hasSelection &&
                selStart >= seg.start &&
                selStart <= seg.end;
            if (this.shouldShowTooltip() && attention && caretNearChip) {
                showTooltip(chip, attention.tooltip, this.container, {
                    clearOf: this.wrap,
                });
            }
        };

        const insertCaret = () => {
            if (!this.hasFocus || hasSelection) return;
            const caretEl = document.createElement('span');
            caretEl.className = 'marked-textarea-caret';
            into.appendChild(caretEl);
        };

        for (const seg of this.segments) {
            if (seg.start > cursor) {
                const plainText = text.slice(cursor, seg.start);
                if (
                    !hasSelection &&
                    selStart >= cursor &&
                    selStart <= seg.start
                ) {
                    const caretOffset = selStart - cursor;
                    appendRun(plainText.slice(0, caretOffset), cursor);
                    insertCaret();
                    appendRun(
                        plainText.slice(caretOffset),
                        cursor + caretOffset,
                    );
                } else {
                    appendRun(plainText, cursor);
                }
            }

            if (!hasSelection && selStart === seg.start) {
                insertCaret();
            }

            // A mark starts its own paragraph run (or none).
            leaveParagraph();
            appendChip(seg);

            if (!hasSelection && selStart === seg.end) {
                insertCaret();
            }

            cursor = seg.end;
        }

        if (cursor < text.length) {
            const remaining = text.slice(cursor);
            if (
                !hasSelection &&
                selStart >= cursor &&
                selStart <= text.length
            ) {
                const caretOffset = selStart - cursor;
                appendRun(remaining.slice(0, caretOffset), cursor);
                insertCaret();
                appendRun(remaining.slice(caretOffset), cursor + caretOffset);
            } else {
                appendRun(remaining, cursor);
            }
        } else if (!hasSelection && selStart === text.length) {
            insertCaret();
        }

        if (text.length === 0 && this.hasFocus) {
            insertCaret();
        }

        this.display.scrollTop = this.textarea.scrollTop;
        this.display.scrollLeft = this.textarea.scrollLeft;
        this._lastPaintKey = this.paintKey();
        this.exposePickerInDisplay();
        this.favoritesPanel?.syncStar();
    }

    private syncHiddenFields(): void {
        const previous = new Map(
            this.hiddenContainers.map((box, index) => [
                box.id,
                { box, field: this.hiddenFields[index] },
            ]),
        );
        const portions = this.committedPortions();
        // The explicit first-part binding follows the first current portion,
        // even after an insertion changes which stable entry occupies it.
        if (
            this.textarea.hasAttribute('data-ezclassify-first-part-binding') &&
            this.hiddenContainers[0]?.id !==
                portions.find((segment) => segment.entryId)?.entryId
        ) {
            for (const { box, field } of previous.values()) {
                field?.destroy();
                this.options.unregisterHiddenField?.(box);
                box.remove();
            }
            previous.clear();
        }
        this.hiddenFields = [];
        this.hiddenContainers = [];
        for (let i = 0; i < portions.length; i++) {
            const seg = portions[i];
            if (!seg.entryId) continue;
            const reused = previous.get(seg.entryId);
            previous.delete(seg.entryId);
            const box = reused?.box ?? document.createElement('div');
            if (!reused) {
                box.setAttribute('data-ezclassify-controller', 'hidden');
                box.setAttribute(
                    'data-ezclassify-hidden-format',
                    this.hiddenFormat,
                );
                box.id = seg.entryId;
                box.setAttribute('data-ezclassify-rendered', '');
                if (this.partOfId)
                    box.setAttribute('data-ezclassify-part-of', this.partOfId);
                box.setAttribute('data-marked-textarea-field', '');
                if (this.options.entryStoreManaged)
                    box.setAttribute('data-marked-textarea-entry-managed', '');
                this.hiddenRoot.appendChild(box);
            }
            box.setAttribute(
                'data-ezclassify-target',
                `${this.targetIdPrefix}${i + 1}`,
            );
            box.dataset.segmentIndex = String(i);
            box.dataset.segmentStart = String(seg.start);
            box.dataset.segmentEnd = String(seg.end);
            const field =
                reused?.field ??
                this.options.registerHiddenField?.(box) ??
                null;
            if (
                field &&
                JSON.stringify(field.getAssertions()) !==
                    JSON.stringify(seg.assertions)
            )
                field.setAssertions(seg.assertions);
            this.hiddenFields.push(field);
            this.hiddenContainers.push(box);
        }
        for (const { box, field } of previous.values()) {
            field?.destroy();
            this.options.unregisterHiddenField?.(box);
            box.remove();
        }
        this.emitChange();
    }

    private emitChange(): void {
        this.options.onChange?.(this.getAssertions(), '');
        const detail = {
            segments: this.getSegments(),
            scanResult: null,
            origin: this.applyingEntryState ? 'store' : 'editor',
        };
        this.textarea.dispatchEvent(
            new CustomEvent('ezclassify:marked-change', {
                bubbles: true,
                detail,
            }),
        );
        this.container.dispatchEvent(
            new CustomEvent('ezclassify:marked-change', {
                bubbles: true,
                detail,
            }),
        );
    }

    /**
     * Emit a lightweight event with current segment text for live preview
     * updates.
     */
    private emitTextChange(): void {
        const text = this.textarea.value;
        const segments = this.segments.map((seg, i) => {
            const nextStart = this.segments[i + 1]?.start ?? text.length;
            return {
                marking: seg.marking,
                rendered: seg.rendered,
                text: text.slice(seg.end, nextStart).replace(/^\s+|\s+$/g, ''),
            };
        });
        const detail = { segments, scanResult: null };
        this.textarea.dispatchEvent(
            new CustomEvent('ezclassify:text-change', {
                bubbles: true,
                detail,
            }),
        );
        this.container.dispatchEvent(
            new CustomEvent('ezclassify:text-change', {
                bubbles: true,
                detail,
            }),
        );
    }

    private initResize(handle: HTMLElement): void {
        let startY = 0;
        let startH = 0;
        const onMouseMove = (e: MouseEvent) => {
            const newH = startH + (e.clientY - startY);
            if (newH >= 48) {
                this.display.style.height = `${newH}px`;
            }
        };
        const onMouseUp = () => {
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
        };
        handle.addEventListener('mousedown', (e) => {
            e.preventDefault();
            startY = e.clientY;
            startH = this.display.offsetHeight;
            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);
        });
    }

    /** Selected text a Ctrl+Enter moved into a new mark, for the next open. */
    private _pickerDraft: string | undefined;

    /**
     * Open the inline editor on the marking at `[start, end)`.
     *
     * @param openList - False when the caret moving into the marking opened the
     *   editor: that is not a request for suggestions.
     */
    private async openPicker(
        start: number,
        end: number,
        openList = true,
    ): Promise<void> {
        this.destroyPicker();
        const openSeq = this.pickerOpenSeq;
        // Escape cancels the edit. The Ctrl+Enter path snapshots before its
        // template insertion; the click/caret-driven opens snapshot here.
        if (!this._pickerCancelSnapshot) {
            this._pickerCancelSnapshot = {
                value: this.textarea.value,
                caret: this.textarea.selectionStart,
            };
        }
        // Cancel any debounced scan that hasn't fired yet. With the picker now
        // open, syncFromTextarea would skip anyway, but clearing the timer avoids
        // a spurious no-op setTimeout callback on the scheduler queue.
        if (this.syncTimer) {
            clearTimeout(this.syncTimer);
            this.syncTimer = null;
        }
        this.activeRange = { start, end };

        const v = this.textarea.value;
        const raw = v.slice(start, end);
        // A mark just made from selected text holds that text as an
        // uncommitted draft: nothing has been stored for it yet.
        const draft = this._pickerDraft;
        this._pickerDraft = undefined;
        const inner = draft ? '' : this.extractInner(raw);

        // Find the segment's existing assertions so the editor can seed from
        // them instead of re-parsing the rendered text. This is critical for
        // marking formats the engine can't round-trip (e.g. joint markings).
        const seg = this.segments.find(
            (s) => s.start === start && s.end === end,
        );
        const existingAssertions = seg?.assertions;

        // Create an inline mount: renderDisplay will place it in the text flow
        // where the chip would normally be, between the parentheses
        const mount = document.createElement('span');
        mount.className = 'marked-textarea-picker-mount';
        mount.style.display = 'inline';

        const picker = new InlineMarkingEditor();
        await picker.init(
            mount as unknown as HTMLDivElement,
            this.engineSource,
            inner,
            {
                formatId: this.scanFormat,
                scope: this.options.scope,
                assertions: existingAssertions,
                draft,
                openList,
                resolveContext: this.options.resolveContext,
                schemeId: this.schemeId,
                tooltips: this.options.tooltips,
                tooltipConceptProperty: this.options.tooltipConceptProperty,
                onChange: () => this.onPickerChange(),
                onExit: (direction, fromSheet) => {
                    const range = this.activeRange;
                    this._explicitClose = true;
                    void this.closePicker().then(async () => {
                        const pos = range
                            ? direction === 'left'
                                ? range.start
                                : range.end
                            : this.textarea.selectionStart;
                        if (fromSheet) this.leaveCaretAt(pos);
                        else this.focusAt(pos);
                        await this.syncFromTextarea();
                        this.revealCaret();
                    });
                },
                onBlurCommit: (outcome) => {
                    // An invalid draft stays mounted and marked; anything
                    // else was stored (or unchanged) and the editor closes.
                    if (outcome === 'invalid' || this.picker !== picker) return;
                    this._explicitClose = true;
                    void this.closePicker().then(() => this.afterClose());
                },
                onCancel: () => this.escapeClosePicker(),
                // The favorites button stamps onto the open segment, so
                // focus moving to it must not close the editor first.
                isFieldChrome: (node) =>
                    !!this.favoritesPanel?.button.contains(node),
                // Which paragraph's mark this is, ahead of the field's own
                // label, so the sheet's title says it even when it has to
                // truncate.
                label: () => {
                    const field = accessibleLabel(
                        this.textarea,
                        t('aria.markingInput'),
                    );
                    const paragraph = paragraphNumber(
                        this.textarea.value,
                        this.activeRange?.start ?? start,
                    );
                    return {
                        text: t('mark.paragraphTitle')
                            .replace('{n}', String(paragraph))
                            .replace('{label}', field.text),
                    };
                },
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

        this.container.classList.add(this.classNames.pickerActive);

        // Re-render display so the chip is replaced with the inline editor
        this.renderDisplay();
        picker.focus();
    }

    private onPickerChange(): void {
        if (!this.picker || !this.activeRange) {
            return;
        }
        this.userEditPending = true;
        const rendered = this.picker.getRendered().trim();
        const { start, end } = this.activeRange;
        const v = this.textarea.value;
        const full = this.wrapRendered(rendered);
        const nextChar = v[end];
        const insert =
            full && (nextChar === ' ' || nextChar === '\n') && /\s$/.test(full)
                ? full.replace(/\s+$/, '')
                : full;
        const next = v.slice(0, start) + insert + v.slice(end);
        // Picker edit: a user-driven value change, so notify the host.
        this.setHostValue(next);
        this.lastScannedText = '';

        // Update activeRange to match the new marking length so subsequent
        // edits patch the correct span. Keep the editor open; the user may
        // want to add more concepts before leaving the marking.
        const newEnd = start + insert.length;
        this.activeRange = { start, end: newEnd };

        // Update the segment that the editor is editing so renderDisplay and
        // selectionchange use correct positions.
        const segIdx = this.segments.findIndex((s) => s.start === start);
        if (segIdx >= 0) {
            const drift = newEnd - end;
            this.segments[segIdx] = {
                ...this.segments[segIdx],
                end: newEnd,
                marking: insert,
                rendered,
                assertions: this.picker.getAssertions(),
            };
            // Shift all segments after this one by the same drift
            for (let i = segIdx + 1; i < this.segments.length; i++) {
                this.segments[i] = {
                    ...this.segments[i],
                    start: this.segments[i].start + drift,
                    end: this.segments[i].end + drift,
                };
            }
        }

        this.renderDisplay();
        this.picker.focus();
    }

    protected async closePicker(skipRender = false): Promise<void> {
        // Don't close while an acceptance might be in progress.
        // Only allow close from:
        // - skipRender=true (acceptance flow via onPickerChange)
        // - Explicit user actions (Escape, arrow-exit) which set _explicitClose
        if (!skipRender && this.picker && !this._explicitClose) {
            return;
        }
        this._explicitClose = false;

        // Leaving the editor is a commit boundary, through the composer's one
        // commit function: a draft that does not read completely stays open
        // and marked invalid rather than being dropped or written raw.
        if (this.picker && this.activeRange && !skipRender) {
            const outcome = await this.picker.commit();
            if (outcome === 'invalid') return;
        }

        // Save the editor's assertions before destroying it. syncFromTextarea
        // will use these instead of re-parsing the rendered text, the engine's
        // text parser can't always reconstruct assertions from the rendered form
        // (e.g. joint markings like "//JOINT TIER 3 ALPHA BRAVO//NET-G//RL").
        if (this.picker && this.activeRange) {
            // Commit path: fixes the engine applied inside the editor belong
            // to the committed value, so they join the field's mark record.
            // (Escape-cancel never reaches here and discards them.)
            this.recordMarksHeld(
                this.marksWith(
                    this.activeRange.start,
                    this.picker.getAssertions(),
                ),
            );
            recordAppliedFixes(
                this._appliedFixes,
                this.picker.getAppliedFixes(),
            );
            this.updateStatusMark();
            const rendered = this.picker.getRendered().trim();
            // The dedup key is the marking as the field writes it.
            const wrappedRendered = this.wrapRendered(rendered).trimEnd();
            this._editorAssertions = {
                marking: wrappedRendered,
                assertions: this.picker.getAssertions(),
            };
        }

        // Write the editor's current INPUT content to the textarea on close.
        // This handles: user typed text directly, or deleted concepts.
        // Leaving the editor is a commit boundary, so write its scheme-resolved
        // canonical value rather than provisional input text.
        if (this.picker && this.activeRange && !skipRender) {
            const editorContent = this.picker.getRendered().trim();
            const { start, end } = this.activeRange;
            const v = this.textarea.value;
            const existing = v.slice(start, end);
            const full = this.wrapRendered(editorContent);
            const trimmedFull = full.trimEnd();
            if (trimmedFull !== existing) {
                const nextChar = v[end];
                const insert =
                    trimmedFull && (nextChar === ' ' || nextChar === '\n')
                        ? trimmedFull
                        : full;
                this.setHostValue(v.slice(0, start) + insert + v.slice(end));
                this.lastScannedText = '';
                // Prune segments whose end position now falls outside the patched
                // textarea. Happens when the picker closes without a selection and
                // the "()" template is removed; the temp segment pushed by openPicker
                // would otherwise outlive the textarea content, causing a ghost chip.
                // syncFromTextarea() would normally clear this but skips early when
                // both the new value and lastScannedText happen to equal "" (the
                // empty-textarea case), so we must sync segments here instead.
                const newLen = this.textarea.value.length;
                this.segments = this.segments.filter((s) => s.end <= newLen);
            }

            // Merely opening and leaving a loaded repairable marking is the
            // user's commit boundary. If its content was not otherwise
            // changed, apply the exact safe repair the engine returned during
            // the load scan. Genuine validation errors have no pending fixes
            // and remain highlighted.
            const loadedSegment = this.segments.find(
                (segment) =>
                    segment.start === start && segment.pendingFixes?.length,
            );
            if (
                loadedSegment &&
                editorContent ===
                    this.extractInner(loadedSegment.marking).trim()
            ) {
                const repaired = applyRepairsLogic(
                    [{ ...loadedSegment, repaired: true }],
                    this._pickerCancelSnapshot?.value ?? this.textarea.value,
                    this.template,
                    this.embeddedStyle?.pattern,
                );
                if (repaired.patched) {
                    this.setHostValue(repaired.value);
                    recordAppliedFixes(
                        this._appliedFixes,
                        loadedSegment.pendingFixes,
                    );
                    this.updateStatusMark();
                    const correctedMarking = this.wrapRendered(
                        loadedSegment.rendered,
                    ).trimEnd();
                    this._editorAssertions = {
                        marking: correctedMarking,
                        assertions: this.picker.getAssertions(),
                    };
                    this.lastScannedText = '';
                }
            }
        }
        if (this.picker && !skipRender) {
            // Opening a marking and leaving its editor is an edit transaction,
            // even when the author did not type. Preserve loaded text at rest,
            // but on commit re-run the engine from the editor assertions so
            // safe fixes are applied consistently on click-out/blur.
            this.userEditPending = true;
            this.lastScannedText = '';
            this.lastMarkingStrings = [];
        }
        this.activeRange = null;
        this.activeSegmentIndex = -1;
        this.finishClose();
        // Re-render to swap the inline editor back to a static chip,
        // unless the caller will trigger a sync that handles rendering
        if (!skipRender) this.renderDisplay();
    }

    /**
     * The favorites panel's notion of "current marking": the segment the caret
     * sits inside, tracked continuously, NOT gated on an inline editor being
     * open. A multi-segment textarea has no single whole-field marking to
     * compare/save, so this is caret-scoped end to end: star-fill lights up
     * gold only while the caret sits inside a segment whose rendered form
     * matches a loaded favorite (outline in body text, at a boundary, or with
     * no match), and the pinned save/remove row offers itself (and is otherwise
     * absent) on exactly the same condition.
     *
     * Reads `activeSegmentIndex` rather than re-deriving "which segment is the
     * caret in" from `hasFocus`/`textarea.selectionStart` directly:
     * `onSelectionChange`'s auto-open/close transition already maintains that
     * index as the single source of truth for exactly this question, updated on
     * every caret move (including the brief post-close cooldown window where a
     * NEW segment is entered but the picker deliberately doesn't auto-reopen
     * yet; see its own comment), and reset to -1 by `closePicker` on every exit
     * path. Deriving it independently here would have to reinvent that same
     * state machine and would disagree with it the moment the inline editor's
     * own input (not the textarea) holds DOM focus, since `hasFocus` tracks the
     * TEXTAREA's native focus/blur only.
     */
    private currentFavoritesMarking(): { rendered: string; valid: boolean } {
        const seg = this.segments[this.activeSegmentIndex];
        if (!seg) return { rendered: '', valid: false };
        return {
            rendered: seg.rendered,
            valid: seg.valid && !!seg.rendered,
        };
    }

    /**
     * Where a brand-new marked line should start, given a raw caret position.
     * keepLeadingPartMarks only recognizes a part mark when it leads a line, so
     * a caret sitting inside a line that's already marked can't start the new
     * mark in place; it has to start a new line. Snapping that new line's start
     * to the END of the current line (rather than the raw caret) keeps whatever
     * text is already on that line intact instead of splitting it mid-word.
     * Shared by the favorites stamp path and the Ctrl+Enter template-insert
     * path; both walk the same line/segment geometry to decide it.
     */
    private newMarkedLineInsertion(caret: number): {
        insertAt: number;
        prefix: string;
    } {
        const v = this.textarea.value;
        // A caret snapshot taken before a host-driven value replacement (the
        // Tab-to-star path snapshots on blur) can be stale by the time it's
        // used here: clamp it to the current text's length instead of
        // resolving line geometry against an offset the text no longer has.
        const safeCaret = Math.min(caret, v.length);
        const lineStart =
            safeCaret === 0 ? 0 : v.lastIndexOf('\n', safeCaret - 1) + 1;
        const lineHasMark = this.segments.some((s) => s.start === lineStart);
        if (!lineHasMark) {
            return { insertAt: lineStart, prefix: '' };
        }
        const nextNewline = v.indexOf('\n', safeCaret);
        const lineEnd = nextNewline === -1 ? v.length : nextNewline;
        return { insertAt: lineEnd, prefix: '\n' };
    }

    /**
     * Apply a favorite: "stamp at caret." Inside an open inline editor, it
     * REPLACES that segment's marking text; in plain body text, it inserts a
     * new marking segment at the last known caret. Both branches operate on the
     * textarea's OWN current text for the target span rather than
     * reconstructing it, so this behaves correctly whether the open segment is
     * freshly templated (Ctrl+Enter, nothing typed yet) or a previously
     * loaded/edited marking.
     */
    private async applyFavorite(marking: string): Promise<void> {
        const result = await this.readForFavorites(marking);
        const rendered = result.rendered.trim();
        const wrapped = this.wrapRendered(rendered);

        if (this.picker && this.activeRange) {
            // Replacing an existing segment's span excludes the template's
            // trailing separator (the span ends at the marking's own close
            // delimiter, not past it), so the replacement text must not
            // carry one either, so trimming here is correct, not an oversight.
            const insert = wrapped.trimEnd();
            const { start, end } = this.activeRange;
            const v = this.textarea.value;
            this.setHostValue(v.slice(0, start) + insert + v.slice(end));
            this.lastScannedText = '';
            this.recordMarksHeld(this.marksWith(start, result.assertions));
            recordAppliedFixes(this._appliedFixes, result.appliedFixes);
            this.updateStatusMark();
            // Tear the picker down WITHOUT its normal "write picker content
            // back" step (closePicker's non-skipRender path): the line above
            // already wrote the correct, final content, and re-reading the
            // (untouched) picker's own input would clobber it.
            this.finishClose();
            this.activeRange = null;
            this.activeSegmentIndex = -1;
            this.focusAt(start + insert.length);
            void this.syncFromTextarea().then(() => this.revealCaret());
            return;
        }

        // Inserting into plain body text keeps the template's trailing
        // separator intact: that space is what keeps the new marking from
        // gluing directly onto the body text that follows it. The
        // Ctrl+Enter insert path never trims for the same reason.
        const insert = wrapped;
        const caret = this._lastCaret;
        const v = this.textarea.value;
        const { insertAt, prefix } = this.newMarkedLineInsertion(caret);
        const inserted = prefix + insert;
        this.setHostValue(v.slice(0, insertAt) + inserted + v.slice(insertAt));
        this.lastScannedText = '';
        this.recordMarksHeld(this.marksWith(-1, result.assertions));
        recordAppliedFixes(this._appliedFixes, result.appliedFixes);
        this.updateStatusMark();
        const caretAfter = insertAt + inserted.length;
        this.focusAt(caretAfter);
        this._lastCaret = caretAfter;
        void this.syncFromTextarea().then(() => this.revealCaret());
    }

    private onKeydown(e: KeyboardEvent): void {
        if (this.picker && e.key === 'Escape') {
            e.preventDefault();
            this.escapeClosePicker();
            return;
        }

        // Ctrl+Shift+Enter (Win/Linux) or Cmd+Shift+Enter (Mac): open the
        // favorites panel at the caret, instead of the concept picker.
        if (
            !this.picker &&
            e.key === 'Enter' &&
            (e.ctrlKey || e.metaKey) &&
            e.shiftKey
        ) {
            e.preventDefault();
            if (this.favoritesPanel) {
                this._lastCaret = this.textarea.selectionStart;
                void this.favoritesPanel.open();
            }
            return;
        }

        // Ctrl+Enter (Win/Linux) or Cmd+Enter (Mac): open picker
        if (!this.picker && e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            const selStart = this.textarea.selectionStart;
            const selEnd = this.textarea.selectionEnd;

            // Check if caret or selection is inside an existing marking
            for (const seg of this.segments) {
                if (selStart >= seg.start && selEnd <= seg.end) {
                    void this.openPicker(seg.start, seg.end);
                    return;
                }
            }

            // Snapshot BEFORE any edit below so an Escape cancel restores the
            // text exactly, template and selection included.
            this._pickerCancelSnapshot = {
                value: this.textarea.value,
                caret: selStart,
            };

            // A selection is text the user means as the marking: it moves
            // into the new mark as the editor's draft and is read there,
            // instead of an empty mark landing in front of it. One line only;
            // a marking is never multi-line.
            let draft = '';
            if (selStart !== selEnd) {
                const selected = this.textarea.value.slice(selStart, selEnd);
                if (/[\r\n]/.test(selected) || !selected.trim()) return;
                draft = selected.trim();
                const removed = selEnd - selStart;
                const without =
                    this.textarea.value.slice(0, selStart) +
                    this.textarea.value.slice(selEnd);
                this.setHostValue(without);
                this.lastScannedText = '';
                for (let i = 0; i < this.segments.length; i++) {
                    if (this.segments[i].start >= selEnd) {
                        this.segments[i] = {
                            ...this.segments[i],
                            start: this.segments[i].start - removed,
                            end: this.segments[i].end - removed,
                        };
                    }
                }
                this.textarea.setSelectionRange(selStart, selStart);
            }
            const caret = selStart;

            const template = this.template;
            const v = this.textarea.value;
            const openDelim = template.slice(0, template.indexOf('{marking}'));
            const closeDelim = template
                .slice(template.indexOf('{marking}') + '{marking}'.length)
                .trimEnd();

            // Scan backwards for an unmatched open delimiter
            const before = v.slice(0, caret);
            const lastOpen = openDelim ? before.lastIndexOf(openDelim) : -1;
            const hasUnmatchedOpen =
                lastOpen >= 0 &&
                (closeDelim
                    ? !before.slice(lastOpen).includes(closeDelim)
                    : false);

            if (hasUnmatchedOpen && !draft) {
                const afterCaret = v.slice(caret);
                const alreadyClosed =
                    closeDelim && afterCaret.startsWith(closeDelim);
                if (alreadyClosed) {
                    const markingEnd = caret + closeDelim.length;
                    void this.openPicker(lastOpen, markingEnd);
                } else {
                    const insertClose = closeDelim + ' ';
                    this.setHostValue(
                        v.slice(0, caret) + insertClose + v.slice(caret),
                    );
                    this.lastScannedText = '';
                    const markingEnd = caret + closeDelim.length;
                    // Add temp segment so inline editor can mount
                    this.segments.push({
                        start: lastOpen,
                        end: markingEnd,
                        marking: v.slice(lastOpen, caret) + closeDelim,
                        assertions: [],
                        rendered: '',
                        text: '',
                        valid: true,
                        errors: [],
                        validationErrors: [],
                        repaired: false,
                    });
                    this.activeSegmentIndex = this.segments.length - 1;
                    void this.openPicker(lastOpen, markingEnd);
                }
            } else {
                const insert = template.replace('{marking}', draft);
                this._pickerDraft = draft || undefined;
                // Part marks are only recognized when they LEAD a line
                // (keepLeadingPartMarks); a template dropped mid-line would
                // be silently discarded by the next scan, so the marking the
                // user just built would vanish without a chip or an error.
                // Insert at the start of the caret's line so the new mark
                // covers that paragraph. When the line already begins with a
                // marking, start a new marked line after it instead of
                // splitting the current line mid-word.
                const { insertAt, prefix } = this.newMarkedLineInsertion(caret);
                const inserted = prefix + insert;
                this.setHostValue(
                    v.slice(0, insertAt) + inserted + v.slice(insertAt),
                );
                this.lastScannedText = '';
                const markStart = insertAt + prefix.length;
                const markingEnd = markStart + insert.trimEnd().length;
                // Shift segments at/after the insertion point so their offsets
                // keep matching the patched text.
                for (let i = 0; i < this.segments.length; i++) {
                    if (this.segments[i].start >= insertAt) {
                        this.segments[i] = {
                            ...this.segments[i],
                            start: this.segments[i].start + inserted.length,
                            end: this.segments[i].end + inserted.length,
                        };
                    }
                }
                // Create a temporary segment for the new empty marking so the
                // inline editor can mount. Don't sync first, the empty ()
                // would be removed by repair before the editor opens.
                this.segments.push({
                    start: markStart,
                    end: markingEnd,
                    marking: insert.trimEnd(),
                    assertions: [],
                    rendered: '',
                    text: '',
                    valid: true,
                    errors: [],
                    validationErrors: [],
                    repaired: false,
                });
                // Keep segments ordered by start: renderDisplay walks them as
                // an ascending sequence.
                this.segments.sort((a, b) => a.start - b.start);
                this.activeSegmentIndex = this.segments.findIndex(
                    (s) => s.start === markStart && s.end === markingEnd,
                );
                void this.openPicker(markStart, markingEnd);
            }
        }
    }

    /**
     * Caret target = end of the active marking, or the live caret when no
     * marking is active. Captured BEFORE close clears the active range.
     */
    protected captureCaretTarget(): number {
        return this.activeRange
            ? this.activeRange.end
            : this.textarea.selectionStart;
    }

    /** Restore the caret to the captured target after a host-level Escape close. */
    protected restoreCaretAfterEscape(target: number | null): void {
        const caretAfter = target ?? this.textarea.selectionStart;
        this.textarea.setSelectionRange(caretAfter, caretAfter);
    }

    /** The textarea also restores the caret on the capture-phase Escape path. */
    protected override restoreCaretOnDocEscape(target: number | null): void {
        const caretAfter = target ?? this.textarea.selectionStart;
        this.textarea.setSelectionRange(caretAfter, caretAfter);
    }

    /**
     * Focus the field with the caret at `pos` without letting the browser
     * scroll the page: focusing a textarea scrolls to wherever its caret was,
     * which after an edit of one paragraph could be the end of the document.
     * {@link revealCaret} then brings the right place into view.
     */
    private focusAt(pos: number): void {
        this.textarea.focus({ preventScroll: true });
        this.textarea.setSelectionRange(pos, pos);
    }

    /**
     * Put the caret at `pos` without focusing the field. After the phone sheet
     * closes, focus on the textarea would bring the keyboard straight back up;
     * the caret is still where the next edit starts.
     */
    private leaveCaretAt(pos: number): void {
        this.textarea.setSelectionRange(pos, pos);
        const active = this.textarea.ownerDocument.activeElement;
        if (
            active instanceof HTMLElement &&
            active !== this.textarea.ownerDocument.body
        )
            active.blur();
    }

    /**
     * Bring the mark (or text) at the caret into view, only when it is outside
     * the visible part of the page or under a bar the page pins to its top.
     */
    private revealCaret(): void {
        const pos = this.textarea.selectionStart;
        const chip = [
            ...this.display.querySelectorAll<HTMLElement>('[data-start]'),
        ].find(
            (c) =>
                Number(c.dataset.start) <= pos && pos <= Number(c.dataset.end),
        );
        revealClearOfPinned(chip ?? this.wrap);
    }

    protected afterClose(): void {
        void this.syncFromTextarea();
    }

    /**
     * Reset segment state after an Escape cancel. When the cancel rewrote the
     * textarea, every segment offset (including the temp segment pushed for a
     * fresh template) was computed against the discarded value; drop them and
     * force the post-cancel sync to rescan from scratch.
     */
    protected afterCancel(valueRestored: boolean): void {
        this.activeRange = null;
        this.activeSegmentIndex = -1;
        if (valueRestored) {
            this.segments = [];
            this.lastMarkingStrings = [];
            this.lastScannedText = '';
            this.lastSegmentedText = '';
        }
        this.renderDisplay();
    }
}
