/**
 * Vue variant of `bindEzClassifyToObject`. Accepts a Vue reactive container, a
 * `Ref` whose `.value` is the doc, or a `reactive()` proxy used directly, and
 * keeps it in sync with a `EzClassifyStore`. Direct property mutation on a
 * `reactive()` doc propagates because Vue's reactivity catches it through
 * `watch`; assigning a new `.value` on a `Ref` propagates the same way.
 *
 * Everything else, the path walking, the round-trip dedupe that stops a commit
 * from echoing back as a publish, and the order writes and publishes happen in,
 * is `createDocBinding` in `@ezclassify/ui`, shared with the React, Angular,
 * and plain-object bindings. What is left here is the container: unwrap the
 * reference, mutate in place, and watch.
 */

import { isRef, watch, type Ref, type WatchStopHandle } from 'vue';
import type { EzClassifyStore } from '@ezclassify/ui';
import {
    createDocBinding,
    readDocPath,
    writeDocPath,
    type BindMarkingsHandle,
    type MarkingsToObjectConfig,
} from '@ezclassify/ui';

/**
 * Accept either a `Ref<T>` or a plain `reactive()` object. The reactive object
 * case is the common form Vue users reach for, `const doc = reactive({...})`.
 */
export type VueReactiveDoc<T extends object> = Ref<T> | T;

function unwrap<T extends object>(doc: VueReactiveDoc<T>): T {
    return isRef(doc) ? (doc as Ref<T>).value : (doc as T);
}

/**
 * Wire a Vue reactive document to a `EzClassifyStore`. Mutations through Vue's
 * reactivity (assigning a `Ref`'s `.value`, or property-writing a `reactive()`
 * object) propagate to the store; store commits propagate back as in-place
 * mutations Vue picks up automatically.
 *
 * @param store - The store this document is bound to.
 * @param doc - A `Ref` holding the document, or the reactive document itself.
 * @param config - Marking id to document path, one entry per binding.
 * @returns The binding handle: `onChange`, `setPath`, `dispose`.
 */
export function bindEzClassifyToReactiveDoc<T extends object>(
    store: EzClassifyStore,
    doc: VueReactiveDoc<T>,
    config: MarkingsToObjectConfig,
): BindMarkingsHandle<T> {
    return createDocBinding(
        store,
        {
            read: () => unwrap(doc),
            // Vue is the one container that mutates in place: its proxy is
            // already the reactive boundary, so a fresh object would only cost
            // the identity every watcher below is keyed on.
            write: (path, value) =>
                writeDocPath(
                    unwrap(doc) as Record<string, unknown>,
                    path,
                    value,
                ),
            observe: (paths, onHostWrite) => {
                // One watcher per path, deep, so a mutation inside a bound
                // value (pushing to an assertion array in place, say) counts as
                // a write. Synchronous flush keeps a publish in the same tick
                // as the mutation that caused it. The publish pass re-reads
                // every path and skips whatever did not move, so several
                // watchers firing on one edit still produce one publish each
                // for what actually changed.
                const stops: WatchStopHandle[] = paths.map((path) =>
                    watch(() => readDocPath(unwrap(doc), path), onHostWrite, {
                        deep: true,
                        flush: 'sync',
                    }),
                );
                return () => {
                    for (const stop of stops) stop();
                };
            },
        },
        config,
        { label: '[ezclassify/vue] bindEzClassifyToReactiveDoc' },
    );
}
