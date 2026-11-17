/**
 * InlineMarkingEditor: the inline editor MarkedInput and MarkedTextArea open
 * inside a marking's delimiters.
 *
 * It looks like the surrounding text (no chips, no pills) and is the shared
 * composer's input (see `composer/composer-controller.ts`): typing reads the
 * whole marking on every keystroke, the result row shows what will be stored,
 * and Enter, Tab, click and tap follow the same commit table as every other
 * field. The host field sees a change only when the composer commits.
 *
 * The editor's mount sits inline in the host field's display layer. The host
 * keeps that layer hidden from assistive technology except for the path to this
 * editor (see MarkedFieldBase.exposePickerInDisplay), and the editor's live
 * region and invalid-draft note mount outside it, beside the field.
 *
 * Engine auto-fixes applied on commit are accumulated for the host, whose
 * single status mark communicates them (the Enhancement Status Indicator
 * contract allows one mark per field).
 *
 * Lifecycle: created when the user opens a marking, destroyed when the host
 * closes it.
 */
import type {
    Assertion,
    Change,
    ProcessResult,
    ProcessingContext,
    Suggestion,
} from '@ezclassify/types';
import type { ProcessOptions, SuggestOptions } from '../adapter-options';
import type {
    ComponentEngineSource,
    ComponentSchemeEngine,
} from './component-base-readonly';
import {
    isComponentContextAdapter,
    partsOption,
} from './component-base-readonly';
import inlineEditorCss from './inline-marking-editor.css?inline';
import { COMPONENT_CSS } from './component-utils';
import { adoptStylesOnce } from '../styles/adopt';
import {
    assertDescribesConcepts,
    createConceptDescriber,
} from './concept-description';
import { recordAppliedFixes } from './status-mark';
import { createComposerPort } from './composer/composer-port';
import { withoutTakenFromWhole } from '../assertion-identity';
import { renderViewRefused } from '../render-refusal';
import {
    coveredCategoriesOf,
    suggestionSurfaces,
    type SuggestionSurface,
} from '../format-resolver';
import { t } from '../i18n';
import {
    ComposerController,
    statedAssertions,
    type CommitOutcome,
    type ComposerCommit,
    type ComposerPort,
    type ComposerReading,
} from './composer/composer-controller';
import { ComposerView, accessibleLabel } from './composer/composer-view';

/** Options for the inline marking editor. */
export interface InlineMarkingEditorOptions {
    formatId: string;
    /** The host field's one scope, as its surface (see `ComponentOptions`). */
    scope?: string;
    /** The scope ids the host field lists (see `ComponentOptions`). */
    scopes?: readonly string[];
    /** The current whole, resolved again when the host marking changes. */
    resolveContext?: () => ProcessingContext | undefined;
    /** See `ComponentOptions.resolveParts`: the whole's parts, at call time. */
    resolveParts?: () => readonly string[];
    /** A commit stored a new value. */
    onChange?: (rendered: string, assertions: Assertion[]) => void;
    /**
     * The user asked to leave the editor with a committed value: Enter or a
     * click on the result row committed, or Left/Right left the marking.
     * `fromSheet` is true when the commit closed the phone sheet: the host then
     * leaves focus off its text, which would bring the keyboard back.
     */
    onExit?: (
        direction: 'left' | 'right' | 'commit',
        fromSheet?: boolean,
    ) => void;
    /**
     * Focus left the editor and the composer committed; the host closes the
     * editor unless the outcome is 'invalid', which keeps the draft on screen.
     */
    onBlurCommit?: (outcome: CommitOutcome) => void;
    /**
     * Escape with nothing left for the composer to do (list closed, draft
     * clean): the host cancels the editing session.
     */
    onCancel?: () => void;
    /** The host field's own container, where the live region and note mount. */
    root?: HTMLElement;
    /** See `ComposerViewOptions.isFieldChrome`. */
    isFieldChrome?: (node: Node) => boolean;
    /** Keep the host's control reachable in the phone sheet. */
    sheetTools?: () => HTMLElement | null;
    /** The host field's accessible name, for the combobox and listbox. */
    label?: () => { id?: string; text: string };
    /**
     * Pre-existing assertions to seed the editor with instead of re-parsing
     * initialValue.
     */
    assertions?: Assertion[];
    /**
     * Open the list as the editor opens (default: a click on the marking).
     * False for an editor opened because the keyboard moved the caret into a
     * marking: moving the caret is not a request for suggestions. The list then
     * opens on typing, a click on the marking or its chevron, or
     * Ctrl/Cmd+Enter, and on Down only when the host takes no Up and Down for
     * its own lines (see `onLineMove`).
     */
    openList?: boolean;
    /**
     * Where the caret lands in the editor's text as it opens: the offset a
     * click on the marking pointed at. Defaults to the end of the text.
     */
    caret?: number;
    /**
     * Up or Down while the list is closed, for a host whose text has lines.
     * Called inside the key event, before the browser moves the caret: the host
     * must put focus and caret into its own text at once, at the offset that
     * matches `caret` in the editor's text, so the browser moves the caret a
     * line there. The editor commits on the blur that follows, the same as any
     * other move out of it. Without it, Down opens the list.
     */
    onLineMove?: (direction: 'up' | 'down', caret: number) => void;
    /**
     * Text the user already typed as this marking, not yet committed (typed
     * text moved into a new mark). It opens as a dirty draft over an empty
     * committed value, so the result row reads it and Enter stores it.
     */
    draft?: string;
    /** False disables the active row's definition line. */
    tooltips?: boolean;
    /** Concept view property to use for row detail. */
    tooltipConceptProperty?: string;
}

/** Inline marking editor: an input plus the shared composer. */
export class InlineMarkingEditor {
    private engine!: ComponentSchemeEngine;
    private container!: HTMLDivElement;
    private input!: HTMLInputElement;
    private sizer!: HTMLSpanElement;
    private chevron!: HTMLButtonElement;
    /**
     * The box the chevron centers on: an invisible copy of the closing
     * delimiter the host draws after the mount, so the chevron stands on the
     * delimiter's whole width whatever the template writes (see closeDelimiter
     * and inline-marking-editor.css).
     */
    private chevronAnchor!: HTMLSpanElement;
    private chevronAnchorText!: Text;
    private unsubscribeChevron: (() => void) | null = null;
    private options!: InlineMarkingEditorOptions;
    private assertions: Assertion[] = [];
    private rendered = '';
    private destroyed = false;
    private controller!: ComposerController;
    private view!: ComposerView;
    /** Fixes the engine applied during this session, deduplicated by rule. */
    private _appliedFixes = new Map<string, Change>();
    private readonly _conceptDescriber = createConceptDescriber({
        engine: () => this.engine,
        options: () => this.options,
    });

    async init(
        container: HTMLDivElement,
        engineOrContext: ComponentEngineSource,
        initialValue: string,
        options: InlineMarkingEditorOptions,
    ): Promise<void> {
        this.engine = isComponentContextAdapter(engineOrContext)
            ? engineOrContext.scheme
            : engineOrContext;
        assertDescribesConcepts(this.engine, 'InlineMarkingEditor');
        this.container = container;
        this.options = options;

        adoptStylesOnce(inlineEditorCss, options.root ?? container);

        const wrap = document.createElement('div');
        wrap.className = 'inline-editor-wrap';
        container.appendChild(wrap);

        // Hidden sizer span: mirrors input content to auto-size the input.
        this.sizer = document.createElement('span');
        this.sizer.className = 'inline-editor-sizer';
        this.sizer.setAttribute('aria-hidden', 'true');
        wrap.appendChild(this.sizer);

        this.input = document.createElement('input');
        this.input.type = 'text';
        this.input.className = 'inline-editor-input';
        this.input.value = initialValue;
        this.input.setAttribute('autocomplete', 'off');
        this.input.setAttribute('spellcheck', 'false');
        // A press inside the editor is caret navigation, never an outside
        // click for the host. Stop only propagation so the browser still
        // places the caret.
        this.input.addEventListener('mousedown', (event) => {
            event.stopPropagation();
        });
        this.input.addEventListener('keydown', (e) => this.onKeydown(e));
        // A plain click on the marking asks for its list. The second press of
        // a double-click, or a press that ends a drag, is selecting text.
        this.input.addEventListener('click', (event) => {
            if (event.detail !== 1) return;
            if (this.input.selectionStart !== this.input.selectionEnd) return;
            void this.view?.open('pointer');
        });
        wrap.appendChild(this.input);
        this.chevronAnchor = document.createElement('span');
        this.chevronAnchor.className =
            'inline-editor-chevron-anchor inline-editor-chevron-anchor--bare';
        this.chevronAnchorText = document.createTextNode('');
        this.chevron = this.createChevron();
        this.chevronAnchor.append(this.chevronAnchorText, this.chevron);
        wrap.appendChild(this.chevronAnchor);
        this.autoSizeInput();

        // Seed without normalizing the visible text: a loaded marking stays
        // byte-for-byte on screen until the user commits.
        if (options.assertions && options.assertions.length > 0) {
            const result = await this.process('', options.assertions);
            this.assertions = result.assertions;
            this.rendered = initialValue;
        } else if (initialValue.trim()) {
            const result = await this.process(initialValue);
            this.assertions = result.assertions;
            this.rendered = initialValue;
        }
        if (this.destroyed) return;

        this.controller = new ComposerController({
            port: this.port(),
            shape: 'whole',
            announce: (text) => this.view?.announce(text),
        });
        const root = options.root ?? container;
        this.view = new ComposerView({
            controller: this.controller,
            input: this.input,
            anchor: container,
            bounds: root,
            field: root,
            label:
                options.label ??
                (() => accessibleLabel(this.input, t('aria.markingInput'))),
            css: COMPONENT_CSS + inlineEditorCss,
            singleLine: true,
            describeConcept: this._conceptDescriber.enabled()
                ? (conceptId, categoryId) =>
                      this._conceptDescriber.resolve(conceptId, categoryId)
                : undefined,
            onDraft: () => this.autoSizeInput(),
            onBlurCommit: (outcome) => this.options.onBlurCommit?.(outcome),
            onEnterCommit: (_outcome, fromSheet) =>
                this.options.onExit?.('commit', fromSheet),
            isFieldChrome: options.isFieldChrome,
            sheetTools: options.sheetTools,
            onEscapeIdle: () => {
                this.options.onCancel?.();
                return true;
            },
            onLineMove: options.onLineMove
                ? (direction) => {
                      options.onLineMove?.(
                          direction,
                          this.input.selectionStart ?? this.input.value.length,
                      );
                      return true;
                  }
                : undefined,
        });
        this.chevron.setAttribute('aria-controls', this.view.list.id);
        this.unsubscribeChevron = this.controller.subscribe((s) => {
            this.chevron.setAttribute('aria-expanded', String(s.open));
        });
        // Outside the display layer the host keeps hidden from assistive
        // technology, so both are heard and seen.
        root.appendChild(this.view.announcer);
        root.appendChild(this.view.note);
        if (options.draft) {
            this.input.value = options.draft;
            this.autoSizeInput();
            void this.controller.input(options.draft, options.draft.length);
        }

        requestAnimationFrame(() => {
            if (this.destroyed) return;
            this.autoSizeInput();
            // A key pressed before this frame may already have opened the
            // phone sheet, which owns focus; leave it there.
            if (this.view.activeInput === this.input) {
                this.input.focus();
                const caret = this.clampCaret(options.caret);
                this.input.setSelectionRange(caret, caret);
            }
            if (options.openList !== false) void this.view.open('api');
        });
    }

    destroy(): void {
        this.destroyed = true;
        this.unsubscribeChevron?.();
        this.view?.destroy();
        this.controller?.dispose();
        this.container.innerHTML = '';
    }

    /**
     * Open the list for a click on the marking the editor already holds, with
     * the caret where the click pointed (`caret`, an offset in the editor's
     * text) or left where it is.
     */
    showList(caret?: number): void {
        if (this.destroyed || !this.view) return;
        if (caret !== undefined && this.view.activeInput === this.input) {
            const at = this.clampCaret(caret);
            this.input.setSelectionRange(at, at);
            void this.controller.input(this.input.value, at);
        }
        void this.view.open('pointer');
    }

    /**
     * The marking's closing delimiter, for the host to draw right after the
     * editor's mount. The editor's chevron sits on it: while the chevron shows,
     * the delimiter's glyphs give way to it but keep their width, so the host's
     * display stays in register with its text layer and the space after the
     * marking stays where it was (see inline-marking-editor.css). The chevron
     * centers on the delimiter's full width, one glyph or several. A template
     * that writes no closing delimiter leaves it nowhere to stand but on the
     * text, so it is not drawn; a click on the marking opens the list.
     *
     * @param text - The delimiter as the host writes it, possibly empty
     * @returns The element to append after the mount
     */
    closeDelimiter(text: string): HTMLSpanElement {
        if (this.chevronAnchor) {
            this.chevronAnchorText.data = text;
            this.chevronAnchor.classList.toggle(
                'inline-editor-chevron-anchor--bare',
                text === '',
            );
        }
        const span = document.createElement('span');
        span.className = 'inline-editor-close';
        span.textContent = text;
        return span;
    }

    /** Read the draft again: what it is judged against changed. */
    refreshContext(): void {
        void this.controller?.refreshContext();
    }

    /** Whether the editor holds typed text not yet committed. */
    hasDraft(): boolean {
        return this.controller?.isDirty() ?? false;
    }

    /** The current uncommitted marking, or null when this session is clean. */
    getDraftMarking(): { rendered: string; valid: boolean } | null {
        if (!this.controller?.isDirty()) return null;
        const reading = this.controller.completeReading();
        return {
            rendered: reading?.rendered ?? '',
            valid:
                !!reading &&
                reading.valid &&
                !reading.refusal &&
                reading.assertions.length > 0,
        };
    }

    /** The committed value of this editing session. */
    getRendered(): string {
        return this.rendered;
    }

    getAssertions(): Assertion[] {
        return [...this.assertions];
    }

    /** True while the draft differs from the committed value. */
    isDirty(): boolean {
        return this.controller?.isDirty() ?? false;
    }

    /** True when the last commit stored nothing and the draft shows why. */
    isInvalid(): boolean {
        return this.controller?.snapshot().invalid ?? false;
    }

    /**
     * Commit the draft through the composer's one commit function, for a host
     * that is closing the editor (an outside click, leaving the marking).
     */
    commit(): Promise<CommitOutcome> {
        return this.controller.commit();
    }

    /**
     * Fixes the engine applied during this editing session, deduplicated by
     * rule. The host merges these into its own record on commit; a canceled
     * session discards them.
     */
    getAppliedFixes(): Change[] {
        return [...this._appliedFixes.values()];
    }

    /**
     * Focus the input that owns the edit: the sheet's own while the phone sheet
     * is open, so a host that focuses the editor after mounting it does not
     * pull focus out of the sheet and the on-screen keyboard with it.
     */
    focus(): void {
        (this.view?.activeInput ?? this.input)?.focus();
    }

    /**
     * True when `node` belongs to this editor: its inline mount, or the
     * composer surface portaled to the document body. A host's outside-press
     * handling must treat a press on either as inside the editor.
     */
    owns(node: Node): boolean {
        return (
            this.container.contains(node) ||
            !!this.view?.surface.contains(node) ||
            !!this.view?.note.contains(node)
        );
    }

    private onKeydown(e: KeyboardEvent): void {
        if (e.isComposing || e.keyCode === 229) return;
        const atStart =
            this.input.selectionStart === 0 && this.input.selectionEnd === 0;
        const len = this.input.value.length;
        const atEnd =
            this.input.selectionStart === len &&
            this.input.selectionEnd === len;
        const direction =
            e.key === 'ArrowLeft' && atStart
                ? 'left'
                : e.key === 'ArrowRight' && atEnd
                  ? 'right'
                  : null;
        if (!direction) return;
        // Leaving the marking is a commit boundary: the same commit as blur.
        e.preventDefault();
        void this.controller.commit().then((outcome) => {
            if (outcome !== 'invalid') this.options.onExit?.(direction);
        });
    }

    /** An offset in the editor's text, the end when none is given. */
    private clampCaret(caret: number | undefined): number {
        const length = this.input.value.length;
        if (caret === undefined || !Number.isFinite(caret)) return length;
        return Math.min(Math.max(Math.trunc(caret), 0), length);
    }

    /**
     * The chevron at the end of the marking: the pointer's way to the list when
     * the caret came in by keyboard. It shows and hides the list without taking
     * focus from the text, so typing still filters. It stays out of the Tab
     * order: the keyboard has Ctrl/Cmd+Enter, and a touch screen opens the list
     * with the tap on the marking itself (inline-marking-editor.css hides it on
     * a coarse pointer).
     */
    private createChevron(): HTMLButtonElement {
        const chevron = document.createElement('button');
        chevron.type = 'button';
        chevron.className = 'inline-editor-chevron';
        chevron.tabIndex = -1;
        chevron.setAttribute('aria-label', t('aria.showSuggestions'));
        chevron.setAttribute('aria-haspopup', 'listbox');
        chevron.setAttribute('aria-expanded', 'false');
        chevron.innerHTML =
            '<svg viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="m2 3.75 3 3 3-3"/></svg>';
        // Keep focus in the text, and keep the press from reading as a press
        // outside the editor.
        chevron.addEventListener('mousedown', (event) => {
            event.preventDefault();
            event.stopPropagation();
        });
        chevron.addEventListener('click', () => {
            if (this.destroyed || !this.view) return;
            if (this.controller.isOpen) this.view.close();
            else void this.view.open('pointer');
            if (this.view.activeInput === this.input) this.input.focus();
        });
        return chevron;
    }

    private autoSizeInput(): void {
        // Measure with the sizer (same font, absolutely positioned). Round up
        // so the input always covers every painted glyph; rounding down left
        // a click-through strip where a press could land on the host textarea
        // underneath and be taken for an editor exit.
        const text = this.input.value || ' ';
        this.sizer.textContent = text;
        const width = this.sizer.getBoundingClientRect().width;
        this.input.style.width = `${Math.max(Math.ceil(width), 8)}px`;
    }

    private process(
        text: string,
        assertions?: readonly Assertion[],
    ): Promise<ProcessResult> {
        return Promise.resolve(
            this.callProcess(text, {
                outputFormat: this.options.formatId,
                context: this.options.resolveContext?.(),
                // The engine takes a whole's values again from `context`.
                ...(assertions
                    ? { assertions: withoutTakenFromWhole(assertions) }
                    : {}),
            }),
        ) as Promise<ProcessResult>;
    }

    private port(): ComposerPort {
        return createComposerPort({
            shape: 'whole',
            binding: {
                process: (text, request) => this.process(text, request?.chosen),
                coveredCategories: () =>
                    coveredCategoriesOf(
                        this.engine,
                        this.options.formatId,
                        this.options.scope,
                    ),
                write: (assertions) =>
                    Promise.resolve(
                        this.callRender([...assertions], this.options.formatId),
                    ),
                readsInWhole: () =>
                    this.options.resolveContext?.()?.partOf !== undefined,
            },
            scheme: () => this.engine.getScheme(),
            meta: () => this.callGetProfile(),
            formatId: () => this.options.formatId,
            scope: () => this.options.scope,
            scopes: () => this.options.scopes ?? [],
            suggestions: async (live) => {
                const context = this.options.resolveContext?.();
                const asked = await Promise.all(
                    this.suggestionSurfaces().map(async (options) =>
                        context?.role === 'part' || context?.partOf
                            ? Object.values(
                                  (
                                      await Promise.resolve(
                                          this.callProcess('', {
                                              ...options,
                                              context,
                                              assertions: [...(live ?? [])],
                                              suggestFor: this.engine
                                                  .getScheme()
                                                  .categories.map(
                                                      (category) => category.id,
                                                  ),
                                          }),
                                      )
                                  ).suggestionsFor ?? {},
                              ).flatMap((result) => result.suggestions)
                            : (
                                  await Promise.resolve(
                                      this.callSuggest(
                                          [...(live ?? [])],
                                          options,
                                      ),
                                  )
                              ).suggestions,
                    ),
                );
                return asked
                    .flat()
                    .filter(
                        (s: Suggestion) => !s.conceptId.startsWith('preset:'),
                    );
            },
            gated: async (query, live) => {
                const asked = await Promise.all(
                    this.suggestionSurfaces().map((options) =>
                        Promise.resolve(
                            this.callSuggest([...live], {
                                ...options,
                                filter: query,
                                includeGated: true,
                            }),
                        ),
                    ),
                );
                return asked.flatMap((result) =>
                    result.suggestions.filter((s: Suggestion) => s.gated),
                );
            },
            committed: () => ({
                assertions: this.assertions,
                rendered: this.rendered,
            }),
            store: (reading, commit) => this.store(reading, commit),
        });
    }

    /**
     * Store a complete reading: process the stated assertions so the engine
     * settles what they imply, keep the result as this session's committed
     * value, and hand it to the host.
     */
    private async store(
        reading: ComposerReading,
        commit: ComposerCommit,
    ): Promise<void> {
        // Commit the resulting facts; diagnostic pre-repair facts are history.
        const result = await this.process(
            '',
            statedAssertions(reading.assertions),
        );
        if (this.destroyed) return;
        this.assertions = result.assertions;
        // A refused write is the engine's marker: the draft it read stands,
        // and the facts still go to the host, which judges them.
        this.rendered = renderViewRefused(result)
            ? reading.rendered
            : result.rendered;
        // A second commit in the same session replaces the first, and what
        // was fixed in the value it replaces no longer describes the mark.
        if (commit.replaces) this._appliedFixes.clear();
        // Processing the statement repairs it again but cannot see how the
        // draft's text was read; those fixes come with the reading.
        recordAppliedFixes(this._appliedFixes, reading.appliedFixes);
        recordAppliedFixes(this._appliedFixes, result.appliedFixes);
        this.options.onChange?.(this.rendered, this.assertions);
    }

    /** Engine.render in the given format. */
    private callRender(assertions: Assertion[], format: string) {
        return this.engine.render(assertions, format);
    }

    private callProcess(input: string, opts: ProcessOptions) {
        const withParts = partsOption(this.options.resolveParts, opts) ?? opts;
        return this.engine.process(input, withParts);
    }

    private callSuggest(input: string | Assertion[], options: SuggestOptions) {
        const read =
            typeof input === 'string' ? input : statedAssertions(input);
        return this.engine.suggest(read, options);
    }

    /** Where the composer asks what the host field offers. */
    private suggestionSurfaces(): SuggestionSurface[] {
        return suggestionSurfaces(
            this.callGetProfile(),
            this.options.formatId,
            this.options.scope,
            this.options.scopes,
            true,
        );
    }

    private callGetProfile() {
        return this.engine.getSchemeMeta();
    }
}
