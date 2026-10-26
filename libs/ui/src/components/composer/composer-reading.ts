/**
 * Turn an engine result into the composer's reading, the one shape every
 * field's port returns.
 *
 * A read processes the draft once: the text as typed, with the facts already
 * chosen beside it. The engine settles text and chosen facts as one marking and
 * proves its fix paths for that marking, so no fix is proven again here. An
 * additive draft first reads its text through the reader's call, to apply the
 * field's add rule.
 *
 * Two jobs live here so no field re-derives them:
 *
 * - Completeness. A draft is complete when recognition accounted for every
 *   character (`recognition.status === 'complete'`), or when there was nothing
 *   to read. Anything partial, ambiguous or unrecognized is incomplete, and the
 *   commit table stores nothing for it.
 * - Carry-forward. A concept in a category the field's format never writes has no
 *   text to be read back from. A whole-marking draft re-read on a keystroke
 *   would drop it, so a committed assertion in such a category goes with the
 *   text as a chosen fact.
 */

import type {
    Assertion,
    Fix,
    ProcessResult,
    SchemePublicView,
    Suggestion,
    ValidateResult,
} from '@ezclassify/types';
import type {
    ComposerCorrection,
    ComposerFragment,
    ComposerReading,
} from './composer-controller';
import { statedAssertions } from './composer-controller';

/** What a composer read sends the engine besides the text. */
export interface ComposerProcessRequest {
    /** Facts already chosen beside the text, settled with it as one marking. */
    readonly chosen?: readonly Assertion[];
}

/** The engine calls a field's composer port is built from. */
export interface ComposerEngineBinding {
    /**
     * Process `text` in the field's format and context, as the author's call.
     * `request.chosen` is settled together with what the text states, as one
     * marking; with no text it is the marking.
     */
    process(
        text: string,
        request?: ComposerProcessRequest,
    ): Promise<ProcessResult>;
    /**
     * Read `text` in the field's format and context, as the reader's call: the
     * facts it states once settled, and no fix paths. Required for an additive
     * draft, which reads the text first to learn which of the base's
     * single-choice values it replaces.
     */
    validate?(text: string): Promise<ValidateResult>;
    /**
     * Category ids the field's format writes. Undefined when the adapter cannot
     * say, which disables carry-forward.
     */
    coveredCategories?(): Set<string> | undefined;
    /**
     * Write an assertion set in the field's format as it is, without validating
     * or repairing it (see ComposerPort.write).
     */
    write?(assertions: readonly Assertion[]): Promise<string>;
}

/**
 * Build a reading from a process result for the text it read.
 *
 * @param result - The process result for `text`
 * @param text - The draft text the result read
 */
export function readingFromResult(
    result: ProcessResult,
    text: string,
): ComposerReading {
    const recognition = result.recognition;
    const unmatched: ComposerFragment[] = (recognition?.unmatched ?? []).map(
        (span) => ({ start: span.start, end: span.end, text: span.text }),
    );
    const corrections: ComposerCorrection[] = (
        recognition?.corrections ?? []
    ).map((c) => ({
        start: c.start,
        end: c.end,
        original: c.original,
        replacement: c.replacement,
        reason: c.reason,
    }));
    // Completeness needs recognition's account of every character. A result
    // without one cannot say the text was fully read, so it is not complete:
    // treating any assertion as enough would store "A zz" as "A" and drop "zz".
    const complete =
        text.trim().length === 0 || recognition?.status === 'complete';
    return {
        assertions: result.assertions,
        rendered: result.rendered,
        complete,
        unmatched,
        corrections,
        valid: result.valid,
        errors: result.errors ?? [],
        warnings: result.warnings ?? [],
        proposedFixes: (result.proposedFixes ?? []) as Fix[],
        appliedFixes: result.appliedFixes ?? [],
        assertionsBeforeRepair: result.assertionsBeforeRepair,
    };
}

/**
 * Read a whole-marking draft: the text, with each committed assertion the
 * format cannot write chosen beside it, so the reading describes what will
 * actually be stored. Recognition comes from the text alone.
 *
 * @param binding - The field's engine calls
 * @param text - The draft text
 * @param committed - The value the field holds now
 */
export async function readWholeDraft(
    binding: ComposerEngineBinding,
    text: string,
    committed: readonly Assertion[],
): Promise<ComposerReading> {
    const covered = binding.coveredCategories?.();
    const carried = covered
        ? committed.filter((a) => !covered.has(a.categoryId))
        : [];
    const result = await binding.process(
        text,
        carried.length > 0 ? { chosen: carried } : {},
    );
    return readingFromResult(result, text);
}

/**
 * Read an additive draft: the text adds to `base` by the field's own add rule
 * (a single-choice value it states replaces the base's), and the text goes to
 * the engine with what is left of the base chosen beside it. Recognition, and
 * so completeness, comes from the text; the errors and the proven fixes are the
 * combined marking's, including a rule the text breaks on its own.
 *
 * Which base values the text replaces is only known once the text is read, so a
 * non-empty text is read first through the reader's call, which proves no fix
 * paths.
 *
 * @param binding - The field's engine calls; `validate` is required
 * @param text - The draft text
 * @param base - The assertion set the text adds to
 * @param add - The field's add rule
 */
export async function readAdditiveDraft(
    binding: ComposerEngineBinding,
    text: string,
    base: readonly Assertion[],
    add: (
        assertions: readonly Assertion[],
        ref: { conceptId: string; categoryId: string },
    ) => Assertion[],
): Promise<ComposerReading> {
    // With no text the base is the whole marking.
    let chosen = statedAssertions(base);
    if (text.trim().length > 0) {
        if (!binding.validate) {
            throw new Error(
                '[ezclassify] An additive composer draft needs a binding that can validate its text.',
            );
        }
        const stated = statedAssertions(
            (await binding.validate(text)).assertions,
        );
        for (const a of stated) chosen = add(chosen, a);
        // The text states these itself; only the rest of the base goes with it.
        const fromText = new Set(stated.map(refKey));
        chosen = chosen.filter((a) => !fromText.has(refKey(a)));
    }
    // Beside text, an empty base adds nothing to send; with no text it is
    // the marking, empty or not.
    const sendChosen = text.trim().length === 0 || chosen.length > 0;
    const result = await binding.process(text, sendChosen ? { chosen } : {});
    return readingFromResult(result, text);
}

function refKey(ref: { conceptId: string; categoryId: string }): string {
    return `${ref.categoryId}\u0000${ref.conceptId}`;
}

/**
 * Render an assertion set as a complete reading (a structural edit's result).
 *
 * @param binding - The field's engine calls
 * @param assertions - The edited set; only what the user stated is sent
 */
export async function renderAssertions(
    binding: ComposerEngineBinding,
    assertions: readonly Assertion[],
): Promise<ComposerReading> {
    const result = await binding.process('', {
        chosen: statedAssertions(assertions),
    });
    return readingFromResult(result, '');
}

/**
 * A list row for an assertion from the scheme's own data, labeled the way the
 * field's format writes it, for a fact the engine's suggestions do not cover.
 */
export function suggestionForAssertion(
    assertion: Assertion,
    scheme: Pick<SchemePublicView, 'concepts' | 'categories'>,
    formatId: string,
): Suggestion | undefined {
    const concept = scheme.concepts.find((c) => c.id === assertion.conceptId);
    const category = scheme.categories.find(
        (c) => c.id === assertion.categoryId,
    );
    if (!concept || !category) return undefined;
    const views = concept.views ?? {};
    return {
        conceptId: concept.id,
        categoryId: category.id,
        label: views[formatId] ?? views['default'] ?? concept.id,
        name: concept.name,
        description: concept.name,
        views,
        group: category.label,
        selected: true,
        order: 0,
    };
}
