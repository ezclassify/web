/**
 * The one ranking function every field's composer uses.
 *
 * A query is matched against a suggestion's short form (the label the active
 * format writes), its long form (the concept name) and its other spellings (the
 * scheme's views and aliases). The best field decides the tier. Tiers are, from
 * best: an exact match, a prefix match, a match at the start of a later word,
 * then a match anywhere. The first three are the ranked list; a match anywhere
 * sits below the threshold and is kept behind a "more" row rather than mixed
 * in, because a two-letter query otherwise surfaces a mid-word hit above the
 * value the user is spelling.
 *
 * Near misses (a dropped or swapped letter) are not ranked here at all. They
 * belong to {@link closestSpelling}, which answers "did you mean" for text the
 * parser could not read.
 */

import type { Suggestion } from '@ezclassify/types';

/** How strongly a query matched, best first. */
export type MatchTier = 'exact' | 'prefix' | 'word' | 'substring';

/** Which spelling of the suggestion produced its best match. */
export type MatchSource = 'label' | 'name' | 'other';

/** One suggestion with the reason it ranked where it did. */
export interface RankedSuggestion {
    readonly suggestion: Suggestion;
    readonly tier: MatchTier;
    readonly source: MatchSource;
    /**
     * The spelling that matched when it was neither the short nor the long
     * form, so a row can say which alias produced it. Undefined otherwise.
     */
    readonly matchedSpelling?: string;
}

/** A ranked query result: the rows above the threshold and those below it. */
export interface RankedResult {
    /** Exact, prefix and word-start matches, best first. */
    readonly primary: RankedSuggestion[];
    /** Substring matches, kept for a "more" row. */
    readonly more: RankedSuggestion[];
}

const TIER_ORDER: Record<MatchTier, number> = {
    exact: 0,
    prefix: 1,
    word: 2,
    substring: 3,
};

const SOURCE_ORDER: Record<MatchSource, number> = {
    label: 0,
    name: 1,
    other: 2,
};

/** Case- and spacing-insensitive form used for every comparison. */
export function normalizeSpelling(text: string): string {
    return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

/** The tier `query` reaches against one spelling, or null for no match. */
export function matchTier(query: string, spelling: string): MatchTier | null {
    const q = normalizeSpelling(query);
    const s = normalizeSpelling(spelling);
    if (!q || !s) return null;
    if (s === q) return 'exact';
    if (s.startsWith(q)) return 'prefix';
    const at = s.indexOf(q);
    if (at < 0) return null;
    // A word start is a match right after a space or punctuation, so "info"
    // reaches "STUDENT INFORMATION" at the same tier as a prefix would.
    for (let i = at; i >= 0; i = s.indexOf(q, i + 1)) {
        if (i > 0 && /[\s\-/(,.]/.test(s[i - 1])) return 'word';
        if (i + 1 >= s.length) break;
    }
    return 'substring';
}

/**
 * Every spelling of a suggestion that the user might type, deduplicated
 * case-insensitively, with the short and long forms first.
 */
export function spellingsOf(
    suggestion: Suggestion,
    aliases: readonly string[] = [],
): { text: string; source: MatchSource }[] {
    const seen = new Set<string>();
    const out: { text: string; source: MatchSource }[] = [];
    const add = (text: string | undefined, source: MatchSource) => {
        if (!text) return;
        const key = normalizeSpelling(text);
        if (!key || seen.has(key)) return;
        seen.add(key);
        out.push({ text, source });
    };
    add(suggestion.label, 'label');
    add(suggestion.name, 'name');
    for (const view of Object.values(suggestion.views ?? {}))
        add(view, 'other');
    for (const alias of aliases) add(alias, 'other');
    return out;
}

/** The best match of `query` against one suggestion, or null. */
export function rankOne(
    query: string,
    suggestion: Suggestion,
    aliases: readonly string[] = [],
): RankedSuggestion | null {
    let best: RankedSuggestion | null = null;
    for (const spelling of spellingsOf(suggestion, aliases)) {
        const tier = matchTier(query, spelling.text);
        if (!tier) continue;
        const better =
            !best ||
            TIER_ORDER[tier] < TIER_ORDER[best.tier] ||
            (TIER_ORDER[tier] === TIER_ORDER[best.tier] &&
                SOURCE_ORDER[spelling.source] < SOURCE_ORDER[best.source]);
        if (better) {
            best = {
                suggestion,
                tier,
                source: spelling.source,
                matchedSpelling:
                    spelling.source === 'other' ? spelling.text : undefined,
            };
        }
    }
    return best;
}

/**
 * True when `query` reaches any suggestion above the substring tier: the
 * question the caret-token search asks for each candidate word run. It stops at
 * the first hit and sorts nothing, since the token search asks it for several
 * candidates on every keystroke.
 */
export function reachesAny(
    query: string,
    suggestions: readonly Suggestion[],
    aliasesOf: (s: Suggestion) => readonly string[] = () => [],
): boolean {
    if (!normalizeSpelling(query)) return false;
    return suggestions.some((suggestion) =>
        spellingsOf(suggestion, aliasesOf(suggestion)).some((spelling) => {
            const tier = matchTier(query, spelling.text);
            return tier !== null && tier !== 'substring';
        }),
    );
}

/**
 * Rank `suggestions` for `query`. An empty query ranks nothing: browsing is a
 * grouped view, not a ranked one.
 *
 * Order within a tier: available before gated, a match on the short form before
 * one on the long form or an alias, a shorter short form first (the closer
 * completion), then the order the engine returned.
 *
 * @param query - The caret token
 * @param suggestions - Candidate suggestions, in engine order
 * @param aliasesOf - Extra spellings for a suggestion (the scheme's aliases)
 */
export function rankSuggestions(
    query: string,
    suggestions: readonly Suggestion[],
    aliasesOf: (s: Suggestion) => readonly string[] = () => [],
): RankedResult {
    if (!normalizeSpelling(query)) return { primary: [], more: [] };
    const ranked: { row: RankedSuggestion; index: number }[] = [];
    suggestions.forEach((suggestion, index) => {
        const row = rankOne(query, suggestion, aliasesOf(suggestion));
        if (row) ranked.push({ row, index });
    });
    ranked.sort((a, b) => {
        const tier = TIER_ORDER[a.row.tier] - TIER_ORDER[b.row.tier];
        if (tier !== 0) return tier;
        const gated =
            (a.row.suggestion.gated ? 1 : 0) - (b.row.suggestion.gated ? 1 : 0);
        if (gated !== 0) return gated;
        const source = SOURCE_ORDER[a.row.source] - SOURCE_ORDER[b.row.source];
        if (source !== 0) return source;
        const length =
            a.row.suggestion.label.length - b.row.suggestion.label.length;
        if (length !== 0) return length;
        return a.index - b.index;
    });
    const primary: RankedSuggestion[] = [];
    const more: RankedSuggestion[] = [];
    for (const { row } of ranked) {
        (row.tier === 'substring' ? more : primary).push(row);
    }
    return { primary, more };
}

/**
 * Edit distance with adjacent transpositions (optimal string alignment),
 * capped: returns `limit + 1` when the distance exceeds `limit`.
 */
export function editDistance(a: string, b: string, limit: number): number {
    if (Math.abs(a.length - b.length) > limit) return limit + 1;
    if (a.length === 0) return b.length;
    if (b.length === 0) return a.length;

    const cap = limit + 1;
    const cols = b.length + 1;
    let twoRowsBack = new Array<number>(cols).fill(cap);
    let previous = new Array<number>(cols).fill(cap);
    let current = new Array<number>(cols).fill(cap);
    for (let j = 0; j <= Math.min(b.length, limit); j++) previous[j] = j;

    for (let i = 1; i <= a.length; i++) {
        const from = Math.max(1, i - limit);
        const to = Math.min(b.length, i + limit);
        current[0] = Math.min(i, cap);
        if (from > 1) current[from - 1] = cap;
        for (let j = from; j <= to; j++) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            let v = Math.min(
                previous[j] + 1,
                current[j - 1] + 1,
                previous[j - 1] + cost,
            );
            if (
                i > 1 &&
                j > 1 &&
                a[i - 1] === b[j - 2] &&
                a[i - 2] === b[j - 1]
            ) {
                v = Math.min(v, twoRowsBack[j - 2] + 1);
            }
            current[j] = Math.min(v, cap);
        }
        if (to < b.length) current[to + 1] = cap;
        [twoRowsBack, previous, current] = [previous, current, twoRowsBack];
    }
    return previous[b.length];
}

/**
 * The suggestion whose spelling is closest to `fragment`, for a "did you mean"
 * correction on text the parser could not read. Tolerates about one mistake per
 * four characters; shorter fragments get one. Returns null when nothing is that
 * close, because guessing further only offers a wrong value with confidence.
 *
 * @returns The suggestion and the spelling it matched, or null
 */
export function closestSpelling(
    fragment: string,
    suggestions: readonly Suggestion[],
    aliasesOf: (s: Suggestion) => readonly string[] = () => [],
): { suggestion: Suggestion; spelling: string } | null {
    const f = normalizeSpelling(fragment);
    if (f.length < 2) return null;
    const limit = Math.max(1, Math.floor(f.length / 4));
    let best: { suggestion: Suggestion; spelling: string; d: number } | null =
        null;
    for (const suggestion of suggestions) {
        if (suggestion.gated) continue;
        for (const spelling of spellingsOf(suggestion, aliasesOf(suggestion))) {
            const s = normalizeSpelling(spelling.text);
            const d = editDistance(f, s, limit);
            if (d > limit || d === 0) continue;
            if (!best || d < best.d) {
                best = { suggestion, spelling: spelling.text, d };
            }
        }
    }
    return best
        ? { suggestion: best.suggestion, spelling: best.spelling }
        : null;
}
