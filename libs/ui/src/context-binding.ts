/**
 * Vanilla-DOM binding for a {@link ContextAdapter}. Lets a host page mark a
 * parent element with the `data-ezclassify-context` attribute and have
 * descendant components automatically resolve to that context, analogous to a
 * React context provider, but for plain HTML.
 *
 * Usage: the host builds its context however it builds one, in process or bound
 * to a remote runtime, registers it under a key, and names that key on an
 * ancestor element.
 *
 * ```html
 * <script>
 *     registerContext('document-form', ctx);
 * </script>
 * <div data-ezclassify-context="document-form">
 *     <div data-ezclassify-mount="tags"></div>
 * </div>
 * ```
 *
 * The component's `init` walks up the DOM looking for the nearest
 * `[data-ezclassify-context]` ancestor, reads the registry key, and pulls the
 * context out of the registry. A direct argument always wins over the
 * DOM-discovered one.
 */

import type { ContextAdapter } from '@ezclassify/types';

const REGISTRY = new Map<string, ContextAdapter>();

/**
 * Register a context under a stable key. The same key may be referenced by
 * multiple `[data-ezclassify-context]` attributes on the page. Re-registering
 * the same key replaces the previous context.
 */
export function registerContext(key: string, ctx: ContextAdapter): void {
    REGISTRY.set(key, ctx);
}

/** Remove a context registration. Useful for SPA route teardown. */
export function unregisterContext(key: string): void {
    REGISTRY.delete(key);
}

/**
 * Walk up from `el` and return the context registered for the nearest
 * `[data-ezclassify-context]` ancestor, or `null` when none is present (or when
 * the registry has no entry for the key).
 */
export function findContext(
    el: HTMLElement | null | undefined,
): ContextAdapter | null {
    if (!el) return null;
    const provider = el.closest('[data-ezclassify-context]');
    if (!provider) return null;
    const key = provider.getAttribute('data-ezclassify-context');
    if (!key) return null;
    return REGISTRY.get(key) ?? null;
}

/** Drop every registration. Mainly useful for tests. */
export function clearContextRegistry(): void {
    REGISTRY.clear();
}
