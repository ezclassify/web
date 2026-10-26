/**
 * The layout facts a structural UI surface needs, read from the scheme's own
 * projection of them.
 *
 * A format's field tree is authoring content. It stays server-side, and the
 * only reason this library ever walked one was that an in-process engine
 * happened to hand its schemes over with the tree still attached. A remote
 * adapter never saw it, so the two adapters laid the same marking out
 * differently. `SchemeMetaView.formats` is the resolved answer both of them
 * get: category order, the text written at each boundary, the text written
 * around every single value, and the headings paired with the lists they head.
 *
 * Nothing here parses, infers, or reconstructs. Whatever the projection does
 * not carry, a surface does without.
 */

import type {
    EachAffix,
    RenderFormatLayout,
    SchemeMetaView,
    TierComposition,
} from '@ezclassify/types';

/** The scheme metadata a layout lookup reads. */
export type FormatLayoutSource = Pick<
    SchemeMetaView,
    'formats' | 'defaultRenderFormat'
>;

/** One format's layout, indexed for the lookups UI surfaces do per keystroke. */
export interface PublicFormatLayout {
    /** The projected format this layout came from. */
    format: RenderFormatLayout;
    /** The categories the format writes, in the order it writes them. */
    categoryOrder: string[];
    /** What separates two values of one category, keyed by category id. */
    categorySeparators: Map<string, string>;
    /** The category a heading concept introduces, keyed by concept id. */
    headerCategoryByConcept: Map<string, string>;
    /**
     * The heading a category's values sit under, keyed by the category the
     * heading introduces. `categoryId` is the category the heading concept is
     * itself asserted in.
     */
    headerByCategory: Map<string, { conceptId: string; categoryId: string }>;
    /** What is written immediately before a category, keyed by category id. */
    separatorBeforeCategory: Map<string, string>;
    /**
     * The concept view a category is written in, keyed by category id, for the
     * categories that are written in a view of their own. A category absent
     * from the map is written in the format's `view`; read it through
     * {@link viewForCategory} rather than reaching past that fallback.
     */
    categoryViews: Map<string, string>;
    /**
     * How a category's tiered concepts compose into one token, keyed by
     * category id, outermost tier first. A category absent from the map writes
     * its values as plain siblings.
     */
    categoryTiers: Map<string, TierComposition[]>;
    /**
     * What a category writes around every one of its values, keyed by category
     * id. A category absent from the map writes its values bare.
     *
     * Around each value, not once around the list: three values written with a
     * separator between them carry this three times and the separator twice.
     * Read it through {@link eachForCategory}.
     */
    categoryEach: Map<string, EachAffix>;
}

/**
 * Indexed layouts, keyed by the projected format they were built from.
 *
 * These lookups run on every keystroke in the tag and marking surfaces, and a
 * format object is stable for as long as the adapter's scheme is. Keying the
 * cache on that object means a reloaded scheme produces a new one and misses on
 * its own, with no invalidation to remember.
 */
const indexedByFormat = new WeakMap<RenderFormatLayout, PublicFormatLayout>();

/**
 * The layout of a scheme that publishes none: no order, no boundaries, no
 * headings. Surfaces that need an order supply their own fallback, and the ones
 * that only ask about headings get the honest answer that there are none.
 */
const EMPTY_FORMAT: RenderFormatLayout = {
    id: '',
    surface: '',
    mode: 'inline',
    categoryOrder: [],
};

/** Build the map-shaped index for one projected format. */
function index(format: RenderFormatLayout): PublicFormatLayout {
    const headerCategoryByConcept = new Map<string, string>();
    const headerByCategory = new Map<
        string,
        { conceptId: string; categoryId: string }
    >();
    for (const header of format.headers ?? []) {
        headerCategoryByConcept.set(header.concept, header.category);
        headerByCategory.set(header.category, {
            conceptId: header.concept,
            categoryId: header.headerCategory,
        });
    }
    return {
        format,
        // `?? []` rather than a bare spread: this reads a wire payload, and a
        // server that omits the member must not take the field down with it.
        categoryOrder: [...(format.categoryOrder ?? [])],
        categorySeparators: new Map(
            Object.entries(format.categorySeparators ?? {}),
        ),
        headerCategoryByConcept,
        headerByCategory,
        separatorBeforeCategory: new Map(
            Object.entries(format.separatorBefore ?? {}),
        ),
        categoryViews: new Map(Object.entries(format.categoryViews ?? {})),
        categoryTiers: new Map(
            Object.entries(format.categoryTiers ?? {}).map(
                ([categoryId, tiers]) => [categoryId, [...tiers]],
            ),
        ),
        categoryEach: new Map(
            Object.entries(format.categoryEach ?? {}).map(
                ([categoryId, each]) => [categoryId, { ...each }],
            ),
        ),
    };
}

/**
 * Resolve one render format and index its layout.
 *
 * @param meta - Scheme metadata carrying the projected render formats.
 * @param formatId - Format to resolve; defaults to the scheme's default render
 *   format, then to the first format the scheme publishes.
 * @returns The indexed layout for the resolved format, or the empty layout when
 *   the scheme publishes no render formats. `formats` is an optional member of
 *   the metadata view, so an absent projection is a scheme fact this library
 *   reports rather than an error it raises: a field bound to such a scheme
 *   still edits, it just has no authored order to lay out in.
 */
export function getPublicFormatLayout(
    meta: FormatLayoutSource,
    formatId?: string,
): PublicFormatLayout {
    const formats = meta.formats ?? [];
    const format =
        formats.find(
            (candidate) =>
                candidate.id === (formatId ?? meta.defaultRenderFormat),
        ) ??
        formats[0] ??
        EMPTY_FORMAT;

    const cached = indexedByFormat.get(format);
    if (cached) return cached;
    const built = index(format);
    indexedByFormat.set(format, built);
    return built;
}

/**
 * The concept view one category is written in.
 *
 * A format names a default view, and a field may write in a view of its own:
 * that is how one format writes a control in its short spelling beside a level
 * in its spelled-out one. The per-category answer wins where there is one.
 *
 * @param layout - An indexed layout from {@link getPublicFormatLayout}.
 * @param categoryId - The category being written.
 * @returns The view key, or `undefined` when neither the category nor the
 *   format names one and the concept's `default` view applies.
 */
export function viewForCategory(
    layout: PublicFormatLayout,
    categoryId: string,
): string | undefined {
    return layout.categoryViews.get(categoryId) ?? layout.format.view;
}

/**
 * The tier compositions one category writes, outermost tier first.
 *
 * @param layout - An indexed layout from {@link getPublicFormatLayout}.
 * @param categoryId - The category being written.
 * @returns The compositions, or an empty array for a category whose values are
 *   plain siblings.
 */
export function tiersForCategory(
    layout: PublicFormatLayout,
    categoryId: string,
): TierComposition[] {
    return layout.categoryTiers.get(categoryId) ?? [];
}

/**
 * What one category writes around every single one of its values.
 *
 * A category whose values each carry a marker of their own is written by a
 * field that declares it, and the marker belongs to the value: a surface
 * placing three values writes this three times, inside the separators rather
 * than around them.
 *
 * @param layout - An indexed layout from {@link getPublicFormatLayout}.
 * @param categoryId - The category being written.
 * @returns The affix, or `undefined` for a category whose values are written
 *   bare.
 */
export function eachForCategory(
    layout: PublicFormatLayout,
    categoryId: string,
): EachAffix | undefined {
    return layout.categoryEach.get(categoryId);
}

/**
 * Every literal separator one format writes, deduplicated.
 *
 * Callers use this to find where a typed tail begins, so the set is the
 * punctuation the format can put between things: what it writes between
 * categories, what it writes between two values of one category, the resolved
 * text at each category boundary, and what attaches a tiered concept to the
 * head it composes with. A prefix or suffix wraps the whole marking rather than
 * dividing it, and is deliberately absent. So is the per-value affix, for the
 * same reason: it frames a value rather than standing between two of them, and
 * a caller looking for where a typed tail begins would cut inside a token.
 */
export function getPublicFormatSeparators(
    format: RenderFormatLayout,
): string[] {
    const separators = new Set<string>();
    const add = (value: string | undefined): void => {
        if (value) separators.add(value);
    };
    add(format.separator);
    for (const value of Object.values(format.categorySeparators ?? {})) {
        add(value);
    }
    for (const value of Object.values(format.separatorBefore ?? {})) {
        add(value);
    }
    for (const tiers of Object.values(format.categoryTiers ?? {})) {
        for (const tier of tiers) add(tier.attachedBy);
    }
    return [...separators];
}
