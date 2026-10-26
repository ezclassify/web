/**
 * React-backed `EzClassifyStore`. Backing primitive is a plain field per
 * marking (held inside the shared {@link BaseEzClassifyStore}'s reactive cell);
 * subscription goes through `useSyncExternalStore` on the consumer side. There
 * is no `useState`/`useReducer` mirror; the store IS the external source, and
 * React reads snapshots from it.
 *
 * All engine-facing logic (commit + cycle protection, aggregate / whole-rollup
 * recompute, per-category facet refresh) lives in `BaseEzClassifyStore`; this
 * adapter supplies only the plain-field reactive cell and React-friendly
 * accessors.
 *
 * Cycle protection: listeners registered with a `PublishSource` token are
 * skipped on commits whose `source.token` matches. The binding hook
 * (`useEzClassify(id)`) registers a per-component token so a component that
 * publishes a write doesn't get re-rendered with its own value an extra time.
 * See `libs/ui/docs/binding-model.md` §8.
 */

import {
    BaseEzClassifyStore,
    type EzClassifyStoreEngine,
    type FacetState,
    type PublishSource,
    type ReactiveCell,
} from '@ezclassify/ui';

export interface ReactEzClassifyStoreOptions {
    format?: string;
}

/** Plain-field reactive cell: React reads snapshots via `useSyncExternalStore`. */
class PlainCell<T> implements ReactiveCell<T> {
    private value: T;
    constructor(initial: T) {
        this.value = initial;
    }
    get(): T {
        return this.value;
    }
    set(next: T): void {
        this.value = next;
    }
}

export class ReactEzClassifyStore extends BaseEzClassifyStore {
    constructor(
        engine: EzClassifyStoreEngine,
        options?: ReactEzClassifyStoreOptions,
    ) {
        super(engine, options);
    }

    protected createCell<T>(initial: T): ReactiveCell<T> {
        return new PlainCell<T>(initial);
    }

    protected storeLabel(): string {
        return '[ezclassify/react] ReactEzClassifyStore';
    }

    /**
     * Convenience for `useSyncExternalStore` callers. `useSyncExternalStore`
     * passes a no-arg callback; this method curries the id so the hook can
     * forward the subscribe argument directly. Cycle protection still applies,
     * pass a stable per-component `PublishSource` when subscribing.
     */
    subscribeFor(
        id: string,
        source?: PublishSource,
    ): (notify: () => void) => () => void {
        return (notify: () => void) => this.subscribe(id, notify, source);
    }

    /**
     * Current {@link FacetState} for one category facet, read straight from its
     * cell. The `getSnapshot` half of a `useSyncExternalStore` pair: the cell
     * is the state, so a hook that pairs this with {@link subscribeFacetFor}
     * needs no `useState` mirror of its own.
     *
     * A facet is only recomputed while it has a live `subscribeFacet` listener;
     * the paired subscription is what keeps this snapshot fresh.
     */
    facetSnapshot(markingId: string, categoryId: string): FacetState {
        return this.facetCell(markingId, categoryId).get();
    }

    /**
     * `subscribe` half of the `useSyncExternalStore` pair for one category
     * facet. Curries the ids so the hook forwards the notify callback
     * directly.
     */
    subscribeFacetFor(
        markingId: string,
        categoryId: string,
    ): (notify: () => void) => () => void {
        return (notify: () => void) =>
            this.subscribeFacet(markingId, categoryId, notify);
    }
}
