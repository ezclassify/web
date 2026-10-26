/**
 * `useEzClassify(id)`: the per-marking binding hook. Returns the current
 * `EzClassifyState` and a publisher that writes the rendered-side string back
 * through the store. Tracks subscriptions via `useSyncExternalStore` so
 * concurrent rendering stays consistent.
 *
 * Pulls the active `ReactEzClassifyStore` from `EzClassifyStoreContext`, which
 * is provided either by `EzClassifyProvider` or by an explicit
 * `<EzClassifyStoreProvider store={…}>` wrapping the subtree. Per
 * binding-model.md §8, the store IS the framework's view of state; no bridge,
 * no mirroring.
 *
 * Cycle protection: every call to this hook installs a stable per-component
 * `PublishSource` token. When `setRendered` publishes, the store's commit skips
 * the listener registered under the same token; so the component that just
 * wrote doesn't get an extra re-render echoing its own value.
 */

import {
    createContext,
    useCallback,
    useContext,
    useMemo,
    useRef,
    useSyncExternalStore,
    type ReactNode,
} from 'react';
import type { Assertion } from '@ezclassify/types';
import {
    EMPTY_EZCLASSIFY_STATE,
    reportPublishFailure,
    type EzClassifyState,
    type PublishSource,
} from '@ezclassify/ui';
import { ReactEzClassifyStore } from './react-ezclassify-store';

const EzClassifyStoreContext = createContext<ReactEzClassifyStore | null>(null);

export function EzClassifyStoreProvider({
    store,
    children,
}: {
    store: ReactEzClassifyStore;
    children: ReactNode;
}) {
    return (
        <EzClassifyStoreContext.Provider value={store}>
            {children}
        </EzClassifyStoreContext.Provider>
    );
}

/**
 * Read the active store without subscribing. Throws when no provider sits
 * above.
 */
export function useEzClassifyStore(): ReactEzClassifyStore {
    const store = useContext(EzClassifyStoreContext);
    if (!store) {
        throw new Error(
            '[ezclassify/react] useEzClassifyStore must be used under <EzClassifyStoreProvider>',
        );
    }
    return store;
}

export type SetRendered = (next: string) => void;
export type SetAssertions = (next: Assertion[]) => void;

/**
 * Binding hook. `useEzClassify(id)` subscribes the component to marking `id`
 * and returns `[state, setRendered]`. The setter publishes the new rendered
 * string through the store; the engine round-trips it to assertions, the store
 * commits, and every other subscriber sees the new state. The component that
 * called `setRendered` is skipped on the commit.
 */
export function useEzClassify(id: string): [EzClassifyState, SetRendered] {
    const store = useEzClassifyStore();

    // Stable per-component identity for cycle protection. `useRef` guarantees
    // the same object lives across renders for this component instance.
    const tokenRef = useRef<object | null>(null);
    if (!tokenRef.current) tokenRef.current = {};
    const source: PublishSource = useMemo(
        () => ({ token: tokenRef.current }),
        [],
    );

    const subscribe = useCallback(
        (notify: () => void) => store.subscribe(id, notify, source),
        [store, id, source],
    );
    const getSnapshot = useCallback(() => store.get(id), [store, id]);
    // SSR fallback: `EMPTY_EZCLASSIFY_STATE` is a frozen object identical across
    // renders so React's hydration won't trip on a stale snapshot.
    const getServerSnapshot = useCallback(() => EMPTY_EZCLASSIFY_STATE, []);
    const state = useSyncExternalStore(
        subscribe,
        getSnapshot,
        getServerSnapshot,
    );

    const setRendered = useCallback<SetRendered>(
        (next: string) => {
            store
                .publishRendered(id, next, source)
                .catch((error: unknown) =>
                    reportPublishFailure('useEzClassify', id, error),
                );
        },
        [store, id, source],
    );

    return [state, setRendered];
}

/**
 * Companion to `useEzClassify` for assertion-driven schemes. Same store, same
 * cycle protection; the setter publishes through the assertion side.
 */
export function useEzClassifyAssertions(
    id: string,
): [EzClassifyState, SetAssertions] {
    const store = useEzClassifyStore();
    const tokenRef = useRef<object | null>(null);
    if (!tokenRef.current) tokenRef.current = {};
    const source: PublishSource = useMemo(
        () => ({ token: tokenRef.current }),
        [],
    );

    const subscribe = useCallback(
        (notify: () => void) => store.subscribe(id, notify, source),
        [store, id, source],
    );
    const getSnapshot = useCallback(() => store.get(id), [store, id]);
    const getServerSnapshot = useCallback(() => EMPTY_EZCLASSIFY_STATE, []);
    const state = useSyncExternalStore(
        subscribe,
        getSnapshot,
        getServerSnapshot,
    );

    const setAssertions = useCallback<SetAssertions>(
        (next: Assertion[]) => {
            store
                .publishAssertions(id, next, source)
                .catch((error: unknown) =>
                    reportPublishFailure('useEzClassifyAssertions', id, error),
                );
        },
        [store, id, source],
    );

    return [state, setAssertions];
}
