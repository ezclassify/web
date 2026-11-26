/**
 * GuideChecklist Component
 *
 * An interactive helper that lets users search guide rules by keyword, check
 * the rules that apply to their data, see compound rules activate, and copy the
 * computed marking result.
 *
 * Supports text analysis: paste a paragraph to surface lexical nominations for
 * review. Scanning never accepts a rule or changes the evaluated selection.
 *
 * Every rule is tracked by its guide and its id together. A Context's guides
 * sit side by side, so two guides that use the same rule id show two rows, and
 * the selection sent to `evaluateMany` names each rule's guide.
 *
 * With `data-ezclassify-bound-to="<marking id>"` on its host, copying the
 * computed marking also writes it to that marking through the store.
 *
 * Markup declares the rest. `selected` opens the checklist on a set of
 * selections, `editor` turns on text analysis, in a built-in textarea or a
 * `<textarea>` the page wrote, and `result` shows the computed marking in an
 * element elsewhere on the page. Markup the checklist cannot honor is refused
 * whole, so a page never opens on a marking other than the one it declared.
 */

import {
    resolveVocabulary,
    describeOutcome,
    type Assertion,
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
import { t } from '../i18n';
import { getMountHost } from '../mount-host-registry';
import guideHelperCss from './guide-helper.css?inline';
import { dismissStatusMarkPopover } from './status-mark';
import { markingTarget } from './marking-target';

/** The nouns the page's locale gives the chrome when a guide names none. */
function guideHelperDefaults() {
    return {
        rule: { singular: t('noun.rule.one'), plural: t('noun.rule.other') },
        guide: { singular: t('noun.guide.one'), plural: t('noun.guide.other') },
    };
}

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

/**
 * One selected rule, named by the guide that holds it. A Context holds its
 * guides side by side, and two guides may use the same rule id for two
 * different rules, so a rule id alone does not say which rule was selected.
 */
export interface GuideRuleSelection {
    /** Id of the guide that holds the rule. */
    guideId: string;
    /** Id of the rule within that guide. */
    ruleId: string;
}

/** The key a rule is tracked under: its guide and its id within that guide. */
function selectionKey(guideId: string, ruleId: string): string {
    return `${guideId}\u001f${ruleId}`;
}

/** The selections as the map {@link GuideChecklist} tracks them in. */
function toSelectionMap(
    selections: readonly GuideRuleSelection[],
): Map<string, GuideRuleSelection> {
    return new Map(
        selections.map(({ guideId, ruleId }) => [
            selectionKey(guideId, ruleId),
            { guideId, ruleId },
        ]),
    );
}

/** Read a `selected` value, or return null when it is not a selection list. */
function parseSelected(value: string): GuideRuleSelection[] | null {
    let parsed: unknown;
    try {
        parsed = JSON.parse(value);
    } catch {
        return null;
    }
    if (!Array.isArray(parsed)) return null;
    const selections: GuideRuleSelection[] = [];
    for (const entry of parsed as unknown[]) {
        const { guideId, ruleId } = (entry ?? {}) as Record<string, unknown>;
        if (typeof guideId !== 'string' || typeof ruleId !== 'string')
            return null;
        selections.push({ guideId, ruleId });
    }
    return selections;
}

/** Markup the checklist refuses, reported as an `ezclassify:host-error`. */
class RefusedMarkup extends Error {
    constructor(
        readonly code: 'guide-selection-refused' | 'guide-target-missing',
        message: string,
    ) {
        super(message);
    }
}

/** What a checklist's markup declared, once every part of it has been read. */
interface ChecklistMarkup {
    selections: GuideRuleSelection[];
    /** The page's textarea, `'built-in'` for our own, null for no analysis. */
    editor: HTMLTextAreaElement | 'built-in' | null;
    /** The element that shows the computed marking, null for the panel. */
    result: HTMLElement | null;
}

/** Options specific to the GuideChecklist component. */
export interface GuideChecklistOptions extends ComponentOptions {
    /** Show outcome per rule (default: true). */
    showOutcomes?: boolean;
    /** Show rationale text (default: false). */
    showRationale?: boolean;
    /** Clipboard format (default: 'text'). */
    copyFormat?: 'text' | 'html';
    /**
     * Turn on text analysis. Empty or `"true"` renders a built-in textarea;
     * otherwise the DOM id of a `<textarea>` on the page, whose own text and
     * label are used as written. Absent or `"false"` leaves it off.
     */
    editor?: string;
    /**
     * DOM id of the element that shows the computed marking and its breakdown
     * in place of the panel.
     */
    result?: string;
    /**
     * JSON array of `{ guideId, ruleId }`, the rules selected when the
     * checklist opens.
     */
    selected?: string;
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
    private markingTools: HTMLElement | null = null;
    private markingValue: HTMLElement | null = null;

    private views: GuideStructuralView[] = [];
    private ruleByRow = new WeakMap<HTMLElement, GuideRuleView>();
    private rulesByGuide = new Map<string, Map<string, GuideRuleView>>();
    /** The guide each rendered row belongs to. */
    private guideByRow = new WeakMap<HTMLElement, string>();
    private guideAdapter: GuideEngineAdapter | null = null;
    private activeGuideIndex = 0;
    /**
     * The selected rules, keyed by {@link selectionKey}, in the order the
     * reviewer selected them.
     */
    private selectedRules = new Map<string, GuideRuleSelection>();
    /** Nominated rules, keyed by {@link selectionKey}. */
    private nominatedRules = new Set<string>();
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
    /** What this checklist put in the page outside its own container. */
    private placedNodes: HTMLElement[] = [];
    private uid = Math.random().toString(36).slice(2, 8);
    /** Set by {@link destroy}; guards the async panel build against a teardown. */
    private _destroyed = false;

    private get vocab(): ResolvedVocabulary {
        return resolveVocabulary(
            this.views[this.activeGuideIndex],
            guideHelperDefaults(),
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

        this.paintUnavailable(t('guide.unavailableRules'));
    }

    private paintUnavailable(text: string): void {
        const failed = document.createElement('div');
        failed.className = 'ezc-guide-unavailable';
        failed.setAttribute('role', 'alert');
        failed.textContent = text;
        this.container.appendChild(failed);
    }

    /**
     * Refuse markup the checklist cannot honor: say so on the page and tell the
     * host why, in the shape every other refused host reports.
     */
    private refuseMarkup(refusal: RefusedMarkup): void {
        console.error(refusal.message);
        this.paintUnavailable(t('guide.unavailableSetup'));
        (getMountHost(this.container) ?? this.container).dispatchEvent(
            new CustomEvent('ezclassify:host-error', {
                bubbles: true,
                composed: true,
                detail: { code: refusal.code, message: refusal.message },
            }),
        );
    }

    /** Find an element a checklist option names, in the checklist's own tree. */
    private pageElement(id: string): HTMLElement | null {
        const root = this.container.getRootNode();
        return 'getElementById' in root
            ? (root as Document | ShadowRoot).getElementById(id)
            : null;
    }

    /**
     * Read everything the markup declares before anything is built.
     *
     * @throws {RefusedMarkup} When any part of it cannot be honored.
     */
    private readMarkup(): ChecklistMarkup {
        const opts = this.options as GuideChecklistOptions;
        return {
            selections:
                opts.selected === undefined
                    ? []
                    : this.readSelected(opts.selected),
            editor: this.readEditor(opts.editor),
            result:
                opts.result === undefined ? null : this.readResult(opts.result),
        };
    }

    /**
     * Every declared selection has to be a rule a reviewer could check. One
     * that is not is refused rather than dropped, since evaluating the rest
     * would open on a marking the page did not declare.
     */
    private readSelected(value: string): GuideRuleSelection[] {
        const selections = parseSelected(value);
        if (!selections) {
            throw new RefusedMarkup(
                'guide-selection-refused',
                `[GuideChecklist] "selected" must be a JSON array of { guideId, ruleId }, got: ${value}`,
            );
        }
        for (const { guideId, ruleId } of selections) {
            const rule = this.rulesByGuide.get(guideId)?.get(ruleId);
            if (!rule || rule.isComputed) {
                throw new RefusedMarkup(
                    'guide-selection-refused',
                    `[GuideChecklist] "selected" names ${ruleId} in ${guideId}, which is not a selectable rule of a loaded guide.`,
                );
            }
        }
        return selections;
    }

    private readEditor(
        value: string | undefined,
    ): HTMLTextAreaElement | 'built-in' | null {
        if (value === undefined || value === 'false') return null;
        if (value === '' || value === 'true') return 'built-in';
        const target = this.pageElement(value);
        if (target?.tagName !== 'TEXTAREA') {
            throw new RefusedMarkup(
                'guide-target-missing',
                `[GuideChecklist] "editor" names "${value}", which is not a <textarea> on the page.`,
            );
        }
        return target as HTMLTextAreaElement;
    }

    private readResult(value: string): HTMLElement {
        const target = this.pageElement(value);
        if (!target) {
            throw new RefusedMarkup(
                'guide-target-missing',
                `[GuideChecklist] "result" names "${value}", which is not an element on the page.`,
            );
        }
        return target;
    }

    /**
     * Put a node of this checklist in the page, outside its container. It
     * carries the marker its design tokens are scoped to, and leaves with the
     * checklist.
     */
    private trackPlaced(node: HTMLElement): HTMLElement {
        node.setAttribute('data-ezclassify', '');
        this.placedNodes.push(node);
        return node;
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
        if (this.lastScanResults !== null)
            this.updateScanNominations(this.lastScanResults);

        let markup: ChecklistMarkup;
        try {
            markup = this.readMarkup();
        } catch (error) {
            if (!(error instanceof RefusedMarkup)) throw error;
            this.refuseMarkup(error);
            return;
        }

        if (this.views.length === 0) return;

        // A selection the host set while the views were loading is newer than
        // the markup, so it stands.
        const seeded =
            markup.selections.length > 0 && this.selectedRules.size === 0;
        if (seeded) this.selectedRules = toSelectionMap(markup.selections);

        const root = document.createElement('div');
        root.className = 'ezc-guide-helper';
        root.setAttribute('role', 'region');
        this.mountBoundMarkingTools(root);
        root.setAttribute('aria-label', this.views[0].name);

        if (markup.editor) {
            if (markup.editor === 'built-in') {
                root.appendChild(this.renderTextInput());
            } else {
                markup.editor.after(
                    this.trackPlaced(this.renderAnalyzeButton(markup.editor)),
                );
            }
            this.nominationStatus = document.createElement('div');
            this.nominationStatus.className = 'ezc-guide-nomination-status';
            this.nominationStatus.setAttribute('role', 'status');
            this.nominationStatus.setAttribute('aria-live', 'polite');
            this.nominationStatus.textContent = t('guide.analyzePrompt');
            root.appendChild(this.nominationStatus);
        }

        root.appendChild(this.renderSearch());
        root.appendChild(this.renderRuleList());

        this.breakdownContainer = document.createElement('div');
        this.breakdownContainer.className = 'ezc-guide-breakdown';
        this.breakdownContainer.setAttribute('aria-live', 'polite');
        this.breakdownContainer.setAttribute('role', 'log');
        const result = this.renderResult();

        this.evaluationErrorEl = document.createElement('div');
        this.evaluationErrorEl.className = 'ezc-guide-error';
        this.evaluationErrorEl.setAttribute('role', 'alert');
        this.evaluationErrorEl.hidden = true;
        this.evaluationErrorEl.textContent = t('guide.evaluationFailed');

        // The failure notice stays beside the marking it qualifies, wherever
        // that marking is shown.
        if (markup.result) {
            for (const node of [
                result,
                this.breakdownContainer,
                this.evaluationErrorEl,
            ]) {
                markup.result.appendChild(this.trackPlaced(node));
            }
        } else {
            root.append(
                this.breakdownContainer,
                result,
                this.evaluationErrorEl,
            );
        }

        this.announcer = createAnnouncer();
        root.appendChild(this.announcer);

        this.container.appendChild(root);
        this.panelBuilt = true;
        if (seeded) this.applySeededSelection();
        else if (this.selectedRules.size > 0) this.applySelection(false);
        else this.render();
        this.paintScanStatus();
    }

    destroy(): void {
        this.destroyFieldTools();
        if (this.markingTools) dismissStatusMarkPopover(this.markingTools);
        this.markingTools = null;
        this.markingValue = null;
        this.removeRuleErrors();
        for (const node of this.placedNodes) node.remove();
        this.placedNodes = [];
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
        this.guideByRow = new WeakMap();
        this.rulesByGuide.clear();
        this.panelBuilt = false;
        this.selectedRules.clear();
        this.lastScanResults = null;
        this.nominatedRules.clear();
        this.lastEvaluation = null;
        this.pendingScanStatus = null;
        this.container.innerHTML = '';
    }

    /** The selected (checked) rules, each named by its guide. */
    getSelections(): GuideRuleSelection[] {
        return [...this.selectedRules.values()].map((s) => ({ ...s }));
    }

    /** Get the last evaluation result. */
    getEvaluation(): EvaluationResult | null {
        return this.lastEvaluation;
    }

    /**
     * Programmatically set the selected rules and re-evaluate.
     *
     * @param selections - The rules to select, each named by its guide.
     */
    setSelections(selections: readonly GuideRuleSelection[]): void {
        this.selectedRules = toSelectionMap(selections);
        if (this.panelBuilt) this.applySelection(false);
    }

    /** Clear all selections. */
    clearSelection(): void {
        this.selectedRules.clear();
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
            this.nominatedRules.clear();
            const message = t('guide.scanFailed');
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

    /**
     * Nominate each hit's rule in the guide it names. A hit no loaded guide
     * holds nominates nothing, so a rule id two guides share never nominates
     * the other guide's rule.
     */
    private updateScanNominations(results: GuideScanResult[]): void {
        this.nominatedRules = new Set();
        for (const { guideId, rule } of results) {
            if (!this.rulesByGuide.get(guideId)?.has(rule.id)) continue;
            this.nominatedRules.add(selectionKey(guideId, rule.id));
        }
        const count = this.nominatedRules.size;
        if (count > 0) {
            this.pendingScanStatus = {
                status: t(
                    count === 1
                        ? 'guide.nominatedStatus.one'
                        : 'guide.nominatedStatus.other',
                ).replace('{count}', String(count)),
                announcement: t(
                    count === 1
                        ? 'guide.nominatedAnnouncement.one'
                        : 'guide.nominatedAnnouncement.other',
                ).replace('{count}', String(count)),
            };
        } else {
            const message = t('guide.noneNominated');
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
        if (!this.panelBuilt) return;
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
        heading.textContent = t('guide.contributing');
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
        label.textContent = t('guide.pasteLabel');
        wrap.appendChild(label);

        const textarea = document.createElement('textarea');
        textarea.id = `ezc-guide-textarea-${this.uid}`;
        textarea.className = 'ezc-guide-textarea';
        textarea.setAttribute('autocomplete', 'off');
        wrap.appendChild(textarea);
        wrap.appendChild(this.renderAnalyzeButton(textarea));

        return wrap;
    }

    private renderAnalyzeButton(
        textarea: HTMLTextAreaElement,
    ): HTMLButtonElement {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'ezc-guide-analyze-btn';
        btn.textContent = t('guide.analyzeButton');
        btn.addEventListener('click', () => {
            void this.analyzeText(textarea.value);
        });
        return btn;
    }

    private renderSearch(): HTMLDivElement {
        const wrap = document.createElement('div');
        wrap.className = 'ezc-guide-search';

        const label = document.createElement('label');
        label.setAttribute('for', `ezc-guide-search-${this.uid}`);
        label.textContent = t('guide.searchLabel');
        wrap.appendChild(label);

        this.searchInput = document.createElement('input');
        this.searchInput.id = `ezc-guide-search-${this.uid}`;
        this.searchInput.type = 'search';
        this.searchInput.className = 'ezc-guide-search-input';
        this.searchInput.placeholder = t('guide.searchPlaceholder');
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
                    .concat(v.uncategorized),
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
        hint.textContent = t('guide.searchHint');
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
        legend.textContent = t('guide.selectLegend');
        fieldset.appendChild(legend);

        this.buildRuleCheckboxes(fieldset);

        return fieldset;
    }

    private rebuildRuleList(): void {
        this.rulesContainer.innerHTML = '';
        const legend = document.createElement('legend');
        legend.className = 'ezc-sr-only';
        legend.textContent = t('guide.selectLegend');
        this.rulesContainer.appendChild(legend);
        this.buildRuleCheckboxes(this.rulesContainer);
    }

    private buildRuleCheckboxes(container: HTMLElement): void {
        const opts = this.options as GuideChecklistOptions;
        const showOutcomes = opts.showOutcomes !== false;
        const multiGuide = this.views.length > 1;

        for (const [viewIndex, view] of this.views.entries()) {
            if (
                !view.categories.some(
                    (category) => category.items.length > 0,
                ) &&
                view.uncategorized.length === 0
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
                const items = cat.items;
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
                        this.buildCheckboxRow(
                            view.id,
                            viewIndex,
                            rule,
                            showOutcomes,
                        ),
                    );
                }

                container.appendChild(group);
            }

            for (const rule of view.uncategorized) {
                container.appendChild(
                    this.buildCheckboxRow(
                        view.id,
                        viewIndex,
                        rule,
                        showOutcomes,
                    ),
                );
            }

            const compoundItems =
                view.categories.find((c) => c.id === '_compound')?.items ?? [];
            if (compoundItems.length > 0) {
                const group = document.createElement('div');
                group.setAttribute('role', 'group');
                group.setAttribute('aria-label', t('guide.compoundRules'));
                group.dataset.sectionTotal = String(compoundItems.length);

                const heading = this.buildCategoryHeading(
                    t('guide.compoundRules'),
                    compoundItems.length,
                );
                group.appendChild(heading);

                for (const rule of compoundItems) {
                    group.appendChild(
                        this.buildComputedRow(view.id, rule, showOutcomes),
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
        guideId: string,
        viewIndex: number,
        rule: GuideRuleView,
        showOutcomes: boolean,
    ): HTMLDivElement {
        const key = selectionKey(guideId, rule.id);
        // The guide's position, not its id, keeps the detail id a valid,
        // unique token when two guides share a rule id.
        const detailId = `rule-${viewIndex}-${rule.id}-detail-${this.uid}`;
        const row = document.createElement('div');
        row.className = 'ezc-guide-rule';
        row.dataset.ruleId = rule.id;
        row.dataset.guideId = guideId;
        this.ruleByRow.set(row, rule);
        this.guideByRow.set(row, guideId);
        row.dataset.nominated = String(this.nominatedRules.has(key));

        const label = document.createElement('label');

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.value = rule.id;
        checkbox.checked = this.selectedRules.has(key);
        if (rule.description)
            checkbox.setAttribute('aria-describedby', detailId);
        checkbox.addEventListener('change', () => {
            if (checkbox.checked) {
                this.selectedRules.set(key, { guideId, ruleId: rule.id });
            } else {
                this.selectedRules.delete(key);
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
        badge.textContent = t('guide.nominatedBadge');
        badge.hidden = !this.nominatedRules.has(key);
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
            detailWrap.id = detailId;
            detailWrap.className = 'ezc-guide-rule-detail';
            detailWrap.textContent = rule.description;
            row.appendChild(detailWrap);
        }

        return row;
    }

    private buildComputedRow(
        guideId: string,
        rule: GuideRuleView,
        showOutcomes: boolean,
    ): HTMLDivElement {
        const row = document.createElement('div');
        row.className =
            'ezc-guide-rule ezc-guide-rule--auto ezc-guide-rule--inactive';
        row.dataset.ruleId = rule.id;
        row.dataset.guideId = guideId;
        this.ruleByRow.set(row, rule);
        this.guideByRow.set(row, guideId);

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
        const activeComputed = this.activeComputedKeys();

        const rows =
            this.rulesContainer.querySelectorAll<HTMLDivElement>(
                '.ezc-guide-rule',
            );
        for (const row of rows) {
            const ruleId = row.dataset.ruleId;
            if (!ruleId) continue;

            const ruleView = this.ruleByRow.get(row);
            const guideId = this.guideByRow.get(row);
            if (!ruleView || guideId === undefined) continue;
            const key = selectionKey(guideId, ruleId);

            if (ruleView.isComputed) {
                const isActive = activeComputed.has(key);
                row.classList.toggle('ezc-guide-rule--inactive', !isActive);
                const cb = row.querySelector<HTMLInputElement>(
                    'input[type="checkbox"]',
                );
                if (cb) cb.checked = !!isActive;
            } else {
                const checkbox = row.querySelector<HTMLInputElement>(
                    'input[type="checkbox"]',
                );
                if (checkbox) checkbox.checked = this.selectedRules.has(key);
                const nominated = this.nominatedRules.has(key);
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
                    empty.textContent = t('guide.noMatch').replace(
                        '{filter}',
                        () => this.filterText,
                    );
                    this.rulesContainer.appendChild(empty);
                } else {
                    existingEmpty.textContent = t('guide.noMatch').replace(
                        '{filter}',
                        () => this.filterText,
                    );
                }
            } else if (existingEmpty) {
                existingEmpty.remove();
            }
        } else if (existingEmpty) {
            existingEmpty.remove();
        }
    }

    /**
     * The computed rules the last evaluation activated, keyed by guide. The
     * breakdown names each rule's guide; a single loaded guide also owns every
     * rule the result lists without one.
     */
    private activeComputedKeys(): Set<string> {
        const keys = new Set<string>();
        const evaluation = this.lastEvaluation;
        if (!evaluation) return keys;
        for (const entry of evaluation.breakdown) {
            if (entry.isComputed)
                keys.add(
                    selectionKey(entry.rule.artifact.id, entry.rule.ruleId),
                );
        }
        if (this.views.length === 1) {
            for (const rule of evaluation.activeComputedRules)
                keys.add(selectionKey(this.views[0].id, rule.id));
        }
        return keys;
    }

    private renderResult(): HTMLDivElement {
        const wrap = document.createElement('div');
        wrap.className = 'ezc-guide-result';

        const label = document.createElement('span');
        label.className = 'ezc-guide-result-label';
        label.id = `result-label-${this.uid}`;
        label.textContent = t('guide.computedLabel');
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
        this.copyBtn.textContent = t('guide.copy');
        this.copyBtn.setAttribute('aria-label', t('guide.copyLabel'));
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
        const selection = this.getSelections();

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

    /**
     * Evaluate the selection the markup declared. The page has no other way to
     * learn what it opened on, so this tells the host as a reviewer's change
     * would; a turn later, so a listener attached in the same tick as
     * initialization hears it.
     */
    private applySeededSelection(): void {
        const pending = this.evaluate();
        this.render();
        void Promise.resolve(pending ?? true).then((current) => {
            if (!current || this._destroyed) return;
            this.render();
            this.dispatchChangeEvent();
        });
    }

    private handleCopy(): void {
        if (this.evaluationPending || this.evaluationFailed) return;
        const marking = this.lastEvaluation?.aggregatedMarking ?? '';
        if (!marking) return;

        if (typeof navigator !== 'undefined' && navigator.clipboard) {
            navigator.clipboard.writeText(marking).then(
                () => announce(this.announcer, t('guide.copied')),
                () => announce(this.announcer, t('guide.copyFailed')),
            );
        }

        // `data-ezclassify-bound-to` makes the checklist a second editor of
        // the named marking. The runtime wires the binding; the checklist
        // hands it the computed marking, and the store reads it like any
        // other edit, so every view of that marking follows.
        if (this.isBound()) this.options.onChange?.([], marking);

        this.container.dispatchEvent(
            new CustomEvent('ezclassify:guide-copy', {
                bubbles: true,
                detail: { marking },
            }),
        );
    }

    /** Tools edit the associated marking, independently of guide selections. */
    private mountBoundMarkingTools(root: HTMLElement): void {
        const target = this.isBound() ? markingTarget(this) : undefined;
        if (!target) return;
        const row = document.createElement('div');
        row.className = 'ezc-guide-marking-tools';
        row.setAttribute('role', 'group');
        const label = document.createElement('span');
        label.className = 'ezc-guide-marking-label';
        label.id = `current-marking-label-${this.uid}`;
        row.setAttribute('aria-labelledby', label.id);
        label.textContent = t('guide.currentLabel');
        const value = document.createElement('span');
        value.className = 'ezc-guide-marking-value';
        this.markingValue = value;
        value.textContent = target.getCurrent().rendered || EMPTY_VALUE;
        row.append(label, value);
        root.appendChild(row);
        this.markingTools = this.mountFieldTools(
            row,
            {
                root: this.options.root ?? this.container,
                keyboardRoot: this.container,
            },
            () => ({
                root: this.options.root ?? this.container,
                config: this.options.favorites,
                ...target,
                focusField: () => this.searchInput.focus(),
            }),
        );
    }

    /** Whether the host names a marking with `data-ezclassify-bound-to`. */
    private isBound(): boolean {
        const host = getMountHost(this.container) ?? this.container;
        return !!host.getAttribute('data-ezclassify-bound-to');
    }

    /**
     * A bound-store commit updates the Current marking tools row. The guide
     * selection and its independently computed result stay as they are.
     */
    override setAssertions(assertions: Assertion[]): void {
        this.assertions = [...assertions];
        const target = markingTarget(this);
        if (target && this.markingValue)
            this.markingValue.textContent =
                target.getCurrent().rendered || EMPTY_VALUE;
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
