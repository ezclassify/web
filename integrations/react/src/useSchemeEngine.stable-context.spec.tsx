/**
 * UseSchemeEngine must tolerate an unstable Context argument. A consumer that
 * builds the Context inline in render,
 * `useSchemeEngine(Context.fromSchemeEngine(engine))`, hands a fresh wrapper
 * over every render; an init effect keyed on the argument's object identity
 * would tear down and rebuild the store, call setState, re-render, get another
 * fresh wrapper, and loop until React threw "Maximum update depth exceeded."
 *
 * These tests pin both directions: a fresh-wrapper-but-same-engine argument
 * must NOT re-run the effect (no storm, store reused), while a genuinely
 * different engine MUST still re-run it (no over-stabilization, no dropped
 * updates). A consumer who already memoizes the argument must see identical
 * single-construction behavior.
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { useMemo } from 'react';
import { describe, it, expect } from 'vitest';
import { render, act } from '@testing-library/react';
import { Context } from '@ezclassify/engine';
import type { LocalSchemeEngineAdapter } from '@ezclassify/types';
import { useSchemeEngine } from './index';
import type { ReactEzClassifyStore } from './index';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = resolve(__dirname, '../../../vendor/spec/fixtures/v1');

function loadScheme(): unknown {
    return JSON.parse(
        readFileSync(resolve(fixturesDir, 'ref-scheme-1.json'), 'utf8'),
    );
}

/** Build a fresh, standalone scheme engine adapter from the reference fixture. */
function makeEngine(): LocalSchemeEngineAdapter {
    return Context.fromComponents({ scheme: loadScheme() })
        .scheme as LocalSchemeEngineAdapter;
}

/** Flush React effects plus EzClassifyUI's async component-init queue. */
async function flush(): Promise<void> {
    await act(async () => {
        await new Promise<void>((r) => setTimeout(r, 0));
    });
}

interface Probe {
    stores: Set<ReactEzClassifyStore>;
    renders: number;
}

/**
 * Builds a fresh Context wrapper on every render. The underlying engine
 * identity drives the effect, so the wrapper churn is invisible to it.
 */
function FreshContextApp({
    engine,
    rollupId,
    probe,
}: {
    engine: LocalSchemeEngineAdapter;
    rollupId: string;
    probe: Probe;
}) {
    probe.renders++;
    // Self-bound the runaway: if the init effect re-fired on every fresh
    // Context, the component would re-render without limit (allocating a new
    // store/forms instance each pass, so it OOMs the worker long before React's
    // own nested-update guard trips). Throwing here turns a regression into a
    // fast, deterministic failure. Renders stay in the single digits, so this
    // never fires in the green path.
    if (probe.renders > 50)
        throw new Error(
            'render storm: useSchemeEngine re-initialized in a loop',
        );
    const ctx = Context.fromSchemeEngine(engine);
    const { ref, store } = useSchemeEngine(ctx, { rollupId });
    if (store) probe.stores.add(store);
    return (
        <div ref={ref}>
            <input data-ezclassify-controller="tags" id={`${rollupId}-input`} />
        </div>
    );
}

/** Memoizes the Context, the "already-correct" consumer path. */
function MemoizedContextApp({
    engine,
    rollupId,
    probe,
}: {
    engine: LocalSchemeEngineAdapter;
    rollupId: string;
    probe: Probe;
}) {
    probe.renders++;
    const ctx = useMemo(() => Context.fromSchemeEngine(engine), [engine]);
    const { ref, store } = useSchemeEngine(ctx, { rollupId });
    if (store) probe.stores.add(store);
    return (
        <div ref={ref}>
            <input data-ezclassify-controller="tags" id={`${rollupId}-input`} />
        </div>
    );
}

describe('useSchemeEngine: unstable Context argument', () => {
    it('does not loop when a fresh Context is built on every render', async () => {
        const probe: Probe = { stores: new Set(), renders: 0 };
        const engine = makeEngine();

        // A regression makes this render() throw "Maximum update depth
        // exceeded" before the assertions.
        const { rerender, unmount } = render(
            <FreshContextApp
                engine={engine}
                rollupId="fresh-ctx"
                probe={probe}
            />,
        );
        await flush();

        // Force several parent re-renders, each handing over a brand-new Context.
        for (let i = 0; i < 5; i++) {
            rerender(
                <FreshContextApp
                    engine={engine}
                    rollupId="fresh-ctx"
                    probe={probe}
                />,
            );
            await flush();
        }

        // One engine identity => the effect ran exactly once => one store.
        expect(probe.stores.size).toBe(1);
        // Render count stays in the handful we forced, no runaway cascade.
        expect(probe.renders).toBeLessThan(20);

        unmount();
    });

    it('re-runs the effect when the engine genuinely changes', async () => {
        const probe: Probe = { stores: new Set(), renders: 0 };
        const engineA = makeEngine();
        const engineB = makeEngine(); // distinct instance => different component identity

        const { rerender, unmount } = render(
            <FreshContextApp
                engine={engineA}
                rollupId="swap-ctx"
                probe={probe}
            />,
        );
        await flush();
        expect(probe.stores.size).toBe(1);

        // Swap to a different engine, the structural signature changes, so the
        // effect must tear down and rebuild, producing a second store.
        rerender(
            <FreshContextApp
                engine={engineB}
                rollupId="swap-ctx"
                probe={probe}
            />,
        );
        await flush();
        expect(probe.stores.size).toBe(2);

        unmount();
    });

    it('builds the store once for a consumer that memoizes the Context', async () => {
        const probe: Probe = { stores: new Set(), renders: 0 };
        const engine = makeEngine();

        const { rerender, unmount } = render(
            <MemoizedContextApp
                engine={engine}
                rollupId="memo-ctx"
                probe={probe}
            />,
        );
        await flush();

        for (let i = 0; i < 5; i++) {
            rerender(
                <MemoizedContextApp
                    engine={engine}
                    rollupId="memo-ctx"
                    probe={probe}
                />,
            );
            await flush();
        }

        expect(probe.stores.size).toBe(1);

        unmount();
    });
});
