/**
 * Vue 3 marking controls for a connected EzClassify REST client.
 *
 * Create one client during application initialization and share it through
 * Vue's provide/inject graph. A feature retrieves that same client and calls
 * `useEzClassify(clientRef, { root: featureElement })` during setup, with an
 * actual HTMLElement bounding its scanner. The composable owns its scanner and
 * local store; unmounting it does not destroy the shared client.
 *
 * `useEzClassify(id)` instead binds a marking through an ancestor store.
 * `provideEzClassify` optionally shares marking state and presentation
 * defaults; it is not needed merely to share the network client. See the
 * package README for complete initialization, injection, mounting, and
 * teardown.
 */

import {
    computed,
    inject,
    onBeforeUnmount,
    onMounted,
    provide,
    shallowRef,
    watch,
    type Ref,
    type ShallowRef,
    type WritableComputedRef,
} from 'vue';
import {
    EzClassifyUI,
    contextSignature,
    isEngineContext,
    mergeProvisionOptions,
    reportPublishFailure,
    sameSignature,
} from '@ezclassify/ui';
import type { Assertion, EzClassifyState } from '@ezclassify/ui';
import { VueRefStore, VueRefStoreKey } from './composables/vue-ref-store';
import {
    useEzClassifyProvision,
    type EzClassifyEngine,
    type EzClassifyOptions,
} from './composables/provide-ezclassify';

/**
 * Options forwarded to EzClassifyUI. Alias of the app-level
 * {@link EzClassifyOptions}: the per-call argument is an override of the same
 * shape `provideEzClassify` sets.
 */
export type UseEzClassifyOptions = EzClassifyOptions;

/** Return value from useEzClassify(engine, options). */
export interface UseEzClassifyReturn {
    forms: ShallowRef<EzClassifyUI | null>;
    store: ShallowRef<VueRefStore | null>;
}

type EzClassifyEngineInput = EzClassifyEngine | Ref<EzClassifyEngine | null>;

export function useEzClassify(
    engine?: EzClassifyEngineInput | null,
    options?: UseEzClassifyOptions,
): UseEzClassifyReturn;
export function useEzClassify(id: string): WritableComputedRef<string>;
export function useEzClassify(
    arg?: string | EzClassifyEngineInput | null,
    options?: UseEzClassifyOptions,
): UseEzClassifyReturn | WritableComputedRef<string> {
    if (typeof arg === 'string') return useMarkingBinding(arg);
    return useEzClassifyInit(arg ?? null, options);
}

/**
 * Assertion-side companion. Read or write the `Assertion[]` slice of the
 * marking, useful for tag-picker / checklist components that produce a list of
 * concept selections rather than a rendered string.
 */
export function useEzClassifyAssertions(
    id: string,
): WritableComputedRef<Assertion[]> {
    const store = inject(VueRefStoreKey);
    if (!store) {
        throw new Error(
            '[ezclassify/vue] useEzClassifyAssertions(id) requires useEzClassify() higher in the tree, or provideEzClassify({ engine }) at the app root',
        );
    }
    const token = {};
    const stateRef = store.refFor(id);
    return computed<Assertion[]>({
        get: () => stateRef.value.assertions,
        set: (next) => {
            store
                .publishAssertions(id, next, { token })
                .catch((error: unknown) =>
                    reportPublishFailure('useEzClassifyAssertions', id, error),
                );
        },
    });
}

/**
 * Read-only access to the per-marking state for components that need the full
 * shape.
 */
export function useEzClassifyState(id: string): Readonly<Ref<EzClassifyState>> {
    const store = inject(VueRefStoreKey);
    if (!store) {
        throw new Error(
            '[ezclassify/vue] useEzClassifyState(id) requires useEzClassify() higher in the tree, or provideEzClassify({ engine }) at the app root',
        );
    }
    return store.refFor(id);
}

function useMarkingBinding(id: string): WritableComputedRef<string> {
    const store = inject(VueRefStoreKey);
    if (!store) {
        throw new Error(
            '[ezclassify/vue] useEzClassify(id) requires useEzClassify() higher in the tree, or provideEzClassify({ engine }) at the app root',
        );
    }
    // Stable token tied to this composable invocation. Publish writes carry it
    // so any store-level subscribers registered with the same token (none in
    // the default Vue path, but external test/wiring code might) skip the
    // self-echo. The computed itself depends on the ref directly, so Vue's
    // reactivity handles the read-side without an extra listener.
    const token = {};
    const stateRef = store.refFor(id);
    return computed<string>({
        get: () => stateRef.value.rendered,
        set: (next) => {
            store
                .publishRendered(id, next, { token })
                .catch((error: unknown) =>
                    reportPublishFailure('useEzClassify', id, error),
                );
        },
    });
}

function useEzClassifyInit(
    engine: EzClassifyEngineInput | null,
    options?: UseEzClassifyOptions,
): UseEzClassifyReturn {
    const forms = shallowRef<EzClassifyUI | null>(null);
    const store = shallowRef<VueRefStore | null>(null);
    const provision = useEzClassifyProvision();
    // An engine argument overrides app-level provision for this subtree; without
    // one the composable drives the app's engine, and binds the app's store when
    // it has one rather than standing up a second store over the same runtime.
    const source: EzClassifyEngineInput | null =
        engine ?? provision?.engine ?? null;
    const inheritedStore = engine ? undefined : provision?.store;
    const opts: UseEzClassifyOptions = mergeProvisionOptions(
        provision?.options,
        options,
    );
    // A store handed down by the app is not this composable's to build or
    // destroy; only a subtree that overrode the engine owns one.
    let ownsStore = false;
    // The engine the current store was built for. Descendants bind to the store
    // during setup, before `onMounted` runs `init()`, so `init()` keeps the
    // store whenever the engine is unchanged; replacing it would orphan every
    // facet a child already subscribed.
    let storeEngine: EzClassifyEngine | null = null;

    function releaseStore(): void {
        if (ownsStore) store.value?.destroy();
        ownsStore = false;
        store.value = null;
        storeEngine = null;
    }

    function buildStore(eng: EzClassifyEngine): VueRefStore {
        storeEngine = eng;
        if (inheritedStore) {
            ownsStore = false;
            return inheritedStore;
        }
        ownsStore = true;
        // The store needs the scheme surface; EzClassifyUI takes the context
        // whole (scheme + guide + access): same split as @ezclassify/react.
        const schemeAdapter = isEngineContext(eng) ? eng.scheme : eng;
        return new VueRefStore(schemeAdapter, { format: opts.format });
    }

    function init(eng: EzClassifyEngine | null) {
        if (forms.value) {
            forms.value.destroy();
            forms.value = null;
        }
        const keepStore =
            eng !== null &&
            store.value !== null &&
            sameSignature(contextSignature(storeEngine), contextSignature(eng));
        if (!keepStore) releaseStore();
        if (!eng) return;

        const root =
            opts.root ?? document.getElementById('app') ?? document.body;
        const activeStore = keepStore ? store.value! : buildStore(eng);
        store.value = activeStore;
        forms.value = new EzClassifyUI(eng, {
            root,
            rollupId: opts.rollupId,
            format: opts.format,
            colorMap: opts.colorMap,
            tooltipConceptProperty: opts.tooltipConceptProperty,
            favorites: opts.favorites,
            store: activeStore,
        });
    }

    // Provide the store to descendants synchronously during setup. Mounting
    // EzClassifyUI is deferred to `onMounted` (it needs the DOM), but the
    // store has no DOM dependency; give children a usable store right away.
    const initialEngine: EzClassifyEngine | null = isRefLike(source)
        ? source.value
        : source;
    if (initialEngine) {
        store.value = buildStore(initialEngine);
    }
    provide(
        VueRefStoreKey,
        new Proxy({} as VueRefStore, {
            get(_, prop) {
                const s = store.value;
                if (!s)
                    throw new Error(
                        '[ezclassify/vue] store accessed before an engine was available. Call provideEzClassify({ engine }) at the app root, or pass an engine to useEzClassify().',
                    );
                const value = Reflect.get(s as object, prop);
                return typeof value === 'function' ? value.bind(s) : value;
            },
        }),
    );

    onMounted(() => {
        const eng = isRefLike(source) ? source.value : source;
        init(eng);
    });

    if (isRefLike(source)) {
        // Re-init when the engine ref changes. Vue's `watch` keys on the ref's
        // value identity, so a consumer who hands us a *new* Context wrapper around
        // the same underlying engine would, naively, trigger a full teardown+rebuild
        // (dropping per-marking store state and re-running the scanner). Gate the
        // watch on the engine's structural signature, the shared, framework-agnostic
        // definition of "did the engine actually change?"; so a wrapper-only change
        // is a no-op, matching React's `useStableEngineArg`. See
        // libs/ui/src/engine-signature.ts.
        //
        // Limit (see engine-signature.ts): a Context built inline from freshly
        // constructed child engines on every pass still yields new component
        // identities and re-inits; memoizing the child engine stays the consumer's
        // job. This only suppresses wrapper-only churn.
        let prevSig = contextSignature(initialEngine);
        watch(source, (eng) => {
            const nextSig = contextSignature(eng ?? null);
            if (sameSignature(prevSig, nextSig)) return;
            prevSig = nextSig;
            init(eng);
        });
    }

    onBeforeUnmount(() => {
        forms.value?.destroy();
        forms.value = null;
        releaseStore();
    });

    return { forms, store };
}

function isRefLike(value: unknown): value is Ref<EzClassifyEngine | null> {
    return !!value && typeof value === 'object' && 'value' in (value as object);
}

export {
    provideEzClassify,
    useEzClassifyProvision,
    EzClassifyProvisionKey,
} from './composables/provide-ezclassify';
export type {
    EzClassifyEngine,
    EzClassifyOptions,
    EzClassifyProvision,
} from './composables/provide-ezclassify';
export { bindEzClassifyToReactiveDoc } from './composables/bindEzClassifyToReactiveDoc';
export type { VueReactiveDoc } from './composables/bindEzClassifyToReactiveDoc';
export { useEzClassifyFacet } from './composables/useEzClassifyFacet';
export type { UseEzClassifyFacetReturn } from './composables/useEzClassifyFacet';
export { VueRefStore, VueRefStoreKey } from './composables/vue-ref-store';
export type { VueRefStoreOptions } from './composables/vue-ref-store';
export { ContextReference, ContextReferenceTab } from './ContextReference';
