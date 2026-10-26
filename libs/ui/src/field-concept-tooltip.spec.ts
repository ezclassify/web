import { describe, it, expect, vi } from 'vitest';
import {
    hideConceptTooltip,
    showConceptTooltip,
} from './field-concept-tooltip';
import type { FormsContext } from './forms/types';
import { mockRenderFormats } from './render-format-layout-mock';

function createMockCtx(overrides: Partial<FormsContext> = {}): FormsContext {
    const _profile = {
        concepts: [] as any[],
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
    };
    return {
        engine: {
            getScheme: () => _profile,
            getSchemeMeta: () => ({
                id: 'test',
                version: '1.0',
                name: 'Test',
                defaultRenderFormat: 'default',
                formats: mockRenderFormats(_profile.formats),
                scopes: [],
            }),
            listCategories: () => _profile.categories,
            getConceptsInCategory: (catId: string) =>
                _profile.concepts.filter((c: any) =>
                    c.categories?.includes(catId),
                ),
            render: vi.fn().mockReturnValue(''),
            process: vi
                .fn()
                .mockReturnValue({ assertions: [], rendered: '', valid: true }),
            suggest: vi.fn().mockReturnValue({ suggestions: [] }),
        } as any,
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
        ...overrides,
    } as FormsContext;
}

describe('field-concept-tooltip', () => {
    describe('showConceptTooltip', () => {
        /** A scheme with one category holding a parent and its child. */
        function ctxWithConcepts(): FormsContext {
            const ctx = createMockCtx();
            const categories = [{ id: 'level', label: 'Level' }];
            const concepts = [
                {
                    id: 'parent',
                    name: 'Parent',
                    views: { default: 'P' },
                    categories: ['level'],
                    parents: [],
                    aliases: [],
                },
                {
                    id: 'child',
                    name: 'Child',
                    views: { default: 'C' },
                    categories: ['level'],
                    parents: ['parent'],
                    aliases: [],
                },
            ];
            (ctx.engine as unknown as Record<string, unknown>).listCategories =
                () => categories;
            (
                ctx.engine as unknown as Record<string, unknown>
            ).getConceptsInCategory = () => concepts;
            return ctx;
        }

        /**
         * The tooltip asks the engine for one thing: whether the hovered
         * concept was inferred. An empty marking carries no assertions to read
         * that from, so the call is a round trip under a remote engine that can
         * only answer "nothing".
         */
        it('does not process an empty marking', async () => {
            const ctx = ctxWithConcepts();
            const field = document.createElement('input');

            await showConceptTooltip(ctx, field, 'child', 10, 10);

            expect(ctx.engine.process).not.toHaveBeenCalled();
            expect(ctx.tooltipEl).not.toBeNull();
            hideConceptTooltip(ctx);
        });

        it('names a parent concept resolved from another category walk', async () => {
            const ctx = ctxWithConcepts();
            const field = document.createElement('input');
            ctx.lastValidated.set(field, 'C');

            await showConceptTooltip(ctx, field, 'child', 10, 10);

            expect(ctx.tooltipEl?.innerHTML).toContain('Parents: Parent');
            hideConceptTooltip(ctx);
        });
    });

    describe('hideConceptTooltip', () => {
        it('removes tooltip element and sets to null', () => {
            const ctx = createMockCtx();
            const tip = document.createElement('div');
            document.body.appendChild(tip);
            ctx.tooltipEl = tip;

            hideConceptTooltip(ctx);

            expect(ctx.tooltipEl).toBeNull();
            expect(document.body.contains(tip)).toBe(false);
        });

        it('does nothing when tooltipEl is null', () => {
            const ctx = createMockCtx();
            ctx.tooltipEl = null;

            hideConceptTooltip(ctx);

            expect(ctx.tooltipEl).toBeNull();
        });
    });
});
