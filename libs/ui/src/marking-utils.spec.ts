import { describe, it, expect, vi } from 'vitest';
import {
    assembleWithConcept,
    findUnambiguousMatch,
    groupSuggestionsWithDepth,
    getConceptDepth,
} from './marking-utils';
import {
    mockRenderFormats,
    type MockFormatFixture,
} from './render-format-layout-mock';

function makeConcept(overrides: Record<string, any> = {}) {
    return {
        id: overrides.id ?? 'c1',
        name: overrides.name ?? 'Concept One',
        views: overrides.views ?? { default: 'C1' },
        aliases: overrides.aliases ?? [],
        categories: overrides.categories ?? ['cat-a'],
        parents: overrides.parents ?? [],
        position: overrides.position ?? 0,
        ...overrides,
    };
}

/** A format that writes one heading concept ahead of the list it heads. */
function ownedCategoryFormat(
    concept: string,
    ownerCategory: string,
    ownedCategory: string,
): MockFormatFixture {
    return {
        id: 'default',
        categoryOrder: [ownerCategory, ownedCategory],
        categorySeparator: '//',
        separator: ', ',
        headers: [
            {
                concept,
                headerCategory: ownerCategory,
                category: ownedCategory,
                position: 'prefix',
            },
        ],
    };
}

function makeProfile(overrides: Record<string, any> = {}) {
    const concepts = overrides.concepts ?? [];
    // Auto-derive categories from concepts if not explicitly provided
    const derivedCategories =
        overrides.categories ??
        (() => {
            const catIds = new Set<string>();
            for (const c of concepts) {
                for (const catId of c.categories ?? []) catIds.add(catId);
            }
            return Array.from(catIds).map((id) => ({
                id,
                label: id,
                single: false,
                required: false,
            }));
        })();
    const formats: MockFormatFixture[] = overrides.formats ?? [
        {
            id: 'default',
            view: 'default',
            categorySeparator: '//',
            separator: ', ',
            categoryOrder: derivedCategories.map(
                (category: { id: string }) => category.id,
            ),
        },
    ];
    return {
        id: 'test',
        version: '1.0.0',
        name: 'Test',
        referenceSurfaceLabel: {
            singular: 'Handbook',
            plural: 'Handbooks',
        },
        concepts,
        categories: derivedCategories,
        defaultRenderFormat: overrides.defaultRenderFormat ?? 'default',
        ...overrides,
        // The fixtures in `overrides.formats` are resolved, never spread raw.
        formats: mockRenderFormats(formats),
    };
}

function makeEngine(
    profileOverrides: Record<string, any> = {},
    engineOverrides: Record<string, any> = {},
) {
    const scheme = makeProfile(profileOverrides);
    const concepts: any[] = scheme.concepts;
    const categories: any[] = scheme.categories;
    const categoryMap = new Map(
        categories.map((c: any) => [
            c.id,
            concepts.filter((co: any) => co.categories?.includes(c.id)),
        ]),
    );
    return {
        getScheme: () => scheme,
        getSchemeMeta: () => scheme,
        listCategories: () => categories,
        getConceptsInCategory: (catId: string) =>
            categoryMap.get(catId) ??
            concepts.filter((c: any) => c.categories?.includes(catId)),
        suggest: vi.fn().mockReturnValue({ suggestions: [] }),
        process: vi.fn().mockReturnValue({ assertions: [], rendered: '' }),
        render: vi.fn().mockReturnValue(''),
        ...engineOverrides,
    } as any;
}

function makeSuggestion(overrides: Record<string, any> = {}): any {
    return {
        conceptId: overrides.conceptId ?? 'c1',
        categoryId: overrides.categoryId ?? 'cat-a',
        label: overrides.label ?? 'Concept One',
        description: overrides.description ?? '',
        name: overrides.name ?? 'Concept One',
        views: overrides.views ?? { default: 'C1' },
        group: overrides.group ?? 'Group A',
        selected: overrides.selected ?? false,
        order: overrides.order ?? 0,
        ...overrides,
    };
}

describe('assembleWithConcept', () => {
    it('returns just the label when existing is empty', () => {
        const engine = makeEngine({
            concepts: [makeConcept({ id: 'c1', views: { default: 'ALPHA' } })],
        });
        expect(assembleWithConcept(engine, '', 'c1')).toBe('ALPHA');
    });

    it('appends with category separator when no target category', () => {
        const engine = makeEngine({
            concepts: [makeConcept({ id: 'c1', views: { default: 'ALPHA' } })],
        });
        expect(assembleWithConcept(engine, 'EXISTING', 'c1')).toBe(
            'EXISTING//ALPHA',
        );
    });

    it('uses custom category separator from format', () => {
        const engine = makeEngine({
            concepts: [makeConcept({ id: 'c1', views: { default: 'ALPHA' } })],
            formats: [
                {
                    id: 'custom',
                    view: 'default',
                    categorySeparator: ' | ',
                    categoryOrder: ['cat-a'],
                },
            ],
            defaultRenderFormat: 'custom',
        });
        expect(assembleWithConcept(engine, 'EXISTING', 'c1')).toBe(
            'EXISTING | ALPHA',
        );
    });

    it('falls back to conceptId when concept has no views', () => {
        const engine = makeEngine({
            concepts: [makeConcept({ id: 'c1', views: {} })],
        });
        expect(assembleWithConcept(engine, '', 'c1')).toBe('c1');
    });

    it('falls back to conceptId when concept is not found', () => {
        const engine = makeEngine({ concepts: [] });
        expect(assembleWithConcept(engine, '', 'missing')).toBe('missing');
    });

    it('inserts within section when header is present and separator follows', () => {
        const header = makeConcept({
            id: 'h1',
            views: { default: 'HDR' },
            categories: ['headers'],
        });
        const child = makeConcept({
            id: 'c1',
            views: { default: 'CHILD' },
            parents: ['h1'],
            aliases: [],
            categories: ['cat-a'],
        });
        const engine = makeEngine({
            concepts: [header, child],
            formats: [ownedCategoryFormat('h1', 'headers', 'cat-a')],
        });
        const result = assembleWithConcept(
            engine,
            'HDR, X//OTHER',
            'c1',
            'cat-a',
        );
        expect(result).toBe('HDR, X, CHILD//OTHER');
    });

    it('appends when header is found but no separator follows', () => {
        const header = makeConcept({
            id: 'h1',
            views: { default: 'HDR' },
            categories: ['headers'],
        });
        const child = makeConcept({
            id: 'c1',
            views: { default: 'CHILD' },
            parents: ['h1'],
            aliases: [],
            categories: ['cat-a'],
        });
        const engine = makeEngine({
            concepts: [header, child],
            formats: [ownedCategoryFormat('h1', 'headers', 'cat-a')],
        });
        const result = assembleWithConcept(engine, 'HDR, X', 'c1', 'cat-a');
        expect(result).toBe('HDR, X, CHILD');
    });

    it('uses specified formatId to resolve view key', () => {
        const engine = makeEngine({
            concepts: [
                makeConcept({
                    id: 'c1',
                    views: { default: 'DEF', short: 'SH' },
                }),
            ],
            formats: [
                {
                    id: 'default',
                    view: 'default',
                    categorySeparator: '//',
                    categoryOrder: ['cat-a'],
                },
                {
                    id: 'short',
                    view: 'short',
                    categorySeparator: '//',
                    categoryOrder: ['cat-a'],
                },
            ],
        });
        expect(assembleWithConcept(engine, '', 'c1', undefined, 'short')).toBe(
            'SH',
        );
    });
});

describe('findUnambiguousMatch', () => {
    it('returns the single match when exactly one concept matches', () => {
        const s = makeSuggestion({
            conceptId: 'c1',
            categoryId: 'cat-a',
            label: 'Alpha',
            name: 'Alpha',
            views: { default: 'ALPHA' },
        });
        const engine = makeEngine(
            {},
            {
                suggest: vi.fn().mockReturnValue({ suggestions: [s] }),
            },
        );
        const result = findUnambiguousMatch(engine, '', 'alpha');
        expect(result).toEqual({ conceptId: 'c1', categoryId: 'cat-a' });
    });

    it('returns null when no suggestions match', () => {
        const engine = makeEngine(
            {},
            {
                suggest: vi.fn().mockReturnValue({ suggestions: [] }),
            },
        );
        expect(findUnambiguousMatch(engine, '', 'nothing')).toBeNull();
    });

    it('returns null when multiple concepts match (ambiguous)', () => {
        const s1 = makeSuggestion({
            conceptId: 'c1',
            label: 'Alpha',
            name: 'Alpha',
            views: { default: 'Alpha' },
        });
        const s2 = makeSuggestion({
            conceptId: 'c2',
            label: 'Alpha',
            name: 'Alpha',
            views: { default: 'Alpha' },
        });
        const engine = makeEngine(
            {},
            {
                suggest: vi.fn().mockReturnValue({ suggestions: [s1, s2] }),
            },
        );
        expect(findUnambiguousMatch(engine, '', 'Alpha')).toBeNull();
    });

    it('skips already-selected suggestions', () => {
        const s = makeSuggestion({
            conceptId: 'c1',
            label: 'Alpha',
            name: 'Alpha',
            views: { default: 'Alpha' },
            selected: true,
        });
        const engine = makeEngine(
            {},
            {
                suggest: vi.fn().mockReturnValue({ suggestions: [s] }),
            },
        );
        expect(findUnambiguousMatch(engine, '', 'Alpha')).toBeNull();
    });

    it('matches case-insensitively on conceptId', () => {
        const s = makeSuggestion({
            conceptId: 'myId',
            label: 'Other',
            name: 'Other',
            views: { default: 'Other' },
        });
        const engine = makeEngine(
            {},
            {
                suggest: vi.fn().mockReturnValue({ suggestions: [s] }),
            },
        );
        expect(findUnambiguousMatch(engine, '', 'MYID')).toEqual({
            conceptId: 'myId',
            categoryId: 'cat-a',
        });
    });

    it('passes formatId to suggest options', () => {
        const suggestFn = vi.fn().mockReturnValue({ suggestions: [] });
        const engine = makeEngine({}, { suggest: suggestFn });
        findUnambiguousMatch(engine, 'val', 'x', 'my-format');
        expect(suggestFn).toHaveBeenCalledWith('val', {
            outputFormat: 'my-format',
        });
    });
});

describe('groupSuggestionsWithDepth', () => {
    it('returns empty array for empty suggestions', () => {
        expect(groupSuggestionsWithDepth([], makeProfile())).toEqual([]);
    });

    it('groups suggestions by their group property', () => {
        const suggestions = [
            makeSuggestion({ group: 'A', conceptId: 'c1' }),
            makeSuggestion({ group: 'A', conceptId: 'c2' }),
            makeSuggestion({ group: 'B', conceptId: 'c3' }),
        ];
        const scheme = makeProfile({
            concepts: [
                makeConcept({ id: 'c1' }),
                makeConcept({ id: 'c2' }),
                makeConcept({ id: 'c3' }),
            ],
            categories: [{ id: 'cat-a', label: 'A', hierarchyRoot: false }],
        });
        const groups = groupSuggestionsWithDepth(suggestions, scheme);
        expect(groups).toHaveLength(2);
        expect(groups[0].label).toBe('A');
        expect(groups[0].items).toHaveLength(2);
        expect(groups[1].label).toBe('B');
        expect(groups[1].items).toHaveLength(1);
    });

    it('assigns sequential globalIndex across groups', () => {
        const suggestions = [
            makeSuggestion({ group: 'A', conceptId: 'c1' }),
            makeSuggestion({ group: 'B', conceptId: 'c2' }),
        ];
        const scheme = makeProfile({
            concepts: [makeConcept({ id: 'c1' }), makeConcept({ id: 'c2' })],
            categories: [],
        });
        const groups = groupSuggestionsWithDepth(suggestions, scheme);
        expect(groups[0].items[0].globalIndex).toBe(0);
        expect(groups[1].items[0].globalIndex).toBe(1);
    });

    it('uses name as secondary when different from primary', () => {
        const s = makeSuggestion({
            views: { default: 'Label' },
            name: 'Full Name',
        });
        const scheme = makeProfile({
            concepts: [makeConcept({ id: 'c1' })],
            categories: [],
        });
        const groups = groupSuggestionsWithDepth([s], scheme);
        expect(groups[0].items[0].primary).toBe('Label');
        expect(groups[0].items[0].secondary).toBe('Full Name');
    });

    it('uses description as secondary when name matches primary', () => {
        const s = makeSuggestion({
            views: { default: 'Same' },
            name: 'Same',
            description: 'A description',
        });
        const scheme = makeProfile({
            concepts: [makeConcept({ id: 'c1' })],
            categories: [],
        });
        const groups = groupSuggestionsWithDepth([s], scheme);
        expect(groups[0].items[0].secondary).toBe('A description');
    });

    it('sets empty secondary when name and description match primary', () => {
        const s = makeSuggestion({
            views: { default: 'Same' },
            name: 'Same',
            description: 'Same',
        });
        const scheme = makeProfile({
            concepts: [makeConcept({ id: 'c1' })],
            categories: [],
        });
        const groups = groupSuggestionsWithDepth([s], scheme);
        expect(groups[0].items[0].secondary).toBe('');
    });
});

describe('getConceptDepth', () => {
    it('returns 0 for a root concept with no parents', () => {
        const scheme = makeProfile({
            concepts: [makeConcept({ id: 'c1', parents: [] })],
            categories: [{ id: 'cat-a', label: 'A' }],
        });
        expect(getConceptDepth('c1', 'cat-a', scheme)).toBe(0);
    });

    it('returns 1 when concept has one parent in the same category', () => {
        const scheme = makeProfile({
            concepts: [
                makeConcept({
                    id: 'parent',
                    parents: [],
                    categories: ['cat-a'],
                }),
                makeConcept({
                    id: 'child',
                    parents: ['parent'],
                    categories: ['cat-a'],
                }),
            ],
            categories: [{ id: 'cat-a', label: 'A' }],
        });
        expect(getConceptDepth('child', 'cat-a', scheme)).toBe(1);
    });

    it('returns 2 for a grandchild', () => {
        const scheme = makeProfile({
            concepts: [
                makeConcept({ id: 'root', parents: [], categories: ['cat-a'] }),
                makeConcept({
                    id: 'mid',
                    parents: ['root'],
                    categories: ['cat-a'],
                }),
                makeConcept({
                    id: 'leaf',
                    parents: ['mid'],
                    categories: ['cat-a'],
                }),
            ],
            categories: [{ id: 'cat-a', label: 'A' }],
        });
        expect(getConceptDepth('leaf', 'cat-a', scheme)).toBe(2);
    });

    it('stops at hierarchy root', () => {
        const scheme = makeProfile({
            concepts: [
                makeConcept({ id: 'root', parents: [], categories: ['cat-a'] }),
                makeConcept({
                    id: 'child',
                    parents: ['root'],
                    categories: ['cat-a'],
                }),
            ],
            categories: [{ id: 'cat-a', label: 'A', hierarchyRoot: true }],
        });
        expect(getConceptDepth('child', 'cat-a', scheme)).toBe(0);
    });

    it('returns 0 when concept is not found', () => {
        const scheme = makeProfile({ concepts: [], categories: [] });
        expect(getConceptDepth('missing', 'cat-a', scheme)).toBe(0);
    });

    it('counts a parent that governs the category in the format tree', () => {
        const scheme = makeProfile({
            concepts: [
                makeConcept({
                    id: 'header',
                    parents: [],
                    categories: ['headers'],
                }),
                makeConcept({
                    id: 'child',
                    parents: ['header'],
                    categories: ['cat-a'],
                }),
            ],
            categories: [{ id: 'cat-a', label: 'A' }],
            formats: [ownedCategoryFormat('header', 'headers', 'cat-a')],
        });
        expect(getConceptDepth('child', 'cat-a', scheme)).toBe(1);
    });
});
