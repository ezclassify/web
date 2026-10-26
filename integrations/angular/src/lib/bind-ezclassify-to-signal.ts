/**
 * Angular variant of `bindEzClassifyToObject`. Accepts a `WritableSignal` that
 * holds the document and keeps it in sync with a `EzClassifyStore` in both
 * directions.
 *
 * Direct mutation in the Angular idiom means writing the signal; either
 * `doc.set(next)` or `doc.update(d => ({ ...d, classification: 'X' }))`. An
 * `effect` catches the write and publishes the changed paths back to the store.
 * The plain-object semantics of vanilla `bindEzClassifyToObject` (where direct
 * property mutation is undefined behavior) does not apply here because the
 * signal is the reactive container.
 *
 * Everything else, the path walking, the round-trip dedupe that stops a commit
 * from echoing back as a publish, and the order writes and publishes happen in,
 * is `createDocBinding` in `@ezclassify/ui`, shared with the React, Vue, and
 * plain-object bindings. What is left here is the container: read a signal,
 * write it immutably, and watch it.
 */

import {
    effect,
    untracked,
    type Injector,
    type WritableSignal,
} from '@angular/core';
import type { EzClassifyStore } from '@ezclassify/ui';
import {
    createDocBinding,
    writeDocPathImmutable,
    type BindMarkingsHandle,
    type MarkingsToObjectConfig,
} from '@ezclassify/ui';

export interface BindMarkingsToSignalOptions {
    /**
     * Optional injector for the `effect()` call. Provide one when invoking
     * outside an injection context, `inject(Injector)` in a constructor and
     * pass it in.
     */
    injector?: Injector;
}

/**
 * Wire a `WritableSignal<T>` document to a `EzClassifyStore`. The signal's
 * value carries the doc; bindings push changes both ways.
 *
 * @param store - The store this document is bound to.
 * @param doc - Signal holding the document.
 * @param config - Marking id to document path, one entry per binding.
 * @param options - Injector for the internal `effect()`, when outside a
 *   context.
 * @returns The binding handle: `onChange`, `setPath`, `dispose`.
 */
export function bindEzClassifyToSignal<T extends object>(
    store: EzClassifyStore,
    doc: WritableSignal<T>,
    config: MarkingsToObjectConfig,
    options?: BindMarkingsToSignalOptions,
): BindMarkingsHandle<T> {
    const effectOptions = options?.injector
        ? { injector: options.injector }
        : undefined;

    return createDocBinding(
        store,
        {
            read: () => doc(),
            write: (path, value) =>
                doc.update((current) =>
                    writeDocPathImmutable(current, path, value),
                ),
            observe: (_paths, onHostWrite) => {
                const ref = effect(() => {
                    // Read the signal to depend on it, then leave the consumer
                    // before publishing. Publishing is not a projection: it
                    // reads store signals and can write back into this very
                    // signal (clearing a marking commits inside the publish
                    // call, and the store subscription writes `doc`
                    // synchronously). Tracked, those reads would become
                    // dependencies of this effect and re-run it on every
                    // commit.
                    doc();
                    untracked(onHostWrite);
                }, effectOptions);
                return () => ref.destroy();
            },
        },
        config,
        { label: '[ezclassify/angular] bindEzClassifyToSignal' },
    );
}
