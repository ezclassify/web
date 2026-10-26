/**
 * Whether a write of a marking was refused, and why, for the paths that paint a
 * write into a native input.
 *
 * A refused write is the opaque refusal marker and nothing else, so painting it
 * would replace the author's text with a marker. A path that paints a write
 * asks here first and, when it was refused, keeps the text and shows these
 * messages instead.
 */

import type { RenderAssessment } from '@ezclassify/types';

/**
 * Whether a write could not be made: a field had conflicting values, or a fact
 * or the whole output could not be written. A write that carries no assessment
 * (a rolled-up state, which writes no output of its own) was not refused.
 *
 * @param write - The write, with what writing it did
 * @returns True when the write must not reach the DOM
 */
export function renderViewRefused(write: {
    assessment?: RenderAssessment;
}): boolean {
    return (
        write.assessment !== undefined &&
        (write.assessment.conflicts.length > 0 ||
            write.assessment.unrepresentable.length > 0)
    );
}

/**
 * Explain a refused write, one message per conflict and per thing that could
 * not be written. The engine's own detail wins where it gives one.
 *
 * @param format - The output the write was for, as the field names it
 * @param write - The refused write
 * @returns The messages, empty when nothing was refused
 */
export function renderViewRefusalMessages(
    format: string,
    write: { assessment?: RenderAssessment },
): string[] {
    if (!write.assessment) return [];
    return [
        ...write.assessment.conflicts.map(
            (conflict) =>
                `Cannot display format "${format}": field "${conflict.field}" has conflicting values.`,
        ),
        ...write.assessment.unrepresentable.map(
            (value) =>
                value.detail ??
                ('conceptId' in value
                    ? `Cannot display format "${format}": concept "${value.conceptId}" is ${value.reason}.`
                    : `Cannot display format "${format}": output "${value.output}" was refused (${value.reason}).`),
        ),
    ];
}
