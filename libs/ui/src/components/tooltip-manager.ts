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

/** Where a tooltip may sit. */
export interface TooltipPlacement {
    /**
     * A box the tooltip must not cover, such as the text field the target sits
     * in: the tooltip goes below it, or above it when there is no room below,
     * still lined up with the target. Without it (or when neither side fits)
     * the tooltip goes below the target, or above it.
     */
    readonly clearOf?: HTMLElement | null;
}

/**
 * Show the root's tooltip near a target element. One tooltip serves the whole
 * root, so showing it on a target releases whatever it described before.
 *
 * @param target - The element the tooltip describes (`aria-describedby`)
 * @param content - The tooltip's text, one line per row
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
    content: string,
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
    copyOverlayTheme(target, tip);

    // Build structured content from the lines
    tip.innerHTML = '';
    const lines = content.split('\n');
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

    const margin = 8;

    // Vertical positioning: prefer below, flip above if needed. A box to keep
    // clear of moves both edges out to that box when the tooltip fits there.
    const fitsBelow = (edge: number) =>
        edge + 6 + tipRect.height <= window.innerHeight - margin;
    const fitsAbove = (edge: number) => edge - 6 - tipRect.height >= margin;
    const clear = placement?.clearOf?.isConnected
        ? placement.clearOf.getBoundingClientRect()
        : null;
    let top = rect.bottom + 6;
    if (clear && fitsBelow(clear.bottom)) {
        top = clear.bottom + 6;
    } else if (clear && fitsAbove(clear.top)) {
        top = clear.top - tipRect.height - 6;
    } else if (!fitsBelow(rect.bottom) && fitsAbove(rect.top)) {
        top = rect.top - tipRect.height - 6;
    }
    // Clamp vertically so tooltip stays on screen
    top = Math.max(
        margin,
        Math.min(top, window.innerHeight - tipRect.height - margin),
    );

    // Horizontal positioning: prefer centered below target, clamp to viewport
    let left = rect.left + rect.width / 2 - tipRect.width / 2;
    left = Math.max(
        margin,
        Math.min(left, window.innerWidth - tipRect.width - margin),
    );

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
    getContent: () => string | undefined,
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
