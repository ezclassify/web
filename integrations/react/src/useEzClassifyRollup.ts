import { useCallback, useRef, useSyncExternalStore } from 'react';
import {
    EMPTY_EZCLASSIFY_STATE,
    bucketParts,
    type BucketKey,
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
    /** The scheme selector, for a Context that holds several schemes. */
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
 * the hook reads exactly one. On a page with several Contexts it must name its
 * Context, and on a Context with several schemes its scheme, as a submitted
 * aggregate sink must; otherwise it throws rather than pick one silently.
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
 * @throws When the bucket is ambiguous or names an unknown Context.
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
 * Pick the one roll-up the caller asked for from a level's buckets.
 *
 * @throws When more than one bucket matches.
 */
function readBucket(
    store: ReactEzClassifyStore,
    id: string | undefined,
    context: string | undefined,
    scheme: string | undefined,
): EzClassifyState {
    const matches: [BucketKey, EzClassifyState][] = [];
    for (const [key, state] of store.getAggregate(id).byBucket) {
        const { contextKey, schemeSelector } = bucketParts(key);
        if (context !== undefined && contextKey !== context) continue;
        if (scheme !== undefined && schemeSelector !== scheme) continue;
        matches.push([key, state]);
    }
    if (matches.length > 1) {
        const names = matches
            .map(([key]) => {
                const { contextKey, schemeSelector } = bucketParts(key);
                return [contextKey, schemeSelector || '(primary)']
                    .filter(Boolean)
                    .join('/');
            })
            .join(', ');
        throw new Error(
            `[ezclassify/react] useEzClassifyRollup(${describeLevel(id)}) matches several roll-ups (${names}); name one with { context, scheme }.`,
        );
    }
    return matches[0]?.[1] ?? EMPTY_EZCLASSIFY_STATE;
}

function describeLevel(id: string | undefined): string {
    return id === undefined ? '' : JSON.stringify(id);
}
