/**
 * Accessibility utilities for screen reader announcements and keyboard
 * navigation hints.
 */

/** Create an ARIA live region for screen reader announcements */
export function createAnnouncer(): HTMLDivElement {
    const el = document.createElement('div');
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    el.setAttribute('aria-atomic', 'true');
    el.className = 'ez-sr-only';
    return el;
}

/** Announce text to screen readers */
export function announce(announcer: HTMLElement, text: string): void {
    announcer.textContent = '';
    requestAnimationFrame(() => {
        announcer.textContent = text;
    });
}

/** Create a keyboard hints bar */
export function createKeyboardHints(
    hints: Array<{ keys: string; action: string }>,
): HTMLDivElement {
    const bar = document.createElement('div');
    bar.className = 'proto-kbd-hints';
    bar.setAttribute('aria-label', 'Keyboard shortcuts');
    for (const h of hints) {
        const hint = document.createElement('span');
        hint.className = 'proto-kbd-hint';
        // Split on + (combo) and / (or): render each key as a <kbd>
        const tokens = h.keys.split(/([+/])/);
        for (const token of tokens) {
            if (token === '+' || token === '/') {
                hint.appendChild(
                    document.createTextNode(token === '/' ? ' or ' : '+'),
                );
            } else if (token) {
                const kbd = document.createElement('kbd');
                kbd.textContent = token;
                hint.appendChild(kbd);
            }
        }
        hint.appendChild(document.createTextNode(' ' + h.action));
        bar.appendChild(hint);
    }
    return bar;
}
