import { useRef } from 'react';
import {
    contextSignature,
    sameSignature,
    type ContextAdapter,
    type EzClassifyUI,
} from '@ezclassify/ui';

/** What `new EzClassifyUI(...)` takes first: one Context or a keyed set. */
export type EzClassifySource = ConstructorParameters<typeof EzClassifyUI>[0];

/** The Contexts an `<EzClassifyProvider>` was given, exactly one form set. */
export interface ProvidedContexts {
    context?: ContextAdapter;
    contexts?: Readonly<Record<string, ContextAdapter>>;
}

/** A root's source, held at one identity while its Contexts are the same. */
export interface StableSource {
    /** What every root passes to `EzClassifyUI`. */
    source: EzClassifySource;
    /** The Context keys, when the provider was given several. */
    contextKeys: readonly string[] | null;
}

/**
 * Turn the provider's `context` or `contexts` prop into the source every
 * `<EzClassify>` root passes to `EzClassifyUI`, holding one reference for as
 * long as the Contexts are structurally the same.
 *
 * A Context composed inline in a render body is a new wrapper on every pass.
 * Keying the roots on that identity would rebuild every store and runtime on
 * each render, and in React it loops: the rebuild sets state, the parent
 * renders, a new wrapper arrives. So the source is keyed on each Context's
 * structural signature (`contextSignature` in `@ezclassify/ui`, which the Vue
 * and Angular packages use for the same question), plus the keys of a keyed
 * set. A genuinely different Context, or a key added or removed, changes the
 * signature and yields a new source.
 *
 * A Context rebuilt from freshly constructed component engines on every render
 * still changes identity and cannot be deduplicated without hashing content;
 * memoizing it at the call site is the caller's job.
 *
 * @param provided - The provider's props, with exactly one of the two set.
 * @returns The stable source to initialize roots with, and its Context keys.
 * @throws When neither or both of `context` and `contexts` are set.
 */
export function useStableSource(provided: ProvidedContexts): StableSource {
    const held = useRef<{
        signature: readonly unknown[];
        value: StableSource;
    } | null>(null);
    const signature = signatureOf(provided);
    if (!held.current || !sameSignature(held.current.signature, signature)) {
        held.current = {
            signature,
            value: {
                source: sourceOf(provided),
                contextKeys: provided.contexts
                    ? Object.keys(provided.contexts)
                    : null,
            },
        };
    }
    return held.current.value;
}

/**
 * The values whose change counts as a change of Contexts: the form used, then
 * per Context its key (for a keyed set) and its structural signature.
 */
function signatureOf({ context, contexts }: ProvidedContexts): unknown[] {
    if (context && contexts) {
        throw new Error(
            '[ezclassify/react] <EzClassifyProvider> takes `context` or `contexts`, not both.',
        );
    }
    if (context) return ['context', ...contextSignature(context)];
    if (!contexts) {
        throw new Error(
            '[ezclassify/react] <EzClassifyProvider> needs a connected Context: pass `context`, or `contexts` for several.',
        );
    }
    const signature: unknown[] = ['contexts'];
    for (const key of Object.keys(contexts).sort()) {
        signature.push(key, ...contextSignature(contexts[key]));
    }
    return signature;
}

function sourceOf({ context, contexts }: ProvidedContexts): EzClassifySource {
    if (context) return context;
    return { contexts: { ...contexts } };
}
