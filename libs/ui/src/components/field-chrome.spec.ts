/**
 * Unit tests for the field family's inline chrome: one row inside the field's
 * trailing edge, and the reserve it publishes so the field's text never runs
 * under it.
 *
 * Jsdom lays nothing out, so these tests give the wrap and the row the boxes a
 * browser would and drive the ResizeObserver by hand. The browser lane
 * (e2e/examples/document-form.spec.ts) measures the same thing on real layout.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FIELD_CHROME_INLINE_SIZE, mountFieldChrome } from './field-chrome';

/** A ResizeObserver stand-in whose callbacks the test fires. */
class FakeResizeObserver {
    static live = new Set<FakeResizeObserver>();
    readonly targets = new Set<Element>();
    constructor(private readonly callback: () => void) {
        FakeResizeObserver.live.add(this);
    }
    observe(target: Element): void {
        this.targets.add(target);
    }
    unobserve(target: Element): void {
        this.targets.delete(target);
    }
    disconnect(): void {
        this.targets.clear();
        FakeResizeObserver.live.delete(this);
    }
    /** Report a resize of `target` to every observer watching it. */
    static resize(target: Element): void {
        for (const observer of FakeResizeObserver.live)
            if (observer.targets.has(target)) observer.callback();
    }
}

/** Give `el` a fixed horizontal box (and a 32px height). */
function place(el: HTMLElement, left: number, width: number): void {
    el.getBoundingClientRect = () =>
        ({
            left,
            right: left + width,
            width,
            top: 0,
            bottom: 32,
            height: 32,
            x: left,
            y: 0,
            toJSON: () => ({}),
        }) as DOMRect;
}

let wrap: HTMLDivElement;
let originalObserver: typeof ResizeObserver | undefined;

beforeEach(() => {
    document.body.innerHTML = '';
    wrap = document.createElement('div');
    document.body.appendChild(wrap);
    place(wrap, 0, 400);
    originalObserver = globalThis.ResizeObserver;
    globalThis.ResizeObserver =
        FakeResizeObserver as unknown as typeof ResizeObserver;
});

afterEach(() => {
    globalThis.ResizeObserver = originalObserver as typeof ResizeObserver;
    FakeResizeObserver.live.clear();
});

describe('mountFieldChrome', () => {
    it('mounts one row as the last child of the wrap, its status group first', () => {
        const field = document.createElement('textarea');
        wrap.appendChild(field);
        const chrome = mountFieldChrome(wrap, {});
        const clear = document.createElement('button');
        chrome.element.appendChild(clear);

        expect(wrap.lastElementChild).toBe(chrome.element);
        expect(chrome.element.className).toBe('ez-field-chrome');
        expect([...chrome.element.children]).toEqual([chrome.status, clear]);
        expect(chrome.status.className).toBe('ez-field-chrome__status');
    });

    it('pins the row to the first line when asked', () => {
        const chrome = mountFieldChrome(wrap, { align: 'start' });
        expect(
            chrome.element.classList.contains('ez-field-chrome--start'),
        ).toBe(true);
    });

    it('publishes how far the row reaches into the field, inside the trailing border', () => {
        wrap.style.borderRightWidth = '1px';
        wrap.style.borderRightStyle = 'solid';
        const chrome = mountFieldChrome(wrap, {});
        // The row: 56px wide, ending 4px inside the wrap's 1px border.
        place(chrome.element, 339, 56);
        chrome.measure();
        expect(wrap.style.getPropertyValue(FIELD_CHROME_INLINE_SIZE)).toBe(
            '60px',
        );
    });

    it('measures from the left edge in a right-to-left field', () => {
        wrap.style.direction = 'rtl';
        const chrome = mountFieldChrome(wrap, {});
        place(chrome.element, 4, 56);
        chrome.measure();
        expect(wrap.style.getPropertyValue(FIELD_CHROME_INLINE_SIZE)).toBe(
            '60px',
        );
    });

    it('follows the row when its contents change size', () => {
        const chrome = mountFieldChrome(wrap, {});
        place(chrome.element, 340, 56);
        FakeResizeObserver.resize(chrome.element);
        expect(wrap.style.getPropertyValue(FIELD_CHROME_INLINE_SIZE)).toBe(
            '60px',
        );

        // A favorites button joins the status group: the row grows by it.
        const star = document.createElement('button');
        chrome.status.appendChild(star);
        place(chrome.element, 316, 80);
        FakeResizeObserver.resize(chrome.element);
        expect(wrap.style.getPropertyValue(FIELD_CHROME_INLINE_SIZE)).toBe(
            '84px',
        );

        // And leaves again.
        star.remove();
        place(chrome.element, 340, 56);
        FakeResizeObserver.resize(chrome.element);
        expect(wrap.style.getPropertyValue(FIELD_CHROME_INLINE_SIZE)).toBe(
            '60px',
        );
    });

    it('re-measures when the wrap itself resizes', () => {
        const chrome = mountFieldChrome(wrap, {});
        place(chrome.element, 340, 56);
        chrome.measure();
        place(wrap, 0, 300);
        place(chrome.element, 240, 56);
        FakeResizeObserver.resize(wrap);
        expect(wrap.style.getPropertyValue(FIELD_CHROME_INLINE_SIZE)).toBe(
            '60px',
        );
    });

    it('reserves nothing for a row with nothing showing', () => {
        const chrome = mountFieldChrome(wrap, {});
        place(chrome.element, 400, 0);
        chrome.measure();
        expect(wrap.style.getPropertyValue(FIELD_CHROME_INLINE_SIZE)).toBe(
            '0px',
        );
    });

    it('removes the row, its reserve and its observer on destroy', () => {
        const chrome = mountFieldChrome(wrap, {});
        place(chrome.element, 340, 56);
        chrome.measure();
        chrome.destroy();
        expect(wrap.querySelector('.ez-field-chrome')).toBeNull();
        expect(wrap.style.getPropertyValue(FIELD_CHROME_INLINE_SIZE)).toBe('');
        expect(FakeResizeObserver.live.size).toBe(0);
    });

    it('works without ResizeObserver, measuring on demand', () => {
        globalThis.ResizeObserver =
            undefined as unknown as typeof ResizeObserver;
        const chrome = mountFieldChrome(wrap, {});
        place(chrome.element, 340, 56);
        chrome.measure();
        expect(wrap.style.getPropertyValue(FIELD_CHROME_INLINE_SIZE)).toBe(
            '60px',
        );
        expect(() => chrome.destroy()).not.toThrow();
    });
});

/** The selector list and body of the stylesheet rule that sets `property`. */
function ruleSetting(css: string, property: string) {
    const flat = css.replace(/\/\*[\s\S]*?\*\//g, '');
    for (const match of flat.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        if (match[2].includes(property))
            return { selector: match[1].trim(), body: match[2] };
    }
    throw new Error(`no rule sets ${property}`);
}

describe('the reserve rule', () => {
    it('pads every text layer of the family by the row plus a gap, over the host padding', () => {
        const here = dirname(fileURLToPath(import.meta.url));
        const css = readFileSync(join(here, 'field-chrome.css'), 'utf8');
        const { selector, body } = ruleSetting(css, 'padding-inline-end');
        expect(body).toMatch(
            /padding-inline-end:\s*calc\(\s*var\(--ez-field-chrome-inline-size, 0px\)\s*\+\s*0\.5rem\s*\)\s*!important/,
        );
        const layers = selector.split(',').map((s) => s.trim());
        expect(layers).toEqual([
            '.marking-field-wrap > .marking-field-host',
            '.marking-field-wrap > .marking-field-display',
            '.tag-input-wrap',
            '.marked-input-wrap > .marked-input-native',
            '.marked-input-wrap > .marked-input-display',
            '.marked-textarea-wrap > .marked-textarea-input',
            '.marked-textarea-wrap > .marked-textarea-display',
        ]);
    });
});
