/**
 * `<EzClassify>`: one marking root, usually one document.
 *
 * ```tsx
 * <EzClassifyProvider context={client}>
 *     <EzClassify>
 *         <form>…</form>
 *     </EzClassify>
 * </EzClassifyProvider>;
 * ```
 *
 * The root renders one `div` without a role around its children, enhances every
 * `data-ezclassify-*` element inside it, and owns the store its children bind
 * to with `useEzClassify(id)`, `useEzClassifyFacet` and `useEzClassifyRollup`.
 * Everything past initialization is markup.
 *
 * It is an exported component, so its identity never changes: a parent
 * re-render, or a new store, never remounts the subtree. To share state with UI
 * outside the form, put one root around both, or pass the same `store` to
 * each.
 */

import {
    createContext,
    createElement,
    useContext,
    useEffect,
    useMemo,
    useRef,
    useState,
    type ReactNode,
} from 'react';
import { EzClassifyUI } from '@ezclassify/ui';
import { useProvision } from './EzClassifyProvider';
import { ScopeStore, useScopeStore } from './scope-store';
import type { ReactEzClassifyStore } from './react-ezclassify-store';
import { EzClassifyStoreProvider } from './useEzClassify';

/** Props accepted by {@link EzClassify}. */
export interface EzClassifyProps {
    /**
     * A store the application owns, for state that outlives this root or is
     * shared with another. It is not destroyed when the root unmounts. Omitted,
     * the root builds its own and destroys it on unmount.
     */
    store?: ReactEzClassifyStore;
    children?: ReactNode;
}

/** What a root shares with code inside it. */
interface Scope {
    /** The runtime, or `null` until it has initialized. */
    forms: EzClassifyUI | null;
}

const ScopeContext = createContext<Scope | null>(null);

/** One marking root. See the module documentation. */
export function EzClassify({ store: given, children }: EzClassifyProps) {
    const { source, options } = useProvision('<EzClassify>');
    const owned = useScopeStore(given ? null : source, options.format);
    // Exactly one of the two is set: `useScopeStore` builds a store whenever it
    // is handed a source, which it is whenever the application passed none.
    const store = (given ?? owned) as ReactEzClassifyStore;
    const rootRef = useRef<HTMLDivElement | null>(null);
    const [forms, setForms] = useState<EzClassifyUI | null>(null);
    // A runtime that cannot start leaves the document without its marking
    // controls. That is surfaced to the nearest error boundary rather than
    // rendered as an ordinary-looking form.
    const [failure, setFailure] = useState<{ error: unknown } | null>(null);

    const { format, colorMap, tooltipConceptProperty, favorites } = options;

    // Runs after the children have committed, so the first scan sees them.
    useEffect(() => {
        const root = rootRef.current;
        // A store an `<Activity>` released is replaced on the next render;
        // the runtime starts against that one.
        if (!root || (store instanceof ScopeStore && store.released)) return;
        let instance: EzClassifyUI;
        try {
            instance = new EzClassifyUI(source, {
                root,
                store,
                format,
                colorMap,
                tooltipConceptProperty,
                favorites,
            });
        } catch (error) {
            setFailure({ error });
            return;
        }
        setForms(instance);
        return () => {
            instance.destroy();
            setForms(null);
        };
    }, [source, store, format, colorMap, tooltipConceptProperty, favorites]);

    const scope = useMemo<Scope>(() => ({ forms }), [forms]);
    if (failure) throw failure.error;
    return createElement(EzClassifyStoreProvider, {
        store,
        children: createElement(
            ScopeContext.Provider,
            { value: scope },
            createElement('div', { ref: rootRef }, children),
        ),
    });
}

/**
 * The runtime of the enclosing `<EzClassify>` root, for code that has to reach
 * it directly: its registered components, its `root` element, readiness.
 * Marking state is better read through `useEzClassify(id)` and
 * `useEzClassifyRollup`.
 *
 * @returns The runtime, or `null` until it has initialized.
 * @throws When no `<EzClassify>` root encloses the caller.
 */
export function useEzClassifyUI(): EzClassifyUI | null {
    const scope = useContext(ScopeContext);
    if (!scope) {
        throw new Error(
            '[ezclassify/react] useEzClassifyUI must be used inside <EzClassify>',
        );
    }
    return scope.forms;
}
