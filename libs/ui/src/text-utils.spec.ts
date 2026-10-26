import { describe, it, expect } from 'vitest';
import { escHtml } from './text-utils';

describe('text-utils', () => {
    describe('escHtml', () => {
        it('escapes ampersand', () => {
            expect(escHtml('a&b')).toBe('a&amp;b');
        });

        it('escapes less-than', () => {
            expect(escHtml('a<b')).toBe('a&lt;b');
        });

        it('escapes greater-than', () => {
            expect(escHtml('a>b')).toBe('a&gt;b');
        });

        it('escapes double quotes for attribute contexts', () => {
            expect(escHtml('a"b')).toBe('a&quot;b');
        });

        it('escapes single quotes, so single-quoted attribute values are safe too', () => {
            expect(escHtml("a'b")).toBe('a&#39;b');
        });

        it('escapes multiple special characters', () => {
            expect(escHtml('<a&b>')).toBe('&lt;a&amp;b&gt;');
        });

        it('returns plain text unchanged', () => {
            expect(escHtml('hello world')).toBe('hello world');
        });

        it('returns empty string unchanged', () => {
            expect(escHtml('')).toBe('');
        });

        it('handles string with only special characters', () => {
            expect(escHtml('&<>')).toBe('&amp;&lt;&gt;');
        });

        it('handles repeated special characters', () => {
            expect(escHtml('&&<<>>')).toBe('&amp;&amp;&lt;&lt;&gt;&gt;');
        });
    });
});
