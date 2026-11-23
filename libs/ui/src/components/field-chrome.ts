/**
 * The EzClassify suite's shared field frame and trailing chrome, used by every
 * editing control: MarkingField, TagInput, MarkedInput, MarkedTextArea,
 * DecisionFlow, SingleSelect, CategorySelector and CategoryChecklist.
 *
 * The chrome is one row holding the branding/tools button and the clear button.
 * It stays in the same place at rest and while focused. A text field overlays
 * it on its trailing edge (`'overlay'`), and its text never runs under it: the
 * chrome measures how far it reaches into the field from the trailing edge and
 * publishes that distance on the field's wrap as
 * `--ez-field-chrome-inline-size`; each field's stylesheet reserves that much
 * trailing padding on its text layers. A ResizeObserver keeps the value
 * current, so the reserve follows the chrome's contents (a change count, a
 * coarse-pointer target size, a font change). A control with a header row of
 * its own (the pickers, DecisionFlow) places the chrome at that row's trailing
 * end instead (`'inline'`), in flow, where it needs no reserve.
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

// White below the WCAG luminance crossover and black above it.
function contrastingAccent(color: string): string {
    const channel = 'max(0, sign(0.179 - y))';
    return `color(from ${color} xyz-d65 calc(0.95047 * ${channel}) ${channel} calc(1.08883 * ${channel}))`;
}

/** Use the host's ordinary accent-color as the field's palette fallback. */
export function mirrorHostAccent(
    frame: HTMLElement,
    styles: CSSStyleDeclaration,
): void {
    const accent = styles.accentColor;
    const native = accent && accent !== 'auto' ? accent : '';
    const primary = '--_ez-default-color-primary';
    const contrast = globalThis.CSS?.supports?.(
        'color',
        contrastingAccent('red'),
    )
        ? contrastingAccent(`var(--ez-color-primary, var(${primary}))`)
        : '';
    for (const [property, value] of [
        [primary, native],
        [`${primary}-contrast`, native ? contrast : ''],
    ]) {
        if (frame.style.getPropertyValue(property) !== value)
            frame.style.setProperty(property, value);
    }
}

/** The custom property each field's text layers read for their reserve. */
export const FIELD_CHROME_INLINE_SIZE = '--ez-field-chrome-inline-size';

/** A mounted chrome row and the measurement that keeps its reserve current. */
export interface FieldChrome {
    /** The row. The field mounts its clear button here, after {@link status}. */
    readonly element: HTMLElement;
    /**
     * The branding/tools button's group, ahead of clear in reading and Tab
     * order. Mount the mark here with `shape: 'chrome'`.
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
        /**
         * The visible field when it has its own font outside the chrome's
         * inheritance.
         */
        fontSource?: HTMLElement;
        /** A select before the trailing chrome in the field's arrow order. */
        leadingSelect?: HTMLSelectElement;
        /**
         * An owned caption retained in reading order while chrome follows the
         * work.
         */
        header?: () => HTMLElement | null;
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

    const fontSource = opts.fontSource;
    const syncFont = () => {
        if (!fontSource) return;
        const style = getComputedStyle(fontSource);
        for (const property of [
            'fontFamily',
            'fontSize',
            'fontStyle',
            'fontWeight',
            'fontStretch',
            'lineHeight',
        ] as const) {
            if (element.style[property] !== style[property])
                element.style[property] = style[property];
        }
        if (
            opts.leadingSelect &&
            wrap.style.getPropertyValue('--ez-chevron-source-size') !==
                style.fontSize
        )
            wrap.style.setProperty('--ez-chevron-source-size', style.fontSize);
    };
    syncFont();
    const fontObserver = fontSource
        ? observeFieldTheme(fontSource, syncFont, undefined, true)
        : null;

    // A select and its trailing buttons share one physical arrow order.
    // Other fields manage their own text or picker keys.
    const leadingSelect = opts.leadingSelect;
    const keyboardRoot = leadingSelect ? wrap : element;
    const onKeydown = (event: KeyboardEvent) => {
        if (
            !['ArrowLeft', 'ArrowRight'].includes(event.key) ||
            event.altKey ||
            event.ctrlKey ||
            event.metaKey ||
            event.shiftKey ||
            event.isComposing
        )
            return;
        const controls = [
            ...(leadingSelect ? [leadingSelect] : []),
            ...element.querySelectorAll<HTMLButtonElement | HTMLInputElement>(
                'button.ez-marked-field-add, button.ez-status-mark, button.ez-clear-button, input.ez-field-action__checkbox',
            ),
        ].filter((control) => {
            if (
                control.disabled ||
                control.getAttribute('aria-disabled') === 'true'
            )
                return false;
            for (
                let node: HTMLElement | null = control;
                node;
                node = node.parentElement
            ) {
                const style = getComputedStyle(node);
                if (
                    node.hidden ||
                    style.display === 'none' ||
                    style.visibility === 'hidden' ||
                    style.visibility === 'collapse'
                )
                    return false;
                if (node === wrap) break;
            }
            return true;
        });
        const target =
            event.target instanceof Element
                ? event.target.closest(
                      'button, select, input.ez-field-action__checkbox',
                  )
                : null;
        if (!controls.some((control) => control === target)) return;
        const rtl = getComputedStyle(wrap).direction === 'rtl';
        controls.sort((a, b) => {
            if (a === leadingSelect || b === leadingSelect)
                return (a === leadingSelect ? -1 : 1) * (rtl ? -1 : 1);
            const distance =
                a.getBoundingClientRect().left - b.getBoundingClientRect().left;
            return (
                distance ||
                (rtl ? -1 : 1) *
                    (a.compareDocumentPosition(b) &
                    Node.DOCUMENT_POSITION_FOLLOWING
                        ? -1
                        : 1)
            );
        });
        event.preventDefault();
        event.stopPropagation();
        const index = controls.findIndex((control) => control === target);
        controls[index + (event.key === 'ArrowRight' ? 1 : -1)]?.focus();
    };
    keyboardRoot.addEventListener('keydown', onKeydown);

    // In flow, the row takes its own room; there is nothing to reserve.
    if (opts.placement === 'inline') {
        return {
            element,
            status,
            measure() {},
            destroy() {
                fontObserver?.disconnect();
                keyboardRoot.removeEventListener('keydown', onKeydown);
                element.remove();
            },
        };
    }

    let header: HTMLElement | null = null;
    const measure = () => {
        if (!element.isConnected) return;
        syncFont();
        const reserve = chromeReach(wrap, element);
        wrap.style.setProperty(FIELD_CHROME_INLINE_SIZE, `${reserve}px`);
        const nextHeader = opts.header?.() ?? null;
        if (nextHeader !== header) {
            if (header) observer?.unobserve(header);
            header = nextHeader;
            if (header) observer?.observe(header);
        }
        if (header?.isConnected) {
            header.style.paddingInlineEnd = `${reserve}px`;
            header.style.minBlockSize = `${element.getBoundingClientRect().height}px`;
            const rect = header.getBoundingClientRect();
            element.style.top = `${rect.top + rect.height / 2 - wrap.getBoundingClientRect().top - wrap.clientTop}px`;
        }
    };
    // Every child change that resizes the row resizes its border box, which
    // is what the observer reports; the wrap itself is observed too, because a
    // border or direction change moves the row without resizing it.
    // Measuring also writes styles that affect these boxes. Do that on the
    // next frame so the observer can finish delivering the current sizes.
    let frame: number | undefined;
    const scheduleMeasure = () => {
        if (frame !== undefined) return;
        frame = requestAnimationFrame(() => {
            frame = undefined;
            measure();
        });
    };
    const observer =
        typeof ResizeObserver === 'undefined'
            ? null
            : new ResizeObserver(scheduleMeasure);
    observer?.observe(element);
    observer?.observe(wrap);
    measure();

    return {
        element,
        status,
        measure,
        destroy() {
            fontObserver?.disconnect();
            if (opts.leadingSelect)
                wrap.style.removeProperty('--ez-chevron-source-size');
            observer?.disconnect();
            if (frame !== undefined) cancelAnimationFrame(frame);
            keyboardRoot.removeEventListener('keydown', onKeydown);
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
export function chromeReach(wrap: HTMLElement, chrome: HTMLElement): number {
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

/** Mark an enhanced native control for the suite's low-specificity defaults. */
export function mountNativeFieldDefaults(host: HTMLElement): () => void {
    const existing = host.classList.contains('ez-native-field');
    const hadClassAttribute = host.hasAttribute('class');
    host.classList.add('ez-native-field');
    return () => {
        if (!existing) host.classList.remove('ez-native-field');
        if (!hadClassAttribute && !host.className)
            host.removeAttribute('class');
    };
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
 *   explicit palette (a theme option) should keep the token colors. Composite
 *   controls keep their own layout and mirror only the appearance.
 * @returns A function that stops following the host
 */
export function mirrorHostFrame(
    frame: HTMLElement,
    host: Element | null,
    opts: {
        container: HTMLElement;
        styleInputs?: boolean;
        explicitPalette?: () => boolean;
        paintOnly?: boolean;
    },
): () => void {
    if (
        !(
            host instanceof HTMLInputElement ||
            host instanceof HTMLTextAreaElement ||
            host instanceof HTMLFieldSetElement ||
            host instanceof HTMLSelectElement
        ) ||
        (host instanceof HTMLInputElement && host.type === 'hidden') ||
        (!opts.paintOnly &&
            !(
                host instanceof HTMLInputElement ||
                host instanceof HTMLSelectElement
            )) ||
        opts.styleInputs
    )
        return () => {};
    const releaseDefaults =
        !opts.paintOnly && host instanceof HTMLInputElement
            ? mountNativeFieldDefaults(host)
            : undefined;
    const sync = () => {
        const styles = window.getComputedStyle(host);
        mirrorHostAccent(frame, styles);
        // A native select is already the visible surface inside the frame.
        if (host instanceof HTMLSelectElement) return;
        // The frame's own stylesheet floor, read before the host's values are
        // written over it: the suite's single-line height.
        if (!opts.paintOnly) frame.style.minHeight = '';
        const floor = opts.paintOnly
            ? ''
            : window.getComputedStyle(frame).minHeight;
        const explicitPalette =
            !!opts.explicitPalette?.() ||
            opts.container.hasAttribute('data-color-scheme');
        for (const [property, token] of [
            ['backgroundColor', 'color-background'],
            ['color', 'color-text'],
            ['borderColor', 'color-border'],
            ['borderWidth', 'border-width'],
            ['borderRadius', 'border-radius'],
        ] as const) {
            const value =
                explicitPalette && token.startsWith('color-')
                    ? ''
                    : styles[property];
            if (opts.paintOnly)
                frame.style.setProperty(`--_ez-native-${token}`, value);
            else frame.style[property] = value;
        }
        for (const [property, cssName] of [
            ['borderStyle', 'border-style'],
            ['font', 'font'],
            ['lineHeight', 'line-height'],
        ] as const) {
            if (opts.paintOnly) {
                // A borderless host already supplies zero width. Keep the
                // default style so a later width override can draw an edge.
                const borderless =
                    property === 'borderStyle' &&
                    /^(none|hidden)$/.test(styles.borderStyle);
                frame.style.setProperty(
                    `--_ez-native-${cssName}`,
                    borderless ? '' : styles[property],
                );
                continue;
            }
            frame.style[property] = styles[property];
        }
        if (opts.paintOnly) return;
        for (const property of [
            'boxSizing',
            'marginTop',
            'marginBottom',
            'minHeight',
            'paddingTop',
            'paddingBottom',
            'paddingLeft',
        ] as const) {
            frame.style[property] = styles[property];
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
    const observer = observeFieldTheme(host, sync, opts.container, true);
    return () => {
        observer?.disconnect();
        releaseDefaults?.();
    };
}

/** Refresh computed field snapshots when a host changes its theme scope. */
export function observeFieldTheme(
    host: HTMLElement,
    sync: () => void,
    container?: HTMLElement,
    observeHostStyle = false,
): MutationObserver | null {
    if (typeof MutationObserver === 'undefined') return null;
    const observer = new MutationObserver(sync);
    if (container && !container.contains(host)) {
        observer.observe(container, {
            attributes: true,
            attributeFilter: ['data-color-scheme'],
        });
    }
    observer.observe(host, {
        attributes: true,
        attributeFilter: [
            ...(observeHostStyle ? ['style', 'class'] : []),
            'data-theme',
            'data-bs-theme',
            'data-color-scheme',
        ],
    });
    // Host stylesheets can scope a theme to any ancestor attribute.
    const ShadowRootOfHost = host.ownerDocument.defaultView?.ShadowRoot;
    let ancestor: Element | null = host;
    while (ancestor) {
        const parent: HTMLElement | null = ancestor.parentElement;
        const root: Node | null = parent ? null : ancestor.getRootNode();
        ancestor =
            parent ??
            (ShadowRootOfHost && root instanceof ShadowRootOfHost
                ? root.host
                : null);
        if (ancestor) observer.observe(ancestor, { attributes: true });
    }
    return observer;
}
