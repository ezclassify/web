/**
 * GuideChecklist Component
 *
 * An interactive helper that lets users search guide rules by keyword, check
 * the rules that apply to their data, see compound rules activate, and copy the
 * computed marking result.
 *
 * Supports text analysis: paste a paragraph to surface lexical nominations for
 * review. Scanning never accepts a rule or changes the evaluated selection.
 */

import {
    resolveVocabulary,
    describeOutcome,
    type EvaluationResult,
    type ResolvedVocabulary,
    type GuideScanResult,
    type GuideEngineAdapter,
    type GuideStructuralView,
    type GuideRuleView,
    type MaybePromise,
} from '@ezclassify/types';
import type { ComponentEngineSource } from './component-base-readonly';
import {
    isComponentContextAdapter,
    ReadOnlyComponentBase,
    type ComponentOptions,
} from './component-base-readonly';
import { createAnnouncer, announce } from './component-utils';
import { EMPTY_VALUE } from '../text-utils';
import guideHelperCss from './guide-helper.css?inline';

const GUIDE_HELPER_DEFAULTS = {
    rule: { singular: 'rule', plural: 'rules' },
    guide: { singular: 'guide', plural: 'guides' },
};

/**
 * Tell a resolved value apart from a pending one. The adapter contract types
 * these members as `MaybePromise`, so the caller decides at runtime whether it
 * has an answer or a promise of one.
 */
function isPromiseLike<T>(value: T | PromiseLike<T>): value is PromiseLike<T> {
    return (
        typeof value === 'object' &&
        value !== null &&
        typeof (value as PromiseLike<T>).then === 'function'
    );
}

function appendOutcomeText(element: HTMLElement, text: string): void {
    for (const [index, part] of text.split('_').entries()) {
        if (index > 0) element.append('_', document.createElement('wbr'));
        element.append(part);
    }
}

/** Options specific to the GuideChecklist component. */
export interface GuideChecklistOptions extends ComponentOptions {
    /** Show outcome per rule (default: true). */
    showOutcomes?: boolean;
    /** Show rationale text (default: false). */
    showRationale?: boolean;
    /** Clipboard format (default: 'text'). */
    copyFormat?: 'text' | 'html';
    /** Render a built-in textarea for text analysis (default: false). */
    textInput?: boolean;
    /** Pre-built guide view data. Accepts a single view or multiple. */
    guides?: GuideStructuralView | GuideStructuralView[];
}

const GUIDE_HELPER_CSS: string = guideHelperCss;

/**
 * Interactive guide rule picker. Parallels the profile-side
 * `CategoryChecklist`: select rules, see the engine evaluate them into a
 * marking, and see the breakdown. Includes search + paste-text-to-analyze.
 */
export class GuideChecklist extends ReadOnlyComponentBase {
    private searchInput!: HTMLInputElement;
    private rulesContainer!: HTMLElement;
    private breakdownContainer!: HTMLDivElement;
    private resultOutput!: HTMLOutputElement;
    private copyBtn!: HTMLButtonElement;
    private announcer!: HTMLDivElement;
    private nominationStatus?: HTMLDivElement;
    private matchCountEl!: HTMLSpanElement;
    private evaluationErrorEl!: HTMLDivElement;

    private views: GuideStructuralView[] = [];
    private ruleByRow = new WeakMap<HTMLElement, GuideRuleView>();
    private rulesByGuide = new Map<string, Map<string, GuideRuleView>>();
    private activeGuideByRuleId = new Map<string, string>();
    private guideAdapter: GuideEngineAdapter | null = null;
    private activeGuideIndex = 0;
    private selectedRuleIds = new Set<string>();
    private nominatedRuleIds = new Set<string>();
    private lastScanResults: GuideScanResult[] | null = null;
    private filterText = '';
    private lastEvaluation: EvaluationResult | null = null;
    /**
     * Monotonic ticket for the evaluation in flight. Two quick selections
     * against a remote guide engine can answer out of order; only the result
     * holding the current ticket is allowed to land.
     */
    private evaluationToken = 0;
    /** Only the newest text scan may update nominations or their status. */
    private scanToken = 0;
    private evaluationFailed = false;
    private evaluationPending = false;
    private panelBuilt = false;
    private pendingScanStatus: { status: string; announcement: string } | null =
        null;
    private uid = Math.random().toString(36).slice(2, 8);
    /** Set by {@link destroy}; guards the async panel build against a teardown. */
    private _destroyed = false;

    private get vocab(): ResolvedVocabulary {
        return resolveVocabulary(
            this.views[this.activeGuideIndex],
            GUIDE_HELPER_DEFAULTS,
        );
    }

    /**
     * Initialize with GuideChecklist-specific options (includes guides,
     * showOutcomes, etc.).
     */
    override async init(
        container: HTMLDivElement,
        engineOrContext?: ComponentEngineSource | null,
        options?: GuideChecklistOptions,
    ): Promise<void> {
        if (engineOrContext && isComponentContextAdapter(engineOrContext)) {
            this.guideAdapter = engineOrContext.guide ?? null;
        }
        await super.init(container, engineOrContext, options);
    }

    protected setup(): void {
        this.injectComponentStyles(GUIDE_HELPER_CSS);

        const opts = this.options as GuideChecklistOptions;
        let views: MaybePromise<GuideStructuralView[]>;

        if (opts.guides) {
            views = Array.isArray(opts.guides) ? opts.guides : [opts.guides];
        } else {
            // Resolution order mirrors the Guidebook:
            //   1. guideAdapter.buildGuideViews(); set from the Context in init() above.
            //   2. ctx.guide.buildGuideViews(): fallback via context property (same adapter, different path).
            //   3. engine.buildGuideViews(): for adapters that bundle guide data on the scheme handle.
            type ViewSource = {
                buildGuideViews?: () => MaybePromise<GuideStructuralView[]>;
            };
            const ctxGuide = (this.guideAdapter ?? this.context?.guide) as
                ViewSource | null | undefined;
            const ctxBuild = ctxGuide?.buildGuideViews;
            if (typeof ctxBuild === 'function') {
                views = ctxBuild.call(ctxGuide);
            } else {
                const buildAll = (this.engine as ViewSource).buildGuideViews;
                views =
                    typeof buildAll === 'function'
                        ? buildAll.call(this.engine)
                        : [];
            }
        }

        // The view list may be a promise: the local guide adapter builds the
        // views in process, the remote one fetches them. Resolve it, then
        // build. A rejection gets its own visible state rather than an empty
        // pane, which would read as "this guide has no rules".
        if (!isPromiseLike(views)) {
            this.buildPanel(views);
            return;
        }
        void views.then(
            (resolved) => this.buildPanel(resolved),
            (error: unknown) => this.buildUnavailable(error),
        );
    }

    /**
     * Paint the failure state for a view list that never arrived. `destroy`
     * empties the container, so a checklist torn down mid-flight paints
     * nothing.
     */
    private buildUnavailable(error: unknown): void {
        if (this._destroyed) return;

        console.error(
            '[GuideChecklist] could not load the guide views:',
            error,
        );

        const failed = document.createElement('div');
        failed.className = 'ezc-guide-unavailable';
        failed.setAttribute('role', 'alert');
        failed.textContent =
            'Guide unavailable. The rules could not be loaded, so this is not a complete list of what applies.';
        this.container.appendChild(failed);
    }

    /**
     * Build the checklist once the structural views are in hand. Split out of
     * {@link setup} because a remote guide adapter answers with a promise, and
     * `setup` is synchronous by contract.
     *
     * @param views - The resolved structural views, in load order.
     */
    private buildPanel(views: GuideStructuralView[]): void {
        // A remote guide can answer after the host has already torn the
        // checklist down; building into a destroyed container would resurrect
        // it.
        if (this._destroyed) return;

        this.views = views;
        this.rulesByGuide = new Map(
            views.map((view) => {
                const rules = new Map<string, GuideRuleView>();
                for (const category of view.categories) {
                    for (const rule of category.items) rules.set(rule.id, rule);
                }
                for (const rule of view.uncategorized) rules.set(rule.id, rule);
                return [view.id, rules];
            }),
        );
        this.activeGuideByRuleId.clear();
        for (const [guideId, rules] of this.rulesByGuide) {
            for (const ruleId of rules.keys()) {
                this.activeGuideByRuleId.set(ruleId, guideId);
            }
        }
        if (this.lastScanResults !== null)
            this.updateScanNominations(this.lastScanResults);
        const opts = this.options as GuideChecklistOptions;

        if (this.views.length === 0) return;

        const root = document.createElement('div');
        root.className = 'ezc-guide-helper';
        root.setAttribute('role', 'region');
        root.setAttribute('aria-label', this.views[0].name);

        if (opts.textInput) {
            root.appendChild(this.renderTextInput());
            this.nominationStatus = document.createElement('div');
            this.nominationStatus.className = 'ezc-guide-nomination-status';
            this.nominationStatus.setAttribute('role', 'status');
            this.nominationStatus.setAttribute('aria-live', 'polite');
            this.nominationStatus.textContent =
                'Analyze text to nominate rules for review.';
            root.appendChild(this.nominationStatus);
        }

        root.appendChild(this.renderSearch());
        root.appendChild(this.renderRuleList());

        this.breakdownContainer = document.createElement('div');
        this.breakdownContainer.className = 'ezc-guide-breakdown';
        this.breakdownContainer.setAttribute('aria-live', 'polite');
        this.breakdownContainer.setAttribute('role', 'log');
        root.appendChild(this.breakdownContainer);

        root.appendChild(this.renderResult());

        this.evaluationErrorEl = document.createElement('div');
        this.evaluationErrorEl.className = 'ezc-guide-error';
        this.evaluationErrorEl.setAttribute('role', 'alert');
        this.evaluationErrorEl.hidden = true;
        this.evaluationErrorEl.textContent =
            'The marking for this selection could not be computed. What is shown may be out of date.';
        root.appendChild(this.evaluationErrorEl);

        this.announcer = createAnnouncer();
        root.appendChild(this.announcer);

        this.container.appendChild(root);
        this.panelBuilt = true;
        if (this.selectedRuleIds.size > 0) this.applySelection(false);
        else this.render();
        this.paintScanStatus();
    }

    destroy(): void {
        this.removeRuleErrors();
        // Retire the evaluation ticket first. Every listener this component
        // owns is on a node inside the container, so emptying it releases
        // them, but an evaluation already on the wire holds a reference to
        // this instance and lands whenever the runtime answers. Without this
        // the late answer repaints a container the host has taken back and
        // fires `ezclassify:guide-change` at a listener that let this
        // checklist go. `settleEvaluation` compares against the current
        // ticket, so parking it out of reach retires every outstanding one.
        this._destroyed = true;
        this.evaluationToken = Number.MAX_SAFE_INTEGER;
        this.scanToken = Number.MAX_SAFE_INTEGER;
        this.guideAdapter = null;
        this.views = [];
        this.ruleByRow = new WeakMap();
        this.rulesByGuide.clear();
        this.activeGuideByRuleId.clear();
        this.panelBuilt = false;
        this.selectedRuleIds.clear();
        this.lastScanResults = null;
        this.nominatedRuleIds.clear();
        this.lastEvaluation = null;
        this.pendingScanStatus = null;
        this.container.innerHTML = '';
    }

    /** Get currently selected (checked) rule IDs. */
    getSelectedRuleIds(): string[] {
        return [...this.selectedRuleIds];
    }

    /** Get the last evaluation result. */
    getEvaluation(): EvaluationResult | null {
        return this.lastEvaluation;
    }

    /** Programmatically set selected rules and re-evaluate. */
    setSelectedRuleIds(ids: string[]): void {
        this.selectedRuleIds = new Set(ids);
        if (this.panelBuilt) this.applySelection(false);
    }

    /** Clear all selections. */
    clearSelection(): void {
        this.selectedRuleIds.clear();
        if (this.panelBuilt) this.applySelection(false);
    }

    /** Programmatically set the search query. */
    setSearchQuery(query: string): void {
        this.filterText = query;
        if (this.searchInput) this.searchInput.value = query;
        if (this.panelBuilt) this.render();
    }

    /**
     * Scan text across all loaded guides and render matching rules as
     * nominations for review. A lexical hit is not an accepted selection, so
     * this deliberately leaves the evaluated rule set unchanged.
     *
     * Asynchronous because scanning is an adapter operation: an in-process
     * guide engine answers immediately, a guide engine behind a runtime answers
     * over the wire, and the component has no business knowing which it holds.
     *
     * @param text - The document text to scan.
     * @returns The scan hits, after the nominations have been rendered.
     */
    async analyzeText(text: string): Promise<GuideScanResult[]> {
        if (!this.guideAdapter || this._destroyed) return [];
        const token = ++this.scanToken;
        let results: GuideScanResult[];
        try {
            results = await Promise.resolve(this.guideAdapter.scan(text));
        } catch (error) {
            if (token !== this.scanToken || this._destroyed) return [];
            console.error('[GuideChecklist] analyzing text failed:', error);
            this.lastScanResults = null;
            this.nominatedRuleIds.clear();
            const message =
                'Unable to analyze text. Your selections are unchanged.';
            this.pendingScanStatus = { status: message, announcement: message };
            if (this.panelBuilt) {
                this.render();
                this.paintScanStatus();
            }
            return [];
        }
        if (token !== this.scanToken || this._destroyed) return [];
        this.lastScanResults = results;
        this.updateScanNominations(results);
        if (this.panelBuilt) {
            this.render();
            this.paintScanStatus();
        }
        return results;
    }

    private updateScanNominations(results: GuideScanResult[]): void {
        const activeResults =
            this.views.length === 0
                ? results
                : results.filter((result) => {
                      const activeGuideId = this.activeGuideByRuleId.get(
                          result.rule.id,
                      );
                      return (
                          activeGuideId !== undefined &&
                          (result.guideId === activeGuideId ||
                              (this.views.length === 1 &&
                                  result.guideId === undefined))
                      );
                  });
        this.nominatedRuleIds = new Set(
            activeResults.map((result) => result.rule.id),
        );
        const count = this.nominatedRuleIds.size;
        if (count > 0) {
            this.pendingScanStatus = {
                status: `${count} rule${count === 1 ? '' : 's'} nominated. Review the highlighted rows and select the ones that apply.`,
                announcement: `${count} rule${count === 1 ? '' : 's'} nominated from text. Review and select any that apply.`,
            };
        } else {
            const message =
                'No rules nominated. Your selections are unchanged.';
            this.pendingScanStatus = { status: message, announcement: message };
        }
    }

    private paintScanStatus(): void {
        if (!this.pendingScanStatus || !this.panelBuilt) return;
        if (this.nominationStatus)
            this.nominationStatus.textContent = this.pendingScanStatus.status;
        announce(this.announcer, this.pendingScanStatus.announcement);
        this.pendingScanStatus = null;
    }

    protected render(): void {
        this.renderCheckboxes();
        this.renderBreakdown();
        this.renderResultValue();
        this.evaluationErrorEl.hidden = !this.evaluationFailed;
    }

    private renderBreakdown(): void {
        this.breakdownContainer.innerHTML = '';
        if (!this.lastEvaluation) return;

        const contributing = this.lastEvaluation.breakdown.filter(
            (b) => !b.wasOverridden,
        );
        if (contributing.length === 0) return;

        const multiGuide = this.views.length > 1;
        const guideById = new Map(this.views.map((v) => [v.id, v]));

        const heading = document.createElement('div');
        heading.className = 'ezc-guide-breakdown-heading';
        heading.textContent = 'Contributing to marking:';
        this.breakdownContainer.appendChild(heading);

        const list = document.createElement('ul');
        list.className = 'ezc-guide-breakdown-list';

        for (const entry of contributing) {
            const guide =
                guideById.get(entry.rule.artifact.id) ??
                (this.views.length === 1 ? this.views[0] : undefined);
            const ruleView = guide
                ? this.rulesByGuide.get(guide.id)?.get(entry.rule.ruleId)
                : undefined;
            const item = document.createElement('li');
            item.className = 'ezc-guide-breakdown-item';

            const main = document.createElement('div');
            main.className = 'ezc-guide-breakdown-main';

            const name = document.createElement('span');
            name.className = 'ezc-guide-breakdown-name';
            if (entry.isComputed)
                name.classList.add('ezc-guide-breakdown-name--computed');
            name.textContent = ruleView?.name ?? entry.rule.ruleId;
            main.appendChild(name);

            if (multiGuide) {
                if (guide) {
                    const source = document.createElement('span');
                    source.className = 'ezc-guide-breakdown-source';
                    source.textContent = guide.name;
                    source.setAttribute(
                        'aria-label',
                        `from guide: ${guide.name}`,
                    );
                    main.appendChild(source);
                }
            }

            const outcomeText = describeOutcome(entry.outcome);
            if (outcomeText) {
                const outcome = document.createElement('span');
                outcome.className = 'ezc-guide-breakdown-outcome';
                appendOutcomeText(outcome, outcomeText);
                main.appendChild(outcome);
            }

            item.appendChild(main);

            if (entry.isComputed && ruleView?.rationale) {
                const rationale = document.createElement('div');
                rationale.className = 'ezc-guide-breakdown-rationale';
                rationale.textContent = ruleView.rationale;
                item.appendChild(rationale);
            }

            list.appendChild(item);
        }

        this.breakdownContainer.appendChild(list);
    }

    private renderTextInput(): HTMLDivElement {
        const wrap = document.createElement('div');
        wrap.className = 'ezc-guide-text-input';

        const label = document.createElement('label');
        label.setAttribute('for', `ezc-guide-textarea-${this.uid}`);
        label.textContent = 'Paste or type your text';
        wrap.appendChild(label);

        const textarea = document.createElement('textarea');
        textarea.id = `ezc-guide-textarea-${this.uid}`;
        textarea.className = 'ezc-guide-textarea';
        textarea.setAttribute('autocomplete', 'off');
        wrap.appendChild(textarea);

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'ezc-guide-analyze-btn';
        btn.textContent = 'Analyze Text';
        btn.addEventListener('click', () => {
            void this.analyzeText(textarea.value);
        });
        wrap.appendChild(btn);

        return wrap;
    }

    private renderSearch(): HTMLDivElement {
        const wrap = document.createElement('div');
        wrap.className = 'ezc-guide-search';

        const label = document.createElement('label');
        label.setAttribute('for', `ezc-guide-search-${this.uid}`);
        label.textContent = 'Search rules by keyword';
        wrap.appendChild(label);

        this.searchInput = document.createElement('input');
        this.searchInput.id = `ezc-guide-search-${this.uid}`;
        this.searchInput.type = 'search';
        this.searchInput.className = 'ezc-guide-search-input';
        this.searchInput.placeholder = 'Type keywords to filter rules\u2026';
        this.searchInput.value = this.filterText;
        this.searchInput.setAttribute('autocomplete', 'off');
        this.searchInput.setAttribute(
            'aria-describedby',
            `ezc-guide-search-hint-${this.uid}`,
        );
        this.searchInput.addEventListener('input', () => {
            this.filterText = this.searchInput.value.trim();
            this.renderCheckboxes();
            const checkable = this.views.flatMap((v) =>
                v.categories
                    .filter((c) => c.id !== '_compound')
                    .flatMap((c) => c.items)
                    .concat(v.uncategorized)
                    .filter(
                        (rule) =>
                            this.activeGuideByRuleId.get(rule.id) === v.id,
                    ),
            );
            const visible = this.filterText
                ? checkable.filter((r) => this.ruleMatchesFilter(r)).length
                : checkable.length;
            announce(
                this.matchCountEl,
                `${visible} rule${visible === 1 ? '' : 's'} match`,
            );
        });
        wrap.appendChild(this.searchInput);

        const hint = document.createElement('span');
        hint.id = `ezc-guide-search-hint-${this.uid}`;
        hint.className = 'ezc-sr-only';
        hint.textContent =
            'Type keywords to filter matching rules. Check all that apply.';
        wrap.appendChild(hint);

        this.matchCountEl = document.createElement('span');
        this.matchCountEl.setAttribute('aria-live', 'polite');
        this.matchCountEl.className = 'ezc-sr-only';
        wrap.appendChild(this.matchCountEl);

        return wrap;
    }

    private renderRuleList(): HTMLFieldSetElement {
        const fieldset = document.createElement('fieldset');
        fieldset.className = 'ezc-guide-rules';
        this.rulesContainer = fieldset;

        const legend = document.createElement('legend');
        legend.className = 'ezc-sr-only';
        legend.textContent = 'Select all rules that apply';
        fieldset.appendChild(legend);

        this.buildRuleCheckboxes(fieldset);

        return fieldset;
    }

    private rebuildRuleList(): void {
        this.rulesContainer.innerHTML = '';
        const legend = document.createElement('legend');
        legend.className = 'ezc-sr-only';
        legend.textContent = 'Select all rules that apply';
        this.rulesContainer.appendChild(legend);
        this.buildRuleCheckboxes(this.rulesContainer);
    }

    private buildRuleCheckboxes(container: HTMLElement): void {
        const opts = this.options as GuideChecklistOptions;
        const showOutcomes = opts.showOutcomes !== false;
        const multiGuide = this.views.length > 1;

        for (const view of this.views) {
            const active = (rules: readonly GuideRuleView[]) =>
                rules.filter(
                    (rule) => this.activeGuideByRuleId.get(rule.id) === view.id,
                );
            if (
                !view.categories.some(
                    (category) => active(category.items).length > 0,
                ) &&
                active(view.uncategorized).length === 0
            )
                continue;
            if (multiGuide) {
                const guideHeading = document.createElement('p');
                guideHeading.className = 'ezc-guide-source-label';
                guideHeading.textContent = view.name;
                container.appendChild(guideHeading);
            }

            for (const cat of view.categories) {
                if (cat.id === '_compound') continue;
                const items = active(cat.items);
                if (items.length === 0) continue;

                const group = document.createElement('div');
                group.setAttribute('role', 'group');
                group.setAttribute('aria-label', cat.label);
                group.dataset.sectionTotal = String(items.length);

                const heading = this.buildCategoryHeading(
                    cat.label,
                    items.length,
                );
                group.appendChild(heading);

                for (const rule of items) {
                    group.appendChild(
                        this.buildCheckboxRow(rule, showOutcomes),
                    );
                }

                container.appendChild(group);
            }

            for (const rule of active(view.uncategorized)) {
                container.appendChild(
                    this.buildCheckboxRow(rule, showOutcomes),
                );
            }

            const compoundItems = active(
                view.categories.find((c) => c.id === '_compound')?.items ?? [],
            );
            if (compoundItems.length > 0) {
                const group = document.createElement('div');
                group.setAttribute('role', 'group');
                group.setAttribute('aria-label', 'Compound Rules');
                group.dataset.sectionTotal = String(compoundItems.length);

                const heading = this.buildCategoryHeading(
                    'Compound Rules',
                    compoundItems.length,
                );
                group.appendChild(heading);

                for (const rule of compoundItems) {
                    group.appendChild(
                        this.buildComputedRow(rule, showOutcomes),
                    );
                }

                container.appendChild(group);
            }
        }
    }

    private buildCategoryHeading(label: string, total: number): HTMLElement {
        const heading = document.createElement('h3');
        heading.className = 'ezc-guide-category-label';
        const labelSpan = document.createElement('span');
        labelSpan.textContent = label;
        heading.appendChild(labelSpan);
        const countSpan = document.createElement('span');
        countSpan.className = 'ezc-guide-category-count';
        countSpan.dataset.total = String(total);
        countSpan.textContent = `(${total})`;
        heading.appendChild(countSpan);
        return heading;
    }

    private buildCheckboxRow(
        rule: GuideRuleView,
        showOutcomes: boolean,
    ): HTMLDivElement {
        const row = document.createElement('div');
        row.className = 'ezc-guide-rule';
        row.dataset.ruleId = rule.id;
        this.ruleByRow.set(row, rule);
        row.dataset.nominated = String(this.nominatedRuleIds.has(rule.id));

        const label = document.createElement('label');

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.value = rule.id;
        checkbox.checked = this.selectedRuleIds.has(rule.id);
        checkbox.setAttribute(
            'aria-describedby',
            `rule-${rule.id}-detail-${this.uid}`,
        );
        checkbox.addEventListener('change', () => {
            if (checkbox.checked) {
                this.selectedRuleIds.add(rule.id);
            } else {
                this.selectedRuleIds.delete(rule.id);
            }
            this.applySelection(true);
        });
        label.appendChild(checkbox);

        const nameSpan = document.createElement('span');
        nameSpan.className = 'ezc-guide-rule-name';
        nameSpan.textContent = rule.name;
        label.appendChild(nameSpan);

        const badge = document.createElement('span');
        badge.className = 'ezc-guide-nominated-badge';
        badge.textContent = 'Nominated';
        badge.hidden = !this.nominatedRuleIds.has(rule.id);
        label.appendChild(badge);

        if (showOutcomes && rule.outcomeText) {
            const outcomeEl = document.createElement('span');
            outcomeEl.className = 'ezc-guide-rule-outcome';
            outcomeEl.setAttribute(
                'aria-label',
                `outcome: ${rule.outcomeText}`,
            );
            appendOutcomeText(outcomeEl, rule.outcomeText);
            label.appendChild(outcomeEl);
        }

        row.appendChild(label);

        if (rule.description) {
            const detailWrap = document.createElement('div');
            detailWrap.id = `rule-${rule.id}-detail-${this.uid}`;
            detailWrap.className = 'ezc-guide-rule-detail';
            detailWrap.textContent = rule.description;
            row.appendChild(detailWrap);
        }

        return row;
    }

    private buildComputedRow(
        rule: GuideRuleView,
        showOutcomes: boolean,
    ): HTMLDivElement {
        const row = document.createElement('div');
        row.className =
            'ezc-guide-rule ezc-guide-rule--auto ezc-guide-rule--inactive';
        row.dataset.ruleId = rule.id;
        this.ruleByRow.set(row, rule);

        const label = document.createElement('label');

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.value = rule.id;
        checkbox.disabled = true;
        checkbox.checked = false;
        label.appendChild(checkbox);

        const nameSpan = document.createElement('span');
        nameSpan.className = 'ezc-guide-rule-name';
        nameSpan.textContent = rule.name;
        label.appendChild(nameSpan);

        const badge = document.createElement('span');
        badge.className = 'ezc-guide-auto-badge';
        badge.textContent = 'auto';
        label.appendChild(badge);

        if (showOutcomes && rule.outcomeText) {
            const outcomeEl = document.createElement('span');
            outcomeEl.className = 'ezc-guide-rule-outcome';
            outcomeEl.textContent = rule.outcomeText;
            label.appendChild(outcomeEl);
        }

        row.appendChild(label);
        return row;
    }

    private renderCheckboxes(): void {
        const filter = this.filterText.toLowerCase();
        const activeComputed = new Set(
            this.lastEvaluation?.activeComputedRules.map((rule) => rule.id),
        );

        const rows =
            this.rulesContainer.querySelectorAll<HTMLDivElement>(
                '.ezc-guide-rule',
            );
        for (const row of rows) {
            const ruleId = row.dataset.ruleId;
            if (!ruleId) continue;

            const ruleView = this.ruleByRow.get(row);
            if (!ruleView) continue;

            if (ruleView.isComputed) {
                const isActive = activeComputed.has(ruleId);
                row.classList.toggle('ezc-guide-rule--inactive', !isActive);
                const cb = row.querySelector<HTMLInputElement>(
                    'input[type="checkbox"]',
                );
                if (cb) cb.checked = !!isActive;
            } else {
                const checkbox = row.querySelector<HTMLInputElement>(
                    'input[type="checkbox"]',
                );
                if (checkbox)
                    checkbox.checked = this.selectedRuleIds.has(ruleId);
                const nominated = this.nominatedRuleIds.has(ruleId);
                row.dataset.nominated = String(nominated);
                row.classList.toggle('ezc-guide-rule--nominated', nominated);
                const badge = row.querySelector<HTMLElement>(
                    '.ezc-guide-nominated-badge',
                );
                if (badge) badge.hidden = !nominated;
            }

            if (filter) {
                const matches = this.ruleMatchesFilter(ruleView);
                row.classList.toggle('ezc-guide-rule--hidden', !matches);
            } else {
                row.classList.remove('ezc-guide-rule--hidden');
            }
        }

        // Update category counts with visible/total when filtering
        const groups =
            this.rulesContainer.querySelectorAll<HTMLElement>('[role="group"]');
        for (const group of groups) {
            const total = parseInt(group.dataset.sectionTotal ?? '0', 10);
            const visible = group.querySelectorAll(
                '.ezc-guide-rule:not(.ezc-guide-rule--hidden)',
            ).length;
            const countEl = group.querySelector<HTMLElement>(
                '.ezc-guide-category-count',
            );
            if (countEl) {
                countEl.textContent = filter
                    ? `(${visible} of ${total})`
                    : `(${total})`;
            }
            // Hide group entirely when no rules match under a filter
            if (filter) {
                group.style.display = visible === 0 ? 'none' : '';
            } else {
                group.style.display = '';
            }
        }

        // Hide guide source headings when all their rules are hidden by filter
        const sourceLabels = this.rulesContainer.querySelectorAll<HTMLElement>(
            '.ezc-guide-source-label',
        );
        for (const label of sourceLabels) {
            if (!filter) {
                label.style.display = '';
                continue;
            }
            let sibling = label.nextElementSibling;
            let anyVisible = false;
            while (
                sibling &&
                !sibling.classList.contains('ezc-guide-source-label')
            ) {
                if (
                    !sibling.classList.contains('ezc-guide-rule--hidden') &&
                    sibling.classList.contains('ezc-guide-rule')
                ) {
                    anyVisible = true;
                    break;
                }
                const visibleInGroup = sibling.querySelector?.(
                    '.ezc-guide-rule:not(.ezc-guide-rule--hidden)',
                );
                if (visibleInGroup) {
                    anyVisible = true;
                    break;
                }
                sibling = sibling.nextElementSibling;
            }
            label.style.display = anyVisible ? '' : 'none';
        }

        // Show "no results" when everything is hidden by the filter
        const existingEmpty =
            this.rulesContainer.querySelector<HTMLElement>('.ezc-guide-empty');
        if (filter) {
            const totalVisible = this.rulesContainer.querySelectorAll(
                '.ezc-guide-rule:not(.ezc-guide-rule--hidden)',
            ).length;
            if (totalVisible === 0) {
                if (!existingEmpty) {
                    const empty = document.createElement('div');
                    empty.className = 'ezc-guide-empty';
                    empty.setAttribute('role', 'status');
                    empty.textContent = `No rules match \u201c${this.filterText}\u201d`;
                    this.rulesContainer.appendChild(empty);
                } else {
                    existingEmpty.textContent = `No rules match \u201c${this.filterText}\u201d`;
                }
            } else if (existingEmpty) {
                existingEmpty.remove();
            }
        } else if (existingEmpty) {
            existingEmpty.remove();
        }
    }

    private renderResult(): HTMLDivElement {
        const wrap = document.createElement('div');
        wrap.className = 'ezc-guide-result';

        const label = document.createElement('span');
        label.className = 'ezc-guide-result-label';
        label.id = `result-label-${this.uid}`;
        label.textContent = 'Computed marking:';
        wrap.appendChild(label);

        this.resultOutput = document.createElement('output');
        this.resultOutput.className = 'ezc-guide-result-value';
        this.resultOutput.setAttribute(
            'aria-labelledby',
            `result-label-${this.uid}`,
        );
        this.resultOutput.setAttribute('aria-live', 'polite');
        this.resultOutput.textContent = '';
        wrap.appendChild(this.resultOutput);

        this.copyBtn = document.createElement('button');
        this.copyBtn.type = 'button';
        this.copyBtn.className = 'ezc-guide-copy-btn';
        this.copyBtn.textContent = 'Copy';
        this.copyBtn.setAttribute('aria-label', 'Copy marking to clipboard');
        this.copyBtn.addEventListener('click', () => this.handleCopy());
        wrap.appendChild(this.copyBtn);

        return wrap;
    }

    private renderResultValue(): void {
        const marking = this.lastEvaluation?.aggregatedMarking ?? '';
        this.resultOutput.textContent = this.evaluationPending
            ? 'Evaluating…'
            : marking || EMPTY_VALUE;
        this.copyBtn.disabled =
            this.evaluationPending || this.evaluationFailed || !marking;
    }

    /**
     * Recompute the evaluation for the current selection.
     *
     * Returns a promise only when the adapter answered with one, so an
     * in-process guide engine stays synchronous and a guide engine behind a
     * runtime hands back something the caller can wait on. The promise resolves
     * to whether its result was still the current one when it landed; it never
     * rejects, because the failure is turned into displayed state here.
     */
    private evaluate(): Promise<boolean> | null {
        const token = ++this.evaluationToken;
        this.evaluationPending = true;
        const adapter = this.guideAdapter;
        if (!adapter) {
            this.settleEvaluation(token, null, false);
            return null;
        }
        const selection = [...this.selectedRuleIds];

        let outcome: MaybePromise<EvaluationResult>;
        try {
            outcome = adapter.evaluateMany(selection);
        } catch (error) {
            console.error(
                '[GuideChecklist] evaluating the selected rules failed:',
                error,
            );
            this.settleEvaluation(token, this.lastEvaluation, true);
            return null;
        }
        if (!isPromiseLike(outcome)) {
            this.settleEvaluation(token, outcome, false);
            return null;
        }
        return Promise.resolve(outcome).then(
            (result) => this.settleEvaluation(token, result, false),
            (error: unknown) => {
                console.error(
                    '[GuideChecklist] evaluating the selected rules failed:',
                    error,
                );
                // Hold the last good marking rather than blanking it, and say
                // so: a checklist that silently keeps showing a marking it can
                // no longer compute is the failure-as-absence pattern.
                return this.settleEvaluation(token, this.lastEvaluation, true);
            },
        );
    }

    /**
     * Record an evaluation outcome and report whether it was still the current
     * one. A superseded result is dropped so the older of two overlapping
     * evaluations cannot overwrite the newer.
     */
    private settleEvaluation(
        token: number,
        result: EvaluationResult | null,
        failed: boolean,
    ): boolean {
        if (token !== this.evaluationToken) return false;
        this.lastEvaluation = result;
        this.evaluationFailed = failed;
        this.evaluationPending = false;
        return true;
    }

    /**
     * Recompute, repaint, and optionally tell the host.
     *
     * The `ezclassify:guide-change` event carries the evaluation of the
     * selection that caused it in both modes: with an in-process guide engine
     * that is this tick, with one behind a runtime it is when the answer lands.
     * A selection superseded before its answer arrived fires nothing; the
     * selection that won fires once, which is the same latest-wins rule the
     * displayed marking follows.
     *
     * @param notify - Whether to emit `ezclassify:guide-change`. Programmatic
     *   selection changes repaint but stay silent, as they always have.
     */
    private applySelection(notify: boolean): void {
        const pending = this.evaluate();
        // Repaint now so the checkbox the user just toggled reflects the click
        // while the evaluation is still in flight.
        this.render();
        if (!pending) {
            if (notify) this.dispatchChangeEvent();
            return;
        }
        void pending.then((current) => {
            if (!current) return;
            this.render();
            if (notify) this.dispatchChangeEvent();
        });
    }

    private handleCopy(): void {
        if (this.evaluationPending || this.evaluationFailed) return;
        const marking = this.lastEvaluation?.aggregatedMarking ?? '';
        if (!marking) return;

        if (typeof navigator !== 'undefined' && navigator.clipboard) {
            navigator.clipboard.writeText(marking).then(
                () => announce(this.announcer, 'Marking copied to clipboard'),
                () => announce(this.announcer, 'Failed to copy marking'),
            );
        }

        const forId =
            this.container
                .closest('[data-ezclassify-target]')
                ?.getAttribute('data-ezclassify-target') ??
            this.container.getAttribute('data-ezclassify-target');
        if (forId) {
            const target = document.getElementById(
                forId,
            ) as HTMLInputElement | null;
            if (target) {
                target.value = marking;
                target.dispatchEvent(new Event('input', { bubbles: true }));
                target.dispatchEvent(new Event('change', { bubbles: true }));
            }
        }

        this.container.dispatchEvent(
            new CustomEvent('ezclassify:guide-copy', {
                bubbles: true,
                detail: { marking },
            }),
        );
    }

    private dispatchChangeEvent(): void {
        this.container.dispatchEvent(
            new CustomEvent('ezclassify:guide-change', {
                bubbles: true,
                detail: this.lastEvaluation,
            }),
        );
    }

    private ruleMatchesFilter(rule: GuideRuleView): boolean {
        const filter = this.filterText.toLowerCase();
        if (!filter) return true;
        if (rule.name.toLowerCase().includes(filter)) return true;
        if (rule.description?.toLowerCase().includes(filter)) return true;
        if (rule.keywords.some((k) => k.toLowerCase().includes(filter)))
            return true;
        if (
            rule.matcherLabels.some((label) =>
                label.toLowerCase().includes(filter),
            )
        )
            return true;
        return false;
    }
}
