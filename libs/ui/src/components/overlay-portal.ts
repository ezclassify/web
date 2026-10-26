/**
 * Shared viewport-overlay support.
 *
 * UI components may be mounted inside cards, dialogs, tables, transformed
 * panels, or scroll containers. Dropdowns and tooltips therefore belong in
 * document.body, not in an arbitrary consumer layout ancestor. These helpers
 * preserve the source field's theme after that portal move.
 */

import { adoptStyles, type AdoptedStyles } from '../styles/adopt';

const THEME_PROPERTIES = [
    '--ez-color-background',
    '--ez-color-border',
    '--ez-color-border-focus',
    '--ez-color-text',
    '--ez-color-muted',
    '--ez-color-primary',
    '--ez-color-primary-contrast',
    '--ez-color-success',
    '--ez-color-warning',
    '--ez-color-error',
    '--ez-color-surface-hover',
    '--ez-color-surface-active',
    '--ez-dropdown-background',
    '--ez-dropdown-color',
    '--ez-dropdown-item-hover',
    '--ez-dropdown-highlight',
    '--ez-dropdown-selected',
    '--ez-dropdown-group-bg',
    '--ez-dropdown-shadow',
    '--ez-tooltip-background',
    '--ez-tooltip-color',
    '--ez-tooltip-border',
    '--ez-tooltip-shadow',
    '--ez-tooltip-header-color',
    '--ez-tooltip-heading-color',
    '--ez-tooltip-body-color',
    '--ez-tooltip-rule-color',
    '--ez-border-radius',
    '--ez-font-family',
    '--ez-z-dropdown',
    '--ez-z-tooltip',
] as const;

/** Copy documented presentation tokens from an in-flow anchor to an overlay. */
export function copyOverlayTheme(
    source: HTMLElement,
    overlay: HTMLElement,
): void {
    const style = window.getComputedStyle(source);
    for (const property of THEME_PROPERTIES) {
        const value = style.getPropertyValue(property);
        if (value) overlay.style.setProperty(property, value);
    }
    overlay.style.font = style.font;
}

/**
 * Put a fixed-position overlay beyond all consumer clipping ancestors. Optional
 * CSS follows the overlay so shadow/scoped mounts remain styled.
 *
 * The overlay lands in `document.body`, so its CSS is adopted onto the
 * document. Callers hold the returned handle while mounted and release it when
 * they remove the overlay.
 *
 * @returns A handle to release during teardown, or null when no CSS was given
 */
export function portalViewportOverlay(
    overlay: HTMLElement,
    source: HTMLElement,
    css?: string,
): AdoptedStyles | null {
    const adopted = css ? adoptStyles(css, document) : null;
    copyOverlayTheme(source, overlay);
    document.body.appendChild(overlay);
    return adopted;
}
