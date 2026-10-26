/**
 * Which categories a field's composer port reports as the ones the field edits.
 * Isolated from any engine: the port reads the scheme's categories and the
 * field's format from what the field hands it.
 */
import { describe, expect, it } from 'vitest';
import type { SchemePublicView } from '@ezclassify/types';
import { createComposerPort, type ComposerPortField } from './composer-port';
import type { FormatLayoutSource } from '../../format-layout';

const categories = [
    { id: 'level', label: 'Level', required: true, rollup: 'max' },
    { id: 'sharing', label: 'Sharing', rollup: 'union' },
    {
        id: 'handling',
        label: 'Handling',
        rollup: 'union',
        scopes: ['sensitivity'],
    },
    {
        id: 'keep',
        label: 'Keep for',
        required: true,
        rollup: 'max',
        scopes: ['retention'],
    },
] as SchemePublicView['categories'];

/** Two surfaces; a request that names no output writes `sensitivity`. */
const meta = {
    formats: [
        { id: 'sensitivity/full', surface: 'sensitivity' },
        { id: 'retention/block', surface: 'retention' },
    ],
    defaultRenderFormat: 'sensitivity/full',
} as unknown as FormatLayoutSource;

function categoryIds(
    formatId: string,
    declared: { categoryId?: string; scope?: string } = {},
    source: FormatLayoutSource = meta,
): string[] {
    const field = {
        shape: 'whole',
        binding: { process: async () => ({}) },
        scheme: () => ({ categories, concepts: [] }),
        meta: () => source,
        formatId: () => formatId,
        scope: () => declared.scope,
        categoryId: () => declared.categoryId,
    } as unknown as ComposerPortField;
    return createComposerPort(field)
        .categories()
        .map((c) => c.id);
}

describe('the categories a composer port reports', () => {
    it("are those of the default surface's field and the marking's own", () => {
        expect(categoryIds('sensitivity/full')).toEqual([
            'level',
            'sharing',
            'handling',
        ]);
    });

    it("are only the scoped ones of another surface's field", () => {
        expect(categoryIds('retention/block')).toEqual(['keep']);
    });

    it('follow the surface a field declares over its format', () => {
        expect(categoryIds('sensitivity/full', { scope: 'retention' })).toEqual(
            ['keep'],
        );
    });

    it('are every category when the format names no surface the metadata lists', () => {
        expect(categoryIds('sensitivity/short')).toEqual([
            'level',
            'sharing',
            'handling',
            'keep',
        ]);
    });

    it('are only the bound category for a field bound to one', () => {
        expect(
            categoryIds('sensitivity/full', { categoryId: 'level' }),
        ).toEqual(['level']);
        expect(categoryIds('sensitivity/full', { categoryId: 'keep' })).toEqual(
            [],
        );
    });
});

it('orders categories by the active format before stable scheme-order fallbacks', () => {
    const source = {
        ...meta,
        formats: [
            {
                id: 'sensitivity/full',
                surface: 'sensitivity',
                categoryOrder: ['handling', 'level'],
            },
            {
                id: 'sensitivity/short',
                surface: 'sensitivity',
                categoryOrder: ['sharing', 'handling'],
            },
        ],
    } as FormatLayoutSource;
    expect(categoryIds('sensitivity/full', {}, source)).toEqual([
        'handling',
        'level',
        'sharing',
    ]);
    expect(categoryIds('sensitivity/short', {}, source)).toEqual([
        'sharing',
        'handling',
        'level',
    ]);
    expect(source.formats?.[0].categoryOrder).toEqual(['handling', 'level']);
});
