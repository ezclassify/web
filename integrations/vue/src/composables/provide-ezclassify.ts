/**
 * Optional shared marking-state provision for `@ezclassify/vue`.
 *
 * The application supplies a connected REST client through the public `engine`
 * option. This additionally shares a binding store and optional UI defaults.
 * For client-only sharing with feature-local marking stores, use ordinary Vue
 * provide/inject and pass the shared client ref to `useEzClassify` locally.
 *
 * A supplied store and the connected client remain caller-owned. A store
 * created for component provision is destroyed with that scope. App provision
 * persists for the app lifetime. Provision is scoped to Vue's injection graph.
 */

import {
    getCurrentScope,
    inject,
    onScopeDispose,
    provide,
    type App,
    type InjectionKey,
} from 'vue';
import { isEngineContext } from '@ezclassify/ui';
import type {
    ContextAdapter,
    EzClassifyPresentationOptions,
    RemoteContextSchemeEngineAdapter,
    SchemeEngineAdapter,
} from '@ezclassify/ui';
import { VueRefStore, VueRefStoreKey } from './vue-ref-store';

/** Structural client contract accepted by a marking scope. */
export type EzClassifyEngine =
    SchemeEngineAdapter | RemoteContextSchemeEngineAdapter | ContextAdapter;

/**
 * Presentation options a scope applies to every marking surface it mounts.
 *
 * The shared {@link EzClassifyPresentationOptions | presentation-options} bag
 * plus the one thing Vue genuinely adds: `useEzClassify()` mounts the scanner
 * itself rather than over a directive's host element, so the subtree it scans
 * is a caller's choice.
 */
export interface EzClassifyOptions extends EzClassifyPresentationOptions {
    /** Element the scanner treats as its root. Defaults to `#app`, then `body`. */
    root?: HTMLElement;
}

/** What an application provides once and every binding below inherits. */
export interface EzClassifyProvision {
    /** The default engine, or `null` when a store was provided instead. */
    engine: EzClassifyEngine | null;
    /** Presentation defaults, overridden per call. */
    options?: EzClassifyOptions;
    /**
     * A store the application already owns. When present, it is what bindings
     * below resolve and what `useEzClassify()` without an engine override binds
     * to, and it is never destroyed here: whoever created it owns its
     * lifetime.
     *
     * Left unset, `provideEzClassify` builds one from `engine` and puts it here
     * on the provision {@link useEzClassifyProvision} reads back.
     */
    store?: VueRefStore;
}

/** Injection key for the application-level provision. */
export const EzClassifyProvisionKey: InjectionKey<EzClassifyProvision> = Symbol(
    'EzClassifyProvision',
);

/**
 * Share a client-backed marking store and optional presentation defaults.
 * Descendant binding composables can use this store without mounting a scanner;
 * `useEzClassify()` still mounts controls when called by a descendant. The
 * `engine` option carries the application's connected REST client. A created
 * component-scoped store is destroyed with that scope; app provision persists
 * for the application lifetime. Supplied stores remain caller-owned. This
 * function does not own or destroy the connected client.
 *
 * @param provision - Connected client (or caller-owned store) and UI defaults.
 * @param app - Provide on this app instance instead of the current component.
 */
export function provideEzClassify(
    provision: EzClassifyProvision,
    app?: App,
): void {
    const store = provision.store ?? buildAppStore(provision, app);
    const resolved: EzClassifyProvision = store
        ? { ...provision, store }
        : provision;
    if (app) {
        app.provide(EzClassifyProvisionKey, resolved);
        if (store) app.provide(VueRefStoreKey, store);
        return;
    }
    provide(EzClassifyProvisionKey, resolved);
    if (store) provide(VueRefStoreKey, store);
}

/**
 * The store an application-level engine backs, built here rather than by the
 * first `useEzClassify()` below it. A binding composable needs a store the
 * moment it runs, and a page whose only EzClassify surface is a facet picker or
 * a marking field never calls `useEzClassify()` at all.
 *
 * Returns `undefined` when there is no engine to build on, which is the shape a
 * provision carrying only options has.
 *
 * @param provision - What the application provided.
 * @param app - The app instance the provision targets, if any.
 * @returns The store to share, or `undefined`.
 */
function buildAppStore(
    provision: EzClassifyProvision,
    app?: App,
): VueRefStore | undefined {
    if (!provision.engine) return undefined;
    // The store needs the scheme surface; a composed context carries scheme,
    // guide, and access together and `EzClassifyUI` takes it whole.
    const engine = provision.engine;
    const store = new VueRefStore(
        isEngineContext(engine) ? engine.scheme : engine,
        { format: provision.options?.format },
    );
    // Only a scope can tell us when the store stops being needed, and only when
    // the provision is that scope's own. Provided on an app the store belongs to
    // the app, which outlives every component in it; binding teardown to
    // whatever scope happened to be active would destroy the application's store
    // the first time that one component unmounted, and every binding below it
    // would then be talking to a dead store. A plugin's `install(app)` runs
    // outside a scope, but a root component that calls
    // `provideEzClassify({ engine }, app)` from its own `setup()` is inside one.
    if (!app && getCurrentScope()) onScopeDispose(() => store.destroy());
    return store;
}

/**
 * Read the application-level provision, or `undefined` when none was provided.
 * Exposed so a component can tell "no default configured" from "the default is
 * an empty options bag" without catching a throw.
 */
export function useEzClassifyProvision(): EzClassifyProvision | undefined {
    return inject(EzClassifyProvisionKey, undefined);
}
