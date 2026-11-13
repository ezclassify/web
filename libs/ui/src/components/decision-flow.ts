/**
 * DecisionFlow: sequential decision-point stepper component.
 *
 * Renders one profile category at a time as radio-card options with step
 * indicators, Next/Back navigation, and a summary stripe showing all completed
 * selections. Each step calls `reprocess()` so constraints and inference fire
 * as the user progresses through the flow.
 *
 * Useful for any scheme with ordered single-select categories, multi-tier
 * access levels, incident severity ratings, risk triage workflows, etc.
 *
 * Attribute: `data-ezclassify-controller="decisionflow"`. Config, on that host:
 *
 * - `data-ezclassify-decisionflow-categories`: JSON array (or comma or space
 *   list) of category IDs in step order. Absent, the flow walks every category
 *   of the scopes it names.
 * - `data-ezclassify-scope`: the scope ids the flow walks, space-separated.
 *   Absent, the scheme's default scope.
 *
 * Scopes: a flow walks its scopes in the scheme's declaration order, then
 * category order. Each step belongs to the scope its category declares, and
 * every engine call made for a step (its options, the choices it accepts) is
 * made on that scope's surface. A flow whose steps span more than one scope
 * labels each step with its scope, groups the summary by scope, judges the
 * marking on each scope's surface, and ends by showing each scope written in
 * its own output. A flow of one scope looks as it always has.
 *
 * Which steps show is the engine's answer: a step shows while the engine offers
 * an option for it or it holds a choice. A choice that leaves a step with
 * nothing on offer clears that step's choices, so the marking never keeps a
 * fact for a path the author did not take.
 */

import { ComponentBase } from './component-base';
import type {
    ComponentEngineSource,
    ComponentOptions,
} from './component-base-readonly';
import { createAnnouncer, announce } from './component-utils';
import { SuggestionCatalog } from './composer/suggestion-catalog';
import { statedAssertions } from './composer/composer-controller';
import type { ComposerPort } from './composer/composer-controller';
import type {
    Assertion,
    ConceptTextInput,
    Fix,
    ProcessResult,
    RenderAssessment,
    Suggestion,
    ValidationError,
    Warning,
} from '@ezclassify/types';
import { applyTextInputAttributes } from './text-input-attributes';
import decisionFlowCss from './decision-flow.css?inline';
import { getPublicFormatLayout } from '../format-layout';
import { observeNativeLock } from './dom-helpers';
import { EMPTY_VALUE } from '../text-utils';
import type { EzClassifyState } from '../store/ezclassify-store';
import { viewOutputOf } from '../format-resolver';
import { renderViewRefused } from '../render-refusal';
import {
    factsInScopes,
    inDeclarationOrder,
    parseScopeList,
    scopeLabel,
    scopesOfCategory,
} from '../scopes';

/** Options a DecisionFlow reads beyond every component's own. */
export interface DecisionFlowOptions extends ComponentOptions {
    /** Category IDs in step order; overrides the host attribute. */
    categoryOrder?: string[];
    /**
     * `data-ezclassify-decisionflow-categories` as harvested from the host: a
     * JSON array, or a comma or space list, of category IDs in step order.
     */
    categories?: string;
    /**
     * The scope ids the flow walks, as `data-ezclassify-scope` lists them. A
     * flow mounted directly may instead list them in `scope`, space-separated.
     */
    scopes?: readonly string[];
}

interface ConceptDef {
    id: string;
    name: string;
    description: string;
    /**
     * Present when the concept accepts a user-typed value (e.g. "{value}"
     * view).
     */
    textInput?: ConceptTextInput;
}

interface StepDef {
    categoryId: string;
    label: string;
    description: string;
    /** True = single-select (radio); false = multi-select (checkbox). */
    single: boolean;
    /** Whether the scheme requires a choice in this category. */
    required: boolean;
    concepts: ConceptDef[];
    /**
     * When set, this step is only shown while its owning concept is asserted.
     * Derived from an unambiguous fixed-header/category field group.
     */
    requiredHeader?: { conceptId: string; categoryId: string };
    /**
     * The scope this step's category belongs to among the scopes the flow
     * walks. Undefined for a scheme that declares no scopes.
     */
    scope?: string;
}

/**
 * A value-taking concept the author chose before typing its value. The flow
 * asserts it only once it has a value: a value-taking concept stated with none
 * is not a marking the engine accepts.
 */
interface PendingText {
    categoryId: string;
    conceptId: string;
    value: string;
}

/**
 * Sequential category stepper that walks the user through one decision per
 * category.
 */
export class DecisionFlow extends ComponentBase {
    protected override clearButtonMount(): HTMLElement | null {
        return this.flowEl ? this.clearButtonFrame(this.flowEl) : null;
    }
    /** Full step list built once at setup: includes owned/conditional steps. */
    private _allSteps: StepDef[] = [];
    /** The scopes the flow's steps belong to, in declaration order. */
    private stepScopes: string[] = [];
    /**
     * The categories the engine offered an option for at its last complete
     * answer; null until it has answered. Kept across a change until the next
     * answer lands, so a step does not flicker out while its options load.
     */
    private offeredCategories: Set<string> | null = null;

    /** Whether the flow's steps span more than one scope. */
    private get multiScope(): boolean {
        return this.stepScopes.length > 1;
    }

    /**
     * Subset of _allSteps that are currently visible: a step shows while the
     * engine offers it an option or it holds a choice. The step the author is
     * on stays while the engine answers.
     */
    private get steps(): StepDef[] {
        const offered = this.offeredCategories;
        return this._allSteps.filter((step) => {
            const header = step.requiredHeader;
            if (
                header &&
                !this.assertions.some(
                    (a) =>
                        a.conceptId === header.conceptId &&
                        a.categoryId === header.categoryId,
                )
            )
                return false;
            if (!offered) return true;
            return (
                step.categoryId === this._currentCategoryId ||
                offered.has(step.categoryId) ||
                this.assertions.some((a) => a.categoryId === step.categoryId) ||
                this.pendingText?.categoryId === step.categoryId
            );
        });
    }

    private currentStep = 0;
    /**
     * Category ID at the active step: the source of truth when step indices
     * shift.
     */
    private _currentCategoryId = '';
    private flowEl!: HTMLDivElement;
    private announcer!: HTMLDivElement;
    /** When true, render() focuses the active option after rebuilding the DOM. */
    private _restoreFocusAfterRender = false;
    /** When true, render() focuses the companion value field instead. */
    private _focusCompanion = false;
    /**
     * The concept id last interacted with: used to restore focus after
     * multi-select toggles.
     */
    private _lastFocusConceptId = '';
    /** One catalog per scope the flow walks; one for a flow of one scope. */
    private catalogs = new Map<string, SuggestionCatalog>();
    private pickerPort!: ComposerPort;
    private catalogReady = false;
    private userEdit = false;
    /** The category the author last changed, which a prune never clears. */
    private editedCategory = '';
    private optionsSequence = 0;
    private pickSequence = 0;
    private judgeSequence = 0;
    private locked = false;
    private stopObservingLock?: () => void;
    private pointerActive = false;
    private rendering = false;
    private catalogChangedDuringPress = false;
    private pendingText: PendingText | null = null;
    /** True while a committed store state is being applied. */
    private applyingStoreState = false;
    /** The end-of-flow writing of each scope, keyed by the facts written. */
    private result: { key: string; texts: Map<string, string> } | null = null;
    private resultSequence = 0;
    /** The facts the result is being written for, while a write is in flight. */
    private resultWriting: string | null = null;
    private readonly finishPointer = () => {
        this.pointerActive = false;
        if (this.catalogChangedDuringPress && !this._destroyed) {
            this.catalogChangedDuringPress = false;
            this.render();
        }
    };
    private readonly releasePointer = (event: Event) => {
        if (!this.pointerActive || this.flowEl.contains(event.target as Node))
            return;
        this.finishPointer();
    };
    private readonly outsidePointer = (event: Event) => {
        if (!this.flowEl.contains(event.target as Node)) this.finishPointer();
    };
    private readonly requestOptions = () => {
        if (
            this._destroyed ||
            this.rendering ||
            this.enhancedInput?.matches(':disabled, [readonly]')
        )
            return;
        void this.refreshOptions();
    };

    /**
     * A flow names its scopes as a list. Every engine call for a step names
     * that step's scope, so the base's single surface is the flow's scope only
     * when it walks exactly one.
     */
    override async init(
        container: HTMLDivElement,
        engineOrContext?: ComponentEngineSource | null,
        options?: DecisionFlowOptions,
    ): Promise<void> {
        const scopes = options?.scopes
            ? [...options.scopes]
            : parseScopeList(options?.scope);
        await super.init(container, engineOrContext, {
            ...options,
            scopes,
            scope: scopes.length === 1 ? scopes[0] : undefined,
        } as DecisionFlowOptions);
    }

    private get flowOptions(): DecisionFlowOptions {
        return this.options as DecisionFlowOptions;
    }

    private catalogFor(step: StepDef): SuggestionCatalog | undefined {
        return this.catalogs.get(this.multiScope ? (step.scope ?? '') : '');
    }

    private async refreshOptions(paint = true): Promise<void> {
        const sequence = ++this.optionsSequence;
        const contextKey = JSON.stringify(this.getProcessingContext()) ?? '';
        const live = statedAssertions(this.assertions);
        await Promise.all(
            [...this.catalogs.values()].map(async (catalog) => {
                await catalog.load(contextKey);
                await catalog.refresh(live);
            }),
        );
        if (this._destroyed || sequence !== this.optionsSequence) return;
        this.catalogReady = true;
        this.offeredCategories = new Set(
            [...this.catalogs.values()].flatMap((catalog) =>
                catalog
                    .rows()
                    .filter((s) => !s.gated)
                    .map((s) => s.categoryId),
            ),
        );
        if (!paint) return;
        if (this.clearIrrelevantSteps()) return;
        if (this.pointerActive) this.catalogChangedDuringPress = true;
        else this.render();
    }

    /**
     * After the author's own change, clear the choices of every step the engine
     * no longer offers anything for. The engine's answer for the new marking is
     * what says a path was not taken; the flow does not decide it. Only facts
     * the author stated are cleared, never the step just changed, and the
     * engine settles the result.
     *
     * @returns Whether anything was cleared (and a reprocess started)
     */
    private clearIrrelevantSteps(): boolean {
        const offered = this.offeredCategories;
        const edited = this.editedCategory;
        this.editedCategory = '';
        if (!offered || !edited) return false;
        const stepCategories = new Set(this._allSteps.map((s) => s.categoryId));
        const irrelevant = (categoryId: string) =>
            categoryId !== edited &&
            stepCategories.has(categoryId) &&
            !offered.has(categoryId);
        if (this.pendingText && irrelevant(this.pendingText.categoryId))
            this.pendingText = null;
        const cleared = statedAssertions(this.assertions).filter((a) =>
            irrelevant(a.categoryId),
        );
        if (cleared.length === 0) return false;
        let next = this.assertions;
        for (const assertion of cleared)
            next = this.pickerPort.remove(next, assertion);
        this.userEdit = true;
        this.assertions = next;
        this.reprocess();
        return true;
    }

    private pick(step: StepDef, conceptId: string, action: () => void): void {
        const sequence = ++this.pickSequence;
        const apply = () => {
            if (
                this._destroyed ||
                sequence !== this.pickSequence ||
                this.enhancedInput?.matches(':disabled, [readonly]')
            )
                return false;
            if (
                (this.catalogFor(step)
                    ?.rows()
                    .some(
                        (s) =>
                            !s.gated &&
                            s.categoryId === step.categoryId &&
                            s.conceptId === conceptId,
                    ) ??
                    false) ||
                this.assertions.some(
                    (a) =>
                        a.categoryId === step.categoryId &&
                        a.conceptId === conceptId,
                )
            ) {
                this.editedCategory = step.categoryId;
                action();
                return true;
            }
            return false;
        };
        // A choice the engine has not offered yet may be on its way: the
        // options for the marking as it now stands are still loading.
        if (this.catalogReady && apply()) return;
        void this.refreshOptions(false).then(() => {
            if (this._destroyed || sequence !== this.pickSequence) return;
            if (!apply()) this.render();
        });
    }

    private visibleConcepts(step: StepDef): ConceptDef[] {
        const catalog = this.catalogFor(step);
        if (!this.catalogReady || !catalog) return step.concepts;
        const offered = new Set(
            catalog
                .rows()
                .filter((s) => !s.gated && s.categoryId === step.categoryId)
                .map((s) => s.conceptId),
        );
        for (const a of this.assertions) {
            if (a.categoryId === step.categoryId) offered.add(a.conceptId);
        }
        if (this.pendingText?.categoryId === step.categoryId)
            offered.add(this.pendingText.conceptId);
        return step.concepts.filter((c) => offered.has(c.id));
    }

    protected setup(): void {
        this.injectComponentStyles(decisionFlowCss);

        const listed = this.listedScopes();
        const categoryIds = this.resolveCategoryOrder(listed);
        if (categoryIds.length === 0) return;

        const headersByCategory = getPublicFormatLayout(
            this.schemeMeta,
        ).headerByCategory;

        const scopeOrder = new Map(
            (this.schemeMeta.scopes ?? []).map((s, i) => [s.id, i]),
        );
        this._allSteps = categoryIds
            .map((catId) => {
                const cat = this.scheme.categories.find((c) => c.id === catId);
                const concepts = this.scheme.concepts
                    .filter((c) => c.categories.includes(catId))
                    .sort((a, b) => a.position - b.position);
                return {
                    categoryId: catId,
                    label: cat?.label ?? catId,
                    description: '', // engine concept descriptions shown per-option
                    single: cat?.single !== false, // default single unless explicitly false
                    required: cat?.required !== false,
                    concepts: concepts.map((c) => ({
                        id: c.id,
                        // For text_input concepts, show the concept's human name (e.g. "Labeled By"),
                        // not the view template (e.g. "{value}") which is meaningless without a value.
                        name: c.textInput
                            ? c.name
                            : (c.views?.['default'] ?? c.name),
                        description: c.definition ?? '',
                        textInput: c.textInput ?? undefined,
                    })),
                    requiredHeader: headersByCategory.get(catId),
                    scope: cat ? this.stepScopeOf(cat, listed) : undefined,
                };
            })
            // Scopes in declaration order, then the categories' own order.
            // Array.prototype.sort is stable, so one scope keeps its order.
            .sort(
                (a, b) =>
                    (scopeOrder.get(a.scope ?? '') ?? Number.MAX_SAFE_INTEGER) -
                    (scopeOrder.get(b.scope ?? '') ?? Number.MAX_SAFE_INTEGER),
            );
        this.stepScopes = inDeclarationOrder(
            this._allSteps.flatMap((s) => (s.scope ? [s.scope] : [])),
            this.schemeMeta,
        );

        // Determine starting step from existing assertions.
        // When there are no assertions at all (fresh component), always start at step 0.
        // When the component is seeded, advance past optional categories that have no
        // assertion; they are skippable and don't block a valid partial/full marking.
        const startStep = this.options.startStep ?? 0;
        const hasAnyAssertions = this.assertions.length > 0;
        const visibleSteps = this.steps; // use getter; reflects initial assertion state
        const firstIncomplete = hasAnyAssertions
            ? visibleSteps.findIndex(
                  (s) =>
                      !this.assertions.some(
                          (a) => a.categoryId === s.categoryId,
                      ) && s.required,
              )
            : 0;

        this.currentStep =
            firstIncomplete >= 0
                ? Math.max(startStep, firstIncomplete)
                : visibleSteps.length - 1;
        this._currentCategoryId =
            visibleSteps[this.currentStep]?.categoryId ?? '';

        this.flowEl = document.createElement('div');
        this.flowEl.className = 'ez-decision-flow';
        this.flowEl.setAttribute('role', 'group');
        this.flowEl.setAttribute('aria-label', 'Decision flow');
        this.container.appendChild(this.flowEl);

        this.announcer = createAnnouncer();
        this.container.appendChild(this.announcer);

        this.pickerPort = this.composerPort('additive');
        if (this.multiScope) {
            for (const scope of this.stepScopes) {
                this.catalogs.set(
                    scope,
                    new SuggestionCatalog(
                        (live) => this.scopeSuggestions(scope, live),
                        () => undefined,
                    ),
                );
            }
        } else {
            this.catalogs.set(
                '',
                new SuggestionCatalog(
                    (live) => this.pickerPort.suggestions(live),
                    () => undefined,
                ),
            );
        }
        this.flowEl.addEventListener('focusin', this.requestOptions);
        this.flowEl.addEventListener('pointerdown', () => {
            this.pointerActive = true;
        });
        this.flowEl.addEventListener('click', () => {
            this.finishPointer();
            this.requestOptions();
        });
        // Touch browsers may dispatch click after pointerup in a later task.
        // Keep an inside press mounted until click; an outside release cancels it.
        this.flowEl.addEventListener('keyup', this.finishPointer);
        document.addEventListener('pointerdown', this.outsidePointer);
        document.addEventListener('pointerup', this.releasePointer);
        document.addEventListener('pointercancel', this.finishPointer);
        this.stopObservingLock = observeNativeLock(
            this.enhancedInput,
            (locked) => {
                this.locked = locked;
                this.render();
            },
        );
        this.render();
    }

    /**
     * What the engine offers on one scope's surface, for a flow that walks
     * several: the same question the composer asks for a field of one scope
     * (see `composerSuggestions`), asked on that scope.
     */
    private async scopeSuggestions(
        scope: string,
        live?: readonly Assertion[],
    ): Promise<Suggestion[]> {
        const context = this.getProcessingContext();
        const options = { outputFormat: this.outputFor(scope), surface: scope };
        const categories = this._allSteps
            .filter((s) => s.scope === scope)
            .map((s) => s.categoryId);
        const suggestions =
            context?.role === 'part' || context?.partOf
                ? Object.values(
                      (
                          await Promise.resolve(
                              this.callProcess('', {
                                  ...options,
                                  context,
                                  assertions: [...(live ?? [])],
                                  suggestFor: categories,
                              }),
                          )
                      ).suggestionsFor ?? {},
                  ).flatMap((result) => result.suggestions)
                : (
                      await Promise.resolve(
                          this.callSuggest([...(live ?? [])], options),
                      )
                  ).suggestions;
        return this.disambiguateSuggestions(
            suggestions.filter((s) => !s.conceptId.startsWith('preset:')),
        );
    }

    protected override onAssertionsChanged(): void {
        ++this.optionsSequence;
        ++this.pickSequence;
        const contextKey = JSON.stringify(this.getProcessingContext()) ?? '';
        for (const catalog of this.catalogs.values()) {
            if (catalog.useContext(contextKey)) this.catalogReady = false;
            catalog.invalidateLive();
        }
        // A pending value-taking choice in a single-choice step gives way when
        // the marking states another choice there.
        const pending = this.pendingText;
        if (
            pending &&
            this._allSteps.find((s) => s.categoryId === pending.categoryId)
                ?.single &&
            statedAssertions(this.assertions).some(
                (a) =>
                    a.categoryId === pending.categoryId &&
                    a.conceptId !== pending.conceptId,
            )
        )
            this.pendingText = null;
        const refresh = this.userEdit;
        this.userEdit = false;
        super.onAssertionsChanged();
        if (refresh) this.requestOptions();
    }

    /**
     * A committed state from the marking's store. Its errors judge the marking
     * on the store's surface; a flow judges it on its own scopes.
     */
    override applyStoreState(state: EzClassifyState): void {
        this.applyingStoreState = true;
        try {
            super.applyStoreState(state);
        } finally {
            this.applyingStoreState = false;
        }
    }

    /**
     * Show what the engine says about the marking, judged on the flow's own
     * scopes. A flow of several scopes judges the marking on each of their
     * surfaces, and a committed store state is judged again on the flow's
     * scope, so the report under the flow always answers the same question
     * whichever path brought the marking.
     */
    override updateValidationErrors(
        errors: ValidationError[],
        proposedFixes: readonly Fix[] = [],
        warnings: readonly Warning[] = [],
    ): void {
        if (!this.judgesInOwnScopes()) {
            ++this.judgeSequence;
            super.updateValidationErrors(errors, proposedFixes, warnings);
            return;
        }
        void this.judgeInScopes();
    }

    /**
     * The flow's own write was refused. The report under the flow is still the
     * judgment on its own scopes, followed by why the write was refused.
     */
    protected override showRenderRefusal(
        write: { assessment?: RenderAssessment },
        errors: readonly ValidationError[] = [],
        proposedFixes: readonly Fix[] = [],
        warnings: readonly Warning[] = [],
    ): void {
        if (!this.judgesInOwnScopes()) {
            ++this.judgeSequence;
            super.showRenderRefusal(write, errors, proposedFixes, warnings);
            return;
        }
        void this.judgeInScopes(write);
    }

    /**
     * Whether the report under the flow comes from judging the marking on the
     * flow's own scopes rather than from the read that brought it: always for a
     * flow of several scopes, and for a committed store state when the flow
     * names its scope. A facet reports nothing of its own.
     */
    private judgesInOwnScopes(): boolean {
        return (
            !this.options.facetOf &&
            (this.multiScope ||
                (this.applyingStoreState && this.options.scope !== undefined))
        );
    }

    /**
     * The output a scope is written in for this flow: the flow's own format on
     * the surface that format writes, else the scope's default for the flow's
     * role. Without a scope, the flow's own format.
     */
    private outputFor(scope: string | undefined): string {
        if (scope === undefined) return this.formatId;
        const own = this.schemeMeta.formats?.find(
            (f) => f.id === this.formatId,
        )?.surface;
        return scope === own
            ? this.formatId
            : viewOutputOf(this.schemeMeta, [scope], !!this.options.holdsPart);
    }

    /**
     * Read the stated marking on each of the flow's scopes and merge the
     * reports.
     */
    private async judgeInScopes(refused?: {
        assessment?: RenderAssessment;
    }): Promise<void> {
        const sequence = ++this.judgeSequence;
        const show = (
            errors: ValidationError[],
            proposedFixes: Fix[] = [],
            warnings: Warning[] = [],
        ) =>
            refused
                ? super.showRenderRefusal(
                      refused,
                      errors,
                      proposedFixes,
                      warnings,
                  )
                : super.updateValidationErrors(errors, proposedFixes, warnings);
        const stated = statedAssertions(this.assertions);
        if (stated.length === 0) {
            show([]);
            return;
        }
        const scopes: (string | undefined)[] = this.multiScope
            ? this.stepScopes
            : [this.options.scope];
        try {
            const results: ProcessResult[] = await Promise.all(
                scopes.map((scope) =>
                    Promise.resolve(
                        this.callProcess('', {
                            outputFormat: this.outputFor(scope),
                            assertions: stated,
                            context: this.getProcessingContext(),
                            ...(scope ? { surface: scope } : {}),
                        }),
                    ),
                ),
            );
            if (this._destroyed || sequence !== this.judgeSequence) return;
            const once = <T>(items: T[]) => {
                const seen = new Set<string>();
                return items.filter((item) => {
                    const key = JSON.stringify(item);
                    if (seen.has(key)) return false;
                    seen.add(key);
                    return true;
                });
            };
            show(
                once(results.flatMap((r) => r.errors ?? [])),
                once(results.flatMap((r) => r.proposedFixes ?? [])),
                once(results.flatMap((r) => r.warnings ?? [])),
            );
        } catch (error) {
            if (this._destroyed || sequence !== this.judgeSequence) return;
            this.showReadFailure(error);
        }
    }

    destroy(): void {
        this.destroyClearButton();
        this.removeRuleErrors();
        this._destroyed = true;
        for (const catalog of this.catalogs.values()) catalog.dispose();
        this.stopObservingLock?.();
        document.removeEventListener('pointerdown', this.outsidePointer);
        document.removeEventListener('pointerup', this.releasePointer);
        document.removeEventListener('pointercancel', this.finishPointer);
        this.container.innerHTML = '';
    }

    protected override discardDraft(): void {
        this.pendingText = null;
        this.currentStep = this.options.startStep ?? 0;
        this._currentCategoryId =
            this.steps[this.currentStep]?.categoryId ?? '';
    }

    protected render(): void {
        this.rendering = true;
        try {
            // Keep currentStep coherent when the visible step list grows or shrinks.
            // _currentCategoryId is the source of truth; currentStep follows from it.
            const steps = this.steps;
            const idx = steps.findIndex(
                (s) => s.categoryId === this._currentCategoryId,
            );
            if (idx >= 0) {
                this.currentStep = idx;
            } else {
                // The current category disappeared (e.g. an owned step was hidden),
                // fall back to the nearest previous step that is still visible.
                this.currentStep = Math.min(
                    this.currentStep,
                    Math.max(0, steps.length - 1),
                );
                this._currentCategoryId =
                    steps[this.currentStep]?.categoryId ?? '';
            }

            // Snapshot focus before clearing innerHTML. _restoreFocusAfterRender is set
            // explicitly by user actions (click, Next/Back). Secondary renders triggered by
            // catalog updates don't set the flag, so without this snapshot they would leave
            // focus on document.body after the DOM rebuild.
            const prevFocused = document.activeElement as HTMLElement | null;
            const focusedInComponent = this.flowEl.contains(prevFocused);
            const prevConceptId = prevFocused?.dataset?.conceptId ?? '';
            const prevWasTextField =
                prevFocused?.classList?.contains(
                    'ez-decision-flow__text-field',
                ) ?? false;

            const selection = prevWasTextField
                ? [
                      (prevFocused as HTMLInputElement).selectionStart,
                      (prevFocused as HTMLInputElement).selectionEnd,
                  ]
                : null;
            const restoreTextFocus = () => {
                const fields = Array.from(
                    this.flowEl.querySelectorAll<HTMLInputElement>(
                        '.ez-decision-flow__text-field',
                    ),
                );
                const field =
                    fields.find(
                        (input) => input.dataset.conceptId === prevConceptId,
                    ) ?? fields[0];
                field?.focus();
                if (
                    field &&
                    selection &&
                    selection[0] !== null &&
                    selection[1] !== null
                ) {
                    field.setSelectionRange(selection[0], selection[1]);
                }
            };

            this.flowEl.innerHTML = '';
            this.renderProgress();
            this.renderCurrentStep();
            this.renderNavigation();
            this.renderSummary();
            this.renderResult();

            // Restore keyboard focus after DOM rebuild. Set _restoreFocusAfterRender before
            // any action that calls render() as a side-effect (concept selection, Next/Back).
            // Initial setup render leaves the flag false so mount doesn't steal page focus.
            if (this._focusCompanion) {
                this._focusCompanion = false;
                this._restoreFocusAfterRender = false;
                this.flowEl
                    .querySelector<HTMLInputElement>(
                        '.ez-decision-flow__companion .ez-decision-flow__text-field',
                    )
                    ?.focus();
            } else if (this._restoreFocusAfterRender) {
                this._restoreFocusAfterRender = false;
                const step = this.steps[this.currentStep];
                if (prevWasTextField) {
                    restoreTextFocus();
                } else if (step && this.isTextInputStep(step)) {
                    restoreTextFocus();
                } else if (step?.single) {
                    // Radio group: restore to the roving-tabindex owner (the selected option or first)
                    const activeRadio = this.flowEl.querySelector<HTMLElement>(
                        '[role="radio"][tabindex="0"]',
                    );
                    activeRadio?.focus();
                } else {
                    // Checkbox group: restore to the last-interacted option, or the first
                    const target = this._lastFocusConceptId
                        ? this.flowEl.querySelector<HTMLElement>(
                              `[role="checkbox"][data-concept-id="${this._lastFocusConceptId}"]`,
                          )
                        : this.flowEl.querySelector<HTMLElement>(
                              '[role="checkbox"]',
                          );
                    target?.focus();
                }
            } else if (focusedInComponent) {
                // Secondary render (e.g. from catalog updates), restore to whatever was
                // focused before the DOM rebuild so we don't silently push focus to body.
                if (prevWasTextField) {
                    restoreTextFocus();
                } else if (prevConceptId) {
                    const restored =
                        this.flowEl.querySelector<HTMLElement>(
                            `[role="radio"][data-concept-id="${prevConceptId}"], [role="checkbox"][data-concept-id="${prevConceptId}"]`,
                        ) ??
                        this.flowEl.querySelector<HTMLElement>(
                            '[role="radio"][tabindex="0"]',
                        ) ??
                        this.flowEl.querySelector<HTMLElement>(
                            '[role="checkbox"]',
                        );
                    restored?.focus();
                }
            }
        } finally {
            this.rendering = false;
        }
    }

    /**
     * The scopes the flow walks: the ones its host lists that the scheme
     * declares, else the scheme's default scope. Empty for a scheme that
     * declares no scopes.
     */
    private listedScopes(): string[] {
        const declared = new Set(
            (this.schemeMeta.scopes ?? []).map((s) => s.id),
        );
        const named = this.flowOptions.scopes ?? [];
        const unknown = named.filter((s) => !declared.has(s));
        if (unknown.length > 0) {
            console.warn(
                `[ezclassify] DecisionFlow: data-ezclassify-scope names ${unknown
                    .map((s) => `"${s}"`)
                    .join(', ')}, which the scheme does not declare. ` +
                    `It declares ${[...declared].map((s) => `"${s}"`).join(', ') || 'no scopes'}.`,
            );
        }
        const known = named.filter((s) => declared.has(s));
        if (known.length > 0) return inDeclarationOrder(known, this.schemeMeta);
        const fallback = this.schemeMeta.defaultScope;
        return fallback ? [fallback] : [];
    }

    /**
     * The scope a category's step belongs to: the first of the walked scopes
     * the category belongs to. A category named explicitly that belongs to none
     * of them keeps its own first scope.
     */
    private stepScopeOf(
        category: { scopes?: readonly string[] },
        listed: readonly string[],
    ): string | undefined {
        const own = inDeclarationOrder(
            scopesOfCategory(category, this.schemeMeta),
            this.schemeMeta,
        );
        return own.find((s) => listed.includes(s)) ?? own[0];
    }

    /**
     * The categories to walk: the ones the options or the host list, else every
     * category that belongs to a walked scope, scope by scope.
     */
    private resolveCategoryOrder(listed: readonly string[]): string[] {
        const opts = this.flowOptions;
        if (Array.isArray(opts.categoryOrder)) return opts.categoryOrder;

        // The host's attribute, harvested by the scanner; a flow mounted
        // directly on its container reads the container's own.
        const attr =
            opts.categories ??
            this.container.getAttribute(
                'data-ezclassify-decisionflow-categories',
            );
        if (attr !== null && attr !== undefined) return parseCategoryList(attr);

        const categories = this.scheme.categories;
        if (listed.length === 0) return categories.map((c) => c.id);
        return listed.flatMap((scope) =>
            categories
                .filter((c) =>
                    scopesOfCategory(c, this.schemeMeta).includes(scope),
                )
                .filter((c) => this.stepScopeOf(c, listed) === scope)
                .map((c) => c.id),
        );
    }

    /**
     * True when the user can advance past the current step without a selection.
     * Required categories must have a selection; optional ones may be skipped.
     */
    private isStepPassable(stepIndex: number): boolean {
        const step = this.steps[stepIndex];
        if (!step) return false;
        if (this.assertions.some((a) => a.categoryId === step.categoryId))
            return true;
        return !step.required;
    }

    private renderProgress(): void {
        const bar = document.createElement('div');
        bar.className = 'ez-decision-flow__progress';
        bar.setAttribute('aria-hidden', 'true');
        if (this.steps.length === 1) {
            bar.textContent = 'Step 1 of 1';
            this.flowEl.appendChild(bar);
            return;
        }

        this.steps.forEach((step, i) => {
            if (i > 0) {
                const connector = document.createElement('div');
                connector.className = 'ez-decision-flow__step-connector';
                if (i <= this.currentStep) connector.dataset.state = 'complete';
                bar.appendChild(connector);
            }
            const dot = document.createElement('div');
            dot.className = 'ez-decision-flow__step-dot';
            const hasSelection = this.assertions.some(
                (a) => a.categoryId === step.categoryId,
            );
            if (i === this.currentStep) dot.dataset.state = 'current';
            else if (hasSelection) dot.dataset.state = 'complete';
            bar.appendChild(dot);
        });
        this.flowEl.appendChild(bar);
    }

    private renderCurrentStep(): void {
        const step = this.steps[this.currentStep];
        if (!step) return;

        const q = document.createElement('div');
        q.className = 'ez-decision-flow__question';

        // A flow of several scopes says which one each step belongs to.
        if (this.multiScope && step.scope) {
            const scope = document.createElement('div');
            scope.className = 'ez-decision-flow__scope';
            scope.textContent = scopeLabel(step.scope, this.schemeMeta);
            q.appendChild(scope);
        }

        const label = document.createElement('h3');
        label.className = 'ez-decision-flow__question-label';
        label.id = `df-label-${step.categoryId}`;
        label.textContent = `Step ${this.currentStep + 1} of ${this.steps.length}: ${step.label}`;
        q.appendChild(label);

        if (!step.single && !this.isTextInputStep(step)) {
            const hint = document.createElement('div');
            hint.className = 'ez-decision-flow__question-desc';
            hint.textContent = 'Select all that apply.';
            q.appendChild(hint);
        }

        const optionsEl = document.createElement('div');
        optionsEl.className = 'ez-decision-flow__options';
        optionsEl.setAttribute(
            'aria-labelledby',
            `df-label-${step.categoryId}`,
        );

        if (this.isTextInputStep(step)) {
            optionsEl.setAttribute('role', 'group');
            this.renderTextInputOptions(step, optionsEl);
        } else if (step.single) {
            optionsEl.setAttribute('role', 'radiogroup');
            this.renderRadioOptions(step, optionsEl);
        } else {
            optionsEl.setAttribute('role', 'group');
            this.renderCheckboxOptions(step, optionsEl);
        }

        q.appendChild(optionsEl);
        if (!this.isTextInputStep(step)) this.renderCompanions(step, q);
        this.flowEl.appendChild(q);
    }

    /**
     * The concept ids a step holds, including a value-taking choice still
     * pending.
     */
    private chosenIn(step: StepDef): Set<string> {
        const chosen = new Set(
            this.assertions
                .filter((a) => a.categoryId === step.categoryId)
                .map((a) => a.conceptId),
        );
        if (this.pendingText?.categoryId === step.categoryId) {
            if (step.single) chosen.clear();
            chosen.add(this.pendingText.conceptId);
        }
        return chosen;
    }

    private renderRadioOptions(step: StepDef, optionsEl: HTMLElement): void {
        const selected = [...this.chosenIn(step)][0];
        const visibleConcepts = this.visibleConcepts(step);

        visibleConcepts.forEach((concept, i) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.disabled = this.locked;
            btn.className = 'ez-decision-flow__option';
            btn.setAttribute('role', 'radio');
            btn.setAttribute(
                'aria-checked',
                concept.id === selected ? 'true' : 'false',
            );
            btn.tabIndex =
                concept.id === selected || (!selected && i === 0) ? 0 : -1;
            btn.textContent = concept.name;
            btn.dataset.conceptId = concept.id;
            if (concept.description) btn.title = concept.description;

            btn.addEventListener('click', () => {
                if (
                    this._destroyed ||
                    this.enhancedInput?.matches(':disabled, [readonly]')
                )
                    return;
                // Restore focus to this option after the DOM rebuild that follows reprocess().
                this._restoreFocusAfterRender = true;
                this._lastFocusConceptId = concept.id;
                this.pick(step, concept.id, () => {
                    if (concept.textInput)
                        this.chooseValueConcept(step, concept);
                    else this.selectConcept(step.categoryId, concept.id);
                    announce(this.announcer, `Selected ${concept.name}`);
                });
            });

            btn.addEventListener('keydown', (e: KeyboardEvent) => {
                const options = Array.from(
                    optionsEl.querySelectorAll<HTMLButtonElement>(
                        '[role="radio"]',
                    ),
                );
                const idx = options.indexOf(btn);
                let next = -1;

                if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
                    next = (idx + 1) % options.length;
                } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
                    next = (idx - 1 + options.length) % options.length;
                }

                if (next >= 0) {
                    e.preventDefault();
                    // Arrow keys move focus only: no selection commit. The user presses
                    // Enter or Space (which triggers a click event on the focused button)
                    // to confirm a choice.
                    options.forEach((o, j) => {
                        o.tabIndex = j === next ? 0 : -1;
                    });
                    options[next].focus();
                }
            });

            optionsEl.appendChild(btn);
        });
    }

    /**
     * True when every visible concept in the step accepts a user-typed value
     * (text_input).
     */
    private isTextInputStep(step: StepDef): boolean {
        const visible = this.visibleConcepts(step);
        return visible.length > 0 && visible.every((c) => c.textInput != null);
    }

    private renderTextInputOptions(
        step: StepDef,
        optionsEl: HTMLElement,
    ): void {
        const visibleConcepts = this.visibleConcepts(step);
        for (const concept of visibleConcepts) {
            if (!concept.textInput) continue;
            const ti = concept.textInput;

            const existingAssertion = this.assertions.find(
                (a) =>
                    a.conceptId === concept.id &&
                    a.categoryId === step.categoryId,
            );

            const wrap = document.createElement('div');
            wrap.className = 'ez-decision-flow__text-field-wrap';

            const inputEl = document.createElement('input');
            inputEl.type = 'text';
            inputEl.dataset.conceptId = concept.id;
            inputEl.readOnly = this.locked;
            inputEl.className = 'ez-decision-flow__text-field';
            inputEl.placeholder = ti.placeholder ?? '';
            inputEl.setAttribute('aria-label', ti.label ?? concept.name);
            applyTextInputAttributes(inputEl, ti);
            const draft =
                this.pendingText?.conceptId === concept.id &&
                this.pendingText.categoryId === step.categoryId
                    ? this.pendingText.value
                    : undefined;
            if (draft !== undefined) inputEl.value = draft;
            else if (existingAssertion?.value)
                inputEl.value = existingAssertion.value;

            inputEl.addEventListener('input', () => {
                if (
                    this._destroyed ||
                    this.enhancedInput?.matches(':disabled, [readonly]')
                )
                    return;
                this.enterValue(step, concept, inputEl);
            });

            // Prevent arrow keys from bubbling to the flow's keyboard handler.
            inputEl.addEventListener('keydown', (e) => e.stopPropagation());

            wrap.appendChild(inputEl);
            optionsEl.appendChild(wrap);
        }
    }

    /**
     * The value fields of a step that mixes value-taking concepts with plain
     * ones: one labeled field under the options for each value-taking choice
     * the step holds or has pending.
     */
    private renderCompanions(step: StepDef, target: HTMLElement): void {
        const chosen = this.chosenIn(step);
        for (const concept of step.concepts) {
            if (!concept.textInput || !chosen.has(concept.id)) continue;
            const ti = concept.textInput;
            const assertion = this.assertions.find(
                (a) =>
                    a.conceptId === concept.id &&
                    a.categoryId === step.categoryId,
            );
            const pending =
                this.pendingText?.conceptId === concept.id &&
                this.pendingText.categoryId === step.categoryId
                    ? this.pendingText
                    : null;

            const wrap = document.createElement('div');
            wrap.className =
                'ez-decision-flow__text-field-wrap ez-decision-flow__companion';
            const fieldId = `df-value-${step.categoryId}-${concept.id}`;

            const label = document.createElement('label');
            label.className = 'ez-decision-flow__companion-label';
            label.htmlFor = fieldId;
            label.textContent = ti.label ?? concept.name;

            const inputEl = document.createElement('input');
            inputEl.type = 'text';
            inputEl.id = fieldId;
            inputEl.dataset.conceptId = concept.id;
            inputEl.readOnly = this.locked;
            inputEl.className = 'ez-decision-flow__text-field';
            inputEl.placeholder = ti.placeholder ?? '';
            inputEl.required = ti.required !== false;
            applyTextInputAttributes(inputEl, ti);
            inputEl.value = pending ? pending.value : (assertion?.value ?? '');

            const errorEl = document.createElement('div');
            errorEl.className = 'ez-decision-flow__companion-error';
            errorEl.id = `${fieldId}-error`;
            errorEl.setAttribute('role', 'alert');
            inputEl.setAttribute('aria-describedby', errorEl.id);

            const showError = (blurred: boolean) => {
                const value = inputEl.value.trim();
                const message =
                    value && !inputEl.validity.valid
                        ? `Invalid format. Expected: ${ti.placeholder ?? 'the required value format'}`
                        : !value && inputEl.required && blurred
                          ? 'Required'
                          : '';
                errorEl.textContent = message;
                if (message) inputEl.setAttribute('aria-invalid', 'true');
                else inputEl.removeAttribute('aria-invalid');
            };

            inputEl.addEventListener('input', () => {
                if (
                    this._destroyed ||
                    this.enhancedInput?.matches(':disabled, [readonly]')
                )
                    return;
                showError(false);
                this.enterValue(step, concept, inputEl);
            });
            inputEl.addEventListener('blur', () => showError(true));
            inputEl.addEventListener('keydown', (e) => e.stopPropagation());
            showError(false);

            wrap.append(label, inputEl, errorEl);
            target.appendChild(wrap);
        }
    }

    /**
     * The author typed into a value field. The concept is stated once its value
     * is complete for the field (present and in the field's format), and
     * withdrawn while it is not; the typed text stays in the field either way.
     */
    private enterValue(
        step: StepDef,
        concept: ConceptDef,
        inputEl: HTMLInputElement,
    ): void {
        const value = inputEl.value;
        const complete = value.trim() !== '' && inputEl.validity.valid;
        this.pendingText = {
            categoryId: step.categoryId,
            conceptId: concept.id,
            value,
        };
        const index = this.assertions.findIndex(
            (a) =>
                a.conceptId === concept.id && a.categoryId === step.categoryId,
        );
        if (!complete && index < 0) return;
        this.userEdit = true;
        this.editedCategory = step.categoryId;
        // Restore focus to this field after the DOM rebuild that follows reprocess().
        this._restoreFocusAfterRender = true;
        if (complete && index >= 0) {
            const edited: Assertion = {
                ...this.assertions[index],
                value,
                source: 'user',
                confidence: 'certain',
            };
            delete edited.sourceRule;
            this.assertions = this.assertions.map((a, i) =>
                i === index ? edited : a,
            );
        } else if (complete) {
            this.assertions = [
                ...this.assertions,
                {
                    conceptId: concept.id,
                    categoryId: step.categoryId,
                    confidence: 'certain',
                    source: 'user',
                    value,
                },
            ];
        } else {
            this.assertions = this.assertions.filter((_, i) => i !== index);
        }
        this.reprocess();
    }

    /**
     * The author chose a value-taking concept from a step's options. It is
     * pending, shown checked with its value field, until a value is typed. In a
     * single-choice step it replaces the step's other choice.
     */
    private chooseValueConcept(step: StepDef, concept: ConceptDef): void {
        const held = this.assertions.some(
            (a) =>
                a.categoryId === step.categoryId && a.conceptId === concept.id,
        );
        const pendingHere =
            this.pendingText?.categoryId === step.categoryId &&
            this.pendingText.conceptId === concept.id;
        if (!step.single && (held || pendingHere)) {
            // A second press on a checkbox withdraws the choice.
            if (pendingHere) this.pendingText = null;
            if (held) this.toggleConcept(step.categoryId, concept.id, true);
            else this.render();
            return;
        }
        this._focusCompanion = true;
        if (held) {
            this.render();
            return;
        }
        this.pendingText = {
            categoryId: step.categoryId,
            conceptId: concept.id,
            value: '',
        };
        const replaced = step.single
            ? this.assertions.filter((a) => a.categoryId === step.categoryId)
            : [];
        if (replaced.length === 0) {
            this.render();
            return;
        }
        this.userEdit = true;
        for (const previous of replaced)
            this.assertions = this.pickerPort.remove(this.assertions, previous);
        this.reprocess();
    }

    private renderCheckboxOptions(step: StepDef, optionsEl: HTMLElement): void {
        const selectedIds = this.chosenIn(step);
        const visibleConcepts = this.visibleConcepts(step);

        visibleConcepts.forEach((concept) => {
            const isChecked = selectedIds.has(concept.id);
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.disabled = this.locked;
            btn.className = 'ez-decision-flow__option';
            btn.setAttribute('role', 'checkbox');
            btn.setAttribute('aria-checked', isChecked ? 'true' : 'false');
            // Checkboxes are independently focusable: no roving tabindex.
            btn.tabIndex = 0;
            btn.textContent = concept.name;
            btn.dataset.conceptId = concept.id;
            if (concept.description) btn.title = concept.description;

            btn.addEventListener('click', () => {
                if (
                    this._destroyed ||
                    this.enhancedInput?.matches(':disabled, [readonly]')
                )
                    return;
                this._restoreFocusAfterRender = true;
                this._lastFocusConceptId = concept.id;
                this.pick(step, concept.id, () => {
                    if (concept.textInput)
                        this.chooseValueConcept(step, concept);
                    else
                        this.toggleConcept(
                            step.categoryId,
                            concept.id,
                            isChecked,
                        );
                    announce(
                        this.announcer,
                        isChecked
                            ? `Deselected ${concept.name}`
                            : `Selected ${concept.name}`,
                    );
                });
            });

            optionsEl.appendChild(btn);
        });
    }

    /**
     * Move to another step. A value-taking choice left without a value is
     * dropped; one with a value is in the marking already.
     */
    private goToStep(index: number): void {
        const steps = this.steps;
        if (index < 0 || index >= steps.length) return;
        this.pendingText = null;
        this.currentStep = index;
        this._currentCategoryId = steps[index].categoryId;
        this._restoreFocusAfterRender = true;
        this.render();
        announce(
            this.announcer,
            `Step ${index + 1}: ${steps[index].label ?? ''}`,
        );
    }

    private renderNavigation(): void {
        const nav = document.createElement('div');
        nav.className = 'ez-decision-flow__nav';

        const back = document.createElement('button');
        back.type = 'button';
        back.className = 'ez-decision-flow__nav-btn';
        back.textContent = '← Back';
        back.disabled = this.currentStep === 0;
        back.addEventListener('click', () => {
            if (this.currentStep > 0) this.goToStep(this.currentStep - 1);
        });
        nav.appendChild(back);

        const next = document.createElement('button');
        next.type = 'button';
        next.className = 'ez-decision-flow__nav-btn';
        next.textContent =
            this.currentStep === this.steps.length - 1 ? 'Done' : 'Next →';
        // Optional categories (required: false) are skippable, Next stays enabled even without
        // a selection so the user can advance through them without being forced to pick.
        next.disabled = !this.isStepPassable(this.currentStep);
        next.addEventListener('click', () => {
            if (this.currentStep < this.steps.length - 1)
                this.goToStep(this.currentStep + 1);
        });
        nav.appendChild(next);

        this.flowEl.appendChild(nav);
    }

    private summaryChip(step: StepDef): HTMLSpanElement {
        const stepAssertions = this.assertions.filter(
            (a) => a.categoryId === step.categoryId,
        );
        const names = stepAssertions.map((a) => {
            const concept = step.concepts.find((c) => c.id === a.conceptId);
            // For text_input concepts, show the user-typed value.
            if (concept?.textInput && a.value) return a.value;
            return concept?.name ?? a.conceptId;
        });
        const chip = document.createElement('span');
        chip.className =
            stepAssertions.length > 0
                ? 'ez-decision-flow__summary-chip'
                : 'ez-decision-flow__summary-chip ez-decision-flow__summary-chip--empty';
        chip.textContent = `${step.label}: ${
            stepAssertions.length === 0
                ? EMPTY_VALUE
                : step.single
                  ? names[0]
                  : names.join(', ')
        }`;
        return chip;
    }

    private renderSummary(): void {
        const summary = document.createElement('div');
        summary.className = 'ez-decision-flow__summary';
        summary.setAttribute('aria-label', 'Selected decisions');

        if (!this.multiScope) {
            for (const step of this.steps)
                summary.appendChild(this.summaryChip(step));
            this.flowEl.appendChild(summary);
            return;
        }

        // A flow of several scopes groups its decisions by scope.
        summary.classList.add('ez-decision-flow__summary--grouped');
        const steps = this.steps;
        for (const scope of this.stepScopes) {
            const inScope = steps.filter((s) => s.scope === scope);
            if (inScope.length === 0) continue;
            const group = document.createElement('div');
            group.className = 'ez-decision-flow__summary-group';
            group.setAttribute('role', 'group');
            const label = scopeLabel(scope, this.schemeMeta);
            group.setAttribute('aria-label', label);
            const heading = document.createElement('span');
            heading.className = 'ez-decision-flow__summary-scope';
            heading.textContent = label;
            group.appendChild(heading);
            for (const step of inScope)
                group.appendChild(this.summaryChip(step));
            summary.appendChild(group);
        }
        this.flowEl.appendChild(summary);
    }

    /**
     * At the end of a flow of several scopes, the finished marking: each scope
     * written in its own output, under its label.
     */
    private renderResult(): void {
        if (!this.multiScope) return;
        if (this.currentStep !== this.steps.length - 1) return;
        const result = document.createElement('div');
        result.className = 'ez-decision-flow__result';
        result.setAttribute('role', 'group');
        result.setAttribute('aria-label', 'Finished marking');
        const key = JSON.stringify(
            this.assertions
                .map((a) => [a.categoryId, a.conceptId, a.value ?? null])
                .sort(),
        );
        const texts = this.result?.key === key ? this.result.texts : null;
        const writing = this.resultWriting === key;
        for (const scope of this.stepScopes) {
            const block = document.createElement('div');
            block.className = 'ez-decision-flow__result-scope';
            block.dataset.scope = scope;
            const heading = document.createElement('div');
            heading.className = 'ez-decision-flow__result-label';
            heading.textContent = scopeLabel(scope, this.schemeMeta);
            const text = document.createElement('pre');
            text.className = 'ez-decision-flow__result-text';
            text.textContent = texts?.get(scope) || EMPTY_VALUE;
            block.append(heading, text);
            result.appendChild(block);
        }
        this.flowEl.appendChild(result);
        if (!texts && !writing) void this.writeResult(key);
    }

    /** Write each scope's facts in that scope's own output, then show them. */
    private async writeResult(key: string): Promise<void> {
        const sequence = ++this.resultSequence;
        this.resultWriting = key;
        const meta = this.schemeMeta;
        try {
            const written = await Promise.all(
                this.stepScopes.map(
                    async (scope): Promise<[string, string]> => {
                        const facts = factsInScopes(
                            this.assertions,
                            this.scheme.categories,
                            [scope],
                            meta,
                        );
                        if (facts.length === 0) return [scope, ''];
                        const write = await Promise.resolve(
                            this.callRender(facts, {
                                format: this.outputFor(scope),
                            }),
                        );
                        return [
                            scope,
                            renderViewRefused(write) ? '' : write.rendered,
                        ];
                    },
                ),
            );
            if (this._destroyed || sequence !== this.resultSequence) return;
            this.result = { key, texts: new Map(written) };
        } catch {
            if (this._destroyed || sequence !== this.resultSequence) return;
            this.result = { key, texts: new Map() };
        }
        this.resultWriting = null;
        for (const block of this.flowEl.querySelectorAll<HTMLElement>(
            '.ez-decision-flow__result-scope',
        )) {
            const text = block.querySelector('.ez-decision-flow__result-text');
            if (text)
                text.textContent =
                    this.result.texts.get(block.dataset.scope ?? '') ||
                    EMPTY_VALUE;
        }
    }

    private selectConcept(categoryId: string, conceptId: string): void {
        this.userEdit = true;
        if (this.pendingText?.categoryId === categoryId)
            this.pendingText = null;
        for (const previous of this.assertions.filter(
            (a) => a.categoryId === categoryId && a.conceptId !== conceptId,
        )) {
            this.assertions = this.pickerPort.remove(this.assertions, previous);
        }
        this.assertions = this.pickerPort.add(this.assertions, {
            conceptId,
            categoryId,
        });
        this.reprocess();
    }

    /**
     * Toggle a concept in a multi-select category. `wasChecked` mirrors the
     * aria-checked state at the moment the button was clicked, avoids a
     * double-read of assertions after the DOM captures the closure value.
     */
    private toggleConcept(
        categoryId: string,
        conceptId: string,
        wasChecked: boolean,
    ): void {
        this.userEdit = true;
        const ref = { conceptId, categoryId };
        this.assertions = wasChecked
            ? this.pickerPort.remove(this.assertions, ref)
            : this.pickerPort.add(this.assertions, ref);
        this.reprocess();
    }
}

/**
 * The category ids a `data-ezclassify-decisionflow-categories` value lists: a
 * JSON array of ids, or ids separated by commas or spaces.
 */
function parseCategoryList(value: string): string[] {
    const text = value.trim();
    if (text.startsWith('[')) {
        try {
            const parsed: unknown = JSON.parse(text);
            if (
                Array.isArray(parsed) &&
                parsed.every((id) => typeof id === 'string')
            )
                return parsed;
        } catch {
            /* reported below */
        }
        console.warn(
            `[ezclassify] DecisionFlow: data-ezclassify-decisionflow-categories is not a JSON array of category ids: ${text}`,
        );
        return [];
    }
    return text.split(/[\s,]+/).filter(Boolean);
}
