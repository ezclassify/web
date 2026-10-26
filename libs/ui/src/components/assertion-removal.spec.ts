import { describe, expect, it } from 'vitest';
import type {
    Assertion,
    ConceptView,
    SchemeMetaView,
    SchemePublicView,
} from '@ezclassify/types';
import { removeAssertionCascade } from './assertion-removal';

const assertion = (conceptId: string, categoryId: string): Assertion => ({
    conceptId,
    categoryId,
    confidence: 'certain',
    source: 'user',
});

const concept = (
    id: string,
    category: string,
    parents: string[] = [],
): ConceptView => ({
    id,
    name: id,
    views: { default: id },
    aliases: [],
    categories: [category],
    parents,
    position: 0,
});

const scheme = {
    concepts: [
        concept('REL', 'dissemination'),
        concept('USA', 'rel_countries'),
        concept('GBR', 'rel_countries'),
        concept('PARENT', 'hierarchy'),
        concept('CHILD', 'hierarchy', ['PARENT']),
        concept('GRANDCHILD', 'hierarchy', ['CHILD']),
        concept('OTHER', 'hierarchy'),
    ],
    categories: [
        'classification',
        'dissemination',
        'rel_countries',
        'hierarchy',
        'audit_metadata',
    ].map((id) => ({ id, label: id, rollup: 'union' as const })),
} satisfies Pick<SchemePublicView, 'concepts' | 'categories'>;

/**
 * The layout the cascade reads: one heading (REL) introducing the country list
 * it heads. Everything else is order the cascade never consults.
 */
const meta = {
    defaultRenderFormat: 'default',
    formats: [
        {
            id: 'default',
            surface: 'default',
            mode: 'inline',
            separator: '//',
            categoryOrder: [
                'classification',
                'dissemination',
                'rel_countries',
                'hierarchy',
                'audit_metadata',
            ],
            categorySeparators: { rel_countries: ', ' },
            headers: [
                {
                    concept: 'REL',
                    headerCategory: 'dissemination',
                    category: 'rel_countries',
                    position: 'prefix',
                },
            ],
        },
    ],
} satisfies Pick<SchemeMetaView, 'formats' | 'defaultRenderFormat'>;

describe('removeAssertionCascade', () => {
    it('removes the category owned by a removed header assertion', () => {
        const result = removeAssertionCascade(
            [
                assertion('SECRET', 'classification'),
                assertion('REL', 'dissemination'),
                assertion('USA', 'rel_countries'),
                assertion('GBR', 'rel_countries'),
            ],
            'REL',
            'dissemination',
            scheme,
            meta,
        );

        expect(result).toEqual([assertion('SECRET', 'classification')]);
    });

    it('removes asserted descendants transitively with their parent', () => {
        const result = removeAssertionCascade(
            [
                assertion('PARENT', 'hierarchy'),
                assertion('CHILD', 'hierarchy'),
                assertion('GRANDCHILD', 'hierarchy'),
                assertion('OTHER', 'hierarchy'),
            ],
            'PARENT',
            'hierarchy',
            scheme,
            meta,
        );

        expect(result).toEqual([assertion('OTHER', 'hierarchy')]);
    });

    it('does not remove a same-id assertion from an unrelated category', () => {
        const result = removeAssertionCascade(
            [
                assertion('REL', 'dissemination'),
                assertion('REL', 'audit_metadata'),
                assertion('USA', 'rel_countries'),
            ],
            'REL',
            'dissemination',
            scheme,
            meta,
        );

        expect(result).toEqual([assertion('REL', 'audit_metadata')]);
    });
});
