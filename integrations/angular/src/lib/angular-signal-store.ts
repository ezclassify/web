/**
 * Angular-backed `EzClassifyStore`. Each marking entry IS a
 * `WritableSignal<EzClassifyState>`: there is no mirror layer between the store
 * and Angular's reactivity. Components that hold a signal from this store read
 * change-detection-friendly values directly; the store itself still satisfies
 * the framework-neutral subscribe / publish contract so the `@ezclassify/ui`
 * runtime can treat it like any other store.
 *
 * All engine-facing logic (commit + cycle protection, aggregate / whole-rollup
 * recompute, per-category facet refresh) lives in `BaseEzClassifyStore`; this
 * adapter supplies only the `WritableSignal`-backed reactive cell, exposes the
 * underlying signals through `signalFor` / `aggregateSignalRef` /
 * `wholeRollupSignalRef` / `facetSignalRef`, and overrides teardown so it does
 * NOT write signals during destroy. Every accessor hands out a read-only
 * signal: writes go through the store's publish path so the engine stays the
 * only author of committed state.
 *
 * Cycle protection: `subscribe` stashes the caller's `PublishSource` token
 * alongside its listener. On commit, the store skips listeners whose token
 * matches the publishing source; so a bound signal that publishes its own write
 * doesn't get its effect fired right back with the same value.
 *
 * See `libs/ui/docs/binding-model.md` §8 for the state-adapter pattern.
 */

import {
    InjectionToken,
    signal,
    type Signal,
    type WritableSignal,
} from '@angular/core';
import {
    BaseEzClassifyStore,
    type EzClassifyState,
    type EzClassifyStore,
    type EzClassifyStoreEngine,
    type FacetState,
    type ReactiveCell,
} from '@ezclassify/ui';

/**
 * DI token holding the active `EzClassifyStore` for the current scope.
 * `EzClassifyDirective` provides one per host; descendants pull it via
 * `inject(EZCLASSIFY_STORE)`.
 */
export const EZCLASSIFY_STORE = new InjectionToken<EzClassifyStore>(
    'EZCLASSIFY_STORE',
);

/**
 * The same store as {@link EZCLASSIFY_STORE}, as a signal that reads `null`
 * until the scope has one.
 *
 * `EZCLASSIFY_STORE` hands back a usable handle, which is what a binding wants
 * once the engine is in place. It cannot express "not yet": a descendant is
 * constructed during the host's create pass, before the directive's inputs are
 * applied, and an engine fetched over the wire may not arrive for another
 * second after that. A binding that needs to arm itself when the store shows up
 * reads this signal instead of guessing at a microtask.
 *
 * `provideEzClassify` supplies a constant signal (the application store exists
 * as soon as anything asks for it); `EzClassifyDirective` supplies its own, so
 * a rebuild on a changed engine re-arms every binding in its scope.
 */
export const EZCLASSIFY_STORE_SIGNAL = new InjectionToken<
    Signal<EzClassifyStore | null>
>('EZCLASSIFY_STORE_SIGNAL');

export interface AngularSignalStoreOptions {
    format?: string;
}

/**
 * The signal-shaped reads an Angular binding projects out of a store.
 *
 * {@link AngularSignalStore} implements it, and so does any store an application
 * substitutes through `[ezClassifyStore]` that exposes the same two accessors.
 * Bindings type against this rather than the class: the directive's store input
 * has always accepted a store the host owns, and narrowing to one constructor
 * would turn a supported substitution into silently empty state.
 */
export interface SignalBackedEzClassifyStore extends EzClassifyStore {
    signalFor(id: string): Signal<EzClassifyState>;
    facetSignalRef(markingId: string, categoryId: string): Signal<FacetState>;
}

/** The accessors {@link SignalBackedEzClassifyStore} adds, in report order. */
const SIGNAL_ACCESSORS = ['signalFor', 'facetSignalRef'] as const;

/**
 * Which parts of {@link SignalBackedEzClassifyStore} a store does not answer.
 *
 * Structural, not `instanceof`: a subclass, a decorator, a test double, or a
 * second copy of this package in the dependency graph all satisfy the contract
 * without sharing a constructor with {@link AngularSignalStore}.
 *
 * @param store - The store a scope resolved.
 * @returns The missing accessor names, empty when the store is usable.
 */
export function missingSignalAccessors(store: EzClassifyStore): string[] {
    const candidate = store as Partial<SignalBackedEzClassifyStore>;
    return SIGNAL_ACCESSORS.filter(
        (name) => typeof candidate[name] !== 'function',
    );
}

/**
 * Narrow a scope's store to the signal-backed contract, or fail saying why.
 *
 * A store that cannot be projected is a wiring mistake, not an empty state.
 * Returning a blank projection instead would leave a field permanently showing
 * no options and no value with nothing in the console to explain it.
 *
 * @param store - The store a scope resolved.
 * @param context - Caller name and arguments, used in the error message.
 * @returns The same store, typed for signal projection.
 * @throws Error naming the accessors the store does not implement.
 */
export function requireSignalBackedStore(
    store: EzClassifyStore,
    context: string,
): SignalBackedEzClassifyStore {
    const missing = missingSignalAccessors(store);
    if (missing.length > 0) {
        throw new Error(
            `[ezclassify/angular] ${context}: the store bound to this scope does not implement ` +
                `${missing.join(' or ')}, so its state cannot be projected into signals. ` +
                'Bind a store that extends AngularSignalStore, or drop [ezClassifyStore] and let the ' +
                'directive build one.',
        );
    }
    return store as SignalBackedEzClassifyStore;
}

/** Reactive cell backed by an Angular `WritableSignal`, with the signal exposed. */
class SignalCell<T> implements ReactiveCell<T> {
    readonly signal: WritableSignal<T>;
    constructor(initial: T) {
        this.signal = signal(initial);
    }
    get(): T {
        return this.signal();
    }
    set(next: T): void {
        this.signal.set(next);
    }
}

/**
 * Backing primitive: a `WritableSignal<EzClassifyState>` per marking. The
 * signal IS the entry; there is no plain-state mirror to keep in sync.
 *
 * The aggregate and each whole-rollup are separate signals that recompute on
 * every contributor commit (same shape as `VanillaEzClassifyStore`).
 */
export class AngularSignalStore extends BaseEzClassifyStore {
    constructor(
        engine: EzClassifyStoreEngine,
        options?: AngularSignalStoreOptions,
    ) {
        super(engine, options);
    }

    protected createCell<T>(initial: T): ReactiveCell<T> {
        return new SignalCell<T>(initial);
    }

    protected storeLabel(): string {
        return '[ezclassify/angular] AngularSignalStore';
    }

    /**
     * Do NOT write the aggregate / whole-rollup signals during teardown.
     * Setting a signal here triggers Angular's effect scheduler, which re-runs
     * effects that subscribe to these signals and then call back into this
     * store (subscribeAggregate, subscribeFacet, etc.). Those calls hit
     * assertAlive() on a destroyed store and produce console errors. The
     * component tree is being destroyed; Angular cleans up the effects; no
     * final zero state needed.
     */
    protected override onDestroy(): void {
        // intentionally empty; see method doc.
    }

    /**
     * Get the live signal for a marking. Components can read it inside effects
     * / templates.
     *
     * Read-only by contract. The cell is the store's committed state, and the
     * only way state becomes committed is an engine round trip through
     * `publishRendered` / `publishAssertions`. Handing out a `WritableSignal`
     * would open a write channel that skips the engine entirely: no validation,
     * no listeners, no aggregate or facet refresh, and a displayed marking that
     * disagrees with what the engine would have said. Publish instead.
     */
    signalFor(id: string): Signal<EzClassifyState> {
        return (
            this.markingCell(id) as SignalCell<EzClassifyState>
        ).signal.asReadonly();
    }

    /**
     * Expose the aggregate signal for template / effect consumption. Read-only;
     * see {@link signalFor}.
     */
    aggregateSignalRef(): Signal<EzClassifyState> {
        return (
            this.aggregateStateCell() as SignalCell<EzClassifyState>
        ).signal.asReadonly();
    }

    /**
     * Expose the per-whole rollup signal for template / effect consumption.
     * Read-only; see {@link signalFor}.
     */
    wholeRollupSignalRef(wholeId: string): Signal<EzClassifyState> {
        return (
            this.wholeRollupCell(wholeId) as SignalCell<EzClassifyState>
        ).signal.asReadonly();
    }

    /**
     * Live signal for one category facet of a marking: allowable options plus
     * the selected assertions, computed by the store. `injectEzClassifyFacet`
     * projects this signal through `computed()` instead of mirroring it into
     * signals of its own.
     *
     * A facet is only recomputed while it has a live `subscribeFacet` listener,
     * so hold a subscription (the native facet adapter does) for as long as the
     * signal is read. Read-only; see {@link signalFor}.
     */
    facetSignalRef(markingId: string, categoryId: string): Signal<FacetState> {
        return (
            this.facetCell(markingId, categoryId) as SignalCell<FacetState>
        ).signal.asReadonly();
    }
}
