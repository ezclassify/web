import type { Assertion, SchemePublicView } from '@ezclassify/types';
import {
    getPublicFormatLayout,
    type FormatLayoutSource,
} from '../format-layout';

const assertionKey = (conceptId: string, categoryId: string): string =>
    `${conceptId}::${categoryId}`;

/**
 * Remove one assertion together with assertions that depend on it.
 *
 * A user removing a directly associated field header is also removing the
 * adjacent category values. Likewise, removing a hierarchy parent removes its
 * asserted descendants in that category. Pruning those dependents before
 * reprocessing preserves the user's removal intent instead of allowing
 * inference to immediately restore the parent.
 *
 * @param assertions - Current assertion set
 * @param conceptId - Concept explicitly removed by the user
 * @param categoryId - Category of the explicitly removed assertion
 * @param scheme - Loaded scheme view carrying the concept hierarchy
 * @param meta - Scheme metadata carrying the projected render-format layouts
 * @returns A new assertion set with the removal cascade applied
 */
export function removeAssertionCascade(
    assertions: readonly Assertion[],
    conceptId: string,
    categoryId: string,
    scheme: Pick<SchemePublicView, 'concepts'>,
    meta: FormatLayoutSource,
): Assertion[] {
    const concepts = new Map(
        scheme.concepts.map((concept) => [concept.id, concept]),
    );
    const removed = new Set([assertionKey(conceptId, categoryId)]);
    const headerCategory =
        getPublicFormatLayout(meta).headerCategoryByConcept.get(conceptId);

    if (headerCategory) {
        for (const assertion of assertions) {
            if (assertion.categoryId === headerCategory) {
                removed.add(
                    assertionKey(assertion.conceptId, assertion.categoryId),
                );
            }
        }
    }

    let changed = true;
    while (changed) {
        changed = false;
        for (const assertion of assertions) {
            const key = assertionKey(assertion.conceptId, assertion.categoryId);
            if (removed.has(key)) continue;

            const concept = concepts.get(assertion.conceptId);
            if (
                concept?.parents.some((parentId) =>
                    removed.has(assertionKey(parentId, assertion.categoryId)),
                )
            ) {
                removed.add(key);
                changed = true;
            }
        }
    }

    return assertions.filter(
        (assertion) =>
            !removed.has(
                assertionKey(assertion.conceptId, assertion.categoryId),
            ),
    );
}
