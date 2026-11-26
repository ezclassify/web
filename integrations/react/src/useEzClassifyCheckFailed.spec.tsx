/**
 * `useEzClassifyCheckFailed(id)` follows one field's own check state: the
 * attribute and `ezclassify:check-change` event its host carries.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { useEzClassifyCheckFailed } from './useEzClassifyCheckFailed';

function report(host: HTMLElement, failed: boolean): void {
    host.toggleAttribute('data-ezclassify-check-failed', failed);
    host.dispatchEvent(
        new CustomEvent('ezclassify:check-change', {
            bubbles: true,
            detail: { failed },
        }),
    );
}

afterEach(() => {
    cleanup();
    document.body.replaceChildren();
});

describe('useEzClassifyCheckFailed', () => {
    it('is true while its own field reports a failed check, and not for another field', () => {
        const mine = document.createElement('input');
        mine.id = 'mine';
        const other = document.createElement('input');
        other.id = 'other';
        document.body.append(mine, other);
        const { result } = renderHook(() => useEzClassifyCheckFailed('mine'));
        expect(result.current).toBe(false);
        act(() => report(other, true));
        expect(result.current).toBe(false);
        act(() => report(mine, true));
        expect(result.current).toBe(true);
        act(() => report(mine, false));
        expect(result.current).toBe(false);
    });

    it('starts true when the field already failed before it mounted', () => {
        const host = document.createElement('input');
        host.id = 'late';
        host.setAttribute('data-ezclassify-check-failed', '');
        document.body.append(host);
        const { result } = renderHook(() => useEzClassifyCheckFailed('late'));
        expect(result.current).toBe(true);
    });
});
