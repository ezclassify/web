/**
 * Runtime helpers shared by every `EzClassifyStore` implementation.
 *
 * Lives in its own module so `base-ezclassify-store.ts` can import these values
 * while `ezclassify-store.ts` (which defines `VanillaEzClassifyStore` as a
 * `BaseEzClassifyStore` subclass) imports the base class. With the helpers
 * inline in either file, whichever module a spec loaded first would hit the
 * other's class binding mid-evaluation (TDZ). This module imports no store
 * class, so the runtime graph stays acyclic. Both helpers are re-exported from
 * `./ezclassify-store` and from the package root, so consumers are unaffected
 * by the split.
 */

import type { Assertion, Suggestion } from '@ezclassify/types';
import type {
    EzClassifyAggregate,
    EzClassifyState,
    FacetState,
} from './ezclassify-store';

/**
 * Canonical empty `EzClassifyState`. Identity is not stable across calls; copy
 * if mutating.
 */
export const EMPTY_EZCLASSIFY_STATE: EzClassifyState = Object.freeze({
    rendered: '',
    renders: {},
    assertions: [],
    valid: false,
    errors: [],
    displayColor: undefined,
});

/**
 * Canonical empty `FacetState`: the seed a facet cell holds before the store
 * has computed allowable options for it. `allowableOptions: null` is the
 * show-all fallback, so a picker reading a never-refreshed cell behaves exactly
 * as it does on an engine with no suggest capability.
 */
export const EMPTY_FACET_STATE: FacetState = Object.freeze({
    allowableOptions: null,
    selectedAssertions: [],
});

/**
 * True when the candidate allowableOptions + selectedAssertions match the
 * previously-cached FacetState closely enough to skip a listener notification.
 * Compares concept+category pairs; value/confidence/source differences don't
 * affect what the picker displays, so they're deliberately ignored.
 *
 * Exported from `@ezclassify/ui` so the framework store adapters share this
 * single definition instead of each carrying a "local copy not exported from
 * the lib" duplicate.
 */
export function facetStateEqual(
    prev: FacetState,
    nextAllowable: Suggestion[] | null,
    nextSelected: Assertion[],
): boolean {
    // null vs non-null is a meaningful difference (show-all vs filtered).
    if ((prev.allowableOptions === null) !== (nextAllowable === null))
        return false;
    if (prev.allowableOptions !== null && nextAllowable !== null) {
        if (prev.allowableOptions.length !== nextAllowable.length) return false;
        const prevKeys = new Set(
            prev.allowableOptions.map((s) => `${s.conceptId}::${s.categoryId}`),
        );
        for (const s of nextAllowable) {
            if (!prevKeys.has(`${s.conceptId}::${s.categoryId}`)) return false;
        }
    }
    if (prev.selectedAssertions.length !== nextSelected.length) return false;
    const prevSelectedKeys = new Set(
        prev.selectedAssertions.map((a) => `${a.conceptId}::${a.categoryId}`),
    );
    for (const a of nextSelected) {
        if (!prevSelectedKeys.has(`${a.conceptId}::${a.categoryId}`))
            return false;
    }
    return true;
}

/**
 * Separates the two halves of a {@link BucketKey}. A unit separator cannot
 * appear in a Context key or a scheme selector a host writes in markup.
 */
const BUCKET_SEPARATOR = '\u001f';

/**
 * The key of one rollup bucket: a Context and a scheme selector within it.
 * Rollups combine markings of one bucket only and never merge two buckets,
 * because two Contexts can carry the same scheme id under different guides or
 * access policies, and two schemes of one Context are read by different rules.
 *
 * Built with {@link bucketKey}; read back with {@link bucketParts}.
 */
export type BucketKey = `${string}\u001f${string}`;

/**
 * The bucket of the markings read in Context `contextKey` under its scheme
 * `schemeSelector`.
 *
 * @param contextKey - The instance's key for the Context. Empty for the only
 *   Context of an instance built from one Context.
 * @param schemeSelector - The Context-local scheme selector. Empty for the
 *   Context's primary scheme.
 */
export function bucketKey(
    contextKey: string,
    schemeSelector: string,
): BucketKey {
    if (
        contextKey.includes(BUCKET_SEPARATOR) ||
        schemeSelector.includes(BUCKET_SEPARATOR)
    ) {
        throw new Error(
            '[ezclassify] A Context key or scheme selector cannot contain a unit separator.',
        );
    }
    return `${contextKey}${BUCKET_SEPARATOR}${schemeSelector}`;
}

/** The Context key and scheme selector a {@link BucketKey} was built from. */
export function bucketParts(key: BucketKey): {
    contextKey: string;
    schemeSelector: string;
} {
    const at = key.indexOf(BUCKET_SEPARATOR);
    return {
        contextKey: key.slice(0, at),
        schemeSelector: key.slice(at + 1),
    };
}

/**
 * The bucket of a store built over one engine: the only Context's primary
 * scheme.
 */
export const SOLE_BUCKET: BucketKey = bucketKey('', '');

/** The aggregate of a level with no contributor in any bucket. */
export const EMPTY_EZCLASSIFY_AGGREGATE: EzClassifyAggregate = Object.freeze({
    byBucket: new Map<BucketKey, EzClassifyState>(),
});
