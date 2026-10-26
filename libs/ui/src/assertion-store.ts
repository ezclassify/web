import type { FieldAssertion } from './forms/types';

/**
 * Convert engine assertion objects to the minimal `{conceptId, categoryId,
 * value?}` shape used by forms.
 */
export function toFieldAssertions(
    assertions: Array<{
        conceptId: string;
        categoryId: string;
        value?: string;
    }>,
): FieldAssertion[] {
    return assertions.map((a) => ({
        conceptId: a.conceptId,
        categoryId: a.categoryId,
        ...(a.value ? { value: a.value } : {}),
    }));
}
