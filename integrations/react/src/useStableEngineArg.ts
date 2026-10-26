import { useRef } from 'react';
import {
    contextSignature,
    sameSignature,
    type EngineArg,
} from '@ezclassify/ui';

/**
 * The structural-signature logic that decides whether two engine arguments
 * represent the same loaded engine lives in `@ezclassify/ui`
 * (`contextSignature` / `sameSignature`) so React, Vue, and Angular agree on
 * what "the engine changed" means. See that module for the full rationale: in
 * short, `Context.from*` mints a fresh wrapper every render, so we key on the
 * component adapters (scheme/guide/access + spec id/version) instead of the
 * wrapper's identity.
 */

/**
 * Return a referentially-stable version of the engine argument that only
 * changes when its structural signature changes.
 *
 * Why this exists: `useSchemeEngine` re-initializes its forms instance inside a
 * `useEffect` keyed on the engine argument. If that key is the Context object's
 * identity, a consumer who builds the Context inline each render (see
 * `contextSignature` in `@ezclassify/ui`) triggers a re-render storm; the
 * effect builds a store, calls `setState`, React re-renders, the consumer hands
 * over a fresh Context, the effect's dependency looks changed, it tears down
 * and rebuilds, `setState` fires again, and so on until React bails with
 * "Maximum update depth exceeded." Stabilizing the argument here breaks that
 * cycle at the source: as long as the underlying components are the same, the
 * same reference flows into the effect and it does not re-run.
 *
 * A consumer who already memoizes the argument sees identical behavior; the
 * first signature wins and that reference is what flows through, so there is no
 * double-construction and no missed update. Swap in a genuinely different
 * scheme / guide / access engine (or bump the spec version) and the signature
 * changes, so a real context change still re-runs the effect.
 *
 * Note the limit: a Context built inline from _freshly constructed_ child
 * engines on every render (e.g. `Context.fromComponents({ scheme })` where
 * `scheme` is parsed JSON re-wrapped each render) still produces new component
 * identities, so it is not, and cannot safely be, deduplicated here. Telling
 * those apart would require hashing document content, which risks dropping a
 * real update when content changes but the hash collides or the id is reused
 * mid-edit. Memoizing the child engine (or the Context) at the call site is the
 * consumer's job in that case, and they pay full construction cost regardless.
 */
export function useStableEngineArg(engine: EngineArg): EngineArg {
    const ref = useRef<{ sig: readonly unknown[]; value: EngineArg } | null>(
        null,
    );
    const sig = contextSignature(engine);
    if (ref.current === null || !sameSignature(ref.current.sig, sig)) {
        ref.current = { sig, value: engine };
    }
    return ref.current.value;
}
