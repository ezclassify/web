import { afterEach, expect, it, vi } from 'vitest';
import { setCheckFailed, watchCheckFailed } from './field-check';

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
    host.addEventListener('ezclassify:check-change', (event) =>
        seen.push((event as CustomEvent).detail.failed),
    );
    setCheckFailed(host, false);
    setCheckFailed(host, true);
    setCheckFailed(host, true);
    expect(host.hasAttribute('data-ezclassify-check-failed')).toBe(true);
    setCheckFailed(host, false);
    expect(host.hasAttribute('data-ezclassify-check-failed')).toBe(false);
    expect(seen).toEqual([true, false]);
});

it('watchCheckFailed follows one field by id and never another', () => {
    const a = field('a');
    const b = field('b');
    setCheckFailed(a, true);
    const listener = vi.fn();
    const stop = watchCheckFailed('a', listener);
    expect(listener).toHaveBeenLastCalledWith(true);
    setCheckFailed(b, true);
    expect(listener).toHaveBeenCalledTimes(1);
    setCheckFailed(a, false);
    expect(listener).toHaveBeenLastCalledWith(false);
    stop();
    setCheckFailed(a, true);
    expect(listener).toHaveBeenCalledTimes(2);
});
