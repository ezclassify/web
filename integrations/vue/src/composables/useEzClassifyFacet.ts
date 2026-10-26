import {
    computed,
    inject,
    onBeforeUnmount,
    type ComputedRef,
    type WritableComputedRef,
} from 'vue';
import {
    publishFacetSelection,
    selectedConceptIds,
    type EzClassifyFacetSelectionInput,
} from '@ezclassify/ui';
import type { Suggestion, ValidationError } from '@ezclassify/types';
import { VueRefStoreKey } from './vue-ref-store';

export interface UseEzClassifyFacetReturn {
    /** Bind directly with `v-model`. */
    value: WritableComputedRef<string[]>;
    /** Pass directly to `:options`. */
    options: ComputedRef<Suggestion[]>;
    rendered: ComputedRef<string>;
    valid: ComputedRef<boolean>;
    errors: ComputedRef<ValidationError[]>;
    loading: ComputedRef<boolean>;
    setValue: (next: readonly EzClassifyFacetSelectionInput[]) => void;
}

/**
 * `v-model` adapter for PrimeVue, Vuetify, Quasar, and custom Vue controls.
 *
 * Nothing here mirrors store state. Every returned ref is a `computed` over the
 * store's own cells: `options` and `loading` read the facet ref, the other four
 * read the marking ref, and the store is the single place that decides what
 * either one holds. Selection changes use the shared publisher in
 * `@ezclassify/ui`; one facet subscription keeps the native ref current.
 *
 * @param markingId - The marking this field is one facet of.
 * @param categoryId - The category this field controls.
 * @returns Refs for the field plus its change callback.
 */
export function useEzClassifyFacet(
    markingId: string,
    categoryId: string,
): UseEzClassifyFacetReturn {
    const store = inject(VueRefStoreKey);
    if (!store) {
        throw new Error(
            '[ezclassify/vue] useEzClassifyFacet requires useEzClassify() higher in the tree, or provideEzClassify({ engine }) at the app root',
        );
    }

    // The store writes the native ref before notifying listeners. This
    // subscription retains computation; computed refs read the cell directly.
    const unsubscribe = store.subscribeFacet(markingId, categoryId, () => {});
    const source = { token: {} };
    let destroyed = false;
    const facet = store.facetRef(markingId, categoryId);
    const marking = store.refFor(markingId);

    const setValue = (next: readonly EzClassifyFacetSelectionInput[]): void => {
        if (destroyed) return;
        void publishFacetSelection(store, markingId, categoryId, next, source);
    };

    onBeforeUnmount(() => {
        destroyed = true;
        unsubscribe();
    });

    return {
        value: computed<string[]>({
            get: () => selectedConceptIds(marking.value.assertions, categoryId),
            set: setValue,
        }),
        options: computed(() => facet.value.allowableOptions ?? []),
        rendered: computed(() => marking.value.rendered),
        valid: computed(() => marking.value.valid),
        errors: computed(() => marking.value.errors),
        loading: computed(() => facet.value.allowableOptions === null),
        setValue,
    };
}
