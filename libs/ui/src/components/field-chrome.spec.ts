/**
 * Unit tests for the field family's inline chrome: one row inside the field's
 * trailing edge, and the reserve it publishes so the field's text never runs
 * under it.
 *
 * Jsdom lays nothing out, so these tests give the wrap and the row the boxes a
 * browser would and drive the ResizeObserver by hand. The browser lane
 * (e2e/examples/document-form.spec.ts) measures the same thing on real layout.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    FIELD_CHROME_INLINE_SIZE,
    mountFieldChrome,
    observeFieldTheme,
} from './field-chrome';

it.each(['ancestor', 'shadow host'])(
    'refreshes field snapshots when a theme is removed from a %s',
    async (scope) => {
        const ancestor = document.createElement('div');
        const field = document.createElement('textarea');
        const root =
            scope === 'shadow host'
                ? ancestor.attachShadow({ mode: 'open' })
                : ancestor;
        root.append(field);
        ancestor.setAttribute('data-app-theme', 'evergreen');
        const sync = vi.fn();
        const observer = observeFieldTheme(field, sync);
        try {
            ancestor.removeAttribute('data-app-theme');
            await Promise.resolve();
            expect(sync).toHaveBeenCalledTimes(1);
        } finally {
            observer?.disconnect();
        }
    },
);

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
    vi.useRealTimers();
    globalThis.ResizeObserver = originalObserver as typeof ResizeObserver;
    FakeResizeObserver.live.clear();
});

describe('mountFieldChrome', () => {
    it('anchors logically trailing chrome to a wrapped caption while keeping its label before the work', () => {
        let header = document.createElement('div');
        wrap.append(header);
        const chrome = mountFieldChrome(wrap, { header: () => header });
        place(chrome.element, 340, 50);
        header.getBoundingClientRect = () =>
            ({
                left: 0,
                right: 400,
                top: 20,
                bottom: 84,
                width: 400,
                height: 64,
            }) as DOMRect;
        chrome.measure();
        expect(chrome.element.style.top).toBe('52px');
        expect(header.style.paddingInlineEnd).toBe('60px');
        expect(header.style.minBlockSize).toBe('32px');
        const oldHeader = header;
        header = document.createElement('div');
        wrap.insertBefore(header, chrome.element);
        oldHeader.remove();
        header.getBoundingClientRect = () =>
            ({
                left: 0,
                right: 400,
                top: 12,
                bottom: 52,
                width: 400,
                height: 40,
            }) as DOMRect;
        chrome.measure();
        expect(chrome.element.style.top).toBe('32px');
        expect(
            [...FakeResizeObserver.live].some((observer) =>
                observer.targets.has(oldHeader),
            ),
        ).toBe(false);
        expect(
            [...FakeResizeObserver.live].some((observer) =>
                observer.targets.has(header),
            ),
        ).toBe(true);
        chrome.destroy();
        expect(FakeResizeObserver.live.size).toBe(0);
    });

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
        vi.useFakeTimers();
        const chrome = mountFieldChrome(wrap, {});
        const original = wrap.style.getPropertyValue(FIELD_CHROME_INLINE_SIZE);
        place(chrome.element, 340, 56);
        FakeResizeObserver.resize(chrome.element);
        FakeResizeObserver.resize(wrap);
        expect(wrap.style.getPropertyValue(FIELD_CHROME_INLINE_SIZE)).toBe(
            original,
        );
        expect(vi.getTimerCount()).toBe(1);
        vi.advanceTimersToNextFrame();
        expect(wrap.style.getPropertyValue(FIELD_CHROME_INLINE_SIZE)).toBe(
            '60px',
        );

        // A change count widens the branding group.
        const count = document.createElement('span');
        chrome.status.appendChild(count);
        place(chrome.element, 316, 80);
        FakeResizeObserver.resize(chrome.element);
        vi.advanceTimersToNextFrame();
        expect(wrap.style.getPropertyValue(FIELD_CHROME_INLINE_SIZE)).toBe(
            '84px',
        );

        // And leaves again.
        count.remove();
        place(chrome.element, 340, 56);
        FakeResizeObserver.resize(chrome.element);
        vi.advanceTimersToNextFrame();
        expect(wrap.style.getPropertyValue(FIELD_CHROME_INLINE_SIZE)).toBe(
            '60px',
        );
    });

    it('re-measures when the wrap itself resizes', () => {
        vi.useFakeTimers();
        const chrome = mountFieldChrome(wrap, {});
        place(chrome.element, 340, 56);
        chrome.measure();
        place(wrap, 0, 300);
        place(chrome.element, 218, 56);
        FakeResizeObserver.resize(wrap);
        vi.advanceTimersToNextFrame();
        expect(wrap.style.getPropertyValue(FIELD_CHROME_INLINE_SIZE)).toBe(
            '82px',
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
        vi.useFakeTimers();
        const chrome = mountFieldChrome(wrap, {});
        place(chrome.element, 340, 56);
        chrome.measure();
        FakeResizeObserver.resize(wrap);
        chrome.destroy();
        expect(wrap.querySelector('.ez-field-chrome')).toBeNull();
        expect(wrap.style.getPropertyValue(FIELD_CHROME_INLINE_SIZE)).toBe('');
        expect(FakeResizeObserver.live.size).toBe(0);
        expect(vi.getTimerCount()).toBe(0);
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

describe.each(['overlay', 'inline'] as const)(
    '%s chrome keyboard navigation',
    (placement) => {
        function pair(direction = 'ltr', leadingSelect?: HTMLSelectElement) {
            wrap.style.direction = direction;
            const chrome = mountFieldChrome(wrap, { placement, leadingSelect });
            const tools = document.createElement('button');
            tools.className = 'ez-status-mark';
            const clear = document.createElement('button');
            clear.className = 'ez-clear-button';
            chrome.status.appendChild(tools);
            chrome.element.appendChild(clear);
            return { chrome, tools, clear };
        }
        function key(
            target: HTMLElement,
            key: string,
            modifiers: KeyboardEventInit = {},
        ) {
            const event = new KeyboardEvent('keydown', {
                key,
                bubbles: true,
                cancelable: true,
                ...modifiers,
            });
            target.dispatchEvent(event);
            return event;
        }
        it.each(['ltr', 'rtl'])(
            'moves in physical %s order and contains both edges',
            (direction) => {
                const { tools, clear } = pair(direction);
                place(tools, direction === 'rtl' ? 36 : 0, 32);
                place(clear, direction === 'rtl' ? 0 : 36, 32);
                const [left, right] =
                    direction === 'rtl' ? [clear, tools] : [tools, clear];
                let escaped = 0;
                wrap.addEventListener('keydown', () => escaped++);
                left.focus();
                expect(key(left, 'ArrowLeft').defaultPrevented).toBe(true);
                expect(document.activeElement).toBe(left);
                key(left, 'ArrowRight');
                expect(document.activeElement).toBe(right);
                key(right, 'ArrowRight');
                expect(document.activeElement).toBe(right);
                key(right, 'ArrowLeft');
                expect(document.activeElement).toBe(left);
                expect(escaped).toBe(0);
            },
        );
        it.each(['ltr', 'rtl'])(
            'connects a leading select and chrome in %s order',
            (direction) => {
                const select = document.createElement('select');
                wrap.appendChild(select);
                const { tools, clear } = pair(direction, select);
                place(tools, direction === 'rtl' ? 36 : 0, 32);
                place(clear, direction === 'rtl' ? 0 : 36, 32);
                const forward =
                    direction === 'rtl' ? 'ArrowLeft' : 'ArrowRight';
                const back = direction === 'rtl' ? 'ArrowRight' : 'ArrowLeft';
                select.focus();
                expect(key(select, 'ArrowDown').defaultPrevented).toBe(false);
                expect(key(select, forward).defaultPrevented).toBe(true);
                expect(document.activeElement).toBe(tools);
                key(tools, forward);
                expect(document.activeElement).toBe(clear);
                key(clear, back);
                expect(document.activeElement).toBe(tools);
                key(tools, back);
                expect(document.activeElement).toBe(select);
            },
        );
        it.each([
            'disabled',
            'hidden',
            'display',
            'visibility',
            'aria-disabled',
        ])('skips a %s clear button without leaking the arrow', (state) => {
            const { tools, clear } = pair();
            if (state === 'disabled') clear.disabled = true;
            if (state === 'hidden') clear.hidden = true;
            if (state === 'display') clear.style.display = 'none';
            if (state === 'visibility') clear.style.visibility = 'hidden';
            if (state === 'aria-disabled')
                clear.setAttribute('aria-disabled', 'true');
            tools.focus();
            expect(key(tools, 'ArrowRight').defaultPrevented).toBe(true);
            expect(document.activeElement).toBe(tools);
            clear.disabled = false;
            clear.hidden = false;
            clear.style.cssText = '';
            clear.removeAttribute('aria-disabled');
            key(tools, 'ArrowRight');
            expect(document.activeElement).toBe(clear);
        });
        it('skips branding hidden with its status group and uses current buttons after replacement', () => {
            const { chrome, tools, clear } = pair();
            chrome.status.hidden = true;
            clear.focus();
            expect(key(clear, 'ArrowLeft').defaultPrevented).toBe(true);
            expect(document.activeElement).toBe(clear);
            chrome.status.hidden = false;
            const replacement = tools.cloneNode(true) as HTMLButtonElement;
            tools.replaceWith(replacement);
            key(clear, 'ArrowLeft');
            expect(document.activeElement).toBe(replacement);
        });
        it('leaves text arrows, modifiers, composition and Tab native', () => {
            const { chrome, tools } = pair();
            const input = document.createElement('input');
            chrome.element.appendChild(input);
            input.focus();
            expect(key(input, 'ArrowRight').defaultPrevented).toBe(false);
            expect(document.activeElement).toBe(input);
            tools.focus();
            for (const modifiers of [
                { altKey: true },
                { ctrlKey: true },
                { metaKey: true },
                { shiftKey: true },
                { isComposing: true },
            ]) {
                expect(
                    key(tools, 'ArrowRight', modifiers).defaultPrevented,
                ).toBe(false);
                expect(document.activeElement).toBe(tools);
            }
            expect(key(tools, 'Tab').defaultPrevented).toBe(false);
        });
        it('removes the keyboard listener on destroy even if the row is reattached', () => {
            const { chrome, tools } = pair();
            chrome.destroy();
            wrap.appendChild(chrome.element);
            tools.focus();
            expect(key(tools, 'ArrowRight').defaultPrevented).toBe(false);
            expect(document.activeElement).toBe(tools);
        });
    },
);

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
        const { selector, body } = ruleSetting(
            css,
            'var(--ez-field-chrome-inline-size, 0px)',
        );
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
            '.select-dropdown-field:not(.select-dropdown-field--native)',
        ]);
    });

    it('reserves the chrome and chevron inside the authored select', () => {
        const here = dirname(fileURLToPath(import.meta.url));
        const css = readFileSync(join(here, 'single-select.css'), 'utf8');
        const { selector, body } = ruleSetting(css, 'padding-inline-end');
        expect(selector).toBe('.select-dropdown-native');
        expect(body).toMatch(
            /padding-inline-end:\s*calc\(\s*var\(--ez-field-chrome-inline-size, 0px\)\s*\+\s*0\.25rem\s*\+\s*0\.75em\s*\)\s*!important/,
        );
    });
});
