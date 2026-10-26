/**
 * Project a spec's format fixture into the `RenderFormatLayout` a real adapter
 * publishes.
 *
 * Specs here describe a format the way a scheme author thinks about one: the
 * categories it writes, what goes between them, and what goes between two
 * values of one category. An adapter never hands that description to a UI. It
 * hands over `SchemeMetaView.formats`, already resolved, and this is the one
 * place a mock engine turns the former into the latter, so a fixture stays
 * readable without every spec restating the projected shape.
 *
 * Excluded from the published tarball by the `*-mock.ts` rule in
 * `tsconfig.lib.json`.
 */

import type { RenderFormatLayout } from '@ezclassify/types';

/** A spec's description of one format, in the terms a fixture states it. */
export interface MockFormatFixture {
    id: string;
    /** The scheme scope this format writes. Defaults to `default`. */
    surface?: string;
    /** Defaults to `inline`. */
    mode?: 'inline' | 'block';
    /** Default concept view key. */
    view?: string;
    /** The categories this format writes, in order. */
    categoryOrder?: string[];
    /** Written between two values of one category. */
    separator?: string;
    /** Written between two adjacent categories. */
    categorySeparator?: string;
    /** Resolved text before a named category, overriding the default. */
    separatorBefore?: Record<string, string>;
    /** Concept view per category, where it differs from the format's own. */
    categoryViews?: Record<string, string>;
    /** Tier compositions per category, outermost tier first. */
    categoryTiers?: RenderFormatLayout['categoryTiers'];
    /** What is written around every value, per category. */
    categoryEach?: RenderFormatLayout['categoryEach'];
    /** Headings paired with the lists they head. */
    headers?: RenderFormatLayout['headers'];
}

/** Project one fixture format into its published layout. */
export function mockRenderFormat(
    fixture: MockFormatFixture,
): RenderFormatLayout {
    const categoryOrder = fixture.categoryOrder ?? [];
    const layout: RenderFormatLayout = {
        id: fixture.id,
        surface: fixture.surface ?? 'default',
        mode: fixture.mode ?? 'inline',
        categoryOrder: [...categoryOrder],
    };
    if (fixture.view !== undefined) layout.view = fixture.view;
    if (fixture.categorySeparator !== undefined) {
        layout.separator = fixture.categorySeparator;
    }
    if (fixture.separator !== undefined && categoryOrder.length > 0) {
        layout.categorySeparators = Object.fromEntries(
            categoryOrder.map((category) => [category, fixture.separator!]),
        );
    }
    if (fixture.separatorBefore !== undefined) {
        layout.separatorBefore = fixture.separatorBefore;
    }
    if (fixture.categoryViews !== undefined) {
        layout.categoryViews = fixture.categoryViews;
    }
    if (fixture.categoryTiers !== undefined) {
        layout.categoryTiers = fixture.categoryTiers;
    }
    if (fixture.categoryEach !== undefined) {
        layout.categoryEach = fixture.categoryEach;
    }
    if (fixture.headers !== undefined) layout.headers = fixture.headers;
    return layout;
}

/** Project a fixture's whole format list, tolerating an absent one. */
export function mockRenderFormats(
    fixtures: readonly MockFormatFixture[] | undefined,
): RenderFormatLayout[] {
    return (fixtures ?? []).map(mockRenderFormat);
}
