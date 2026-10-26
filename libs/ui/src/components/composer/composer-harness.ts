/**
 * Test harness for driving the composer the way a user does: type into the
 * field's input, press keys, click rows, blur. Shared by the composer's own
 * specs, the cross-component contract spec and every field spec, so each drives
 * the picker through one vocabulary instead of reaching into its DOM its own
 * way. Excluded from the library build (`*-harness.ts`).
 */

/** Resolve after `ms` milliseconds. */
export function wait(ms = 60): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
}

/** The open composer surface, or null when none is open. */
export function openSurface(): HTMLElement | null {
    return document.body.querySelector<HTMLElement>(
        '.ez-composer:not([hidden])',
    );
}

/** Every composer surface in the document, open or not. */
export function allSurfaces(): HTMLElement[] {
    return [...document.body.querySelectorAll<HTMLElement>('.ez-composer')];
}

/** The navigable option rows of the open surface. */
export function rows(): HTMLElement[] {
    const surface = openSurface();
    if (!surface) return [];
    return [
        ...surface.querySelectorAll<HTMLElement>(
            '.ez-composer__list [role="option"]',
        ),
    ];
}

/** The short-form text of each concept row, in order. */
export function rowLabels(): string[] {
    return rows()
        .filter((r) => r.dataset.kind === 'concept')
        .map((r) => r.querySelector('.ez-composer__short')?.textContent ?? '');
}

/** The concept row with this short form, or undefined. */
export function rowFor(label: string): HTMLElement | undefined {
    return rows().find(
        (r) => r.querySelector('.ez-composer__short')?.textContent === label,
    );
}

/** The active row (the one `aria-activedescendant` names), or null. */
export function activeRow(input: HTMLElement): HTMLElement | null {
    const id = input.getAttribute('aria-activedescendant');
    return id ? document.getElementById(id) : null;
}

/** The result row's value text. */
export function resultValue(): string {
    return (
        openSurface()?.querySelector('.ez-composer__result-value')
            ?.textContent ?? ''
    );
}

/** The result row's state (`ok`, `typing`, `incomplete`, `empty`, ...). */
export function resultState(): string {
    return (
        openSurface()?.querySelector<HTMLElement>('.ez-composer__result')
            ?.dataset.state ?? ''
    );
}

/** Replace the input's text as typing does, caret at the end. */
export function typeText(
    input: HTMLInputElement | HTMLTextAreaElement,
    text: string,
): void {
    input.value = text;
    input.setSelectionRange(text.length, text.length);
    input.dispatchEvent(new Event('input', { bubbles: true }));
}

/** Dispatch a keydown on `input`; returns the event so callers can check it. */
export function press(
    input: HTMLElement,
    key: string,
    init: KeyboardEventInit = {},
): KeyboardEvent {
    const event = new KeyboardEvent('keydown', {
        key,
        bubbles: true,
        cancelable: true,
        ...init,
    });
    input.dispatchEvent(event);
    return event;
}

/**
 * Move focus away from `input` the way leaving a field does: blur it and let
 * the composer's blur delay elapse.
 */
export async function leave(input: HTMLElement, settle = 250): Promise<void> {
    input.blur();
    input.dispatchEvent(new FocusEvent('blur'));
    await wait(settle);
}
