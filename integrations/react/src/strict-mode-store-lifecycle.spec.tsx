/**
 * Store lifetime across React's StrictMode double-mount.
 *
 * StrictMode runs every effect setup, then its cleanup, then the setup again,
 * against the same committed tree. Anything that creates a store outside an
 * effect and destroys it inside one therefore hands the second setup a store
 * the first cleanup already tore down, and every binding below it is dead for
 * the life of the page. The same sequence runs again on an ordinary unmount and
 * remount, and twice over when a page carries two providers.
 *
 * The visible symptom is a console error per field, "store has been destroyed",
 * followed by a native input where a marking surface should be, so these cases
 * assert on both halves: the store the provider hands down is usable, and
 * nothing on the page reports a destroyed store while mounting.
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { StrictMode, type ReactElement, type ReactNode } from 'react';
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, act, cleanup } from '@testing-library/react';
import { Context } from '@ezclassify/engine';
import type { LocalSchemeEngineAdapter } from '@ezclassify/types';
import {
    EzClassifyProvider,
    useEzClassifyStore,
    useSchemeEngine,
    type ReactEzClassifyStore,
} from './index';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = resolve(__dirname, '../../../vendor/spec/fixtures/v1');

/** A fresh, standalone scheme engine adapter from the reference fixture. */
function makeEngine(): LocalSchemeEngineAdapter {
    return Context.fromComponents({
        scheme: JSON.parse(
            readFileSync(resolve(fixturesDir, 'ref-scheme-1.json'), 'utf8'),
        ),
    }).scheme as LocalSchemeEngineAdapter;
}

/** Flush React effects plus EzClassifyUI's async component init. */
async function flush(): Promise<void> {
    await act(async () => {
        for (let index = 0; index < 6; index++) {
            await new Promise<void>((tick) => setTimeout(tick, 25));
        }
    });
}

/**
 * Whether a store still answers. `subscribe` is the first thing every binding
 * and every deferred component wiring calls, and it is the call that raises the
 * destroyed-store error, so it is the honest liveness probe.
 */
/** Whether a store still takes work: a destroyed one rejects a publish. */
async function isUsable(store: ReactEzClassifyStore | null): Promise<boolean> {
    if (!store) return false;
    try {
        await store.publishRendered('liveness-probe', '');
        return true;
    } catch {
        return false;
    }
}

let errors: string[] = [];

beforeEach(() => {
    errors = [];
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
        errors.push(args.map((arg) => String(arg)).join(' '));
    });
});

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

/** Every console error naming a torn-down store, whichever field raised it. */
function destroyedStoreErrors(): string[] {
    return errors.filter((line) => line.includes('store has been destroyed'));
}

/** Captures the store its provider hands down, so a case can probe it. */
function StoreProbe({
    into,
}: {
    into: { store: ReactEzClassifyStore | null };
}) {
    into.store = useEzClassifyStore();
    return null;
}

/** The app-level shape: the provider owns the store the bindings share. */
function ProvidedPage({
    engine,
    probe,
    children,
}: {
    engine: LocalSchemeEngineAdapter;
    probe: { store: ReactEzClassifyStore | null };
    children?: ReactNode;
}): ReactElement {
    return (
        <EzClassifyProvider engine={engine}>
            <StoreProbe into={probe} />
            {children}
        </EzClassifyProvider>
    );
}

/**
 * The demo's own markup: a rendered host, a field bound to it, and a card
 * mirroring the page aggregate. Both bindings are wired after the component's
 * `init()` resolves, so they are the ones that reach a store torn down in
 * between.
 */
function DemoFields({ testId }: { testId: string }): ReactElement {
    return (
        <>
            <input type="hidden" id={testId} data-ezclassify-rendered />
            <input
                id={`${testId}-tags`}
                data-ezclassify-controller="tags"
                data-ezclassify-bound-to={testId}
            />
            <div data-ezclassify-controller="card" data-ezclassify-aggregate />
        </>
    );
}

/** The per-subtree shape the engine demos use: the hook owns the store. */
function OverridePage({
    engine,
    testId,
}: {
    engine: LocalSchemeEngineAdapter;
    testId: string;
}): ReactElement {
    const { ref } = useSchemeEngine(engine);
    return (
        <div ref={ref} data-testid={testId}>
            <DemoFields testId={testId} />
        </div>
    );
}

describe('provider store lifetime under StrictMode', () => {
    it('hands down a usable store after the double-mount', async () => {
        const probe: { store: ReactEzClassifyStore | null } = { store: null };
        render(
            <StrictMode>
                <ProvidedPage engine={makeEngine()} probe={probe} />
            </StrictMode>,
        );
        await flush();

        expect(probe.store).not.toBeNull();
        expect(await isUsable(probe.store)).toBe(true);
    });

    it('hands down a usable store after an unmount and a remount', async () => {
        const engine = makeEngine();
        const probe: { store: ReactEzClassifyStore | null } = { store: null };
        const first = render(
            <StrictMode>
                <ProvidedPage engine={engine} probe={probe} />
            </StrictMode>,
        );
        await flush();
        const firstStore = probe.store;
        first.unmount();
        await flush();

        // The store the first mount owned is gone with it, and the remount is
        // a fresh one rather than the torn-down instance handed back.
        expect(await isUsable(firstStore)).toBe(false);

        render(
            <StrictMode>
                <ProvidedPage engine={engine} probe={probe} />
            </StrictMode>,
        );
        await flush();

        expect(probe.store).not.toBe(firstStore);
        expect(await isUsable(probe.store)).toBe(true);
    });

    it('keeps two providers on one page independent', async () => {
        const left: { store: ReactEzClassifyStore | null } = { store: null };
        const right: { store: ReactEzClassifyStore | null } = { store: null };
        render(
            <StrictMode>
                <>
                    <ProvidedPage engine={makeEngine()} probe={left} />
                    <ProvidedPage engine={makeEngine()} probe={right} />
                </>
            </StrictMode>,
        );
        await flush();

        expect(left.store).not.toBeNull();
        expect(right.store).not.toBeNull();
        // Two providers are two applications' worth of bindings. Sharing a
        // store between them would leak one page's markings into the other.
        expect(left.store).not.toBe(right.store);
        expect(await isUsable(left.store)).toBe(true);
        expect(await isUsable(right.store)).toBe(true);
    });

    it('leaves the surviving provider alone when its neighbor unmounts', async () => {
        const left: { store: ReactEzClassifyStore | null } = { store: null };
        const right: { store: ReactEzClassifyStore | null } = { store: null };
        // Held outside the render: a provider rebuilds its store when the
        // engine's signature changes, and a fresh engine per render is a fresh
        // signature, which would tear the survivor down for its own reasons.
        const leftEngine = makeEngine();
        const rightEngine = makeEngine();
        function Page({ both }: { both: boolean }): ReactElement {
            return (
                <StrictMode>
                    <>
                        <ProvidedPage engine={leftEngine} probe={left} />
                        {both ? (
                            <ProvidedPage engine={rightEngine} probe={right} />
                        ) : null}
                    </>
                </StrictMode>
            );
        }
        const view = render(<Page both />);
        await flush();
        const survivor = left.store;

        view.rerender(<Page both={false} />);
        await flush();

        expect(await isUsable(survivor)).toBe(true);
    });
});

describe('field mounting under StrictMode', () => {
    it('enhances the fields under a provider without a destroyed store', async () => {
        const probe: { store: ReactEzClassifyStore | null } = { store: null };
        function ProvidedFields(): ReactElement {
            const { ref } = useSchemeEngine();
            return (
                <div ref={ref} data-testid="provided">
                    <DemoFields testId="provided" />
                </div>
            );
        }
        render(
            <StrictMode>
                <ProvidedPage engine={makeEngine()} probe={probe}>
                    <ProvidedFields />
                </ProvidedPage>
            </StrictMode>,
        );
        await flush();

        expect(destroyedStoreErrors()).toEqual([]);
        expect(
            document.querySelectorAll('[data-ezclassify-mount]').length,
        ).toBeGreaterThan(0);
    });

    it('enhances the fields under a per-subtree engine without a destroyed store', async () => {
        render(
            <StrictMode>
                <OverridePage engine={makeEngine()} testId="override" />
            </StrictMode>,
        );
        await flush();

        expect(destroyedStoreErrors()).toEqual([]);
        expect(
            document.querySelectorAll('[data-ezclassify-mount]').length,
        ).toBeGreaterThan(0);
    });

    it('enhances both subtrees when two of them mount together', async () => {
        render(
            <StrictMode>
                <>
                    <OverridePage engine={makeEngine()} testId="first" />
                    <OverridePage engine={makeEngine()} testId="second" />
                </>
            </StrictMode>,
        );
        await flush();

        expect(destroyedStoreErrors()).toEqual([]);
    });

    it('enhances the fields again after an unmount and a remount', async () => {
        const engine = makeEngine();
        const first = render(
            <StrictMode>
                <OverridePage engine={engine} testId="remount" />
            </StrictMode>,
        );
        await flush();
        first.unmount();

        render(
            <StrictMode>
                <OverridePage engine={engine} testId="remount" />
            </StrictMode>,
        );
        await flush();

        expect(destroyedStoreErrors()).toEqual([]);
        expect(
            document.querySelectorAll('[data-ezclassify-mount]').length,
        ).toBeGreaterThan(0);
    });
});
