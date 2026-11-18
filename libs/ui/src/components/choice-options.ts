import type { AssertionRef, ProcessResult } from '@ezclassify/types';
import { t } from '../i18n';

/**
 * Available choices retain root/sibling order, with descendants after their
 * parent.
 */
export function orderChoiceOptions<T extends { concept: { id: string } }>(
    options: readonly T[],
    concepts: readonly { id: string; parents?: readonly string[] }[],
): T[] {
    const byId = new Map(options.map((option) => [option.concept.id, option]));
    const parents = new Map(
        concepts.map((concept) => [concept.id, concept.parents]),
    );
    const children = new Map<string, T[]>();
    const hasParent = new Set<string>();
    for (const option of options) {
        for (const parent of parents.get(option.concept.id) ?? []) {
            if (!byId.has(parent)) continue;
            const siblings = children.get(parent) ?? [];
            siblings.push(option);
            children.set(parent, siblings);
            hasParent.add(option.concept.id);
        }
    }
    const result: T[] = [];
    const seen = new Set<string>();
    const walk = (root: T) => {
        const pending = [root];
        while (pending.length > 0) {
            const option = pending.pop()!;
            if (seen.has(option.concept.id)) continue;
            seen.add(option.concept.id);
            result.push(option);
            pending.push(
                ...[...(children.get(option.concept.id) ?? [])].reverse(),
            );
        }
    };
    options.filter((option) => !hasParent.has(option.concept.id)).forEach(walk);
    // A cycle has no root; still show each available option once.
    options.forEach(walk);
    return result;
}

/**
 * Explain a blocked choice using DecisionFlow's canonical engine-result
 * priority.
 */
export function choiceBlockReason(
    result: Pick<ProcessResult, 'errors' | 'appliedFixes'>,
    conceptId: string,
    currentMessages: readonly string[],
): string {
    const errors = (result.errors ?? []).filter(
        (error) => !currentMessages.includes(error.message),
    );
    const fixes = result.appliedFixes ?? [];
    const touches = (refs: readonly AssertionRef[] | undefined) =>
        (refs ?? []).some((ref) => ref.conceptId === conceptId);
    return (
        errors.find((error) => error.affectedConcepts?.includes(conceptId))
            ?.message ??
        fixes.find((fix) => touches(fix.remove) || touches(fix.add))?.message ??
        fixes.find((fix) => (fix.remove ?? []).length > 0)?.message ??
        errors[0]?.message ??
        t('composer.unavailable')
    );
}
