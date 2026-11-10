/**
 * @vitest-environment jsdom
 *
 * resolveProfile helper: a component marks in its scheme view's scheme, the
 * Context's primary.
 */

import { describe, it, expect } from 'vitest';
import type { ComponentSchemeEngine } from './component-base-readonly';
import { resolveProfile } from './component-base-readonly';

describe('resolveProfile', () => {
    it("names the scheme view's own scheme", () => {
        const view = {
            getScheme: () => ({ id: 'primary' }),
        } as unknown as ComponentSchemeEngine;
        expect(resolveProfile(view)).toBe('primary');
    });

    it('rejects a view that cannot name its scheme', () => {
        expect(() => resolveProfile({} as ComponentSchemeEngine)).toThrow(
            /must implement getScheme/,
        );
    });
});
