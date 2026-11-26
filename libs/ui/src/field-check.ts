/**
 * What a marking field tells its host when it could not check the text in it.
 *
 * A field reads typed text through the runtime. When that read fails (the
 * runtime is unreachable, a timeout, a malformed response, an HTTP error) the
 * field keeps showing the last result it has, marked as possibly out of date.
 * This is the same state for the page: a presence-only attribute on the field's
 * host element and an `ezclassify:check-change` event dispatched from it, so
 * "not checked" never has to be inferred from the absence of an error.
 */

/** Stamped on a field's host element while its last check of the text failed. */
export const CHECK_FAILED_ATTRIBUTE = 'data-ezclassify-check-failed';

/**
 * Dispatched from a field's host element, bubbling, each time the field starts
 * or stops reporting a failed check. `detail.failed` is the new state.
 */
export const CHECK_CHANGE_EVENT = 'ezclassify:check-change';

/** `detail` of {@link CHECK_CHANGE_EVENT}. */
export interface CheckChangeDetail {
    /** True when the field's last check of its text failed. */
    failed: boolean;
}

/**
 * Record a field's check state on its host. Stamps or clears the attribute and
 * dispatches the event, only when the state changed.
 *
 * @param host - The field's host element, the one the page authored
 * @param failed - Whether the field's last check of its text failed
 */
export function setCheckFailed(host: Element, failed: boolean): void {
    if (host.hasAttribute(CHECK_FAILED_ATTRIBUTE) === failed) return;
    host.toggleAttribute(CHECK_FAILED_ATTRIBUTE, failed);
    // The element's own realm, so a host in another window or under jsdom
    // accepts the event.
    const view = host.ownerDocument.defaultView;
    const Ctor = view?.CustomEvent ?? CustomEvent;
    host.dispatchEvent(
        new Ctor<CheckChangeDetail>(CHECK_CHANGE_EVENT, {
            bubbles: true,
            detail: { failed },
        }),
    );
}

/**
 * Follow whether the field whose host has `id` last failed to check its text.
 * The listener is called at once with the current state, then on every change,
 * including when the field is enhanced after this call. Framework bindings
 * build their idiom on this.
 *
 * @param id - The DOM id of the field's host, the marking id
 * @param listener - Receives the state
 * @param root - Where to look and listen; the document by default
 * @returns A function that stops following
 */
export function watchCheckFailed(
    id: string,
    listener: (failed: boolean) => void,
    root: Document | Element = document,
): () => void {
    const hostOf = (): Element | null =>
        'getElementById' in root
            ? root.getElementById(id)
            : root.querySelector(`[id="${CSS.escape(id)}"]`);
    const handler = (event: Event) => {
        const target = event.target;
        if (target instanceof Element && target.id === id)
            listener((event as CustomEvent<CheckChangeDetail>).detail.failed);
    };
    root.addEventListener(CHECK_CHANGE_EVENT, handler);
    listener(hostOf()?.hasAttribute(CHECK_FAILED_ATTRIBUTE) ?? false);
    return () => root.removeEventListener(CHECK_CHANGE_EVENT, handler);
}
