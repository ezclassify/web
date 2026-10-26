/**
 * Text geometry for the composer: which part of the typed text the caret is
 * completing, and how an accepted suggestion takes that part's place.
 *
 * The composer's input holds exactly what the user typed. A suggestion never
 * rewrites the whole value; it replaces the caret-bounded token and leaves
 * every other character where the user put it. Token boundaries come from two
 * places: the active render format's own separators (scheme data, never a fixed
 * set here) and whitespace. Whitespace is a soft boundary because concept
 * labels can contain spaces: the token is the longest run of words in front of
 * the caret that still reads as the start of something the caller can match.
 */

/** A half-open character range `[start, end)` in the typed text. */
export interface TextRange {
    readonly start: number;
    readonly end: number;
}

/** The caret-bounded token and the text it covers. */
export interface CaretToken extends TextRange {
    /** The token text, trimmed. Empty when the caret starts a fresh token. */
    readonly query: string;
}

/** The result of splicing a replacement into the typed text. */
export interface SpliceResult {
    readonly text: string;
    /** Caret offset just past the inserted text and its trailing space. */
    readonly caret: number;
}

/**
 * Separators sorted longest first, so a multi-character separator such as `//`
 * is consumed as a unit instead of leaving a stray half of it behind.
 */
function orderedSeparators(separators: readonly string[]): string[] {
    return [...new Set(separators.filter((s) => s.trim().length > 0))].sort(
        (a, b) => b.length - a.length,
    );
}

/**
 * The separator-bounded segment around `caret`. Only separators with visible
 * characters bound a segment; a separator that is pure whitespace would split
 * every multi-word label, so whitespace is left to {@link caretToken}.
 */
export function segmentAround(
    text: string,
    caret: number,
    separators: readonly string[],
): TextRange {
    const seps = orderedSeparators(separators);
    let start = 0;
    let end = text.length;
    let i = 0;
    while (i < text.length) {
        const sep = seps.find((s) => text.startsWith(s, i));
        if (!sep) {
            if (text[i] === '\n') {
                if (i < caret) start = i + 1;
                else if (i >= caret) {
                    end = Math.min(end, i);
                    break;
                }
            }
            i++;
            continue;
        }
        if (i + sep.length <= caret) {
            start = i + sep.length;
        } else if (i >= caret) {
            end = i;
            break;
        } else {
            // The caret sits inside a separator: the segment starts after it.
            start = i + sep.length;
        }
        i += sep.length;
    }
    return { start, end: Math.max(start, end) };
}

const WHITESPACE = /\s/;

/**
 * Find the token the caret is completing.
 *
 * The token ends at the end of the word under the caret, so editing the middle
 * of a word replaces the whole word. It starts at the earliest word start in
 * the caret's segment whose text still has a match (per `hasMatch`), falling
 * back to the word under the caret. A caret that follows whitespace starts a
 * fresh, empty token: the user has finished the previous word.
 *
 * @param text - The typed text
 * @param caret - The caret offset
 * @param separators - The active render format's separators
 * @param hasMatch - Whether a candidate query matches anything worth offering
 */
export function caretToken(
    text: string,
    caret: number,
    separators: readonly string[],
    hasMatch: (query: string) => boolean,
): CaretToken {
    const at = Math.max(0, Math.min(caret, text.length));
    const segment = segmentAround(text, at, separators);
    let end = at;
    while (end < segment.end && !WHITESPACE.test(text[end])) end++;
    // A caret at the start of a word (segment start or just after whitespace)
    // completes only the word it sits in front of, if any.
    if (at === segment.start || WHITESPACE.test(text[at - 1])) {
        return { start: at, end, query: text.slice(at, end).trim() };
    }

    const wordStarts: number[] = [];
    for (let i = segment.start; i < at; i++) {
        const prev = i === segment.start ? ' ' : text[i - 1];
        if (!WHITESPACE.test(text[i]) && WHITESPACE.test(prev)) {
            wordStarts.push(i);
        }
    }
    if (wordStarts.length === 0) return { start: at, end, query: '' };
    const last = wordStarts[wordStarts.length - 1];
    for (const start of wordStarts) {
        if (start === last) break;
        const query = text.slice(start, end).trim();
        if (query && hasMatch(query)) return { start, end, query };
    }
    return { start: last, end, query: text.slice(last, end).trim() };
}

/**
 * Replace `range` with `insert`, keeping the neighbors readable: a space is
 * added where the insert would otherwise fuse with a word on either side, and a
 * trailing space follows an insert at the end of the text so the next keystroke
 * starts a fresh token instead of extending the accepted one.
 */
export function spliceToken(
    text: string,
    range: TextRange,
    insert: string,
    separators: readonly string[],
): SpliceResult {
    const seps = orderedSeparators(separators);
    const before = text.slice(0, range.start);
    const after = text.slice(range.end);
    const endsSoft =
        before.length === 0 ||
        WHITESPACE.test(before[before.length - 1]) ||
        seps.some((s) => before.endsWith(s));
    const startsSoft =
        after.length === 0 ||
        WHITESPACE.test(after[0]) ||
        seps.some((s) => after.startsWith(s));
    const lead = endsSoft ? '' : ' ';
    const trail = after.length === 0 ? ' ' : startsSoft ? '' : ' ';
    const next = before + lead + insert + trail + after;
    return {
        text: next,
        caret: before.length + lead.length + insert.length + trail.length,
    };
}
