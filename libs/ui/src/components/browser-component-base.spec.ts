/**
 * Tests for the reference-surface resolver chokepoint used by Handbook,
 * Guidebook, and AccessHandbook. See resolveReferenceSurfaceOverride's own doc
 * comment for the "why undefined means keep the old text" contract this
 * exercises directly; handbook.spec.ts / guidebook.spec.ts /
 * access-handbook.spec.ts exercise it end-to-end through each component.
 */

import { afterEach, describe, it, expect, vi } from 'vitest';
import { resetLocale, setLocale } from '../i18n';
import { GENERIC_REFERENCE_SURFACE_NOUNS } from '@ezclassify/types';
import {
    announceMatchCount,
    resolveReferenceSurfaceOverride,
} from './browser-component-base';

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

describe('announceMatchCount', () => {
    afterEach(() => {
        resetLocale();
        vi.unstubAllGlobals();
    });

    /** What the announcer holds once its frame has run. */
    function said(visible: number): string {
        vi.stubGlobal('requestAnimationFrame', (run: FrameRequestCallback) => {
            run(0);
            return 0;
        });
        const announcer = document.createElement('div');
        announceMatchCount(announcer, visible, 'alp', {
            singular: 'rule',
            plural: 'rules',
        });
        return announcer.textContent ?? '';
    }

    it('says nothing without a query', () => {
        const announcer = document.createElement('div');
        announceMatchCount(announcer, 2, '', {
            singular: 'rule',
            plural: 'rules',
        });
        expect(announcer.textContent).toBe('');
    });

    it('says how many match, none, one or several, in English by default', () => {
        expect(said(0)).toBe('No rules match "alp"');
        expect(said(1)).toBe('1 rule matches');
        expect(said(3)).toBe('3 rules match');
    });

    it('says none, one and several from the host locale', () => {
        setLocale({
            'search.matchCount.none': 'Aucune {item} pour « {query} »',
            'search.matchCount.one': '{count} {item} trouvée',
            'search.matchCount.other': '{count} {items} trouvées',
        });
        expect(said(0)).toBe('Aucune rule pour « alp »');
        expect(said(1)).toBe('1 rule trouvée');
        expect(said(3)).toBe('3 rules trouvées');
    });
});
