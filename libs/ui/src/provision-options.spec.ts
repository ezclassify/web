import { describe, expect, it } from 'vitest';
import { mergeProvisionOptions } from './provision-options';

interface Options {
    format?: string;
    tooltipConceptProperty?: string;
}

describe('mergeProvisionOptions', () => {
    it('applies the overrides over the defaults, key by key', () => {
        expect(
            mergeProvisionOptions<Options>(
                { format: 'app', tooltipConceptProperty: 'app-property' },
                { format: 'scope' },
            ),
        ).toEqual({ format: 'scope', tooltipConceptProperty: 'app-property' });
    });

    it('keeps a default whose override key is explicitly undefined', () => {
        expect(
            mergeProvisionOptions<Options>(
                { format: 'app' },
                { format: undefined, tooltipConceptProperty: 'scope-property' },
            ),
        ).toEqual({ format: 'app', tooltipConceptProperty: 'scope-property' });
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
