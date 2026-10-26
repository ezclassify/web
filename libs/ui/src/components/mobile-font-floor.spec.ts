import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/**
 * IOS Safari zooms the page whenever a focused field's effective font-size is
 * under 16px. Every field a user can tap into must floor its font under a
 * coarse pointer, or the first tap on a phone zooms the viewport. This locks
 * the floor onto the actual focus targets (the invisible capture layers) and
 * their display layers so a later refactor cannot quietly drop it.
 *
 * The stylesheets are asserted from disk: the `?inline` CSS import is stubbed
 * to an empty string in the test transform, so the source file is the only
 * thing worth pinning.
 */
describe('mobile font-size floor (iOS focus-zoom guard)', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const readCss = (name: string): string =>
        readFileSync(join(here, name), 'utf8');

    /** Concatenate the bodies of every `@media (pointer: coarse)` block. */
    function coarseBlock(css: string): string {
        const marker = '@media (pointer: coarse)';
        let from = 0;
        let out = '';
        for (;;) {
            const start = css.indexOf(marker, from);
            if (start < 0) break;
            const open = css.indexOf('{', start);
            let depth = 0;
            let close = -1;
            for (let i = open; i < css.length; i++) {
                if (css[i] === '{') depth++;
                else if (css[i] === '}') {
                    depth--;
                    if (depth === 0) {
                        close = i;
                        break;
                    }
                }
            }
            if (close < 0) throw new Error('unbalanced coarse-pointer block');
            out += css.slice(open + 1, close);
            from = close + 1;
        }
        expect(out.length).toBeGreaterThan(0);
        return out;
    }

    it('MarkedInput floors the native capture and display layers', () => {
        const block = coarseBlock(readCss('marked-input.css'));
        expect(block).toContain('textarea.marked-input-native');
        expect(block).toContain('.marked-input-display');
        expect(block).toContain('font-size: max(1em, 16px)');
    });

    it('MarkedTextArea floors the native capture and display layers', () => {
        const block = coarseBlock(readCss('marked-text-area.css'));
        expect(block).toContain('textarea.marked-textarea-input');
        expect(block).toContain('.marked-textarea-display');
        expect(block).toContain('font-size: max(1em, 16px)');
    });

    it('InlineMarkingEditor floors the input and its width sizer', () => {
        const block = coarseBlock(readCss('inline-marking-editor.css'));
        expect(block).toContain('.inline-editor-input');
        expect(block).toContain('.inline-editor-sizer');
        expect(block).toContain('font-size: max(1em, 16px)');
    });

    it('picker rows and the favorites list rows meet the 44px touch target', () => {
        // Unconditional, not coarse-gated, which satisfies touch a fortiori.
        expect(readCss('composer/composer.css')).toMatch(
            /\.ez-composer__row\s*\{[^}]*min-height: 2\.75rem/,
        );
        expect(readCss('component-utils.css')).toMatch(
            /\.proto-dropdown-item[^}]*min-height: 2\.75rem/s,
        );
    });
});
