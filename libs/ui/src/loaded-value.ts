/**
 * What a marking field holds after the engine reads what it was given, and the
 * engine's judgment of that value.
 *
 * A field displays the engine's result and decides no marking semantics. It
 * holds the engine's rendering verbatim, with every fix and addition the engine
 * applied and any text the engine could not read where the engine wrote it. The
 * errors, warnings and ways to fix it shows are the engine's judgment of that
 * value, so an action taken from them works on the value the field holds and
 * never brings back something a fix removed.
 */
import type {
    Assertion,
    ProcessResult,
    RecognitionResult,
    ValidateResult,
} from '@ezclassify/types';
import { renderViewRefused } from './render-refusal';

/** What {@link acceptedValue} reads from an engine result. */
export type AcceptedValueResult = Pick<
    ProcessResult | ValidateResult,
    'rendered' | 'recognition'
> & { readonly assessment?: ProcessResult['assessment'] };

/**
 * The value a marking field holds after the engine read the author's text: the
 * engine's rendering, exactly as the engine wrote it.
 *
 * The author's text stands only where the result says the rendering is not a
 * reading of it (see {@link keepsSource}).
 *
 * @param source - The text the author supplied
 * @param result - The engine's reading of exactly that text
 * @returns The text the field holds
 */
export function acceptedValue(
    source: string,
    result: AcceptedValueResult,
): string {
    return keepsSource(result) ? source : result.rendered;
}

/**
 * Whether a text read leaves the author's text standing: the result carries no
 * recognition, which every text read has, or the engine refused to write the
 * rendering (its assessment names conflicts or facts it could not write). The
 * value is then not the engine's writing, so the engine's account of its
 * writing (the render assessment) is not about the value.
 *
 * @param result - The engine's reading of the author's text
 */
export function keepsSource(result: AcceptedValueResult): boolean {
    return !result.recognition || renderViewRefused(result);
}

/** What {@link judgedAsHeld} reads and replaces in an engine result. */
export interface HeldReading {
    rendered: string;
    assertions: Assertion[];
    valid: boolean;
    errors?: ValidateResult['errors'];
    warnings?: ValidateResult['warnings'];
    proposedFixes?: ProcessResult['proposedFixes'];
    recognition?: RecognitionResult;
    assertionsBeforeRepair?: Assertion[];
    assessment?: ProcessResult['assessment'];
}

/**
 * The engine's result for the value a field holds once it has read `asked`.
 *
 * The engine already judges its resulting value, including applied repairs.
 * Only unread text moved by rendering needs a second read: recognition spans
 * refer to the input, so reading the held text obtains its current offsets.
 *
 * The rest stays from the first read, the one that saw what the author gave:
 * the value, the facts with who stated them, the fixes the engine applied, and
 * the assessment of writing the value.
 *
 * @param asked - The text or facts the first read was given
 * @param first - That read's answer
 * @param readAgain - Read the value `first` settled on, the same way the first
 *   read was made: its rendering for a text read, its facts for a read of
 *   facts
 * @returns `first`, judged as the value the field holds
 */
export function judgedAsHeld<T extends HeldReading>(
    asked: string | readonly Assertion[],
    first: T | PromiseLike<T>,
    readAgain: (settled: T) => T | PromiseLike<T>,
): T | Promise<T> {
    const judge = (settled: T): T | Promise<T> => {
        // Unread text the engine moved: the recognition's spans are offsets
        // into the text given, not into the value.
        const unreadMoved =
            typeof asked === 'string' &&
            (settled.recognition?.unmatched?.length ?? 0) > 0 &&
            acceptedValue(asked, settled) !== asked;
        if (!unreadMoved) return settled;
        return Promise.resolve(readAgain(settled)).then((again) =>
            heldJudgment(settled, again, typeof asked === 'string'),
        );
    };
    return isThenable(first)
        ? Promise.resolve(first).then(judge)
        : judge(first);
}

/** `settled` with the judgment of `again`, the reading of its own value. */
function heldJudgment<T extends HeldReading>(
    settled: T,
    again: T,
    text: boolean,
): T {
    // Every text read carries recognition. One that does not is no reading
    // of the value, so the value has no judgment of its own to take.
    if (text && !again.recognition) return settled;
    const held: T = {
        ...settled,
        valid: again.valid,
        errors: again.errors,
        warnings: again.warnings,
    };
    if ('proposedFixes' in again) held.proposedFixes = again.proposedFixes;
    // The repair is settled: nothing in the value was read before it.
    delete held.assertionsBeforeRepair;
    if (text) held.recognition = again.recognition;
    return held;
}

function isThenable<T>(value: T | PromiseLike<T>): value is PromiseLike<T> {
    return (
        typeof value === 'object' &&
        value !== null &&
        typeof (value as PromiseLike<T>).then === 'function'
    );
}

/** A run of the held value the engine could not read, by offset. */
export interface UnreadRun {
    readonly start: number;
    readonly end: number;
}

/**
 * The runs of the held value the engine could not read, as the engine's
 * recognition of that value reports them, left to right.
 *
 * @param recognition - The recognition of the value the field holds
 * @param length - The value's length; a span past it is cut off there
 */
export function unreadRuns(
    recognition: Pick<RecognitionResult, 'unmatched'> | undefined,
    length: number,
): UnreadRun[] {
    return (recognition?.unmatched ?? [])
        .map((span) => ({
            start: Math.max(0, span.start),
            end: Math.min(length, span.end),
        }))
        .filter((run) => run.start < run.end)
        .sort((a, b) => a.start - b.start);
}

/**
 * The author's text the engine could not read, one entry per fragment, as the
 * engine's recognition reports it.
 *
 * @param recognition - The reading's recognition, when it has one
 */
export function unreadFragments(
    recognition: Pick<RecognitionResult, 'unmatched'> | undefined,
): string[] {
    return (recognition?.unmatched ?? [])
        .map((span) => span.text.trim())
        .filter((text) => text.length > 0);
}
