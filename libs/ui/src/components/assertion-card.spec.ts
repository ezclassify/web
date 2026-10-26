import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AssertionCard } from './assertion-card';
import type { AssertionCardOptions } from './assertion-card';
import type { SchemeEngineAdapter, Assertion } from '@ezclassify/types';
import type {
    SchemePublicView,
    ConceptView,
    CategoryView,
} from '@ezclassify/types';
import { Context } from '@ezclassify/engine';
import { mockRenderFormats } from '../render-format-layout-mock';

function createMockProfile(): SchemePublicView {
    const concepts: ConceptView[] = [
        {
            id: 'level-high',
            name: 'High',
            views: { default: 'High' },
            categories: ['level'],
            parents: [],
            aliases: [],
            position: 0,
        },
        {
            id: 'level-low',
            name: 'Low',
            views: { default: 'Low' },
            categories: ['level'],
            parents: [],
            aliases: [],
            position: 1,
        },
        {
            id: 'cat-a',
            name: 'Category A',
            views: { default: 'Category A' },
            categories: ['category'],
            parents: [],
            aliases: [],
            position: 0,
        },
        {
            id: 'cat-b',
            name: 'Category B',
            views: { default: 'Category B' },
            categories: ['category'],
            parents: [],
            aliases: [],
            position: 1,
        },
    ] as ConceptView[];

    const categories: CategoryView[] = [
        {
            id: 'level',
            label: 'Level',
            single: true,
            required: false,
        } as CategoryView,
        {
            id: 'category',
            label: 'Categories',
            single: false,
            required: false,
        } as CategoryView,
    ];

    return {
        name: 'Test Scheme',
        categories,
        concepts,
        formats: [
            {
                id: 'default',
                categoryOrder: ['level', 'category'],
                separator: ' ',
                categorySeparator: '//',
                view: 'default',
            },
        ],
        scopes: [],
        defaultRenderFormat: 'default',
    } as unknown as SchemePublicView;
}

function createMockEngine(scheme?: SchemePublicView): SchemeEngineAdapter {
    const p = scheme ?? createMockProfile();
    return {
        getScheme: () => p,
        getSchemeMeta: () => ({
            id: (p as any).id ?? 'test',
            version: (p as any).version ?? '1.0',
            name: p.name ?? 'Test',
            colorFrom: (p as any).colorFrom,
            defaultRenderFormat: (p as any).defaultRenderFormat ?? 'default',
            formats: mockRenderFormats(p.formats ?? []),
            scopes: (p as any).scopes ?? [],
        }),
        listCategories: () => p.categories ?? [],
        getConceptsInCategory: (catId: string) =>
            (p.concepts ?? []).filter((c: any) =>
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
        process: vi.fn((input: string) => {
            const ids = input
                .split(',')
                .map((s) => s.trim())
                .filter(Boolean);
            const assertions = ids.map((id) => {
                const concept = p.concepts.find((c) => c.id === id);
                return {
                    conceptId: id,
                    categoryId: concept?.categories[0] ?? 'level',
                    confidence: 'certain' as const,
                    source: 'parse' as const,
                };
            });
            return { assertions, rendered: input, valid: true };
        }),
        suggest: vi.fn().mockReturnValue({ suggestions: [] }),
    } as unknown as SchemeEngineAdapter;
}

const toCtx = (eng: unknown) => Context.fromSchemeEngine(eng as never);
describe('AssertionCard', () => {
    let container: HTMLDivElement;
    let engine: SchemeEngineAdapter;
    let component: AssertionCard;

    beforeEach(async () => {
        container = document.createElement('div');
        document.body.appendChild(container);
        engine = createMockEngine();
        component = new AssertionCard();
    });

    it('initializes and renders empty state', async () => {
        await component.init(container, toCtx(engine));
        const card = container.querySelector('.assertion-card');
        expect(card).toBeTruthy();
        expect(card!.querySelector('.assertion-card--empty')).toBeTruthy();
        expect(card!.textContent).toContain('No assertions');
    });

    it('renders primary category value prominently', async () => {
        await component.init(container, toCtx(engine));
        component.setAssertions([
            {
                conceptId: 'level-high',
                categoryId: 'level',
                confidence: 'certain',
                source: 'user',
            },
        ]);

        const primary = container.querySelector('.assertion-card-primary');
        expect(primary).toBeTruthy();
        expect(primary!.textContent).toBe('High');
    });

    it('renders secondary categories as labeled rows', async () => {
        await component.init(container, toCtx(engine));
        component.setAssertions([
            {
                conceptId: 'level-high',
                categoryId: 'level',
                confidence: 'certain',
                source: 'user',
            },
            {
                conceptId: 'cat-a',
                categoryId: 'category',
                confidence: 'certain',
                source: 'user',
            },
            {
                conceptId: 'cat-b',
                categoryId: 'category',
                confidence: 'certain',
                source: 'user',
            },
        ]);

        const categoryLabel = container.querySelector(
            '.assertion-card-category-label',
        );
        expect(categoryLabel).toBeTruthy();
        expect(categoryLabel!.textContent).toBe('Categories');

        const categoryValues = container.querySelector(
            '.assertion-card-category-values',
        );
        expect(categoryValues).toBeTruthy();
        expect(categoryValues!.textContent).toBe('Category A, Category B');
    });

    it('applies colorMap to card border', async () => {
        const options: AssertionCardOptions = {
            colorMap: {
                'level-high': { background: '#ff0000', text: '#ffffff' },
            },
        };
        await component.init(container, toCtx(engine), options);
        component.setAssertions([
            {
                conceptId: 'level-high',
                categoryId: 'level',
                confidence: 'certain',
                source: 'user',
            },
        ]);

        const card = container.querySelector('.assertion-card') as HTMLElement;
        expect(card.style.getPropertyValue('--assertion-card-color')).toBe(
            '#ff0000',
        );
    });

    it('lets a host colorMap override the scheme-default color', async () => {
        // Scheme names its single-select level category as the color driver,
        // with a portable black-on-orange default on the level concept.
        const scheme = createMockProfile();
        (scheme as any).colorFrom = 'level';
        scheme.concepts.find((c) => c.id === 'level-high')!.color = {
            background: '#ff8c00',
            text: '#000000',
        };
        const coloredEngine = createMockEngine(scheme);

        // A conflicting host colorMap proves the consuming application wins.
        const options: AssertionCardOptions = {
            colorMap: {
                'level-high': { background: '#ff0000', text: '#ffffff' },
            },
        };
        await component.init(container, toCtx(coloredEngine), options);
        component.setAssertions([
            {
                conceptId: 'level-high',
                categoryId: 'level',
                confidence: 'certain',
                source: 'user',
            },
        ]);

        const card = container.querySelector('.assertion-card') as HTMLElement;
        expect(card.style.getPropertyValue('--assertion-card-color')).toBe(
            '#ff0000',
        );
    });

    it('falls through to the scheme default when the colorMap has no entry for the shown concept', async () => {
        // Display-color precedence (ARCHITECTURE.md): host colorMap entry,
        // then what the adapter resolved, then the published category default.
        // Supplying a colorMap that says nothing about this concept must not
        // skip the steps below it.
        const scheme = createMockProfile();
        (scheme as unknown as { colorFrom?: string }).colorFrom = 'level';
        scheme.concepts.find((c) => c.id === 'level-high')!.color = {
            background: '#ff8c00',
            text: '#000000',
        };
        const coloredEngine = createMockEngine(scheme);

        const options: AssertionCardOptions = {
            colorMap: {
                'level-low': { background: '#0000ff', text: '#ffffff' },
            },
        };
        await component.init(container, toCtx(coloredEngine), options);
        component.setAssertions([
            {
                conceptId: 'level-high',
                categoryId: 'level',
                confidence: 'certain',
                source: 'user',
            },
        ]);

        const card = container.querySelector('.assertion-card') as HTMLElement;
        expect(card.style.getPropertyValue('--assertion-card-color')).toBe(
            '#ff8c00',
        );
    });

    it('resolves the scheme default from a non-primary driving category', async () => {
        // color_from names the "level" category, but "category" is the primary
        // one. The card accent still adopts the level concept's default color.
        const scheme = createMockProfile();
        (scheme as any).colorFrom = 'level';
        scheme.concepts.find((c) => c.id === 'level-high')!.color = {
            background: '#ff8c00',
            text: '#000000',
        };
        const coloredEngine = createMockEngine(scheme);

        const options: AssertionCardOptions = {
            primaryCategoryId: 'category',
        };
        await component.init(container, toCtx(coloredEngine), options);
        component.setAssertions([
            {
                conceptId: 'cat-a',
                categoryId: 'category',
                confidence: 'certain',
                source: 'user',
            },
            {
                conceptId: 'level-high',
                categoryId: 'level',
                confidence: 'certain',
                source: 'user',
            },
        ]);

        const card = container.querySelector('.assertion-card') as HTMLElement;
        expect(card.style.getPropertyValue('--assertion-card-color')).toBe(
            '#ff8c00',
        );
    });

    it('renders footer text', async () => {
        const options: AssertionCardOptions = {
            footer: 'Test footer',
        };
        await component.init(container, toCtx(engine), options);
        component.setAssertions([
            {
                conceptId: 'level-high',
                categoryId: 'level',
                confidence: 'certain',
                source: 'user',
            },
        ]);

        const footer = container.querySelector('.assertion-card-footer');
        expect(footer).toBeTruthy();
        expect(footer!.textContent).toBe('Test footer');
    });

    it('renders footer from callback', async () => {
        const options: AssertionCardOptions = {
            footer: (assertions) => `${assertions.length} assertion(s)`,
        };
        await component.init(container, toCtx(engine), options);
        component.setAssertions([
            {
                conceptId: 'level-high',
                categoryId: 'level',
                confidence: 'certain',
                source: 'user',
            },
            {
                conceptId: 'cat-a',
                categoryId: 'category',
                confidence: 'certain',
                source: 'user',
            },
        ]);

        const footer = container.querySelector('.assertion-card-footer');
        expect(footer!.textContent).toBe('2 assertion(s)');
    });

    it('uses custom primaryCategoryId', async () => {
        const options: AssertionCardOptions = {
            primaryCategoryId: 'category',
        };
        await component.init(container, toCtx(engine), options);
        component.setAssertions([
            {
                conceptId: 'level-high',
                categoryId: 'level',
                confidence: 'certain',
                source: 'user',
            },
            {
                conceptId: 'cat-a',
                categoryId: 'category',
                confidence: 'certain',
                source: 'user',
            },
        ]);

        const primary = container.querySelector('.assertion-card-primary');
        expect(primary!.textContent).toBe('Category A');

        // Level should appear as secondary
        const categoryLabel = container.querySelector(
            '.assertion-card-category-label',
        );
        expect(categoryLabel!.textContent).toBe('Level');
    });

    it('getRendered returns rendered string', async () => {
        await component.init(container, toCtx(engine));
        component.setAssertions([
            {
                conceptId: 'level-high',
                categoryId: 'level',
                confidence: 'certain',
                source: 'user',
            },
        ]);
        const rendered = component.getRendered();
        expect(typeof rendered).toBe('string');
    });

    it('destroy clears the container', async () => {
        await component.init(container, toCtx(engine));
        expect(container.children.length).toBeGreaterThan(0);
        component.destroy();
        expect(container.innerHTML).toBe('');
    });

    it('sets aria-label from title option', async () => {
        const options: AssertionCardOptions = {
            title: 'My Card',
        };
        await component.init(container, toCtx(engine), options);
        const card = container.querySelector('.assertion-card');
        expect(card!.getAttribute('aria-label')).toBe('My Card');
    });
});
