import { afterEach, describe, it, expect } from 'vitest';
import { resetLocale, setLocale } from '../i18n';
import {
    markAttention,
    extractInner,
    applyRepairs,
    keepLeadingPartMarks,
    matchLeadingMark,
    wrapPartMark,
    fixesNeedingCorrection,
    paragraphNumber,
} from './marked-text-area-logic';
import type { RepairSegment } from './marked-text-area-logic';

describe('marked-text-area-logic', () => {
    describe('extractInner', () => {
        it('strips parentheses by default', () => {
            expect(extractInner('(ALPHA)', [])).toBe('ALPHA');
        });

        it('uses embedded pattern when it matches', () => {
            const patterns = [{ pattern: '\\((.+?)\\)' }];
            expect(extractInner('(BRAVO)', patterns)).toBe('BRAVO');
        });

        it('falls back to paren stripping when pattern does not match', () => {
            const patterns = [{ pattern: '\\[(.+?)\\]' }];
            expect(extractInner('(CHARLIE)', patterns)).toBe('CHARLIE');
        });

        it('handles patterns with different delimiters', () => {
            const patterns = [{ pattern: '<<(.+?)>>' }];
            expect(extractInner('<<DELTA>>', patterns)).toBe('DELTA');
        });

        it('returns trimmed content', () => {
            expect(extractInner('( ECHO )', [])).toBe('ECHO');
        });

        it('tries multiple patterns and uses the first match', () => {
            const patterns = [
                { pattern: '\\[(.+?)\\]' },
                { pattern: '\\((.+?)\\)' },
            ];
            expect(extractInner('(FOXTROT)', patterns)).toBe('FOXTROT');
        });
    });

    describe('wrapPartMark', () => {
        const template = '({marking}) ';
        const patterns = '\\(([^)]+)\\)';
        const greedy = '\\((.+)\\)';

        it('wraps a bare rendered marking once with the template', () => {
            expect(wrapPartMark('S//NF', template, patterns)).toBe('(S//NF) ');
        });

        it('leaves a rendered marking that already is one whole wrapped mark alone', () => {
            // A scheme whose part view spells its own delimiters, e.g. a tag
            // list whose concepts render as "(gluten)".
            expect(wrapPartMark('(gluten)', template, patterns)).toBe(
                '(gluten)',
            );
        });

        it('still wraps when the delimiters only appear inside the marking', () => {
            expect(wrapPartMark('S//REL TO (X)', template, patterns)).toBe(
                '(S//REL TO (X)) ',
            );
        });

        it('does not let a greedy pattern take two marks for one', () => {
            expect(wrapPartMark('(A)//(B)', template, greedy)).toBe(
                '((A)//(B)) ',
            );
            expect(wrapPartMark('(gluten)', template, greedy)).toBe('(gluten)');
        });

        it('wraps when the scheme declares no embedded pattern', () => {
            expect(wrapPartMark('(gluten)', template, undefined)).toBe(
                '((gluten)) ',
            );
        });

        it('returns an empty string for an empty rendering', () => {
            expect(wrapPartMark('', template, patterns)).toBe('');
        });
    });

    describe('fixesNeedingCorrection', () => {
        const add = (...conceptIds: string[]) => ({
            ruleId: 'derive',
            action: 'add',
            add: conceptIds.map((conceptId) => ({
                conceptId,
                categoryId: 'c',
            })),
            message: `added ${conceptIds.join(', ')}`,
        });

        it('keeps an added concept the field format writes', () => {
            const fixes = [add('VISIBLE')];
            expect(fixesNeedingCorrection(fixes, new Set())).toEqual(fixes);
        });

        it('drops an added concept the field format never writes', () => {
            expect(
                fixesNeedingCorrection(
                    [add('IMPLICIT')],
                    new Set(['IMPLICIT']),
                ),
            ).toEqual([]);
        });

        it('keeps an add that also puts in a concept the format writes', () => {
            const fixes = [add('IMPLICIT', 'VISIBLE')];
            expect(
                fixesNeedingCorrection(fixes, new Set(['IMPLICIT'])),
            ).toEqual(fixes);
        });

        it('drops tolerant recognition, which changes no fact', () => {
            const reorder = {
                ruleId: 'recognition',
                action: 'reorder',
                message: 'Read `gluten` as `(gluten)` (alias).',
            };
            expect(fixesNeedingCorrection([reorder], new Set())).toEqual([]);
        });

        it('keeps removals and replacements of what the author wrote', () => {
            const remove = {
                ruleId: 'r',
                action: 'remove',
                remove: [{ conceptId: 'IMPLICIT', categoryId: 'c' }],
                message: 'removed',
            };
            const replace = {
                ruleId: 'p',
                action: 'replace',
                remove: [{ conceptId: 'IMPLICIT', categoryId: 'c' }],
                add: [{ conceptId: 'OTHER', categoryId: 'c' }],
                message: 'replaced',
            };
            expect(
                fixesNeedingCorrection(
                    [remove, replace],
                    new Set(['IMPLICIT']),
                ),
            ).toEqual([remove, replace]);
        });

        it('keeps a fix that states no action', () => {
            const bare = { ruleId: 'legacy', message: 'Removed the suffix' };
            expect(fixesNeedingCorrection([bare], new Set())).toEqual([bare]);
        });
    });

    describe('applyRepairs', () => {
        const template = '({marking}) ';

        it('does not wrap a rendering that already carries the wrapper', () => {
            const segments: RepairSegment[] = [
                {
                    start: 0,
                    end: 8,
                    marking: '(gluten)',
                    rendered: '(gluten)',
                    repaired: true,
                },
            ];
            const result = applyRepairs(
                segments,
                '(gluten) Pasta.',
                template,
                '\\(([^)]+)\\)',
            );
            expect(result.patched).toBe(false);
            expect(result.value).toBe('(gluten) Pasta.');
        });

        it('returns patched=false when no segments are repaired', () => {
            const segments: RepairSegment[] = [
                {
                    start: 0,
                    end: 3,
                    marking: '(A)',
                    rendered: 'A',
                    repaired: false,
                },
            ];
            const result = applyRepairs(segments, '(A) text', template);
            expect(result.patched).toBe(false);
            expect(result.value).toBe('(A) text');
            expect(result.drift).toBe(0);
        });

        it('patches a repaired segment', () => {
            const segments: RepairSegment[] = [
                {
                    start: 0,
                    end: 3,
                    marking: '(A)',
                    rendered: 'B',
                    repaired: true,
                },
            ];
            const result = applyRepairs(segments, '(A) text', template);
            expect(result.patched).toBe(true);
            expect(result.value).toBe('(B) text');
            expect(result.drift).toBe(0);
        });

        it('tracks drift when replacement changes length', () => {
            const segments: RepairSegment[] = [
                {
                    start: 0,
                    end: 3,
                    marking: '(A)',
                    rendered: 'LONG',
                    repaired: true,
                },
            ];
            const result = applyRepairs(segments, '(A) text', template);
            expect(result.patched).toBe(true);
            expect(result.value).toBe('(LONG) text');
            expect(result.drift).toBe(3);
        });

        it('skips repaired segments whose corrected form matches the original', () => {
            const segments: RepairSegment[] = [
                {
                    start: 0,
                    end: 3,
                    marking: '(A)',
                    rendered: 'A',
                    repaired: true,
                },
            ];
            const result = applyRepairs(segments, '(A) text', template);
            expect(result.patched).toBe(false);
        });

        it('applies drift to subsequent segments', () => {
            const segments: RepairSegment[] = [
                {
                    start: 0,
                    end: 3,
                    marking: '(A)',
                    rendered: 'AB',
                    repaired: true,
                },
                {
                    start: 9,
                    end: 12,
                    marking: '(C)',
                    rendered: 'D',
                    repaired: true,
                },
            ];
            const result = applyRepairs(
                segments,
                '(A) text (C) more',
                template,
            );
            expect(result.patched).toBe(true);
            expect(result.value).toBe('(AB) text (D) more');
        });
    });

    describe('keepLeadingPartMarks', () => {
        // Helper: locate each candidate's start offset in the text by literal find.
        const at = (text: string, ...markings: string[]) =>
            markings.map((m) => ({ start: text.indexOf(m), marking: m }));

        it('keeps a single leading mark', () => {
            const text =
                '(U) Some plain definition prose with no other parens.';
            const scanned = at(text, '(U)');
            expect(keepLeadingPartMarks(scanned, text)).toEqual(scanned);
        });

        it('drops a mid-prose parenthesized citation token', () => {
            // The SECRET-guidance false positive: real "(U)" lead + a "§1.2(a)" cite.
            const text =
                '(U) Marking Sponsor/Policy Basis: OCA/EO 13526, §1.2(a).';
            const lead = { start: text.indexOf('(U)'), marking: '(U)' };
            const cite = { start: text.indexOf('(a)'), marking: '(a)' };
            const kept = keepLeadingPartMarks([lead, cite], text);
            expect(kept).toEqual([lead]);
        });

        it('keeps one leading mark per line in a multi-paragraph field', () => {
            const text = '(U) Para one.\n\n(S) Para two.';
            const scanned = at(text, '(U)', '(S)');
            expect(keepLeadingPartMarks(scanned, text)).toEqual(scanned);
        });

        it('treats whitespace/indent before a mark as still leading', () => {
            const text = '   (C) indented mark';
            const scanned = at(text, '(C)');
            expect(keepLeadingPartMarks(scanned, text)).toEqual(scanned);
        });

        it('drops a mark when non-blank text precedes it on the same line', () => {
            const text = 'see also (TS) for the higher level';
            const scanned = at(text, '(TS)');
            expect(keepLeadingPartMarks(scanned, text)).toEqual([]);
        });

        it('keeps the line-leading mark but drops a same-line trailing one', () => {
            const text = '(U) refer to clause (b) below';
            const lead = { start: text.indexOf('(U)'), marking: '(U)' };
            const trailing = { start: text.indexOf('(b)'), marking: '(b)' };
            expect(keepLeadingPartMarks([lead, trailing], text)).toEqual([
                lead,
            ]);
        });

        it('keeps the leading mark and drops a mid-sentence prose parenthetical', () => {
            // A description field with a leading "(U)" plus a later
            // "(effective 31 December 2016)" parenthetical. Only the leading mark is a
            // genuine part mark; the mid-sentence parenthetical is prose.
            const text =
                '(U) Classification and control markings for US government documents per the 2016 IC Markings System Register and Manual (effective 31 December 2016), implementing ICD 710 and EO 13526.';
            const lead = { start: text.indexOf('(U)'), marking: '(U)' };
            const parenthetical = {
                start: text.indexOf('(effective'),
                marking: '(effective 31 December 2016)',
            };
            expect(keepLeadingPartMarks([lead, parenthetical], text)).toEqual([
                lead,
            ]);
        });
    });

    describe('matchLeadingMark', () => {
        // us-gov-capco ships a greedy wrapper pattern.
        const greedy = '\\((.+)\\)';

        it('matches only the leading mark when prose has a later paren', () => {
            const text =
                '(U) Marking Sponsor/Policy Basis: OCA/EO 13526, §1.2(a). Further';
            expect(matchLeadingMark(text, greedy)).toBe('(U)');
        });

        it('matches the leading mark when there is no later paren', () => {
            expect(
                matchLeadingMark(
                    '(U) Under EO 13526, SECRET must be applied',
                    greedy,
                ),
            ).toBe('(U)');
        });

        it('keeps joint markings intact (no inner paren)', () => {
            expect(
                matchLeadingMark('(TS//SI) some text (b) later', greedy),
            ).toBe('(TS//SI)');
        });

        it('returns empty when no mark leads the value', () => {
            expect(
                matchLeadingMark('plain prose, no marking here', greedy),
            ).toBe('');
        });

        it('returns empty for empty inputs', () => {
            expect(matchLeadingMark('', greedy)).toBe('');
            expect(matchLeadingMark('(U) x', '')).toBe('');
        });

        it('honors an already-anchored, already-reluctant pattern', () => {
            expect(matchLeadingMark('(C) text (z)', '^\\((.+?)\\)')).toBe(
                '(C)',
            );
        });
    });
});

describe('markAttention', () => {
    afterEach(() => resetLocale());

    it('puts each message on its own tooltip line, the first one as the title', () => {
        const { tooltip } = markAttention('invalid', [
            'PUBLIC cannot carry sensitive-content tags.',
            'Financial information is confidential at minimum',
        ]);
        expect(tooltip).toBe(
            'PUBLIC cannot carry sensitive-content tags.\n' +
                'Financial information is confidential at minimum.',
        );
        expect(tooltip).not.toContain('.;');
    });

    it('names the mark by its state and its messages as whole sentences', () => {
        expect(markAttention('invalid', ['One.', 'Two']).label).toBe(
            'Invalid marking: One. Two. Activate to edit.',
        );
        expect(markAttention('warning', ['Heads up.']).label).toBe(
            'Marking has a warning: Heads up. Activate to edit.',
        );
    });

    it('takes its words from the locale table', () => {
        setLocale({
            'mark.invalidLabel': 'Marquage invalide : {messages}',
            'mark.warningLabel': 'Avertissement : {messages}',
        } as never);
        expect(markAttention('invalid', ['Un.']).label).toBe(
            'Marquage invalide : Un.',
        );
        expect(markAttention('warning', ['Deux.']).label).toBe(
            'Avertissement : Deux.',
        );
    });
});

describe('paragraphNumber', () => {
    const body = '(C) One.\n\n(I) Two.\n(U) Three.';
    it('counts from 1, skipping the blank lines between paragraphs', () => {
        expect(paragraphNumber(body, 0)).toBe(1);
        expect(paragraphNumber(body, body.indexOf('(I)'))).toBe(2);
        expect(paragraphNumber(body, body.indexOf('(U)'))).toBe(3);
    });

    it('counts a position inside a paragraph as that paragraph', () => {
        expect(paragraphNumber(body, body.indexOf('Two'))).toBe(2);
    });
});
