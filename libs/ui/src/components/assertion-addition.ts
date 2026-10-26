import type {
    Assertion,
    FixConceptReference,
    SchemePublicView,
} from '@ezclassify/types';

/**
 * Add one concept to an assertion set as the user's own choice.
 *
 * A single-select category holds one concept, so the new one replaces whatever
 * the category held. A concept already present is confirmed as the user's
 * rather than duplicated, which turns an inferred assertion into a certain one.
 * The caller reprocesses the result through the engine.
 *
 * @param assertions - Current assertion set
 * @param ref - The concept to add and the category it goes in
 * @param scheme - Loaded scheme view carrying the category definitions
 * @returns A new assertion set; the input is not modified
 */
export function addUserAssertion(
    assertions: readonly Assertion[],
    ref: FixConceptReference,
    scheme: Pick<SchemePublicView, 'categories'>,
): Assertion[] {
    const chosen: Assertion = {
        conceptId: ref.conceptId,
        categoryId: ref.categoryId,
        confidence: 'certain',
        source: 'user',
    };
    const isChosen = (a: Assertion) =>
        a.conceptId === ref.conceptId && a.categoryId === ref.categoryId;
    if (assertions.some(isChosen)) {
        return assertions.map((a) => (isChosen(a) ? chosen : a));
    }
    const single = scheme.categories.find(
        (c) => c.id === ref.categoryId,
    )?.single;
    const kept = single
        ? assertions.filter((a) => a.categoryId !== ref.categoryId)
        : [...assertions];
    return [...kept, chosen];
}
