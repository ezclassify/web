/**
 * Store lifetime across React's StrictMode double-mount.
 *
 * StrictMode runs every effect setup, then its cleanup, then the setup again,
 * against the same committed tree. Anything that creates a store outside an
 * effect and destroys it inside one therefore hands the second setup a store
 * the first cleanup already tore down, and every binding below it is dead for
 * the life of the page. The same sequence runs again on an ordinary unmount and
 * remount, and twice over when a page carries two roots.
 *
 * The visible symptom is a console error per field, "store has been destroyed",
 * followed by a native input where a marking surface should be, so these cases
 * assert on both halves: the store a root hands down is usable, and nothing on
 * the page reports a destroyed store while mounting.
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { StrictMode, type ReactElement, type ReactNode } from 'react';
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, act, cleanup } from '@testing-library/react';
import { Context } from '@ezclassify/engine';
import type { ContextAdapter } from '@ezclassify/ui';
import {
    EzClassify,
    EzClassifyProvider,
    useEzClassifyStore,
    type ReactEzClassifyStore,
} from './index';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = resolve(__dirname, '../../../vendor/spec/fixtures/v1');

/** A fresh Context over the reference fixture. */
function makeContext(): ContextAdapter {
    return Context.fromComponents({
        scheme: JSON.parse(
            readFileSync(resolve(fixturesDir, 'ref-scheme-1.json'), 'utf8'),
        ),
    }) as unknown as ContextAdapter;
}

/** Flush React effects plus EzClassifyUI's async component init. */
async function flush(): Promise<void> {
    await act(async () => {
        for (let index = 0; index < 6; index++) {
            await new Promise<void>((tick) => setTimeout(tick, 25));
        }
    });
}

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

/** Captures the store its root hands down, so a case can probe it. */
function StoreProbe({
    into,
}: {
    into: { store: ReactEzClassifyStore | null };
}) {
    into.store = useEzClassifyStore();
    return null;
}

/**
 * A demo's own markup: a marking host, a field bound to it, and a card
 * mirroring the page aggregate. Both bindings are wired after the component's
 * `init()` resolves, so they are the ones that reach a store torn down in
 * between.
 */
function DemoFields({ testId }: { testId: string }): ReactElement {
    return (
        <>
            <input type="hidden" id={testId} data-ezclassify-marking />
            <input
                id={`${testId}-tags`}
                data-ezclassify-controller="tags"
                data-ezclassify-bound-to={testId}
            />
            <div data-ezclassify-controller="card" data-ezclassify-aggregate />
        </>
    );
}

/** One root with the demo fields and a probe on its store. */
function Root({
    testId,
    probe,
}: {
    testId: string;
    probe?: { store: ReactEzClassifyStore | null };
}): ReactElement {
    return (
        <EzClassify>
            {probe ? <StoreProbe into={probe} /> : null}
            <DemoFields testId={testId} />
        </EzClassify>
    );
}

function Page({
    context,
    children,
}: {
    context: ContextAdapter;
    children?: ReactNode;
}): ReactElement {
    return (
        <StrictMode>
            <EzClassifyProvider context={context}>
                {children}
            </EzClassifyProvider>
        </StrictMode>
    );
}

describe('root store lifetime under StrictMode', () => {
    it('hands down a usable store after the double-mount', async () => {
        const probe: { store: ReactEzClassifyStore | null } = { store: null };
        render(
            <Page context={makeContext()}>
                <Root testId="one" probe={probe} />
            </Page>,
        );
        await flush();

        expect(probe.store).not.toBeNull();
        expect(await isUsable(probe.store)).toBe(true);
    });

    it('hands down a fresh usable store after an unmount and a remount', async () => {
        const context = makeContext();
        const probe: { store: ReactEzClassifyStore | null } = { store: null };
        const first = render(
            <Page context={context}>
                <Root testId="remount" probe={probe} />
            </Page>,
        );
        await flush();
        const firstStore = probe.store;
        first.unmount();
        await flush();

        // The store the first mount owned is gone with it, and the remount is
        // a fresh one rather than the torn-down instance handed back.
        expect(await isUsable(firstStore)).toBe(false);

        render(
            <Page context={context}>
                <Root testId="remount" probe={probe} />
            </Page>,
        );
        await flush();

        expect(probe.store).not.toBe(firstStore);
        expect(await isUsable(probe.store)).toBe(true);
        expect(destroyedStoreErrors()).toEqual([]);
        expect(
            document.querySelectorAll('[data-ezclassify-mount]').length,
        ).toBeGreaterThan(0);
    });

    it('keeps two roots on one page independent', async () => {
        const left: { store: ReactEzClassifyStore | null } = { store: null };
        const right: { store: ReactEzClassifyStore | null } = { store: null };
        render(
            <Page context={makeContext()}>
                <Root testId="left" probe={left} />
                <Root testId="right" probe={right} />
            </Page>,
        );
        await flush();

        // Two roots are two documents. Sharing a store between them would
        // leak one document's markings into the other.
        expect(left.store).not.toBe(right.store);
        expect(await isUsable(left.store)).toBe(true);
        expect(await isUsable(right.store)).toBe(true);
        expect(destroyedStoreErrors()).toEqual([]);
    });

    it('leaves the surviving root alone when its neighbor unmounts', async () => {
        const left: { store: ReactEzClassifyStore | null } = { store: null };
        const right: { store: ReactEzClassifyStore | null } = { store: null };
        const context = makeContext();
        function Two({ both }: { both: boolean }): ReactElement {
            return (
                <Page context={context}>
                    <Root testId="left" probe={left} />
                    {both ? <Root testId="right" probe={right} /> : null}
                </Page>
            );
        }
        const view = render(<Two both />);
        await flush();
        const survivor = left.store;

        view.rerender(<Two both={false} />);
        await flush();

        expect(await isUsable(survivor)).toBe(true);
    });

    it('enhances its fields without reaching a destroyed store', async () => {
        render(
            <Page context={makeContext()}>
                <Root testId="fields" />
            </Page>,
        );
        await flush();

        expect(destroyedStoreErrors()).toEqual([]);
        expect(
            document.querySelectorAll('[data-ezclassify-mount]').length,
        ).toBeGreaterThan(0);
    });
});
