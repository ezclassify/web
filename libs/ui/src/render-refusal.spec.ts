import { describe, expect, it } from 'vitest';
import type { RenderAssessment } from '@ezclassify/types';
import { renderViewRefusalMessages, renderViewRefused } from './render-refusal';

const written = (
    refusals: Partial<Pick<RenderAssessment, 'conflicts' | 'unrepresentable'>>,
): { assessment: RenderAssessment } => ({
    assessment: {
        emitted: [],
        omitted: [],
        collapsed: [],
        conflicts: refusals.conflicts ?? [],
        unrepresentable: refusals.unrepresentable ?? [],
    },
});

describe('renderViewRefused', () => {
    it('is false for a write that left facts out but wrote what it could', () => {
        expect(
            renderViewRefused({
                assessment: {
                    ...written({}).assessment,
                    omitted: [{ conceptId: 'KEEP', categoryId: 'keep' }],
                },
            }),
        ).toBe(false);
    });

    it('is false for a rolled-up state, which carries no assessment', () => {
        expect(renderViewRefused({})).toBe(false);
    });

    it('is true for a conflict, a fact it cannot write, or an output refused whole', () => {
        expect(
            renderViewRefused(
                written({ conflicts: [{ field: 'level', assertions: [] }] }),
            ),
        ).toBe(true);
        expect(
            renderViewRefused(
                written({
                    unrepresentable: [{ conceptId: 'X', reason: 'no-view' }],
                }),
            ),
        ).toBe(true);
        expect(
            renderViewRefused(
                written({
                    unrepresentable: [
                        {
                            output: 'sensitivity/short',
                            reason: 'unresolved-context',
                        },
                    ],
                }),
            ),
        ).toBe(true);
    });
});

describe('renderViewRefusalMessages', () => {
    it('names the concept a format cannot write', () => {
        expect(
            renderViewRefusalMessages(
                'sensitivity/short',
                written({
                    unrepresentable: [
                        { conceptId: 'KEEP_7Y', reason: 'no-field' },
                    ],
                }),
            ),
        ).toEqual([
            'Cannot display format "sensitivity/short": concept "KEEP_7Y" is no-field.',
        ]);
    });

    it('names the output a scheme refused whole, which has no concept', () => {
        expect(
            renderViewRefusalMessages(
                'short',
                written({
                    unrepresentable: [
                        {
                            output: 'sensitivity/short',
                            reason: 'unresolved-context',
                        },
                    ],
                }),
            ),
        ).toEqual([
            'Cannot display format "short": output "sensitivity/short" was refused (unresolved-context).',
        ]);
    });

    it("prefers the engine's own detail, and lists conflicts first", () => {
        expect(
            renderViewRefusalMessages(
                'sensitivity/full',
                written({
                    conflicts: [{ field: 'level', assertions: [] }],
                    unrepresentable: [
                        {
                            output: 'sensitivity/full',
                            reason: 'ambiguous-representation',
                            detail: 'Two cases hold at once.',
                        },
                    ],
                }),
            ),
        ).toEqual([
            'Cannot display format "sensitivity/full": field "level" has conflicting values.',
            'Two cases hold at once.',
        ]);
    });

    it('says nothing for a state with no assessment', () => {
        expect(renderViewRefusalMessages('sensitivity/full', {})).toEqual([]);
    });
});
