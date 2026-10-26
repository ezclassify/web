/**
 * React variant of `bindEzClassifyToObject`. Owns the document as React state
 * and keeps it in sync with a `EzClassifyStore`. When the store commits, the
 * hook replaces the state so consumers re-render; when the consumer writes the
 * document through the returned `setDoc`, the hook publishes whatever changed
 * back to the store.
 *
 * React's reactivity model is `setState`, not in-place mutation, so the
 * "framework catches direct mutation" property from the spec is realized here
 * through React's normal state pipeline: any call to `setDoc` is the mutation,
 * and the hook propagates it. Direct property writes on the returned `doc`
 * (e.g. `doc.classification = 'X'`) bypass React and are undefined behavior,
 * same as in vanilla `bindEzClassifyToObject`.
 *
 * Everything else, the path walking, the round-trip dedupe that stops a commit
 * from echoing back as a publish, and the order writes and publishes happen in,
 * is `createDocBinding` in `@ezclassify/ui`, shared with the Vue, Angular, and
 * plain-object bindings. What is left here is the container: read a ref, write
 * it immutably into state, and treat `setDoc` as the observation point.
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import type {
    BindMarkingsHandle,
    EzClassifyStore,
    MarkingBindingValue,
    MarkingDiffEntry,
    MarkingsToObjectConfig,
} from '@ezclassify/ui';
import { createDocBinding, writeDocPathImmutable } from '@ezclassify/ui';

export interface UseEzClassifyObjectResult<T> {
    /**
     * Current document state. Re-renders trigger when the store commits or
     * `setDoc` is called.
     */
    doc: T;
    /** Replace the document. Changed bound paths are published to the store. */
    setDoc: (next: T | ((prev: T) => T)) => void;
    /** Programmatic single-path edit. Routes through the store. */
    setPath: (path: string, value: MarkingBindingValue) => void;
    /** Register a change listener. Returns an unsubscribe function. */
    onChange: (
        listener: (doc: T, diff: MarkingDiffEntry[]) => void,
    ) => () => void;
}

/**
 * Hook variant of `bindEzClassifyToObject`. Returns the current doc, a setter
 * that propagates writes back to the store, a path-targeted setter, and an
 * `onChange` registration.
 *
 * @param store - The store this document is bound to.
 * @param initialDoc - The document to start from. Read once.
 * @param config - Marking id to document path, one entry per binding.
 * @returns The document plus the three ways to drive it.
 */
export function useEzClassifyObject<T extends object>(
    store: EzClassifyStore,
    initialDoc: T,
    config: MarkingsToObjectConfig,
): UseEzClassifyObjectResult<T> {
    const [doc, setDocState] = useState<T>(initialDoc);
    const docRef = useRef<T>(doc);
    docRef.current = doc;

    // The config is read once, at the first binding. Re-reading it per render
    // would rebuild the subscriptions on every inline object literal a caller
    // passes, which is most of them.
    const configRef = useRef(config);

    // Listener registrations outlive any one binding: the binding is rebuilt if
    // the store changes, and a consumer that registered before that should not
    // have to notice. The binding gets one forwarding listener.
    const listenersRef = useRef<
        Set<(doc: T, diff: MarkingDiffEntry[]) => void>
    >(new Set());

    // Set by the binding's `observe`; running it is what publishes a host write.
    // `setDoc` is React's observation point, so the hook calls this rather than
    // the binding watching anything.
    const publishRef = useRef<() => void>(() => {});
    const bindingRef = useRef<BindMarkingsHandle<T> | null>(null);

    useEffect(() => {
        const binding = createDocBinding<T>(
            store,
            {
                read: () => docRef.current,
                write: (path, value) => {
                    const updated = writeDocPathImmutable(
                        docRef.current,
                        path,
                        value,
                    );
                    docRef.current = updated;
                    setDocState(updated);
                },
                observe: (_paths, onHostWrite) => {
                    publishRef.current = onHostWrite;
                    return () => {
                        publishRef.current = () => {};
                    };
                },
            },
            configRef.current,
            { label: '[ezclassify/react] useEzClassifyObject' },
        );
        const detach = binding.onChange((updated, diff) => {
            for (const listener of listenersRef.current)
                listener(updated, diff);
        });
        bindingRef.current = binding;
        return () => {
            detach();
            binding.dispose();
            bindingRef.current = null;
        };
    }, [store]);

    const setDoc = useCallback((next: T | ((prev: T) => T)) => {
        // The publish is a side effect, so it runs here rather than inside a
        // state updater: React may call an updater more than once (it does in
        // StrictMode), and a doubled updater would publish the same edit twice.
        const resolved =
            typeof next === 'function'
                ? (next as (prev: T) => T)(docRef.current)
                : next;
        docRef.current = resolved;
        setDocState(resolved);
        publishRef.current();
    }, []);

    const setPath = useCallback((path: string, value: MarkingBindingValue) => {
        const binding = bindingRef.current;
        if (!binding) {
            throw new Error(
                '[ezclassify/react] useEzClassifyObject: setPath called before the hook mounted',
            );
        }
        binding.setPath(path, value);
    }, []);

    const onChange = useCallback(
        (listener: (doc: T, diff: MarkingDiffEntry[]) => void) => {
            listenersRef.current.add(listener);
            return () => {
                listenersRef.current.delete(listener);
            };
        },
        [],
    );

    return { doc, setDoc, setPath, onChange };
}
