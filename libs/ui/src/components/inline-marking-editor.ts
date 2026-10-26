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
    isAddressableSchemeEngine,
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
    scope?: string;
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
    /** The host field's accessible name, for the combobox and listbox. */
    label?: () => { id?: string; text: string };
    /**
     * Pre-existing assertions to seed the editor with instead of re-parsing
     * initialValue.
     */
    assertions?: Assertion[];
    /**
     * Open the list as the editor opens (default). False for an editor opened
     * because the caret moved into a marking: moving the caret is not a request
     * for suggestions, so the list waits for typing or ArrowDown.
     */
    openList?: boolean;
    /**
     * Text the user already typed as this marking, not yet committed (typed
     * text moved into a new mark). It opens as a dirty draft over an empty
     * committed value, so the result row reads it and Enter stores it.
     */
    draft?: string;
    /** The loaded profile id this editor targets. */
    schemeId?: string;
    /** False disables the active row's definition line. */
    tooltips?: boolean;
    /** Concept view property to use for row detail. */
    tooltipConceptProperty?: string;
}

/** Inline marking editor: an input plus the shared composer. */
export class InlineMarkingEditor {
    private engine!: ComponentSchemeEngine;
    private schemeAddressing = false;
    private container!: HTMLDivElement;
    private input!: HTMLInputElement;
    private sizer!: HTMLSpanElement;
    private options!: InlineMarkingEditorOptions;
    private schemeId: string | undefined;
    private assertions: Assertion[] = [];
    private rendered = '';
    private destroyed = false;
    private controller!: ComposerController;
    private view!: ComposerView;
    /** Fixes the engine applied during this session, deduplicated by rule. */
    private _appliedFixes = new Map<string, Change>();
    private readonly _conceptDescriber = createConceptDescriber({
        engine: () => this.engine,
        schemeId: () => this.schemeId,
        schemeAddressing: () => this.schemeAddressing,
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
        this.schemeAddressing =
            !isComponentContextAdapter(engineOrContext) &&
            isAddressableSchemeEngine(this.engine);
        this.container = container;
        this.options = options;
        this.schemeId = options.schemeId;

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
        wrap.appendChild(this.input);
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
            onEscapeIdle: () => {
                this.options.onCancel?.();
                return true;
            },
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
                this.input.setSelectionRange(
                    this.input.value.length,
                    this.input.value.length,
                );
            }
            if (options.openList !== false) void this.view.open('api');
        });
    }

    destroy(): void {
        this.destroyed = true;
        this.view?.destroy();
        this.controller?.dispose();
        this.container.innerHTML = '';
    }

    /** Read the draft again: what it is judged against changed. */
    refreshContext(): void {
        void this.controller?.refreshContext();
    }

    /** Whether the editor holds typed text not yet committed. */
    hasDraft(): boolean {
        return this.controller?.isDirty() ?? false;
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
                coveredCategories: () => {
                    const coverage = this.engine.getFormatCoverage?.(
                        this.options.formatId,
                        this.schemeId,
                    );
                    return coverage
                        ? new Set(coverage.coveredCategories)
                        : undefined;
                },
                write: async (assertions) =>
                    (
                        await Promise.resolve(
                            this.callRender(
                                [...assertions],
                                this.options.formatId,
                            ),
                        )
                    ).rendered,
            },
            scheme: () => this.engine.getScheme(this.schemeId),
            meta: () => this.callGetProfile(),
            formatId: () => this.options.formatId,
            scope: () => this.options.scope,
            suggestions: async (live) => {
                const context = this.options.resolveContext?.();
                const options = {
                    outputFormat: this.options.formatId,
                    surface: this.options.scope,
                };
                const suggestions =
                    context?.role === 'part' || context?.partOf
                        ? Object.values(
                              (
                                  await Promise.resolve(
                                      this.callProcess('', {
                                          ...options,
                                          context,
                                          assertions: [...(live ?? [])],
                                          suggestFor: this.engine
                                              .getScheme(this.schemeId)
                                              .categories.map(
                                                  (category) => category.id,
                                              ),
                                      }),
                                  )
                              ).suggestionsFor ?? {},
                          ).flatMap((result) => result.suggestions)
                        : (
                              await Promise.resolve(
                                  this.callSuggest([...(live ?? [])], options),
                              )
                          ).suggestions;
                return suggestions.filter(
                    (s: Suggestion) => !s.conceptId.startsWith('preset:'),
                );
            },
            gated: async (query, live) => {
                const result = await Promise.resolve(
                    this.callSuggest([...live], {
                        outputFormat: this.options.formatId,
                        filter: query,
                        surface: this.options.scope,
                        includeGated: true,
                    }),
                );
                return result.suggestions.filter((s: Suggestion) => s.gated);
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
        this.rendered = result.rendered;
        // A second commit in the same session replaces the first, and what
        // was fixed in the value it replaces no longer describes the mark.
        if (commit.replaces) this._appliedFixes.clear();
        // Processing the statement repairs it again but cannot see how the
        // draft's text was read; those fixes come with the reading.
        recordAppliedFixes(this._appliedFixes, reading.appliedFixes);
        recordAppliedFixes(this._appliedFixes, result.appliedFixes);
        this.options.onChange?.(this.rendered, this.assertions);
    }

    /** Engine.render, addressed to this editor's scheme where it can be. */
    private callRender(assertions: Assertion[], format: string) {
        if (
            this.schemeAddressing &&
            this.schemeId &&
            isAddressableSchemeEngine(this.engine)
        ) {
            return this.engine.render(assertions, format, this.schemeId);
        }
        return this.engine.render(assertions, format);
    }

    private callProcess(input: string, opts: ProcessOptions) {
        const withParts = partsOption(this.options.resolveParts, opts) ?? opts;
        if (
            this.schemeAddressing &&
            this.schemeId &&
            isAddressableSchemeEngine(this.engine)
        ) {
            return this.engine.process(input, this.schemeId, withParts);
        }
        return this.engine.process(input, withParts);
    }

    private callSuggest(input: string | Assertion[], options: SuggestOptions) {
        const read =
            typeof input === 'string' ? input : statedAssertions(input);
        if (
            this.schemeAddressing &&
            this.schemeId &&
            isAddressableSchemeEngine(this.engine)
        ) {
            return this.engine.suggest(read, this.schemeId, options);
        }
        return this.engine.suggest(read, options);
    }

    private callGetProfile() {
        if (this.schemeAddressing && this.schemeId) {
            return this.engine.getSchemeMeta(this.schemeId);
        }
        return this.engine.getSchemeMeta();
    }
}
