import { afterEach, describe, expect, it, vi } from 'vitest';
import { bindTextToolsEdges, focusTextCaretNeighbor } from './text-caret-edge';

const press = (
    input: HTMLElement,
    key: string,
    modifiers: KeyboardEventInit = {},
) => {
    const event = new KeyboardEvent('keydown', {
        key,
        bubbles: true,
        cancelable: true,
        ...modifiers,
    });
    input.dispatchEvent(event);
    return event;
};
afterEach(() => document.body.replaceChildren());

describe('native caret edges', () => {
    it('hands only collapsed native boundaries to available adjacent controls', () => {
        const input = document.createElement('input');
        input.value = 'draft';
        const before = document.createElement('button');
        const after = document.createElement('button');
        document.body.append(before, input, after);
        input.addEventListener('keydown', (event) =>
            focusTextCaretNeighbor(event, (edge) =>
                edge === 'left' ? before : after,
            ),
        );
        input.focus();
        input.setSelectionRange(0, 0);
        expect(press(input, 'ArrowLeft').defaultPrevented).toBe(true);
        expect(document.activeElement).toBe(before);
        input.focus();
        input.setSelectionRange(5, 5);
        const focus = vi.spyOn(after, 'focus');
        expect(press(input, 'ArrowRight').defaultPrevented).toBe(true);
        expect(focus).toHaveBeenCalledWith({ preventScroll: true });
        expect(document.activeElement).toBe(after);
        expect(input.value).toBe('draft');
    });
    it('leaves text selection, normal caret keys, modifiers and native date fields alone', () => {
        const input = document.createElement('input');
        input.value = 'draft';
        const neighbor = document.createElement('button');
        document.body.append(input, neighbor);
        input.addEventListener('keydown', (event) =>
            focusTextCaretNeighbor(event, () => neighbor),
        );
        input.focus();
        for (const range of [
            [0, 2],
            [2, 2],
            [3, 5],
        ]) {
            input.setSelectionRange(range[0], range[1]);
            expect(press(input, 'ArrowRight').defaultPrevented).toBe(false);
            expect(press(input, 'ArrowLeft').defaultPrevented).toBe(false);
        }
        input.setSelectionRange(5, 5);
        for (const modifier of [
            { altKey: true },
            { ctrlKey: true },
            { metaKey: true },
            { shiftKey: true },
            { isComposing: true },
            { keyCode: 229 },
        ])
            expect(press(input, 'ArrowRight', modifier).defaultPrevented).toBe(
                false,
            );
        input.type = 'date';
        input.value = '2040-01-01';
        expect(press(input, 'ArrowRight').defaultPrevented).toBe(false);
        expect(document.activeElement).toBe(input);
    });
    it('limits only trailing text exit when the editor has following body text', () => {
        const root = document.createElement('div');
        const input = document.createElement('input');
        input.value = 'held draft';
        const tools = document.createElement('button');
        const previous = document.createElement('button');
        root.append(previous, input, tools);
        document.body.append(root);
        const stop = bindTextToolsEdges(
            root,
            () => input,
            () => tools,
            () => false,
            () => previous,
        );
        input.focus();
        input.setSelectionRange(input.value.length, input.value.length);
        expect(press(input, 'ArrowRight').defaultPrevented).toBe(false);
        expect(document.activeElement).toBe(input);
        tools.focus();
        expect(press(tools, 'ArrowLeft').defaultPrevented).toBe(true);
        expect(document.activeElement).toBe(input);
        expect(input.selectionStart).toBe(input.value.length);
        input.setSelectionRange(0, 0);
        expect(press(input, 'ArrowLeft').defaultPrevented).toBe(true);
        expect(document.activeElement).toBe(previous);
        expect(input.value).toBe('held draft');
        stop();
    });

    it('pairs text end with tools, preserves the draft and removes capture on teardown', () => {
        const root = document.createElement('div');
        const input = document.createElement('textarea');
        const tools = document.createElement('button');
        input.value = 'uncommitted';
        root.append(input, tools);
        document.body.append(root);
        const stop = bindTextToolsEdges(
            root,
            () => input,
            () => tools,
        );
        const clicked = vi.fn();
        tools.addEventListener('click', clicked);
        input.focus();
        input.setSelectionRange(input.value.length, input.value.length);
        expect(press(input, 'ArrowRight').defaultPrevented).toBe(true);
        expect(document.activeElement).toBe(tools);
        expect(press(tools, 'ArrowLeft').defaultPrevented).toBe(true);
        expect(document.activeElement).toBe(input);
        expect(input.selectionStart).toBe(input.value.length);
        expect(input.value).toBe('uncommitted');
        expect(clicked).not.toHaveBeenCalled();
        input.setSelectionRange(0, 0);
        expect(press(input, 'ArrowLeft').defaultPrevented).toBe(false);
        stop();
        input.setSelectionRange(input.value.length, input.value.length);
        expect(press(input, 'ArrowRight').defaultPrevented).toBe(false);
    });
});
