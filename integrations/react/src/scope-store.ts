/**
 * The store an `<EzClassify>` root builds and owns when the application does
 * not pass one.
 */

import { useEffect, useReducer, useRef } from 'react';
import { contextStoreBuckets, isContextAdapter } from '@ezclassify/ui';
import { ReactEzClassifyStore } from './react-ezclassify-store';
import type { EzClassifySource } from './use-stable-source';

/** What a subscription to a released root store returns. */
const releaseNothing = (): void => {};

/**
 * A root-owned store. Once released it takes no new listener, quietly, where
 * any other store throws. React runs a child's effects before its parent's, so
 * when a root rebuilds the store an `<Activity>` released while it hid the
 * tree, the children subscribe to the old store first. Their listeners would
 * never fire, and the root's re-render moves them onto the new store.
 * Publishing to it still rejects. A store the application passes in is its own,
 * and its use after destroy still fails loudly.
 */
export class ScopeStore extends ReactEzClassifyStore {
    /** Whether this store has been destroyed. */
    get released(): boolean {
        return this.destroyed;
    }

    override subscribe(
        ...args: Parameters<ReactEzClassifyStore['subscribe']>
    ): () => void {
        if (this.destroyed) return releaseNothing;
        return super.subscribe(...args);
    }

    override subscribeAggregate(
        ...args: Parameters<ReactEzClassifyStore['subscribeAggregate']>
    ): () => void {
        if (this.destroyed) return releaseNothing;
        return super.subscribeAggregate(...args);
    }

    override subscribeFacet(
        ...args: Parameters<ReactEzClassifyStore['subscribeFacet']>
    ): () => void {
        if (this.destroyed) return releaseNothing;
        return super.subscribeFacet(...args);
    }
}

/**
 * Build a root's store over the Contexts its `EzClassifyUI` reads. One Context
 * is the store's sole bucket, read by that Context's scheme; several are read
 * per bucket, resolved the way the runtime resolves them.
 */
function buildStore(
    source: EzClassifySource,
    format: string | undefined,
): ScopeStore {
    if (isContextAdapter(source)) {
        return new ScopeStore(source.scheme, format ? { format } : undefined);
    }
    return new ScopeStore({ buckets: contextStoreBuckets(source, { format }) });
}

/** What a root holds so it can rebuild its own store. */
interface OwnedStore {
    source: EzClassifySource;
    format: string | undefined;
    store: ScopeStore;
    /** Whether the effect that owns this store is currently mounted. */
    mounted: boolean;
    /** Set once the store has been destroyed. */
    disposed: boolean;
}

/**
 * Build and own a root's store, rebuilding it only when the source or the
 * format changes, and destroying it when the root unmounts.
 *
 * The store is built during render so the root's children can bind to it on
 * their first pass, before the runtime scans them.
 *
 * An effect cleanup cannot destroy the store on the spot. StrictMode runs an
 * effect's setup, then its cleanup, then the setup again against the same
 * committed render, and the children's effects run their second setup before
 * this one does. A store destroyed by the first cleanup would be handed to
 * every child that subscribes in between. So the cleanup destroys the store
 * only once the commit it ran in has finished and the setup has not come back.
 *
 * The setup can still come back later: an `<Activity>` that hides the tree
 * cleans its effects up and keeps its state, then runs them again when it is
 * shown. By then the store is gone, so the setup builds a new one and
 * re-renders the tree onto it.
 *
 * @param source - The root's source, or `null` when the application passed its
 *   own store.
 * @param format - The render format the store writes markings in.
 * @returns The owned store, or `null` when the root owns none.
 */
export function useScopeStore(
    source: EzClassifySource | null,
    format: string | undefined,
): ScopeStore | null {
    const held = useRef<OwnedStore | null>(null);
    const [, rebuilt] = useReducer((count: number) => count + 1, 0);

    if (!source) {
        held.current = null;
    } else if (
        !held.current ||
        held.current.source !== source ||
        held.current.format !== format
    ) {
        held.current = {
            source,
            format,
            store: buildStore(source, format),
            mounted: false,
            disposed: false,
        };
    }
    const store = held.current?.store ?? null;

    useEffect(() => {
        const entry = held.current;
        if (!entry || !store) return;
        if (entry.disposed) {
            held.current = {
                ...entry,
                store: buildStore(entry.source, entry.format),
                disposed: false,
            };
            rebuilt();
            return;
        }
        entry.mounted = true;
        return () => {
            entry.mounted = false;
            queueMicrotask(() => {
                if (entry.mounted) return;
                entry.disposed = true;
                entry.store.destroy();
            });
        };
    }, [store]);

    return store;
}
