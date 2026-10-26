/**
 * Unit tests for the ★ chrome drawer module: mount idempotency, the bottom/top
 * orientation toggle, and theme mirroring.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
    ensureFieldDrawer,
    setFieldDrawerOrientation,
    syncFieldDrawerTheme,
} from './field-chrome-drawer';

let wrap: HTMLDivElement;

beforeEach(() => {
    document.body.innerHTML = '';
    wrap = document.createElement('div');
    document.body.appendChild(wrap);
});

afterEach(() => {
    document.body.innerHTML = '';
});

describe('ensureFieldDrawer', () => {
    it('mounts one drawer, hanging off the bottom by default', () => {
        const drawer = ensureFieldDrawer(wrap, {});
        expect(drawer.classList.contains('ez-field-drawer')).toBe(true);
        expect(drawer.classList.contains('ez-field-drawer--bottom')).toBe(true);
        expect(drawer.parentElement).toBe(wrap);
    });

    it('is idempotent: a second call returns the same element, never a second drawer', () => {
        const first = ensureFieldDrawer(wrap, {});
        const second = ensureFieldDrawer(wrap, {});
        expect(second).toBe(first);
        expect(wrap.querySelectorAll(':scope > .ez-field-drawer')).toHaveLength(
            1,
        );
    });

    it('does not pick up a nested wrap`s drawer as its own (:scope > only)', () => {
        const inner = document.createElement('div');
        wrap.appendChild(inner);
        ensureFieldDrawer(inner, {});
        // wrap itself still has none of its own; calling ensure on wrap must
        // mount a fresh drawer there, not find inner's by a non-scoped query.
        const drawer = ensureFieldDrawer(wrap, {});
        expect(drawer.parentElement).toBe(wrap);
        expect(wrap.querySelectorAll(':scope > .ez-field-drawer')).toHaveLength(
            1,
        );
    });
});

describe('setFieldDrawerOrientation', () => {
    it('toggles between the bottom and top edge classes', () => {
        const drawer = ensureFieldDrawer(wrap, {});
        expect(drawer.classList.contains('ez-field-drawer--bottom')).toBe(true);

        setFieldDrawerOrientation(drawer, 'top');
        expect(drawer.classList.contains('ez-field-drawer--top')).toBe(true);
        expect(drawer.classList.contains('ez-field-drawer--bottom')).toBe(
            false,
        );

        setFieldDrawerOrientation(drawer, 'bottom');
        expect(drawer.classList.contains('ez-field-drawer--bottom')).toBe(true);
        expect(drawer.classList.contains('ez-field-drawer--top')).toBe(false);
    });
});

describe('syncFieldDrawerTheme', () => {
    it('mirrors the given border/background colors onto the drawer', () => {
        const drawer = ensureFieldDrawer(wrap, {});
        syncFieldDrawerTheme(drawer, {
            borderColor: 'rgb(1, 2, 3)',
            backgroundColor: 'rgb(4, 5, 6)',
            marginTop: '6px',
            marginBottom: '8px',
        });
        expect(
            drawer.style.getPropertyValue('--ez-field-drawer-border-color'),
        ).toBe('rgb(1, 2, 3)');
        expect(drawer.style.borderColor).toBe('');
        expect(drawer.style.backgroundColor).toBe('rgb(4, 5, 6)');
        expect(drawer.style.getPropertyValue('--ez-field-margin-top')).toBe(
            '6px',
        );
        expect(drawer.style.getPropertyValue('--ez-field-margin-bottom')).toBe(
            '8px',
        );
    });
});

describe('attached-tab geometry', () => {
    // jsdom has no layout engine and doesn't apply an injected <style>'s
    // cascade to getComputedStyle (established pattern; see e.g. the
    // "drawer classes actually resolve to opposite physical edges" test in
    // marking-field.spec.ts), so this reads the real CSS source.
    const css = readFileSync(
        join(
            dirname(fileURLToPath(import.meta.url)),
            'field-chrome-drawer.css',
        ),
        'utf8',
    );

    it('covers the field border and inset focus ring in both orientations', () => {
        // Without this overlap, the field's own border line stays fully visible underneath the
        // drawer's footprint, and the tab reads as a second box stacked
        // against the field instead of one shape with a notch cut into it.
        // The 3px pull covers the border and inset focus ring both consumers'
        // .{tag-input,marking-field}-wrap use.
        expect(css).toMatch(
            /\.ez-field-drawer--bottom\s*\{[^}]*margin-top:\s*-3px/,
        );
        expect(css).toMatch(
            /\.ez-field-drawer--top\s*\{[^}]*margin-bottom:\s*-3px/,
        );
    });
});

describe('resting field chrome', () => {
    const css = readFileSync(
        join(
            dirname(fileURLToPath(import.meta.url)),
            'field-chrome-drawer.css',
        ),
        'utf8',
    );

    it('places the status inside an unfocused field and hides helper controls', () => {
        // Layout is verified in Chrome; jsdom cannot evaluate :focus-within.
        expect(css).toMatch(
            /:not\(:focus-within\)\s*>\s*\.ez-field-drawer\s*\{[^}]*top: 50%;[^}]*bottom: auto;[^}]*border: none;/,
        );
        expect(css).toMatch(
            /:not\(:focus-within\)\s*>\s*\.ez-field-drawer\s*>\s*:not\(\.ez-status-mark\)\s*\{\s*display: none;/,
        );
    });
});
