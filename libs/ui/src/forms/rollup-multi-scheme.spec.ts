/**
 * @vitest-environment jsdom
 *
 * Per-profile rollup output.
 *
 * Verifies that updateRollup emits `data-rendered-<schemeId>` per contributing
 * profile and clears stale entries when a profile stops contributing.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { updateRollup } from './rollup';
import type { SchemeEngineAdapter } from '@ezclassify/types';
import type { FormsContext } from './types';
import type { ComponentInstance } from '../components/component-base';
import { mockRenderFormat } from '../render-format-layout-mock';

vi.mock('./dom', () => ({ showCopiedIndicator: vi.fn() }));

function createMultiProfileEngine() {
    return {
        loadScheme: vi.fn(),
        listSchemes: () => [
            { id: 'alpha', name: 'alpha', version: '1.0.0', isDefault: true },
            { id: 'beta', name: 'beta', version: '1.0.0', isDefault: false },
        ],
        getDefaultScheme: () => ({
            id: 'alpha',
            name: 'alpha',
            version: '1.0.0',
            isDefault: true,
        }),
        getScheme: (_id?: string) => ({
            id: _id ?? 'alpha',
            concepts: [],
            categories: [],
            formats: [
                {
                    id: 'default',
                    categoryOrder: [],
                    separator: ' ',
                    categorySeparator: '//',
                    view: 'default',
                },
            ],
            vocabulary: {
                whole: { singular: 'banner', plural: 'banners' },
                part: { singular: 'portion', plural: 'portions' },
            },
        }),
        getSchemeMeta: (_id?: string) => ({
            id: _id ?? 'alpha',
            version: '1.0.0',
            name: _id ?? 'alpha',
            defaultRenderFormat: 'default',
            formats: [
                mockRenderFormat({
                    id: 'default',
                    view: 'default',
                    categorySeparator: '//',
                    separator: ' ',
                    categoryOrder: [],
                }),
            ],
            scopes: [],
            vocabulary: {
                whole: { singular: 'banner', plural: 'banners' },
                part: { singular: 'portion', plural: 'portions' },
            },
        }),
        listCategories: (_id?: string) => [],
        getConceptsInCategory: (_catId: string, _id?: string) => [],
        process: vi.fn((input: string, _schemeIdOrOpts?: string | unknown) => ({
            assertions: [],
            rendered: input,
            valid: true,
        })),
        suggest: vi.fn(() => ({ suggestions: [] })),
        render: vi.fn((assertions: any[]) =>
            assertions.map((a: any) => a.conceptId).join(','),
        ),
        aggregate: vi.fn((values: string[], a?: string | unknown) => ({
            assertions: [],
            // Tag the rendered output with whichever profile id was passed so tests
            // can assert per-profile routing.
            rendered:
                typeof a === 'string'
                    ? `${a}:${values.join('+')}`
                    : values.join('+'),
            valid: true,
        })),
        checkCoverage: vi.fn(async () => ({
            covered: true,
            missing: [],
            missingLabels: [],
            excess: [],
            excessLabels: [],
            rendered: '',
        })),
        uncoveredAssertions: vi.fn(() => []),
    } as unknown as SchemeEngineAdapter;
}

function createMockCtx(overrides: Partial<FormsContext> = {}): FormsContext {
    return {
        engine: createMultiProfileEngine(),
        schemeAddressing: true,
        root: document.body,
        fields: [],
        rollupField: null,
        defaultFormat: 'default',
        domObserver: null,
        autocompleters: new Map(),
        lastValidated: new Map(),
        fieldAssertions: new Map(),
        tooltipEl: null,
        settingValue: false,
        colorMap: {},
        selectorAttr: 'ezclassify',
        mounted: new Map(),
        partOfMap: new Map(),
        targetMap: new Map(),
        initializing: false,
        ...overrides,
    } as FormsContext;
}

function createComponent(
    rendered: string,
    schemeId?: string,
): ComponentInstance {
    const comp: any = {
        init: vi.fn(),
        getAssertions: vi.fn(() => []),
        setAssertions: vi.fn(),
        destroy: vi.fn(),
        getRendered: vi.fn(() => rendered),
    };
    if (schemeId) comp.schemeId = schemeId;
    return comp;
}

describe('forms/rollup: per-profile output', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
    });

    it('single-profile rollup emits one data-rendered-<schemeId>', async () => {
        const rollupField = document.createElement('input');
        document.body.appendChild(rollupField);
        const ctx = createMockCtx({ rollupField });

        const el = document.createElement('div');
        document.body.appendChild(el);
        ctx.mounted.set(el, createComponent('A', 'alpha'));

        await updateRollup(ctx);
        await new Promise((r) => setTimeout(r, 50));

        expect(rollupField.getAttribute('data-rendered-alpha')).toBe('alpha:A');
        expect(rollupField.getAttribute('data-rendered-beta')).toBeNull();
        expect(rollupField.value).toBe('alpha:A');
    });

    it('multi-profile rollup emits two data-rendered-* attrs, contents per profile', async () => {
        const rollupField = document.createElement('input');
        document.body.appendChild(rollupField);
        const ctx = createMockCtx({ rollupField });

        const elA = document.createElement('div');
        document.body.appendChild(elA);
        ctx.mounted.set(elA, createComponent('A', 'alpha'));

        const elB = document.createElement('div');
        document.body.appendChild(elB);
        ctx.mounted.set(elB, createComponent('B', 'beta'));

        await updateRollup(ctx);
        await new Promise((r) => setTimeout(r, 50));

        expect(rollupField.getAttribute('data-rendered-alpha')).toBe('alpha:A');
        expect(rollupField.getAttribute('data-rendered-beta')).toBe('beta:B');
        // value falls back to the engine's default profile (alpha) when more than
        // one profile contributes.
        expect(rollupField.value).toBe('alpha:A');
    });

    it('removing a contributing profile clears its stale data-rendered-* attribute', async () => {
        const rollupField = document.createElement('input');
        document.body.appendChild(rollupField);
        const ctx = createMockCtx({ rollupField });

        const elA = document.createElement('div');
        document.body.appendChild(elA);
        const compA = createComponent('A', 'alpha');
        ctx.mounted.set(elA, compA);

        const elB = document.createElement('div');
        document.body.appendChild(elB);
        ctx.mounted.set(elB, createComponent('B', 'beta'));

        await updateRollup(ctx);
        await new Promise((r) => setTimeout(r, 50));
        expect(rollupField.getAttribute('data-rendered-beta')).toBe('beta:B');

        // Drop the beta component and re-run.
        ctx.mounted.delete(elB);
        await updateRollup(ctx);
        await new Promise((r) => setTimeout(r, 50));

        expect(rollupField.getAttribute('data-rendered-alpha')).toBe('alpha:A');
        expect(rollupField.getAttribute('data-rendered-beta')).toBeNull();
    });

    it('falls back to ezclassify-scheme attribute on bare input fields', async () => {
        const rollupField = document.createElement('input');
        document.body.appendChild(rollupField);
        const fieldA = document.createElement('input');
        fieldA.setAttribute('data-ezclassify-scheme', 'alpha');
        fieldA.value = 'A';
        const fieldB = document.createElement('input');
        fieldB.setAttribute('data-ezclassify-scheme', 'beta');
        fieldB.value = 'B';
        document.body.append(fieldA, fieldB);

        const ctx = createMockCtx({ rollupField, fields: [fieldA, fieldB] });

        await updateRollup(ctx);
        await new Promise((r) => setTimeout(r, 50));

        expect(rollupField.getAttribute('data-rendered-alpha')).toBe('alpha:A');
        expect(rollupField.getAttribute('data-rendered-beta')).toBe('beta:B');
    });

    it('does not assign a bare field to an arbitrary scheme without a default', async () => {
        const rollupField = document.createElement('input');
        const field = document.createElement('input');
        field.value = 'A';
        document.body.append(rollupField, field);
        const engine = createMultiProfileEngine();
        engine.getDefaultScheme = () => null;
        const ctx = createMockCtx({ engine, rollupField, fields: [field] });

        await updateRollup(ctx);

        expect(rollupField.hasAttribute('data-rendered-alpha')).toBe(false);
        expect(rollupField.value).toBe('');
    });

    it('emits ezclassify:rollup event with byScheme detail', async () => {
        const rollupField = document.createElement('input');
        document.body.appendChild(rollupField);
        const ctx = createMockCtx({ rollupField });

        const elA = document.createElement('div');
        document.body.appendChild(elA);
        ctx.mounted.set(elA, createComponent('A', 'alpha'));
        const elB = document.createElement('div');
        document.body.appendChild(elB);
        ctx.mounted.set(elB, createComponent('B', 'beta'));

        let detail: {
            rendered?: string;
            byScheme?: Record<string, string>;
        } | null = null;
        rollupField.addEventListener('ezclassify:rollup', (e) => {
            detail = (e as CustomEvent).detail;
        });

        await updateRollup(ctx);
        await new Promise((r) => setTimeout(r, 50));

        expect(detail).not.toBeNull();
        expect(detail!.byScheme).toEqual({ alpha: 'alpha:A', beta: 'beta:B' });
    });
});
