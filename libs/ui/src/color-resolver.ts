/**
 * Centralized color palettes and resolution logic for category-based coloring.
 *
 * Category color lookups across components use these shared palettes and the
 * resolver functions below.
 */

import type { ConceptColor, SchemePublicView } from '@ezclassify/types';

/** Lighter background/card colors for component UIs (cards, chips, indicators). */
export const CATEGORY_BACKGROUND_COLORS = [
    '#FDB827', // yellow
    '#f97316', // orange
    '#22c55e', // green
    '#60a5fa', // blue
    '#a855f7', // purple
    '#ec4899', // pink
    '#14b8a6', // teal
    '#f97316', // orange
];

/**
 * Text colors that sit on top of CATEGORY_BACKGROUND_COLORS; these are the
 * foreground (text-on-background) values, not backgrounds themselves. The dark
 * shades are paired and regression-tested at WCAG AA contrast against the
 * bright background swatches above.
 */
export const CATEGORY_BACKGROUND_TEXT_COLORS = [
    '#5a2f0e', // yellow-text on #FDB827 gold, 6.5:1, clears WCAG AA
    '#431407', // orange-950 on orange-500, 5.6:1 WCAG AA
    '#052e16', // green-950 on green-500, 6.5:1
    '#172554', // blue-950 on blue-400, 5.8:1
    '#000000', // black on purple-500, 5.3:1
    '#0f172a', // slate-900 on pink-500, 5.1:1
    '#042f2e', // teal-950 on teal-500, 5.8:1
    '#431407', // orange-950 on orange-500, 5.6:1
];

/** Color pair for a category (used by headless consumers). */
export interface CategoryColor {
    background: string;
    text: string;
}

/**
 * Build a category-to-color mapping from a scheme's categories.
 *
 * Returns a Map keyed by category ID. Colors cycle through the default
 * background palette. Pass custom palettes to override.
 */
export function buildCategoryColorMap(
    scheme: { categories: Array<{ id: string }> },
    palette?: string[],
    textPalette?: string[],
): Map<string, CategoryColor> {
    const bg = palette ?? CATEGORY_BACKGROUND_COLORS;
    const txt = textPalette ?? CATEGORY_BACKGROUND_TEXT_COLORS;
    const map = new Map<string, CategoryColor>();
    for (let i = 0; i < scheme.categories.length; i++) {
        map.set(scheme.categories[i].id, {
            background: bg[i % bg.length],
            text: txt[i % txt.length],
        });
    }
    return map;
}

/**
 * A resolved marking assertion reduced to the two facts the display-color
 * resolver needs: the category the concept was asserted in, and the
 * scheme-default color its resolved concept view carries.
 *
 * `color` is present only on concepts in the scheme's `color_from` category;
 * the engine loader rejects a color declared elsewhere and rejects a half pair,
 * so any value here is a complete, correctly-placed pair.
 */
export interface ResolvedMarkingAssertion {
    /** Stable concept ID used by conditional color rules. */
    conceptId: string;
    /** Category ID this concept was asserted in. */
    categoryId: string;
    /** Scheme-default color pair from the assertion's resolved concept view. */
    color?: ConceptColor;
}

/** Scheme metadata needed for display-color resolution. */
export interface MarkingColorMeta {
    /** Single-category color source, when category mode is used. */
    colorFrom?: string;
}

/**
 * Resolve the scheme-default display color carried by a category of concepts.
 *
 * A scheme in category mode names one category as its color driver via
 * `render.color_from`, surfaced as `meta.colorFrom`, and the authored pair
 * lives on the resolved concept in that category. This is a lookup over
 * published scheme data: find the assertion in the driving category and read
 * its color. The driving category is `single: true` by loader rule, so at most
 * one assertion ever matches. Passing a single assertion yields that part's
 * color, which is what per-token and per-chip surfaces need.
 *
 * A scheme may instead declare `render.color_from` as an ordered condition
 * list. Those conditions are scheme policy and are evaluated by the runtime
 * that owns the scheme, never here; the resulting whole-marking pair arrives on
 * `ProcessResult.displayColor` and the store carries it as
 * `EzClassifyState.displayColor`. This function returns undefined for such a
 * scheme, and callers that hold a state fall back to the state's color before
 * the generic palette.
 *
 * Returns undefined when the scheme declares no category color driver, when
 * nothing is asserted in the driving category, or when that concept carries no
 * color. On undefined, hosts fall back to their existing category palette; the
 * generic palette cycling stays the default for schemes with no authored
 * colors.
 *
 * @param meta - Scheme metadata carrying the driving category
 * @param assertions - Resolved assertions, each paired with its concept's color
 * @param scheme - Full scheme, consulted for the driving concept's authored
 *   color when the assertion projection did not carry one
 * @returns The `{ background, text }` pair, or undefined when no color applies
 */
export function resolveMarkingColor(
    meta: MarkingColorMeta,
    assertions: readonly ResolvedMarkingAssertion[],
    scheme?: Pick<SchemePublicView, 'concepts'>,
): ConceptColor | undefined {
    if (!meta.colorFrom) return undefined;
    const driving = assertions.find((a) => a.categoryId === meta.colorFrom);
    if (!driving) return undefined;
    return (
        driving.color ??
        scheme?.concepts.find((c) => c.id === driving.conceptId)?.color
    );
}
