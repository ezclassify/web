/**
 * Shared field chrome for MarkingField and TagInput. At rest, only the status
 * mark appears inside the field's right edge. While the field contains focus,
 * the same chrome becomes an attached drawer with optional helper controls. The
 * drawer uses the edge opposite the suggestion dropdown so both remain visible
 * without covering each other.
 */

import fieldChromeDrawerCss from './field-chrome-drawer.css?inline';
import { adoptStylesOnce } from '../styles/adopt';

/** Adopt the drawer stylesheet once per root (see adoptStylesOnce). */
function injectStyles(root: HTMLElement | undefined): void {
    adoptStylesOnce(fieldChromeDrawerCss, root);
}

/**
 * Mount (or return the existing) chrome drawer on `wrap`. Idempotent, the same
 * "only one, never stacked" invariant `ensureStatusMark` in `status-mark.ts`
 * owns for the mark itself: a render pass that calls this again gets the same
 * element back rather than a second drawer.
 *
 * @param wrap - The field's own positioned wrapper element (its bordered box)
 * @param opts - Style-injection root
 * @returns The drawer element; mount the status mark and favorites button
 *   inside it with `shape: 'chrome'`
 */
export function ensureFieldDrawer(
    wrap: HTMLElement,
    opts: { root?: HTMLElement },
): HTMLElement {
    const existing = wrap.querySelector<HTMLElement>(
        ':scope > .ez-field-drawer',
    );
    if (existing) return existing;

    injectStyles(opts.root);

    const drawer = document.createElement('div');
    drawer.className = 'ez-field-drawer ez-field-drawer--bottom';
    wrap.appendChild(drawer);
    return drawer;
}

/**
 * Set which edge the drawer hangs off: 'bottom' (default; also used while the
 * field's dropdown is closed or open above) or 'top' (mirrored, while the
 * dropdown is open below: the bottom edge is occupied by the dropdown, so the
 * drawer moves to the opposite, free edge). A no-op class toggle; safe to call
 * on every position pass.
 */
export function setFieldDrawerOrientation(
    drawer: HTMLElement,
    orientation: 'top' | 'bottom',
): void {
    drawer.classList.toggle('ez-field-drawer--top', orientation === 'top');
    drawer.classList.toggle(
        'ez-field-drawer--bottom',
        orientation === 'bottom',
    );
}

/**
 * Mirror the field's own border/background onto the drawer so it reads as an
 * attached tab sharing the field's exact surface, not a mismatched chip. Call
 * once at mount (with the same captured styles the field mirrors onto its own
 * display layer) and again from the field's theme observer whenever the host
 * re-themes. Optional host margins keep the tab attached to the field's border
 * box rather than the enclosing grid area's margin box.
 */
export function syncFieldDrawerTheme(
    drawer: HTMLElement,
    styles: {
        borderColor: string;
        backgroundColor: string;
        marginTop?: string;
        marginBottom?: string;
    },
): void {
    drawer.style.setProperty(
        '--ez-field-drawer-border-color',
        styles.borderColor,
    );
    drawer.style.backgroundColor = styles.backgroundColor;
    drawer.style.setProperty(
        '--ez-field-margin-top',
        styles.marginTop ?? '0px',
    );
    drawer.style.setProperty(
        '--ez-field-margin-bottom',
        styles.marginBottom ?? '0px',
    );
}
