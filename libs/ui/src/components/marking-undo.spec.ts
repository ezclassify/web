/**
 * A marking's one-level undo: what it offers, and when the offer ends. An
 * action's own consequences are not the next change; the first change after the
 * author presses anything again is.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isUndoChord, MarkingUndo, valueSignature } from './marking-undo';

const field = {};
const other = {};
let undo: MarkingUndo;

afterEach(() => {
    // An offer left open keeps a document listener; end it.
    undo?.end();
});

const press = (key: string, init: KeyboardEventInit = {}) =>
    document.dispatchEvent(new KeyboardEvent('keydown', { key, ...init }));

describe('a marking undo', () => {
    it('offers nothing until an action makes an offer', () => {
        undo = new MarkingUndo();
        expect(undo.offer).toBeNull();
    });

    it("hears its action's consequences as its result, and ends at the next change once the author moves on", () => {
        undo = new MarkingUndo();
        const listener = vi.fn();
        undo.subscribe(listener);
        undo.make('clear', field, () => {});
        expect(undo.offer?.kind).toBe('clear');
        expect(listener).toHaveBeenCalledTimes(1);

        // The engine's answer, then the store committing it: one action.
        undo.observe('empty');
        undo.observe('empty with defaults');
        expect(undo.offer).not.toBeNull();

        // The author moves on; the value the action left is unchanged.
        press('Tab');
        undo.observe('empty with defaults');
        expect(undo.offer).not.toBeNull();

        // The marking changes: the offer is over.
        undo.observe('SECRET');
        expect(undo.offer).toBeNull();
        expect(listener).toHaveBeenCalledTimes(2);
    });

    it('is not ended by a modifier key or by the undo chord itself', () => {
        undo = new MarkingUndo();
        undo.make('edit', field, () => {});
        undo.observe('after');
        press('Control', { ctrlKey: true });
        press('z', { ctrlKey: true });
        undo.observe('still settling');
        expect(undo.offer).not.toBeNull();
        document.dispatchEvent(new Event('pointerdown'));
        undo.observe('changed');
        expect(undo.offer).toBeNull();
    });

    it('is replaced by the next action: one level only', async () => {
        undo = new MarkingUndo();
        const first = vi.fn();
        const second = vi.fn();
        undo.make('clear', field, first);
        undo.make('edit', other, second);
        expect(undo.offer?.kind).toBe('edit');
        await undo.perform();
        expect(first).not.toHaveBeenCalled();
        expect(second).toHaveBeenCalledTimes(1);
    });

    it('puts the marking back once, and offers nothing for the undo itself', async () => {
        undo = new MarkingUndo();
        const restore = vi.fn();
        undo.make('clear', field, restore);
        expect(await undo.perform()).toBe(true);
        expect(restore).toHaveBeenCalledTimes(1);
        expect(undo.offer).toBeNull();
        expect(await undo.perform()).toBe(false);
        expect(restore).toHaveBeenCalledTimes(1);
    });

    it('goes with the field that made it, and only that field', () => {
        undo = new MarkingUndo();
        undo.make('clear', field, () => {});
        undo.end(other);
        expect(undo.offer).not.toBeNull();
        undo.end(field);
        expect(undo.offer).toBeNull();
    });
});

describe('the undo chord', () => {
    it('is Ctrl+Z or Cmd+Z, never with Shift or Alt', () => {
        const chord = (init: KeyboardEventInit) =>
            isUndoChord(new KeyboardEvent('keydown', init));
        expect(chord({ key: 'z', ctrlKey: true })).toBe(true);
        expect(chord({ key: 'z', metaKey: true })).toBe(true);
        expect(chord({ key: 'Z', ctrlKey: true })).toBe(true);
        expect(chord({ key: 'z', ctrlKey: true, shiftKey: true })).toBe(false);
        expect(chord({ key: 'z', ctrlKey: true, altKey: true })).toBe(false);
        expect(chord({ key: 'z' })).toBe(false);
        expect(chord({ key: 'y', ctrlKey: true })).toBe(false);
    });
});

describe('a marking value signature', () => {
    it('is the same for the same text and facts in any order', () => {
        const a = { conceptId: 'A', categoryId: 'c' } as const;
        const b = { conceptId: 'B', categoryId: 'c' } as const;
        expect(valueSignature('A/B', [a, b])).toBe(
            valueSignature('A/B', [b, a]),
        );
        expect(valueSignature('A/B', [a, b])).not.toBe(
            valueSignature('A/B', [a]),
        );
        expect(valueSignature('A', [a])).not.toBe(valueSignature('', [a]));
    });
});
