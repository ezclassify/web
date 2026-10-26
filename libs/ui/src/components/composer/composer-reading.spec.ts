/**
 * How an engine result becomes the composer's reading: completeness from
 * recognition, carry-forward of what the format cannot write, and the additive
 * merge. Isolated from any engine, so the assertions-versus-rendered mismatch
 * class (a rendered string that names a different set than the assertions it
 * travels with) is pinned directly, and so is the number of engine calls one
 * read makes.
 */
import { describe, expect, it, vi } from 'vitest';
import type {
    Assertion,
    ProcessResult,
    ValidateResult,
} from '@ezclassify/types';
import {
    readAdditiveDraft,
    readWholeDraft,
    readingFromResult,
    suggestionForAssertion,
    type ComposerEngineBinding,
    type ComposerProcessRequest,
} from './composer-reading';

function a(
    conceptId: string,
    categoryId: string,
    extra: Partial<Assertion> = {},
): Assertion {
    return {
        conceptId,
        categoryId,
        confidence: 'certain',
        source: 'user',
        ...extra,
    };
}

function result(
    assertions: Assertion[],
    rendered: string,
    status?: 'complete' | 'partial' | 'unrecognized',
    unmatched: { start: number; end: number; text: string }[] = [],
): ProcessResult {
    return {
        assertions,
        rendered,
        valid: true,
        errors: [],
        warnings: [],
        appliedFixes: [],
        proposedFixes: [],
        ...(status
            ? { recognition: { status, unmatched, corrections: [] } }
            : {}),
    } as unknown as ProcessResult;
}

/** What validate answers for a text: the facts it states. */
function read(assertions: Assertion[]): ValidateResult {
    return { assertions } as unknown as ValidateResult;
}

type Process = (
    text: string,
    request?: ComposerProcessRequest,
) => Promise<ProcessResult>;

describe('readingFromResult', () => {
    it('is complete only when recognition accounted for every character', () => {
        expect(
            readingFromResult(result([a('S', 'level')], 'S', 'complete'), 'S')
                .complete,
        ).toBe(true);
        const partial = readingFromResult(
            result([a('S', 'level')], 'S zz', 'partial', [
                { start: 2, end: 4, text: 'zz' },
            ]),
            'S zz',
        );
        expect(partial.complete).toBe(false);
        expect(partial.unmatched).toEqual([{ start: 2, end: 4, text: 'zz' }]);
    });

    it('is not complete without recognition, however many assertions came back', () => {
        expect(
            readingFromResult(result([a('S', 'level')], 'S'), 'S zz').complete,
        ).toBe(false);
    });

    it('treats an empty draft as complete: it clears the value', () => {
        expect(
            readingFromResult(result([], '', 'unrecognized'), '  ').complete,
        ).toBe(true);
    });
});

describe('readWholeDraft', () => {
    it('sends an invisible committed assertion beside the text in one call', async () => {
        const process = vi.fn<Process>(async (_text, request) =>
            result(
                [a('S', 'level'), ...(request?.chosen ?? [])],
                'S (with MAIN)',
                'complete',
            ),
        );
        const binding: ComposerEngineBinding = {
            process,
            coveredCategories: () => new Set(['level']),
        };
        const reading = await readWholeDraft(binding, 'S', [
            a('S', 'level'),
            a('MAIN', 'branch'),
        ]);
        expect(reading.assertions.map((x) => x.conceptId).sort()).toEqual([
            'MAIN',
            'S',
        ]);
        // The rendered string describes the set actually returned.
        expect(reading.rendered).toBe('S (with MAIN)');
        // Recognition still comes from the text as typed.
        expect(reading.complete).toBe(true);
        expect(process).toHaveBeenCalledTimes(1);
        expect(process).toHaveBeenCalledWith('S', {
            chosen: [a('MAIN', 'branch')],
        });
    });

    it('sends the text alone when nothing needs carrying', async () => {
        const process = vi.fn<Process>(async () =>
            result([a('S', 'level')], 'S', 'complete'),
        );
        await readWholeDraft(
            { process, coveredCategories: () => new Set(['level']) },
            'S',
            [a('S', 'level')],
        );
        expect(process).toHaveBeenCalledTimes(1);
        expect(process).toHaveBeenCalledWith('S', {});
    });

    it('carries nothing when the adapter cannot say what its format writes', async () => {
        const process = vi.fn<Process>(async () => result([], '', 'complete'));
        const reading = await readWholeDraft({ process }, '', [
            a('MAIN', 'branch'),
        ]);
        expect(reading.assertions).toEqual([]);
        expect(process).toHaveBeenCalledWith('', {});
    });
});

describe('readAdditiveDraft', () => {
    const replacing = (
        list: readonly Assertion[],
        ref: { conceptId: string; categoryId: string },
    ) => [
        ...list.filter((x) => x.categoryId !== ref.categoryId),
        a(ref.conceptId, ref.categoryId),
    ];

    it('sends the text with what is left of the base after the add rule, reading completeness from the text', async () => {
        const validate = vi.fn(async () => read([a('U', 'level')]));
        const process = vi.fn<Process>(async (_text, request) =>
            result(
                [...(request?.chosen ?? []), a('U', 'level')],
                'NF/U',
                'partial',
                [{ start: 2, end: 4, text: 'zz' }],
            ),
        );
        const reading = await readAdditiveDraft(
            { process, validate },
            'U zz',
            [a('S', 'level'), a('NF', 'caveat')],
            replacing,
        );
        // The typed level replaces the base's; the caveat goes beside the text.
        expect(process).toHaveBeenCalledTimes(1);
        expect(process).toHaveBeenCalledWith('U zz', {
            chosen: [a('NF', 'caveat')],
        });
        expect(reading.assertions.map((x) => x.conceptId)).toEqual(['NF', 'U']);
        expect(reading.complete).toBe(false);
        expect(reading.unmatched[0].text).toBe('zz');
    });

    it('reports the combined marking as the engine judged it, offering exactly the fixes it proved', async () => {
        const proven = {
            message: 'Keep SECRET.',
            rendered: 'NF/S',
            keeps: [
                { conceptId: 'NF', categoryId: 'caveat' },
                { conceptId: 'S', categoryId: 'level' },
            ],
            adds: [],
            removes: [{ conceptId: 'U', categoryId: 'level' }],
        };
        const validate = vi.fn(async () =>
            read([a('U', 'level'), a('S', 'level')]),
        );
        const process = vi.fn<Process>(
            async () =>
                ({
                    ...result([a('NF', 'caveat'), a('S', 'level')], 'NF/S'),
                    valid: false,
                    errors: [
                        {
                            constraintId: 'one-level',
                            message: 'Choose one level.',
                        },
                    ],
                    proposedFixes: [proven],
                }) as unknown as ProcessResult,
        );
        const reading = await readAdditiveDraft(
            { process, validate },
            'U//S',
            [a('C', 'level'), a('NF', 'caveat')],
            replacing,
        );
        expect(reading.valid).toBe(false);
        expect(reading.errors.map((e) => e.constraintId)).toEqual([
            'one-level',
        ]);
        expect(reading.proposedFixes).toEqual([proven]);
        // One read of the text, one process of the marking: no fix proved again.
        expect(validate).toHaveBeenCalledTimes(1);
        expect(process).toHaveBeenCalledTimes(1);
    });

    it('reads an empty text as the base alone, without reading any text', async () => {
        const validate = vi.fn(async () => read([]));
        const process = vi.fn<Process>(async (_text, request) =>
            result([...(request?.chosen ?? [])], 'S'),
        );
        const reading = await readAdditiveDraft(
            { process, validate },
            '',
            [a('S', 'level'), a('I', 'x', { confidence: 'inferred' })],
            (l) => [...l],
        );
        // Only what the user stated goes back to the engine.
        expect(process).toHaveBeenCalledWith('', { chosen: [a('S', 'level')] });
        expect(validate).not.toHaveBeenCalled();
        expect(reading.complete).toBe(true);
    });

    it('refuses a text it cannot read for the add rule', async () => {
        const process = vi.fn<Process>(async () => result([], ''));
        await expect(
            readAdditiveDraft({ process }, 'U', [], replacing),
        ).rejects.toThrow(/validate/);
        expect(process).not.toHaveBeenCalled();
    });
});

describe('suggestionForAssertion', () => {
    it('labels a fact the way the field format writes it, grouped by its category', () => {
        const s = suggestionForAssertion(
            a('MAIN', 'branch'),
            {
                concepts: [
                    {
                        id: 'MAIN',
                        name: 'Our School',
                        views: { default: 'OUR SCHOOL', short: 'OS' },
                    },
                ] as never,
                categories: [{ id: 'branch', label: 'Branch' }] as never,
            },
            'short',
        );
        expect(s?.label).toBe('OS');
        expect(s?.group).toBe('Branch');
        expect(s?.selected).toBe(true);
    });
});
