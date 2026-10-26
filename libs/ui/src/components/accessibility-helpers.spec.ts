import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    createAnnouncer,
    announce,
    createKeyboardHints,
} from './accessibility-helpers';

describe('accessibility-helpers', () => {
    describe('createAnnouncer', () => {
        it('returns a div with role=status', () => {
            const el = createAnnouncer();
            expect(el.tagName).toBe('DIV');
            expect(el.getAttribute('role')).toBe('status');
        });

        it('has aria-live=polite', () => {
            const el = createAnnouncer();
            expect(el.getAttribute('aria-live')).toBe('polite');
        });

        it('has aria-atomic=true', () => {
            const el = createAnnouncer();
            expect(el.getAttribute('aria-atomic')).toBe('true');
        });

        it('has sr-only class for visual hiding', () => {
            const el = createAnnouncer();
            expect(el.className).toBe('ez-sr-only');
        });

        it('starts with empty text content', () => {
            const el = createAnnouncer();
            expect(el.textContent).toBe('');
        });
    });

    describe('announce', () => {
        let announcer: HTMLDivElement;

        beforeEach(() => {
            announcer = createAnnouncer();
            document.body.appendChild(announcer);
            vi.spyOn(window, 'requestAnimationFrame').mockImplementation(
                (cb) => {
                    cb(0);
                    return 0;
                },
            );
        });

        afterEach(() => {
            announcer.remove();
            vi.restoreAllMocks();
        });

        it('sets text content after clearing', () => {
            announce(announcer, 'Item selected');
            expect(announcer.textContent).toBe('Item selected');
        });

        it('clears previous content before setting new text', () => {
            announcer.textContent = 'Old announcement';
            announce(announcer, 'New announcement');
            expect(announcer.textContent).toBe('New announcement');
        });

        it('works with empty string', () => {
            announce(announcer, '');
            expect(announcer.textContent).toBe('');
        });

        it('uses requestAnimationFrame for the update', () => {
            announce(announcer, 'Test');
            expect(window.requestAnimationFrame).toHaveBeenCalledOnce();
        });
    });

    describe('createKeyboardHints', () => {
        it('returns a div with correct class and aria-label', () => {
            const bar = createKeyboardHints([]);
            expect(bar.tagName).toBe('DIV');
            expect(bar.className).toBe('proto-kbd-hints');
            expect(bar.getAttribute('aria-label')).toBe('Keyboard shortcuts');
        });

        it('renders each hint as a span', () => {
            const bar = createKeyboardHints([
                { keys: 'Enter', action: 'select' },
                { keys: 'Escape', action: 'close' },
            ]);
            const hints = bar.querySelectorAll('.proto-kbd-hint');
            expect(hints.length).toBe(2);
        });

        it('renders keys as <kbd> elements', () => {
            const bar = createKeyboardHints([
                { keys: 'Enter', action: 'confirm' },
            ]);
            const kbd = bar.querySelector('kbd');
            expect(kbd).not.toBeNull();
            expect(kbd!.textContent).toBe('Enter');
        });

        it('renders + as a combo separator', () => {
            const bar = createKeyboardHints([
                { keys: 'Ctrl+Enter', action: 'submit' },
            ]);
            const kbds = bar.querySelectorAll('kbd');
            expect(kbds.length).toBe(2);
            expect(kbds[0].textContent).toBe('Ctrl');
            expect(kbds[1].textContent).toBe('Enter');
            // The hint text should contain "+"
            const hint = bar.querySelector('.proto-kbd-hint')!;
            expect(hint.textContent).toContain('+');
        });

        it('renders / as "or" separator', () => {
            const bar = createKeyboardHints([
                { keys: 'Enter/Tab', action: 'select' },
            ]);
            const hint = bar.querySelector('.proto-kbd-hint')!;
            expect(hint.textContent).toContain(' or ');
        });

        it('appends action text after keys', () => {
            const bar = createKeyboardHints([
                { keys: 'Escape', action: 'dismiss' },
            ]);
            const hint = bar.querySelector('.proto-kbd-hint')!;
            expect(hint.textContent).toContain('dismiss');
        });

        it('handles empty hints array', () => {
            const bar = createKeyboardHints([]);
            expect(bar.children.length).toBe(0);
        });
    });
});
