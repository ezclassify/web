import { describe, expect, it } from 'vitest';
import type { RenderFormatLayout, SchemeMetaView } from '@ezclassify/types';
import {
    eachForCategory,
    getPublicFormatLayout,
    getPublicFormatSeparators,
    tiersForCategory,
    viewForCategory,
} from './format-layout';

function layout(
    overrides: Partial<RenderFormatLayout> = {},
): RenderFormatLayout {
    return {
        id: 'default',
        surface: 'default',
        mode: 'inline',
        categoryOrder: [],
        ...overrides,
    };
}

function meta(
    formats: RenderFormatLayout[],
    defaultRenderFormat = 'default',
): Pick<SchemeMetaView, 'formats' | 'defaultRenderFormat'> {
    return { formats, defaultRenderFormat };
}

describe('getPublicFormatLayout', () => {
    it('resolves the named format', () => {
        const wanted = layout({ id: 'short', categoryOrder: ['b'] });
        const resolved = getPublicFormatLayout(
            meta([layout({ categoryOrder: ['a'] }), wanted]),
            'short',
        );
        expect(resolved.format).toBe(wanted);
        expect(resolved.categoryOrder).toEqual(['b']);
    });

    it('falls back to the scheme default when no format is named', () => {
        const fallback = layout({ id: 'banner', categoryOrder: ['b'] });
        const resolved = getPublicFormatLayout(
            meta([layout({ id: 'other' }), fallback], 'banner'),
        );
        expect(resolved.format).toBe(fallback);
    });

    it('falls back to the first format when the default names nothing', () => {
        const first = layout({ id: 'first' });
        const resolved = getPublicFormatLayout(
            meta([first, layout({ id: 'second' })], 'missing'),
        );
        expect(resolved.format).toBe(first);
    });

    it('reports an empty layout when the scheme publishes no render formats', () => {
        for (const source of [meta([]), { defaultRenderFormat: 'default' }]) {
            const resolved = getPublicFormatLayout(source);
            expect(resolved.categoryOrder).toEqual([]);
            expect(resolved.headerCategoryByConcept.size).toBe(0);
            expect(resolved.format.separator).toBeUndefined();
        }
    });

    it('survives a format whose category order the server omitted', () => {
        const partial = {
            id: 'default',
            surface: 'x',
            mode: 'inline',
        } as unknown as RenderFormatLayout;
        expect(getPublicFormatLayout(meta([partial])).categoryOrder).toEqual(
            [],
        );
    });

    it('indexes headers both ways', () => {
        const resolved = getPublicFormatLayout(
            meta([
                layout({
                    categoryOrder: ['dissem', 'countries'],
                    headers: [
                        {
                            concept: 'REL',
                            headerCategory: 'dissem',
                            category: 'countries',
                            position: 'prefix',
                        },
                    ],
                }),
            ]),
        );
        expect(resolved.headerCategoryByConcept.get('REL')).toBe('countries');
        expect(resolved.headerByCategory.get('countries')).toEqual({
            conceptId: 'REL',
            categoryId: 'dissem',
        });
    });

    it('reports no associations for a format that declares no headers', () => {
        const resolved = getPublicFormatLayout(
            meta([layout({ categoryOrder: ['a'] })]),
        );
        expect(resolved.headerCategoryByConcept.size).toBe(0);
        expect(resolved.headerByCategory.size).toBe(0);
        expect(resolved.separatorBeforeCategory.size).toBe(0);
        expect(resolved.categorySeparators.size).toBe(0);
    });

    it('indexes the per-category and per-boundary separators', () => {
        const resolved = getPublicFormatLayout(
            meta([
                layout({
                    categoryOrder: ['a', 'b'],
                    categorySeparators: { a: ', ' },
                    separatorBefore: { b: '//' },
                }),
            ]),
        );
        expect(resolved.categorySeparators.get('a')).toBe(', ');
        expect(resolved.categorySeparators.get('b')).toBeUndefined();
        expect(resolved.separatorBeforeCategory.get('b')).toBe('//');
    });

    it('returns the same index for repeated lookups of one format', () => {
        // These lookups run on every keystroke, so the index is built once per
        // projected format and reused until the adapter hands back a new one.
        const source = meta([layout({ categoryOrder: ['a'] })]);
        expect(getPublicFormatLayout(source)).toBe(
            getPublicFormatLayout(source),
        );
    });

    it('does not expose the projection for callers to mutate', () => {
        const projected = layout({ categoryOrder: ['a', 'b'] });
        const resolved = getPublicFormatLayout(meta([projected]));
        resolved.categoryOrder.push('c');
        expect(projected.categoryOrder).toEqual(['a', 'b']);
    });

    it('indexes the per-category views and tier compositions', () => {
        const resolved = getPublicFormatLayout(
            meta([
                layout({
                    categoryOrder: ['level', 'controls'],
                    categoryViews: { controls: 'short' },
                    categoryTiers: {
                        controls: [
                            { tier: 'compartment', attachedBy: '-' },
                            { tier: 'subcompartment', attachedBy: ' ' },
                        ],
                    },
                }),
            ]),
        );
        expect(resolved.categoryViews.get('controls')).toBe('short');
        expect(resolved.categoryViews.get('level')).toBeUndefined();
        expect(resolved.categoryTiers.get('controls')).toEqual([
            { tier: 'compartment', attachedBy: '-' },
            { tier: 'subcompartment', attachedBy: ' ' },
        ]);
        expect(resolved.categoryTiers.get('level')).toBeUndefined();
    });

    it('does not expose the projected tier list for callers to mutate', () => {
        const projected = layout({
            categoryOrder: ['controls'],
            categoryTiers: {
                controls: [{ tier: 'compartment', attachedBy: '-' }],
            },
        });
        const resolved = getPublicFormatLayout(meta([projected]));
        resolved.categoryTiers
            .get('controls')!
            .push({ tier: 'subcompartment', attachedBy: ' ' });
        expect(projected.categoryTiers!['controls']).toHaveLength(1);
    });
});

describe('viewForCategory', () => {
    it('writes a category in its own view where the format gives it one', () => {
        const resolved = getPublicFormatLayout(
            meta([
                layout({
                    view: 'long',
                    categoryOrder: ['level', 'controls'],
                    categoryViews: { controls: 'short' },
                }),
            ]),
        );
        expect(viewForCategory(resolved, 'controls')).toBe('short');
    });

    it('falls back to the format view for a category that names none', () => {
        const resolved = getPublicFormatLayout(
            meta([
                layout({
                    view: 'long',
                    categoryOrder: ['level'],
                    categoryViews: { controls: 'short' },
                }),
            ]),
        );
        expect(viewForCategory(resolved, 'level')).toBe('long');
    });

    it('reports no view when neither the category nor the format names one', () => {
        const resolved = getPublicFormatLayout(
            meta([layout({ categoryOrder: ['level'] })]),
        );
        expect(viewForCategory(resolved, 'level')).toBeUndefined();
    });
});

describe('tiersForCategory', () => {
    it('returns the compositions a category writes, outermost first', () => {
        const resolved = getPublicFormatLayout(
            meta([
                layout({
                    categoryOrder: ['controls'],
                    categoryTiers: {
                        controls: [
                            { tier: 'compartment', attachedBy: '-' },
                            { tier: 'subcompartment', attachedBy: ' ' },
                        ],
                    },
                }),
            ]),
        );
        expect(
            tiersForCategory(resolved, 'controls').map((one) => one.tier),
        ).toEqual(['compartment', 'subcompartment']);
    });

    it('returns nothing for a category whose values are plain siblings', () => {
        const resolved = getPublicFormatLayout(
            meta([layout({ categoryOrder: ['level'] })]),
        );
        expect(tiersForCategory(resolved, 'level')).toEqual([]);
    });
});

describe('eachForCategory', () => {
    it('returns what a category writes around every one of its values', () => {
        const resolved = getPublicFormatLayout(
            meta([
                layout({
                    categoryOrder: ['controls'],
                    categoryEach: { controls: { prefix: '(', suffix: ')' } },
                }),
            ]),
        );
        expect(eachForCategory(resolved, 'controls')).toEqual({
            prefix: '(',
            suffix: ')',
        });
    });

    it('returns the one side a one-sided affix declares', () => {
        const resolved = getPublicFormatLayout(
            meta([
                layout({
                    categoryOrder: ['controls'],
                    categoryEach: { controls: { prefix: 'SP-' } },
                }),
            ]),
        );
        expect(eachForCategory(resolved, 'controls')).toEqual({
            prefix: 'SP-',
        });
    });

    it('returns nothing for a category whose values are written bare', () => {
        const resolved = getPublicFormatLayout(
            meta([layout({ categoryOrder: ['level'] })]),
        );
        expect(eachForCategory(resolved, 'level')).toBeUndefined();
    });

    it('survives a server that omits the member', () => {
        // Same reason `categoryOrder` is read through a fallback: this reads a
        // wire payload, and an older server leaves the key off entirely.
        const resolved = getPublicFormatLayout(
            meta([layout({ categoryOrder: ['level'] })]),
        );
        expect(resolved.categoryEach.size).toBe(0);
    });
});

describe('getPublicFormatSeparators', () => {
    it('collects the format, category, and boundary separators once each', () => {
        expect(
            getPublicFormatSeparators(
                layout({
                    separator: '//',
                    categoryOrder: ['a', 'b', 'c'],
                    categorySeparators: { a: ', ', b: ', ' },
                    separatorBefore: { b: '//', c: '-' },
                }),
            ),
        ).toEqual(['//', ', ', '-']);
    });

    it('leaves the per-value affix out, as it leaves the format affixes out', () => {
        // It frames a value rather than standing between two of them, so a
        // caller looking for where a typed tail begins would cut inside a
        // token.
        expect(
            getPublicFormatSeparators(
                layout({
                    separator: '//',
                    categoryOrder: ['controls'],
                    categorySeparators: { controls: ', ' },
                    categoryEach: { controls: { prefix: '(', suffix: ')' } },
                }),
            ),
        ).toEqual(['//', ', ']);
    });

    it('collects what attaches a tiered concept to its head', () => {
        // The caret and tail surfaces look for where a typed value begins, and
        // in a tiered category that boundary is the attachment, not the
        // category's own separator.
        expect(
            getPublicFormatSeparators(
                layout({
                    separator: '//',
                    categoryOrder: ['controls'],
                    categorySeparators: { controls: ', ' },
                    categoryTiers: {
                        controls: [
                            { tier: 'compartment', attachedBy: '-' },
                            { tier: 'subcompartment', attachedBy: ' ' },
                        ],
                    },
                }),
            ),
        ).toEqual(['//', ', ', '-', ' ']);
    });

    it('skips empty strings and returns nothing for a bare format', () => {
        expect(
            getPublicFormatSeparators(
                layout({ separator: '', categorySeparators: { a: '' } }),
            ),
        ).toEqual([]);
    });
});
