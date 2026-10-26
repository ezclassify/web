/**
 * TokenTree: builds a nested tree of renderable tokens from assertions +
 * profile.
 *
 * The tree mirrors the marking's visual structure:
 *
 * - Top level: category groups (separated by //)
 * - Within categories: one token per assertion, in display order, except where
 *   the format composes a tiered concept into the head it belongs to
 * - Leaf level: text-input values attached to their parent concept
 *
 * Each node knows its conceptId, categoryId, depth, separator, and children.
 * The UI renders this as nested <span> elements; cursor position maps to a
 * node, and deleting removes that node + descendants.
 *
 * Render structure is adapter-derived. The tree lays out what the adapter
 * already resolved and says nothing about which categories a scheme wants
 * suppressed: category `when` conditions and `suppressIfSubsetOf` are scheme
 * policy, the runtime that owns the scheme applies them when it renders, and
 * the public scheme projection a remote adapter receives does not carry either
 * field. Evaluating them here produced a layout that agreed with the server
 * only when the engine happened to be in-process. Suppression therefore reaches
 * the UI the way every other resolved fact does: through the assertion set and
 * the rendered string the adapter returns.
 */

import type {
    Assertion,
    EachAffix,
    SchemePublicView,
    ConceptView,
    TierComposition,
} from '@ezclassify/types';
import {
    eachForCategory,
    getPublicFormatLayout,
    tiersForCategory,
    viewForCategory,
    type FormatLayoutSource,
} from '../format-layout';

/** A single token in the rendered tree */
export interface TokenNode {
    /** Unique key for React-style diffing / DOM identity */
    key: string;
    /** Concept ID (undefined for separator-only nodes) */
    conceptId?: string;
    /** Category this token belongs to */
    categoryId: string;
    /** Display text for this token */
    label: string;
    /** Separator rendered BEFORE this token (e.g. '-', ' ', ', ') */
    separator: string;
    /**
     * What the format writes around this token, when the category frames every
     * one of its values.
     *
     * Inside the separator rather than outside it: the separator joins two
     * values, this frames one. Only a top-level token carries it, because the
     * format writes it around a whole value and an attached tier is part of the
     * value above it rather than a value of its own.
     */
    each?: EachAffix;
    /** Nesting depth (0 = category root, 1 = concept, 2 = child concept, ...) */
    depth: number;
    /** Child tokens (child concepts, text-input values) */
    children: TokenNode[];
    /** If this is a text-input value node */
    isTextValue?: boolean;
    /** The assertion this node represents */
    assertion?: Assertion;
    /** Whether this concept is inferred (not user-selected) */
    inferred?: boolean;
    /** The concept's display position from metadata */
    position: number;
}

/** A category group: top-level container in the tree */
export interface CategoryGroup {
    categoryId: string;
    label: string;
    /** Separator rendered BEFORE this group (e.g. '//' between categories) */
    separator: string;
    /** Concept tokens in render order */
    tokens: TokenNode[];
    /** Whether this group has a header concept (e.g. REL TO) */
    headerConceptId?: string;
}

/** The full token tree for a marking */
export interface TokenTree {
    groups: CategoryGroup[];
}

/**
 * Build the renderable token tree for a set of assertions under a scheme.
 *
 * Walks assertion categories in their supplied order and lays out one group per
 * category that has assertions. Within each category an assertion gets its own
 * token unless the format composes its tier into a head, and text-input values
 * attach as leaf children of their concept. Each category is written in the
 * view the projection gives it, which need not be the format's own.
 *
 * Scheme-authored suppression is not applied here; see the module header. An
 * assertion the runtime suppressed from the rendered string is still a real
 * assertion and still gets a token, which is what the chip and caret surfaces
 * need.
 *
 * @param assertions - The marking's assertions to lay out.
 * @param scheme - The resolved scheme that defines categories and concepts.
 * @param meta - Scheme metadata carrying the projected render-format layouts.
 * @param formatId - Render format to use; defaults to the scheme's
 *   `defaultRenderFormat`.
 * @returns A tree of category groups, each holding its concept tokens in render
 *   order.
 */
export function buildTokenTree(
    assertions: Assertion[],
    scheme: Pick<SchemePublicView, 'concepts' | 'categories'>,
    meta: FormatLayoutSource,
    formatId?: string,
): TokenTree {
    const layout = getPublicFormatLayout(meta, formatId);
    const format = layout.format;
    const conceptMap = new Map(scheme.concepts.map((c) => [c.id, c]));
    const categoryMap = new Map(scheme.categories.map((f) => [f.id, f]));

    const groups: CategoryGroup[] = [];
    let isFirstGroup = true;

    // Headers can interleave categories in the engine's print order. A group
    // is one contiguous run, so a later occurrence never jumps ahead of it.
    const runs: Assertion[][] = [];
    for (const assertion of assertions) {
        const last = runs.at(-1);
        if (last?.[0].categoryId === assertion.categoryId) last.push(assertion);
        else runs.push([assertion]);
    }
    for (const categoryAssertions of runs) {
        const categoryId = categoryAssertions[0].categoryId;
        const category = categoryMap.get(categoryId);
        if (!category) continue;

        // Detect header concept
        const headerAssertion = assertions.find((a) => {
            const c = conceptMap.get(a.conceptId);
            return (
                c !== undefined &&
                layout.headerCategoryByConcept.get(c.id) === categoryId
            );
        });

        // Build between-category separator
        let groupSep = '';
        if (!isFirstGroup) {
            groupSep =
                layout.separatorBeforeCategory.get(categoryId) ??
                format.separator ??
                '';
        }

        const tokens = buildCategoryTokens(
            categoryAssertions,
            categoryId,
            conceptMap,
            layout.categorySeparators.get(categoryId),
            viewForCategory(layout, categoryId),
            tiersForCategory(layout, categoryId),
            eachForCategory(layout, categoryId),
        );

        groups.push({
            categoryId,
            label: category.label,
            separator: groupSep,
            tokens,
            headerConceptId: headerAssertion?.conceptId,
        });
        isFirstGroup = false;
    }

    return { groups };
}

/**
 * Lay one category's assertions out.
 *
 * A category whose format writes tier compositions lays its assertions out as
 * composed tokens: a tiered concept does not stand beside the head it belongs
 * to, it attaches to it, and the two together are one chip. Every other
 * category gives each assertion its own sibling token.
 *
 * @param categoryAssertions - The assertions in this category.
 * @param categoryId - The category being laid out.
 * @param conceptMap - Every concept in the scheme, by id.
 * @param categorySeparator - What the format writes between two values here.
 * @param categoryView - The concept view this category is written in.
 * @param tiers - The category's tier compositions, outermost tier first.
 * @param each - What the format writes around every value here.
 */
function buildCategoryTokens(
    categoryAssertions: Assertion[],
    categoryId: string,
    conceptMap: Map<string, ConceptView>,
    categorySeparator: string | undefined,
    categoryView: string | undefined,
    tiers: TierComposition[],
    each: EachAffix | undefined,
): TokenNode[] {
    if (tiers.length > 0) {
        return framed(
            buildTieredTokens(
                categoryAssertions,
                categoryId,
                conceptMap,
                categorySeparator,
                categoryView,
                tiers,
            ),
            each,
        );
    }

    const withinSep = categorySeparator ?? '';
    let isFirst = true;
    const tokens: TokenNode[] = [];

    for (const assertion of categoryAssertions) {
        const concept = conceptMap.get(assertion.conceptId);
        const label = getLabel(concept, categoryView, assertion);

        tokens.push({
            key: `${categoryId}::${assertion.conceptId}`,
            conceptId: assertion.conceptId,
            categoryId,
            label,
            separator: isFirst ? '' : withinSep,
            depth: 0,
            children: buildTextValueChildren(assertion, concept, categoryId),
            assertion,
            inferred: assertion.confidence === 'inferred',
            position: concept?.position ?? 0,
        });
        isFirst = false;
    }

    return framed(tokens, each);
}

/**
 * Hand every top-level token the affix the format writes around a value.
 *
 * One place for both layouts, because the rule is the same in both: the format
 * frames a value, and a value is a top-level token whether or not it has a tier
 * attached inside it. A category that frames nothing leaves the member off
 * rather than carrying two empty strings, so a surface asks whether there is an
 * affix instead of whether it is empty.
 */
function framed(tokens: TokenNode[], each: EachAffix | undefined): TokenNode[] {
    if (each === undefined) return tokens;
    for (const token of tokens) token.each = each;
    return tokens;
}

/** Adjacency key for children whose head is not itself tiered or asserted. */
const ROOT_KEY = '__root__';

/**
 * The view one concept is written in where its tier sets it apart.
 *
 * A tier may name a view of its own, which is how a format writes a
 * subcompartment shorter than the compartment it hangs off. A concept whose
 * tier names none is written in the category's view.
 */
function tierViewOf(
    concept: ConceptView | undefined,
    tiers: TierComposition[],
    categoryView: string | undefined,
): string | undefined {
    for (const tier of tiers) {
        if (tier.view && concept?.tier === tier.tier) return tier.view;
    }
    return categoryView;
}

/**
 * Lay a tiered category out as composed tokens.
 *
 * A tiered concept attaches to the head it belongs to rather than standing
 * beside it: what goes between them is the tier's attachment, not the
 * category's value separator, and the head plus everything attached to it is
 * one chip. A head that was never asserted is still synthesized, because the
 * written token needs it and a surface that showed only the children would
 * spell the marking wrong.
 *
 * The head is written in `headView` when the boundary that names it says so,
 * which is the one place a format can write a composed token's two halves
 * differently. That mirrors the engine: the boundary's word about the position
 * it names wins over the head's own tier view.
 */
function buildTieredTokens(
    categoryAssertions: Assertion[],
    categoryId: string,
    conceptMap: Map<string, ConceptView>,
    categorySeparator: string | undefined,
    categoryView: string | undefined,
    tiers: TierComposition[],
): TokenNode[] {
    const tierByName = new Map(tiers.map((tier) => [tier.tier, tier]));
    /** The boundary a concept's own tier declares, if the format declares one. */
    const boundaryOf = (
        id: string | undefined,
    ): TierComposition | undefined => {
        const tier = id === undefined ? undefined : conceptMap.get(id)?.tier;
        return tier === undefined ? undefined : tierByName.get(tier);
    };
    const labelOf = (
        concept: ConceptView | undefined,
        assertion: Assertion | undefined,
        view: string | undefined,
    ): string => getLabel(concept, view, assertion);
    const labeling: TierLabeling = {
        conceptMap,
        boundaryOf,
        headLabel: (concept, assertion, firstChildId) =>
            labelOf(
                concept,
                assertion,
                boundaryOf(firstChildId)?.headView ??
                    tierViewOf(concept, tiers, categoryView),
            ),
    };

    const assertedIds = new Set(categoryAssertions.map((a) => a.conceptId));
    const assertionMap = new Map(
        categoryAssertions.map((a) => [a.conceptId, a]),
    );

    // Build parent→children adjacency for the concepts the format tiers.
    const tieredIds = new Set<string>();
    const childrenOf = new Map<string, TokenNode[]>();

    for (const a of categoryAssertions) {
        const concept = conceptMap.get(a.conceptId);
        const boundary = boundaryOf(concept?.id);
        if (!concept || !boundary) continue;
        tieredIds.add(concept.id);

        const node: TokenNode = {
            key: `${categoryId}::${concept.id}`,
            conceptId: concept.id,
            categoryId,
            label: labelOf(
                concept,
                a,
                tierViewOf(concept, tiers, categoryView),
            ),
            separator: boundary.attachedBy,
            depth: 0, // set during the tree walk below
            children: buildTextValueChildren(a, concept, categoryId),
            assertion: a,
            inferred: a.confidence === 'inferred',
            position: concept.position,
        };

        const parentId = findTieredParent(
            concept,
            categoryId,
            assertedIds,
            conceptMap,
        );
        const key = parentId ?? ROOT_KEY;
        const arr = childrenOf.get(key) ?? [];
        arr.push(node);
        childrenOf.set(key, arr);
    }

    // Concepts that have tiered children hanging off them.
    const parentIds = new Set<string>();
    for (const id of tieredIds) {
        const c = conceptMap.get(id);
        if (c) for (const pid of c.parents) parentIds.add(pid);
    }

    const results: TokenNode[] = [];

    // Untiered concepts first, minus the heads that were swallowed above.
    for (const a of categoryAssertions) {
        const concept = conceptMap.get(a.conceptId);
        if (!concept) continue;
        if (tieredIds.has(concept.id)) continue;
        if (parentIds.has(concept.id)) {
            const hasChildren = (childrenOf.get(concept.id) ?? []).length > 0;
            if (hasChildren) continue;
        }

        results.push({
            key: `${categoryId}::${concept.id}`,
            conceptId: concept.id,
            categoryId,
            label: labelOf(
                concept,
                a,
                tierViewOf(concept, tiers, categoryView),
            ),
            separator: '',
            depth: 0,
            children: buildTextValueChildren(a, concept, categoryId),
            assertion: a,
            inferred: a.confidence === 'inferred',
            position: concept.position,
        });
    }

    // Composed tokens: one root per head, its attached children beneath it.
    for (const [parentKey, children] of childrenOf) {
        if (parentKey !== ROOT_KEY && tieredIds.has(parentKey)) continue;

        const parentConcept =
            parentKey !== ROOT_KEY
                ? conceptMap.get(parentKey)
                : synthesizedHead(children, categoryId, conceptMap);

        if (!parentConcept) {
            // No head to attach to: each child is its own root token.
            for (const child of children) {
                setDepths(child, 0, childrenOf, labeling);
                results.push(child);
            }
            continue;
        }

        const parentAssertion = assertionMap.get(parentConcept.id);
        const parentNode: TokenNode = {
            key: `${categoryId}::${parentConcept.id}`,
            conceptId: parentConcept.id,
            categoryId,
            label: labeling.headLabel(
                parentConcept,
                parentAssertion,
                children[0]?.conceptId,
            ),
            separator: '',
            depth: 0,
            children: [],
            assertion: parentAssertion,
            inferred: parentAssertion?.confidence === 'inferred',
            position: parentConcept.position,
        };
        for (const child of children) {
            attachSubtree(child, childrenOf, 1, labeling);
            parentNode.children.push(child);
        }
        results.push(parentNode);
    }

    // Building tier heads can collect roots separately; restore their supplied
    // order, using the first asserted descendant for a synthesized head.
    const index = new Map(categoryAssertions.map((a, i) => [a.conceptId, i]));
    const orderOf = (node: TokenNode): number =>
        index.get(node.conceptId ?? '') ??
        Math.min(...node.children.map(orderOf));
    results.sort((a, b) => orderOf(a) - orderOf(b));

    // Only an attached child keeps its tier's attachment. A token that ended up
    // at root level is beside its neighbors rather than inside one of them, so
    // it is written with the category's own separator, exactly as an untiered
    // category writes its values. A tiered concept whose head is not here would
    // otherwise pull the attachment out to top level and spell the marking as
    // something the adapter never rendered.
    for (let i = 0; i < results.length; i++) {
        results[i].separator = i === 0 ? '' : (categorySeparator ?? '');
    }

    return results;
}

/** What a tiered walk needs to relabel a node once it turns out to be a head. */
interface TierLabeling {
    conceptMap: Map<string, ConceptView>;
    /** The boundary a concept's own tier declares, by concept id. */
    boundaryOf(id: string | undefined): TierComposition | undefined;
    /**
     * A head's label, written in the view the boundary below it names.
     *
     * @param concept - The head concept.
     * @param assertion - Its assertion, absent for a synthesized head.
     * @param firstChildId - The concept id of the first child attached to it,
     *   whose boundary is the one that names this position.
     */
    headLabel(
        concept: ConceptView,
        assertion: Assertion | undefined,
        firstChildId: string | undefined,
    ): string;
}

/**
 * Relabel a node that has just been found to be a head.
 *
 * A node is built as somebody's child before the walk knows whether anything
 * hangs off it, and the view a head position is written in belongs to the
 * boundary below it, not to the head's own tier. So the label is settled here,
 * once the children are known.
 */
function relabelAsHead(
    node: TokenNode,
    children: TokenNode[],
    labeling: TierLabeling,
): void {
    if (children.length === 0 || node.conceptId === undefined) return;
    const concept = labeling.conceptMap.get(node.conceptId);
    if (!concept) return;
    node.label = labeling.headLabel(
        concept,
        node.assertion,
        children[0]?.conceptId,
    );
}

/**
 * The head a set of root-level children belongs to, from the children.
 *
 * They landed at the root because no asserted or tiered ancestor was found, but
 * the written token still names a head, so it is taken from the first child's
 * parents in this category. Returns `undefined` when the children genuinely
 * have no head here, and each of them stands on its own.
 */
function synthesizedHead(
    children: TokenNode[],
    categoryId: string,
    conceptMap: Map<string, ConceptView>,
): ConceptView | undefined {
    const first = children[0]?.conceptId;
    const childConcept =
        first === undefined ? undefined : conceptMap.get(first);
    if (!childConcept) return undefined;
    const headId = childConcept.parents.find((p) => {
        const pc = conceptMap.get(p);
        return pc !== undefined && pc.categories.includes(categoryId);
    });
    return headId === undefined ? undefined : conceptMap.get(headId);
}

/**
 * The nearest ancestor in this category a tiered concept attaches to.
 *
 * Walks up the parent chain, breadth of each level first, and stops at the
 * first ancestor that is in this category and is either asserted or tiered
 * itself. `visited` keeps a cyclic scheme finite.
 */
function findTieredParent(
    concept: ConceptView,
    categoryId: string,
    assertedIds: Set<string>,
    conceptMap: Map<string, ConceptView>,
): string | undefined {
    const visited = new Set<string>();
    const walk = (ids: string[]): string | undefined => {
        for (const pid of ids) {
            if (visited.has(pid)) continue;
            visited.add(pid);
            const pc = conceptMap.get(pid);
            if (!pc) continue;
            if (
                pc.categories.includes(categoryId) &&
                (assertedIds.has(pid) || pc.tier !== undefined)
            ) {
                return pid;
            }
            const found = walk(pc.parents);
            if (found) return found;
        }
        return undefined;
    };
    return walk(concept.parents);
}

/** Hang a node's own tiered children off it and number the depths downward. */
function attachSubtree(
    node: TokenNode,
    childrenOf: Map<string, TokenNode[]>,
    depth: number,
    labeling: TierLabeling,
): void {
    node.depth = depth;
    const tieredChildren =
        node.conceptId === undefined
            ? []
            : (childrenOf.get(node.conceptId) ?? []);
    relabelAsHead(node, tieredChildren, labeling);
    for (const child of tieredChildren) {
        attachSubtree(child, childrenOf, depth + 1, labeling);
        node.children.push(child);
    }
}

/**
 * Number a root-level child's depths, attaching any tiered children it has.
 *
 * Separate from {@link attachSubtree} because this node may already carry its
 * text-value children, so an attachment that is already there is not repeated.
 */
function setDepths(
    node: TokenNode,
    depth: number,
    childrenOf: Map<string, TokenNode[]>,
    labeling: TierLabeling,
): void {
    node.depth = depth;
    const tieredChildren =
        node.conceptId === undefined
            ? []
            : (childrenOf.get(node.conceptId) ?? []);
    relabelAsHead(node, tieredChildren, labeling);
    for (const child of tieredChildren) {
        setDepths(child, depth + 1, childrenOf, labeling);
        if (!node.children.includes(child)) {
            node.children.push(child);
        }
    }
}

function buildTextValueChildren(
    assertion: Assertion,
    concept: ConceptView | undefined,
    categoryId: string,
): TokenNode[] {
    if (!assertion.value || !concept?.textInput) return [];
    return [
        {
            key: `${categoryId}::${concept.id}::value`,
            conceptId: concept.id,
            categoryId,
            label: assertion.value,
            separator: ' ',
            depth: 0, // will be adjusted by parent
            children: [],
            isTextValue: true,
            assertion,
            position: concept.position,
        },
    ];
}

function getLabel(
    concept: ConceptView | undefined,
    conceptProperty: string | undefined,
    assertion?: Assertion,
): string {
    if (!concept) return assertion?.conceptId ?? '?';
    const prop = conceptProperty ?? 'default';
    let label = concept.views[prop] ?? concept.views['default'] ?? concept.id;
    // Substitute {value} for text-input concepts
    if (label.includes('{value}') && assertion?.value) {
        label = label.replace('{value}', assertion.value);
    }
    return label;
}

/** Flat representation of a token for cursor navigation */
export interface FlatToken {
    node: TokenNode;
    /** Index within the flat list */
    index: number;
    /** The category group this token belongs to */
    groupIndex: number;
}

/**
 * Flatten the tree into a sequential, depth-first list for caret navigation.
 *
 * Each token appears before its children, so left/right arrow movement steps
 * through parents then descendants in reading order. The `index` is the
 * position in this flat list; `groupIndex` records which category group the
 * token came from.
 */
export function flattenTree(tree: TokenTree): FlatToken[] {
    const result: FlatToken[] = [];
    for (let gi = 0; gi < tree.groups.length; gi++) {
        const group = tree.groups[gi];
        for (const token of group.tokens) {
            flattenNode(token, gi, result);
        }
    }
    return result;
}

function flattenNode(
    node: TokenNode,
    groupIndex: number,
    result: FlatToken[],
): void {
    result.push({ node, index: result.length, groupIndex });
    for (const child of node.children) {
        flattenNode(child, groupIndex, result);
    }
}

/**
 * Collect the assertions carried by a node and all its descendants.
 *
 * Used when deleting a token: removing a node drops its own assertion plus
 * every child assertion in one edit. Text-value leaf nodes are skipped because
 * their assertion is already represented by the parent concept token.
 */
export function collectAssertions(node: TokenNode): Assertion[] {
    const result: Assertion[] = [];
    if (node.assertion && !node.isTextValue) {
        result.push(node.assertion);
    }
    for (const child of node.children) {
        result.push(...collectAssertions(child));
    }
    return result;
}
