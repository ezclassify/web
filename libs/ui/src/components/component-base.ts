/**
 * Interactive base class for form components that support editing.
 *
 * Extends ReadOnlyComponentBase with reprocessing, suggestion fetching,
 * assertion add/remove/toggle, token tree access, and tooltip attachment.
 * Interactive components like TagInput, SingleSelect, and CategoryChecklist
 * extend this class.
 */

import type {
    Assertion,
    Change,
    Fix,
    ProcessResult,
    RenderAssessment,
    Suggestion,
    Warning,
} from '@ezclassify/types';
import { buildTokenTree, type TokenTree } from '../token-tree/token-tree';
import { createKeyboardHints, attachTooltip } from './component-utils';
import {
    ReadOnlyComponentBase,
    type ComponentEngineSource,
    type ComponentOptions,
} from './component-base-readonly';
import { createClearButton, type ClearButton } from './clear-button';
import { t } from '../i18n';
import {
    assertDescribesConcepts,
    createConceptDescriber,
} from './concept-description';
import { removeAssertionCascade } from './assertion-removal';
import { fixAssertions } from './rule-errors';
import { recordAppliedFixes } from './status-mark';
import { assertionFactKey, takenFromWhole } from '../assertion-identity';
import type { EzClassifyState } from '../store/ezclassify-store';
import { createComposerPort } from './composer/composer-port';
import { judgedAsHeld } from '../loaded-value';
import {
    replacesStated,
    statedAssertions,
    type ComposerCommit,
    type ComposerDraftShape,
    type ComposerPort,
    type ComposerReading,
} from './composer/composer-controller';

// Re-export types from the read-only base so existing imports still work
export type {
    ComponentInstance,
    ComponentOptions,
} from './component-base-readonly';
export {
    CATEGORY_COLORS,
    ReadOnlyComponentBase,
    resolveProfile,
} from './component-base-readonly';

/**
 * Interactive foundation for form components, adding reprocessing, editing,
 * suggestion fetching, and tooltip support on top of the read-only base.
 */
export abstract class ComponentBase extends ReadOnlyComponentBase {
    /**
     * Sequence counter for reprocess: ensures only the latest mutation's result
     * is applied
     */
    private _reprocessSeq = 0;
    private clearControl?: ClearButton;
    private readonly updateClearButton = () => {
        queueMicrotask(() => this.clearControl?.update());
    };

    override async init(
        container: HTMLDivElement,
        engine?: ComponentEngineSource | null,
        options?: ComponentOptions,
    ): Promise<void> {
        await super.init(container, engine, options);
        const mount = this.clearButtonMount();
        if (!mount) return;
        this.clearControl = createClearButton({
            label: t('aria.clearMarking'),
            host: this.enhancedInput ?? undefined,
            empty: () => !this.hasClearValue(),
            clear: async () => {
                this.discardDraft();
                await this.setValue('');
                this.discardDraft();
            },
        });
        mount.appendChild(this.clearControl.button);
        this.container.addEventListener('input', this.updateClearButton);
    }

    /** Components place clear inside their own stable field chrome. */
    protected clearButtonMount(): HTMLElement | null {
        return this.container;
    }

    /** Keep clear outside content that a render replaces, without a new row. */
    protected clearButtonFrame(content: HTMLElement): HTMLElement {
        const frame = document.createElement('div');
        frame.className = 'ez-clear-frame';
        content.replaceWith(frame);
        frame.appendChild(content);
        return frame;
    }

    protected hasClearValue(): boolean {
        return !!this._lastRendered || this.assertions.length > 0;
    }

    protected discardDraft(): void {}

    protected destroyClearButton(): void {
        this.container.removeEventListener('input', this.updateClearButton);
        this.clearControl?.destroy();
        this.clearControl = undefined;
    }

    protected override onAssertionsChanged(): void {
        super.onAssertionsChanged();
        this.clearControl?.update();
    }
    /**
     * Set to true by destroy(): prevents async callbacks from mutating
     * destroyed state
     */
    protected _destroyed = false;
    /**
     * Concept-detail resolution and its result cache for this instance, shared
     * with every other field class via `createConceptDescriber`. Constructed
     * here even though `engine` and `schemeId` are not assigned until `init()`
     * runs; the describer reads those fields live on each call, not at
     * construction time.
     */
    private readonly _conceptDescriber = createConceptDescriber({
        engine: () => this.engine,
        schemeId: () => this.schemeId,
        schemeAddressing: () => this.schemeAddressing,
        options: () => this.options,
    });

    /** Every editable field shows concept detail, so it needs `describeConcept`. */
    protected override assertEngineCapabilities(componentLabel: string): void {
        assertDescribesConcepts(this.engine, componentLabel);
    }

    /**
     * Fixes the engine has APPLIED while producing the field's current value,
     * deduplicated by ruleId. Sourced from `ProcessResult.appliedFixes` (the
     * engine's own record, which carries the rule identity and human message);
     * proposed fixes never land here. Accumulates across reprocesses so the
     * status mark keeps communicating state after a later no-fix reprocess;
     * cleared when the field is emptied or its value is replaced (through
     * setValue, a replacing composer commit, or an edit that drops something
     * the field stated).
     */
    protected _appliedFixes = new Map<string, Change>();

    /**
     * Fixes the engine applied while producing the field's current value,
     * deduplicated by rule. Empty when the value is exactly what the user built
     * with no rule-driven changes.
     */
    getAppliedFixes(): readonly Change[] {
        return [...this._appliedFixes.values()];
    }

    protected override recordAppliedFixes(
        fixes: readonly Change[],
        reset = false,
    ): void {
        if (reset) this._appliedFixes.clear();
        recordAppliedFixes(this._appliedFixes, fixes);
    }

    override setAssertions(assertions: Assertion[]): void {
        this.invalidateValueRead();
        // A marking that drops something the field stated replaces its value,
        // and the fixes behind the old value no longer explain it.
        if (replacesStated(this.assertions, assertions))
            this._appliedFixes.clear();
        this.assertions = [...assertions];
        this.reprocess();
    }

    /**
     * Reflect an already evaluated marking, including unrecognized text and
     * facts outside its rendered scope. Reprocessing only its assertions would
     * erase the text and publish a different marking back to the store. The
     * store's judgment of the marking comes with it, so every field bound to it
     * shows the same errors and ways to fix. The fixes the store's reading
     * applied are explained too; a state that echoes the value the field holds
     * keeps the field's own explanation of how that value came about.
     */
    applyStoreState(state: EzClassifyState): void {
        this.invalidateValueRead();
        ++this._reprocessSeq;
        if (this._destroyed) return;
        const replacesValue = state.rendered !== this._lastRendered;
        this.assertions = [...state.assertions];
        this.failedRead = null;
        this._lastRendered = state.rendered;
        // A structured or computed state has no recognition: nothing was read.
        this.noteReading(state);
        this.displayColor = state.displayColor;
        this.recordAppliedFixes(state.appliedFixes ?? [], replacesValue);
        this.updateValidationErrors(state.errors, state.proposedFixes);
        this.onAssertionsChanged();
    }

    /**
     * Add an assertion. Re-processes through the engine to apply constraints,
     * inference, and defaults.
     */
    protected addAssertion(
        conceptId: string,
        categoryId: string,
        value?: string,
        insertIndex?: number,
    ): void {
        // Single-select categories: remove existing concept before adding the new one
        const category = this.scheme.categories.find(
            (f) => f.id === categoryId,
        );
        if (category?.single) {
            this.assertions = this.assertions.filter(
                (a) => a.categoryId !== categoryId,
            );
        }

        // Don't add duplicates; upgrade inferred to explicit
        const existing = this.assertions.find(
            (a) => a.conceptId === conceptId && a.categoryId === categoryId,
        );
        if (existing) {
            if (existing.confidence === 'inferred') {
                existing.confidence = 'certain';
                existing.source = 'user';
                this.reprocess();
            }
            return;
        }

        const assertion: Assertion = {
            conceptId,
            categoryId,
            confidence: 'certain',
            source: 'user',
            ...(value ? { value } : {}),
        };
        if (
            insertIndex !== undefined &&
            insertIndex >= 0 &&
            insertIndex < this.assertions.length
        ) {
            this.assertions.splice(insertIndex, 0, assertion);
        } else {
            this.assertions.push(assertion);
        }

        this.reprocess();
    }

    /**
     * A pressed fix changes the value the same way a pick does: the concepts it
     * keeps and adds become the author's marking, in one write, and the engine
     * settles everything they imply before the field writes the result back to
     * its host.
     */
    protected override ruleFixHandler(): (fix: Fix) => void {
        return (fix) => {
            if (this._destroyed) return;
            this.reprocessEdit(fixAssertions(fix));
        };
    }

    /**
     * Toggle a suggestion: add if not present, remove if explicit, upgrade if
     * inferred
     */
    protected toggleSuggestion(s: {
        conceptId: string;
        categoryId: string;
        selected?: boolean;
    }): void {
        if (s.selected) {
            const assertion = this.assertions.find(
                (a) =>
                    a.conceptId === s.conceptId &&
                    a.categoryId === s.categoryId,
            );
            if (assertion?.confidence === 'inferred') {
                // Upgrade inferred to explicit
                assertion.confidence = 'certain';
                assertion.source = 'user';
                this.reprocess();
            } else {
                this.removeAssertion(s.conceptId, s.categoryId);
            }
        } else {
            this.addAssertion(s.conceptId, s.categoryId);
        }
    }

    /**
     * A new value replaces the old one: any read still in flight for the old
     * value (a reprocess, or a judging read started by a whole or parts change)
     * is for a marking the field no longer holds, and its errors and fixes must
     * not be painted over the new value's.
     */
    override async setValue(value: string): Promise<void> {
        ++this._reprocessSeq;
        return super.setValue(value);
    }

    /**
     * An editable field reads its value as the author's call: the proven fix
     * paths are the buttons under it.
     */
    protected override readValue(value: string): Promise<ProcessResult> {
        return Promise.resolve(
            this.callProcess(value, {
                outputFormat: this.formatId,
                context: this.getProcessingContext(),
            }),
        );
    }

    /**
     * The parts this field's whole covers changed: judge the current value
     * against them again and show what that finds. Only the errors and their
     * fixes are refreshed; the value itself is not rewritten or republished,
     * because nothing the author stated changed.
     */
    refreshParts(): void {
        if (!this.coversParts || this._destroyed) return;
        // A value that never read has nothing to judge yet: read it first.
        if (this.readFailed) {
            this.retryRead();
            return;
        }
        const userAssertions = statedAssertions(this.assertions);
        // An empty whole is judged only once a part is marked: then it is
        // missing everything the parts carry, and the field offers the fix.
        // No recognized assertions can also mean unread text; keep its report.
        if (userAssertions.length === 0 && !this.partsMarked) {
            if (!this._lastRendered.trim()) this.updateValidationErrors([]);
            return;
        }
        this.judgeAgain(userAssertions);
    }

    /**
     * The whole this part belongs to changed: judge the current value against
     * it again and show what that finds, the same way {@link refreshParts} does
     * for a whole. Only a field that reads in its whole's context has anything
     * to refresh.
     */
    refreshWhole(): void {
        if (this._destroyed) return;
        if (this.readFailed) {
            this.retryRead();
            return;
        }
        if (!this.getProcessingContext()) return;
        const userAssertions = statedAssertions(this.assertions);
        if (userAssertions.length === 0) return;
        this.judgeAgain(userAssertions);
    }

    /**
     * Read the author's assertions again and replace the errors, fixes and
     * warnings the field shows. The value itself is not rewritten or
     * republished, because nothing the author stated changed.
     */
    private judgeAgain(userAssertions: Assertion[]): void {
        // A reprocess already under way reads the parts itself; a newer one
        // started while this read runs makes this one stale.
        const seq = this._reprocessSeq;
        const current = () => seq === this._reprocessSeq && !this._destroyed;
        const read = (assertions: Assertion[]) =>
            this.callProcess('', {
                outputFormat: this.formatId,
                assertions,
                context: this.getProcessingContext(),
            });
        void Promise.resolve()
            .then(() =>
                judgedAsHeld(userAssertions, read(userAssertions), (settled) =>
                    read(statedAssertions(settled.assertions)),
                ),
            )
            .then((result) => {
                if (!current()) return;
                this.updateValidationErrors(
                    result.errors ?? [],
                    result.proposedFixes,
                    result.warnings,
                );
            })
            .catch((error: unknown) => {
                if (current()) this.showReadFailure(error);
            });
    }

    /**
     * Re-process current assertions through the engine to apply all rules
     * (constraints, inference, defaults, repair). Updates assertions, rendered
     * string, and triggers onAssertionsChanged.
     */
    protected reprocess(): void {
        void this.reprocessNow();
    }

    /**
     * {@link reprocess}, returning a promise that settles once the result has
     * been applied (or discarded as stale, or failed). The composer's commit
     * awaits this so the stored value, the host write-back and its native
     * `input` event have all happened before it reports the commit.
     *
     * @param processEmpty - Evaluate empty category selections through the
     *   engine so its defaults apply; text controls may still clear to blank.
     */
    protected reprocessNow(processEmpty = false): Promise<void> {
        // Sequence guard: if another reprocess fires before this one completes,
        // the stale result is discarded (only the latest mutation wins).
        const seq = ++this._reprocessSeq;

        // Only render user-selected assertions. Inferred concepts are stripped so
        // the engine re-derives them from the current user set; removing a concept
        // also removes anything it implied.
        const userAssertions = statedAssertions(this.assertions);
        const facetCategory = this.options.resolveFacetSiblings
            ? this.options.categoryId
            : undefined;
        const siblings = this.options.resolveFacetSiblings?.() ?? [];

        // Skip the API call when there's nothing to process
        if (
            !processEmpty &&
            userAssertions.length === 0 &&
            this.assertions.length === 0
        ) {
            this._lastRendered = '';
            this.noteReading({});
            // Cleared field: back to the starless "enhanced" state.
            this._appliedFixes.clear();
            this.updateValidationErrors([]);
            this.onAssertionsChanged();
            // A cleared whole still has to cover its parts.
            this.refreshParts();
            return Promise.resolve();
        }

        const userByKey = new Map(
            userAssertions.map((a) => [assertionFactKey(a), a]),
        );

        const applyResult = (result: {
            assertions: Assertion[];
            rendered: string;
            errors?: Array<{ constraintId: string; message: string }>;
            appliedFixes?: Change[];
            proposedFixes?: Fix[];
            warnings?: Warning[];
            assertionsBeforeRepair?: Assertion[];
            assessment?: RenderAssessment;
        }) => {
            if (seq !== this._reprocessSeq || this._destroyed) return;
            this.assertions = result.assertions
                .filter((assertion) =>
                    facetCategory
                        ? assertion.categoryId === facetCategory
                        : true,
                )
                .map((a) => {
                    const key = assertionFactKey(a);
                    const chosen = userByKey.get(key);
                    if (chosen) {
                        const settled = { ...a, ...chosen };
                        // An absent attribution is also part of the chosen provenance.
                        if (chosen.sourceRule === undefined)
                            delete settled.sourceRule;
                        if (chosen.provenance === undefined)
                            delete settled.provenance;
                        return settled;
                    }
                    // Canonical values can differ from the chosen input. The
                    // reader retains their chosen origin without a local codec.
                    if (a.source === 'user' || a.source === 'parse') return a;
                    // A value taken from the whole keeps its source: relabeled,
                    // it would read as the part's own and be stated on the
                    // next pass.
                    if (takenFromWhole(a)) return a;
                    // Defaults are certain origins. Marking them inferred would
                    // make getSuggestions() hide their checked rows as if they
                    // were engine-derived side effects.
                    return {
                        ...a,
                        confidence:
                            a.source === 'default'
                                ? ('certain' as const)
                                : ('inferred' as const),
                    };
                });
            this._lastRendered = result.rendered;
            this.noteReading(result);
            recordAppliedFixes(this._appliedFixes, result.appliedFixes);
            if (result.errors)
                this.updateValidationErrors(
                    result.errors,
                    result.proposedFixes,
                    result.warnings,
                );
            this.onAssertionsChanged();
        };

        // A read that raises leaves the marking as it was and says why.
        const failed = (error: unknown) => {
            if (seq !== this._reprocessSeq || this._destroyed) return;
            this.showReadFailure(error);
        };

        // Single process() call with pre-built assertions: skips the parse stage
        // and avoids a separate render() round-trip.
        // The facts the engine settles on are judged as the value the field
        // will hold (see judgedAsHeld), so a repair the engine made is not
        // offered back as a way to fix.
        const read = (assertions: Assertion[]) =>
            this.callProcess('', {
                outputFormat: this.formatId,
                assertions,
                context: this.getProcessingContext(),
            });
        const asked = [...siblings, ...userAssertions];
        let processResult: ProcessResult | Promise<ProcessResult>;
        try {
            processResult = judgedAsHeld<ProcessResult>(
                asked,
                read(asked),
                (settled) => read(statedAssertions(settled.assertions)),
            );
        } catch (error) {
            failed(error);
            return Promise.resolve();
        }

        if (processResult && !('then' in processResult)) {
            applyResult(processResult);
            return Promise.resolve();
        }

        // Async engine: await the result
        return Promise.resolve(processResult).then(applyResult).catch(failed);
    }

    /**
     * Remove an assertion by concept+category. Re-processes through the engine
     * to apply cascades, inference, and defaults.
     */
    protected removeAssertion(conceptId: string, categoryId: string): void {
        this.reprocessEdit(
            removeAssertionCascade(
                this.assertions,
                conceptId,
                categoryId,
                this.scheme,
                this.schemeMeta,
            ),
        );
    }

    /**
     * Store an edit made outside the composer (a tag removed, a pressed fix)
     * and reprocess it. An edit that drops something the field stated replaces
     * the value, the same rule a composer commit follows (see
     * `replacesStated`): the fixes behind the old value no longer describe the
     * field, so the record starts over and the reprocess records the repairs
     * that still apply. An edit that only adds keeps them.
     */
    private reprocessEdit(next: Assertion[]): void {
        if (replacesStated(this.assertions, next)) this._appliedFixes.clear();
        this.assertions = next;
        this.reprocess();
    }

    /**
     * Disambiguate suggestions with duplicate labels in the same group by
     * appending (parent)
     */
    protected disambiguateSuggestions(suggestions: Suggestion[]): Suggestion[] {
        // Find labels that appear more than once in the same group
        const groupLabels = new Map<string, Map<string, number>>();
        for (const s of suggestions) {
            const labels =
                groupLabels.get(s.group) ?? new Map<string, number>();
            labels.set(s.label, (labels.get(s.label) ?? 0) + 1);
            groupLabels.set(s.group, labels);
        }

        // For duplicates, clone and append parent info
        const result: Suggestion[] = [];
        let conceptsById:
            Map<string, (typeof this.scheme.concepts)[number]> | undefined;
        for (const s of suggestions) {
            if ((groupLabels.get(s.group)?.get(s.label) ?? 0) > 1) {
                conceptsById ??= new Map(
                    this.scheme.concepts.map((concept) => [
                        concept.id,
                        concept,
                    ]),
                );
                const concept = conceptsById.get(s.conceptId);
                if (concept?.parents.length) {
                    const parent = conceptsById.get(concept.parents[0]);
                    const parentLabel =
                        parent?.views['default'] ?? parent?.id ?? '';
                    if (parentLabel) {
                        result.push({
                            ...s,
                            label: `${s.label} (${parentLabel})`,
                        });
                        continue;
                    }
                }
            }
            result.push(s);
        }
        return result;
    }

    /**
     * Resolve a concept's detail text: the one algorithm every dwell surface
     * (dropdown rows, painted tokens, chips) reads from, via
     * `createConceptDescriber`. Lazy-loads from the engine on first call, then
     * caches.
     */
    protected resolveConceptDescription(
        conceptId: string,
        categoryId: string,
    ): string | undefined {
        return this._conceptDescriber.resolve(conceptId, categoryId);
    }

    /**
     * Attach a concept tooltip to a DOM element. Shows on hover/focus with full
     * concept description including rules.
     */
    protected attachConceptTooltip(
        el: HTMLElement,
        conceptId: string,
        categoryId: string,
    ): void {
        attachTooltip(
            el,
            () => this.resolveConceptDescription(conceptId, categoryId),
            this.options.root,
            () => this.shouldShowTooltip(),
        );
    }

    /**
     * Guard for tooltip display: honors the host's declarative opt-out
     * (`data-ezclassify-no-tooltips` → options.tooltips === false); subclasses
     * can override to suppress tooltips contextually.
     */
    protected shouldShowTooltip(): boolean {
        return this._conceptDescriber.enabled();
    }

    /**
     * Get suggestions from the engine. Filters out concepts that are already
     * inferred in a given category; the user shouldn't see them as selectable
     * since they were auto-added. Example: USA in owner_producer is inferred
     * when TS is selected; showing it in the dropdown would let the user click
     * it thinking they're adding it to REL TO.
     *
     * When the component is category-bound (options.categoryId, wired from
     * `data-ezclassify-category`), the result is scoped to that category's
     * suggestions. The engine's suggest API has no category option, so this is
     * the chokepoint: without it, a bound field's dropdown offers concepts the
     * facet binding will refuse anyway, so they are dead rows.
     *
     * `liveContext`, when supplied, overrides which assertions the engine
     * treats as "currently present" for this call, REGARDLESS of whether a
     * filter is active; see MarkingField.refreshSuggestions for why it needs
     * this. Every other caller leaves it undefined and keeps the behavior
     * described below unchanged.
     */
    protected async getSuggestions(
        filter?: string,
        liveContext?: Assertion[],
    ): Promise<Suggestion[]> {
        // When the user is actively typing a filter, they want to FIND/SWITCH a
        // concept; so suggest must offer all matching concepts, including
        // alternatives to an already-selected single-select value (e.g. typing
        // "TIER 2" while TIER 3 is set must still surface TIER 2). Passing the
        // current full marking as input, or the field's own complete assertions as
        // context, makes the engine treat single-select categories as "satisfied"
        // and return only the current value, hiding the alternatives. So for the
        // filtered path we query by filter alone (empty input, no own-marking
        // context). With no filter (browsing), keep the contextual behavior so
        // cross-category gating still applies. A caller that supplies
        // `liveContext` wants the opposite of that filtered-path carve-out: it
        // has already resolved its own live state and wants the engine's full
        // suppression/rule/constraint machinery to evaluate against it even
        // while filtering (a checked, still-selected row keeps rendering
        // because the engine marks it `selected: true` rather than dropping
        // it, not because context was withheld).
        const hasFilter = !!(filter && filter.trim());
        const rendered =
            liveContext !== undefined || !hasFilter ? this.getRendered() : '';
        const chosen =
            liveContext !== undefined
                ? liveContext
                : hasFilter
                  ? []
                  : this.assertions;
        const options = {
            outputFormat: this.formatId,
            surface: this.options.scope,
        };
        const suggestions =
            rendered && chosen.length > 0
                ? Object.values(
                      (
                          await Promise.resolve(
                              this.callProcess(rendered, {
                                  ...options,
                                  assertions: chosen,
                                  suggestFor: this.options.categoryId
                                      ? [this.options.categoryId]
                                      : this.scheme.categories.map(
                                            (category) => category.id,
                                        ),
                              }),
                          )
                      ).suggestionsFor ?? {},
                  ).flatMap((answer) => answer.suggestions)
                : (
                      await Promise.resolve(
                          this.callSuggest(
                              chosen.length > 0 ? chosen : rendered,
                              {
                                  ...options,
                                  filter: filter || undefined,
                                  includeGated: hasFilter || undefined,
                              },
                          ),
                      )
                  ).suggestions;

        const boundCategory = this.options.categoryId;
        const scoped = boundCategory
            ? suggestions.filter((s) => s.categoryId === boundCategory)
            : suggestions;
        // Build set of concept+category pairs that are inferred (not user-added).
        // Sourced from `liveContext` when the caller supplied one, so a live
        // edit's own inferred concepts are excluded the same tick, not one
        // keystroke behind (same reasoning as `rendered`/`assertions` above).
        const inferredPairs = new Set(
            (liveContext ?? this.assertions)
                .filter((a) => a.confidence === 'inferred')
                .map((a) => `${a.conceptId}::${a.categoryId}`),
        );
        return inferredPairs.size > 0
            ? scoped.filter(
                  (s) => !inferredPairs.has(`${s.conceptId}::${s.categoryId}`),
              )
            : scoped;
    }

    /**
     * The composer port for a field built on this base: every engine call the
     * shared composer makes goes through this component's own scheme, format,
     * context and suggest binding, so the composer never re-derives any of it.
     *
     * @param shape - 'whole' when the field's text is the whole marking,
     *   'additive' when it adds to the committed set (TagInput)
     */
    protected composerPort(shape: ComposerDraftShape): ComposerPort {
        return createComposerPort({
            shape,
            binding: {
                process: (text, request) =>
                    Promise.resolve(
                        this.callProcess(text, {
                            outputFormat: this.formatId,
                            surface: this.options.scope,
                            context: this.getProcessingContext(),
                            ...(request?.chosen
                                ? { assertions: [...request.chosen] }
                                : {}),
                        }),
                    ),
                validate: (text) =>
                    Promise.resolve(
                        this.callValidate(text, {
                            outputFormat: this.formatId,
                            surface: this.options.scope,
                            context: this.getProcessingContext(),
                        }),
                    ),
                coveredCategories: () => {
                    const coverage = this.engine.getFormatCoverage?.(
                        this.formatId,
                        this.schemeId,
                    );
                    return coverage
                        ? new Set(coverage.coveredCategories)
                        : undefined;
                },
                write: async (assertions) =>
                    (
                        await Promise.resolve(
                            this.callRender([...assertions], {
                                format: this.formatId,
                            }),
                        )
                    ).rendered,
            },
            scheme: () => this.scheme,
            meta: () => this.schemeMeta,
            formatId: () => this.formatId,
            scope: () => this.options.scope,
            categoryId: () => this.options.categoryId,
            suggestions: (live) => this.composerSuggestions(live),
            gated: (query, live) => this.composerGated(query, live),
            committed: () => ({
                assertions: this.assertions,
                rendered: this._lastRendered,
            }),
            store: (reading, commit) =>
                this.storeComposerReading(reading, commit),
            siblings: () => this.options.resolveFacetSiblings?.() ?? [],
            ownCategory: () =>
                this.options.resolveFacetSiblings
                    ? this.options.categoryId
                    : undefined,
        });
    }

    /**
     * Every concept this field offers, for the composer's catalog. Asked once
     * per open without the field's own assertions, retaining its whole context:
     * the list must show the other choices in a filled single-choice category
     * (a replace row), and which rows are checked comes from the composer's own
     * reading, not from the engine's `selected` flag. Asked again with `live`,
     * the draft's assertions, for what the scheme offers only in their
     * context.
     */
    protected async composerSuggestions(
        live?: readonly Assertion[],
    ): Promise<Suggestion[]> {
        const context = this.getProcessingContext();
        const options = {
            outputFormat: this.formatId,
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
        const bound = this.options.categoryId;
        return this.disambiguateSuggestions(
            suggestions.filter(
                (s) =>
                    !s.conceptId.startsWith('preset:') &&
                    (!bound || s.categoryId === bound),
            ),
        );
    }

    /** Rows the scheme's rules gate for `query` given the live assertions. */
    protected async composerGated(
        query: string,
        live: readonly Assertion[],
    ): Promise<Suggestion[]> {
        const result = await Promise.resolve(
            this.callSuggest([...live], {
                outputFormat: this.formatId,
                filter: query,
                surface: this.options.scope,
                includeGated: true,
            }),
        );
        return result.suggestions.filter((s) => s.gated);
    }

    /**
     * Store a complete composer reading as this field's value: what the author
     * stated goes through the ordinary reprocess pipeline, so the host
     * write-back, its native `input` event, the store publish and validation
     * all happen exactly as for any other change. The resulting assertions are
     * the value being committed; diagnostic pre-repair facts never seed it.
     *
     * Reprocessing the statement cannot see how the draft's text was read, so
     * the fixes the engine applied to read it (case, separator, order,
     * spelling) are recorded here, before the reprocess adds any rule repair. A
     * commit that replaces the value (a whole marking, or an additive draft
     * that drops part of what the field held) starts the record over: the fixes
     * behind the value it replaces no longer describe anything, the same as for
     * `setValue`. A commit that only adds keeps them.
     *
     * @param reading - The complete reading the composer commits
     * @param commit - Whether the commit replaces the value or adds to it
     */
    protected async storeComposerReading(
        reading: ComposerReading,
        commit: ComposerCommit,
    ): Promise<void> {
        this.assertions = statedAssertions(reading.assertions);
        this.recordAppliedFixes(reading.appliedFixes, commit.replaces);
        await this.reprocessNow();
    }

    /** Append keyboard hint bar to the container */
    protected appendKeyboardHints(
        hints: Array<{ keys: string; action: string }>,
    ): void {
        this.container.appendChild(createKeyboardHints(hints));
    }

    /** Darken a hex color */
    protected darken(hex: string, amount: number): string {
        const r = parseInt(hex.slice(1, 3), 16);
        const g = parseInt(hex.slice(3, 5), 16);
        const b = parseInt(hex.slice(5, 7), 16);
        const f = 1 - amount;
        return (
            '#' +
            Math.round(r * f)
                .toString(16)
                .padStart(2, '0') +
            Math.round(g * f)
                .toString(16)
                .padStart(2, '0') +
            Math.round(b * f)
                .toString(16)
                .padStart(2, '0')
        );
    }

    /** Get token tree for current assertions */
    protected getTokenTree(): TokenTree {
        return buildTokenTree(
            this.assertions,
            this.scheme,
            this.schemeMeta,
            this.formatId,
        );
    }

    /**
     * Relevance score for a query against one candidate string.
     *
     * Tiered so a real, visible match always outranks a loose one: exact (100),
     * prefix (90), substring (70), then a bounded subsequence fallback for
     * abbreviations and dropped letters (e.g. "scrt" -> "SECRET"). The
     * subsequence level is bounded because, unbounded, any short query matches
     * almost any long label by scattering its letters ("arch" spread across
     * "Lincoln Branch"), which floods the list with noise and hides the real
     * no-match / already-selected states. Bounding the matched span to at most
     * twice the query length keeps only tight subsequences and drops the
     * scatter.
     *
     * @param query - The user's filter text
     * @param target - A candidate label, name, or view string
     * @returns 0 for no match, 1 for an empty query, up to 100 for an exact hit
     */
    protected fuzzyMatch(query: string, target: string): number {
        if (!query) return 1;
        const q = query.toLowerCase();
        const t = target.toLowerCase();
        if (t === q) return 100;
        if (t.startsWith(q)) return 90;
        if (t.includes(q)) return 70;

        // Subsequence fallback: every query character appears in order. Track the
        // span of the matched run so a scattered match across a long label is
        // rejected rather than scored like a real one.
        let qi = 0;
        let firstIdx = -1;
        let lastIdx = -1;
        for (let ti = 0; ti < t.length && qi < q.length; ti++) {
            if (t[ti] === q[qi]) {
                if (firstIdx < 0) firstIdx = ti;
                lastIdx = ti;
                qi++;
            }
        }
        if (qi !== q.length) return 0;

        const span = lastIdx - firstIdx + 1;
        // A tight subsequence stays close to the query length; a scattered one
        // spreads far past it. Anything looser than 2x is noise, not a match.
        if (span > q.length * 2) return 0;

        // Tighter spans score higher, but the fallback never reaches the
        // substring level (70), so a genuine substring match always wins.
        return Math.round(40 * (q.length / span)) + 10;
    }
}
