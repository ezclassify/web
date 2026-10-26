import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { HiddenAssertionField } from './hidden-assertion-field';
import type {
    SchemeEngineAdapter,
    Assertion,
    ValidationError,
} from '@ezclassify/types';
import type { SchemePublicView } from '@ezclassify/types';
import { Context } from '@ezclassify/engine';
import { mockRenderFormats } from '../render-format-layout-mock';

function createMockEngine(): SchemeEngineAdapter {
    const scheme: SchemePublicView = {
        name: 'Test',
        categories: [
            { id: 'cat1', label: 'Cat 1', single: false, required: false },
        ],
        concepts: [
            {
                id: 'c1',
                name: 'Concept 1',
                views: { default: 'C1' },
                categories: ['cat1'],
                parents: [],
                aliases: [],
                position: 0,
            },
            {
                id: 'c2',
                name: 'Concept 2',
                views: { default: 'C2' },
                categories: ['cat1'],
                parents: [],
                aliases: [],
                position: 1,
            },
        ],
        formats: [
            {
                id: 'default',
                categoryOrder: ['cat1'],
                separator: ', ',
                categorySeparator: '//',
                view: 'default',
            },
        ],
        scopes: [],
        defaultRenderFormat: 'default',
    } as unknown as SchemePublicView;

    return {
        getScheme: () => scheme,
        getSchemeMeta: () => ({
            id: (scheme as any).id ?? 'test',
            version: (scheme as any).version ?? '1.0',
            name: scheme.name ?? 'Test',
            defaultRenderFormat:
                (scheme as any).defaultRenderFormat ?? 'default',
            formats: mockRenderFormats(scheme.formats ?? []),
            scopes: (scheme as any).scopes ?? [],
        }),
        listCategories: () => scheme.categories ?? [],
        getConceptsInCategory: (catId: string) =>
            (scheme.concepts ?? []).filter((c: any) =>
                c.categories?.includes(catId),
            ),
        render: vi.fn((assertions: Assertion[]) => ({
            rendered: assertions.map((a) => a.conceptId).join(', '),
            assessment: {
                emitted: [],
                omitted: [],
                collapsed: [],
                conflicts: [],
                unrepresentable: [],
            },
        })),
        validate: vi.fn((input: string) => {
            const ids = input
                .split(',')
                .map((s) => s.trim())
                .filter(Boolean);
            const assertions = ids.map((id) => ({
                conceptId: id,
                categoryId: 'cat1',
                confidence: 'certain' as const,
                source: 'parse' as const,
            }));
            return { assertions, rendered: input, valid: true };
        }),
        suggest: vi.fn().mockReturnValue({ suggestions: [] }),
    } as unknown as SchemeEngineAdapter;
}

const toCtx = (eng: unknown) => Context.fromSchemeEngine(eng as never);
describe('HiddenAssertionField', () => {
    let container: HTMLDivElement;
    let engine: SchemeEngineAdapter;
    let field: HiddenAssertionField;

    beforeEach(async () => {
        container = document.createElement('div');
        document.body.appendChild(container);
        engine = createMockEngine();
        field = new HiddenAssertionField();
    });

    afterEach(() => {
        try {
            field.destroy();
        } catch {
            /* field may not have been initialized */
        }
        container.remove();
    });

    it('hides the container on init', async () => {
        await field.init(container, toCtx(engine));
        expect(container.style.display).toBe('none');
    });

    it('sets data-ezclassify attribute', async () => {
        await field.init(container, toCtx(engine));
        expect(container.getAttribute('data-ezclassify')).toBe('');
    });

    it('starts with empty assertions and empty rendered', async () => {
        await field.init(container, toCtx(engine));
        expect(field.getAssertions()).toEqual([]);
        expect(field.getRendered()).toBe('');
    });

    it('reads the initial value when provided', async () => {
        await field.init(container, toCtx(engine), { initialValue: 'c1, c2' });
        expect(engine.validate).toHaveBeenCalledWith(
            'c1, c2',
            expect.objectContaining({ outputFormat: 'default' }),
        );
        expect(field.getAssertions()).toHaveLength(2);
        expect(field.getRendered()).toBe('c1, c2');
    });

    it('setAssertions replaces stored assertions and re-renders', async () => {
        await field.init(container, toCtx(engine));
        field.setAssertions([
            {
                conceptId: 'c1',
                categoryId: 'cat1',
                confidence: 'certain',
                source: 'user',
            },
        ]);
        expect(engine.render).toHaveBeenCalled();
        expect(field.getRendered()).toBe('c1');
    });

    it('setAssertions returns a copy (not the same array reference)', async () => {
        await field.init(container, toCtx(engine));
        const original: Assertion[] = [
            {
                conceptId: 'c1',
                categoryId: 'cat1',
                confidence: 'certain',
                source: 'user',
            },
        ];
        field.setAssertions(original);
        const retrieved = field.getAssertions();
        expect(retrieved).not.toBe(original);
        expect(retrieved).toEqual(original);
    });

    it('setValue reads through the engine', async () => {
        await field.init(container, toCtx(engine));
        await field.setValue('c1');
        expect(engine.validate).toHaveBeenCalledWith(
            'c1',
            expect.objectContaining({ outputFormat: 'default' }),
        );
        expect(field.getAssertions()).toHaveLength(1);
    });

    it('setValue with empty string clears assertions and rendered', async () => {
        await field.init(container, toCtx(engine), { initialValue: 'c1' });
        await field.setValue('');
        expect(field.getAssertions()).toEqual([]);
        expect(field.getRendered()).toBe('');
    });

    it('emits onChange when assertions change via setAssertions', async () => {
        const onChange = vi.fn();
        await field.init(container, toCtx(engine), { onChange });
        field.setAssertions([
            {
                conceptId: 'c1',
                categoryId: 'cat1',
                confidence: 'certain',
                source: 'user',
            },
        ]);
        expect(onChange).toHaveBeenCalledWith(
            [expect.objectContaining({ conceptId: 'c1' })],
            'c1',
        );
    });

    it('emits onChange when assertions change via setValue', async () => {
        const onChange = vi.fn();
        await field.init(container, toCtx(engine), { onChange });
        await field.setValue('c2');
        expect(onChange).toHaveBeenCalled();
    });

    it('emits onChange when setValue clears assertions', async () => {
        const onChange = vi.fn();
        await field.init(container, toCtx(engine), {
            onChange,
            initialValue: 'c1',
        });
        onChange.mockClear();
        await field.setValue('');
        expect(onChange).toHaveBeenCalledWith([], '');
    });

    it('updateValidationErrors does not throw', async () => {
        await field.init(container, toCtx(engine));
        const errors: ValidationError[] = [
            { constraintId: 'r1', message: 'Error' } as ValidationError,
        ];
        expect(() => field.updateValidationErrors(errors)).not.toThrow();
    });

    it('destroy clears container HTML', async () => {
        await field.init(container, toCtx(engine));
        field.destroy();
        expect(container.innerHTML).toBe('');
    });

    it('uses formatId from options', async () => {
        await field.init(container, toCtx(engine), { formatId: 'banner' });
        await field.setValue('c1');
        expect(engine.validate).toHaveBeenCalledWith(
            'c1',
            expect.objectContaining({ outputFormat: 'banner' }),
        );
    });

    it('handles async render result', async () => {
        // Initialize the field from beforeEach so afterEach cleanup works
        await field.init(container, toCtx(engine));

        const asyncContainer = document.createElement('div');
        document.body.appendChild(asyncContainer);
        const asyncEngine = {
            ...engine,
            getScheme: engine.getScheme,
            render: vi.fn().mockResolvedValue({
                rendered: 'async-rendered',
                assessment: {
                    emitted: [],
                    omitted: [],
                    collapsed: [],
                    conflicts: [],
                    unrepresentable: [],
                },
            }),
        } as unknown as SchemeEngineAdapter;

        const asyncField = new HiddenAssertionField();
        await asyncField.init(asyncContainer, toCtx(asyncEngine));
        asyncField.setAssertions([
            {
                conceptId: 'c1',
                categoryId: 'cat1',
                confidence: 'certain',
                source: 'user',
            },
        ]);
        await new Promise((r) => setTimeout(r, 10));
        expect(asyncField.getRendered()).toBe('async-rendered');
        asyncField.destroy();
        asyncContainer.remove();
    });
});
