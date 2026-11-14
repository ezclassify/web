/**
 * The EzClassify suite's shared field frame and trailing chrome, used by every
 * editing control: MarkingField, TagInput, MarkedInput, MarkedTextArea,
 * DecisionFlow, SingleSelect, CategorySelector and CategoryChecklist.
 *
 * The chrome is one row holding the status mark, the ★ favorites button where
 * it applies, and the clear button. It stays in the same place at rest and
 * while focused. A text field overlays it on its trailing edge (`'overlay'`),
 * and its text never runs under it: the chrome measures how far it reaches into
 * the field from the trailing edge and publishes that distance on the field's
 * wrap as `--ez-field-chrome-inline-size`; each field's stylesheet reserves
 * that much trailing padding on its text layers. A ResizeObserver keeps the
 * value current, so the reserve follows the chrome's contents (a favorites
 * button mounted later, a coarse-pointer target size, a font change). A control
 * with a header row of its own (the pickers, DecisionFlow) places the chrome at
 * that row's trailing end instead (`'inline'`), in flow, where it needs no
 * reserve.
 *
 * The frame is the box a control sits in: the edge, radius, background, padding
 * and focus ring of an ordinary input, from the library's tokens (see
 * field-chrome.css). A control that enhances a text input takes the input's own
 * edge, paint and spacing instead (see {@link mirrorHostFrame}), as the text
 * fields do.
 */

import fieldChromeCss from './field-chrome.css?inline';
import { adoptStylesOnce } from '../styles/adopt';
import { heightAtLeastFloor } from './dom-helpers';

/** The class that gives a control the suite's field frame. */
export const FIELD_FRAME_CLASS = 'ez-field-frame';

/**
 * Give `frame` the suite's field frame. Adopts the shared stylesheet on the
 * frame's root.
 *
 * @param frame - The control's outer box
 * @param root - Style-injection root
 */
export function applyFieldFrame(frame: HTMLElement, root?: HTMLElement): void {
    adoptStylesOnce(fieldChromeCss, root ?? frame);
    frame.classList.add(FIELD_FRAME_CLASS);
}

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
    opts: {
        root?: HTMLElement;
        align?: 'center' | 'start';
        placement?: 'overlay' | 'inline';
    },
): FieldChrome {
    adoptStylesOnce(fieldChromeCss, opts.root ?? wrap);

    const element = document.createElement('div');
    element.className = 'ez-field-chrome';
    if (opts.placement === 'inline')
        element.classList.add('ez-field-chrome--inline');
    else if (opts.align === 'start')
        element.classList.add('ez-field-chrome--start');
    const status = document.createElement('div');
    status.className = 'ez-field-chrome__status';
    element.appendChild(status);
    wrap.appendChild(element);

    // In flow, the row takes its own room; there is nothing to reserve.
    if (opts.placement === 'inline') {
        return {
            element,
            status,
            measure() {},
            destroy() {
                element.remove();
            },
        };
    }

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

/**
 * Give a control that enhances a text input that input's own edge, paint and
 * spacing, the way the text fields do, and keep them current as the host's
 * styles or theme change. A hidden input has no look to keep, and a host that
 * asked for the library's own field styling (`styleInputs`) keeps the frame's
 * tokens.
 *
 * The control's own stylesheet height is a floor: a host that asks for more
 * keeps it, and a single row sits centered in the extra room.
 *
 * @param frame - The control's visible box
 * @param host - The element the control was mounted for
 * @param opts - The control's container (watched for a `data-color-scheme`
 *   palette), whether the host asked for the library's styling, and whether an
 *   explicit palette (a theme option) should keep the token colors
 * @returns A function that stops following the host
 */
export function mirrorHostFrame(
    frame: HTMLElement,
    host: Element | null,
    opts: {
        container: HTMLElement;
        styleInputs?: boolean;
        explicitPalette?: () => boolean;
    },
): () => void {
    if (
        !(host instanceof HTMLInputElement) ||
        host.type === 'hidden' ||
        opts.styleInputs
    )
        return () => {};
    const sync = () => {
        const styles = window.getComputedStyle(host);
        // The frame's own stylesheet floor, read before the host's values are
        // written over it: the suite's single-line height.
        frame.style.minHeight = '';
        const floor = window.getComputedStyle(frame).minHeight;
        const explicitPalette =
            !!opts.explicitPalette?.() ||
            opts.container.hasAttribute('data-color-scheme');
        for (const property of [
            'boxSizing',
            'backgroundColor',
            'color',
            'font',
            'lineHeight',
            'borderWidth',
            'borderStyle',
            'borderColor',
            'borderRadius',
            'marginTop',
            'marginBottom',
            'minHeight',
            'paddingTop',
            'paddingBottom',
            'paddingLeft',
        ] as const) {
            frame.style[property] =
                explicitPalette &&
                ['backgroundColor', 'color', 'borderColor'].includes(property)
                    ? ''
                    : styles[property];
        }
        // The floor is the frame's outer height; a content-box frame measures
        // min-height inside the host padding and border it just took on.
        const box = window.getComputedStyle(frame);
        const edges =
            box.boxSizing === 'border-box'
                ? 0
                : [
                      box.paddingTop,
                      box.paddingBottom,
                      box.borderTopWidth,
                      box.borderBottomWidth,
                  ].reduce((sum, length) => sum + (parseFloat(length) || 0), 0);
        frame.style.minHeight = heightAtLeastFloor(
            styles.minHeight,
            `${Math.max(0, (parseFloat(floor) || 0) - edges)}px`,
        );
    };
    sync();
    if (typeof MutationObserver === 'undefined') return () => {};
    const observer = new MutationObserver(sync);
    observer.observe(opts.container, {
        attributes: true,
        attributeFilter: ['data-color-scheme'],
    });
    for (
        let ancestor: HTMLElement | null = host;
        ancestor;
        ancestor = ancestor.parentElement
    ) {
        observer.observe(ancestor, {
            attributes: true,
            attributeFilter: [
                'style',
                'class',
                'data-theme',
                'data-bs-theme',
                'data-color-scheme',
            ],
        });
    }
    return () => observer.disconnect();
}
