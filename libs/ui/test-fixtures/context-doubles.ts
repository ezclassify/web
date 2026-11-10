/**
 * Context-shaped test doubles for specs that drive the UI through a Context.
 *
 * The UI takes a composed Context and reads only its `scheme`, `guide` and
 * `access` views; it never calls the operations that need more than one of
 * them. Specs need two things the engine's own Context does not give them:
 *
 * - A Context around a mock scheme adapter, so a spec that is about the UI and
 *   not the engine can still hand the UI the shape a deployment hands it; and
 * - A Context whose operations a spec can replace or spy on. The engine's Context
 *   and its views are frozen, so `vi.spyOn` cannot wrap them.
 *
 * Neither double decides anything: every answer comes from the adapter or the
 * Context it wraps.
 */

import type {
    AccessEngineAdapter,
    ContextAdapter,
    ContextSchemeEngineAdapter,
    GuideEngineAdapter,
} from '@ezclassify/types';

/** Any object whose methods a double copies. */
type Operations = object;

/**
 * A Context holding one scheme and nothing else, around any scheme adapter.
 *
 * It has no guide, no access policy and no crosswalk, and the operations that
 * compose artifacts are not available: the UI never calls them, and a spec that
 * does fails loudly instead of reading an answer nobody computed.
 *
 * @param scheme - The scheme adapter the Context exposes as `scheme`
 * @returns A Context whose `scheme` is `scheme` itself
 */
export function schemeOnlyContext(scheme: unknown): ContextAdapter {
    const unavailable = (operation: string) => () => {
        throw new Error(
            `This test Context holds only a scheme, so it cannot ${operation}.`,
        );
    };
    return {
        connected: true,
        scheme: scheme as ContextSchemeEngineAdapter,
        describeSchemes: unavailable('describe its schemes'),
        describeCrosswalks: () => [],
        audit: unavailable('audit a document'),
        checkContextAccess: unavailable('check access'),
        accessRequirements: unavailable('describe access requirements'),
        translate: unavailable('translate a marking'),
        destroy: () => {},
    };
}

/**
 * Copy a view's operations onto a plain object, each still answered by the
 * view, so a spec can replace or spy on one of them.
 *
 * @param view - An engine view (its methods live on its class)
 * @returns A plain object with the view's methods bound to the view and its
 *   properties read through to it
 */
export function openOperations<T extends Operations>(view: T): T {
    const open: Record<string, unknown> = {};
    const seen = new Set<string>();
    for (
        let level: object | null = view;
        level && level !== Object.prototype;
        level = Object.getPrototypeOf(level)
    ) {
        for (const name of Object.getOwnPropertyNames(level)) {
            if (name === 'constructor' || seen.has(name)) continue;
            seen.add(name);
            const descriptor = Object.getOwnPropertyDescriptor(level, name)!;
            if (typeof descriptor.value === 'function') {
                open[name] = (descriptor.value as Function).bind(view);
            } else {
                Object.defineProperty(open, name, {
                    configurable: true,
                    enumerable: true,
                    get: () => (view as Record<string, unknown>)[name],
                });
            }
        }
    }
    return open as T;
}

/** A Context whose views and operations a spec may replace or spy on. */
export type OpenContext = ContextAdapter & {
    scheme: ContextSchemeEngineAdapter & Record<string, unknown>;
    guide?: GuideEngineAdapter & Record<string, unknown>;
    access?: AccessEngineAdapter & Record<string, unknown>;
};

/**
 * Wrap a Context so its scheme, guide and access operations can be replaced or
 * spied on. Every operation is still answered by the wrapped Context.
 *
 * @param context - The Context to open, usually the engine's own
 * @returns A plain Context over the same composition
 */
export function openContext(context: ContextAdapter): OpenContext {
    const open = openOperations(context) as OpenContext;
    Object.defineProperty(open, 'scheme', {
        configurable: true,
        enumerable: true,
        writable: true,
        value: openOperations(context.scheme),
    });
    for (const family of ['guide', 'access'] as const) {
        const view = context[family];
        Object.defineProperty(open, family, {
            configurable: true,
            enumerable: true,
            writable: true,
            value: view ? openOperations(view) : undefined,
        });
    }
    return open;
}
