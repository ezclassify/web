/**
 * Pure logic functions for the MarkedTextArea component.
 *
 * All functions are side-effect-free: no DOM, no event listeners, no engine
 * calls. They extract and transform marking strings.
 */

import { t } from '../i18n';

/** Embedded pattern entry from a scheme's embeddedMarking configuration. */
interface EmbeddedPattern {
    pattern: string;
}

/** Minimal segment shape needed by applyRepairs. */
export interface RepairSegment {
    start: number;
    end: number;
    marking: string;
    rendered: string;
    repaired: boolean;
}

/** Minimal scan-result shape needed by {@link keepLeadingPartMarks}. */
export interface ScannedMarking {
    /** Character offset of the wrapped marking's opening delimiter. */
    start: number;
}

/**
 * Match the genuine leading part mark at the very start of a field value.
 *
 * A scheme's `embeddedMarking` wrapper pattern is often written with a greedy
 * quantifier (e.g. `\((.+)\)`). Run greedily against a field whose prose
 * contains a later closing delimiter, e.g. "(A) note: see section (b) below."
 * The match spans from the leading "(" all the way to the prose paren, so the
 * marking chip swallows the whole sentence. The leading part mark is only the
 * first wrapped token, so match it minimally: anchor at the start and make the
 * pattern's quantifiers reluctant. Falls back to the unmodified, start-anchored
 * pattern when the reluctant form does not match at index 0.
 *
 * @param value - The field value
 * @param pattern - The scheme's embeddedMarking regex source
 * @returns The leading marking string (e.g. "(U)") or '' when none leads
 */
export function matchLeadingMark(value: string, pattern: string): string {
    if (!value || !pattern) return '';
    // Anchor at start so we only ever accept a leading mark.
    const anchored = pattern.startsWith('^') ? pattern : `^(?:${pattern})`;
    // Make greedy quantifiers reluctant so the FIRST closing delimiter wins, not
    // the last. Only the bare quantifiers are touched (a following '?' means it is
    // already reluctant/optional and is left alone).
    const reluctant = anchored.replace(/([.\])])([+*])(?![?])/g, '$1$2?');
    for (const src of [reluctant, anchored]) {
        try {
            const m = new RegExp(src).exec(value);
            if (m && m.index === 0 && m[0]) return m[0];
        } catch {
            /* malformed transform, try the next candidate */
        }
    }
    return '';
}

/**
 * Keep only wrapped markings that sit at the start of a line (a genuine
 * leading/explicit part mark), discarding ones embedded mid-prose.
 *
 * The engine's scan walks the whole field text with the scheme's wrapper
 * pattern (parenthesized tokens), so ordinary prose that happens to contain a
 * parenthesized abbreviation or citation, e.g. "OCA/EO 13526, §1.2(a)", gets
 * matched as a part mark in addition to the field's real leading "(U)". A
 * marked field carries at most one part mark per line/paragraph and it always
 * leads that line; a wrapped token that appears _after_ non-blank text on its
 * line is prose, not a marking.
 *
 * A marking qualifies when everything between the start of its line and the
 * mark's opening delimiter is whitespace. This preserves multi-paragraph fields
 * (each paragraph's leading mark starts its own line) while dropping the
 * citation/abbreviation false positives.
 *
 * @param scanned - Wrapped scan results in document order (each carries
 *   `start`)
 * @param text - The full field text the offsets index into
 */
export function keepLeadingPartMarks<T extends ScannedMarking>(
    scanned: T[],
    text: string,
): T[] {
    return scanned.filter((r) => {
        const lineStart = text.lastIndexOf('\n', r.start - 1) + 1;
        // Genuine leading mark: only whitespace precedes it on its own line.
        return text.slice(lineStart, r.start).trim().length === 0;
    });
}

/**
 * Extract the inner content from a wrapped marking using the scheme's embedded
 * patterns. Falls back to stripping leading "(" and trailing ")".
 */
export function extractInner(
    marking: string,
    embeddedPatterns: EmbeddedPattern[],
): string {
    let inner = marking.replace(/^\(|\)$/g, '').trim();
    for (const style of embeddedPatterns) {
        const re = new RegExp(style.pattern);
        const m = re.exec(marking);
        if (m?.[1]) {
            inner = m[1];
            break;
        }
    }
    return inner;
}

/**
 * Write a rendered part marking as it appears in the field.
 *
 * Most schemes render a part marking bare ("S//NF") and the embedded template
 * adds the wrapper. A scheme may instead spell the wrapper in the part view
 * itself, so a concept renders as "(gluten)": that rendering already is one
 * whole embedded mark, and wrapping it again would write "((gluten))". The
 * pattern that belongs to the template decides, read the way a leading mark is
 * read, so a greedy pattern cannot take "(A)//(B)" for a single mark.
 *
 * @param rendered - The engine's rendering of the part marking
 * @param template - The embedded marking template (e.g. "({marking}) ")
 * @param pattern - The embedded marking pattern declared with that template
 * @returns The field text for the marking, or '' for an empty rendering
 */
export function wrapPartMark(
    rendered: string,
    template: string,
    pattern: string | undefined,
): string {
    if (!rendered) return '';
    if (pattern && matchLeadingMark(rendered, pattern) === rendered) {
        return rendered;
    }
    return template.replace('{marking}', rendered);
}

/** Minimal applied-change shape needed by {@link fixesNeedingCorrection}. */
export interface CorrectableChange {
    message: string;
    action?: string;
    add?: readonly { conceptId: string }[];
}

/**
 * The applied fixes that would change what a loaded marking says.
 *
 * A marking loaded into a field is shown as needing correction when the engine
 * had to change it. Two kinds of applied fix change nothing the author could
 * write differently. Tolerant recognition (`reorder`: case, alias, order,
 * separator) read the marking as written and changed no fact. A concept the
 * engine added that the field's format never writes (a scheme-derived implicit
 * concept its render hides) cannot appear in the text however the author writes
 * it. Flagging either would ask for a correction that leaves the field as it
 * is, forever.
 *
 * @param fixes - The engine's applied fixes for the loaded marking
 * @param omittedConceptIds - Concepts the field's format leaves out of its
 *   rendering of the result
 */
export function fixesNeedingCorrection<T extends CorrectableChange>(
    fixes: readonly T[],
    omittedConceptIds: ReadonlySet<string>,
): T[] {
    return fixes.filter((change) => {
        if (change.action === 'reorder') return false;
        const added = change.add ?? [];
        if (
            change.action === 'add' &&
            added.length > 0 &&
            added.every((ref) => omittedConceptIds.has(ref.conceptId))
        ) {
            return false;
        }
        return true;
    });
}

/**
 * Patch textarea content when repair changed any marking's rendered form.
 * Returns the new value, cumulative drift, and whether any patch was applied.
 *
 * @param segments - The current marking segments with repair flags
 * @param textareaValue - The current textarea value
 * @param embeddedTemplate - The embedded marking template (e.g. "({marking}) ")
 * @param embeddedPattern - The embedded marking pattern declared with the
 *   template, so a rendering that already carries its wrapper is not wrapped
 *   twice
 */
export function applyRepairs(
    segments: RepairSegment[],
    textareaValue: string,
    embeddedTemplate: string,
    embeddedPattern?: string,
): { value: string; drift: number; patched: boolean } {
    let v = textareaValue;
    let drift = 0;
    let patched = false;

    for (const seg of segments) {
        if (!seg.repaired) continue;
        const corrected = wrapPartMark(
            seg.rendered,
            embeddedTemplate,
            embeddedPattern,
        ).trimEnd();
        if (corrected === seg.marking) continue;

        const adjStart = seg.start + drift;
        const adjEnd = seg.end + drift;
        v = v.slice(0, adjStart) + corrected + v.slice(adjEnd);
        drift += corrected.length - (seg.end - seg.start);
        patched = true;
    }

    return { value: v, drift, patched };
}

/** What a mark with something to say tells the user about itself. */
export interface MarkAttention {
    /**
     * Tooltip text: one message per line, so the first message is the title and
     * each reads on its own.
     */
    readonly tooltip: string;
    /** The mark's accessible name as a button that opens its editor. */
    readonly label: string;
}

/**
 * The tooltip and accessible name of a mark that breaks rules (`invalid`) or
 * carries warnings (`warning`), from the engine's messages for it.
 *
 * @param kind - Which state the mark is in
 * @param messages - The engine's messages, in its order; at least one
 */
export function markAttention(
    kind: 'invalid' | 'warning',
    messages: readonly string[],
): MarkAttention {
    const sentences = messages
        .map((m) => m.trim())
        .filter(Boolean)
        .map((m) => (/[.!?]$/.test(m) ? m : `${m}.`));
    return {
        tooltip: sentences.join('\n'),
        label: t(
            kind === 'invalid' ? 'mark.invalidLabel' : 'mark.warningLabel',
        ).replace('{messages}', sentences.join(' ')),
    };
}

/**
 * The paragraph a position in a document body falls in, counted from 1. Blank
 * lines separate paragraphs and are not paragraphs themselves, so a body that
 * leaves an empty line between its paragraphs numbers them the way a reader
 * does.
 *
 * @param text - The body text
 * @param at - A position in it
 */
export function paragraphNumber(text: string, at: number): number {
    const before = text.slice(0, Math.max(0, at)).split('\n');
    // Every line before the one `at` is on, that holds text, is a paragraph
    // before this one.
    return before.slice(0, -1).filter((line) => line.trim()).length + 1;
}
