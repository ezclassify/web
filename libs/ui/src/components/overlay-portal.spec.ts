/**
 * The overlay theme copy: tokens travel from the anchor, the font family comes
 * from the page around the EzClassify root. jsdom resolves neither inheritance
 * nor var(), so each element's computed font is given to it directly: an anchor
 * inside a field's text layer is styled the way that layer mirrors its control,
 * and the root carries the family a browser would inherit from the page.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { copyOverlayTheme } from './overlay-portal';

const MONOSPACE = '13px / 18px "SF Mono", monospace';

let page: HTMLDivElement;
let overlay: HTMLDivElement;

beforeEach(() => {
    page = document.createElement('div');
    page.className = 'page';
    document.body.appendChild(page);
    overlay = document.createElement('div');
    document.body.appendChild(overlay);
});

afterEach(() => {
    document.body.innerHTML = '';
    document.head.innerHTML = '';
});

/** Add page CSS, including the library's own root declaration. */
function pageStyles(css: string): void {
    const style = document.createElement('style');
    style.textContent = `.ez-root, [data-ezclassify] { --ez-font-family: inherit; }\n${css}`;
    document.head.appendChild(style);
}

/** A root holding a field text layer that mirrors a monospace control. */
function fieldLayer(): HTMLElement {
    page.innerHTML =
        '<div data-ezclassify><div class="layer"><span class="anchor"></span></div></div>';
    const anchor = page.querySelector<HTMLElement>('.anchor')!;
    anchor.style.font = MONOSPACE;
    return anchor;
}

describe('copyOverlayTheme', () => {
    it("gives the overlay the page font around the root, not the field control's", () => {
        pageStyles('.page [data-ezclassify] { font-family: Georgia, serif; }');
        copyOverlayTheme(fieldLayer(), overlay);
        expect(getComputedStyle(overlay).fontFamily).toBe('Georgia, serif');
    });

    it("leaves size, weight and line height to the overlay's own stylesheet", () => {
        pageStyles('.page [data-ezclassify] { font-family: Georgia, serif; }');
        copyOverlayTheme(fieldLayer(), overlay);
        expect(overlay.style.fontSize).toBe('');
        expect(overlay.style.fontWeight).toBe('');
        expect(overlay.style.lineHeight).toBe('');
    });

    it('uses the host --ez-font-family when one is set', () => {
        pageStyles(
            '.page [data-ezclassify] { font-family: Georgia, serif; --ez-font-family: Inter, sans-serif; }',
        );
        copyOverlayTheme(fieldLayer(), overlay);
        expect(getComputedStyle(overlay).fontFamily).toBe('Inter, sans-serif');
    });

    it("reads the owner's root when the source sits in field text beside it", () => {
        // A text area's root container is mounted beside its text layers, so
        // an inline editor inside the text has no root among its ancestors.
        pageStyles('.page [data-ezclassify] { font-family: Georgia, serif; }');
        page.innerHTML =
            '<div class="layer"><span class="anchor"></span></div><div data-ezclassify></div>';
        const anchor = page.querySelector<HTMLElement>('.anchor')!;
        anchor.style.font = MONOSPACE;
        const owner = page.querySelector<HTMLElement>('[data-ezclassify]')!;
        copyOverlayTheme(anchor, overlay, owner);
        expect(getComputedStyle(overlay).fontFamily).toBe('Georgia, serif');
    });

    it('discards an old dropdown override when the next anchor stops supplying it', () => {
        const anchor = fieldLayer();
        anchor.style.setProperty('--ez-dropdown-background', '#123456');
        copyOverlayTheme(anchor, overlay);
        expect(overlay.style.getPropertyValue('--ez-dropdown-background')).toBe(
            '#123456',
        );

        anchor.style.removeProperty('--ez-dropdown-background');
        anchor.style.setProperty('--ez-color-background', '#234567');
        copyOverlayTheme(anchor, overlay);
        expect(overlay.style.getPropertyValue('--ez-dropdown-background')).toBe(
            '',
        );
        expect(overlay.style.getPropertyValue('--ez-color-background')).toBe(
            '#234567',
        );
    });

    it('outside any root, reads the nearest ancestor that is not a form control', () => {
        pageStyles(
            '.page { font-family: Georgia, serif; } .page textarea { font: 13px monospace; }',
        );
        page.innerHTML = '<textarea></textarea>';
        copyOverlayTheme(page.querySelector('textarea')!, overlay);
        expect(getComputedStyle(overlay).fontFamily).toBe('Georgia, serif');
    });
});
