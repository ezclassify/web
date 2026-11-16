/**
 * Framework-agnostic "did the Context argument change?" helper.
 *
 * Every framework binding (`@ezclassify/react`, `@ezclassify/vue`,
 * `@ezclassify/angular`) faces the same problem: the natural way to pass a
 * Context into the binding is to compose it inline, in the render body or the
 * template expression.
 *
 * A Context factory mints a brand-new wrapper object on every call, so the
 * binding sees a "new" Context on every render / change-detection pass even
 * when the underlying scheme/guide/access views are identical. Keying
 * re-initialization on the wrapper's identity therefore causes spurious
 * teardown+rebuild churn (and, in React, an outright re-render storm).
 *
 * So the bindings key on the Context's _structural signature_: its component
 * views plus its resolved id and version, rather than the disposable wrapper.
 * The same views mean the same loaded Context. This module is the single shared
 * definition of that signature so the three bindings agree on what "changed"
 * means. A binding given several Contexts signs each one under its key.
 *
 * Limit: a Context built inline from _freshly constructed_ views on every pass
 * still yields new component identities and cannot be deduplicated here without
 * hashing document content (which risks dropping real updates). Memoizing the
 * Context at the call site remains the consumer's job.
 */
import type { ContextAdapter, ContextMetadata } from '@ezclassify/types';

/**
 * Spec identity a composition may carry alongside its views. Optional on
 * purpose: it is a property of Contexts that were resolved from a spec, not
 * part of the {@link ContextAdapter} contract, and a host's own implementation
 * is free not to have one.
 */
type SpecIdentified = { readonly metadata?: ContextMetadata };

/**
 * The values whose change counts as a "real" change to a Context argument: its
 * scheme, guide and access views, plus its id and resolved version when
 * present; not the wrapper's own identity.
 *
 * @param context - The Context, or null when none is bound yet
 */
export function contextSignature(
    context: ContextAdapter | null,
): readonly unknown[] {
    if (context == null) return [null];
    const metadata = (context as ContextAdapter & SpecIdentified).metadata;
    return [
        context.scheme,
        context.guide,
        context.access,
        metadata?.id,
        metadata?.resolvedVersion,
    ];
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
