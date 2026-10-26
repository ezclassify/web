/**
 * Shown where a surface has a slot but no value for it yet. One constant so
 * every surface says the same thing, and a word rather than a dash so a screen
 * reader announces the empty state instead of skipping it.
 */
export const EMPTY_VALUE = '(empty)';

/**
 * Escape `&`, `<`, `>`, `"`, and `'` for safe insertion into innerHTML.
 *
 * The output is safe in a text node and in an attribute value quoted either
 * way. Every HTML-building call site in the library shares this one helper, and
 * the text reaching it is scheme-authored, so the guarantee has to hold for the
 * next call site as well as the current ones.
 *
 * @param s - Raw text
 * @returns The same text with HTML-significant characters escaped
 */
export function escHtml(s: string): string {
    return s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}
