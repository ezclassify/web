import { describe, it, expect } from 'vitest';
import { toFieldAssertions } from './assertion-store';

describe('assertion-store', () => {
    describe('toFieldAssertions', () => {
        it('converts engine assertions to FieldAssertion shape', () => {
            const result = toFieldAssertions([
                { conceptId: 'A', categoryId: 'c1' },
                { conceptId: 'B', categoryId: 'c2', value: 'val' },
            ]);
            expect(result).toEqual([
                { conceptId: 'A', categoryId: 'c1' },
                { conceptId: 'B', categoryId: 'c2', value: 'val' },
            ]);
        });

        it('preserves value when present', () => {
            const result = toFieldAssertions([
                { conceptId: 'A', categoryId: 'c1', value: 'test' },
            ]);
            expect(result[0].value).toBe('test');
        });

        it('omits value key when not present', () => {
            const result = toFieldAssertions([
                { conceptId: 'A', categoryId: 'c1' },
            ]);
            expect('value' in result[0]).toBe(false);
        });

        it('returns empty array for empty input', () => {
            expect(toFieldAssertions([])).toEqual([]);
        });
    });
});
