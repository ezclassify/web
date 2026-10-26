import { describe, expect, it, vi } from 'vitest';
import type { Assertion, Suggestion } from '@ezclassify/types';
import { SuggestionCatalog } from './suggestion-catalog';

const row = (conceptId: string, categoryId = 'level') =>
    ({ conceptId, categoryId }) as Suggestion;
const fact = (conceptId: string, value?: string) =>
    ({ conceptId, categoryId: 'level', value }) as Assertion;
const deferred = <T>() => {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((r) => {
        resolve = r;
    });
    return { promise, resolve };
};

describe('SuggestionCatalog', () => {
    it('loads only on request and shares the base catalog between interactions', async () => {
        const suggestions = vi.fn().mockResolvedValue([row('a')]);
        const catalog = new SuggestionCatalog(suggestions, vi.fn());
        expect(catalog.rows()).toEqual([]);
        expect(suggestions).not.toHaveBeenCalled();
        await Promise.all([catalog.load(), catalog.load()]);
        await catalog.load();
        expect(suggestions).toHaveBeenCalledTimes(1);
        expect(catalog.rows()).toEqual([row('a')]);
        catalog.invalidate();
        expect(suggestions).toHaveBeenCalledTimes(1);
    });

    it('waits for a shared live-context request on repeated interactions', async () => {
        const pending = deferred<Suggestion[]>();
        const suggestions = vi.fn(() => pending.promise);
        const catalog = new SuggestionCatalog(suggestions, vi.fn());
        const first = catalog.refresh([fact('a')]);
        let settled = false;
        const second = catalog.refresh([fact('a')]).then(() => {
            settled = true;
        });
        await Promise.resolve();
        expect(settled).toBe(false);
        expect(suggestions).toHaveBeenCalledTimes(1);
        pending.resolve([row('a')]);
        await Promise.all([first, second]);
        expect(settled).toBe(true);
        expect(catalog.rows()).toEqual([row('a')]);
    });

    it('keeps replacements and merges context-only choices by concept and category', async () => {
        const catalog = new SuggestionCatalog(
            async (live) =>
                live ? [row('a'), row('a', 'owner'), row('b')] : [row('a')],
            vi.fn(),
        );
        await catalog.load();
        await catalog.refresh([fact('a')]);
        expect(catalog.rows()).toEqual([row('a'), row('a', 'owner'), row('b')]);
    });

    it('keeps the newest live value when engine responses arrive out of order', async () => {
        const old = deferred<Suggestion[]>();
        const catalog = new SuggestionCatalog(
            async (live) =>
                live?.[0].value === 'old' ? old.promise : [row('new')],
            vi.fn(),
        );
        const first = catalog.refresh([fact('a', 'old')]);
        await catalog.refresh([fact('a', 'new')]);
        old.resolve([row('old')]);
        await first;
        expect(catalog.rows()).toEqual([row('new')]);
    });

    it('ignores a base response after context invalidation or teardown', async () => {
        for (const finish of ['invalidate', 'dispose'] as const) {
            const pending = deferred<Suggestion[]>();
            const changed = vi.fn();
            const catalog = new SuggestionCatalog(
                () => pending.promise,
                changed,
            );
            const load = catalog.load();
            catalog[finish]();
            pending.resolve([row('stale')]);
            await load;
            expect(catalog.rows()).toEqual([]);
            expect(changed).not.toHaveBeenCalled();
        }
    });

    it('does not wait for an obsolete live request after invalidation', async () => {
        const pending = deferred<Suggestion[]>();
        const catalog = new SuggestionCatalog(() => pending.promise, vi.fn());
        const old = catalog.refresh([fact('old')]);
        catalog.invalidate();
        let settled = false;
        void catalog.refresh([]).then(() => {
            settled = true;
        });
        await vi.waitFor(() => expect(settled).toBe(true));
        pending.resolve([row('old')]);
        await old;
        expect(catalog.rows()).toEqual([]);
    });

    it('retries a failed base request on the next explicit interaction', async () => {
        const suggestions = vi
            .fn()
            .mockRejectedValueOnce(new Error('offline'))
            .mockResolvedValue([row('a')]);
        const catalog = new SuggestionCatalog(suggestions, vi.fn());
        await catalog.load();
        expect(catalog.rows()).toEqual([]);
        await catalog.load();
        expect(catalog.rows()).toEqual([row('a')]);
    });
});
