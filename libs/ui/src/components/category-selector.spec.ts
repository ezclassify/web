import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
    CategorySelector,
    type CategorySelectorOptions,
} from './category-selector';
import type { SchemeEngineAdapter, Assertion } from '@ezclassify/types';
import type { SchemePublicView } from '@ezclassify/types';
import { Context } from '@ezclassify/engine';
import { mockRenderFormats } from '../render-format-layout-mock';

/** Create a minimal mock engine with configurable categories and concepts */
function createMockEngine(
    overrides: Partial<SchemePublicView> = {},
): SchemeEngineAdapter {
    const scheme: SchemePublicView = {
        id: 'test-profile',
        name: 'Test Scheme',
        version: '1.0.0',
        defaultRenderFormat: 'default',
        categories: [
            {
                id: 'f1',
                label: 'Metric A',
                required: false,
                single: true,
                rollupOperator: 'highest',
                order: 0,
            },
            {
                id: 'f2',
                label: 'Metric B',
                required: false,
                single: false,
                rollupOperator: 'union',
                order: 1,
            },
        ],
        concepts: [
            {
                id: 'c1',
                name: 'Low',
                views: { default: 'Low', label: 'Low', code: 'L' },
                aliases: [],
                categories: ['f1'],
                parents: [],
                position: 0,
            },
            {
                id: 'c2',
                name: 'Medium',
                views: { default: 'Medium', label: 'Medium', code: 'M' },
                aliases: [],
                categories: ['f1'],
                parents: [],
                position: 1,
            },
            {
                id: 'c3',
                name: 'High',
                views: { default: 'High', label: 'High', code: 'H' },
                aliases: [],
                categories: ['f1'],
                parents: [],
                position: 2,
            },
            {
                id: 'c4',
                name: 'Option X',
                views: { default: 'Option X' },
                aliases: [],
                categories: ['f2'],
                parents: [],
                position: 0,
            },
            {
                id: 'c5',
                name: 'Option Y',
                views: { default: 'Option Y' },
                aliases: [],
                categories: ['f2'],
                parents: [],
                position: 1,
            },
            {
                id: 'c6',
                name: 'Option Z',
                views: { default: 'Option Z' },
                aliases: [],
                categories: ['f2'],
                parents: [],
                position: 2,
            },
        ],
        formats: [
            {
                id: 'default',
                categoryOrder: ['f1', 'f2'],
                separator: ':',
                categorySeparator: '/',
                view: 'default',
            },
        ],
        scopes: [],
        conceptGroups: [],
        parseRules: [],
        wizardQuestions: [],
        ...overrides,
    } as unknown as SchemePublicView;

    return {
        getScheme: () => scheme,
        getSchemeMeta: () => ({
            id: scheme.id ?? 'test',
            version: scheme.version ?? '1.0',
            name: scheme.name ?? 'Test',
            defaultRenderFormat: scheme.defaultRenderFormat ?? 'default',
            formats: mockRenderFormats(scheme.formats ?? []),
            scopes: scheme.scopes ?? [],
        }),
        listCategories: () => scheme.categories ?? [],
        getConceptsInCategory: (catId: string) =>
            (scheme.concepts ?? []).filter((c: any) =>
                c.categories?.includes(catId),
            ),
        render: vi.fn((assertions: Assertion[]) => {
            return assertions.map((a) => a.conceptId).join(':');
        }),
        process: vi.fn(
            (input: string, options?: { assertions?: Assertion[] }) => {
                if (options?.assertions) {
                    const rendered = options.assertions
                        .map((a) => a.conceptId)
                        .join(':');
                    return {
                        assertions: options.assertions.map((a) => ({ ...a })),
                        rendered,
                        valid: true,
                    };
                }
                const ids = input.split(':').filter(Boolean);
                const assertions = ids.map((id) => {
                    const concept = scheme.concepts.find((c) => c.id === id);
                    return {
                        conceptId: id,
                        categoryId: concept?.categories[0] ?? 'f1',
                        confidence: 'certain' as const,
                        source: 'parse' as const,
                    };
                });
                return { assertions, rendered: input, valid: true };
            },
        ),
        suggest: vi.fn(() => ({ suggestions: [] })),
        describeConcept: (conceptId: string, categoryId: string) => {
            const concept = (scheme.concepts ?? []).find(
                (c) => c.id === conceptId,
            );
            return { lines: [`${categoryId}: ${concept?.name ?? conceptId}`] };
        },
    } as unknown as SchemeEngineAdapter;
}

const toCtx = (eng: unknown) => Context.fromSchemeEngine(eng as never);
describe('CategorySelector', () => {
    let container: HTMLDivElement;
    let engine: SchemeEngineAdapter;
    let selector: CategorySelector;

    beforeEach(async () => {
        container = document.createElement('div');
        document.body.appendChild(container);
        engine = createMockEngine();
        selector = new CategorySelector();
    });

    async function init(
        opts?: Partial<CategorySelectorOptions>,
    ): Promise<void> {
        await selector.init(
            container,
            toCtx(engine),
            opts as CategorySelectorOptions,
        );
    }

    it('refuses an engine without describeConcept when it binds', async () => {
        delete (engine as { describeConcept?: unknown }).describeConcept;
        await expect(init()).rejects.toThrow(
            /CategorySelector requires engine\.describeConcept\(\)/,
        );
        expect(
            container.querySelectorAll('.category-selector-row'),
        ).toHaveLength(0);
    });

    it('should render category rows for each category', async () => {
        await init();
        const rows = container.querySelectorAll('.category-selector-row');
        expect(rows.length).toBe(2);
    });

    it('should render correct labels for categories', async () => {
        await init();
        const labels = container.querySelectorAll('.category-selector-label');
        expect(labels[0].textContent).toBe('Metric A');
        expect(labels[1].textContent).toBe('Metric B');
    });

    it('should render buttons for each concept in a category', async () => {
        await init();
        const rows = container.querySelectorAll('.category-selector-row');
        // First row (single-select, 3 concepts)
        const btns1 = rows[0].querySelectorAll('.category-selector-btn');
        expect(btns1.length).toBe(3);
        // Second row (multi-select, 3 concepts)
        const btns2 = rows[1].querySelectorAll('.category-selector-btn');
        expect(btns2.length).toBe(3);
    });

    it('should use role="radio" for single-select categories', async () => {
        await init();
        const rows = container.querySelectorAll('.category-selector-row');
        expect(rows[0].getAttribute('role')).toBe('radiogroup');
        const btns = rows[0].querySelectorAll('.category-selector-btn');
        expect(btns[0].getAttribute('role')).toBe('radio');
    });

    it('should use role="checkbox" for multi-select categories', async () => {
        await init();
        const rows = container.querySelectorAll('.category-selector-row');
        expect(rows[1].getAttribute('role')).toBe('group');
        const btns = rows[1].querySelectorAll('.category-selector-btn');
        expect(btns[0].getAttribute('role')).toBe('checkbox');
    });

    it('should select a concept when button is clicked (single-select)', async () => {
        await init();
        const btn = container.querySelector(
            '[data-concept-id="c2"]',
        ) as HTMLElement;
        btn.click();
        const assertions = selector.getAssertions();
        expect(
            assertions.some(
                (a) => a.conceptId === 'c2' && a.categoryId === 'f1',
            ),
        ).toBe(true);
    });

    it('should enforce single-select: clicking another button deselects the first', async () => {
        await init();
        const btn1 = container.querySelector(
            '[data-concept-id="c1"]',
        ) as HTMLElement;
        btn1.click();
        expect(selector.getAssertions().some((a) => a.conceptId === 'c1')).toBe(
            true,
        );

        const btn2 = container.querySelector(
            '[data-concept-id="c2"]',
        ) as HTMLElement;
        btn2.click();
        const assertions = selector.getAssertions();
        expect(
            assertions.some(
                (a) => a.conceptId === 'c1' && a.categoryId === 'f1',
            ),
        ).toBe(false);
        expect(
            assertions.some(
                (a) => a.conceptId === 'c2' && a.categoryId === 'f1',
            ),
        ).toBe(true);
    });

    it('clears a selected single-choice item without changing other categories', async () => {
        await init();
        const click = (id: string) =>
            container
                .querySelector<HTMLButtonElement>(`[data-concept-id="${id}"]`)!
                .click();
        click('c4');
        click('c2');
        click('c2');
        expect(
            selector.getAssertions().filter((a) => a.categoryId === 'f1'),
        ).toEqual([]);
        expect(selector.getAssertions().some((a) => a.conceptId === 'c4')).toBe(
            true,
        );
        expect(
            container
                .querySelector('[data-concept-id="c2"]')
                ?.getAttribute('aria-checked'),
        ).toBe('false');
    });

    it('should allow multiple selections in multi-select categories', async () => {
        await init();
        const btnX = container.querySelector(
            '[data-concept-id="c4"]',
        ) as HTMLElement;
        const btnY = container.querySelector(
            '[data-concept-id="c5"]',
        ) as HTMLElement;
        btnX.click();
        btnY.click();
        const assertions = selector.getAssertions();
        expect(
            assertions.some(
                (a) => a.conceptId === 'c4' && a.categoryId === 'f2',
            ),
        ).toBe(true);
        expect(
            assertions.some(
                (a) => a.conceptId === 'c5' && a.categoryId === 'f2',
            ),
        ).toBe(true);
    });

    it('should toggle (deselect) in multi-select categories on second click', async () => {
        await init();
        const btn = container.querySelector(
            '[data-concept-id="c4"]',
        ) as HTMLElement;
        btn.click();
        expect(selector.getAssertions().some((a) => a.conceptId === 'c4')).toBe(
            true,
        );

        // Click again to deselect
        const btnAfter = container.querySelector(
            '[data-concept-id="c4"]',
        ) as HTMLElement;
        btnAfter.click();
        expect(selector.getAssertions().some((a) => a.conceptId === 'c4')).toBe(
            false,
        );
    });

    it('should mark selected buttons with aria-checked="true"', async () => {
        await init();
        const btn = container.querySelector(
            '[data-concept-id="c1"]',
        ) as HTMLElement;
        expect(btn.getAttribute('aria-checked')).toBe('false');
        btn.click();
        const updatedBtn = container.querySelector(
            '[data-concept-id="c1"]',
        ) as HTMLElement;
        expect(updatedBtn.getAttribute('aria-checked')).toBe('true');
    });

    it('should show preview bar when showPreview is true', async () => {
        await init({ showPreview: true });
        const preview = container.querySelector('.proto-preview');
        expect(preview).not.toBeNull();
    });

    it('should not show preview bar by default', async () => {
        await init();
        // Preview exists in DOM but not appended when showPreview is falsy
        // Check that it's not in the container's direct DOM tree
        const visiblePreview = container.querySelector('.proto-preview');
        // The preview element is created but only appended when showPreview is true
        expect(visiblePreview).toBeNull();
    });

    it('should call onChange when assertions change', async () => {
        const onChange = vi.fn();
        await init({ onChange });
        const btn = container.querySelector(
            '[data-concept-id="c1"]',
        ) as HTMLElement;
        btn.click();
        expect(onChange).toHaveBeenCalled();
    });

    it('should render group headings when categoryGroups is provided', async () => {
        await init({
            categoryGroups: {
                'Group Alpha': ['f1'],
                'Group Beta': ['f2'],
            },
        });
        const headings = container.querySelectorAll(
            '.category-selector-group-heading',
        );
        expect(headings.length).toBe(2);
        expect(headings[0].textContent).toBe('Group Alpha');
        expect(headings[1].textContent).toBe('Group Beta');
    });

    it('should show codes when showCodes is true and concept has code view', async () => {
        await init({ showCodes: true });
        const firstRow = container.querySelectorAll(
            '.category-selector-row',
        )[0];
        const codes = firstRow.querySelectorAll('.category-selector-code');
        // Concepts c1-c3 have 'code' views
        expect(codes.length).toBe(3);
        expect(codes[0].textContent).toBe('L');
    });

    it('should handle keyboard ArrowRight navigation', async () => {
        await init();
        const btns = container
            .querySelectorAll('.category-selector-row')[0]
            .querySelectorAll('.category-selector-btn');
        const firstBtn = btns[0] as HTMLElement;
        firstBtn.focus();
        firstBtn.dispatchEvent(
            new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }),
        );
        // After ArrowRight, col 1 should be the tab stop; col 0 should be removed from tab order
        const col1 = container.querySelector(
            '[data-row-index="0"][data-col-index="1"]',
        ) as HTMLElement;
        const col0 = container.querySelector(
            '[data-row-index="0"][data-col-index="0"]',
        ) as HTMLElement;
        expect(col1).not.toBeNull();
        expect(col1.tabIndex).toBe(0);
        expect(col0.tabIndex).toBe(-1);
    });

    it('should handle keyboard ArrowLeft navigation', async () => {
        await init();
        const btns = container
            .querySelectorAll('.category-selector-row')[0]
            .querySelectorAll('.category-selector-btn');
        // Focus col 1 first via ArrowRight
        const firstBtn = btns[0] as HTMLElement;
        firstBtn.focus();
        firstBtn.dispatchEvent(
            new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }),
        );
        const col1 = container.querySelector(
            '[data-row-index="0"][data-col-index="1"]',
        ) as HTMLElement;
        col1.dispatchEvent(
            new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }),
        );
        const col0 = container.querySelector(
            '[data-row-index="0"][data-col-index="0"]',
        ) as HTMLElement;
        expect(col0.tabIndex).toBe(0);
        expect(col1.tabIndex).toBe(-1);
    });

    describe('WCAG 2.1.1: single-row ArrowDown/ArrowUp navigation', () => {
        it('ArrowDown moves to next option when there is only one category row', async () => {
            // Create a mock engine with a single category row (single-select, 3 concepts)
            const singleRowEngine = createMockEngine({
                categories: [
                    {
                        id: 'status',
                        label: 'Status',
                        required: false,
                        single: true,
                        rollupOperator: 'highest',
                        order: 0,
                    },
                ] as any,
                concepts: [
                    {
                        id: 'on-hold',
                        name: 'On Hold',
                        views: { default: 'On Hold' },
                        aliases: [],
                        categories: ['status'],
                        parents: [],
                        position: 0,
                    },
                    {
                        id: 'not-yet',
                        name: 'Not Yet',
                        views: { default: 'Not Yet' },
                        aliases: [],
                        categories: ['status'],
                        parents: [],
                        position: 1,
                    },
                    {
                        id: 'being-checked',
                        name: 'Being Checked',
                        views: { default: 'Being Checked' },
                        aliases: [],
                        categories: ['status'],
                        parents: [],
                        position: 2,
                    },
                ] as any,
            });
            const singleSelector = new CategorySelector();
            await singleSelector.init(container, toCtx(singleRowEngine));

            const col0 = container.querySelector(
                '[data-row-index="0"][data-col-index="0"]',
            ) as HTMLElement;
            col0.focus();
            col0.dispatchEvent(
                new KeyboardEvent('keydown', {
                    key: 'ArrowDown',
                    bubbles: true,
                }),
            );

            const col1 = container.querySelector(
                '[data-row-index="0"][data-col-index="1"]',
            ) as HTMLElement;
            expect(col1.tabIndex).toBe(0);
            expect(col0.tabIndex).toBe(-1);

            singleSelector.destroy();
        });

        it('ArrowUp moves to previous option when there is only one category row', async () => {
            const singleRowEngine = createMockEngine({
                categories: [
                    {
                        id: 'status',
                        label: 'Status',
                        required: false,
                        single: true,
                        rollupOperator: 'highest',
                        order: 0,
                    },
                ] as any,
                concepts: [
                    {
                        id: 'on-hold',
                        name: 'On Hold',
                        views: { default: 'On Hold' },
                        aliases: [],
                        categories: ['status'],
                        parents: [],
                        position: 0,
                    },
                    {
                        id: 'not-yet',
                        name: 'Not Yet',
                        views: { default: 'Not Yet' },
                        aliases: [],
                        categories: ['status'],
                        parents: [],
                        position: 1,
                    },
                    {
                        id: 'being-checked',
                        name: 'Being Checked',
                        views: { default: 'Being Checked' },
                        aliases: [],
                        categories: ['status'],
                        parents: [],
                        position: 2,
                    },
                ] as any,
            });
            const singleSelector = new CategorySelector();
            await singleSelector.init(container, toCtx(singleRowEngine));

            // Move to col 1 first
            const col0 = container.querySelector(
                '[data-row-index="0"][data-col-index="0"]',
            ) as HTMLElement;
            col0.focus();
            col0.dispatchEvent(
                new KeyboardEvent('keydown', {
                    key: 'ArrowRight',
                    bubbles: true,
                }),
            );
            const col1 = container.querySelector(
                '[data-row-index="0"][data-col-index="1"]',
            ) as HTMLElement;
            // Now ArrowUp from col 1 should go back to col 0
            col1.dispatchEvent(
                new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }),
            );
            expect(col0.tabIndex).toBe(0);
            expect(col1.tabIndex).toBe(-1);

            singleSelector.destroy();
        });

        it('ArrowDown wraps from last option to first in single-row', async () => {
            const singleRowEngine = createMockEngine({
                categories: [
                    {
                        id: 'status',
                        label: 'Status',
                        required: false,
                        single: true,
                        rollupOperator: 'highest',
                        order: 0,
                    },
                ] as any,
                concepts: [
                    {
                        id: 'a',
                        name: 'A',
                        views: { default: 'A' },
                        aliases: [],
                        categories: ['status'],
                        parents: [],
                        position: 0,
                    },
                    {
                        id: 'b',
                        name: 'B',
                        views: { default: 'B' },
                        aliases: [],
                        categories: ['status'],
                        parents: [],
                        position: 1,
                    },
                ] as any,
            });
            const singleSelector = new CategorySelector();
            await singleSelector.init(container, toCtx(singleRowEngine));

            // Move to col 1 (last)
            const col0 = container.querySelector(
                '[data-row-index="0"][data-col-index="0"]',
            ) as HTMLElement;
            col0.focus();
            col0.dispatchEvent(
                new KeyboardEvent('keydown', {
                    key: 'ArrowRight',
                    bubbles: true,
                }),
            );
            const col1 = container.querySelector(
                '[data-row-index="0"][data-col-index="1"]',
            ) as HTMLElement;
            // ArrowDown from last should wrap to first
            col1.dispatchEvent(
                new KeyboardEvent('keydown', {
                    key: 'ArrowDown',
                    bubbles: true,
                }),
            );
            expect(col0.tabIndex).toBe(0);
            expect(col1.tabIndex).toBe(-1);

            singleSelector.destroy();
        });
    });

    it('should handle keyboard Enter to select', async () => {
        await init();
        const btn = container.querySelector(
            '[data-concept-id="c1"]',
        ) as HTMLElement;
        btn.focus();
        btn.dispatchEvent(
            new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
        );
        expect(selector.getAssertions().some((a) => a.conceptId === 'c1')).toBe(
            true,
        );
    });

    it('should handle keyboard Space to select', async () => {
        await init();
        const btn = container.querySelector(
            '[data-concept-id="c1"]',
        ) as HTMLElement;
        btn.focus();
        btn.dispatchEvent(
            new KeyboardEvent('keydown', { key: ' ', bubbles: true }),
        );
        expect(selector.getAssertions().some((a) => a.conceptId === 'c1')).toBe(
            true,
        );
    });

    it('should return rendered string via getRendered()', async () => {
        await init();
        const btn = container.querySelector(
            '[data-concept-id="c1"]',
        ) as HTMLElement;
        btn.click();
        // The mock render just joins conceptIds with ':'
        const rendered = selector.getRendered();
        expect(rendered).toContain('c1');
    });

    it('should support setAssertions() and re-render', async () => {
        await init();
        selector.setAssertions([
            {
                conceptId: 'c3',
                categoryId: 'f1',
                confidence: 'certain',
                source: 'user',
            },
        ]);
        const btn = container.querySelector(
            '[data-concept-id="c3"]',
        ) as HTMLElement;
        expect(btn.getAttribute('aria-checked')).toBe('true');
    });

    it('should clean up DOM on destroy()', async () => {
        await init();
        expect(container.children.length).toBeGreaterThan(0);
        selector.destroy();
        expect(container.children.length).toBe(0);
    });

    describe('categoryId scoping (facet-of)', () => {
        it('renders only the bound category row when categoryId is provided', async () => {
            await init({ categoryId: 'f1' });
            const rows = container.querySelectorAll('.category-selector-row');
            expect(rows.length).toBe(1);
            expect(rows[0].getAttribute('aria-label')).toBe('Metric A');
        });

        it('renders no buttons from other categories when scoped', async () => {
            await init({ categoryId: 'f1' });
            const btns = container.querySelectorAll('.category-selector-btn');
            expect(btns.length).toBe(3);
            const ids = Array.from(btns).map(
                (b) => (b as HTMLElement).dataset.conceptId,
            );
            // c4–c6 belong to f2 and must not appear
            expect(ids).not.toContain('c4');
            expect(ids).not.toContain('c5');
            expect(ids).not.toContain('c6');
        });

        it('commits only within the bound category on click', async () => {
            await init({ categoryId: 'f1' });
            const btn = container.querySelector(
                '[data-concept-id="c2"]',
            ) as HTMLElement;
            btn.click();
            const assertions = selector.getAssertions();
            expect(assertions.every((a) => a.categoryId === 'f1')).toBe(true);
        });

        it('without categoryId still renders all category rows', async () => {
            await init();
            const rows = container.querySelectorAll('.category-selector-row');
            expect(rows.length).toBe(2);
        });
    });
});
