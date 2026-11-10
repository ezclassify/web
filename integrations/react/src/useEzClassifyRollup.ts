import { useCallback, useRef, useSyncExternalStore } from 'react';
import {
    EMPTY_EZCLASSIFY_STATE,
    bucketKey,
    type EzClassifyState,
} from '@ezclassify/ui';
import { useProvision } from './EzClassifyProvider';
import { useEzClassifyStore } from './useEzClassify';
import type { ReactEzClassifyStore } from './react-ezclassify-store';

/**
 * Which of a level's roll-ups to read, named the way markup names it: the
 * Context key (`data-ezclassify-context`) and the Context-local scheme selector
 * (`data-ezclassify-scheme`).
 */
export interface EzClassifyBucket {
    /** The Context key. Required when the provider was given several. */
    context?: string;
    /**
     * The selector of a scheme other than the Context's primary, for a Context
     * that holds several. Omitted, the primary scheme is read, as markup reads
     * it without `data-ezclassify-scheme`.
     */
    scheme?: string;
}

/** The cached read for one hook call. */
interface Held {
    store: ReactEzClassifyStore;
    id: string | undefined;
    context: string | undefined;
    scheme: string | undefined;
    /** Set when the store has committed since `value` was read. */
    stale: boolean;
    value: EzClassifyState;
}

/**
 * The roll-up of one level of the enclosing `<EzClassify>` root, read from its
 * store and re-rendered as the store commits.
 *
 * With no `id` it reads the root itself, the page. With the id of a whole it
 * reads that whole's parts; with the id of a collection, its members.
 *
 * A level keeps one roll-up per Context and scheme and never merges them, so
 * the hook reads exactly one: the Context it names, in its primary scheme
 * unless it names another. Which one is fixed when the hook is called, never by
 * the data a level holds. On a page with several Contexts it must name its
 * Context, and it throws at once when it names none, or one the provider does
 * not hold.
 *
 * ```tsx
 * const page = useEzClassifyRollup();
 * const document = useEzClassifyRollup('document');
 * const cui = useEzClassifyRollup(undefined, { context: 'cui' });
 * ```
 *
 * @param id - A whole or collection id; omitted reads the page.
 * @param bucket - Which Context and scheme to read, where there is a choice.
 * @returns The roll-up state; empty until anything at that level is marked.
 * @throws When the provider holds several Contexts and the hook names none, or
 *   names one the provider does not hold.
 */
export function useEzClassifyRollup(
    id?: string,
    bucket?: EzClassifyBucket,
): EzClassifyState {
    const store = useEzClassifyStore();
    const { contextKeys } = useProvision('useEzClassifyRollup');
    const context = bucket?.context;
    const scheme = bucket?.scheme;
    if (contextKeys && context === undefined) {
        throw new Error(
            `[ezclassify/react] useEzClassifyRollup(${describeLevel(id)}) must name its Context on a page with several: one of ${contextKeys.join(', ')}.`,
        );
    }
    if (
        contextKeys &&
        context !== undefined &&
        !contextKeys.includes(context)
    ) {
        throw new Error(
            `[ezclassify/react] useEzClassifyRollup(${describeLevel(id)}) names Context "${context}", which the provider does not hold: ${contextKeys.join(', ')}.`,
        );
    }

    const held = useRef<Held | null>(null);

    const getSnapshot = useCallback((): EzClassifyState => {
        const last = held.current;
        const same =
            last !== null &&
            last.store === store &&
            last.id === id &&
            last.context === context &&
            last.scheme === scheme;
        if (same && !last.stale) return last.value;
        const value = readBucket(store, id, context, scheme);
        // Keep the earlier reference when nothing moved, so a commit elsewhere
        // in the store does not re-render this caller.
        if (same && Object.is(last.value, value)) {
            last.stale = false;
            return last.value;
        }
        held.current = { store, id, context, scheme, stale: false, value };
        return value;
    }, [store, id, context, scheme]);

    const subscribe = useCallback(
        (notify: () => void) => {
            const markStale = (): void => {
                if (held.current) held.current.stale = true;
            };
            // A commit between this render and the subscription is caught by
            // React's own check after subscribing, which reads afresh.
            markStale();
            return store.subscribeAggregate(() => {
                markStale();
                notify();
            }, id);
        },
        [store, id],
    );

    return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/**
 * The one roll-up the caller asked for: its Context (the only one when the
 * provider holds one) in the scheme it names, the primary when it names none.
 */
function readBucket(
    store: ReactEzClassifyStore,
    id: string | undefined,
    context: string | undefined,
    scheme: string | undefined,
): EzClassifyState {
    return (
        store
            .getAggregate(id)
            .byBucket.get(bucketKey(context ?? '', scheme ?? '')) ??
        EMPTY_EZCLASSIFY_STATE
    );
}

function describeLevel(id: string | undefined): string {
    return id === undefined ? '' : JSON.stringify(id);
}
