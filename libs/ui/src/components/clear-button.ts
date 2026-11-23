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

export interface ClearActionOptions {
    mode?: 'clear';
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
}

interface ToggleActionOptions {
    mode: 'toggle';
    label: string;
    toggle: () => void;
}

export interface ToggleAction {
    element: HTMLLabelElement;
    input: HTMLInputElement;
    update(state: 'none' | 'some' | 'all', disabled: boolean): void;
}

export function createFieldAction(options: ClearActionOptions): ClearButton;
export function createFieldAction(options: ToggleActionOptions): ToggleAction;
export function createFieldAction(
    options: ClearActionOptions | ToggleActionOptions,
): ClearButton | ToggleAction {
    return options.mode === 'toggle'
        ? createToggleAction(options)
        : createClearAction(options);
}

function createToggleAction(options: ToggleActionOptions): ToggleAction {
    const element = document.createElement('label');
    element.className = 'ez-field-action ez-field-action--toggle';
    element.dataset.mode = 'toggle';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.className = 'ez-field-action__checkbox';
    input.setAttribute('aria-label', options.label);
    input.addEventListener('change', options.toggle);
    const glyph = document.createElement('span');
    glyph.className = 'ez-field-action__glyph ez-field-action__glyph--toggle';
    glyph.setAttribute('aria-hidden', 'true');
    glyph.innerHTML =
        '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 8.5 6.5 11.5 12.5 4.5"/><path d="M4 8h8"/></svg>';
    element.append(input, glyph);
    return {
        element,
        input,
        update(state, disabled) {
            input.checked = state === 'all';
            input.indeterminate = state === 'some';
            input.disabled = disabled;
        },
    };
}

/** Clearing and draft disposal belong to the field. */
function createClearAction(options: ClearActionOptions): ClearButton {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'ez-clear-button ez-field-action';
    const icon = document.createElement('span');
    icon.className = 'ez-clear-button__icon ez-field-action__glyph';
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
    // Prevent focus moving to the button while it clears a draft. Let touch
    // pointer events complete so WebKit still delivers the activation click.
    button.addEventListener('mousedown', (event) => {
        if (!button.disabled) event.preventDefault();
    });
    button.addEventListener('pointerdown', (event) => {
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
