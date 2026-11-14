import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DecisionFlow } from './decision-flow';
import type { SchemeEngineAdapter, Assertion } from '@ezclassify/types';
import type {
    SchemePublicView,
    ConceptView,
    CategoryView,
} from '@ezclassify/types';
import { schemeOnlyContext } from '../../test-fixtures/context-doubles';
import {
    mockRenderFormat,
    mockRenderFormats,
} from '../render-format-layout-mock';

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
    return {
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
    } as unknown as SchemeEngineAdapter;
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
    return {
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
    } as unknown as SchemeEngineAdapter;
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
    return {
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
    } as unknown as SchemeEngineAdapter;
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

    it('renders radio options for the current step', async () => {
        await component.init(container, toCtx(engine));
        await enterFlow(container);
        const options = container.querySelectorAll('[role="radio"]');
        expect(options.length).toBe(3);
    });

    describe('WCAG 4.1.2: radio option role and state', () => {
        it('unselected radio buttons have aria-checked="false"', async () => {
            await component.init(container, toCtx(engine));
            await enterFlow(container);
            const options = Array.from(
                container.querySelectorAll<HTMLButtonElement>('[role="radio"]'),
            );
            expect(
                options.every(
                    (o) => o.getAttribute('aria-checked') === 'false',
                ),
            ).toBe(true);
        });

        it('selected radio button has aria-checked="true", others remain false', async () => {
            await component.init(container, toCtx(engine));
            await enterFlow(container);
            const options =
                container.querySelectorAll<HTMLButtonElement>('[role="radio"]');
            options[1].click();
            const after = Array.from(
                container.querySelectorAll<HTMLButtonElement>('[role="radio"]'),
            );
            expect(after[1].getAttribute('aria-checked')).toBe('true');
            expect(after[0].getAttribute('aria-checked')).toBe('false');
            expect(after[2].getAttribute('aria-checked')).toBe('false');
        });

        it('radiogroup container has role="radiogroup"', async () => {
            await component.init(container, toCtx(engine));
            await enterFlow(container);
            const optionsEl = container.querySelector(
                '.ez-decision-flow__options',
            );
            expect(optionsEl?.getAttribute('role')).toBe('radiogroup');
        });
    });

    describe('WCAG 2.4.3: focus stays inside component after secondary renders', () => {
        it('focus stays on the selected radio after a subsequent render call (simulated _refreshAllowed)', async () => {
            await component.init(container, toCtx(engine));
            await enterFlow(container);
            const options =
                container.querySelectorAll<HTMLButtonElement>('[role="radio"]');

            // Simulate user selecting an option
            options[0].click();

            // After the selection render, focus should be on the selected radio
            const radioAfterSelect = container.querySelector<HTMLButtonElement>(
                '[role="radio"][tabindex="0"]',
            );
            radioAfterSelect?.focus();
            expect(document.activeElement).toBe(radioAfterSelect);

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
        const rows = container.querySelectorAll('.ez-decision-flow__row');
        // One scope: one line, with no scope label.
        expect(rows.length).toBe(1);
        expect(
            rows[0].querySelector('.ez-decision-flow__row-label'),
        ).toBeNull();
        expect(
            rows[0].querySelector('.ez-decision-flow__row-text')?.textContent,
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
        // The arrows sit at the step's inside edges, around its options.
        const step = container.querySelector('.ez-decision-flow__step')!;
        expect(step.firstElementChild).toBe(back);
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
        const text = container.querySelector('.ez-decision-flow__row-text');
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

    it('heads the open step on one line beside the dots: "1 of 2 · Scope"', async () => {
        await component.init(container, toCtx(engine));
        await enterFlow(container);
        const label = container.querySelector(
            '.ez-decision-flow__header .ez-decision-flow__question-label',
        );
        expect(label?.textContent).toBe('1 of 2 \u00b7 Scope');
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

    it('single-select step options container has role radiogroup', async () => {
        await component.init(container, toCtx(engine));
        await enterFlow(container);
        // The first step in the default profile is single-select.
        const optionsEl = container.querySelector('.ez-decision-flow__options');
        expect(optionsEl?.getAttribute('role')).toBe('radiogroup');
    });

    it('radiogroup aria-labelledby targets an element with the step question text', async () => {
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

    it("a multi-select step's dot names every selected concept", async () => {
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
    return {
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
    } as unknown as SchemeEngineAdapter;
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

    it('renders a text input field for a text_input concept category', () => {
        // Advance past level (required single-select) to the label step
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
        );
        expect(textField).not.toBeNull();
        expect(textField?.tagName).toBe('INPUT');
        expect(textField?.getAttribute('placeholder')).toBe('Name or initials');
        expect(textField?.getAttribute('aria-label')).toBe('Labeled By');
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

        const dot = container.querySelector<HTMLElement>(
            '.ez-decision-flow__step-dot[aria-current="step"]',
        );
        expect(dot?.getAttribute('aria-label')).toContain('Label: Smith, J.');
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
    return {
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
    } as unknown as SchemeEngineAdapter;
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
        // group by scope, each group named.
        expect(
            [
                ...container.querySelectorAll(
                    '.ez-decision-flow__dot-group-label',
                ),
            ].map((label) => label.textContent),
        ).toEqual(['Marking', 'Admin']);
        expect(
            container.querySelector('.ez-decision-flow__question-label')
                ?.textContent,
        ).toBe('1 of 2 \u00b7 Level');
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
        const radio = host.querySelector<HTMLButtonElement>('[role="radio"]')!;
        radio.dispatchEvent(new Event('pointerdown', { bubbles: true }));
        radio.focus();
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
        expect(host.querySelectorAll('[role="radio"]')).toHaveLength(3);
        outside.dispatchEvent(new Event(eventType, { bubbles: true }));
        outside.focus();
        radio.focus();
        await new Promise((r) => setTimeout(r, 30));
        try {
            expect(host.querySelectorAll('[role="radio"]')).toHaveLength(1);
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
        await vi.waitFor(() =>
            expect(host.querySelectorAll('[role="radio"]')).toHaveLength(1),
        );
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

    it('at rest is one line: the dots, its marking and error count, then the chrome', async () => {
        await flow.init(container, toCtx(createMockEngine()), {
            initialValue: 'S:P',
        } as never);
        await settle();
        flow.updateValidationErrors([
            { constraintId: 'required', message: 'Impact is required' },
        ]);
        const frame = container.querySelector('.ez-decision-flow')!;
        const header = frame.querySelector('.ez-decision-flow__header')!;
        const rows = frame.querySelector<HTMLElement>(
            '.ez-decision-flow__rows',
        )!;
        // The header holds the line, after the dots and before the chrome.
        const line = header.querySelector(
            '.ez-decision-flow__rest .ez-decision-flow__row',
        )!;
        expect(
            line.querySelector('.ez-decision-flow__row-text')?.textContent,
        ).not.toBe('not set');
        expect(
            line.querySelector('.ez-decision-flow__row-errors')?.textContent,
        ).toBe('1 error');
        expect(line.querySelector('.ez-decision-flow__row-label')).toBeNull();
        const order = [
            header.querySelector('.ez-decision-flow__progress')!,
            line,
            header.querySelector('.ez-status-mark')!,
        ];
        for (let i = 1; i < order.length; i++)
            expect(
                order[i - 1].compareDocumentPosition(order[i]) &
                    Node.DOCUMENT_POSITION_FOLLOWING,
            ).toBeTruthy();
        // Nothing else shows: no step, no lines under the header, and the
        // step header is the open flow's (it shows only under data-open).
        expect(step().hidden).toBe(true);
        expect(rows.hidden).toBe(true);
        expect(rows.children).toHaveLength(0);
        expect(frame.hasAttribute('data-open')).toBe(false);

        // Open, the line moves under the step and the header names the step.
        dots()[0].focus();
        expect(frame.hasAttribute('data-open')).toBe(true);
        expect(title()).toMatch(/^\d of 2 · /);
        expect(
            header.querySelector('.ez-decision-flow__rest')!.children,
        ).toHaveLength(0);
        expect(rows.hidden).toBe(false);
        expect(
            [...rows.querySelectorAll('.ez-decision-flow__row')].map(
                (row) =>
                    row.querySelector('.ez-decision-flow__row-label') === null,
            ),
        ).toEqual([true]);
    });

    it('says "not set" on its rest line when nothing is answered', async () => {
        await flow.init(container, toCtx(createMockEngine()));
        const text = container.querySelector<HTMLElement>(
            '.ez-decision-flow__rest .ez-decision-flow__row-text',
        )!;
        expect(text.textContent).toBe('not set');
        expect(text.hasAttribute('data-empty')).toBe(true);
    });

    it('lists the engine errors under it only while open; at rest the count carries them', async () => {
        const outside = document.createElement('button');
        document.body.appendChild(outside);
        await flow.init(container, toCtx(createMockEngine()));
        flow.updateValidationErrors([
            { constraintId: 'required', message: 'Impact is required' },
        ]);
        const list = () =>
            document.querySelector<HTMLElement>('.ez-validation-errors')!;
        expect(list().hidden).toBe(true);
        dots()[0].focus();
        expect(list().hidden).toBe(false);
        expect(list().textContent).toContain('Impact is required');
        outside.focus();
        expect(list().hidden).toBe(true);
    });

    it('at rest across scopes is the header and one labeled line per scope', async () => {
        const scoped = document.createElement('div');
        document.body.appendChild(scoped);
        await flow.init(scoped, toCtx(createScopedEngine()), {
            scope: 'marking admin',
        });
        await settle();
        const frame = scoped.querySelector('.ez-decision-flow')!;
        const header = frame.querySelector('.ez-decision-flow__header')!;
        // The header is the grouped dots and the chrome: no line in it.
        expect(header.querySelector('.ez-decision-flow__row')).toBeNull();
        expect(
            [...header.querySelectorAll('.ez-decision-flow__dot-group')].map(
                (group) => group.getAttribute('aria-label'),
            ),
        ).toEqual(['Marking', 'Admin']);
        expect(frame.hasAttribute('data-open')).toBe(false);
        const rows = frame.querySelector<HTMLElement>(
            '.ez-decision-flow__rows',
        )!;
        expect(rows.hidden).toBe(false);
        expect(
            [...rows.querySelectorAll('.ez-decision-flow__row')].map(
                (row) =>
                    row.querySelector('.ez-decision-flow__row-label')
                        ?.textContent,
            ),
        ).toEqual(['Marking', 'Admin']);
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

    it('marks a required unanswered step missing once the engine reports an error', async () => {
        const engine = createMockEngine();
        const profile = engine.getScheme() as SchemePublicView;
        (profile.categories[1] as { required?: boolean }).required = true;
        await flow.init(container, toCtx(engine));
        await enterFlow(container);
        // Unanswered and nothing reported: it waits for an answer.
        expect(dots()[1].dataset.state).toBe('unset');
        flow.updateValidationErrors([
            { constraintId: 'required', message: 'Impact is required' },
        ]);
        expect(dots()[1].dataset.state).toBe('missing');
        expect(dots()[1].getAttribute('aria-label')).toContain(
            'Impact: needs an answer',
        );
        // An optional unset step is never missing.
        expect(dots()[0].dataset.state).toBe('optional');
        const count = container.querySelector<HTMLElement>(
            '.ez-decision-flow__row-errors',
        );
        expect(count?.textContent).toBe('1 error');
        expect(count?.title).toBe('Impact is required');
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

    it('writes one line per scope, labeled, with the errors judged on that scope', async () => {
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
                    '.ez-decision-flow__row[data-scope="admin"] .ez-decision-flow__row-errors',
                )?.textContent,
            ).toBe('1 error'),
        );
        const rows = [
            ...scoped.querySelectorAll<HTMLElement>('.ez-decision-flow__row'),
        ];
        expect(
            rows.map(
                (row) =>
                    row.querySelector('.ez-decision-flow__row-label')
                        ?.textContent,
            ),
        ).toEqual(['Marking', 'Admin']);
        // Each line counts its own scope's errors, and an error both scopes
        // report counts once, on the first of them.
        expect(
            rows.map(
                (row) =>
                    row.querySelector<HTMLElement>(
                        '.ez-decision-flow__row-errors',
                    )?.title,
            ),
        ).toEqual(['Shared rule broken', 'Admin needs a value']);
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
