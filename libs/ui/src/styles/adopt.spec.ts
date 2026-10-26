/**
 * Unit cover for the constructable-stylesheet module.
 *
 * Jsdom has neither `replaceSync` nor `adoptedStyleSheets`; the shim in
 * `tests/setup/constructable-stylesheets.ts` supplies both, which is what makes
 * the memoization and reference-count assertions here observable at all.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
    adoptStyles,
    adoptStylesOnce,
    adoptedStyleTexts,
    hasAdoptedStyles,
    supportsAdoptedStyleSheets,
} from './adopt';

const CSS_A = '.ez-adopt-a { color: rgb(1, 2, 3); }';
const CSS_B = '.ez-adopt-b { color: rgb(4, 5, 6); }';

function documentSheets(): readonly CSSStyleSheet[] {
    return document.adoptedStyleSheets;
}

describe('adoptStyles', () => {
    beforeEach(() => {
        document.adoptedStyleSheets = [];
    });

    afterEach(() => {
        document.adoptedStyleSheets = [];
    });

    it('reports support once the environment can construct sheets', () => {
        expect(supportsAdoptedStyleSheets()).toBe(true);
    });

    it('adopts the sheet onto the document by default', () => {
        const handle = adoptStyles(CSS_A);
        expect(documentSheets()).toContain(handle.sheet);
        expect(hasAdoptedStyles(CSS_A)).toBe(true);
        handle.release();
    });

    it('builds one sheet per CSS text and reuses it', () => {
        const first = adoptStyles(CSS_A);
        const second = adoptStyles(CSS_A);
        expect(second.sheet).toBe(first.sheet);
        expect(documentSheets().filter((s) => s === first.sheet)).toHaveLength(
            1,
        );
        first.release();
        second.release();
    });

    it('builds distinct sheets for distinct CSS text', () => {
        const a = adoptStyles(CSS_A);
        const b = adoptStyles(CSS_B);
        expect(b.sheet).not.toBe(a.sheet);
        expect(adoptedStyleTexts()).toEqual([CSS_A, CSS_B]);
        a.release();
        b.release();
    });

    it('keeps the sheet adopted until the last handle is released', () => {
        const first = adoptStyles(CSS_A);
        const second = adoptStyles(CSS_A);
        const third = adoptStyles(CSS_A);

        third.release();
        expect(hasAdoptedStyles(CSS_A)).toBe(true);
        first.release();
        expect(hasAdoptedStyles(CSS_A)).toBe(true);
        second.release();
        expect(hasAdoptedStyles(CSS_A)).toBe(false);
    });

    it('releases in any order, not just reverse acquisition order', () => {
        const first = adoptStyles(CSS_A);
        const second = adoptStyles(CSS_A);
        first.release();
        expect(hasAdoptedStyles(CSS_A)).toBe(true);
        second.release();
        expect(hasAdoptedStyles(CSS_A)).toBe(false);
    });

    it('ignores a repeated release from the same handle', () => {
        const first = adoptStyles(CSS_A);
        const second = adoptStyles(CSS_A);
        first.release();
        first.release();
        first.release();
        expect(hasAdoptedStyles(CSS_A)).toBe(true);
        second.release();
        expect(hasAdoptedStyles(CSS_A)).toBe(false);
    });

    it('re-adopts a released sheet on the next request', () => {
        adoptStyles(CSS_A).release();
        expect(hasAdoptedStyles(CSS_A)).toBe(false);
        const again = adoptStyles(CSS_A);
        expect(hasAdoptedStyles(CSS_A)).toBe(true);
        again.release();
    });

    it('adopts onto the shadow root that owns the target element', () => {
        const host = document.createElement('div');
        document.body.appendChild(host);
        const shadow = host.attachShadow({ mode: 'open' });
        const inner = document.createElement('span');
        shadow.appendChild(inner);

        const handle = adoptStyles(CSS_A, inner);
        expect(shadow.adoptedStyleSheets).toContain(handle.sheet);
        expect(documentSheets()).not.toContain(handle.sheet);

        handle.release();
        expect(shadow.adoptedStyleSheets).not.toContain(handle.sheet);
        host.remove();
    });

    it('counts the same sheet independently per root', () => {
        const host = document.createElement('div');
        document.body.appendChild(host);
        const shadow = host.attachShadow({ mode: 'open' });

        const inDocument = adoptStyles(CSS_A, document.body);
        const inShadow = adoptStyles(CSS_A, shadow);
        expect(inShadow.sheet).toBe(inDocument.sheet);

        inShadow.release();
        expect(shadow.adoptedStyleSheets).not.toContain(inDocument.sheet);
        expect(hasAdoptedStyles(CSS_A)).toBe(true);

        inDocument.release();
        expect(hasAdoptedStyles(CSS_A)).toBe(false);
        host.remove();
    });

    it('adopts a detached element onto its owner document', () => {
        const detached = document.createElement('div');
        const handle = adoptStyles(CSS_A, detached);
        expect(documentSheets()).toContain(handle.sheet);
        handle.release();
    });
});

describe('adoptStylesOnce', () => {
    beforeEach(() => {
        document.adoptedStyleSheets = [];
    });

    afterEach(() => {
        document.adoptedStyleSheets = [];
    });

    it('adopts once and stays adopted on repeat calls', () => {
        adoptStylesOnce(CSS_A);
        adoptStylesOnce(CSS_A);
        adoptStylesOnce(CSS_A);
        expect(adoptedStyleTexts()).toEqual([CSS_A]);
    });

    it('survives a reference-counted handle releasing the same sheet', () => {
        adoptStylesOnce(CSS_A);
        const handle = adoptStyles(CSS_A);
        handle.release();
        expect(hasAdoptedStyles(CSS_A)).toBe(true);
    });
});

describe('unsupported environments', () => {
    it('throws instead of falling back to an inline style element', () => {
        const descriptor = Object.getOwnPropertyDescriptor(
            CSSStyleSheet.prototype,
            'replaceSync',
        );
        // Deleting replaceSync is what the support probe reads, so this is the
        // same shape a pre-16.4 Safari presents.
        delete (CSSStyleSheet.prototype as Partial<CSSStyleSheet>).replaceSync;
        try {
            expect(supportsAdoptedStyleSheets()).toBe(false);
            expect(() => adoptStyles(CSS_A)).toThrow(
                /constructable stylesheets/,
            );
            expect(() => adoptStylesOnce(CSS_A)).toThrow(
                /constructable stylesheets/,
            );
            expect(document.querySelector('style')).toBeNull();
        } finally {
            if (descriptor) {
                Object.defineProperty(
                    CSSStyleSheet.prototype,
                    'replaceSync',
                    descriptor,
                );
            }
        }
    });
});
