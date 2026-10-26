/**
 * React marking controls for a connected EzClassify REST client.
 *
 * Create one client during application initialization and share it through your
 * application's React context. A feature retrieves that client and calls
 * `useSchemeEngine(client)`, attaching the returned ref to its container. The
 * hook owns the feature's UI scanner and binding store, not the client.
 * Unmounting a feature leaves the shared client available to other features.
 * The application destroys the client only at application/session teardown.
 *
 * The package README contains a complete connected-client mount example.
 * `EzClassifyProvider` optionally shares marking state and UI defaults as well;
 * it is not required merely to share a network client.
 */

import {
    createElement,
    useCallback,
    useEffect,
    useRef,
    useState,
    type ReactNode,
    type RefObject,
} from 'react';
import {
    EzClassifyUI,
    isEngineContext,
    mergeProvisionOptions,
} from '@ezclassify/ui';
import type { EngineArg } from '@ezclassify/ui';
import { ReactEzClassifyStore } from './react-ezclassify-store';
import { useEzClassifyProvision } from './EzClassifyProvider';
import { EzClassifyStoreProvider } from './useEzClassify';
import type { UseSchemeEngineOptions } from './scheme-engine-options';
import { useStableEngineArg } from './useStableEngineArg';

/** Return value from useSchemeEngine. */
export interface UseSchemeEngineReturn {
    /** The EzClassifyUI instance, or null while the engine is loading. */
    forms: EzClassifyUI | null;
    /**
     * Ref to attach to your container element. All EzClassify DOM is scoped
     * inside it.
     */
    ref: RefObject<HTMLDivElement | null>;
    /**
     * The binding store created for this hook instance, or null before the
     * engine is ready. Children that call `useEzClassify(id)` need a
     * `<EzClassifyStoreProvider>` above them; `Container` does this
     * automatically.
     */
    store: ReactEzClassifyStore | null;
    /**
     * Convenience wrapper that mounts the ref'd container and provides the
     * store to descendants in one step. Equivalent to: <EzClassifyStoreProvider
     * store={store}> <div ref={ref}>{children}</div>
     * </EzClassifyStoreProvider>
     */
    Container: (props: { children?: ReactNode }) => ReactNode;
}

/**
 * Initialize the EzClassify forms library for the current React tree.
 *
 * Returns a `ref` that you place on a container element: all EzClassify DOM
 * (dropdowns, tooltips, rollup inputs) stays scoped inside it. The hook
 * auto-enhances any element with `data-ezclassify-*` attributes inside the
 * container, and tears down cleanly on unmount.
 *
 * Pass the application's connected REST client as `engine`. With an optional
 * `EzClassifyProvider` above, omitting it reuses that scope's client and store;
 * supplying it creates a local store for this hook. Options merge over any
 * inherited presentation defaults, key by key. They configure UI presentation,
 * not the network client or policy engine.
 *
 * @param engine - Connected REST client, or omitted to inherit provision.
 * @param options - Presentation options for this UI scope.
 * @returns The scanner instance, the container ref and wrapper, and the store
 *   descendants bind to.
 */
export function useSchemeEngine(
    engine?: EngineArg,
    options?: UseSchemeEngineOptions,
): UseSchemeEngineReturn {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const [forms, setForms] = useState<EzClassifyUI | null>(null);
    const [owned, setOwned] = useState<{
        engine: EngineArg;
        format: string | undefined;
        store: ReactEzClassifyStore;
    } | null>(null);
    const provision = useEzClassifyProvision();

    // An engine argument overrides app-level provision for this subtree; without
    // one the hook drives the app's engine and reuses the app's store rather
    // than standing up a second store over the same runtime.
    const override = engine ?? null;
    const stableOverride = useStableEngineArg(override);
    const stableProvided = useStableEngineArg(provision?.engine ?? null);
    const stableEngine = stableOverride ?? stableProvided;
    const inheritedStore = override ? null : (provision?.store ?? null);
    const merged = useMergedOptions(provision?.options, options);

    useEffect(() => {
        if (!stableEngine || inheritedStore) {
            setOwned(null);
            return;
        }
        const schemeAdapter = isEngineContext(stableEngine)
            ? stableEngine.scheme
            : stableEngine;
        const store = new ReactEzClassifyStore(schemeAdapter, {
            format: merged.format,
        });
        setOwned({ engine: stableEngine, format: merged.format, store });
        return () => store.destroy();
    }, [stableEngine, inheritedStore, merged.format]);

    const store =
        inheritedStore ??
        (owned?.engine === stableEngine && owned.format === merged.format
            ? owned.store
            : null);

    // Initialize after the store's provider and children have committed. An
    // override creates its store in the preceding effect, so scanning during
    // that effect would find an empty container.
    useEffect(() => {
        if (!stableEngine || !store || !containerRef.current) {
            setForms(null);
            return;
        }
        let instance: EzClassifyUI | null = null;
        try {
            instance = new EzClassifyUI(stableEngine, {
                root: containerRef.current,
                rollupId: merged.rollupId,
                format: merged.format,
                colorMap: merged.colorMap,
                tooltipConceptProperty: merged.tooltipConceptProperty,
                favorites: merged.favorites,
                store,
            });
            setForms(instance);
        } catch (err) {
            console.error('[useSchemeEngine] Failed to initialize forms:', err);
            setForms(null);
        }
        return () => {
            instance?.destroy();
            setForms(null);
        };
    }, [
        stableEngine,
        store,
        merged.colorMap,
        merged.favorites,
        merged.format,
        merged.rollupId,
        merged.tooltipConceptProperty,
    ]);

    // React preserves the scanned subtree while this binding store is stable.
    const Container = useCallback(
        ({ children }: { children?: ReactNode }) => {
            // Descendants may call store-backed hooks such as
            // useEzClassifyFacet. Hold them until the provider exists so
            // applications do not need their own `store && ...` guard.
            const tree = createElement(
                'div',
                { ref: containerRef },
                store ? children : null,
            );
            return store
                ? createElement(EzClassifyStoreProvider, {
                      store,
                      children: tree,
                  })
                : tree;
        },
        [store],
    );

    return { forms, ref: containerRef, store, Container };
}

/**
 * The shared provision merge, held at a stable identity while both inputs are
 * unchanged so the init effect does not re-run on every render.
 *
 * @param defaults - App-level options from `<EzClassifyProvider>`, if any.
 * @param overrides - Options passed to this `useSchemeEngine` call, if any.
 * @returns The options in force for this call.
 */
function useMergedOptions(
    defaults: UseSchemeEngineOptions | undefined,
    overrides: UseSchemeEngineOptions | undefined,
): UseSchemeEngineOptions {
    const held = useRef<{
        defaults: UseSchemeEngineOptions | undefined;
        overrides: UseSchemeEngineOptions | undefined;
        merged: UseSchemeEngineOptions;
    } | null>(null);
    if (
        !held.current ||
        held.current.defaults !== defaults ||
        held.current.overrides !== overrides
    ) {
        held.current = {
            defaults,
            overrides,
            merged: mergeProvisionOptions(defaults, overrides),
        };
    }
    return held.current.merged;
}

export type { UseSchemeEngineOptions } from './scheme-engine-options';
export {
    EzClassifyProvider,
    useEzClassifyProvision,
} from './EzClassifyProvider';
export type {
    EzClassifyProviderProps,
    EzClassifyProvision,
} from './EzClassifyProvider';
export { ReactEzClassifyStore } from './react-ezclassify-store';
export type { ReactEzClassifyStoreOptions } from './react-ezclassify-store';
export {
    EzClassifyStoreProvider,
    useEzClassify,
    useEzClassifyAssertions,
    useEzClassifyStore,
} from './useEzClassify';
export type { SetRendered, SetAssertions } from './useEzClassify';
export { useEzClassifyFacet } from './useEzClassifyFacet';
export type { UseEzClassifyFacetReturn } from './useEzClassifyFacet';
export { useEzClassifyObject } from './useEzClassifyObject';
export type { UseEzClassifyObjectResult } from './useEzClassifyObject';
export { useEzClassifyRollup } from './useEzClassifyRollup';
export { ContextReference, ContextReferenceTab } from './ContextReference';
export type {
    ContextReferenceProps,
    ContextReferenceTabProps,
} from './ContextReference';
