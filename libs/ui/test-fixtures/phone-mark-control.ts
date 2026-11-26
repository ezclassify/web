/**
 * Drives the phone layout's control for an existing marking, the painted mark,
 * the way a keyboard or screen reader user does. Shared by the MarkedInput and
 * MarkedTextArea specs, which mount their own field on the phone layout (a
 * coarse pointer under the sheet breakpoint) and hand over how to find its
 * marks.
 */
import { expect } from 'vitest';

/** Resolve after one animation frame and the work queued behind it. */
export async function nextFrame(): Promise<void> {
    await new Promise((resolve) => requestAnimationFrame(resolve));
    await new Promise((resolve) => setTimeout(resolve, 0));
}

/** Press a key on an element the way a browser delivers it. */
export function pressKey(element: Element, key: string): KeyboardEvent {
    const event = new KeyboardEvent('keydown', {
        key,
        bubbles: true,
        cancelable: true,
    });
    element.dispatchEvent(event);
    return event;
}

/** The actions a mark opened, in order, or none when they are closed. */
export function markActions(): HTMLButtonElement[] {
    return [
        ...document.querySelectorAll<HTMLButtonElement>(
            '.ez-marking-touch-actions button',
        ),
    ];
}

/** The open phone sheet's input, if a sheet is open. */
export function sheetInput(): HTMLInputElement | null {
    return document.querySelector<HTMLInputElement>(
        '.ez-composer[data-surface="sheet"]:not([hidden]) .ez-composer__sheet-input',
    );
}

/** A button of the open phone sheet. */
export function sheetButton(name: 'done' | 'cancel'): HTMLButtonElement {
    return document.querySelector<HTMLButtonElement>(
        `.ez-composer[data-surface="sheet"]:not([hidden]) .ez-composer__sheet-${name}`,
    )!;
}

/** Open a mark's actions with a key and return them. */
export function openMarkActions(
    mark: HTMLElement,
    key: 'Enter' | ' ',
): HTMLButtonElement[] {
    mark.focus();
    expect(pressKey(mark, key).defaultPrevented).toBe(true);
    return markActions();
}

/** Open the sheet on a mark through its Edit action. */
export async function editMark(mark: HTMLElement): Promise<HTMLInputElement> {
    const [edit] = openMarkActions(mark, 'Enter');
    edit!.click();
    await expect.poll(() => sheetInput()).not.toBeNull();
    return sheetInput()!;
}
