/**
 * Shared trailing chrome for the marking field family (MarkingField, TagInput,
 * MarkedInput, MarkedTextArea): one inline row inside the field's trailing edge
 * holding the status mark, the ★ favorites button where it applies, and the
 * clear button. It stays in the same place at rest and while focused.
 *
 * The field's text never runs under it. The chrome measures how far it reaches
 * into the field from the trailing edge and publishes that distance on the
 * field's wrap as `--ez-field-chrome-inline-size`; each field's stylesheet
 * reserves that much trailing padding on its text layers. A ResizeObserver
 * keeps the value current, so the reserve follows the chrome's contents (a
 * favorites button mounted later, a coarse-pointer target size, a font
 * change).
 */

import fieldChromeCss from './field-chrome.css?inline';
import { adoptStylesOnce } from '../styles/adopt';

/** The custom property each field's text layers read for their reserve. */
export const FIELD_CHROME_INLINE_SIZE = '--ez-field-chrome-inline-size';

/** A mounted chrome row and the measurement that keeps its reserve current. */
export interface FieldChrome {
    /** The row. The field mounts its clear button here, after {@link status}. */
    readonly element: HTMLElement;
    /**
     * The row's leading group: mount the status mark and the favorites button
     * here with `shape: 'chrome'`. Being its own element keeps them ahead of
     * clear in reading and Tab order whenever each is mounted.
     */
    readonly status: HTMLElement;
    /** Measure the chrome now and publish the reserve on the wrap. */
    measure(): void;
    /** Stop observing, remove the row and its reserve. */
    destroy(): void;
}

/**
 * Mount the chrome row on `wrap`, the field's positioned outer element.
 *
 * @param wrap - The field's wrapper; the row is appended as its last child, so
 *   Tab reaches the field's own controls before the chrome
 * @param opts - Style-injection root, and `align: 'start'` for a multi-line
 *   field whose chrome pins to the first line instead of centering
 * @returns The mounted chrome
 */
export function mountFieldChrome(
    wrap: HTMLElement,
    opts: { root?: HTMLElement; align?: 'center' | 'start' },
): FieldChrome {
    adoptStylesOnce(fieldChromeCss, opts.root);

    const element = document.createElement('div');
    element.className =
        opts.align === 'start'
            ? 'ez-field-chrome ez-field-chrome--start'
            : 'ez-field-chrome';
    const status = document.createElement('div');
    status.className = 'ez-field-chrome__status';
    element.appendChild(status);
    wrap.appendChild(element);

    const measure = () => {
        if (!element.isConnected) return;
        const reserve = chromeReach(wrap, element);
        wrap.style.setProperty(FIELD_CHROME_INLINE_SIZE, `${reserve}px`);
    };
    // Every child change that resizes the row resizes its border box, which
    // is what the observer reports; the wrap itself is observed too, because a
    // border or direction change moves the row without resizing it.
    const observer =
        typeof ResizeObserver === 'undefined'
            ? null
            : new ResizeObserver(measure);
    observer?.observe(element);
    observer?.observe(wrap);
    measure();

    return {
        element,
        status,
        measure,
        destroy() {
            observer?.disconnect();
            element.remove();
            wrap.style.removeProperty(FIELD_CHROME_INLINE_SIZE);
        },
    };
}

/**
 * How far the chrome reaches into the field, measured from the inside of the
 * wrap's trailing border to the chrome's leading edge. Zero for a row with
 * nothing showing.
 */
function chromeReach(wrap: HTMLElement, chrome: HTMLElement): number {
    const row = chrome.getBoundingClientRect();
    if (row.width === 0) return 0;
    const box = wrap.getBoundingClientRect();
    const style = getComputedStyle(wrap);
    const reach =
        style.direction === 'rtl'
            ? row.right - box.left - (parseFloat(style.borderLeftWidth) || 0)
            : box.right - row.left - (parseFloat(style.borderRightWidth) || 0);
    return Math.max(0, Math.ceil(reach));
}
