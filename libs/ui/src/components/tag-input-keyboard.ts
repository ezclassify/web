/**
 * Keyboard event handlers for TagInput.
 *
 * Pure functions that interpret keyboard events on chips and the filter input,
 * then delegate to callbacks for state mutations and DOM updates. TagInput owns
 * all state; these functions receive what they need through context objects.
 */

import type { Assertion } from '@ezclassify/types';
import { derivedAssertion } from '../assertion-identity';

/**
 * Assertion shape keyboard handlers need to tell derived chips from stated
 * ones.
 */
export type KeyboardAssertion = Pick<
    Assertion,
    'conceptId' | 'categoryId' | 'confidence' | 'source' | 'sourceRule'
>;

/** A chip the engine derived: keys skip it, as its missing × does. */
const derived = (a: KeyboardAssertion | undefined): boolean =>
    a !== undefined && derivedAssertion(a);

/** All external state the chip keydown handler needs. */
export interface ChipKeyboardContext {
    tagEls: HTMLSpanElement[];
    filterInput: HTMLInputElement;
    assertions: KeyboardAssertion[];
    focusChip: (index: number) => void;
    unfocusAllChips: () => void;
    removeAssertion: (conceptId: string, categoryId: string) => void;
    closeList: () => void;
    setPendingFocusConceptId: (id: string | null) => void;
}

/**
 * Handle keyboard events on a focused chip (tag) element.
 *
 * Supports arrow navigation between chips, deletion via Backspace/Delete,
 * Escape to unfocus, and printable-character passthrough to the filter input.
 */
export function handleChipKeydown(
    e: KeyboardEvent,
    chip: HTMLSpanElement,
    ctx: ChipKeyboardContext,
): void {
    const idx = ctx.tagEls.indexOf(chip);

    switch (e.key) {
        case 'ArrowLeft':
            e.preventDefault();
            if (idx > 0) ctx.focusChip(idx - 1);
            break;
        case 'ArrowRight':
            e.preventDefault();
            if (idx < ctx.tagEls.length - 1) {
                ctx.focusChip(idx + 1);
            } else {
                ctx.unfocusAllChips();
                ctx.filterInput.focus();
            }
            break;
        case 'ArrowUp':
        case 'ArrowDown':
            e.preventDefault();
            ctx.unfocusAllChips();
            ctx.filterInput.focus();
            break;
        case 'Backspace':
        case 'Delete': {
            e.preventDefault();
            const conceptId = chip.dataset.conceptId;
            const categoryId = chip.dataset.categoryId;
            if (conceptId && categoryId) {
                const assertion = ctx.assertions.find(
                    (a) =>
                        a.conceptId === conceptId &&
                        a.categoryId === categoryId,
                );
                if (derived(assertion)) {
                    let prevIdx = idx - 1;
                    while (prevIdx >= 0) {
                        const prevChip = ctx.tagEls[prevIdx];
                        const prevId = prevChip?.dataset.conceptId;
                        const prevCategory = prevChip?.dataset.categoryId;
                        const prevAssertion = ctx.assertions.find(
                            (a) =>
                                a.conceptId === prevId &&
                                a.categoryId === prevCategory,
                        );
                        if (!derived(prevAssertion)) break;
                        prevIdx--;
                    }
                    if (prevIdx >= 0) ctx.focusChip(prevIdx);
                    break;
                }
                const prevIdx = Math.max(0, idx - 1);
                if (prevIdx < ctx.tagEls.length) {
                    ctx.setPendingFocusConceptId(
                        ctx.tagEls[prevIdx]?.dataset.conceptId ?? null,
                    );
                }
                ctx.removeAssertion(conceptId, categoryId);
            }
            break;
        }
        case 'Escape':
            e.preventDefault();
            ctx.unfocusAllChips();
            ctx.closeList();
            ctx.filterInput.focus();
            break;
        default: {
            // Printable-character passthrough moves focus to the filter input
            // so typing while a chip is active starts a new search. Skip it
            // when the event target is the remove button: that's a focusable
            // descendant of the chip, and Space (key length 1, same as any
            // printable char) activates a <button> on keyup, not keydown.
            // Redirecting focus here during keydown would move focus off the
            // button before that keyup fires, so the button never sees its
            // own activation and Space silently does nothing.
            const target = e.target as HTMLElement | null;
            const targetIsRemoveButton =
                !!target?.classList?.contains('proto-tag-remove');
            if (
                e.key.length === 1 &&
                !e.ctrlKey &&
                !e.metaKey &&
                !targetIsRemoveButton
            ) {
                ctx.unfocusAllChips();
                ctx.filterInput.focus();
            }
            break;
        }
    }
}

/** What the filter's own chip keys need. */
export interface FilterChipKeyContext {
    filterInput: HTMLInputElement;
    tagEls: HTMLSpanElement[];
    assertions: KeyboardAssertion[];
    focusChip: (index: number) => void;
}

/**
 * The filter input's chip keys. Every list key (arrows, Enter, Tab, Escape)
 * belongs to the composer; these two reach the chips from an empty filter: Left
 * focuses the last chip, Backspace focuses the last chip the user chose
 * (skipping derived ones), so a second Backspace removes it.
 */
export function handleFilterChipKeys(
    e: KeyboardEvent,
    ctx: FilterChipKeyContext,
): void {
    if (e.isComposing || e.keyCode === 229) return;
    if (ctx.filterInput.value || ctx.tagEls.length === 0) return;
    if (e.key === 'ArrowLeft') {
        e.preventDefault();
        ctx.focusChip(ctx.tagEls.length - 1);
        return;
    }
    if (e.key === 'Backspace') {
        e.preventDefault();
        let lastUserIdx = ctx.tagEls.length - 1;
        while (lastUserIdx >= 0) {
            const el = ctx.tagEls[lastUserIdx];
            const a = ctx.assertions.find(
                (x) =>
                    x.conceptId === el.dataset.conceptId &&
                    x.categoryId === el.dataset.categoryId,
            );
            if (!derived(a)) break;
            lastUserIdx--;
        }
        if (lastUserIdx >= 0) ctx.focusChip(lastUserIdx);
    }
}
