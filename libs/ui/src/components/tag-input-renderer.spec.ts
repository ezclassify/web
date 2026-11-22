import { describe, expect, it, vi } from 'vitest';
import type { Assertion, CategoryView, ConceptView } from '@ezclassify/types';
import { renderTagChips } from './tag-input-renderer';

describe('renderTagChips', () => {
    it('keeps the supplied order even when format headers would group it differently', () => {
        const concepts = [
            concept('S', 'SECRET', ['level']),
            concept('SI', 'SI', ['sci']),
            concept('REL', 'REL TO', ['dissemination']),
            concept('DISPLAY', 'DISPLAY ONLY', ['dissemination']),
            concept('USA', 'USA', ['rel_to_countries']),
            concept('AUS', 'AUS', ['rel_to_countries']),
            concept('CAN', 'CAN', ['rel_to_countries']),
            concept('GBR', 'GBR', ['display_only_countries']),
            concept('NZL', 'NZL', ['display_only_countries']),
        ];
        const assertions = [
            assertion('S', 'level'),
            assertion('SI', 'sci'),
            assertion('REL', 'dissemination'),
            assertion('DISPLAY', 'dissemination'),
            assertion('USA', 'rel_to_countries'),
            assertion('AUS', 'rel_to_countries'),
            assertion('CAN', 'rel_to_countries'),
            assertion('GBR', 'display_only_countries'),
            assertion('NZL', 'display_only_countries'),
        ];
        const inputWrap = document.createElement('div');
        const filterInput = document.createElement('input');
        inputWrap.appendChild(filterInput);

        const tags = renderTagChips({
            scheme: {
                id: 'test',
                version: '1.0.0',
                name: 'Test',
                referenceSurfaceLabel: {
                    singular: 'Handbook',
                    plural: 'Handbooks',
                },
                defaultRenderFormat: 'default',
                labelPresets: [],
                concepts,
                categories: [
                    category('level'),
                    category('sci'),
                    category('dissemination'),
                    category('rel_to_countries'),
                    category('display_only_countries'),
                ],
                formats: [
                    {
                        id: 'default',
                        surface: 'default',
                        mode: 'inline',
                        categoryOrder: [],
                    },
                ],
            },
            schemeMeta: {
                defaultRenderFormat: 'default',
                formats: [
                    {
                        id: 'default',
                        surface: 'default',
                        mode: 'inline',
                        separator: '//',
                        categoryOrder: [
                            'level',
                            'sci',
                            'dissemination',
                            'rel_to_countries',
                            'display_only_countries',
                        ],
                        headers: [
                            {
                                concept: 'REL',
                                headerCategory: 'dissemination',
                                category: 'rel_to_countries',
                                position: 'prefix',
                            },
                            {
                                concept: 'DISPLAY',
                                headerCategory: 'dissemination',
                                category: 'display_only_countries',
                                position: 'prefix',
                            },
                        ],
                    },
                ],
            },
            assertions,
            formatId: 'default',
            inputWrap,
            filterInput,
            getCategoryColor: () => '#000000',
            getCategoryTextColor: () => '#ffffff',
            categoryHueOffset: (category) =>
                category === 'level' ? 0 : undefined,
            onRemoveAssertion: vi.fn(),
            onReprocess: vi.fn(),
            onChipClick: vi.fn(),
            onChipKeydown: vi.fn(),
            onChipBlur: vi.fn(),
        });

        expect(tags.map((tag) => tag.dataset.conceptId)).toEqual(
            assertions.map((a) => a.conceptId),
        );
        const themed = tags.filter((tag) =>
            tag.hasAttribute('data-ez-themed-category'),
        );
        expect(themed.map((tag) => tag.dataset.categoryId)).toEqual(['level']);
        expect(
            themed[0].style.getPropertyValue('--ez-category-hue-offset'),
        ).toBe('0');
    });

    it('names a chip whose value is typed into it by its concept, not its view template', () => {
        const typed: ConceptView = {
            ...concept('BY_TEXT', '{value}', ['classified_by']),
            name: 'Classified By',
            textInput: { placeholder: 'Name and position' },
        };
        const inputWrap = document.createElement('div');
        const filterInput = document.createElement('input');
        inputWrap.appendChild(filterInput);
        const [tag] = renderTagChips({
            scheme: {
                id: 'test',
                version: '1.0.0',
                name: 'Test',
                referenceSurfaceLabel: {
                    singular: 'Handbook',
                    plural: 'Handbooks',
                },
                defaultRenderFormat: 'default',
                labelPresets: [],
                concepts: [typed],
                categories: [category('classified_by')],
                formats: [
                    {
                        id: 'default',
                        surface: 'default',
                        mode: 'inline',
                        categoryOrder: [],
                    },
                ],
            },
            schemeMeta: {
                defaultRenderFormat: 'default',
                formats: [
                    {
                        id: 'default',
                        surface: 'default',
                        mode: 'inline',
                        separator: '//',
                        categoryOrder: ['classified_by'],
                    },
                ],
            },
            assertions: [
                {
                    ...assertion('BY_TEXT', 'classified_by'),
                    value: 'Jane Analyst',
                },
            ],
            formatId: 'default',
            inputWrap,
            filterInput,
            getCategoryColor: () => '#000000',
            getCategoryTextColor: () => '#ffffff',
            onRemoveAssertion: vi.fn(),
            onReprocess: vi.fn(),
            onChipClick: vi.fn(),
            onChipKeydown: vi.fn(),
            onChipBlur: vi.fn(),
        });

        expect(tag.querySelector('span')?.textContent).toBe('Classified By');
        expect(tag.textContent).not.toContain('{value}');
        expect(
            tag.querySelector<HTMLInputElement>('.proto-tag-edit')?.value,
        ).toBe('Jane Analyst');
    });
});

function concept(id: string, label: string, categories: string[]): ConceptView {
    return {
        id,
        name: label,
        views: { default: label },
        categories,
        parents: [],
        aliases: [],
        position: 0,
    };
}

function category(id: string): CategoryView {
    return { id, label: id, rollup: 'max' };
}

function assertion(conceptId: string, categoryId: string): Assertion {
    return {
        conceptId,
        categoryId,
        confidence: 'certain',
        source: 'user',
    };
}
