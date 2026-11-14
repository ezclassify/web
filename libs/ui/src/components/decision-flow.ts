/**
 * DecisionFlow: sequential decision-point stepper component.
 *
 * A field-sized control in the suite's frame. Its header row holds one dot per
 * step, the step header ("3 of 8 · Dissemination Control") and the suite's
 * status mark and clear. Under it, one line per scope shows what the marking
 * writes there and how many errors it has. Focusing or pressing the control
 * opens the current step between the two: its options in a row, with the
 * previous and next step arrows at the box's inside edges. Each choice calls
 * `reprocess()` so constraints and inference fire as the author goes, and a
 * choice in a single-choice step moves on to the next step.
 *
 * The dots are the navigation: each one jumps to its step, and says at a glance
 * whether the step is current, answered, missing an answer the engine asks for,
 * or optional and unset. Hovering or focusing a dot grows it and shows the
 * category with its selections; on a touch screen the first tap previews and a
 * second tap on the same dot jumps.
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
 * groups its dots by scope under each scope's label, judges the marking on each
 * scope's surface, and gives each scope a line of its own, written in that
 * scope's own output with the errors judged there. A flow of one scope has one
 * unlabeled line.
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
import { getPublicFormatLayout, viewForCategory } from '../format-layout';
import { observeNativeLock } from './dom-helpers';
import { EMPTY_VALUE } from '../text-utils';
import type { EzClassifyState } from '../store/ezclassify-store';
import { viewOutputOf } from '../format-resolver';
import { renderViewRefused } from '../render-refusal';
import { writtenValue } from '../value-spelling';
import {
    categoriesByScope,
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
        return this.suiteChrome?.element ?? null;
    }
    /** The header row: the dots, the step header and the suite's chrome. */
    private headerEl!: HTMLDivElement;
    /** The dots, one per visible step. */
    private dotsEl!: HTMLDivElement;
    /** "3 of 8 · Dissemination Control". */
    private titleEl!: HTMLDivElement;
    /** The open step: its options between the previous and next arrows. */
    private stepEl!: HTMLDivElement;
    /** One line per scope: what the marking writes there, and its errors. */
    private rowsEl!: HTMLDivElement;
    /** The label a previewed dot shows, laid over the flow. */
    private previewEl!: HTMLDivElement;
    /** Whether the current step is open under the header. */
    private open = false;
    /** The dot whose label shows, by index into the visible steps. */
    private previewIndex: number | null = null;
    /** How the last press on the flow was made: 'touch', 'mouse', 'pen'. */
    private lastPointerType = '';
    /** True while a press on a dot moves the flow to its step. */
    private jumping = false;
    /** The keyboard's dot among the dots (roving tabindex). */
    private dotFocus = -1;
    /** The engine's error messages for the marking, by the category named. */
    private errorsByCategory = new Map<string, string[]>();
    /** The engine's error messages, by the scope it judged them on. */
    private errorsByScope = new Map<string, string[]>();
    /** Every error message of the last judgment. */
    private allErrors: string[] = [];
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
    /** The latest load of the engine's options, settled or not. */
    private optionsLoading: Promise<void> = Promise.resolve();
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
    /** Each scope's writing, for a flow of several, keyed by the facts written. */
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
        if (this.flowEl.contains(event.target as Node)) return;
        this.finishPointer();
        // A tap anywhere else puts a previewed dot back.
        this.setPreview(null);
    };
    /** Focus left the flow: the step closes and the flow is one line again. */
    private readonly focusOut = (event: FocusEvent) => {
        // A render replaces the focused element and puts focus back itself.
        if (this.rendering) return;
        const next = event.relatedTarget as Node | null;
        if (next && this.flowEl.contains(next)) return;
        this.setPreview(null);
        this.setOpen(false);
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
     * A flow names its scopes as a list, in `scopes`; a flow mounted directly
     * may list them in `scope` instead, space-separated. Every engine call for
     * a step names that step's scope, so the base's single surface is the
     * flow's scope only when it walks exactly one.
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

    private refreshOptions(paint = true): Promise<void> {
        const loading = this.loadOptions(paint);
        this.optionsLoading = loading;
        return loading;
    }

    private async loadOptions(paint: boolean): Promise<void> {
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

        // The flow in the suite's field frame: the header row, the open step
        // and one line per scope. The header and the preview overlay last the
        // component's life; render() rebuilds what is inside them.
        this.flowEl = document.createElement('div');
        this.flowEl.className = 'ez-decision-flow';
        this.flowEl.setAttribute('role', 'group');
        this.flowEl.setAttribute('aria-label', 'Decision flow');
        this.applySuiteFrame(this.flowEl);
        this.headerEl = document.createElement('div');
        this.headerEl.className = 'ez-decision-flow__header';
        this.dotsEl = document.createElement('div');
        this.dotsEl.className = 'ez-decision-flow__progress';
        this.dotsEl.setAttribute('role', 'toolbar');
        this.dotsEl.setAttribute('aria-label', 'Steps');
        this.titleEl = document.createElement('div');
        this.titleEl.className = 'ez-decision-flow__question-label';
        // The dots and the step header share the row and wrap within it; the
        // chrome keeps the row's trailing end.
        const headerMain = document.createElement('div');
        headerMain.className = 'ez-decision-flow__header-main';
        headerMain.append(this.dotsEl, this.titleEl);
        this.headerEl.appendChild(headerMain);
        this.stepEl = document.createElement('div');
        this.stepEl.className = 'ez-decision-flow__step';
        this.stepEl.hidden = true;
        this.rowsEl = document.createElement('div');
        this.rowsEl.className = 'ez-decision-flow__rows';
        this.previewEl = document.createElement('div');
        this.previewEl.className = 'ez-decision-flow__dot-preview';
        this.previewEl.setAttribute('aria-hidden', 'true');
        this.previewEl.hidden = true;
        this.flowEl.append(
            this.headerEl,
            this.stepEl,
            this.rowsEl,
            this.previewEl,
        );
        this.container.appendChild(this.flowEl);
        this.mountSuiteChrome(this.headerEl);

        this.announcer = createAnnouncer();
        this.container.appendChild(this.announcer);
        this.appendKeyboardHints([
            { keys: '\u2190/\u2192', action: 'steps' },
            { keys: 'Enter', action: 'go to step' },
        ]);

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
        // Focus inside the flow opens its step; leaving closes it.
        this.flowEl.addEventListener('focusin', (event) => {
            if (!this.suiteChrome?.element.contains(event.target as Node))
                this.setOpen(true);
        });
        this.flowEl.addEventListener('focusout', this.focusOut);
        this.flowEl.addEventListener('pointerdown', (event) => {
            this.pointerActive = true;
            this.lastPointerType = event.pointerType;
        });
        this.flowEl.addEventListener('click', (event) => {
            this.finishPointer();
            this.requestOptions();
            if (!this.suiteChrome?.element.contains(event.target as Node))
                this.setOpen(true);
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
            this.showJudgment(errors, proposedFixes, warnings);
            return;
        }
        void this.judgeInScopes();
    }

    /**
     * Show the engine's judgment of the marking: under the flow, as every
     * control shows it, and on the dots and scope lines, where each error marks
     * the step of the category it names.
     */
    private showJudgment(
        errors: readonly ValidationError[],
        proposedFixes: readonly Fix[],
        warnings: readonly Warning[],
        refused?: { assessment?: RenderAssessment },
        byScope?: ReadonlyMap<string, readonly ValidationError[]>,
    ): void {
        this.allErrors = errors.map((error) => error.message);
        this.errorsByCategory = new Map();
        for (const error of errors) {
            if (!error.categoryId) continue;
            const list = this.errorsByCategory.get(error.categoryId) ?? [];
            list.push(error.message);
            this.errorsByCategory.set(error.categoryId, list);
        }
        // An error the engine reports on several scopes belongs to the first
        // of them, in the scheme's declaration order, so it is counted once.
        const counted = new Set<string>();
        this.errorsByScope = new Map(
            [...(byScope ?? [])].map(([scope, list]) => [
                scope,
                list
                    .map((error) => error.message)
                    .filter((message) => {
                        if (counted.has(message)) return false;
                        counted.add(message);
                        return true;
                    }),
            ]),
        );
        if (refused)
            super.showRenderRefusal(refused, errors, proposedFixes, warnings);
        else super.updateValidationErrors([...errors], proposedFixes, warnings);
        if (this.flowEl && !this.rendering) {
            this.renderProgress();
            this.renderRows();
        }
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
            this.showJudgment(errors, proposedFixes, warnings, write);
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
            byScope?: ReadonlyMap<string, readonly ValidationError[]>,
        ) =>
            this.showJudgment(
                errors,
                proposedFixes,
                warnings,
                refused,
                byScope,
            );
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
                new Map(
                    scopes.flatMap((scope, i) =>
                        scope ? [[scope, results[i].errors ?? []]] : [],
                    ),
                ),
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
        this.flowEl?.removeEventListener('focusout', this.focusOut);
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
            const prevDot = prevFocused?.classList?.contains(
                'ez-decision-flow__step-dot',
            )
                ? (prevFocused.dataset.index ?? null)
                : null;
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

            this.renderProgress();
            this.renderTitle();
            this.stepEl.replaceChildren();
            this.renderNavigation('start');
            this.renderCurrentStep();
            this.renderNavigation('end');
            this.stepEl.hidden = !this.open;
            this.renderRows();
            this.flowEl.toggleAttribute('data-ezclassify-locked', this.locked);
            // A rebuilt dot keeps its label showing.
            if (this.previewIndex !== null) this.setPreview(this.previewIndex);

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
                if (prevDot !== null) {
                    (
                        this.dotsEl.querySelector<HTMLElement>(
                            `.ez-decision-flow__step-dot[data-index="${prevDot}"]`,
                        ) ??
                        this.dotsEl.querySelector<HTMLElement>(
                            '.ez-decision-flow__step-dot[tabindex="0"]',
                        )
                    )?.focus();
                } else if (prevWasTextField) {
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
        return categoriesByScope(categories, listed, this.schemeMeta).flatMap(
            (group) => group.categories.map((c) => c.id),
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

    /**
     * What a step holds, in words: its choices as the step's scope writes them,
     * or empty when it holds none.
     */
    private selectionText(step: StepDef): string {
        // A typed value shows the way the step's scope writes it, not in the
        // spelling it is stored in.
        const view = viewForCategory(
            getPublicFormatLayout(this.schemeMeta, this.outputFor(step.scope)),
            step.categoryId,
        );
        return this.assertions
            .filter((a) => a.categoryId === step.categoryId)
            .map((a) => {
                const concept = step.concepts.find((c) => c.id === a.conceptId);
                if (concept?.textInput && a.value)
                    return writtenValue(
                        a.value,
                        concept.textInput.encoding,
                        view,
                    );
                return concept?.name ?? a.conceptId;
            })
            .join(', ');
    }

    /**
     * A step's state at a glance: answered; missing, when the engine asks for
     * an answer there; optional and unset; or unset.
     */
    private stepState(
        step: StepDef,
    ): 'answered' | 'missing' | 'optional' | 'unset' {
        if (this.chosenIn(step).size > 0) return 'answered';
        // The engine names the category, or judges the step's scope wrong
        // while this required step is still unanswered.
        if (
            this.errorsByCategory.has(step.categoryId) ||
            (step.required && this.errorsIn(step.scope).length > 0)
        )
            return 'missing';
        return step.required ? 'unset' : 'optional';
    }

    /** A dot's label: the category and its selections, or why it has none. */
    private dotLabel(step: StepDef): string {
        const state = this.stepState(step);
        const held = this.selectionText(step);
        const said =
            state === 'answered'
                ? held || 'chosen'
                : state === 'missing'
                  ? 'needs an answer'
                  : state === 'optional'
                    ? 'optional, not set'
                    : 'not set';
        return `${step.label}: ${said}`;
    }

    /**
     * The dots: one button per visible step, grouped by scope with the scope's
     * label when the flow spans several. They are one tab stop; the arrow keys
     * move between them, and Enter, Space or a press jumps to the step.
     */
    private renderProgress(): void {
        const steps = this.steps;
        this.dotsEl.replaceChildren();
        if (this.dotFocus < 0 || this.dotFocus >= steps.length)
            this.dotFocus = this.currentStep;
        const groups: { scope?: string; steps: number[] }[] = [];
        steps.forEach((step, i) => {
            const last = groups[groups.length - 1];
            if (this.multiScope && last && last.scope !== step.scope)
                groups.push({ scope: step.scope, steps: [i] });
            else if (last) last.steps.push(i);
            else groups.push({ scope: step.scope, steps: [i] });
        });
        for (const group of groups) {
            let target: HTMLElement = this.dotsEl;
            if (this.multiScope && group.scope) {
                const label = scopeLabel(group.scope, this.schemeMeta);
                target = document.createElement('span');
                target.className = 'ez-decision-flow__dot-group';
                target.setAttribute('role', 'group');
                target.setAttribute('aria-label', label);
                target.dataset.scope = group.scope;
                const caption = document.createElement('span');
                caption.className = 'ez-decision-flow__dot-group-label';
                caption.setAttribute('aria-hidden', 'true');
                caption.textContent = label;
                target.appendChild(caption);
                this.dotsEl.appendChild(target);
            }
            for (const i of group.steps) target.appendChild(this.dot(i));
        }
    }

    private dot(i: number): HTMLButtonElement {
        const steps = this.steps;
        const step = steps[i];
        const dot = document.createElement('button');
        dot.type = 'button';
        dot.className = 'ez-decision-flow__step-dot';
        dot.dataset.state = this.stepState(step);
        dot.dataset.index = String(i);
        dot.dataset.categoryId = step.categoryId;
        if (i === this.currentStep) {
            dot.dataset.current = '';
            dot.setAttribute('aria-current', 'step');
        }
        dot.tabIndex = i === this.dotFocus ? 0 : -1;
        dot.setAttribute(
            'aria-label',
            `Step ${i + 1} of ${steps.length}, ${this.dotLabel(step)}`,
        );
        dot.addEventListener('click', () => {
            // A finger has no hover: its first tap shows the dot's label and
            // a second tap on the same dot goes there.
            if (this.lastPointerType === 'touch' && this.previewIndex !== i) {
                this.lastPointerType = '';
                this.setPreview(i);
                return;
            }
            this.lastPointerType = '';
            this.dotFocus = i;
            this.setPreview(null);
            this.setOpen(true);
            // The jump keeps focus on the dot; that focus is no request to
            // preview the step the author just went to.
            this.jumping = true;
            try {
                this.goToStep(i, 'dot');
            } finally {
                this.jumping = false;
            }
        });
        dot.addEventListener('pointerenter', (event) => {
            if (event.pointerType !== 'touch') this.setPreview(i);
        });
        dot.addEventListener('pointerleave', (event) => {
            if (event.pointerType !== 'touch' && this.previewIndex === i)
                this.setPreview(null);
        });
        dot.addEventListener('focus', () => {
            this.dotFocus = i;
            // Focus a render or a jump puts back is no request to preview.
            if (!this.jumping && !this.rendering) this.setPreview(i);
        });
        dot.addEventListener('blur', () => {
            if (this.previewIndex === i) this.setPreview(null);
        });
        dot.addEventListener('keydown', (event) => this.onDotKeydown(event, i));
        return dot;
    }

    /** Arrow keys, Home and End move between the dots. */
    private onDotKeydown(event: KeyboardEvent, i: number): void {
        const count = this.steps.length;
        const next =
            event.key === 'ArrowRight' || event.key === 'ArrowDown'
                ? (i + 1) % count
                : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
                  ? (i - 1 + count) % count
                  : event.key === 'Home'
                    ? 0
                    : event.key === 'End'
                      ? count - 1
                      : -1;
        if (next < 0) return;
        event.preventDefault();
        const dots = [
            ...this.dotsEl.querySelectorAll<HTMLButtonElement>(
                '.ez-decision-flow__step-dot',
            ),
        ];
        dots.forEach((dot, j) => (dot.tabIndex = j === next ? 0 : -1));
        this.dotFocus = next;
        dots[next]?.focus();
    }

    /**
     * Show the label of the dot at `index` over the flow, or hide it. The label
     * never moves the layout and stays inside the viewport.
     */
    private setPreview(index: number | null): void {
        if (!this.previewEl) return;
        const step = index === null ? undefined : this.steps[index];
        const dot =
            index === null
                ? null
                : this.dotsEl.querySelector<HTMLElement>(
                      `.ez-decision-flow__step-dot[data-index="${index}"]`,
                  );
        for (const other of this.dotsEl.querySelectorAll<HTMLElement>(
            '[data-previewing]',
        ))
            other.removeAttribute('data-previewing');
        if (!step || !dot) {
            this.previewIndex = null;
            this.previewEl.hidden = true;
            return;
        }
        this.previewIndex = index;
        dot.setAttribute('data-previewing', '');
        this.previewEl.textContent = this.dotLabel(step);
        this.previewEl.dataset.state = this.stepState(step);
        this.previewEl.hidden = false;
        // Centered under the dot, then pulled back inside the viewport.
        const frame = this.flowEl.getBoundingClientRect();
        const at = dot.getBoundingClientRect();
        this.previewEl.style.top = `${at.bottom - frame.top + 4}px`;
        this.previewEl.style.left = '0px';
        const width = this.previewEl.getBoundingClientRect().width;
        const viewport =
            document.documentElement.clientWidth || window.innerWidth;
        const margin = 8;
        let left = at.left + at.width / 2 - width / 2;
        left = Math.min(left, viewport - margin - width);
        left = Math.max(left, margin);
        this.previewEl.style.left = `${left - frame.left}px`;
    }

    /** Open or close the current step under the header. */
    private setOpen(open: boolean): void {
        if (this.open === open || !this.stepEl) return;
        this.open = open;
        this.stepEl.hidden = !open;
        this.flowEl.toggleAttribute('data-open', open);
    }

    /** The step header beside the dots: "3 of 8 · Dissemination Control". */
    private renderTitle(): void {
        const steps = this.steps;
        const step = steps[this.currentStep];
        this.titleEl.id = step ? `df-label-${step.categoryId}` : '';
        this.titleEl.textContent = step
            ? `${this.currentStep + 1} of ${steps.length} · ${step.label}`
            : '';
    }

    private renderCurrentStep(): void {
        const step = this.steps[this.currentStep];
        if (!step) return;

        const q = document.createElement('div');
        q.className = 'ez-decision-flow__question';

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
        this.stepEl.appendChild(q);
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
                    // A plain choice answers the step, so the flow moves on;
                    // a value-taking one waits for its value.
                    if (concept.textInput)
                        this.chooseValueConcept(step, concept);
                    else
                        void this.selectConcept(
                            step.categoryId,
                            concept.id,
                        ).then(() => void this.advanceFrom(step.categoryId));
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

            // Enter moves on to the next step. Other keys stay in the field.
            inputEl.addEventListener('keydown', (e) => {
                e.stopPropagation();
                if (e.key === 'Enter') {
                    e.preventDefault();
                    this.goToStep(this.currentStep + 1);
                }
            });

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
            inputEl.addEventListener('keydown', (e) => {
                e.stopPropagation();
                if (e.key === 'Enter') {
                    e.preventDefault();
                    this.goToStep(this.currentStep + 1);
                }
            });
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

            // Space toggles a choice; Enter moves on to the next step.
            btn.addEventListener('keydown', (event: KeyboardEvent) => {
                if (event.key !== 'Enter') return;
                event.preventDefault();
                this.goToStep(this.currentStep + 1);
            });

            optionsEl.appendChild(btn);
        });
    }

    /**
     * Move to another step. A value-taking choice left without a value is
     * dropped; one with a value is in the marking already. A jump from a dot
     * keeps the keyboard on the dots; any other move takes it to the step.
     */
    private goToStep(index: number, from: 'dot' | 'step' = 'step'): void {
        const steps = this.steps;
        if (index < 0 || index >= steps.length) return;
        this.pendingText = null;
        this.currentStep = index;
        this._currentCategoryId = steps[index].categoryId;
        this.dotFocus = index;
        this._restoreFocusAfterRender = from === 'step';
        this.render();
        if (from === 'dot')
            this.dotsEl
                .querySelector<HTMLElement>(
                    `.ez-decision-flow__step-dot[data-index="${index}"]`,
                )
                ?.focus();
        announce(
            this.announcer,
            `Step ${index + 1}: ${steps[index].label ?? ''}`,
        );
    }

    /**
     * After a choice in the step for `categoryId` settles, move on to the next
     * step, unless the author has moved somewhere else meanwhile.
     */
    private async advanceFrom(categoryId: string): Promise<void> {
        // Which step comes next is the engine's answer for the new marking: a
        // choice can bring steps or take them away. Wait for the options it
        // started loading, and for any load that one started in turn, a
        // bounded number of times.
        for (let i = 0; i < ADVANCE_SETTLE_ROUNDS; i++) {
            const loading = this.optionsLoading;
            await loading.catch(() => {});
            if (loading === this.optionsLoading) break;
        }
        if (this._destroyed || this._currentCategoryId !== categoryId) return;
        this.goToStep(this.currentStep + 1);
    }

    /**
     * The previous or next step arrow, at the open step's inside edge. Both
     * stay; each is disabled at its end, and Next waits for an answer the step
     * requires.
     */
    private renderNavigation(side: 'start' | 'end'): void {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = `ez-decision-flow__nav-btn ez-decision-flow__nav-btn--${side}`;
        const glyph = document.createElement('span');
        glyph.setAttribute('aria-hidden', 'true');
        // Text presentation (U+FE0E), so no platform swaps in an emoji.
        glyph.textContent = `${side === 'start' ? '‹' : '›'}︎`;
        button.appendChild(glyph);
        if (side === 'start') {
            button.setAttribute('aria-label', 'Previous step');
            button.disabled = this.currentStep === 0;
            button.addEventListener('click', () => {
                if (this.currentStep > 0) this.goToStep(this.currentStep - 1);
            });
        } else {
            button.setAttribute('aria-label', 'Next step');
            // An optional step (required: false) can be passed unanswered.
            button.disabled =
                this.currentStep >= this.steps.length - 1 ||
                !this.isStepPassable(this.currentStep);
            button.addEventListener('click', () => {
                if (this.currentStep < this.steps.length - 1)
                    this.goToStep(this.currentStep + 1);
            });
        }
        this.stepEl.appendChild(button);
    }

    /**
     * One line per scope: the scope's label when the flow spans several, what
     * the marking writes in that scope's own output, and how many errors the
     * engine reports there. The count's title holds the messages, which the
     * error list under the flow also shows in full.
     */
    private renderRows(): void {
        this.rowsEl.replaceChildren();
        const scopes: (string | undefined)[] = this.multiScope
            ? this.stepScopes
            : [undefined];
        const key = this.factsKey();
        const texts =
            this.multiScope && this.result?.key === key
                ? this.result.texts
                : null;
        for (const scope of scopes) {
            const row = document.createElement('div');
            row.className = 'ez-decision-flow__row';
            if (scope) row.dataset.scope = scope;
            if (scope) {
                const label = document.createElement('span');
                label.className = 'ez-decision-flow__row-label';
                label.textContent = scopeLabel(scope, this.schemeMeta);
                row.appendChild(label);
            }
            const text = scope ? (texts?.get(scope) ?? '') : this._lastRendered;
            const value = document.createElement('span');
            value.className = 'ez-decision-flow__row-text';
            // A block of several lines reads on one; the title keeps them.
            value.textContent = text
                ? text.split(/\n+/).join(' · ')
                : EMPTY_VALUE;
            if (!text) value.dataset.empty = '';
            value.title = text;
            row.appendChild(value);
            const messages = this.errorsIn(scope);
            if (messages.length > 0) {
                row.dataset.invalid = '';
                const count = document.createElement('span');
                count.className = 'ez-decision-flow__row-errors';
                count.textContent =
                    messages.length === 1
                        ? '1 error'
                        : `${messages.length} errors`;
                count.title = messages.join('\n');
                row.appendChild(count);
            }
            this.rowsEl.appendChild(row);
        }
        if (this.multiScope && !texts && this.resultWriting !== key)
            void this.writeResult(key);
    }

    /**
     * The error messages for one scope's line: those the engine reported
     * judging the marking on that scope, for a flow of several; every one for a
     * flow of one.
     */
    private errorsIn(scope: string | undefined): string[] {
        if (!this.multiScope || scope === undefined) return this.allErrors;
        return this.errorsByScope.get(scope) ?? [];
    }

    /** The facts the scope lines are written for. */
    private factsKey(): string {
        return JSON.stringify(
            this.assertions
                .map((a) => [a.categoryId, a.conceptId, a.value ?? null])
                .sort(),
        );
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
        this.renderRows();
    }

    /**
     * Choose a concept in a single-choice step.
     *
     * @returns Settles once the engine's answer for the choice is applied
     */
    private selectConcept(
        categoryId: string,
        conceptId: string,
    ): Promise<void> {
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
        return this.reprocessNow();
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
 * How many chained loads of the engine's options a move to the next step waits
 * through. A choice starts one load; clearing a path the engine no longer
 * offers starts one more. Any further load is a change from elsewhere, which
 * the move does not wait for.
 */
const ADVANCE_SETTLE_ROUNDS = 3;

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
