import { t } from '../i18n';
import { createAnnouncer, announce } from './accessibility-helpers';

/** Shared clear control. The owning field supplies the ordinary write path. */

export interface ClearButton {
    button: HTMLButtonElement;
    update(): void;
    destroy(): void;
}

/** Create a stable form action; clearing and draft disposal belong to the field. */
export function createClearButton(options: {
    label: string;
    host?: HTMLInputElement | HTMLTextAreaElement;
    empty: () => boolean;
    clear: () => void | Promise<void>;
}): ClearButton {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'ez-clear-button';
    button.setAttribute('aria-label', options.label);
    button.title = options.label;
    button.innerHTML =
        '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg>';
    const status = createAnnouncer();
    button.appendChild(status);
    const update = () => {
        button.disabled = !!options.host?.matches(':disabled, [readonly]');
        button.setAttribute(
            'aria-disabled',
            String(button.disabled || options.empty()),
        );
    };
    button.addEventListener('pointerdown', (event) => {
        // Keep a pointer press from blurring and committing the draft we are clearing.
        if (!button.disabled) event.preventDefault();
        event.stopPropagation();
    });
    button.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        update();
        if (button.disabled || options.empty()) return;
        const cleared = options.clear();
        if (event.detail === 0) {
            button.focus({ preventScroll: true });
        } else if (document.activeElement instanceof HTMLElement) {
            document.activeElement.blur();
        }
        void Promise.resolve(cleared).then(() => {
            update();
            announce(status, t('a11y.composer.cleared'));
        });
    });
    const observer = options.host ? new MutationObserver(update) : null;
    observer?.observe(options.host!, {
        attributes: true,
        attributeFilter: ['disabled', 'readonly'],
    });
    const input = () => queueMicrotask(update);
    options.host?.addEventListener('input', input);
    update();
    return {
        button,
        update,
        destroy() {
            observer?.disconnect();
            options.host?.removeEventListener('input', input);
            button.remove();
        },
    };
}
