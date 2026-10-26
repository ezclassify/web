/**
 * Enhancement status mark (ARCHITECTURE.md "Enhancement Status Indicator").
 *
 * Every enhanced input and textarea carries exactly one EzClassify status mark:
 * the 3-bar-plus-sparkle brand glyph. It cycles through three states as fixes
 * arrive and get noticed:
 *
 * - **quiet**: no applied fixes. The whole glyph sits muted.
 * - **unseen**: EzClassify applied a fix the user has not yet been shown. The
 *   sparkle turns accent-colored, a small corner dot appears, and the sparkle
 *   pulses on an interval to draw the eye without demanding it.
 * - **seen**: the fix tooltip has actually presented (hover-intent delay elapsed,
 *   keyboard focus, or a press). The dot clears and the pulse stops; the accent
 *   sparkle persists as "done and known."
 * - **error**: the field could not check all of its text (see
 *   {@link setStatusMarkError}). The sparkle turns the error color and the
 *   popover leads with the reason. It overrides the fix states until the field
 *   clears it, and needs no acknowledgment: it lasts as long as its cause.
 *
 * A fresh fix the user hasn't been shown re-arms unseen even if earlier fixes
 * on the same field were already seen (whole-mark, not per-fix, but a field
 * with any un-shown fix reads as unseen). Clearing the fix set returns to quiet
 * and forgets what was seen, so the next fix starts unseen again. State lives
 * in-memory per mark element; there is no persistence across mounts.
 *
 * A proposed fix never changes the mark; only fixes EzClassify actually applied
 * do. Hovering (past the tooltip's hover-intent delay) or focusing an active
 * mark previews every change the engine made, each change once, in the engine's
 * own words for it (the change's `message`). Pressing it (a tap, a click, Enter
 * or Space) opens that list until a second press, Escape, or a press or focus
 * outside the field closes it; a phone has no hover, so the press is its only
 * way in. The indicator communicates state; it is not a per-fix activity feed.
 *
 * The module owns the single-mark invariant: `ensureStatusMark` is idempotent
 * per wrap element and `setStatusMarkFixes` mutates the existing mark in place,
 * so re-renders can never stack indicators.
 */

import type { AssertionRef, Change } from '@ezclassify/types';
import { attachTooltip, hideTooltip, showTooltip } from './tooltip-manager';
import { adoptStylesOnce } from '../styles/adopt';
import statusMarkCss from './status-mark.css?inline';

/**
 * A change's identity: its rule, what it did and to what, and what it says. One
 * rule that removes three concepts made three changes; reading the same text
 * again makes the same ones.
 */
function fixKey(fix: Change): string {
    const refs = (list: readonly AssertionRef[] | undefined) =>
        (list ?? []).map((ref) => `${ref.categoryId}:${ref.conceptId}`);
    return JSON.stringify([
        fix.ruleId,
        fix.action,
        refs(fix.add),
        refs(fix.remove),
        fix.message,
    ]);
}

/**
 * Add the fixes the engine applied to a field's record of them, each change
 * once: a later reading that makes the same change again does not repeat it.
 * Only applied fixes go here, never proposals; the record is what the field's
 * status mark explains (see {@link setStatusMarkFixes}).
 *
 * @param record - The field's applied fixes, keyed by change
 * @param fixes - `ProcessResult.appliedFixes` from a read of the field
 */
export function recordAppliedFixes(
    record: Map<string, Change>,
    fixes: readonly Change[] | undefined,
): void {
    for (const fix of fixes ?? []) {
        const key = fixKey(fix);
        if (!record.has(key)) record.set(key, fix);
    }
}

/** Options for mounting a status mark on a field wrap. */
export interface StatusMarkOptions {
    /**
     * Field shape: 'input' self-positions at the right edge of the first line
     * for the bare input host in `ezclassify-ui.ts`'s plain-field path.
     * 'chrome' places the mark inline in a caller-owned flex container.
     * MarkingField, TagInput, MarkedInput, and MarkedTextArea use 'chrome'.
     */
    shape: 'input' | 'chrome';
    /** Root element for style injection and tooltip mounting. */
    root?: HTMLElement;
    /** Tooltip guard (the data-ezclassify-no-tooltips opt-out). */
    shouldShowTooltip?: () => boolean;
}

/**
 * The mark's visual states, derived from the field's error, its fixes and what
 * has been shown.
 */
type MarkState = 'quiet' | 'unseen' | 'seen' | 'error';

/** The error each mark reports, when its field has one (see setStatusMarkError). */
const markErrors = new WeakMap<HTMLElement, string>();

/** Deduplicated applied fixes per mark element, keyed by change. */
const markFixes = new WeakMap<HTMLElement, Map<string, Change>>();

/**
 * The fixes that have actually been shown to the user (tooltip presented, not
 * just hovered-through), as rule id to the message that was shown. A rule id
 * alone does not identify a fix: the same rule reading a different value says
 * something new, and that must not count as seen.
 */
const markAcknowledged = new WeakMap<HTMLElement, Map<string, string>>();

/**
 * The fixes, rule id to message, that were actually behind the tooltip content
 * the last time it was built. The tooltip's own hover-intent delay means
 * content built at mouseenter can predate a mid-dwell reprocess; acknowledging
 * must credit only what this snapshot says was shown, never the live fix set,
 * or a fix that arrived after the hover started and was never rendered gets
 * marked seen anyway.
 */
const markContentSnapshot = new WeakMap<
    HTMLElement,
    ReadonlyMap<string, string>
>();

const ENHANCED_LABEL = 'Enhanced by EzClassify';

/** Adopt the mark stylesheet once per root (see adoptStylesOnce). */
function injectStyles(root: HTMLElement | undefined): void {
    adoptStylesOnce(statusMarkCss, root);
}

/**
 * Build the mark's SVG: the 3-bar-plus-sparkle brand glyph. The sparkle path
 * carries its own class so CSS can drive its color and pulse animation
 * independently of the bars, which stay muted in every state.
 */
function buildMarkSvg(): string {
    return (
        '<svg viewBox="-4 -4 72 72" aria-hidden="true" focusable="false">' +
        '<path d="M20 14 H14 V50 H20" stroke="currentColor" stroke-width="6" fill="none" stroke-linecap="square" stroke-linejoin="miter"/>' +
        '<path d="M44 14 H50 V50 H44" stroke="currentColor" stroke-width="6" fill="none" stroke-linecap="square" stroke-linejoin="miter"/>' +
        '<rect x="23" y="22" width="18" height="4" fill="currentColor"/>' +
        '<rect x="23" y="30" width="18" height="4" fill="currentColor"/>' +
        '<rect x="23" y="38" width="18" height="4" fill="currentColor"/>' +
        '<g transform="translate(59 7)"><path class="ez-status-mark__sparkle" d="M0 -9 L1.8 -1.8 L9 0 L1.8 1.8 L0 9 L-1.8 1.8 L-9 0 L-1.8 -1.8 Z" fill="currentColor"/></g>' +
        '</svg>'
    );
}

/**
 * Whether the user has expressed a system-level preference for reduced motion.
 * Read fresh on every unseen transition rather than watched live, matching how
 * the rest of the library treats media-query preferences (compare the
 * coarse-pointer check in tag-input.ts). A mid-session OS change does not need
 * to interrupt an already-scheduled pulse.
 */
function prefersReducedMotion(): boolean {
    return (
        typeof window !== 'undefined' &&
        typeof window.matchMedia === 'function' &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches
    );
}

/** Each fix's message, keyed by its rule id. */
function messagesOf(fixes: ReadonlyMap<string, Change>): Map<string, string> {
    return new Map([...fixes].map(([id, fix]) => [id, fix.message]));
}

/** Derive the mark's current state from its fixes and acknowledgment set. */
function deriveState(mark: HTMLElement): MarkState {
    if (markErrors.has(mark)) return 'error';
    const fixes = markFixes.get(mark);
    if (!fixes || fixes.size === 0) return 'quiet';
    const acknowledged = markAcknowledged.get(mark);
    const allSeen =
        !!acknowledged &&
        [...fixes].every(([id, fix]) => acknowledged.get(id) === fix.message);
    return allSeen ? 'seen' : 'unseen';
}

/** Apply the visual/a11y consequences of a state to the mark element. */
function applyVisualState(mark: HTMLElement, state: MarkState): void {
    // `--quiet` has no CSS rule of its own today (quiet is just the base
    // `.ez-status-mark` look, opacity 0.75 and a muted color); it's kept as
    // an explicit state marker on the element so a consumer overriding this
    // stylesheet, or a test, has something to select without inferring
    // "quiet" from the absence of the other two classes.
    mark.classList.toggle('ez-status-mark--quiet', state === 'quiet');
    mark.classList.toggle('ez-status-mark--unseen', state === 'unseen');
    mark.classList.toggle('ez-status-mark--seen', state === 'seen');
    mark.classList.toggle('ez-status-mark--error', state === 'error');
    // The pulse is a courtesy nudge, not the state carrier: the corner dot
    // alone must communicate "unseen fix" when motion is reduced.
    mark.classList.toggle(
        'ez-status-mark--pulse',
        state === 'unseen' && !prefersReducedMotion(),
    );

    const active = state !== 'quiet';
    // Quiet is decorative; an active mark carries an explanation, so it
    // becomes keyboard-reachable (focus previews the list) and reads as the
    // button that discloses it. A disclosure button's expanded state is what
    // its press controls, so a hover or focus preview leaves it collapsed and
    // the first Enter reads as expanding it.
    mark.tabIndex = active ? 0 : -1;
    if (active) {
        mark.setAttribute('aria-expanded', String(markPinned.has(mark)));
    } else {
        mark.removeAttribute('aria-expanded');
        mark.removeAttribute('aria-controls');
    }

    const fixes = markFixes.get(mark);
    const count = fixes?.size ?? 0;
    // The dot and the pulse are aria-hidden, so the label is the only
    // accessible carrier of unseen vs. seen; fold the review state into it
    // rather than leaving both states with identical text.
    const reviewStatus =
        state === 'unseen'
            ? ', not yet reviewed'
            : state === 'seen'
              ? ', reviewed'
              : '';
    const fixed =
        count > 0
            ? ` ${count} fix${
                  count === 1 ? '' : 'es'
              } applied to this marking${reviewStatus}.`
            : '';
    const error = markErrors.get(mark);
    mark.setAttribute(
        'aria-label',
        error !== undefined
            ? `${ENHANCED_LABEL}. ${error}${fixed}`
            : active
              ? `${ENHANCED_LABEL}.${fixed}`
              : ENHANCED_LABEL,
    );
}

/** The tooltip root each mark shows its applied-changes popover in. */
const markRoot = new WeakMap<HTMLElement, HTMLElement | undefined>();
/** Marks whose popover the user pressed open, as opposed to hovered. */
const markPinned = new WeakSet<HTMLElement>();
/** Removes the listeners that dismiss a mark's open popover. */
const markDismissers = new WeakMap<HTMLElement, () => void>();

/** The field a mark belongs to: the library wrapper around it. */
function fieldOf(mark: HTMLElement): HTMLElement {
    return (
        mark.closest<HTMLElement>(
            '.marking-field-wrap, .marked-input-wrap, .marked-textarea-wrap, .tag-input-wrap',
        ) ??
        mark.parentElement ??
        mark
    );
}

/**
 * Close the mark's applied-changes popover if it is the one showing. The
 * popover describes the field's value when it opened; once that value changes
 * or the user moves on it is stale, and on a touch screen nothing else ever
 * closes it.
 */
export function dismissStatusMarkPopover(mark: HTMLElement): void {
    collapse(mark);
    const tipId = mark.getAttribute('aria-describedby');
    if (!tipId) return;
    const tip = document.getElementById(tipId);
    if (tip?.classList.contains('ez-tooltip')) hideTooltip(markRoot.get(mark));
}

/**
 * The list the mark's press opened is no longer open: the tooltip hid (a second
 * press, Escape, a blur, a scroll) or another target took it. The mark is no
 * longer pinned, so a later hover preview closes on leave, and it reads
 * collapsed.
 */
function collapse(mark: HTMLElement): void {
    markPinned.delete(mark);
    markDismissers.get(mark)?.();
    markDismissers.delete(mark);
    if (mark.hasAttribute('aria-expanded')) {
        mark.setAttribute('aria-expanded', 'false');
    }
    mark.removeAttribute('aria-controls');
}

/** The mark's press opened its list: it reads expanded and names the list. */
function expand(mark: HTMLElement): void {
    markPinned.add(mark);
    mark.setAttribute('aria-expanded', 'true');
    const tipId = mark.getAttribute('aria-describedby');
    if (tipId) mark.setAttribute('aria-controls', tipId);
}

/** Whether `mark`'s applied-changes popover is the one showing. */
function popoverOpen(mark: HTMLElement): boolean {
    const tipId = mark.getAttribute('aria-describedby');
    const tip = tipId ? document.getElementById(tipId) : null;
    return !!tip && !tip.hidden && tip.classList.contains('ez-tooltip');
}

/**
 * The popover just opened on `mark`: keep it off the field's error list (it
 * moves above the mark, or closes when there is no room), and close it when
 * focus or a press goes anywhere outside the field.
 */
function guardPopover(mark: HTMLElement): void {
    const tipId = mark.getAttribute('aria-describedby');
    const tip = tipId ? document.getElementById(tipId) : null;
    if (!tip) return;
    const field = fieldOf(mark);
    const errors = [
        ...(field.parentElement?.querySelectorAll<HTMLElement>(
            '.ez-validation-errors',
        ) ?? []),
    ].filter(
        (list) =>
            !list.hidden &&
            (field.contains(list) || list.previousElementSibling === field),
    );
    for (const list of errors) {
        const a = tip.getBoundingClientRect();
        const b = list.getBoundingClientRect();
        const overlaps =
            a.left < b.right &&
            b.left < a.right &&
            a.top < b.bottom &&
            b.top < a.bottom;
        if (!overlaps) continue;
        const above = mark.getBoundingClientRect().top - a.height - 6;
        if (above >= 8) {
            tip.style.top = `${above}px`;
        } else {
            dismissStatusMarkPopover(mark);
            return;
        }
    }
    markDismissers.get(mark)?.();
    const outside = (event: Event) => {
        const target = event.target as Node | null;
        if (target && (field.contains(target) || tip.contains(target))) return;
        dismissStatusMarkPopover(mark);
    };
    const doc = mark.ownerDocument;
    doc.addEventListener('focusin', outside, true);
    doc.addEventListener('pointerdown', outside, true);
    markDismissers.set(mark, () => {
        doc.removeEventListener('focusin', outside, true);
        doc.removeEventListener('pointerdown', outside, true);
    });
}

/**
 * Record that the fixes captured in the mark's content snapshot have been shown
 * to the user (the tooltip actually presented past its hover-intent delay, or
 * focus). Deliberately acknowledges the snapshot, not the live fix set: a
 * reprocess mid-dwell can add a fix after the tooltip content was already
 * built, and that fix was never rendered, so it must stay unseen regardless of
 * what's in `markFixes` by the time this fires. Marking acknowledgment only
 * means something while fixes exist; a quiet mark has nothing to acknowledge.
 */
function acknowledgeMark(mark: HTMLElement): void {
    const fixes = markFixes.get(mark);
    if (!fixes || fixes.size === 0) return;
    const shown = markContentSnapshot.get(mark);
    let acknowledged = markAcknowledged.get(mark);
    if (!acknowledged) {
        acknowledged = new Map();
        markAcknowledged.set(mark, acknowledged);
    }
    const toAcknowledge = shown ?? messagesOf(fixes);
    for (const [key, message] of toAcknowledge) {
        if (fixes.get(key)?.message === message) {
            acknowledged.set(key, message);
        }
    }
    applyVisualState(mark, deriveState(mark));
}

/**
 * Mount the field's single status mark inside `wrap` (a positioned wrapper
 * element), or return the one already there. Idempotent: calling it after a
 * render pass that wiped the wrap recreates the mark; calling it when the mark
 * exists returns it unchanged, so a field can never accumulate a stack of
 * indicators.
 *
 * @param wrap - Positioned wrapper the mark anchors to (one mark per wrap)
 * @param opts - Shape, style/tooltip root, and tooltip guard
 * @returns The mark element
 */
export function ensureStatusMark(
    wrap: HTMLElement,
    opts: StatusMarkOptions,
): HTMLElement {
    const existing = wrap.querySelector<HTMLElement>(
        ':scope > .ez-status-mark',
    );
    if (existing) return existing;

    injectStyles(opts.root);

    const mark = document.createElement('button');
    mark.type = 'button';
    mark.className = `ez-status-mark ez-status-mark--${opts.shape} ez-status-mark--quiet`;
    mark.tabIndex = -1;
    mark.setAttribute('aria-label', ENHANCED_LABEL);
    mark.innerHTML = buildMarkSvg();
    const dot = document.createElement('span');
    dot.className = 'ez-status-mark__dot';
    dot.setAttribute('aria-hidden', 'true');
    mark.appendChild(dot);
    markFixes.set(mark, new Map());
    markAcknowledged.set(mark, new Map());

    const content = (): string | undefined => {
        const error = markErrors.get(mark);
        const fixes = markFixes.get(mark);
        // The opt-out hides the fix explanation, never the error.
        if (!fixes || fixes.size === 0 || !explainsFixes()) return error;
        // Snapshot exactly which fixes are behind this content build so
        // acknowledgeMark can credit only what actually got shown, not
        // whatever the fix set grows to before the tooltip fires.
        markContentSnapshot.set(mark, messagesOf(fixes));
        const lines = [...fixes.values()].map((f) => '• ' + f.message);
        return [
            ...(error !== undefined ? [error, ''] : []),
            'EzClassify fixed this marking:',
            ...lines,
        ].join('\n');
    };
    const explainsFixes = () => opts.shouldShowTooltip?.() ?? true;
    // The error is not an optional helper: the tooltip opt-out hides the fix
    // explanation, never the reason the field is invalid.
    const mayShow = () =>
        markErrors.has(mark) ||
        (explainsFixes() && (markFixes.get(mark)?.size ?? 0) > 0);
    const shown = () => {
        acknowledgeMark(mark);
        guardPopover(mark);
    };

    // A press must not move focus onto the mark. Focus inside the field
    // turns its chrome into the attached drawer, which moves the mark out
    // from under the finger or pointer before the press ends, so the click
    // would land on the field instead. The keyboard still reaches the mark
    // with Tab.
    mark.addEventListener('mousedown', (e) => e.preventDefault());
    // A press (tap, click, Enter, Space) opens the list, or closes the one
    // it opened. It must not submit a form or reach the field's own click
    // handling (focus-the-filter, open the editor).
    mark.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (markPinned.has(mark) && popoverOpen(mark)) {
            dismissStatusMarkPopover(mark);
            return;
        }
        const text = mayShow() ? content() : undefined;
        if (!text) return;
        showTooltip(mark, text, opts.root, undefined, () => collapse(mark));
        expand(mark);
        shown();
    });
    mark.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape' || !popoverOpen(mark)) return;
        // Closing the list is all Escape does here: the field must not also
        // take it as a cancel.
        e.preventDefault();
        e.stopPropagation();
        dismissStatusMarkPopover(mark);
    });

    attachTooltip(
        mark,
        content,
        opts.root,
        mayShow,
        // Acknowledgment happens when the tooltip actually presents, not on a
        // pointer merely passing through; attachTooltip's own hover-intent
        // delay already filters that out before this fires.
        shown,
        undefined,
        undefined,
        () => markPinned.has(mark) && popoverOpen(mark),
    );
    markRoot.set(mark, opts.root);

    wrap.appendChild(mark);
    return mark;
}

/**
 * Update the wrap's status mark to reflect the fixes EzClassify has applied to
 * the field's current value. An empty list returns the mark to quiet and
 * forgets what was previously shown, so a later fix starts unseen again. A
 * non-empty list that includes any fix not yet shown to the user (re)arms
 * unseen; if every current fix has already been shown, the mark reads seen.
 * Each change appears once, however many readings made it. Only fixes the
 * engine actually APPLIED belong here; proposed fixes must never be passed.
 *
 * @param wrap - The wrapper the mark was mounted on via {@link ensureStatusMark}
 * @param fixes - Applied fixes behind the field's current value
 */
export function setStatusMarkFixes(
    wrap: HTMLElement,
    fixes: readonly Change[],
): void {
    const mark = wrap.querySelector<HTMLElement>(':scope > .ez-status-mark');
    if (!mark) return;
    // The field's value was just rendered again: a popover about the value
    // it had is out of date.
    dismissStatusMarkPopover(mark);

    const deduped = new Map<string, Change>();
    recordAppliedFixes(deduped, fixes);
    markFixes.set(mark, deduped);
    // Prune acknowledgment for any change that is no longer shown, not only
    // when the set goes fully empty, so a change that drops out and comes
    // back later is unseen again. This also covers the clean-reprocess case
    // (every change drops out, so acknowledged empties).
    const acknowledged = markAcknowledged.get(mark);
    if (acknowledged) {
        for (const [key, message] of acknowledged) {
            if (deduped.get(key)?.message !== message) {
                acknowledged.delete(key);
            }
        }
    }

    applyVisualState(mark, deriveState(mark));
}

/**
 * Set or clear the error the wrap's status mark reports. While one is set the
 * mark reads as an error, whatever fixes it also explains, and its popover and
 * accessible label lead with the message. Clearing it returns the mark to the
 * state its fixes give it.
 *
 * Use it for a fact about the whole field that no marking chip can carry, such
 * as text the field could not check. A rule error belongs to the marking it
 * breaks, never here.
 *
 * @param wrap - The wrapper the mark was mounted on via {@link ensureStatusMark}
 * @param message - What is wrong, or `null` to clear it
 */
export function setStatusMarkError(
    wrap: HTMLElement,
    message: string | null,
): void {
    const mark = wrap.querySelector<HTMLElement>(':scope > .ez-status-mark');
    if (!mark) return;
    if ((markErrors.get(mark) ?? null) === message) return;
    // The popover describes the error it opened with.
    dismissStatusMarkPopover(mark);
    if (message === null) markErrors.delete(mark);
    else markErrors.set(mark, message);
    applyVisualState(mark, deriveState(mark));
}
