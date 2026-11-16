/**
 * Spec helpers that read one bucket of a store's level rollups. A store built
 * over one engine holds the single bucket `SOLE_BUCKET`, so most specs read the
 * page through these rather than unpacking the bucket map each time.
 */

import type {
    EzClassifyAggregate,
    EzClassifyState,
    EzClassifyStore,
} from './ezclassify-store';
import {
    EMPTY_EZCLASSIFY_STATE,
    SOLE_BUCKET,
    type BucketKey,
} from './store-shared';

/** One bucket of a level, the empty state when the level holds none. */
export function bucketState(
    aggregate: EzClassifyAggregate,
    bucket: BucketKey = SOLE_BUCKET,
): EzClassifyState {
    return aggregate.byBucket.get(bucket) ?? EMPTY_EZCLASSIFY_STATE;
}

/** A level's rollup in one bucket: the page when `nodeId` is omitted. */
export function levelState(
    store: EzClassifyStore,
    nodeId?: string,
    bucket: BucketKey = SOLE_BUCKET,
): EzClassifyState {
    return bucketState(store.getAggregate(nodeId), bucket);
}

/** Listen to one bucket of a level: the page when `nodeId` is omitted. */
export function onLevelState(
    store: EzClassifyStore,
    listener: (state: EzClassifyState) => void,
    nodeId?: string,
    bucket: BucketKey = SOLE_BUCKET,
): () => void {
    return store.subscribeAggregate(
        (aggregate) => listener(bucketState(aggregate, bucket)),
        nodeId,
    );
}
