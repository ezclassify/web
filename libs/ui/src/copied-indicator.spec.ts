import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { showCopiedIndicator } from './copied-indicator';

describe('copied-indicator', () => {
    beforeEach(() => {
        Element.prototype.scrollIntoView = vi.fn();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe('showCopiedIndicator', () => {
        it('appends a "Copied" indicator to the wrapping div', () => {
            const wrapper = document.createElement('div');
            const field = document.createElement('input');
            wrapper.appendChild(field);
            document.body.appendChild(wrapper);

            showCopiedIndicator(field);

            const indicator = wrapper.querySelector('.ez-copied-indicator');
            expect(indicator).not.toBeNull();
            expect(indicator!.textContent).toBe('Copied');

            wrapper.remove();
        });

        it('does nothing when field has no wrapping div', () => {
            const field = document.createElement('input');
            showCopiedIndicator(field);
            // no error thrown, no indicator anywhere
        });
    });
});
