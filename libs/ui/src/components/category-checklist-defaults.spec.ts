import { afterEach, describe, expect, it } from 'vitest';
import { Context, SchemeEngine } from '@ezclassify/engine';
import { CategoryChecklist } from './category-checklist';

function context(conditional: boolean) {
    return Context.fromSchemeEngine(
        SchemeEngine.fromJSON({
            scheme: {
                id: 'checklist-defaults',
                version: '1.0.0',
                name: 'Checklist defaults',
                data: {
                    categories: [
                        {
                            id: 'level',
                            label: 'Level',
                            single: true,
                            rollup: 'max',
                        },
                        {
                            id: 'origin',
                            label: 'Origin',
                            rollup: 'union',
                            default_concept: conditional
                                ? {
                                      concept: 'HOME',
                                      when: {
                                          category: 'level',
                                          is: 'has_content',
                                      },
                                  }
                                : 'HOME',
                        },
                    ],
                    concepts: {
                        inline: [
                            {
                                id: 'LOW',
                                name: 'Low',
                                views: { default: 'LOW' },
                                categories: ['level'],
                                rank: 0,
                            },
                            {
                                id: 'HOME',
                                name: 'Home',
                                views: { default: 'HOME' },
                                categories: ['origin'],
                            },
                            {
                                id: 'PARTNER',
                                name: 'Partner',
                                views: { default: 'PARTNER' },
                                categories: ['origin'],
                            },
                        ],
                    },
                },
                render: {
                    default: 'banner',
                    formats: [
                        {
                            id: 'banner',
                            surface: 'banner',
                            mode: 'inline',
                            separator: '//',
                            fields: [
                                { category: 'level' },
                                { category: 'origin', separator: ',' },
                            ],
                        },
                    ],
                },
            },
        }),
    );
}

describe('category clearing through engine defaults', () => {
    let checklist: CategoryChecklist | undefined;
    afterEach(() => {
        checklist?.destroy();
        checklist = undefined;
        document.body.innerHTML = '';
    });

    it.each([
        { conditional: true, level: true, defaults: ['HOME'] },
        { conditional: true, level: false, defaults: [] },
        { conditional: false, level: false, defaults: ['HOME'] },
    ])(
        'settles defaults with conditional=$conditional and level=$level',
        async ({ conditional, level, defaults }) => {
            const root = document.createElement('div');
            document.body.appendChild(root);
            const ctx = context(conditional);
            checklist = new CategoryChecklist();
            await checklist.init(root, ctx, {
                categoryId: 'origin',
            });
            checklist.setAssertions([
                ...(level
                    ? [
                          {
                              conceptId: 'LOW',
                              categoryId: 'level',
                              source: 'user' as const,
                              confidence: 'certain' as const,
                          },
                      ]
                    : []),
                {
                    conceptId: 'PARTNER',
                    categoryId: 'origin',
                    source: 'user',
                    confidence: 'certain',
                },
            ]);
            await expect
                .poll(() =>
                    checklist!
                        .getAssertions()
                        .some((a) => a.conceptId === 'PARTNER'),
                )
                .toBe(true);
            root.querySelector<HTMLButtonElement>(
                '.category-checklist-toggle button:last-child',
            )!.click();

            await expect
                .poll(() =>
                    checklist!
                        .getAssertions()
                        .filter((a) => a.categoryId === 'origin')
                        .map((a) => a.conceptId),
                )
                .toEqual(defaults);
            for (const assertion of checklist
                .getAssertions()
                .filter((a) => a.categoryId === 'origin')) {
                expect(assertion.source).toBe('default');
                expect(assertion.confidence).toBe('certain');
            }
        },
    );
});
