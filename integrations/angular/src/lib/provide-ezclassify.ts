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
 * The one provided Context, for the labels and roots that need a single scheme;
 * unset under `{ contexts }`. Internal to the package: the application already
 * holds the Context it provided.
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

/**
 * What every root under this injector initializes with: the one provided
 * Context, or the provided Contexts by key. Internal to the package; the
 * application names its Contexts through {@link provideEzClassify}.
 */
export const EZCLASSIFY_CONTEXTS = new InjectionToken<
    | ContextAdapter
    | { readonly contexts: Readonly<Record<string, ContextAdapter>> }
>('EZCLASSIFY_CONTEXTS');

/** Configuration accepted by {@link provideEzClassify}. */
export type EzClassifyProvision = (
    | {
          /**
           * The connected Context, for example the result of
           * `connectContext()`. The application creates and owns it.
           */
          context: ContextAdapter;
          contexts?: never;
      }
    | {
          /**
           * Several connected Contexts, each under the key
           * `data-ezclassify-context` names. Markup outside any
           * `data-ezclassify-context` ancestor has no Context and is reported
           * as a host error; there is no implicit first key.
           */
          contexts: Readonly<Record<string, ContextAdapter>>;
          context?: never;
      }
) & {
    /** Presentation defaults for every root that does not override them. */
    options?: EzClassifyOptions;
};

/**
 * Name the connected Context, or several by key, and optional presentation
 * defaults, for every `ezClassify` root and `<ez-marking-label>` under this
 * injector.
 *
 * @param provision - `{ context }` or `{ contexts }`, and optional presentation
 *   defaults.
 * @returns Providers for an application or route injector.
 * @throws TypeError when neither or both are given, `contexts` is empty, or a
 *   value is not a Context, so a wiring mistake shows at bootstrap instead of
 *   as fields that never mark anything.
 */
export function provideEzClassify(
    provision: EzClassifyProvision,
): EnvironmentProviders {
    const { context, contexts } = provision ?? {};
    if ((context === undefined) === (contexts === undefined)) {
        throw new TypeError(
            '[ezclassify/angular] provideEzClassify() takes exactly one of { context } or { contexts }.',
        );
    }
    if (contexts !== undefined) {
        const entries = Object.entries(contexts ?? {});
        if (entries.length === 0) {
            throw new TypeError(
                '[ezclassify/angular] provideEzClassify({ contexts }) needs at least one Context.',
            );
        }
        for (const [key, value] of entries) {
            if (!isContextAdapter(value)) {
                throw new TypeError(
                    `[ezclassify/angular] provideEzClassify({ contexts }): contexts.${key} is not a connected Context.`,
                );
            }
        }
        return makeEnvironmentProviders([
            { provide: EZCLASSIFY_CONTEXTS, useValue: { contexts } },
            { provide: EZCLASSIFY_OPTIONS, useValue: provision.options ?? {} },
        ]);
    }
    if (!isContextAdapter(context)) {
        throw new TypeError(
            '[ezclassify/angular] provideEzClassify({ context }) needs a connected Context, ' +
                'for example the result of connectContext().',
        );
    }
    return makeEnvironmentProviders([
        { provide: EZCLASSIFY_CONTEXT, useValue: context },
        { provide: EZCLASSIFY_CONTEXTS, useValue: context },
        { provide: EZCLASSIFY_OPTIONS, useValue: provision.options ?? {} },
    ]);
}
