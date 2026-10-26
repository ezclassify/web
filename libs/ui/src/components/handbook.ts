/**
 * Handbook Component
 *
 * A browsable reference panel that displays all concepts from the loaded
 * profile, grouped by category. For each concept it shows the name, definition,
 * guidance, constraint rules, and aliases; the same rich information that
 * appears in hover tooltips, but laid out in a searchable, scrollable view.
 *
 * When the profile defines multiple scopes, a tab bar lets users switch between
 * them, filtering categories and concepts to the active scope using the same
 * rules as the engine's suggestion system. A profile overview section at the
 * top shows the profile's name, version, description, and guidance before the
 * category list.
 *
 * Categories start collapsed. When a search filter is active, matching concepts
 * inside collapsed categories are revealed.
 */

import type {
    CategoryView,
    ConceptDescription,
    ConceptView,
} from '@ezclassify/types';
import {
    isAddressableSchemeEngine,
    ReadOnlyComponentBase,
    type ComponentEngineSource,
    type ComponentOptions,
} from './component-base-readonly';
import { createAnnouncer, announce } from './component-utils';
import { resolveReferenceSurfaceOverride } from './browser-component-base';
import handbookCss from './handbook.css?inline';

/** Structured description data for a single concept entry. */
interface EntryData {
    concept: ConceptView;
    category: CategoryView;
    /** Constraint/inference rules. Null means not yet loaded (lazy). */
    rules: string[] | null;
    /** Depth in the in-category parent hierarchy (0 = root). */
    depth: number;
}

/** Minimal profile shape for entry building. */
interface ProfileLike {
    concepts: ConceptView[];
    categories: CategoryView[];
}

/** Minimal engine adapter shape for getConceptsInCategory. */
interface ConceptsInCategoryProvider {
    getConceptsInCategory?(
        categoryId: string,
        opts: { nested: true },
    ): Array<{ concept: ConceptView; depth: number }> | undefined;
}

/**
 * Check whether an entry belongs to the active scope. Mirrors the engine's
 * suggest-helpers scope logic:
 *
 * - Concept with explicit scopes: must include active scope
 * - Category with explicit scopes: must include active scope
 * - Category with NO scopes + profile has defaultScope: only in default scope
 */
function entryInScope(
    entry: EntryData,
    activeScope: string | null,
    defaultScope: string | null,
): boolean {
    if (!activeScope) return true;

    const { concept, category } = entry;

    if (concept.scopes && concept.scopes.length > 0) {
        if (!concept.scopes.includes(activeScope)) return false;
    }

    if (category.scopes && category.scopes.length > 0) {
        if (!category.scopes.includes(activeScope)) return false;
    } else if (defaultScope && activeScope !== defaultScope) {
        return false;
    }

    return true;
}

/**
 * Build handbook entries from scheme data. When an adapter with
 * `getConceptsInCategory` is provided it's used for hierarchical ordering;
 * otherwise concepts fall back to position-sorted flat rows.
 */
function buildEntries(
    scheme: ProfileLike,
    engine: ConceptsInCategoryProvider | undefined,
    categoryFilter?: string[],
): EntryData[] {
    const entries: EntryData[] = [];

    let categories = scheme.categories;
    if (categoryFilter) {
        categories = categories.filter((f) => categoryFilter.includes(f.id));
    }

    for (const category of categories) {
        const hierarchical = engine?.getConceptsInCategory?.(category.id, {
            nested: true,
        });
        if (hierarchical) {
            for (const node of hierarchical) {
                entries.push({
                    concept: node.concept,
                    category,
                    rules: null,
                    depth: node.depth,
                });
            }
            continue;
        }
        const concepts = scheme.concepts
            .filter((c) => c.categories.includes(category.id))
            .sort((a, b) => a.position - b.position);
        for (const concept of concepts) {
            entries.push({ concept, category, rules: null, depth: 0 });
        }
    }

    return entries;
}

/** Case-insensitive substring match on a concept's name, views, and aliases. */
function matchesFilter(entry: EntryData, filter: string): boolean {
    const c = entry.concept;
    if (c.name.toLowerCase().includes(filter)) return true;
    for (const v of Object.values(c.views)) {
        if (v.toLowerCase().includes(filter)) return true;
    }
    for (const alias of c.aliases) {
        if (alias.toLowerCase().includes(filter)) return true;
    }
    return false;
}

/**
 * Count how many entries survive the current scope + filter, for SR
 * announcements.
 */
function countVisibleEntries(
    entries: EntryData[],
    activeScope: string | null,
    defaultScope: string | null,
    filterText: string,
): number {
    const scoped = activeScope
        ? entries.filter((e) => entryInScope(e, activeScope, defaultScope))
        : entries;
    if (!filterText) return scoped.length;
    const lower = filterText.toLowerCase();
    return scoped.filter((e) => matchesFilter(e, lower)).length;
}

/** Options specific to the Handbook component. */
export interface HandbookOptions extends ComponentOptions {
    /** If true, all category groups start expanded (default: false). */
    expandAll?: boolean;
    /** Category IDs to include. When omitted, all categories are shown. */
    categoryFilter?: string[];
}

/** Shape of the profile-level scope definition. */
interface ProfileScope {
    id: string;
    label: string;
}

const HANDBOOK_CSS: string = handbookCss;

/**
 * Browsable reference panel showing all profile concepts with definitions,
 * guidance, and rules.
 */
export class Handbook extends ReadOnlyComponentBase {
    /**
     * Mount the component.
     *
     * Narrows the inherited signature to {@link HandbookOptions} so a caller can
     * pass this component's own options without widening them to the shared
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
        options?: HandbookOptions,
    ): Promise<void> {
        await super.init(container, engineOrContext, options);
    }

    private searchInput!: HTMLInputElement;
    private body!: HTMLDivElement;
    private announcer!: HTMLDivElement;
    private allEntries: EntryData[] = [];
    private expandedCategories = new Set<string>();
    private filterText = '';
    private activeScope: string | null = null;
    private defaultScope: string | null = null;
    private profileScopes: ProfileScope[] = [];
    private scopeTabsEl: HTMLDivElement | null = null;
    private readonly instanceId = Math.random().toString(36).slice(2, 10);

    protected setup(): void {
        this.injectComponentStyles(HANDBOOK_CSS);

        const opts = this.options as HandbookOptions;

        // Build all entries without rules (lazy-loaded when visible)
        this.allEntries = buildEntries(
            this.scheme,
            this.engine as ConceptsInCategoryProvider,
            opts.categoryFilter,
        );

        // Pre-expand categories only when explicitly requested
        if (opts.expandAll) {
            for (const category of this.scheme.categories) {
                this.expandedCategories.add(category.id);
            }
        }

        // Determine scopes from profile metadata.
        // defaultScope may be missing from REST-fetched profiles, infer from
        // the first scope entry, which by convention is always the default.
        this.profileScopes =
            (this.scheme.scopes as ProfileScope[] | undefined) ?? [];
        this.defaultScope =
            this.scheme.defaultScope ??
            (this.profileScopes.length > 0 ? this.profileScopes[0].id : null);
        if (this.profileScopes.length > 1) {
            this.activeScope = this.defaultScope;
        }

        // Reference-surface noun: the scheme's own word for its Handbook (e.g.
        // "Shelving Guide"), or `undefined` when the scheme declares none;
        // see resolveReferenceSurfaceOverride's doc comment for why that case
        // keeps the hardcoded strings below untouched.
        const surfaceOverride = resolveReferenceSurfaceOverride(
            this.scheme.referenceSurfaceLabel,
            'handbook',
        );

        // Root wrapper
        const root = document.createElement('div');
        root.className = 'ez-handbook';
        root.setAttribute('role', 'region');
        root.setAttribute(
            'aria-label',
            surfaceOverride ? surfaceOverride.singular : 'Scheme handbook',
        );

        // Scheme overview
        root.appendChild(this.renderOverview());

        // Scope tabs + tab panel (only when profile has multiple scopes)
        const hasScopes = this.profileScopes.length > 1;
        const panelId = `ez-handbook-panel-${this.instanceId}`;
        if (hasScopes) {
            this.scopeTabsEl = this.renderScopeTabs(panelId);
            root.appendChild(this.scopeTabsEl);
        }

        // Tab panel wraps search + body; bordered when tabs are present
        const panel = document.createElement('div');
        panel.className = 'ez-handbook__tab-panel';
        panel.id = panelId;
        if (hasScopes) {
            panel.setAttribute('role', 'tabpanel');
        }

        // Search bar
        const searchWrap = document.createElement('div');
        searchWrap.className = 'ez-handbook__search';
        this.searchInput = document.createElement('input');
        this.searchInput.type = 'search';
        this.searchInput.className = 'ez-handbook__search-input';
        this.searchInput.placeholder = 'Search concepts\u2026';
        this.searchInput.setAttribute(
            'aria-label',
            surfaceOverride
                ? `Search ${surfaceOverride.singular} concepts`
                : 'Search handbook concepts',
        );
        this.searchInput.addEventListener('input', () => {
            this.filterText = this.searchInput.value.trim();
            this.render();
            const count = countVisibleEntries(
                this.allEntries,
                this.activeScope,
                this.defaultScope,
                this.filterText,
            );
            announce(
                this.announcer,
                count === 0
                    ? `No concepts match "${this.filterText}"`
                    : `${count} concept${count === 1 ? '' : 's'} found`,
            );
        });
        searchWrap.appendChild(this.searchInput);
        panel.appendChild(searchWrap);

        // Body (category groups + entries)
        this.body = document.createElement('div');
        this.body.setAttribute('role', 'list');
        panel.appendChild(this.body);

        // Announcer
        this.announcer = createAnnouncer();
        panel.appendChild(this.announcer);

        root.appendChild(panel);

        this.container.appendChild(root);
        this.render();
    }

    destroy(): void {
        this.removeRuleErrors();
        this.container.innerHTML = '';
    }

    protected render(): void {
        this.body.innerHTML = '';
        const filter = this.filterText.toLowerCase();

        // Filter entries by active scope
        const scopedEntries = this.activeScope
            ? this.allEntries.filter((e) =>
                  entryInScope(e, this.activeScope, this.defaultScope),
              )
            : this.allEntries;

        // Group entries by category
        const categoryMap = new Map<string, EntryData[]>();
        for (const entry of scopedEntries) {
            const categoryId = entry.category.id;
            if (!categoryMap.has(categoryId)) categoryMap.set(categoryId, []);
            categoryMap.get(categoryId)!.push(entry);
        }

        let totalVisible = 0;

        for (const [categoryId, categoryEntries] of categoryMap) {
            const category = categoryEntries[0].category;

            // Filter entries by search text
            const matchingEntries = filter
                ? categoryEntries.filter((e) => matchesFilter(e, filter))
                : categoryEntries;

            if (filter && matchingEntries.length === 0) continue;

            totalVisible += matchingEntries.length;
            const isExpanded = this.expandedCategories.has(categoryId);

            // Category group container
            const group = document.createElement('div');
            group.className = 'ez-handbook__category';
            group.setAttribute('role', 'listitem');

            // Header: show total count (not just filtered) when no filter
            const displayCount = filter
                ? matchingEntries.length
                : categoryEntries.length;
            const header = this.renderCategoryHeader(
                category,
                displayCount,
                isExpanded,
                categoryId,
            );
            group.appendChild(header);

            // Body (concept entries)
            const showEntries =
                isExpanded || (filter && matchingEntries.length > 0);
            if (showEntries) {
                // Lazy-load rules for entries about to be displayed
                this.loadRulesForEntries(matchingEntries);

                const body = document.createElement('div');
                body.className = 'ez-handbook__category-body';
                for (const entry of matchingEntries) {
                    body.appendChild(this.renderEntry(entry));
                }
                group.appendChild(body);
            }

            this.body.appendChild(group);
        }

        if (totalVisible === 0 && filter) {
            const empty = document.createElement('div');
            empty.className = 'ez-handbook__empty';
            empty.setAttribute('role', 'status');
            empty.textContent = `No concepts match \u201c${this.filterText}\u201d`;
            this.body.appendChild(empty);
        }
    }

    private renderOverview(): HTMLDivElement {
        const el = document.createElement('div');
        el.className = 'ez-handbook__overview';

        const name = document.createElement('div');
        name.className = 'ez-handbook__overview-name';
        name.textContent = this.scheme.name;
        el.appendChild(name);

        // Version + mode meta line
        const meta = document.createElement('div');
        meta.className = 'ez-handbook__overview-meta';
        const parts: string[] = [];
        if (this.scheme.version) parts.push(`v${this.scheme.version}`);
        const categoryCount = this.scheme.categories.length;
        const conceptCount = this.scheme.concepts.length;
        parts.push(
            `${categoryCount} ${categoryCount === 1 ? 'category' : 'categories'}`,
        );
        parts.push(`${conceptCount} concept${conceptCount === 1 ? '' : 's'}`);
        meta.textContent = parts.join(' \u00b7 ');
        el.appendChild(meta);

        const previewText =
            this.scheme.description ||
            this.scheme.definition ||
            this.scheme.guidance;
        if (!previewText) return el;
        const introduction = document.createElement('details');
        introduction.className = 'ez-handbook__introduction';
        const summary = document.createElement('summary');
        const preview = document.createElement('span');
        preview.className =
            'ez-handbook__overview-desc ez-handbook__introduction-preview';
        preview.textContent = previewText;
        summary.appendChild(preview);
        for (const [className, text] of [
            ['ez-handbook__introduction-more', '\u2026 Show more'],
            ['ez-handbook__introduction-less', 'Show less'],
        ]) {
            const label = document.createElement('span');
            label.className = className;
            label.textContent = text;
            summary.appendChild(label);
        }
        introduction.appendChild(summary);
        el.appendChild(introduction);

        if (this.scheme.description) {
            const desc = document.createElement('div');
            desc.className = 'ez-handbook__overview-desc';
            desc.textContent = this.scheme.description;
            introduction.appendChild(desc);
        }

        if (this.scheme.definition) {
            const label = document.createElement('div');
            label.className = 'ez-handbook__overview-label';
            label.textContent = 'Definition';
            introduction.appendChild(label);
            const text = document.createElement('div');
            text.className = 'ez-handbook__overview-desc';
            text.textContent = this.scheme.definition;
            introduction.appendChild(text);
        }

        if (this.scheme.guidance) {
            const label = document.createElement('div');
            label.className = 'ez-handbook__overview-label';
            label.textContent = 'Guidance';
            introduction.appendChild(label);
            const text = document.createElement('div');
            text.className = 'ez-handbook__overview-desc';
            text.textContent = this.scheme.guidance;
            introduction.appendChild(text);
        }

        return el;
    }

    private renderScopeTabs(panelId: string): HTMLDivElement {
        const scopeLabel = this.scheme.scopeLabel ?? 'Scope';

        const bar = document.createElement('div');
        bar.className = 'ez-handbook__scope-tabs';
        bar.setAttribute('role', 'tablist');
        bar.setAttribute('aria-label', scopeLabel);

        for (const scope of this.profileScopes) {
            const tab = document.createElement('button');
            tab.type = 'button';
            tab.className = 'ez-handbook__scope-tab';
            tab.textContent = scope.label;
            tab.setAttribute('role', 'tab');
            tab.setAttribute(
                'aria-selected',
                scope.id === this.activeScope ? 'true' : 'false',
            );
            tab.setAttribute('aria-controls', panelId);
            tab.id = `ez-handbook-tab-${scope.id}`;
            // Roving tabindex: only the active tab is in the tab order.
            tab.tabIndex = scope.id === this.activeScope ? 0 : -1;
            tab.dataset.scopeId = scope.id;
            tab.addEventListener('click', () => this.activateTab(tab));
            bar.appendChild(tab);
        }

        // ArrowLeft/ArrowRight navigate between tabs with activation-follows-focus.
        bar.addEventListener('keydown', (e) => {
            if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
            const tabs = Array.from(
                bar.querySelectorAll<HTMLButtonElement>('[role="tab"]'),
            );
            const current = tabs.findIndex((t) => t === document.activeElement);
            if (current < 0) return;
            e.preventDefault();
            const next =
                e.key === 'ArrowRight'
                    ? (current + 1) % tabs.length
                    : (current - 1 + tabs.length) % tabs.length;
            this.activateTab(tabs[next]);
        });

        return bar;
    }

    private activateTab(tab: HTMLButtonElement): void {
        const scopeId = tab.dataset.scopeId;
        if (!scopeId) return;
        this.activeScope = scopeId;
        this.updateScopeTabStates();
        this.render();
        tab.focus();
    }

    private updateScopeTabStates(): void {
        if (!this.scopeTabsEl) return;
        const tabs = this.scopeTabsEl.querySelectorAll<HTMLElement>(
            '.ez-handbook__scope-tab',
        );
        for (const tab of tabs) {
            const isActive = tab.dataset.scopeId === this.activeScope;
            tab.setAttribute('aria-selected', isActive ? 'true' : 'false');
            tab.tabIndex = isActive ? 0 : -1;
        }
    }

    private renderCategoryHeader(
        category: CategoryView,
        count: number,
        isExpanded: boolean,
        categoryId: string,
    ): HTMLDivElement {
        // NOTE: Uses div[role="button"] rather than a native <button>. AccessHandbook takes the
        // native-button approach for its group headers (see access-handbook.ts). Either ARIA
        // pattern is valid, but native button is preferred, free focus management, correct
        // default type, no manual keydown needed. Converting here requires a CSS reset on
        // .ez-handbook__category-header (background:none; border:none; padding:inherit) and
        // removing tabIndex + the role attribute. Not done: Handbook's design is locked; any
        // structural DOM change needs maintainer sign-off. The Enter/Space handler below is correct
        // for this div pattern. See also the parallel note in browser-component-base.ts::buildCategoryHeader.
        const header = document.createElement('div');
        header.className = 'ez-handbook__category-header';
        header.tabIndex = 0;
        header.setAttribute('role', 'button');
        header.setAttribute('aria-expanded', String(isExpanded));
        header.setAttribute(
            'aria-label',
            `${category.label}, ${count} concepts, ${isExpanded ? 'expanded' : 'collapsed'}`,
        );

        const arrow = document.createElement('span');
        arrow.className = 'ez-handbook__category-arrow';
        arrow.textContent = isExpanded ? '\u25bc' : '\u25b6';
        arrow.setAttribute('aria-hidden', 'true');
        header.appendChild(arrow);

        const label = document.createElement('span');
        label.textContent = category.label;
        header.appendChild(label);

        const countEl = document.createElement('span');
        countEl.className = 'ez-handbook__category-count';
        countEl.textContent = `(${count})`;
        header.appendChild(countEl);

        header.addEventListener('click', () => this.toggleCategory(categoryId));
        header.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                this.toggleCategory(categoryId);
            }
        });

        return header;
    }

    /**
     * Lazy-load rules for a batch of entries that are about to be displayed.
     * Skips entries that already have rules loaded. For sync engines the rules
     * populate immediately; for async (REST) engines, a re-render fires once
     * all pending fetches complete.
     */
    private loadRulesForEntries(entries: EntryData[]): void {
        if (!this.engine.describeConcept) return;

        const conceptProp = this.options.tooltipConceptProperty
            ? { view: this.options.tooltipConceptProperty }
            : undefined;

        const pending: Promise<void>[] = [];

        for (const entry of entries) {
            if (entry.rules !== null) continue;

            const result =
                this.schemeAddressing && isAddressableSchemeEngine(this.engine)
                    ? this.engine.describeConcept(
                          entry.concept.id,
                          entry.category.id,
                          this.schemeId,
                          conceptProp,
                      )
                    : this.engine.describeConcept(
                          entry.concept.id,
                          entry.category.id,
                          conceptProp,
                      );

            if (result && typeof result === 'object' && !('then' in result)) {
                // Sync engine: populate immediately
                entry.rules = result.rules ?? [];
            } else if (
                result &&
                typeof result === 'object' &&
                'then' in result
            ) {
                // Async engine: collect promise
                pending.push(
                    (result as Promise<ConceptDescription>)
                        .then((desc) => {
                            entry.rules = desc.rules ?? [];
                        })
                        .catch(() => {
                            entry.rules = [];
                        }),
                );
            } else {
                entry.rules = [];
            }
        }

        if (pending.length > 0) {
            Promise.all(pending).then(() => this.render());
        }
    }

    private renderEntry(entry: EntryData): HTMLDivElement {
        const { concept, category, rules, depth } = entry;
        const el = document.createElement('div');
        el.className = 'ez-handbook__entry';
        if (depth > 0)
            el.classList.add(`ez-handbook__entry--depth-${Math.min(depth, 5)}`);
        el.setAttribute('data-depth', String(depth));
        el.tabIndex = 0;
        el.setAttribute('role', 'article');
        el.setAttribute('aria-label', concept.name);
        el.setAttribute('aria-level', String(depth + 1));

        // Category color bar
        const color = this.getCategoryColor(category.id);
        el.setAttribute('data-category-color', '');
        el.style.setProperty('--ez-entry-category-color', color);
        el.style.setProperty('--ez-entry-depth', String(depth));

        // Name
        const nameEl = document.createElement('div');
        nameEl.className = 'ez-handbook__entry-name';
        nameEl.textContent = concept.name;
        el.appendChild(nameEl);

        // Aliases (show views + aliases that differ from name)
        const altLabels = new Set<string>();
        for (const [key, val] of Object.entries(concept.views)) {
            if (key !== 'default' && val && val !== concept.name)
                altLabels.add(val);
        }
        for (const alias of concept.aliases) {
            if (alias !== concept.name && alias !== concept.views['default'])
                altLabels.add(alias);
        }
        if (altLabels.size > 0) {
            const aliases = document.createElement('div');
            aliases.className = 'ez-handbook__entry-aliases';
            aliases.textContent = `Also: ${[...altLabels].join(', ')}`;
            el.appendChild(aliases);
        }

        const definition = concept.definition;
        const guidance = concept.guidance;

        // Definition
        if (definition) {
            const label = document.createElement('div');
            label.className = 'ez-handbook__section-label';
            label.textContent = 'Description';
            el.appendChild(label);
            const text = document.createElement('div');
            text.className = 'ez-handbook__section-text';
            text.textContent = definition;
            el.appendChild(text);
        }

        // Guidance
        if (guidance) {
            const label = document.createElement('div');
            label.className = 'ez-handbook__section-label';
            label.textContent = 'Usage';
            el.appendChild(label);
            const text = document.createElement('div');
            text.className = 'ez-handbook__section-text';
            text.textContent = guidance;
            el.appendChild(text);
        }

        // Rules
        if (rules && rules.length > 0) {
            const label = document.createElement('div');
            label.className = 'ez-handbook__section-label';
            label.textContent = 'Scheme rules';
            el.appendChild(label);
            const rulesEl = document.createElement('div');
            rulesEl.className = 'ez-handbook__rules';
            for (const r of rules) {
                const rule = document.createElement('div');
                rule.className = 'ez-handbook__rule';
                rule.textContent = r;
                rulesEl.appendChild(rule);
            }
            el.appendChild(rulesEl);
        }

        // Notices
        if (concept.notices && concept.notices.length > 0) {
            for (const notice of concept.notices) {
                const noticeEl = document.createElement('div');
                noticeEl.className = `ez-handbook__notice ez-handbook__notice--${notice.type}`;
                noticeEl.setAttribute(
                    'role',
                    notice.type === 'warning' ? 'alert' : 'note',
                );

                const icon = notice.type === 'warning' ? '\u26a0' : '\u2139';
                const typeLabel =
                    notice.type.charAt(0).toUpperCase() + notice.type.slice(1);

                const labelEl = document.createElement('span');
                labelEl.className = 'ez-handbook__notice-label';
                labelEl.textContent = `${icon} ${typeLabel}`;
                noticeEl.appendChild(labelEl);

                const textEl = document.createElement('span');
                textEl.className = 'ez-handbook__notice-text';
                textEl.textContent = notice.text;
                noticeEl.appendChild(textEl);

                el.appendChild(noticeEl);
            }
        }

        // Deprecated
        if (concept.deprecated) {
            const dep = document.createElement('div');
            dep.className = 'ez-handbook__deprecated';
            dep.textContent = concept.deprecatedMessage
                ? `Deprecated: ${concept.deprecatedMessage}`
                : 'Deprecated';
            if (concept.deprecatedReplacement) {
                const replacement = this.scheme.concepts.find(
                    (c) => c.id === concept.deprecatedReplacement,
                );
                if (replacement) {
                    dep.textContent += ` \u2192 use ${replacement.name}`;
                }
            }
            el.appendChild(dep);
        }

        return el;
    }

    private toggleCategory(categoryId: string): void {
        if (this.expandedCategories.has(categoryId)) {
            this.expandedCategories.delete(categoryId);
        } else {
            this.expandedCategories.add(categoryId);
        }
        this.render();
        // Re-focus the toggled header
        const header = this.body.querySelector(
            `.ez-handbook__category-header[aria-label^="${this.scheme.categories.find((f) => f.id === categoryId)?.label}"]`,
        ) as HTMLElement;
        header?.focus();
    }
}
