/**
 * Nested-mount ownership boundary, React level (case C5).
 *
 * Companion to libs/ui/src/nested-mount-harness.spec.ts (the DOM/SDK-level
 * C1..C4). This file guards the same invariant through nested `<EzClassify>`
 * roots: each constructs its own EzClassifyUI, so the inner root's controller
 * sits under two overlapping roots.
 *
 * Invariant: a controller is enhanced once, by the root that owns it. Its
 * nearest mount-root ancestor is the inner root, so the outer root must skip
 * it. A regression would double-enhance the field and produce two mount
 * siblings.
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, afterEach } from 'vitest';
import { render, act, cleanup } from '@testing-library/react';
import type { ContextAdapter } from '@ezclassify/ui';
import { EzClassify, EzClassifyProvider } from './index';
import { connectDemoContext } from '../../../test-support/demo-runtime';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = resolve(__dirname, '../../../vendor/spec/fixtures/v1');

function loadScheme(): unknown {
    return JSON.parse(
        readFileSync(resolve(fixturesDir, 'ref-scheme-1.json'), 'utf8'),
    );
}

/** A fresh Context over the reference fixture. */
async function makeContext(): Promise<ContextAdapter> {
    return (await connectDemoContext({
        draft: {
            scheme: loadScheme(),
        },
    })) as unknown as ContextAdapter;
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

/** A field in its own root, nested inside the parent root below. */
function NestedRootField() {
    return (
        <EzClassify>
            <input data-ezclassify-controller="tags" id="c5-child-field" />
        </EzClassify>
    );
}

describe('nested-mount harness (React level)', () => {
    it('C5: a controller under nested roots is enhanced only by the root that owns it', async () => {
        const { container } = render(
            <EzClassifyProvider context={await makeContext()}>
                <EzClassify>
                    <NestedRootField />
                </EzClassify>
            </EzClassifyProvider>,
        );
        await flush();

        const field = container.querySelector('#c5-child-field') as HTMLElement;
        expect(field).not.toBeNull();

        const parent = field.parentElement!;
        const mounts = parent.querySelectorAll(
            ':scope > [data-ezclassify-mount]',
        );
        // Exactly one mount: the inner root owns the field; the outer root
        // skips it. Two would mean both enhanced it.
        expect(mounts.length).toBe(1);
    });
});
