/** Accessibility utilities for screen reader announcements. */

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
