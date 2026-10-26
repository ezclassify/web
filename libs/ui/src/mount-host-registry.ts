/**
 * Registry mapping an interactive controller's sibling mount container back to
 * its ORIGINAL host element.
 *
 * `createMountContainer()` inserts an empty `[data-ezclassify-mount]` <div> as
 * a sibling after the host element. A controller's init() must enhance ITS
 * host, not re-discover it with a parent-wide querySelector; that fallback
 * binds the FIRST matching input under the shared parent, so two bare sibling
 * controllers (e.g. two marked-inputs in one container) would both capture the
 * first input.
 *
 * Kept in a dedicated leaf module so both component-factory (writer) and the
 * components (readers) can use it without an import cycle.
 */
const mountHosts = new WeakMap<HTMLElement, HTMLElement>();

/**
 * Host element → owning EzClassifyUI instance id. Recorded when an instance
 * enhances a host, so the cross-instance claim guard (emitOne defense-in-depth)
 * and the reclaim-on-register sweep can tell which instance currently owns a
 * host that already carries a `[data-ezclassify-mount]` sibling.
 */
const mountOwners = new WeakMap<HTMLElement, string>();

/** Record the host element a mount container was created for. */
export function setMountHost(container: HTMLElement, host: HTMLElement): void {
    mountHosts.set(container, host);
}

/**
 * The original host element for a mount container. For keep-visible controllers
 * (marked-input / marked-textarea) this host IS the native element to enhance.
 */
export function getMountHost(container: HTMLElement): HTMLElement | undefined {
    return mountHosts.get(container);
}

/** Record which EzClassifyUI instance owns (enhanced) a host element. */
export function setMountOwner(host: HTMLElement, instanceId: string): void {
    mountOwners.set(host, instanceId);
}

/** The instance id that currently owns a host, if any. */
export function getMountOwner(host: HTMLElement): string | undefined {
    return mountOwners.get(host);
}

/** Drop the ownership record for a host (on teardown / reclaim). */
export function clearMountOwner(host: HTMLElement): void {
    mountOwners.delete(host);
}
