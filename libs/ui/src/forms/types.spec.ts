import { describe, it, expect } from 'vitest';
import { cssEscape } from './types';

describe('forms/types', () => {
    describe('cssEscape', () => {
        it('returns plain alphanumeric strings unchanged', () => {
            expect(cssEscape('abc123')).toBe('abc123');
        });

        it('escapes dots', () => {
            expect(cssEscape('my.class')).toContain('\\');
        });

        it('escapes colons', () => {
            expect(cssEscape('my:id')).toContain('\\');
        });

        it('handles empty string', () => {
            expect(cssEscape('')).toBe('');
        });

        it('preserves hyphens and underscores', () => {
            expect(cssEscape('my-class_name')).toBe('my-class_name');
        });
    });
});
