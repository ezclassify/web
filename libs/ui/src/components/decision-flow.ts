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
 * Attribute: `data-ezclassify-controller="decisionflow"` Config:
 * `data-ezclassify-decisionflow-categories`: JSON array of category IDs in step
 * order.
 */

import { ComponentBase } from './component-base';
import { createAnnouncer, announce } from './component-utils';
import { SuggestionCatalog } from './composer/suggestion-catalog';
import { statedAssertions } from './composer/composer-controller';
import type { ComposerPort } from './composer/composer-controller';
import type { ConceptTextInput } from '@ezclassify/types';
import { applyTextInputAttributes } from './text-input-attributes';
import decisionFlowCss from './decision-flow.css?inline';
import { getPublicFormatLayout } from '../format-layout';
import { observeNativeLock } from './dom-helpers';
import { EMPTY_VALUE } from '../text-utils';

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
    concepts: ConceptDef[];
    /**
     * When set, this step is only shown while its owning concept is asserted.
     * Derived from an unambiguous fixed-header/category field group.
     */
    requiredHeader?: { conceptId: string; categoryId: string };
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
    /**
     * Subset of _allSteps that are currently visible based on current
     * assertions.
     */
    private get steps(): StepDef[] {
        return this._allSteps.filter((step) => {
            if (!step.requiredHeader) return true;
            // A dependent step is visible only while its field header is asserted.
            return this.assertions.some(
                (a) =>
                    a.conceptId === step.requiredHeader!.conceptId &&
                    a.categoryId === step.requiredHeader!.categoryId,
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
    /**
     * The concept id last interacted with: used to restore focus after
     * multi-select toggles.
     */
    private _lastFocusConceptId = '';
    private catalog!: SuggestionCatalog;
    private pickerPort!: ComposerPort;
    private catalogReady = false;
    private userEdit = false;
    private optionsSequence = 0;
    private pickSequence = 0;
    private locked = false;
    private stopObservingLock?: () => void;
    private pointerActive = false;
    private rendering = false;
    private catalogChangedDuringPress = false;
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

    private async refreshOptions(paint = true): Promise<void> {
        const sequence = ++this.optionsSequence;
        await this.catalog.load(
            JSON.stringify(this.getProcessingContext()) ?? '',
        );
        await this.catalog.refresh(statedAssertions(this.assertions));
        if (this._destroyed || sequence !== this.optionsSequence) return;
        this.catalogReady = true;
        if (!paint) return;
        if (this.pointerActive) this.catalogChangedDuringPress = true;
        else this.render();
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
                this.catalog
                    .rows()
                    .some(
                        (s) =>
                            !s.gated &&
                            s.categoryId === step.categoryId &&
                            s.conceptId === conceptId,
                    ) ||
                this.assertions.some(
                    (a) =>
                        a.categoryId === step.categoryId &&
                        a.conceptId === conceptId,
                )
            ) {
                action();
                return true;
            }
            return false;
        };
        if (this.catalogReady) apply();
        else
            void this.refreshOptions(false).then(() => {
                if (this._destroyed || sequence !== this.pickSequence) return;
                if (!apply()) this.render();
            });
    }

    private visibleConcepts(step: StepDef): ConceptDef[] {
        if (!this.catalogReady) return step.concepts;
        const offered = new Set(
            this.catalog
                .rows()
                .filter((s) => !s.gated && s.categoryId === step.categoryId)
                .map((s) => s.conceptId),
        );
        for (const a of this.assertions) {
            if (a.categoryId === step.categoryId) offered.add(a.conceptId);
        }
        return step.concepts.filter((c) => offered.has(c.id));
    }

    protected setup(): void {
        this.injectComponentStyles(decisionFlowCss);

        const categoryIds = this.resolveCategoryOrder();
        if (categoryIds.length === 0) return;

        const headersByCategory = getPublicFormatLayout(
            this.schemeMeta,
        ).headerByCategory;

        this._allSteps = categoryIds.map((catId) => {
            const cat = this.scheme.categories.find((c) => c.id === catId);
            const concepts = this.scheme.concepts
                .filter((c) => c.categories.includes(catId))
                .sort((a, b) => a.position - b.position);
            return {
                categoryId: catId,
                label: cat?.label ?? catId,
                description: '', // engine concept descriptions shown per-option
                single: cat?.single !== false, // default single unless explicitly false
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
            };
        });

        // Determine starting step from existing assertions.
        // When there are no assertions at all (fresh component), always start at step 0.
        // When the component is seeded, advance past optional categories that have no
        // assertion; they are skippable and don't block a valid partial/full marking.
        const startStep = this.options.startStep ?? 0;
        const hasAnyAssertions = this.assertions.length > 0;
        const visibleSteps = this.steps; // use getter; reflects initial assertion state
        const firstIncomplete = hasAnyAssertions
            ? visibleSteps.findIndex((s) => {
                  if (
                      this.assertions.some((a) => a.categoryId === s.categoryId)
                  )
                      return false;
                  // Only required categories with no assertion count as incomplete.
                  const cat = this.scheme.categories.find(
                      (c) => c.id === s.categoryId,
                  );
                  return cat?.required !== false;
              })
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
        this.catalog = new SuggestionCatalog(
            (live) => this.pickerPort.suggestions(live),
            () => undefined,
        );
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

    protected override onAssertionsChanged(): void {
        ++this.optionsSequence;
        ++this.pickSequence;
        if (
            this.catalog?.useContext(
                JSON.stringify(this.getProcessingContext()) ?? '',
            )
        )
            this.catalogReady = false;
        this.catalog?.invalidateLive();
        const refresh = this.userEdit;
        this.userEdit = false;
        super.onAssertionsChanged();
        if (refresh) this.requestOptions();
    }

    destroy(): void {
        this.destroyClearButton();
        this.removeRuleErrors();
        this._destroyed = true;
        this.catalog?.dispose();
        this.stopObservingLock?.();
        document.removeEventListener('pointerdown', this.outsidePointer);
        document.removeEventListener('pointerup', this.releasePointer);
        document.removeEventListener('pointercancel', this.finishPointer);
        this.container.innerHTML = '';
    }

    protected override discardDraft(): void {
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

            // Restore keyboard focus after DOM rebuild. Set _restoreFocusAfterRender before
            // any action that calls render() as a side-effect (concept selection, Next/Back).
            // Initial setup render leaves the flag false so mount doesn't steal page focus.
            if (this._restoreFocusAfterRender) {
                this._restoreFocusAfterRender = false;
                const step = this.steps[this.currentStep];
                if (step && this.isTextInputStep(step)) {
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
                              `[data-concept-id="${this._lastFocusConceptId}"]`,
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
                            `[data-concept-id="${prevConceptId}"]`,
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

    private resolveCategoryOrder(): string[] {
        const opts = this.options as Record<string, unknown>;
        const explicit = opts['categoryOrder'] as string[] | undefined;
        if (explicit && Array.isArray(explicit)) return explicit;

        // Fall back: parse from data-ezclassify-decisionflow-categories attribute on the original element
        const el =
            this.container.closest(
                '[data-ezclassify-decisionflow-categories]',
            ) ?? this.container;
        const attr = el.getAttribute('data-ezclassify-decisionflow-categories');
        if (attr) {
            try {
                return JSON.parse(attr);
            } catch {
                /* ignore */
            }
        }

        // Default: all categories that belong to the active scope.
        // Active scope = options.scope → scheme defaultScope → no filter.
        const activeScope =
            this.options.scope ??
            this.engine.getSchemeMeta(this.schemeId).defaultScope;
        const inScope = activeScope
            ? this.scheme.categories.filter(
                  (c) =>
                      !c.scopes ||
                      c.scopes.length === 0 ||
                      c.scopes.includes(activeScope),
              )
            : this.scheme.categories;
        return inScope.map((c) => c.id);
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
        const cat = this.scheme.categories.find(
            (c) => c.id === step.categoryId,
        );
        return cat?.required === false;
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
        this.flowEl.appendChild(q);
    }

    private renderRadioOptions(step: StepDef, optionsEl: HTMLElement): void {
        const selected = this.assertions.find(
            (a) => a.categoryId === step.categoryId,
        )?.conceptId;
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
                    this.selectConcept(step.categoryId, concept.id);
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
            if (existingAssertion?.value)
                inputEl.value = existingAssertion.value;

            inputEl.addEventListener('input', () => {
                if (
                    this._destroyed ||
                    this.enhancedInput?.matches(':disabled, [readonly]')
                )
                    return;
                const val = inputEl.value;
                this.userEdit = true;
                // Restore focus to this field after the DOM rebuild that follows reprocess().
                this._restoreFocusAfterRender = true;

                // Find or update the assertion for this concept.
                const existingIdx = this.assertions.findIndex(
                    (a) =>
                        a.conceptId === concept.id &&
                        a.categoryId === step.categoryId,
                );
                if (val) {
                    if (existingIdx >= 0) {
                        this.assertions[existingIdx] = {
                            ...this.assertions[existingIdx],
                            value: val,
                        };
                    } else {
                        this.assertions.push({
                            conceptId: concept.id,
                            categoryId: step.categoryId,
                            confidence: 'certain',
                            source: 'user',
                            value: val,
                        });
                    }
                } else {
                    if (existingIdx >= 0)
                        this.assertions.splice(existingIdx, 1);
                }
                this.reprocess();
            });

            // Prevent arrow keys from bubbling to the flow's keyboard handler.
            inputEl.addEventListener('keydown', (e) => e.stopPropagation());

            wrap.appendChild(inputEl);
            optionsEl.appendChild(wrap);
        }
    }

    private renderCheckboxOptions(step: StepDef, optionsEl: HTMLElement): void {
        const selectedIds = new Set(
            this.assertions
                .filter((a) => a.categoryId === step.categoryId)
                .map((a) => a.conceptId),
        );
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
                    this.toggleConcept(step.categoryId, concept.id, isChecked);
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

    private renderNavigation(): void {
        const nav = document.createElement('div');
        nav.className = 'ez-decision-flow__nav';

        const back = document.createElement('button');
        back.type = 'button';
        back.className = 'ez-decision-flow__nav-btn';
        back.textContent = '← Back';
        back.disabled = this.currentStep === 0;
        back.addEventListener('click', () => {
            const steps = this.steps;
            if (this.currentStep > 0) {
                this.currentStep--;
                this._currentCategoryId =
                    steps[this.currentStep]?.categoryId ?? '';
                this._restoreFocusAfterRender = true;
                this.render();
                announce(
                    this.announcer,
                    `Step ${this.currentStep + 1}: ${steps[this.currentStep]?.label ?? ''}`,
                );
            }
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
            const steps = this.steps;
            if (this.currentStep < steps.length - 1) {
                this.currentStep++;
                this._currentCategoryId =
                    steps[this.currentStep]?.categoryId ?? '';
                this._restoreFocusAfterRender = true;
                this.render();
                announce(
                    this.announcer,
                    `Step ${this.currentStep + 1}: ${steps[this.currentStep]?.label ?? ''}`,
                );
            }
        });
        nav.appendChild(next);

        this.flowEl.appendChild(nav);
    }

    private renderSummary(): void {
        const summary = document.createElement('div');
        summary.className = 'ez-decision-flow__summary';
        summary.setAttribute('aria-label', 'Selected decisions');

        for (const step of this.steps) {
            const stepAssertions = this.assertions.filter(
                (a) => a.categoryId === step.categoryId,
            );
            let chipText: string;
            if (stepAssertions.length === 0) {
                chipText = `${step.label}: ${EMPTY_VALUE}`;
            } else if (step.single) {
                const a0 = stepAssertions[0];
                const concept = step.concepts.find(
                    (c) => c.id === a0.conceptId,
                );
                const display =
                    concept?.textInput && a0.value
                        ? a0.value
                        : (concept?.name ?? a0.conceptId);
                chipText = `${step.label}: ${display}`;
            } else {
                const names = stepAssertions.map((a) => {
                    const concept = step.concepts.find(
                        (c) => c.id === a.conceptId,
                    );
                    // For text_input concepts, show the user-typed value.
                    if (concept?.textInput && a.value) return a.value;
                    return concept?.name ?? a.conceptId;
                });
                chipText = `${step.label}: ${names.join(', ')}`;
            }

            const chip = document.createElement('span');
            chip.className =
                stepAssertions.length > 0
                    ? 'ez-decision-flow__summary-chip'
                    : 'ez-decision-flow__summary-chip ez-decision-flow__summary-chip--empty';
            chip.textContent = chipText;
            summary.appendChild(chip);
        }

        this.flowEl.appendChild(summary);
    }

    private selectConcept(categoryId: string, conceptId: string): void {
        this.userEdit = true;
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
