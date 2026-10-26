import { describe, expect, it } from 'vitest';
import type { Suggestion } from '@ezclassify/types';
import {
    reachesAny,
    closestSpelling,
    editDistance,
    matchTier,
    rankSuggestions,
    spellingsOf,
} from './composer-ranking';

function s(
    conceptId: string,
    label: string,
    name = label,
    extra: Partial<Suggestion> = {},
): Suggestion {
    return {
        conceptId,
        categoryId: 'c',
        label,
        description: name,
        name,
        views: { default: label },
        group: 'Group',
        selected: false,
        order: 0,
        ...extra,
    };
}

describe('matchTier', () => {
    it('orders exact, prefix, word start and substring', () => {
        expect(matchTier('secret', 'SECRET')).toBe('exact');
        expect(matchTier('sec', 'SECRET')).toBe('prefix');
        expect(matchTier('info', 'STUDENT INFORMATION')).toBe('word');
        expect(matchTier('cre', 'SECRET')).toBe('substring');
        expect(matchTier('xyz', 'SECRET')).toBeNull();
    });

    it('ignores case and repeated spaces', () => {
        expect(matchTier('student  info', 'STUDENT INFORMATION')).toBe(
            'prefix',
        );
    });
});

describe('rankSuggestions', () => {
    const all = [
        s('RESTRICTED', 'RESTRICTED'),
        s('SECRET', 'SECRET'),
        s('SECURITY', 'SECURITY INFORMATION'),
        s('STUDENT', 'STUDENT INFORMATION'),
        s('INTERNAL', 'INTERNAL'),
    ];

    it('ranks nothing for an empty query (browse is grouped, not ranked)', () => {
        expect(rankSuggestions('', all)).toEqual({ primary: [], more: [] });
    });

    it('puts prefix matches above word-start matches, shorter first', () => {
        const r = rankSuggestions('se', all);
        expect(r.primary.map((x) => x.suggestion.conceptId)).toEqual([
            'SECRET',
            'SECURITY',
        ]);
    });

    it('keeps substring matches below the threshold, behind "more"', () => {
        const r = rankSuggestions('te', all);
        expect(r.primary.map((x) => x.suggestion.conceptId)).toEqual([]);
        expect(r.more.map((x) => x.suggestion.conceptId).sort()).toEqual([
            'INTERNAL',
            'RESTRICTED',
        ]);
    });

    it('matches a later word at the word-start tier', () => {
        const r = rankSuggestions('info', all);
        // Same tier, so the shorter short form comes first.
        expect(r.primary.map((x) => x.suggestion.conceptId)).toEqual([
            'STUDENT',
            'SECURITY',
        ]);
        expect(r.primary.every((x) => x.tier === 'word')).toBe(true);
    });

    it('sorts gated rows after available ones within a tier', () => {
        const r = rankSuggestions('s', [
            s('A', 'SA', 'SA', { gated: true }),
            s('B', 'SB'),
        ]);
        expect(r.primary.map((x) => x.suggestion.conceptId)).toEqual([
            'B',
            'A',
        ]);
    });

    it('says which alias produced a match, and only then', () => {
        const oak = s('OAK', 'OAKWOOD', 'Oakwood Middle School');
        const byAlias = rankSuggestions('oakwood middle', [oak], () => [
            'oakwood middle school',
        ]);
        expect(byAlias.primary[0].source).toBe('name');
        expect(byAlias.primary[0].matchedSpelling).toBeUndefined();
        const aliasOnly = rankSuggestions('big oak', [oak], () => [
            'big oak campus',
        ]);
        expect(aliasOnly.primary[0].matchedSpelling).toBe('big oak campus');
    });
});

describe('spellingsOf', () => {
    it('deduplicates spellings case-insensitively, short form first', () => {
        const out = spellingsOf(
            s('X', 'OAKWOOD', 'Oakwood', {
                views: { default: 'OAKWOOD', long: 'oakwood', short: 'OAK' },
            }),
            ['Oak', 'OAKWOOD MIDDLE'],
        );
        expect(out.map((o) => o.text)).toEqual([
            'OAKWOOD',
            'OAK',
            'OAKWOOD MIDDLE',
        ]);
    });
});

describe('closestSpelling', () => {
    const all = [s('C', 'CONFIDENTIAL'), s('R', 'RESTRICTED'), s('A', 'ALPHA')];

    it('offers the nearest spelling for a typo', () => {
        expect(closestSpelling('confidentail', all)?.suggestion.conceptId).toBe(
            'C',
        );
        expect(closestSpelling('Alpah', all)?.suggestion.conceptId).toBe('A');
    });

    it('offers nothing when nothing is close enough to trust', () => {
        expect(closestSpelling('zzzzzz', all)).toBeNull();
        expect(closestSpelling('x', all)).toBeNull();
    });

    it('never offers a gated concept', () => {
        expect(
            closestSpelling('alpah', [
                s('A', 'ALPHA', 'ALPHA', { gated: true }),
            ]),
        ).toBeNull();
    });

    it('keeps the first suggestion on an equal-distance tie', () => {
        const first = s('FIRST', 'ABCE');
        const second = s('SECOND', 'ABCF');
        expect(closestSpelling('ABCD', [first, second])?.suggestion).toBe(
            first,
        );
    });
});

describe('editDistance', () => {
    it('counts an adjacent swap as one edit', () => {
        expect(editDistance('alpah', 'alpha', 3)).toBe(1);
        expect(editDistance('abc', 'abc', 3)).toBe(0);
        expect(editDistance('abc', 'xyz', 1)).toBe(2);
    });

    it('handles an empty spelling within the cap', () => {
        expect(editDistance('a', '', 1)).toBe(1);
        expect(editDistance('', 'a', 1)).toBe(1);
    });

    it('agrees with optimal-string-alignment distance within its cap', () => {
        const words = [''];
        for (let length = 1; length <= 4; length++) {
            for (let mask = 0; mask < 1 << length; mask++) {
                words.push(
                    Array.from({ length }, (_, bit) =>
                        mask & (1 << bit) ? 'b' : 'a',
                    ).join(''),
                );
            }
        }
        const reference = (a: string, b: string): number => {
            const d = Array.from({ length: a.length + 1 }, () =>
                new Array<number>(b.length + 1).fill(0),
            );
            for (let i = 0; i <= a.length; i++) d[i][0] = i;
            for (let j = 0; j <= b.length; j++) d[0][j] = j;
            for (let i = 1; i <= a.length; i++) {
                for (let j = 1; j <= b.length; j++) {
                    const cost = a[i - 1] === b[j - 1] ? 0 : 1;
                    d[i][j] = Math.min(
                        d[i - 1][j] + 1,
                        d[i][j - 1] + 1,
                        d[i - 1][j - 1] + cost,
                    );
                    if (
                        i > 1 &&
                        j > 1 &&
                        a[i - 1] === b[j - 2] &&
                        a[i - 2] === b[j - 1]
                    ) {
                        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
                    }
                }
            }
            return d[a.length][b.length];
        };
        for (const a of words) {
            for (const b of words) {
                const exact = reference(a, b);
                for (const limit of [0, 1, 2, 3]) {
                    const actual = editDistance(a, b, limit);
                    if (exact <= limit)
                        expect(actual, `${a}/${b}, limit ${limit}`).toBe(exact);
                    else
                        expect(
                            actual,
                            `${a}/${b}, limit ${limit}`,
                        ).toBeGreaterThan(limit);
                }
            }
        }
    });

    it('bounds near-match work to the error band', () => {
        const readsFor = (length: number): number => {
            let reads = 0;
            const counted = (value: string): string =>
                new Proxy(Object(value) as String, {
                    get(target, key, receiver) {
                        if (typeof key === 'string' && /^\d+$/.test(key))
                            reads++;
                        return Reflect.get(target, key, receiver);
                    },
                }) as unknown as string;
            const a = counted('a'.repeat(length));
            const b = counted('a'.repeat(length - 1) + 'b');
            expect(editDistance(a, b, 2)).toBe(1);
            return reads;
        };
        const small = readsFor(192);
        const large = readsFor(384);
        expect(large).toBeLessThan(small * 2.6);
    });
});

describe('reachesAny', () => {
    const list = [
        {
            conceptId: 'A',
            categoryId: 'c',
            label: 'ALPHA',
            name: 'First letter',
            views: {},
        },
        {
            conceptId: 'B',
            categoryId: 'c',
            label: 'BRAVO',
            name: 'Second letter',
            views: {},
        },
    ] as never[];

    it('agrees with the primary tiers of rankSuggestions', () => {
        for (const q of ['al', 'ALPHA', 'second', 'lph', 'zz', '']) {
            expect(reachesAny(q, list)).toBe(
                rankSuggestions(q, list).primary.length > 0,
            );
        }
    });

    it('counts an alias', () => {
        expect(
            reachesAny('ay', list, (s) => (s.conceptId === 'A' ? ['AY'] : [])),
        ).toBe(true);
    });
});
