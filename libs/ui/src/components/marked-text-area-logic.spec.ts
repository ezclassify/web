import { afterEach, describe, it, expect } from 'vitest';
import { resetLocale, setLocale } from '../i18n';
import {
    markAttention,
    extractInner,
    applyRepairs,
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

        it('reads a greedy pattern as written', () => {
            expect(wrapPartMark('(gluten)', template, greedy)).toBe('(gluten)');
            expect(wrapPartMark('S//REL TO (X)', template, greedy)).toBe(
                '(S//REL TO (X)) ',
            );
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
            expect(result.caret).toBe(0);
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
        });

        it('moves a caret after a repair by the length the repair changed', () => {
            const segments: RepairSegment[] = [
                {
                    start: 0,
                    end: 3,
                    marking: '(A)',
                    rendered: 'LONG',
                    repaired: true,
                },
            ];
            const result = applyRepairs(
                segments,
                '(A) text',
                template,
                undefined,
                5,
            );
            expect(result.patched).toBe(true);
            expect(result.value).toBe('(LONG) text');
            expect(result.caret).toBe(8);
        });

        it('keeps a caret ahead of a repair where it is', () => {
            // A caret on the first line must not move for a shorter mark
            // written on a later line: counting that repair would put it
            // before the start of the text, which a textarea reads as its end.
            const segments: RepairSegment[] = [
                {
                    start: 8,
                    end: 18,
                    marking: '(INTERNAL)',
                    rendered: 'I',
                    repaired: true,
                },
            ];
            const result = applyRepairs(
                segments,
                '(A) one\n(INTERNAL) two',
                template,
                undefined,
                2,
            );
            expect(result.value).toBe('(A) one\n(I) two');
            expect(result.caret).toBe(2);
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

    describe('matchLeadingMark', () => {
        const bounded = '\\(([^)]+)\\)';
        const greedy = '\\((.+)\\)';

        it('matches the mark that leads the value', () => {
            expect(matchLeadingMark('(U) see section (a) below', bounded)).toBe(
                '(U)',
            );
            expect(matchLeadingMark('(TS//SI) text', greedy)).toBe('(TS//SI)');
        });

        it('applies a greedy pattern as written, as the scan does', () => {
            expect(matchLeadingMark('(U) see section (a) below', greedy)).toBe(
                '(U) see section (a)',
            );
        });

        it('returns empty when no mark leads the value', () => {
            expect(
                matchLeadingMark('plain prose, no marking here', greedy),
            ).toBe('');
            expect(matchLeadingMark('see (U) here', bounded)).toBe('');
        });

        it('returns empty for empty inputs or a pattern that does not compile', () => {
            expect(matchLeadingMark('', greedy)).toBe('');
            expect(matchLeadingMark('(U) x', '')).toBe('');
            expect(matchLeadingMark('(U) x', '(')).toBe('');
        });

        it('honors an already-anchored pattern', () => {
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
