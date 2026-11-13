/**
 * What every field in the family promises about its inline chrome, as
 * assertions the component specs share: the chrome row is the wrap's last
 * child, its status group holds the status mark (and the favorites button where
 * one is mounted) ahead of clear, the field's text layers are the ones the
 * stylesheet pads by the chrome's reserve, and the mark's tone follows whether
 * the field has a message.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from 'vitest';

/**
 * A component stylesheet's source, read from disk: the test transform stubs
 * `?inline` CSS imports to an empty string.
 */
function componentCss(name: string): string {
    const here = dirname(fileURLToPath(import.meta.url));
    return readFileSync(join(here, '../src/components', name), 'utf8');
}
const fieldChromeCss = componentCss('field-chrome.css');
const statusMarkCss = componentCss('status-mark.css');

/**
 * The selector list of the rule in field-chrome.css that reserves the chrome's
 * room on the family's text layers.
 */
export const FIELD_TEXT_LAYERS: string = (() => {
    const flat = fieldChromeCss.replace(/\/\*[\s\S]*?\*\//g, '');
    for (const match of flat.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        if (match[2].includes('--ez-field-chrome-inline-size'))
            return match[1].trim();
    }
    throw new Error('field-chrome.css reserves no room for the chrome');
})();

/**
 * Assert the field's chrome is inline in `wrap` and the field's text layers
 * reserve its room.
 *
 * @param wrap - The field's wrapper (`.marking-field-wrap` and its siblings)
 * @param layers - The field's text layers: what the user reads and types in
 * @returns The chrome row, for the caller's further checks
 */
export function expectInlineChrome(
    wrap: Element,
    layers: readonly Element[],
): HTMLElement {
    const chrome = wrap.querySelector<HTMLElement>(':scope > .ez-field-chrome');
    expect(chrome, 'the chrome row').not.toBeNull();
    expect(wrap.lastElementChild).toBe(chrome);
    expect(wrap.querySelectorAll('.ez-field-chrome')).toHaveLength(1);
    const status = chrome!.firstElementChild!;
    expect(status.classList.contains('ez-field-chrome__status')).toBe(true);
    const mark = status.firstElementChild!;
    expect(mark.classList.contains('ez-status-mark')).toBe(true);
    expect(mark.classList.contains('ez-status-mark--chrome')).toBe(true);
    expect(wrap.querySelectorAll('.ez-status-mark')).toHaveLength(1);
    const clear = chrome!.lastElementChild!;
    expect(clear.classList.contains('ez-clear-button')).toBe(true);
    expect(layers.length).toBeGreaterThan(0);
    for (const layer of layers)
        expect(layer.matches(FIELD_TEXT_LAYERS), layer.className).toBe(true);
    expect(
        (wrap as HTMLElement).style.getPropertyValue(
            '--ez-field-chrome-inline-size',
        ),
        'the published reserve',
    ).toMatch(/^\d+px$/);
    return chrome!;
}

/** The selector list of the first status-mark.css rule whose body names `token`. */
function statusMarkRuleUsing(token: string): string {
    const flat = statusMarkCss.replace(/\/\*[\s\S]*?\*\//g, '');
    for (const match of flat.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        if (match[2].includes(token)) return match[1].trim();
    }
    throw new Error(`status-mark.css never uses ${token}`);
}

/**
 * How the stylesheet colors this status mark: `strong` when one of the rules
 * painting the strong token matches it (the field has a message for the user),
 * `muted` otherwise.
 *
 * @param mark - A mounted `.ez-status-mark`
 * @returns The mark's tone
 */
export function markTone(mark: Element): 'strong' | 'muted' {
    return mark.matches(statusMarkRuleUsing('--ez-status-mark-strong-color'))
        ? 'strong'
        : 'muted';
}
