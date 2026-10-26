import { describe, it, expect } from 'vitest';
import {
    CATEGORY_BACKGROUND_COLORS,
    CATEGORY_BACKGROUND_TEXT_COLORS,
    buildCategoryColorMap,
    resolveMarkingColor,
} from './color-resolver';

function relativeLuminance(hex: string): number {
    const channels = [1, 3, 5].map((start) => {
        const value = Number.parseInt(hex.slice(start, start + 2), 16) / 255;
        return value <= 0.04045
            ? value / 12.92
            : ((value + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

describe('color-resolver', () => {
    describe('palette arrays', () => {
        it('has 8 background colors', () => {
            expect(CATEGORY_BACKGROUND_COLORS).toHaveLength(8);
        });

        it('has 8 background text colors', () => {
            expect(CATEGORY_BACKGROUND_TEXT_COLORS).toHaveLength(8);
        });

        it('pairs every default banner background with WCAG AA text contrast', () => {
            for (let i = 0; i < CATEGORY_BACKGROUND_COLORS.length; i++) {
                const background = relativeLuminance(
                    CATEGORY_BACKGROUND_COLORS[i],
                );
                const text = relativeLuminance(
                    CATEGORY_BACKGROUND_TEXT_COLORS[i],
                );
                const lighter = Math.max(background, text);
                const darker = Math.min(background, text);
                expect(
                    (lighter + 0.05) / (darker + 0.05),
                ).toBeGreaterThanOrEqual(4.5);
            }
        });
    });

    describe('buildCategoryColorMap', () => {
        it('maps category IDs to background/text color pairs', () => {
            const scheme = { categories: [{ id: 'level' }, { id: 'dissem' }] };
            const map = buildCategoryColorMap(scheme);
            expect(map.size).toBe(2);
            expect(map.get('level')!.background).toBe(
                CATEGORY_BACKGROUND_COLORS[0],
            );
            expect(map.get('level')!.text).toBe(
                CATEGORY_BACKGROUND_TEXT_COLORS[0],
            );
            expect(map.get('dissem')!.background).toBe(
                CATEGORY_BACKGROUND_COLORS[1],
            );
        });

        it('cycles colors when categories exceed palette length', () => {
            const categories = Array.from({ length: 10 }, (_, i) => ({
                id: `c${i}`,
            }));
            const map = buildCategoryColorMap({ categories });
            expect(map.get('c8')!.background).toBe(
                CATEGORY_BACKGROUND_COLORS[0],
            );
            expect(map.get('c9')!.background).toBe(
                CATEGORY_BACKGROUND_COLORS[1],
            );
        });

        it('accepts custom palettes', () => {
            const scheme = { categories: [{ id: 'x' }] };
            const map = buildCategoryColorMap(scheme, ['#aaa'], ['#bbb']);
            expect(map.get('x')!.background).toBe('#aaa');
            expect(map.get('x')!.text).toBe('#bbb');
        });

        it('returns empty map for empty categories', () => {
            const map = buildCategoryColorMap({ categories: [] });
            expect(map.size).toBe(0);
        });
    });

    describe('resolveMarkingColor', () => {
        // Mirrors the ISM shape: classification is the color driver, an orange
        // TOP SECRET pair plus an uncolored dissemination assertion.
        const orange = { background: '#ff8c00', text: '#000000' };
        const ismMeta = { colorFrom: 'classification' };
        const ismAssertions = [
            {
                conceptId: 'TOP_SECRET',
                categoryId: 'classification',
                color: orange,
            },
            { conceptId: 'NOFORN', categoryId: 'dissemination' },
        ];

        it('resolves the real color from the driving-category assertion', () => {
            expect(resolveMarkingColor(ismMeta, ismAssertions)).toEqual(orange);
        });

        it('returns undefined when the scheme names no color driver', () => {
            // Most schemes (HIPAA, SOX, ...) declare no colorFrom; hosts fall
            // back to their generic category palette.
            expect(resolveMarkingColor({}, ismAssertions)).toBeUndefined();
            expect(
                resolveMarkingColor({ colorFrom: undefined }, ismAssertions),
            ).toBeUndefined();
        });

        it('returns undefined when nothing is asserted in the driving category', () => {
            expect(
                resolveMarkingColor(ismMeta, [
                    {
                        conceptId: 'NOFORN',
                        categoryId: 'dissemination',
                    },
                ]),
            ).toBeUndefined();
            expect(resolveMarkingColor(ismMeta, [])).toBeUndefined();
        });

        it('ignores a color carried by an assertion outside the driving category', () => {
            // The loader rejects color on non-color_from concepts, so this
            // shape cannot occur in practice; the resolver keys strictly on the
            // driving category so a stray color still cannot leak through.
            expect(
                resolveMarkingColor(ismMeta, [
                    {
                        conceptId: 'NOFORN',
                        categoryId: 'dissemination',
                        color: orange,
                    },
                ]),
            ).toBeUndefined();
        });

        it('returns the whole-marking color for a max-rolled level', () => {
            // S + C parts roll up to an S-colored whole; single:true means
            // exactly one classification assertion reaches the resolver.
            const red = { background: '#c8102e', text: '#ffffff' };
            expect(
                resolveMarkingColor(ismMeta, [
                    {
                        conceptId: 'SECRET',
                        categoryId: 'classification',
                        color: red,
                    },
                    {
                        conceptId: 'NOFORN',
                        categoryId: 'dissemination',
                    },
                ]),
            ).toEqual(red);
        });

        it('resolves a single part assertion the same way', () => {
            expect(
                resolveMarkingColor(ismMeta, [
                    {
                        conceptId: 'TOP_SECRET',
                        categoryId: 'classification',
                        color: orange,
                    },
                ]),
            ).toEqual(orange);
        });

        it('reads the authored concept color when the assertion carries none', () => {
            // Callers that build the projection from a store snapshot may not
            // have a color on every assertion. The scheme still has one.
            const scheme = {
                concepts: [{ id: 'TOP_SECRET', color: orange }],
            } as any;
            expect(
                resolveMarkingColor(
                    ismMeta,
                    [
                        {
                            conceptId: 'TOP_SECRET',
                            categoryId: 'classification',
                        },
                    ],
                    scheme,
                ),
            ).toEqual(orange);
        });

        it('returns undefined when neither the assertion nor the scheme has a color', () => {
            const scheme = { concepts: [{ id: 'TOP_SECRET' }] } as any;
            expect(
                resolveMarkingColor(
                    ismMeta,
                    [
                        {
                            conceptId: 'TOP_SECRET',
                            categoryId: 'classification',
                        },
                    ],
                    scheme,
                ),
            ).toBeUndefined();
        });
    });
});
