/**
 * Tests for the Handbook component.
 *
 * Verifies rendering of profile overview, scope tabs, concept entries grouped
 * by category, search filtering (including collapsed-match reveal), category
 * expand/collapse, deprecated concept display, and accessibility.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ConceptView, Assertion } from '@ezclassify/types';
// The fixtures are authored schemes (concept documentation blocks), an
// internal shape; this spec is already engine-bound.
import type { Category, Concept, Scheme } from '@ezclassify/types/internal';
import { Context } from '@ezclassify/engine';
import { Handbook } from './handbook';
import { loadPantry } from '@ezclassify/example-schemes/pantry';
import { loadCedarValley } from '@ezclassify/example-schemes/cedar-valley';
import { mockRenderFormats } from '../render-format-layout-mock';

/** Scheme with scopes and explicit defaultScope */
function createScopedProfile(): Scheme {
    const concepts: Concept[] = [
        {
            id: 'alpha',
            name: 'Alpha',
            views: { default: 'ALPHA' },
            aliases: [],
            categories: ['f1'],
            parents: [],
            position: 0,
        } as Concept,
        {
            id: 'beta',
            name: 'Beta',
            views: { default: 'BETA' },
            aliases: [],
            categories: ['f1'],
            parents: [],
            position: 1,
        } as Concept,
        {
            id: 'gamma',
            name: 'Gamma',
            views: { default: 'GAMMA' },
            aliases: [],
            categories: ['f2'],
            parents: [],
            position: 0,
        } as Concept,
        {
            id: 'delta',
            name: 'Delta',
            views: { default: 'DELTA' },
            aliases: [],
            categories: ['f3'],
            parents: [],
            position: 0,
            scopes: ['extra'],
        } as Concept,
    ];
    const categories: Category[] = [
        { id: 'f1', label: 'Main', single: false, required: false } as Category,
        {
            id: 'f2',
            label: 'Extra Only',
            single: false,
            required: false,
            scopes: ['extra'],
        } as Category,
        {
            id: 'f3',
            label: 'Extra Items',
            single: false,
            required: false,
            scopes: ['extra'],
        } as Category,
    ];
    return {
        id: 'scoped',
        version: '1.0',
        name: 'Scoped Scheme',
        description: '',
        concepts,
        categories,
        parseRules: [],
        formats: [
            {
                id: 'default',
                categoryOrder: ['f1', 'f2', 'f3'],
                separator: ',',
                categorySeparator: '//',
                view: 'default',
            },
        ],
        defaultRenderFormat: 'default',
        defaultScope: 'main',
        scopeLabel: 'Context',
        scopes: [
            { id: 'main', label: 'Main Marking' },
            { id: 'extra', label: 'Extra Block' },
        ],
    } as unknown as Scheme;
}

/**
 * Scheme with scopes but NO explicit defaultScope (REST client scenario): first
 * scope is inferred as default
 */
function createScopedProfileNoDefault(): Scheme {
    const base = createScopedProfile() as any;
    delete base.defaultScope;
    return base as Scheme;
}

function createProfile(): Scheme {
    const concepts: Concept[] = [
        {
            id: 'alpha',
            name: 'Alpha',
            views: { default: 'ALPHA', short: 'A' },
            aliases: ['al'],
            categories: ['f1'],
            parents: [],
            position: 0,
            documentation: {
                definition: 'First letter of the Greek alphabet',
                guidance: 'Use for the highest priority items',
            },
        } as Concept,
        {
            id: 'beta',
            name: 'Beta',
            views: { default: 'BETA' },
            aliases: [],
            categories: ['f1'],
            parents: ['alpha'],
            position: 1,
            documentation: { definition: 'Second letter' },
        } as Concept,
        {
            id: 'gamma',
            name: 'Gamma',
            views: { default: 'GAMMA' },
            aliases: ['gam'],
            categories: ['f2'],
            parents: [],
            position: 0,
            documentation: {
                guidance: 'Use for radiation measurements',
                notices: [
                    {
                        type: 'warning',
                        required: true,
                        text: 'Handle with care',
                    },
                    {
                        type: 'handling',
                        required: false,
                        text: 'Special handling required',
                    },
                ],
            },
        } as Concept,
        {
            id: 'old',
            name: 'Old Concept',
            views: { default: 'OLD' },
            aliases: [],
            categories: ['f1'],
            parents: [],
            position: 2,
            deprecated: true,
            deprecatedMessage: 'No longer valid',
            deprecatedReplacement: 'alpha',
        } as Concept,
    ];

    const categories: Category[] = [
        {
            id: 'f1',
            label: 'Group One',
            single: false,
            required: false,
        } as Category,
        {
            id: 'f2',
            label: 'Group Two',
            single: false,
            required: false,
        } as Category,
    ];

    return {
        id: 'test',
        version: '1.0',
        name: 'Test Scheme',
        description: 'A profile for testing',
        definition: 'Formal definition of the test profile',
        guidance: 'Follow these guidelines when using this profile',
        concepts,
        categories,
        parseRules: [],
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

/**
 * Project authored concepts the way an engine adapter does.
 *
 * `getConceptsInCategory` answers `ConceptView`, which carries `definition`,
 * `guidance` and `notices` as flat fields. The authored `Concept` the fixtures
 * below are written as keeps all three inside its `documentation` block, so a
 * mock that handed those documents straight back would let the Handbook pass
 * against a shape no real adapter returns.
 */
function toConceptViews(concepts: Concept[]): ConceptView[] {
    return concepts.map(
        (concept) =>
            ({
                ...concept,
                definition: concept.documentation?.definition,
                guidance: concept.documentation?.guidance,
                notices: concept.documentation?.notices,
            }) as unknown as ConceptView,
    );
}

/** The scheme an adapter answers with: authored documents already projected. */
function toSchemeView(scheme: Scheme): Scheme {
    return {
        ...scheme,
        concepts: toConceptViews((scheme as any).concepts ?? []),
    } as unknown as Scheme;
}

function describeConceptResult(
    p: Scheme,
    conceptId: string,
    categoryId: string,
) {
    const concept = p.concepts.find((c) => c.id === conceptId);
    const rules = conceptId === 'alpha' ? ['Exclusive with Beta'] : [];
    return {
        conceptId,
        categoryId,
        name: concept?.name ?? conceptId,
        definition: concept?.documentation?.definition,
        guidance: concept?.documentation?.guidance,
        rules: rules.length > 0 ? rules : undefined,
        lines: [`${categoryId}: ${concept?.name ?? conceptId}`],
    };
}

function createEngine(scheme?: Scheme) {
    const p = scheme ?? createProfile();
    const view = toSchemeView(p);
    return {
        getScheme: () => view,
        getSchemeMeta: () => ({
            id: (p as any).id ?? 'test',
            version: (p as any).version ?? '1.0',
            name: (p as any).name ?? 'Test',
            defaultRenderFormat: (p as any).defaultRenderFormat ?? 'default',
            formats: mockRenderFormats((p as any).formats ?? []),
            scopes: (p as any).scopes ?? [],
        }),
        listCategories: () => (p as any).categories ?? [],
        getConceptsInCategory: (catId: string, opts?: any) => {
            if (opts?.nested) return undefined;
            return ((view as any).concepts ?? []).filter((c: any) =>
                c.categories?.includes(catId),
            );
        },
        render: vi.fn((_a: Assertion[]) => ''),
        process: vi.fn((_input: string) => ({
            assertions: [],
            rendered: '',
            valid: true,
        })),
        suggest: vi.fn(() => ({ suggestions: [] })),
        describeConcept: vi.fn((conceptId: string, categoryId: string) =>
            describeConceptResult(p, conceptId, categoryId),
        ),
    } as any;
}

/** Async describeConcept engine (simulates REST client) */
function createAsyncEngine(scheme?: Scheme) {
    const p = scheme ?? createProfile();
    const view = toSchemeView(p);
    return {
        getScheme: () => view,
        getSchemeMeta: () => ({
            id: (p as any).id ?? 'test',
            version: (p as any).version ?? '1.0',
            name: (p as any).name ?? 'Test',
            defaultRenderFormat: (p as any).defaultRenderFormat ?? 'default',
            formats: mockRenderFormats((p as any).formats ?? []),
            scopes: (p as any).scopes ?? [],
        }),
        listCategories: () => (p as any).categories ?? [],
        getConceptsInCategory: (catId: string, opts?: any) => {
            if (opts?.nested) return undefined;
            return ((view as any).concepts ?? []).filter((c: any) =>
                c.categories?.includes(catId),
            );
        },
        render: vi.fn((_a: Assertion[]) => ''),
        process: vi.fn((_input: string) => ({
            assertions: [],
            rendered: '',
            valid: true,
        })),
        suggest: vi.fn(() => ({ suggestions: [] })),
        describeConcept: vi.fn((conceptId: string, categoryId: string) =>
            Promise.resolve(describeConceptResult(p, conceptId, categoryId)),
        ),
    } as any;
}

const toCtx = (eng: unknown) => Context.fromSchemeEngine(eng as never);
describe('Handbook', () => {
    let container: HTMLDivElement;
    let handbook: Handbook;

    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
        handbook = new Handbook();
    });

    afterEach(() => {
        handbook.destroy();
        container.remove();
    });

    describe('profile overview', () => {
        it('keeps the introduction collapsed while allowing the full definition and guidance to be opened', async () => {
            await handbook.init(container, toCtx(createEngine()));
            const details = container.querySelector<HTMLDetailsElement>(
                '.ez-handbook__introduction',
            )!;
            expect(details.open).toBe(false);
            expect(details.textContent).toContain(
                'Formal definition of the test profile',
            );
            expect(details.textContent).toContain(
                'Follow these guidelines when using this profile',
            );
            details.querySelector('summary')!.click();
            expect(details.open).toBe(true);
            details.querySelector('summary')!.click();
            expect(details.open).toBe(false);
        });

        it('renders profile name, description, definition, and guidance', async () => {
            await handbook.init(container, toCtx(createEngine()));

            const overview = container.querySelector('.ez-handbook__overview')!;
            expect(overview).toBeTruthy();
            expect(
                overview.querySelector('.ez-handbook__overview-name')!
                    .textContent,
            ).toBe('Test Scheme');
            expect(
                overview.querySelector('.ez-handbook__overview-desc')!
                    .textContent,
            ).toBe('A profile for testing');

            const labels = [
                ...overview.querySelectorAll('.ez-handbook__overview-label'),
            ].map((l) => l.textContent);
            expect(labels).toContain('Definition');
            expect(labels).toContain('Guidance');
        });

        it('shows version, category count, and concept count', async () => {
            await handbook.init(container, toCtx(createEngine()));

            const meta = container.querySelector(
                '.ez-handbook__overview-meta',
            )!;
            expect(meta.textContent).toContain('v1.0');
            expect(meta.textContent).not.toContain('composition');
            expect(meta.textContent).toContain('2 categories');
            expect(meta.textContent).toContain('4 concepts');
        });
    });

    describe('category groups', () => {
        it('renders category groups with headers', async () => {
            await handbook.init(container, toCtx(createEngine()));

            const headers = container.querySelectorAll(
                '.ez-handbook__category-header',
            );
            expect(headers.length).toBe(2);
            expect(headers[0].textContent).toContain('Group One');
            expect(headers[1].textContent).toContain('Group Two');
        });

        it('starts with categories collapsed by default', async () => {
            await handbook.init(container, toCtx(createEngine()));

            const entries = container.querySelectorAll('.ez-handbook__entry');
            expect(entries.length).toBe(0);

            const headers = container.querySelectorAll(
                '.ez-handbook__category-header',
            );
            expect(headers[0].getAttribute('aria-expanded')).toBe('false');
        });

        it('toggles category expand/collapse on click', async () => {
            await handbook.init(container, toCtx(createEngine()));

            // Click first category header to expand
            const header = container.querySelector(
                '.ez-handbook__category-header',
            ) as HTMLElement;
            header.click();

            let entries = container.querySelectorAll('.ez-handbook__entry');
            expect(entries.length).toBe(3); // alpha, beta, old in f1

            // Click again to collapse
            const updatedHeader = container.querySelector(
                '.ez-handbook__category-header',
            ) as HTMLElement;
            updatedHeader.click();

            entries = container.querySelectorAll('.ez-handbook__entry');
            expect(entries.length).toBe(0);
        });

        it('respects expandAll: true option', async () => {
            await handbook.init(container, toCtx(createEngine()), {
                expandAll: true,
            });

            const entries = container.querySelectorAll('.ez-handbook__entry');
            expect(entries.length).toBe(4); // all expanded
        });

        it('respects categoryFilter option', async () => {
            await handbook.init(container, toCtx(createEngine()), {
                expandAll: true,
                categoryFilter: ['f2'],
            });

            const headers = container.querySelectorAll(
                '.ez-handbook__category-header',
            );
            expect(headers.length).toBe(1);
            expect(headers[0].textContent).toContain('Group Two');

            const entries = container.querySelectorAll('.ez-handbook__entry');
            expect(entries.length).toBe(1); // only gamma
        });

        it('handles keyboard navigation on category headers', async () => {
            await handbook.init(container, toCtx(createEngine()));

            const header = container.querySelector(
                '.ez-handbook__category-header',
            ) as HTMLElement;

            // Enter key expands
            header.dispatchEvent(
                new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
            );
            let entries = container.querySelectorAll('.ez-handbook__entry');
            expect(entries.length).toBe(3);

            // Space key collapses
            const updatedHeader = container.querySelector(
                '.ez-handbook__category-header',
            ) as HTMLElement;
            updatedHeader.dispatchEvent(
                new KeyboardEvent('keydown', { key: ' ', bubbles: true }),
            );
            entries = container.querySelectorAll('.ez-handbook__entry');
            expect(entries.length).toBe(0);
        });
    });

    describe('concept entries', () => {
        it('shows concept name, definition, guidance, and rules when expanded', async () => {
            await handbook.init(container, toCtx(createEngine()), {
                expandAll: true,
            });

            const firstEntry = container.querySelector('.ez-handbook__entry')!;
            expect(
                firstEntry.querySelector('.ez-handbook__entry-name')!
                    .textContent,
            ).toBe('Alpha');
            expect(
                firstEntry.querySelector('.ez-handbook__section-text')!
                    .textContent,
            ).toBe('First letter of the Greek alphabet');

            const labels = [
                ...firstEntry.querySelectorAll('.ez-handbook__section-label'),
            ].map((l) => l.textContent);
            expect(labels).toContain('Description');
            expect(labels).toContain('Usage');
            expect(labels).toContain('Scheme rules');

            const rules = firstEntry.querySelectorAll('.ez-handbook__rule');
            expect(rules.length).toBe(1);
            expect(rules[0].textContent).toBe('Exclusive with Beta');
        });

        it('renders Description/Usage from flat ConceptView fields on the nested path', async () => {
            // The nested-category path builds its entries from
            // `getConceptsInCategory({ nested: true })` rather than from the flat
            // call, so it reaches the description and usage text by its own route.
            // Regression guard: that route has to render them too.
            const p = createProfile();
            const eng = createEngine(p);
            eng.getConceptsInCategory = (
                catId: string,
                opts?: { nested?: boolean },
            ) => {
                const inCat = ((p as any).concepts ?? []).filter((c: any) =>
                    c.categories?.includes(catId),
                );
                if (!opts?.nested) return inCat;
                return inCat.map((c: any) => ({
                    concept: {
                        id: c.id,
                        name: c.name,
                        views: c.views ?? {},
                        aliases: c.aliases ?? [],
                        categories: c.categories ?? [],
                        parents: c.parents ?? [],
                        position: c.position ?? 0,
                        // Flat view fields, NOT nested under `documentation`.
                        definition: c.documentation?.definition,
                        guidance: c.documentation?.guidance,
                    },
                    depth: 0,
                }));
            };
            await handbook.init(container, toCtx(eng), { expandAll: true });

            const firstEntry = container.querySelector('.ez-handbook__entry')!;
            const labels = [
                ...firstEntry.querySelectorAll('.ez-handbook__section-label'),
            ].map((l) => l.textContent);
            expect(labels).toContain('Description');
            expect(labels).toContain('Usage');
            expect(
                firstEntry.querySelector('.ez-handbook__section-text')!
                    .textContent,
            ).toBe('First letter of the Greek alphabet');
        });

        it('shows aliases and alternative views', async () => {
            await handbook.init(container, toCtx(createEngine()), {
                expandAll: true,
            });

            const firstEntry = container.querySelector('.ez-handbook__entry')!;
            const aliases = firstEntry.querySelector(
                '.ez-handbook__entry-aliases',
            );
            expect(aliases).toBeTruthy();
            expect(aliases!.textContent).toContain('A');
            expect(aliases!.textContent).toContain('al');
        });

        it('shows deprecated concepts with replacement info', async () => {
            await handbook.init(container, toCtx(createEngine()), {
                expandAll: true,
            });

            const entries = container.querySelectorAll('.ez-handbook__entry');
            const oldEntry = [...entries].find(
                (e) =>
                    e.querySelector('.ez-handbook__entry-name')?.textContent ===
                    'Old Concept',
            )!;
            const dep = oldEntry.querySelector('.ez-handbook__deprecated');
            expect(dep).toBeTruthy();
            expect(dep!.textContent).toContain('No longer valid');
            expect(dep!.textContent).toContain('Alpha');
        });

        it('lazy-loads rules from async engine when category is expanded', async () => {
            await handbook.init(container, toCtx(createAsyncEngine()));

            // Expand first category to trigger lazy load
            const header = container.querySelector(
                '.ez-handbook__category-header',
            ) as HTMLElement;
            header.click();

            // Rules are loaded async, wait for the re-render
            await new Promise((r) => setTimeout(r, 50));

            const firstEntry = container.querySelector('.ez-handbook__entry')!;
            const rules = firstEntry.querySelectorAll('.ez-handbook__rule');
            expect(rules.length).toBe(1);
            expect(rules[0].textContent).toBe('Exclusive with Beta');
        });

        it('shows notices with type-based styling', async () => {
            await handbook.init(container, toCtx(createEngine()), {
                expandAll: true,
            });

            // Find the Gamma entry (has notices)
            const entries = container.querySelectorAll('.ez-handbook__entry');
            const gammaEntry = [...entries].find(
                (e) =>
                    e.querySelector('.ez-handbook__entry-name')?.textContent ===
                    'Gamma',
            )!;
            const notices = gammaEntry.querySelectorAll('.ez-handbook__notice');
            expect(notices.length).toBe(2);
            expect(
                notices[0].classList.contains('ez-handbook__notice--warning'),
            ).toBe(true);
            expect(notices[0].textContent).toContain('Handle with care');
            expect(
                notices[1].classList.contains('ez-handbook__notice--handling'),
            ).toBe(true);
            expect(notices[1].textContent).toContain(
                'Special handling required',
            );
        });

        it('applies category color to entry border', async () => {
            await handbook.init(container, toCtx(createEngine()), {
                expandAll: true,
            });

            const entry = container.querySelector(
                '.ez-handbook__entry',
            ) as HTMLElement;
            expect(entry.hasAttribute('data-category-color')).toBe(true);
            expect(
                entry.style.getPropertyValue('--ez-entry-category-color'),
            ).toBeTruthy();
        });
    });

    describe('search', () => {
        it('filters concepts by search text', async () => {
            await handbook.init(container, toCtx(createEngine()), {
                expandAll: true,
            });

            const input = container.querySelector(
                '.ez-handbook__search-input',
            ) as HTMLInputElement;
            input.value = 'gamma';
            input.dispatchEvent(new Event('input'));

            const entries = container.querySelectorAll('.ez-handbook__entry');
            expect(entries.length).toBe(1);
            expect(
                entries[0].querySelector('.ez-handbook__entry-name')!
                    .textContent,
            ).toBe('Gamma');

            // Group One should be hidden (no matches)
            const headers = container.querySelectorAll(
                '.ez-handbook__category-header',
            );
            expect(headers.length).toBe(1);
            expect(headers[0].textContent).toContain('Group Two');
        });

        it('shows no-results message when filter has no matches', async () => {
            await handbook.init(container, toCtx(createEngine()));

            const input = container.querySelector(
                '.ez-handbook__search-input',
            ) as HTMLInputElement;
            input.value = 'zzzznonexistent';
            input.dispatchEvent(new Event('input'));

            const empty = container.querySelector('.ez-handbook__empty');
            expect(empty).toBeTruthy();
            expect(empty!.textContent).toContain('zzzznonexistent');
        });

        it('reveals matching concepts in collapsed categories', async () => {
            await handbook.init(container, toCtx(createEngine()));

            // Categories are collapsed by default
            expect(
                container.querySelectorAll('.ez-handbook__entry').length,
            ).toBe(0);

            // Search for something in f1
            const input = container.querySelector(
                '.ez-handbook__search-input',
            ) as HTMLInputElement;
            input.value = 'alpha';
            input.dispatchEvent(new Event('input'));

            // Should show the match even though the category is collapsed
            const entries = container.querySelectorAll('.ez-handbook__entry');
            expect(entries.length).toBe(1);
            expect(entries[0].textContent).toContain('Alpha');
        });

        it('searches by alias', async () => {
            await handbook.init(container, toCtx(createEngine()));

            const input = container.querySelector(
                '.ez-handbook__search-input',
            ) as HTMLInputElement;
            input.value = 'gam';
            input.dispatchEvent(new Event('input'));

            const entries = container.querySelectorAll('.ez-handbook__entry');
            expect(entries.length).toBe(1);
            expect(
                entries[0].querySelector('.ez-handbook__entry-name')!
                    .textContent,
            ).toBe('Gamma');
        });

        it('does not match on definition or guidance text', async () => {
            await handbook.init(container, toCtx(createEngine()));

            const input = container.querySelector(
                '.ez-handbook__search-input',
            ) as HTMLInputElement;
            input.value = 'greek';
            input.dispatchEvent(new Event('input'));

            const entries = container.querySelectorAll('.ez-handbook__entry');
            expect(entries.length).toBe(0);
        });
    });

    describe('scope tabs', () => {
        it('does not render scope tabs when profile has no scopes', async () => {
            await handbook.init(container, toCtx(createEngine()));

            const tabs = container.querySelectorAll('.ez-handbook__scope-tab');
            expect(tabs.length).toBe(0);
        });

        it('renders scope tabs when profile has multiple scopes', async () => {
            const scheme = createScopedProfile();
            await handbook.init(container, toCtx(createEngine(scheme)));

            const tabs = container.querySelectorAll('.ez-handbook__scope-tab');
            expect(tabs.length).toBe(2);
            expect(tabs[0].textContent).toBe('Main Marking');
            expect(tabs[1].textContent).toBe('Extra Block');
            // Default scope is active initially
            expect(tabs[0].getAttribute('aria-selected')).toBe('true');
            expect(tabs[1].getAttribute('aria-selected')).toBe('false');
        });

        it('default scope shows only unscoped categories', async () => {
            const scheme = createScopedProfile();
            await handbook.init(container, toCtx(createEngine(scheme)), {
                expandAll: true,
            });

            // Default scope 'main': only f1 (unscoped) should appear
            const headers = container.querySelectorAll(
                '.ez-handbook__category-header',
            );
            const categoryLabels = [...headers].map((h) => h.textContent);
            expect(categoryLabels.some((l) => l!.includes('Main'))).toBe(true);
            expect(categoryLabels.some((l) => l!.includes('Extra Only'))).toBe(
                false,
            );
            expect(categoryLabels.some((l) => l!.includes('Extra Items'))).toBe(
                false,
            );
        });

        it('switching scope shows scoped categories and hides unscoped ones', async () => {
            const scheme = createScopedProfile();
            await handbook.init(container, toCtx(createEngine(scheme)), {
                expandAll: true,
            });

            // Switch to 'extra' scope
            const tabs = container.querySelectorAll('.ez-handbook__scope-tab');
            (tabs[1] as HTMLElement).click();

            // 'extra' scope: f2 (scoped to extra) and f3 (scoped to extra) should appear
            // f1 (unscoped) should NOT appear (unscoped categories only in default scope)
            const headers = container.querySelectorAll(
                '.ez-handbook__category-header',
            );
            const categoryLabels = [...headers].map((h) => h.textContent);
            expect(categoryLabels.some((l) => l!.includes('Main'))).toBe(false);
            expect(categoryLabels.some((l) => l!.includes('Extra Only'))).toBe(
                true,
            );
            expect(categoryLabels.some((l) => l!.includes('Extra Items'))).toBe(
                true,
            );
        });

        it('concept-level scopes filter correctly', async () => {
            const scheme = createScopedProfile();
            await handbook.init(container, toCtx(createEngine(scheme)), {
                expandAll: true,
            });

            // Switch to 'extra' scope
            const tabs = container.querySelectorAll('.ez-handbook__scope-tab');
            (tabs[1] as HTMLElement).click();

            // Delta (scoped to 'extra') should appear in f3
            const entries = container.querySelectorAll('.ez-handbook__entry');
            const names = [...entries].map(
                (e) => e.querySelector('.ez-handbook__entry-name')!.textContent,
            );
            expect(names).toContain('Delta');
            expect(names).toContain('Gamma'); // unscoped concept in scoped category
        });

        it('updates tab aria-selected on switch', async () => {
            const scheme = createScopedProfile();
            await handbook.init(container, toCtx(createEngine(scheme)));

            const tabs = container.querySelectorAll('.ez-handbook__scope-tab');
            (tabs[1] as HTMLElement).click();

            expect(tabs[0].getAttribute('aria-selected')).toBe('false');
            expect(tabs[1].getAttribute('aria-selected')).toBe('true');
        });

        it('infers default scope from first scope when defaultScope is missing', async () => {
            const scheme = createScopedProfileNoDefault();
            await handbook.init(container, toCtx(createEngine(scheme)), {
                expandAll: true,
            });

            // Default scope inferred as 'main' (first scope), only f1 should appear
            const headers = container.querySelectorAll(
                '.ez-handbook__category-header',
            );
            const categoryLabels = [...headers].map((h) => h.textContent);
            expect(categoryLabels.some((l) => l!.includes('Main'))).toBe(true);
            expect(categoryLabels.some((l) => l!.includes('Extra Only'))).toBe(
                false,
            );

            // Switch to 'extra', scoped categories appear, unscoped f1 hidden
            const tabs = container.querySelectorAll('.ez-handbook__scope-tab');
            (tabs[1] as HTMLElement).click();

            const updatedHeaders = container.querySelectorAll(
                '.ez-handbook__category-header',
            );
            const updatedLabels = [...updatedHeaders].map((h) => h.textContent);
            expect(updatedLabels.some((l) => l!.includes('Main'))).toBe(false);
            expect(updatedLabels.some((l) => l!.includes('Extra Only'))).toBe(
                true,
            );
        });

        it('wraps content in a tabpanel with border', async () => {
            const scheme = createScopedProfile();
            await handbook.init(container, toCtx(createEngine(scheme)));

            const panel = container.querySelector('.ez-handbook__tab-panel');
            expect(panel).toBeTruthy();
            expect(panel!.getAttribute('role')).toBe('tabpanel');
            // Search and categories should be inside the panel
            expect(
                panel!.querySelector('.ez-handbook__search-input'),
            ).toBeTruthy();
            expect(panel!.querySelector('[role="list"]')).toBeTruthy();
        });

        it('uses unique tab panel ids across handbook instances', async () => {
            const scheme = createScopedProfile();
            await handbook.init(container, toCtx(createEngine(scheme)));

            const secondContainer = document.createElement('div');
            document.body.appendChild(secondContainer);
            const second = new Handbook();
            try {
                await second.init(secondContainer, toCtx(createEngine(scheme)));

                const panels = [
                    ...document.querySelectorAll('.ez-handbook__tab-panel'),
                ];
                const ids = panels.map((panel) => panel.id);
                expect(new Set(ids).size).toBe(ids.length);
                for (const tab of document.querySelectorAll(
                    '.ez-handbook__scope-tab',
                )) {
                    expect(ids).toContain(tab.getAttribute('aria-controls'));
                }
            } finally {
                second.destroy();
                secondContainer.remove();
            }
        });

        it('uses scopeLabel for the tablist aria-label', async () => {
            const scheme = createScopedProfile();
            await handbook.init(container, toCtx(createEngine(scheme)));

            const tablist = container.querySelector('[role="tablist"]');
            expect(tablist!.getAttribute('aria-label')).toBe('Context');
        });

        describe('WCAG 2.1.1 + 4.1.2: tab keyboard pattern', () => {
            it('only the active tab has tabIndex=0; inactive tabs have tabIndex=-1', async () => {
                const scheme = createScopedProfile();
                await handbook.init(container, toCtx(createEngine(scheme)));

                const tabs = Array.from(
                    container.querySelectorAll<HTMLElement>(
                        '.ez-handbook__scope-tab',
                    ),
                );
                expect(tabs[0].tabIndex).toBe(0); // active (main)
                expect(tabs[1].tabIndex).toBe(-1); // inactive (extra)
            });

            it('tabIndex updates when a tab is clicked', async () => {
                const scheme = createScopedProfile();
                await handbook.init(container, toCtx(createEngine(scheme)));

                const tabs = Array.from(
                    container.querySelectorAll<HTMLElement>(
                        '.ez-handbook__scope-tab',
                    ),
                );
                tabs[1].click();

                expect(tabs[0].tabIndex).toBe(-1); // was active, now inactive
                expect(tabs[1].tabIndex).toBe(0); // now active
            });

            it('ArrowRight moves focus to next tab and activates it', async () => {
                const scheme = createScopedProfile();
                await handbook.init(container, toCtx(createEngine(scheme)));

                const tabs = Array.from(
                    container.querySelectorAll<HTMLElement>(
                        '.ez-handbook__scope-tab',
                    ),
                );
                tabs[0].focus();

                const tablist = container.querySelector('[role="tablist"]')!;
                tablist.dispatchEvent(
                    new KeyboardEvent('keydown', {
                        key: 'ArrowRight',
                        bubbles: true,
                    }),
                );

                expect(document.activeElement).toBe(tabs[1]);
                expect(tabs[1].getAttribute('aria-selected')).toBe('true');
                expect(tabs[0].getAttribute('aria-selected')).toBe('false');
            });

            it('ArrowLeft wraps from first tab to last', async () => {
                const scheme = createScopedProfile();
                await handbook.init(container, toCtx(createEngine(scheme)));

                const tabs = Array.from(
                    container.querySelectorAll<HTMLElement>(
                        '.ez-handbook__scope-tab',
                    ),
                );
                tabs[0].focus();

                const tablist = container.querySelector('[role="tablist"]')!;
                tablist.dispatchEvent(
                    new KeyboardEvent('keydown', {
                        key: 'ArrowLeft',
                        bubbles: true,
                    }),
                );

                expect(document.activeElement).toBe(tabs[tabs.length - 1]);
                expect(
                    tabs[tabs.length - 1].getAttribute('aria-selected'),
                ).toBe('true');
            });

            it('ArrowRight wraps from last tab to first', async () => {
                const scheme = createScopedProfile();
                await handbook.init(container, toCtx(createEngine(scheme)));

                const tabs = Array.from(
                    container.querySelectorAll<HTMLElement>(
                        '.ez-handbook__scope-tab',
                    ),
                );
                tabs[0].click(); // activate first, then move to last
                tabs[tabs.length - 1].focus();

                const tablist = container.querySelector('[role="tablist"]')!;
                tablist.dispatchEvent(
                    new KeyboardEvent('keydown', {
                        key: 'ArrowRight',
                        bubbles: true,
                    }),
                );

                expect(document.activeElement).toBe(tabs[0]);
                expect(tabs[0].getAttribute('aria-selected')).toBe('true');
            });

            it('each tab has aria-controls pointing to the tab panel', async () => {
                const scheme = createScopedProfile();
                await handbook.init(container, toCtx(createEngine(scheme)));

                const tabs = Array.from(
                    container.querySelectorAll<HTMLElement>('[role="tab"]'),
                );
                expect(tabs.length).toBeGreaterThan(0);
                for (const tab of tabs) {
                    const panelId = tab.getAttribute('aria-controls');
                    expect(panelId).toBeTruthy();
                    const panel = document.getElementById(panelId!);
                    expect(panel).not.toBeNull();
                    expect(panel!.getAttribute('role')).toBe('tabpanel');
                }
            });

            it('each tab has a stable id attribute', async () => {
                const scheme = createScopedProfile();
                await handbook.init(container, toCtx(createEngine(scheme)));

                const tabs = Array.from(
                    container.querySelectorAll<HTMLElement>('[role="tab"]'),
                );
                for (const tab of tabs) {
                    expect(tab.id).toMatch(/^ez-handbook-tab-/);
                }
            });
        });
    });

    describe('accessibility', () => {
        it('has proper ARIA attributes', async () => {
            await handbook.init(container, toCtx(createEngine()));

            const region = container.querySelector('[role="region"]');
            expect(region).toBeTruthy();
            expect(region!.getAttribute('aria-label')).toBe('Scheme handbook');

            const searchInput = container.querySelector(
                '.ez-handbook__search-input',
            );
            expect(searchInput!.getAttribute('aria-label')).toBe(
                'Search handbook concepts',
            );

            const headers = container.querySelectorAll(
                '.ez-handbook__category-header',
            );
            expect(headers[0].getAttribute('role')).toBe('button');
            expect(headers[0].getAttribute('aria-expanded')).toBe('false');
            expect(headers[0].getAttribute('tabindex')).toBe('0');
        });

        it("uses the scheme's renamed reference-surface noun in ARIA labels when declared", async () => {
            const renamed = {
                ...createProfile(),
                referenceSurfaceLabel: {
                    singular: 'Shelving Guide',
                    plural: 'Shelving Guides',
                },
            } as unknown as Scheme;
            await handbook.init(container, toCtx(createEngine(renamed)));

            const region = container.querySelector('[role="region"]');
            expect(region!.getAttribute('aria-label')).toBe('Shelving Guide');

            const searchInput = container.querySelector(
                '.ez-handbook__search-input',
            );
            expect(searchInput!.getAttribute('aria-label')).toBe(
                'Search Shelving Guide concepts',
            );
        });

        it('entries have article role and are focusable', async () => {
            await handbook.init(container, toCtx(createEngine()), {
                expandAll: true,
            });

            const entries = container.querySelectorAll('.ez-handbook__entry');
            expect(entries[0].getAttribute('role')).toBe('article');
            expect(entries[0].getAttribute('tabindex')).toBe('0');
        });
    });

    describe('lifecycle', () => {
        it('cleans up DOM on destroy', async () => {
            await handbook.init(container, toCtx(createEngine()));

            expect(container.children.length).toBeGreaterThan(0);
            handbook.destroy();
            expect(container.innerHTML).toBe('');
        });
    });

    describe('context re-bind', () => {
        it('renders pantry scheme categories and concepts', async () => {
            const ctxA = toCtx(loadPantry());
            await handbook.init(container, ctxA, { expandAll: true });

            const headers = [
                ...container.querySelectorAll('.ez-handbook__category-header'),
            ];
            const headerText = headers.map((h) => h.textContent ?? '');
            expect(headerText.some((t) => t.includes('Allergen Tags'))).toBe(
                true,
            );

            const entries = [
                ...container.querySelectorAll('.ez-handbook__entry-name'),
            ];
            const entryNames = entries.map((e) => e.textContent ?? '');
            expect(entryNames.some((n) => n.includes('Gluten'))).toBe(true);
        });

        it('fully re-renders on Context change: cedarValley content appears, pantry content disappears', async () => {
            const ctxA = toCtx(loadPantry());
            await handbook.init(container, ctxA, { expandAll: true });

            // Sanity: pantry content visible before re-bind
            expect(container.textContent).toContain('Allergen Tags');
            expect(container.textContent).toContain('Gluten');

            // Re-bind to cedarValley context
            handbook.destroy();
            const ctxB = toCtx(loadCedarValley());
            await handbook.init(container, ctxB, { expandAll: true });

            // CedarValley category and concept must appear
            const headers = [
                ...container.querySelectorAll('.ez-handbook__category-header'),
            ];
            const headerText = headers.map((h) => h.textContent ?? '');
            expect(headerText.some((t) => t.includes('Protection'))).toBe(true);

            const entries = [
                ...container.querySelectorAll('.ez-handbook__entry-name'),
            ];
            const entryNames = entries.map((e) => e.textContent ?? '');
            expect(entryNames.some((n) => n.includes('Restricted'))).toBe(true);

            // Pantry-specific content must be gone
            expect(headerText.some((t) => t.includes('Allergen Tags'))).toBe(
                false,
            );
            expect(entryNames.some((n) => n.includes('Gluten'))).toBe(false);
        });
    });
});
