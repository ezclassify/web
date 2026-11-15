/**
 * How a field writes a concept, for every place the field names one to the
 * author: the options it offers, the dots that sum up a step, and the changes
 * its status mark lists. Also the order the field writes a scope's categories
 * in (see {@link inWrittenOrder}).
 *
 * A field names a concept the way its marking writes it, in the output the
 * field writes for the concept's scope. That is the output the field names when
 * it writes that scope, else the scheme's default output for the scope and the
 * field's role (whole or part). An output writes a category in the concept view
 * it names for it, and a concept with no spelling in that view in its `default`
 * view, the way the engine spells it. A concept that output gives no spelling
 * reads as the scheme's default output for the scope writes it, and failing
 * that as its name, so a field never names a concept with nothing.
 *
 * A value-taking concept's views are templates for its value, so it reads as
 * its name.
 *
 * Everything here is the scheme's to say: which scope a category is on, which
 * output writes a scope, and how each concept is spelled there.
 */

import type {
    AssertionRef,
    SchemeMetaView,
    SchemePublicView,
} from '@ezclassify/types';
import { getPublicFormatLayout, viewForCategory } from './format-layout';
import { viewOutputOf } from './format-resolver';
import { inDeclarationOrder, scopesOfCategory } from './scopes';

/** What a field writes, as far as naming its concepts goes. */
export interface WritingField {
    /** The output the field names (its format). */
    formatId: string;
    /** Whether the field holds a part rather than a whole marking. */
    part: boolean;
    /**
     * The scopes the field writes, in any order. A category of several scopes
     * is named as the first of these it belongs to writes it.
     */
    scopes: readonly string[];
}

/** The scheme metadata the naming reads. */
export type WritingMeta = Pick<
    SchemeMetaView,
    | 'formats'
    | 'scopes'
    | 'defaultScope'
    | 'defaultRenderFormat'
    | 'defaultPartRenderFormat'
    | 'defaultWholeRenderFormat'
>;

/** A field and the scheme it writes in. */
export interface ConceptWriting {
    /** The scheme's concepts and categories. */
    scheme: Pick<SchemePublicView, 'concepts' | 'categories'>;
    /** The scheme's outputs and scopes. */
    meta: WritingMeta;
    /** What the field writes. */
    field: WritingField;
}

/**
 * The scope a field writes a category on: the first, in the scheme's order, of
 * the category's scopes that the field writes, else the category's first scope.
 * Undefined for a scheme that declares no scopes.
 *
 * @param category - The category, with the scopes it declares
 * @param field - What the field writes
 * @param meta - The scheme's scope metadata
 */
export function fieldScopeOf(
    category: { scopes?: readonly string[] },
    field: Pick<WritingField, 'scopes'>,
    meta: WritingMeta,
): string | undefined {
    const own = inDeclarationOrder(scopesOfCategory(category, meta), meta);
    return own.find((scope) => field.scopes.includes(scope)) ?? own[0];
}

/**
 * The output a field writes a scope in: the output it names, when that output
 * writes the scope, else the scheme's default output for the scope and the
 * field's role. Without a scope, the output the field names.
 *
 * @param meta - The scheme's outputs and scopes
 * @param field - What the field writes
 * @param scope - The scope id, if the scheme declares scopes
 * @returns The output's id
 */
export function fieldOutputFor(
    meta: WritingMeta,
    field: Pick<WritingField, 'formatId' | 'part'>,
    scope: string | undefined,
): string {
    if (scope === undefined) return field.formatId;
    const named = meta.formats?.find((f) => f.id === field.formatId)?.surface;
    return scope === named
        ? field.formatId
        : viewOutputOf(meta, [scope], field.part);
}

/** Gates per scheme, keyed by its concept list, which is stable per scheme. */
const gatesByScheme = new WeakMap<object, Map<string, Set<string>>>();

/**
 * The categories each category gates, as the scheme declares it: a category
 * whose concepts name a parent concept held in another is gated by that one,
 * and so is a list a heading concept introduces in the scheme's default output.
 * Keyed by the gated category, each with the categories gating it.
 */
function gatingOf(writing: ConceptWriting): Map<string, Set<string>> {
    const key = writing.scheme.concepts;
    const cached = gatesByScheme.get(key);
    if (cached) return cached;
    const gatedBy = new Map<string, Set<string>>();
    const add = (gate: string, gated: string) => {
        if (gate === gated) return;
        const set = gatedBy.get(gated) ?? new Set<string>();
        set.add(gate);
        gatedBy.set(gated, set);
    };
    const categoriesOf = new Map(
        writing.scheme.concepts.map((c) => [c.id, c.categories]),
    );
    for (const concept of writing.scheme.concepts)
        for (const parent of concept.parents ?? [])
            for (const gate of categoriesOf.get(parent) ?? [])
                for (const gated of concept.categories) add(gate, gated);
    for (const [gated, header] of getPublicFormatLayout(writing.meta)
        .headerByCategory)
        add(header.categoryId, gated);
    gatesByScheme.set(key, gatedBy);
    return gatedBy;
}

/**
 * Categories in the order a field writes them on one scope: the ones the
 * field's output for that scope writes, in the order that output writes them,
 * then the rest in the order given. One thing overrides that order: a step
 * never comes after a step that depends on it. A category that gates another
 * (the gated category's concepts name a parent in it, or it holds the heading
 * of the gated list) comes immediately before the first category it gates,
 * whether the output writes it or not.
 *
 * The order is the output's own, as the scheme publishes it, not the order of
 * any particular marking, so it is the same whatever the field holds. An output
 * the scheme publishes no order for leaves the categories as given, gates
 * aside. Everything that lists a scope's categories in written order (a
 * stepper's steps, the chips of a tag field) reads it here.
 *
 * @param writing - The field and its scheme
 * @param scope - The scope id, if the scheme declares scopes
 * @param categoryIds - The categories to order, in declaration order
 * @returns The same categories, in the order the field writes them
 */
export function inWrittenOrder(
    writing: ConceptWriting,
    scope: string | undefined,
    categoryIds: readonly string[],
): string[] {
    const { meta, field } = writing;
    const written = getPublicFormatLayout(
        meta,
        fieldOutputFor(meta, field, scope),
    ).categoryOrder;
    const rank = new Map<string, number>();
    written.forEach((id, i) => {
        if (!rank.has(id)) rank.set(id, i);
    });
    const byOutput = [
        ...categoryIds
            .filter((id) => rank.has(id))
            .sort((a, b) => (rank.get(a) ?? 0) - (rank.get(b) ?? 0)),
        ...categoryIds.filter((id) => !rank.has(id)),
    ];
    // Each category goes in after the categories that gate it, those in the
    // same order; a cycle of gates is broken where it closes.
    const position = new Map(byOutput.map((id, i) => [id, i]));
    const gatedBy = gatingOf(writing);
    const placed = new Set<string>();
    const placing = new Set<string>();
    const ordered: string[] = [];
    const place = (id: string): void => {
        if (placed.has(id) || placing.has(id)) return;
        placing.add(id);
        const gates = [...(gatedBy.get(id) ?? [])]
            .filter((gate) => position.has(gate))
            .sort((a, b) => (position.get(a) ?? 0) - (position.get(b) ?? 0));
        for (const gate of gates) place(gate);
        placing.delete(id);
        placed.add(id);
        ordered.push(id);
    };
    for (const id of byOutput) place(id);
    return ordered;
}

/**
 * How a field writes a concept (see the module comment): its spelling in the
 * output the field writes the concept's category in, else in the scheme's
 * default output for that scope and the field's role, else its name.
 *
 * @param writing - The field and its scheme
 * @param ref - The concept and the category it is held in
 * @returns The text to name the concept by; never empty
 */
export function writtenConcept(
    writing: ConceptWriting,
    ref: Pick<AssertionRef, 'categoryId' | 'conceptId'>,
): string {
    const { scheme, meta, field } = writing;
    const concept = scheme.concepts.find((c) => c.id === ref.conceptId);
    if (!concept) return ref.conceptId;
    const named = concept.name || concept.id;
    if (concept.textInput) return named;
    const category = scheme.categories.find((c) => c.id === ref.categoryId);
    const scope = category ? fieldScopeOf(category, field, meta) : undefined;
    const outputs = [
        fieldOutputFor(meta, field, scope),
        viewOutputOf(meta, scope === undefined ? [] : [scope], field.part),
    ];
    for (const output of outputs) {
        const view = viewForCategory(
            getPublicFormatLayout(meta, output),
            ref.categoryId,
        );
        const spelled =
            (view !== undefined ? concept.views?.[view] : undefined) ||
            concept.views?.['default'];
        if (spelled) return spelled;
    }
    return named;
}
