import { useCallback, useMemo, useState, useSyncExternalStore } from 'react';
import {
    publishFacetSelection,
    selectedConceptIds,
    type EzClassifyFacetSelectionInput,
} from '@ezclassify/ui';
import type { Suggestion, ValidationError } from '@ezclassify/types';
import { useEzClassifyStore } from './useEzClassify';

export interface UseEzClassifyFacetReturn {
    /** Values for a controlled single- or multi-select. */
    value: string[];
    /** Governed options in the shape most React select libraries consume. */
    options: Suggestion[];
    /** Controlled-component change callback. */
    setValue: (next: readonly EzClassifyFacetSelectionInput[]) => void;
    rendered: string;
    valid: boolean;
    errors: ValidationError[];
    loading: boolean;
}

/**
 * Controlled-field adapter for MUI, React Aria, Radix, and ordinary React
 * inputs. The UI library keeps its normal component API; EzClassify supplies
 * only options, value, validation, and the change callback.
 *
 * Nothing here mirrors store state. Both `useSyncExternalStore` calls read the
 * store's own cells: the facet cell answers `options` and `loading`, the
 * marking cell answers the rest, and the store is the single place that decides
 * what either one holds. Selection changes use the shared publisher in
 * `@ezclassify/ui`. The native facet subscription also keeps its options
 * fresh.
 *
 * @param markingId - The marking this field is one facet of.
 * @param categoryId - The category this field controls.
 * @returns The controlled-field props plus its change callback.
 */
export function useEzClassifyFacet(
    markingId: string,
    categoryId: string,
): UseEzClassifyFacetReturn {
    const store = useEzClassifyStore();
    // This field's identity as a publisher, for as long as it is mounted.
    const [source] = useState(() => ({ token: {} }));

    const subscribeFacet = useMemo(
        () => store.subscribeFacetFor(markingId, categoryId),
        [store, markingId, categoryId],
    );
    const getFacet = useCallback(
        () => store.facetSnapshot(markingId, categoryId),
        [store, markingId, categoryId],
    );
    const facet = useSyncExternalStore(subscribeFacet, getFacet, getFacet);

    const subscribeMarking = useMemo(
        () => store.subscribeFor(markingId),
        [store, markingId],
    );
    const getMarking = useCallback(
        () => store.get(markingId),
        [store, markingId],
    );
    const marking = useSyncExternalStore(
        subscribeMarking,
        getMarking,
        getMarking,
    );

    const setValue = useCallback(
        (next: readonly EzClassifyFacetSelectionInput[]) => {
            void publishFacetSelection(
                store,
                markingId,
                categoryId,
                next,
                source,
            );
        },
        [store, markingId, categoryId, source],
    );

    return {
        value: useMemo(
            () => selectedConceptIds(marking.assertions, categoryId),
            [marking, categoryId],
        ),
        options: facet.allowableOptions ?? EMPTY_OPTIONS,
        setValue,
        rendered: marking.rendered,
        valid: marking.valid,
        errors: marking.errors,
        loading: facet.allowableOptions === null,
    };
}

/**
 * Stable empty list for the show-all fallback. A fresh `[]` each render would
 * make `options` a new reference on every pass and defeat memoization in the
 * select component downstream.
 */
const EMPTY_OPTIONS = Object.freeze([]) as unknown as Suggestion[];
