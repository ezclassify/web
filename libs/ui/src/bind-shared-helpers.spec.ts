/**
 * Unit tests for the bind helpers the three framework adapters (React, Vue,
 * Angular) share from `@ezclassify/ui`: `normalize`, `stringifyForDiff`,
 * `writeDocPath`, and `writeDocPathImmutable`.
 */

import { describe, it, expect } from 'vitest';
import {
    normalize,
    stringifyForDiff,
    writeDocPath,
    writeDocPathImmutable,
} from './bind-ezclassify-to-object';
import type { Assertion } from '@ezclassify/types';

describe('normalize', () => {
    it('expands a bare string value to a rendered-mode entry', () => {
        expect(normalize({ m1: 'title.classification' })).toEqual([
            { markingId: 'm1', path: 'title.classification', mode: 'rendered' },
        ]);
    });

    it('passes through an explicit { path, mode } pair', () => {
        expect(normalize({ m1: { path: '/a/b', mode: 'assertions' } })).toEqual(
            [{ markingId: 'm1', path: '/a/b', mode: 'assertions' }],
        );
    });

    it('handles a mixed config in declaration order', () => {
        expect(
            normalize({
                a: 'pa',
                b: { path: 'pb', mode: 'assertions' },
                c: { path: 'pc', mode: 'rendered' },
            }),
        ).toEqual([
            { markingId: 'a', path: 'pa', mode: 'rendered' },
            { markingId: 'b', path: 'pb', mode: 'assertions' },
            { markingId: 'c', path: 'pc', mode: 'rendered' },
        ]);
    });

    it('returns an empty list for an empty config', () => {
        expect(normalize({})).toEqual([]);
    });
});

describe('stringifyForDiff', () => {
    it('maps null and undefined to the empty string', () => {
        expect(stringifyForDiff(null)).toBe('');
        expect(stringifyForDiff(undefined)).toBe('');
    });

    it('passes strings through unchanged', () => {
        expect(stringifyForDiff('SECRET//REL')).toBe('SECRET//REL');
    });

    it('JSON-encodes arrays and objects', () => {
        const arr: Assertion[] = [
            { categoryId: 'c', conceptId: 'x' } as Assertion,
        ];
        expect(stringifyForDiff(arr)).toBe(JSON.stringify(arr));
        expect(stringifyForDiff({ a: 1 })).toBe('{"a":1}');
    });

    it('falls back to String() when JSON.stringify throws (circular)', () => {
        const circular: Record<string, unknown> = {};
        circular.self = circular;
        // Does not throw; produces some string.
        expect(typeof stringifyForDiff(circular)).toBe('string');
    });
});

describe('writeDocPathImmutable', () => {
    it('returns a new doc and does not mutate the input', () => {
        const doc = { title: { classification: 'S' } };
        const next = writeDocPathImmutable(doc, 'title.classification', 'TS');
        expect(next).not.toBe(doc);
        expect(doc.title.classification).toBe('S');
        expect(next.title.classification).toBe('TS');
    });

    it('shallow-copies only the nodes on the path, structurally sharing siblings', () => {
        const sibling = { keep: true };
        const doc = { a: { b: 1 }, other: sibling };
        const next = writeDocPathImmutable(doc, 'a.b', 2);
        expect(next.a).not.toBe(doc.a);
        // Untouched branch is shared by reference.
        expect(next.other).toBe(sibling);
    });

    it('creates missing intermediates', () => {
        const doc: Record<string, unknown> = {};
        const next = writeDocPathImmutable(doc, 'x.y.z', 'v') as {
            x: { y: { z: string } };
        };
        expect(next.x.y.z).toBe('v');
        expect(doc).toEqual({});
    });

    it('honors JSON Pointer paths with RFC 6901 escapes', () => {
        const doc: Record<string, unknown> = {};
        const next = writeDocPathImmutable(doc, '/foo~1bar/baz', 'v') as {
            'foo/bar': { baz: string };
        };
        expect(next['foo/bar'].baz).toBe('v');
    });

    it('produces the same terminal value as the in-place writeDocPath', () => {
        const immutableDoc = writeDocPathImmutable(
            {} as Record<string, unknown>,
            'a.b',
            7,
        ) as {
            a: { b: number };
        };
        const inPlace: Record<string, unknown> = {};
        writeDocPath(inPlace, 'a.b', 7);
        expect(immutableDoc.a.b).toBe((inPlace as { a: { b: number } }).a.b);
    });
});
