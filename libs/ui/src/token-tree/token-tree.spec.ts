import { describe, it, expect } from 'vitest';
import {
    buildTokenTree,
    flattenTree,
    collectAssertions,
    TokenTree,
    TokenNode,
} from './token-tree';
import type {
    SchemePublicView,
    CategoryView,
    ConceptView,
    EachAffix,
    FormatHeaderAssociation,
    RenderFormatLayout,
    TierComposition,
    Assertion,
} from '@ezclassify/types';

/**
 * The scheme facts `buildTokenTree` reads, in one object: concepts and
 * categories from the scheme view, render-format layouts from the metadata
 * view. The two arrive from different adapter calls in real use; a fixture
 * carrying both is what lets a case state one scheme.
 */
type TokenTreeFixture = Pick<SchemePublicView, 'concepts' | 'categories'> & {
    formats: RenderFormatLayout[];
    defaultRenderFormat: string;
};

function createFormat(
    categoryOrder: string[],
    options: {
        valueSeparator?: string;
        fieldSeparator?: string;
        view?: string;
        separatorBefore?: Record<string, string>;
        headers?: FormatHeaderAssociation[];
        /** Concept view per category, where it differs from the format's. */
        categoryViews?: Record<string, string>;
        /** Tier compositions per category, outermost tier first. */
        tiers?: Record<string, TierComposition[]>;
        /** What the format writes around every value, per category. */
        each?: Record<string, EachAffix>;
    } = {},
): RenderFormatLayout {
    return {
        id: 'default',
        surface: 'default',
        mode: 'inline',
        separator: options.fieldSeparator ?? '//',
        view: options.view ?? 'default',
        categoryOrder,
        categorySeparators: Object.fromEntries(
            categoryOrder.map((category) => [
                category,
                options.valueSeparator ?? ' ',
            ]),
        ),
        separatorBefore: options.separatorBefore,
        headers: options.headers,
        categoryViews: options.categoryViews,
        categoryTiers: options.tiers,
        categoryEach: options.each,
    };
}

function createProfile(
    overrides: Partial<TokenTreeFixture> = {},
): TokenTreeFixture {
    return {
        concepts: [],
        categories: [],
        formats: [createFormat([])],
        defaultRenderFormat: 'default',
        ...overrides,
    };
}

/**
 * A category with the members the tree builder reads; `required`, `single`, and
 * `rollup` are contract members no case here varies.
 */
function createCategory(overrides: Partial<CategoryView> = {}): CategoryView {
    return {
        id: 'f1',
        label: 'F1',
        required: false,
        single: false,
        rollup: 'max',
        ...overrides,
    };
}

function createConcept(overrides: Partial<ConceptView> = {}): ConceptView {
    return {
        id: 'c1',
        name: 'Concept1',
        views: { default: 'C1' },
        categories: ['f1'],
        parents: [],
        aliases: [],
        position: 0,
        ...overrides,
    };
}

function createAssertion(overrides: Partial<Assertion> = {}): Assertion {
    return {
        conceptId: 'c1',
        categoryId: 'f1',
        confidence: 'certain',
        source: 'user',
        ...overrides,
    } as Assertion;
}

describe('token-tree', () => {
    describe('buildTokenTree', () => {
        it('returns empty groups for no assertions', () => {
            const scheme = createProfile({
                categories: [createCategory({ id: 'f1', label: 'F1' })],
                formats: [createFormat(['f1'])],
            });

            const tree = buildTokenTree([], scheme, scheme);
            expect(tree.groups).toHaveLength(0);
        });

        it('creates a single group for single-category assertions', () => {
            const scheme = createProfile({
                concepts: [
                    createConcept({
                        id: 'c1',
                        views: { default: 'C1' },
                        categories: ['f1'],
                        position: 1,
                    }),
                ],
                categories: [createCategory({ id: 'f1', label: 'F1' })],
                formats: [createFormat(['f1'])],
            });

            const assertions = [
                createAssertion({ conceptId: 'c1', categoryId: 'f1' }),
            ];
            const tree = buildTokenTree(assertions, scheme, scheme);

            expect(tree.groups).toHaveLength(1);
            expect(tree.groups[0].categoryId).toBe('f1');
            expect(tree.groups[0].tokens).toHaveLength(1);
            expect(tree.groups[0].tokens[0].conceptId).toBe('c1');
        });

        it('preserves supplied category order over format order', () => {
            const scheme = createProfile({
                concepts: [
                    createConcept({
                        id: 'c1',
                        views: { default: 'C1' },
                        categories: ['f1'],
                        position: 1,
                    }),
                    createConcept({
                        id: 'c2',
                        views: { default: 'C2' },
                        categories: ['f2'],
                        position: 2,
                    }),
                ],
                categories: [
                    createCategory({ id: 'f1', label: 'F1' }),
                    createCategory({ id: 'f2', label: 'F2' }),
                ],
                formats: [createFormat(['f2', 'f1'])],
            });

            const assertions = [
                createAssertion({ conceptId: 'c1', categoryId: 'f1' }),
                createAssertion({ conceptId: 'c2', categoryId: 'f2' }),
            ];
            const tree = buildTokenTree(assertions, scheme, scheme);

            expect(tree.groups).toHaveLength(2);
            expect(tree.groups[0].categoryId).toBe('f1');
            expect(tree.groups[1].categoryId).toBe('f2');
        });

        it('preserves repeated category runs around header-owned values', () => {
            const assertions = [
                createAssertion({ conceptId: 'REL', categoryId: 'control' }),
                createAssertion({ conceptId: 'USA', categoryId: 'countries' }),
                createAssertion({
                    conceptId: 'DISPLAY',
                    categoryId: 'control',
                }),
                createAssertion({
                    conceptId: 'GBR',
                    categoryId: 'displayCountries',
                }),
            ];
            const scheme = createProfile({
                concepts: assertions.map((a) =>
                    createConcept({
                        id: a.conceptId,
                        categories: [a.categoryId],
                    }),
                ),
                categories: ['control', 'countries', 'displayCountries'].map(
                    (id) => createCategory({ id }),
                ),
                formats: [
                    createFormat(['control', 'countries', 'displayCountries']),
                ],
            });
            const tree = buildTokenTree(assertions, scheme, scheme);
            expect(
                flattenTree(tree)
                    .filter((token) => token.node.conceptId)
                    .map((token) => token.node.conceptId),
            ).toEqual(assertions.map((a) => a.conceptId));
        });

        it('applies category separator between groups', () => {
            const scheme = createProfile({
                concepts: [
                    createConcept({
                        id: 'c1',
                        categories: ['f1'],
                        position: 1,
                    }),
                    createConcept({
                        id: 'c2',
                        categories: ['f2'],
                        position: 2,
                    }),
                ],
                categories: [
                    createCategory({ id: 'f1', label: 'F1' }),
                    createCategory({ id: 'f2', label: 'F2' }),
                ],
                formats: [createFormat(['f1', 'f2'])],
            });

            const assertions = [
                createAssertion({ conceptId: 'c1', categoryId: 'f1' }),
                createAssertion({ conceptId: 'c2', categoryId: 'f2' }),
            ];
            const tree = buildTokenTree(assertions, scheme, scheme);

            expect(tree.groups[0].separator).toBe('');
            expect(tree.groups[1].separator).toBe('//');
        });

        it('preserves supplied concept order over metadata positions', () => {
            const scheme = createProfile({
                concepts: [
                    createConcept({
                        id: 'c2',
                        views: { default: 'C2' },
                        categories: ['f1'],
                        position: 2,
                    }),
                    createConcept({
                        id: 'c1',
                        views: { default: 'C1' },
                        categories: ['f1'],
                        position: 1,
                    }),
                ],
                categories: [createCategory({ id: 'f1', label: 'F1' })],
                formats: [createFormat(['f1'], { valueSeparator: ', ' })],
            });

            const assertions = [
                createAssertion({ conceptId: 'c2', categoryId: 'f1' }),
                createAssertion({ conceptId: 'c1', categoryId: 'f1' }),
            ];
            const tree = buildTokenTree(assertions, scheme, scheme);

            expect(tree.groups[0].tokens[0].conceptId).toBe('c2');
            expect(tree.groups[0].tokens[1].conceptId).toBe('c1');
        });

        it('uses concept view for label', () => {
            const scheme = createProfile({
                concepts: [
                    createConcept({
                        id: 'c1',
                        views: { default: 'DISPLAY-LABEL' },
                        categories: ['f1'],
                        position: 1,
                    }),
                ],
                categories: [createCategory({ id: 'f1', label: 'F1' })],
                formats: [createFormat(['f1'])],
            });

            const assertions = [
                createAssertion({ conceptId: 'c1', categoryId: 'f1' }),
            ];
            const tree = buildTokenTree(assertions, scheme, scheme);

            expect(tree.groups[0].tokens[0].label).toBe('DISPLAY-LABEL');
        });

        it('marks inferred assertions', () => {
            const scheme = createProfile({
                concepts: [
                    createConcept({
                        id: 'c1',
                        categories: ['f1'],
                        position: 1,
                    }),
                ],
                categories: [createCategory({ id: 'f1', label: 'F1' })],
                formats: [createFormat(['f1'])],
            });

            const assertions = [
                createAssertion({
                    conceptId: 'c1',
                    categoryId: 'f1',
                    confidence: 'inferred',
                }),
            ];
            const tree = buildTokenTree(assertions, scheme, scheme);

            expect(tree.groups[0].tokens[0].inferred).toBe(true);
        });

        it('builds text value children', () => {
            const scheme = createProfile({
                concepts: [
                    createConcept({
                        id: 'c1',
                        categories: ['f1'],
                        position: 1,
                        textInput: { placeholder: 'Enter value' } as any,
                    }),
                ],
                categories: [createCategory({ id: 'f1', label: 'F1' })],
                formats: [createFormat(['f1'])],
            });

            const assertions = [
                createAssertion({
                    conceptId: 'c1',
                    categoryId: 'f1',
                    value: 'my-value',
                }),
            ];
            const tree = buildTokenTree(assertions, scheme, scheme);

            expect(tree.groups[0].tokens[0].children).toHaveLength(1);
            expect(tree.groups[0].tokens[0].children[0].isTextValue).toBe(true);
            expect(tree.groups[0].tokens[0].children[0].label).toBe('my-value');
        });

        it('skips empty categories', () => {
            const scheme = createProfile({
                concepts: [
                    createConcept({
                        id: 'c1',
                        categories: ['f1'],
                        position: 1,
                    }),
                ],
                categories: [
                    createCategory({ id: 'f1', label: 'F1' }),
                    createCategory({ id: 'f2', label: 'F2' }),
                ],
                formats: [createFormat(['f1', 'f2'])],
            });

            const assertions = [
                createAssertion({ conceptId: 'c1', categoryId: 'f1' }),
            ];
            const tree = buildTokenTree(assertions, scheme, scheme);

            expect(tree.groups).toHaveLength(1);
            expect(tree.groups[0].categoryId).toBe('f1');
        });

        it('leaves scheme-authored suppression to the adapter', () => {
            const scheme = createProfile({
                concepts: [
                    createConcept({
                        id: 'c1',
                        categories: ['f1'],
                        position: 1,
                    }),
                    createConcept({
                        id: 'c1-dup',
                        categories: ['f2'],
                        position: 1,
                    }),
                ],
                categories: [
                    createCategory({ id: 'f1', label: 'F1' }),
                    createCategory({
                        id: 'f2',
                        label: 'F2',
                    }),
                ],
                formats: [createFormat(['f1', 'f2'])],
            });

            // The public view intentionally carries no suppression policy.
            // TokenTree lays out the resolved assertions the adapter supplied.
            const assertions = [
                createAssertion({ conceptId: 'c1', categoryId: 'f1' }),
                createAssertion({ conceptId: 'c1', categoryId: 'f2' }),
            ];
            const tree = buildTokenTree(assertions, scheme, scheme);

            expect(tree.groups.map((g) => g.categoryId)).toEqual(['f1', 'f2']);
        });

        it('detects header concepts', () => {
            const scheme = createProfile({
                concepts: [
                    createConcept({
                        id: 'header-c',
                        categories: ['headers'],
                        position: 0,
                    }),
                    createConcept({
                        id: 'c1',
                        categories: ['f1'],
                        position: 1,
                    }),
                ],
                categories: [
                    createCategory({ id: 'headers', label: 'Headers' }),
                    createCategory({ id: 'f1', label: 'F1' }),
                ],
                formats: [
                    createFormat(['headers', 'f1'], {
                        headers: [
                            {
                                concept: 'header-c',
                                headerCategory: 'headers',
                                category: 'f1',
                                position: 'prefix',
                            },
                        ],
                    }),
                ],
            });

            const assertions = [
                createAssertion({
                    conceptId: 'header-c',
                    categoryId: 'headers',
                }),
                createAssertion({ conceptId: 'c1', categoryId: 'f1' }),
            ];
            const tree = buildTokenTree(assertions, scheme, scheme);

            expect(
                tree.groups.find((group) => group.categoryId === 'f1')
                    ?.headerConceptId,
            ).toBe('header-c');
        });

        it('uses fallback format when not specified', () => {
            const scheme = createProfile({
                concepts: [
                    createConcept({
                        id: 'c1',
                        categories: ['f1'],
                        position: 1,
                    }),
                ],
                categories: [createCategory({ id: 'f1', label: 'F1' })],
                defaultRenderFormat: 'default',
                formats: [createFormat(['f1'])],
            });

            const assertions = [
                createAssertion({ conceptId: 'c1', categoryId: 'f1' }),
            ];
            // No formatId passed, uses defaultRenderFormat
            const tree = buildTokenTree(assertions, scheme, scheme);

            expect(tree.groups).toHaveLength(1);
        });

        it('substitutes {value} in labels', () => {
            const scheme = createProfile({
                concepts: [
                    createConcept({
                        id: 'c1',
                        views: { default: 'PREFIX {value}' },
                        categories: ['f1'],
                        position: 1,
                        textInput: { placeholder: 'v' } as any,
                    }),
                ],
                categories: [createCategory({ id: 'f1', label: 'F1' })],
                formats: [createFormat(['f1'])],
            });

            const assertions = [
                createAssertion({
                    conceptId: 'c1',
                    categoryId: 'f1',
                    value: 'DATA',
                }),
            ];
            const tree = buildTokenTree(assertions, scheme, scheme);

            expect(tree.groups[0].tokens[0].label).toBe('PREFIX DATA');
        });

        it('nests subcompartments under a synthesized parent when only children are asserted', () => {
            // controls is a tiered category: compartment tokens join with '-',
            // subcompartments with ' '. Asserting two subcompartments (A-1, A-2)
            // whose parent A is itself unasserted should still produce a single
            // root token for A holding both children, the tree synthesizes the
            // parent so the rendered hierarchy stays intact.
            const scheme = createProfile({
                concepts: [
                    createConcept({
                        id: 'A',
                        views: { default: 'A' },
                        categories: ['controls'],
                        position: 1,
                        tier: 'compartment',
                    }),
                    createConcept({
                        id: 'A-1',
                        views: { default: '1' },
                        categories: ['controls'],
                        parents: ['A'],
                        aliases: [],
                        position: 1.1,
                        tier: 'subcompartment',
                    }),
                    createConcept({
                        id: 'A-2',
                        views: { default: '2' },
                        categories: ['controls'],
                        parents: ['A'],
                        aliases: [],
                        position: 1.2,
                        tier: 'subcompartment',
                    }),
                ],
                categories: [
                    createCategory({ id: 'controls', label: 'Controls' }),
                ],
                formats: [
                    createFormat(['controls'], {
                        valueSeparator: ', ',
                        tiers: {
                            controls: [
                                { tier: 'compartment', attachedBy: '-' },
                                { tier: 'subcompartment', attachedBy: ' ' },
                            ],
                        },
                    }),
                ],
            });

            const assertions = [
                createAssertion({ conceptId: 'A-1', categoryId: 'controls' }),
                createAssertion({ conceptId: 'A-2', categoryId: 'controls' }),
            ];
            const tree = buildTokenTree(assertions, scheme, scheme);

            expect(tree.groups).toHaveLength(1);
            const root = tree.groups[0].tokens[0];
            expect(tree.groups[0].tokens).toHaveLength(1);
            expect(root.conceptId).toBe('A');
            expect(root.label).toBe('A');
            expect(root.children).toHaveLength(2);
            expect(root.children[0].label).toBe('1');
            expect(root.children[0].separator).toBe(' ');
            expect(root.children[1].label).toBe('2');
            expect(root.children[1].separator).toBe(' ');
        });

        it('writes a category in its own view where the format gives it one', () => {
            // One format writing a level spelled out beside a control in its
            // short spelling is the whole point of a per-category view.
            const scheme = createProfile({
                concepts: [
                    createConcept({
                        id: 'TOP',
                        views: { long: 'TOP SECRET', short: 'TS' },
                        categories: ['level'],
                        position: 1,
                    }),
                    createConcept({
                        id: 'A',
                        views: { long: 'ALPHA', short: 'A' },
                        categories: ['controls'],
                        position: 1,
                    }),
                ],
                categories: [
                    createCategory({ id: 'level', label: 'Level' }),
                    createCategory({ id: 'controls', label: 'Controls' }),
                ],
                formats: [
                    createFormat(['level', 'controls'], {
                        view: 'long',
                        categoryViews: { controls: 'short' },
                    }),
                ],
            });

            const tree = buildTokenTree(
                [
                    createAssertion({ conceptId: 'TOP', categoryId: 'level' }),
                    createAssertion({ conceptId: 'A', categoryId: 'controls' }),
                ],
                scheme,
                scheme,
            );

            expect(tree.groups[0].tokens[0].label).toBe('TOP SECRET');
            expect(tree.groups[1].tokens[0].label).toBe('A');
        });

        it('composes tiered children onto a head that was itself asserted', () => {
            const scheme = createProfile({
                concepts: [
                    createConcept({
                        id: 'A',
                        views: { default: 'A' },
                        categories: ['controls'],
                        position: 1,
                        tier: 'compartment',
                    }),
                    createConcept({
                        id: 'A-1',
                        views: { default: '1' },
                        categories: ['controls'],
                        parents: ['A'],
                        position: 1.1,
                        tier: 'subcompartment',
                    }),
                ],
                categories: [
                    createCategory({ id: 'controls', label: 'Controls' }),
                ],
                formats: [
                    createFormat(['controls'], {
                        valueSeparator: ', ',
                        tiers: {
                            controls: [
                                { tier: 'compartment', attachedBy: '-' },
                                { tier: 'subcompartment', attachedBy: ' ' },
                            ],
                        },
                    }),
                ],
            });

            const tree = buildTokenTree(
                [
                    createAssertion({ conceptId: 'A', categoryId: 'controls' }),
                    createAssertion({
                        conceptId: 'A-1',
                        categoryId: 'controls',
                    }),
                ],
                scheme,
                scheme,
            );

            expect(tree.groups[0].tokens).toHaveLength(1);
            const root = tree.groups[0].tokens[0];
            expect(root.conceptId).toBe('A');
            expect(root.assertion?.conceptId).toBe('A');
            expect(root.children.map((c) => c.conceptId)).toEqual(['A-1']);
            expect(root.children[0].depth).toBe(1);
        });

        it("writes a composed token's halves in the views its tier names", () => {
            // The boundary's word about the head position wins over the head's
            // own tier view, which is how the engine composes the same token.
            const scheme = createProfile({
                concepts: [
                    createConcept({
                        id: 'A',
                        views: {
                            default: 'A',
                            head: 'ALPHA',
                            compartment: 'Al',
                        },
                        categories: ['controls'],
                        position: 1,
                        tier: 'compartment',
                    }),
                    createConcept({
                        id: 'A-1',
                        views: { default: '1', child: 'ONE' },
                        categories: ['controls'],
                        parents: ['A'],
                        position: 1.1,
                        tier: 'subcompartment',
                    }),
                ],
                categories: [
                    createCategory({ id: 'controls', label: 'Controls' }),
                ],
                formats: [
                    createFormat(['controls'], {
                        tiers: {
                            controls: [
                                {
                                    tier: 'compartment',
                                    attachedBy: '-',
                                    view: 'compartment',
                                },
                                {
                                    tier: 'subcompartment',
                                    attachedBy: ' ',
                                    view: 'child',
                                    headView: 'head',
                                },
                            ],
                        },
                    }),
                ],
            });

            const tree = buildTokenTree(
                [
                    createAssertion({ conceptId: 'A', categoryId: 'controls' }),
                    createAssertion({
                        conceptId: 'A-1',
                        categoryId: 'controls',
                    }),
                ],
                scheme,
                scheme,
            );

            const root = tree.groups[0].tokens[0];
            expect(root.label).toBe('ALPHA');
            expect(root.children[0].label).toBe('ONE');
        });

        it('leaves an untiered concept in a tiered category standing on its own', () => {
            const scheme = createProfile({
                concepts: [
                    createConcept({
                        id: 'PLAIN',
                        views: { default: 'PLAIN' },
                        categories: ['controls'],
                        position: 0,
                    }),
                    createConcept({
                        id: 'A',
                        views: { default: 'A' },
                        categories: ['controls'],
                        position: 1,
                        tier: 'compartment',
                    }),
                ],
                categories: [
                    createCategory({ id: 'controls', label: 'Controls' }),
                ],
                formats: [
                    createFormat(['controls'], {
                        valueSeparator: ', ',
                        tiers: {
                            controls: [
                                { tier: 'compartment', attachedBy: '-' },
                            ],
                        },
                    }),
                ],
            });

            const tree = buildTokenTree(
                [
                    createAssertion({
                        conceptId: 'PLAIN',
                        categoryId: 'controls',
                    }),
                    createAssertion({ conceptId: 'A', categoryId: 'controls' }),
                ],
                scheme,
                scheme,
            );

            const tokens = tree.groups[0].tokens;
            expect(tokens.map((t) => t.conceptId)).toEqual(['PLAIN', 'A']);
            // A root-level token sits beside its neighbor, so it takes the
            // category's separator rather than its tier's attachment.
            expect(tokens[0].separator).toBe('');
            expect(tokens[1].separator).toBe(', ');
            expect(tokens[1].children).toEqual([]);
        });

        it('frames every value of a category that declares a per-value affix', () => {
            const scheme = createProfile({
                concepts: [
                    createConcept({
                        id: 'c1',
                        views: { default: 'C1' },
                        categories: ['f1'],
                        position: 1,
                    }),
                    createConcept({
                        id: 'c2',
                        views: { default: 'C2' },
                        categories: ['f1'],
                        position: 2,
                    }),
                ],
                categories: [createCategory({ id: 'f1', label: 'F1' })],
                formats: [
                    createFormat(['f1'], {
                        valueSeparator: '/',
                        each: { f1: { prefix: '(', suffix: ')' } },
                    }),
                ],
            });

            const tree = buildTokenTree(
                [
                    createAssertion({ conceptId: 'c1', categoryId: 'f1' }),
                    createAssertion({ conceptId: 'c2', categoryId: 'f1' }),
                ],
                scheme,
                scheme,
            );

            const tokens = tree.groups[0].tokens;
            // Every value, not the list: two tokens carry it and one separator
            // sits between them, so a surface writes it twice.
            expect(tokens.map((t) => t.each)).toEqual([
                { prefix: '(', suffix: ')' },
                { prefix: '(', suffix: ')' },
            ]);
            expect(tokens[1].separator).toBe('/');
            expect(
                tokens
                    .map(
                        (t, i) =>
                            `${i === 0 ? '' : t.separator}${t.each?.prefix ?? ''}${t.label}${t.each?.suffix ?? ''}`,
                    )
                    .join(''),
            ).toBe('(C1)/(C2)');
        });

        it('leaves a category that frames nothing without the member', () => {
            const scheme = createProfile({
                concepts: [
                    createConcept({
                        id: 'c1',
                        views: { default: 'C1' },
                        categories: ['f1'],
                        position: 1,
                    }),
                ],
                categories: [createCategory({ id: 'f1', label: 'F1' })],
                formats: [createFormat(['f1'])],
            });

            const tree = buildTokenTree(
                [createAssertion({ conceptId: 'c1', categoryId: 'f1' })],
                scheme,
                scheme,
            );

            expect(tree.groups[0].tokens[0].each).toBeUndefined();
        });

        it('frames a composed token once, not each half of it', () => {
            // The affix goes around a value, and a tier is attached inside the
            // value above it rather than being one of its own. Framing the
            // child too would write the marker in the middle of a token.
            const scheme = createProfile({
                concepts: [
                    createConcept({
                        id: 'A',
                        views: { default: 'A' },
                        categories: ['controls'],
                        position: 1,
                    }),
                    createConcept({
                        id: 'A-1',
                        views: { default: '1' },
                        categories: ['controls'],
                        parents: ['A'],
                        position: 1.1,
                        tier: 'sub',
                    }),
                ],
                categories: [
                    createCategory({ id: 'controls', label: 'Controls' }),
                ],
                formats: [
                    createFormat(['controls'], {
                        tiers: {
                            controls: [{ tier: 'sub', attachedBy: '-' }],
                        },
                        each: { controls: { prefix: 'SP-' } },
                    }),
                ],
            });

            const tree = buildTokenTree(
                [
                    createAssertion({ conceptId: 'A', categoryId: 'controls' }),
                    createAssertion({
                        conceptId: 'A-1',
                        categoryId: 'controls',
                    }),
                ],
                scheme,
                scheme,
            );

            const root = tree.groups[0].tokens[0];
            expect(root.each).toEqual({ prefix: 'SP-' });
            expect(root.children[0].each).toBeUndefined();
        });

        it('gives a tiered concept its own token when its head is not in the category', () => {
            const scheme = createProfile({
                concepts: [
                    createConcept({
                        id: 'ORPHAN',
                        views: { default: 'ORPHAN' },
                        categories: ['controls'],
                        parents: [],
                        position: 1,
                        tier: 'compartment',
                    }),
                ],
                categories: [
                    createCategory({ id: 'controls', label: 'Controls' }),
                ],
                formats: [
                    createFormat(['controls'], {
                        valueSeparator: ', ',
                        tiers: {
                            controls: [
                                { tier: 'compartment', attachedBy: '-' },
                            ],
                        },
                    }),
                ],
            });

            const tree = buildTokenTree(
                [
                    createAssertion({
                        conceptId: 'ORPHAN',
                        categoryId: 'controls',
                    }),
                ],
                scheme,
                scheme,
            );

            const tokens = tree.groups[0].tokens;
            expect(tokens).toHaveLength(1);
            expect(tokens[0].conceptId).toBe('ORPHAN');
            expect(tokens[0].depth).toBe(0);
            expect(tokens[0].children).toEqual([]);
        });

        it('uses custom betweenCategorySeparators', () => {
            const scheme = createProfile({
                concepts: [
                    createConcept({
                        id: 'c1',
                        categories: ['f1'],
                        position: 1,
                    }),
                    createConcept({
                        id: 'c2',
                        categories: ['f2'],
                        position: 2,
                    }),
                ],
                categories: [
                    createCategory({ id: 'f1', label: 'F1' }),
                    createCategory({ id: 'f2', label: 'F2' }),
                ],
                formats: [
                    createFormat(['f1', 'f2'], {
                        separatorBefore: { f2: '-' },
                    }),
                ],
            });

            const assertions = [
                createAssertion({ conceptId: 'c1', categoryId: 'f1' }),
                createAssertion({ conceptId: 'c2', categoryId: 'f2' }),
            ];
            const tree = buildTokenTree(assertions, scheme, scheme);

            expect(tree.groups[1].separator).toBe('-');
        });
    });

    describe('flattenTree', () => {
        it('returns empty list for empty tree', () => {
            const tree: TokenTree = { groups: [] };
            expect(flattenTree(tree)).toEqual([]);
        });

        it('flattens single group with single token', () => {
            const node: TokenNode = {
                key: 'f1::c1',
                conceptId: 'c1',
                categoryId: 'f1',
                label: 'C1',
                separator: '',
                depth: 0,
                children: [],
                position: 0,
            };
            const tree: TokenTree = {
                groups: [
                    {
                        categoryId: 'f1',
                        label: 'F1',
                        separator: '',
                        tokens: [node],
                    },
                ],
            };

            const flat = flattenTree(tree);
            expect(flat).toHaveLength(1);
            expect(flat[0].node).toBe(node);
            expect(flat[0].index).toBe(0);
            expect(flat[0].groupIndex).toBe(0);
        });

        it('flattens children recursively', () => {
            const child: TokenNode = {
                key: 'f1::c2',
                conceptId: 'c2',
                categoryId: 'f1',
                label: 'C2',
                separator: '-',
                depth: 1,
                children: [],
                position: 1,
            };
            const parent: TokenNode = {
                key: 'f1::c1',
                conceptId: 'c1',
                categoryId: 'f1',
                label: 'C1',
                separator: '',
                depth: 0,
                children: [child],
                position: 0,
            };
            const tree: TokenTree = {
                groups: [
                    {
                        categoryId: 'f1',
                        label: 'F1',
                        separator: '',
                        tokens: [parent],
                    },
                ],
            };

            const flat = flattenTree(tree);
            expect(flat).toHaveLength(2);
            expect(flat[0].node.conceptId).toBe('c1');
            expect(flat[1].node.conceptId).toBe('c2');
        });

        it('assigns correct groupIndex for multiple groups', () => {
            const node1: TokenNode = {
                key: 'f1::c1',
                conceptId: 'c1',
                categoryId: 'f1',
                label: 'C1',
                separator: '',
                depth: 0,
                children: [],
                position: 0,
            };
            const node2: TokenNode = {
                key: 'f2::c2',
                conceptId: 'c2',
                categoryId: 'f2',
                label: 'C2',
                separator: '',
                depth: 0,
                children: [],
                position: 0,
            };
            const tree: TokenTree = {
                groups: [
                    {
                        categoryId: 'f1',
                        label: 'F1',
                        separator: '',
                        tokens: [node1],
                    },
                    {
                        categoryId: 'f2',
                        label: 'F2',
                        separator: '//',
                        tokens: [node2],
                    },
                ],
            };

            const flat = flattenTree(tree);
            expect(flat).toHaveLength(2);
            expect(flat[0].groupIndex).toBe(0);
            expect(flat[1].groupIndex).toBe(1);
        });

        it('walks a real tiered tree depth-first (parent before its children)', () => {
            // Integration check over buildTokenTree output rather than hand-built
            // nodes: the synthesized compartment parent must come before its two
            // subcompartment children in the flattened navigation order.
            const scheme = createProfile({
                concepts: [
                    createConcept({
                        id: 'TOP',
                        views: { default: 'TOP' },
                        categories: ['level'],
                        position: 1,
                    }),
                    createConcept({
                        id: 'A',
                        views: { default: 'A' },
                        categories: ['controls'],
                        position: 1,
                        tier: 'compartment',
                    }),
                    createConcept({
                        id: 'A-1',
                        views: { default: '1' },
                        categories: ['controls'],
                        parents: ['A'],
                        aliases: [],
                        position: 1.1,
                        tier: 'subcompartment',
                    }),
                    createConcept({
                        id: 'A-2',
                        views: { default: '2' },
                        categories: ['controls'],
                        parents: ['A'],
                        aliases: [],
                        position: 1.2,
                        tier: 'subcompartment',
                    }),
                ],
                categories: [
                    createCategory({ id: 'level', label: 'Level' }),
                    createCategory({ id: 'controls', label: 'Controls' }),
                ],
                formats: [
                    createFormat(['level', 'controls'], {
                        valueSeparator: ', ',
                        tiers: {
                            controls: [
                                { tier: 'compartment', attachedBy: '-' },
                                { tier: 'subcompartment', attachedBy: ' ' },
                            ],
                        },
                    }),
                ],
            });

            const tree = buildTokenTree(
                [
                    createAssertion({ conceptId: 'TOP', categoryId: 'level' }),
                    createAssertion({
                        conceptId: 'A-1',
                        categoryId: 'controls',
                    }),
                    createAssertion({
                        conceptId: 'A-2',
                        categoryId: 'controls',
                    }),
                ],
                scheme,
                scheme,
            );

            const flat = flattenTree(tree);
            expect(flat.map((f) => f.node.conceptId)).toEqual([
                'TOP',
                'A',
                'A-1',
                'A-2',
            ]);
        });

        it('assigns sequential indices', () => {
            const n1: TokenNode = {
                key: '1',
                categoryId: 'f1',
                label: 'A',
                separator: '',
                depth: 0,
                children: [],
                position: 0,
            };
            const n2: TokenNode = {
                key: '2',
                categoryId: 'f1',
                label: 'B',
                separator: ' ',
                depth: 0,
                children: [],
                position: 1,
            };
            const n3: TokenNode = {
                key: '3',
                categoryId: 'f2',
                label: 'C',
                separator: '',
                depth: 0,
                children: [],
                position: 0,
            };
            const tree: TokenTree = {
                groups: [
                    {
                        categoryId: 'f1',
                        label: 'F1',
                        separator: '',
                        tokens: [n1, n2],
                    },
                    {
                        categoryId: 'f2',
                        label: 'F2',
                        separator: '//',
                        tokens: [n3],
                    },
                ],
            };

            const flat = flattenTree(tree);
            expect(flat.map((f) => f.index)).toEqual([0, 1, 2]);
        });
    });

    describe('collectAssertions', () => {
        it('returns empty for node without assertion', () => {
            const node: TokenNode = {
                key: 'k',
                categoryId: 'f1',
                label: 'L',
                separator: '',
                depth: 0,
                children: [],
                position: 0,
            };
            expect(collectAssertions(node)).toEqual([]);
        });

        it('collects assertion from node', () => {
            const assertion = createAssertion({ conceptId: 'c1' });
            const node: TokenNode = {
                key: 'k',
                conceptId: 'c1',
                categoryId: 'f1',
                label: 'L',
                separator: '',
                depth: 0,
                children: [],
                assertion,
                position: 0,
            };
            expect(collectAssertions(node)).toEqual([assertion]);
        });

        it('skips text value nodes', () => {
            const assertion = createAssertion({ conceptId: 'c1' });
            const node: TokenNode = {
                key: 'k',
                conceptId: 'c1',
                categoryId: 'f1',
                label: 'val',
                separator: '',
                depth: 0,
                children: [],
                assertion,
                isTextValue: true,
                position: 0,
            };
            expect(collectAssertions(node)).toEqual([]);
        });

        it('collects assertions recursively from children', () => {
            const a1 = createAssertion({ conceptId: 'c1' });
            const a2 = createAssertion({ conceptId: 'c2' });
            const child: TokenNode = {
                key: 'k2',
                conceptId: 'c2',
                categoryId: 'f1',
                label: 'C2',
                separator: '-',
                depth: 1,
                children: [],
                assertion: a2,
                position: 1,
            };
            const parent: TokenNode = {
                key: 'k1',
                conceptId: 'c1',
                categoryId: 'f1',
                label: 'C1',
                separator: '',
                depth: 0,
                children: [child],
                assertion: a1,
                position: 0,
            };
            const result = collectAssertions(parent);
            expect(result).toHaveLength(2);
            expect(result[0]).toBe(a1);
            expect(result[1]).toBe(a2);
        });
    });
});
