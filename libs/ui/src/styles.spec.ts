import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
    getDefaultStyles,
    injectDefaultStyles,
    EZ_CSS_VARIABLES,
} from './styles';
import { adoptedStyleTexts, hasAdoptedStyles } from './styles/adopt';

describe('styles', () => {
    describe('EZ_CSS_VARIABLES', () => {
        it('is a string', () => {
            expect(typeof EZ_CSS_VARIABLES).toBe('string');
        });

        it('defines dropdown highlight and checked accents in each palette', () => {
            // MarkingField mounts beside its host, outside a component container.
            // Dropdown aliases therefore need :root fallbacks and dark/light
            // redeclarations so nested themes resolve their own palette.
            //
            // This source check establishes declaration placement only, not browser
            // cascade results. Read styles.css directly because vitest's inline CSS
            // transform returns an empty string in this environment.
            const css = readFileSync(
                join(dirname(fileURLToPath(import.meta.url)), 'styles.css'),
                'utf8',
            );
            const tokens = [
                '--ez-dropdown-highlight',
                '--ez-dropdown-selected',
            ];

            const rootBlockMatch = css.match(
                /:where\(:root\)\s*\{([\s\S]*?)\n\}/,
            );
            expect(rootBlockMatch).not.toBeNull();
            const rootBlock = rootBlockMatch![1];

            const darkBlockMatch = css.match(
                /\[data-color-scheme='dark'\][\s\S]*?\{([\s\S]*?)\n\}/,
            );
            expect(darkBlockMatch).not.toBeNull();
            const darkBlock = darkBlockMatch![1];

            const lightBlockMatch = css.match(
                /\[data-color-scheme='light'\][\s\S]*?\{([\s\S]*?)\n\}/,
            );
            expect(lightBlockMatch).not.toBeNull();
            const lightBlock = lightBlockMatch![1];

            for (const token of tokens) {
                expect(rootBlock, `:root must declare ${token}`).toContain(
                    token,
                );
                expect(
                    darkBlock,
                    `the dark theme block must redeclare ${token} so it re-resolves against the dark palette`,
                ).toContain(token);
                expect(
                    lightBlock,
                    `the light theme block must redeclare ${token} so a nested light island re-resolves against the light palette`,
                ).toContain(token);
            }
        });

        it('defines --ez-color-border-focus/--ez-focus-ring-shadow in every theme block, not only the component-scope block', () => {
            // Focus aliases resolve the primary palette at their declaration site.
            // Standalone .ez-input.ez-styled inputs need :root fallbacks and each
            // theme's own declarations. This source check establishes placement,
            // not actual browser focus/cascade results.
            const css = readFileSync(
                join(dirname(fileURLToPath(import.meta.url)), 'styles.css'),
                'utf8',
            );
            const tokens = [
                '--ez-color-border-focus',
                '--ez-focus-ring-shadow',
            ];

            const rootBlockMatch = css.match(
                /:where\(:root\)\s*\{([\s\S]*?)\n\}/,
            );
            expect(rootBlockMatch).not.toBeNull();
            const rootBlock = rootBlockMatch![1];

            const darkBlockMatch = css.match(
                /\[data-color-scheme='dark'\][\s\S]*?\{([\s\S]*?)\n\}/,
            );
            expect(darkBlockMatch).not.toBeNull();
            const darkBlock = darkBlockMatch![1];

            const lightBlockMatch = css.match(
                /\[data-color-scheme='light'\][\s\S]*?\{([\s\S]*?)\n\}/,
            );
            expect(lightBlockMatch).not.toBeNull();
            const lightBlock = lightBlockMatch![1];

            for (const token of tokens) {
                expect(rootBlock, `:root must declare ${token}`).toContain(
                    token,
                );
                expect(
                    darkBlock,
                    `the dark theme block must redeclare ${token} so it re-resolves against the dark palette`,
                ).toContain(token);
                expect(
                    lightBlock,
                    `the light theme block must redeclare ${token} so a nested light island re-resolves against the light palette`,
                ).toContain(token);
            }
        });

        it('lets host layout tokens inherit through every generated field mount', () => {
            const css = readFileSync(
                join(dirname(fileURLToPath(import.meta.url)), 'styles.css'),
                'utf8',
            );
            const root = css.match(/:where\(:root\)\s*\{([\s\S]*?)\n\}/)![1];
            for (const token of [
                '--ez-border-radius',
                '--ez-border-width',
                '--ez-spacing-xs',
                '--ez-spacing-sm',
                '--ez-spacing-md',
                '--ez-spacing-lg',
                '--ez-transition',
                '--ez-z-dropdown',
                '--ez-z-tooltip',
            ]) {
                expect(root).toContain(`${token}:`);
                expect(css.match(new RegExp(`${token}:`, 'g'))).toHaveLength(1);
            }
        });

        it('declares every layer token the package reads, so a host that sets the documented tokens can see each layer default', () => {
            // A layer token read by a component but declared nowhere has no
            // default a host could read or shadow.
            const here = dirname(fileURLToPath(import.meta.url));
            const files = [
                'styles.css',
                'components/concept-tooltip.css',
                'components/coverage-action.css',
                'components/inline-marking-editor.css',
                'components/overlay-portal.ts',
                'forms/styles.ts',
            ];
            const read = new Set<string>();
            for (const file of files) {
                const text = readFileSync(join(here, file), 'utf8');
                for (const match of text.matchAll(/--ez-z-[a-z-]+/g)) {
                    read.add(match[0]);
                }
            }
            expect([...read].sort()).toEqual([
                '--ez-z-dropdown',
                '--ez-z-tooltip',
            ]);
            // Reads styles.css itself, for the reason the theme test above
            // records: the `?inline` import is empty in this environment.
            const css = readFileSync(join(here, 'styles.css'), 'utf8');
            for (const token of read) {
                expect(css).toContain(`${token}:`);
            }
        });
    });

    describe('getDefaultStyles', () => {
        it('returns the default stylesheet text', () => {
            expect(getDefaultStyles()).toBe(EZ_CSS_VARIABLES);
        });
    });

    describe('injectDefaultStyles', () => {
        it('adopts the default stylesheet onto the document', () => {
            injectDefaultStyles();
            expect(hasAdoptedStyles(getDefaultStyles())).toBe(true);
        });

        it('creates no style element, so a host can forbid inline styles', () => {
            injectDefaultStyles();
            expect(document.head.querySelector('style')).toBeNull();
        });

        it('adopts the sheet only once on the document', () => {
            injectDefaultStyles();
            injectDefaultStyles();
            const adopted = adoptedStyleTexts().filter(
                (css) => css === getDefaultStyles(),
            );
            expect(adopted).toHaveLength(1);
        });

        it('adopts into the shadow root that owns a custom root', () => {
            const host = document.createElement('div');
            document.body.appendChild(host);
            const shadow = host.attachShadow({ mode: 'open' });
            const root = document.createElement('div');
            shadow.appendChild(root);

            injectDefaultStyles(root);
            expect(hasAdoptedStyles(getDefaultStyles(), shadow)).toBe(true);
            host.remove();
        });

        it('does not duplicate when adopted into the same root twice', () => {
            const host = document.createElement('div');
            document.body.appendChild(host);
            const shadow = host.attachShadow({ mode: 'open' });
            const root = document.createElement('div');
            shadow.appendChild(root);

            injectDefaultStyles(root);
            injectDefaultStyles(root);
            expect(
                adoptedStyleTexts(shadow).filter(
                    (css) => css === getDefaultStyles(),
                ),
            ).toHaveLength(1);
            host.remove();
        });
    });
});
