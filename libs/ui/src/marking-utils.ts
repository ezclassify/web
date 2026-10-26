/**
 * Shared engine utilities used by framework integrations. Pure functions for
 * assembling labels, matching concepts, and grouping suggestions; no
 * framework-specific dependencies.
 */

import type {
    ConceptView,
    CategoryView,
    SchemeEngineAdapter,
    Suggestion,
    SuggestResult,
    SchemePublicView,
} from '@ezclassify/types';
import {
    getPublicFormatLayout,
    type FormatLayoutSource,
} from './format-layout';

/**
 * The scheme facts the hierarchy helpers read: the concepts and categories from
 * the scheme view, plus the render-format layouts from its metadata view. The
 * two come from different adapter calls, so this joins them rather than
 * pretending either one carries the other.
 */
export type PublicHierarchyScheme = Pick<
    SchemePublicView,
    'concepts' | 'categories'
> &
    FormatLayoutSource;

/** Result of an unambiguous concept match: the concept and its category. */
export interface UnambiguousMatch {
    conceptId: string;
    categoryId: string;
}

/** A grouped suggestion with computed display data for hierarchical rendering. */
export interface GroupedSuggestionItem {
    suggestion: Suggestion;
    primary: string;
    secondary: string;
    depth: number;
    globalIndex: number;
}

/** A labeled group of suggestion items for dropdown rendering. */
export interface SuggestionGroup {
    label: string;
    items: GroupedSuggestionItem[];
}

/**
 * Build a concept map from adapter methods. Iterates all categories and
 * collects unique concepts by ID.
 */
function buildConceptMap(
    engine: SchemeEngineAdapter,
): Map<string, ConceptView> {
    const map = new Map<string, ConceptView>();
    for (const cat of engine.listCategories()) {
        for (const c of engine.getConceptsInCategory(cat.id)) {
            if (!map.has(c.id)) map.set(c.id, c);
        }
    }
    return map;
}

/**
 * Build a marking string by inserting a concept into an existing marking.
 *
 * When `targetCategoryId` is provided and the concept has a parent whose header
 * is already present in the marking, the new concept is inserted within that
 * category section. Otherwise it is appended using the format's category
 * separator.
 *
 * @param engine - Engine adapter for scheme lookup
 * @param existing - Current marking string (may be empty)
 * @param conceptId - ID of the concept to add
 * @param targetCategoryId - Optional category to insert within
 * @param formatId - Optional render format ID (defaults to scheme default)
 * @returns The assembled marking string with the new concept included
 */
export function assembleWithConcept(
    engine: SchemeEngineAdapter,
    existing: string,
    conceptId: string,
    targetCategoryId?: string,
    formatId?: string,
): string {
    const layout = getPublicFormatLayout(engine.getSchemeMeta(), formatId);
    const conceptMap = buildConceptMap(engine);
    const concept = conceptMap.get(conceptId);
    const viewKey = layout.format.view ?? 'default';
    const label =
        concept?.views[viewKey] ?? concept?.views['default'] ?? conceptId;

    if (!existing) return label;

    if (targetCategoryId && concept) {
        for (const parentId of concept.parents) {
            const parent = conceptMap.get(parentId);
            if (
                !parent ||
                layout.headerCategoryByConcept.get(parent.id) !==
                    targetCategoryId
            )
                continue;
            const headerLabel =
                parent.views[viewKey] ?? parent.views['default'] ?? parent.id;
            if (!existing.includes(headerLabel)) continue;

            const sectionStart = existing.indexOf(headerLabel);
            const afterHeader = existing.slice(sectionStart);
            const nextSep = afterHeader.search(/\/\//);
            if (nextSep > 0) {
                const insertPos = sectionStart + nextSep;
                return (
                    existing.slice(0, insertPos) +
                    ', ' +
                    label +
                    existing.slice(insertPos)
                );
            } else {
                return `${existing}, ${label}`;
            }
        }
    }

    const sep = layout.format.separator ?? '';
    return `${existing}${sep}${label}`;
}

/**
 * Find a single unambiguous concept match for user-typed text.
 *
 * Calls engine.suggest() to retrieve eligible (non-selected) suggestions, then
 * filters for an exact case-insensitive match across all forms (label, name,
 * conceptId, and all views). Returns the match only when exactly one concept
 * qualifies.
 *
 * @param engine - Engine adapter for suggest calls
 * @param committedValue - Current committed marking string
 * @param text - User-typed text to match
 * @param formatId - Optional render format ID
 * @returns The matching concept and category, or null if ambiguous or no match
 */
export function findUnambiguousMatch(
    engine: SchemeEngineAdapter,
    committedValue: string,
    text: string,
    formatId?: string,
): UnambiguousMatch | null {
    const lower = text.toLowerCase();
    const opts: { outputFormat?: string } = {};
    if (formatId) opts.outputFormat = formatId;
    const suggestResult = engine.suggest(committedValue, opts) as SuggestResult;
    const eligible = suggestResult.suggestions.filter((s) => !s.selected);

    const matches = eligible.filter((s) => {
        const allForms = [
            s.label,
            s.name,
            s.conceptId,
            ...Object.values(s.views),
        ];
        return allForms.some((form) => form.toLowerCase() === lower);
    });

    return matches.length === 1
        ? { conceptId: matches[0].conceptId, categoryId: matches[0].categoryId }
        : null;
}

/**
 * Group a flat suggestion array into labeled groups with hierarchy depth.
 *
 * Suggestions are grouped by their `group` property (typically the category
 * label). For each suggestion, a primary and secondary display label are
 * computed, and the hierarchy depth within its category is resolved via the
 * scheme's concept parent chain.
 *
 * @param suggestions - Flat array of suggestions from engine.suggest()
 * @param scheme - The loaded scheme for concept/category lookup
 * @returns Array of labeled groups, each containing enriched suggestion items
 */
export function groupSuggestionsWithDepth(
    suggestions: Suggestion[],
    scheme: PublicHierarchyScheme,
): SuggestionGroup[] {
    const groups: SuggestionGroup[] = [];
    let currentGroup = '';
    let globalIndex = 0;

    // Build the concept/category lookup maps once instead of rebuilding them
    // inside getConceptDepth for every suggestion (this runs on each keystroke,
    // so the naive per-suggestion rebuild is O(N*C)).
    const conceptMap = new Map(scheme.concepts.map((c) => [c.id, c]));
    const categoryMap = new Map(scheme.categories.map((f) => [f.id, f]));
    const headerCategoryByConcept =
        getPublicFormatLayout(scheme).headerCategoryByConcept;

    for (const s of suggestions) {
        if (s.group !== currentGroup) {
            currentGroup = s.group;
            groups.push({ label: currentGroup, items: [] });
        }

        const primary = s.views['default'] ?? s.label;
        let secondary = '';
        if (s.name !== primary) {
            secondary = s.name;
        } else if (s.description && s.description !== primary) {
            secondary = s.description;
        }

        const depth = conceptDepthFromMaps(
            s.conceptId,
            s.categoryId,
            conceptMap,
            categoryMap,
            headerCategoryByConcept,
        );

        groups[groups.length - 1].items.push({
            suggestion: s,
            primary,
            secondary,
            depth,
            globalIndex: globalIndex++,
        });
    }

    return groups;
}

/**
 * Compute the hierarchy depth of a concept within its category.
 *
 * Walks the parent chain counting ancestors that belong to the same category.
 * Stops at hierarchy roots or when no matching parent is found.
 *
 * @param conceptId - The concept to measure depth for
 * @param categoryId - The category context for the depth walk
 * @param scheme - The loaded scheme for concept/category lookup
 * @returns Depth number (0 = root level, 1 = one parent deep, etc.)
 */
export function getConceptDepth(
    conceptId: string,
    categoryId: string,
    scheme: PublicHierarchyScheme,
): number {
    const conceptMap = new Map(scheme.concepts.map((c) => [c.id, c]));
    const categoryMap = new Map(scheme.categories.map((f) => [f.id, f]));
    return conceptDepthFromMaps(
        conceptId,
        categoryId,
        conceptMap,
        categoryMap,
        getPublicFormatLayout(scheme).headerCategoryByConcept,
    );
}

/**
 * Core depth walk operating on prebuilt lookup maps, so a caller resolving
 * depth for many concepts (see {@link groupSuggestionsWithDepth}) builds the
 * maps once rather than once per concept.
 */
function conceptDepthFromMaps(
    conceptId: string,
    categoryId: string,
    conceptMap: Map<string, ConceptView>,
    categoryMap: Map<string, CategoryView>,
    headerCategoryByConcept: Map<string, string>,
): number {
    let depth = 0;
    let current = conceptMap.get(conceptId);

    while (current && current.parents.length > 0) {
        let foundParent = false;
        for (const pid of current.parents) {
            const parent = conceptMap.get(pid);
            if (!parent) continue;
            if (
                parent.categories.some(
                    (fid) => categoryMap.get(fid)?.hierarchyRoot,
                )
            )
                break;
            if (
                parent.categories.includes(categoryId) ||
                headerCategoryByConcept.get(parent.id) === categoryId
            ) {
                depth++;
                current = parent;
                foundParent = true;
                break;
            }
        }
        if (!foundParent) break;
    }
    return depth;
}
