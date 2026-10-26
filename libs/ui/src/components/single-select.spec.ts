import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Context } from '@ezclassify/engine';
import type { Assertion, LocalSchemeEngineAdapter } from '@ezclassify/types';
import { SingleSelect } from './single-select';
function makeEngine(
    withTextInput = false,
    calendarValue = false,
): LocalSchemeEngineAdapter {
    return Context.fromComponents({
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
                    concepts: {
                        inline: [
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
                                    default: calendarValue ? '{value}' : 'L3',
                                },
                                ...(withTextInput
                                    ? {
                                          text_input: {
                                              encoding: calendarValue
                                                  ? {
                                                        type: 'calendar-date',
                                                        canonical: 'YYYY-MM-DD',
                                                        accepts: [
                                                            'YYYYMMDD',
                                                            'YYYY-MM-DD',
                                                        ],
                                                        views: {
                                                            default: 'YYYYMMDD',
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
                },
                rules: [],
                rollup_pipelines: [],
                parse: {
                    case_sensitive: false,
                    strip_whitespace: true,
                },
                render: {
                    default: 'default',
                    formats: [
                        {
                            id: 'default',
                            surface: 'marking',
                            mode: 'inline',
                            separator: '//',
                            fields: [{ category: 'level', separator: '//' }],
                        },
                    ],
                },
            },
        },
    }).scheme as LocalSchemeEngineAdapter;
}

// Same shape as makeEngine, but the level category drives the display color
// (render.color_from) and each level concept carries an authority-mandated
// color pair. Used to prove the cards adopt the mandated color.
function makeColoredEngine(): LocalSchemeEngineAdapter {
    const colors: Record<string, { background: string; text: string }> = {
        'level-1': { background: '#00a651', text: '#ffffff' },
        'level-2': { background: '#ff8c00', text: '#000000' },
        'level-3': { background: '#c8102e', text: '#ffffff' },
    };
    return Context.fromComponents({
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
                    concepts: {
                        inline: [
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
                },
                rules: [],
                rollup_pipelines: [],
                parse: {
                    case_sensitive: false,
                    strip_whitespace: true,
                },
                render: {
                    default: 'default',
                    color_from: 'level',
                    formats: [
                        {
                            id: 'default',
                            surface: 'marking',
                            mode: 'inline',
                            separator: '//',
                            fields: [{ category: 'level', separator: '//' }],
                        },
                    ],
                },
            },
        },
    }).scheme as LocalSchemeEngineAdapter;
}

const toCtx = (eng: unknown) => Context.fromSchemeEngine(eng as never);
describe('SingleSelect', () => {
    let container: HTMLDivElement;
    let engine: LocalSchemeEngineAdapter;
    let component: SingleSelect;
    beforeEach(async () => {
        container = document.createElement('div');
        document.body.appendChild(container);
        engine = makeEngine();
        component = new SingleSelect();
    });
    it('renders a conventional select by default', async () => {
        await component.init(container, toCtx(engine));
        const select =
            container.querySelector<HTMLSelectElement>('.select-dropdown');
        expect(select).not.toBeNull();
        expect(select?.options).toHaveLength(4);
        expect(container.querySelector('.select-card')).toBeNull();
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
        expect(detail.dataset.state).toBe('preview');
        expect(detail.textContent).toContain('L1');
        expect(detail.textContent).toContain(
            'Choose this level for the first tier.',
        );

        cards[0].dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));
        expect(detail.dataset.state).toBe('empty');

        cards[0].click();
        expect(detail.dataset.state).toBe('selected');
        expect(detail.textContent).toContain('L1');
        component.destroy();
    });
    it('fills cards from authority-mandated colors (render.color_from)', async () => {
        // No host colorMap: the mandated per-concept color drives each card.
        const coloredEngine = makeColoredEngine();
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
        const textInputEngine = makeEngine(true);
        await component.init(container, toCtx(textInputEngine));
        const select =
            container.querySelector<HTMLSelectElement>('.select-dropdown')!;
        select.value = 'level-3';
        select.dispatchEvent(new Event('change', { bubbles: true }));

        // A text choice is only a local draft until it has a valid value.
        // A scoped engine or store refresh can return no complete assertion.
        component.setAssertions([]);
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
        expect(supplement.querySelector('.select-card-text-field')).toBeNull();
        component.destroy();
    });
    it('keeps a real canonical calendar choice across a second edit and clear', async () => {
        const calendar = makeEngine(true, true);
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

    it('makes an explicit selected-value edit a fresh user choice without changing provider provenance', async () => {
        const textEngine = makeEngine(true);
        const process = textEngine.process.bind(textEngine);
        const derived: Assertion = {
            conceptId: 'level-3',
            categoryId: 'level',
            value: '20350930',
            source: 'infer',
            confidence: 'inferred',
            sourceRule: 'suggest-value',
            provenance: {
                providerId: 'fixture-provider',
                reproducibility: 'best-effort',
                attribution: {
                    name: 'Fixture provider',
                    license: 'Apache-2.0',
                },
            },
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
        await component.init(container, toCtx(makeEngine(true)));
        const select =
            container.querySelector<HTMLSelectElement>('.select-dropdown')!;
        select.value = 'level-3';
        select.dispatchEvent(new Event('change', { bubbles: true }));
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
        await component.init(container, toCtx(makeEngine(true)));
        const select =
            container.querySelector<HTMLSelectElement>('.select-dropdown')!;
        select.value = 'level-3';
        select.dispatchEvent(new Event('change', { bubbles: true }));
        expect(select.value).toBe('level-3');

        await component.setValue('');
        expect(select.value).toBe('');
        expect(container.querySelector('.select-card-text-field')).toBeNull();
        component.destroy();
    });
    it('host colorMap wins over the scheme default color', async () => {
        const coloredEngine = makeColoredEngine();
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

    describe('arrow key navigation (WCAG 4.1.2)', () => {
        it('ArrowDown selects the next card without requiring Enter or Space', async () => {
            await component.init(container, toCtx(engine), {
                initialValue: 'L1',
                mode: 'cards',
            });
            const cards =
                container.querySelectorAll<HTMLElement>('.select-card');
            expect(cards[0].getAttribute('aria-checked')).toBe('true');
            expect(cards[1].getAttribute('aria-checked')).toBe('false');

            cards[0].dispatchEvent(
                new KeyboardEvent('keydown', {
                    key: 'ArrowDown',
                    bubbles: true,
                }),
            );

            const updated =
                container.querySelectorAll<HTMLElement>('.select-card');
            expect(updated[0].getAttribute('aria-checked')).toBe('false');
            expect(updated[1].getAttribute('aria-checked')).toBe('true');
            component.destroy();
        });

        it('ArrowUp selects the previous card without requiring Enter or Space', async () => {
            await component.init(container, toCtx(engine), {
                initialValue: 'L2',
                mode: 'cards',
            });
            const cards =
                container.querySelectorAll<HTMLElement>('.select-card');
            expect(cards[1].getAttribute('aria-checked')).toBe('true');
            expect(cards[0].getAttribute('aria-checked')).toBe('false');

            cards[1].dispatchEvent(
                new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }),
            );

            const updated =
                container.querySelectorAll<HTMLElement>('.select-card');
            expect(updated[1].getAttribute('aria-checked')).toBe('false');
            expect(updated[0].getAttribute('aria-checked')).toBe('true');
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
