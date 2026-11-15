/**
 * Tooltip creation, positioning, and lifecycle management. Manages per-root
 * tooltip state using a WeakMap so each shadow root or container element gets
 * its own tooltip instance.
 */

import tooltipCss from './concept-tooltip.css?inline';
import { copyOverlayTheme, portalViewportOverlay } from './overlay-portal';
import type { AdoptedStyles } from '../styles/adopt';

/**
 * Per-root tooltip state, keyed by the root container element. `detach`, when
 * set, removes the scroll/resize dismiss listeners registered while a tooltip
 * is visible.
 */
const tooltipByRoot = new WeakMap<
    HTMLElement,
    {
        el: HTMLDivElement;
        style: AdoptedStyles | null;
        handler: (e: KeyboardEvent) => void;
        detach?: () => void;
        /**
         * What the tooltip describes now. It need not sit inside the root (a
         * field's chrome can hang outside the container it was mounted for), so
         * hiding releases it by reference, not only by searching the root.
         */
        target?: Element;
        /** Tells {@link target}'s owner the tooltip no longer describes it. */
        release?: () => void;
    }
>();

/** Lazily create a tooltip element scoped to a root container */
function ensureTooltipForRoot(root: HTMLElement): HTMLDivElement {
    const existing = tooltipByRoot.get(root);
    if (existing) return existing.el;

    const el = document.createElement('div');
    el.className = 'ez-tooltip';
    el.setAttribute('role', 'tooltip');
    el.setAttribute('data-ezclassify', '');
    el.id = 'ez-concept-tooltip-' + Math.random().toString(36).slice(2, 8);
    el.hidden = true;
    const style = portalViewportOverlay(el, root, tooltipCss);

    // Dismiss on Escape: scoped to root
    const handler = (e: KeyboardEvent) => {
        if (e.key === 'Escape' && !el.hidden) {
            hideTooltip(root);
        }
    };
    root.addEventListener('keydown', handler);

    tooltipByRoot.set(root, { el, style, handler });
    return el;
}

/** Remove tooltip DOM and listener for a root (called from destroy) */
export function cleanupTooltipForRoot(root: HTMLElement): void {
    const entry = tooltipByRoot.get(root);
    if (!entry) return;
    entry.detach?.();
    root.removeEventListener('keydown', entry.handler);
    entry.el.remove();
    entry.style?.release();
    tooltipByRoot.delete(root);
}

/** What a tooltip shows: lines of text, or content the caller built. */
export type TooltipContent = string | Node;

/** Where a tooltip may sit. */
export interface TooltipPlacement {
    /**
     * What the tooltip must not cover, such as the field the target belongs to,
     * or that field and its error list (the box around them all). The tooltip
     * goes below that box, or above it, lined up with the target; when neither
     * has room it goes beside the box, right or left. Room is judged first
     * inside every ancestor that clips the box's overflow, so the tooltip stays
     * by what the reader can see, then inside the viewport alone. Without it,
     * or when no side has room, the tooltip goes below the target, or above
     * it.
     */
    readonly clearOf?: HTMLElement | readonly HTMLElement[] | null;
}

/** A rectangle in viewport coordinates. */
interface Box {
    left: number;
    top: number;
    right: number;
    bottom: number;
}

/** The space between a tooltip and what it keeps clear of. */
const GAP = 6;
/** How far a tooltip stays from the viewport's edges. */
const VIEWPORT_MARGIN = 8;

/** The box around the connected elements in `clearOf`, or null for none. */
function clearBox(clearOf: TooltipPlacement['clearOf']): {
    box: Box;
    anchor: HTMLElement;
} | null {
    const elements = (
        clearOf ? (Array.isArray(clearOf) ? clearOf : [clearOf]) : []
    ).filter((el): el is HTMLElement => !!el?.isConnected);
    if (elements.length === 0) return null;
    const rects = elements.map((el) => el.getBoundingClientRect());
    return {
        anchor: elements[0],
        box: {
            left: Math.min(...rects.map((r) => r.left)),
            top: Math.min(...rects.map((r) => r.top)),
            right: Math.max(...rects.map((r) => r.right)),
            bottom: Math.max(...rects.map((r) => r.bottom)),
        },
    };
}

/** The viewport, less its margin. */
function viewportBox(): Box {
    return {
        left: VIEWPORT_MARGIN,
        top: VIEWPORT_MARGIN,
        right: window.innerWidth - VIEWPORT_MARGIN,
        bottom: window.innerHeight - VIEWPORT_MARGIN,
    };
}

/** An element's parent, crossing out of a shadow root to its host. */
function parentOf(el: Element): Element | null {
    if (el.parentElement) return el.parentElement;
    const root = el.getRootNode();
    return root instanceof ShadowRoot ? root.host : null;
}

/**
 * The part of the viewport where `el` can be seen: the viewport, cut down on
 * each axis by every ancestor that clips its overflow on that axis.
 */
function visibleBox(el: HTMLElement): Box {
    const box = viewportBox();
    const clips = (overflow: string) =>
        /hidden|auto|scroll|clip/.test(overflow);
    for (
        let node = parentOf(el);
        node && node !== document.body && node !== document.documentElement;
        node = parentOf(node)
    ) {
        const style = window.getComputedStyle(node);
        // Some DOM implementations leave the longhands empty when only the
        // shorthand was set; a browser always computes both.
        const x = clips(style.overflowX || style.overflow);
        const y = clips(style.overflowY || style.overflow);
        if (!x && !y) continue;
        const r = node.getBoundingClientRect();
        if (x) {
            box.left = Math.max(box.left, r.left);
            box.right = Math.min(box.right, r.right);
        }
        if (y) {
            box.top = Math.max(box.top, r.top);
            box.bottom = Math.min(box.bottom, r.bottom);
        }
    }
    return box;
}

/** `value` held inside [min, max], or `min` when the range is empty. */
function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(value, max));
}

/**
 * Where a tooltip of `size` sits clear of `clear`: below, above, right of or
 * left of it, the first that fits inside `area`, lined up with `target`. Null
 * when none fits.
 */
function placeClearOf(
    clear: Box,
    target: Box,
    size: { width: number; height: number },
    area: Box,
): { left: number; top: number } | null {
    const { width, height } = size;
    const centered = clamp(
        (target.left + target.right) / 2 - width / 2,
        area.left,
        area.right - width,
    );
    if (clear.bottom + GAP + height <= area.bottom) {
        return { left: centered, top: clear.bottom + GAP };
    }
    if (clear.top - GAP - height >= area.top) {
        return { left: centered, top: clear.top - GAP - height };
    }
    if (height > area.bottom - area.top) return null;
    const top = clamp(target.top, area.top, area.bottom - height);
    if (clear.right + GAP + width <= area.right) {
        return { left: clear.right + GAP, top };
    }
    if (clear.left - GAP - width >= area.left) {
        return { left: clear.left - GAP - width, top };
    }
    return null;
}

/**
 * Show the root's tooltip near a target element. One tooltip serves the whole
 * root, so showing it on a target releases whatever it described before.
 *
 * @param target - The element the tooltip describes (`aria-describedby`)
 * @param content - The tooltip's text, one line per row, or content a caller
 *   built itself. Built content may hold a control (the status mark's undo), so
 *   the tooltip then takes pointer presses.
 * @param root - The root whose tooltip to show; the document body by default
 * @param placement - Where the tooltip may sit
 * @param onRelease - Called once when the tooltip stops describing `target`: it
 *   hides, or another target takes it. A target that discloses the tooltip (a
 *   button whose press opens it) owns its own `aria-expanded` and resets it
 *   here; the manager never touches a target's state beyond the link. Showing
 *   the tooltip on the same target again without one keeps the pending one.
 */
export function showTooltip(
    target: HTMLElement,
    content: TooltipContent,
    root?: HTMLElement,
    placement?: TooltipPlacement,
    onRelease?: () => void,
): void {
    // A dwell timer's target can be removed from the DOM between when the
    // timer was scheduled and when it fires: dropdown rows, TagInput chips, and
    // marking segment chips all get rebuilt wholesale on re-render, and
    // removing a node fires no mouseleave to cancel the pending timer. Showing
    // against a detached element positions off a zeroed getBoundingClientRect
    // and leaves a tooltip nothing can dismiss (no mouseleave path exists for
    // an element no longer in the tree).
    if (!target.isConnected) return;

    const effectiveRoot = root ?? document.body;
    const tip = ensureTooltipForRoot(effectiveRoot);
    // A target can sit in a field's text (a marking in a text area's body),
    // which mirrors the control's font; the tooltip reads its root's.
    copyOverlayTheme(target, tip, effectiveRoot);

    tip.innerHTML = '';
    const built = typeof content !== 'string';
    tip.classList.toggle('ez-tooltip--built', built);
    // A tooltip holds no controls; built content may, so it is a group.
    tip.setAttribute('role', built ? 'group' : 'tooltip');
    if (built) tip.appendChild(content);
    // Build structured content from the lines
    const lines = built ? [] : content.split('\n');
    let currentSection: HTMLDivElement | null = null;

    for (const line of lines) {
        if (line === '') {
            currentSection = null;
            continue;
        }
        if (line === 'Scheme rules:') {
            const heading = document.createElement('div');
            heading.className = 'ez-tooltip__heading';
            heading.textContent = 'Scheme rules';
            tip.appendChild(heading);
            currentSection = document.createElement('div');
            currentSection.className = 'ez-tooltip__rules';
            tip.appendChild(currentSection);
            continue;
        }
        if (line.startsWith('  ') && currentSection) {
            const rule = document.createElement('div');
            rule.className = 'ez-tooltip__rule';
            rule.textContent = line.trim();
            currentSection.appendChild(rule);
            continue;
        }
        if (line.startsWith('Description: ') || line.startsWith('Usage: ')) {
            const label = line.startsWith('Description: ')
                ? 'Description'
                : 'Usage';
            const text = line.slice(label.length + 2);
            const heading = document.createElement('div');
            heading.className = 'ez-tooltip__heading';
            heading.textContent = label;
            tip.appendChild(heading);
            const body = document.createElement('div');
            body.className = 'ez-tooltip__body';
            body.textContent = text;
            tip.appendChild(body);
            continue;
        }
        // First line = header (concept name)
        const header = document.createElement('div');
        header.className = 'ez-tooltip__header';
        header.textContent = line;
        tip.appendChild(header);
    }

    // Link for accessibility. One tooltip serves the whole root, so whatever
    // it described before no longer points at it.
    const shown = tooltipByRoot.get(effectiveRoot);
    if (shown && shown.target !== target) {
        releaseShownTarget(shown, tip.id);
        shown.target = target;
        shown.release = onRelease;
    } else if (shown && onRelease) {
        shown.release = onRelease;
    }
    effectiveRoot
        .querySelectorAll(`[aria-describedby="${tip.id}"]`)
        .forEach((el) => {
            if (el !== target) releaseTooltipTarget(el, tip.id);
        });
    target.setAttribute('aria-describedby', tip.id);
    tip.hidden = false;

    // Position near the target
    const rect = target.getBoundingClientRect();
    const tipWidth = Math.min(32 * 16, window.innerWidth - 16); // max 32rem
    tip.style.maxWidth = tipWidth + 'px';

    // First render to get actual dimensions
    tip.style.left = '0';
    tip.style.top = '0';
    const tipRect = tip.getBoundingClientRect();

    const margin = VIEWPORT_MARGIN;

    // Clear of a box: below, above or beside it, inside what clips it if
    // possible, else anywhere in the viewport (the tooltip itself lives in
    // the document body, so no ancestor actually clips it).
    const clear = clearBox(placement?.clearOf);
    const placed = clear
        ? (placeClearOf(clear.box, rect, tipRect, visibleBox(clear.anchor)) ??
          placeClearOf(clear.box, rect, tipRect, viewportBox()))
        : null;

    // Otherwise by the target: prefer below, flip above if needed.
    let top = rect.bottom + GAP;
    let left = rect.left + rect.width / 2 - tipRect.width / 2;
    if (placed) {
        ({ top, left } = placed);
    } else if (
        rect.bottom + GAP + tipRect.height > window.innerHeight - margin &&
        rect.top - GAP - tipRect.height >= margin
    ) {
        top = rect.top - tipRect.height - GAP;
    }
    // Keep it on screen.
    top = clamp(top, margin, window.innerHeight - tipRect.height - margin);
    left = clamp(left, margin, window.innerWidth - tipRect.width - margin);

    tip.style.left = left + 'px';
    tip.style.top = top + 'px';

    // The tooltip is position:fixed and anchored to the target's viewport rect at
    // show time, so once the page (or any nested scroll container) scrolls it
    // would otherwise hang in place on screen. Dismiss it on scroll/resize, the
    // standard tooltip behavior. Capture:true catches scrolls from inner
    // containers; the listeners are torn down in hideTooltip via entry.detach.
    const entry = tooltipByRoot.get(effectiveRoot);
    if (entry) {
        entry.detach?.();
        const dismiss = () => hideTooltip(effectiveRoot);
        const opts: AddEventListenerOptions = { capture: true, passive: true };
        window.addEventListener('scroll', dismiss, opts);
        window.addEventListener('resize', dismiss);
        entry.detach = () => {
            window.removeEventListener('scroll', dismiss, opts);
            window.removeEventListener('resize', dismiss);
            entry.detach = undefined;
        };
    }
}

/** Hide the tooltip */
export function hideTooltip(root?: HTMLElement): void {
    const effectiveRoot = root ?? document.body;
    const entry = tooltipByRoot.get(effectiveRoot);
    const tip = entry?.el;
    if (!tip) return;
    entry.detach?.();
    tip.hidden = true;
    // Unlink the elements that reference this tooltip
    releaseShownTarget(entry, tip.id);
    effectiveRoot
        .querySelectorAll(`[aria-describedby="${tip.id}"]`)
        .forEach((el) => releaseTooltipTarget(el, tip.id));
}

/**
 * The tooltip stops describing the target it remembers: drop the link and tell
 * the target's owner, once.
 */
function releaseShownTarget(
    entry: { target?: Element; release?: () => void },
    tipId: string,
): void {
    const { target, release } = entry;
    entry.target = undefined;
    entry.release = undefined;
    if (target) releaseTooltipTarget(target, tipId);
    release?.();
}

/** An element the tooltip no longer describes: drop the link. */
function releaseTooltipTarget(el: Element, tipId: string): void {
    // Only the link to this tooltip is ours to drop: the element may have
    // moved on to another root's tooltip since.
    if (el.getAttribute('aria-describedby') !== tipId) return;
    el.removeAttribute('aria-describedby');
}

/**
 * A touch move beyond this many px before the long-press timer fires cancels
 * it: the finger is scrolling the list, not holding on a row.
 */
const LONG_PRESS_MOVE_CANCEL_PX = 10;

/**
 * Attach tooltip behavior to an element. Shows on hover and focus, hides on
 * leave/blur/Escape. Waits for content to be available before showing
 * (async-safe for lazy-loaded descriptions).
 *
 * @param onShown - Optional callback fired the moment the tooltip actually
 *   presents (after the hover-intent delay resolves), not when hover/focus
 *   merely begins. Callers that need to distinguish "shown to the user" from "a
 *   pointer passed through," such as the status mark's seen/unseen tracking,
 *   should hook this rather than the enter/focus events themselves.
 * @param enableLongPressTouch - Opt in to a touch equivalent of hover: a touch
 *   held on `target` past the same hover-intent delay reveals the tooltip, and
 *   lifting the finger afterward swallows the synthetic click that would
 *   otherwise follow so a long-press to inspect never also activates the
 *   target. A touch released before the delay elapses (an ordinary tap) is
 *   untouched: its click proceeds exactly as if this were never attached. Off
 *   by default: most `attachTooltip` targets (tokens, chips, the status mark)
 *   are real focusable controls where a touch tap is the primary activation
 *   gesture, and stealing its click would break them.
 * @param placement - Where the tooltip may sit, read when it shows (see
 *   {@link TooltipPlacement})
 * @param pinned - Whether the user opened the tooltip deliberately (pressed the
 *   target). While it returns true, the pointer leaving the target does not
 *   hide it; whatever pinned it closes it. Hover-only tooltips omit it.
 */
export function attachTooltip(
    target: HTMLElement,
    getContent: () => TooltipContent | undefined,
    root?: HTMLElement,
    shouldShow?: () => boolean,
    onShown?: () => void,
    enableLongPressTouch?: boolean,
    placement?: () => TooltipPlacement,
    pinned?: () => boolean,
): () => void {
    let showTimer: ReturnType<typeof setTimeout> | null = null;
    let active = false;
    let shown = false;

    const show = () => {
        if (shouldShow && !shouldShow()) return;
        // A target can receive mouseenter and then focus (or vice versa)
        // with no intervening leave/blur, e.g. a pointer-driven click that
        // also focuses the element. Without clearing here, the earlier
        // timer leaks and both eventually fire, showing the tooltip twice
        // and calling onShown twice for one dwell.
        if (showTimer) {
            clearTimeout(showTimer);
            showTimer = null;
        }
        active = true;
        const content = getContent();
        if (content) {
            showTimer = setTimeout(() => {
                if (active) {
                    showTooltip(target, content, root, placement?.());
                    shown = true;
                    onShown?.();
                }
            }, 300);
        } else {
            let attempts = 0;
            const poll = () => {
                if (!active) return;
                attempts++;
                const c = getContent();
                if (c) {
                    showTooltip(target, c, root, placement?.());
                    shown = true;
                    onShown?.();
                } else if (attempts < 10) {
                    setTimeout(poll, 200);
                }
            };
            setTimeout(poll, 300);
        }
    };
    const hide = () => {
        active = false;
        shown = false;
        if (showTimer) {
            clearTimeout(showTimer);
            showTimer = null;
        }
        hideTooltip(root);
    };

    // A tooltip the user pressed open stays when the pointer moves on.
    const leave = () => {
        if (pinned?.()) {
            active = false;
            if (showTimer) {
                clearTimeout(showTimer);
                showTimer = null;
            }
            return;
        }
        hide();
    };

    target.addEventListener('mouseenter', show);
    target.addEventListener('mouseleave', leave);
    target.addEventListener('focus', show);
    target.addEventListener('blur', hide);

    let touching = false;
    let touchStartX = 0;
    let touchStartY = 0;
    const onTouchStart = (e: TouchEvent) => {
        // A second finger landing mid-touch means a pinch/gesture, not a
        // press-and-hold on this row; leave it alone.
        if (e.touches.length !== 1) return;
        touching = true;
        touchStartX = e.touches[0].clientX;
        touchStartY = e.touches[0].clientY;
        show();
    };
    const onTouchMove = (e: TouchEvent) => {
        if (!touching) return;
        const t = e.touches[0];
        if (!t) return;
        if (
            Math.abs(t.clientX - touchStartX) > LONG_PRESS_MOVE_CANCEL_PX ||
            Math.abs(t.clientY - touchStartY) > LONG_PRESS_MOVE_CANCEL_PX
        ) {
            touching = false;
            hide();
        }
    };
    const onTouchEnd = (e: TouchEvent) => {
        if (!touching) return;
        touching = false;
        // The hold lasted long enough for the tooltip to actually present:
        // treat the release as dismissing the tooltip, not as a tap on the
        // row underneath. Without this the browser's synthetic click still
        // fires right after touchend and selects the row the user only meant
        // to inspect.
        if (shown) e.preventDefault();
        hide();
    };
    const onTouchCancel = () => {
        touching = false;
        hide();
    };
    if (enableLongPressTouch) {
        target.addEventListener('touchstart', onTouchStart, {
            passive: true,
        });
        target.addEventListener('touchmove', onTouchMove, { passive: true });
        target.addEventListener('touchend', onTouchEnd);
        target.addEventListener('touchcancel', onTouchCancel);
    }

    return () => {
        hide();
        target.removeEventListener('mouseenter', show);
        target.removeEventListener('mouseleave', leave);
        target.removeEventListener('focus', show);
        target.removeEventListener('blur', hide);
        if (enableLongPressTouch) {
            target.removeEventListener('touchstart', onTouchStart);
            target.removeEventListener('touchmove', onTouchMove);
            target.removeEventListener('touchend', onTouchEnd);
            target.removeEventListener('touchcancel', onTouchCancel);
        }
    };
}
