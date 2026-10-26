import { describe, expect, it } from 'vitest';
import {
    projectEntrySpans,
    reconcileEntryIds,
} from './marked-text-area-entries';

describe('marked body entry ownership', () => {
    const text = 'Preface\n(A) One.\n(B) Two.  ';
    const spans = [
        { entryId: 'one', start: 8, end: 11 },
        { entryId: 'two', start: 17, end: 20 },
    ];
    it('replaces one token without changing any body bytes', () => {
        expect(
            projectEntrySpans(text, spans, [
                { entryId: 'one', marking: '(C)' },
                { entryId: 'two', marking: '(B)' },
            ]).text,
        ).toBe('Preface\n(C) One.\n(B) Two.  ');
    });
    it('removes tokens and keeps exact unmarked prose, including empty membership', () => {
        expect(
            projectEntrySpans(text, spans, [{ entryId: 'two', marking: '(B)' }])
                .text,
        ).toBe('Preface\n One.\n(B) Two.  ');
        expect(projectEntrySpans(text, spans, []).text).toBe(
            'Preface\n One.\n Two.  ',
        );
    });
    it('moves only explicit owned body spans and appends new entries', () => {
        expect(
            projectEntrySpans(text, spans, [
                { entryId: 'two', marking: '(B)' },
                { entryId: 'one', marking: '(A)' },
                { entryId: 'three', marking: '(C)' },
            ]).text,
        ).toBe('Preface\n(B) Two.  \n(A) One.\n(C)');
    });
    it('preserves same-line adjacency for token edits and empty entries', () => {
        const inline = '(A) One. (B) Two.';
        const inlineSpans = [
            { entryId: 'one', start: 0, end: 3 },
            { entryId: 'two', start: 9, end: 12 },
        ];
        expect(
            projectEntrySpans(inline, inlineSpans, [
                { entryId: 'one', marking: '(C)' },
                { entryId: 'two', marking: '(B)' },
            ]).text,
        ).toBe('(C) One. (B) Two.');
        expect(
            projectEntrySpans(inline, inlineSpans, [
                { entryId: 'one', marking: '' },
                { entryId: 'two', marking: '(B)' },
            ]).text,
        ).toBe(' One. (B) Two.');
    });
    it('retains identity across a token edit and a body-only insertion', () => {
        expect(
            reconcileEntryIds(
                '(A) Body',
                [{ entryId: 'one', start: 0, end: 3 }],
                '(LONG) Body',
                [{ start: 0, end: 6 }],
                () => 'new',
            ),
        ).toEqual(['one']);
        expect(
            reconcileEntryIds(
                '(A) Body',
                [{ entryId: 'one', start: 0, end: 3 }],
                '(A) Longer body',
                [{ start: 0, end: 3 }],
                () => 'new',
            ),
        ).toEqual(['one']);
    });
    it('does not attach replaced multi-paragraph content to old identities', () => {
        expect(
            reconcileEntryIds(
                text,
                spans,
                '(C) New\n(D) New',
                [
                    { start: 0, end: 3 },
                    { start: 8, end: 11 },
                ],
                () => 'new',
            ),
        ).toEqual(['new', 'new']);
    });
});
