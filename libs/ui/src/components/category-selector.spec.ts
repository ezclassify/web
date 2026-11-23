import { openFieldTools } from '../../test-fixtures/marking-tools';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
    CategorySelector,
    type CategorySelectorOptions,
} from './category-selector';
import type { SchemeEngineAdapter, Assertion } from '@ezclassify/types';
import type { SchemePublicView } from '@ezclassify/types';
import { schemeOnlyContext } from '../../test-fixtures/context-doubles';
import { mockRenderFormats } from '../render-format-layout-mock';
import { EzClassifyUI } from '../ezclassify-ui';
import { VanillaEzClassifyStore } from '../store/ezclassify-store';

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
            defaultScope: scheme.defaultScope,
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
            (
                input: string | Assertion[],
                options?: { assertions?: Assertion[] },
            ) => {
                const facts = Array.isArray(input)
                    ? input
                    : options?.assertions;
                if (facts) {
                    const rendered = facts.map((a) => a.conceptId).join(':');
                    return {
                        assertions: facts.map((a) => ({ ...a })),
                        rendered,
                        valid: true,
                        errors: [],
                        proposedFixes: [],
                    };
                }
                if (typeof input !== 'string')
                    throw new Error('Expected marking text');
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
                return {
                    assertions,
                    rendered: input,
                    valid: true,
                    errors: [],
                    proposedFixes: [],
                };
            },
        ),
        suggest: vi.fn(() => ({
            suggestions: scheme.concepts.map((concept) => ({
                conceptId: concept.id,
                categoryId: concept.categories[0],
                label: concept.name,
                description: '',
                name: concept.name,
                views: concept.views,
                group: concept.categories[0],
                selected: false,
                order: concept.position,
            })),
        })),
        describeConcept: (conceptId: string, categoryId: string) => {
            const concept = (scheme.concepts ?? []).find(
                (c) => c.id === conceptId,
            );
            return { lines: [`${categoryId}: ${concept?.name ?? conceptId}`] };
        },
    } as unknown as SchemeEngineAdapter;
}

const toCtx = (eng: unknown) => schemeOnlyContext(eng as never);
/**
 * Dispatch the real controller key path, then jsdom's missing native button
 * activation.
 */
function activateChoice(button: HTMLElement, key: string): void {
    const event = new KeyboardEvent('keydown', {
        key,
        bubbles: true,
        cancelable: true,
    });
    button.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    button.dispatchEvent(new KeyboardEvent('keyup', { key, bubbles: true }));
    button.click();
}

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
    afterEach(() => {
        if (container.querySelector('.category-selector-body'))
            selector.destroy();
        container.remove();
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

    it('renders both category modes through DecisionFlow shared native choices', async () => {
        await init();
        const choices = [
            ...container.querySelectorAll<HTMLButtonElement>(
                '.category-selector-btn',
            ),
        ];
        expect(
            choices.every((button) =>
                button.classList.contains('ez-choice-button'),
            ),
        ).toBe(true);
        expect(choices.every((button) => button.type === 'button')).toBe(true);
        expect(choices[0].getAttribute('role')).toBe('radio');
        expect(
            choices
                .find((button) => button.dataset.categoryId === 'f2')
                ?.getAttribute('role'),
        ).toBe('checkbox');
    });
    it('shows an engine-offered same-category child after its parent in shared preorder despite a baseline omission', async () => {
        const profile = engine.getScheme();
        const child = profile.concepts.find((concept) => concept.id === 'c5')!;
        child.parents = ['c4'];
        child.position = 99;
        await init({ categoryId: 'f2', initialValue: 'c4' });
        const offered = await engine.suggest!([]);
        selector.applyAllowableOptions(
            offered.suggestions.filter((entry) => entry.conceptId !== 'c5'),
        );
        expect(
            [
                ...container.querySelectorAll<HTMLElement>(
                    '.category-selector-btn',
                ),
            ].map((button) => button.dataset.conceptId),
        ).toEqual(['c4', 'c5', 'c6']);
        activateChoice(
            container.querySelector<HTMLElement>('[data-concept-id="c4"]')!,
            'Enter',
        );
        await vi.waitFor(() =>
            expect(
                container.querySelector('[data-concept-id="c5"]'),
            ).toBeNull(),
        );
    });
    it('uses the shared blocked interaction and DecisionFlow canonical reason without selecting', async () => {
        const suggest = vi.mocked(engine.suggest!).getMockImplementation()!;
        vi.mocked(engine.suggest!).mockImplementation(
            async (input, options) => {
                const answer = await suggest(input, options);
                return {
                    ...answer,
                    suggestions: answer.suggestions.filter(
                        (entry) => entry.conceptId !== 'c5',
                    ),
                };
            },
        );
        const process = vi.mocked(engine.process).getMockImplementation()!;
        vi.mocked(engine.process).mockImplementation(async (input, options) => {
            const answer = await process(input, options);
            return {
                ...answer,
                errors: answer.assertions.some(
                    (assertion) => assertion.conceptId === 'c5',
                )
                    ? [
                          {
                              constraintId: 'exclusive',
                              message: 'Selected X excludes Y.',
                              affectedConcepts: ['c5'],
                          },
                      ]
                    : [],
            };
        });
        await init({ categoryId: 'f2', initialValue: 'c4' });
        const blocked = container.querySelector<HTMLButtonElement>(
            '[data-concept-id="c5"]',
        )!;
        expect(blocked.getAttribute('aria-disabled')).toBe('true');
        expect(
            container.querySelector('.ez-choice-reason')?.getAttribute('role'),
        ).toBe('status');
        blocked.focus();
        await vi.waitFor(() =>
            expect(
                container.querySelector('.ez-choice-reason')?.textContent,
            ).toContain('Selected X excludes Y.'),
        );
        activateChoice(blocked, 'Enter');
        expect(
            selector.getAssertions().map((assertion) => assertion.conceptId),
        ).toEqual(['c4']);
    });

    it.each([
        { buttonSelector: '.ez-status-mark', leave: false },
        { buttonSelector: '.ez-clear-button', leave: false },
        { buttonSelector: '.ez-status-mark', leave: true },
        { buttonSelector: '.ez-clear-button', leave: true },
    ])(
        'retains $buttonSelector focus through deferred catalog rendering without reclaiming outside focus ($leave)',
        async ({ buttonSelector, leave }) => {
            await init({ categoryId: 'f2', initialValue: 'c4' });
            const suggest = vi.mocked(engine.suggest!).getMockImplementation()!;
            let release!: () => void;
            const pending = new Promise<void>((resolve) => {
                release = resolve;
            });
            const started = vi.fn();
            vi.mocked(engine.suggest!).mockImplementation(
                async (input, options) => {
                    const result = await suggest(input, options);
                    started();
                    await pending;
                    return result;
                },
            );
            selector.setAssertions([
                {
                    conceptId: 'c5',
                    categoryId: 'f2',
                    confidence: 'certain',
                    source: 'user',
                },
            ]);
            await vi.waitFor(() => expect(started).toHaveBeenCalled());
            const target =
                container.querySelector<HTMLButtonElement>(buttonSelector)!;
            expect(target.disabled).toBe(false);
            const previous = container.querySelector('.category-selector-btn');
            target.focus();
            const outside = document.createElement('button');
            document.body.appendChild(outside);
            if (leave) outside.focus();
            release();
            await vi.waitFor(() =>
                expect(
                    container.querySelector('.category-selector-btn'),
                ).not.toBe(previous),
            );
            expect(container.querySelector(buttonSelector)).toBe(target);
            expect(target.isConnected).toBe(true);
            expect(document.activeElement).toBe(leave ? outside : target);
            outside.remove();
        },
    );

    it('leaves the portaled Tools tab focused when a catalog render moves its branding button', async () => {
        await init({ categoryId: 'f2', initialValue: 'c4' });
        const suggest = vi.mocked(engine.suggest!).getMockImplementation()!;
        let release!: () => void;
        const pending = new Promise<void>((resolve) => {
            release = resolve;
        });
        const started = vi.fn();
        vi.mocked(engine.suggest!).mockImplementation(
            async (input, options) => {
                const result = await suggest(input, options);
                started();
                await pending;
                return result;
            },
        );
        selector.setAssertions([
            {
                conceptId: 'c5',
                categoryId: 'f2',
                confidence: 'certain',
                source: 'user',
            },
        ]);
        await vi.waitFor(() => expect(started).toHaveBeenCalled());
        const brand =
            container.querySelector<HTMLButtonElement>('.ez-status-mark')!;
        brand.click();
        const tab = document
            .getElementById(brand.getAttribute('aria-describedby')!)!
            .querySelector<HTMLButtonElement>('[role="tab"]')!;
        tab.focus();
        const previous = container.querySelector('.category-selector-btn');
        release();
        await vi.waitFor(() =>
            expect(container.querySelector('.category-selector-btn')).not.toBe(
                previous,
            ),
        );
        expect(document.activeElement).toBe(tab);
        expect(tab.isConnected).toBe(true);
    });

    it.each([false, true])(
        'gives each category a first-choice Tab stop and retains its own current option (grouped %s)',
        async (grouped) => {
            await init({
                initialValue: 'c2:c5',
                ...(grouped
                    ? { categoryGroups: { Second: ['f2'], First: ['f1'] } }
                    : {}),
            });
            const button = (id: string) =>
                container.querySelector<HTMLButtonElement>(
                    `[data-concept-id="${id}"]`,
                )!;
            const stops = () =>
                [
                    ...container.querySelectorAll<HTMLButtonElement>(
                        '.category-selector-btn[tabindex="0"]',
                    ),
                ].map((item) => item.dataset.conceptId);
            expect(stops()).toEqual(grouped ? ['c4', 'c1'] : ['c1', 'c4']);
            for (const row of container.querySelectorAll(
                '.category-selector-row',
            ))
                expect(
                    row.querySelectorAll(
                        '.category-selector-btn[tabindex="0"]',
                    ),
                ).toHaveLength(1);
            button('c2').focus();
            button('c2').dispatchEvent(
                new KeyboardEvent('keydown', {
                    key: 'ArrowRight',
                    bubbles: true,
                    cancelable: true,
                }),
            );
            expect(document.activeElement).toBe(button('c3'));
            expect(button('c4').tabIndex).toBe(0);
            selector.setAssertions([
                {
                    conceptId: 'c2',
                    categoryId: 'f1',
                    confidence: 'certain',
                    source: 'user',
                },
                {
                    conceptId: 'c4',
                    categoryId: 'f2',
                    confidence: 'certain',
                    source: 'user',
                },
            ]);
            await vi.waitFor(() =>
                expect(button('c4').getAttribute('aria-checked')).toBe('true'),
            );
            expect(document.activeElement).toBe(button('c3'));
            expect(stops()).toEqual(grouped ? ['c4', 'c3'] : ['c3', 'c4']);
            button('c4').focus();
            selector.setAssertions([
                {
                    conceptId: 'c2',
                    categoryId: 'f1',
                    confidence: 'certain',
                    source: 'user',
                },
                {
                    conceptId: 'c5',
                    categoryId: 'f2',
                    confidence: 'certain',
                    source: 'user',
                },
            ]);
            await vi.waitFor(() =>
                expect(button('c5').getAttribute('aria-checked')).toBe('true'),
            );
            expect(document.activeElement).toBe(button('c4'));
            expect(stops()).toEqual(grouped ? ['c4', 'c3'] : ['c3', 'c4']);
        },
    );

    it('keeps one default stop per category when other rows are navigated or filtered', async () => {
        await init();
        const button = (id: string) =>
            container.querySelector<HTMLButtonElement>(
                `[data-concept-id="${id}"]`,
            )!;
        expect(button('c1').tabIndex).toBe(0);
        expect(button('c4').tabIndex).toBe(0);
        button('c2').focus();
        button('c5').focus();
        expect(button('c2').tabIndex).toBe(0);
        expect(button('c5').tabIndex).toBe(0);
        button('c5').dispatchEvent(
            new KeyboardEvent('keydown', {
                key: 'Home',
                bubbles: true,
                cancelable: true,
            }),
        );
        expect(button('c2').tabIndex).toBe(0);
        expect(button('c4').tabIndex).toBe(0);
        const outside = document.createElement('button');
        document.body.appendChild(outside);
        outside.focus();
        const options = await engine.suggest!([]);
        selector.applyAllowableOptions(
            options.suggestions.filter((option) =>
                ['c2', 'c5'].includes(option.conceptId),
            ),
        );
        expect(document.activeElement).toBe(outside);
        expect(
            [
                ...container.querySelectorAll<HTMLButtonElement>(
                    '.category-selector-btn[tabindex="0"]',
                ),
            ].map((item) => item.dataset.conceptId),
        ).toEqual(['c2', 'c5']);
        outside.remove();
    });

    it.each(['local', 'dependent', 'stale', 'outside'])(
        'applies a canonical whole %s remedy through the associated store while retaining captured values',
        async (choice) => {
            const scheme = engine.getScheme();
            (scheme.scopes ??= []).push(
                { id: 'default', label: 'Default' },
                { id: 'authority', label: 'Authority' },
            );
            scheme.defaultScope = 'default';
            engine.aggregateAssertions = vi.fn((sets: Assertion[][]) => ({
                assertions: sets.flat(),
                rendered: sets
                    .flat()
                    .map((fact) => fact.conceptId)
                    .join(':'),
                valid: true,
                errors: [],
                warnings: [],
                appliedFixes: [],
                notices: [],
                proposedFixes: [],
            }));
            scheme.categories.push(
                {
                    ...scheme.categories[1],
                    id: 'related',
                    label: 'Related values',
                },
                {
                    ...scheme.categories[1],
                    id: 'capture',
                    label: 'Captured values',
                    scopes: ['authority'],
                },
            );
            scheme.concepts.push(
                {
                    ...scheme.concepts[0],
                    id: 'country',
                    name: 'Country',
                    categories: ['related'],
                },
                {
                    ...scheme.concepts[0],
                    id: 'name',
                    name: 'Name',
                    categories: ['capture'],
                },
                {
                    ...scheme.concepts[0],
                    id: 'date',
                    name: 'Date',
                    categories: ['capture'],
                },
            );
            const process = vi.mocked(engine.process).getMockImplementation()!;
            const first: Assertion = {
                conceptId: 'c4',
                categoryId: 'f2',
                confidence: 'certain',
                source: 'user',
            };
            const second: Assertion = { ...first, conceptId: 'c5' };
            const country: Assertion = {
                ...first,
                conceptId: 'country',
                categoryId: 'related',
            };
            const name: Assertion = {
                ...first,
                conceptId: 'name',
                categoryId: 'capture',
                value: 'Jane Analyst',
            };
            const date: Assertion = {
                ...name,
                conceptId: 'date',
                value: '2040-01-01',
            };
            const refs = (facts: Assertion[]) =>
                facts.map(({ conceptId, categoryId }) => ({
                    conceptId,
                    categoryId,
                }));
            let holdUpdate = false;
            const updateReleases: Array<() => void> = [];
            vi.mocked(engine.process).mockImplementation(
                async (input, options) => {
                    const answer = await process(input, options);
                    if (
                        holdUpdate &&
                        options?.outputFormat === undefined &&
                        options?.surface === undefined
                    )
                        await new Promise<void>((resolve) =>
                            updateReleases.push(resolve),
                        );
                    const conflict =
                        answer.assertions.some(
                            (fact) => fact.conceptId === 'c4',
                        ) &&
                        answer.assertions.some(
                            (fact) => fact.conceptId === 'c5',
                        );
                    const fixes = [
                        {
                            message: 'Remove Option X.',
                            rendered: 'c5:country:name:date',
                            keeps: refs([second, country]),
                            adds: [],
                            removes: refs([first]),
                        },
                        {
                            message: 'Remove Option Y and Country.',
                            rendered: 'c4:name:date',
                            keeps: refs([first, name, date]),
                            adds: [],
                            removes: refs([second, country]),
                        },
                    ];
                    return {
                        ...answer,
                        valid: !conflict,
                        errors: conflict
                            ? [
                                  {
                                      constraintId: 'exclusive',
                                      categoryId: 'f2',
                                      message: 'These options conflict.',
                                  },
                              ]
                            : [],
                        proposedFixes:
                            conflict &&
                            !options?.outputFormat &&
                            !options?.surface
                                ? fixes
                                : [],
                    };
                },
            );
            container.innerHTML =
                '<input id="canonical-whole" type="hidden" data-ezclassify-marking><fieldset data-ezclassify-controller="selector" data-ezclassify-facet-of="canonical-whole" data-ezclassify-category="f2"></fieldset>';
            const store = new VanillaEzClassifyStore(engine);
            await store.publishAssertions('canonical-whole', [
                first,
                second,
                country,
                name,
                date,
            ]);
            const forms = new EzClassifyUI(toCtx(engine), {
                root: container,
                store,
            });
            try {
                const actions = () => [
                    ...(openFieldTools(
                        container,
                    )?.querySelectorAll<HTMLButtonElement>(
                        '.ez-validation-errors__fix',
                    ) ?? []),
                ];
                await vi.waitFor(() =>
                    expect(
                        actions().map((button) => button.textContent),
                    ).toEqual([
                        'Remove Option X',
                        'Remove Option Y and Country',
                    ]),
                );
                if (choice === 'stale') {
                    const previous = actions()[0];
                    previous.focus();
                    const newer = { ...name, value: 'A newer captured name' };
                    const newerDate = { ...date, value: '2050-02-03' };
                    holdUpdate = true;
                    await store.publishAssertions('canonical-whole', [
                        first,
                        second,
                        country,
                        newer,
                        newerDate,
                    ]);
                    await vi.waitFor(() =>
                        expect(updateReleases.length).toBeGreaterThan(0),
                    );
                    const publish = vi.spyOn(store, 'publishAssertions');
                    previous.click();
                    expect(publish).not.toHaveBeenCalled();
                    expect(
                        store.get('canonical-whole').assertions,
                    ).toContainEqual(expect.objectContaining(newer));
                    expect(
                        store
                            .get('canonical-whole')
                            .assertions.map((fact) => fact.conceptId),
                    ).toEqual(expect.arrayContaining(['c4', 'c5', 'country']));
                    expect(actions()).toHaveLength(0);
                    expect(document.activeElement).not.toBe(document.body);
                    holdUpdate = false;
                    updateReleases.splice(0).forEach((release) => release());
                    await vi.waitFor(() => expect(actions()).toHaveLength(2));
                    actions()[1].click();
                    await vi.waitFor(() =>
                        expect(
                            store
                                .get('canonical-whole')
                                .assertions.some(
                                    (fact) => fact.conceptId === 'c5',
                                ),
                        ).toBe(false),
                    );
                    expect(
                        store.get('canonical-whole').assertions,
                    ).toContainEqual(expect.objectContaining(newer));
                    expect(
                        store.get('canonical-whole').assertions,
                    ).toContainEqual(expect.objectContaining(newerDate));
                    return;
                }
                const action = actions()[choice === 'local' ? 0 : 1];
                action.focus();
                action.click();
                const outside = document.createElement('button');
                if (choice === 'outside') {
                    container.appendChild(outside);
                    outside.focus();
                }
                await vi.waitFor(() =>
                    expect(
                        store
                            .get('canonical-whole')
                            .assertions.some(
                                (fact) =>
                                    fact.conceptId ===
                                    (choice === 'local' ? 'c4' : 'c5'),
                            ),
                    ).toBe(false),
                );
                expect(store.get('canonical-whole').assertions).toContainEqual(
                    expect.objectContaining(name),
                );
                expect(store.get('canonical-whole').assertions).toContainEqual(
                    expect.objectContaining(date),
                );
                expect(
                    store
                        .get('canonical-whole')
                        .assertions.some(
                            (fact) => fact.conceptId === 'country',
                        ),
                ).toBe(choice === 'local');
                await vi.waitFor(() =>
                    expect(
                        container
                            .querySelector(
                                `[data-concept-id="${choice === 'local' ? 'c4' : 'c5'}"]`,
                            )
                            ?.getAttribute('aria-checked'),
                    ).toBe('false'),
                );
                if (choice === 'outside')
                    expect(document.activeElement).toBe(outside);
                else {
                    expect(
                        (
                            document.activeElement as HTMLElement
                        ).classList.contains('category-selector-btn'),
                    ).toBe(true);
                    expect(
                        (document.activeElement as HTMLButtonElement).disabled,
                    ).toBe(false);
                }
            } finally {
                forms.destroy();
            }
        },
    );

    it.each(['sibling', 'context', 'parts'])(
        'rejects an automatic whole proof after its %s input changes before a newer judgment starts',
        async (changed) => {
            const process = vi.mocked(engine.process).getMockImplementation()!;
            let name = 'Original name';
            let context = 'PARENT-A';
            let parts = ['PART-A'];
            let release: (() => void) | undefined;
            vi.mocked(engine.process).mockImplementation(
                async (input, options) => {
                    const answer = await process(input, options);
                    const result = {
                        ...answer,
                        valid: false,
                        errors: [
                            {
                                constraintId: 'exclusive',
                                categoryId: 'f2',
                                message: 'These options conflict.',
                            },
                        ],
                        proposedFixes: [] as import('@ezclassify/types').Fix[],
                    };
                    if (
                        options?.outputFormat === undefined &&
                        options?.surface === undefined
                    ) {
                        expect(options?.context).toEqual({
                            partOf: { rendered: 'PARENT-A' },
                        });
                        expect(options?.parts).toEqual(['PART-A']);
                        await new Promise<void>((resolve) => {
                            release = resolve;
                        });
                        result.proposedFixes = [
                            {
                                message: 'Remove Option Y.',
                                rendered: 'c4',
                                keeps: [{ conceptId: 'c4', categoryId: 'f2' }],
                                adds: [],
                                removes: [
                                    { conceptId: 'c5', categoryId: 'f2' },
                                ],
                            },
                        ];
                    }
                    return result;
                },
            );
            const mounting = init({
                facetOf: 'doc',
                categoryId: 'f2',
                initialValue: 'c4:c5',
                resolveFacetSiblings: () => [
                    {
                        conceptId: 'c1',
                        categoryId: 'f1',
                        value: name,
                        confidence: 'certain',
                        source: 'user',
                    },
                ],
                resolveContext: () => ({ partOf: { rendered: context } }),
                resolveParts: () => parts,
            });
            await vi.waitFor(() => expect(release).toBeTypeOf('function'));
            if (changed === 'sibling') name = 'New name';
            else if (changed === 'context') context = 'PARENT-B';
            else parts = ['PART-B'];
            release!();
            await mounting;
            expect(
                container.nextElementSibling?.querySelectorAll(
                    '.ez-validation-errors__fix',
                ).length ?? 0,
            ).toBe(0);
            expect(
                selector.getAssertions().map((fact) => fact.conceptId),
            ).toEqual(['c4', 'c5']);
        },
    );

    it('settles initial multi-choice availability before mounting completes', async () => {
        const suggest = vi.mocked(engine.suggest!).getMockImplementation()!;
        vi.mocked(engine.suggest!).mockImplementation(
            async (input, options) => {
                const result = await suggest(input, options);
                return {
                    ...result,
                    suggestions: result.suggestions.filter(
                        (entry) => entry.conceptId !== 'c5',
                    ),
                };
            },
        );
        await init({ facetOf: 'doc', categoryId: 'f2', initialValue: 'c4' });
        expect(
            container
                .querySelector('[data-concept-id="c5"]')
                ?.getAttribute('aria-disabled'),
        ).toBe('true');
        expect(
            container
                .querySelector('[data-concept-id="c4"]')
                ?.getAttribute('aria-disabled'),
        ).toBeNull();
    });

    it('does not redraw a destroyed mount when initial availability settles', async () => {
        const suggest = vi.mocked(engine.suggest!).getMockImplementation()!;
        let release!: () => void;
        const pending = new Promise<void>((resolve) => {
            release = resolve;
        });
        vi.mocked(engine.suggest!).mockImplementation(
            async (input, options) => {
                const result = await suggest(input, options);
                await pending;
                return result;
            },
        );
        const mounting = init({ categoryId: 'f2', initialValue: 'c4' });
        await vi.waitFor(() => expect(engine.suggest).toHaveBeenCalled());
        selector.destroy();
        release();
        await mounting;
        expect(container.children).toHaveLength(0);
    });

    it('reports a loaded invalid category after its rows are initialized', async () => {
        const process = vi.mocked(engine.process).getMockImplementation()!;
        vi.mocked(engine.process).mockImplementation(
            async (input, options) => ({
                ...(await process(input, options)),
                valid: false,
                errors: [
                    {
                        constraintId: 'exclusive',
                        categoryId: 'f2',
                        message: 'Loaded options conflict.',
                    },
                ],
                proposedFixes: [],
            }),
        );
        await init({ facetOf: 'doc', categoryId: 'f2', initialValue: 'c4:c5' });
        expect(container.nextElementSibling?.textContent).toContain(
            'Loaded options conflict.',
        );
        expect(container.hasAttribute('data-ezclassify-invalid')).toBe(true);
    });

    it('keeps the native-enabled deselected option focused while its former availability is replaced', async () => {
        const suggest = vi.mocked(engine.suggest!).getMockImplementation()!;
        vi.mocked(engine.suggest!).mockImplementation(
            async (input, options) => {
                const result = await suggest(input, options);
                return {
                    ...result,
                    suggestions: result.suggestions.filter(
                        (entry) => entry.conceptId !== 'c4',
                    ),
                };
            },
        );
        await init({ categoryId: 'f2', initialValue: 'c4' });
        const option = () =>
            container.querySelector<HTMLButtonElement>(
                '[data-concept-id="c4"]',
            )!;
        option().focus();
        activateChoice(option(), 'Enter');
        await vi.waitFor(() =>
            expect(option().getAttribute('aria-checked')).toBe('false'),
        );
        expect(option().disabled).toBe(false);
        expect(document.activeElement).toBe(option());
    });

    it.each(['Enter', ' '])(
        'retains a deselected option after async %s processing without reclaiming outside focus',
        async (key) => {
            await init({ categoryId: 'f2' });
            selector.setAssertions([
                {
                    conceptId: 'c4',
                    categoryId: 'f2',
                    confidence: 'certain',
                    source: 'user',
                },
                {
                    conceptId: 'c5',
                    categoryId: 'f2',
                    confidence: 'certain',
                    source: 'user',
                },
            ]);
            const option = () =>
                container.querySelector<HTMLButtonElement>(
                    '[data-concept-id="c4"]',
                )!;
            await vi.waitFor(() =>
                expect(option().getAttribute('aria-checked')).toBe('true'),
            );
            const process = vi.mocked(engine.process).getMockImplementation()!;
            let release!: () => void;
            let pending = new Promise<void>((resolve) => {
                release = resolve;
            });
            vi.mocked(engine.process).mockImplementation(
                async (input, options) => {
                    const result = await process(input, options);
                    await pending;
                    return result;
                },
            );
            option().focus();
            activateChoice(option(), key);
            release();
            await vi.waitFor(() =>
                expect(option().getAttribute('aria-checked')).toBe('false'),
            );
            expect(document.activeElement).toBe(option());

            pending = new Promise<void>((resolve) => {
                release = resolve;
            });
            activateChoice(option(), key);
            const outside = document.createElement('button');
            document.body.appendChild(outside);
            outside.focus();
            release();
            await vi.waitFor(() =>
                expect(option().getAttribute('aria-checked')).toBe('true'),
            );
            expect(document.activeElement).toBe(outside);
            outside.remove();
        },
    );

    it('preserves focused option identity when allowability changes its column', async () => {
        await init({ categoryId: 'f2' });
        const option = () =>
            container.querySelector<HTMLButtonElement>(
                '[data-concept-id="c5"]',
            )!;
        option().focus();
        selector.applyAllowableOptions([
            {
                conceptId: 'c5',
                categoryId: 'f2',
                label: 'Option Y',
                name: 'Option Y',
                description: '',
                views: { default: 'Option Y' },
                selected: false,
                order: 0,
                group: 'f2',
            },
        ]);
        expect(document.activeElement).toBe(option());
        expect(option().tabIndex).toBe(0);
        expect(option().dataset.colIndex).toBe('0');
    });

    it('offers multi-choice options beside existing choices and refuses an unavailable addition', async () => {
        const suggest = vi.mocked(engine.suggest!).getMockImplementation()!;
        vi.mocked(engine.suggest!).mockImplementation((input, options) => {
            const result = suggest(input, options);
            const held =
                Array.isArray(input) &&
                input.some((assertion) => assertion.conceptId === 'c4');
            return Promise.resolve(result).then((answer) => ({
                ...answer,
                suggestions: answer.suggestions.filter(
                    (suggestion) => !held || suggestion.conceptId !== 'c5',
                ),
            }));
        });
        await init({ facetOf: 'doc', categoryId: 'f2' });
        selector.setAssertions([
            {
                conceptId: 'c4',
                categoryId: 'f2',
                confidence: 'certain',
                source: 'user',
            },
        ]);
        const blocked = () =>
            container.querySelector<HTMLButtonElement>(
                '[data-concept-id="c5"]',
            )!;
        await vi.waitFor(() =>
            expect(blocked().getAttribute('aria-disabled')).toBe('true'),
        );
        blocked().click();
        await Promise.resolve();
        expect(
            selector.getAssertions().map((assertion) => assertion.conceptId),
        ).toEqual(['c4']);
        expect(
            container
                .querySelector('[data-concept-id="c4"]')
                ?.getAttribute('aria-disabled'),
        ).toBeNull();
        selector.setAssertions([]);
        await vi.waitFor(() =>
            expect(blocked().getAttribute('aria-disabled')).toBeNull(),
        );
    });

    it('reports category conflicts and slice-safe canonical fixes through refusal refreshes without importing sibling values', async () => {
        const sibling: Assertion = {
            conceptId: 'c1',
            categoryId: 'f1',
            value: 'Held sibling value',
            confidence: 'certain',
            source: 'user',
        };
        const process = vi.mocked(engine.process).getMockImplementation()!;
        let refused = false;
        const fix = {
            message: 'Remove Option Y.',
            rendered: 'c1:c4',
            keeps: [
                { conceptId: 'c1', categoryId: 'f1' },
                { conceptId: 'c4', categoryId: 'f2' },
            ],
            adds: [],
            removes: [{ conceptId: 'c5', categoryId: 'f2' }],
        };
        vi.mocked(engine.process).mockImplementation(async (input, options) => {
            const answer = await process(input, options);
            if (refused)
                return {
                    ...answer,
                    rendered: 'refused',
                    errors: [],
                    proposedFixes: [],
                    assessment: {
                        emitted: [],
                        omitted: [],
                        collapsed: [],
                        conflicts: [],
                        unrepresentable: [
                            {
                                output: 'default',
                                reason: 'ambiguous-representation',
                                concepts: ['c4', 'c5'],
                            },
                        ],
                    },
                };
            const conflict =
                answer.assertions.some(
                    (assertion) => assertion.conceptId === 'c4',
                ) &&
                answer.assertions.some(
                    (assertion) => assertion.conceptId === 'c5',
                );
            return {
                ...answer,
                valid: !conflict,
                errors: conflict
                    ? [
                          {
                              constraintId: 'exclusive',
                              message: 'These options cannot be combined.',
                              affectedConcepts: ['c4', 'c5'],
                          },
                          {
                              constraintId: 'other',
                              message: 'An unrelated category is incomplete.',
                              categoryId: 'f1',
                          },
                      ]
                    : [],
                proposedFixes: conflict
                    ? [
                          fix,
                          {
                              ...fix,
                              rendered: 'c4:c5',
                              message: 'Remove Low.',
                              removes: [{ conceptId: 'c1', categoryId: 'f1' }],
                          },
                      ]
                    : [],
            };
        });
        const onChange = vi.fn();
        await init({
            facetOf: 'doc',
            categoryId: 'f2',
            resolveFacetSiblings: () => [sibling],
            resolveFacetRefusal: () => [],
            onChange,
        });
        selector.setAssertions([
            {
                conceptId: 'c4',
                categoryId: 'f2',
                confidence: 'certain',
                source: 'user',
            },
            {
                conceptId: 'c5',
                categoryId: 'f2',
                confidence: 'certain',
                source: 'user',
            },
        ]);
        const errors = () => container.nextElementSibling;
        await vi.waitFor(() =>
            expect(errors()?.textContent).toContain(
                'These options cannot be combined.',
            ),
        );
        expect(errors()?.textContent).not.toContain('An unrelated category');
        expect(
            [
                ...(openFieldTools(container)?.querySelectorAll(
                    '.ez-validation-errors__fix',
                ) ?? []),
            ].map((button) => button.textContent),
        ).toEqual(['Remove Option Y']);
        selector.refreshFacetRefusal();
        expect(errors()?.textContent).toContain(
            'These options cannot be combined.',
        );
        refused = true;
        onChange.mockClear();
        selector.setAssertions(selector.getAssertions());
        await vi.waitFor(() => expect(onChange).toHaveBeenCalled());
        // Refusal-only reports do not erase the category's current judgment.
        expect(errors()?.textContent).toContain(
            'These options cannot be combined.',
        );
        refused = false;
        openFieldTools(container)!
            .querySelector<HTMLButtonElement>('.ez-validation-errors__fix')!
            .click();
        await vi.waitFor(() =>
            expect(
                selector
                    .getAssertions()
                    .map((assertion) => assertion.conceptId),
            ).toEqual(['c4']),
        );
        await vi.waitFor(() =>
            expect(onChange).toHaveBeenLastCalledWith(
                [
                    expect.objectContaining({
                        conceptId: 'c4',
                        categoryId: 'f2',
                    }),
                ],
                expect.any(String),
            ),
        );
        expect(sibling.value).toBe('Held sibling value');
    });

    it('refuses an engine without describeConcept when it binds', async () => {
        delete (engine as { describeConcept?: unknown }).describeConcept;
        await expect(init()).rejects.toThrow(
            /CategorySelector requires engine\.describeConcept\(\)/,
        );
        expect(
            container.querySelectorAll('.category-selector-row'),
        ).toHaveLength(0);
    });

    it("puts each category's name on its own line above its buttons, with the suite chrome ending the first line", async () => {
        await init();
        const body = container.querySelector('.category-selector-body')!;
        expect(body.classList.contains('ez-field-frame')).toBe(true);
        const rows = [
            ...container.querySelectorAll<HTMLElement>(
                '.category-selector-row',
            ),
        ];
        for (const row of rows) {
            // Name line first, then the buttons: never side by side.
            expect(row.children[0].className).toBe('category-selector-head');
            expect(row.children[1].className).toBe('category-selector-options');
        }
        const firstHead = rows[0].querySelector('.category-selector-head')!;
        const chrome = body.querySelector(':scope > .ez-field-chrome')!;
        expect(
            firstHead.id || firstHead.querySelector('[id]')?.id,
        ).toBeTruthy();
        expect(chrome.querySelector('.ez-status-mark')).not.toBeNull();
        expect(chrome.querySelector('.ez-clear-button')).not.toBeNull();
        // One chrome for the control, however many categories it shows.
        expect(container.querySelectorAll('.ez-field-chrome')).toHaveLength(1);
        // A rebuild keeps the same chrome at the first line's end.
        rows[0]
            .querySelector<HTMLButtonElement>('.category-selector-btn')!
            .click();
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(
            container.querySelector(
                '.category-selector-body > .ez-field-chrome',
            ),
        ).toBe(chrome);
    });

    it('displays a derived option as inferred until the author chooses it', async () => {
        await init();
        selector.applyStoreState({
            rendered: 'Local',
            renders: {},
            valid: true,
            errors: [],
            assertions: [
                {
                    conceptId: 'c4',
                    categoryId: 'f2',
                    confidence: 'inferred',
                    source: 'infer',
                    sourceRule: 'adds-local',
                },
            ],
        } as never);
        const local = () =>
            container.querySelector<HTMLButtonElement>(
                '[data-concept-id="c4"]',
            )!;
        expect(local().classList).toContain('ez-choice-button--inferred');
        expect(local().getAttribute('aria-checked')).toBe('false');
        expect(local().getAttribute('aria-disabled')).toBeNull();

        local().click();
        await vi.waitFor(() => {
            expect(local().getAttribute('aria-checked')).toBe('true');
            expect(local().classList).not.toContain(
                'ez-choice-button--inferred',
            );
            expect(selector.getAssertions()).toContainEqual(
                expect.objectContaining({ conceptId: 'c4', source: 'user' }),
            );
        });
    });

    it("marks a facet's status only with fixes to its own category", async () => {
        await init({ facetOf: 'doc', categoryId: 'f1' });
        const mark = () =>
            container.querySelector<HTMLElement>('.ez-status-mark')!;
        const state = (categoryId: string) => ({
            rendered: 'Low',
            renders: {},
            valid: true,
            errors: [],
            assertions: [
                {
                    conceptId: 'c1',
                    categoryId: 'f1',
                    confidence: 'certain' as const,
                    source: 'user' as const,
                },
                // What the fix added is in the marking.
                {
                    conceptId: 'x',
                    categoryId,
                    confidence: 'inferred' as const,
                    source: 'infer' as const,
                    sourceRule: `adds-${categoryId}`,
                },
            ],
            appliedFixes: [
                {
                    ruleId: `adds-${categoryId}`,
                    action: 'add',
                    add: [{ categoryId, conceptId: 'x' }],
                    message: `Added to ${categoryId}`,
                },
            ],
        });
        // A fix to another category is not this facet's to explain.
        selector.applyStoreState(state('f2') as never);
        expect(mark().classList.contains('ez-status-mark--unseen')).toBe(false);
        selector.applyStoreState(state('f1') as never);
        expect(mark().classList.contains('ez-status-mark--unseen')).toBe(true);
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
        await vi.waitFor(() =>
            expect(
                selector
                    .getAssertions()
                    .some((assertion) => assertion.conceptId === 'c5'),
            ).toBe(true),
        );
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

    it('uses the shared native definition hint without a custom hover popup', async () => {
        engine.getScheme().concepts[0]!.definition = 'Canonical definition';
        await init();
        const choice = container.querySelector<HTMLButtonElement>(
            '.category-selector-btn',
        )!;
        expect(choice.title).toBe('Metric A: Low\nCanonical definition');
        expect(choice.getAttribute('aria-description')).toBe(
            'Metric A: Low. Canonical definition.',
        );
        const before = selector.getAssertions();
        choice.focus();
        choice.dispatchEvent(new Event('mouseenter'));
        await new Promise((resolve) => setTimeout(resolve, 350));
        expect(document.querySelector('.ez-tooltip:not([hidden])')).toBeNull();
        expect(document.activeElement).toBe(choice);
        expect(selector.getAssertions()).toEqual(before);
    });

    it('puts working category stops before chrome and returns from top-row Up without choosing', async () => {
        await init();
        const options = [
            ...container.querySelectorAll<HTMLButtonElement>(
                '.category-selector-btn',
            ),
        ];
        const brand = container.querySelector<HTMLElement>('.ez-status-mark')!;
        for (const option of options)
            option.getBoundingClientRect = () =>
                ({
                    left: 0,
                    right: 60,
                    top: 20,
                    bottom: 50,
                    width: 60,
                    height: 30,
                }) as DOMRect;
        expect(
            options
                .filter((option) => option.tabIndex === 0)
                .every(
                    (option) =>
                        !!(
                            option.compareDocumentPosition(brand) &
                            Node.DOCUMENT_POSITION_FOLLOWING
                        ),
                ),
        ).toBe(true);
        const before = selector.getAssertions();
        options[0].focus();
        options[0].dispatchEvent(
            new KeyboardEvent('keydown', {
                key: 'ArrowUp',
                bubbles: true,
                cancelable: true,
            }),
        );
        expect(document.activeElement).toBe(brand);
        brand.dispatchEvent(
            new KeyboardEvent('keydown', {
                key: 'ArrowDown',
                bubbles: true,
                cancelable: true,
            }),
        );
        expect(document.activeElement).toBe(options[0]);
        expect(selector.getAssertions()).toEqual(before);
        expect(
            container.querySelector('.ez-tooltip--tools:not([hidden])'),
        ).toBeNull();
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

    it('navigates physical wrapped rows without changing selection or scrolling at their edges', async () => {
        await init({ categoryId: 'f2' });
        const buttons = [
            ...container.querySelectorAll<HTMLButtonElement>(
                '.category-selector-btn',
            ),
        ];
        let boxes = [
            new DOMRect(0, 0, 60, 30),
            new DOMRect(80, 0, 60, 30),
            new DOMRect(160, 0, 60, 30),
        ];
        buttons.forEach((button, index) => {
            button.getBoundingClientRect = () => boxes[index];
        });
        const key = (name: string, ctrlKey = false) => {
            const event = new KeyboardEvent('keydown', {
                key: name,
                ctrlKey,
                bubbles: true,
                cancelable: true,
            });
            document.activeElement!.dispatchEvent(event);
            return event;
        };
        buttons[0].focus();
        expect(key('ArrowDown').defaultPrevented).toBe(true);
        expect(document.activeElement).toBe(buttons[0]);
        key('ArrowRight');
        expect(document.activeElement).toBe(buttons[1]);
        // A phone-sized wrap changes the physical row, not the category identity.
        boxes = [
            new DOMRect(0, 0, 60, 30),
            new DOMRect(80, 0, 60, 30),
            new DOMRect(10, 40, 60, 30),
        ];
        buttons[0].focus();
        key('ArrowDown');
        expect(document.activeElement).toBe(buttons[2]);
        key('ArrowUp');
        expect(document.activeElement).toBe(buttons[0]);
        key('ArrowLeft');
        expect(document.activeElement).toBe(buttons[0]);
        expect(key('ArrowRight', true).defaultPrevented).toBe(false);
        expect(key('Tab').defaultPrevented).toBe(false);
        expect(selector.getAssertions()).toEqual([]);
    });

    it('should handle keyboard Enter to select', async () => {
        await init();
        const btn = container.querySelector(
            '[data-concept-id="c1"]',
        ) as HTMLElement;
        btn.focus();
        activateChoice(btn, 'Enter');
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
        activateChoice(btn, ' ');
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

    describe('scope', () => {
        /** Two categories: f1 on the marking as a whole, f2 in severity. */
        function scopedEngine(): SchemeEngineAdapter {
            const base = createMockEngine().getScheme();
            return createMockEngine({
                defaultScope: 'default',
                scopes: [
                    { id: 'default', label: 'Default' },
                    { id: 'severity', label: 'Severity' },
                ],
                categories: base.categories.map((category) =>
                    category.id === 'f2'
                        ? { ...category, scopes: ['severity'] }
                        : category,
                ),
            } as Partial<SchemePublicView>);
        }

        const rowIds = () =>
            [
                ...container.querySelectorAll<HTMLElement>(
                    '[role="radiogroup"], [role="group"]',
                ),
            ].map((row) => row.dataset.categoryId);

        it('lists only the default scope when the host names none', async () => {
            engine = scopedEngine();
            await init();
            expect(rowIds()).toEqual(['f1']);
        });

        it('lists only the scope the host names', async () => {
            engine = scopedEngine();
            await init({ scope: 'severity' });
            expect(rowIds()).toEqual(['f2']);
        });

        it('lists the surface its format writes when the host names no scope', async () => {
            engine = scopedEngine();
            const meta = engine.getSchemeMeta();
            const formats = [
                ...(meta.formats ?? []),
                {
                    ...(meta.formats ?? [])[0],
                    id: 'severity-format',
                    surface: 'severity',
                },
            ];
            engine.getSchemeMeta = () => ({ ...meta, formats });
            await init({ formatId: 'severity-format' });
            expect(rowIds()).toEqual(['f2']);
        });

        it('lists a category bound by facet whatever its scope', async () => {
            engine = scopedEngine();
            await init({ categoryId: 'f2' });
            expect(rowIds()).toEqual(['f2']);
        });
    });

    describe('a selection the engine cannot write', () => {
        const MARKER = '[unrepresentable:ambiguous-representation]';

        /** Refuses any selection holding concept c2; writes the rest. */
        function refusingEngine(): SchemeEngineAdapter {
            const refusing = createMockEngine();
            const process = refusing.process as unknown as (
                input: string,
                options?: { assertions?: Assertion[] },
            ) => Record<string, unknown>;
            refusing.process = vi.fn(
                (input: string, options?: { assertions?: Assertion[] }) => {
                    const result = process(input, options);
                    const refused = options?.assertions?.some(
                        (a) => a.conceptId === 'c2',
                    );
                    return {
                        ...result,
                        errors: [],
                        rendered: refused ? MARKER : result.rendered,
                        assessment: {
                            emitted: [],
                            omitted: [],
                            collapsed: [],
                            conflicts: [],
                            unrepresentable: refused
                                ? [
                                      {
                                          output: 'default',
                                          reason: 'ambiguous-representation',
                                      },
                                  ]
                                : [],
                        },
                    };
                },
            ) as unknown as SchemeEngineAdapter['process'];
            return refusing;
        }

        const click = (conceptId: string) =>
            container
                .querySelector<HTMLButtonElement>(
                    `[data-concept-id="${conceptId}"]`,
                )!
                .click();

        it('keeps the value and says why through the status', async () => {
            engine = refusingEngine();
            const onChange = vi.fn();
            await init({ onChange });

            click('c1');
            expect(selector.getRendered()).toBe('c1');

            click('c2');

            expect(selector.getRendered()).toBe('c1');
            expect(onChange).toHaveBeenLastCalledWith(expect.anything(), 'c1');
            expect(container.hasAttribute('data-ezclassify-invalid')).toBe(
                true,
            );
            expect(document.body.textContent).toContain(
                'ambiguous-representation',
            );
            expect(document.body.textContent).not.toContain(MARKER);
        });

        it('leaves saying why to the field that shows the marking, on a facet', async () => {
            engine = refusingEngine();
            await init({ facetOf: 'whole' });

            click('c2');

            expect(container.hasAttribute('data-ezclassify-invalid')).toBe(
                false,
            );
        });

        it('clears the status once the selection can be written', async () => {
            engine = refusingEngine();
            await init();
            click('c2');
            expect(container.hasAttribute('data-ezclassify-invalid')).toBe(
                true,
            );

            click('c1');

            expect(selector.getRendered()).toBe('c1');
            expect(container.hasAttribute('data-ezclassify-invalid')).toBe(
                false,
            );
        });
    });
});
