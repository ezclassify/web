import { describe, it, expect } from 'vitest';
import { THEMES, applyTheme, EzTheme } from './themes';

describe('themes', () => {
    describe('THEMES', () => {
        it('contains government theme', () => {
            expect(THEMES.government).toBeDefined();
            expect(THEMES.government.name).toBe('Government');
        });

        it('contains corporate theme', () => {
            expect(THEMES.corporate).toBeDefined();
            expect(THEMES.corporate.name).toBe('Corporate');
        });

        it('contains minimal theme', () => {
            expect(THEMES.minimal).toBeDefined();
            expect(THEMES.minimal.name).toBe('Minimal');
        });

        it('contains dark theme', () => {
            expect(THEMES.dark).toBeDefined();
            expect(THEMES.dark.name).toBe('Dark');
        });

        it('has 4 themes total', () => {
            expect(Object.keys(THEMES)).toHaveLength(4);
        });

        it('each theme has required sections', () => {
            for (const theme of Object.values(THEMES)) {
                expect(theme.input).toBeDefined();
                expect(theme.dropdown).toBeDefined();
                expect(theme.badge).toBeDefined();
                expect(theme.notice).toBeDefined();
                expect(typeof theme.name).toBe('string');
            }
        });

        it('each theme input section has color variables', () => {
            for (const theme of Object.values(THEMES)) {
                expect(theme.input['--ez-color-text']).toBeDefined();
                expect(theme.input['--ez-color-background']).toBeDefined();
                expect(theme.input['--ez-color-border']).toBeDefined();
            }
        });
    });

    describe('applyTheme', () => {
        it('generates CSS with data-theme selector', () => {
            const css = applyTheme(THEMES.government);
            expect(css).toContain('[data-theme="government"]');
        });

        it('includes all CSS custom properties', () => {
            const css = applyTheme(THEMES.corporate);
            expect(css).toContain('--ez-color-text');
            expect(css).toContain('--ez-color-background');
            expect(css).toContain('--ez-dropdown-background');
            expect(css).toContain('--ez-color-primary');
        });

        it('slugifies theme name for selector', () => {
            const customTheme: EzTheme = {
                name: 'My Custom Theme',
                input: { '--ez-color-text': '#000' },
                dropdown: {},
                badge: {},
                notice: {},
            };
            const css = applyTheme(customTheme);
            expect(css).toContain('[data-theme="my-custom-theme"]');
        });

        it('produces valid CSS block format', () => {
            const css = applyTheme(THEMES.minimal);
            expect(css).toMatch(/^\[data-theme="minimal"\] \{/);
            expect(css).toMatch(/\}$/);
        });

        it('formats declarations with proper indentation', () => {
            const css = applyTheme(THEMES.dark);
            const lines = css.split('\n');
            // First line is selector, last line is closing brace
            for (let i = 1; i < lines.length - 1; i++) {
                expect(lines[i]).toMatch(/^\s{2}--ez-/);
            }
        });

        it('merges all sections into declarations', () => {
            const theme: EzTheme = {
                name: 'Test',
                input: { '--a': '1' },
                dropdown: { '--b': '2' },
                badge: { '--c': '3' },
                notice: { '--d': '4' },
            };
            const css = applyTheme(theme);
            expect(css).toContain('--a: 1;');
            expect(css).toContain('--b: 2;');
            expect(css).toContain('--c: 3;');
            expect(css).toContain('--d: 4;');
        });
    });
});
