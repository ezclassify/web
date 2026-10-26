import { describe, expect, it } from 'vitest';
import { mergeProvisionOptions } from './provision-options';

interface Options {
    format?: string;
    rollupId?: string;
}

describe('mergeProvisionOptions', () => {
    it('applies the overrides over the defaults, key by key', () => {
        expect(
            mergeProvisionOptions<Options>(
                { format: 'app', rollupId: 'app-rollup' },
                { format: 'scope' },
            ),
        ).toEqual({ format: 'scope', rollupId: 'app-rollup' });
    });

    it('keeps a default whose override key is explicitly undefined', () => {
        expect(
            mergeProvisionOptions<Options>(
                { format: 'app' },
                { format: undefined, rollupId: 'scope-rollup' },
            ),
        ).toEqual({ format: 'app', rollupId: 'scope-rollup' });
    });

    it('answers with a fresh bag for every combination of absent inputs', () => {
        const defaults: Options = { format: 'app' };
        const merged = mergeProvisionOptions<Options>(defaults, undefined);
        expect(merged).toEqual(defaults);
        expect(merged).not.toBe(defaults);
        expect(mergeProvisionOptions<Options>(undefined, undefined)).toEqual(
            {},
        );
        expect(
            mergeProvisionOptions<Options>(undefined, { format: 'scope' }),
        ).toEqual({ format: 'scope' });
    });

    it('treats null the way it treats absent, for optional injection', () => {
        expect(
            mergeProvisionOptions<Options>(null, { format: 'scope' }),
        ).toEqual({ format: 'scope' });
        expect(mergeProvisionOptions<Options>({ format: 'app' }, null)).toEqual(
            { format: 'app' },
        );
        expect(mergeProvisionOptions<Options>(null, null)).toEqual({});
    });
});
