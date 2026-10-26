/**
 * Optional shared marking-state provision for `@ezclassify/angular`.
 *
 * The application supplies its connected REST client through the public
 * `engine` option. This additionally registers shared marking state and
 * optional UI presentation defaults. Client-only sharing can instead use an
 * application-owned InjectionToken and pass that same client to each feature's
 * `[ezClassify]` host.
 *
 * A directive owns its local UI runtime. The provider's shared store is created
 * lazily and destroyed with its injector. The application retains client
 * ownership. Provision belongs to the Angular injector, not module state.
 */

import {
    DestroyRef,
    InjectionToken,
    inject,
    makeEnvironmentProviders,
    signal,
    type EnvironmentProviders,
    type Signal,
} from '@angular/core';
import { isEngineContext } from '@ezclassify/ui';
import type {
    ContextAdapter,
    ContextSchemeEngineAdapter,
    RemoteContextSchemeEngineAdapter,
    EzClassifyPresentationOptions,
    EzClassifyStore,
    SchemeEngineAdapter,
} from '@ezclassify/ui';
import {
    AngularSignalStore,
    EZCLASSIFY_STORE,
    EZCLASSIFY_STORE_SIGNAL,
} from './angular-signal-store';

/** Structural client contract accepted by a marking scope. */
export type EzClassifyEngine =
    SchemeEngineAdapter | RemoteContextSchemeEngineAdapter | ContextAdapter;

/** The scheme operations available after resolving a bare adapter or Context. */
export type EzClassifySchemeEngine =
    | SchemeEngineAdapter
    | RemoteContextSchemeEngineAdapter
    | ContextSchemeEngineAdapter;

/**
 * Presentation options a scope applies to every marking surface it mounts.
 * Provided app-wide through {@link provideEzClassify} and overridden per host
 * through the directive's `[ezClassifyOptions]` input.
 *
 * The Angular name for the shared
 * {@link EzClassifyPresentationOptions | presentation-options} bag; Angular adds
 * nothing to it.
 */
export type EzClassifyOptions = EzClassifyPresentationOptions;

/**
 * The application's default engine. `[ezClassify]` on a host overrides it for
 * that host and its descendants; a host with no binding inherits it.
 */
export const EZCLASSIFY_ENGINE = new InjectionToken<EzClassifyEngine>(
    'EZCLASSIFY_ENGINE',
);

/**
 * The application's default presentation options. `[ezClassifyOptions]` on a
 * host is merged over these, key by key, so a host can override the format
 * without restating the color map.
 */
export const EZCLASSIFY_OPTIONS = new InjectionToken<EzClassifyOptions>(
    'EZCLASSIFY_OPTIONS',
);

/** Configuration accepted by {@link provideEzClassify}. */
export interface EzClassifyProvision {
    /**
     * Connected REST client inherited by marking surfaces unless a host
     * overrides it. The application creates and owns the client.
     */
    engine: EzClassifyEngine;
    /** Presentation defaults applied to every scope that does not override them. */
    options?: EzClassifyOptions;
}

/**
 * Register a connected REST client, optional UI defaults, and a lazy shared
 * marking store. Hosts can inherit the client with `ezClassify` or supply a
 * client explicitly through `[ezClassify]`. The directive creates its local
 * store; bindings outside a directive resolve the shared provider store.
 * Presentation defaults affect UI scopes, not the client or engine. The owning
 * injector destroys the shared store; the application owns client disposal. See
 * the README for client-only sharing with local feature stores.
 *
 * @param provision - Connected client and optional presentation defaults.
 * @returns Providers for an application or route injector.
 */
export function provideEzClassify(
    provision: EzClassifyProvision,
): EnvironmentProviders {
    return makeEnvironmentProviders([
        { provide: EZCLASSIFY_ENGINE, useValue: provision.engine },
        { provide: EZCLASSIFY_OPTIONS, useValue: provision.options ?? {} },
        {
            provide: EZCLASSIFY_STORE,
            useFactory: appLevelStore,
        },
        {
            provide: EZCLASSIFY_STORE_SIGNAL,
            useFactory: (): Signal<EzClassifyStore | null> =>
                signal(inject(EZCLASSIFY_STORE)).asReadonly(),
        },
    ]);
}

/**
 * The store backing the application scope. Built lazily, on the first injection
 * that is not inside an `[ezClassify]` host (that directive shadows this
 * provider with its own store), and torn down with the injector that owns it.
 */
function appLevelStore(): EzClassifyStore {
    const engine = inject(EZCLASSIFY_ENGINE);
    const options = inject(EZCLASSIFY_OPTIONS, { optional: true }) ?? {};
    const store = new AngularSignalStore(resolveSchemeAdapter(engine), {
        format: options.format,
    });
    inject(DestroyRef).onDestroy(() => store.destroy());
    return store;
}

/**
 * The scheme surface of an injected engine. A composed context carries scheme,
 * guide, and access together; the store only ever needs the scheme side, and
 * `EzClassifyUI` takes the composition whole.
 *
 * @param engine - The engine a scope was given.
 * @returns The scheme adapter to build a store on.
 */
export function resolveSchemeAdapter(
    engine: EzClassifyEngine,
): EzClassifySchemeEngine {
    return isEngineContext(engine) ? engine.scheme : engine;
}
