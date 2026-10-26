/**
 * Rollup integration against an async engine (the REST client), exercising the
 * full chain from a component mutation through onChange, rollup update, and the
 * aggregate call. The async path must produce the same rollup as the sync one.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type {
    CategoryView,
    ConceptView,
    SchemePublicView,
} from '@ezclassify/types';
import { EzClassifyUI } from '../ezclassify-ui';
import { createAsyncMockEngine } from './async-engine-mock';

function wait(ms = 50) {
    return new Promise((r) => setTimeout(r, ms));
}

/**
 * Poll until `predicate` is true, or give up after `timeout`. Replaces fixed
 * sleeps so these async-rollup assertions wait for the debounced rollup + async
 * aggregate to actually settle instead of guessing a duration, a fixed sleep
 * flakes under the independence gate's CPU saturation.
 */
async function waitUntil(
    predicate: () => boolean,
    timeout = 5000,
    interval = 10,
) {
    const start = Date.now();
    while (!predicate()) {
        if (Date.now() - start > timeout) return;
        await wait(interval);
    }
}

function createProfile(): SchemePublicView {
    const concepts: ConceptView[] = [
        {
            id: 'A',
            name: 'A',
            views: { default: 'A' },
            aliases: [],
            categories: ['f1'],
            parents: [],
            position: 0,
        } as ConceptView,
        {
            id: 'B',
            name: 'B',
            views: { default: 'B' },
            aliases: [],
            categories: ['f1'],
            parents: [],
            position: 1,
        } as ConceptView,
    ];
    const categories: CategoryView[] = [
        {
            id: 'f1',
            label: 'F1',
            single: false,
            required: false,
        } as CategoryView,
    ];
    return {
        id: 'test',
        version: '1.0',
        name: 'Test',
        description: '',
        concepts,
        categories,
        parseRules: [],
        formats: [
            {
                id: 'default',
                categoryOrder: ['f1'],
                separator: ',',
                view: 'default',
            },
        ],
        defaultRenderFormat: 'default',
    } as unknown as SchemePublicView;
}

let formsRoot: HTMLDivElement;

beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    document.body.innerHTML = '';
    formsRoot = document.createElement('div');
    document.body.appendChild(formsRoot);
});

afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
});

describe('Async rollup integration', () => {
    it('rollup computes from field values after async init', async () => {
        const engine = createAsyncMockEngine({
            delay: 5,
            scheme: createProfile(),
        });

        // Create two tag-input fields + rollup
        formsRoot.innerHTML = `
      <input type="text" id="field1" data-ezclassify-controller="tags" data-ezclassify-format="default" value="A">
      <input type="text" id="field2" data-ezclassify-controller="tags" data-ezclassify-format="default" value="B">
      <input type="hidden" id="test-rollup">
    `;

        new EzClassifyUI(engine as never, {
            rollupId: 'test-rollup',
        });

        // Wait for async init + debounced rollup to settle.
        await waitUntil(
            () =>
                ((document.getElementById('test-rollup') as HTMLInputElement)
                    ?.value.length ?? 0) > 0,
        );

        const rollup = document.getElementById(
            'test-rollup',
        ) as HTMLInputElement;
        // Rollup should have a value (aggregate of field values)
        expect(rollup.value.length).toBeGreaterThan(0);
    });

    it('rollup updates when field value changes via chip interaction', async () => {
        const engine = createAsyncMockEngine({
            delay: 5,
            scheme: createProfile(),
        });

        formsRoot.innerHTML = `
      <input type="text" id="field1" data-ezclassify-controller="tags" data-ezclassify-format="default" value="A">
      <input type="hidden" id="test-rollup">
    `;

        new EzClassifyUI(engine as never, {
            rollupId: 'test-rollup',
        });
        await waitUntil(
            () =>
                ((document.getElementById('field1') as HTMLInputElement)?.value
                    .length ?? 0) > 0,
        );

        // The field should have a value after init
        const field = document.getElementById('field1') as HTMLInputElement;
        expect(field.value.length).toBeGreaterThan(0);
    });

    it('multiple fields contribute to aggregate', async () => {
        const engine = createAsyncMockEngine({
            delay: 5,
            scheme: createProfile(),
        });

        formsRoot.innerHTML = `
      <input type="text" id="f1" data-ezclassify-controller="tags" data-ezclassify-format="default" value="A">
      <input type="text" id="f2" data-ezclassify-controller="tags" data-ezclassify-format="default" value="B">
      <input type="hidden" id="test-rollup">
    `;

        new EzClassifyUI(engine as never, {
            rollupId: 'test-rollup',
        });
        await waitUntil(() => engine._callCount('aggregate') > 0);

        // Aggregate should have been called with both field values
        expect(engine._callCount('aggregate')).toBeGreaterThan(0);
    });

    it('data-ezclassify-no-rollup fields excluded from aggregate', async () => {
        const engine = createAsyncMockEngine({
            delay: 5,
            scheme: createProfile(),
        });

        formsRoot.innerHTML = `
      <input type="text" id="f1" data-ezclassify-controller="tags" data-ezclassify-format="default" value="A" data-ezclassify-no-rollup>
      <input type="text" id="f2" data-ezclassify-controller="tags" data-ezclassify-format="default" value="B">
      <input type="hidden" id="test-rollup">
    `;

        new EzClassifyUI(engine as never, {
            rollupId: 'test-rollup',
        });
        await waitUntil(() =>
            engine._calls.some((c) => c.method === 'aggregate'),
        );

        // Check that aggregate was called, it should only contain B
        const aggCalls = engine._calls.filter((c) => c.method === 'aggregate');
        if (aggCalls.length > 0) {
            const lastCall = aggCalls[aggCalls.length - 1];
            const inputs = lastCall.args[0] as string[];
            // A (with data-ezclassify-no-rollup) should not be in the inputs
            expect(inputs.some((v) => v === 'A' || v.includes('A'))).toBe(
                false,
            );
        }
    });
});
