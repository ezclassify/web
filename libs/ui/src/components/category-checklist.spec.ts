import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
    CategoryChecklist,
    type CategoryChecklistOptions,
} from './category-checklist';
import type { SchemeEngineAdapter, Assertion } from '@ezclassify/types';
import type { SchemePublicView } from '@ezclassify/types';
import { Context } from '@ezclassify/engine';
import { mockRenderFormats } from '../render-format-layout-mock';

/** Create a minimal mock engine with a multi-select category */
function createMockEngine(
    overrides: Partial<SchemePublicView> = {},
): SchemeEngineAdapter {
    const scheme: SchemePublicView = {
        id: 'test-checklist',
        name: 'Test Checklist Scheme',
        version: '1.0.0',
        defaultRenderFormat: 'default',
        categories: [
            {
                id: 'items',
                label: 'Items',
                required: false,
                single: false,
                rollupOperator: 'union',
                order: 0,
            },
            {
                id: 'other',
                label: 'Other Category',
                required: false,
                single: true,
                rollupOperator: 'highest',
                order: 1,
            },
        ],
        concepts: [
            {
                id: 'item-a',
                name: 'Item Alpha',
                views: { default: 'Item Alpha' },
                aliases: [],
                categories: ['items'],
                parents: [],
                position: 0,
            },
            {
                id: 'item-b',
                name: 'Item Bravo',
                views: { default: 'Item Bravo' },
                aliases: [],
                categories: ['items'],
                parents: [],
                position: 1,
            },
            {
                id: 'item-c',
                name: 'Item Charlie',
                views: { default: 'Item Charlie' },
                aliases: [],
                categories: ['items'],
                parents: [],
                position: 2,
            },
            {
                id: 'item-d',
                name: 'Item Delta',
                views: { default: 'Item Delta' },
                aliases: [],
                categories: ['items'],
                parents: [],
                position: 3,
            },
            {
                id: 'item-e',
                name: 'Item Echo',
                views: { default: 'Item Echo' },
                aliases: [],
                categories: ['items'],
                parents: [],
                position: 4,
            },
            {
                id: 'other-1',
                name: 'Other One',
                views: { default: 'Other One' },
                aliases: [],
                categories: ['other'],
                parents: [],
                position: 0,
            },
        ],
        formats: [
            {
                id: 'default',
                categoryOrder: ['items'],
                separator: ',',
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
            return assertions.map((a) => a.conceptId).join(',');
        }),
        process: vi.fn(
            (input: string, options?: { assertions?: Assertion[] }) => {
                if (options?.assertions) {
                    const rendered = options.assertions
                        .map((a) => a.conceptId)
                        .join(',');
                    return {
                        assertions: options.assertions.map((a) => ({ ...a })),
                        rendered,
                        valid: true,
                    };
                }
                const ids = input.split(',').filter(Boolean);
                const assertions = ids.map((id) => {
                    const concept = scheme.concepts.find((c) => c.id === id);
                    return {
                        conceptId: id,
                        categoryId: concept?.categories[0] ?? 'items',
                        confidence: 'certain' as const,
                        source: 'parse' as const,
                    };
                });
                return { assertions, rendered: input, valid: true };
            },
        ),
        suggest: vi.fn(() => ({ suggestions: [] })),
        describeConcept: (conceptId: string) => ({ lines: [conceptId] }),
    } as unknown as SchemeEngineAdapter;
}

const toCtx = (eng: unknown) => Context.fromSchemeEngine(eng as never);
describe('CategoryChecklist', () => {
    let container: HTMLDivElement;
    let engine: SchemeEngineAdapter;
    let checklist: CategoryChecklist;

    beforeEach(async () => {
        container = document.createElement('div');
        document.body.appendChild(container);
        engine = createMockEngine();
        checklist = new CategoryChecklist();
    });

    async function init(
        opts?: Partial<CategoryChecklistOptions>,
    ): Promise<void> {
        await checklist.init(container, toCtx(engine), {
            categoryId: 'items',
            ...opts,
        } as CategoryChecklistOptions);
    }

    it('should render a header with category label', async () => {
        await init();
        const heading = container.querySelector(
            '.category-checklist-header h3',
        );
        expect(heading?.textContent).toBe('Items');
    });

    it('should show count badge "0 of 5"', async () => {
        await init();
        const count = container.querySelector('.category-checklist-count');
        expect(count?.textContent).toBe('0 of 5');
    });

    it('should render checkboxes for each concept in the category', async () => {
        await init();
        const checkboxes = container.querySelectorAll(
            '.category-checklist-checkbox',
        );
        expect(checkboxes.length).toBe(5);
    });

    it('should render labels for each concept', async () => {
        await init();
        const labels = container.querySelectorAll('.category-checklist-label');
        expect(labels[0].textContent).toBe('Item Alpha');
        expect(labels[4].textContent).toBe('Item Echo');
    });

    it('should add assertion when checkbox is checked', async () => {
        await init();
        const checkbox = container.querySelector(
            '[data-concept-id="item-a"]',
        ) as HTMLInputElement;
        checkbox.checked = true;
        checkbox.dispatchEvent(new Event('change', { bubbles: true }));
        expect(
            checklist
                .getAssertions()
                .some(
                    (a) => a.conceptId === 'item-a' && a.categoryId === 'items',
                ),
        ).toBe(true);
    });

    it('should remove assertion when checkbox is unchecked', async () => {
        await init();
        // First check
        const checkbox = container.querySelector(
            '[data-concept-id="item-a"]',
        ) as HTMLInputElement;
        checkbox.checked = true;
        checkbox.dispatchEvent(new Event('change', { bubbles: true }));
        expect(
            checklist.getAssertions().some((a) => a.conceptId === 'item-a'),
        ).toBe(true);

        // Then uncheck - need to get the re-rendered checkbox
        const checkbox2 = container.querySelector(
            '[data-concept-id="item-a"]',
        ) as HTMLInputElement;
        checkbox2.checked = false;
        checkbox2.dispatchEvent(new Event('change', { bubbles: true }));
        expect(
            checklist.getAssertions().some((a) => a.conceptId === 'item-a'),
        ).toBe(false);
    });

    it('should update count badge when items are selected', async () => {
        await init();
        const cb1 = container.querySelector(
            '[data-concept-id="item-a"]',
        ) as HTMLInputElement;
        cb1.checked = true;
        cb1.dispatchEvent(new Event('change', { bubbles: true }));

        const cb2 = container.querySelector(
            '[data-concept-id="item-b"]',
        ) as HTMLInputElement;
        cb2.checked = true;
        cb2.dispatchEvent(new Event('change', { bubbles: true }));

        const count = container.querySelector('.category-checklist-count');
        expect(count?.textContent).toBe('2 of 5');
    });

    it('should show search input by default', async () => {
        await init();
        const search = container.querySelector('.category-checklist-search');
        expect(search).not.toBeNull();
    });

    it('should hide search input when showSearch is false', async () => {
        await init({ showSearch: false });
        const search = container.querySelector('.category-checklist-search');
        expect(search).toBeNull();
    });

    it('should filter items when search text is entered', async () => {
        await init();
        const search = container.querySelector(
            '.category-checklist-search',
        ) as HTMLInputElement;
        search.value = 'Alpha';
        search.dispatchEvent(new Event('input', { bubbles: true }));

        const items = container.querySelectorAll('.category-checklist-item');
        expect(items.length).toBe(1);
        const label = items[0].querySelector('.category-checklist-label');
        expect(label?.textContent).toBe('Item Alpha');
    });

    it('should show "No matching items" when filter has no results', async () => {
        await init();
        const search = container.querySelector(
            '.category-checklist-search',
        ) as HTMLInputElement;
        search.value = 'zzzzz';
        search.dispatchEvent(new Event('input', { bubbles: true }));

        const empty = container.querySelector('.category-checklist-empty');
        expect(empty?.textContent).toBe('No matching items.');
    });

    it('should show toggle buttons by default', async () => {
        await init();
        const toggle = container.querySelector('.category-checklist-toggle');
        expect(toggle).not.toBeNull();
        const buttons = toggle?.querySelectorAll('button');
        expect(buttons?.length).toBe(2);
        expect(buttons?.[0].textContent).toBe('Select all');
        expect(buttons?.[1].textContent).toBe('Clear all');
    });

    it('should hide toggle buttons when showToggleAll is false', async () => {
        await init({ showToggleAll: false });
        const toggle = container.querySelector('.category-checklist-toggle');
        expect(toggle).toBeNull();
    });

    it('should select all items when "Select all" is clicked', async () => {
        await init();
        const selectAllBtn = container.querySelector(
            '.category-checklist-toggle button:first-child',
        ) as HTMLElement;
        selectAllBtn.click();
        const assertions = checklist.getAssertions();
        expect(assertions.filter((a) => a.categoryId === 'items').length).toBe(
            5,
        );
    });

    it('should clear all items when "Clear all" is clicked', async () => {
        await init();
        // First select some
        const cb1 = container.querySelector(
            '[data-concept-id="item-a"]',
        ) as HTMLInputElement;
        cb1.checked = true;
        cb1.dispatchEvent(new Event('change', { bubbles: true }));
        expect(checklist.getAssertions().length).toBeGreaterThan(0);

        // Clear all
        const clearAllBtn = container.querySelector(
            '.category-checklist-toggle button:last-child',
        ) as HTMLElement;
        clearAllBtn.click();
        expect(
            checklist.getAssertions().filter((a) => a.categoryId === 'items')
                .length,
        ).toBe(0);
    });

    it('should call onChange when assertions change', async () => {
        const onChange = vi.fn();
        await init({ onChange });
        const cb = container.querySelector(
            '[data-concept-id="item-a"]',
        ) as HTMLInputElement;
        cb.checked = true;
        cb.dispatchEvent(new Event('change', { bubbles: true }));
        expect(onChange).toHaveBeenCalled();
    });

    it('should show preview bar when showPreview is true', async () => {
        await init({ showPreview: true });
        const preview = container.querySelector('.proto-preview');
        expect(preview).not.toBeNull();
    });

    it('should not show preview bar by default', async () => {
        await init();
        const preview = container.querySelector('.proto-preview');
        expect(preview).toBeNull();
    });

    it('should return rendered string via getRendered()', async () => {
        await init();
        const cb = container.querySelector(
            '[data-concept-id="item-a"]',
        ) as HTMLInputElement;
        cb.checked = true;
        cb.dispatchEvent(new Event('change', { bubbles: true }));
        const rendered = checklist.getRendered();
        expect(rendered).toContain('item-a');
    });

    it('should support setAssertions() and re-render', async () => {
        await init();
        checklist.setAssertions([
            {
                conceptId: 'item-b',
                categoryId: 'items',
                confidence: 'certain',
                source: 'user',
            },
            {
                conceptId: 'item-d',
                categoryId: 'items',
                confidence: 'certain',
                source: 'user',
            },
        ]);
        const count = container.querySelector('.category-checklist-count');
        expect(count?.textContent).toBe('2 of 5');

        // Check that checkboxes are in correct state
        const cbB = container.querySelector(
            '[data-concept-id="item-b"]',
        ) as HTMLInputElement;
        expect(cbB.checked).toBe(true);
        const cbA = container.querySelector(
            '[data-concept-id="item-a"]',
        ) as HTMLInputElement;
        expect(cbA.checked).toBe(false);
    });

    it('should throw if categoryId is missing', async () => {
        const promise = checklist.init(
            container,
            toCtx(engine),
            {} as CategoryChecklistOptions,
        );
        await expect(promise).rejects.toThrow(
            'CategoryChecklist requires a categoryId option',
        );
    });

    it('should throw if categoryId does not exist in profile', async () => {
        const promise = checklist.init(container, toCtx(engine), {
            categoryId: 'nonexistent',
        } as CategoryChecklistOptions);
        await expect(promise).rejects.toThrow(
            'Category "nonexistent" not found in profile',
        );
    });

    it('should use real checkboxes with associated labels', async () => {
        await init();
        const checkboxes = container.querySelectorAll(
            '.category-checklist-checkbox',
        ) as NodeListOf<HTMLInputElement>;
        const labels = container.querySelectorAll(
            '.category-checklist-label',
        ) as NodeListOf<HTMLLabelElement>;
        // Each label's htmlFor should match the checkbox id
        for (let i = 0; i < checkboxes.length; i++) {
            expect(checkboxes[i].type).toBe('checkbox');
            expect(labels[i].htmlFor).toBe(checkboxes[i].id);
        }
    });

    it('should wrap list in role="group" with aria-label', async () => {
        await init();
        const list = container.querySelector('.category-checklist-list');
        expect(list?.getAttribute('role')).toBe('group');
        expect(list?.getAttribute('aria-label')).toBe('Items');
    });

    it('should have aria-live on count badge', async () => {
        await init();
        const count = container.querySelector('.category-checklist-count');
        expect(count?.getAttribute('aria-live')).toBe('polite');
    });

    it('should clean up DOM on destroy()', async () => {
        await init();
        expect(container.children.length).toBeGreaterThan(0);
        checklist.destroy();
        expect(container.children.length).toBe(0);
    });

    it('should NOT rebuild the DOM when toggling a checkbox (sync fix)', async () => {
        await init();

        // Get a reference to the first checkbox element
        const checkboxBefore = container.querySelector(
            '[data-concept-id="item-a"]',
        ) as HTMLInputElement;
        expect(checkboxBefore).not.toBeNull();

        // Toggle the checkbox
        checkboxBefore.checked = true;
        checkboxBefore.dispatchEvent(new Event('change', { bubbles: true }));

        // After toggling, the same DOM element should still be in the tree
        // (i.e., the list was NOT rebuilt via innerHTML = '')
        const checkboxAfter = container.querySelector(
            '[data-concept-id="item-a"]',
        ) as HTMLInputElement;
        expect(checkboxAfter).toBe(checkboxBefore); // Same reference = no rebuild
        expect(checkboxAfter.checked).toBe(true);
    });

    it('should preserve focus after toggling a checkbox', async () => {
        await init();

        const checkbox = container.querySelector(
            '[data-concept-id="item-b"]',
        ) as HTMLInputElement;
        expect(checkbox).not.toBeNull();

        // Focus and toggle the checkbox
        checkbox.focus();
        expect(document.activeElement).toBe(checkbox);

        checkbox.checked = true;
        checkbox.dispatchEvent(new Event('change', { bubbles: true }));

        // Focus should still be on the same element after the render cycle
        expect(document.activeElement).toBe(checkbox);
    });
});
