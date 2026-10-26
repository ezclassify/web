/**
 * Registry of the gate a part field's marking reads pass before they read in
 * their whole's context.
 *
 * A part reads its markings against its whole as it stands. When one user
 * action both commits a part and changes its whole (pressing a button that sets
 * the whole while a mark editor is open), the part's read and the whole's read
 * are on the wire together, and which whole the part is read against would
 * depend on which answer arrives first. The runtime registers a gate for each
 * part host whose whole lives in its store: while that whole is being read
 * again, the part waits for it, and reads against the value the store commits.
 *
 * Kept in a leaf module, like the mount-host registry, so the runtime (writer)
 * and the components (readers) share it without an import cycle. Not part of
 * the package entry.
 */

/**
 * Asked before a part reads in its whole's context. Returns true when the read
 * must wait, and then calls `resume` once, when the whole has settled.
 */
export type WholeReadGate = (resume: () => void) => boolean;

const gates = new WeakMap<HTMLElement, WholeReadGate>();

/** Register the gate for a part host. */
export function setWholeReadGate(host: HTMLElement, gate: WholeReadGate): void {
    gates.set(host, gate);
}

/** Drop a part host's gate. */
export function clearWholeReadGate(host: HTMLElement): void {
    gates.delete(host);
}

/**
 * Resolve once `host`'s whole has settled: at once when it has no gate or its
 * whole is not being read again. The whole can start another read on the way to
 * settling, so the gate is asked again after every wait.
 */
export async function wholeSettled(host: HTMLElement): Promise<void> {
    for (;;) {
        const gate = gates.get(host);
        const waited = await new Promise<boolean>((resolve) => {
            if (!gate?.(() => resolve(true))) resolve(false);
        });
        if (!waited) return;
    }
}
