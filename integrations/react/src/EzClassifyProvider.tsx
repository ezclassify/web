/**
 * Application provision for `@ezclassify/react`.
 *
 * The application connects its Context once and names it here. Each document
 * then sits in its own `<EzClassify>` root, which builds and owns that
 * document's store and UI runtime. The provider holds no store: marking state
 * belongs to a root, so two documents on one page never share it by accident.
 *
 * The application owns the Context and disposes of it; nothing here constructs
 * or destroys it. Provision is scoped to this React tree, not module state.
 */

import {
    createContext,
    createElement,
    useContext,
    useMemo,
    type ReactNode,
} from 'react';
import type { ContextAdapter } from '@ezclassify/ui';
import type { EzClassifyOptions } from './ezclassify-options';
import { useStableSource, type EzClassifySource } from './use-stable-source';

/** Props shared by both forms of {@link EzClassifyProvider}. */
interface ProviderBaseProps {
    /** Presentation defaults for every `<EzClassify>` root below. */
    options?: EzClassifyOptions;
    children?: ReactNode;
}

/**
 * Props accepted by {@link EzClassifyProvider}: one connected Context, or a
 * keyed set of them when the page marks against several. With several, each
 * section names its Context with `data-ezclassify-context="<key>"` on an
 * enclosing element; there is no implicit default.
 */
export type EzClassifyProviderProps = ProviderBaseProps &
    (
        | {
              /** The connected Context, for example from `connectContext()`. */
              context: ContextAdapter;
              contexts?: never;
          }
        | {
              context?: never;
              /** Several connected Contexts, by the key markup names them with. */
              contexts: Readonly<Record<string, ContextAdapter>>;
          }
    );

/** What a root reads from the provider above it. */
export interface Provision {
    /** The source every root initializes `EzClassifyUI` with. */
    source: EzClassifySource;
    /** The Context keys, when the provider was given several. */
    contextKeys: readonly string[] | null;
    /** Presentation defaults. */
    options: EzClassifyOptions;
}

const ProvisionContext = createContext<Provision | null>(null);

/**
 * Name the connected Context, or several, and optional presentation defaults
 * for every `<EzClassify>` root below. Place it once, near the top of the
 * application.
 */
export function EzClassifyProvider(props: EzClassifyProviderProps): ReactNode {
    const { options, children } = props;
    const { source, contextKeys } = useStableSource(props);
    const provision = useMemo<Provision>(
        () => ({ source, contextKeys, options: options ?? EMPTY_OPTIONS }),
        [source, contextKeys, options],
    );
    return createElement(
        ProvisionContext.Provider,
        { value: provision },
        children,
    );
}

/** Stable identity so a provider without options does not churn its value. */
const EMPTY_OPTIONS: EzClassifyOptions = Object.freeze({});

/**
 * The provision above the caller.
 *
 * @param caller - What to name in the error.
 * @throws When no `<EzClassifyProvider>` sits above.
 */
export function useProvision(caller: string): Provision {
    const provision = useContext(ProvisionContext);
    if (!provision) {
        throw new Error(
            `[ezclassify/react] ${caller} must be used inside <EzClassifyProvider context={...}>`,
        );
    }
    return provision;
}
