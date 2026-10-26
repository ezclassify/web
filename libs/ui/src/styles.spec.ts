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

        it('defines dropdown row/header/checked colors in every theme block, not only :root', () => {
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
                '--ez-dropdown-background',
                '--ez-dropdown-color',
                '--ez-dropdown-highlight',
                '--ez-dropdown-selected',
            ];

            const rootBlockMatch = css.match(/:root\s*\{([\s\S]*?)\n\}/);
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

            // Theme-sensitive aliases belong in the theme blocks, not solely in
            // the theme-invariant component block.
            const scopedBlockMatch = css.match(
                /\.ez-root,\s*\n\[data-ezclassify\]\s*\{([\s\S]*?)\n\}/,
            );
            expect(scopedBlockMatch).not.toBeNull();
            const scopedBlock = scopedBlockMatch![1];
            for (const token of tokens) {
                expect(scopedBlock).not.toContain(`${token}:`);
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

            const rootBlockMatch = css.match(/:root\s*\{([\s\S]*?)\n\}/);
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

            // The component block alone cannot supply these theme-sensitive aliases.
            const scopedBlockMatch = css.match(
                /\.ez-root,\s*\n\[data-ezclassify\]\s*\{([\s\S]*?)\n\}/,
            );
            expect(scopedBlockMatch).not.toBeNull();
            const scopedBlock = scopedBlockMatch![1];
            for (const token of tokens) {
                expect(scopedBlock).not.toContain(`${token}:`);
            }
        });

        it('leaves --ez-select-active-border/--ez-select-active-bg scoped to the component block (audited, no reachable gap)', () => {
            // Counterpoint to the two tests above: these are the SAME shape
            // of alias (var() over --ez-color-primary) and were reviewed by
            // the same audit, but their only consumer (SingleSelect's
            // `.select-card`) is always appended directly into
            // `this.container`, which component-base-readonly.ts stamps
            // with `data-ezclassify` in the same code path that creates it.
            // It is never portaled (no overlay-portal usage in
            // single-select.ts) or sibling-mounted the way MarkingField's
            // wrap is, so there is no reachable gap to close. This guards
            // against someone "fixing" them later under the assumption that
            // every var(--ez-color-primary) alias in this block leaks out of
            // its scope; it doesn't, unless a consumer actually escapes the
            // scope.
            const css = readFileSync(
                join(dirname(fileURLToPath(import.meta.url)), 'styles.css'),
                'utf8',
            );
            const scopedBlockMatch = css.match(
                /\.ez-root,\s*\n\[data-ezclassify\]\s*\{([\s\S]*?)\n\}/,
            );
            expect(scopedBlockMatch).not.toBeNull();
            const scopedBlock = scopedBlockMatch![1];
            expect(scopedBlock).toContain('--ez-select-active-border:');
            expect(scopedBlock).toContain('--ez-select-active-bg:');
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
