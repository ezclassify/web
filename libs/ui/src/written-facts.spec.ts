/**
 * Which facts a marking writes, by the engine's assessments of the forms a
 * field shows it in.
 *
 * The scheme here writes a label line and a record block. A group's member is
 * collapsed into the group's written name, a default is left out of the line,
 * and the block writes the record's facts.
 */
import { describe, expect, it } from 'vitest';
import { writtenFactTest } from './written-facts';

const categories = [
    { id: 'level' },
    { id: 'group' },
    { id: 'owner' },
    { id: 'signer', scopes: ['record'] },
    { id: 'basis', scopes: ['record'] },
];
const meta = {
    defaultScope: 'label',
    scopes: [
        { id: 'label', label: 'Label' },
        { id: 'record', label: 'Record' },
    ],
    formats: [
        { id: 'label/line', surface: 'label' },
        { id: 'record/block', surface: 'record' },
    ],
};
const ref = (categoryId: string, conceptId: string) => ({
    categoryId,
    conceptId,
});

/** The label line's assessment: GROUP written, MEMBER under it, owner left out. */
const LINE = {
    formatId: 'label/line',
    assessment: {
        emitted: [ref('level', 'LOW'), ref('group', 'GROUP')],
        omitted: [ref('owner', 'HOME'), ref('basis', 'POLICY')],
        collapsed: [[ref('group', 'MEMBER'), ref('group', 'GROUP')]],
    },
};

describe('writtenFactTest', () => {
    it('counts a member collapsed into its group, and a default left out, as unwritten', () => {
        const written = writtenFactTest([LINE], categories, meta);

        expect(written(ref('group', 'MEMBER'))).toBe(false);
        expect(written(ref('owner', 'HOME'))).toBe(false);
        expect(written(ref('group', 'GROUP'))).toBe(true);
        expect(written(ref('level', 'LOW'))).toBe(true);
    });

    it('takes no evidence from a form about a scope it does not write', () => {
        // The line leaves the record's basis out because the line does not
        // write the record, not because the marking does not write it.
        const written = writtenFactTest([LINE], categories, meta);

        expect(written(ref('basis', 'POLICY'))).toBe(true);
    });

    it('counts a fact one form leaves out and another writes as written', () => {
        const block = {
            formatId: 'record/block',
            assessment: {
                emitted: [ref('basis', 'POLICY')],
                omitted: [ref('signer', 'AUTO')],
                collapsed: [],
            },
        };
        const line = {
            surface: 'label',
            assessment: {
                emitted: [ref('owner', 'HOME')],
                omitted: [],
                collapsed: [],
            },
        };
        const written = writtenFactTest([LINE, block, line], categories, meta);

        expect(written(ref('basis', 'POLICY'))).toBe(true);
        expect(written(ref('signer', 'AUTO'))).toBe(false);
        // The line form named by its surface writes the owner LINE left out.
        expect(written(ref('owner', 'HOME'))).toBe(true);
    });

    it('counts every fact as written when no form reports an assessment', () => {
        const written = writtenFactTest(
            [{ formatId: 'label/line' }],
            categories,
            meta,
        );

        expect(written(ref('group', 'MEMBER'))).toBe(true);
    });
});
