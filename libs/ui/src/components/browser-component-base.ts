/**
 * Shared rendering helpers for read-only "browser" components: Handbook
 * (profile concepts), Guidebook (guide rules), and AccessHandbook (access
 * rules). All three consume an engine view (`StructuralView<T>` for the first
 * two) plus a `FilterResult` from engine.filter* and render a related DOM
 * shape: categories or groups with collapsible headers and item rows. Search,
 * filter-driven visibility, ARIA wiring, and reference-surface noun resolution
 * live here so the three components don't duplicate them.
 *
 * Deliberately not a base class: Handbook, Guidebook, and AccessHandbook
 * already extend `ReadOnlyComponentBase`, which owns `this.engine` /
 * `this.schemeId` / styles / init. Mixing another class in via multiple
 * inheritance wouldn't work. Module-level helpers called from each subclass
 * give the same de-duplication benefit without the inheritance mess.
 */

import {
    GENERIC_REFERENCE_SURFACE_NOUNS,
    type ReferenceSurfaceKey,
    type ReferenceSurfaceLabel,
    type FilterResult,
    type StructuralView,
} from '@ezclassify/types';
import { announce, createAnnouncer } from './component-utils';

/** Options for {@link renderStructuralTree}. */
export interface RenderStructuralTreeOptions<Item> {
    container: HTMLElement;
    view: StructuralView<Item>;
    /**
     * CSS class applied to everything this helper creates. Each specific
     * component can theme with a different root class (`ez-handbook`,
     * `ez-guidebook`) and pass it here.
     */
    rootClass: string;
    /**
     * Set of category ids that should start expanded. Caller maintains the
     * state; this helper respects but does not mutate it.
     */
    expanded: Set<string>;
    /**
     * Invoked when the user clicks a category header. Caller updates `expanded`
     * and re-renders.
     */
    onToggleCategory: (categoryId: string) => void;
    /** Renders a single item row. Called once per item in the view. */
    renderItem: (item: Item) => HTMLElement;
}

/**
 * Render a view's categories + items into `container`. Clears any existing
 * content. Category headers toggle an `aria-expanded` state and emit
 * `onToggleCategory` on click / Enter / Space.
 */
export function renderStructuralTree<Item>(
    opts: RenderStructuralTreeOptions<Item>,
): void {
    const {
        container,
        view,
        rootClass,
        expanded,
        onToggleCategory,
        renderItem,
    } = opts;
    container.innerHTML = '';

    for (const category of view.categories) {
        const group = document.createElement('div');
        group.className = `${rootClass}__category`;
        group.setAttribute('role', 'listitem');
        group.dataset.categoryId = category.id;

        const isExpanded = expanded.has(category.id);
        const header = buildCategoryHeader(
            category,
            isExpanded,
            rootClass,
            onToggleCategory,
        );
        group.appendChild(header);

        const body = document.createElement('div');
        body.className = `${rootClass}__category-body`;
        body.dataset.role = 'category-body';
        body.hidden = !isExpanded;
        for (const item of category.items) {
            body.appendChild(renderItem(item));
        }
        group.appendChild(body);

        container.appendChild(group);
    }

    for (const item of view.uncategorized) {
        container.appendChild(renderItem(item));
    }
}

// Uses div[role="button"] with explicit Enter/Space handling rather than a native
// <button>: the Guidebook/Handbook header styling depends on the div's box model, and
// swapping the element is a structural DOM change to shared rendering helpers.
function buildCategoryHeader(
    category: { id: string; label: string; items: unknown[] },
    isExpanded: boolean,
    rootClass: string,
    onToggle: (id: string) => void,
): HTMLElement {
    const header = document.createElement('div');
    header.className = `${rootClass}__category-header`;
    header.tabIndex = 0;
    header.setAttribute('role', 'button');
    header.setAttribute('aria-expanded', String(isExpanded));
    header.setAttribute(
        'aria-label',
        `${category.label}, ${category.items.length} items, ${isExpanded ? 'expanded' : 'collapsed'}`,
    );

    const arrow = document.createElement('span');
    arrow.className = `${rootClass}__category-arrow`;
    arrow.textContent = isExpanded ? '▼' : '▶';
    arrow.setAttribute('aria-hidden', 'true');
    header.appendChild(arrow);

    const label = document.createElement('span');
    label.textContent = category.label;
    header.appendChild(label);

    const countEl = document.createElement('span');
    countEl.className = `${rootClass}__category-count`;
    countEl.textContent = `(${category.items.length})`;
    header.appendChild(countEl);

    header.addEventListener('click', () => onToggle(category.id));
    header.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onToggle(category.id);
        }
    });

    return header;
}

/** Options for {@link applyFilterToTree}. */
export interface ApplyFilterOptions {
    container: HTMLElement;
    filter: FilterResult;
    rootClass: string;
    /**
     * When the filter is active ("`query !== ''`"), expand collapsed categories
     * that have any matching rows so users can see the hits.
     */
    query: string;
    /** Optional: show a "no results" banner when nothing is visible. */
    noResultsText?: string;
}

/**
 * Toggle `--hidden` on rows and headers based on the filter result. Rows are
 * identified by `data-item-id="<ruleId|conceptId>"`. Category headers and
 * bodies are updated by reading `data-category-id`.
 */
export function applyFilterToTree(opts: ApplyFilterOptions): void {
    const { container, filter, rootClass, query, noResultsText } = opts;
    const active = query.trim().length > 0;

    // Rows
    container.querySelectorAll<HTMLElement>('[data-item-id]').forEach((row) => {
        const id = row.dataset.itemId!;
        row.classList.toggle(
            `${rootClass}__entry--hidden`,
            active && !filter.visibleIds.has(id),
        );
    });

    // Category groups
    container
        .querySelectorAll<HTMLElement>(`.${rootClass}__category`)
        .forEach((group) => {
            const categoryId = group.dataset.categoryId ?? '';
            const count = filter.categoryCounts.get(categoryId) ?? {
                visible: 0,
                total: 0,
            };
            const countEl = group.querySelector<HTMLElement>(
                `.${rootClass}__category-count`,
            );
            if (countEl) {
                countEl.textContent = active
                    ? `(${count.visible} of ${count.total})`
                    : `(${count.total})`;
            }
            const hide = active && count.visible === 0;
            group.classList.toggle(`${rootClass}__category--hidden`, hide);
            // While filtering, auto-expand groups that have matches so the hits are visible.
            const body = group.querySelector<HTMLElement>(
                `[data-role="category-body"]`,
            );
            if (body && active && count.visible > 0) {
                body.hidden = false;
            }
        });

    // "No results" banner
    const existing = container.querySelector<HTMLElement>(
        `.${rootClass}__empty`,
    );
    if (active && filter.total.visible === 0) {
        if (existing) {
            existing.textContent = noResultsText ?? `No results for "${query}"`;
        } else {
            const empty = document.createElement('div');
            empty.className = `${rootClass}__empty`;
            empty.setAttribute('role', 'status');
            empty.textContent = noResultsText ?? `No results for "${query}"`;
            container.appendChild(empty);
        }
    } else if (existing) {
        existing.remove();
    }
}

/** Options for {@link buildSearchInput}. */
export interface SearchInputOptions {
    rootClass: string;
    placeholder: string;
    ariaLabel: string;
    onInput: (query: string) => void;
}

/**
 * Build a standard search input wrapper. Returns the wrapping div, the input
 * itself, and an announcer element the caller can feed screen-reader summaries
 * of filter hits to.
 */
export function buildSearchInput(opts: SearchInputOptions): {
    wrap: HTMLElement;
    input: HTMLInputElement;
    announcer: HTMLElement;
} {
    const wrap = document.createElement('div');
    wrap.className = `${opts.rootClass}__search`;

    const input = document.createElement('input');
    input.type = 'search';
    input.className = `${opts.rootClass}__search-input`;
    input.placeholder = opts.placeholder;
    input.setAttribute('autocomplete', 'off');
    input.setAttribute('aria-label', opts.ariaLabel);
    input.addEventListener('input', () => opts.onInput(input.value.trim()));

    wrap.appendChild(input);

    const announcer = createAnnouncer();
    wrap.appendChild(announcer);

    return { wrap, input, announcer };
}

/** Announce an integer "N items match" summary to the screen reader. */
export function announceMatchCount(
    announcer: HTMLElement,
    visible: number,
    query: string,
    itemLabel: string,
    pluralLabel?: string,
): void {
    if (!query) return;
    const plural = pluralLabel ?? `${itemLabel}s`;
    const text =
        visible === 0
            ? `No ${plural} match "${query}"`
            : `${visible} ${visible === 1 ? itemLabel : plural} match`;
    announce(announcer, text);
}

/**
 * Reference-surface chrome-title resolver chokepoint: Handbook, Guidebook, and
 * AccessHandbook all call through here to decide whether their own artifact
 * (scheme / guide / access policy) renamed the reference surface they render,
 * mirroring how `roleNoun` is the engine-side chokepoint for the whole/part
 * structural nouns.
 *
 * Callers pass their artifact's _already-resolved_ `referenceSurfaceLabel`
 * (`Scheme.referenceSurfaceLabel`, a `GuideMetaView`'s, or the resolved pair an
 * access engine exposes) plus which surface they are. The engine's
 * `referenceSurfaceLabel()` always returns a fully-populated pair, generic
 * fallback included, so this resolver can't tell "declared, but happens to
 * match the generic word" from "declared nothing": an acceptable approximation,
 * since the two render identically anyway.
 *
 * Returns `undefined` when the resolved pair equals the engine's generic noun
 * for that surface, telling the caller "no override, keep rendering your
 * default chrome text", so a scheme/guide/access policy with no `vocabulary`
 * block renders the generic chrome text. A per-instance chrome-title option, if
 * a component offers one, belongs to that component's own options merge, ahead
 * of this artifact-level word, per the display-color precedence convention
 * documented in `libs/ui/ARCHITECTURE.md`: component option, then artifact
 * default, then generic fallback.
 */
export function resolveReferenceSurfaceOverride(
    resolvedLabel: ReferenceSurfaceLabel | null | undefined,
    surface: ReferenceSurfaceKey,
): ReferenceSurfaceLabel | undefined {
    if (!resolvedLabel) return undefined;
    const generic = GENERIC_REFERENCE_SURFACE_NOUNS[surface];
    return resolvedLabel.singular === generic.singular &&
        resolvedLabel.plural === generic.plural
        ? undefined
        : resolvedLabel;
}
