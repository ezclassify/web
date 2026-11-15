/**
 * How a field writes a concept, for every place the field names one to the
 * author: the options it offers, the dots that sum up a step, and the changes
 * its status mark lists.
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
