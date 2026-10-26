import defaultStylesCss from './styles.css?inline';
import { adoptStylesOnce } from './styles/adopt';

/** The default EzClassify stylesheet: design tokens and base styles. */
export const EZ_CSS_VARIABLES: string = defaultStylesCss;

/** Retrieve default styles. */
export function getDefaultStyles(): string {
    return EZ_CSS_VARIABLES;
}

/**
 * Adopt the default EzClassify stylesheet (no-op if already adopted). When
 * `root` is provided, the sheet is adopted onto that element's root node, so a
 * component mounted in a shadow root gets the stylesheet inside that shadow
 * root instead of in the document.
 */
export function injectDefaultStyles(root?: HTMLElement): void {
    if (typeof document === 'undefined') return;
    adoptStylesOnce(getDefaultStyles(), root);
}
