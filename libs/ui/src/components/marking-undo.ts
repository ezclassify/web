/**
 * One marking's undo (ARCHITECTURE.md "Undo"). A field that changes a marking
 * on the author's behalf, by a clear or by any other edit, offers to put the
 * marking back to what it was before that action. One level only: the offer
 * belongs to the marking, so every field bound to it shows it, and it lasts
 * until the marking next changes, from that field or any other, or until the
 * field that made it is destroyed. There is no timer.
 *
 * The field that acted owns the snapshot, because only it knows everything it
 * cleared (a draft typed into it, say) and how to write it back. This module
 * holds the offer and decides when it ends.
 *
 * When it ends: an action's consequences (the engine's answer, a rule's repair,
 * the store committing it, a step it made irrelevant) all arrive before the
 * author does anything else, and none of them is the next change. So the
 * marking's value is followed until the author next presses a key or a pointer
 * anywhere; from then on, any different value is the next change and ends the
 * offer. Another action ends it too, by making its own offer. A field bound to
 * a store marking hears every value through the runtime, which feeds the
 * store's commits in; a field with no store feeds its own values in.
 */

import type { Assertion } from '@ezclassify/types';
import { assertionFactKey } from '../assertion-identity';

/** What the offer undoes: a clear (the × became undo) or any other edit. */
export type UndoKind = 'clear' | 'edit';

/** The offer as the fields that show it see it. */
export interface UndoOffer {
    readonly kind: UndoKind;
}

interface Entry extends UndoOffer {
    /** The field that made the offer: only it can withdraw it. */
    readonly owner: object;
    /** Writes the marking back to what it was before the action. */
    readonly restore: () => void | Promise<void>;
    /** The value the action left, as far as it has been heard. */
    value?: string;
    /** Whether the author has moved on, so the action has settled. */
    settled: boolean;
}

/** Offers still taking in their action's consequences. */
const settling = new Set<MarkingUndo>();

/**
 * The author pressed something: every action before it has settled. The undo
 * chord is not a next step, it is the undo, and a modifier on its own is not a
 * press of anything.
 */
function authorMovedOn(event: Event): void {
    if (
        event instanceof KeyboardEvent &&
        (isUndoChord(event) ||
            ['Control', 'Meta', 'Shift', 'Alt'].includes(event.key))
    )
        return;
    for (const undo of [...settling]) undo.settle();
}

function watchForAuthor(undo: MarkingUndo): void {
    if (settling.size === 0 && typeof document !== 'undefined') {
        document.addEventListener('keydown', authorMovedOn, true);
        document.addEventListener('pointerdown', authorMovedOn, true);
    }
    settling.add(undo);
}

function stopWatching(undo: MarkingUndo): void {
    if (!settling.delete(undo) || settling.size > 0) return;
    if (typeof document === 'undefined') return;
    document.removeEventListener('keydown', authorMovedOn, true);
    document.removeEventListener('pointerdown', authorMovedOn, true);
}

/** The one-level undo of one marking. */
export class MarkingUndo {
    private entry: Entry | null = null;
    private readonly listeners = new Set<() => void>();

    /** The live offer, or null when there is nothing to undo. */
    get offer(): UndoOffer | null {
        return this.entry;
    }

    /**
     * Offer to undo the action `owner` just made (or is making). Any earlier
     * offer ends: undo is one level.
     *
     * @param kind - A clear, or any other edit
     * @param owner - The field that acted
     * @param restore - Puts the marking back to what it was before the action
     */
    make(
        kind: UndoKind,
        owner: object,
        restore: () => void | Promise<void>,
    ): void {
        this.entry = { kind, owner, restore, settled: false };
        watchForAuthor(this);
        this.emit();
    }

    /**
     * The marking holds the value `signature` names. Until the action has
     * settled this is its result; after, a different value ends the offer.
     */
    observe(signature: string): void {
        const entry = this.entry;
        if (!entry) return;
        if (!entry.settled) entry.value = signature;
        else if (signature !== entry.value) this.end();
    }

    /**
     * The author has moved on: whatever the marking holds now is what the
     * action left. Called on the author's next key or pointer press.
     */
    settle(): void {
        stopWatching(this);
        if (this.entry) this.entry.settled = true;
    }

    /**
     * End the offer. With `owner`, only an offer that field made: a field going
     * away takes its snapshot with it.
     */
    end(owner?: object): void {
        if (!this.entry || (owner && this.entry.owner !== owner)) return;
        this.entry = null;
        stopWatching(this);
        this.emit();
    }

    /**
     * Undo: put the marking back and end the offer. The restore is not an
     * action of its own, so nothing offers to undo the undo.
     *
     * @returns Whether there was anything to undo
     */
    async perform(): Promise<boolean> {
        const entry = this.entry;
        if (!entry) return false;
        this.entry = null;
        stopWatching(this);
        this.emit();
        await entry.restore();
        return true;
    }

    /**
     * Hear whenever the offer starts or ends.
     *
     * @returns Stops listening
     */
    subscribe(listener: () => void): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    private emit(): void {
        for (const listener of [...this.listeners]) listener();
    }
}

/**
 * Whether a key press is the platform's undo chord: Ctrl+Z, or Cmd+Z on a Mac,
 * without Shift (which is redo) or Alt.
 */
export function isUndoChord(event: KeyboardEvent): boolean {
    return (
        (event.ctrlKey || event.metaKey) &&
        !event.shiftKey &&
        !event.altKey &&
        event.key.toLowerCase() === 'z'
    );
}

/**
 * A marking value as one comparable string: its text and its facts, in no
 * particular order. Two values that say the same thing compare equal.
 */
export function valueSignature(
    rendered: string,
    assertions: readonly Pick<
        Assertion,
        'categoryId' | 'conceptId' | 'value'
    >[],
): string {
    return JSON.stringify([
        rendered,
        assertions.map((a) => assertionFactKey(a)).sort(),
    ]);
}
