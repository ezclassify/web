/**
 * Forms/rollup process-cache behavior.
 *
 * The LRU cache reuses identical (schemeId, rendered, role, partOfRendered,
 * format) tuples within a session to avoid repeated engine processing.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { loadCedarValley } from '@ezclassify/example-schemes/cedar-valley';
import { clearRollupProcessCache, processRollupMarking } from './rollup';
import { EzClassifyUI } from '../ezclassify-ui';

function mockCtx(processSpy: ReturnType<typeof vi.fn>) {
    return {
        defaultFormat: 'default',
        engine: {
            listSchemes: undefined,
            process: processSpy,
        },
    } as any;
}

describe('forms/rollup process cache', () => {
    beforeEach(() => {
        clearRollupProcessCache();
    });

    it('identical calls hit the cache, engine.process called once', async () => {
        const spy = vi.fn().mockResolvedValue({
            valid: true,
            rendered: 'R',
            errors: [],
            assertions: [],
            warnings: [],
        });
        const ctx = mockCtx(spy);

        await processRollupMarking(ctx, 'p1', 'INPUT', { role: 'whole' });
        await processRollupMarking(ctx, 'p1', 'INPUT', { role: 'whole' });
        await processRollupMarking(ctx, 'p1', 'INPUT', { role: 'whole' });

        expect(spy).toHaveBeenCalledTimes(1);
    });

    it('shares one in-flight process call across identical rollup requests', async () => {
        let finish!: (result: { valid: boolean; rendered: string }) => void;
        const pending = new Promise<{ valid: boolean; rendered: string }>(
            (resolve) => {
                finish = resolve;
            },
        );
        const spy = vi.fn().mockReturnValue(pending);
        const ctx = mockCtx(spy);

        const first = processRollupMarking(ctx, 'p1', 'INPUT', {
            role: 'whole',
        });
        const second = processRollupMarking(ctx, 'p1', 'INPUT', {
            role: 'whole',
        });
        const callsBeforeResolution = spy.mock.calls.length;
        finish({ valid: true, rendered: 'INPUT' });
        const results = await Promise.all([first, second]);

        expect(callsBeforeResolution).toBe(1);
        expect(results[0]).toBe(results[1]);
    });

    it('different roles bypass the cache', async () => {
        const spy = vi.fn().mockResolvedValue({
            valid: true,
            rendered: 'R',
            errors: [],
            assertions: [],
            warnings: [],
        });
        const ctx = mockCtx(spy);

        await processRollupMarking(ctx, 'p1', 'INPUT', { role: 'whole' });
        await processRollupMarking(ctx, 'p1', 'INPUT', { role: 'part' });

        expect(spy).toHaveBeenCalledTimes(2);
    });

    it('different partOf bypasses the cache', async () => {
        const spy = vi.fn().mockResolvedValue({
            valid: true,
            rendered: 'R',
            errors: [],
            assertions: [],
            warnings: [],
        });
        const ctx = mockCtx(spy);

        await processRollupMarking(ctx, 'p1', 'CHILD', {
            role: 'part',
            partOf: { rendered: 'A' },
        });
        await processRollupMarking(ctx, 'p1', 'CHILD', {
            role: 'part',
            partOf: { rendered: 'B' },
        });

        expect(spy).toHaveBeenCalledTimes(2);
    });

    it('different schemeIds are separate cache entries', async () => {
        const spy = vi.fn().mockResolvedValue({
            valid: true,
            rendered: 'R',
            errors: [],
            assertions: [],
            warnings: [],
        });
        const ctx = mockCtx(spy);

        await processRollupMarking(ctx, 'p1', 'INPUT', { role: 'whole' });
        await processRollupMarking(ctx, 'p2', 'INPUT', { role: 'whole' });

        expect(spy).toHaveBeenCalledTimes(2);
    });

    it('reads an empty marking through the engine and retains its validation result', async () => {
        const spy = vi.fn().mockResolvedValue({
            valid: false,
            rendered: '',
            errors: [
                { constraintId: 'required-level', message: 'Level required' },
            ],
            assertions: [],
            warnings: [],
        });
        const ctx = mockCtx(spy);

        const result = await processRollupMarking(ctx, 'p1', '', {
            role: 'whole',
        });

        expect(spy).toHaveBeenCalledTimes(1);
        expect(result.valid).toBe(false);
        expect(result.errors).toEqual([
            { constraintId: 'required-level', message: 'Level required' },
        ]);
        expect(result.rendered).toBe('');
    });

    it('returns the real scheme result for an empty whole', async () => {
        const root = document.createElement('div');
        document.body.appendChild(root);
        const forms = new EzClassifyUI(loadCedarValley(), { root });
        try {
            const expected = await Promise.resolve(
                forms.engine.process('', {
                    outputFormat: 'long',
                    context: { role: 'whole' },
                }),
            );
            const observed = await processRollupMarking(
                { defaultFormat: 'long', engine: forms.engine } as any,
                'cedar-valley',
                '',
                { role: 'whole' },
            );
            expect(observed).toEqual(expected);
        } finally {
            forms.destroy();
            root.remove();
        }
    });

    it('cache survives across 10 identical calls on realistic 5-marking document', async () => {
        // Simulate a form with 5 children + 1 parent rendering 10 times
        // (e.g., user edits one field, rollup fires 10 times via debounce).
        // Expected: 6 unique tuples -> 6 process calls total, not 6*10 = 60.
        const spy = vi.fn().mockResolvedValue({
            valid: true,
            rendered: 'R',
            errors: [],
            assertions: [],
            warnings: [],
        });
        const ctx = mockCtx(spy);

        for (let rollupTick = 0; rollupTick < 10; rollupTick++) {
            // 1 parent process
            await processRollupMarking(ctx, 'p1', 'PARENT', { role: 'whole' });
            // 5 child processes
            for (let i = 1; i <= 5; i++) {
                await processRollupMarking(ctx, 'p1', `CHILD${i}`, {
                    role: 'part',
                    partOf: { rendered: 'PARENT' },
                });
            }
        }

        expect(spy).toHaveBeenCalledTimes(6);
    });

    it('clearRollupProcessCache forces a re-fetch', async () => {
        const spy = vi.fn().mockResolvedValue({
            valid: true,
            rendered: 'R',
            errors: [],
            assertions: [],
            warnings: [],
        });
        const ctx = mockCtx(spy);

        await processRollupMarking(ctx, 'p1', 'INPUT', { role: 'whole' });
        clearRollupProcessCache();
        await processRollupMarking(ctx, 'p1', 'INPUT', { role: 'whole' });

        expect(spy).toHaveBeenCalledTimes(2);
    });

    it('EzClassifyUI.destroy() clears its own engine partition (documented teardown contract)', async () => {
        const root = document.createElement('div');
        document.body.appendChild(root);
        const forms = new EzClassifyUI(loadCedarValley(), { root });
        const spy = vi.spyOn(forms.engine, 'process').mockResolvedValue({
            valid: true,
            rendered: 'R',
            errors: [],
            assertions: [],
            warnings: [],
        } as never);
        const ctx = { defaultFormat: 'default', engine: forms.engine } as any;

        await processRollupMarking(ctx, 'p1', 'INPUT', { role: 'whole' });
        expect(spy).toHaveBeenCalledTimes(1);
        await processRollupMarking(ctx, 'p1', 'INPUT', { role: 'whole' });
        expect(spy).toHaveBeenCalledTimes(1); // cache hit

        forms.destroy();
        root.remove();

        // Same tuple now misses and re-hits the engine.
        await processRollupMarking(ctx, 'p1', 'INPUT', { role: 'whole' });
        expect(spy).toHaveBeenCalledTimes(2);
        spy.mockRestore();
    });

    /**
     * Two contexts on one page can carry the same scheme id over a different
     * composition, so a cached answer may not cross from one engine to the
     * other, and one context's teardown may not throw away the other's work.
     */
    it('keeps each engine on its own partition', async () => {
        const hit = {
            valid: true,
            rendered: 'R',
            errors: [],
            assertions: [],
            warnings: [],
        };
        const first = vi.fn().mockResolvedValue(hit);
        const second = vi.fn().mockResolvedValue(hit);
        const ctxA = mockCtx(first);
        const ctxB = mockCtx(second);

        await processRollupMarking(ctxA, 'p1', 'INPUT', { role: 'whole' });
        await processRollupMarking(ctxB, 'p1', 'INPUT', { role: 'whole' });
        // Same scheme id and same tuple, different engine: no borrowed answer.
        expect(first).toHaveBeenCalledTimes(1);
        expect(second).toHaveBeenCalledTimes(1);

        clearRollupProcessCache(ctxA.engine);

        await processRollupMarking(ctxA, 'p1', 'INPUT', { role: 'whole' });
        await processRollupMarking(ctxB, 'p1', 'INPUT', { role: 'whole' });
        expect(first).toHaveBeenCalledTimes(2);
        expect(second).toHaveBeenCalledTimes(1); // untouched by the peer's clear
    });

    it('LRU eviction keeps memory bounded (300 unique calls, cap 256)', async () => {
        const spy = vi.fn().mockResolvedValue({
            valid: true,
            rendered: 'R',
            errors: [],
            assertions: [],
            warnings: [],
        });
        const ctx = mockCtx(spy);

        // 300 unique (rendered) tuples, one each
        for (let i = 0; i < 300; i++) {
            await processRollupMarking(ctx, 'p1', `INPUT_${i}`, {
                role: 'whole',
            });
        }
        expect(spy).toHaveBeenCalledTimes(300);

        // The first 44 should be evicted (256 cap). Re-request the very first one:
        // should miss the cache and hit the engine again.
        await processRollupMarking(ctx, 'p1', 'INPUT_0', { role: 'whole' });
        expect(spy).toHaveBeenCalledTimes(301);

        // A recently-added one is still cached.
        await processRollupMarking(ctx, 'p1', 'INPUT_299', { role: 'whole' });
        expect(spy).toHaveBeenCalledTimes(301);
    });
});
