import { t } from '../i18n';
import { createAnnouncer, announce } from './accessibility-helpers';
import type { UndoOffer } from './marking-undo';

/**
 * Shared clear control. The owning field supplies the ordinary write path.
 *
 * After a clear the × becomes the undo of that clear, in the same place and at
 * the same size, for as long as the marking's undo offer is a clear's (see
 * marking-undo.ts). When the offer ends it goes back to ×.
 */

export interface ClearButton {
    button: HTMLButtonElement;
    /** Read the field's state and the marking's offer again. */
    update(): void;
    destroy(): void;
}

const CLEAR_ICON =
    '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg>';
const UNDO_ICON =
    '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/></svg>';

/** Create a stable form action; clearing and draft disposal belong to the field. */
export function createClearButton(options: {
    label: string;
    host?: HTMLInputElement | HTMLTextAreaElement;
    empty: () => boolean;
    clear: () => void | Promise<void>;
    /** The marking's live undo offer, if it has one. */
    undoOffer?: () => UndoOffer | null;
    /** Undo the clear the offer stands for. */
    undo?: () => Promise<unknown>;
    /** Put focus in the field itself. */
    focusField?: () => void;
}): ClearButton {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'ez-clear-button';
    const icon = document.createElement('span');
    icon.className = 'ez-clear-button__icon';
    button.appendChild(icon);
    const status = createAnnouncer();
    button.appendChild(status);
    let mode: 'clear' | 'undo' | null = null;
    const undoing = () => options.undoOffer?.()?.kind === 'clear';
    const update = () => {
        const next = undoing() ? 'undo' : 'clear';
        if (next !== mode) {
            mode = next;
            const label = next === 'undo' ? t('aria.undoClear') : options.label;
            button.setAttribute('aria-label', label);
            button.title = label;
            button.dataset.mode = next;
            icon.innerHTML = next === 'undo' ? UNDO_ICON : CLEAR_ICON;
        }
        button.disabled = !!options.host?.matches(':disabled, [readonly]');
        button.setAttribute(
            'aria-disabled',
            String(button.disabled || (mode === 'clear' && options.empty())),
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
        if (button.disabled) return;
        // A keyboard press has no click count; a pointer press does, and the
        // second click of a double click lands on the undo the first one just
        // put here. It must not take the clear straight back.
        const keyboard = event.detail === 0;
        if (mode === 'undo') {
            if (event.detail > 1) return;
            void options.undo?.().then(() => {
                if (keyboard) options.focusField?.();
                update();
                announce(status, t('a11y.markingRestored'));
            });
            return;
        }
        if (options.empty()) return;
        const cleared = options.clear();
        if (keyboard) {
            // Focus goes to the field, not to the undo that takes this
            // button's place: Enter there would undo at once. The undo is
            // the next Tab stop.
            if (options.focusField) options.focusField();
            else button.focus({ preventScroll: true });
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
