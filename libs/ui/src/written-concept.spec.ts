/**
 * How a field names a concept: as its marking writes it, in the output the
 * field writes the concept's scope in, else the scheme's default output for
 * that scope and the field's role, else by its name.
 *
 * The scheme here writes a document line in a short whole view and a shorter
 * part view, and a notice block in a spelled-out view, the way a banner, a
 * portion mark and an authority block divide a marking.
 */
import { describe, expect, it } from 'vitest';
import type {
    CategoryView,
    ConceptView,
    RenderFormatLayout,
} from '@ezclassify/types';
import {
    fieldOutputFor,
    fieldScopeOf,
    writtenConcept,
    type ConceptWriting,
    type WritingField,
    type WritingMeta,
} from './written-concept';

const concept = (
    id: string,
    name: string,
    category: string,
    views: Record<string, string>,
    extra: Partial<ConceptView> = {},
): ConceptView =>
    ({
        id,
        name,
        views,
        categories: [category],
        parents: [],
        aliases: [],
        position: 1,
        ...extra,
    }) as ConceptView;

const output = (
    id: string,
    surface: string,
    view: string | undefined,
    defaultFor: ('whole' | 'part')[] = [],
    categoryViews?: Record<string, string>,
): RenderFormatLayout => ({
    id,
    surface,
    mode: 'inline',
    categoryOrder: [],
    ...(view ? { view } : {}),
    defaultFor,
    ...(categoryViews ? { categoryViews } : {}),
});

const META: WritingMeta = {
    scopes: [
        { id: 'line', label: 'Line' },
        { id: 'notice', label: 'Notice' },
    ],
    defaultScope: 'line',
    defaultRenderFormat: 'line/spelled',
    formats: [
        output('line/short', 'line', 'short', ['whole']),
        output('line/tiny', 'line', 'tiny', ['part']),
        output('line/spelled', 'line', 'spelled'),
        // The notice block writes the handling category in a view of its own.
        output('notice/block', 'notice', 'block', ['whole', 'part'], {
            handling: 'handling_block',
        }),
    ],
};

const CATEGORIES = [
    { id: 'control', label: 'Control' } as CategoryView,
    { id: 'handling', label: 'Handling', scopes: ['notice'] } as CategoryView,
    {
        id: 'shared',
        label: 'Shared',
        scopes: ['notice', 'line'],
    } as CategoryView,
    { id: 'release', label: 'Release', scopes: ['notice'] } as CategoryView,
];

const CONCEPTS = [
    concept('KEEP', 'Keep Inside the Office', 'control', {
        default: 'KO',
        short: 'KEEP',
        tiny: 'K',
        spelled: 'KEEP INSIDE THE OFFICE',
    }),
    concept('ONLY_DEFAULT', 'Only a Default', 'control', { default: 'OD' }),
    concept('ONLY_SHORT', 'Only Short', 'control', { short: 'OS' }),
    concept('UNSPELLED', 'Never Spelled', 'control', {}),
    concept('SHRED', 'Shred After Use', 'handling', {
        default: 'SHRED',
        handling_block: 'Shred this copy after use.',
    }),
    concept('BOTH', 'On Both', 'shared', {
        default: 'B',
        short: 'BOTH',
        block: 'Written on both.',
    }),
    concept(
        'ON_DATE',
        'On a Date',
        'release',
        { default: '{value}', block: 'On {value}' },
        {
            textInput: { placeholder: 'YYYYMMDD' },
        } as Partial<ConceptView>,
    ),
];

const writing = (field: Partial<WritingField>): ConceptWriting => ({
    scheme: { concepts: CONCEPTS, categories: CATEGORIES },
    meta: META,
    field: { formatId: 'line/short', part: false, scopes: [], ...field },
});

const named = (
    field: Partial<WritingField>,
    conceptId: string,
    categoryId: string,
) => writtenConcept(writing(field), { conceptId, categoryId });

describe('writtenConcept', () => {
    it("writes a concept in the view of the output the field names for the concept's scope", () => {
        expect(named({ formatId: 'line/short' }, 'KEEP', 'control')).toBe(
            'KEEP',
        );
        expect(named({ formatId: 'line/spelled' }, 'KEEP', 'control')).toBe(
            'KEEP INSIDE THE OFFICE',
        );
    });

    it("writes a concept on another scope in that scope's default output, in the view it names for the category", () => {
        expect(named({ formatId: 'line/short' }, 'SHRED', 'handling')).toBe(
            'Shred this copy after use.',
        );
    });

    it("writes a part field's concept in the scope's part default", () => {
        // The field names an output on another scope, so the line scope is
        // written in its default for a part.
        expect(
            named({ formatId: 'notice/block', part: true }, 'KEEP', 'control'),
        ).toBe('K');
        expect(
            named({ formatId: 'notice/block', part: false }, 'KEEP', 'control'),
        ).toBe('KEEP');
    });

    it('takes the concept default where the output has no spelling of its own, as the engine writes it', () => {
        expect(
            named({ formatId: 'line/short' }, 'ONLY_DEFAULT', 'control'),
        ).toBe('OD');
    });

    it("falls back to the scope's default output when the named output spells the concept nowhere", () => {
        expect(
            named({ formatId: 'line/spelled' }, 'ONLY_SHORT', 'control'),
        ).toBe('OS');
    });

    it('ends at the name, never empty, when nothing spells the concept', () => {
        expect(named({ formatId: 'line/short' }, 'UNSPELLED', 'control')).toBe(
            'Never Spelled',
        );
    });

    it('names a value-taking concept by its name, never its template', () => {
        expect(named({ formatId: 'notice/block' }, 'ON_DATE', 'release')).toBe(
            'On a Date',
        );
    });

    it('writes a category of several scopes on the first one the field writes', () => {
        expect(
            named(
                { formatId: 'line/short', scopes: ['line'] },
                'BOTH',
                'shared',
            ),
        ).toBe('BOTH');
        expect(
            named(
                { formatId: 'line/short', scopes: ['notice'] },
                'BOTH',
                'shared',
            ),
        ).toBe('Written on both.');
    });

    it('names a concept the scheme does not have by its id', () => {
        expect(named({}, 'GONE', 'control')).toBe('GONE');
    });
});

describe('fieldScopeOf and fieldOutputFor', () => {
    it("put a category on the field's scope, in the field's own output only on its own surface", () => {
        const shared = CATEGORIES[2];
        expect(fieldScopeOf(shared, { scopes: [] }, META)).toBe('line');
        expect(fieldScopeOf(shared, { scopes: ['notice'] }, META)).toBe(
            'notice',
        );
        // No declared scopes: the default scope.
        expect(fieldScopeOf(CATEGORIES[0], { scopes: [] }, META)).toBe('line');
        const field = { formatId: 'line/spelled', part: false };
        expect(fieldOutputFor(META, field, 'line')).toBe('line/spelled');
        expect(fieldOutputFor(META, field, 'notice')).toBe('notice/block');
        expect(fieldOutputFor(META, field, undefined)).toBe('line/spelled');
    });
});
