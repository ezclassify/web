/**
 * Shared viewport-overlay support.
 *
 * UI components may be mounted inside cards, dialogs, tables, transformed
 * panels, or scroll containers. Dropdowns and tooltips therefore belong in
 * document.body, not in an arbitrary consumer layout ancestor. These helpers
 * preserve the source field's theme after that portal move. The font is the
 * exception: chrome takes the page's UI font, never a field control's own.
 */

import { adoptStyles, type AdoptedStyles } from '../styles/adopt';

const THEME_PROPERTIES = [
    '--ez-color-border-focus',
    '--ez-focus-ring-width',
    '--ez-focus-ring-offset',
    '--ez-color-muted',
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
    '--ez-dropdown-group-sticky-bg',
    '--ez-dropdown-shadow',
    '--ez-tooltip-background',
    '--ez-tooltip-color',
    '--ez-tooltip-border',
    '--ez-tooltip-shadow',
    '--ez-tooltip-header-color',
    '--ez-tooltip-heading-color',
    '--ez-tooltip-body-color',
    '--ez-tooltip-rule-color',
    '--ez-z-dropdown',
    '--ez-z-tooltip',
] as const;
const FRAME_THEME_PROPERTIES = [
    'color-background',
    'color-border',
    'color-text',
    'color-primary',
    'border-radius',
    'border-width',
] as const;

/** The closest form, themed region, or component container owns typography. */
const UI_FONT_SCOPE = 'form, .ez-root, [data-ezclassify]';

/** Native controls whose own font a field's text layers mirror. */
const FORM_CONTROL = 'input, textarea, select';

/**
 * Read the ordinary CSS font in the closest form or EzClassify scope that
 * contains the owner.
 *
 * A field's text layers mirror the native control's font on purpose, so the
 * marked text keeps the control's metrics. Chrome is not field text, and a
 * monospace textarea must not hand its face to the composer, a dropdown or a
 * tooltip opened from inside it. The root is library or host owned and never
 * mirrors a control, so its computed family is the surrounding page's. Outside
 * any root, the nearest ancestor that is not a form control stands in for it.
 *
 * @param owner - The component the chrome belongs to: its root container, or an
 *   element of it that sits outside the field's text layers
 * @returns The CSS style of the surrounding UI
 */
function uiFontStyle(owner: HTMLElement): CSSStyleDeclaration {
    let surrounding = owner.closest<HTMLElement>(UI_FONT_SCOPE) ?? owner;
    while (surrounding.matches(FORM_CONTROL) && surrounding.parentElement)
        surrounding = surrounding.parentElement;
    return window.getComputedStyle(surrounding);
}

/**
 * Copy documented presentation tokens from an in-flow anchor to an overlay, and
 * give the overlay the surrounding UI font.
 *
 * The overlay keeps the theme's base size and font family. Its stylesheet
 * supplies the relative sizes for labels and help text, independent of any font
 * applied directly to the native field.
 *
 * @param source - The in-flow element whose tokens the overlay takes
 * @param overlay - The portaled element
 * @param owner - Where the font is read from. Pass the component's root when
 *   `source` sits inside a field's text (an inline editor, a marking in the
 *   body): the root container of a text area is mounted beside its text layers,
 *   not around them, so no ancestor of `source` reaches it.
 */
export function copyOverlayTheme(
    source: HTMLElement,
    overlay: HTMLElement,
    owner: HTMLElement = source,
): void {
    const style = window.getComputedStyle(source);
    for (const property of THEME_PROPERTIES) {
        const value = style.getPropertyValue(property);
        if (value) overlay.style.setProperty(property, value);
        else overlay.style.removeProperty(property);
    }
    // A portal must keep a local palette's absent override from picking up
    // an unrelated override inherited from the document it lands in.
    for (const name of FRAME_THEME_PROPERTIES) {
        for (const prefix of ['--ez-', '--_ez-default-']) {
            const property = prefix + name;
            overlay.style.setProperty(
                property,
                style.getPropertyValue(property) || 'initial',
            );
        }
    }
    const fontStyle = uiFontStyle(owner);
    overlay.style.fontFamily = fontStyle.fontFamily;
    overlay.style.fontSize = fontStyle.fontSize;
}

/**
 * Put a fixed-position overlay beyond all consumer clipping ancestors. Optional
 * CSS follows the overlay so shadow/scoped mounts remain styled.
 *
 * The overlay lands in `document.body`, so its CSS is adopted onto the
 * document. Callers hold the returned handle while mounted and release it when
 * they remove the overlay.
 *
 * @param owner - Where the font is read from (see {@link copyOverlayTheme})
 * @returns A handle to release during teardown, or null when no CSS was given
 */
export function portalViewportOverlay(
    overlay: HTMLElement,
    source: HTMLElement,
    css?: string,
    owner: HTMLElement = source,
): AdoptedStyles | null {
    const adopted = css ? adoptStyles(css, document) : null;
    copyOverlayTheme(source, overlay, owner);
    document.body.appendChild(overlay);
    return adopted;
}
