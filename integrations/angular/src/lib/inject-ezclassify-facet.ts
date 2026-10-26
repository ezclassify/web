import {
    DestroyRef,
    computed,
    effect,
    inject,
    signal,
    untracked,
    type Signal,
} from '@angular/core';
import {
    EMPTY_EZCLASSIFY_STATE,
    EMPTY_FACET_STATE,
    publishFacetSelection,
    selectedConceptIds,
    type EzClassifyFacetSelectionInput,
    type EzClassifyState,
    type EzClassifyStore,
    type FacetState,
} from '@ezclassify/ui';
import type { Suggestion, ValidationError } from '@ezclassify/types';
import {
    EZCLASSIFY_STORE,
    EZCLASSIFY_STORE_SIGNAL,
    requireSignalBackedStore,
    type SignalBackedEzClassifyStore,
} from './angular-signal-store';

export interface InjectEzClassifyFacetReturn {
    value: Signal<string[]>;
    options: Signal<Suggestion[]>;
    rendered: Signal<string>;
    valid: Signal<boolean>;
    errors: Signal<ValidationError[]>;
    loading: Signal<boolean>;
    setValue(next: readonly EzClassifyFacetSelectionInput[]): void;
}

/**
 * Signal adapter for Angular Material and other controlled Angular fields.
 *
 * Use the returned signals with the component library's ordinary `[value]` and
 * change output. Initialization and teardown follow the surrounding
 * `[ezClassify]` directive, or the app-level `provideEzClassify()`, whichever
 * is in scope.
 *
 * Nothing here mirrors store state. Every signal is a `computed` projection
 * over the store's own cells: `options` and `loading` read the facet cell, the
 * other four read the marking cell, and the store is the single place that
 * decides what either one holds. Selection changes use the shared publisher in
 * `@ezclassify/ui`; one facet subscription keeps the native cell current.
 *
 * The engine may not exist yet. A component is constructed during its host's
 * create pass, before `[ezClassify]` has applied, and an engine fetched over
 * the wire arrives later still. This arms itself from the scope's store signal,
 * so a late engine, or a rebuild on a changed engine, re-binds the facet
 * instead of leaving it stuck on its initial values.
 *
 * @param markingId - The marking this field is one facet of.
 * @param categoryId - The category this field controls.
 * @returns Read-only signals for the field plus its change callback.
 */
export function injectEzClassifyFacet(
    markingId: string,
    categoryId: string,
): InjectEzClassifyFacetReturn {
    const storeSignal = injectStoreSignal();
    const destroyRef = inject(DestroyRef);

    // The store the facet projects, derived rather than assigned. `null` means
    // the scope has no store yet, which is the ordinary state before an engine
    // arrives. A store that is present but cannot be projected is a different
    // thing entirely, and it says so: see requireSignalBackedStore.
    //
    // Deriving it also keeps the effect below free of signal writes, which
    // Angular forbids inside an effect before v19.
    const bound = computed<SignalBackedEzClassifyStore | null>(() => {
        const store = storeSignal();
        if (!store) return null;
        return requireSignalBackedStore(
            store,
            `injectEzClassifyFacet('${markingId}', '${categoryId}')`,
        );
    });
    let activeStore: SignalBackedEzClassifyStore | undefined;
    const source = { token: {} };
    let unsubscribe: (() => void) | undefined;
    let pendingValue: readonly EzClassifyFacetSelectionInput[] | undefined;
    let destroyed = false;

    const release = (): void => {
        unsubscribe?.();
        unsubscribe = undefined;
        activeStore = undefined;
    };

    effect(() => {
        const store = bound();
        // Subscription replay and pending writes can read or update native
        // cells. Track only the store identity so commits do not rebind it.
        untracked(() => {
            if (destroyed) return;
            release();
            if (!store) return;
            activeStore = store;
            // The store writes its signal before notifying listeners; retaining
            // this subscription keeps computation live without a snapshot layer.
            unsubscribe = store.subscribeFacet(markingId, categoryId, () => {});
            if (pendingValue) {
                void publishFacetSelection(
                    store,
                    markingId,
                    categoryId,
                    pendingValue,
                    source,
                );
                pendingValue = undefined;
            }
        });
    });

    destroyRef.onDestroy(() => {
        destroyed = true;
        release();
    });

    const facet = computed<FacetState>(() => {
        const store = bound();
        return store
            ? store.facetSignalRef(markingId, categoryId)()
            : EMPTY_FACET_STATE;
    });
    const marking = computed<EzClassifyState>(() => {
        const store = bound();
        return store ? store.signalFor(markingId)() : EMPTY_EZCLASSIFY_STATE;
    });

    return {
        value: computed(() =>
            selectedConceptIds(marking().assertions, categoryId),
        ),
        options: computed(() => facet().allowableOptions ?? []),
        rendered: computed(() => marking().rendered),
        valid: computed(() => marking().valid),
        errors: computed(() => marking().errors),
        loading: computed(() => facet().allowableOptions === null),
        setValue(next) {
            if (destroyed) return;
            if (activeStore) {
                void publishFacetSelection(
                    activeStore,
                    markingId,
                    categoryId,
                    next,
                    source,
                );
            } else {
                pendingValue = next;
            }
        },
    };
}

/**
 * The scope's store as a signal.
 *
 * `provideEzClassify()` and `EzClassifyDirective` both supply
 * {@link EZCLASSIFY_STORE_SIGNAL}. An application that wires
 * {@link EZCLASSIFY_STORE} by hand, which the package has always supported,
 * supplies only the store; read that as a store that is already there and will
 * not change. Neither one present is a wiring mistake, and the injector says so
 * in its own words.
 *
 * @returns The scope's store, `null` while it has none.
 */
function injectStoreSignal(): Signal<EzClassifyStore | null> {
    const provided = inject(EZCLASSIFY_STORE_SIGNAL, { optional: true });
    if (provided) return provided;
    return signal(inject(EZCLASSIFY_STORE)).asReadonly();
}
