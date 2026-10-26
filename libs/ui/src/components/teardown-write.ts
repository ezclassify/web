/**
 * The last write of a field torn down with a draft still open.
 *
 * A host can remove a field while focus is still in it: a dialog that closes, a
 * route that changes. No blur has run, so nothing has asked the composer to
 * commit what was typed. The field commits the draft through its ordinary
 * commit path (the same one Enter takes, so an unreadable draft still stores
 * nothing) and finishes tearing down once that write has landed. The runtime
 * that removed the field waits on the same write before it lets go of the
 * field's store wiring, so the value reaches the store.
 */

const pending = new WeakMap<object, Promise<void>>();

/** Nonzero while a whole runtime is tearing down its fields. */
let wholeRuntime = 0;

/**
 * Run `teardown` for a runtime that is going away as a whole, store and all.
 * Its fields tear down at once and start no write: there is no store left to
 * write to, and a runtime rebuilt in the same turn may already be taking the
 * same elements over. The runtime keeps each field's draft in its marking host
 * first (see `keepDraft` in ezclassify-ui.ts), which is what the next runtime
 * reads.
 */
export function tearingDownRuntime(teardown: () => void): void {
    wholeRuntime++;
    try {
        teardown();
    } finally {
        wholeRuntime--;
    }
}

/**
 * Tear `owner` down once `write` settles, or at once when there is nothing to
 * write. A second call while a write is pending does nothing: some hosts
 * destroy the same field through two registries.
 *
 * @param owner - The field being destroyed
 * @param write - Starts the draft's commit, or null when there is no draft
 * @param teardown - The field's own teardown
 */
export function teardownAfterWrite(
    owner: object,
    write: (() => Promise<unknown>) | null,
    teardown: () => void,
): void {
    if (pending.has(owner)) return;
    if (!write || wholeRuntime > 0) {
        teardown();
        return;
    }
    const done = write()
        .then(
            () => undefined,
            () => undefined,
        )
        .then(teardown)
        // Teardown runs outside the caller's stack now, so a throw has nowhere
        // to go; the runtime's own teardown treats a failing destroy the same.
        .catch(() => undefined);
    pending.set(owner, done);
}

/** The write a destroyed field is still finishing, if any. */
export function pendingTeardownWrite(owner: object): Promise<void> | undefined {
    return pending.get(owner);
}
