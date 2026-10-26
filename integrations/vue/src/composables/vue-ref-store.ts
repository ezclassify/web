/**
 * Vue-backed `EzClassifyStore`. Each marking entry is a `Ref<EzClassifyState>`,
 * Vue's native reactive primitive, so a component that reads the ref reactively
 * re-renders on every commit without a bridge effect, and a `WritableComputed`
 * over the ref's `.rendered` side is the idiomatic two-way binding shape.
 *
 * All engine-facing logic (commit + cycle protection, aggregate / whole-rollup
 * recompute, per-category facet refresh) lives in `BaseEzClassifyStore`; this
 * adapter supplies only the `Ref`-backed reactive cell and exposes the
 * underlying refs through `refFor` / `aggregateRef` / `wholeRollupRef` for
 * template + computed consumption.
 *
 * Cycle protection: standard subscribe-self-skip via `PublishSource.token`. The
 * Vue binding composable doesn't actually subscribe: it reads the ref directly
 * through Vue's reactivity; so the token check is unused on the Vue side. The
 * store still honors it because the `EzClassifyStore` contract requires it of
 * every adapter, and plain `.subscribe` callers rely on it.
 *
 * See `libs/ui/docs/binding-model.md` §8 for the state-adapter pattern.
 */

import { ref as vueRef, type InjectionKey, type Ref } from 'vue';
import {
    BaseEzClassifyStore,
    type EzClassifyState,
    type EzClassifyStoreEngine,
    type FacetState,
    type ReactiveCell,
} from '@ezclassify/ui';

export interface VueRefStoreOptions {
    format?: string;
}

/** Reactive cell backed by a Vue `Ref`, with the ref exposed for template use. */
class VueCell<T> implements ReactiveCell<T> {
    readonly ref: Ref<T>;
    constructor(initial: T) {
        this.ref = vueRef(initial) as Ref<T>;
    }
    get(): T {
        return this.ref.value;
    }
    set(next: T): void {
        this.ref.value = next;
    }
}

export class VueRefStore extends BaseEzClassifyStore {
    constructor(engine: EzClassifyStoreEngine, options?: VueRefStoreOptions) {
        super(engine, options);
    }

    protected createCell<T>(initial: T): ReactiveCell<T> {
        return new VueCell<T>(initial);
    }

    protected storeLabel(): string {
        return '[ezclassify/vue] VueRefStore';
    }

    /** Live ref for the marking. Components read this through Vue's reactivity. */
    refFor(id: string): Ref<EzClassifyState> {
        return (this.markingCell(id) as VueCell<EzClassifyState>).ref;
    }

    /** Live ref for the page-level aggregate. */
    aggregateRef(): Ref<EzClassifyState> {
        return (this.aggregateStateCell() as VueCell<EzClassifyState>).ref;
    }

    /** Live ref for a per-whole rollup. Templates can `v-bind` it directly. */
    wholeRollupRef(wholeId: string): Ref<EzClassifyState> {
        return (this.wholeRollupCell(wholeId) as VueCell<EzClassifyState>).ref;
    }

    /**
     * Live ref for one category facet of a marking: allowable options plus the
     * selected assertions, computed by the store. `useEzClassifyFacet` projects
     * this ref through `computed()` instead of mirroring it into a
     * `shallowRef`.
     *
     * A facet is only recomputed while it has a live `subscribeFacet` listener,
     * so hold a subscription (the native facet adapter does) for as long as the
     * ref is read.
     */
    facetRef(markingId: string, categoryId: string): Ref<FacetState> {
        return (this.facetCell(markingId, categoryId) as VueCell<FacetState>)
            .ref;
    }
}

/**
 * Vue `provide` / `inject` key for the active `VueRefStore`. The runtime
 * initializer (`useEzClassify(engine, options)`) calls `provide()` with it; the
 * binding composable (`useEzClassify(id)`) calls `inject()`.
 */
export const VueRefStoreKey: InjectionKey<VueRefStore> =
    Symbol('EzClassifyStore');
