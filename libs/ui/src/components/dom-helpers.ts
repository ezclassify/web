/**
 * DOM reconciliation and geometry utilities, plus the shared component CSS
 * constant and accessor.
 */

import componentCss from './component-utils.css?inline';

/** Shared CSS for every component. */
export const COMPONENT_CSS: string = componentCss;

/** Returns the full component CSS string for external injection */
export function getComponentStyles(): string {
    return COMPONENT_CSS;
}

/**
 * Keyed DOM child list reconciler. Efficiently updates a parent element's
 * children to match a new list, reusing existing DOM nodes by key. Only adds,
 * removes, and reorders; never recreates nodes that haven't changed.
 *
 * @param parent - Container element whose children are managed
 * @param items - New ordered list of items to render
 * @param keyFn - Extracts a stable unique key from each item
 * @param createFn - Creates a new DOM element for an item
 * @param updateFn - Updates an existing DOM element to reflect new item state
 *   (optional)
 * @param trailingNodes - Elements to keep at the end (e.g., filter input); not
 *   managed by reconciler
 */
export function reconcileChildren<T>(
    parent: HTMLElement,
    items: T[],
    keyFn: (item: T) => string,
    createFn: (item: T) => HTMLElement,
    updateFn?: (el: HTMLElement, item: T) => void,
    trailingNodes?: HTMLElement[],
): HTMLElement[] {
    const existingByKey = new Map<string, HTMLElement>();
    const managed = new Set<HTMLElement>(trailingNodes ?? []);

    for (let i = parent.children.length - 1; i >= 0; i--) {
        const child = parent.children[i] as HTMLElement;
        if (managed.has(child)) continue;
        const key = child.dataset.reconcileKey;
        if (key) {
            existingByKey.set(key, child);
        }
    }

    const result: HTMLElement[] = [];
    const newKeys = new Set<string>();

    for (const item of items) {
        const key = keyFn(item);
        newKeys.add(key);
        let el = existingByKey.get(key);
        if (el) {
            if (updateFn) updateFn(el, item);
        } else {
            el = createFn(item);
            el.dataset.reconcileKey = key;
        }
        result.push(el);
    }

    // Remove nodes no longer in the list
    for (const [key, el] of existingByKey) {
        if (!newKeys.has(key)) {
            el.remove();
        }
    }

    // Ensure trailing nodes are in the parent before positioning reconciled items relative to them
    const trailing = trailingNodes ?? [];
    for (const tn of trailing) {
        if (!parent.contains(tn)) parent.appendChild(tn);
    }

    // Reorder: walk through result and ensure each element is in the right position
    let refNode: Node | null = trailing.length > 0 ? trailing[0] : null;
    for (let i = result.length - 1; i >= 0; i--) {
        const el = result[i];
        if (el.nextSibling !== refNode || el.parentNode !== parent) {
            parent.insertBefore(el, refNode);
        }
        refNode = el;
    }

    return result;
}

/**
 * Batch-read geometry for multiple elements in a single layout pass, avoiding
 * interleaved read/write thrashing.
 */
export function readGeometry(
    ...elements: Array<HTMLElement | null>
): DOMRect[] {
    return elements.map((el) =>
        el ? el.getBoundingClientRect() : new DOMRect(),
    );
}

/**
 * A mirrored host `min-height` held to at least the field family's own floor.
 *
 * The single-line fields share one height: their stylesheet declares it as the
 * floor, and a host that asks for more keeps it. Both values are computed
 * styles. A floor that is not a positive pixel length (no stylesheet applied)
 * or a host value that is not a pixel length (`auto`, a percentage) leaves the
 * host's value as it is.
 *
 * @param host - The host's computed `min-height`.
 * @param floor - The field's own computed `min-height` before mirroring.
 * @returns The `min-height` to write on the field's visible layers.
 */
export function heightAtLeastFloor(host: string, floor: string): string {
    const floorPx = /^[\d.]+px$/.test(floor) ? parseFloat(floor) : 0;
    if (floorPx <= 0) return host;
    if (host === 'auto' || host === '') return floor;
    if (!/^[\d.]+px$/.test(host)) return host;
    return parseFloat(host) >= floorPx ? host : floor;
}

/**
 * Detect a macOS-family platform for keyboard-shortcut labels (Cmd vs Ctrl).
 * Prefers the modern userAgentData API; navigator.platform is deprecated and
 * empty on some browsers, so it is only the fallback.
 */
export function isMacPlatform(): boolean {
    if (typeof navigator === 'undefined') return false;
    const uaData = (
        navigator as Navigator & {
            userAgentData?: { platform?: string };
        }
    ).userAgentData;
    const platform = uaData?.platform ?? navigator.platform ?? '';
    return /mac/i.test(platform);
}

/**
 * Keep generated controls aligned with their native field's editability,
 * including a disabled ancestor fieldset. The returned cleanup disconnects
 * observation when the enhancement is destroyed.
 */
export function observeNativeLock(
    host: HTMLInputElement | null,
    update: (locked: boolean) => void,
): () => void {
    const refresh = () => update(!!host?.matches(':disabled, [readonly]'));
    const observer = new MutationObserver(refresh);
    for (
        let element: HTMLElement | null = host;
        element;
        element = element.parentElement
    ) {
        observer.observe(element, {
            attributes: true,
            attributeFilter: ['disabled', 'readonly'],
        });
    }
    refresh();
    return () => observer.disconnect();
}
