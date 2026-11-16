/**
 * The handbook leads with a marked scheme's overall marking as the engine
 * reports it. Read through the real engine over the marked conformance scheme,
 * so the marking shown is the engine's answer, not a value the spec supplies.
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { EzClassifyUI } from '../ezclassify-ui';
import type { EzClassifyClient } from '@ezclassify/rest-client';
import { connectDemoContext } from '../../../../test-support/demo-runtime';

const fixtures = resolve(
    dirname(fileURLToPath(import.meta.url)),
    '../../../../vendor/spec/fixtures/v1',
);

function scheme(name: string): unknown {
    return JSON.parse(readFileSync(resolve(fixtures, `${name}.json`), 'utf8'));
}

describe('the handbook over a marked scheme', () => {
    let ui: EzClassifyUI | null = null;
    let root: HTMLElement | null = null;

    afterEach(() => {
        ui?.destroy();
        root?.remove();
    });

    async function mount(name: string): Promise<{
        context: EzClassifyClient;
        page: HTMLElement;
    }> {
        root = document.createElement('div');
        root.innerHTML = `<div data-ezclassify-controller="handbook"></div>`;
        document.body.appendChild(root);
        const context = await connectDemoContext({
            draft: { scheme: scheme(name) },
        });
        ui = new EzClassifyUI(context, { root });
        return {
            context,
            // The handbook renders in the mount beside its host.
            page: root,
        };
    }

    it('shows the overall marking the engine reports for the scheme', async () => {
        const { context, page } = await mount('ref-marked-1');
        const reported = context.scheme.getScheme().marking;
        expect(reported).toBeTruthy();
        await expect
            .poll(
                () =>
                    page.querySelector('.ez-handbook__overview-marking')
                        ?.textContent,
            )
            .toBe(`Overall marking: ${reported}`);
    });

    it('shows no overall marking for a scheme that carries none', async () => {
        const { page } = await mount('ref-scheme-1');
        await expect
            .poll(() => page.querySelector('.ez-handbook__overview'))
            .not.toBeNull();
        expect(page.querySelector('.ez-handbook__overview-marking')).toBeNull();
    });
});
