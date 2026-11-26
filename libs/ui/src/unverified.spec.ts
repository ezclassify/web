import { afterEach, expect, it, vi } from 'vitest';
import { setUnverified, watchUnverified } from './unverified';

afterEach(() => document.body.replaceChildren());

function field(id: string): HTMLInputElement {
    const input = document.createElement('input');
    input.id = id;
    document.body.append(input);
    return input;
}

it('stamps, clears and announces a field only when its state changes', () => {
    const host = field('a');
    const seen: boolean[] = [];
    host.addEventListener('ezclassify:unverified-change', (event) =>
        seen.push((event as CustomEvent).detail.unverified),
    );
    setUnverified(host, false);
    setUnverified(host, true);
    setUnverified(host, true);
    expect(host.hasAttribute('data-ezclassify-unverified')).toBe(true);
    setUnverified(host, false);
    expect(host.hasAttribute('data-ezclassify-unverified')).toBe(false);
    expect(seen).toEqual([true, false]);
});

it('watchUnverified follows one field by id and never another', () => {
    const a = field('a');
    const b = field('b');
    setUnverified(a, true);
    const listener = vi.fn();
    const stop = watchUnverified('a', listener);
    expect(listener).toHaveBeenLastCalledWith(true);
    setUnverified(b, true);
    expect(listener).toHaveBeenCalledTimes(1);
    setUnverified(a, false);
    expect(listener).toHaveBeenLastCalledWith(false);
    stop();
    setUnverified(a, true);
    expect(listener).toHaveBeenCalledTimes(2);
});
