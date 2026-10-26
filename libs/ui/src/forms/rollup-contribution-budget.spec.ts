import { describe, expect, it, vi } from 'vitest';
import { aggregateRollupMarkings } from './rollup';
import type { FormsContext } from './types';

function context(roleAware: boolean | undefined) {
    const aggregate = vi.fn(async (inputs: string[]) => ({
        rendered: inputs.join(' '),
        assertions: [],
        valid: true,
        errors: [],
    }));
    return {
        ctx: {
            engine: { getSchemeMeta: () => ({ roleAware }), aggregate },
            defaultFormat: 'part',
        } as unknown as FormsContext,
        aggregate,
    };
}

describe('unchanged part contribution call budget', () => {
    it.each([4, 40])(
        'reuses %i whole-insensitive part contributions while coverage can be judged separately',
        async (count) => {
            const { ctx, aggregate } = context(false);
            const parts = Array.from(
                { length: count },
                (_, index) => `part-${index}`,
            );
            await aggregateRollupMarkings(ctx, parts, 'scheme');
            aggregate.mockClear();
            for (let wholeEdit = 0; wholeEdit < 3; wholeEdit++)
                await aggregateRollupMarkings(ctx, parts, 'scheme');
            expect(aggregate).toHaveBeenCalledTimes(0);
            await aggregateRollupMarkings(
                ctx,
                [...parts, 'new-part'],
                'scheme',
            );
            expect(aggregate).toHaveBeenCalledTimes(1);
        },
    );
    it.each([true, undefined])(
        'keeps the conservative budget when whole dependence is %s',
        async (roleAware) => {
            const { ctx, aggregate } = context(roleAware);
            await aggregateRollupMarkings(ctx, ['part'], 'scheme');
            await aggregateRollupMarkings(ctx, ['part'], 'scheme');
            expect(aggregate).toHaveBeenCalledTimes(2);
        },
    );
    it('starts the aggregate before returning its promise', async () => {
        const { ctx, aggregate } = context(false);
        const pending = aggregateRollupMarkings(ctx, ['part'], 'scheme');
        expect(aggregate).toHaveBeenCalledTimes(1);
        await pending;
    });
    it('retries a failed aggregate rather than caching a failed answer', async () => {
        const { ctx, aggregate } = context(false);
        aggregate.mockRejectedValueOnce(new Error('offline'));
        await expect(
            aggregateRollupMarkings(ctx, ['part'], 'scheme'),
        ).rejects.toThrow('offline');
        await aggregateRollupMarkings(ctx, ['part'], 'scheme');
        expect(aggregate).toHaveBeenCalledTimes(2);
    });
});
