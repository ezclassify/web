/**
 * DecisionFlow: sequential decision-point stepper component.
 *
 * A field-sized control in the suite's frame. The status mark and clear sit at
 * the trailing end of its first line.
 *
 * One row of dots heads the control, a gap between scopes. A flow of one scope
 * writes its marking beside the dots, or under them, whole, when it does not
 * fit. A flow of several writes each scope's value under its name, below the
 * step. Under a value with something wrong, a line names the steps it is
 * missing, each a way to its step, and gives the engine's other messages.
 *
 * Focusing or pressing the control opens it, and opening adds one thing, the
 * step, at the bottom: its title ("3 of 8 · Dissemination Control") on a line
 * of its own, then the step's options between the previous and next step
 * arrows. Nothing above the step moves, hides or changes size when it opens or
 * when the step changes. Each choice calls `reprocess()` so constraints and
 * inference fire as the author goes; a choice in a single-choice step moves on
 * to the next step, and a multiple-choice step's toggles do not. Every option
 * is a toggle: pressing a chosen one again un-chooses it and the flow stays on
 * the step, and a value step is cleared by emptying its box. There is no clear
 * for one step; the x clears the whole marking, every scope the flow writes. An
 * option reads as the flow writes its concept on the step's scope (see
 * written-concept.ts), with the concept's name and definition in its tooltip
 * and description. One the marking's current choices rule out stays in its
 * place, unavailable, and says why. A value-taking option reads as its
 * concept's name and, once chosen, becomes the box its value is typed in.
 *
 * The dots are the navigation: each one jumps to its step, and says at a glance
 * whether the step is answered, missing an answer the engine asks for, or
 * optional and unset; while a step is open, its dot is ringed as current.
 * Hovering or focusing a dot grows it and shows the category with its
 * selections; on a touch screen the first tap previews and a second tap on the
 * same dot jumps.
 *
 * Useful for any scheme with ordered single-select categories, multi-tier
 * access levels, incident severity ratings, risk triage workflows, etc.
 *
 * Attribute: `data-ezclassify-controller="decisionflow"`. Config, on that host:
 *
 * - `data-ezclassify-decisionflow-categories`: JSON array (or comma or space
 *   list) of category IDs in step order. Absent, the flow walks every category
 *   of the scopes it names, in the order the marking writes them.
 * - `data-ezclassify-scope`: the scope ids the flow walks, space-separated.
 *   Absent, the scheme's default scope.
 *
 * Order: a flow walks its scopes in the scheme's declaration order, and each
 * scope's steps in the order the field's output for that scope writes their
 * categories, so the steps read the way the marking does. The order is the
 * output's own, as the scheme publishes it, never the current marking's, so the
 * dots never reorder while the author answers. A category the output does not
 * write comes after the written ones, in declaration order, and so does every
 * category of an output the scheme publishes no order for. A dependent step
 * shows only while the choice that heads it is made, in its written place.
 *
 * Opening a flow the author has chosen nothing in yet goes to the first step
 * with no value at all. A step a default already answers is passed over, reads
 * as inferred, and its dot still goes to it.
 *
 * Scopes: each step belongs to the scope its category declares, and every
 * engine call made for a step (its options, the choices it accepts) is made on
 * that scope's surface. A flow whose steps span more than one scope groups its
 * dots by scope, judges the marking on each scope's surface, and gives each
 * scope a value of its own, written in that scope's own output with what is
 * wrong there. A flow of one scope has one unlabeled value.
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
    AssertionRef,
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
import type { EzClassifyState } from '../store/ezclassify-store';
import {
    fieldOutputFor,
    fieldScopeOf,
    inWrittenOrder,
    writtenConcept,
} from '../written-concept';
import type { ShownForm } from '../written-facts';
import { renderViewRefused } from '../render-refusal';
import { writtenValue } from '../value-spelling';
import { t } from '../i18n';
import { derivedAssertion } from '../assertion-identity';
import { unreviewedAdditions } from './status-mark';
import { locateTokenSpans } from '../token-tree/token-tree';
import {
    categoriesByScope,
    factsInScopes,
    inDeclarationOrder,
    parseScopeList,
    scopeLabel,
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
    /**
     * What the option says: the concept as the flow writes it on the step's
     * scope (see written-concept.ts). A value-taking concept's name.
     */
    label: string;
    /** The concept's name, for its tooltip, description and value box. */
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
    /**
     * True = single-select (one pressed toggle); false = multi-select
     * (checkbox).
     */
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

    /** The flow's x clears every scope it writes, not one step. */
    protected override clearLabel(): string {
        return t('aria.clearWholeMarking');
    }
    /** The header row: the dots, the step header and the suite's chrome. */
    private headerEl!: HTMLDivElement;
    /** The dots, one per visible step. */
    private dotsEl!: HTMLDivElement;
    /** "3 of 8 · Dissemination Control", while the step is open. */
    private titleEl!: HTMLDivElement;
    /** A flow of one scope's line, in the header while the flow is at rest. */
    private restEl!: HTMLDivElement;
    /** The header's line: the dots, then the step's title or the rest line. */
    private headerMainEl!: HTMLDivElement;
    /** The open step: its options between the previous and next arrows. */
    private stepEl!: HTMLDivElement;
    /** A flow of several scopes: each scope's caption and value, under the step. */
    private valuesEl!: HTMLDivElement;
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
    /**
     * The furthest step the author has reached in this flow. A step before it
     * has been passed; a step at or after it has not been reached yet.
     */
    private furthestStep = 0;
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
     * engine offers it an option or it holds a choice. While the flow is open,
     * the step the author is on stays while the engine answers; at rest the
     * author is on no step, so the dots are the engine's answer alone.
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
                (this.open && step.categoryId === this._currentCategoryId) ||
                offered.has(step.categoryId) ||
                this.assertions.some((a) => a.categoryId === step.categoryId) ||
                this.pendingText?.categoryId === step.categoryId
            );
        });
    }

    private currentStep = 0;
    /**
     * Set when the flow opened before the engine said which steps it offers:
     * the flow goes to the step the author is needed at once it has.
     */
    private placeOnOptions = false;
    /**
     * Category ID at the active step: the source of truth when step indices
     * shift.
     */
    private _currentCategoryId = '';
    private flowEl!: HTMLDivElement;
    private announcer!: HTMLDivElement;
    /** When true, render() focuses the active option after rebuilding the DOM. */
    private _restoreFocusAfterRender = false;
    /** When true, render() focuses the chosen option's value field instead. */
    private _focusValueField = false;
    /**
     * Each value field's line for its expected form, used when the box is too
     * narrow.
     */
    private readonly formatHints = new WeakMap<HTMLInputElement, HTMLElement>();
    /** Refits the open value fields' expected form as their boxes resize. */
    private formatObserver: ResizeObserver | null = null;
    /** Under the step's options: why the option in question is unavailable. */
    private reasonEl!: HTMLDivElement;
    /** The concept whose reason shows, if any. */
    private reasonConcept: string | null = null;
    /** Reasons already asked, by step and concept, for the facts below. */
    private readonly blockReasons = new Map<string, string>();
    private reasonsFacts = '';
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
    /**
     * Each scope's writing, for a flow of several, keyed by the facts written,
     * with the form each was written in and what writing it did.
     */
    private result: {
        key: string;
        texts: Map<string, string>;
        forms: ShownForm[];
    } | null = null;
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
        this.pressingOutside = true;
    };
    /** A press outside the flow is down and has not clicked yet. */
    private pressingOutside = false;
    /**
     * A press anywhere else puts the flow at rest, whatever its errors. It
     * closes once the press has landed, on its click, so the step folding away
     * never moves what the press was aimed at out from under it.
     */
    private readonly outsideClick = (event: Event) => {
        this.pressingOutside = false;
        // The path the click took, not where its target is now: a press on a
        // dot rebuilds the dots before the click reaches the document.
        if (event.composedPath().includes(this.flowEl)) return;
        this.setOpen(false);
    };
    /** Focus left the flow: the step closes and the flow is one line again. */
    private readonly focusOut = (event: FocusEvent) => {
        // A render replaces the focused element and puts focus back itself.
        if (this.rendering) return;
        const next = event.relatedTarget as Node | null;
        if (next && this.flowEl.contains(next)) return;
        this.setPreview(null);
        // A press elsewhere closes the flow on its click (see outsideClick).
        if (this.pressingOutside) return;
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
        if (this.placeOnOptions) {
            this.placeOnOptions = false;
            if (this.open && this.placeWhereNeeded() && !paint) this.render();
        }
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
        this.assertions = next;
        this.reprocess();
        return true;
    }

    private pick(step: StepDef, conceptId: string, action: () => void): void {
        this.beginUserEdit();
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
                        label: this.writtenAs(catId, c.id),
                        name: c.name || c.id,
                        description: c.definition ?? '',
                        textInput: c.textInput ?? undefined,
                    })),
                    requiredHeader: headersByCategory.get(catId),
                    scope: cat ? this.stepScopeOf(cat, listed) : undefined,
                };
            })
            // Scopes in declaration order, each keeping the order resolved
            // above: Array.prototype.sort is stable.
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
        this.restEl = document.createElement('div');
        this.restEl.className = 'ez-decision-flow__rest';
        // One row of dots, and for a flow of one scope its marking beside
        // them, under them when it does not fit. The chrome keeps the row's
        // trailing end. Opening the flow changes none of it.
        const headerMain = document.createElement('div');
        headerMain.className = 'ez-decision-flow__header-main';
        headerMain.append(this.dotsEl, this.restEl);
        this.headerMainEl = headerMain;
        this.headerEl.appendChild(headerMain);
        this.stepEl = document.createElement('div');
        this.stepEl.className = 'ez-decision-flow__step';
        this.stepEl.hidden = true;
        this.reasonEl = document.createElement('div');
        this.reasonEl.className = 'ez-decision-flow__option-reason';
        this.reasonEl.setAttribute('role', 'status');
        this.reasonEl.hidden = true;
        this.valuesEl = document.createElement('div');
        this.valuesEl.className = 'ez-decision-flow__values';
        this.previewEl = document.createElement('div');
        this.previewEl.className = 'ez-decision-flow__dot-preview';
        this.previewEl.setAttribute('aria-hidden', 'true');
        this.previewEl.hidden = true;
        this.flowEl.append(
            this.headerEl,
            this.stepEl,
            this.valuesEl,
            this.previewEl,
        );
        this.container.appendChild(this.flowEl);
        this.mountSuiteChrome(this.headerEl);
        // The line under each value carries the report, so the list under
        // the flow stays aside.
        this.setReportInField(true);

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
        // Focus inside the flow opens its step; leaving closes it. A way to a
        // missing step opens the flow at that step when it is pressed, not
        // when a press focuses it, which would rebuild it out from under the
        // press.
        this.flowEl.addEventListener('focusin', (event) => {
            const target = event.target as Element;
            if (
                !this.suiteChrome?.element.contains(target) &&
                !target.closest?.('.ez-decision-flow__missing')
            )
                this.setOpen(true);
        });
        this.flowEl.addEventListener('focusout', this.focusOut);
        this.flowEl.addEventListener('pointerdown', (event) => {
            this.pointerActive = true;
            this.lastPointerType = event.pointerType;
            // A press on a dot or an option moves on from what the status
            // mark's list explained, even when it changes no value.
            if (!this.suiteChrome?.element.contains(event.target as Node))
                this.dismissSuiteStatusPopover();
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
        document.addEventListener('click', this.outsideClick);
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
        // The steps the flow shows are the engine's answer, at rest as when
        // open, so its dots do not change when it opens.
        this.requestOptions();
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
        // Asked in the scheme's order, as a flow of one scope asks: the order
        // the flow walks its steps in is its own, not part of the question.
        const steps = new Map(
            this._allSteps
                .filter((s) => s.scope === scope)
                .map((s) => [s.categoryId, s]),
        );
        const suggestions = await this.offeredBeside(
            live ?? [],
            { outputFormat: this.outputFor(scope), surface: scope },
            this.scheme.categories.flatMap((c) => {
                const step = steps.get(c.id);
                return step
                    ? [{ id: step.categoryId, single: step.single }]
                    : [];
            }),
        );
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
        super.onAssertionsChanged();
        // Whoever changed the marking, the steps on offer follow it.
        this.requestOptions();
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
        // An error belongs to the category it names, or to the categories
        // of the concepts it asks for (a rule that wants one of a step's
        // choices), so the step it asks about reads as required.
        // Every step counts, not only those showing: a judgment can land
        // before the engine offers the step it asks about.
        const categoryOf = new Map<string, string>();
        for (const step of this._allSteps)
            for (const concept of step.concepts)
                categoryOf.set(concept.id, step.categoryId);
        for (const error of errors) {
            const categories = new Set<string>();
            if (error.categoryId) categories.add(error.categoryId);
            for (const conceptId of error.affectedConcepts ?? []) {
                const categoryId = categoryOf.get(conceptId);
                if (categoryId) categories.add(categoryId);
            }
            for (const categoryId of categories) {
                const list = this.errorsByCategory.get(categoryId) ?? [];
                list.push(error.message);
                this.errorsByCategory.set(categoryId, list);
            }
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
            this.renderValues();
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
        return fieldOutputFor(this.schemeMeta, this.writingField(), scope);
    }

    /**
     * How the flow writes a concept held in a category: what its options, its
     * dots and its status mark name the concept by (see written-concept.ts).
     */
    private writtenAs(categoryId: string, conceptId: string): string {
        const writing = this.conceptWriting();
        return writing
            ? writtenConcept(writing, { categoryId, conceptId })
            : conceptId;
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
        this.formatObserver?.disconnect();
        this.destroyClearButton();
        this.removeRuleErrors();
        this._destroyed = true;
        for (const catalog of this.catalogs.values()) catalog.dispose();
        this.stopObservingLock?.();
        document.removeEventListener('pointerdown', this.outsidePointer);
        document.removeEventListener('click', this.outsideClick);
        document.removeEventListener('pointerup', this.releasePointer);
        document.removeEventListener('pointercancel', this.finishPointer);
        this.flowEl?.removeEventListener('focusout', this.focusOut);
        this.container.innerHTML = '';
    }

    /**
     * Drop a value-taking choice still waiting for its value. The flow stays on
     * its step: a clear or an undo changes the marking, not where the author
     * is.
     */
    protected override discardDraft(): void {
        this.pendingText = null;
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
            this.renderStep();
            this.renderValues();
            this.flowEl.toggleAttribute('data-ezclassify-locked', this.locked);
            // A rebuilt dot keeps its label showing.
            if (this.previewIndex !== null) this.setPreview(this.previewIndex);

            // Restore keyboard focus after DOM rebuild. Set _restoreFocusAfterRender before
            // any action that calls render() as a side-effect (concept selection, Next/Back).
            // Initial setup render leaves the flag false so mount doesn't steal page focus.
            if (this._focusValueField) {
                this._focusValueField = false;
                this._restoreFocusAfterRender = false;
                this.flowEl
                    .querySelector<HTMLInputElement>(
                        '.ez-decision-flow__value-option .ez-decision-flow__text-field',
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
                    // Toggle group: restore to the last-interacted option, or
                    // the roving-tabindex owner (the chosen option or first)
                    const target =
                        (this._lastFocusConceptId
                            ? this.flowEl.querySelector<HTMLElement>(
                                  `[aria-pressed][data-concept-id="${this._lastFocusConceptId}"]`,
                              )
                            : null) ??
                        this.flowEl.querySelector<HTMLElement>(
                            '[aria-pressed][tabindex="0"]',
                        );
                    target?.focus();
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
                            `[aria-pressed][data-concept-id="${prevConceptId}"], [role="checkbox"][data-concept-id="${prevConceptId}"]`,
                        ) ??
                        this.flowEl.querySelector<HTMLElement>(
                            '[aria-pressed][tabindex="0"]',
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
        return fieldScopeOf(category, { scopes: listed }, this.schemeMeta);
    }

    /**
     * The categories to walk: the ones the options or the host list, in the
     * order they list them, else every category that belongs to a walked scope,
     * scope by scope, each scope's in the order the flow writes them.
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
        const field = this.writingField();
        if (listed.length === 0)
            return inWrittenOrder(
                this.schemeMeta,
                field,
                undefined,
                categories.map((c) => c.id),
            );
        return categoriesByScope(categories, listed, this.schemeMeta).flatMap(
            (group) =>
                inWrittenOrder(
                    this.schemeMeta,
                    field,
                    group.scope,
                    group.categories.map((c) => c.id),
                ),
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

    /** The concept view the step's scope output writes its category in. */
    private viewOf(step: StepDef): string | undefined {
        return viewForCategory(
            getPublicFormatLayout(this.schemeMeta, this.outputFor(step.scope)),
            step.categoryId,
        );
    }

    /** A stored value, spelled the way the step's scope output writes it. */
    private shownValue(
        step: StepDef,
        concept: ConceptDef,
        value: string,
    ): string {
        return writtenValue(
            value,
            concept.textInput?.encoding,
            this.viewOf(step),
        );
    }

    /**
     * What a step holds, in words: its choices as the step's scope writes them,
     * or empty when it holds none.
     */
    private selectionText(step: StepDef): string {
        // A typed value shows the way the step's scope writes it, not in the
        // spelling it is stored in.
        const view = this.viewOf(step);
        return this.assertions
            .filter((a) => a.categoryId === step.categoryId)
            .map((a) => {
                const concept = step.concepts.find((c) => c.id === a.conceptId);
                if (concept?.textInput && a.value)
                    return `${concept.name}: ${writtenValue(
                        a.value,
                        concept.textInput.encoding,
                        view,
                    )}`;
                return concept?.label ?? a.conceptId;
            })
            .join(', ');
    }

    /**
     * Whether a step holds something and all of it is derived (a default, a
     * rule, another choice that includes it): the author chose none of it, so
     * its dot reads as inferred.
     */
    private onlyDerived(step: StepDef): boolean {
        if (this.pendingText?.categoryId === step.categoryId) return false;
        const held = this.assertions.filter(
            (a) => a.categoryId === step.categoryId,
        );
        return held.length > 0 && held.every((a) => derivedAssertion(a));
    }

    /** Whether everything a step holds is a typed value. */
    private holdsOnlyValues(step: StepDef): boolean {
        const held = this.assertions.filter(
            (a) => a.categoryId === step.categoryId,
        );
        return (
            held.length > 0 &&
            held.every(
                (a) =>
                    a.value !== undefined &&
                    !!step.concepts.find((c) => c.id === a.conceptId)
                        ?.textInput,
            )
        );
    }

    /**
     * A step's state at a glance: answered; missing, when the engine asks for
     * an answer there; optional and unset; or unset.
     */
    private stepState(
        step: StepDef,
    ): 'answered' | 'missing' | 'optional' | 'unset' {
        if (this.chosenIn(step).size > 0) return 'answered';
        // A step is required when its category is, or when the engine asks
        // for it now, so its dot, its label and its error say the same thing.
        const asked = this.errorsByCategory.has(step.categoryId);
        if (!step.required && !asked) return 'optional';
        // While the flow is open, a step the author has not reached yet is
        // required, not an error: it becomes one once passed without an
        // answer, or when the flow goes to rest.
        if (!this.reachedPast(step)) return 'unset';
        return asked || this.errorsIn(step.scope).length > 0
            ? 'missing'
            : 'unset';
    }

    /**
     * Whether a step's missing answer is due: always at rest, and while the
     * flow is open once the author has passed the step.
     */
    private reachedPast(step: StepDef): boolean {
        if (!this.open) return true;
        const index = this.steps.indexOf(step);
        return index >= 0 && index < this.furthestStep;
    }

    /**
     * The engine's messages the flow holds back while it is open: those that
     * ask for an answer to a step the author has not passed yet, including the
     * step they are on while its value is still being typed.
     */
    private heldBack(): Set<string> {
        const held = new Set<string>();
        if (!this.open) return held;
        for (const step of this.steps) {
            const stated = this.assertions.some(
                (a) => a.categoryId === step.categoryId,
            );
            if (stated || this.reachedPast(step)) continue;
            for (const message of this.errorsByCategory.get(step.categoryId) ??
                [])
                held.add(message);
        }
        return held;
    }

    /** Bring each dot's state and label up to date in place, keeping focus. */
    private refreshDots(): void {
        for (const dot of this.dotsEl.querySelectorAll<HTMLElement>(
            '.ez-decision-flow__step-dot',
        )) {
            const index = Number(dot.dataset.index);
            const step = this.steps[index];
            if (!step) continue;
            dot.dataset.state = this.stepState(step);
            dot.toggleAttribute('data-inferred', this.onlyDerived(step));
            this.markCurrent(dot, index);
            dot.setAttribute(
                'aria-label',
                `Step ${index + 1} of ${this.steps.length}, ${this.dotLabel(step)}`,
            );
        }
    }

    /** The open step's dot is current; at rest no dot is. */
    private markCurrent(dot: HTMLElement, index: number): void {
        const current = this.open && index === this.currentStep;
        dot.toggleAttribute('data-current', current);
        if (current) dot.setAttribute('aria-current', 'step');
        else dot.removeAttribute('aria-current');
    }

    /**
     * A dot's label: the category and its selections, or why it has none. A
     * step that holds only typed values names each by its choice and value
     * ("Specific Date: 20481231").
     */
    private dotLabel(step: StepDef): string {
        const state = this.stepState(step);
        const held = this.selectionText(step);
        if (state === 'answered' && held && this.onlyDerived(step))
            return `${step.label}: ${held}${t('aria.inferredSuffix')}`;
        if (state === 'answered' && held && this.holdsOnlyValues(step))
            return held;
        const said =
            state === 'answered'
                ? held || 'chosen'
                : state === 'missing'
                  ? 'needs an answer'
                  : state === 'optional'
                    ? `optional, ${NOT_SET}`
                    : `required, ${NOT_SET}`;
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
                // The scopes' dots share one row, a gap between scopes. The
                // scope's name is the group's accessible name, its dots'
                // labels and its value's caption, not a word in the row.
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
        dot.toggleAttribute('data-inferred', this.onlyDerived(step));
        dot.dataset.index = String(i);
        dot.dataset.categoryId = step.categoryId;
        this.markCurrent(dot, i);
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
        this.previewEl.textContent =
            this.multiScope && step.scope
                ? `${scopeLabel(step.scope, this.schemeMeta)} · ${this.dotLabel(step)}`
                : this.dotLabel(step);
        this.previewEl.dataset.state = this.stepState(step);
        this.previewEl.hidden = false;
        // Centered above the dot, so it never covers the step under the
        // header, and under it only where above would leave the viewport or a
        // clipping ancestor; then pulled back inside the viewport.
        const frame = this.flowEl.getBoundingClientRect();
        const at = dot.getBoundingClientRect();
        this.previewEl.style.left = '0px';
        const height = this.previewEl.getBoundingClientRect().height;
        const above = at.top - height - 4;
        const top = above >= visibleTop(this.flowEl) ? above : at.bottom + 4;
        this.previewEl.style.top = `${top - frame.top}px`;
        const width = this.previewEl.getBoundingClientRect().width;
        const viewport =
            document.documentElement.clientWidth || window.innerWidth;
        const margin = 8;
        let left = at.left + at.width / 2 - width / 2;
        left = Math.min(left, viewport - margin - width);
        left = Math.max(left, margin);
        this.previewEl.style.left = `${left - frame.left}px`;
    }

    /**
     * Open or close the current step under the header. Opening adds the step at
     * the bottom and moves nothing above it.
     */
    private setOpen(open: boolean): void {
        if (this.open === open || !this.stepEl) return;
        const shown = this.shownCategories();
        this.open = open;
        this.stepEl.hidden = !open;
        this.flowEl.toggleAttribute('data-open', open);
        // Opening holds back what the author has not reached yet; at rest
        // everything missing shows. The open step's scope reads as current
        // on its caption.
        if (open) {
            this.openWhereNeeded();
            this.furthestStep = Math.max(this.furthestStep, this.currentStep);
        } else this.placeOnOptions = false;
        // Going to rest lets go of a step shown only because the author was
        // on it; the dots are drawn again only then, so a dot pressed to open
        // the flow stays in place for its click.
        if (this.shownCategories() !== shown) {
            this.render();
            return;
        }
        this.refreshDots();
        this.renderValues();
    }

    /** The categories of the steps showing, as one key. */
    private shownCategories(): string {
        return this.steps.map((step) => step.categoryId).join(' ');
    }

    /**
     * Opening a flow the author has chosen nothing in yet goes to the first
     * step with no value at all, past any a default already answers. Only the
     * step is drawn again here, so a dot pressed to open the flow is still
     * there for its click. Opened before the engine has said which steps it
     * offers, the flow goes there once it has, unless the author has moved by
     * then.
     */
    private openWhereNeeded(): void {
        if (this.offeredCategories === null) {
            this.placeOnOptions = true;
            return;
        }
        if (this.placeWhereNeeded()) this.renderStep();
    }

    /**
     * Make the first offered step with no value current, when the author has
     * chosen nothing yet.
     *
     * @returns Whether the current step changed
     */
    private placeWhereNeeded(): boolean {
        if (
            this.pendingText ||
            this.assertions.some((a) => !derivedAssertion(a))
        )
            return false;
        const offered = this.offeredCategories;
        const target = this.steps.find(
            (step) =>
                this.chosenIn(step).size === 0 &&
                (!offered || offered.has(step.categoryId)),
        );
        if (!target || target.categoryId === this._currentCategoryId)
            return false;
        this._currentCategoryId = target.categoryId;
        // The step left may have shown only because the author was on it.
        this.currentStep = this.steps.indexOf(target);
        return true;
    }

    /** The step under the header: its title, its options and the arrows. */
    private renderStep(): void {
        this.renderTitle();
        this.stepEl.replaceChildren(this.titleEl);
        this.renderNavigation('start');
        this.renderCurrentStep();
        this.renderNavigation('end');
        this.stepEl.hidden = !this.open;
        this.fitFormats();
    }

    /** The open step's first line: "3 of 8 · Dissemination Control". */
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
            // Said to assistive technology; the toggles' check marks show it.
            hint.className = 'ez-decision-flow__question-desc ez-sr-only';
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
            optionsEl.setAttribute('role', 'group');
            this.renderToggleOptions(step, optionsEl);
        } else {
            optionsEl.setAttribute('role', 'group');
            this.renderCheckboxOptions(step, optionsEl);
        }

        q.appendChild(optionsEl);
        // The reason line outlives a render, so a reason showing keeps showing
        // while its option is still ruled out.
        const blocked = new Set(
            this.isTextInputStep(step)
                ? []
                : this.stepOptions(step)
                      .filter((o) => o.blocked)
                      .map((o) => o.concept.id),
        );
        if (this.reasonConcept !== null && !blocked.has(this.reasonConcept))
            this.hideBlockReason();
        q.appendChild(this.reasonEl);
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

    /**
     * The options of a step the marking holds only because the engine derived
     * them (a rule added it, another choice includes it, a default), each with
     * what says why: "Included by" the held choice whose members it is, when
     * one is. The author did not choose them, so they never look chosen.
     */
    private inferredIn(step: StepDef): Map<string, string | null> {
        const held = this.assertions.filter(
            (a) => a.categoryId === step.categoryId,
        );
        const stated = new Set(
            held.filter((a) => !derivedAssertion(a)).map((a) => a.conceptId),
        );
        const inferred = new Map<string, string | null>();
        for (const a of held) {
            if (stated.has(a.conceptId) || !derivedAssertion(a)) continue;
            const includer = this.assertions.find((other) =>
                this.scheme.concepts
                    .find((c) => c.id === other.conceptId)
                    ?.members?.includes(a.conceptId),
            );
            inferred.set(
                a.conceptId,
                includer
                    ? t('flow.includedBy').replace('{choice}', () =>
                          this.writtenAs(
                              includer.categoryId,
                              includer.conceptId,
                          ),
                      )
                    : null,
            );
        }
        return inferred;
    }

    /** Draw an option the marking holds only by derivation (see inferredIn). */
    private markInferred(btn: HTMLButtonElement): void {
        btn.classList.add('ez-decision-flow__option--inferred');
        btn.setAttribute(
            btn.hasAttribute('aria-pressed') ? 'aria-pressed' : 'aria-checked',
            'false',
        );
        btn.setAttribute(
            'aria-label',
            `${btn.textContent ?? ''}${t('aria.inferredSuffix')}`,
        );
    }

    /**
     * A single-choice step's options: toggle buttons, at most one pressed.
     * Pressing an unpressed option chooses it in place of the step's other
     * choice and moves on; pressing the pressed one un-chooses it and stays.
     */
    private renderToggleOptions(step: StepDef, optionsEl: HTMLElement): void {
        const chosen = this.chosenIn(step);
        const inferred = this.inferredIn(step);
        const selected = [...chosen][0];
        const options = this.stepOptions(step);
        const first = options.find((o) => !o.blocked)?.concept.id;

        for (const { concept, blocked } of options) {
            // An option the marking holds only by derivation is not pressed:
            // pressing it makes it the author's own choice.
            const pressed =
                concept.id === selected && !inferred.has(concept.id);
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.disabled = this.locked;
            btn.className = 'ez-decision-flow__option';
            btn.setAttribute('aria-pressed', pressed ? 'true' : 'false');
            btn.tabIndex =
                concept.id === selected || (!selected && concept.id === first)
                    ? 0
                    : -1;
            btn.textContent = concept.label;
            btn.dataset.conceptId = concept.id;
            this.describeOption(
                btn,
                step,
                concept,
                optionsEl,
                inferred.get(concept.id),
            );
            if (inferred.has(concept.id)) this.markInferred(btn);
            if (blocked) this.blockOption(btn, step, concept);

            btn.addEventListener('click', () => {
                if (
                    this._destroyed ||
                    this.enhancedInput?.matches(':disabled, [readonly]')
                )
                    return;
                if (blocked) {
                    void this.showBlockReason(step, concept);
                    return;
                }
                // Restore focus to this option after the DOM rebuild that follows reprocess().
                this._restoreFocusAfterRender = true;
                this._lastFocusConceptId = concept.id;
                this.pick(step, concept.id, () => {
                    if (concept.textInput)
                        this.chooseValueConcept(step, concept);
                    else if (pressed)
                        this.toggleConcept(step.categoryId, concept.id, true);
                    // A plain choice answers the step, so the flow moves on;
                    // a value-taking one waits for its value.
                    else
                        void this.selectConcept(
                            step.categoryId,
                            concept.id,
                        ).then(() => void this.advanceFrom(step.categoryId));
                    announce(
                        this.announcer,
                        pressed
                            ? `Deselected ${concept.label}`
                            : `Selected ${concept.label}`,
                    );
                });
            });

            btn.addEventListener('keydown', (e: KeyboardEvent) => {
                const toggles = Array.from(
                    optionsEl.querySelectorAll<HTMLButtonElement>(
                        '[aria-pressed]',
                    ),
                );
                const idx = toggles.indexOf(btn);
                let next = -1;

                if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
                    next = (idx + 1) % toggles.length;
                } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
                    next = (idx - 1 + toggles.length) % toggles.length;
                }

                if (next >= 0) {
                    e.preventDefault();
                    // Arrow keys move focus only: no selection commit. The user presses
                    // Enter or Space (which triggers a click event on the focused button)
                    // to choose or un-choose.
                    toggles.forEach((o, j) => {
                        o.tabIndex = j === next ? 0 : -1;
                    });
                    toggles[next].focus();
                }
            });

            optionsEl.appendChild(
                concept.textInput && chosen.has(concept.id)
                    ? this.valueOption(step, concept, btn)
                    : btn,
            );
        }
    }

    /**
     * The options a step shows: those the engine offers, and those it holds
     * back only because they conflict with what the marking holds, which show
     * blocked with the reason. An option under a parent concept stays out until
     * one of its parents is chosen, and one outside the step's scope never
     * shows.
     */
    private stepOptions(
        step: StepDef,
    ): { concept: ConceptDef; blocked: boolean }[] {
        const offered = new Set(this.visibleConcepts(step).map((c) => c.id));
        if (!this.catalogReady || !this.catalogFor(step))
            return step.concepts.map((concept) => ({
                concept,
                blocked: false,
            }));
        const held = new Set(this.assertions.map((a) => a.conceptId));
        return step.concepts.flatMap<{
            concept: ConceptDef;
            blocked: boolean;
        }>((concept) => {
            if (offered.has(concept.id)) return [{ concept, blocked: false }];
            const view = this.scheme.concepts.find((c) => c.id === concept.id);
            const parents = view?.parents ?? [];
            const inScope =
                !step.scope ||
                !view?.scopes ||
                view.scopes.includes(step.scope);
            return inScope &&
                (parents.length === 0 || parents.some((p) => held.has(p)))
                ? [{ concept, blocked: true }]
                : [];
        });
    }

    /**
     * An option's tooltip and description: the concept's name, when the option
     * does not already read as it, and what the concept means.
     */
    private describeOption(
        btn: HTMLButtonElement,
        step: StepDef,
        concept: ConceptDef,
        optionsEl: HTMLElement,
        why?: string | null,
    ): void {
        const lines = [
            why ?? '',
            concept.name !== concept.label ? concept.name : '',
            concept.description,
        ].filter(Boolean);
        if (lines.length === 0) return;
        btn.title = lines.join('\n');
        const description = document.createElement('span');
        description.hidden = true;
        description.id = `df-desc-${step.categoryId}-${concept.id}`;
        description.textContent = lines
            .map((line) => (/[.!?]$/.test(line) ? line : `${line}.`))
            .join(' ');
        optionsEl.appendChild(description);
        btn.setAttribute('aria-describedby', description.id);
    }

    /**
     * An option the marking's current choices rule out: it stays in its place,
     * unavailable, and says why on hover, focus or a tap. Choosing it never
     * takes another choice away.
     */
    private blockOption(
        btn: HTMLButtonElement,
        step: StepDef,
        concept: ConceptDef,
    ): void {
        btn.setAttribute('aria-disabled', 'true');
        btn.dataset.blocked = '';
        const show = () => void this.showBlockReason(step, concept);
        const hide = () => {
            if (this.reasonConcept === concept.id) this.hideBlockReason();
        };
        btn.addEventListener('pointerenter', (event) => {
            if (event.pointerType !== 'touch') show();
        });
        btn.addEventListener('pointerleave', (event) => {
            if (event.pointerType !== 'touch') hide();
        });
        btn.addEventListener('focus', show);
        btn.addEventListener('blur', hide);
    }

    /** Show why `concept` is unavailable, under the step's options. */
    private async showBlockReason(
        step: StepDef,
        concept: ConceptDef,
    ): Promise<void> {
        const facts = this.factsKey();
        if (facts !== this.reasonsFacts) {
            this.reasonsFacts = facts;
            this.blockReasons.clear();
        }
        const key = `${step.categoryId}\u0000${concept.id}`;
        this.reasonConcept = concept.id;
        const known = this.blockReasons.get(key);
        this.reasonEl.hidden = false;
        this.reasonEl.textContent = known
            ? `${concept.label} is not available: ${known}`
            : '';
        if (known) return;
        let reason: string;
        try {
            reason = await this.blockReason(step, concept);
        } catch {
            reason = t('composer.unavailable');
        }
        if (this._destroyed || facts !== this.reasonsFacts) return;
        this.blockReasons.set(key, reason);
        if (this.reasonConcept === concept.id)
            this.reasonEl.textContent = `${concept.label} is not available: ${reason}`;
    }

    private hideBlockReason(): void {
        this.reasonConcept = null;
        this.reasonEl.hidden = true;
        this.reasonEl.textContent = '';
    }

    /**
     * Why the engine rules out `concept` beside the marking's current choices,
     * in its own words: what it says about the marking with the concept added
     * that it does not say about the marking now.
     */
    private async blockReason(
        step: StepDef,
        concept: ConceptDef,
    ): Promise<string> {
        const stated = statedAssertions(this.assertions).filter(
            (a) => !(step.single && a.categoryId === step.categoryId),
        );
        const result = await Promise.resolve(
            this.callProcess('', {
                outputFormat: this.outputFor(step.scope),
                assertions: [
                    ...stated,
                    {
                        conceptId: concept.id,
                        categoryId: step.categoryId,
                        confidence: 'certain',
                        source: 'user',
                    },
                ],
                context: this.getProcessingContext(),
                ...(step.scope ? { surface: step.scope } : {}),
            }),
        );
        const fresh = (message: string) => !this.allErrors.includes(message);
        const errors = (result.errors ?? []).filter((e) => fresh(e.message));
        const fixes = result.appliedFixes ?? [];
        const touches = (refs: readonly AssertionRef[] | undefined) =>
            (refs ?? []).some((ref) => ref.conceptId === concept.id);
        return (
            errors.find((e) => e.affectedConcepts?.includes(concept.id))
                ?.message ??
            fixes.find((f) => touches(f.remove) || touches(f.add))?.message ??
            fixes.find((f) => (f.remove ?? []).length > 0)?.message ??
            errors[0]?.message ??
            t('composer.unavailable')
        );
    }

    /**
     * True when every visible concept in the step accepts a user-typed value
     * (text_input).
     */
    private isTextInputStep(step: StepDef): boolean {
        const visible = this.visibleConcepts(step);
        return visible.length > 0 && visible.every((c) => c.textInput != null);
    }

    /**
     * A step of value-taking concepts. One concept's box is the whole step,
     * with no label of its own; several each carry their concept's name.
     */
    private renderTextInputOptions(
        step: StepDef,
        optionsEl: HTMLElement,
    ): void {
        const concepts = this.visibleConcepts(step).filter((c) => c.textInput);
        const named = concepts.length > 1;
        for (const concept of concepts) {
            const { input, after } = this.valueField(step, concept, false);
            const wrap = document.createElement('div');
            wrap.className = 'ez-decision-flow__text-field-wrap';
            if (named) {
                const box = document.createElement('div');
                box.className = 'ez-decision-flow__value-box';
                const name = document.createElement('label');
                name.className = 'ez-decision-flow__value-name';
                name.htmlFor = input.id;
                name.textContent = concept.name;
                box.append(name, input);
                wrap.append(box, ...after);
            } else {
                wrap.append(input, ...after);
            }
            optionsEl.appendChild(wrap);
        }
    }

    /**
     * A chosen value-taking option: its own box in its place among the options,
     * the concept's name a small label on the box (the option itself, still the
     * choice) and the value under it.
     */
    private valueOption(
        step: StepDef,
        concept: ConceptDef,
        btn: HTMLButtonElement,
    ): HTMLElement {
        const option = document.createElement('div');
        option.className = 'ez-decision-flow__value-option';
        const box = document.createElement('div');
        box.className = 'ez-decision-flow__value-box';
        btn.classList.add('ez-decision-flow__value-name');
        const { input, after } = this.valueField(step, concept, true);
        box.append(btn, input);
        option.append(box, ...after);
        return option;
    }

    /**
     * A value-taking concept's input. Its accessible name is the concept's
     * field label; the form it expects shows once, in the empty box, or as a
     * line under the box when it does not fit there, and after typing only in
     * an error. A value the author chose from a step's options wants its value
     * before the flow leaves it.
     */
    private valueField(
        step: StepDef,
        concept: ConceptDef,
        chosen: boolean,
    ): { input: HTMLInputElement; after: HTMLElement[] } {
        const ti = concept.textInput!;
        const assertion = this.assertions.find(
            (a) =>
                a.conceptId === concept.id && a.categoryId === step.categoryId,
        );
        const pending =
            this.pendingText?.conceptId === concept.id &&
            this.pendingText.categoryId === step.categoryId
                ? this.pendingText
                : null;
        const fieldId = `df-value-${step.categoryId}-${concept.id}`;

        const input = document.createElement('input');
        input.type = 'text';
        input.id = fieldId;
        input.dataset.conceptId = concept.id;
        input.readOnly = this.locked;
        input.className = 'ez-decision-flow__text-field';
        input.setAttribute('aria-label', ti.label ?? concept.name);
        input.required = chosen && ti.required !== false;
        applyTextInputAttributes(input, ti);
        input.value = pending
            ? pending.value
            : assertion?.value
              ? this.shownValue(step, concept, assertion.value)
              : '';

        const after: HTMLElement[] = [];
        if (ti.placeholder) {
            const hint = document.createElement('div');
            hint.className = 'ez-decision-flow__text-hint';
            hint.id = `${fieldId}-hint`;
            hint.textContent = ti.placeholder;
            hint.hidden = true;
            this.formatHints.set(input, hint);
            after.push(hint);
        }
        const errorEl = document.createElement('div');
        errorEl.className = 'ez-decision-flow__value-error';
        errorEl.id = `${fieldId}-error`;
        errorEl.setAttribute('role', 'alert');
        after.push(errorEl);

        const showError = (blurred: boolean) => {
            const value = input.value.trim();
            const message =
                value && !input.validity.valid
                    ? `Invalid format. Expected: ${ti.placeholder ?? 'the required value format'}`
                    : !value && input.required && blurred
                      ? 'Required'
                      : '';
            errorEl.textContent = message;
            if (message) input.setAttribute('aria-invalid', 'true');
            else input.removeAttribute('aria-invalid');
        };

        input.addEventListener('input', () => {
            if (
                this._destroyed ||
                this.enhancedInput?.matches(':disabled, [readonly]')
            )
                return;
            showError(false);
            this.fitFormat(input);
            this.enterValue(step, concept, input);
        });
        input.addEventListener('blur', () => showError(true));
        // Enter moves on to the next step. Other keys stay in the field.
        input.addEventListener('keydown', (e) => {
            e.stopPropagation();
            if (e.key === 'Enter') {
                e.preventDefault();
                this.goToStep(this.currentStep + 1);
            }
        });
        showError(false);
        this.fitFormat(input);
        return { input, after };
    }

    /**
     * Show a value field's expected form once: in the empty box when it fits
     * there, or else as the line under the box while the box is empty.
     */
    private fitFormat(input: HTMLInputElement): void {
        const hint = this.formatHints.get(input);
        if (!hint) return;
        const text = hint.textContent ?? '';
        const fits = formatFits(input, text);
        if (fits) input.placeholder = text;
        else input.removeAttribute('placeholder');
        hint.hidden = fits || input.value !== '';
        input.setAttribute(
            'aria-describedby',
            [hint.hidden ? '' : hint.id, `${input.id}-error`]
                .filter(Boolean)
                .join(' '),
        );
    }

    /** Fit each open value field's expected form now and as its box resizes. */
    private fitFormats(): void {
        this.formatObserver?.disconnect();
        const inputs = this.stepEl.querySelectorAll<HTMLInputElement>(
            '.ez-decision-flow__text-field',
        );
        if (inputs.length === 0) return;
        if (!this.formatObserver && typeof ResizeObserver === 'function')
            this.formatObserver = new ResizeObserver((entries) => {
                for (const entry of entries)
                    this.fitFormat(entry.target as HTMLInputElement);
            });
        for (const input of inputs) {
            this.fitFormat(input);
            this.formatObserver?.observe(input);
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
        this.beginUserEdit();
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
     * pending, shown chosen with its value field, until a value is typed. In a
     * single-choice step it replaces the step's other choice. Pressing it again
     * un-chooses it.
     */
    private chooseValueConcept(step: StepDef, concept: ConceptDef): void {
        const held = this.assertions.some(
            (a) =>
                a.categoryId === step.categoryId && a.conceptId === concept.id,
        );
        const pendingHere =
            this.pendingText?.categoryId === step.categoryId &&
            this.pendingText.conceptId === concept.id;
        if (held || pendingHere) {
            // A second press withdraws the choice.
            if (pendingHere) this.pendingText = null;
            if (held) this.toggleConcept(step.categoryId, concept.id, true);
            else this.render();
            return;
        }
        this._focusValueField = true;
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
        for (const previous of replaced)
            this.assertions = this.pickerPort.remove(this.assertions, previous);
        this.reprocess();
    }

    private renderCheckboxOptions(step: StepDef, optionsEl: HTMLElement): void {
        const selectedIds = this.chosenIn(step);
        const inferred = this.inferredIn(step);

        for (const { concept, blocked } of this.stepOptions(step)) {
            // An option the marking holds only by derivation is not checked:
            // pressing it makes it the author's own choice.
            const isChecked =
                selectedIds.has(concept.id) && !inferred.has(concept.id);
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.disabled = this.locked;
            btn.className = 'ez-decision-flow__option';
            btn.setAttribute('role', 'checkbox');
            btn.setAttribute('aria-checked', isChecked ? 'true' : 'false');
            // Checkboxes are independently focusable: no roving tabindex.
            btn.tabIndex = 0;
            btn.textContent = concept.label;
            btn.dataset.conceptId = concept.id;
            this.describeOption(
                btn,
                step,
                concept,
                optionsEl,
                inferred.get(concept.id),
            );
            if (inferred.has(concept.id)) this.markInferred(btn);
            if (blocked) this.blockOption(btn, step, concept);

            btn.addEventListener('click', () => {
                if (
                    this._destroyed ||
                    this.enhancedInput?.matches(':disabled, [readonly]')
                )
                    return;
                if (blocked) {
                    void this.showBlockReason(step, concept);
                    return;
                }
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
                            ? `Deselected ${concept.label}`
                            : `Selected ${concept.label}`,
                    );
                });
            });

            // Space toggles a choice; Enter moves on to the next step.
            btn.addEventListener('keydown', (event: KeyboardEvent) => {
                if (event.key !== 'Enter') return;
                event.preventDefault();
                this.goToStep(this.currentStep + 1);
            });

            optionsEl.appendChild(
                concept.textInput && isChecked
                    ? this.valueOption(step, concept, btn)
                    : btn,
            );
        }
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
        this.placeOnOptions = false;
        this.currentStep = index;
        this.furthestStep = Math.max(this.furthestStep, index);
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
     * What the marking writes, never shortened. A flow of one scope shows it
     * beside the dots. A flow of several shows, under the step, each scope's
     * caption and its value under it, written in the scope's own output: a
     * block of several lines keeps its lines. While the flow is open, the
     * caption of the open step's scope reads as current. Under a value that has
     * something wrong, a line says what: the steps it is missing, each a way to
     * its step, and the engine's other messages.
     */
    private renderValues(): void {
        this.restEl.replaceChildren();
        this.valuesEl.replaceChildren();
        this.valuesEl.hidden = !this.multiScope;
        if (!this.multiScope) {
            this.restEl.appendChild(
                this.valueOf(undefined, this._lastRendered),
            );
            return;
        }
        const key = this.factsKey();
        const texts = this.result?.key === key ? this.result.texts : null;
        const current = this.open
            ? this.steps[this.currentStep]?.scope
            : undefined;
        for (const scope of this.stepScopes) {
            const block = document.createElement('div');
            block.className = 'ez-decision-flow__scope';
            block.dataset.scope = scope;
            const caption = document.createElement('div');
            caption.className = 'ez-decision-flow__scope-caption';
            const name = document.createElement('span');
            name.className = 'ez-decision-flow__scope-name';
            name.textContent = scopeLabel(scope, this.schemeMeta);
            caption.appendChild(name);
            if (scope === current) {
                caption.dataset.current = '';
                caption.setAttribute('aria-current', 'step');
            }
            block.append(caption, this.valueOf(scope, texts?.get(scope) ?? ''));
            this.valuesEl.appendChild(block);
        }
        if (!texts && this.resultWriting !== key) void this.writeResult(key);
    }

    /**
     * A value, whole, breaking only at spaces, its own line ends and its
     * separators, then what is wrong with it, if anything.
     */
    private valueOf(scope: string | undefined, text: string): HTMLElement {
        const wrap = document.createElement('div');
        wrap.className = 'ez-decision-flow__value-wrap';
        const line = document.createElement('div');
        line.className = 'ez-decision-flow__value';
        const shown = document.createElement('span');
        shown.className = 'ez-decision-flow__value-text';
        if (text) writeBreakable(shown, text, this.unreviewedRuns(text));
        else {
            shown.textContent = NOT_SET;
            shown.dataset.empty = '';
        }
        line.appendChild(shown);
        wrap.appendChild(line);
        const problems = this.problemsOf(scope);
        if (problems) {
            line.dataset.invalid = '';
            wrap.appendChild(problems);
        }
        return wrap;
    }

    /**
     * The runs of a value's text that are values a marking rule added and the
     * author has not reviewed yet: drawn inferred until they are.
     */
    private unreviewedRuns(text: string): { start: number; end: number }[] {
        if (!this.suiteChrome) return [];
        const unreviewed = unreviewedAdditions(this.suiteChrome.status);
        return locateTokenSpans(text, this.getTokenTree(), (node) =>
            this.printsToken(node),
        ).filter(
            ({ token }) =>
                !!token.conceptId &&
                unreviewed({
                    categoryId: token.categoryId,
                    conceptId: token.conceptId,
                }),
        );
    }

    /** What the author has reviewed changed: draw the values again. */
    protected override onStatusReviewChange(): void {
        if (this.restEl) this.renderValues();
    }

    /**
     * What is wrong with a scope's value, in words, or null when nothing is:
     * "Missing: " and the steps the engine wants answered, each a button to its
     * step, then each of the engine's other messages on a line of its own.
     * While the flow is open, what the author has not reached yet is not wrong
     * yet.
     */
    private problemsOf(scope: string | undefined): HTMLElement | null {
        const due = this.steps
            .map((step, index) => ({ step, index }))
            .filter(({ step }) => this.stepState(step) === 'missing');
        const missing = due.filter(
            ({ step }) => !this.multiScope || step.scope === scope,
        );
        // A message that asks for a missing step is said by naming the step,
        // under the value of the scope the step belongs to.
        const said = new Set(
            due.flatMap(
                ({ step }) => this.errorsByCategory.get(step.categoryId) ?? [],
            ),
        );
        const others = this.errorsIn(scope).filter((m) => !said.has(m));
        if (missing.length === 0 && others.length === 0) return null;

        const problems = document.createElement('div');
        problems.className = 'ez-decision-flow__problems';
        if (missing.length > 0) {
            const line = document.createElement('div');
            line.className = 'ez-decision-flow__missing';
            line.append('Missing: ');
            missing.forEach(({ step, index }, i) => {
                if (i > 0) line.append(', ');
                const go = document.createElement('button');
                go.type = 'button';
                go.className = 'ez-decision-flow__missing-step';
                go.textContent = step.label;
                go.addEventListener('click', () => {
                    if (this._destroyed) return;
                    this.dotFocus = index;
                    this.setOpen(true);
                    this.goToStep(index);
                });
                line.appendChild(go);
            });
            problems.appendChild(line);
        }
        for (const message of others) {
            const line = document.createElement('div');
            line.className = 'ez-decision-flow__problem';
            line.textContent = message;
            problems.appendChild(line);
        }
        return problems;
    }

    /**
     * The error messages for one scope's line: those the engine reported
     * judging the marking on that scope, for a flow of several; every one for a
     * flow of one.
     */
    private errorsIn(scope: string | undefined): string[] {
        const all =
            !this.multiScope || scope === undefined
                ? this.allErrors
                : (this.errorsByScope.get(scope) ?? []);
        const held = this.heldBack();
        return held.size === 0 ? all : all.filter((m) => !held.has(m));
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
                    async (scope): Promise<[string, string, ShownForm?]> => {
                        const facts = factsInScopes(
                            this.assertions,
                            this.scheme.categories,
                            [scope],
                            meta,
                        );
                        if (facts.length === 0) return [scope, ''];
                        const format = this.outputFor(scope);
                        const write = await Promise.resolve(
                            this.callRender(facts, { format }),
                        );
                        return renderViewRefused(write)
                            ? [scope, '']
                            : [
                                  scope,
                                  write.rendered,
                                  {
                                      formatId: format,
                                      assessment: write.assessment,
                                  },
                              ];
                    },
                ),
            );
            if (this._destroyed || sequence !== this.resultSequence) return;
            this.result = {
                key,
                texts: new Map(
                    written.map(([scope, text]) => [scope, text] as const),
                ),
                forms: written.flatMap(([, , form]) => (form ? [form] : [])),
            };
        } catch {
            if (this._destroyed || sequence !== this.resultSequence) return;
            this.result = { key, texts: new Map(), forms: [] };
        }
        this.resultWriting = null;
        this.renderValues();
        // The mark explains changes to what the scope lines write.
        this.updateSuiteStatusMark();
    }

    /**
     * A flow of several scopes shows each scope's line, written in that scope's
     * own output, once those writings land for the facts it holds.
     */
    protected override shownForms(): ShownForm[] {
        return this.result?.key === this.factsKey() &&
            this.result.forms.length > 0
            ? this.result.forms
            : super.shownForms();
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

/** What a step or a scope line says when the marking holds nothing there. */
const NOT_SET = 'not set';

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

/**
 * The top edge of what is visible of `el`: the viewport's, or the nearest
 * ancestor's that clips its overflow, whichever is lower.
 */
function visibleTop(el: HTMLElement): number {
    let top = 0;
    for (
        let node = el.parentElement;
        node && node !== document.documentElement;
        node = node.parentElement
    ) {
        const style = getComputedStyle(node);
        if (/(hidden|clip|auto|scroll)/.test(style.overflowY))
            top = Math.max(top, node.getBoundingClientRect().top);
    }
    return top;
}

/**
 * Write `text` into `el` so it breaks only at spaces, at its own line ends, and
 * after a run of separator slashes, never inside a token: a marking wraps at
 * its "//" and "/", and a block keeps each of its lines.
 */
function writeBreakable(
    el: HTMLElement,
    text: string,
    inferred: readonly { start: number; end: number }[] = [],
): void {
    let cursor = 0;
    for (const run of [...inferred].sort((a, b) => a.start - b.start)) {
        if (run.start < cursor) continue;
        writeBreakableRun(el, text.slice(cursor, run.start));
        const value = document.createElement('span');
        value.className = 'ez-decision-flow__value-inferred';
        writeBreakableRun(value, text.slice(run.start, run.end));
        el.appendChild(value);
        cursor = run.end;
    }
    writeBreakableRun(el, text.slice(cursor));
}

/** {@link writeBreakable} for one run of the text. */
function writeBreakableRun(el: HTMLElement, text: string): void {
    text.split('\n').forEach((line, index) => {
        if (index > 0) el.appendChild(document.createElement('br'));
        for (const part of line.split(/(?<=\/)(?!\/)/)) {
            if (part === '') continue;
            el.appendChild(document.createTextNode(part));
            if (part.endsWith('/'))
                el.appendChild(document.createElement('wbr'));
        }
    });
}

/**
 * Whether `text` fits whole in the empty `input` as its placeholder. An input
 * with no width yet (a closed step, or no layout) counts as fitting; it is
 * measured again once it has one.
 */
function formatFits(input: HTMLInputElement, text: string): boolean {
    const style = getComputedStyle(input);
    const room =
        input.clientWidth -
        (parseFloat(style.paddingLeft) || 0) -
        (parseFloat(style.paddingRight) || 0);
    if (room <= 0) return true;
    const probe = document.createElement('span');
    probe.style.position = 'absolute';
    probe.style.visibility = 'hidden';
    probe.style.whiteSpace = 'pre';
    probe.style.fontFamily = style.fontFamily;
    probe.style.fontSize = style.fontSize;
    probe.style.fontWeight = style.fontWeight;
    probe.style.fontStyle = style.fontStyle;
    probe.style.letterSpacing = style.letterSpacing;
    probe.textContent = text;
    (input.parentElement ?? document.body).appendChild(probe);
    const needed = probe.getBoundingClientRect().width;
    probe.remove();
    return needed <= room;
}
