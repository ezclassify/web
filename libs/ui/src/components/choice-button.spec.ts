import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createChoiceButton, type ChoiceButtonOptions } from './choice-button';

function choice(options: Partial<ChoiceButtonOptions> = {}) {
    return createChoiceButton(document, {
        mode: 'checkbox',
        label: 'Choice',
        reference: { conceptId: 'choice', categoryId: 'category' },
        selected: false,
        tabIndex: 0,
        className: 'context-choice',
        onActivate: () => {},
        ...options,
    });
}

describe('shared native choice button', () => {
    it.each(['toggle', 'radio', 'checkbox'] as const)(
        'carries accepted %s semantics without changing state on activation',
        (mode) => {
            const activate = vi.fn();
            const button = choice({
                mode,
                selected: true,
                onActivate: activate,
            });
            expect(button.type).toBe('button');
            expect(button.classList.contains('ez-choice-button')).toBe(true);
            expect(button.classList.contains('context-choice')).toBe(true);
            expect(button.getAttribute('role')).toBe(
                mode === 'toggle' ? null : mode,
            );
            const state = mode === 'toggle' ? 'aria-pressed' : 'aria-checked';
            expect(button.getAttribute(state)).toBe('true');
            expect(button.dataset).toMatchObject({
                conceptId: 'choice',
                categoryId: 'category',
            });
            button.click();
            expect(activate).toHaveBeenCalledOnce();
            expect(button.getAttribute(state)).toBe('true');
        },
    );
    it('keeps explainable blocks native-enabled but prevents native disabled activation', () => {
        const activate = vi.fn();
        const explain = vi.fn();
        const blocked = choice({
            blocked: true,
            onActivate: activate,
            onExplainBlocked: explain,
        });
        expect(blocked.disabled).toBe(false);
        expect(blocked.getAttribute('aria-disabled')).toBe('true');
        expect(blocked.hasAttribute('data-blocked')).toBe(true);
        blocked.click();
        expect(explain).toHaveBeenCalledOnce();
        expect(activate).not.toHaveBeenCalled();
        const disabled = choice({
            disabled: true,
            tabIndex: -1,
            onActivate: activate,
        });
        expect(disabled.disabled).toBe(true);
        expect(disabled.tabIndex).toBe(-1);
        disabled.click();
        expect(activate).not.toHaveBeenCalled();
    });
    it('reuses DecisionFlow inference and blocked hover/focus behavior without selecting', () => {
        const inferred = choice({ inferred: true, selected: false });
        expect(inferred.classList.contains('ez-choice-button--inferred')).toBe(
            true,
        );
        expect(inferred.getAttribute('aria-label')).toContain('Choice');
        expect(inferred.getAttribute('aria-label')).not.toBe('Choice');
        expect(inferred.getAttribute('aria-checked')).toBe('false');
        const explain = vi.fn(),
            hide = vi.fn();
        const blocked = choice({
            blocked: true,
            onExplainBlocked: explain,
            onHideExplanation: hide,
        });
        blocked.dispatchEvent(
            Object.assign(new Event('pointerenter'), { pointerType: 'touch' }),
        );
        expect(explain).not.toHaveBeenCalled();
        blocked.dispatchEvent(
            Object.assign(new Event('pointerenter'), { pointerType: 'mouse' }),
        );
        expect(explain).toHaveBeenCalledOnce();
        blocked.dispatchEvent(new FocusEvent('focus'));
        expect(explain).toHaveBeenCalledTimes(2);
        blocked.dispatchEvent(new FocusEvent('blur'));
        expect(hide).toHaveBeenCalledOnce();
        blocked.dispatchEvent(
            Object.assign(new Event('pointerleave'), { pointerType: 'mouse' }),
        );
        expect(hide).toHaveBeenCalledTimes(2);
    });
    it('keeps caller label identity and leaves native activation/navigation keys untouched', () => {
        const label = document.createElement('span');
        label.textContent = 'Label';
        const activate = vi.fn();
        const button = choice({ label, onActivate: activate });
        expect(button.firstChild).toBe(label);
        for (const key of ['Enter', ' ', 'ArrowDown', 'ArrowRight', 'Tab']) {
            const event = new KeyboardEvent('keydown', {
                key,
                bubbles: true,
                cancelable: true,
            });
            button.dispatchEvent(event);
            expect(event.defaultPrevented).toBe(false);
        }
        expect(activate).not.toHaveBeenCalled();
        // Jsdom omits native keyboard default activation; browsers supply this click.
        button.click();
        expect(activate).toHaveBeenCalledOnce();
    });
    it('owns the shared frame, focus and accessibility media treatments', () => {
        const css = readFileSync(
            join(dirname(fileURLToPath(import.meta.url)), 'choice-button.css'),
            'utf8',
        );
        expect(css).toContain('.ez-choice-button:focus-visible');
        expect(css).toContain('min-height: 2.75rem');
        expect(css).toContain('prefers-reduced-motion');
        expect(css).toContain('forced-colors');
        expect(css).toContain('ButtonText');
        expect(css).toContain('Highlight');
    });
});
