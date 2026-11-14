import { afterEach, describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
    CategoryChecklist,
    type CategoryChecklistOptions,
} from './category-checklist';
import type { SchemeEngineAdapter, Assertion } from '@ezclassify/types';
import type { SchemePublicView } from '@ezclassify/types';
import { schemeOnlyContext } from '../../test-fixtures/context-doubles';
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

const toCtx = (eng: unknown) => schemeOnlyContext(eng as never);
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

    // A checklist mounted by hand binds the first text input beside it, so a
    // container left from another test would feed this one its value.
    afterEach(() => {
        checklist.destroy();
        container.remove();
    });

    async function init(
        opts?: Partial<CategoryChecklistOptions>,
    ): Promise<void> {
        await checklist.init(container, toCtx(engine), {
            categoryId: 'items',
            ...opts,
        } as CategoryChecklistOptions);
    }

    it('names its category in the first row, which is not a heading the host did not write', async () => {
        await init();
        const header = container.querySelector('.category-checklist-header')!;
        expect(
            header.querySelector('.category-checklist-name')?.textContent,
        ).toBe('Items');
        expect(header.querySelector('h1, h2, h3, h4, h5, h6')).toBeNull();
        // The row ends with the count, Select all, Clear all and the mark.
        const controls = header.querySelector('.category-checklist-controls')!;
        expect([...controls.children].map((child) => child.className)).toEqual([
            'category-checklist-count',
            'category-checklist-toggle',
            'ez-field-chrome ez-field-chrome--inline',
        ]);
        expect(controls.querySelector('.ez-status-mark')).not.toBeNull();
        // Clear all is its clear: the chrome adds no second one.
        expect(container.querySelector('.ez-clear-button')).toBeNull();
    });

    it('sits in the suite frame', async () => {
        await init();
        expect(
            container
                .querySelector('.category-checklist-frame')
                ?.classList.contains('ez-field-frame'),
        ).toBe(true);
    });

    it('toggles a checkbox from anywhere on its row', async () => {
        await init();
        const row = container.querySelector<HTMLLabelElement>(
            '.category-checklist-item',
        )!;
        const box = row.querySelector<HTMLInputElement>(
            '.category-checklist-checkbox',
        )!;
        // The row is the checkbox's label: a press on its name toggles it.
        expect(row.tagName).toBe('LABEL');
        expect(row.contains(box)).toBe(true);
        row.click();
        expect(box.checked).toBe(true);
        expect(
            checklist
                .getAssertions()
                .some((a) => a.conceptId === box.dataset.conceptId),
        ).toBe(true);
        expect(row.classList.contains('category-checklist-item--checked')).toBe(
            true,
        );
    });

    it('publishes nothing from a value read that lands after it was torn down', async () => {
        // A host can tear the field down, and its Context with it, while the
        // field reads a value it was given. The read's answer then has
        // nowhere to go: publishing it would call into the gone Context.
        const onChange = vi.fn();
        await init({ onChange } as Partial<CategoryChecklistOptions>);
        let answer!: (result: unknown) => void;
        const deferred = () =>
            new Promise((resolve) => {
                answer = resolve;
            });
        const mock = engine as unknown as Record<string, unknown>;
        mock.validate = vi.fn(deferred);
        mock.process = vi.fn(deferred);
        const read = checklist.setValue('item-a');
        checklist.destroy();
        answer({
            assertions: [
                {
                    conceptId: 'item-a',
                    categoryId: 'items',
                    confidence: 'certain',
                    source: 'parse',
                },
            ],
            rendered: 'item-a',
            valid: true,
            errors: [],
        });
        await read;
        expect(onChange).not.toHaveBeenCalled();
        expect(checklist.getAssertions()).toEqual([]);
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
        const rows = container.querySelectorAll(
            '.category-checklist-item',
        ) as NodeListOf<HTMLLabelElement>;
        // Each row is the label of the checkbox it holds, by holding it: a
        // label found by id would reach another checklist of the category.
        for (let i = 0; i < checkboxes.length; i++) {
            expect(checkboxes[i].type).toBe('checkbox');
            expect(rows[i].htmlFor).toBe('');
            expect(rows[i].contains(checkboxes[i])).toBe(true);
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

describe('CategoryChecklist header layout', () => {
    it('wraps the toggle buttons to a line of their own before it breaks the title mid-word', () => {
        const css = readFileSync(
            join(
                dirname(fileURLToPath(import.meta.url)),
                'category-checklist.css',
            ),
            'utf8',
        ).replace(/\/\*[\s\S]*?\*\//g, '');
        const rule = (selector: string) =>
            css.match(
                new RegExp(
                    `(?:^|\\})\\s*${selector.replace(/[.]/g, '\\$&')}\\s*\\{([^}]*)\\}`,
                ),
            )?.[1] ?? '';
        expect(rule('.category-checklist-header')).toMatch(/flex-wrap:\s*wrap/);
        // A word of the name stays whole, whatever the host's own wrapping.
        const name = rule('.category-checklist-name');
        expect(name).toMatch(/overflow-wrap:\s*normal/);
        expect(name).toMatch(/word-break:\s*normal/);
        // The controls wrap as one unit, at the row's trailing end.
        const controls = rule('.category-checklist-controls');
        expect(controls).toMatch(/flex-wrap:\s*nowrap/);
        expect(controls).toMatch(/margin-inline-start:\s*auto/);
        // The buttons stay one unit, each on one line.
        expect(rule('.category-checklist-toggle button')).toMatch(
            /white-space:\s*nowrap/,
        );
    });
});
