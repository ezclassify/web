/**
 * Where the composer paints: an anchored popover on desktop, a sheet docked to
 * the keyboard on coarse-pointer phones.
 *
 * The popover measures against the visual viewport (the part the user can see
 * with an on-screen keyboard up), subtracts the library's own affixed status
 * banners, never covers the field it controls, and preserves the list's scroll
 * position across a reposition. Its side is chosen once per open, when its
 * content is known, and kept while the box still fits there: re-choosing on
 * every keystroke would flip the list above and below the field while the user
 * types.
 *
 * It never covers a control the user may reach for while it is open either.
 * Above the field it stops at the nearest control; when it fits on neither side
 * the page scrolls to make room below (keeping that control in view when the
 * box fits without hiding it); when it still does not fit it shrinks to the
 * room there is and scrolls inside it, and the view folds the broken rules to
 * make its header smaller.
 *
 * The sheet replaces the popover where a popover cannot work: a phone with the
 * keyboard up has too little room above or below a field for a usable list, and
 * flipping between them covers the label or the typed text. The sheet spans the
 * visible width, sits on the keyboard, and carries its own copy of the field at
 * the top so the text being typed is always in view.
 */

import { copyOverlayTheme } from '../overlay-portal';
import { readGeometry } from '../dom-helpers';

/**
 * The part of the page the user can actually see, in the same client
 * coordinates `getBoundingClientRect` and `position: fixed` use.
 *
 * `window.innerHeight` is the layout viewport. iOS Safari does not shrink it
 * when the on-screen keyboard opens; only the visual viewport shrinks (and may
 * pan, which moves `offsetTop`). Sizing against `innerHeight` let a list run
 * under the keyboard where it could be neither seen nor tapped. Browsers
 * without `visualViewport` fall back to the layout viewport, which is what they
 * paint anyway.
 */
export interface VisibleViewportBand {
    top: number;
    bottom: number;
    left: number;
    right: number;
}

/** The visible band right now; see {@link VisibleViewportBand}. */
export function visibleViewportBand(): VisibleViewportBand {
    const vv = window.visualViewport;
    if (vv && vv.height > 0 && vv.width > 0) {
        return {
            top: vv.offsetTop,
            bottom: vv.offsetTop + vv.height,
            left: vv.offsetLeft,
            right: vv.offsetLeft + vv.width,
        };
    }
    return {
        top: 0,
        bottom: window.innerHeight,
        left: 0,
        right: window.innerWidth,
    };
}

/**
 * {@link visibleViewportBand} less the library's own affixed status banners.
 *
 * A top- or bottom-affixed status banner is `position: fixed` above every
 * overlay on purpose: the marking must never be covered. A surface that clamps
 * to the bare viewport edge would slide its first or last rows under the
 * banner, so the banners' boxes come off the band first.
 */
export function unobscuredViewportBand(): VisibleViewportBand {
    const band = visibleViewportBand();
    let { top, bottom } = band;
    for (const bar of document.querySelectorAll('.ez-banner-affix-top')) {
        const rect = bar.getBoundingClientRect();
        if (rect.height > 0) top = Math.max(top, rect.bottom);
    }
    for (const bar of document.querySelectorAll('.ez-banner-affix-bottom')) {
        const rect = bar.getBoundingClientRect();
        if (rect.height > 0) bottom = Math.min(bottom, rect.top);
    }
    // A band the bars leave empty is no use to anyone; fall back to the
    // visible viewport rather than place the list in negative space.
    return bottom > top ? { ...band, top, bottom } : band;
}

/** How long without a scroll event counts as the scroll having settled. */
const SCROLL_SETTLE_MS = 150;

/**
 * Subscribe `handler` to every event that can change where the composer belongs
 * while it is open: a window resize; the visual viewport's own `resize`
 * (keyboard opens or closes) and `scroll` (iOS pans the visual viewport to keep
 * the caret in view, which changes `offsetTop` without resizing anything); a
 * scroll of the document or any scroller around the field (heard in the capture
 * phase, since `scroll` does not bubble); and the end of a scroll.
 *
 * The end of a scroll is its own call, with an event of type `scrollend`. A
 * placement made while the page was still moving (a smooth scroll, a fling)
 * measured a field that kept going; this is the one made where it stopped. It
 * comes from the browser's `scrollend` where there is one, and otherwise once
 * no scroll has arrived for a moment. Returns the matching unsubscribe.
 */
export function listenForViewportChanges(
    handler: (event: Event) => void,
): () => void {
    const vv = window.visualViewport;
    let settleTimer: ReturnType<typeof setTimeout> | null = null;
    let settleTarget: EventTarget | null = null;
    const settled = (): void => {
        if (settleTimer) clearTimeout(settleTimer);
        settleTimer = null;
        const end = new Event('scrollend');
        // Keep what scrolled, so a handler can still tell its own scroller
        // from the page's.
        Object.defineProperty(end, 'target', { value: settleTarget });
        handler(end);
    };
    const onScroll = (event: Event): void => {
        handler(event);
        settleTarget = event.target;
        if (settleTimer) clearTimeout(settleTimer);
        settleTimer = setTimeout(settled, SCROLL_SETTLE_MS);
    };
    const onScrollEnd = (event: Event): void => {
        settleTarget = event.target;
        settled();
    };
    const scrollOptions = { passive: true, capture: true };
    window.addEventListener('resize', handler);
    vv?.addEventListener('resize', handler);
    vv?.addEventListener('scroll', onScroll);
    window.addEventListener('scroll', onScroll, scrollOptions);
    window.addEventListener('scrollend', onScrollEnd, scrollOptions);
    return () => {
        if (settleTimer) clearTimeout(settleTimer);
        window.removeEventListener('resize', handler);
        vv?.removeEventListener('resize', handler);
        vv?.removeEventListener('scroll', onScroll);
        window.removeEventListener('scroll', onScroll, scrollOptions);
        window.removeEventListener('scrollend', onScrollEnd, scrollOptions);
    };
}

/**
 * True when a captured `scroll` event came from inside the surface itself (its
 * own list) rather than from the page or an ancestor. Nested scrollers do not
 * bubble `scroll`, so hosts listen on `window` in the capture phase to follow
 * the field; that listener also hears the list's own wheel scrolling, and
 * repositioning on those fights the gesture mid-scroll.
 */
export function isInternalScroll(surface: HTMLElement, event: Event): boolean {
    return event.target instanceof Node && surface.contains(event.target);
}

/** The elements a popover placement reads and writes. */
export interface PopoverPlacement {
    /** The positioned box (portaled to `document.body`). */
    readonly surface: HTMLElement;
    /** The scrolling list inside it; its height is what gets budgeted. */
    readonly list: HTMLElement;
    /** The combobox input the popover controls. */
    readonly input: HTMLElement;
    /** The field box around the input; the popover never covers it. */
    readonly anchor: HTMLElement;
    /** The box the popover's left edge is clamped within. */
    readonly bounds: HTMLElement;
    /** Owning field when the anchor is an inline editor within body text. */
    readonly field?: HTMLElement;
}

/**
 * One option row's worth of list: the least a box is of use with, and the floor
 * for the list's height budget after subtracting chrome (result row, needed
 * strip, footer, borders). If chrome ever eats the whole box, the list keeps
 * one visible row and the box scrolls, never a zero-height sliver.
 */
const MIN_LIST_HEIGHT = 60;

/** The smallest box worth showing beside the field. */
const MIN_BOX_HEIGHT = 100;

/** What counts as a control the user may reach for while the list is open. */
const CONTROL_SELECTOR = [
    'button',
    'input:not([type="hidden"])',
    'select',
    'textarea',
    'a[href]',
    '[role="switch"]',
    '[role="button"]',
    '[role="checkbox"]',
    '[role="tab"]',
].join(', ');

/**
 * The box of the lowest control on the page above the field that a popover
 * spanning `left`..`right` would cover. Null when there is none. The field's
 * own parts and the popover are not controls to keep clear of. The whole
 * document is searched, not only the field's own box: the control a user
 * reaches for (a switch that changes how the field is judged) is often in a
 * section of its own above the field.
 */
function nearestControlAbove(
    p: PopoverPlacement,
    anchorTop: number,
    left: number,
    right: number,
): { el: HTMLElement; bottom: number } | null {
    let lowest: { el: HTMLElement; bottom: number } | null = null;
    const doc = p.anchor.ownerDocument;
    for (const el of doc.querySelectorAll<HTMLElement>(CONTROL_SELECTOR)) {
        if (
            (p.field ?? p.anchor).contains(el) ||
            p.surface.contains(el) ||
            el === p.input
        ) {
            continue;
        }
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) continue;
        if (rect.bottom > anchorTop || rect.right <= left || rect.left >= right)
            continue;
        // Scrolled out of view, it is not in the popover's way.
        if (rect.bottom <= 0) continue;
        if (lowest === null || rect.bottom > lowest.bottom) {
            lowest = { el, bottom: rect.bottom };
        }
    }
    return lowest;
}

/** What a popover placement found. */
export interface PopoverFit {
    /**
     * Whether the box has room for its chrome and at least one option row; when
     * it does not, the caller should make the chrome smaller (fold the errors)
     * and place again.
     */
    readonly fits: boolean;
    /** Whether the placement scrolled the page to make room below the field. */
    readonly scrolled: boolean;
}

/** Which side the popover last took ('below' before any placement). */
export function popoverSide(surface: HTMLElement): 'above' | 'below' {
    return surface.dataset.side === 'above' ? 'above' : 'below';
}

/**
 * Position an already-visible popover against its field: clamp the left edge,
 * size the list to the room available, and open below or above.
 *
 * @param p - The elements involved
 * @param lockSide - Keep the side chosen by an earlier call in this open. The
 *   first placement of an open passes false; every reposition after it (typing,
 *   scroll, keyboard) passes true, so the popover never flips mid-edit while it
 *   still fits where it is.
 * @param mayScroll - Whether this placement may scroll the page to make the box
 *   fit below its field. False on a second placement of the same state (after a
 *   scroll, or after folding), so one change scrolls at most once
 * @returns See {@link PopoverFit}
 */
export function positionPopover(
    p: PopoverPlacement,
    lockSide: boolean,
    mayScroll = false,
): PopoverFit {
    const [inputRect, boundsRect, anchorRect] = readGeometry(
        p.input,
        p.bounds,
        p.anchor,
    );
    // Portaling escapes clipping but also leaves the field's CSS inheritance
    // chain. Copy the documented presentation tokens on every placement so
    // host themes follow, including after a light/dark switch.
    copyOverlayTheme(p.anchor, p.surface);

    // Measure the list's natural height with any earlier clamp lifted:
    // scrollHeight on the list is clamp-independent, but the surface's own
    // scrollHeight (used for chrome) reflects both list and surface clamps.
    // Lifting them also clamps scrollTop to 0, so save and restore both: a reposition must
    // never move the user's place in the list.
    const savedScrollTop = p.list.scrollTop;
    const savedSurfaceScrollTop = p.surface.scrollTop;
    p.surface.style.maxHeight = '';
    p.list.style.maxHeight = 'none';
    const listNatural = p.list.scrollHeight;
    const style = window.getComputedStyle(p.surface);
    const px = (value: string): number =>
        value.endsWith('px') ? Number.parseFloat(value) || 0 : 0;
    const marginTop = px(style.marginTop);
    const chrome =
        Math.max(0, p.surface.scrollHeight - listNatural) +
        px(style.borderTopWidth) +
        px(style.borderBottomWidth);

    const band = unobscuredViewportBand();
    // Clear the input as well as the box around it: an input can be taller
    // than its wrap (the inline editor's touch-sized input), and anchoring on
    // the wrap alone let an above-placed list sit on the input.
    const anchorTop = Math.min(anchorRect.top, inputRect.top);
    const anchorBottom = Math.max(anchorRect.bottom, inputRect.bottom);
    // Room on each side counts the 8px edge margin and the 4px gap.
    const spaceBelow = band.bottom - anchorBottom - 4 - 8;
    const width = p.surface.offsetWidth || 320;
    const maxLeft = Math.max(boundsRect.left, boundsRect.right - width);
    let left = Math.min(inputRect.left, maxLeft);
    const viewportMax = band.right - width - 8;
    if (left > viewportMax) left = viewportMax;
    if (left < band.left + 8) left = band.left + 8;

    // A popover never covers a control the user may reach for while it is
    // open (a switch right above the field, say): above the field, the room
    // ends at the nearest such control.
    const openAbove = anchorTop - 4 - band.top - 8;
    const control = nearestControlAbove(p, anchorTop, left, left + width);
    const spaceAbove =
        control === null
            ? openAbove
            : Math.min(openAbove, anchorTop - 4 - control.bottom - 4);
    p.surface.style.position = 'fixed';
    p.surface.style.left = `${left}px`;

    // What the box needs to be of use: its chrome (the result row) and at
    // least one option row, and no less than the 100px a list near an edge
    // needs to be usable (or the whole box, when it is smaller).
    const activeOption =
        p.list.querySelector<HTMLElement>('.ez-composer__row--active') ??
        p.list.querySelector<HTMLElement>('[role="option"]');
    const heading = activeOption
        ?.closest('[role="group"]')
        ?.querySelector<HTMLElement>('.ez-composer__group-label');
    const rowHeight =
        (activeOption?.offsetHeight ?? 0) + (heading?.offsetHeight ?? 0);
    const oneRow = Math.min(listNatural, Math.max(rowHeight, MIN_LIST_HEIGHT));
    const needed = Math.min(
        listNatural + chrome,
        Math.max(MIN_BOX_HEIGHT, chrome + oneRow),
    );
    const preferred = Math.min(listNatural, 300 - chrome) + chrome;

    // Order of preference: the side where the box fits at its preferred
    // height, below first; below when it fits there with at least one option
    // row; below after scrolling the page so it does (when the caller allows
    // it); above when it fits under the nearest control; otherwise the
    // roomier side, shrunk to it, and the caller folds what it can. Above
    // never reaches past the nearest control (see spaceAbove).
    const locked =
        lockSide && p.surface.dataset.side ? popoverSide(p.surface) : null;
    let side: 'above' | 'below';
    if (locked && (locked === 'below' ? spaceBelow : spaceAbove) >= needed) {
        side = locked;
    } else if (spaceBelow >= preferred) {
        side = 'below';
    } else if (spaceAbove >= preferred) {
        side = 'above';
    } else if (spaceBelow >= needed) {
        side = 'below';
    } else if (
        mayScroll &&
        scrollToFitBelow(
            p,
            anchorTop,
            band,
            spaceBelow,
            needed,
            preferred,
            control?.el ?? null,
        )
    ) {
        const placed = positionPopover(p, lockSide, false);
        p.list.scrollTop = savedScrollTop;
        p.surface.scrollTop = savedSurfaceScrollTop;
        return { ...placed, scrolled: true };
    } else if (spaceAbove >= needed) {
        side = 'above';
    } else {
        side = spaceBelow >= spaceAbove ? 'below' : 'above';
    }
    const room = Math.max(0, side === 'below' ? spaceBelow : spaceAbove);
    const fits = room >= needed;
    // The box stops at 360px, but never so short that tall chrome (the
    // result, its rules, the needs) leaves the list less than a row when the
    // room would hold one: that row would sit under the chrome.
    const total = Math.min(room, Math.max(360, chrome + oneRow));
    // One row's worth of list at least: when even that does not fit, the
    // whole box scrolls inside its room (below) instead of the list
    // vanishing.
    const listMax = Math.max(oneRow, total - chrome);
    p.list.style.maxHeight = `${listMax}px`;
    p.list.scrollTop = Math.min(
        savedScrollTop,
        Math.max(0, listNatural - listMax),
    );
    // Too little room for the chrome and a row: the whole box scrolls inside
    // the room it has rather than spill over what is next to it.
    const natural = Math.min(listNatural, listMax) + chrome;
    const overflows = natural > total && total > 0;
    const height = overflows ? total : natural;
    p.surface.style.height = '';
    p.surface.style.minHeight = '';
    p.surface.style.maxHeight = overflows ? `${total}px` : '';
    p.surface.style.overflowY = overflows ? 'auto' : '';
    p.surface.scrollTop = savedSurfaceScrollTop;
    // Kept inside the visible band even when the field itself is not (an
    // off-screen field focused from code).
    const top =
        side === 'below'
            ? Math.max(
                  band.top + 8,
                  Math.min(anchorBottom + 4, band.bottom - height - 8),
              )
            : Math.max(
                  band.top + 8,
                  Math.min(anchorTop - height - 4, band.bottom - height - 8),
              );
    p.surface.style.top = `${top - marginTop}px`;
    p.surface.style.bottom = 'auto';
    p.surface.style.width = '';
    p.surface.dataset.side = side;
    return { fits, scrolled: false };
}

/**
 * Scroll the page so the list fits below its field, when it can: far enough for
 * the box at its preferred height, but never further than the field at the top
 * of the visible band (below any header pinned there), never past the end of
 * the page, and no further than the box needs when going further would hide the
 * nearest control above the field (`control`). Returns whether the scroll makes
 * the box fit.
 */
function scrollToFitBelow(
    p: PopoverPlacement,
    anchorTop: number,
    band: VisibleViewportBand,
    spaceBelow: number,
    needed: number,
    preferred: number,
    control: HTMLElement | null,
): boolean {
    const doc = p.anchor.ownerDocument;
    const scroller = doc.scrollingElement ?? doc.documentElement;
    const win = doc.defaultView ?? window;
    const maxScroll = Math.max(
        0,
        scroller.scrollHeight - win.innerHeight - win.scrollY,
    );
    const top =
        Math.max(band.top, pinnedHeaderBottom(p.anchor, band, p.surface)) + 8;
    const by = Math.min(
        Math.max(needed, preferred) - spaceBelow,
        Math.max(0, anchorTop - top),
        maxScroll,
    );
    if (by <= 0 || spaceBelow + by < needed) return false;
    // Instant, whatever the page's scroll-behavior: the placement re-measures
    // the field right after, and a smooth scroll would not have moved it yet.
    win.scrollBy({ top: by, behavior: 'instant' });
    // Keep the nearest control above the field reachable when the box fits
    // with less: if the scroll hid it (off the top, or under a header the
    // page pins there), scroll back to just what the box needs.
    const least = needed - spaceBelow;
    if (control && least < by && !reachable(control)) {
        win.scrollBy({ top: -(by - Math.max(least, 0)), behavior: 'instant' });
    }
    return true;
}

/**
 * The bottom edge of the headers the page pins to the top of the visible band
 * (position fixed or sticky) above the field's column, stacked (a site header
 * with a sticky banner under it), or the band's top when there are none.
 * Scrolling the field to the band's top would otherwise hide it under them.
 */
function pinnedHeaderBottom(
    anchor: HTMLElement,
    band: VisibleViewportBand,
    surface: HTMLElement | null = null,
): number {
    const doc = anchor.ownerDocument;
    if (typeof doc.elementFromPoint !== 'function') return band.top;
    const rect = anchor.getBoundingClientRect();
    const x = Math.min(
        Math.max(rect.left + rect.width / 2, band.left + 1),
        band.right - 1,
    );
    let edge = band.top;
    // A few layers at most; each one found moves the probe below it.
    for (let layer = 0; layer < 4; layer++) {
        const pinned = pinnedAt(anchor, surface, x, edge + 1);
        if (pinned === null || pinned <= edge) break;
        edge = pinned;
    }
    return edge;
}

/**
 * Scroll the page just enough to show `target`, clear of the headers and
 * banners the page pins to the top of the view (a bare `scrollIntoView` leaves
 * it under them) and of the keyboard. Does nothing when it is already in the
 * clear.
 */
export function revealClearOfPinned(target: HTMLElement): void {
    if (!target.isConnected) return;
    const win = target.ownerDocument.defaultView;
    if (!win) return;
    const band = unobscuredViewportBand();
    const top = Math.max(band.top, pinnedHeaderBottom(target, band)) + 8;
    const bottom = band.bottom - 8;
    const rect = target.getBoundingClientRect();
    // Not laid out (hidden, or no layout at all): nothing to bring into view.
    if (rect.width === 0 && rect.height === 0) return;
    let by = 0;
    if (rect.top < top) by = rect.top - top;
    else if (rect.bottom > bottom)
        // Never so far that its top goes under the pinned bars.
        by = Math.min(rect.bottom - bottom, rect.top - top);
    if (by !== 0) win.scrollBy({ top: by, behavior: 'instant' });
}

/** Whether a press at the middle of `el` would reach it. */
function reachable(el: HTMLElement): boolean {
    const rect = el.getBoundingClientRect();
    const doc = el.ownerDocument;
    if (typeof doc.elementFromPoint !== 'function') return true;
    const hit = doc.elementFromPoint(
        rect.left + rect.width / 2,
        rect.top + rect.height / 2,
    );
    return hit !== null && (hit === el || el.contains(hit) || hit.contains(el));
}

/** The bottom of a fixed or sticky box covering the point, or null. */
function pinnedAt(
    anchor: HTMLElement,
    surface: HTMLElement | null,
    x: number,
    y: number,
): number | null {
    const doc = anchor.ownerDocument;
    let el = doc.elementFromPoint(x, y);
    while (el && el !== doc.body && el !== doc.documentElement) {
        if (surface?.contains(el) || el.contains(anchor)) return null;
        const position = getComputedStyle(el).position;
        if (position === 'fixed' || position === 'sticky') {
            const box = el.getBoundingClientRect();
            if (box.top <= y && box.bottom > y) return box.bottom;
        }
        el = el.parentElement;
    }
    return null;
}

/**
 * Dock the sheet to the bottom of the visible band (the top of the keyboard),
 * full visible width. The sheet grows to its content and stops 8px short of the
 * band's top, so a banner or the page's own header stays visible above it.
 *
 * @param keepHeight - Keep at least the height an earlier call gave it in this
 *   open (the caller clears it when a new open starts), so the sheet never gets
 *   shorter while the user works in it
 */
export function positionSheet(
    surface: HTMLElement,
    list: HTMLElement,
    keepHeight = false,
): void {
    if (!keepHeight) delete surface.dataset.sheetHeight;
    const band = unobscuredViewportBand();
    const savedScrollTop = list.scrollTop;
    list.style.maxHeight = 'none';
    const listNatural = list.scrollHeight;
    // scrollHeight leaves out the box's own borders; they paint too.
    const style = window.getComputedStyle(surface);
    const px = (value: string): number =>
        value.endsWith('px') ? Number.parseFloat(value) || 0 : 0;
    const chrome =
        Math.max(0, surface.scrollHeight - listNatural) +
        px(style.borderTopWidth) +
        px(style.borderBottomWidth);
    const maxHeight = Math.max(MIN_LIST_HEIGHT, band.bottom - band.top - 8);
    const listMax = Math.max(MIN_LIST_HEIGHT, maxHeight - chrome);
    list.style.maxHeight = `${listMax}px`;
    list.scrollTop = Math.min(
        savedScrollTop,
        Math.max(0, listNatural - listMax),
    );
    // While it stays open the sheet never gets shorter: content that shrinks
    // (a fix applied, the list narrowed) would otherwise drop its top edge
    // under the user's finger. The room below the list is simply empty.
    const previous = Number(surface.dataset.sheetHeight) || 0;
    const height = Math.min(
        Math.max(Math.min(listNatural, listMax) + chrome, previous),
        maxHeight,
    );
    surface.dataset.sheetHeight = String(height);
    surface.style.height = '';
    surface.style.minHeight = `${height}px`;
    surface.style.position = 'fixed';
    surface.style.left = `${band.left}px`;
    surface.style.width = `${band.right - band.left}px`;
    surface.style.top = `${band.bottom - height}px`;
    surface.style.bottom = 'auto';
    surface.style.maxHeight = '';
    surface.style.overflowY = '';
    surface.dataset.side = 'sheet';
}

/**
 * A visible viewport shorter than this (px) is a phone with its keyboard up (a
 * 330px band on a current iPhone, 450px on a tall one): the sheet keeps only
 * its essentials fixed and gives the rest to the list.
 */
const COMPACT_BAND = 500;

/**
 * Whether the visible viewport is a phone's with the keyboard up. The whole
 * visible viewport counts, not what bars the page pins leave of it: they
 * shorten the sheet, but they do not mean a keyboard.
 */
export function keyboardUp(): boolean {
    const band = visibleViewportBand();
    return band.bottom - band.top < COMPACT_BAND;
}

/**
 * Dock the keyboard-up sheet: the whole visible band (below any banner the page
 * affixes to the top), 4px short of its top, whatever its content. The list
 * (and what scrolls with it) takes all the height the fixed chrome leaves,
 * through the surface's flex layout, so no read, fold or scroll changes the
 * list's size; only a change of the band itself does.
 */
export function positionCompactSheet(
    surface: HTMLElement,
    list: HTMLElement,
): void {
    const band = unobscuredViewportBand();
    const top = band.top + 4;
    const height = Math.max(MIN_BOX_HEIGHT, band.bottom - top);
    delete surface.dataset.sheetHeight;
    list.style.maxHeight = '';
    surface.style.position = 'fixed';
    surface.style.left = `${band.left}px`;
    surface.style.width = `${band.right - band.left}px`;
    surface.style.top = `${band.bottom - height}px`;
    surface.style.bottom = 'auto';
    surface.style.height = `${height}px`;
    surface.style.minHeight = `${height}px`;
    surface.style.maxHeight = `${height}px`;
    surface.style.overflowY = '';
    surface.dataset.side = 'sheet';
}

/**
 * Scroll `row` into the list's view, clearing a sticky group label above it. A
 * bare `scrollIntoView` does not know the label floats over the top of the
 * scrollport and can leave the row's top edge under it.
 */
export function revealRow(list: HTMLElement, row: HTMLElement): void {
    let sticky = 0;
    const group = row.closest('[role="group"]');
    const label = group?.querySelector<HTMLElement>(
        '.ez-composer__group-label',
    );
    if (label && label !== row) sticky = label.offsetHeight;
    const top = row.offsetTop;
    const bottom = top + row.offsetHeight;
    const viewTop = list.scrollTop + sticky;
    const viewBottom = list.scrollTop + list.clientHeight;
    if (top < viewTop) list.scrollTop = Math.max(0, top - sticky);
    else if (bottom > viewBottom) list.scrollTop = bottom - list.clientHeight;
}

/**
 * Hold the page where it is while the docked sheet is open, and return the
 * release. The sheet covers the page, so nothing under it should move: the user
 * cannot scroll it (the root stops scrolling), and a scroll the browser makes
 * on its own, such as bringing the caret of the sheet's input into view as the
 * user types, is put back at once. Released, the page is where it was when the
 * sheet opened, with the field the user tapped still in view.
 */
export function holdPageScroll(doc: Document): () => void {
    const win = doc.defaultView;
    if (!win) return () => {};
    const root = doc.documentElement;
    const left = win.scrollX;
    const top = win.scrollY;
    const overflow = root.style.overflow;
    root.style.overflow = 'hidden';
    const keep = (): void => {
        if (win.scrollX !== left || win.scrollY !== top) {
            win.scrollTo({ left, top, behavior: 'instant' });
        }
    };
    win.addEventListener('scroll', keep, { passive: true });
    return () => {
        win.removeEventListener('scroll', keep);
        root.style.overflow = overflow;
        keep();
    };
}
