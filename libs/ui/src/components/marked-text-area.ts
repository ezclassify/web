import { markingTarget, setMarkingEntry } from './marking-target';
/**
 * MarkedTextArea: progressively enhances a <textarea> whose value contains
 * inline markings (e.g. "(U) Para one.\n\n(S) Para two."). An owned editor
 * captures keyboard and pointer input. The original textarea holds the
 * submitted value. A display div renders styled text with marking chips, a
 * blinking caret, and selection highlights; all in one text flow, so there is
 * zero drift between cursor and text.
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
    RenderAssessment,
    UnreadMark,
    ValidationError,
} from '@ezclassify/types';
import type { ComponentEngineSource } from './component-base-readonly';
import type { ComponentOptions } from './component-base-readonly';
import { HiddenAssertionField } from './hidden-assertion-field';
import { accessibleLabel } from './composer/composer-view';
import { bindNativeTextEditor } from './native-text-editor';
import { assertionFactKey, withoutTakenFromWhole } from '../assertion-identity';
import { renderViewRefused } from '../render-refusal';
import { t } from '../i18n';
import { createAnnouncer } from './accessibility-helpers';
import { getMountHost } from '../mount-host-registry';
import { wholeSettled } from '../whole-read-gate';
import { revealClearOfPinned } from './composer/composer-placement';
import { AppliedFixHistory } from './applied-fix-history';
import {
    statusMarkOwnsNode,
    statusMarkFavoriteApplyOwner,
    setStatusMarkError,
    setStatusMarkGroups,
    type StatusMarkGroup,
} from './status-mark';
import {
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
import type { ShownForm } from '../written-facts';
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
    editedMarkingIndices,
    fixesNeedingCorrection,
    paragraphNumber,
} from './marked-text-area-logic';

interface PendingMarkReading {
    start: number;
    marking: string;
    assertions: Assertion[];
    changes: readonly Change[];
}

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
    /**
     * The text inside the wrapper as the engine's scan read it
     * (`ScanResult.inner`). Absent for text the scan did not read, such as an
     * unrecognized wrapper or a mark still being inserted.
     *
     * @internal
     */
    inner?: string;
    /** Engine assertions for the marking. */
    assertions: Assertion[];
    /** Rendered marking (format matches scan output). */
    rendered: string;
    /**
     * What writing `rendered` did with the marking's facts, as the engine
     * assessed it: which it wrote, left out or collapsed into another value.
     */
    assessment?: RenderAssessment;
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

/**
 * The wrapped marks a scan could not read that this field shows, as invalid
 * segments with no assertions.
 *
 * A part mark leads its paragraph, so the field shows the unread marks the
 * engine says lead theirs. A wrapped token later in a line, such as the "(a)"
 * of "see section (a) below", stays prose.
 *
 * @param unread - The scan's `unread` list, in document order
 */
function unreadSegments(unread: readonly UnreadMark[]): MarkedSegment[] {
    return unread
        .filter((mark) => mark.leading)
        .map((mark) => ({
            start: mark.start,
            end: mark.end,
            marking: mark.text,
            assertions: [],
            rendered: '',
            text: '',
            valid: false,
            errors: ['Unrecognized marking: not matched to any known concept'],
            validationErrors: [],
            repaired: false,
        }));
}

/** Caller-facing options for MarkedTextArea. */
export interface MarkedTextAreaOptions extends ComponentOptions {
    /** The host binds ordered entries; hidden children are projection-only. */
    entryStoreManaged?: boolean;
    /** Resolve the whole/banner marking at call time for part-of context. */
    resolveContext?: () => ProcessingContext | undefined;
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
    onScanCompleteness?: (complete: boolean) => void;
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
    protected readonly markingActionKey = 'hint.addMarking' as const;
    protected readonly classNames: MarkedFieldClassNames = {
        wrap: 'marked-textarea-wrap',
        display: 'marked-textarea-display',
        footer: 'marked-textarea-footer',
        touchAdd: 'marked-textarea-touch-add',
        pickerActive: 'marked-textarea-picker-active',
    };

    protected override options: MarkedTextAreaOptions = {};
    /** A text area's chrome pins to its first line, top right. */
    protected override readonly chromeAlign = 'start';

    private nativeTextarea!: HTMLTextAreaElement;
    private nativeEditor: ReturnType<typeof bindNativeTextEditor> | null = null;
    private restoreScanAriaInvalid: string | null | undefined;

    /** The component-owned editing surface. */
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
    /**
     * Native focus restoration cannot enter source whose store rendering is
     * pending.
     */
    private renderingEntrySeq: number | null = null;
    private applyingEntry: {
        entryId: string | undefined;
        owner: HTMLElement | undefined;
    } | null = null;
    private entryOrder: readonly string[] = [];
    private emptyEntries: Array<MarkingEntrySpan & { entryId: string }> = [];
    private applyingEntryState = false;
    /** The committed source geometry before a picker inserts or edits a mark. */
    private pickerCommittedState: {
        segments: MarkedSegment[];
        heldPortions: MarkedSegment[];
        emptyEntries: Array<MarkingEntrySpan & { entryId: string }>;
        entryOrder: readonly string[];
        lastSegmentedText: string;
        lastScannedText: string;
        lastMarkingStrings: string[];
        userEditPending: boolean;
        scanComplete: boolean;
        scanFailed: boolean;
    } | null = null;
    /** Only the latest store projection declined while its source is edited. */
    private pendingEntryStates: {
        entries: readonly { entryId: string; state: EzClassifyState }[];
        current: () => boolean;
    } | null = null;

    private activeRange: { start: number; end: number } | null = null;
    /**
     * Segment index the cursor was last inside: used to detect enter/leave
     * transitions.
     */
    private activeSegmentIndex = -1;
    private toolsButton: HTMLElement | null = null;

    protected override isFieldChrome(node: Node): boolean {
        return !!(
            (node === this.host && this.picker?.isToolsSuspended) ||
            statusMarkOwnsNode(this.toolsButton, node) ||
            this.fieldFavorites?.contains(node)
        );
    }

    /**
     * Caret position snapshotted on every focused selectionchange. The
     * favorites panel applies "stamp at caret" against THIS, not the live
     * `textarea.selectionStart`: Moving from the textarea into its tools blurs
     * the field, but the caret position the user meant to stamp at is the one
     * they left behind, not wherever the DOM selection happens to report once
     * focus has moved on.
     */
    private _lastCaret = 0;
    private readonly onBrandDown = (event: KeyboardEvent): void => {
        if (
            event.key !== 'ArrowDown' ||
            event.altKey ||
            event.ctrlKey ||
            event.metaKey ||
            event.shiftKey ||
            event.isComposing ||
            event.keyCode === 229 ||
            event.defaultPrevented ||
            event.target !== this.toolsButton
        )
            return;
        event.preventDefault();
        event.stopPropagation();
        if (this.picker) this.picker.focus();
        else
            this.focusAt(Math.min(this._lastCaret, this.textarea.value.length));
    };

    /**
     * Resolved in init(), after bindEngine(), from the options or the resolved
     * scan format. It stays an empty string until then; the constructor never
     * sets it.
     */
    private partOfId: string | undefined;
    /** Names a portion entry when the textarea has no id and no whole. */
    private readonly entryIdPrefix = 'para-';

    /**
     * Display-size observer; stored so destroy() can disconnect it. Without
     * that, repeated mount/unmount in SPA hosts accumulates live observers
     * holding detached DOM.
     */
    private _resizeObserver: ResizeObserver | null = null;

    /** Keep separate correction records for paragraphs with identical facts. */
    private readonly appliedFixHistories = new Map<string, AppliedFixHistory>();
    private pendingMarkReadings: {
        text: string;
        marks: PendingMarkReading[];
    } | null = null;

    /** Whether the Runtime read the whole text on the last scan. */
    private scanComplete = true;
    /** The completeness last reported to validity and the runtime. */
    private reportedScanComplete = true;
    /** A failed scan must be retried even if the text returns to an old value. */
    private scanFailed = false;
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
    private readonly textareaEvents = new AbortController();
    /**
     * True when the next scan follows a user edit. Externally supplied
     * replacements are read without rewriting them.
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

    /**
     * The caret's entry, or the entry still owned by the active Favorite
     * application.
     */
    private favoriteEntryId(): string | undefined {
        const owner = statusMarkFavoriteApplyOwner(this.toolsButton);
        return (
            this.segments[this.activeSegmentIndex]?.entryId ??
            (owner && owner === this.applyingEntry?.owner
                ? this.applyingEntry.entryId
                : undefined)
        );
    }

    async init(
        container: HTMLDivElement,
        engineOrContext?: ComponentEngineSource | null,
        options?: MarkedTextAreaOptions,
    ): Promise<void> {
        this.options = options ?? {};
        setMarkingEntry(this, {
            id: () => this.favoriteEntryId(),
            prepareApply: () => {
                const apply = {
                    entryId: this.favoriteEntryId(),
                    owner: statusMarkFavoriteApplyOwner(this.toolsButton),
                };
                this.applyingEntry = apply;
                // The store will project the selected entry back into its
                // existing source span. Its discarded picker must not write
                // the previous draft over that update.
                this.finishClose();
                this.activeRange = null;
                this.activeSegmentIndex = -1;
                return () => {
                    if (this.applyingEntry === apply) this.applyingEntry = null;
                };
            },
        });
        // `data-ezclassify-format` names the format the field reads its marks
        // in and writes each one back in; without it, the scheme's part
        // default.
        this.bindEngine(container, engineOrContext, options?.formatId);
        this.partOfId = options?.partOfId;

        this.injectStyle();

        this.host = this.resolveHost();
        const textarea = this.textarea;
        const native = this.nativeTextarea;
        this.styleNativeField(native);

        // Capture textarea styles BEFORE making it invisible
        const capturedStyles = this.captureAndMirrorStylesPreHide();

        this.wrap = document.createElement('div');
        this.wrap.className = this.classNames.wrap;
        native.parentNode?.insertBefore(this.wrap, native);
        this.wrap.append(native, textarea);
        this.nativeEditor = bindNativeTextEditor(native, textarea, {
            label: () => t('aria.markingInput'),
            onNativeInput: () => this.onTextareaInput(),
            onLocked: () => void this.closePicker(),
            onReset: () => {
                ++this.scanSeq;
                this.finishClose();
                this.setValue(native.value);
            },
            describe: () =>
                [
                    native.getAttribute('aria-describedby'),
                    this.scanValidity ? this.scanNotice?.id : undefined,
                ]
                    .filter(Boolean)
                    .join(' '),
        });

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
            if (!['color', 'backgroundColor', 'borderColor'].includes(p))
                (textarea.style as unknown as Record<string, string>)[p] =
                    capturedStyles[p];
        }
        if (native.style.height)
            this.display.style.height = native.style.height;
        if (native.style.minHeight)
            this.display.style.minHeight = native.style.minHeight;

        // Re-sync color/background when the host changes theme so the display
        // div matches the themed appearance in both light and dark modes.
        this.setMeasuredFontSize(capturedStyles.fontSize);
        this.installThemeObserver(
            capturedStyles,
            'marked-textarea-input',
            native,
        );

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

        // Keyboard hint + touch "Add marking" footer, and the inline chrome.
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
        // engine applies a fix), in the field's inline chrome.
        this.toolsButton = this.mountFieldTools(
            this.chrome.status,
            {
                correctionCategory: this.options.categoryId,
                onToolsOpen: () => {
                    if (document.activeElement === this.textarea)
                        this._lastCaret = this.textarea.selectionStart;
                    this.toolsButton?.focus();
                    this.picker?.suspendForTools();
                },
                root: this.container,
                shouldShowTooltip: () => this.shouldShowTooltip(),
                words: this.changeWords(),
            },
            () =>
                this.markedFavoritesHost({
                    describeTarget: () =>
                        this.activeSegmentIndex >= 0
                            ? t('favorites.editingMarking')
                                  .replace(
                                      '{n}',
                                      String(this.activeSegmentIndex + 1),
                                  )
                                  .replace(
                                      '{total}',
                                      String(this.segments.length),
                                  )
                            : t('favorites.insertParagraph'),
                    getCurrent: () => this.currentFavoritesMarking(),
                    onApply: (marking, signal) => {
                        const target = markingTarget(this);
                        return target && this.favoriteEntryId()
                            ? target.onApply(marking, signal)
                            : this.applyFavorite(marking, signal);
                    },
                    focusField: () =>
                        this.picker
                            ? this.picker.focus()
                            : this.textarea.focus(),
                }),
        );

        this.toolsButton?.addEventListener('keydown', this.onBrandDown, true);

        this.boundInput = () => this.onTextareaInput();
        this.boundKeydown = (e) => this.onKeydown(e);
        this.boundDocKeydown = (e) => this.onDocKeydown(e);
        this.boundDocClick = (e) => this.onDocClick(e);
        this.boundSelectionChange = () => this.onSelectionChange();
        this.listenToTextarea('input', this.boundInput);
        this.listenToTextarea('keydown', this.boundKeydown);
        this.listenToTextarea('focus', () => {
            this.hasFocus = true;
            this.renderDisplay();
            if (this.picker?.isToolsSuspended && !this.pressing) {
                const retained = this.picker;
                // A keyboard focus move can set the textarea caret in the
                // same turn. Let its existing entry-navigation logic choose
                // the target before resuming the held editor.
                queueMicrotask(() => {
                    if (
                        this.tornDown ||
                        this.picker !== retained ||
                        document.activeElement !== this.textarea ||
                        this.pressing
                    )
                        return;
                    this.onSelectionChange();
                    if (
                        this.picker === retained &&
                        retained.isToolsSuspended &&
                        this.activeSegmentIndex >= 0
                    )
                        retained.focus();
                });
            }
        });
        this.listenToTextarea('blur', () => {
            this.hasFocus = false;
            this.display.style.borderColor = capturedStyles.borderColor;
            if (!this.picker) this.renderDisplay();
            // Trigger sync on blur so deferred repairs (skipped while cursor was
            // inside a marking) get applied now that the user has moved away.
            // Skip sync when the picker is open: it manages content independently.
            // Sync runs after the picker closes via onPickerChange → syncFromTextarea.
            if (!this.picker) void this.syncFromTextarea();
        });
        // A plain click on a marking opens it with its list, caret at the
        // click. The release decides (see MarkedFieldBase.pressing): a drag or
        // a double-click is a text selection and opens nothing.
        this.watchPresses();
        this.listenToTextarea('mouseup', (event) => {
            if (event.button !== 0 || event.detail > 1) return;
            requestAnimationFrame(() => this.openFromClick());
        });
        this.listenToTextarea('scroll', () => {
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

        await this.syncFromTextarea(true);
    }

    /** Create the editor alongside the original form textarea. */
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
        this.nativeTextarea = textarea;
        const editor = textarea.ownerDocument.createElement('textarea');
        editor.className = textarea.className;
        editor.defaultValue = textarea.defaultValue;
        editor.value = textarea.value;
        editor.setSelectionRange(
            textarea.selectionStart,
            textarea.selectionEnd,
            textarea.selectionDirection,
        );
        return editor;
    }

    /**
     * Snapshot the textarea's layout styles. The base helper mirrors them onto
     * the display, but the textarea also copies height/minHeight separately in
     * init, so it only needs the captured map here (no display yet).
     */
    private captureAndMirrorStylesPreHide(): Record<string, string> {
        const csBeforeHide = window.getComputedStyle(this.nativeTextarea);
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
        this.setHostValue(value, false);
        void this.syncFromTextarea();
    }

    protected override setHostValue(value: string, notify = true): void {
        this.nativeTextarea.value = value;
        super.setHostValue(this.nativeTextarea.value, notify);
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
        if (this.tornDown || !current()) return false;
        if (this.picker) {
            ++this.entryWriteSeq;
            this.pendingEntryStates = { entries, current };
            return false;
        }
        if (
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
            this.nativeTextarea.setAttribute(
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
            this.nativeTextarea.setAttribute(
                'data-ezclassify-entry-conflict',
                'unresolved-source',
            );
            return false;
        }
        if (
            this.nativeTextarea.getAttribute(
                'data-ezclassify-entry-conflict',
            ) === 'unresolved-source'
        )
            this.nativeTextarea.removeAttribute(
                'data-ezclassify-entry-conflict',
            );
        const successfulReads = new Map<string, ProcessResult>();
        this.renderingEntrySeq = seq;
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
                        outputFormat: this.scanFormat,
                        context: this.options.resolveContext?.(),
                    };
                    const read = await Promise.resolve(
                        this.engine.process(state.assertions, options),
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
                    this.engine.render(state.assertions, this.scanFormat),
                );
                // A refused write is the engine's marker: the entry keeps
                // the marking it holds.
                if (renderViewRefused(result))
                    return { entryId, marking: previous?.marking ?? '' };
                return {
                    entryId,
                    marking: this.wrapRendered(result.rendered).trimEnd(),
                };
            }),
        ).finally(() => {
            if (this.renderingEntrySeq === seq) this.renderingEntrySeq = null;
        });
        if (
            this.picker &&
            !this.tornDown &&
            current() &&
            seq === this.entryWriteSeq
        ) {
            this.pendingEntryStates = { entries, current };
            return false;
        }
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
                        assessment: state.assessment,
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
        this.pruneFixHistories();
        for (const segment of this.segments) {
            if (segment.entryId && !segment.readFailure)
                this.appliedFixHistories
                    .get(segment.entryId)
                    ?.record(segment.assertions);
        }
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
        if (!this.picker) await this.settleClosedEditor();
    }

    private teardown(): void {
        this.tornDown = true;
        this.pickerCommittedState = null;
        this.pendingEntryStates = null;
        if (this.syncTimer) clearTimeout(this.syncTimer);
        this._resizeObserver?.disconnect();
        this._resizeObserver = null;
        this.disconnectThemeObserver();
        cleanupTooltipForRoot(this.container);
        this.destroyPicker();
        this.toolsButton?.removeEventListener(
            'keydown',
            this.onBrandDown,
            true,
        );
        this.destroyFieldTools();
        this.toolsButton = null;
        this.textareaEvents.abort();
        document.removeEventListener('keydown', this.boundDocKeydown, true);
        document.removeEventListener('mousedown', this.boundDocClick);
        this.unwatchPresses();
        document.removeEventListener(
            'selectionchange',
            this.boundSelectionChange,
        );
        for (const f of this.hiddenFields) f?.destroy();
        this.hiddenFields = [];
        this.hiddenContainers = [];
        this.restoreNativeScanAria();
        this.nativeEditor?.release();
        this.nativeEditor = null;
        const native = this.nativeTextarea;
        native.setSelectionRange(
            this.textarea.selectionStart,
            this.textarea.selectionEnd,
            this.textarea.selectionDirection,
        );
        // A host the page removed itself stays removed (see MarkingField).
        if (this.wrap.parentNode && native.parentNode === this.wrap)
            this.wrap.parentNode.insertBefore(native, this.wrap);
        this.wrap.remove();
        this.hiddenRoot.remove();
        // Last, so nothing above is skipped if the store refuses the call. The
        // restored textarea is no longer checked by this field: it keeps none
        // of this field's verdicts, and the rollups stop counting a field
        // that is gone.
        this.scanComplete = true;
        this.reportScanCompleteness();
    }

    private listenToTextarea<K extends keyof HTMLElementEventMap>(
        type: K,
        listener: (event: HTMLElementEventMap[K]) => void,
    ): void {
        this.textarea.addEventListener(type, listener, {
            signal: this.textareaEvents.signal,
        });
    }

    private onTextareaInput(): void {
        // Ignore the component's own setHostValue dispatch; the originating
        // code path already handles rendering and syncing.
        if (this._selfDispatch) return;
        // Keep the editor's facts only while this exact mark remains. Body
        // text may change during the scan that settles an earlier mark edit.
        this.retainPendingMarks(this.textarea.value);
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

    private async syncFromTextarea(initializing = false): Promise<void> {
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
        const pendingAtStart = this.pendingMarkReadings;
        // Empty text has no markings to read. Clear its published children even
        // when a remote adapter is unavailable, and invalidate the prior scan.
        if (!text) {
            this.segments = [];
            this.heldPortions = [];
            this.emptyEntries = [];
            this.lastMarkingStrings = [];
            this.lastSegmentedText = '';
            this.appliedFixHistories.clear();
            this.pendingMarkReadings = null;
            this.activeRange = null;
            this.activeSegmentIndex = -1;
            this.scanComplete = true;
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
            this.pendingMarkReadings === pendingAtStart &&
            this.textarea.value === text;
        let scanOutcome;
        try {
            scanOutcome = await Promise.resolve(
                this.engine.scan(text, {
                    outputFormat: this.scanFormat,
                }),
            );
        } catch (error) {
            if (this.tornDown) return;
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

        // The field shows the part marks the scan read: every wrapped marking it
        // returned, wherever it stands on its line. Wrapped text the scan could
        // not read is in `unread`, not here.
        const embedded = scanOutcome.results.filter((r) => r.wrapped);

        // Re-process only markings that changed since the last scan to get
        // repair results (autofixes, validation with context). Unchanged
        // markings reuse the scan result directly; no extra engine calls.
        // Read against a settled whole: when this edit also changed the whole,
        // reading now would compare the marks with whichever whole answered
        // first.
        await wholeSettled(this.nativeTextarea);
        if (!isCurrent()) return;
        const ctx = this.options.resolveContext?.();
        const prevMarkings = this.lastMarkingStrings;
        const saved = this.pendingMarksIn(text);
        const savedByStart = new Map(saved.map((mark) => [mark.start, mark]));
        const readingFor = (found: { start: number; marking: string }) => {
            const reading = savedByStart.get(found.start);
            return reading?.marking === found.marking ? reading : undefined;
        };
        const changedIndices: number[] = [];
        for (let i = 0; i < embedded.length; i++) {
            if (
                i >= prevMarkings.length ||
                embedded[i].marking !== prevMarkings[i] ||
                readingFor(embedded[i])
            ) {
                changedIndices.push(i);
            }
        }
        this.lastMarkingStrings = embedded.map((r) => r.marking);
        // The marks this user edit wrote. Only they may take the engine's safe
        // repairs: a fix rewrites the portion that was edited and no other, so
        // typing in one paragraph never rewrites the mark of another. The
        // initial scan also accepts safe, settled repairs to loaded marks.
        const edited = new Set(
            userInitiated
                ? editedMarkingIndices(
                      prevMarkings,
                      embedded.map((r) => r.marking),
                  )
                : [],
        );
        for (const index of changedIndices) {
            if (readingFor(embedded[index])) edited.add(index);
        }

        // Seed the editor's own span with the committed assertions. Another
        // paragraph with the same printed marking can hold different facts.
        const readMarking = (found: {
            start: number;
            marking: string;
            inner?: string;
        }) => {
            // Use saved assertions if they match this marking
            const assertions = readingFor(found)?.assertions;
            const stated = assertions?.length ? assertions : null;
            // The scan reports what is inside the wrapper; the wrapper shape
            // is the scheme's, so the field never strips it itself.
            const input = stated ? '' : found.inner;
            if (input === undefined) {
                throw new Error(
                    `The scan found ${found.marking} without the text inside its wrapper.`,
                );
            }
            const options = {
                outputFormat: this.scanFormat,
                // The engine takes a whole's values again from `ctx`.
                ...(stated
                    ? { assertions: withoutTakenFromWhole(stated) }
                    : {}),
                context: ctx,
            };
            return Promise.resolve(this.engine.process(input, options));
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
                        const result = await readMarking(embedded[idx]);
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
        const editsByStart = new Map<number, readonly Change[]>();
        this.segments = embedded.map((r, i) => {
            const nextStart = embedded[i + 1]?.start ?? text.length;
            const bodyText = text
                .slice(r.end, nextStart)
                .replace(/^\s+|\s+$/g, '');
            const processed = processedResults.get(i);
            const res = processed ?? r.result;
            // Only corrections that would change the field flag it; once one
            // does, every applied fix travels with the repair it records. A
            // mark this edit did not write keeps the flag it loaded with.
            const isEdited = edited.has(i);
            const corrections = isEdited
                ? []
                : fixesNeedingCorrection(
                      res.appliedFixes,
                      this.omittedFromFieldFormat(res),
                  );
            const initialRepair =
                initializing &&
                complete &&
                !!processed &&
                corrections.length > 0 &&
                res.valid &&
                res.recognition?.status === 'complete' &&
                !!res.rendered &&
                !renderViewRefused(res) &&
                this.canRepairAtCaret(r.start, r.end);
            const unappliedFixes = !initialRepair && corrections.length > 0;
            if (isEdited || initialRepair)
                editsByStart.set(r.start, res.appliedFixes);
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
                inner: r.inner,
                assertions: res.assertions,
                rendered: res.rendered,
                assessment: res.assessment,
                text: bodyText,
                valid: errors.length === 0,
                errors,
                warnings,
                validationErrors: res.errors,
                repaired:
                    initialRepair || (isEdited && res.appliedFixes.length > 0),
                pendingFixes: unappliedFixes ? res.appliedFixes : [],
                readFailure: failure,
                sourceUnresolved,
                preserveSource: failure !== undefined || sourceUnresolved,
            };
        });

        // Wrapped marks the scan could not read, such as "(junkxyz)", read like
        // a marking and carry none. Shown as plain prose they would be
        // invisible to validation and rollup, so each one that leads its
        // paragraph is shown as an invalid, assertion-free segment the picker
        // can open on for correction. The scan lists nothing past where it
        // stopped; the field-level error covers that text.
        const unrecognized = unreadSegments(scanOutcome.unread);
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
                `${this.nativeTextarea.id || this.partOfId || this.entryIdPrefix}-entry-${++this.hiddenGeneration}`,
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
        // An edit that extends the end of a mark and also changes its body
        // can replace the store span. Its unchanged start still anchors the
        // local correction record. The history drops any fixes whose marking
        // was substantively replaced when it reconciles the Runtime's facts.
        const { prefix } = textEdit(previousSegmentedText, text);
        const editedMark = previousSegments.find(
            (mark) => mark.start < prefix && prefix < mark.end,
        );
        if (editedMark?.entryId && !ids.includes(editedMark.entryId)) {
            const successor = owned.find(
                (mark) => mark.start === editedMark.start && prefix < mark.end,
            );
            const history = this.appliedFixHistories.get(editedMark.entryId);
            if (
                successor?.entryId &&
                history &&
                !previousSegments.some(
                    (mark) => mark.entryId === successor.entryId,
                )
            )
                this.appliedFixHistories.set(successor.entryId, history);
        }

        // A kept segment past a partial scan's cut has no new reading.
        // Leave its pending result staged until the Runtime actually reads it.
        const processedStarts = new Set(
            [...processedResults.keys()].map((index) => embedded[index].start),
        );
        for (const segment of owned) {
            const reading = readingFor(segment);
            if (reading && processedStarts.has(segment.start))
                this.recordMarkChanges(
                    segment.entryId!,
                    reading.assertions,
                    reading.changes,
                );
            if (!segment.readFailure) {
                this.recordMarkChanges(
                    segment.entryId!,
                    segment.assertions,
                    editsByStart.get(segment.start),
                );
            }
        }
        this.retainPendingMarks(
            text,
            saved.filter((mark) => !processedStarts.has(mark.start)),
        );
        this.pruneFixHistories();
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
        const repaired =
            (initializing || userInitiated) && (await this.applyRepairs());
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
    private stageMarkReading(
        start: number,
        marking: string,
        assertions: Assertion[],
        changes: readonly Change[],
    ): void {
        const text = this.textarea.value;
        const marks = this.pendingMarksIn(text).filter(
            (mark) => mark.start !== start,
        );
        if (marking && text.startsWith(marking, start))
            marks.push({ start, marking, assertions, changes });
        this.retainPendingMarks(text, marks);
    }

    private retainPendingMarks(
        text: string,
        marks = this.pendingMarksIn(text),
    ): void {
        const current = this.pendingMarkReadings;
        if (text === current?.text && marks === current.marks) return;
        this.pendingMarkReadings = marks.length ? { text, marks } : null;
    }

    private pendingMarksIn(text: string): PendingMarkReading[] {
        const pending = this.pendingMarkReadings;
        if (!pending) return [];
        if (text === pending.text) return pending.marks;
        const byStart = new Map(
            pending.marks.map((mark) => [String(mark.start), mark]),
        );
        return rebaseEntrySpans(
            pending.text,
            pending.marks.map((mark) => ({
                entryId: String(mark.start),
                start: mark.start,
                end: mark.start + mark.marking.length,
            })),
            text,
        ).flatMap((span) => {
            const mark = byStart.get(span.entryId!);
            return mark && text.slice(span.start, span.end) === mark.marking
                ? [{ ...mark, start: span.start }]
                : [];
        });
    }

    private recordMarkChanges(
        entryId: string,
        held: readonly Assertion[],
        changes?: readonly Change[],
    ): void {
        let history = this.appliedFixHistories.get(entryId);
        if (!history && changes?.length) {
            history = new AppliedFixHistory();
            this.appliedFixHistories.set(entryId, history);
        }
        history?.record(held, changes);
    }

    private pruneFixHistories(): void {
        const owned = new Set(
            this.committedPortions().map((segment) => segment.entryId),
        );
        for (const entryId of this.appliedFixHistories.keys()) {
            if (!owned.has(entryId)) this.appliedFixHistories.delete(entryId);
        }
    }

    /** Each marking in the field, in the format the field writes it in. */
    protected override markForms(): ShownForm[] {
        return this.segments.map((segment) => ({
            formatId: this.scanFormat,
            assessment: segment.assessment,
        }));
    }

    /**
     * Reflect the applied-fix record, and whether the last scan read the whole
     * text, on the field's single status mark.
     */
    private updateStatusMark(): void {
        setStatusMarkGroups(this.chrome.status, this.markGroups());
        setStatusMarkError(
            this.chrome.status,
            this.scanComplete ? null : t('mark.scanIncomplete'),
        );
    }

    /** Each marking in text order, with the changes recorded for its entry. */
    private markGroups(): StatusMarkGroup[] {
        return this.segments
            .filter((segment) => segment.entryId && segment.assertions.length)
            .map((segment) => ({
                entryId: segment.entryId!,
                marking: segment.marking.trim(),
                changes: this.textStatusChanges(
                    this.appliedFixHistories.get(segment.entryId!)?.values() ??
                        [],
                    segment.assertions,
                ),
            }));
    }

    /**
     * Carry a change in scan completeness to the textarea's native validity and
     * to the runtime, which flags the field's rollups. An incomplete scan makes
     * the textarea invalid until a complete one clears it; a message the host
     * set itself is left alone.
     */
    private reportScanCompleteness(): void {
        if (this.scanComplete === this.reportedScanComplete) return;
        this.reportedScanComplete = this.scanComplete;
        this.showScanNotice(!this.scanComplete);
        this.options.onScanCompleteness?.(this.scanComplete);
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
            if (this.restoreScanAriaInvalid === undefined)
                this.restoreScanAriaInvalid =
                    this.nativeTextarea.getAttribute('aria-invalid');
            this.nativeTextarea.setAttribute('aria-invalid', 'true');
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
            this.restoreNativeScanAria();
            this.scanNotice.hidden = true;
            this.scanAnnouncer.textContent = '';
        }
        if (describedBy.length > 0)
            this.textarea.setAttribute(
                'aria-describedby',
                describedBy.join(' '),
            );
        else this.textarea.removeAttribute('aria-describedby');
        this.nativeEditor?.syncValidity();
    }

    private restoreNativeScanAria(): void {
        if (this.restoreScanAriaInvalid === undefined) return;
        if (this.restoreScanAriaInvalid === null)
            this.nativeTextarea.removeAttribute('aria-invalid');
        else
            this.nativeTextarea.setAttribute(
                'aria-invalid',
                this.restoreScanAriaInvalid,
            );
        this.restoreScanAriaInvalid = undefined;
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

    private canRepairAtCaret(
        start: number,
        end: number,
        caret = this.textarea.selectionStart,
    ): boolean {
        return !this.hasFocus || caret <= start || caret >= end;
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
        const safeSegments = this.segments.filter((seg) =>
            this.canRepairAtCaret(seg.start, seg.end, cursorPos),
        );

        const template = this.template;
        const result = applyRepairsLogic(
            safeSegments,
            this.textarea.value,
            template,
            this.embeddedStyle?.pattern,
            cursorPos,
        );

        if (result.patched) {
            // These are known disjoint edits. Keep each entry's identity even
            // when a single prefix/suffix diff would treat the intervening
            // paragraphs as one replacement.
            let patchIndex = 0;
            let drift = 0;
            const spans = [
                ...this.segments,
                ...this.heldPortions,
                ...this.emptyEntries,
            ].sort((left, right) => left.start - right.start);
            for (const span of spans) {
                while (result.patches[patchIndex]?.end <= span.start)
                    drift += result.patches[patchIndex++].change;
                const patch = result.patches[patchIndex];
                const endChange =
                    patch?.start === span.start && patch.end === span.end
                        ? patch.change
                        : 0;
                span.start += drift;
                span.end += drift + endChange;
            }
            this.lastSegmentedText = result.value;
            // Auto-repair changes the field value: hosts observing ordinary
            // input events must see it (Host Form Contract).
            this.setHostValue(result.value);
            this.textarea.setSelectionRange(result.caret, result.caret);
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
            // A held press leaves the move to its release (openFromClick).
            if (
                !hasSelection &&
                segmentsFresh &&
                !this.pressing &&
                (this.picker ||
                    (this.applyingEntry === null &&
                        this.renderingEntrySeq === null))
            ) {
                const segIdx = this.segments.findIndex(
                    (s) => cursorPos > s.start && cursorPos < s.end,
                );
                if (segIdx !== this.activeSegmentIndex) {
                    if (this.activeSegmentIndex >= 0 && this.picker) {
                        this.moveEditorTo(segIdx, false);
                        return;
                    }
                    this.activeSegmentIndex = segIdx;
                    if (segIdx >= 0 && !closeCooldown) {
                        const seg = this.segments[segIdx];
                        void this.openPicker(seg.start, seg.end, false);
                    }
                }
            }
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

        // Repainting the marking chips can dismiss their old hover, but the
        // tools dialog is anchored to the persistent button outside the display.
        if (this.toolsButton?.getAttribute('aria-expanded') !== 'true')
            hideTooltip(this.container);
        this.clearSegmentHover();
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
            chip.dataset.start = String(seg.start);
            chip.dataset.end = String(seg.end);
            const attention = this.attachSegmentFeedback(
                chip,
                'marked-textarea-chip',
                seg,
                (event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    this.textarea.setSelectionRange(
                        seg.start + 1,
                        seg.start + 1,
                    );
                    this.activeSegmentIndex = this.segments.indexOf(seg);
                    void this.openPicker(seg.start, seg.end);
                },
            );

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
                this.paintSegmentConceptHints(
                    chip,
                    chipText,
                    seg.assertions,
                    seg.assessment,
                );
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
                const { open, close } = this.delimiters;
                editorChip.appendChild(document.createTextNode(open));
                if (this.pickerMount) {
                    editorChip.appendChild(this.pickerMount);
                }
                editorChip.appendChild(this.picker.closeDelimiter(close));
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
    }

    private syncHiddenFields(): void {
        const previous = new Map(
            this.hiddenContainers.map((box, index) => [
                box.id,
                { box, field: this.hiddenFields[index] },
            ]),
        );
        const portions = this.committedPortions();
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
                box.setAttribute('data-ezclassify-format', this.scanFormat);
                box.id = seg.entryId;
                box.setAttribute('data-ezclassify-marking', '');
                if (this.partOfId)
                    box.setAttribute('data-ezclassify-part-of', this.partOfId);
                box.setAttribute('data-marked-textarea-field', '');
                if (this.options.entryStoreManaged)
                    box.setAttribute('data-marked-textarea-entry-managed', '');
                this.hiddenRoot.appendChild(box);
            }
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
        this.nativeTextarea.dispatchEvent(
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
        this.nativeTextarea.dispatchEvent(
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

    /** Capture source and ownership together, before any provisional edit. */
    private capturePickerCancelState(): void {
        if (this._pickerCancelSnapshot) return;
        this._pickerCancelSnapshot = {
            value: this.textarea.value,
            caret: this.textarea.selectionStart,
        };
        const copy = (segments: readonly MarkedSegment[]) =>
            segments.map((segment) => ({
                ...segment,
                assertions: segment.assertions.map((assertion) => ({
                    ...assertion,
                })),
            }));
        this.pickerCommittedState = {
            segments: copy(this.segments),
            heldPortions: copy(this.heldPortions),
            emptyEntries: this.emptyEntries.map((span) => ({ ...span })),
            entryOrder: [...this.entryOrder],
            lastSegmentedText: this.lastSegmentedText,
            lastScannedText:
                this.lastScannedText === this.lastSegmentedText
                    ? this.lastScannedText
                    : '',
            lastMarkingStrings: [...this.lastMarkingStrings],
            userEditPending: this.userEditPending,
            scanComplete: this.scanComplete,
            scanFailed: this.scanFailed,
        };
        // A read started before the edit must not land over its snapshot.
        ++this.scanSeq;
    }

    /**
     * Open the inline editor on the marking at `[start, end)`.
     *
     * @param openList - False when the keyboard moving the caret into the
     *   marking opened the editor: that is not a request for suggestions.
     * @param caret - Where the caret lands in the editor's text (a click's
     *   offset); the end of the text when omitted.
     */
    private async openPicker(
        start: number,
        end: number,
        openList = true,
        caret?: number,
    ): Promise<void> {
        if (this.tornDown || !this.wrap.isConnected) return;
        this.destroyPicker();
        // Escape cancels the edit. The Ctrl+Enter path snapshots before its
        // template insertion; the click/caret-driven opens snapshot here.
        this.capturePickerCancelState();
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

        // Find the segment's existing assertions so the editor can seed from
        // them instead of re-parsing the rendered text. This is critical for
        // marking formats the engine can't round-trip (e.g. joint markings).
        const seg = this.segments.find(
            (s) => s.start === start && s.end === end,
        );
        const existingAssertions = seg?.assertions;
        // A mark the scan read opens on the text the scan found inside its
        // wrapper. Only text the scan did not read is unwrapped here.
        const scanned = seg?.marking === raw ? seg.inner : undefined;
        const inner = draft ? '' : (scanned ?? this.extractInner(raw));

        await this.mountPicker(
            inner,
            'marked-textarea-picker-mount',
            {
                assertions: existingAssertions,
                draft,
                openList,
                caret,
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
                        await this.settleClosedEditor();
                        this.revealCaret();
                    });
                },
                // Up and Down with the list closed move lines in the text, as
                // they do everywhere else in it: the caret goes back to the
                // same place in the textarea and the browser moves it a line.
                onLineMove: (_direction, caretInMark) => {
                    const range = this.activeRange;
                    if (!range) return;
                    const pos = Math.min(
                        range.start + this.delimiters.open.length + caretInMark,
                        Math.max(range.start, range.end - 1),
                    );
                    this.textarea.focus();
                    this.textarea.setSelectionRange(pos, pos);
                },
                sheetTools: () => this.toolsButton,
                // Which paragraph's mark this is, ahead of the field's own
                // label, so the sheet's title says it even when it has to
                // truncate.
                label: () => {
                    const field = accessibleLabel(
                        this.nativeTextarea,
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
            },
            () => {
                this._explicitClose = true;
                void this.closePicker().then(() => this.afterClose());
            },
        );
    }

    /**
     * The release of a plain click in the text. A click inside a marking opens
     * it with its list, the caret where the click landed; a click anywhere else
     * leaves the marking that was open, as a keyboard move would.
     */
    private openFromClick(): void {
        if (this.tornDown || !this.hasFocus) return;
        const pos = this.textarea.selectionStart;
        if (pos !== this.textarea.selectionEnd) return;
        // Offsets from a scan that lags the text would point at the wrong
        // characters (see onSelectionChange).
        if (this.textarea.value !== this.lastSegmentedText) return;
        const segIdx = this.segments.findIndex(
            (s) => pos > s.start && pos < s.end,
        );
        const seg = segIdx >= 0 ? this.segments[segIdx] : undefined;
        const caret = seg
            ? pos - seg.start - this.delimiters.open.length
            : undefined;
        if (segIdx === this.activeSegmentIndex && seg && this.picker) {
            this.picker.showList(caret);
            return;
        }
        if (this.activeSegmentIndex >= 0 && this.picker) {
            this.moveEditorTo(segIdx, true, caret);
            return;
        }
        this.activeSegmentIndex = segIdx;
        if (seg) void this.openPicker(seg.start, seg.end, true, caret);
    }

    /**
     * Close the open editor and, when `segIdx` names a marking, open that one.
     *
     * @param segIdx - The marking to open next, or -1 for none
     * @param openList - Whether the next editor opens with its list
     * @param caret - Where the caret lands in the next editor's text
     */
    private moveEditorTo(
        segIdx: number,
        openList: boolean,
        caret?: number,
    ): void {
        const target = this.segments[segIdx];
        const intended = target ? { ...target } : undefined;
        const entryId = intended?.entryId;
        const source = this.textarea.value;
        this._explicitClose = true;
        this.activeSegmentIndex = -1;
        void this.closePicker().then(async () => {
            await this.settleClosedEditor();
            if (intended && this.hasFocus && !this.picker) {
                const edit = entryId
                    ? null
                    : textEdit(source, this.textarea.value);
                const span = edit
                    ? {
                          start: rebaseOffset(edit, intended.start),
                          end: rebaseOffset(edit, intended.end),
                      }
                    : null;
                const index = this.segments.findIndex((segment) =>
                    entryId
                        ? segment.entryId === entryId
                        : span &&
                          segment.start === span.start &&
                          segment.end === span.end &&
                          segment.marking === intended.marking,
                );
                const next = this.segments[index];
                if (next) {
                    this.activeSegmentIndex = index;
                    await this.openPicker(
                        next.start,
                        next.end,
                        openList,
                        caret,
                    );
                }
            }
        });
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
            this.lastSegmentedText = next;
            this.segments[segIdx] = {
                ...this.segments[segIdx],
                end: newEnd,
                marking: insert,
                rendered,
                assertions: this.picker.getAssertions(),
                // Read again once the edit lands.
                assessment: undefined,
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
            if (!(await this.commitPicker())) return;
        }

        let changes = this.picker?.getAppliedFixes() ?? [];
        const reading =
            this.picker && this.activeRange
                ? this.pickerReading(this.picker)
                : null;

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
                loadedSegment?.inner !== undefined &&
                editorContent === loadedSegment.inner.trim()
            ) {
                const repaired = applyRepairsLogic(
                    [{ ...loadedSegment, repaired: true }],
                    this._pickerCancelSnapshot?.value ?? this.textarea.value,
                    this.template,
                    this.embeddedStyle?.pattern,
                );
                if (repaired.patched) {
                    this.setHostValue(repaired.value);
                    changes = [...changes, ...loadedSegment.pendingFixes!];
                    if (reading)
                        reading.marking = this.wrapRendered(
                            loadedSegment.rendered,
                        ).trimEnd();
                    this.lastScannedText = '';
                }
            }
        }
        if (reading && this.activeRange)
            this.stageMarkReading(
                this.activeRange.start,
                reading.marking,
                reading.assertions,
                changes,
            );
        if (this.picker && !skipRender) {
            // Opening a marking and leaving its editor is an edit transaction,
            // even when the author did not type. Preserve loaded text at rest,
            // but on commit re-run the engine from the editor assertions so
            // safe fixes are applied consistently on click-out/blur.
            this.userEditPending = true;
            this.lastScannedText = '';
        }
        this.activeRange = null;
        this.activeSegmentIndex = -1;
        this.finishClose();
        // Re-render to swap the inline editor back to a static chip,
        // unless the caller will trigger a sync that handles rendering
        if (!skipRender) this.renderDisplay();
    }

    /** The caret segment remains the target while its tools hold focus. */
    private currentFavoritesMarking(): { rendered: string; valid: boolean } {
        const segment = this.segments[this.activeSegmentIndex];
        return segment
            ? {
                  rendered: segment.rendered,
                  valid: segment.valid && !!segment.rendered,
              }
            : { rendered: '', valid: false };
    }

    /**
     * Where a brand-new marked line should start, given a raw caret position. A
     * new part mark leads the paragraph it marks, so a caret sitting inside a
     * line that's already marked can't start the new mark in place; it has to
     * start a new line. Snapping that new line's start to the END of the
     * current line (rather than the raw caret) keeps whatever text is already
     * on that line intact instead of splitting it mid-word. Shared by the
     * favorites stamp path and the Ctrl+Enter template-insert path; both walk
     * the same line/segment geometry to decide it.
     */
    private newMarkedLineInsertion(caret: number): {
        insertAt: number;
        prefix: string;
    } {
        const v = this.textarea.value;
        // A caret snapshot taken before a host-driven value replacement (the
        // Tab-to-tools path snapshots on blur) can be stale by the time it's
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
    private async applyFavorite(
        marking: string,
        signal?: AbortSignal,
    ): Promise<void> {
        const result = await this.readForFavorites(marking);
        if (signal?.aborted) return;
        const rendered = result.rendered.trim();
        const wrapped = this.wrapRendered(rendered);

        // A recent close can deliberately hold the editor closed while the
        // caret already targets another marking. That marking remains the
        // replacement target shown by Favorites, even without an open picker.
        const range =
            this.activeRange ??
            (this.textarea.value === this.lastSegmentedText
                ? this.segments[this.activeSegmentIndex]
                : undefined);
        if (range) {
            // Replacing an existing segment's span excludes the template's
            // trailing separator (the span ends at the marking's own close
            // delimiter, not past it), so the replacement text must not
            // carry one either, so trimming here is correct, not an oversight.
            const insert = wrapped.trimEnd();
            const { start, end } = range;
            const v = this.textarea.value;
            this.setHostValue(v.slice(0, start) + insert + v.slice(end));
            this.lastScannedText = '';
            this.stageMarkReading(
                start,
                insert,
                result.assertions,
                result.appliedFixes,
            );
            // Tear the picker down WITHOUT its normal "write picker content
            // back" step (closePicker's non-skipRender path): the line above
            // already wrote the correct, final content, and re-reading the
            // (untouched) picker's own input would clobber it.
            this.finishClose();
            this.activeRange = null;
            this.activeSegmentIndex = -1;
            this.focusAt(start + insert.length);
            void this.settleClosedEditor().then(() => this.revealCaret());
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
        this.stageMarkReading(
            insertAt + prefix.length,
            insert.trimEnd(),
            result.assertions,
            result.appliedFixes,
        );
        const caretAfter = insertAt + inserted.length;
        this.focusAt(caretAfter);
        this._lastCaret = caretAfter;
        void this.settleClosedEditor().then(() => this.revealCaret());
    }

    private onKeydown(e: KeyboardEvent): void {
        if (this.picker && e.key === 'Escape') {
            e.preventDefault();
            this.escapeClosePicker();
            return;
        }

        // Ctrl+Enter (Win/Linux) or Cmd+Enter (Mac): open picker
        if (
            !this.picker &&
            !e.shiftKey &&
            e.key === 'Enter' &&
            (e.ctrlKey || e.metaKey)
        ) {
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

            // A selection is text the user means as the marking: it moves
            // into the new mark as the editor's draft and is read there,
            // instead of an empty mark landing in front of it. One line only;
            // a marking is never multi-line.
            let draft = '';
            if (selStart !== selEnd) {
                const selected = this.textarea.value.slice(selStart, selEnd);
                if (/[\r\n]/.test(selected) || !selected.trim()) return;
                this.capturePickerCancelState();
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
            this.capturePickerCancelState();
            const caret = selStart;

            const v = this.textarea.value;
            const { open: openDelim, close: closeDelim } = this.delimiters;

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
                const insert = this.template.replace('{marking}', draft);
                this._pickerDraft = draft || undefined;
                // A new part mark leads the paragraph it marks, so insert it
                // at the start of the caret's line rather than mid-line. When the line already begins with a
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
        // The permanent field box or a newer outside control can already own
        // focus when an asynchronous sheet commit finishes.
        if (active === this.textarea) this.textarea.blur();
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
        void this.settleClosedEditor();
    }

    /**
     * All ended edits settle source once, then retry a still-current store
     * view.
     */
    private async settleClosedEditor(): Promise<void> {
        const pending = this.pendingEntryStates;
        this.pendingEntryStates = null;
        this.pickerCommittedState = null;
        await this.syncFromTextarea();
        if (pending?.current() && !this.tornDown) {
            try {
                await this.applyEntryStates(pending.entries, pending.current);
            } catch (error) {
                this.nativeTextarea.dispatchEvent(
                    new CustomEvent('ezclassify:entry-error', {
                        bubbles: true,
                        detail: { error },
                    }),
                );
            }
        }
    }

    /** Restore the committed ownership baseline, never provisional positions. */
    protected afterCancel(_valueRestored: boolean): void {
        this.activeRange = null;
        this.activeSegmentIndex = -1;
        const state = this.pickerCommittedState;
        this.pickerCommittedState = null;
        if (state) {
            ++this.scanSeq;
            this.segments = state.segments;
            this.heldPortions = state.heldPortions;
            this.emptyEntries = state.emptyEntries;
            this.entryOrder = state.entryOrder;
            this.lastSegmentedText = state.lastSegmentedText;
            this.lastScannedText = state.lastScannedText;
            this.lastMarkingStrings = state.lastMarkingStrings;
            this.userEditPending = state.userEditPending;
            this.scanComplete = state.scanComplete;
            this.scanFailed = state.scanFailed;
        }
        this.renderDisplay();
    }
}
