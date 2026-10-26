import { describe, expect, it } from 'vitest';
import { caretToken, segmentAround, spliceToken } from './composer-text';

const SEPS = ['//', '/'];
const labels = ['STUDENT INFORMATION', 'SECRET', 'NOFORN', 'OAKWOOD'];
const hasMatch = (q: string) =>
    labels.some((l) => l.toLowerCase().startsWith(q.toLowerCase()));

describe('segmentAround', () => {
    it('bounds the caret by the nearest format separators, longest first', () => {
        expect(segmentAround('SECRET//NOF', 11, SEPS)).toEqual({
            start: 8,
            end: 11,
        });
        expect(segmentAround('A//B/C', 4, SEPS)).toEqual({ start: 3, end: 4 });
    });

    it('never splits on a separator made only of whitespace', () => {
        expect(segmentAround('SECRET NOF', 10, [' ', '//'])).toEqual({
            start: 0,
            end: 10,
        });
    });

    it('treats a line break as a boundary', () => {
        expect(segmentAround('ONE\nTWO', 6, SEPS)).toEqual({
            start: 4,
            end: 7,
        });
    });
});

describe('caretToken', () => {
    it('is the word at the caret when nothing longer matches', () => {
        expect(caretToken('SECRET NOF', 10, SEPS, hasMatch)).toEqual({
            start: 7,
            end: 10,
            query: 'NOF',
        });
    });

    it('extends over earlier words while they still match a multi-word label', () => {
        expect(caretToken('STUDENT INF', 11, SEPS, hasMatch)).toEqual({
            start: 0,
            end: 11,
            query: 'STUDENT INF',
        });
    });

    it('stops at a format separator', () => {
        expect(caretToken('SECRET//NOF', 11, SEPS, hasMatch).query).toBe('NOF');
    });

    it('covers the whole word when the caret is inside it', () => {
        expect(caretToken('SECRET NOFxx', 9, SEPS, hasMatch)).toEqual({
            start: 7,
            end: 12,
            query: 'NOFxx',
        });
    });

    it('is empty right after whitespace or a separator', () => {
        expect(caretToken('SECRET ', 7, SEPS, hasMatch).query).toBe('');
        expect(caretToken('SECRET//', 8, SEPS, hasMatch).query).toBe('');
    });

    it('is a fresh token when a separator is typed inside a word', () => {
        // "OAK/WOOD" is two tokens, not one: the separator ends the first.
        const token = caretToken('OAK/WOOD', 8, SEPS, hasMatch);
        expect(token).toEqual({ start: 4, end: 8, query: 'WOOD' });
    });
});

describe('spliceToken', () => {
    it('replaces exactly the token and leaves the rest as typed', () => {
        const r = spliceToken(
            'secret nof',
            { start: 7, end: 10 },
            'NOFORN',
            SEPS,
        );
        expect(r.text).toBe('secret NOFORN ');
        expect(r.caret).toBe(r.text.length);
    });

    it('does not fuse the insert with a neighboring word', () => {
        const r = spliceToken('ab', { start: 1, end: 1 }, 'X', SEPS);
        expect(r.text).toBe('a X b');
    });

    it('adds no space next to a separator', () => {
        const r = spliceToken(
            'SECRET//N',
            { start: 8, end: 9 },
            'NOFORN',
            SEPS,
        );
        expect(r.text).toBe('SECRET//NOFORN ');
    });

    it('inserts at the caret for an empty token', () => {
        const r = spliceToken('SECRET ', { start: 7, end: 7 }, 'NOFORN', SEPS);
        expect(r.text).toBe('SECRET NOFORN ');
    });
});
