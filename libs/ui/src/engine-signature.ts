/**
 * Framework-agnostic "did the engine argument change?" helper.
 *
 * Every framework binding (`@ezclassify/react`, `@ezclassify/vue`,
 * `@ezclassify/angular`) faces the same problem: the natural way to pass an
 * engine into the binding is to compose a context inline, in the render body or
 * the template expression.
 *
 * A context factory mints a brand-new wrapper object on every call, so the
 * binding sees a "new" engine on every render / change-detection pass even when
 * the underlying scheme/guide/access adapters are identical. Keying
 * re-initialization on the wrapper's identity therefore causes spurious
 * teardown+rebuild churn (and, in React, an outright re-render storm: see
 * `integrations/react/src/useStableEngineArg.ts`).
 *
 * So the bindings key on the engine's _structural signature_: its component
 * adapters plus spec id/version, rather than the disposable wrapper. The same
 * adapter instances mean the same loaded engine. This module is the single
 * shared definition of that signature so the three bindings agree on what
 * "changed" means; React's `useStableEngineArg` consumes it directly, and the
 * Vue/Angular call sites reference it (see their inline comments).
 *
 * Limit: a context built inline from _freshly constructed_ child engines on
 * every pass still yields new component identities and cannot be deduplicated
 * here without hashing document content (which risks dropping real updates).
 * Memoizing the child engine at the call site remains the consumer's job.
 */
import {
    isContextAdapter,
    type ContextAdapter,
    type ContextMetadata,
    type RemoteContextSchemeEngineAdapter,
    type SchemeEngineAdapter,
} from '@ezclassify/types';

/** The engine argument shape the framework bindings accept. */
export type EngineArg =
    | SchemeEngineAdapter
    | RemoteContextSchemeEngineAdapter
    | ContextAdapter
    | null;

/** Narrow any supported engine argument to a composed context. */
export function isEngineContext(
    engine: Exclude<EngineArg, null>,
): engine is ContextAdapter {
    return 'scheme' in engine && isContextAdapter(engine as ContextAdapter);
}

/**
 * Spec identity a composition may carry alongside its sub-adapters. Optional on
 * purpose: it is a property of contexts that were resolved from a spec, not
 * part of the {@link ContextAdapter} contract, and a host's own implementation
 * is free not to have one.
 */
type SpecIdentified = { readonly metadata?: ContextMetadata };

/**
 * Build the list of values whose change counts as a "real" change to the engine
 * argument.
 *
 * For a composed context we key on its components: scheme, guide, access
 * adapters, plus spec id/version when present; not the wrapper's own identity.
 * A bare scheme adapter has no wrapper to see through, so the value itself is
 * the unit of identity.
 */
export function contextSignature(engine: EngineArg): readonly unknown[] {
    if (engine == null) return [null];
    if (isEngineContext(engine)) {
        const metadata = (engine as ContextAdapter & SpecIdentified).metadata;
        return [
            engine.scheme,
            engine.guide,
            engine.access,
            metadata?.id,
            metadata?.resolvedVersion,
        ];
    }
    return [engine];
}

/** Element-wise `Object.is` comparison of two signatures. */
export function sameSignature(
    a: readonly unknown[],
    b: readonly unknown[],
): boolean {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
        if (!Object.is(a[i], b[i])) return false;
    }
    return true;
}
