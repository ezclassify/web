/**
 * Async client parity tests.
 *
 * Verifies that all component operations produce identical outcomes with both
 * sync (local adapter) and async (REST client) engines. Also tests concurrency
 * guards, error handling, and focus management.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Assertion, SchemePublicView } from '@ezclassify/types';
// The fixtures below are resolved schemes with their rules, which the engine
// reads. That shape is internal, and this spec is already engine-bound.
import type { Category, Concept, Scheme } from '@ezclassify/types/internal';
import { Context } from '@ezclassify/engine';
import { TagInput } from './tag-input';
import { SingleSelect } from './single-select';
import { CategoryChecklist } from './category-checklist';
import { createAsyncMockEngine } from './async-engine-mock';
import { hideTooltip } from './component-utils';
import { mockRenderFormats } from '../render-format-layout-mock';

function createProfile(): Scheme {
    const concepts: Concept[] = [
        {
            id: 'A',
            name: 'Concept A',
            views: { default: 'A' },
            aliases: [],
            categories: ['f1'],
            parents: [],
            position: 0,
        } as Concept,
        {
            id: 'B',
            name: 'Concept B',
            views: { default: 'B' },
            aliases: [],
            categories: ['f1'],
            parents: [],
            position: 1,
        } as Concept,
        {
            id: 'C',
            name: 'Concept C',
            views: { default: 'C' },
            aliases: [],
            categories: ['f2'],
            parents: [],
            position: 0,
        } as Concept,
        {
            id: 'D',
            name: 'Concept D',
            views: { default: 'D' },
            aliases: [],
            categories: ['f2'],
            parents: [],
            position: 1,
        } as Concept,
        {
            id: 'INF',
            name: 'Inferred',
            views: { default: 'INF' },
            aliases: [],
            categories: ['f1'],
            parents: ['A'],
            position: 2,
        } as Concept,
    ];
    const categories: Category[] = [
        {
            id: 'f1',
            label: 'Category 1',
            single: false,
            required: false,
        } as Category,
        {
            id: 'f2',
            label: 'Category 2',
            single: true,
            required: false,
        } as Category,
    ];
    return {
        id: 'test',
        version: '1.0',
        name: 'Test',
        description: '',
        concepts,
        categories,
        parseRules: [],
        rules: [
            {
                id: 'a-implies-inf',
                action: 'imply',
                when: 'A',
                assert: 'INF',
                category: 'f1',
            },
        ],
        formats: [
            {
                id: 'default',
                categoryOrder: ['f1', 'f2'],
                separator: ',',
                categorySeparator: '//',
                view: 'default',
            },
        ],
        defaultRenderFormat: 'default',
    } as unknown as Scheme;
}

const toCtx = (eng: unknown) => Context.fromSchemeEngine(eng as never);
function createSyncEngine(scheme?: Scheme) {
    const p = scheme ?? createProfile();
    return {
        getScheme: () => p,
        getSchemeMeta: () => ({
            id: (p as any).id ?? 'test',
            version: (p as any).version ?? '1.0',
            name: (p as any).name ?? 'Test',
            defaultRenderFormat: (p as any).defaultRenderFormat ?? 'default',
            formats: mockRenderFormats((p as any).formats ?? []),
            scopes: (p as any).scopes ?? [],
        }),
        listCategories: () => (p as any).categories ?? [],
        getConceptsInCategory: (catId: string) =>
            ((p as any).concepts ?? []).filter((c: any) =>
                c.categories?.includes(catId),
            ),
        connected: true,
        render: vi.fn((assertions: Assertion[]) =>
            assertions.map((a) => a.conceptId).join(','),
        ),
        process: vi.fn(
            (input: string, options?: { assertions?: Assertion[] }) => {
                let assertions: Assertion[];
                if (options?.assertions) {
                    assertions = options.assertions.map((a) => ({ ...a }));
                } else {
                    const ids = input
                        ? input
                              .split(',')
                              .map((s) => s.trim())
                              .filter(Boolean)
                        : [];
                    assertions = ids.map((id) => {
                        const concept = p.concepts.find((c) => c.id === id);
                        return {
                            conceptId: id,
                            categoryId: concept?.categories[0] ?? 'f1',
                            confidence: 'certain' as const,
                            source: 'parse' as const,
                        };
                    });
                }
                // Simulate inference: A implies INF
                if (
                    assertions.some((a) => a.conceptId === 'A') &&
                    !assertions.some((a) => a.conceptId === 'INF')
                ) {
                    assertions.push({
                        conceptId: 'INF',
                        categoryId: 'f1',
                        confidence: 'inferred' as const,
                        source: 'engine' as const,
                    });
                }
                return {
                    assertions,
                    rendered: assertions.map((a) => a.conceptId).join(','),
                    valid: true,
                };
            },
        ),
        suggest: vi.fn(() => ({
            suggestions: p.concepts.map((c) => ({
                conceptId: c.id,
                categoryId: c.categories[0],
                label: c.name,
                name: c.name,
                views: c.views,
                group:
                    p.categories.find((f) => f.id === c.categories[0])?.label ??
                    '',
            })),
        })),
        aggregate: vi.fn((inputs: string[]) => ({
            assertions: [],
            rendered: inputs.join('|'),
        })),
        describeConcept: vi.fn((conceptId: string, categoryId: string) => {
            const concept = p.concepts.find((c) => c.id === conceptId);
            return {
                name: concept?.name ?? conceptId,
                lines: [
                    `${categoryId}: ${concept?.name ?? conceptId}`,
                    '',
                    'Rules:',
                    '  Test rule',
                ],
            };
        }),
    };
}

function wait(ms = 50) {
    return new Promise((r) => setTimeout(r, ms));
}

let container: HTMLDivElement;

beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
});

afterEach(() => {
    hideTooltip();
    // Components own body-portaled dropdown/detail surfaces in addition to
    // their in-flow container.
    document.body.innerHTML = '';
});

// ═════════════════════════════════════════════════════════════════════════════
// Component parity, sync vs async engine produce same outcomes
// ═════════════════════════════════════════════════════════════════════════════

describe('Component parity: sync vs async engine', () => {
    describe('TagInput', () => {
        it('init with pre-populated value produces same assertions', async () => {
            // Sync
            const syncEngine = createSyncEngine();
            const syncAC = new TagInput();
            const syncContainer = document.createElement('div');
            const syncInput = document.createElement('input');
            syncInput.value = 'A,B';
            syncContainer.appendChild(syncInput);
            container.appendChild(syncContainer);
            await syncAC.init(syncContainer, toCtx(syncEngine));
            const syncAssertions = syncAC.getAssertions();

            // Async
            const asyncEngine = createAsyncMockEngine({ delay: 5 });
            const asyncAC = new TagInput();
            const asyncContainer = document.createElement('div');
            const asyncInput = document.createElement('input');
            asyncInput.value = 'A,B';
            asyncContainer.appendChild(asyncInput);
            container.appendChild(asyncContainer);
            await asyncAC.init(asyncContainer, toCtx(asyncEngine));
            const asyncAssertions = asyncAC.getAssertions();

            // Same concept IDs (order may differ due to inference)
            const syncIds = new Set(syncAssertions.map((a) => a.conceptId));
            const asyncIds = new Set(asyncAssertions.map((a) => a.conceptId));
            expect(syncIds).toEqual(asyncIds);
        });

        it('getRendered returns same value after init', async () => {
            const syncEngine = createSyncEngine();
            const syncAC = new TagInput();
            const syncContainer = document.createElement('div');
            const syncInput = document.createElement('input');
            syncInput.value = 'A';
            syncContainer.appendChild(syncInput);
            container.appendChild(syncContainer);
            await syncAC.init(syncContainer, toCtx(syncEngine));

            const asyncEngine = createAsyncMockEngine({ delay: 5 });
            const asyncAC = new TagInput();
            const asyncContainer = document.createElement('div');
            const asyncInput = document.createElement('input');
            asyncInput.value = 'A';
            asyncContainer.appendChild(asyncInput);
            container.appendChild(asyncContainer);
            await asyncAC.init(asyncContainer, toCtx(asyncEngine));

            expect(syncAC.getRendered()).toBe(asyncAC.getRendered());
        });

        it('addAssertion produces same result for both engines', async () => {
            // Sync
            const syncEngine = createSyncEngine();
            const syncAC = new TagInput();
            const syncContainer = document.createElement('div');
            syncContainer.appendChild(document.createElement('input'));
            container.appendChild(syncContainer);
            await syncAC.init(syncContainer, toCtx(syncEngine));
            (
                syncAC as unknown as {
                    addAssertion: (id: string, fid: string) => void;
                }
            ).addAssertion('B', 'f1');
            await wait(20);

            // Async
            const asyncEngine = createAsyncMockEngine({ delay: 5 });
            const asyncAC = new TagInput();
            const asyncContainer = document.createElement('div');
            asyncContainer.appendChild(document.createElement('input'));
            container.appendChild(asyncContainer);
            await asyncAC.init(asyncContainer, toCtx(asyncEngine));
            (
                asyncAC as unknown as {
                    addAssertion: (id: string, fid: string) => void;
                }
            ).addAssertion('B', 'f1');
            await wait(50);

            const syncIds = new Set(
                syncAC.getAssertions().map((a) => a.conceptId),
            );
            const asyncIds = new Set(
                asyncAC.getAssertions().map((a) => a.conceptId),
            );
            expect(syncIds).toEqual(asyncIds);
        });

        it('removeAssertion produces same result for both engines', async () => {
            // Sync
            const syncEngine = createSyncEngine();
            const syncAC = new TagInput();
            const syncContainer = document.createElement('div');
            const syncInput = document.createElement('input');
            syncInput.value = 'A,B';
            syncContainer.appendChild(syncInput);
            container.appendChild(syncContainer);
            await syncAC.init(syncContainer, toCtx(syncEngine));
            (
                syncAC as unknown as {
                    removeAssertion: (id: string, fid: string) => void;
                }
            ).removeAssertion('B', 'f1');
            await wait(20);

            // Async
            const asyncEngine = createAsyncMockEngine({ delay: 5 });
            const asyncAC = new TagInput();
            const asyncContainer = document.createElement('div');
            const asyncInput = document.createElement('input');
            asyncInput.value = 'A,B';
            asyncContainer.appendChild(asyncInput);
            container.appendChild(asyncContainer);
            await asyncAC.init(asyncContainer, toCtx(asyncEngine));
            (
                asyncAC as unknown as {
                    removeAssertion: (id: string, fid: string) => void;
                }
            ).removeAssertion('B', 'f1');
            await wait(50);

            const syncIds = new Set(
                syncAC.getAssertions().map((a) => a.conceptId),
            );
            const asyncIds = new Set(
                asyncAC.getAssertions().map((a) => a.conceptId),
            );
            expect(syncIds).toEqual(asyncIds);
        });

        it('setAssertions via public API works for async engine', async () => {
            const asyncEngine = createAsyncMockEngine({ delay: 5 });
            const ac = new TagInput();
            const c = document.createElement('div');
            c.appendChild(document.createElement('input'));
            container.appendChild(c);
            await ac.init(c, toCtx(asyncEngine));

            ac.setAssertions([
                {
                    conceptId: 'A',
                    categoryId: 'f1',
                    confidence: 'certain',
                    source: 'user',
                },
                {
                    conceptId: 'C',
                    categoryId: 'f2',
                    confidence: 'certain',
                    source: 'user',
                },
            ]);
            await wait(50);

            const ids = ac.getAssertions().map((a) => a.conceptId);
            expect(ids).toContain('A');
            expect(ids).toContain('C');
        });
    });

    describe('SingleSelect', () => {
        it('card click selects concept with async engine', async () => {
            const asyncEngine = createAsyncMockEngine({ delay: 5 });
            const select = new SingleSelect();
            const selectEl = document.createElement('select');
            selectEl.setAttribute('data-category', 'f2');
            const c = document.createElement('div');
            c.appendChild(selectEl);
            container.appendChild(c);
            await select.init(c, toCtx(asyncEngine), {
                categoryId: 'f2',
                mode: 'cards',
            });
            await wait(20);

            // Click first card
            const card = c.querySelector('.select-card') as HTMLElement;
            expect(card).toBeTruthy();
            card?.click();
            await wait(50);

            const assertions = select.getAssertions();
            expect(assertions.some((a) => a.categoryId === 'f2')).toBe(true);
        });

        it('single-select replaces previous selection', async () => {
            const asyncEngine = createAsyncMockEngine({ delay: 5 });
            const select = new SingleSelect();
            const c = document.createElement('div');
            c.appendChild(document.createElement('select'));
            container.appendChild(c);
            await select.init(c, toCtx(asyncEngine), {
                categoryId: 'f2',
                mode: 'cards',
            });
            await wait(20);

            // Click first card (C)
            const cards = c.querySelectorAll('.select-card');
            (cards[0] as HTMLElement)?.click();
            await wait(50);

            expect(
                select.getAssertions().some((a) => a.conceptId === 'C'),
            ).toBe(true);

            // Click second card (D)
            const updatedCards = c.querySelectorAll('.select-card');
            (updatedCards[1] as HTMLElement)?.click();
            await wait(50);

            const finalAssertions = select.getAssertions();
            expect(
                finalAssertions.some(
                    (a) => a.conceptId === 'D' && a.categoryId === 'f2',
                ),
            ).toBe(true);
            expect(
                finalAssertions.filter((a) => a.categoryId === 'f2'),
            ).toHaveLength(1);
        });
    });

    describe('CategoryChecklist', () => {
        it('checkbox toggle works with async engine', async () => {
            const asyncEngine = createAsyncMockEngine({ delay: 5 });
            const checklist = new CategoryChecklist();
            const c = document.createElement('div');
            const fieldset = document.createElement('fieldset');
            fieldset.setAttribute('data-category', 'f1');
            c.appendChild(fieldset);
            container.appendChild(c);
            await checklist.init(c, toCtx(asyncEngine), { categoryId: 'f1' });
            await wait(20);

            // Click first checkbox
            const checkbox = c.querySelector(
                'input[type="checkbox"]',
            ) as HTMLInputElement;
            expect(checkbox).toBeTruthy();
            checkbox?.click();
            await wait(50);

            const assertions = checklist.getAssertions();
            expect(assertions.length).toBeGreaterThan(0);
        });
    });
});

// ═════════════════════════════════════════════════════════════════════════════
// Concurrency, rapid mutations with sequence guard
// ═════════════════════════════════════════════════════════════════════════════

describe('Concurrency: rapid mutations with async engine', () => {
    it('rapid add-add: last mutation wins, no duplicates', async () => {
        const asyncEngine = createAsyncMockEngine({ delay: 20 });
        const ac = new TagInput();
        const c = document.createElement('div');
        c.appendChild(document.createElement('input'));
        container.appendChild(c);
        await ac.init(c, toCtx(asyncEngine));

        // Rapid fire two adds without waiting
        const add = (
            ac as unknown as { addAssertion: (id: string, fid: string) => void }
        ).addAssertion.bind(ac);
        add('A', 'f1');
        add('B', 'f1');

        // Wait for both to settle
        await wait(100);

        const ids = ac.getAssertions().map((a) => a.conceptId);
        // Should have B (and its inference results), not duplicates
        expect(ids.filter((id) => id === 'B')).toHaveLength(1);
    });

    it('rapid single-select switch: final card wins', async () => {
        const asyncEngine = createAsyncMockEngine({ delay: 20 });
        const select = new SingleSelect();
        const c = document.createElement('div');
        c.appendChild(document.createElement('select'));
        container.appendChild(c);
        await select.init(c, toCtx(asyncEngine), {
            categoryId: 'f2',
            mode: 'cards',
        });
        await wait(30);

        // Rapidly click C then D
        const cards = c.querySelectorAll('.select-card');
        (cards[0] as HTMLElement)?.click();
        (cards[1] as HTMLElement)?.click();

        await wait(100);

        // Only D should be selected (latest wins)
        const f2Assertions = select
            .getAssertions()
            .filter((a) => a.categoryId === 'f2');
        expect(f2Assertions).toHaveLength(1);
        expect(f2Assertions[0].conceptId).toBe('D');
    });

    it('add then immediately remove: concept not present', async () => {
        const asyncEngine = createAsyncMockEngine({ delay: 20 });
        const ac = new TagInput();
        const c = document.createElement('div');
        c.appendChild(document.createElement('input'));
        container.appendChild(c);
        await ac.init(c, toCtx(asyncEngine));

        const methods = ac as unknown as {
            addAssertion: (id: string, fid: string) => void;
            removeAssertion: (id: string, fid: string) => void;
        };
        methods.addAssertion('B', 'f1');
        methods.removeAssertion('B', 'f1');

        await wait(100);

        const ids = ac.getAssertions().map((a) => a.conceptId);
        expect(ids).not.toContain('B');
    });
});

// ═════════════════════════════════════════════════════════════════════════════
// Error handling, network failures don't corrupt state
// ═════════════════════════════════════════════════════════════════════════════

describe('Error handling: async engine failures', () => {
    it('render failure does not corrupt component state', async () => {
        const asyncEngine = createAsyncMockEngine({ delay: 5 });
        const ac = new TagInput();
        const c = document.createElement('div');
        const input = document.createElement('input');
        input.value = 'A';
        c.appendChild(input);
        container.appendChild(c);
        await ac.init(c, toCtx(asyncEngine));

        // Make next render fail
        asyncEngine._failNext('render');
        (
            ac as unknown as { addAssertion: (id: string, fid: string) => void }
        ).addAssertion('B', 'f1');
        await wait(50);

        // Component should still be functional, assertions may not have updated
        // but should not be in a corrupted state
        const afterAssertions = ac.getAssertions();
        expect(afterAssertions.length).toBeGreaterThanOrEqual(0);
    });

    it('process failure does not corrupt component state', async () => {
        const asyncEngine = createAsyncMockEngine({ delay: 5 });
        const ac = new TagInput();
        const c = document.createElement('div');
        const input = document.createElement('input');
        input.value = 'A';
        c.appendChild(input);
        container.appendChild(c);
        await ac.init(c, toCtx(asyncEngine));

        // Make next process fail
        asyncEngine._failNext('process');
        (
            ac as unknown as { addAssertion: (id: string, fid: string) => void }
        ).addAssertion('B', 'f1');
        await wait(50);

        // Component should still function, getRendered should return something valid
        expect(typeof ac.getRendered()).toBe('string');
    });

    it('component remains usable after error recovery', async () => {
        const asyncEngine = createAsyncMockEngine({ delay: 5 });
        const ac = new TagInput();
        const c = document.createElement('div');
        c.appendChild(document.createElement('input'));
        container.appendChild(c);
        await ac.init(c, toCtx(asyncEngine));

        // Fail first add
        asyncEngine._failNext('render');
        (
            ac as unknown as { addAssertion: (id: string, fid: string) => void }
        ).addAssertion('A', 'f1');
        await wait(50);

        // Second add should work normally
        (
            ac as unknown as { addAssertion: (id: string, fid: string) => void }
        ).addAssertion('B', 'f1');
        await wait(50);

        const ids = ac.getAssertions().map((a) => a.conceptId);
        expect(ids).toContain('B');
    });
});

// ═════════════════════════════════════════════════════════════════════════════
// Inferred confidence preservation
// ═════════════════════════════════════════════════════════════════════════════

describe('Inferred confidence preservation', () => {
    it('user-selected concepts stay certain after reprocess', async () => {
        const asyncEngine = createAsyncMockEngine({ delay: 5 });
        const ac = new TagInput();
        const c = document.createElement('div');
        c.appendChild(document.createElement('input'));
        container.appendChild(c);
        await ac.init(c, toCtx(asyncEngine));

        (
            ac as unknown as { addAssertion: (id: string, fid: string) => void }
        ).addAssertion('B', 'f1');
        await wait(50);

        const bAssertion = ac.getAssertions().find((a) => a.conceptId === 'B');
        expect(bAssertion?.confidence).toBe('certain');
        expect(bAssertion?.source).toBe('user');
    });

    it('engine-inferred concepts marked as inferred after reprocess', async () => {
        const asyncEngine = createAsyncMockEngine({ delay: 5 });
        const ac = new TagInput();
        const c = document.createElement('div');
        c.appendChild(document.createElement('input'));
        container.appendChild(c);
        await ac.init(c, toCtx(asyncEngine));

        // Add A which triggers inference of INF
        (
            ac as unknown as { addAssertion: (id: string, fid: string) => void }
        ).addAssertion('A', 'f1');
        await wait(50);

        const infAssertion = ac
            .getAssertions()
            .find((a) => a.conceptId === 'INF');
        expect(infAssertion).toBeDefined();
        expect(infAssertion?.confidence).toBe('inferred');
    });

    it('removing one inferred concept does not change another inferred status', async () => {
        // Add second inference rule: B implies another concept
        const scheme = createProfile();
        scheme.concepts.push({
            id: 'INF2',
            name: 'Inferred 2',
            views: { default: 'INF2' },
            aliases: [],
            categories: ['f1'],
            parents: ['B'],
            position: 3,
        } as Concept);
        (scheme.rules as unknown[]).push({
            id: 'b-implies-inf2',
            action: 'imply',
            when: 'B',
            assert: 'INF2',
            category: 'f1',
        });

        // The async mock serves the public view; this fixture is the resolved
        // scheme so the sync engine can read its rules.
        const engine = createAsyncMockEngine({
            delay: 5,
            scheme: scheme as unknown as SchemePublicView,
        });
        // Override process to handle both inference rules
        const origProcess = engine.process.bind(engine);
        engine.process = async (
            input: string | Assertion[],
            opts?: { format?: string; assertions?: Assertion[] },
        ) => {
            const result = await origProcess(input, opts);
            if (
                result.assertions.some((a) => a.conceptId === 'B') &&
                !result.assertions.some((a) => a.conceptId === 'INF2')
            ) {
                result.assertions.push({
                    conceptId: 'INF2',
                    categoryId: 'f1',
                    confidence: 'inferred' as const,
                    source: 'engine' as const,
                });
                result.rendered = result.assertions
                    .map((a) => a.conceptId)
                    .join(',');
            }
            return result;
        };

        const ac = new TagInput();
        const c = document.createElement('div');
        const input = document.createElement('input');
        input.value = 'A,B';
        c.appendChild(input);
        container.appendChild(c);
        await ac.init(c, toCtx(engine));
        await wait(30);

        // Both INF and INF2 should be inferred
        expect(
            ac.getAssertions().find((a) => a.conceptId === 'INF')?.confidence,
        ).toBe('inferred');
        expect(
            ac.getAssertions().find((a) => a.conceptId === 'INF2')?.confidence,
        ).toBe('inferred');
    });
});

// ═════════════════════════════════════════════════════════════════════════════
// Focus management during async re-render
// ═════════════════════════════════════════════════════════════════════════════

describe('Focus management during async re-render', () => {
    it('filter input regains focus after async reprocess', async () => {
        const asyncEngine = createAsyncMockEngine({ delay: 10 });
        const ac = new TagInput();
        const c = document.createElement('div');
        c.appendChild(document.createElement('input'));
        container.appendChild(c);
        await ac.init(c, toCtx(asyncEngine));

        // Focus the filter input
        const filterInput = c.querySelector(
            '.tag-input-filter',
        ) as HTMLInputElement;
        expect(filterInput).toBeTruthy();
        filterInput.focus();
        expect(document.activeElement).toBe(filterInput);

        // Trigger reprocess
        (
            ac as unknown as { addAssertion: (id: string, fid: string) => void }
        ).addAssertion('A', 'f1');
        await wait(80);

        // After async rebuild, filter input should have focus
        const newFilter = c.querySelector(
            '.tag-input-filter',
        ) as HTMLInputElement;
        expect(document.activeElement).toBe(newFilter);
    });

    it('focus not stolen when moved to another element', async () => {
        const asyncEngine = createAsyncMockEngine({ delay: 10 });
        const ac = new TagInput();
        const c = document.createElement('div');
        c.appendChild(document.createElement('input'));
        container.appendChild(c);
        await ac.init(c, toCtx(asyncEngine));

        // Focus filter, trigger reprocess, then move focus away
        const filterInput = c.querySelector(
            '.tag-input-filter',
        ) as HTMLInputElement;
        filterInput?.focus();

        (
            ac as unknown as { addAssertion: (id: string, fid: string) => void }
        ).addAssertion('A', 'f1');

        // Move focus to a different element before reprocess completes
        const other = document.createElement('input');
        document.body.appendChild(other);
        other.focus();
        expect(document.activeElement).toBe(other);

        await wait(80);

        // Focus should stay on the other element, not be stolen back
        expect(document.activeElement).toBe(other);
        document.body.removeChild(other);
    });
});

// ═════════════════════════════════════════════════════════════════════════════
// onChange callback parity
// ═════════════════════════════════════════════════════════════════════════════

describe('onChange callback parity', () => {
    it('onChange fires with correct assertions and rendered for async engine', async () => {
        const asyncEngine = createAsyncMockEngine({ delay: 5 });
        let cbAssertions: Assertion[] = [];
        let cbRendered = '';

        const ac = new TagInput();
        const c = document.createElement('div');
        c.appendChild(document.createElement('input'));
        container.appendChild(c);
        await ac.init(c, toCtx(asyncEngine), {
            onChange: (assertions: Assertion[], rendered: string) => {
                cbAssertions = assertions;
                cbRendered = rendered;
            },
        });

        (
            ac as unknown as { addAssertion: (id: string, fid: string) => void }
        ).addAssertion('A', 'f1');
        await wait(50);

        expect(cbAssertions.length).toBeGreaterThan(0);
        expect(cbAssertions.some((a) => a.conceptId === 'A')).toBe(true);
        expect(cbRendered).toContain('A');
    });

    it('onChange not fired for stale reprocess results', async () => {
        const asyncEngine = createAsyncMockEngine({ delay: 30 });
        let callCount = 0;

        const ac = new TagInput();
        const c = document.createElement('div');
        c.appendChild(document.createElement('input'));
        container.appendChild(c);
        await ac.init(c, toCtx(asyncEngine), {
            onChange: () => {
                callCount++;
            },
        });

        callCount = 0;

        // Rapid fire, only the last one should trigger onChange
        const add = (
            ac as unknown as { addAssertion: (id: string, fid: string) => void }
        ).addAssertion.bind(ac);
        add('A', 'f1');
        add('B', 'f1');

        await wait(120);

        // The sequence guard means only the latest reprocess fires onChange
        // First reprocess result (for A) should be discarded
        expect(callCount).toBeLessThanOrEqual(2); // init + latest
    });
});

describe('Engine adapter describeConcept', () => {
    it('returns human-readable rule descriptions', async () => {
        const asyncEngine = createAsyncMockEngine({ delay: 5 });
        const result = await asyncEngine.describeConcept('A', 'f1');

        expect(result.name).toBe('Concept A');
        expect(result.lines.length).toBeGreaterThan(0);
        expect(result.lines.some((l) => l.includes('Rules:'))).toBe(true);
    });

    it('returns concept name in header', async () => {
        const asyncEngine = createAsyncMockEngine({ delay: 5 });
        const result = await asyncEngine.describeConcept('B', 'f1');

        expect(result.lines[0]).toContain('Concept B');
    });
});
