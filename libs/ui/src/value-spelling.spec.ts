import { describe, expect, it } from 'vitest';
import type { ValueEncoding } from '@ezclassify/types';
import { writtenValue } from './value-spelling';

const date: ValueEncoding = {
    type: 'calendar-date',
    canonical: 'YYYY-MM-DD',
    accepts: ['YYYYMMDD', 'YYYY-MM-DD'],
    views: { default: 'YYYYMMDD' },
};

describe('a typed value as an output writes it', () => {
    it('takes the spelling the encoding declares for the view', () => {
        expect(writtenValue('2045-12-31', date, undefined)).toBe('20451231');
        expect(writtenValue('2045-12-31', date, 'default')).toBe('20451231');
    });

    it('keeps the stored spelling for a view the encoding names no spelling for', () => {
        expect(writtenValue('2045-12-31', date, 'long')).toBe('2045-12-31');
        expect(
            writtenValue(
                '2045-12-31',
                { ...date, views: undefined },
                undefined,
            ),
        ).toBe('2045-12-31');
    });

    it('leaves a plain value, and one not in the stored spelling, as it is', () => {
        expect(writtenValue('J. Doe', undefined, undefined)).toBe('J. Doe');
        expect(writtenValue('J. Doe', { type: 'text' }, undefined)).toBe(
            'J. Doe',
        );
        expect(writtenValue('20451231', date, undefined)).toBe('20451231');
    });
});
