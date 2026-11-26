/**
 * `useEzClassifyUnverified(id)` follows one field's own state: the attribute
 * and `ezclassify:unverified-change` event its host carries. These drive a real
 * enhanced field through a failed and then a successful check.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, renderHook } from '@testing-library/react';
import type { ContextAdapter } from '@ezclassify/ui';
import { EzClassify, EzClassifyProvider } from './index';
import { useEzClassifyUnverified } from './useEzClassifyUnverified';
import { createUnverifiableContext } from '../../../libs/ui/test-fixtures/unverifiable-context';

const UNVERIFIED = 'data-ezclassify-unverified';

async function flush(): Promise<void> {
    await act(async () => {
        for (let index = 0; index < 8; index++)
            await new Promise<void>((tick) => setTimeout(tick, 25));
    });
}

function Readout({ id }: { id: string }) {
    return <output data-for={id}>{String(useEzClassifyUnverified(id))}</output>;
}

function typeInto(field: HTMLTextAreaElement, text: string): void {
    field.focus();
    field.value = text;
    field.dispatchEvent(new Event('input', { bubbles: true }));
}

afterEach(() => {
    cleanup();
    document.body.replaceChildren();
});

describe('useEzClassifyUnverified in a real field', () => {
    it('is true after a failed check, false again after the next one lands, and only for its own field', async () => {
        const controls = { down: false };
        const context = (await createUnverifiableContext(
            controls,
        )) as unknown as ContextAdapter;
        const { container } = render(
            <EzClassifyProvider context={context}>
                <EzClassify>
                    <input id="mine" data-ezclassify-controller="marking" />
                    <input id="other" data-ezclassify-controller="marking" />
                    <Readout id="mine" />
                    <Readout id="other" />
                </EzClassify>
            </EzClassifyProvider>,
        );
        await flush();
        const read = (id: string) =>
            container.querySelector(`output[data-for="${id}"]`)!.textContent;
        const editor = container.querySelector<HTMLTextAreaElement>(
            '.marking-field-host',
        )!;
        expect(read('mine')).toBe('false');
        controls.down = true;
        await act(async () => {
            typeInto(editor, 'sec');
            await new Promise<void>((tick) => setTimeout(tick, 100));
        });
        expect(container.querySelector('#mine')!.hasAttribute(UNVERIFIED)).toBe(
            true,
        );
        expect(read('mine')).toBe('true');
        expect(read('other')).toBe('false');
        controls.down = false;
        await act(async () => {
            typeInto(editor, 'secret zzz');
            await new Promise<void>((tick) => setTimeout(tick, 100));
        });
        expect(read('mine')).toBe('false');
    });
});

describe('useEzClassifyUnverified', () => {
    function report(host: HTMLElement, unverified: boolean): void {
        host.toggleAttribute(UNVERIFIED, unverified);
        host.dispatchEvent(
            new CustomEvent('ezclassify:unverified-change', {
                bubbles: true,
                detail: { unverified },
            }),
        );
    }

    it('reads true on the first render when the field already is unverified', () => {
        const host = document.createElement('input');
        host.id = 'late';
        host.setAttribute(UNVERIFIED, '');
        document.body.append(host);
        const seen: boolean[] = [];
        renderHook(() => {
            const value = useEzClassifyUnverified('late');
            seen.push(value);
            return value;
        });
        expect(seen[0]).toBe(true);
    });

    it('waits for a field that is not enhanced yet, and follows an id that changes', () => {
        const { result, rerender } = renderHook(
            ({ id }) => useEzClassifyUnverified(id),
            { initialProps: { id: 'first' } },
        );
        expect(result.current).toBe(false);
        const first = document.createElement('input');
        first.id = 'first';
        const second = document.createElement('input');
        second.id = 'second';
        document.body.append(first, second);
        act(() => report(first, true));
        expect(result.current).toBe(true);
        rerender({ id: 'second' });
        expect(result.current).toBe(false);
        act(() => report(second, true));
        expect(result.current).toBe(true);
        act(() => report(first, false));
        expect(result.current).toBe(true);
    });

    it('stops listening on unmount', () => {
        const add = vi.spyOn(document, 'addEventListener');
        const remove = vi.spyOn(document, 'removeEventListener');
        const { unmount } = renderHook(() => useEzClassifyUnverified('gone'));
        const named = (spy: typeof add) =>
            spy.mock.calls.filter(
                ([type]) => type === 'ezclassify:unverified-change',
            ).length;
        expect(named(add)).toBeGreaterThan(0);
        unmount();
        expect(named(remove)).toBe(named(add));
    });
});
