/**
 * Optional shared marking-state provision for `@ezclassify/react`.
 *
 * The application supplies its connected REST client through the public
 * `engine` prop. This provider additionally builds and shares a binding store
 * and optional presentation defaults. Use ordinary React context when only the
 * client should be shared and each feature should own its marking state.
 *
 * A supplied store remains caller-owned. A store created here is destroyed with
 * this provider. The connected client is never constructed or destroyed here.
 * Provision is scoped to this React tree, not module state.
 */

import {
    createContext,
    createElement,
    useContext,
    useEffect,
    useMemo,
    useReducer,
    useRef,
    type ReactNode,
} from 'react';
import {
    contextSignature,
    isEngineContext,
    sameSignature,
} from '@ezclassify/ui';
import type {
    ContextAdapter,
    EzClassifyState,
    FacetState,
    PublishSource,
    RemoteContextSchemeEngineAdapter,
    SchemeEngineAdapter,
} from '@ezclassify/ui';
import { ReactEzClassifyStore } from './react-ezclassify-store';
import { EzClassifyStoreProvider } from './useEzClassify';
import type { UseSchemeEngineOptions } from './scheme-engine-options';
import { useStableEngineArg } from './useStableEngineArg';
import type { EngineArg } from '@ezclassify/ui';

/** The application-level defaults every binding below the provider inherits. */
export interface EzClassifyProvision {
    /**
     * The default engine, or `null` when the provider was given a store
     * instead.
     */
    engine:
        | SchemeEngineAdapter
        | RemoteContextSchemeEngineAdapter
        | ContextAdapter
        | null;
    /** Presentation defaults, overridden per call. */
    options: UseSchemeEngineOptions;
    /**
     * The store bindings default to. Present whenever the provider was given an
     * engine or a store; `useSchemeEngine` with no engine override binds to it
     * rather than building a second store over the same engine.
     */
    store: ReactEzClassifyStore | null;
}

const EzClassifyProvisionContext = createContext<EzClassifyProvision | null>(
    null,
);

/** Props accepted by {@link EzClassifyProvider}. */
export interface EzClassifyProviderProps {
    /**
     * Connected REST client for this scope. The public prop retains its
     * `engine` name. Ignored when `store` is supplied.
     */
    engine?: EngineArg;
    /**
     * A store the application already owns. Takes precedence over `engine`, and
     * is NOT destroyed when the provider unmounts: whoever created it owns its
     * lifetime.
     */
    store?: ReactEzClassifyStore | null;
    /** Presentation defaults for every binding below this provider. */
    options?: UseSchemeEngineOptions;
    children?: ReactNode;
}

/**
 * Share a client-backed marking store and optional presentation defaults with
 * descendants. A descendant still calls `useSchemeEngine()` to mount controls.
 * No render format is required; omitted formats use the Context default. The
 * application retains client ownership. For a complete client-only sharing and
 * mounting example, see the package README.
 */
export function EzClassifyProvider({
    engine,
    store,
    options,
    children,
}: EzClassifyProviderProps): ReactNode {
    // Same stabilization the hook applies to its own argument: a context
    // composed inline in the root render is a fresh wrapper every pass, and
    // rebuilding the app-level store on each of them would drop every binding.
    const stableEngine = useStableEngineArg(engine ?? null);
    const ownedStore = useOwnedStore(store ? null : stableEngine, options);
    const resolvedStore = store ?? ownedStore;
    const provision = useMemo<EzClassifyProvision>(
        () => ({
            engine: stableEngine,
            options: options ?? EMPTY_OPTIONS,
            store: resolvedStore,
        }),
        [stableEngine, options, resolvedStore],
    );
    const tree = createElement(
        EzClassifyProvisionContext.Provider,
        { value: provision },
        children,
    );
    return resolvedStore
        ? createElement(EzClassifyStoreProvider, {
              store: resolvedStore,
              children: tree,
          })
        : tree;
}

/**
 * Stable identity so a provider without options does not churn its context
 * value.
 */
const EMPTY_OPTIONS: UseSchemeEngineOptions = Object.freeze({});

/**
 * Read the application-level provision, or `null` when no provider sits above.
 * Exposed so a component can tell "no default configured" from "the default is
 * an empty options bag" without catching a throw.
 */
export function useEzClassifyProvision(): EzClassifyProvision | null {
    return useContext(EzClassifyProvisionContext);
}

/** What the provider holds so it can rebuild its own store. */
interface OwnedStore {
    engine: NonNullable<EngineArg>;
    signature: readonly unknown[];
    format: string | undefined;
    store: ReactEzClassifyStore;
    /** Whether the effect that owns this store is currently mounted. */
    mounted: boolean;
    /** Set once the store has been destroyed. */
    disposed: boolean;
}

/** What a subscription to a destroyed provider store returns. */
const releaseNothing = (): void => {};

/**
 * The store a provider builds and owns. Once destroyed it takes no new
 * listener, quietly, where any other store throws. React runs a child's effects
 * before its parent's, so when the provider rebuilds a store an `<Activity>`
 * destroyed while it hid the tree, the children subscribe to the old store
 * first. Their listeners would never fire, and the provider's re-render moves
 * them onto the new store. Publishing to it still rejects. A store an
 * application passes in is its own, and its use after destroy still fails
 * loudly.
 */
class ProviderStore extends ReactEzClassifyStore {
    override subscribe(
        id: string,
        listener: (state: EzClassifyState) => void,
        source?: PublishSource,
    ): () => void {
        if (this.destroyed) return releaseNothing;
        return super.subscribe(id, listener, source);
    }

    override subscribeAggregate(
        listener: (state: EzClassifyState) => void,
    ): () => void {
        if (this.destroyed) return releaseNothing;
        return super.subscribeAggregate(listener);
    }

    override subscribeWholeRollup(
        wholeId: string,
        listener: (state: EzClassifyState) => void,
    ): () => void {
        if (this.destroyed) return releaseNothing;
        return super.subscribeWholeRollup(wholeId, listener);
    }

    override subscribeFacet(
        markingId: string,
        categoryId: string,
        listener: (state: FacetState) => void,
    ): () => void {
        if (this.destroyed) return releaseNothing;
        return super.subscribeFacet(markingId, categoryId, listener);
    }
}

/** The one place the provider constructs a store, used on build and on rebuild. */
function buildStore(
    engine: NonNullable<EngineArg>,
    format: string | undefined,
): ReactEzClassifyStore {
    return new ProviderStore(isEngineContext(engine) ? engine.scheme : engine, {
        format,
    });
}

/**
 * Build (and own) the app-level store for an engine, rebuilding only when the
 * engine's structural signature or the render format changes, and destroying it
 * when the provider unmounts or swaps engines.
 *
 * Not a plain `useMemo`: a memo that constructs is not allowed to destroy what
 * it replaced, and an undestroyed store keeps engine calls in flight for a tree
 * nobody is reading.
 *
 * Nor can an effect cleanup destroy the store on the spot. React's StrictMode
 * runs an effect's setup, then its cleanup, then the setup again, all against
 * the same committed render, and the children's effects run their second setup
 * before this one does. A store destroyed by the first cleanup would be handed
 * to every child that subscribes in between. So the cleanup destroys the store
 * only once the commit it ran in has finished and the setup has not come back.
 *
 * The setup can still come back after that: an `<Activity>` that hides the tree
 * cleans its effects up and keeps its state, then runs them again when it is
 * shown. By then the store is gone, so the setup builds a new one and
 * re-renders the tree below onto it. Children whose effects ran first, against
 * the destroyed store, subscribed to nothing; the re-render moves them over.
 */
function useOwnedStore(
    engine: EngineArg,
    options: UseSchemeEngineOptions | undefined,
): ReactEzClassifyStore | null {
    const format = options?.format;
    const held = useRef<OwnedStore | null>(null);
    const [, rebuilt] = useReducer((count: number) => count + 1, 0);

    if (!engine) {
        held.current = null;
    } else {
        const signature = contextSignature(engine);
        if (
            !held.current ||
            held.current.format !== format ||
            !sameSignature(held.current.signature, signature)
        ) {
            held.current = {
                engine,
                signature,
                format,
                store: buildStore(engine, format),
                mounted: false,
                disposed: false,
            };
        }
    }
    const store = held.current?.store ?? null;

    useEffect(() => {
        const entry = held.current;
        if (!entry || !store) return;
        if (entry.disposed) {
            held.current = {
                ...entry,
                store: buildStore(entry.engine, entry.format),
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
