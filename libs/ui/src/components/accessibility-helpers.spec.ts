import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createAnnouncer, announce } from './accessibility-helpers';

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
});
