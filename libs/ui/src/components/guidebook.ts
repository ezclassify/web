/**
 * Guidebook Component
 *
 * A browsable reference panel that displays all rules from one or more loaded
 * guides, grouped by category. For each rule it shows the name, keywords,
 * outcome, and rationale. Compound rules show their activation conditions and
 * which rules they override.
 *
 * Pass guide data via `opts.guides` (preferred) or the engine may provide a
 * `buildGuideViews()` method as a fallback path. No guide traversal / matcher
 * resolution / filter logic lives here, the structural view is the source of
 * truth.
 */

import {
    referenceSurfaceLabel,
    resolveVocabulary,
    type ReferenceSurfaceLabel,
    type ResolvedVocabulary,
    type FilterResult,
    type GuideStructuralView,
    type GuideRuleView,
    type MaybePromise,
} from '@ezclassify/types';

const GUIDEBOOK_DEFAULTS = {
    rule: { singular: 'rule', plural: 'rules' },
    category: { singular: 'category', plural: 'categories' },
    guide: { singular: 'guide', plural: 'guides' },
};
import {
    ReadOnlyComponentBase,
    type ComponentEngineSource,
    type ComponentOptions,
} from './component-base-readonly';
import guidebookCss from './guidebook.css?inline';
import {
    renderStructuralTree,
    applyFilterToTree,
    buildSearchInput,
    announceMatchCount,
    resolveReferenceSurfaceOverride,
} from './browser-component-base';

/** Options specific to the Guidebook component. */
export interface GuidebookOptions extends ComponentOptions {
    /** If true, all category groups start expanded (default: false). */
    expandAll?: boolean;
    /** Show keyword tags per rule (default: true). */
    showKeywords?: boolean;
    /** Show outcome per rule (default: true). */
    showOutcomes?: boolean;
    /** Show rationale text (default: true). */
    showRationale?: boolean;
    /** Show when conditions on compound rules (default: true). */
    showConditions?: boolean;
    /**
     * Pre-built guide view data. Accepts a single view or multiple. When
     * provided, this takes precedence over any engine-side guide retrieval.
     */
    guides?: GuideStructuralView | GuideStructuralView[];
}

const GUIDEBOOK_CSS: string = guidebookCss;
const ROOT_CLASS = 'ez-guidebook';

/**
 * Duck-typed handle for whichever guide engine actually built `this.views` (the
 * sibling `ctx.guide`, or `this.engine` itself on adapters that bundle guide
 * data onto the scheme handle). `undefined` when views arrived via
 * `opts.guides` pre-built, since that path never touches an engine.
 */
type GuideEngineHandle = {
    /**
     * `MaybePromise` because the guide adapter contract narrows to a
     * synchronous array locally and to a promise remotely. A component that
     * reads either narrowing has to accept both.
     */
    buildGuideViews?: () => MaybePromise<GuideStructuralView[]>;
    getGuideMeta?: (
        guideId?: string,
    ) => { referenceSurfaceLabel?: ReferenceSurfaceLabel } | undefined;
};

/**
 * Browsable reference panel showing all guide rules with keywords, outcomes,
 * and conditions.
 */
export class Guidebook extends ReadOnlyComponentBase {
    /**
     * Mount the component.
     *
     * Narrows the inherited signature to {@link GuidebookOptions} so a caller
     * can pass this component's own options without widening them to the shared
     * shape first.
     *
     * @param container - Element to render into
     * @param engineOrContext - Scheme adapter or composed context; resolved
     *   from the container when omitted
     * @param options - This component's options
     */
    override async init(
        container: HTMLDivElement,
        engineOrContext?: ComponentEngineSource | null,
        options?: GuidebookOptions,
    ): Promise<void> {
        await super.init(container, engineOrContext, options);
    }

    private views: GuideStructuralView[] = [];
    private expanded = new Set<string>();
    private expandedGuides = new Set<string>();
    private body!: HTMLDivElement;
    private searchInputEl!: HTMLInputElement;
    private announcer!: HTMLElement;
    private guideSections = new Map<string, HTMLElement>();
    /** Set by {@link destroy}; guards the async panel build against a teardown. */
    private _destroyed = false;

    protected setup(): void {
        this.injectComponentStyles(GUIDEBOOK_CSS);

        const opts = this.options as GuidebookOptions;

        // Resolution order:
        //   1. Explicit opts.guides (caller pre-built the views).
        //   2. ctx.guide.buildGuideViews(): the canonical path when mounted
        //      against a Context. ctx.scheme is the engine handle (returned by
        //      resolveSchemeEngine), so we have to ask the sibling guide engine
        //      directly. Without this branch a Context-mounted Guidebook would
        //      render empty.
        //   3. engine.buildGuideViews(): fallback for adapters that expose
        //      the method directly (some remote/REST adapters bundle guide
        //      data onto the scheme handle).
        //
        // Tracks whichever guide engine actually produced the views, so the
        // reference-surface lookup can read the pre-resolved
        // GuideMetaView.referenceSurfaceLabel instead of re-deriving it from
        // the raw vocabulary map. Stays undefined for the opts.guides path,
        // which hands us pre-built views with no engine behind them.
        let guideEngineHandle: GuideEngineHandle | undefined;
        let views: MaybePromise<GuideStructuralView[]>;

        if (opts.guides) {
            views = Array.isArray(opts.guides) ? opts.guides : [opts.guides];
        } else {
            const ctxGuide = this.context?.guide as
                GuideEngineHandle | null | undefined;
            const ctxBuild = ctxGuide?.buildGuideViews;
            if (typeof ctxBuild === 'function') {
                views = ctxBuild.call(ctxGuide);
                guideEngineHandle = ctxGuide ?? undefined;
            } else {
                const engineHandle = this.engine as GuideEngineHandle;
                const buildAll = engineHandle.buildGuideViews;
                if (typeof buildAll === 'function') {
                    views = buildAll.call(this.engine);
                    guideEngineHandle = engineHandle;
                } else {
                    views = [];
                }
            }
        }

        // The view list is the only thing this panel waits on, and it may be a
        // promise: the local guide adapter builds the views in process, the
        // remote one fetches them. Resolve it, then build. A rejection gets its
        // own visible state, because a reference panel that renders as an empty
        // region on a failed fetch reads as "this guide has no rules", which is
        // the opposite of what is known.
        if (Array.isArray(views)) {
            this.buildPanel(views, guideEngineHandle);
            return;
        }
        void views.then(
            (resolved) => this.buildPanel(resolved, guideEngineHandle),
            (error: unknown) => this.buildUnavailable(error),
        );
    }

    /**
     * Paint the failure state for a view list that never arrived. Worded and
     * classed apart from the empty state on purpose: "this guide has no rules"
     * and "we could not read this guide" are different facts.
     */
    private buildUnavailable(error: unknown): void {
        if (this._destroyed) return;

        console.error('[Guidebook] could not load the guide views:', error);

        const failed = document.createElement('div');
        failed.className = `${ROOT_CLASS}__error`;
        failed.setAttribute('role', 'alert');
        failed.textContent =
            'Guide unavailable. The rules could not be loaded, so this is not a complete list of what applies.';
        this.container.appendChild(failed);
    }

    /**
     * Build the panel once the structural views are in hand. Split out of
     * {@link setup} because a remote guide adapter answers with a promise, and
     * `setup` is synchronous by contract.
     *
     * @param views - The resolved structural views, in load order.
     * @param guideEngineHandle - The engine that produced them, when one did.
     */
    private buildPanel(
        views: GuideStructuralView[],
        guideEngineHandle: GuideEngineHandle | undefined,
    ): void {
        // A remote guide can answer after the host has already torn the panel
        // down; building into a destroyed container would resurrect it.
        if (this._destroyed) return;

        this.views = views;
        const opts = this.options as GuidebookOptions;

        if (this.views.length === 0) return;

        const combinedVocab = combineVocabularies(this.views);
        // Reference-surface noun: the first loaded guide's own word for its
        // Guidebook (e.g. "Shelving Cheat Sheet"), or `undefined` when none
        // of the loaded guides declare one: same "first guide wins" rule
        // combineVocabularies already uses to keep chrome stable.
        //
        // Prefer the engine's own GuideMetaView.referenceSurfaceLabel (the
        // canonical, already-resolved field per its doc comment) when a guide
        // engine handle is available; core resolves it through the same
        // chokepoint as the vocabulary re-derivation below, so this is not a
        // behavior change, just a single source of truth. Fall back to
        // resolving from view.vocabulary directly only when views arrived via
        // opts.guides, since that path has no engine to ask.
        const primaryLabel =
            guideEngineHandle?.getGuideMeta?.()?.referenceSurfaceLabel ??
            referenceSurfaceLabel(this.views[0]?.vocabulary, 'guidebook');
        const surfaceOverride = resolveReferenceSurfaceOverride(
            primaryLabel,
            'guidebook',
        );

        if (opts.expandAll) {
            for (const view of this.views) {
                for (const cat of view.categories)
                    this.expanded.add(`${view.id}:${cat.id}`);
            }
        }

        // Guide-level expansion only applies when 2+ guides are loaded. With a
        // single guide the title is a plain heading and the body is always open.
        if (this.views.length > 1) {
            if (opts.expandAll) {
                for (const view of this.views) this.expandedGuides.add(view.id);
            } else if (this.views.length > 0) {
                // Default: first guide open, rest collapsed.
                this.expandedGuides.add(this.views[0].id);
            }
        }

        const root = document.createElement('div');
        root.className = ROOT_CLASS;
        root.setAttribute('role', 'region');
        root.setAttribute(
            'aria-label',
            surfaceOverride
                ? surfaceOverride.singular
                : `${combinedVocab.guide.singular} reference`,
        );

        // Search
        const rulePluralLower = combinedVocab.rule.plural.toLowerCase();
        const guidePluralLower = combinedVocab.guide.plural.toLowerCase();
        const { wrap, input, announcer } = buildSearchInput({
            rootClass: ROOT_CLASS,
            placeholder: `Search ${rulePluralLower}…`,
            ariaLabel: surfaceOverride
                ? `Search ${surfaceOverride.singular} ${rulePluralLower}`
                : `Search ${guidePluralLower} ${rulePluralLower}`,
            onInput: (q) => this.onSearch(q),
        });
        this.searchInputEl = input;
        this.announcer = announcer;
        root.appendChild(wrap);

        // Body: role="list"; each guide is a listitem, each category is a nested
        // listitem. The accordion pattern (aria-expanded + aria-controls) lives on
        // buttons inside the listitem sections, not as direct children of the list.
        this.body = document.createElement('div');
        this.body.setAttribute('role', 'list');
        this.body.className = `${ROOT_CLASS}__body`;
        root.appendChild(this.body);

        this.container.appendChild(root);
        this.render();
    }

    destroy(): void {
        this.removeRuleErrors();
        this._destroyed = true;
        this.views = [];
        this.container.innerHTML = '';
    }

    /** Re-render the full tree from the current engine views + expanded state. */
    protected render(): void {
        this.body.innerHTML = '';
        this.guideSections.clear();

        const multiGuide = this.views.length > 1;
        for (const view of this.views) {
            // Use div rather than section so role="listitem" is valid (section cannot
            // carry the listitem role per the ARIA-in-HTML spec).
            const section = document.createElement('div');
            section.className = `${ROOT_CLASS}__guide`;
            section.setAttribute('role', 'listitem');
            section.dataset.guideId = view.id;
            const open = !multiGuide || this.expandedGuides.has(view.id);

            if (multiGuide) {
                const ruleCount =
                    view.categories.reduce((n, c) => n + c.items.length, 0) +
                    view.uncategorized.length;
                const header = document.createElement('button');
                header.type = 'button';
                header.className = `${ROOT_CLASS}__guide-header`;
                header.setAttribute('aria-expanded', String(open));
                header.setAttribute('aria-controls', `guide-body-${view.id}`);
                header.addEventListener('click', () =>
                    this.toggleGuide(view.id),
                );

                const arrow = document.createElement('span');
                arrow.className = `${ROOT_CLASS}__guide-arrow`;
                arrow.setAttribute('aria-hidden', 'true');
                arrow.textContent = open ? '▼' : '▶';

                const title = document.createElement('span');
                title.className = `${ROOT_CLASS}__guide-title`;
                title.textContent = view.name;

                const count = document.createElement('span');
                count.className = `${ROOT_CLASS}__guide-count`;
                count.textContent = `(${ruleCount})`;

                header.append(arrow, title, count);
                section.appendChild(header);
            } else {
                const h = document.createElement('h3');
                h.className = `${ROOT_CLASS}__guide-title`;
                h.textContent = view.name;
                section.appendChild(h);
            }

            const body = document.createElement('div');
            body.className = `${ROOT_CLASS}__guide-body`;
            body.id = `guide-body-${view.id}`;
            if (!open)
                body.classList.add(`${ROOT_CLASS}__guide-body--collapsed`);

            if (view.description) {
                const d = document.createElement('p');
                d.className = `${ROOT_CLASS}__guide-desc`;
                d.textContent = view.description;
                body.appendChild(d);
            }

            const tree = document.createElement('div');
            tree.className = `${ROOT_CLASS}__tree`;
            tree.setAttribute('role', 'list');
            renderStructuralTree({
                container: tree,
                view,
                rootClass: ROOT_CLASS,
                expanded: this.expandedForGuide(view.id),
                onToggleCategory: (categoryId) =>
                    this.toggleCategory(view.id, categoryId),
                renderItem: (item) => this.renderRuleItem(item),
            });
            body.appendChild(tree);
            section.appendChild(body);

            this.body.appendChild(section);
            this.guideSections.set(view.id, section);
        }
    }

    private toggleGuide(guideId: string): void {
        if (this.expandedGuides.has(guideId))
            this.expandedGuides.delete(guideId);
        else this.expandedGuides.add(guideId);
        this.render();
        if (this.searchInputEl.value.trim())
            this.onSearch(this.searchInputEl.value.trim());
    }

    /**
     * Build a per-render expanded set scoped to one guide (strips the guideId
     * prefix).
     */
    private expandedForGuide(guideId: string): Set<string> {
        const out = new Set<string>();
        for (const key of this.expanded) {
            if (key.startsWith(`${guideId}:`))
                out.add(key.slice(guideId.length + 1));
        }
        return out;
    }

    private toggleCategory(guideId: string, categoryId: string): void {
        const key = `${guideId}:${categoryId}`;
        if (this.expanded.has(key)) this.expanded.delete(key);
        else this.expanded.add(key);
        this.render();
        if (this.searchInputEl.value.trim())
            this.onSearch(this.searchInputEl.value.trim());
    }

    /**
     * Filter rule rows over the already-built structural views and apply the
     * result per-guide.
     */
    private onSearch(query: string): void {
        const filterByGuide = new Map<string, FilterResult>();
        for (const view of this.views)
            filterByGuide.set(view.id, computeViewFilter(view, query));

        for (const [guideId, section] of this.guideSections) {
            const tree = section.querySelector<HTMLElement>(
                `.${ROOT_CLASS}__tree`,
            );
            const filter = filterByGuide.get(guideId);
            if (!tree || !filter) continue;
            applyFilterToTree({
                container: tree,
                filter,
                rootClass: ROOT_CLASS,
                query,
            });
        }

        // Hide guide sections whose every rule is filtered out, and auto-expand
        // guides that still have visible matches so the user sees them.
        const active = query.length > 0;
        let totalVisible = 0;
        for (const [guideId, section] of this.guideSections) {
            const filter = filterByGuide.get(guideId);
            if (!filter) continue;
            totalVisible += filter.total.visible;
            if (!active) {
                section.classList.remove(`${ROOT_CLASS}__guide--hidden`);
                continue;
            }
            const anyVisible = filter.total.visible > 0;
            section.classList.toggle(
                `${ROOT_CLASS}__guide--hidden`,
                !anyVisible,
            );
            if (
                anyVisible &&
                this.views.length > 1 &&
                !this.expandedGuides.has(guideId)
            ) {
                this.expandedGuides.add(guideId);
                const body = section.querySelector<HTMLElement>(
                    `.${ROOT_CLASS}__guide-body`,
                );
                body?.classList.remove(`${ROOT_CLASS}__guide-body--collapsed`);
                const header = section.querySelector<HTMLElement>(
                    `.${ROOT_CLASS}__guide-header`,
                );
                header?.setAttribute('aria-expanded', 'true');
                const arrow = section.querySelector<HTMLElement>(
                    `.${ROOT_CLASS}__guide-arrow`,
                );
                if (arrow) arrow.textContent = '▼';
            }
        }
        const vocab = combineVocabularies(this.views);
        announceMatchCount(
            this.announcer,
            totalVisible,
            query,
            vocab.rule.singular.toLowerCase(),
            vocab.rule.plural.toLowerCase(),
        );
    }

    /**
     * Render one rule row, driven entirely by fields on the engine-built
     * `GuideRuleView`.
     */
    private renderRuleItem(rule: GuideRuleView): HTMLElement {
        const opts = this.options as GuidebookOptions;
        const showKeywords = opts.showKeywords !== false;
        const showOutcomes = opts.showOutcomes !== false;
        const showRationale = opts.showRationale !== false;
        const showConditions = opts.showConditions !== false;

        const el = document.createElement('div');
        el.className = `${ROOT_CLASS}__entry`;
        el.dataset.itemId = rule.id;
        el.tabIndex = 0;
        el.setAttribute('role', 'article');
        el.setAttribute('aria-label', rule.name);

        const header = document.createElement('div');
        header.className = `${ROOT_CLASS}__entry-header`;

        const name = document.createElement('span');
        name.className = `${ROOT_CLASS}__entry-name`;
        name.textContent = rule.name;
        header.appendChild(name);

        if (rule.isComputed) {
            const badge = document.createElement('span');
            badge.className = `${ROOT_CLASS}__computed-badge`;
            badge.textContent = 'auto';
            badge.title =
                'This rule fires automatically when its conditions are met';
            header.appendChild(badge);
        }

        if (showOutcomes && rule.outcomeText) {
            const out = document.createElement('span');
            out.className = `${ROOT_CLASS}__outcome`;
            out.textContent = rule.outcomeText;
            out.setAttribute('aria-label', `outcome: ${rule.outcomeText}`);
            header.appendChild(out);
        }

        el.appendChild(header);

        if (rule.description) {
            const desc = document.createElement('div');
            desc.className = `${ROOT_CLASS}__desc`;
            desc.textContent = rule.description;
            el.appendChild(desc);
        }

        if (
            showKeywords &&
            (rule.keywords.length > 0 || rule.matcherLabels.length > 0)
        ) {
            const tags = document.createElement('div');
            tags.className = `${ROOT_CLASS}__keywords`;
            for (const kw of rule.keywords) {
                const tag = document.createElement('span');
                tag.className = `${ROOT_CLASS}__keyword ${ROOT_CLASS}__keyword--literal`;
                tag.textContent = kw;
                tags.appendChild(tag);
            }
            for (const label of rule.matcherLabels) {
                const tag = document.createElement('span');
                tag.className = `${ROOT_CLASS}__keyword ${ROOT_CLASS}__keyword--matcher`;
                tag.textContent = label;
                tags.appendChild(tag);
            }
            el.appendChild(tags);
        }

        if (showConditions && rule.whenText) {
            const when = document.createElement('div');
            when.className = `${ROOT_CLASS}__condition`;
            when.textContent = `When: ${rule.whenText}`;
            el.appendChild(when);
        }

        if (showRationale && rule.rationale) {
            const rationale = document.createElement('div');
            rationale.className = `${ROOT_CLASS}__rationale`;
            rationale.textContent = rule.rationale;
            el.appendChild(rationale);
        }

        if (rule.dependsOnNames.length > 0) {
            const dependencies = document.createElement('div');
            dependencies.className = `${ROOT_CLASS}__dependencies`;
            dependencies.textContent = `Depends on: ${rule.dependsOnNames.join(', ')}`;
            el.appendChild(dependencies);
        }

        if (rule.overrideNames.length > 0) {
            const overrides = document.createElement('div');
            overrides.className = `${ROOT_CLASS}__overrides`;
            overrides.textContent = `Overrides: ${rule.overrideNames.join(', ')}`;
            el.appendChild(overrides);
        }

        return el;
    }
}

/**
 * Merge the vocabularies of every loaded guide with this component's default
 * term map. When guides disagree, the first guide wins; this keeps UI chrome
 * stable across searches while per-guide sections still show each guide's
 * name.
 */
function combineVocabularies(views: GuideStructuralView[]): ResolvedVocabulary {
    return resolveVocabulary(views[0]?.vocabulary, GUIDEBOOK_DEFAULTS);
}

/**
 * Case-insensitive substring filter over a single structural view. Matches rule
 * id, name, description, rationale, keywords, and resolved matcher labels, the
 * same surface as engine.filterGuideRules, but operating on the view (which
 * already pre-resolved matcher labels) so the component never needs the raw
 * Guide.
 */
function computeViewFilter(
    view: GuideStructuralView,
    query: string,
): FilterResult {
    const q = query.trim().toLowerCase();
    const visibleIds = new Set<string>();
    const categoryCounts = new Map<
        string,
        { visible: number; total: number }
    >();
    let totalVisible = 0;
    let total = 0;

    const matches = (r: GuideRuleView): boolean => {
        if (!q) return true;
        if (r.id.toLowerCase().includes(q)) return true;
        if (r.name.toLowerCase().includes(q)) return true;
        if (r.description?.toLowerCase().includes(q)) return true;
        if (r.rationale?.toLowerCase().includes(q)) return true;
        if (r.keywords.some((k) => k.toLowerCase().includes(q))) return true;
        if (r.matcherLabels.some((l) => l.toLowerCase().includes(q)))
            return true;
        return false;
    };

    for (const category of view.categories) {
        let catVis = 0;
        for (const item of category.items) {
            total++;
            if (matches(item)) {
                visibleIds.add(item.id);
                catVis++;
                totalVisible++;
            }
        }
        categoryCounts.set(category.id, {
            visible: catVis,
            total: category.items.length,
        });
    }
    for (const item of view.uncategorized) {
        total++;
        if (matches(item)) {
            visibleIds.add(item.id);
            totalVisible++;
        }
    }

    return {
        visibleIds,
        categoryCounts,
        total: { visible: totalVisible, total },
    };
}
