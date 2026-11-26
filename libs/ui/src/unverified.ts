/**
 * What a field tells its host while what it shows cannot be trusted as the
 * page's value, for either of two reasons.
 *
 * A text field reads typed text through the runtime. When that read fails (the
 * runtime is unreachable, a timeout, a malformed response, an HTTP error) the
 * field keeps showing the last result it has, marked as possibly out of date,
 * because the last check could not be completed.
 *
 * Any field bound to a page marking shares its value with the rest of the page
 * through the store. When the store did not take it, the field keeps the user's
 * entry while the banner, rollups and hidden fields still show the value from
 * before, until the page holds the field's value.
 *
 * The page hears both the same way: a presence-only attribute on the field's
 * host element and an `ezclassify:unverified-change` event dispatched from it,
 * so neither has to be inferred from the absence of an error.
 */

import { getMountHost } from './mount-host-registry';

/** Stamped on a field's host element while its result is unverified. */
export const UNVERIFIED_ATTRIBUTE = 'data-ezclassify-unverified';

/**
 * Dispatched from a field's host element, bubbling, each time the field starts
 * or stops being unverified, and with `unverified: false` when an unverified
 * field is destroyed. `detail.unverified` is the new state.
 */
export const UNVERIFIED_CHANGE_EVENT = 'ezclassify:unverified-change';

/** `detail` of {@link UNVERIFIED_CHANGE_EVENT}. */
export interface UnverifiedChangeDetail {
    /**
     * True while the field's last check of its text could not be completed, or
     * the page does not hold the value the field holds.
     */
    unverified: boolean;
}

/**
 * The host element a field reports on: the element the page authored, which the
 * runtime registered as the mount's host, or else the element a directly
 * constructed field enhances. One lookup for every field family.
 *
 * @param container - The field's mount container
 * @param enhanced - The element the field enhances, when it has one
 */
export function unverifiedHostOf(
    container: HTMLElement,
    enhanced?: Element | null,
): Element | null {
    return getMountHost(container) ?? enhanced ?? null;
}

/**
 * Record a field's state on its host. Stamps or clears the attribute and
 * dispatches the event, only when the state changed.
 *
 * @param host - The field's host element, the one the page authored
 * @param unverified - Whether the field's result is unverified
 */
export function setUnverified(host: Element, unverified: boolean): void {
    if (host.hasAttribute(UNVERIFIED_ATTRIBUTE) === unverified) return;
    host.toggleAttribute(UNVERIFIED_ATTRIBUTE, unverified);
    // The element's own realm, so a host in another window or under jsdom
    // accepts the event.
    const view = host.ownerDocument.defaultView;
    const Ctor = view?.CustomEvent ?? CustomEvent;
    host.dispatchEvent(
        new Ctor<UnverifiedChangeDetail>(UNVERIFIED_CHANGE_EVENT, {
            bubbles: true,
            detail: { unverified },
        }),
    );
}

function hostById(root: Document | Element, id: string): Element | null {
    return 'getElementById' in root
        ? root.getElementById(id)
        : root.querySelector(`[id="${CSS.escape(id)}"]`);
}

/**
 * Whether the field whose host has `id` is unverified right now. False when no
 * such element exists yet.
 *
 * @param id - The DOM id of the field's host, the marking id
 * @param root - Where to look; the document by default
 */
export function isUnverified(
    id: string,
    root: Document | Element = document,
): boolean {
    return hostById(root, id)?.hasAttribute(UNVERIFIED_ATTRIBUTE) ?? false;
}

/**
 * Follow whether the field whose host has `id` is unverified. The listener is
 * called at once with the current state, then on every change, including when
 * the field is enhanced after this call. Framework bindings build their idiom
 * on this.
 *
 * @param id - The DOM id of the field's host, the marking id
 * @param listener - Receives the state
 * @param root - Where to look and listen; the document by default
 * @returns A function that stops following
 */
export function watchUnverified(
    id: string,
    listener: (unverified: boolean) => void,
    root: Document | Element = document,
): () => void {
    const handler = (event: Event) => {
        const target = event.target;
        if (target instanceof Element && target.id === id)
            listener(
                (event as CustomEvent<UnverifiedChangeDetail>).detail
                    .unverified,
            );
    };
    root.addEventListener(UNVERIFIED_CHANGE_EVENT, handler);
    listener(isUnverified(id, root));
    return () => root.removeEventListener(UNVERIFIED_CHANGE_EVENT, handler);
}
