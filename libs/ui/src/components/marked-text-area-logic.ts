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

/**
 * Match the wrapped mark at the very start of a field value.
 *
 * The scheme's `embeddedMarking` pattern is applied as written, anchored at the
 * start, the way the engine's scan reads it. A greedy pattern such as
 * `\((.+)\)` therefore reaches the last closing delimiter on the line, as it
 * does in the scan.
 *
 * @param value - The field value
 * @param pattern - The scheme's embeddedMarking regex source
 * @returns The leading marking string (e.g. "(U)") or '' when none leads
 */
export function matchLeadingMark(value: string, pattern: string): string {
    if (!value || !pattern) return '';
    const anchored = pattern.startsWith('^') ? pattern : `^(?:${pattern})`;
    try {
        const m = new RegExp(anchored).exec(value);
        return m?.[0] ?? '';
    } catch {
        return '';
    }
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
 * pattern that belongs to the template decides, read as a leading mark is.
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
