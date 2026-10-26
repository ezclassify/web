import { describe, it, expect, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useEzClassifyRollup } from './useEzClassifyRollup';

function makeInput(id: string, value = ''): HTMLInputElement {
    const el = document.createElement('input');
    el.type = 'hidden';
    el.id = id;
    el.value = value;
    document.body.appendChild(el);
    return el;
}

function fireRollup(target: HTMLElement, rendered: string) {
    target.dispatchEvent(
        new CustomEvent('ezclassify:rollup', {
            bubbles: true,
            detail: { rendered },
        }),
    );
}

describe('useEzClassifyRollup', () => {
    const created: HTMLElement[] = [];
    afterEach(() => {
        created.splice(0).forEach((el) => el.remove());
    });

    it('returns empty string when hidden input does not exist yet', () => {
        const { result } = renderHook(() =>
            useEzClassifyRollup('no-such-input'),
        );
        expect(result.current).toBe('');
    });

    it('reads initial value from hidden input if already populated', () => {
        const input = makeInput(
            'pre-filled-rollup',
            'STATE ASSESSMENT STAFF / valid',
        );
        created.push(input);

        const { result } = renderHook(() =>
            useEzClassifyRollup('pre-filled-rollup'),
        );
        expect(result.current).toBe('STATE ASSESSMENT STAFF / valid');
    });

    it('updates when ezclassify:rollup fires on the matching input', async () => {
        const input = makeInput('doc-rollup');
        created.push(input);

        const { result } = renderHook(() => useEzClassifyRollup('doc-rollup'));
        expect(result.current).toBe('');

        await act(async () => {
            fireRollup(input, 'TIER 1 / SECRET');
        });

        expect(result.current).toBe('TIER 1 / SECRET');
    });

    it('ignores rollup events from other rollup inputs', async () => {
        const other = makeInput('other-rollup');
        created.push(other);

        const { result } = renderHook(() => useEzClassifyRollup('my-rollup'));

        await act(async () => {
            fireRollup(other, 'SHOULD NOT APPEAR');
        });

        expect(result.current).toBe('');
    });

    it('reflects sequential updates', async () => {
        const input = makeInput('seq-rollup');
        created.push(input);

        const { result } = renderHook(() => useEzClassifyRollup('seq-rollup'));

        await act(async () => {
            fireRollup(input, 'FIRST VALUE');
        });
        expect(result.current).toBe('FIRST VALUE');

        await act(async () => {
            fireRollup(input, 'SECOND VALUE');
        });
        expect(result.current).toBe('SECOND VALUE');
    });

    it('converges on the sink value when a queued event payload is stale', async () => {
        const input = makeInput('burst-rollup');
        created.push(input);
        const { result } = renderHook(() =>
            useEzClassifyRollup('burst-rollup'),
        );

        await act(async () => {
            input.value = 'TLP:GREEN';
            fireRollup(input, '');
        });

        expect(result.current).toBe('TLP:GREEN');
    });

    it('falls back to empty string when event detail has no rendered field', async () => {
        const input = makeInput('detail-less-rollup', 'initial');
        created.push(input);

        const { result } = renderHook(() =>
            useEzClassifyRollup('detail-less-rollup'),
        );

        await act(async () => {
            input.dispatchEvent(
                new CustomEvent('ezclassify:rollup', {
                    bubbles: true,
                    detail: {}, // no rendered field → detail?.rendered ?? '' fires
                }),
            );
        });

        expect(result.current).toBe('');
    });

    it('removes the document listener on unmount', async () => {
        const input = makeInput('unmount-rollup');
        created.push(input);

        const { result, unmount } = renderHook(() =>
            useEzClassifyRollup('unmount-rollup'),
        );

        await act(async () => {
            fireRollup(input, 'BEFORE UNMOUNT');
        });
        expect(result.current).toBe('BEFORE UNMOUNT');

        unmount();

        // After unmount, further events should not cause a state update (React
        // would warn on setState after unmount if the listener remained).
        await act(async () => {
            fireRollup(input, 'AFTER UNMOUNT');
        });
        // result.current stays at the last committed value; no warning thrown
        expect(result.current).toBe('BEFORE UNMOUNT');
    });
});
