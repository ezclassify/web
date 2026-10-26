/**
 * Tests for the reference-surface resolver chokepoint used by Handbook,
 * Guidebook, and AccessHandbook. See resolveReferenceSurfaceOverride's own doc
 * comment for the "why undefined means keep the old text" contract this
 * exercises directly; handbook.spec.ts / guidebook.spec.ts /
 * access-handbook.spec.ts exercise it end-to-end through each component.
 */

import { describe, it, expect } from 'vitest';
import { GENERIC_REFERENCE_SURFACE_NOUNS } from '@ezclassify/engine';
import { resolveReferenceSurfaceOverride } from './browser-component-base';

describe('resolveReferenceSurfaceOverride', () => {
    it('returns undefined for a missing label', () => {
        expect(
            resolveReferenceSurfaceOverride(undefined, 'handbook'),
        ).toBeUndefined();
        expect(
            resolveReferenceSurfaceOverride(null, 'guidebook'),
        ).toBeUndefined();
    });

    it('returns undefined when the resolved label equals the generic noun for that surface', () => {
        expect(
            resolveReferenceSurfaceOverride(
                GENERIC_REFERENCE_SURFACE_NOUNS.handbook,
                'handbook',
            ),
        ).toBeUndefined();
        expect(
            resolveReferenceSurfaceOverride(
                { singular: 'Guidebook', plural: 'Guidebooks' },
                'guidebook',
            ),
        ).toBeUndefined();
    });

    it('returns the label unchanged when it differs from the generic noun', () => {
        const renamed = {
            singular: 'Shelving Guide',
            plural: 'Shelving Guides',
        };
        expect(resolveReferenceSurfaceOverride(renamed, 'handbook')).toEqual(
            renamed,
        );
    });

    it('treats a plural-only difference as an override too', () => {
        const oddPlural = {
            singular: GENERIC_REFERENCE_SURFACE_NOUNS.accessHandbook.singular,
            plural: 'Access Handbooks and Friends',
        };
        expect(
            resolveReferenceSurfaceOverride(oddPlural, 'accessHandbook'),
        ).toEqual(oddPlural);
    });
});
