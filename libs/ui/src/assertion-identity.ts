import type { Assertion } from '@ezclassify/types';

/** The authored fact identity; provenance is not part of the marking. */
export function assertionFactKey(
    assertion: Pick<Assertion, 'categoryId' | 'conceptId' | 'value'>,
): string {
    return JSON.stringify([
        assertion.categoryId,
        assertion.conceptId,
        assertion.value === undefined ? null : assertion.value,
    ]);
}

/**
 * Whether the engine took this value from the whole a part is read against.
 *
 * A scheme can let a part write one word for a list it shares with its whole (a
 * concept that declares `stands_for_whole`). Read against that whole, the part
 * holds the whole's values in the list's category with `source: 'context'`, so
 * every rule judges the real list. The part did not write them: they are
 * context, not part of the mark. A field never shows them as the part's own,
 * never offers them as values to keep or remove, and never passes them back to
 * the engine as stated. Reading the part against its whole again takes them
 * again.
 */
export function takenFromWhole(assertion: Pick<Assertion, 'source'>): boolean {
    return assertion.source === 'context';
}

/**
 * Whether the engine derived this fact rather than the author stating it. The
 * contract names the labels: `infer` and `repair` with a `sourceRule` (a fact a
 * scheme rule adds), `default` (a category's default concept) and `context` (a
 * value a part took from its whole). The engine derives such a fact again each
 * time it settles a marking, so the author cannot remove it on its own.
 */
export function derivedAssertion(
    assertion: Pick<Assertion, 'source' | 'sourceRule' | 'confidence'>,
): boolean {
    return (
        assertion.confidence === 'inferred' ||
        assertion.source === 'infer' ||
        assertion.source === 'default' ||
        takenFromWhole(assertion) ||
        (assertion.source === 'repair' && assertion.sourceRule !== undefined)
    );
}

/**
 * `assertions` without the values taken from a whole. Every call that hands a
 * part's assertions back to the engine sends these: the engine takes the
 * whole's values again from the whole supplied with that call, so a list the
 * whole has since changed is never carried forward.
 */
export function withoutTakenFromWhole<T extends Pick<Assertion, 'source'>>(
    assertions: readonly T[],
): T[] {
    return assertions.filter((one) => !takenFromWhole(one));
}

/**
 * Engine call options with `assertions`, when present, cut down to what the
 * marking states. See {@link withoutTakenFromWhole}.
 */
export function withStatedAssertions<
    T extends { assertions?: readonly Pick<Assertion, 'source'>[] },
>(options: T): T;
export function withStatedAssertions<
    T extends { assertions?: readonly Pick<Assertion, 'source'>[] },
>(options: T | undefined): T | undefined;
export function withStatedAssertions<
    T extends { assertions?: readonly Pick<Assertion, 'source'>[] },
>(options: T | undefined): T | undefined {
    if (!options?.assertions) return options;
    return {
        ...options,
        assertions: withoutTakenFromWhole(options.assertions),
    };
}
