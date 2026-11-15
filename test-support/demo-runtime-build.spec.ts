/**
 * A pin move has to recompile from nothing, whatever an earlier pin built.
 * These rules are what stop a recording from linking crates of another pin.
 */
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildKey, pinnedBuildLayout } from './demo-runtime-build';

const BUILDS = '/work/runtime/target/web-recordings';
const ARGS = ['build', '--release'];

/** Whether `inner` is `outer` or lies beneath it. */
function within(outer: string, inner: string): boolean {
    const relative = path.relative(outer, inner);
    return !relative.startsWith('..') && !path.isAbsolute(relative);
}

describe('pinnedBuildLayout', () => {
    const a = pinnedBuildLayout(BUILDS, 'a'.repeat(40));
    const b = pinnedBuildLayout(BUILDS, 'b'.repeat(40));

    it('gives each pin a source and a Cargo target no other pin shares', () => {
        expect(within(a.root, b.source)).toBe(false);
        expect(within(a.root, b.cargoTarget)).toBe(false);
        expect(within(b.root, a.source)).toBe(false);
        expect(within(b.root, a.cargoTarget)).toBe(false);
    });

    it('builds a pin into its own target, apart from its own source', () => {
        expect(within(a.root, a.source)).toBe(true);
        expect(within(a.root, a.cargoTarget)).toBe(true);
        expect(within(a.source, a.cargoTarget)).toBe(false);
        expect(within(a.cargoTarget, a.source)).toBe(false);
    });

    it('is stable for one pin, so an unchanged pin reuses its build', () => {
        expect(pinnedBuildLayout(BUILDS, 'a'.repeat(40))).toEqual(a);
    });
});

describe('buildKey', () => {
    const key = buildKey('a'.repeat(40), ARGS, 'set');

    it('is a new build when the pin moves', () => {
        expect(buildKey('b'.repeat(40), ARGS, 'set')).not.toBe(key);
    });

    it('is a new build when cargo is called differently', () => {
        expect(buildKey('a'.repeat(40), [...ARGS, '--locked'], 'set')).not.toBe(
            key,
        );
    });

    it('is a new build when the demo set changes', () => {
        expect(buildKey('a'.repeat(40), ARGS, 'other')).not.toBe(key);
    });

    it('is the same build when nothing changed', () => {
        expect(buildKey('a'.repeat(40), ARGS, 'set')).toBe(key);
    });
});
