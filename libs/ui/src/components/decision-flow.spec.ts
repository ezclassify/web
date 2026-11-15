import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DecisionFlow } from './decision-flow';
import type { SchemeEngineAdapter, Assertion } from '@ezclassify/types';
import type {
    SchemePublicView,
    ConceptView,
    CategoryView,
} from '@ezclassify/types';
import { schemeOnlyContext } from '../../test-fixtures/context-doubles';
import { setStatusMarkFixes } from './status-mark';
import {
    mockRenderFormat,
    mockRenderFormats,
} from '../render-format-layout-mock';

/**
 * Answer a process call that names `suggestFor` with each named category's
 * options, taken from the double's own `suggest` in one call, so a spec that
 * counts or stubs `suggest` still sees every options request.
 */
function withSuggestFor(engine: SchemeEngineAdapter): SchemeEngineAdapter {
    type Options = { assertions?: Assertion[]; suggestFor?: string[] };
    const process = engine.process as unknown as (
        input: string,
        opts?: Options,
    ) => unknown;
    (engine as any).process = vi.fn((input: string, opts?: Options) => {
        const named = opts?.suggestFor;
        if (!named) return process(input, opts);
        return Promise.resolve(
            (engine.suggest as any)(opts.assertions ?? [], opts),
        ).then((answer: { suggestions: { categoryId: string }[] }) => ({
            ...(process(input, opts) as object),
            suggestionsFor: Object.fromEntries(
                named.map((categoryId) => [
                    categoryId,
                    {
                        suggestions: answer.suggestions.filter(
                            (s) => s.categoryId === categoryId,
                        ),
                        warnings: [],
                    },
                ]),
            ),
        }));
    });
    return engine;
}

function createStepProfile(): SchemePublicView {
    const concepts: ConceptView[] = [
        {
            id: 'SCOPE_NONE',
            name: 'None',
            views: { default: 'S:N' },
            categories: ['scope'],
            parents: [],
            aliases: [],
            position: 1,
        },
        {
            id: 'SCOPE_PARTIAL',
            name: 'Partial',
            views: { default: 'S:P' },
            categories: ['scope'],
            parents: [],
            aliases: [],
            position: 2,
        },
        {
            id: 'SCOPE_FULL',
            name: 'Full',
            views: { default: 'S:F' },
            categories: ['scope'],
            parents: [],
            aliases: [],
            position: 3,
        },
        {
            id: 'IMPACT_LOW',
            name: 'Low',
            views: { default: 'I:L' },
            categories: ['impact'],
            parents: [],
            aliases: [],
            position: 1,
        },
        {
            id: 'IMPACT_HIGH',
            name: 'High',
            views: { default: 'I:H' },
            categories: ['impact'],
            parents: [],
            aliases: [],
            position: 2,
        },
    ] as ConceptView[];

    const categories: CategoryView[] = [
        {
            id: 'scope',
            label: 'Scope',
            single: true,
            required: false,
        } as CategoryView,
        {
            id: 'impact',
            label: 'Impact',
            single: true,
            required: false,
        } as CategoryView,
    ];

    return {
        name: 'Test Profile',
        categories,
        concepts,
        formats: [
            {
                id: 'default',
                categoryOrder: ['scope', 'impact'],
                separator: '/',
                categorySeparator: '/',
                view: 'default',
            },
        ],
        scopes: [],
        defaultRenderFormat: 'default',
    } as unknown as SchemePublicView;
}

function createMockEngine(): SchemeEngineAdapter {
    const p = createStepProfile();
    return withSuggestFor({
        getScheme: () => p,
        getSchemeMeta: () => ({
            id: (p as any).id ?? 'test',
            version: (p as any).version ?? '1.0',
            name: p.name ?? 'Test',
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
            rendered: assertions
                .map((a) => {
                    const c = p.concepts.find((x) => x.id === a.conceptId);
                    return c?.views?.['default'] ?? a.conceptId;
                })
                .join('/'),
            assessment: {
                emitted: [],
                omitted: [],
                collapsed: [],
                conflicts: [],
                unrepresentable: [],
            },
        })),
        process: vi.fn((input: string, opts?: { assertions?: Assertion[] }) => {
            if (opts?.assertions && opts.assertions.length > 0) {
                const rendered = opts.assertions
                    .map((a) => {
                        const c = p.concepts.find((x) => x.id === a.conceptId);
                        return c?.views?.['default'] ?? a.conceptId;
                    })
                    .join('/');
                return {
                    assertions: [...opts.assertions],
                    rendered,
                    valid: true,
                };
            }
            const tokens = input
                .split('/')
                .map((s) => s.trim())
                .filter(Boolean);
            const assertions = tokens
                .map((token) => {
                    const concept = p.concepts.find(
                        (c) => c.views?.['default'] === token || c.id === token,
                    );
                    return concept
                        ? {
                              conceptId: concept.id,
                              categoryId: concept.categories[0],
                              confidence: 'certain' as const,
                              source: 'parse' as const,
                          }
                        : null;
                })
                .filter(Boolean) as Assertion[];
            return { assertions, rendered: input, valid: true };
        }),
        suggest: vi.fn().mockReturnValue({
            suggestions: p.concepts.map((c) => ({
                conceptId: c.id,
                categoryId: c.categories[0],
                label: c.views?.default ?? c.name,
                name: c.name,
                group: c.categories[0],
            })),
        }),
        describeConcept: (conceptId: string) => ({ lines: [conceptId] }),
    } as unknown as SchemeEngineAdapter);
}

/** Profile with one single-select and one multi-select category. */
function createMixedProfile(): SchemePublicView {
    const concepts: ConceptView[] = [
        {
            id: 'LEVEL_A',
            name: 'Level A',
            views: { default: 'T:A' },
            categories: ['level'],
            parents: [],
            aliases: [],
            position: 1,
        },
        {
            id: 'LEVEL_B',
            name: 'Level B',
            views: { default: 'T:B' },
            categories: ['level'],
            parents: [],
            aliases: [],
            position: 2,
        },
        {
            id: 'CAVEAT_X',
            name: 'Caveat X',
            views: { default: 'CX' },
            categories: ['caveat'],
            parents: [],
            aliases: [],
            position: 1,
        },
        {
            id: 'CAVEAT_Y',
            name: 'Caveat Y',
            views: { default: 'CY' },
            categories: ['caveat'],
            parents: [],
            aliases: [],
            position: 2,
        },
        {
            id: 'CAVEAT_Z',
            name: 'Caveat Z',
            views: { default: 'CZ' },
            categories: ['caveat'],
            parents: [],
            aliases: [],
            position: 3,
        },
    ] as ConceptView[];

    const categories: CategoryView[] = [
        {
            id: 'level',
            label: 'Level',
            single: true,
            required: true,
        } as CategoryView,
        {
            id: 'caveat',
            label: 'Caveat',
            single: false,
            required: false,
        } as CategoryView,
    ];

    return {
        name: 'Mixed Profile',
        categories,
        concepts,
        formats: [
            {
                id: 'default',
                categoryOrder: ['level', 'caveat'],
                separator: '//',
                categorySeparator: '//',
                view: 'default',
            },
        ],
        scopes: [],
        defaultRenderFormat: 'default',
    } as unknown as SchemePublicView;
}

function createMixedEngine(): SchemeEngineAdapter {
    const p = createMixedProfile();
    return withSuggestFor({
        getScheme: () => p,
        getSchemeMeta: () => ({
            id: 'mixed',
            version: '1.0',
            name: 'Mixed Profile',
            defaultRenderFormat: 'default',
            formats: [
                mockRenderFormat({
                    id: 'default',
                    view: 'default',
                    categorySeparator: '//',
                    separator: '//',
                    categoryOrder: ['level', 'caveat'],
                }),
            ],
            scopes: [],
        }),
        listCategories: () => p.categories,
        getConceptsInCategory: (catId: string) =>
            p.concepts.filter((c: any) => c.categories?.includes(catId)),
        render: vi.fn((assertions: Assertion[]) => ({
            rendered: assertions
                .map((a) => {
                    const c = p.concepts.find((x) => x.id === a.conceptId);
                    return c?.views?.['default'] ?? a.conceptId;
                })
                .join('//'),
            assessment: {
                emitted: [],
                omitted: [],
                collapsed: [],
                conflicts: [],
                unrepresentable: [],
            },
        })),
        process: vi.fn(
            (_input: string, opts?: { assertions?: Assertion[] }) => {
                const assertions = opts?.assertions ?? [];
                const rendered = assertions
                    .map((a) => {
                        const c = p.concepts.find((x) => x.id === a.conceptId);
                        return c?.views?.['default'] ?? a.conceptId;
                    })
                    .join('//');
                return { assertions: [...assertions], rendered, valid: true };
            },
        ),
        suggest: vi.fn().mockReturnValue({
            suggestions: p.concepts.map((c) => ({
                conceptId: c.id,
                categoryId: c.categories[0],
                label: c.views?.default ?? c.name,
                name: c.name,
                group: c.categories[0],
            })),
        }),
        describeConcept: (conceptId: string) => ({ lines: [conceptId] }),
    } as unknown as SchemeEngineAdapter);
}

/**
 * Profile with a header concept that owns a dependent category. Mirrors
 * SHARE_WITH → share_recipients in the State Test scheme.
 */
function createOwnedCategoryProfile(): SchemePublicView {
    const concepts: ConceptView[] = [
        {
            id: 'LEVEL_A',
            name: 'Level A',
            views: { default: 'T:A' },
            categories: ['level'],
            parents: [],
            aliases: [],
            position: 1,
        },
        // Two sharing concepts: one owns 'recipients', one doesn't
        {
            id: 'NO_SHARING',
            name: 'No Sharing',
            views: { default: 'NONE' },
            categories: ['sharing'],
            parents: [],
            aliases: [],
            position: 1,
        },
        {
            id: 'SHARE_ALLOWED',
            name: 'Share Allowed',
            views: { default: 'SHARE' },
            categories: ['sharing'],
            parents: [],
            aliases: [],
            position: 2,
        } as unknown as ConceptView,
        // recipients concepts, only visible when SHARE_ALLOWED is selected
        {
            id: 'GROUP_A',
            name: 'Group A',
            views: { default: 'GA' },
            categories: ['recipients'],
            parents: [],
            aliases: [],
            position: 1,
        },
        {
            id: 'GROUP_B',
            name: 'Group B',
            views: { default: 'GB' },
            categories: ['recipients'],
            parents: [],
            aliases: [],
            position: 2,
        },
    ] as ConceptView[];

    const categories: CategoryView[] = [
        {
            id: 'level',
            label: 'Level',
            single: true,
            required: true,
        } as CategoryView,
        {
            id: 'sharing',
            label: 'Sharing',
            single: true,
            required: false,
        } as CategoryView,
        {
            id: 'recipients',
            label: 'Recipients',
            single: false,
            required: false,
        } as CategoryView,
    ];

    return {
        name: 'OwnedCategory Profile',
        categories,
        concepts,
        formats: [{ id: 'default', surface: 'default', mode: 'inline' }],
        scopes: [],
        defaultRenderFormat: 'default',
    } as unknown as SchemePublicView;
}

function createOwnedCategoryEngine(): SchemeEngineAdapter {
    const p = createOwnedCategoryProfile();
    return withSuggestFor({
        getScheme: () => p,
        getSchemeMeta: () => ({
            id: 'owned',
            version: '1.0',
            name: 'OwnedCategory Profile',
            defaultRenderFormat: 'default',
            formats: [
                mockRenderFormat({
                    id: 'default',
                    view: 'default',
                    categorySeparator: '//',
                    separator: '//',
                    categoryOrder: ['level', 'sharing', 'recipients'],
                    // SHARE_ALLOWED heads the recipients list. The association
                    // is a property of the format, and the adapter publishes it
                    // resolved; nothing about the grammar that produced it
                    // reaches a UI.
                    headers: [
                        {
                            concept: 'SHARE_ALLOWED',
                            headerCategory: 'sharing',
                            category: 'recipients',
                            position: 'prefix',
                        },
                    ],
                }),
            ],
            scopes: [],
        }),
        listCategories: () => p.categories,
        getConceptsInCategory: (catId: string) =>
            p.concepts.filter((c: any) => c.categories?.includes(catId)),
        render: vi.fn((assertions: Assertion[]) => ({
            rendered: assertions
                .map((a) => {
                    const c = p.concepts.find((x) => x.id === a.conceptId);
                    return c?.views?.['default'] ?? a.conceptId;
                })
                .join('//'),
            assessment: {
                emitted: [],
                omitted: [],
                collapsed: [],
                conflicts: [],
                unrepresentable: [],
            },
        })),
        process: vi.fn(
            (_input: string, opts?: { assertions?: Assertion[] }) => {
                const assertions = opts?.assertions ?? [];
                const rendered = assertions
                    .map((a) => {
                        const c = p.concepts.find((x) => x.id === a.conceptId);
                        return c?.views?.['default'] ?? a.conceptId;
                    })
                    .join('//');
                return { assertions: [...assertions], rendered, valid: true };
            },
        ),
        suggest: vi.fn().mockReturnValue({
            suggestions: p.concepts.map((c) => ({
                conceptId: c.id,
                categoryId: c.categories[0],
                label: c.views?.default ?? c.name,
                name: c.name,
                group: c.categories[0],
            })),
        }),
        describeConcept: (conceptId: string) => ({ lines: [conceptId] }),
    } as unknown as SchemeEngineAdapter);
}

const toCtx = (eng: unknown) => schemeOnlyContext(eng as never);
describe('DecisionFlow', () => {
    let container: HTMLDivElement;
    let engine: SchemeEngineAdapter;
    let component: DecisionFlow;

    beforeEach(() => {
        container = document.createElement('div');
        container.setAttribute(
            'data-ezclassify-decisionflow-categories',
            '["scope","impact"]',
        );
        document.body.appendChild(container);
        engine = createMockEngine();
        component = new DecisionFlow();
    });

    it('renders step progress dots', async () => {
        await component.init(container, toCtx(engine));
        await enterFlow(container);
        const dots = container.querySelectorAll('.ez-decision-flow__step-dot');
        expect(dots.length).toBe(2);
    });

    it('renders the first step by default', async () => {
        await component.init(container, toCtx(engine));
        await enterFlow(container);
        const label = container.querySelector(
            '.ez-decision-flow__question-label',
        );
        expect(label?.textContent).toContain('Scope');
    });

    it("renders a single-choice step's options as toggle buttons, not radios", async () => {
        await component.init(container, toCtx(engine));
        await enterFlow(container);
        const options = container.querySelectorAll<HTMLButtonElement>(
            '.ez-decision-flow__option',
        );
        expect(options.length).toBe(3);
        expect(
            [...options].every(
                (o) =>
                    o.type === 'button' &&
                    !o.hasAttribute('role') &&
                    !o.hasAttribute('aria-checked'),
            ),
        ).toBe(true);
        expect(container.querySelector('[role="radio"]')).toBeNull();
    });

    describe('WCAG 4.1.2: single-choice option role and state', () => {
        it('an option not chosen is not pressed', async () => {
            await component.init(container, toCtx(engine));
            await enterFlow(container);
            const options = Array.from(
                container.querySelectorAll<HTMLButtonElement>('[aria-pressed]'),
            );
            expect(options).toHaveLength(3);
            expect(
                options.every(
                    (o) => o.getAttribute('aria-pressed') === 'false',
                ),
            ).toBe(true);
        });

        it('the chosen option is pressed and the others are not', async () => {
            await component.init(container, toCtx(engine));
            await enterFlow(container);
            const options =
                container.querySelectorAll<HTMLButtonElement>('[aria-pressed]');
            options[1].click();
            const after = Array.from(
                container.querySelectorAll<HTMLButtonElement>('[aria-pressed]'),
            );
            expect(after[1].getAttribute('aria-pressed')).toBe('true');
            expect(after[0].getAttribute('aria-pressed')).toBe('false');
            expect(after[2].getAttribute('aria-pressed')).toBe('false');
        });

        it('groups the toggles under the step title', async () => {
            await component.init(container, toCtx(engine));
            await enterFlow(container);
            const optionsEl = container.querySelector(
                '.ez-decision-flow__options',
            );
            expect(optionsEl?.getAttribute('role')).toBe('group');
        });
    });

    describe('WCAG 2.4.3: focus stays inside component after secondary renders', () => {
        it('focus stays on the chosen toggle after a subsequent render call (simulated _refreshAllowed)', async () => {
            await component.init(container, toCtx(engine));
            await enterFlow(container);
            const options =
                container.querySelectorAll<HTMLButtonElement>('[aria-pressed]');

            // Simulate user selecting an option
            options[0].click();

            // After the selection render, focus should be on the chosen toggle
            const chosen = container.querySelector<HTMLButtonElement>(
                '[aria-pressed][tabindex="0"]',
            );
            chosen?.focus();
            expect(document.activeElement).toBe(chosen);

            // Simulate a secondary render (e.g. _refreshAllowed completing) by calling render directly
            (component as any).render();

            // Focus must remain inside the component, not drift to document.body
            expect(document.activeElement).not.toBe(document.body);
            expect(container.contains(document.activeElement)).toBe(true);
        });

        it('focus stays on a checkbox option after a subsequent render call', async () => {
            const mixedCtr = document.createElement('div');
            mixedCtr.setAttribute(
                'data-ezclassify-decisionflow-categories',
                '["level","caveat"]',
            );
            document.body.appendChild(mixedCtr);
            const mixedFlow = new DecisionFlow();
            await mixedFlow.init(mixedCtr, toCtx(createMixedEngine()));
            await enterFlow(mixedCtr);

            // Advance to multi-select step
            mixedCtr
                .querySelectorAll<HTMLButtonElement>(
                    '.ez-decision-flow__option',
                )[0]
                .click();
            mixedCtr
                .querySelectorAll<HTMLButtonElement>(
                    '.ez-decision-flow__nav-btn',
                )[1]
                .click();

            const checkbox =
                mixedCtr.querySelector<HTMLButtonElement>('[role="checkbox"]')!;
            checkbox.click();

            // After selection, focus the first checkbox
            const cbAfter =
                mixedCtr.querySelector<HTMLButtonElement>('[role="checkbox"]')!;
            cbAfter.focus();
            expect(document.activeElement).toBe(cbAfter);

            // Secondary render
            (mixedFlow as any).render();

            expect(document.activeElement).not.toBe(document.body);
            expect(mixedCtr.contains(document.activeElement)).toBe(true);

            mixedCtr.remove();
        });
    });

    it('selects an option on click and shows the marking on its line', async () => {
        await component.init(container, toCtx(engine));
        await enterFlow(container);
        const options = container.querySelectorAll<HTMLButtonElement>(
            '.ez-decision-flow__option',
        );
        options[2].click();
        await settle();
        const values = container.querySelectorAll('.ez-decision-flow__value');
        // One scope: one value, after the dots, with no scope name.
        expect(values.length).toBe(1);
        expect(
            container.querySelector('.ez-decision-flow__dot-group-label'),
        ).toBeNull();
        expect(
            values[0].querySelector('.ez-decision-flow__value-text')
                ?.textContent,
        ).toBe('S:F');
    });

    it('Next button is enabled for optional categories without selection (skippable)', async () => {
        // Both scope and impact in this profile have required: false.
        await component.init(container, toCtx(engine));
        await enterFlow(container);
        const nextBtn = container.querySelectorAll<HTMLButtonElement>(
            '.ez-decision-flow__nav-btn',
        )[1];
        expect(nextBtn.disabled).toBe(false);
    });

    it('Next button is disabled for required categories until a selection is made', async () => {
        const requiredProfile = createStepProfile();
        (requiredProfile.categories[0] as any).required = true;
        const requiredEngine: SchemeEngineAdapter = {
            ...engine,
            getScheme: () => requiredProfile,
        } as SchemeEngineAdapter;
        const flow = new DecisionFlow();
        await flow.init(container, toCtx(requiredEngine));
        await enterFlow(container);
        const nextBtn = container.querySelectorAll<HTMLButtonElement>(
            '.ez-decision-flow__nav-btn',
        )[1];
        expect(nextBtn.disabled).toBe(true);
        const options = container.querySelectorAll<HTMLButtonElement>(
            '.ez-decision-flow__option',
        );
        options[0].click();
        const nextBtnAfter = container.querySelectorAll<HTMLButtonElement>(
            '.ez-decision-flow__nav-btn',
        )[1];
        expect(nextBtnAfter.disabled).toBe(false);
    });

    it('navigates to next step when Next is clicked', async () => {
        await component.init(container, toCtx(engine));
        await enterFlow(container);
        const options = container.querySelectorAll<HTMLButtonElement>(
            '.ez-decision-flow__option',
        );
        options[0].click();
        const nextBtn = container.querySelectorAll<HTMLButtonElement>(
            '.ez-decision-flow__nav-btn',
        )[1];
        nextBtn.click();
        const label = container.querySelector(
            '.ez-decision-flow__question-label',
        );
        expect(label?.textContent).toContain('Impact');
    });

    it('disables Back on the first step', async () => {
        await component.init(container, toCtx(engine));
        await enterFlow(container);
        const backBtn = container.querySelector<HTMLButtonElement>(
            '.ez-decision-flow__nav-btn',
        );
        expect(backBtn?.disabled).toBe(true);
    });

    it('names the edge arrows Previous step and Next step, with the glyphs hidden', async () => {
        await component.init(container, toCtx(engine));
        await enterFlow(container);
        const [back, next] = container.querySelectorAll<HTMLButtonElement>(
            '.ez-decision-flow__nav-btn',
        );
        expect(back.getAttribute('aria-label')).toBe('Previous step');
        expect(next.getAttribute('aria-label')).toBe('Next step');
        // The title heads the step; the arrows sit at its inside edges,
        // around its options.
        const step = container.querySelector('.ez-decision-flow__step')!;
        expect(step.firstElementChild?.className).toBe(
            'ez-decision-flow__question-label',
        );
        expect(step.children[1]).toBe(back);
        expect(step.lastElementChild).toBe(next);
        const arrows = [back, next].map((button) =>
            button.querySelector('[aria-hidden="true"]'),
        );
        expect(arrows.map((arrow) => arrow?.textContent)).toEqual([
            '\u2039\uFE0E',
            '\u203a\uFE0E',
        ]);
    });

    it('shows an unset marking on its line as a word, not a dash', async () => {
        await component.init(container, toCtx(engine));
        await enterFlow(container);
        const text = container.querySelector('.ez-decision-flow__value-text');
        // A word, not a dash: a dash is silent to a screen reader.
        expect(text?.textContent).toBe('not set');
        expect(text?.hasAttribute('data-empty')).toBe(true);
    });

    it('arrow keys move focus without committing a selection', async () => {
        await component.init(container, toCtx(engine));
        await enterFlow(container);
        const options = Array.from(
            container.querySelectorAll<HTMLButtonElement>(
                '.ez-decision-flow__option',
            ),
        );
        expect(options.length).toBe(3);

        // Start at index 0, press ArrowDown → should move tabIndex to 1, no assertion
        options[0].dispatchEvent(
            new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }),
        );
        expect(options[1].tabIndex).toBe(0);
        expect(options[0].tabIndex).toBe(-1);
        // No assertion committed
        expect(component.getAssertions().length).toBe(0);
    });

    it('pressing Enter on focused (arrow-navigated) button commits the selection', async () => {
        await component.init(container, toCtx(engine));
        await enterFlow(container);
        const options = Array.from(
            container.querySelectorAll<HTMLButtonElement>(
                '.ez-decision-flow__option',
            ),
        );

        // Arrow to second option without committing
        options[0].dispatchEvent(
            new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }),
        );
        expect(component.getAssertions().length).toBe(0);

        // Click (simulates Enter/Space on button) to commit
        options[1].click();
        expect(
            component
                .getAssertions()
                .some((a) => a.conceptId === 'SCOPE_PARTIAL'),
        ).toBe(true);
    });

    it('heads the open step with its title: "1 of 2 · Scope"', async () => {
        await component.init(container, toCtx(engine));
        await enterFlow(container);
        const label = container.querySelector(
            '.ez-decision-flow__step > .ez-decision-flow__question-label',
        );
        expect(label?.textContent).toBe('1 of 2 \u00b7 Scope');
        expect(
            container.querySelector(
                '.ez-decision-flow__header .ez-decision-flow__question-label',
            ),
        ).toBeNull();
    });

    it('options container aria-labelledby references the h3 label id', async () => {
        await component.init(container, toCtx(engine));
        await enterFlow(container);
        const label = container.querySelector(
            '.ez-decision-flow__question-label',
        );
        const labelId = label?.id;
        expect(labelId).toBeTruthy();
        const optionsEl = container.querySelector('.ez-decision-flow__options');
        expect(optionsEl?.getAttribute('aria-labelledby')).toBe(labelId);
    });

    it("a single-select step's options are a group, not a radiogroup", async () => {
        await component.init(container, toCtx(engine));
        await enterFlow(container);
        // The first step in the default profile is single-select.
        const optionsEl = container.querySelector('.ez-decision-flow__options');
        expect(optionsEl?.getAttribute('role')).toBe('group');
    });

    it('the options group aria-labelledby targets an element with the step question text', async () => {
        await component.init(container, toCtx(engine));
        await enterFlow(container);
        const optionsEl = container.querySelector('.ez-decision-flow__options');
        const labelId = optionsEl?.getAttribute('aria-labelledby');
        expect(labelId).toBeTruthy();
        const labelEl = labelId ? container.querySelector(`#${labelId}`) : null;
        expect(labelEl).not.toBeNull();
        expect(labelEl?.textContent?.trim().length).toBeGreaterThan(0);
    });

    it('live announcer region exists for AT step-change announcements', async () => {
        await component.init(container, toCtx(engine));
        await enterFlow(container);
        const announcer = container.querySelector('[aria-live]');
        expect(announcer).toBeTruthy();
    });

    it('default category order covers all categories, not just single-select', async () => {
        // No explicit data-ezclassify-decisionflow-categories, falls back to profile order.
        // A profile with a multi-select category must include it.
        const mixedContainer = document.createElement('div');
        document.body.appendChild(mixedContainer);
        const flow = new DecisionFlow();
        await flow.init(mixedContainer, toCtx(createMixedEngine()));
        await enterFlow(mixedContainer);
        const dots = mixedContainer.querySelectorAll(
            '.ez-decision-flow__step-dot',
        );
        // Both level (single) and caveat (multi) must produce a step.
        expect(dots.length).toBe(2);
        mixedContainer.remove();
    });

    it('seeded marking with only required categories filled does not land on optional empty step', async () => {
        // Profile: scope required=true, impact required=false. Seed with scope only.
        const seededProfile = createStepProfile();
        (seededProfile.categories[0] as any).required = true;
        (seededProfile.categories[1] as any).required = false;

        const initialAssertions: Assertion[] = [
            {
                conceptId: 'SCOPE_FULL',
                categoryId: 'scope',
                confidence: 'certain',
                source: 'user',
            },
        ];
        const seededEngine: SchemeEngineAdapter = {
            ...engine,
            getScheme: () => seededProfile,
            process: vi.fn(
                (input: string, opts?: { assertions?: Assertion[] }) => {
                    const assertions = opts?.assertions ?? initialAssertions;
                    return {
                        assertions: [...assertions],
                        rendered: 'S:F',
                        valid: true,
                    };
                },
            ),
        } as unknown as SchemeEngineAdapter;

        const flow = new DecisionFlow();
        const seedContainer = document.createElement('div');
        seedContainer.setAttribute(
            'data-ezclassify-decisionflow-categories',
            '["scope","impact"]',
        );
        document.body.appendChild(seedContainer);

        await flow.init(seedContainer, toCtx(seededEngine), {
            initialValue: 'S:F',
        });
        await enterFlow(seedContainer);

        // Should land on last step (scope filled, impact optional = passable), not stuck on impact
        const label = seedContainer.querySelector(
            '.ez-decision-flow__question-label',
        );
        expect(label?.textContent).toContain('Impact');
    });
});

describe('DecisionFlow: multi-select steps', () => {
    let container: HTMLDivElement;
    let mixedEngine: SchemeEngineAdapter;
    let flow: DecisionFlow;

    beforeEach(async () => {
        container = document.createElement('div');
        // Explicit category order: level (single), caveat (multi)
        container.setAttribute(
            'data-ezclassify-decisionflow-categories',
            '["level","caveat"]',
        );
        document.body.appendChild(container);
        mixedEngine = createMixedEngine();
        flow = new DecisionFlow();
        await flow.init(container, toCtx(mixedEngine));
        await enterFlow(container);
    });

    it('asks a single-choice step for its options without its own choice, and a multiple-choice step beside every choice', async () => {
        flow.setAssertions([
            {
                conceptId: 'LEVEL_A',
                categoryId: 'level',
                confidence: 'certain',
                source: 'user',
            },
            {
                conceptId: 'CAVEAT_X',
                categoryId: 'caveat',
                confidence: 'certain',
                source: 'user',
            },
        ]);
        // The level step lists what the caveats allow in place of LEVEL_A,
        // not only LEVEL_A; the caveat step is asked with LEVEL_A and
        // CAVEAT_X both held, so a caveat that conflicts with one stays out.
        await vi.waitFor(() =>
            expect(mixedEngine.process).toHaveBeenCalledWith(
                '',
                expect.objectContaining({
                    suggestFor: ['level'],
                    assertions: expect.arrayContaining([
                        expect.objectContaining({ conceptId: 'CAVEAT_X' }),
                    ]),
                }),
            ),
        );
        const asked = (mixedEngine.process as any).mock.calls.flatMap(
            ([, options]: [string, { suggestFor?: string[] }]) =>
                options?.suggestFor ?? [],
        );
        expect(asked).not.toContain('caveat');
        expect(mixedEngine.suggest).toHaveBeenCalledWith(
            expect.arrayContaining([
                expect.objectContaining({ conceptId: 'LEVEL_A' }),
                expect.objectContaining({ conceptId: 'CAVEAT_X' }),
            ]),
            expect.anything(),
        );
    });

    it('renders a checkbox group for multi-select categories', async () => {
        // Advance past the required level step by selecting one option first
        const levelOpts = container.querySelectorAll<HTMLButtonElement>(
            '.ez-decision-flow__option',
        );
        levelOpts[0].click();
        // Wait for reprocess (sync engine so immediate)
        const nextBtn = container.querySelectorAll<HTMLButtonElement>(
            '.ez-decision-flow__nav-btn',
        )[1];
        nextBtn.click();

        const optionsEl = container.querySelector<HTMLElement>(
            '.ez-decision-flow__options',
        );
        expect(optionsEl?.getAttribute('role')).toBe('group');
        const options = container.querySelectorAll('[role="checkbox"]');
        expect(options.length).toBe(3); // CAVEAT_X, CAVEAT_Y, CAVEAT_Z
    });

    it('multi-select: clicking an option adds the assertion without replacing others', async () => {
        // Go to caveat step
        container
            .querySelectorAll<HTMLButtonElement>('.ez-decision-flow__option')[0]
            .click();
        container
            .querySelectorAll<HTMLButtonElement>(
                '.ez-decision-flow__nav-btn',
            )[1]
            .click();

        const options =
            container.querySelectorAll<HTMLButtonElement>('[role="checkbox"]');
        options[0].click(); // CAVEAT_X
        expect(
            flow.getAssertions().some((a) => a.conceptId === 'CAVEAT_X'),
        ).toBe(true);

        options[1].click(); // CAVEAT_Y, must ADD, not replace CAVEAT_X
        expect(
            flow.getAssertions().some((a) => a.conceptId === 'CAVEAT_X'),
        ).toBe(true);
        expect(
            flow.getAssertions().some((a) => a.conceptId === 'CAVEAT_Y'),
        ).toBe(true);
    });

    it('multi-select: clicking a selected option removes it (toggle off)', async () => {
        // Go to caveat step
        container
            .querySelectorAll<HTMLButtonElement>('.ez-decision-flow__option')[0]
            .click();
        container
            .querySelectorAll<HTMLButtonElement>(
                '.ez-decision-flow__nav-btn',
            )[1]
            .click();

        // First click: add CAVEAT_X
        container
            .querySelectorAll<HTMLButtonElement>('[role="checkbox"]')[0]
            .click();
        expect(
            flow.getAssertions().some((a) => a.conceptId === 'CAVEAT_X'),
        ).toBe(true);

        // Re-query after DOM rebuild, the option now renders with aria-checked="true"
        // and the click closure captures isChecked=true, so clicking removes it.
        container
            .querySelectorAll<HTMLButtonElement>('[role="checkbox"]')[0]
            .click();
        expect(
            flow.getAssertions().some((a) => a.conceptId === 'CAVEAT_X'),
        ).toBe(false);
    });

    it('multi-select: options reflect aria-checked correctly after toggle', async () => {
        container
            .querySelectorAll<HTMLButtonElement>('.ez-decision-flow__option')[0]
            .click();
        container
            .querySelectorAll<HTMLButtonElement>(
                '.ez-decision-flow__nav-btn',
            )[1]
            .click();

        const options = Array.from(
            container.querySelectorAll<HTMLButtonElement>('[role="checkbox"]'),
        );
        expect(options[0].getAttribute('aria-checked')).toBe('false');
        options[0].click(); // select CAVEAT_X
        // After re-render, re-query
        const optionsAfter = Array.from(
            container.querySelectorAll<HTMLButtonElement>('[role="checkbox"]'),
        );
        expect(optionsAfter[0].getAttribute('aria-checked')).toBe('true');
        expect(optionsAfter[1].getAttribute('aria-checked')).toBe('false');
    });

    it('multi-select: an optional step with no selection does not block the flow', async () => {
        // Level is required, Next should be disabled before any selection
        const nextBeforeLevel = container.querySelectorAll<HTMLButtonElement>(
            '.ez-decision-flow__nav-btn',
        )[1];
        expect(nextBeforeLevel.disabled).toBe(true);

        // Select level: the flow moves on to caveat (optional multi-select)
        container
            .querySelectorAll<HTMLButtonElement>('.ez-decision-flow__option')[0]
            .click();
        await settle();

        // Caveat is the last step: Next ends there, and the step reads as
        // optional and unset, never as missing an answer.
        expect(
            container.querySelector('.ez-decision-flow__question-label')
                ?.textContent,
        ).toContain('Caveat');
        const dot = container.querySelector<HTMLElement>(
            '.ez-decision-flow__step-dot[data-category-id="caveat"]',
        );
        expect(dot?.dataset.state).toBe('optional');
        expect(flow.getAssertions().length).toBe(1);
    });

    it("a multi-select step's dot names every selected concept as the marking writes it", async () => {
        container
            .querySelectorAll<HTMLButtonElement>('.ez-decision-flow__option')[0]
            .click();
        await settle();

        const options =
            container.querySelectorAll<HTMLButtonElement>('[role="checkbox"]');
        options[0].click(); // CAVEAT_X
        options[2].click(); // CAVEAT_Z

        const dot = container.querySelector<HTMLElement>(
            '.ez-decision-flow__step-dot[data-category-id="caveat"]',
        );
        expect(dot?.dataset.state).toBe('answered');
        // Each as the marking writes it, the way its option reads.
        expect(dot?.getAttribute('aria-label')).toContain('Caveat: CX, CZ');
    });

    it('hint text "Select all that apply." appears only for multi-select steps', async () => {
        // On the level step (single): no hint
        expect(
            container.querySelector('.ez-decision-flow__question-desc'),
        ).toBeNull();

        // Advance to caveat step
        container
            .querySelectorAll<HTMLButtonElement>('.ez-decision-flow__option')[0]
            .click();
        container
            .querySelectorAll<HTMLButtonElement>(
                '.ez-decision-flow__nav-btn',
            )[1]
            .click();

        const hint = container.querySelector(
            '.ez-decision-flow__question-desc',
        );
        expect(hint?.textContent).toBe('Select all that apply.');
    });
});

// ──────────────────────────────────────────────────────────────────────────────
// text_input steps
// ──────────────────────────────────────────────────────────────────────────────

function createTextInputProfile(): SchemePublicView {
    const concepts: ConceptView[] = [
        {
            id: 'LEVEL_A',
            name: 'Level A',
            views: { default: 'T:A' },
            categories: ['level'],
            parents: [],
            aliases: [],
            position: 1,
        },
        {
            id: 'LABEL_TEXT',
            name: 'Labeled By',
            views: { default: '{value}' },
            categories: ['label'],
            parents: [],
            aliases: [],
            position: 1,
            textInput: {
                pattern: '',
                placeholder: 'Name or initials',
                label: 'Labeled By',
                required: false,
            },
        },
    ] as ConceptView[];

    const categories: CategoryView[] = [
        {
            id: 'level',
            label: 'Level',
            single: true,
            required: true,
        } as CategoryView,
        {
            id: 'label',
            label: 'Label',
            single: true,
            required: false,
        } as CategoryView,
    ];

    return {
        name: 'TextInput Profile',
        categories,
        concepts,
        formats: [
            {
                id: 'default',
                categoryOrder: ['level', 'label'],
                separator: '//',
                categorySeparator: '//',
                view: 'default',
            },
        ],
        scopes: [],
        defaultRenderFormat: 'default',
    } as unknown as SchemePublicView;
}

function createTextInputEngine(): SchemeEngineAdapter {
    const p = createTextInputProfile();
    return withSuggestFor({
        getScheme: () => p,
        getSchemeMeta: () => ({
            id: 'ti-test',
            version: '1.0',
            name: 'TextInput Profile',
            defaultRenderFormat: 'default',
            formats: [
                mockRenderFormat({
                    id: 'default',
                    view: 'default',
                    categorySeparator: '//',
                    separator: '//',
                    categoryOrder: ['level', 'label'],
                }),
            ],
            scopes: [],
        }),
        listCategories: () => p.categories,
        getConceptsInCategory: (catId: string) =>
            p.concepts.filter((c: any) => c.categories?.includes(catId)),
        render: vi.fn((assertions: Assertion[]) => ({
            rendered: assertions
                .map((a) => {
                    const c = p.concepts.find((x) => x.id === a.conceptId);
                    const view = c?.views?.['default'] ?? a.conceptId;
                    return view === '{value}' ? (a.value ?? '') : view;
                })
                .join('//'),
            assessment: {
                emitted: [],
                omitted: [],
                collapsed: [],
                conflicts: [],
                unrepresentable: [],
            },
        })),
        process: vi.fn(
            (_input: string, opts?: { assertions?: Assertion[] }) => {
                const assertions = opts?.assertions ?? [];
                const rendered = assertions
                    .map((a) => {
                        const c = p.concepts.find((x) => x.id === a.conceptId);
                        const view = c?.views?.['default'] ?? a.conceptId;
                        return view === '{value}' ? (a.value ?? '') : view;
                    })
                    .filter(Boolean)
                    .join('//');
                return { assertions: [...assertions], rendered, valid: true };
            },
        ),
        suggest: vi.fn().mockReturnValue({
            suggestions: p.concepts.map((c) => ({
                conceptId: c.id,
                categoryId: c.categories[0],
                label: c.views?.default ?? c.name,
                name: c.name,
                group: c.categories[0],
            })),
        }),
        describeConcept: (conceptId: string) => ({ lines: [conceptId] }),
    } as unknown as SchemeEngineAdapter);
}

describe('DecisionFlow: text_input steps', () => {
    let container: HTMLDivElement;
    let tiEngine: SchemeEngineAdapter;
    let flow: DecisionFlow;

    beforeEach(async () => {
        container = document.createElement('div');
        container.setAttribute(
            'data-ezclassify-decisionflow-categories',
            '["level","label"]',
        );
        document.body.appendChild(container);
        tiEngine = createTextInputEngine();
        flow = new DecisionFlow();
        await flow.init(container, toCtx(tiEngine));
        await enterFlow(container);
    });

    afterEach(() => {
        flow.destroy();
        container.remove();
    });

    /** Answer the level step and move on to the value step. */
    const toValueStep = () => {
        container
            .querySelectorAll<HTMLButtonElement>('.ez-decision-flow__option')[0]
            .click();
        container
            .querySelectorAll<HTMLButtonElement>(
                '.ez-decision-flow__nav-btn',
            )[1]
            .click();
    };
    const valueField = () =>
        container.querySelector<HTMLInputElement>(
            '.ez-decision-flow__text-field',
        )!;
    const formatLine = () =>
        container.querySelector<HTMLElement>('.ez-decision-flow__text-hint')!;

    it('shows the expected form once, in the empty box, with the field label as its name', () => {
        toValueStep();
        const field = valueField();
        expect(field.tagName).toBe('INPUT');
        expect(field.placeholder).toBe('Name or initials');
        expect(formatLine().hidden).toBe(true);
        expect(field.getAttribute('aria-describedby')).toBe(
            `${field.id}-error`,
        );
        expect(field.getAttribute('aria-label')).toBe('Labeled By');
        // One value concept: the box is the whole step, with no second label.
        expect(
            container.querySelector('.ez-decision-flow__value-name'),
        ).toBeNull();
    });

    it('shows the expected form as a line under a box too narrow for it, and drops it once typed', () => {
        // The box has 40px for text; the form needs 200px.
        const room = vi
            .spyOn(HTMLElement.prototype, 'clientWidth', 'get')
            .mockReturnValue(40);
        const measure = vi
            .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
            .mockImplementation(function (this: HTMLElement) {
                const width = this.tagName === 'SPAN' ? 200 : 0;
                return { width, height: 0, top: 0, left: 0 } as DOMRect;
            });
        try {
            toValueStep();
            expect(valueField().hasAttribute('placeholder')).toBe(false);
            expect(formatLine().hidden).toBe(false);
            expect(formatLine().textContent).toBe('Name or initials');
            expect(valueField().getAttribute('aria-describedby')).toBe(
                `${formatLine().id} ${valueField().id}-error`,
            );

            valueField().value = 'Smith';
            valueField().dispatchEvent(new Event('input'));
            expect(formatLine().hidden).toBe(true);
            expect(valueField().hasAttribute('placeholder')).toBe(false);
        } finally {
            room.mockRestore();
            measure.mockRestore();
        }
    });

    it("shows a stored date in the spelling its scope's output writes", async () => {
        const dated = createTextInputEngine();
        const label = (dated.getScheme() as SchemePublicView).concepts.find(
            (concept) => concept.id === 'LABEL_TEXT',
        )!;
        (label.textInput as Record<string, unknown>).encoding = {
            type: 'calendar-date',
            canonical: 'YYYY-MM-DD',
            accepts: ['YYYYMMDD', 'YYYY-MM-DD'],
            views: { default: 'YYYYMMDD' },
        };
        const host = document.createElement('div');
        host.setAttribute(
            'data-ezclassify-decisionflow-categories',
            '["level","label"]',
        );
        document.body.appendChild(host);
        const datedFlow = new DecisionFlow();
        await datedFlow.init(host, toCtx(dated));
        datedFlow.setAssertions([
            {
                conceptId: 'LEVEL_A',
                categoryId: 'level',
                confidence: 'certain',
                source: 'user',
            },
            {
                conceptId: 'LABEL_TEXT',
                categoryId: 'label',
                value: '2048-12-31',
                confidence: 'certain',
                source: 'user',
            },
        ] as Assertion[]);
        await settle();
        await enterFlow(host);
        host.querySelectorAll<HTMLButtonElement>(
            '.ez-decision-flow__step-dot',
        )[1].click();
        expect(
            host.querySelector<HTMLInputElement>(
                '.ez-decision-flow__text-field',
            )?.value,
        ).toBe('20481231');
        datedFlow.destroy();
        host.remove();
    });

    it('typing a value commits an assertion with that value', () => {
        container
            .querySelectorAll<HTMLButtonElement>('.ez-decision-flow__option')[0]
            .click();
        container
            .querySelectorAll<HTMLButtonElement>(
                '.ez-decision-flow__nav-btn',
            )[1]
            .click();

        const textField = container.querySelector<HTMLInputElement>(
            '.ez-decision-flow__text-field',
        )!;
        textField.value = 'Smith, J.';
        textField.dispatchEvent(new Event('input'));

        const assertions = flow.getAssertions();
        const labelAssertion = assertions.find((a) => a.categoryId === 'label');
        expect(labelAssertion).toBeDefined();
        expect(labelAssertion?.conceptId).toBe('LABEL_TEXT');
        expect(labelAssertion?.value).toBe('Smith, J.');
    });

    it('clearing the value removes the assertion', () => {
        container
            .querySelectorAll<HTMLButtonElement>('.ez-decision-flow__option')[0]
            .click();
        container
            .querySelectorAll<HTMLButtonElement>(
                '.ez-decision-flow__nav-btn',
            )[1]
            .click();

        // Type a value first
        container.querySelector<HTMLInputElement>(
            '.ez-decision-flow__text-field',
        )!.value = 'Jones';
        container
            .querySelector<HTMLInputElement>('.ez-decision-flow__text-field')!
            .dispatchEvent(new Event('input'));
        expect(flow.getAssertions().some((a) => a.categoryId === 'label')).toBe(
            true,
        );

        // Clear it
        container.querySelector<HTMLInputElement>(
            '.ez-decision-flow__text-field',
        )!.value = '';
        container
            .querySelector<HTMLInputElement>('.ez-decision-flow__text-field')!
            .dispatchEvent(new Event('input'));
        expect(flow.getAssertions().some((a) => a.categoryId === 'label')).toBe(
            false,
        );
    });

    it('an optional value step left empty does not block the flow', async () => {
        container
            .querySelectorAll<HTMLButtonElement>('.ez-decision-flow__option')[0]
            .click();
        await settle();

        // On the label step with no value typed: it reads as optional, and
        // the marking holds the level alone.
        expect(
            container.querySelector('.ez-decision-flow__text-field'),
        ).not.toBeNull();
        const dot = container.querySelector<HTMLElement>(
            '.ez-decision-flow__step-dot[aria-current="step"]',
        );
        expect(dot?.dataset.state).toBe('optional');
    });

    it('keeps the text caret when editing inside an existing value', () => {
        container
            .querySelector<HTMLButtonElement>('.ez-decision-flow__option')!
            .click();
        container
            .querySelectorAll<HTMLButtonElement>(
                '.ez-decision-flow__nav-btn',
            )[1]
            .click();
        const input = container.querySelector<HTMLInputElement>(
            '.ez-decision-flow__text-field',
        )!;
        input.focus();
        input.value = 'Smith';
        input.setSelectionRange(2, 2);
        input.dispatchEvent(new Event('input'));
        const after = container.querySelector<HTMLInputElement>(
            '.ez-decision-flow__text-field',
        )!;
        expect(after.value).toBe('Smith');
        expect(after.selectionStart).toBe(2);
        expect(after.selectionEnd).toBe(2);
        expect(document.activeElement).toBe(after);
    });

    it("a value step's dot shows the typed value", async () => {
        container
            .querySelectorAll<HTMLButtonElement>('.ez-decision-flow__option')[0]
            .click();
        await settle();

        container.querySelector<HTMLInputElement>(
            '.ez-decision-flow__text-field',
        )!.value = 'Smith, J.';
        container
            .querySelector<HTMLInputElement>('.ez-decision-flow__text-field')!
            .dispatchEvent(new Event('input'));

        // A step of typed values names each by its choice, then its value.
        const dot = container.querySelector<HTMLElement>(
            '.ez-decision-flow__step-dot[aria-current="step"]',
        );
        expect(dot?.getAttribute('aria-label')).toBe(
            'Step 2 of 2, Labeled By: Smith, J.',
        );
    });

    it('text_input step does not show "Select all that apply." hint', () => {
        container
            .querySelectorAll<HTMLButtonElement>('.ez-decision-flow__option')[0]
            .click();
        container
            .querySelectorAll<HTMLButtonElement>(
                '.ez-decision-flow__nav-btn',
            )[1]
            .click();

        const hint = container.querySelector(
            '.ez-decision-flow__question-desc',
        );
        expect(hint).toBeNull();
    });

    it('rendered marking includes the typed value', () => {
        container
            .querySelectorAll<HTMLButtonElement>('.ez-decision-flow__option')[0]
            .click();
        container
            .querySelectorAll<HTMLButtonElement>(
                '.ez-decision-flow__nav-btn',
            )[1]
            .click();

        container.querySelector<HTMLInputElement>(
            '.ez-decision-flow__text-field',
        )!.value = 'Smith, J.';
        container
            .querySelector<HTMLInputElement>('.ez-decision-flow__text-field')!
            .dispatchEvent(new Event('input'));

        expect(flow.getRendered()).toContain('Smith, J.');
    });
});

// ──────────────────────────────────────────────────────────────────────────────
// Owned-category reveal / hide
// ──────────────────────────────────────────────────────────────────────────────

describe('DecisionFlow: headed-category reveal', () => {
    let container: HTMLDivElement;
    let flow: DecisionFlow;

    beforeEach(async () => {
        container = document.createElement('div');
        // Explicit order covers all three categories including the owned one
        container.setAttribute(
            'data-ezclassify-decisionflow-categories',
            '["level","sharing","recipients"]',
        );
        document.body.appendChild(container);
        flow = new DecisionFlow();
        await flow.init(container, toCtx(createOwnedCategoryEngine()));
        await enterFlow(container);
    });

    afterEach(() => {
        flow.destroy();
        container.remove();
    });

    it('owned category step is absent until header concept is selected', () => {
        // At mount: no header concept selected, so recipients step must not appear
        const dots = container.querySelectorAll('.ez-decision-flow__step-dot');
        // Only level + sharing visible (2 dots); recipients is hidden
        expect(dots.length).toBe(2);
    });

    it('selecting header concept reveals the owned step immediately after the owning category', () => {
        // Select level (required)
        container
            .querySelectorAll<HTMLButtonElement>('.ez-decision-flow__option')[0]
            .click();
        // Advance to sharing step
        container
            .querySelectorAll<HTMLButtonElement>(
                '.ez-decision-flow__nav-btn',
            )[1]
            .click();

        // Before selecting SHARE_ALLOWED: only 2 steps
        expect(
            container.querySelectorAll('.ez-decision-flow__step-dot').length,
        ).toBe(2);

        // Select SHARE_ALLOWED in sharing
        const options = container.querySelectorAll<HTMLButtonElement>(
            '.ez-decision-flow__option',
        );
        const shareOption = Array.from(options).find(
            (b) => b.textContent === 'SHARE',
        );
        expect(shareOption).toBeDefined();
        shareOption!.click();

        // Recipients step must now be visible, 3 dots total
        expect(
            container.querySelectorAll('.ez-decision-flow__step-dot').length,
        ).toBe(3);
    });

    it('deselecting header concept hides the owned step and removes orphaned assertions', () => {
        // Select level, advance to sharing, pick SHARE_ALLOWED
        container
            .querySelectorAll<HTMLButtonElement>('.ez-decision-flow__option')[0]
            .click();
        container
            .querySelectorAll<HTMLButtonElement>(
                '.ez-decision-flow__nav-btn',
            )[1]
            .click();
        Array.from(
            container.querySelectorAll<HTMLButtonElement>(
                '.ez-decision-flow__option',
            ),
        )
            .find((b) => b.textContent === 'SHARE')!
            .click();

        // Advance to recipients step and select GROUP_A
        container
            .querySelectorAll<HTMLButtonElement>(
                '.ez-decision-flow__nav-btn',
            )[1]
            .click();
        container
            .querySelectorAll<HTMLButtonElement>('.ez-decision-flow__option')[0]
            .click();
        expect(
            flow.getAssertions().some((a) => a.categoryId === 'recipients'),
        ).toBe(true);

        // Go back and switch to NO_SHARING, should hide recipients step + drop assertions
        container
            .querySelectorAll<HTMLButtonElement>(
                '.ez-decision-flow__nav-btn',
            )[0]
            .click(); // Back
        const noSharingOption = Array.from(
            container.querySelectorAll<HTMLButtonElement>(
                '.ez-decision-flow__option',
            ),
        ).find((b) => b.textContent === 'NONE')!;
        noSharingOption.click();

        // Recipients step hidden again
        expect(
            container.querySelectorAll('.ez-decision-flow__step-dot').length,
        ).toBe(2);
        // Orphaned recipients assertions removed
        expect(
            flow.getAssertions().some((a) => a.categoryId === 'recipients'),
        ).toBe(false);
    });

    it('owned step appears right after the owning category in the step order', () => {
        // Select level, advance to sharing, pick SHARE_ALLOWED
        container
            .querySelectorAll<HTMLButtonElement>('.ez-decision-flow__option')[0]
            .click();
        container
            .querySelectorAll<HTMLButtonElement>(
                '.ez-decision-flow__nav-btn',
            )[1]
            .click();
        Array.from(
            container.querySelectorAll<HTMLButtonElement>(
                '.ez-decision-flow__option',
            ),
        )
            .find((b) => b.textContent === 'SHARE')!
            .click();

        // Advance to next step, must be recipients, not some other category
        container
            .querySelectorAll<HTMLButtonElement>(
                '.ez-decision-flow__nav-btn',
            )[1]
            .click();
        const label = container.querySelector(
            '.ez-decision-flow__question-label',
        );
        expect(label?.textContent).toContain('Recipients');
    });

    it('an optional owned step reads as optional, never as missing an answer', async () => {
        container
            .querySelectorAll<HTMLButtonElement>('.ez-decision-flow__option')[0]
            .click();
        await settle();
        Array.from(
            container.querySelectorAll<HTMLButtonElement>(
                '.ez-decision-flow__option',
            ),
        )
            .find((b) => b.textContent === 'SHARE')!
            .click();
        await settle();

        // The choice moved the flow on to recipients: optional and unset.
        expect(
            container.querySelector('.ez-decision-flow__question-label')
                ?.textContent,
        ).toContain('Recipients');
        const dot = container.querySelector<HTMLElement>(
            '.ez-decision-flow__step-dot[aria-current="step"]',
        );
        expect(dot?.dataset.state).toBe('optional');
    });

    it('gives a hidden owned step no dot', () => {
        // Select level only, recipients step hidden, so it has no dot.
        container
            .querySelectorAll<HTMLButtonElement>('.ez-decision-flow__option')[0]
            .click();

        const dots = Array.from(
            container.querySelectorAll<HTMLElement>(
                '.ez-decision-flow__step-dot',
            ),
        );
        // Only level + sharing dots (2), no recipients dot
        expect(dots.length).toBe(2);
        expect(
            dots.some((dot) =>
                (dot.getAttribute('aria-label') ?? '')
                    .toLowerCase()
                    .includes('recipient'),
            ),
        ).toBe(false);
    });
});

// ─── Scope filtering ────────────────────────────────────────────────────────

/** Profile with 'marking' and 'admin' scopes, defaultScope='marking'. */
function createScopedProfile(): SchemePublicView {
    const concepts: ConceptView[] = [
        {
            id: 'LEVEL_A',
            name: 'Level A',
            views: { default: 'T:A' },
            categories: ['level'],
            parents: [],
            aliases: [],
            position: 1,
        },
        {
            id: 'LEVEL_B',
            name: 'Level B',
            views: { default: 'T:B' },
            categories: ['level'],
            parents: [],
            aliases: [],
            position: 2,
        },
        {
            id: 'ADM_X',
            name: 'Admin X',
            views: { default: 'AX' },
            categories: ['admin_cat'],
            parents: [],
            aliases: [],
            position: 1,
        },
    ] as ConceptView[];

    // level: no scopes (visible in all scopes)
    // admin_cat: scopes: ['admin'] (only visible in admin scope)
    const categories = [
        {
            id: 'level',
            label: 'Level',
            single: true,
            required: true,
        } as CategoryView,
        {
            id: 'admin_cat',
            label: 'Admin Category',
            single: true,
            required: false,
            scopes: ['admin'],
        } as unknown as CategoryView,
    ];

    return {
        name: 'Scoped Profile',
        categories,
        concepts,
        formats: [
            {
                id: 'default',
                categoryOrder: ['level', 'admin_cat'],
                separator: '/',
                categorySeparator: '/',
                view: 'default',
            },
        ],
        scopes: [
            { id: 'marking', label: 'Marking' },
            { id: 'admin', label: 'Admin' },
        ],
        defaultScope: 'marking',
        defaultRenderFormat: 'default',
    } as unknown as SchemePublicView;
}

function createScopedEngine(): SchemeEngineAdapter {
    const p = createScopedProfile();
    return withSuggestFor({
        getScheme: () => p,
        getSchemeMeta: () => ({
            id: 'scoped',
            version: '1.0',
            name: 'Scoped Profile',
            defaultRenderFormat: 'default',
            defaultScope: 'marking',
            formats: [
                mockRenderFormat({
                    id: 'default',
                    view: 'default',
                    categorySeparator: '/',
                    separator: '/',
                    categoryOrder: ['level', 'admin_cat'],
                }),
            ],
            scopes: [
                { id: 'marking', label: 'Marking' },
                { id: 'admin', label: 'Admin' },
            ],
        }),
        listCategories: () => p.categories,
        getConceptsInCategory: (catId: string) =>
            p.concepts.filter((c: any) => c.categories?.includes(catId)),
        render: vi.fn((assertions: Assertion[]) => ({
            rendered: assertions
                .map((a) => {
                    const c = p.concepts.find((x) => x.id === a.conceptId);
                    return c?.views?.['default'] ?? a.conceptId;
                })
                .join('/'),
            assessment: {
                emitted: [],
                omitted: [],
                collapsed: [],
                conflicts: [],
                unrepresentable: [],
            },
        })),
        process: vi.fn(
            (_input: string, opts?: { assertions?: Assertion[] }) => {
                const assertions = opts?.assertions ?? [];
                return {
                    assertions: [...assertions],
                    rendered: assertions.map((a) => a.conceptId).join('/'),
                    valid: true,
                };
            },
        ),
        suggest: vi.fn().mockReturnValue({
            suggestions: p.concepts.map((c) => ({
                conceptId: c.id,
                categoryId: c.categories[0],
                label: c.views?.default ?? c.name,
                name: c.name,
                group: c.categories[0],
            })),
        }),
        describeConcept: (conceptId: string) => ({ lines: [conceptId] }),
    } as unknown as SchemeEngineAdapter);
}

describe('DecisionFlow: scope filtering', () => {
    let container: HTMLDivElement;

    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
    });

    it('hides categories scoped to a non-active scope when using scheme defaultScope', async () => {
        const engine = createScopedEngine();
        const flow = new DecisionFlow();
        await flow.init(container, toCtx(engine));
        await enterFlow(container);

        // With defaultScope='marking', the 'admin_cat' category (scopes:['admin']) must be absent
        const dots = container.querySelectorAll('.ez-decision-flow__step-dot');
        expect(dots.length).toBe(1);

        const label = container.querySelector(
            '.ez-decision-flow__question-label',
        );
        expect(label?.textContent).toContain('Level');
        expect(label?.textContent).not.toContain('Admin');
    });

    it('walks only the scope it names', async () => {
        const engine = createScopedEngine();
        const flow = new DecisionFlow();
        // 'level' declares no scope, so it belongs to the default scope.
        await flow.init(container, toCtx(engine), { scope: 'admin' });
        await enterFlow(container);

        expect(
            container.querySelectorAll('.ez-decision-flow__step-dot').length,
        ).toBe(1);
        expect(
            container.querySelector('.ez-decision-flow__question-label')
                ?.textContent,
        ).toBe('1 of 1 \u00b7 Admin Category');
    });

    it('walks every scope a space-separated list names, labeling each step', async () => {
        const engine = createScopedEngine();
        const flow = new DecisionFlow();
        await flow.init(container, toCtx(engine), { scope: 'admin marking' });
        await enterFlow(container);

        const dots = container.querySelectorAll('.ez-decision-flow__step-dot');
        expect(dots.length).toBe(2);
        // Declaration order, not the order the list was written in: the dots
        // group by scope, each group named, and each scope's value is
        // captioned with its name.
        expect(
            [...container.querySelectorAll('.ez-decision-flow__dot-group')].map(
                (group) => group.getAttribute('aria-label'),
            ),
        ).toEqual(['Marking', 'Admin']);
        expect(
            [
                ...container.querySelectorAll('.ez-decision-flow__scope-name'),
            ].map((name) => name.textContent),
        ).toEqual(['Marking', 'Admin']);
        // The open step's scope reads as current on its caption.
        expect(
            container.querySelector(
                '.ez-decision-flow__scope-caption[aria-current]',
            )?.textContent,
        ).toBe('Marking');
        // The title heads the open step, under the dots.
        expect(
            container.querySelector(
                '.ez-decision-flow__step .ez-decision-flow__question-label',
            )?.textContent,
        ).toBe('1 of 2 \u00b7 Level');
        expect(
            container.querySelector(
                '.ez-decision-flow__header .ez-decision-flow__question-label',
            ),
        ).toBeNull();
        // Every engine call names the surface of the step it is for.
        const surfaces = (engine.suggest as any).mock.calls.map(
            ([, options]: [unknown, { surface?: string }]) => options.surface,
        );
        expect(new Set(surfaces)).toEqual(new Set(['marking', 'admin']));
    });

    it('judges a committed store state on its own scope, not the store surface', async () => {
        const engine = createScopedEngine();
        (engine.process as any).mockImplementation(
            (
                _input: string,
                opts?: { assertions?: Assertion[]; surface?: string },
            ) => ({
                assertions: [...(opts?.assertions ?? [])],
                rendered: (opts?.assertions ?? [])
                    .map((a) => a.conceptId)
                    .join('/'),
                valid: false,
                errors: [
                    {
                        constraintId: 'surface',
                        message: `Judged on ${opts?.surface ?? 'the whole marking'}`,
                    },
                ],
            }),
        );
        const flow = new DecisionFlow();
        await flow.init(container, toCtx(engine), { scope: 'admin' });
        flow.applyStoreState({
            rendered: 'AX',
            renders: {},
            assertions: [
                {
                    conceptId: 'ADM_X',
                    categoryId: 'admin_cat',
                    confidence: 'certain',
                    source: 'user',
                },
            ],
            valid: false,
            errors: [{ constraintId: 'store', message: 'The store says so' }],
        });
        await vi.waitFor(() =>
            expect(
                Array.from(
                    document.querySelectorAll('.ez-validation-errors__message'),
                ).map((el) => el.textContent),
            ).toEqual(['Judged on admin']),
        );
        flow.destroy();
    });

    it('shows all categories when the scheme has no defaultScope', async () => {
        // Same profile but with defaultScope removed, all categories should appear
        const engineNoDefault = createScopedEngine() as any;
        const meta = engineNoDefault.getSchemeMeta();
        engineNoDefault.getSchemeMeta = () => ({
            ...meta,
            defaultScope: undefined,
        });

        const flow = new DecisionFlow();
        await flow.init(container, toCtx(engineNoDefault));
        await enterFlow(container);

        // No scope filter → both categories shown
        const dots = container.querySelectorAll('.ez-decision-flow__step-dot');
        expect(dots.length).toBe(2);
    });

    it('reads the category list harvested from its host', async () => {
        // The runtime mounts the flow in a container beside its host, so the
        // list arrives as the harvested option, not as an attribute on the
        // container or one of its ancestors.
        const engine = createScopedEngine();
        const flow = new DecisionFlow();
        await flow.init(container, toCtx(engine), {
            categories: 'admin_cat, level',
        } as never);
        await enterFlow(container);

        expect(
            Array.from(
                container.querySelectorAll<HTMLElement>(
                    '.ez-decision-flow__step-dot',
                ),
            ).map((dot) => dot.dataset.categoryId),
        ).toEqual(['level', 'admin_cat']);
    });

    it('explicit categoryOrder attribute bypasses scope filtering', async () => {
        container.setAttribute(
            'data-ezclassify-decisionflow-categories',
            '["admin_cat"]',
        );
        const engine = createScopedEngine();
        const flow = new DecisionFlow();
        // Even with defaultScope='marking', an explicit categoryOrder overrides scope filtering
        await flow.init(container, toCtx(engine));
        await enterFlow(container);

        const dots = container.querySelectorAll('.ez-decision-flow__step-dot');
        expect(dots.length).toBe(1);
        const label = container.querySelector(
            '.ez-decision-flow__question-label',
        );
        expect(label?.textContent).toContain('Admin');
    });
});

/** Let the engine's answers and the moves they trigger land. */
async function settle(): Promise<void> {
    for (let i = 0; i < 4; i++)
        await new Promise((resolve) => setTimeout(resolve, 0));
}

async function enterFlow(host: HTMLElement): Promise<void> {
    host.querySelector<HTMLElement>(
        '.ez-decision-flow__option, .ez-decision-flow__text-field',
    )?.focus();
    await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('DecisionFlow options at rest', () => {
    it('asks the engine for its options at mount and after a change from elsewhere, not on a repaint', async () => {
        const host = document.createElement('div');
        document.body.appendChild(host);
        const engine = createMockEngine();
        const flow = new DecisionFlow();
        try {
            await flow.init(host, toCtx(engine));
            // The dots at rest are the steps the engine offers.
            await vi.waitFor(() =>
                expect(engine.suggest).toHaveBeenCalledTimes(1),
            );
            (flow as any).render();
            await Promise.resolve();
            expect(engine.suggest).toHaveBeenCalledTimes(1);
            flow.setAssertions([
                {
                    conceptId: 'IMPACT_LOW',
                    categoryId: 'impact',
                    confidence: 'certain',
                    source: 'user',
                },
            ]);
            await vi.waitFor(() =>
                expect(engine.suggest).toHaveBeenCalledTimes(2),
            );
        } finally {
            flow.destroy();
            host.remove();
        }
    });
});

/** The options a step offers, leaving out those shown only as unavailable. */
const available = (host: HTMLElement) =>
    host.querySelectorAll('[aria-pressed]:not([aria-disabled="true"])');

it.each(['pointerup', 'pointercancel'])(
    'settles deferred options after %s ends a press outside the flow',
    async (eventType) => {
        const host = document.createElement('div');
        const outside = document.createElement('button');
        document.body.append(host, outside);
        const engine = createMockEngine();
        let resolve!: (x: any) => void;
        (engine.suggest as any).mockReturnValue(
            new Promise((r) => {
                resolve = r;
            }),
        );
        const flow = new DecisionFlow();
        await flow.init(host, toCtx(engine));
        const option = host.querySelector<HTMLButtonElement>('[aria-pressed]')!;
        option.dispatchEvent(new Event('pointerdown', { bubbles: true }));
        option.focus();
        resolve({
            suggestions: [
                {
                    conceptId: 'SCOPE_NONE',
                    categoryId: 'scope',
                    label: 'None',
                    name: 'None',
                    group: 'Scope',
                },
            ],
        });
        await new Promise((r) => setTimeout(r, 0));
        // The press is still down: the options it may land on stay as they were.
        expect(available(host)).toHaveLength(3);
        outside.dispatchEvent(new Event(eventType, { bubbles: true }));
        outside.focus();
        option.focus();
        await new Promise((r) => setTimeout(r, 30));
        try {
            expect(available(host)).toHaveLength(1);
        } finally {
            flow.destroy();
            host.remove();
            outside.remove();
        }
    },
);

it('waits for engine availability before accepting the first choice', async () => {
    const host = document.createElement('div');
    document.body.append(host);
    const engine = createMockEngine();
    let resolve!: (value: unknown) => void;
    (engine.suggest as any).mockReturnValue(
        new Promise((r) => {
            resolve = r;
        }),
    );
    const flow = new DecisionFlow();
    try {
        await flow.init(host, toCtx(engine));
        host.querySelector<HTMLButtonElement>(
            '[data-concept-id="SCOPE_FULL"]',
        )!.click();
        expect(flow.getAssertions()).toEqual([]);
        resolve({
            suggestions: [
                {
                    conceptId: 'SCOPE_NONE',
                    categoryId: 'scope',
                    label: 'None',
                    name: 'None',
                    group: 'Scope',
                },
            ],
        });
        await vi.waitFor(() => expect(available(host)).toHaveLength(1));
        expect(flow.getAssertions()).toEqual([]);
        host.querySelector<HTMLButtonElement>(
            '[data-concept-id="SCOPE_NONE"]',
        )!.click();
        expect(flow.getAssertions().map((a) => a.conceptId)).toEqual([
            'SCOPE_NONE',
        ]);
    } finally {
        flow.destroy();
        host.remove();
    }
});

it('an external replacement supersedes a pending initial pick', async () => {
    const host = document.createElement('div');
    document.body.append(host);
    const engine = createMockEngine();
    let resolve!: (value: any) => void;
    (engine.suggest as any).mockReturnValue(
        new Promise((r) => {
            resolve = r;
        }),
    );
    const flow = new DecisionFlow();
    try {
        await flow.init(host, toCtx(engine));
        host.querySelector<HTMLButtonElement>(
            '[data-concept-id="SCOPE_FULL"]',
        )!.click();
        flow.setAssertions([
            {
                conceptId: 'SCOPE_PARTIAL',
                categoryId: 'scope',
                source: 'user',
                confidence: 'certain',
            },
        ]);
        expect(flow.getAssertions().map((a) => a.conceptId)).toEqual([
            'SCOPE_PARTIAL',
        ]);
        resolve({
            suggestions: ['SCOPE_NONE', 'SCOPE_PARTIAL', 'SCOPE_FULL'].map(
                (conceptId) => ({
                    conceptId,
                    categoryId: 'scope',
                    label: conceptId,
                    name: conceptId,
                    group: 'scope',
                }),
            ),
        });
        await new Promise((r) => setTimeout(r, 30));
        expect(flow.getAssertions().map((a) => a.conceptId)).toEqual([
            'SCOPE_PARTIAL',
        ]);
    } finally {
        flow.destroy();
        host.remove();
    }
});

it('a first choice waits for live offerings after base has arrived', async () => {
    const host = document.createElement('div');
    document.body.append(host);
    const engine = createMockEngine();
    let resolve!: (value: any) => void;
    const live = new Promise((r) => {
        resolve = r;
    });
    (engine.suggest as any).mockImplementation((a: any[]) =>
        a.length ? live : { suggestions: [] },
    );
    const flow = new DecisionFlow();
    try {
        await flow.init(host, toCtx(engine));
        flow.setAssertions([
            {
                conceptId: 'SCOPE_PARTIAL',
                categoryId: 'scope',
                source: 'user',
                confidence: 'certain',
            },
        ]);
        const full = host.querySelector<HTMLButtonElement>(
            '[data-concept-id="SCOPE_FULL"]',
        )!;
        full.focus();
        await vi.waitFor(() => expect(engine.suggest).toHaveBeenCalledTimes(2));
        full.click();
        resolve({
            suggestions: ['SCOPE_NONE', 'SCOPE_PARTIAL', 'SCOPE_FULL'].map(
                (conceptId) => ({
                    conceptId,
                    categoryId: 'scope',
                    label: conceptId,
                    name: conceptId,
                    group: 'scope',
                }),
            ),
        });
        await new Promise((r) => setTimeout(r, 30));
        expect(flow.getAssertions().map((a) => a.conceptId)).toEqual([
            'SCOPE_FULL',
        ]);
    } finally {
        flow.destroy();
        host.remove();
    }
});

it('retains the first text edit and its caret while availability is loading', async () => {
    const host = document.createElement('div');
    document.body.append(host);
    const engine = createTextInputEngine();
    let resolve!: (value: unknown) => void;
    (engine.suggest as any).mockReturnValue(
        new Promise((r) => {
            resolve = r;
        }),
    );
    const flow = new DecisionFlow();
    try {
        await flow.init(host, toCtx(engine), {
            categoryOrder: ['label'],
        } as any);
        const input = host.querySelector<HTMLInputElement>(
            '.ez-decision-flow__text-field',
        )!;
        input.focus();
        input.value = 'Smith';
        input.setSelectionRange(2, 2);
        input.dispatchEvent(new Event('input'));
        resolve({
            suggestions: [
                {
                    conceptId: 'LABEL_TEXT',
                    categoryId: 'label',
                    label: 'Label',
                    name: 'Label',
                    group: 'Label',
                },
            ],
        });
        await vi.waitFor(() =>
            expect(flow.getAssertions()[0]?.value).toBe('Smith'),
        );
        const after = host.querySelector<HTMLInputElement>(
            '.ez-decision-flow__text-field',
        )!;
        expect(after.selectionStart).toBe(2);
        expect(document.activeElement).toBe(after);
    } finally {
        flow.destroy();
        host.remove();
    }
});

describe('DecisionFlow: compact layout', () => {
    let container: HTMLDivElement;
    let flow: DecisionFlow;

    beforeEach(() => {
        document.body.innerHTML = '';
        container = document.createElement('div');
        container.setAttribute(
            'data-ezclassify-decisionflow-categories',
            '["scope","impact"]',
        );
        document.body.appendChild(container);
        flow = new DecisionFlow();
    });

    const dots = () => [
        ...container.querySelectorAll<HTMLButtonElement>(
            '.ez-decision-flow__step-dot',
        ),
    ];
    const step = () =>
        container.querySelector<HTMLElement>('.ez-decision-flow__step')!;
    const title = () =>
        container.querySelector('.ez-decision-flow__question-label')
            ?.textContent;
    const touch = (target: HTMLElement) => {
        target.dispatchEvent(
            Object.assign(new Event('pointerdown', { bubbles: true }), {
                pointerType: 'touch',
            }),
        );
        target.click();
    };

    it('sits in the suite frame with the status mark and clear in its header row', async () => {
        await flow.init(container, toCtx(createMockEngine()));
        const frame = container.querySelector('.ez-decision-flow')!;
        expect(frame.classList.contains('ez-field-frame')).toBe(true);
        const header = frame.querySelector('.ez-decision-flow__header')!;
        expect(header.querySelector('.ez-status-mark')).not.toBeNull();
        expect(header.querySelector('.ez-clear-button')).not.toBeNull();
        // No summary of every category: the dots and the scope lines say it.
        expect(
            container.querySelector('.ez-decision-flow__summary'),
        ).toBeNull();
    });

    it("a press on a dot closes the status mark's list; a press on the mark keeps it its own", async () => {
        await flow.init(container, toCtx(createMockEngine()));
        const mark = container.querySelector<HTMLElement>('.ez-status-mark')!;
        setStatusMarkFixes(mark.parentElement!, [
            {
                ruleId: 'r1',
                action: 'add',
                add: [{ conceptId: 'SCOPE_NONE', categoryId: 'scope' }],
                message: 'Rule "r1": added "SCOPE_NONE"',
            },
        ]);
        const tip = () => document.querySelector<HTMLElement>('.ez-tooltip');
        touch(mark);
        expect(tip()?.hidden).toBe(false);
        expect(mark.getAttribute('aria-expanded')).toBe('true');

        touch(dots()[0]);
        expect(tip()?.hidden).toBe(true);
        expect(mark.getAttribute('aria-expanded')).toBe('false');

        // The mark's own press opens it again and a second one closes it.
        touch(mark);
        expect(tip()?.hidden).toBe(false);
        touch(mark);
        expect(tip()?.hidden).toBe(true);
        flow.destroy();
    });

    it('is collapsed at rest, opens on focus and closes when focus leaves', async () => {
        const outside = document.createElement('button');
        document.body.appendChild(outside);
        await flow.init(container, toCtx(createMockEngine()));
        expect(step().hidden).toBe(true);
        dots()[0].focus();
        expect(step().hidden).toBe(false);
        outside.focus();
        expect(step().hidden).toBe(true);
    });

    it('at rest is one line: the dots, its marking and what is wrong with it, then the chrome', async () => {
        await flow.init(container, toCtx(createMockEngine()), {
            initialValue: 'S:P',
        } as never);
        await settle();
        flow.updateValidationErrors([
            { constraintId: 'required', message: 'Impact is required' },
        ]);
        const frame = container.querySelector('.ez-decision-flow')!;
        const header = frame.querySelector('.ez-decision-flow__header')!;
        // The header holds the value, after the dots and before the chrome.
        const value = header.querySelector<HTMLElement>(
            '.ez-decision-flow__rest .ez-decision-flow__value',
        )!;
        expect(
            value.querySelector('.ez-decision-flow__value-text')?.textContent,
        ).not.toBe('not set');
        expect(
            header.querySelector(
                '.ez-decision-flow__rest .ez-decision-flow__problems',
            )?.textContent,
        ).toContain('Impact is required');
        expect(
            header.querySelector('.ez-decision-flow__dot-group-label'),
        ).toBeNull();
        const order = [
            header.querySelector('.ez-decision-flow__progress')!,
            value,
            header.querySelector('.ez-status-mark')!,
        ];
        for (let i = 1; i < order.length; i++)
            expect(
                order[i - 1].compareDocumentPosition(order[i]) &
                    Node.DOCUMENT_POSITION_FOLLOWING,
            ).toBeTruthy();
        expect(step().hidden).toBe(true);
        expect(frame.hasAttribute('data-open')).toBe(false);
        const before = header.innerHTML;

        // Opening adds the step under the header and leaves the header as
        // it was: the value stays where it was.
        dots()[0].focus();
        expect(frame.hasAttribute('data-open')).toBe(true);
        expect(title()).toMatch(/^\d of 2 · /);
        expect(
            header.querySelector(
                '.ez-decision-flow__rest .ez-decision-flow__value',
            ),
        ).not.toBeNull();
        expect(
            header.querySelectorAll('.ez-decision-flow__value'),
        ).toHaveLength(1);
        const settled = (html: string) =>
            html.replace(
                / (tabindex="-?\d"|data-previewing=""|data-current=""|aria-current="step")/g,
                '',
            );
        // Focus moves the dots' tab stop, previews a dot and rings the open
        // step's dot; nothing else in the header changes.
        expect(settled(header.innerHTML)).toBe(settled(before));
    });

    it('shows its marking whole, breaking only after a separator and at its own line ends', async () => {
        await flow.init(container, toCtx(createMockEngine()), {
            initialValue: 'TOP SECRET//SI/TK//REL TO USA, AUS\nSecond line',
        } as never);
        await settle();
        const text = container.querySelector<HTMLElement>(
            '.ez-decision-flow__rest .ez-decision-flow__value-text',
        )!;
        expect(text.innerHTML).toBe(
            'TOP SECRET//<wbr>SI/<wbr>TK//<wbr>REL TO USA, AUS<br>Second line',
        );
    });

    it('says "not set" on its value when nothing is answered', async () => {
        await flow.init(container, toCtx(createMockEngine()));
        const text = container.querySelector<HTMLElement>(
            '.ez-decision-flow__rest .ez-decision-flow__value-text',
        )!;
        expect(text.textContent).toBe('not set');
        expect(text.hasAttribute('data-empty')).toBe(true);
    });

    it('says under its value which steps are missing, never as a list under the flow, each a way to its step', async () => {
        await flow.init(container, toCtx(createMockEngine()));
        flow.updateValidationErrors([
            {
                constraintId: 'required',
                message: 'Impact is required',
                categoryId: 'impact',
            },
        ]);
        const list = () =>
            document.querySelector<HTMLElement>('.ez-validation-errors');
        expect(list()?.hidden ?? true).toBe(true);
        const problems = container.querySelector<HTMLElement>(
            '.ez-decision-flow__rest .ez-decision-flow__problems',
        )!;
        // In words, with no bare count.
        expect(problems.textContent).toBe('Missing: Impact');
        expect(
            container.querySelector('.ez-decision-flow__value-errors'),
        ).toBeNull();
        const go = problems.querySelector<HTMLButtonElement>(
            '.ez-decision-flow__missing-step',
        )!;
        // Focus alone, as a press gives it, does not open the flow and
        // rebuild the line out from under the press.
        go.focus();
        expect(step().hidden).toBe(true);
        go.click();
        expect(step().hidden).toBe(false);
        expect(title()).toBe('2 of 2 · Impact');
    });

    it('shows no line under its value while nothing is wrong', async () => {
        await flow.init(container, toCtx(createMockEngine()));
        flow.updateValidationErrors([]);
        expect(
            container.querySelector('.ez-decision-flow__problems'),
        ).toBeNull();
    });

    it("reads each option as the field writes it, with the concept's name as its tooltip and description", async () => {
        await flow.init(container, toCtx(createMockEngine()));
        await enterFlow(container);
        const partial = container.querySelector<HTMLButtonElement>(
            '.ez-decision-flow__option[data-concept-id="SCOPE_PARTIAL"]',
        )!;
        expect(partial.textContent).toBe('S:P');
        expect(partial.title).toBe('Partial');
        expect(
            document.getElementById(partial.getAttribute('aria-describedby')!)
                ?.textContent,
        ).toBe('Partial.');
    });

    it('shows an option the current choices rule out in its place, unavailable, with the reason, and never takes it', async () => {
        const engine = createMockEngine();
        // The engine offers only None beside the marking, and says why Full
        // is out when asked about it.
        (engine.suggest as any).mockReturnValue({
            suggestions: [
                {
                    conceptId: 'SCOPE_NONE',
                    categoryId: 'scope',
                    label: 'S:N',
                    name: 'None',
                    group: 'scope',
                },
            ],
        });
        const process = engine.process as any;
        const plain = process.getMockImplementation();
        process.mockImplementation(
            (input: string, opts?: { assertions?: Assertion[] }) => {
                const answer = plain(input, opts);
                return opts?.assertions?.some(
                    (a) => a.conceptId === 'SCOPE_FULL',
                )
                    ? {
                          ...answer,
                          errors: [
                              {
                                  constraintId: 'full-needs-impact',
                                  message: 'Full scope needs a high impact.',
                                  affectedConcepts: ['SCOPE_FULL'],
                              },
                          ],
                      }
                    : answer;
            },
        );
        await flow.init(container, toCtx(engine));
        await enterFlow(container);
        await settle();
        const full = container.querySelector<HTMLButtonElement>(
            '.ez-decision-flow__option[data-concept-id="SCOPE_FULL"]',
        )!;
        expect(full.getAttribute('aria-disabled')).toBe('true');
        const reason = () =>
            container.querySelector<HTMLElement>(
                '.ez-decision-flow__option-reason',
            )!;
        expect(reason().hidden).toBe(true);
        full.dispatchEvent(
            Object.assign(new Event('pointerenter'), { pointerType: 'mouse' }),
        );
        await vi.waitFor(() =>
            expect(reason().textContent).toBe(
                'S:F is not available: Full scope needs a high impact.',
            ),
        );
        expect(reason().hidden).toBe(false);
        expect(reason().getAttribute('role')).toBe('status');
        full.click();
        await settle();
        expect(flow.getAssertions().map((a) => a.conceptId)).not.toContain(
            'SCOPE_FULL',
        );
        container
            .querySelector<HTMLButtonElement>(
                '.ez-decision-flow__option[data-concept-id="SCOPE_FULL"]',
            )!
            .dispatchEvent(
                Object.assign(new Event('pointerleave'), {
                    pointerType: 'mouse',
                }),
            );
        expect(reason().hidden).toBe(true);
    });

    it('rings the current dot only while a step is open', async () => {
        await flow.init(container, toCtx(createMockEngine()));
        const ringed = () =>
            dots().filter((dot) => dot.hasAttribute('data-current'));
        expect(ringed()).toHaveLength(0);
        expect(dots().some((dot) => dot.hasAttribute('aria-current'))).toBe(
            false,
        );
        dots()[1].focus();
        expect(ringed()).toEqual([dots()[0]]);
        expect(dots()[0].getAttribute('aria-current')).toBe('step');
    });

    it("across scopes keeps one row of dots, and captions each scope's value under the step", async () => {
        const scoped = document.createElement('div');
        document.body.appendChild(scoped);
        await flow.init(scoped, toCtx(createScopedEngine()), {
            scope: 'marking admin',
        });
        await settle();
        const frame = scoped.querySelector('.ez-decision-flow')!;
        const header = frame.querySelector('.ez-decision-flow__header')!;
        // The row holds the dots, grouped by scope, and no scope's name.
        expect(
            [...header.querySelectorAll('.ez-decision-flow__dot-group')].map(
                (group) => group.getAttribute('aria-label'),
            ),
        ).toEqual(['Marking', 'Admin']);
        expect(header.textContent).not.toMatch(/Marking|Admin/);
        // The values follow the step: the header, the step, then the values.
        expect([...frame.children].map((child) => child.className)).toEqual([
            'ez-decision-flow__header',
            'ez-decision-flow__step',
            'ez-decision-flow__values',
            'ez-decision-flow__dot-preview',
        ]);
        const blocks = [
            ...frame.querySelectorAll<HTMLElement>('.ez-decision-flow__scope'),
        ];
        expect(blocks.map((block) => block.dataset.scope)).toEqual([
            'marking',
            'admin',
        ]);
        for (const block of blocks)
            expect([...block.children].map((child) => child.className)).toEqual(
                [
                    'ez-decision-flow__scope-caption',
                    'ez-decision-flow__value-wrap',
                ],
            );
        expect(
            blocks.map(
                (block) =>
                    block.querySelector('.ez-decision-flow__scope-name')
                        ?.textContent,
            ),
        ).toEqual(['Marking', 'Admin']);
        // At rest no caption reads as current.
        expect(
            frame.querySelector(
                '.ez-decision-flow__scope-caption[aria-current]',
            ),
        ).toBeNull();
        expect(frame.hasAttribute('data-open')).toBe(false);
    });

    it("names a dot's scope in its preview when the flow spans scopes", async () => {
        const scoped = document.createElement('div');
        document.body.appendChild(scoped);
        await flow.init(scoped, toCtx(createScopedEngine()), {
            scope: 'marking admin',
        });
        await settle();
        const adminDot = scoped.querySelector<HTMLElement>(
            '.ez-decision-flow__step-dot[data-category-id="admin_cat"]',
        )!;
        adminDot.dispatchEvent(
            Object.assign(new Event('pointerenter'), { pointerType: 'mouse' }),
        );
        expect(
            scoped.querySelector('.ez-decision-flow__dot-preview')?.textContent,
        ).toMatch(/^Admin · /);
    });

    it('jumps to a step from its dot and keeps the keyboard on the dots', async () => {
        await flow.init(container, toCtx(createMockEngine()));
        await enterFlow(container);
        expect(title()).toBe('1 of 2 · Scope');
        dots()[1].click();
        expect(title()).toBe('2 of 2 · Impact');
        expect(document.activeElement).toBe(dots()[1]);
        expect(dots()[1].getAttribute('aria-current')).toBe('step');
        expect(dots()[0].hasAttribute('aria-current')).toBe(false);
    });

    it('makes the dots one tab stop that the arrow keys move along', async () => {
        await flow.init(container, toCtx(createMockEngine()));
        await enterFlow(container);
        expect(dots().map((dot) => dot.tabIndex)).toEqual([0, -1]);
        dots()[0].focus();
        dots()[0].dispatchEvent(
            new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }),
        );
        expect(document.activeElement).toBe(dots()[1]);
        expect(dots().map((dot) => dot.tabIndex)).toEqual([-1, 0]);
        // Moving focus is not moving the flow: the step is still the first.
        expect(title()).toBe('1 of 2 · Scope');
        dots()[1].dispatchEvent(
            new KeyboardEvent('keydown', { key: 'Home', bubbles: true }),
        );
        expect(document.activeElement).toBe(dots()[0]);
    });

    it('previews a dot on hover with its category and selections, without moving the flow', async () => {
        await flow.init(container, toCtx(createMockEngine()), {
            initialValue: 'S:P',
        } as never);
        await enterFlow(container);
        dots()[0].dispatchEvent(
            Object.assign(new Event('pointerenter'), { pointerType: 'mouse' }),
        );
        const preview = container.querySelector<HTMLElement>(
            '.ez-decision-flow__dot-preview',
        )!;
        expect(preview.hidden).toBe(false);
        expect(preview.textContent).toBe('Scope: S:P');
        expect(dots()[0].hasAttribute('data-previewing')).toBe(true);
        dots()[0].dispatchEvent(
            Object.assign(new Event('pointerleave'), { pointerType: 'mouse' }),
        );
        expect(preview.hidden).toBe(true);
    });

    it('on touch, a first tap previews a dot and a second tap on it jumps', async () => {
        await flow.init(container, toCtx(createMockEngine()));
        await enterFlow(container);
        touch(dots()[1]);
        const preview = container.querySelector<HTMLElement>(
            '.ez-decision-flow__dot-preview',
        )!;
        expect(preview.hidden).toBe(false);
        expect(preview.textContent).toBe('Impact: optional, not set');
        expect(title()).toBe('1 of 2 · Scope');
        touch(dots()[1]);
        expect(title()).toBe('2 of 2 · Impact');
        // The jump puts the preview away.
        expect(preview.hidden).toBe(true);
        // A tap anywhere else puts a preview away.
        touch(dots()[0]);
        expect(preview.hidden).toBe(false);
        document.body.dispatchEvent(
            Object.assign(new Event('pointerdown', { bubbles: true }), {
                pointerType: 'touch',
            }),
        );
        expect(preview.hidden).toBe(true);
    });

    it('moves on to the next step once a single choice settles', async () => {
        await flow.init(container, toCtx(createMockEngine()));
        await enterFlow(container);
        container
            .querySelectorAll<HTMLButtonElement>('.ez-decision-flow__option')[1]
            .click();
        await settle();
        expect(title()).toBe('2 of 2 · Impact');
        expect(dots()[0].dataset.state).toBe('answered');
        // The last step has nowhere to go: a choice there stays put.
        container
            .querySelectorAll<HTMLButtonElement>('.ez-decision-flow__option')[0]
            .click();
        await settle();
        expect(title()).toBe('2 of 2 · Impact');
    });

    it('names its x for the whole marking, and clears every scope it walks from it without leaving the step', async () => {
        const scoped = document.createElement('div');
        document.body.appendChild(scoped);
        await flow.init(scoped, toCtx(createScopedEngine()), {
            scope: 'marking admin',
        });
        await enterFlow(scoped);
        const options = () =>
            scoped.querySelectorAll<HTMLButtonElement>(
                '.ez-decision-flow__option',
            );
        const stepTitle = () =>
            scoped.querySelector('.ez-decision-flow__question-label')
                ?.textContent;
        options()[0].click();
        await settle();
        options()[0].click();
        await settle();
        expect(stepTitle()).toMatch(/^2 of 2 /);
        expect(
            flow
                .getAssertions()
                .map((a) => a.categoryId)
                .sort(),
        ).toEqual(['admin_cat', 'level']);
        const clear =
            scoped.querySelector<HTMLButtonElement>('.ez-clear-button')!;
        expect(clear.getAttribute('aria-label')).toBe(
            'Clear the whole marking',
        );
        expect(clear.title).toBe('Clear the whole marking');

        clear.click();
        await vi.waitFor(() => expect(flow.getAssertions()).toEqual([]));
        // Both scopes are empty, the x is the undo of that clear, and the
        // flow is still on the step the author was on.
        expect(
            [
                ...scoped.querySelectorAll(
                    '.ez-decision-flow__scope .ez-decision-flow__value-text',
                ),
            ].map((value) => value.textContent),
        ).toEqual(['not set', 'not set']);
        expect(clear.getAttribute('aria-label')).toBe('Undo clear');
        expect(stepTitle()).toMatch(/^2 of 2 /);

        clear.click();
        await vi.waitFor(() => expect(flow.getAssertions()).toHaveLength(2));
        expect(stepTitle()).toMatch(/^2 of 2 /);
        expect(clear.getAttribute('aria-label')).toBe(
            'Clear the whole marking',
        );
    });

    it("un-chooses a single choice pressed again, and stays on its step with the other steps' answers kept", async () => {
        await flow.init(container, toCtx(createMockEngine()));
        await enterFlow(container);
        const option = (id: string) =>
            container.querySelector<HTMLButtonElement>(
                `.ez-decision-flow__option[data-concept-id="${id}"]`,
            )!;
        option('SCOPE_PARTIAL').click();
        await settle();
        option('IMPACT_LOW').click();
        await settle();
        dots()[0].click();
        await settle();
        expect(title()).toBe('1 of 2 · Scope');
        expect(option('SCOPE_PARTIAL').getAttribute('aria-pressed')).toBe(
            'true',
        );

        option('SCOPE_PARTIAL').click();
        await settle();
        expect(
            flow.getAssertions().map((a) => [a.categoryId, a.conceptId]),
        ).toEqual([['impact', 'IMPACT_LOW']]);
        expect(
            [
                ...container.querySelectorAll<HTMLButtonElement>(
                    '.ez-decision-flow__option',
                ),
            ].map((o) => o.getAttribute('aria-pressed')),
        ).toEqual(['false', 'false', 'false']);
        // It stays on the step, and says nothing more than the state.
        expect(title()).toBe('1 of 2 · Scope');
        expect(dots()[0].dataset.state).toBe('optional');
        expect(dots()[1].dataset.state).toBe('answered');
        expect(
            container.querySelector('.ez-decision-flow__question-desc'),
        ).toBeNull();
        // No control clears one step.
        expect(container.querySelectorAll('.ez-clear-button')).toHaveLength(1);
    });

    it("lets a required step's choice go, and then names the step under Missing", async () => {
        const outside = document.createElement('button');
        document.body.appendChild(outside);
        const engine = createScopedEngine();
        (engine.process as any).mockImplementation(
            (_input: string, opts?: { assertions?: Assertion[] }) => {
                const assertions = [...(opts?.assertions ?? [])];
                const missing = !assertions.some(
                    (a) => a.categoryId === 'level',
                );
                return {
                    assertions,
                    rendered: assertions.map((a) => a.conceptId).join('/'),
                    valid: !missing,
                    errors: missing
                        ? [
                              {
                                  constraintId: 'required',
                                  categoryId: 'level',
                                  message: 'Level is required',
                              },
                          ]
                        : [],
                };
            },
        );
        const host = document.createElement('div');
        document.body.appendChild(host);
        await flow.init(host, toCtx(engine), { scope: 'marking admin' });
        await enterFlow(host);
        const option = (id: string) =>
            host.querySelector<HTMLButtonElement>(
                `.ez-decision-flow__option[data-concept-id="${id}"]`,
            )!;
        const levelA = () => option('LEVEL_A');
        levelA().click();
        await settle();
        option('ADM_X').click();
        await settle();
        host.querySelector<HTMLElement>(
            '.ez-decision-flow__step-dot[data-category-id="level"]',
        )!.click();
        await settle();
        expect(levelA().getAttribute('aria-pressed')).toBe('true');

        levelA().click();
        await settle();
        expect(flow.getAssertions().map((a) => a.conceptId)).toEqual(['ADM_X']);
        expect(levelA().getAttribute('aria-pressed')).toBe('false');
        outside.focus();
        await vi.waitFor(() =>
            expect(
                host.querySelector('.ez-decision-flow__problems')?.textContent,
            ).toBe('Missing: Level'),
        );
    });

    it('holds a required step back as required while open, and shows it missing once passed or at rest', async () => {
        const outside = document.createElement('button');
        document.body.appendChild(outside);
        const engine = createMockEngine();
        const profile = engine.getScheme() as SchemePublicView;
        (profile.categories[1] as { required?: boolean }).required = true;
        await flow.init(container, toCtx(engine));
        await enterFlow(container);
        flow.updateValidationErrors([
            {
                constraintId: 'required',
                categoryId: 'impact',
                message: 'Impact is required',
            } as never,
        ]);
        // Open on step 1: step 2 is not reached, so it is required, not an
        // error, and its message is held back.
        expect(dots()[1].dataset.state).toBe('unset');
        expect(dots()[1].getAttribute('aria-label')).toContain(
            'Impact: required, not set',
        );
        expect(
            container.querySelector('.ez-decision-flow__problems'),
        ).toBeNull();
        // An optional unset step is never missing.
        expect(dots()[0].dataset.state).toBe('optional');

        // At rest everything missing shows.
        outside.focus();
        expect(dots()[1].dataset.state).toBe('missing');
        expect(dots()[1].getAttribute('aria-label')).toContain(
            'Impact: needs an answer',
        );
        expect(
            container.querySelector('.ez-decision-flow__problems')?.textContent,
        ).toBe('Missing: Impact');
    });

    it('names a step the engine asks for as required, whatever its category says', async () => {
        await flow.init(container, toCtx(createMockEngine()));
        // Neither category is required, but a rule asks for one of Impact's
        // choices, naming the concepts and no category.
        const impact = (createMockEngine().getScheme() as SchemePublicView)
            .categories[1].id;
        const choices = (
            createMockEngine().getScheme() as SchemePublicView
        ).concepts
            .filter((concept) => concept.categories.includes(impact))
            .map((concept) => concept.id);
        flow.updateValidationErrors([
            {
                constraintId: 'rule',
                message: 'Impact is needed for this scope',
                affectedConcepts: choices,
            } as never,
        ]);
        expect(dots()[1].getAttribute('aria-label')).not.toContain('optional');
        expect(dots()[1].dataset.state).toBe('missing');
        expect(dots()[0].getAttribute('aria-label')).toContain('optional');
    });

    it('stays open when a press on a dot rebuilds the dots before its click reaches the page', async () => {
        await flow.init(container, toCtx(createMockEngine()));
        await enterFlow(container);
        dots()[1].click();
        expect(step().hidden).toBe(false);
        expect(title()).toBe('2 of 2 · Impact');
    });

    it('goes to rest on a press anywhere else, errors and all', async () => {
        const outside = document.createElement('div');
        document.body.appendChild(outside);
        await flow.init(container, toCtx(createMockEngine()));
        await enterFlow(container);
        flow.updateValidationErrors([
            { constraintId: 'required', message: 'Impact is required' },
        ]);
        expect(step().hidden).toBe(false);
        // The press lands first: nothing moves under it until its click, even
        // as focus leaves the flow.
        const target = document.createElement('button');
        outside.appendChild(target);
        target.dispatchEvent(new Event('pointerdown', { bubbles: true }));
        target.focus();
        expect(step().hidden).toBe(false);
        target.click();
        expect(step().hidden).toBe(true);
        expect(
            container.querySelector('.ez-decision-flow__problems')?.textContent,
        ).toContain('Impact is required');
    });

    it('advances a multi-choice step on Enter and toggles it on a press', async () => {
        const mixed = document.createElement('div');
        document.body.appendChild(mixed);
        await flow.init(mixed, toCtx(createMixedEngine()));
        await enterFlow(mixed);
        mixed
            .querySelectorAll<HTMLButtonElement>('.ez-decision-flow__option')[0]
            .click();
        await settle();
        const label = () =>
            mixed.querySelector('.ez-decision-flow__question-label')
                ?.textContent;
        expect(label()).toContain('Caveat');
        const box =
            mixed.querySelector<HTMLButtonElement>('[role="checkbox"]')!;
        box.click();
        expect(
            mixed
                .querySelector('[role="checkbox"]')
                ?.getAttribute('aria-checked'),
        ).toBe('true');
        // On the last step Enter has nowhere to go and toggles nothing.
        mixed
            .querySelector<HTMLButtonElement>('[role="checkbox"]')!
            .dispatchEvent(
                new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
            );
        expect(
            mixed
                .querySelector('[role="checkbox"]')
                ?.getAttribute('aria-checked'),
        ).toBe('true');
        expect(label()).toContain('Caveat');
    });

    it('writes each scope its value, under its name, with the errors judged on that scope', async () => {
        const engine = createScopedEngine();
        (engine.process as any).mockImplementation(
            (
                _input: string,
                opts?: { assertions?: Assertion[]; surface?: string },
            ) => ({
                assertions: [...(opts?.assertions ?? [])],
                rendered: (opts?.assertions ?? [])
                    .map((a) => a.conceptId)
                    .join('/'),
                valid: false,
                // The engine reports an error of the marking on both scopes,
                // and one of its own on the admin scope.
                errors: [
                    { constraintId: 'shared', message: 'Shared rule broken' },
                    ...(opts?.surface === 'admin'
                        ? [
                              {
                                  constraintId: 'admin-rule',
                                  message: 'Admin needs a value',
                              },
                          ]
                        : []),
                ],
            }),
        );
        const scoped = document.createElement('div');
        document.body.appendChild(scoped);
        await flow.init(scoped, toCtx(engine), { scope: 'marking admin' });
        await enterFlow(scoped);
        scoped
            .querySelectorAll<HTMLButtonElement>('.ez-decision-flow__option')[0]
            .click();
        await vi.waitFor(() =>
            expect(
                scoped.querySelector(
                    '.ez-decision-flow__scope[data-scope="admin"] .ez-decision-flow__problem',
                )?.textContent,
            ).toBe('Admin needs a value'),
        );
        const rows = [
            ...scoped.querySelectorAll<HTMLElement>('.ez-decision-flow__scope'),
        ];
        expect(
            rows.map(
                (row) =>
                    row.querySelector('.ez-decision-flow__scope-name')
                        ?.textContent,
            ),
        ).toEqual(['Marking', 'Admin']);
        // Each value says its own scope's errors, and an error both scopes
        // report shows once, under the first of them.
        expect(
            rows.map((row) =>
                [...row.querySelectorAll('.ez-decision-flow__problem')].map(
                    (line) => line.textContent,
                ),
            ),
        ).toEqual([['Shared rule broken'], ['Admin needs a value']]);
        // The admin scope's required step reads as missing on its dot.
        await vi.waitFor(() =>
            expect(
                scoped.querySelector<HTMLElement>(
                    '.ez-decision-flow__step-dot[data-category-id="admin_cat"]',
                )?.dataset.state,
            ).toMatch(/missing|optional/),
        );
    });
});

/**
 * On a touch screen the dots fit one line beside the status mark and clear
 * whenever they can: each dot a 24px square target with its disc inside, the
 * targets edge to edge within a scope, a narrower gap between scopes. When they
 * still do not fit, the row breaks only between scopes and a scope that wraps
 * starts at the row's edge. The stylesheet is read from disk: the `?inline` CSS
 * import is empty under test.
 */
describe('DecisionFlow dots on a touch screen', () => {
    const css = readFileSync(
        join(dirname(fileURLToPath(import.meta.url)), 'decision-flow.css'),
        'utf8',
    );
    /** The body of the first rule for `selector` in `text`. */
    const rule = (text: string, selector: string): string => {
        const at = text.indexOf(`${selector} {`);
        expect(at, selector).toBeGreaterThanOrEqual(0);
        return text.slice(at, text.indexOf('}', at));
    };
    const coarse = css.slice(
        css.indexOf('@media (pointer: coarse)'),
        css.indexOf('@media (prefers-reduced-motion'),
    );
    const rem = (body: string, property: string): number => {
        const value = new RegExp(`${property}:\\s*([\\d.]+)rem`).exec(body);
        expect(value, property).not.toBeNull();
        return Number(value![1]);
    };

    it('gives each dot a 24px square target, edge to edge with the next', () => {
        const flow = rule(coarse, '.ez-decision-flow');
        const dot = rule(coarse, '.ez-decision-flow__step-dot');
        expect(rem(flow, '--ez-decision-flow-dot-width') * 16).toBe(24);
        expect(rem(dot, 'height') * 16).toBe(24);
        expect(
            rule(css, '.ez-decision-flow__step-dot').includes(
                'width: var(--ez-decision-flow-dot-width)',
            ),
        ).toBe(true);
        expect(rule(css, '.ez-decision-flow__dot-group')).toMatch(/gap: 0;/);
    });

    it('keeps 8 to 12px between scopes, as a gap that a wrapped scope does not carry', () => {
        const gap = rem(
            rule(coarse, '.ez-decision-flow'),
            '--ez-decision-flow-scope-gap',
        );
        expect(gap * 16).toBeGreaterThanOrEqual(8);
        expect(gap * 16).toBeLessThanOrEqual(12);
        expect(
            rule(
                css,
                '.ez-decision-flow__progress:has(> .ez-decision-flow__dot-group)',
            ),
        ).toMatch(/column-gap: var\(--ez-decision-flow-scope-gap\)/);
        // A margin would indent a scope that wraps to the next line.
        expect(css).not.toMatch(
            /\.ez-decision-flow__dot-group \+ \.ez-decision-flow__dot-group/,
        );
    });

    it('wraps only between scopes, never inside one', () => {
        expect(rule(css, '.ez-decision-flow__progress')).toMatch(
            /flex-wrap: wrap/,
        );
        expect(rule(css, '.ez-decision-flow__dot-group')).toMatch(
            /flex-wrap: nowrap/,
        );
    });
});

it("holds back the open step's required message while its chosen value is still being typed, and says it at rest", async () => {
    const engine = createTextInputEngine();
    const profile = engine.getScheme() as SchemePublicView;
    // The label step offers a plain choice beside the value-taking one, and
    // wants an answer.
    (profile.categories[1] as { required?: boolean }).required = true;
    profile.concepts.push({
        id: 'LABEL_NONE',
        name: 'Unlabeled',
        views: { default: 'UNLABELED' },
        categories: ['label'],
        parents: [],
        aliases: [],
        position: 2,
    } as ConceptView);
    (engine.suggest as any).mockReturnValue({
        suggestions: profile.concepts.map((c) => ({
            conceptId: c.id,
            categoryId: c.categories[0],
            label: c.views?.default ?? c.name,
            name: c.name,
            group: c.categories[0],
        })),
    });
    const host = document.createElement('div');
    host.setAttribute(
        'data-ezclassify-decisionflow-categories',
        '["level","label"]',
    );
    const outside = document.createElement('button');
    document.body.append(host, outside);
    const flow = new DecisionFlow();
    try {
        await flow.init(host, toCtx(engine));
        await enterFlow(host);
        host.querySelectorAll<HTMLButtonElement>(
            '.ez-decision-flow__option',
        )[0].click();
        host.querySelectorAll<HTMLButtonElement>(
            '.ez-decision-flow__nav-btn',
        )[1].click();
        host.querySelector<HTMLButtonElement>(
            '.ez-decision-flow__option[data-concept-id="LABEL_TEXT"]',
        )!.click();
        // Chosen, the value option is the box the value is typed in.
        expect(
            host.querySelector('.ez-decision-flow__value-option input'),
        ).not.toBeNull();
        flow.updateValidationErrors([
            {
                constraintId: 'required',
                categoryId: 'label',
                message: 'Label is required',
            } as never,
        ]);
        const problems = () =>
            host.querySelector('.ez-decision-flow__problems')?.textContent ??
            '';
        expect(problems()).not.toContain('Label is required');
        outside.focus();
        expect(problems()).toContain('Label is required');
    } finally {
        flow.destroy();
        host.remove();
        outside.remove();
    }
});

/**
 * A scheme whose line writes a control short on a whole marking and shorter on
 * a part, and whose notice block writes its handling as a sentence, the way a
 * banner, a portion mark and an authority block divide one marking.
 */
function createLabelProfile(): SchemePublicView {
    const concepts = [
        {
            id: 'KEEP',
            name: 'Keep Inside the Office',
            definition: 'Stays in the office.',
            views: {
                default: 'KO',
                short: 'KEEP',
                tiny: 'K',
                spelled: 'KEEP INSIDE THE OFFICE',
            },
            categories: ['control'],
            parents: [],
            aliases: [],
            position: 1,
        },
        {
            id: 'UNSPELLED',
            name: 'Never Spelled',
            views: {},
            categories: ['control'],
            parents: [],
            aliases: [],
            position: 2,
        },
        {
            id: 'SHRED',
            name: 'Shred',
            views: { default: 'SHRED', block: 'Shred this copy after use.' },
            categories: ['handling'],
            parents: [],
            aliases: [],
            position: 1,
        },
        {
            id: 'ON_DATE',
            name: 'On a Date',
            definition: 'Release on a date.',
            views: { default: '{value}', block: 'On {value}' },
            categories: ['handling'],
            parents: [],
            aliases: [],
            position: 2,
            textInput: { placeholder: 'YYYYMMDD' },
        },
    ] as unknown as ConceptView[];
    return {
        name: 'Label Profile',
        categories: [
            {
                id: 'control',
                label: 'Control',
                single: false,
                required: false,
            } as CategoryView,
            {
                id: 'handling',
                label: 'Handling',
                single: true,
                required: false,
                scopes: ['notice'],
            } as unknown as CategoryView,
        ],
        concepts,
        formats: [],
        scopes: [
            { id: 'line', label: 'Line' },
            { id: 'notice', label: 'Notice' },
        ],
        defaultScope: 'line',
        defaultRenderFormat: 'line/short',
    } as unknown as SchemePublicView;
}

function createLabelEngine(): SchemeEngineAdapter {
    const p = createLabelProfile();
    const output = (
        id: string,
        surface: string,
        view: string,
        defaultFor: string[],
        categoryOrder: string[],
    ) => ({
        ...mockRenderFormat({ id, surface, view, categoryOrder }),
        defaultFor,
    });
    return withSuggestFor({
        getScheme: () => p,
        getSchemeMeta: () => ({
            id: 'labels',
            version: '1.0',
            name: 'Label Profile',
            // As the engine projects a scheme with surfaces: the default
            // output is the default scope's whole default.
            defaultRenderFormat: 'line/short',
            defaultWholeRenderFormat: 'line/short',
            defaultPartRenderFormat: 'line/tiny',
            defaultScope: 'line',
            formats: [
                output('line/short', 'line', 'short', ['whole'], ['control']),
                output('line/tiny', 'line', 'tiny', ['part'], ['control']),
                output('line/spelled', 'line', 'spelled', [], ['control']),
                output(
                    'notice/block',
                    'notice',
                    'block',
                    ['whole', 'part'],
                    ['handling'],
                ),
            ],
            scopes: p.scopes,
        }),
        listCategories: () => p.categories,
        getConceptsInCategory: (catId: string) =>
            p.concepts.filter((c: any) => c.categories?.includes(catId)),
        render: vi.fn((assertions: Assertion[]) => ({
            rendered: assertions.map((a) => a.conceptId).join('/'),
            assessment: {
                emitted: [],
                omitted: [],
                collapsed: [],
                conflicts: [],
                unrepresentable: [],
            },
        })),
        process: vi.fn(
            (_input: string, opts?: { assertions?: Assertion[] }) => {
                const assertions = opts?.assertions ?? [];
                return {
                    assertions: [...assertions],
                    rendered: assertions.map((a) => a.conceptId).join('/'),
                    valid: true,
                };
            },
        ),
        suggest: vi.fn().mockReturnValue({
            suggestions: p.concepts.map((c) => ({
                conceptId: c.id,
                categoryId: c.categories[0],
                label: c.name,
                name: c.name,
                group: c.categories[0],
            })),
        }),
        describeConcept: (conceptId: string) => ({ lines: [conceptId] }),
    } as unknown as SchemeEngineAdapter);
}

describe('DecisionFlow option labels', () => {
    let container: HTMLDivElement;
    let flow: DecisionFlow;

    beforeEach(() => {
        document.body.innerHTML = '';
        container = document.createElement('div');
        document.body.appendChild(container);
        flow = new DecisionFlow();
    });

    const option = (conceptId: string) =>
        container.querySelector<HTMLButtonElement>(
            `.ez-decision-flow__option[data-concept-id="${conceptId}"]`,
        )!;
    const description = (btn: HTMLElement) =>
        document.getElementById(btn.getAttribute('aria-describedby')!)
            ?.textContent;
    const open = async (options: Record<string, unknown> = {}) => {
        await flow.init(container, toCtx(createLabelEngine()), {
            scopes: ['line', 'notice'],
            ...options,
        } as never);
        await enterFlow(container);
        await settle();
    };
    const jumpTo = async (categoryId: string) => {
        container
            .querySelector<HTMLElement>(
                `.ez-decision-flow__step-dot[data-category-id="${categoryId}"]`,
            )!
            .click();
        await settle();
    };

    it("reads a whole marking's option in the scope's whole default, its name and definition in the tooltip and description", async () => {
        await open();
        const keep = option('KEEP');
        expect(keep.textContent).toBe('KEEP');
        expect(keep.title).toBe('Keep Inside the Office\nStays in the office.');
        expect(description(keep)).toBe(
            'Keep Inside the Office. Stays in the office.',
        );
    });

    it("reads a part's option in the scope's part default", async () => {
        await open({ holdsPart: true });
        expect(option('KEEP').textContent).toBe('K');
    });

    it('reads an option in the output the field names for its scope', async () => {
        await open({ formatId: 'line/spelled' });
        expect(option('KEEP').textContent).toBe('KEEP INSIDE THE OFFICE');
    });

    it('reads an option the field writes nothing for by its name, never empty', async () => {
        await open();
        const unspelled = option('UNSPELLED');
        expect(unspelled.textContent).toBe('Never Spelled');
        // The name is the label, so the tooltip does not repeat it.
        expect(unspelled.hasAttribute('title')).toBe(false);
    });

    it("reads another scope's option as that scope writes it, a sentence included, and a value option by its name", async () => {
        await open();
        await jumpTo('handling');
        expect(option('SHRED').textContent).toBe('Shred this copy after use.');
        expect(option('SHRED').title).toBe('Shred');
        const onDate = option('ON_DATE');
        expect(onDate.textContent).toBe('On a Date');
        expect(onDate.title).toBe('Release on a date.');
    });

    it('names a choice on its dot and in the status mark the way its option reads', async () => {
        await open();
        option('KEEP').click();
        await settle();
        const dot = container.querySelector<HTMLElement>(
            '.ez-decision-flow__step-dot[data-category-id="control"]',
        )!;
        expect(dot.getAttribute('aria-label')).toContain('Control: KEEP');

        const mark = container.querySelector<HTMLElement>('.ez-status-mark')!;
        setStatusMarkFixes(mark.parentElement!, [
            {
                ruleId: 'r1',
                action: 'add',
                add: [{ conceptId: 'SHRED', categoryId: 'handling' }],
                message: 'Rule "r1": added "SHRED"',
            },
        ]);
        mark.dispatchEvent(
            Object.assign(new Event('pointerdown', { bubbles: true }), {
                pointerType: 'touch',
            }),
        );
        mark.click();
        expect(
            [
                ...document.querySelectorAll(
                    '.ez-tooltip:not([hidden]) .ez-status-list__text',
                ),
            ].map((line) => line.textContent),
        ).toEqual(['Added Shred this copy after use. to Handling.']);
    });

    it('gives an option too long for its row a row of its own, wrapping from the start edge', () => {
        // The stylesheet is read from disk: the `?inline` import is empty
        // under test.
        const css = readFileSync(
            join(dirname(fileURLToPath(import.meta.url)), 'decision-flow.css'),
            'utf8',
        );
        const at = css.indexOf('.ez-decision-flow__option {');
        const body = css.slice(at, css.indexOf('}', at));
        expect(body).toMatch(/max-width: 100%;/);
        expect(body).toMatch(/text-align: start;/);
        expect(
            css.slice(
                css.indexOf('.ez-decision-flow__options {'),
                css.indexOf('}', css.indexOf('.ez-decision-flow__options {')),
            ),
        ).toMatch(/flex-wrap: wrap;/);
    });
});

// ──────────────────────────────────────────────────────────────────────────────
// Written order and where the flow opens
// ──────────────────────────────────────────────────────────────────────────────

/**
 * A scheme that declares its categories in one order and writes them in
 * another: the owner first, and a note it never writes at all. Sharing heads a
 * recipients list. The owner can hold a default the author did not choose.
 */
function createWrittenOrderEngine(
    categoryOrder: string[],
    shortOrder?: string[],
): SchemeEngineAdapter {
    const concept = (id: string, view: string, category: string) =>
        ({
            id,
            name: id,
            views: { default: view },
            categories: [category],
            parents: [],
            aliases: [],
            position: 1,
        }) as ConceptView;
    const category = (
        id: string,
        label: string,
        required: boolean,
        single = true,
    ) => ({ id, label, required, single }) as CategoryView;
    const p = {
        name: 'Written Order',
        categories: [
            category('level', 'Level', true),
            category('sharing', 'Sharing', false),
            category('recipients', 'Recipients', false, false),
            category('owner', 'Owner', true),
            category('note', 'Note', false),
        ],
        concepts: [
            concept('LEVEL_A', 'A', 'level'),
            concept('NO_SHARING', 'NONE', 'sharing'),
            concept('SHARE_ALLOWED', 'SHARE', 'sharing'),
            concept('GROUP_A', 'GA', 'recipients'),
            concept('USA', 'USA', 'owner'),
            concept('GBR', 'GBR', 'owner'),
            concept('NOTE_X', 'X', 'note'),
        ],
        scopes: [],
        defaultRenderFormat: 'default',
    } as unknown as SchemePublicView;
    const write = (assertions: Assertion[]) =>
        assertions
            .map(
                (a) =>
                    p.concepts.find((c) => c.id === a.conceptId)?.views?.[
                        'default'
                    ] ?? a.conceptId,
            )
            .join('//');
    return withSuggestFor({
        getScheme: () => p,
        getSchemeMeta: () => ({
            id: 'written-order',
            version: '1.0',
            name: 'Written Order',
            defaultRenderFormat: 'default',
            formats: [
                mockRenderFormat({
                    id: 'default',
                    view: 'default',
                    categorySeparator: '//',
                    separator: '/',
                    categoryOrder,
                    headers: [
                        {
                            concept: 'SHARE_ALLOWED',
                            headerCategory: 'sharing',
                            category: 'recipients',
                            position: 'prefix',
                        },
                    ],
                }),
                // A second output, for a field that names it.
                mockRenderFormat({
                    id: 'short',
                    view: 'default',
                    categorySeparator: '/',
                    categoryOrder: shortOrder,
                }),
            ],
            scopes: [],
        }),
        listCategories: () => p.categories,
        getConceptsInCategory: (catId: string) =>
            p.concepts.filter((c) => c.categories.includes(catId)),
        render: vi.fn((assertions: Assertion[]) => ({
            rendered: write(assertions),
            assessment: {
                emitted: [],
                omitted: [],
                collapsed: [],
                conflicts: [],
                unrepresentable: [],
            },
        })),
        // The owner defaults to USA until the author states one.
        process: vi.fn(
            (_input: string, opts?: { assertions?: Assertion[] }) => {
                const assertions = [...(opts?.assertions ?? [])];
                if (!assertions.some((a) => a.categoryId === 'owner'))
                    assertions.push({
                        conceptId: 'USA',
                        categoryId: 'owner',
                        confidence: 'inferred',
                        source: 'default',
                    });
                return { assertions, rendered: write(assertions), valid: true };
            },
        ),
        suggest: vi.fn().mockReturnValue({
            suggestions: p.concepts.map((c) => ({
                conceptId: c.id,
                categoryId: c.categories[0],
                label: c.views?.default ?? c.name,
                name: c.name,
                group: c.categories[0],
            })),
        }),
        describeConcept: (conceptId: string) => ({ lines: [conceptId] }),
    } as unknown as SchemeEngineAdapter);
}

describe('DecisionFlow: steps in written order', () => {
    let host: HTMLDivElement;
    let flow: DecisionFlow;

    /** The owner the scheme defaults to, which the author did not choose. */
    const defaultOwner: Assertion = {
        conceptId: 'USA',
        categoryId: 'owner',
        confidence: 'inferred',
        source: 'default',
    };

    async function mount(
        categoryOrder: string[],
        assertions: Assertion[] = [],
        short?: { order?: string[] },
    ): Promise<void> {
        host = document.createElement('div');
        document.body.appendChild(host);
        flow = new DecisionFlow();
        await flow.init(
            host,
            toCtx(createWrittenOrderEngine(categoryOrder, short?.order)),
            short ? { formatId: 'short' } : {},
        );
        if (assertions.length > 0) flow.setAssertions(assertions);
        await settle();
    }

    afterEach(() => {
        flow.destroy();
        host.remove();
    });

    const dots = () =>
        Array.from(
            host.querySelectorAll<HTMLElement>('.ez-decision-flow__step-dot'),
        );
    const dotCategories = () => dots().map((dot) => dot.dataset.categoryId);
    const dotFor = (categoryId: string) =>
        dots().find((dot) => dot.dataset.categoryId === categoryId)!;
    const title = () =>
        host.querySelector('.ez-decision-flow__question-label')?.textContent;
    /** Open the flow the way a press on its value does. */
    async function open(): Promise<void> {
        host.querySelector<HTMLElement>('.ez-decision-flow__values')!.click();
        await settle();
    }

    it('walks its steps in the order its output writes the categories, not the order the scheme declares them', async () => {
        await mount(['owner', 'level', 'sharing', 'recipients']);
        expect(dotCategories()).toEqual(['owner', 'level', 'sharing', 'note']);
    });

    it('puts the categories its output never writes after the written ones, in declaration order', async () => {
        await mount(['sharing', 'level']);
        expect(dotCategories()).toEqual(['sharing', 'level', 'owner', 'note']);
    });

    it('shows a dependent step only once its heading is chosen, where the output writes it', async () => {
        await mount(['owner', 'sharing', 'recipients', 'level']);
        expect(dotCategories()).toEqual(['owner', 'sharing', 'level', 'note']);
        flow.setAssertions([
            {
                conceptId: 'SHARE_ALLOWED',
                categoryId: 'sharing',
                confidence: 'certain',
                source: 'user',
            },
        ]);
        await settle();
        expect(dotCategories()).toEqual([
            'owner',
            'sharing',
            'recipients',
            'level',
            'note',
        ]);
    });

    it('follows the output the field names, not the scheme default', async () => {
        await mount(['owner', 'level', 'sharing', 'recipients'], [], {
            order: ['note', 'level'],
        });
        expect(dotCategories()).toEqual(['note', 'level', 'sharing', 'owner']);
    });

    it("keeps the scheme's order when the field's output publishes no order", async () => {
        // The scheme's default output has an order; the one the field
        // writes has none, so the flow walks the categories as declared.
        await mount(['owner', 'level', 'sharing', 'recipients'], [], {});
        expect(dotCategories()).toEqual(['level', 'sharing', 'owner', 'note']);
    });

    it('opens on the first step with no value when the author has chosen nothing', async () => {
        await mount(
            ['owner', 'level', 'sharing', 'recipients'],
            [defaultOwner],
        );
        await open();
        expect(title()).toBe('2 of 4 · Level');
        expect(dotFor('level').getAttribute('aria-current')).toBe('step');
    });

    it('opens where it was once the author has chosen something', async () => {
        await mount(
            ['owner', 'level', 'sharing', 'recipients'],
            [
                {
                    conceptId: 'GBR',
                    categoryId: 'owner',
                    confidence: 'certain',
                    source: 'user',
                },
            ],
        );
        await open();
        // Level has no value, but the author chose an owner and is on it.
        expect(title()).toBe('1 of 4 \u00b7 Owner');
    });

    it('passes over a step a default answers, shows it inferred, and still goes there from its dot', async () => {
        await mount(
            ['owner', 'level', 'sharing', 'recipients'],
            [defaultOwner],
        );
        const owner = dotFor('owner');
        expect(owner.dataset.state).toBe('answered');
        expect(owner.hasAttribute('data-inferred')).toBe(true);
        expect(owner.getAttribute('aria-label')).toBe(
            'Step 1 of 4, Owner: USA (inferred)',
        );
        await open();
        expect(title()).toBe('2 of 4 · Level');
        dotFor('owner').click();
        await settle();
        expect(title()).toBe('1 of 4 · Owner');
        // The option the default holds reads as inferred, not chosen.
        const usa = host.querySelector<HTMLElement>(
            '.ez-decision-flow__option[data-concept-id="USA"]',
        )!;
        expect(usa.classList).toContain('ez-decision-flow__option--inferred');
        expect(usa.getAttribute('aria-pressed')).toBe('false');
    });
});
