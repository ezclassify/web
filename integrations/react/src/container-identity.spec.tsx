/**
 * The `Container` a host renders has to survive the hook's own state updates.
 *
 * React keys a subtree on its component's function identity. `useSchemeEngine`
 * sets state after it constructs EzClassifyUI, so a `Container` redefined on
 * every render is a different element type on the very next one: React tears
 * down the div this hook just scanned, mounts a fresh one, and everything
 * EzClassifyUI inserted goes with it. The construction effect does not re-run,
 * because its dependencies did not change, so the surfaces never come back.
 *
 * That is invisible to a host whose engine is ready on the first render only
 * because the damage lands before anyone looks. It is not invisible to a host
 * whose engine arrives asynchronously, which is every REST consumer: the
 * components mounted and were removed in the same tick, and the page showed a
 * plain textarea an author would take for a working marking field.
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { useEffect, useState, type ReactElement } from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, act, cleanup, screen } from '@testing-library/react';
import { Context } from '@ezclassify/engine';
import type { LocalSchemeEngineAdapter } from '@ezclassify/types';
import { EzClassifyProvider, useSchemeEngine } from './index';

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

/** The one controller both hosts below put inside their container. */
function MarkingHost(): ReactElement {
    return <textarea data-testid="host" data-ezclassify-controller="marking" />;
}

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

/** The app-level shape: the provider names the engine, the hook drives it. */
function ProvidedHost(): ReactElement {
    const { Container } = useSchemeEngine();
    return (
        <Container>
            <MarkingHost />
        </Container>
    );
}

/**
 * A host that connects asynchronously: the engine is null on the first render
 * and arrives a tick later, which is the shape of every REST consumer.
 */
function LateProvider(): ReactElement {
    const [engine, setEngine] = useState<LocalSchemeEngineAdapter | null>(null);
    useEffect(() => {
        const timer = setTimeout(() => setEngine(makeEngine()), 10);
        return () => clearTimeout(timer);
    }, []);
    return (
        <EzClassifyProvider engine={engine}>
            <ProvidedHost />
        </EzClassifyProvider>
    );
}

/** The per-subtree override: the hook builds and owns the store itself. */
function LateOverrideHost(): ReactElement {
    const [engine, setEngine] = useState<LocalSchemeEngineAdapter | null>(null);
    useEffect(() => {
        const timer = setTimeout(() => setEngine(makeEngine()), 10);
        return () => clearTimeout(timer);
    }, []);
    const { Container } = useSchemeEngine(engine);
    return (
        <Container>
            <MarkingHost />
        </Container>
    );
}

describe('the container survives the hook settling', () => {
    it('leaves the mount in place when the engine arrives late', async () => {
        render(<LateProvider />);
        await flush();

        expect(screen.getByTestId('host')).toBeDefined();
        const mounts = document.querySelectorAll('[data-ezclassify-mount]');
        expect(mounts).toHaveLength(1);
        expect(mounts[0]?.isConnected).toBe(true);
        // The scanned root is the one still on the page: a remount would have
        // left EzClassifyUI holding a detached div.
        expect(
            mounts[0]?.closest('[data-ezclassify-mount-root]')?.isConnected,
        ).toBe(true);
    });

    it('leaves the mount in place under a per-subtree engine override', async () => {
        render(<LateOverrideHost />);
        await flush();

        expect(
            document.querySelectorAll('[data-ezclassify-mount]'),
        ).toHaveLength(1);
    });
    it('rebuilds an override for a new format without scanning a destroyed store', async () => {
        const engine = makeEngine();
        const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
        function Host({ format }: { format: string }): ReactElement {
            const { Container } = useSchemeEngine(engine, { format });
            return (
                <Container>
                    <MarkingHost />
                </Container>
            );
        }
        const page = render(<Host format="default" />);
        await flush();
        page.rerender(<Host format="portion" />);
        await flush();

        expect(
            document.querySelectorAll('[data-ezclassify-mount]'),
        ).toHaveLength(1);
        expect(errors).not.toHaveBeenCalled();
    });
});
