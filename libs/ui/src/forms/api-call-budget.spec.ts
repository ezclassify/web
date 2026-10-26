import { describe, it, expect, vi, beforeEach } from 'vitest';
import { updateRollup } from './rollup';
import type { FormsContext } from './types';
import type { ComponentInstance } from '../components/component-base';
import { mockRenderFormats } from '../render-format-layout-mock';

vi.mock('./dom', () => ({
    showCopiedIndicator: vi.fn(),
}));

interface MockAssertion {
    conceptId: string;
    categoryId: string;
    confidence: string;
    source: string;
}

function createMockEngine() {
    const _profile = {
        concepts: [] as MockAssertion[],
        categories: [] as any[],
        formats: [
            {
                id: 'default',
                categoryOrder: [],
                separator: ' ',
                categorySeparator: '//',
                view: 'default',
            },
        ],
        scopes: [],
        defaultRenderFormat: 'default',
    };
    return {
        getScheme: vi.fn(() => _profile),
        getSchemeMeta: vi.fn(() => ({
            id: 'test',
            version: '1.0',
            name: 'Test',
            defaultRenderFormat: 'default',
            formats: mockRenderFormats(_profile.formats),
            scopes: [],
        })),
        listCategories: vi.fn(() => _profile.categories),
        getConceptsInCategory: vi.fn((_catId: string) => []),
        render: vi.fn((_assertions: MockAssertion[]) => ''),
        process: vi.fn((input: string) => ({
            assertions: input
                ? [
                      {
                          conceptId: input,
                          categoryId: 'level',
                          confidence: 'certain',
                          source: 'parse',
                      },
                  ]
                : [],
            rendered: input,
            valid: true,
        })),
        suggest: vi.fn(() => ({ suggestions: [] })),
        aggregate: vi.fn((values: string[]) => ({
            assertions: [],
            rendered: values.join('|'),
            valid: true,
        })),
    };
}

function createMockCtx(overrides: Partial<FormsContext> = {}): FormsContext {
    return {
        engine: createMockEngine() as unknown as FormsContext['engine'],
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

function createMockComponent(rendered: string): ComponentInstance {
    return {
        init: vi.fn(),
        getAssertions: vi.fn(() => []),
        setAssertions: vi.fn(),
        setValue: vi.fn(),
        destroy: vi.fn(),
        getRendered: vi.fn(() => rendered),
    };
}

describe('API call budget: updateRollup', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('calls aggregate exactly once per rollup with N populated fields', async () => {
        const rollupField = document.createElement('input');
        const ctx = createMockCtx({ rollupField });

        const fieldA = document.createElement('input');
        fieldA.value = 'ALPHA';
        const fieldB = document.createElement('input');
        fieldB.value = 'BRAVO';
        const fieldC = document.createElement('input');
        fieldC.value = 'CHARLIE';
        ctx.fields.push(fieldA, fieldB, fieldC);

        await updateRollup(ctx);

        expect(ctx.engine.aggregate).toHaveBeenCalledTimes(1);
        const callArgs = (ctx.engine.aggregate as ReturnType<typeof vi.fn>).mock
            .calls[0];
        expect(callArgs[0]).toEqual(['ALPHA', 'BRAVO', 'CHARLIE']);
    });

    it('does not call aggregate when all fields are empty', async () => {
        const rollupField = document.createElement('input');
        const ctx = createMockCtx({ rollupField });

        const fieldA = document.createElement('input');
        fieldA.value = '';
        const fieldB = document.createElement('input');
        fieldB.value = '   ';
        ctx.fields.push(fieldA, fieldB);

        await updateRollup(ctx);

        expect(ctx.engine.aggregate).not.toHaveBeenCalled();
    });

    it('does not call aggregate when there are no fields or components', async () => {
        const rollupField = document.createElement('input');
        const ctx = createMockCtx({ rollupField });

        await updateRollup(ctx);

        expect(ctx.engine.aggregate).not.toHaveBeenCalled();
    });

    it('does not call suggest during rollup', async () => {
        const rollupField = document.createElement('input');
        const ctx = createMockCtx({ rollupField });

        const field = document.createElement('input');
        field.value = 'DATA';
        ctx.fields.push(field);

        await updateRollup(ctx);

        expect(ctx.engine.suggest).not.toHaveBeenCalled();
    });

    /**
     * One populated field is one validation. A repeat rollup over unchanged
     * values is served from this engine's rollup cache.
     */
    it('calls process once per populated field and reuses it on a repeat rollup', async () => {
        const rollupField = document.createElement('input');
        const ctx = createMockCtx({ rollupField });

        const field = document.createElement('input');
        field.value = 'DATA';
        ctx.fields.push(field);

        await updateRollup(ctx);
        expect(ctx.engine.process).toHaveBeenCalledTimes(1);

        await updateRollup(ctx);
        expect(ctx.engine.process).toHaveBeenCalledTimes(1);
    });

    it('scoped components do not trigger aggregate', async () => {
        const rollupField = document.createElement('input');
        const ctx = createMockCtx({ rollupField });

        const scopedEl = document.createElement('div');
        scopedEl.setAttribute('data-ezclassify-scope', 'authority');
        const comp = createMockComponent('scoped-value');
        ctx.mounted.set(scopedEl, comp);

        await updateRollup(ctx);

        expect(ctx.engine.aggregate).not.toHaveBeenCalled();
    });

    it('mixes scoped and unscoped: only unscoped values go to aggregate', async () => {
        const rollupField = document.createElement('input');
        const ctx = createMockCtx({ rollupField });

        const scopedEl = document.createElement('div');
        scopedEl.setAttribute('data-ezclassify-scope', 'authority');
        ctx.mounted.set(scopedEl, createMockComponent('scoped-value'));

        const unscopedEl = document.createElement('div');
        ctx.mounted.set(unscopedEl, createMockComponent('unscoped-value'));

        await updateRollup(ctx);

        expect(ctx.engine.aggregate).toHaveBeenCalledTimes(1);
        const values = (ctx.engine.aggregate as ReturnType<typeof vi.fn>).mock
            .calls[0][0];
        expect(values).toEqual(['unscoped-value']);
    });

    it('skips rollup during initialization', async () => {
        const rollupField = document.createElement('input');
        const ctx = createMockCtx({ rollupField, initializing: true } as any);

        const field = document.createElement('input');
        field.value = 'DATA';
        ctx.fields.push(field);

        await updateRollup(ctx);

        expect(ctx.engine.aggregate).not.toHaveBeenCalled();
    });

    it('does not call aggregate when rollupField is null', async () => {
        const ctx = createMockCtx({ rollupField: null });

        const field = document.createElement('input');
        field.value = 'DATA';
        ctx.fields.push(field);

        await updateRollup(ctx);

        expect(ctx.engine.aggregate).not.toHaveBeenCalled();
    });

    it('single field with value calls aggregate exactly once', async () => {
        const rollupField = document.createElement('input');
        const ctx = createMockCtx({ rollupField });

        const field = document.createElement('input');
        field.value = 'SINGLE';
        ctx.fields.push(field);

        await updateRollup(ctx);

        expect(ctx.engine.aggregate).toHaveBeenCalledTimes(1);
        const values = (ctx.engine.aggregate as ReturnType<typeof vi.fn>).mock
            .calls[0][0];
        expect(values).toEqual(['SINGLE']);
    });

    it('fields with data-ezclassify-no-rollup are excluded from aggregate', async () => {
        const rollupField = document.createElement('input');
        const ctx = createMockCtx({ rollupField });

        const normalField = document.createElement('input');
        normalField.value = 'NORMAL';
        ctx.fields.push(normalField);

        const excludedField = document.createElement('input');
        excludedField.value = 'EXCLUDED';
        excludedField.setAttribute('data-ezclassify-no-rollup', '');
        ctx.fields.push(excludedField);

        await updateRollup(ctx);

        expect(ctx.engine.aggregate).toHaveBeenCalledTimes(1);
        const values = (ctx.engine.aggregate as ReturnType<typeof vi.fn>).mock
            .calls[0][0];
        expect(values).toEqual(['NORMAL']);
    });
});
