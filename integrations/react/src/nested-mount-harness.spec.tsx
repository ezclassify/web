/**
 * Nested-mount ownership boundary, React level (case C5).
 *
 * Companion to libs/ui/src/nested-mount-harness.spec.ts (the DOM/SDK-level
 * C1..C4). This file guards the same invariant through the React integration's
 * useSchemeEngine hook.
 *
 * The shape: a parent component calls useSchemeEngine on a provider region; a
 * CHILD component nested inside it (a nested-scope field) ALSO calls
 * useSchemeEngine on its own wrapper, which contains one controller element.
 * Each useSchemeEngine constructs its own EzClassifyUI, so the child's
 * controller sits under two overlapping roots: the parent's region ref and the
 * child's wrapper ref.
 *
 * Invariant: a controller is enhanced once, by the scope that owns it. The
 * child controller's nearest mount-root ancestor is the child scope's root, so
 * the enclosing parent scope must skip it. A regression would double-enhance
 * the field and produce two mount siblings.
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, afterEach } from 'vitest';
import { render, act, cleanup } from '@testing-library/react';
import { Context } from '@ezclassify/engine';
import type { LocalSchemeEngineAdapter } from '@ezclassify/types';
import { useSchemeEngine } from './index';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = resolve(__dirname, '../../../vendor/spec/fixtures/v1');

function loadScheme(): unknown {
    return JSON.parse(
        readFileSync(resolve(fixturesDir, 'ref-scheme-1.json'), 'utf8'),
    );
}

/** A fresh, standalone scheme engine adapter from the reference fixture. */
function makeEngine(): LocalSchemeEngineAdapter {
    return Context.fromComponents({ scheme: loadScheme() })
        .scheme as LocalSchemeEngineAdapter;
}

/** Flush React effects plus EzClassifyUI's async component-init + rollup. */
async function flush(): Promise<void> {
    await act(async () => {
        for (let i = 0; i < 6; i++) {
            await new Promise<void>((r) => setTimeout(r, 25));
        }
    });
}

afterEach(() => cleanup());

/**
 * A nested-scope field: a child that opens its OWN useSchemeEngine scope on a
 * wrapper holding a single controller element.
 */
function NestedScopeField({ engine }: { engine: LocalSchemeEngineAdapter }) {
    const { ref } = useSchemeEngine(engine, { rollupId: 'c5-child-rollup' });
    return (
        <div ref={ref} data-testid="c5-child-region">
            <input data-ezclassify-controller="tags" id="c5-child-field" />
        </div>
    );
}

/** Parent provider-region that ALSO opens a useSchemeEngine scope. */
function ParentRegion({ engine }: { engine: LocalSchemeEngineAdapter }) {
    const { ref } = useSchemeEngine(engine, { rollupId: 'c5-parent-rollup' });
    return (
        <div ref={ref} data-testid="c5-parent-region">
            <NestedScopeField engine={engine} />
        </div>
    );
}

describe('nested-mount harness (React level)', () => {
    it('C5: a controller under nested useSchemeEngine scopes is enhanced only by its owning scope', async () => {
        // Two distinct engine identities so each useSchemeEngine builds its own
        // EzClassifyUI (a single shared identity would still build two instances,
        // one per hook call, but keeping them distinct mirrors a host that passes
        // a region-scoped engine to each level and avoids any future identity-dedup
        // masking the count).
        const { container } = render(<ParentRegion engine={makeEngine()} />);
        await flush();

        const field = container.querySelector('#c5-child-field') as HTMLElement;
        expect(field).not.toBeNull();

        const parent = field.parentElement!;
        const mounts = parent.querySelectorAll(
            ':scope > [data-ezclassify-mount]',
        );
        // Exactly one mount: the child scope owns the field; the parent scope skips
        // it. Two would mean both scopes enhanced it (the regression this guards).
        expect(mounts.length).toBe(1);
    });
});
