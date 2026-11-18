import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
    openContext,
    schemeOnlyContext,
} from '../../test-fixtures/context-doubles';
import type {
    Assertion,
    LocalContextSchemeEngineAdapter,
    SchemeEngineAdapter,
} from '@ezclassify/types';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SingleSelect } from './single-select';
import {
    connectDemoContext,
    demoRuntimeSettled,
} from '../../../../test-support/demo-runtime';
async function makeEngine(
    withTextInput = false,
    calendarValue = false,
): Promise<LocalContextSchemeEngineAdapter> {
    return openContext(
        await connectDemoContext({
            draft: {
                scheme: {
                    scheme: {
                        id: 'test-select',
                        version: '1.0.0',
                        name: 'Test Select',
                        description: '',
                        data: {
                            categories: [
                                {
                                    id: 'level',
                                    label: 'Level',
                                    required: false,
                                    single: true,
                                    rollup: 'max',
                                    position: 0,
                                    hierarchy_root: true,
                                },
                            ],
                            concepts: [
                                {
                                    id: 'level-1',
                                    name: 'Level 1',
                                    views: { default: 'L1' },
                                    definition:
                                        'Choose this level for the first tier.',
                                    aliases: [],
                                    categories: ['level'],
                                    parents: [],
                                    position: 1,
                                    rank: 0,
                                },
                                {
                                    id: 'level-2',
                                    name: 'Level 2',
                                    views: { default: 'L2' },
                                    aliases: [],
                                    categories: ['level'],
                                    parents: [],
                                    position: 2,
                                    rank: 1,
                                },
                                {
                                    id: 'level-3',
                                    name: 'Level 3',
                                    views: {
                                        default: calendarValue
                                            ? '{value}'
                                            : 'L3',
                                    },
                                    ...(withTextInput
                                        ? {
                                              text_input: {
                                                  encoding: calendarValue
                                                      ? {
                                                            type: 'calendar-date',
                                                            canonical:
                                                                'YYYY-MM-DD',
                                                            accepts: [
                                                                'YYYYMMDD',
                                                                'YYYY-MM-DD',
                                                            ],
                                                            views: {
                                                                default:
                                                                    'YYYYMMDD',
                                                            },
                                                        }
                                                      : {
                                                            type: 'text',
                                                            pattern: '\\d{8}',
                                                        },
                                                  placeholder: 'YYYYMMDD',
                                                  label: 'Review date',
                                                  required: true,
                                              },
                                          }
                                        : {}),
                                    aliases: [],
                                    categories: ['level'],
                                    parents: [],
                                    position: 3,
                                    rank: 2,
                                },
                            ],
                        },
                        rules: [],
                        rollup_pipelines: [],
                        render: {
                            default: 'default',
                            formats: [
                                {
                                    id: 'default',
                                    surface: 'marking',
                                    mode: 'inline',
                                    separator: '//',
                                    fields: [
                                        { category: 'level', separator: '//' },
                                    ],
                                },
                            ],
                        },
                    },
                },
            },
        }),
    ).scheme as LocalContextSchemeEngineAdapter;
}

// Same shape as makeEngine, but the level category drives the display color
// (render.color_from) and each level concept carries an authority-mandated
// color pair. Used to prove the cards adopt the mandated color.
async function makeColoredEngine(): Promise<LocalContextSchemeEngineAdapter> {
    const colors: Record<string, { background: string; text: string }> = {
        'level-1': { background: '#00a651', text: '#ffffff' },
        'level-2': { background: '#ff8c00', text: '#000000' },
        'level-3': { background: '#c8102e', text: '#ffffff' },
    };
    return openContext(
        await connectDemoContext({
            draft: {
                scheme: {
                    scheme: {
                        id: 'test-select-colored',
                        version: '1.0.0',
                        name: 'Test Select Colored',
                        description: '',
                        data: {
                            categories: [
                                {
                                    id: 'level',
                                    label: 'Level',
                                    required: false,
                                    single: true,
                                    rollup: 'max',
                                    position: 0,
                                    hierarchy_root: true,
                                },
                            ],
                            concepts: [
                                {
                                    id: 'level-1',
                                    name: 'Level 1',
                                    views: { default: 'L1' },
                                    color: colors['level-1'],
                                    aliases: [],
                                    categories: ['level'],
                                    parents: [],
                                    position: 1,
                                    rank: 0,
                                },
                                {
                                    id: 'level-2',
                                    name: 'Level 2',
                                    views: { default: 'L2' },
                                    color: colors['level-2'],
                                    aliases: [],
                                    categories: ['level'],
                                    parents: [],
                                    position: 2,
                                    rank: 1,
                                },
                                {
                                    id: 'level-3',
                                    name: 'Level 3',
                                    views: { default: 'L3' },
                                    color: colors['level-3'],
                                    aliases: [],
                                    categories: ['level'],
                                    parents: [],
                                    position: 3,
                                    rank: 2,
                                },
                            ],
                        },
                        rules: [],
                        rollup_pipelines: [],
                        render: {
                            default: 'default',
                            color_from: 'level',
                            formats: [
                                {
                                    id: 'default',
                                    surface: 'marking',
                                    mode: 'inline',
                                    separator: '//',
                                    fields: [
                                        { category: 'level', separator: '//' },
                                    ],
                                },
                            ],
                        },
                    },
                },
            },
        }),
    ).scheme as LocalContextSchemeEngineAdapter;
}

const toCtx = (eng: unknown) => schemeOnlyContext(eng as never);

/**
 * A selector's weight: ids, then classes, attributes and pseudo-classes, then
 * elements.
 */
type Specificity = [number, number, number];

/**
 * The specificity of one compound selector list item, enough for the selectors
 * this library writes: `:where()` weighs nothing, and `:is()` and `:not()`
 * weigh their heaviest argument.
 */
function specificity(selector: string): Specificity {
    let rest = selector;
    const weight: Specificity = [0, 0, 0];
    rest = rest.replace(/:where\((?:[^()]|\([^()]*\))*\)/g, ' ');
    rest = rest.replace(
        /:(?:is|not)\(((?:[^()]|\([^()]*\))*)\)/g,
        (_, inner: string) => {
            const heaviest = inner
                .split(',')
                .map(specificity)
                .sort((a, b) => compareSpecificity(b, a))[0];
            for (let i = 0; i < 3; i++) weight[i] += heaviest[i];
            return ' ';
        },
    );
    weight[0] += (rest.match(/#[\w-]+/g) ?? []).length;
    weight[1] += (rest.match(/\.[\w-]+|\[[^\]]*\]|:(?!:)[\w-]+/g) ?? []).length;
    weight[2] += (
        rest.match(/(?:^|[\s>+~])[a-z][\w-]*|::[\w-]+/gi) ?? []
    ).length;
    return weight;
}

function compareSpecificity(a: Specificity, b: Specificity): number {
    for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] - b[i];
    return 0;
}

describe('SingleSelect', () => {
    let container: HTMLDivElement;
    let engine: LocalContextSchemeEngineAdapter;
    let component: SingleSelect;
    beforeEach(async () => {
        container = document.createElement('div');
        document.body.appendChild(container);
        engine = await makeEngine();
        component = new SingleSelect();
    });
    /**
     * UI-lifetime double: each free-text prefix is accepted asynchronously and
     * trimmed canonically.
     */
    function freeTextAdapter() {
        const original = engine.getScheme();
        const scheme = {
            ...original,
            concepts: original.concepts.map((concept) =>
                concept.id === 'level-3'
                    ? {
                          ...concept,
                          textInput: {
                              encoding: { type: 'text' as const },
                              label: 'Value',
                              required: true,
                          },
                      }
                    : concept,
            ),
        };
        const write = (assertions: readonly Assertion[]) =>
            assertions
                .map((assertion) => assertion.value ?? assertion.conceptId)
                .join('/');
        return {
            getScheme: () => scheme,
            getSchemeMeta: () => engine.getSchemeMeta(),
            process: async (
                _input: string,
                options?: { assertions?: Assertion[] },
            ) => {
                await Promise.resolve();
                const assertions = (options?.assertions ?? []).map(
                    (assertion) => ({
                        ...assertion,
                        ...(assertion.value === undefined
                            ? {}
                            : { value: assertion.value.trim() }),
                    }),
                );
                return {
                    assertions,
                    rendered: write(assertions),
                    valid: true,
                    errors: [],
                    proposedFixes: [],
                };
            },
            render: (assertions: Assertion[]) => ({
                rendered: write(assertions),
                assessment: {
                    emitted: [],
                    omitted: [],
                    collapsed: [],
                    conflicts: [],
                    unrepresentable: [],
                },
            }),
            suggest: () => ({ suggestions: [], warnings: [] }),
            describeConcept: (conceptId: string) => ({ lines: [conceptId] }),
        };
    }
    /**
     * A two-scope label fixture; processing remains a full-state UI-lifetime
     * double.
     */
    function writingAdapter() {
        const base = freeTextAdapter();
        const source = base.getScheme();
        const scheme = {
            ...source,
            categories: [
                ...source.categories.map((category) => ({
                    ...category,
                    scopes: ['line'],
                })),
                {
                    ...source.categories[0]!,
                    id: 'authority',
                    label: 'Authority',
                    single: false,
                    scopes: ['authority'],
                },
            ],
            concepts: [
                ...source.concepts.map((concept) => ({
                    ...concept,
                    views: {
                        default: 'GENERIC',
                        whole: `Whole ${concept.id}`,
                        part: `Part ${concept.id}`,
                        explicit: `Explicit ${concept.id}`,
                    },
                })),
                {
                    ...source.concepts[2]!,
                    id: 'author',
                    name: 'Author',
                    categories: ['authority'],
                },
            ],
        };
        const meta: ReturnType<typeof engine.getSchemeMeta> = {
            ...base.getSchemeMeta(),
            defaultRenderFormat: 'line/part',
            defaultPartRenderFormat: 'line/part',
            defaultWholeRenderFormat: 'authority/block',
            defaultScope: 'line',
            scopes: [
                { id: 'line', label: 'Line' },
                { id: 'authority', label: 'Authority' },
            ],
            formats: [
                {
                    id: 'line/whole',
                    surface: 'line',
                    mode: 'inline' as const,
                    categoryOrder: ['level'],
                    view: 'whole',
                    defaultFor: ['whole'],
                },
                {
                    id: 'line/part',
                    surface: 'line',
                    mode: 'inline' as const,
                    categoryOrder: ['level'],
                    view: 'part',
                    defaultFor: ['part'],
                },
                {
                    id: 'line/explicit',
                    surface: 'line',
                    mode: 'inline' as const,
                    categoryOrder: ['level'],
                    view: 'explicit',
                },
                {
                    id: 'authority/block',
                    surface: 'authority',
                    mode: 'inline' as const,
                    categoryOrder: ['authority'],
                    view: 'whole',
                    defaultFor: ['whole'],
                },
            ],
        };
        return { ...base, getScheme: () => scheme, getSchemeMeta: () => meta };
    }

    it.each(['dropdown', 'cards'] as const)(
        'names %s choices in the category role output without changing full facts or explicit formats',
        async (mode) => {
            for (const [options, prefix] of [
                [{}, 'Whole'],
                [{ holdsPart: false }, 'Whole'],
                [{ holdsPart: true }, 'Part'],
                [{ formatId: 'line/part' }, 'Part'],
                [{ formatId: 'line/explicit' }, 'Explicit'],
            ] as const) {
                const adapter = writingAdapter();
                const process = vi.spyOn(adapter, 'process');
                await component.init(container, toCtx(adapter), {
                    mode,
                    facetOf: 'shared-marking',
                    ...options,
                });
                const facts: Assertion[] = [
                    {
                        conceptId: 'level-1',
                        categoryId: 'level',
                        source: 'user',
                        confidence: 'certain',
                    },
                    {
                        conceptId: 'author',
                        categoryId: 'authority',
                        value: 'Jane Analyst',
                        source: 'user',
                        confidence: 'certain',
                    },
                ];
                component.setAssertions(facts);
                await settleText();
                const label =
                    mode === 'dropdown'
                        ? container.querySelector<HTMLOptionElement>(
                              'option[value="level-1"]',
                          )!.textContent
                        : container.querySelector<HTMLElement>(
                              '.select-card[data-concept-id="level-1"] .select-card-label',
                          )!.textContent;
                expect(label).toBe(`${prefix} level-1`);
                expect(component.getAssertions()).toEqual(facts);
                const query = process.mock.calls.at(-1)?.[1] as {
                    outputFormat?: string;
                };
                expect(query.outputFormat).toBe(
                    'formatId' in options ? options.formatId : 'line/part',
                );
                expect(adapter.getSchemeMeta().defaultWholeRenderFormat).toBe(
                    'authority/block',
                );
                const valueLabel =
                    mode === 'dropdown'
                        ? container.querySelector<HTMLOptionElement>(
                              'option[value="level-3"]',
                          )!.textContent
                        : container.querySelector<HTMLElement>(
                              '.select-card[data-concept-id="level-3"] .select-card-label',
                          )!.textContent;
                expect(valueLabel).toBe('Level 3');
                if (mode === 'dropdown') {
                    const dropdown =
                        container.querySelector<HTMLSelectElement>('select')!;
                    expect(dropdown.value).toBe('level-1');
                }
                component.destroy();
                component = new SingleSelect();
            }
        },
    );

    const settleText = async () => {
        for (let i = 0; i < 4; i++)
            await new Promise((resolve) => setTimeout(resolve, 0));
    };
    it.each(['dropdown', 'cards'] as const)(
        'pairs the %s value companion boundary with branding without choosing',
        async (mode) => {
            await component.init(container, toCtx(freeTextAdapter()), { mode });
            if (mode === 'dropdown') {
                const select =
                    container.querySelector<HTMLSelectElement>('select')!;
                select.value = 'level-3';
                select.dispatchEvent(new Event('change', { bubbles: true }));
            } else
                container
                    .querySelector<HTMLElement>(
                        '.select-card[data-concept-id="level-3"]',
                    )!
                    .click();
            const input = container.querySelector<HTMLInputElement>(
                '.select-card-text-field',
            )!;
            input.value = 'Draft text';
            input.focus();
            input.setSelectionRange(input.value.length, input.value.length);
            const before = component.getAssertions();
            const brand =
                container.querySelector<HTMLElement>('.ez-status-mark')!;
            const right = new KeyboardEvent('keydown', {
                key: 'ArrowRight',
                bubbles: true,
                cancelable: true,
            });
            input.dispatchEvent(right);
            expect(right.defaultPrevented).toBe(true);
            expect(document.activeElement).toBe(brand);
            brand.dispatchEvent(
                new KeyboardEvent('keydown', {
                    key: 'ArrowLeft',
                    bubbles: true,
                    cancelable: true,
                }),
            );
            expect(document.activeElement).toBe(input);
            expect(input.selectionStart).toBe(input.value.length);
            expect(input.value).toBe('Draft text');
            expect(component.getAssertions()).toEqual(before);
            input.setSelectionRange(0, 0);
            const left = new KeyboardEvent('keydown', {
                key: 'ArrowLeft',
                bubbles: true,
                cancelable: true,
            });
            input.dispatchEvent(left);
            expect(left.defaultPrevented).toBe(false);
            expect(document.activeElement).toBe(input);
            component.destroy();
        },
    );
    it.each(['dropdown', 'cards'] as const)(
        'retains native text identity, raw spaces and selection through async %s echoes',
        async (mode) => {
            await component.init(container, toCtx(freeTextAdapter()), { mode });
            if (mode === 'dropdown') {
                const select =
                    container.querySelector<HTMLSelectElement>('select')!;
                select.value = 'level-3';
                select.dispatchEvent(new Event('change', { bubbles: true }));
            } else
                container
                    .querySelector<HTMLElement>(
                        '.select-card[data-concept-id="level-3"]',
                    )!
                    .click();
            const input = container.querySelector<HTMLInputElement>(
                '.select-card-text-field',
            )!;
            input.focus();
            for (const character of 'Alex Example') {
                input.setRangeText(
                    character,
                    input.selectionStart!,
                    input.selectionEnd!,
                    'end',
                );
                input.dispatchEvent(
                    new InputEvent('input', {
                        bubbles: true,
                        inputType: 'insertText',
                        data: character,
                    }),
                );
                await settleText();
                expect(container.querySelector('.select-card-text-field')).toBe(
                    input,
                );
                expect(document.activeElement).toBe(input);
                if (character === ' ') {
                    expect(input.value).toBe('Alex ');
                    component.setAssertions(component.getAssertions());
                    await settleText();
                    expect(input.value).toBe('Alex ');
                }
            }
            expect(input.value).toBe('Alex Example');
            expect(
                component
                    .getAssertions()
                    .find((assertion) => assertion.conceptId === 'level-3')
                    ?.value,
            ).toBe('Alex Example');
            input.setSelectionRange(2, 7, 'backward');
            component.setAssertions(component.getAssertions());
            await settleText();
            expect(container.querySelector('.select-card-text-field')).toBe(
                input,
            );
            expect([
                input.selectionStart,
                input.selectionEnd,
                input.selectionDirection,
            ]).toEqual([2, 7, 'backward']);
            const outside = document.createElement('button');
            document.body.appendChild(outside);
            outside.focus();
            component.setAssertions([
                {
                    conceptId: 'level-3',
                    categoryId: 'level',
                    source: 'user',
                    confidence: 'certain',
                    value: 'External Replacement',
                },
            ]);
            await settleText();
            expect(input.value).toBe('External Replacement');
            expect(document.activeElement).toBe(outside);
            outside.remove();
            component.destroy();
        },
    );

    it('renders a conventional select by default', async () => {
        await component.init(container, toCtx(engine));
        const select =
            container.querySelector<HTMLSelectElement>('.select-dropdown');
        expect(select).not.toBeNull();
        expect(select?.options).toHaveLength(4);
        expect(container.querySelector('.select-card')).toBeNull();
        component.destroy();
    });
    it("leaves the select's type size to a host rule for its selects", async () => {
        await component.init(container, toCtx(engine));
        const select =
            container.querySelector<HTMLSelectElement>('.select-dropdown')!;
        // A host sizes its selects with a class and an element, e.g.
        // `.demo select { font-size: 1rem }`. Every library rule that sets the
        // select's type must weigh less, so the host's size stands.
        const host: Specificity = [0, 1, 1];
        const style = document.createElement('style');
        style.textContent = readFileSync(
            join(dirname(fileURLToPath(import.meta.url)), 'single-select.css'),
            'utf8',
        );
        document.head.appendChild(style);
        const typeRules: string[] = [];
        const walk = (rules: CSSRuleList) => {
            for (const rule of Array.from(rules)) {
                if (rule instanceof CSSMediaRule) walk(rule.cssRules);
                if (!(rule instanceof CSSStyleRule)) continue;
                const setsType = ['font', 'font-size'].some((name) =>
                    rule.style.getPropertyValue(name),
                );
                if (!setsType) continue;
                for (const selector of rule.selectorText.split(','))
                    if (select.matches(selector))
                        typeRules.push(selector.trim());
            }
        };
        walk(style.sheet!.cssRules);
        style.remove();
        expect(typeRules.length).toBeGreaterThan(0);
        for (const selector of typeRules)
            expect(
                compareSpecificity(specificity(selector), host),
                selector,
            ).toBeLessThan(0);
        component.destroy();
    });

    it('keeps choices compact and previews help in one shared detail panel', async () => {
        await component.init(container, toCtx(engine), { mode: 'cards' });
        const cards = container.querySelectorAll<HTMLElement>('.select-card');
        const detail = container.querySelector('.select-detail') as HTMLElement;

        expect(
            cards[0].querySelector('.select-card-sr-desc')?.textContent,
        ).toBe('Choose this level for the first tier.');
        expect(cards[0].querySelector('.select-card-desc')).toBeNull();
        expect(detail.textContent).toContain('Select Level');

        cards[0].dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
        await demoRuntimeSettled();
        expect(detail.dataset.state).toBe('preview');
        expect(detail.textContent).toContain('L1');
        expect(detail.textContent).toContain(
            'Choose this level for the first tier.',
        );

        cards[0].dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));
        await demoRuntimeSettled();
        expect(detail.dataset.state).toBe('empty');

        cards[0].click();
        await demoRuntimeSettled();
        expect(detail.dataset.state).toBe('selected');
        expect(detail.textContent).toContain('L1');
        component.destroy();
    });
    it('fills cards from authority-mandated colors (render.color_from)', async () => {
        // No host colorMap: the mandated per-concept color drives each card.
        const coloredEngine = await makeColoredEngine();
        await component.init(container, toCtx(coloredEngine), {
            mode: 'cards',
        });
        const cards = container.querySelectorAll(
            '.select-card',
        ) as NodeListOf<HTMLElement>;
        expect(cards.length).toBe(3);
        expect(cards[0].dataset.color).toBe('');
        expect(cards[0].style.getPropertyValue('--card-bg')).toBe('#00a651');
        expect(cards[0].style.getPropertyValue('--card-text')).toBe('#ffffff');
        expect(cards[1].style.getPropertyValue('--card-bg')).toBe('#ff8c00');
        expect(cards[1].style.getPropertyValue('--card-text')).toBe('#000000');
        expect(cards[2].style.getPropertyValue('--card-bg')).toBe('#c8102e');
        component.destroy();
    });
    it('puts a selected concept text field below the default select', async () => {
        const textInputEngine = await makeEngine(true);
        await component.init(container, toCtx(textInputEngine));
        const select =
            container.querySelector<HTMLSelectElement>('.select-dropdown')!;
        select.value = 'level-3';
        select.dispatchEvent(new Event('change', { bubbles: true }));
        await demoRuntimeSettled();

        // A text choice is only a local draft until it has a valid value.
        // A scoped engine or store refresh can return no complete assertion.
        component.setAssertions([]);
        await demoRuntimeSettled();
        await vi.waitFor(() => expect(select.value).toBe('level-3'));

        const supplement = container.querySelector(
            '.select-dropdown-supplement',
        )!;
        const input = supplement.querySelector<HTMLInputElement>(
            '.select-card-text-field',
        );
        expect(input).not.toBeNull();
        expect(input?.placeholder).toBe('YYYYMMDD');
        expect(input?.pattern).toBe('\\d{8}');
        expect(
            supplement.querySelector('.select-card-text-label')?.textContent,
        ).toBe('Review date');

        input!.focus();
        input!.value = '2035';
        input!.setSelectionRange(4, 4);
        input!.dispatchEvent(new Event('input', { bubbles: true }));
        expect(component.getAssertions()).toEqual([]);
        await new Promise(requestAnimationFrame);
        const replacement = supplement.querySelector<HTMLInputElement>(
            '.select-card-text-field',
        );
        expect(replacement?.value).toBe('2035');
        expect(document.activeElement).toBe(replacement);
        expect(replacement?.selectionStart).toBe(4);

        replacement!.value = '20350101';
        replacement!.dispatchEvent(new Event('input', { bubbles: true }));
        await vi.waitFor(() =>
            expect(component.getAssertions()).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({
                        conceptId: 'level-3',
                        value: '20350101',
                    }),
                ]),
            ),
        );

        select.value = 'level-1';
        select.dispatchEvent(new Event('change', { bubbles: true }));
        await demoRuntimeSettled();
        expect(supplement.querySelector('.select-card-text-field')).toBeNull();
        component.destroy();
    });
    it('keeps a real canonical calendar choice across a second edit and clear', async () => {
        const calendar = await makeEngine(true, true);
        const raw: Assertion = {
            conceptId: 'level-3',
            categoryId: 'level',
            value: '20350930',
            source: 'user',
            confidence: 'certain',
        };
        const result = await calendar.process([raw]);
        expect(result.valid).toBe(true);
        expect(result.assertions[0]).toMatchObject({
            ...raw,
            value: '2035-09-30',
        });
        expect(result.appliedFixes).toEqual([]);
        await component.init(container, toCtx(calendar));
        component.setAssertions([raw]);
        await demoRuntimeSettled();
        expect(component.getAssertions()[0]).toMatchObject({
            ...raw,
            value: '2035-09-30',
        });
        const input = container.querySelector<HTMLInputElement>(
            '.select-card-text-field',
        )!;
        input.value = '20351231';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        await vi.waitFor(() =>
            expect(component.getAssertions()[0]).toMatchObject({
                ...raw,
                value: '2035-12-31',
            }),
        );
        await component.setValue('');
        expect(component.getAssertions()).toEqual([]);
        expect(container.querySelector('.select-card-text-field')).toBeNull();
        component.destroy();
    });

    it('makes an explicit selected-value edit a fresh user choice', async () => {
        const textEngine = await makeEngine(true);
        const process = textEngine.process.bind(textEngine);
        const derived: Assertion = {
            conceptId: 'level-3',
            categoryId: 'level',
            value: '20350930',
            source: 'infer',
            confidence: 'inferred',
            sourceRule: 'suggest-value',
        };
        const canonical = await process([
            { ...derived, source: 'user', confidence: 'certain' },
        ]);
        const spy = vi
            .spyOn(textEngine, 'process')
            .mockReturnValue({ ...canonical, assertions: [derived] });
        await component.init(container, toCtx(textEngine));
        component.setAssertions([
            {
                ...derived,
                value: '20350101',
                source: 'user',
                confidence: 'certain',
            },
        ]);
        await demoRuntimeSettled();
        const beforeEdit = component.getAssertions()[0];
        spy.mockImplementation(process);
        const input = container.querySelector<HTMLInputElement>(
            '.select-card-text-field',
        )!;
        input.value = '20351231';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        const expected = {
            ...beforeEdit,
            value: '20351231',
            source: 'user',
            confidence: 'certain',
        };
        delete expected.sourceRule;
        expect(spy).toHaveBeenLastCalledWith(
            '',
            expect.objectContaining({ assertions: [expected] }),
        );
        expect(beforeEdit.value).toBe('20350930');
        expect(beforeEdit.sourceRule).toBe('suggest-value');
        expect(component.getAssertions()[0]).toMatchObject(expected);
        component.destroy();
    });

    it('does not reclaim focus when a user leaves a text choice before the next frame', async () => {
        await component.init(container, toCtx(await makeEngine(true)));
        const select =
            container.querySelector<HTMLSelectElement>('.select-dropdown')!;
        select.value = 'level-3';
        select.dispatchEvent(new Event('change', { bubbles: true }));
        await demoRuntimeSettled();
        const input = container.querySelector<HTMLInputElement>(
            '.select-card-text-field',
        )!;
        const nextControl = document.createElement('button');
        container.appendChild(nextControl);
        input.focus();
        input.value = '2035';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        nextControl.focus();
        await new Promise(requestAnimationFrame);
        expect(document.activeElement).toBe(nextControl);
        component.destroy();
    });
    it('clears an incomplete text choice on an explicit value reset', async () => {
        await component.init(container, toCtx(await makeEngine(true)));
        const select =
            container.querySelector<HTMLSelectElement>('.select-dropdown')!;
        select.value = 'level-3';
        select.dispatchEvent(new Event('change', { bubbles: true }));
        await demoRuntimeSettled();
        expect(select.value).toBe('level-3');

        await component.setValue('');
        expect(select.value).toBe('');
        expect(container.querySelector('.select-card-text-field')).toBeNull();
        component.destroy();
    });
    it('host colorMap wins over the scheme default color', async () => {
        const coloredEngine = await makeColoredEngine();
        const colorMap = {
            'level-1': { background: '#111111', text: '#eeeeee' },
        };
        await component.init(container, toCtx(coloredEngine), {
            colorMap,
            mode: 'cards',
        });
        const cards = container.querySelectorAll(
            '.select-card',
        ) as NodeListOf<HTMLElement>;
        expect(cards[0].style.getPropertyValue('--card-bg')).toBe('#111111');
        expect(cards[0].style.getPropertyValue('--card-text')).toBe('#eeeeee');
        component.destroy();
    });
    it('renders cards with colorMap colors applied', async () => {
        const colorMap = {
            'level-1': {
                background: '#00ff00',
                text: '#000000',
                border: '#008800',
            },
            'level-2': { background: '#ffff00', text: '#333333' },
            // level-3 intentionally omitted
        };
        await component.init(container, toCtx(engine), {
            colorMap,
            mode: 'cards',
        });
        const cards = container.querySelectorAll(
            '.select-card',
        ) as NodeListOf<HTMLElement>;
        expect(cards.length).toBe(3);
        // First card has colors
        expect(cards[0].dataset.color).toBe('');
        expect(cards[0].style.getPropertyValue('--card-bg')).toBe('#00ff00');
        expect(cards[0].style.getPropertyValue('--card-text')).toBe('#000000');
        expect(cards[0].style.getPropertyValue('--card-border')).toBe(
            '#008800',
        );
        // Second card has colors (no border)
        expect(cards[1].dataset.color).toBe('');
        expect(cards[1].style.getPropertyValue('--card-bg')).toBe('#ffff00');
        expect(cards[1].style.getPropertyValue('--card-text')).toBe('#333333');
        expect(cards[1].style.getPropertyValue('--card-border')).toBe('');
        // Third card has no custom colors
        expect(cards[2].dataset.color).toBeUndefined();
        expect(cards[2].style.getPropertyValue('--card-bg')).toBe('');
        component.destroy();
    });
    it('selected card with colorMap shows full opacity', async () => {
        const colorMap = {
            'level-1': { background: '#ff0000', text: '#ffffff' },
            'level-2': { background: '#00ff00', text: '#000000' },
        };
        await component.init(container, toCtx(engine), {
            colorMap,
            mode: 'cards',
        });
        // Click to select first card
        const cards = container.querySelectorAll(
            '.select-card',
        ) as NodeListOf<HTMLElement>;
        cards[0].click();
        await demoRuntimeSettled();
        // Re-query after render
        const updatedCards = container.querySelectorAll(
            '.select-card',
        ) as NodeListOf<HTMLElement>;
        // Selected card should have aria-checked true and data-color
        expect(updatedCards[0].getAttribute('aria-checked')).toBe('true');
        expect(updatedCards[0].dataset.color).toBe('');
        expect(updatedCards[0].style.getPropertyValue('--card-bg')).toBe(
            '#ff0000',
        );
        // Unselected card still has data-color but is not checked
        expect(updatedCards[1].getAttribute('aria-checked')).toBe('false');
        expect(updatedCards[1].dataset.color).toBe('');
        component.destroy();
    });
    it('selected card indicator uses colorMap border or background', async () => {
        const colorMap = {
            'level-1': {
                background: '#ff0000',
                text: '#ffffff',
                border: '#cc0000',
            },
            'level-2': { background: '#00ff00', text: '#000000' },
        };
        await component.init(container, toCtx(engine), {
            colorMap,
            mode: 'cards',
        });
        // Select level-1
        const cards = container.querySelectorAll(
            '.select-card',
        ) as NodeListOf<HTMLElement>;
        cards[0].click();
        await demoRuntimeSettled();
        const indicators = container.querySelectorAll(
            '.select-card-indicator',
        ) as NodeListOf<HTMLElement>;
        // Selected card with border color: indicator uses border color
        // jsdom normalizes hex to rgb
        expect(indicators[0].style.getPropertyValue('--ez-indicator-bg')).toBe(
            '#cc0000',
        );
        component.destroy();
    });
    it('cards without colorMap entry are unaffected', async () => {
        const colorMap = {
            'level-1': { background: '#ff0000', text: '#ffffff' },
        };
        await component.init(container, toCtx(engine), {
            colorMap,
            mode: 'cards',
        });
        const cards = container.querySelectorAll(
            '.select-card',
        ) as NodeListOf<HTMLElement>;
        // level-2 and level-3 should not have data-color
        expect(cards[1].dataset.color).toBeUndefined();
        expect(cards[2].dataset.color).toBeUndefined();
        component.destroy();
    });

    describe('spatial card keyboard navigation', () => {
        const cards = () => [
            ...container.querySelectorAll<HTMLElement>('.select-card'),
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
        const place = (card: HTMLElement, left: number, top: number) => {
            card.getBoundingClientRect = () =>
                ({
                    left,
                    right: left + 100,
                    top,
                    bottom: top + 50,
                    width: 100,
                    height: 50,
                    x: left,
                    y: top,
                    toJSON: () => ({}),
                }) as DOMRect;
        };
        it('moves spatially without changing the selected marking and contains edges', async () => {
            await component.init(container, toCtx(engine), {
                initialValue: 'L1',
                mode: 'cards',
            });
            place(cards()[0], 0, 0);
            place(cards()[1], 120, 0);
            place(cards()[2], 120, 80);
            cards()[0].focus();
            let escaped = 0;
            container.addEventListener('keydown', () => escaped++);
            expect(press(cards()[0], 'ArrowRight').defaultPrevented).toBe(true);
            expect(document.activeElement).toBe(cards()[1]);
            press(cards()[1], 'ArrowRight');
            expect(document.activeElement).toBe(cards()[1]);
            press(cards()[1], 'ArrowDown');
            expect(document.activeElement).toBe(cards()[2]);
            press(cards()[2], 'ArrowDown');
            expect(document.activeElement).toBe(cards()[2]);
            press(cards()[2], 'ArrowUp');
            expect(document.activeElement).toBe(cards()[1]);
            press(cards()[1], 'ArrowLeft');
            expect(document.activeElement).toBe(cards()[0]);
            press(cards()[0], 'ArrowLeft');
            expect(document.activeElement).toBe(cards()[0]);
            press(cards()[0], 'End');
            expect(document.activeElement).toBe(cards()[2]);
            press(cards()[2], 'Home');
            expect(document.activeElement).toBe(cards()[0]);
            expect(component.getAssertions().map((a) => a.conceptId)).toEqual([
                'level-1',
            ]);
            expect(cards().filter((card) => card.tabIndex === 0)).toEqual([
                cards()[0],
            ]);
            expect(escaped).toBe(0);
            expect(press(cards()[0], 'Tab').defaultPrevented).toBe(false);
            component.destroy();
        });
        it.each(['Enter', ' '])(
            'retains focus and selection on repeated selected-radio %s activation',
            async (key) => {
                await component.init(container, toCtx(engine), {
                    initialValue: 'L1',
                    mode: 'cards',
                });
                cards()[0].focus();
                press(cards()[0], key);
                await demoRuntimeSettled();
                expect(cards()[0].getAttribute('aria-checked')).toBe('true');
                expect(document.activeElement).toBe(cards()[0]);
                component.destroy();
            },
        );
        it.each([false, true])(
            'preserves focus ownership through asynchronous card selection (outside: %s)',
            async (outside) => {
                await component.init(container, toCtx(engine), {
                    initialValue: 'L1',
                    mode: 'cards',
                });
                const process = engine.process.bind(engine);
                let release!: () => void;
                const pending = new Promise<void>((resolve) => {
                    release = resolve;
                });
                // Exercise the async-capable adapter contract used by remote engines.
                vi.spyOn(
                    engine as SchemeEngineAdapter,
                    'process',
                ).mockImplementation(async (...args) => {
                    const result = await process(...args);
                    await pending;
                    return result;
                });
                cards()[1].focus();
                press(cards()[1], 'Enter');
                const elsewhere = document.createElement('button');
                document.body.appendChild(elsewhere);
                if (outside) elsewhere.focus();
                release();
                await demoRuntimeSettled();
                await vi.waitFor(() =>
                    expect(cards()[1].getAttribute('aria-checked')).toBe(
                        'true',
                    ),
                );
                expect(document.activeElement).toBe(
                    outside ? elsewhere : cards()[1],
                );
                elsewhere.remove();
                component.destroy();
            },
        );
        it('clears an optional radio with Escape while retaining the same card focus', async () => {
            await component.init(container, toCtx(engine), {
                initialValue: 'L1',
                mode: 'cards',
            });
            cards()[0].focus();
            press(cards()[0], 'Escape');
            await demoRuntimeSettled();
            expect(component.getAssertions()).toEqual([]);
            expect(document.activeElement).toBe(cards()[0]);
            expect(cards()[0].getAttribute('aria-checked')).toBe('false');
            component.destroy();
        });
        it('retains card identity across allowability redraw and falls back only when removed', async () => {
            await component.init(container, toCtx(engine), {
                initialValue: 'L1',
                mode: 'cards',
            });
            cards()[2].focus();
            const allow = (ids: string[]) =>
                component.applyAllowableOptions(
                    engine
                        .getScheme()
                        .concepts.filter((concept) => ids.includes(concept.id))
                        .map((concept) => ({
                            conceptId: concept.id,
                            categoryId: 'level',
                            label: concept.name,
                            name: concept.name,
                            description: '',
                            views: concept.views,
                            selected: false,
                            order: concept.position,
                            group: 'level',
                        })),
                );
            allow(['level-1', 'level-3']);
            expect(
                (document.activeElement as HTMLElement).dataset.conceptId,
            ).toBe('level-3');
            expect(cards()[1].tabIndex).toBe(0);
            const elsewhere = document.createElement('button');
            document.body.appendChild(elsewhere);
            elsewhere.focus();
            component.applyAllowableOptions(null);
            expect(document.activeElement).toBe(elsewhere);
            expect(
                cards()
                    .filter((card) => card.tabIndex === 0)
                    .map((card) => card.dataset.conceptId),
            ).toEqual(['level-3']);
            elsewhere.remove();
            cards()[2].focus();
            allow(['level-1']);
            expect(document.activeElement).toBe(cards()[0]);
            expect(cards()[0].tabIndex).toBe(0);
            component.destroy();
        });
        it.each([false, true])(
            'resumes a temporarily empty card group only while focus is still owned (outside: %s)',
            async (outside) => {
                await component.init(container, toCtx(engine), {
                    mode: 'cards',
                });
                cards()[2].focus();
                component.applyAllowableOptions([]);
                expect(document.activeElement).toBe(
                    container.querySelector('.select-cards'),
                );
                const elsewhere = document.createElement('button');
                document.body.appendChild(elsewhere);
                if (outside) elsewhere.focus();
                component.applyAllowableOptions(null);
                expect(document.activeElement).toBe(
                    outside ? elsewhere : cards()[0],
                );
                elsewhere.remove();
                component.destroy();
            },
        );
        it('leaves modifiers, composition and a native child input untouched', async () => {
            await component.init(container, toCtx(engine), {
                initialValue: 'L1',
                mode: 'cards',
            });
            cards()[0].focus();
            for (const modifiers of [
                { altKey: true },
                { ctrlKey: true },
                { metaKey: true },
                { shiftKey: true },
                { isComposing: true },
            ]) {
                expect(
                    press(cards()[0], 'ArrowRight', modifiers).defaultPrevented,
                ).toBe(false);
                expect(
                    press(cards()[0], 'Enter', modifiers).defaultPrevented,
                ).toBe(false);
                expect(document.activeElement).toBe(cards()[0]);
            }
            // The real supplemental editor is outside the card; keep descendant events native too.
            const input = document.createElement('input');
            cards()[0].appendChild(input);
            input.focus();
            for (const key of [
                'ArrowLeft',
                'ArrowRight',
                'Home',
                'End',
                ' ',
                'Enter',
            ]) {
                expect(press(input, key).defaultPrevented).toBe(false);
                expect(document.activeElement).toBe(input);
            }
            expect(component.getAssertions().map((a) => a.conceptId)).toEqual([
                'level-1',
            ]);
            component.destroy();
        });
    });

    describe('roving tabindex', () => {
        it('cold load with no selection puts tabIndex=0 on card 0', async () => {
            await component.init(container, toCtx(engine), {
                mode: 'cards',
            });
            const cards =
                container.querySelectorAll<HTMLElement>('.select-card');
            expect(cards[0].tabIndex).toBe(0);
            expect(cards[1].tabIndex).toBe(-1);
            expect(cards[2].tabIndex).toBe(-1);
            component.destroy();
        });

        it('cold load with a pre-selected value puts tabIndex=0 on the checked card', async () => {
            // The pre-selected level-2 card is at index 1 and owns the tab stop.
            await component.init(container, toCtx(engine), {
                initialValue: 'L2',
                mode: 'cards',
            });
            const cards =
                container.querySelectorAll<HTMLElement>('.select-card');
            const tabStops = Array.from(cards).filter((c) => c.tabIndex === 0);
            expect(tabStops.length).toBe(1);
            expect(tabStops[0].getAttribute('aria-checked')).toBe('true');
            expect(tabStops[0].dataset.index).toBe('1');
            component.destroy();
        });

        it('setAssertions after cold load moves the tab stop to the checked card', async () => {
            // Simulate a store subscription pushing state after init (focusIndex stays -1)
            await component.init(container, toCtx(engine), {
                mode: 'cards',
            });
            component.setAssertions([
                {
                    conceptId: 'level-2',
                    categoryId: 'level',
                    confidence: 'certain',
                    source: 'user',
                },
            ]);
            await demoRuntimeSettled();
            const cards =
                container.querySelectorAll<HTMLElement>('.select-card');
            const tabStops = Array.from(cards).filter((c) => c.tabIndex === 0);
            expect(tabStops.length).toBe(1);
            expect(tabStops[0].getAttribute('aria-checked')).toBe('true');
            // Should be level-2 (index 1), NOT level-1 (index 0)
            expect(tabStops[0].dataset.index).toBe('1');
            component.destroy();
        });
    });
});
