import { afterEach, describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
    CategoryChecklist,
    type CategoryChecklistOptions,
} from './category-checklist';
import type {
    SchemeEngineAdapter,
    Assertion,
    Suggestion,
} from '@ezclassify/types';
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
        vi.restoreAllMocks();
        checklist.destroy();
        container.remove();
    });

    async function init(
        opts?: Partial<CategoryChecklistOptions>,
    ): Promise<void> {
        const originalRect = HTMLElement.prototype.getBoundingClientRect;
        vi.spyOn(
            HTMLElement.prototype,
            'getBoundingClientRect',
        ).mockImplementation(function (this: HTMLElement) {
            if (!this.matches('.category-checklist-item'))
                return originalRect.call(this);
            const list = this.closest('.category-checklist-list')!;
            const index = Array.from(
                list.querySelectorAll('.category-checklist-item'),
            ).indexOf(this);
            return new DOMRect(0, index * 32, 100, 32);
        });
        await checklist.init(container, toCtx(engine), {
            categoryId: 'items',
            ...opts,
        } as CategoryChecklistOptions);
    }

    const boxes = () => [
        ...container.querySelectorAll<HTMLInputElement>(
            '.category-checklist-checkbox',
        ),
    ];
    const press = (
        target: HTMLElement,
        key: string,
        modifiers: KeyboardEventInit = {},
    ) => {
        const event = new KeyboardEvent('keydown', {
            key,
            bubbles: true,
            cancelable: true,
            ...modifiers,
        });
        target.dispatchEvent(event);
        return event;
    };
    it.each(['ltr', 'rtl'])(
        'moves horizontally among header actions in physical %s order without activating',
        async (direction) => {
            await init();
            const header = container.querySelector<HTMLElement>(
                '.category-checklist-header',
            )!;
            header.style.direction = direction;
            const buttons = [
                ...header.querySelectorAll<HTMLElement>(
                    'button, .category-checklist-master',
                ),
            ];
            expect(buttons).toHaveLength(2);
            const physical =
                direction === 'rtl' ? [...buttons].reverse() : buttons;
            physical.forEach((button, index) => {
                button.getBoundingClientRect = () =>
                    ({
                        left: 20 + index * 80,
                        right: 90 + index * 80,
                        top: 10,
                        bottom: 40,
                        width: 70,
                        height: 30,
                    }) as DOMRect;
            });
            const activated = buttons.map(() => vi.fn());
            buttons.forEach((button, index) =>
                button.addEventListener('click', activated[index]),
            );
            const originalStops = buttons.map((button) => button.tabIndex);
            const before = checklist.getAssertions();
            physical[0].focus();
            expect(press(physical[0], 'ArrowLeft').defaultPrevented).toBe(true);
            expect(document.activeElement).toBe(physical[0]);
            for (let index = 1; index < physical.length; index++) {
                expect(
                    press(physical[index - 1], 'ArrowRight').defaultPrevented,
                ).toBe(true);
                expect(document.activeElement).toBe(physical[index]);
            }
            expect(press(physical.at(-1)!, 'ArrowRight').defaultPrevented).toBe(
                true,
            );
            expect(document.activeElement).toBe(physical.at(-1));
            for (let index = physical.length - 2; index >= 0; index--) {
                press(physical[index + 1], 'ArrowLeft');
                expect(document.activeElement).toBe(physical[index]);
            }
            expect(buttons.map((button) => button.tabIndex)).toEqual(
                originalStops,
            );
            expect(checklist.getAssertions()).toEqual(before);
            activated.forEach((click) => expect(click).not.toHaveBeenCalled());
            expect(press(physical[0], 'Tab').defaultPrevented).toBe(false);
            for (const modifiers of [
                { altKey: true },
                { ctrlKey: true },
                { metaKey: true },
                { shiftKey: true },
                { isComposing: true },
            ]) {
                expect(
                    press(physical[0], 'ArrowRight', modifiers)
                        .defaultPrevented,
                ).toBe(false);
                expect(document.activeElement).toBe(physical[0]);
            }
        },
    );

    it('contains header arrows when the bulk checkbox is unavailable', async () => {
        await init();
        const brand = container.querySelector<HTMLElement>('.ez-status-mark')!;
        const bulk = container.querySelector<HTMLInputElement>(
            '.category-checklist-master',
        )!;
        bulk.disabled = true;
        brand.focus();
        expect(press(brand, 'ArrowRight').defaultPrevented).toBe(true);
        expect(document.activeElement).toBe(brand);
        press(brand, 'ArrowDown');
        expect(document.activeElement).toBe(boxes()[0]);
    });

    const suggestions = (ids: string[]): Suggestion[] =>
        engine
            .getScheme()
            .concepts.filter((concept) => ids.includes(concept.id))
            .map((concept) => ({
                conceptId: concept.id,
                categoryId: 'items',
                label: concept.name,
                name: concept.name,
                description: '',
                views: concept.views,
                selected: false,
                order: concept.position,
                group: 'items',
            }));
    const allow = (ids: string[]) =>
        checklist.applyAllowableOptions(suggestions(ids));
    const visibleChoices = () => boxes().map((box) => box.dataset.conceptId);

    it('offers an item the Runtime adds beside a checked choice and removes it when unchecked', async () => {
        vi.mocked(engine.suggest).mockImplementation((input) => ({
            warnings: [],
            suggestions: suggestions(
                Array.isArray(input) &&
                    input.some((a) => a.conceptId === 'item-a')
                    ? ['item-c']
                    : [],
            ),
        }));
        await init();
        allow(['item-a', 'item-b']);
        expect(visibleChoices()).toEqual(['item-a', 'item-b']);

        const first = boxes()[0];
        first.focus();
        first.click();
        await expect
            .poll(visibleChoices)
            .toEqual(['item-a', 'item-b', 'item-c']);
        expect(document.activeElement).toBe(boxes()[0]);

        boxes()[0].click();
        await expect.poll(visibleChoices).toEqual(['item-a', 'item-b']);
    });

    it('authors an inferred choice on its first native activation and hides inherited facts', async () => {
        await init();
        checklist.applyStoreState({
            rendered: 'item-a,item-b',
            renders: {},
            valid: true,
            errors: [],
            assertions: [
                {
                    conceptId: 'item-a',
                    categoryId: 'items',
                    source: 'infer',
                    confidence: 'inferred',
                },
                {
                    conceptId: 'item-b',
                    categoryId: 'items',
                    source: 'context',
                    confidence: 'certain',
                },
            ],
        } as never);
        const item = () =>
            boxes().find((box) => box.dataset.conceptId === 'item-a')!;
        expect(item().checked).toBe(false);
        expect(item().getAttribute('aria-label')).toBe('Item Alpha (inferred)');
        expect(visibleChoices()).not.toContain('item-b');
        item().focus();
        item().click();
        expect(item().checked).toBe(true);
        expect(item().hasAttribute('aria-label')).toBe(false);
        expect(document.activeElement).toBe(item());
        expect(checklist.getAssertions()).toContainEqual(
            expect.objectContaining({ conceptId: 'item-a', source: 'user' }),
        );
    });

    it('keeps each top-level choice with its indented Runtime suggestions', async () => {
        const tier = (id: string, depth: number) => ({
            ...suggestions([id])[0],
            depth,
        });
        vi.mocked(engine.suggest).mockImplementation((input) => ({
            warnings: [],
            suggestions:
                Array.isArray(input) &&
                input.some((a) => a.conceptId === 'item-a')
                    ? [
                          tier('item-a', 0),
                          tier('item-d', 1),
                          tier('item-c', 2),
                          tier('item-b', 0),
                      ]
                    : [],
        }));
        await init();
        checklist.applyAllowableOptions([tier('item-a', 0), tier('item-b', 0)]);
        boxes()[0].click();

        await expect
            .poll(visibleChoices)
            .toEqual(['item-a', 'item-d', 'item-c', 'item-b']);
        const indents = () =>
            boxes().map((box) =>
                box.parentElement?.style.getPropertyValue(
                    '--ez-checklist-indent',
                ),
            );
        expect(indents()).toEqual(['', '0.75rem', '1.5rem', '']);
        expect(
            [...container.querySelectorAll('.category-checklist-column')].map(
                (column) =>
                    [...column.querySelectorAll<HTMLInputElement>('input')].map(
                        (input) => input.dataset.conceptId,
                    ),
            ),
        ).toEqual([['item-a', 'item-d', 'item-c'], ['item-b']]);

        boxes()[0].click();
        await expect.poll(visibleChoices).toEqual(['item-a', 'item-b']);
        checklist.applyAllowableOptions([tier('item-b', 0), tier('item-a', 1)]);
        expect(visibleChoices()).toEqual(['item-b', 'item-a']);
        expect(indents()).toEqual(['', '0.75rem']);
    });

    it('moves vertically inside a branch and across a row even when its entries have different depths', async () => {
        await init();
        checklist.applyAllowableOptions(
            suggestions(['item-a', 'item-b', 'item-c', 'item-d']).map(
                (choice, index) => ({ ...choice, depth: [0, 1, 0, 2][index] }),
            ),
        );
        const [rootA, childA, rootB, childB] = boxes();
        for (const [index, box] of boxes().entries()) {
            const left = index < 2 ? 0 : 120;
            const top = index % 2 ? 32 : 0;
            box.parentElement!.getBoundingClientRect = () =>
                new DOMRect(left, top, 100, 32);
        }
        rootA.focus();
        press(rootA, 'ArrowDown');
        expect(document.activeElement).toBe(childA);
        press(childA, 'ArrowRight');
        expect(document.activeElement).toBe(childB);
        press(childB, 'ArrowUp');
        expect(document.activeElement).toBe(rootB);
        childA.parentElement!.getBoundingClientRect = () =>
            new DOMRect(0, 64, 100, 32);
        childA.focus();
        press(childA, 'ArrowRight');
        expect(document.activeElement).toBe(childB);
        expect(checklist.getAssertions()).toEqual([]);
    });

    it('refreshes additional options when the store updates the choice or its sibling context', async () => {
        const selected: Assertion = {
            conceptId: 'item-a',
            categoryId: 'items',
            confidence: 'certain',
            source: 'user',
        };
        let siblings: Assertion[] = [];
        vi.mocked(engine.suggest).mockImplementation((input) => ({
            warnings: [],
            suggestions: suggestions(
                Array.isArray(input) &&
                    input.some((a) => a.conceptId === 'other-1')
                    ? ['item-d']
                    : ['item-c'],
            ),
        }));
        await init({ resolveFacetSiblings: () => siblings, facetOf: 'doc' });
        allow(['item-a', 'item-b']);
        checklist.setAssertions([selected]);
        await expect
            .poll(visibleChoices)
            .toEqual(['item-a', 'item-b', 'item-c']);

        siblings = [{ ...selected, conceptId: 'other-1', categoryId: 'other' }];
        checklist.refreshFacetRefusal();
        await expect
            .poll(visibleChoices)
            .toEqual(['item-a', 'item-b', 'item-d']);
        expect(boxes()[0].checked).toBe(true);
    });

    it('puts the first working item before header actions in native Tab order and returns from its header', async () => {
        await init({ initialValue: 'item-b', showSearch: true });
        const first = boxes()[0];
        const brand = container.querySelector<HTMLElement>('.ez-status-mark')!;
        const clear = [
            ...container.querySelectorAll<HTMLButtonElement>(
                '.category-checklist-master',
            ),
        ].at(-1)!;
        expect(first.tabIndex).toBe(0);
        expect(boxes()[1].checked).toBe(true);
        expect(
            first.compareDocumentPosition(brand) &
                Node.DOCUMENT_POSITION_FOLLOWING,
        ).toBeTruthy();
        const before = checklist.getAssertions();
        first.focus();
        press(first, 'ArrowUp');
        expect(document.activeElement).toBe(brand);
        press(brand, 'ArrowDown');
        expect(document.activeElement).toBe(first);
        clear.focus();
        press(clear, 'ArrowDown');
        expect(document.activeElement).toBe(first);
        expect(checklist.getAssertions()).toEqual(before);
        expect(
            container.querySelector('.ez-tooltip--tools:not([hidden])'),
        ).toBeNull();
    });

    it('uses one first-item Tab stop until the author chooses another item', async () => {
        await init({ initialValue: 'item-b,item-d' });
        expect(
            boxes()
                .filter((box) => box.tabIndex === 0)
                .map((box) => box.dataset.conceptId),
        ).toEqual(['item-a']);
        boxes()[2].focus();
        checklist.setAssertions([
            {
                conceptId: 'item-d',
                categoryId: 'items',
                confidence: 'certain',
                source: 'user',
            },
        ]);
        expect(
            boxes()
                .filter((box) => box.tabIndex === 0)
                .map((box) => box.dataset.conceptId),
        ).toEqual(['item-c']);
        expect(press(boxes()[2], 'Tab').defaultPrevented).toBe(false);
        expect(
            press(boxes()[2], 'Tab', { shiftKey: true }).defaultPrevented,
        ).toBe(false);
        expect(
            container.querySelectorAll('.category-checklist-master'),
        ).toHaveLength(1);
        expect(
            container
                .querySelector('.ez-status-mark')
                ?.getAttribute('tabindex'),
        ).not.toBe('-1');
    });

    it('moves through the vertical list, contains edges and horizontal arrows, and never toggles by navigation', async () => {
        await init();
        boxes()[0].focus();
        let escaped = 0;
        container.addEventListener('keydown', () => escaped++);
        expect(press(boxes()[0], 'ArrowUp').defaultPrevented).toBe(true);
        expect(document.activeElement).toBe(
            container.querySelector('.ez-status-mark'),
        );
        press(document.activeElement as HTMLElement, 'ArrowDown');
        expect(document.activeElement).toBe(boxes()[0]);
        for (let index = 1; index < boxes().length; index++) {
            press(boxes()[index - 1], 'ArrowDown');
            expect(document.activeElement).toBe(boxes()[index]);
            expect(boxes().filter((box) => box.tabIndex === 0)).toEqual([
                boxes()[index],
            ]);
        }
        press(boxes().at(-1)!, 'ArrowDown');
        expect(document.activeElement).toBe(boxes().at(-1));
        press(boxes().at(-1)!, 'Home');
        expect(document.activeElement).toBe(boxes()[0]);
        press(boxes()[0], 'End');
        expect(document.activeElement).toBe(boxes().at(-1));
        press(boxes().at(-1)!, 'ArrowUp');
        expect(document.activeElement).toBe(boxes().at(-2));
        for (const key of ['ArrowLeft', 'ArrowRight']) {
            expect(press(boxes().at(-2)!, key).defaultPrevented).toBe(true);
            expect(document.activeElement).toBe(boxes().at(-2));
        }
        expect(checklist.getAssertions()).toEqual([]);
        expect(escaped).toBe(0);
    });

    it('skips native-disabled items while retaining one available Tab stop', async () => {
        await init();
        boxes()[1].disabled = true;
        boxes()[0].focus();
        press(boxes()[0], 'ArrowDown');
        expect(document.activeElement).toBe(boxes()[2]);
        expect(
            boxes().filter((box) => !box.disabled && box.tabIndex === 0),
        ).toEqual([boxes()[2]]);
        press(boxes()[2], 'ArrowUp');
        expect(document.activeElement).toBe(boxes()[0]);
    });

    it('Enter toggles the native checkbox exactly once through async processing while Space remains native', async () => {
        await init();
        const process = vi.mocked(engine.process).getMockImplementation()!;
        vi.mocked(engine.process).mockImplementation(async (...args) =>
            process(...args),
        );
        const box = boxes()[1];
        box.focus();
        for (const selected of [true, false]) {
            expect(press(box, 'Enter').defaultPrevented).toBe(true);
            await vi.waitFor(() => expect(box.checked).toBe(selected));
            await vi.waitFor(() =>
                expect(
                    checklist
                        .getAssertions()
                        .some((a) => a.conceptId === 'item-b'),
                ).toBe(selected),
            );
            expect(document.activeElement).toBe(box);
        }
        expect(press(box, ' ').defaultPrevented).toBe(false);
        // Jsdom does not supply the browser's default Space activation.
        box.click();
        await vi.waitFor(() =>
            expect(
                checklist.getAssertions().some((a) => a.conceptId === 'item-b'),
            ).toBe(true),
        );
        expect(document.activeElement).toBe(box);
    });

    it('preserves native modifiers, composition, and filter-input caret keys', async () => {
        await init({ showSearch: true });
        boxes()[0].focus();
        for (const modifiers of [
            { ctrlKey: true },
            { metaKey: true },
            { altKey: true },
            { shiftKey: true },
            { isComposing: true },
        ]) {
            expect(
                press(boxes()[0], 'ArrowDown', modifiers).defaultPrevented,
            ).toBe(false);
            expect(press(boxes()[0], 'Enter', modifiers).defaultPrevented).toBe(
                false,
            );
            expect(document.activeElement).toBe(boxes()[0]);
        }
        const search = container.querySelector<HTMLInputElement>(
            '.category-checklist-search',
        )!;
        search.focus();
        expect(press(search, 'ArrowDown').defaultPrevented).toBe(false);
        expect(press(search, 'ArrowLeft').defaultPrevented).toBe(false);
        expect(document.activeElement).toBe(search);
        expect(checklist.getAssertions()).toEqual([]);
    });

    it('restores a live checkbox by identity on allowability redraw, falling back only when removed', async () => {
        await init();
        boxes()[1].focus();
        allow(['item-b', 'item-c', 'item-d']);
        expect(document.activeElement).toBe(boxes()[0]);
        expect((document.activeElement as HTMLElement).dataset.conceptId).toBe(
            'item-b',
        );
        expect(boxes()[0].tabIndex).toBe(0);
        allow(['item-c', 'item-d']);
        expect(document.activeElement).toBe(boxes()[0]);
        expect((document.activeElement as HTMLElement).dataset.conceptId).toBe(
            'item-c',
        );
        allow([]);
        expect(document.activeElement).toBe(
            container.querySelector('.category-checklist-list'),
        );
        expect(boxes()).toHaveLength(0);
    });

    it.each([false, true])(
        'returns from a temporarily empty group only while it still owns focus (outside: %s)',
        async (outside) => {
            await init();
            boxes().at(-1)!.focus();
            allow([]);
            expect(document.activeElement).toBe(
                container.querySelector('.category-checklist-list'),
            );
            const elsewhere = document.createElement('button');
            document.body.appendChild(elsewhere);
            if (outside) elsewhere.focus();
            allow(['item-a', 'item-b']);
            expect(document.activeElement).toBe(
                outside ? elsewhere : boxes()[0],
            );
            expect(boxes()[0].tabIndex).toBe(0);
            elsewhere.remove();
        },
    );

    it.each(['outside', 'search', 'header'])(
        'never reclaims %s focus during a list refresh',
        async (location) => {
            await init({ showSearch: true });
            boxes()[2].focus();
            const outside = document.createElement('button');
            document.body.appendChild(outside);
            const target =
                location === 'outside'
                    ? outside
                    : container.querySelector<HTMLElement>(
                          location === 'search'
                              ? '.category-checklist-search'
                              : '.category-checklist-master',
                      )!;
            target.focus();
            allow(['item-a', 'item-c']);
            expect(document.activeElement).toBe(target);
            outside.remove();
        },
    );

    it('preserves checkbox identity through filter redraw and leaves the focused search input alone', async () => {
        await init({ showSearch: true });
        const search = container.querySelector<HTMLInputElement>(
            '.category-checklist-search',
        )!;
        boxes()[2].focus();
        search.value = 'Charlie';
        search.dispatchEvent(new Event('input', { bubbles: true }));
        expect(document.activeElement).toBe(boxes()[0]);
        expect(boxes()[0].dataset.conceptId).toBe('item-c');
        search.value = 'Delta';
        search.dispatchEvent(new Event('input', { bubbles: true }));
        expect(document.activeElement).toBe(boxes()[0]);
        expect(boxes()[0].dataset.conceptId).toBe('item-d');
        search.focus();
        search.value = 'Alpha';
        search.dispatchEvent(new Event('input', { bubbles: true }));
        expect(document.activeElement).toBe(search);
        expect(boxes().filter((box) => box.tabIndex === 0)).toHaveLength(1);
    });

    it('names its category in the first row, which is not a heading the host did not write', async () => {
        await init();
        const header = container.querySelector('.category-checklist-header')!;
        expect(
            header.querySelector('.category-checklist-name')?.textContent,
        ).toBe('Items');
        expect(header.querySelector('h1, h2, h3, h4, h5, h6')).toBeNull();
        const controls = header.querySelector('.category-checklist-controls')!;
        expect([...controls.children].map((child) => child.className)).toEqual([
            'ez-field-chrome ez-field-chrome--inline',
        ]);
        expect(controls.querySelector('.ez-status-mark')).not.toBeNull();
        expect(
            controls.querySelector(
                '.ez-field-chrome > .category-checklist-toggle',
            ),
        ).not.toBeNull();
        expect(
            container.querySelector('.category-checklist-frame')
                ?.lastElementChild?.className,
        ).toBe('category-checklist-count');
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

    it('shows the search input only when the list is longer than its room', async () => {
        await init();
        const search = container.querySelector<HTMLInputElement>(
            '.category-checklist-search',
        )!;
        const list = container.querySelector<HTMLElement>(
            '.category-checklist-list',
        )!;
        // Every item fits: no filter to take up room.
        expect(search.hidden).toBe(true);
        // The engine offers nothing, then everything again, and the list
        // that comes back scrolls: the filter shows.
        checklist.applyAllowableOptions([]);
        expect(search.hidden).toBe(true);
        Object.defineProperty(list, 'scrollHeight', {
            configurable: true,
            value: 600,
        });
        Object.defineProperty(list, 'clientHeight', {
            configurable: true,
            value: 352,
        });
        checklist.applyAllowableOptions(null);
        expect(search.hidden).toBe(false);
    });

    it('keeps the search input while it holds a filter, and always when asked', async () => {
        await init();
        const search = container.querySelector<HTMLInputElement>(
            '.category-checklist-search',
        )!;
        search.value = 'Alpha';
        search.dispatchEvent(new Event('input', { bubbles: true }));
        expect(search.hidden).toBe(false);
        checklist.destroy();
        container.innerHTML = '';
        checklist = new CategoryChecklist();
        await init({ showSearch: true });
        expect(
            container.querySelector<HTMLInputElement>(
                '.category-checklist-search',
            )!.hidden,
        ).toBe(false);
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

    it('exposes empty, checked, and mixed states and toggles the category through the adapter', async () => {
        await init();
        const toggle = container.querySelector<HTMLInputElement>(
            '.category-checklist-master',
        )!;
        expect(toggle.getAttribute('aria-label')).toBe('Select all Items');
        expect(toggle.checked).toBe(false);
        expect(toggle.indeterminate).toBe(false);

        toggle.click();
        expect(toggle.checked).toBe(true);
        expect(toggle.indeterminate).toBe(false);
        expect(
            checklist
                .getAssertions()
                .filter((item) => item.categoryId === 'items'),
        ).toHaveLength(5);

        toggle.click();
        expect(toggle.checked).toBe(false);
        expect(toggle.indeterminate).toBe(false);
        expect(
            checklist
                .getAssertions()
                .filter((item) => item.categoryId === 'items'),
        ).toHaveLength(0);

        boxes()[0].click();
        expect(toggle.indeterminate).toBe(true);
        toggle.click();
        expect(toggle.checked).toBe(true);
        expect(toggle.indeterminate).toBe(false);
        expect(
            checklist
                .getAssertions()
                .filter((item) => item.categoryId === 'items'),
        ).toHaveLength(5);
        toggle.click();
        expect(toggle.checked).toBe(false);
        expect(
            checklist
                .getAssertions()
                .filter((item) => item.categoryId === 'items'),
        ).toHaveLength(0);
    });

    it('can hide the bulk checkbox', async () => {
        await init({ showToggleAll: false });
        expect(
            container.querySelector('.category-checklist-master'),
        ).toBeNull();
    });

    it('clears old corrections even if the Runtime fills the category again', async () => {
        const process = vi.mocked(engine.process).getMockImplementation()!;
        const initialFix = {
            ruleId: 'old-addition',
            action: 'add',
            add: [{ conceptId: 'item-a', categoryId: 'items' }],
            message: 'The rule added Alpha',
        } as const;
        const defaultItem = {
            conceptId: 'item-a',
            categoryId: 'items',
            confidence: 'certain',
            source: 'default',
        } as const;
        const sibling = {
            conceptId: 'other-1',
            categoryId: 'other',
            confidence: 'certain',
            source: 'user',
        } as const;
        await init({ facetOf: 'doc', resolveFacetSiblings: () => [sibling] });
        checklist.applyStoreState({
            rendered: 'item-a,other-1',
            renders: {},
            valid: true,
            errors: [],
            assertions: [{ ...defaultItem, source: 'user' }],
            appliedFixes: [initialFix],
        } as never);
        expect(checklist.getAppliedFixes()).toEqual([initialFix]);

        vi.mocked(engine.process).mockImplementation((input, options) => ({
            ...(process(input, options) as Awaited<ReturnType<typeof process>>),
            rendered: 'item-a,other-1',
            assertions: [defaultItem, sibling],
        }));
        checklist['clearAll']();

        expect(checklist.getAppliedFixes()).toEqual([]);
        expect(checklist.getAssertions()).toEqual([defaultItem]);
        expect(engine.process).toHaveBeenCalledWith(
            '',
            expect.objectContaining({
                assertions: [sibling],
            }),
        );
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
        expect(rule('.category-checklist-count')).toMatch(
            /align-self:\s*flex-end/,
        );
    });
});
