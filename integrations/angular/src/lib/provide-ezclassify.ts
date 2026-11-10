/**
 * Application provision for `@ezclassify/angular`.
 *
 * The application connects its Context once and names it here. After that a
 * marking root is a bare `ezClassify` attribute: `<form ezClassify>`. Each root
 * builds and owns its own store; there is no application-wide store. A feature
 * that needs a different Context provides its own `provideEzClassify()` in its
 * route's providers, the ordinary Angular way to scope a dependency.
 *
 * The application owns the Context and disposes of it. Provision belongs to the
 * Angular injector, not module state.
 */

import {
    InjectionToken,
    makeEnvironmentProviders,
    type EnvironmentProviders,
} from '@angular/core';
import { isContextAdapter } from '@ezclassify/ui';
import type {
    ContextAdapter,
    EzClassifyPresentationOptions,
} from '@ezclassify/ui';

/**
 * Presentation options a root applies to every marking surface it mounts.
 * Provided app-wide through {@link provideEzClassify} and overridden per root
 * through the directive's `[ezClassifyOptions]` input.
 *
 * The Angular name for the shared
 * {@link EzClassifyPresentationOptions | presentation-options} bag; Angular adds
 * nothing to it.
 */
export type EzClassifyOptions = EzClassifyPresentationOptions;

/**
 * The connected Context that marking roots and labels in this injector use.
 * Inject it to call the Context directly, for example to explain a marking.
 */
export const EZCLASSIFY_CONTEXT = new InjectionToken<ContextAdapter>(
    'EZCLASSIFY_CONTEXT',
);

/**
 * The provided presentation options. `[ezClassifyOptions]` on a root is merged
 * over these, key by key, so a root can override the format without restating
 * the color map.
 */
export const EZCLASSIFY_OPTIONS = new InjectionToken<EzClassifyOptions>(
    'EZCLASSIFY_OPTIONS',
);

/** Configuration accepted by {@link provideEzClassify}. */
export interface EzClassifyProvision {
    /**
     * The connected Context, for example the result of `connectContext()`. The
     * application creates and owns it.
     */
    context: ContextAdapter;
    /** Presentation defaults for every root that does not override them. */
    options?: EzClassifyOptions;
}

/**
 * Name the connected Context, and optional presentation defaults, for every
 * `ezClassify` root and `<ez-marking-label>` under this injector.
 *
 * @param provision - The connected Context and optional presentation defaults.
 * @returns Providers for an application or route injector.
 * @throws TypeError when `context` is not a Context, so a wiring mistake shows
 *   at bootstrap instead of as fields that never mark anything.
 */
export function provideEzClassify(
    provision: EzClassifyProvision,
): EnvironmentProviders {
    if (!isContextAdapter(provision?.context)) {
        throw new TypeError(
            '[ezclassify/angular] provideEzClassify({ context }) needs a connected Context, ' +
                'for example the result of connectContext().',
        );
    }
    return makeEnvironmentProviders([
        { provide: EZCLASSIFY_CONTEXT, useValue: provision.context },
        { provide: EZCLASSIFY_OPTIONS, useValue: provision.options ?? {} },
    ]);
}
