/**
 * MarkedTextArea against Cedar Valley, the scheme the demos ship, whose shapes
 * the synthetic test engines do not reproduce.
 *
 * Cedar Valley derives an implicit recipient for every nonpublic file and its
 * render filter hides it, so no format ever writes it and no author can type
 * it. A scheme whose part view spells its own parentheses renders a concept as
 * "(INTERNAL)", the same text the field's wrapper adds around a part mark. No
 * shipped scheme does that, so those specs use levels shaped like Cedar
 * Valley's protection levels that do.
 *
 * Two field behaviors have to hold for those shapes. A marking loaded into the
 * field is flagged for correction only when the correction would change what
 * the field says, and a repair writes the part mark with exactly one wrapper.
 */

import { asContext } from '../../test-fixtures/as-context';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { EzClassifyClient } from '@ezclassify/rest-client';
import { EzClassifyUI } from '../ezclassify-ui';
import { MarkedTextArea } from './marked-text-area';
import { connectDemoContext } from '../../../../test-support/demo-runtime';

function wait(ms = 30): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
}

let root: HTMLDivElement;
const activeForms: EzClassifyUI[] = [];

beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    Element.prototype.scrollIntoView = vi.fn();
    document.body.innerHTML = '';
    root = document.createElement('div');
    document.body.appendChild(root);
});

afterEach(() => {
    vi.restoreAllMocks();
    while (activeForms.length > 0) activeForms.pop()!.destroy();
    document.body.innerHTML = '';
});

/** A protection level whose every view spells its own parentheses. */
function selfWrappedLevel(id: string, rank: unknown) {
    const view = `(${id})`;
    return {
        id,
        name: id.charAt(0) + id.slice(1).toLowerCase(),
        views: { default: view, short: `(${id.charAt(0)})`, long: view },
        aliases: [id.toLowerCase()],
        categories: ['level'],
        rank,
    };
}

/**
 * Protection levels shaped like Cedar Valley's, with every concept's view
 * spelling its own parentheses and an embedded marking that reads them.
 */
const SELF_WRAPPED_LEVELS = {
    scheme: {
        id: 'self-wrapped-levels',
        version: '1.0.0',
        name: 'Self-wrapped levels',
        description: 'Levels whose views spell the part wrapper themselves.',
        data: {
            categories: [
                {
                    id: 'level',
                    label: 'Protection',
                    required: true,
                    single: true,
                    rollup: 'max',
                    position: 0,
                },
            ],
            concepts: [
                selfWrappedLevel('PUBLIC', 'bottom'),
                selfWrappedLevel('INTERNAL', { above: 'PUBLIC' }),
                selfWrappedLevel('CONFIDENTIAL', { above: 'INTERNAL' }),
                selfWrappedLevel('RESTRICTED', 'top'),
            ],
        },
        rules: [
            {
                id: 'protection-level-required',
                action: 'cardinality',
                category: 'level',
                min: 1,
                message: 'Choose a protection level.',
            },
        ],
        embedded_marking: [
            { pattern: '\\(([^)]+)\\)', template: '({marking})' },
        ],
        parse: {},
        render: {
            default: 'default',
            formats: [
                {
                    id: 'default',
                    view: 'default',
                    surface: 'marking',
                    mode: 'inline',
                    separator: '//',
                    fields: [{ category: 'level', separator: '/' }],
                },
                {
                    id: 'short',
                    view: 'short',
                    surface: 'marking',
                    mode: 'inline',
                    separator: '//',
                    fields: [{ category: 'level', separator: '/' }],
                },
            ],
        },
    },
};

/** @returns A Context over {@link SELF_WRAPPED_LEVELS} */
async function loadSelfWrappedLevelsContext(): Promise<EzClassifyClient> {
    return await connectDemoContext({ draft: { scheme: SELF_WRAPPED_LEVELS } });
}

async function mountTextarea(
    engine: EzClassifyClient['scheme'],
    value: string,
): Promise<{ ta: HTMLTextAreaElement; comp: MarkedTextArea }> {
    const ta = document.createElement('textarea');
    ta.id = 'body';
    ta.setAttribute('data-ezclassify-controller', 'marked-textarea');
    ta.value = value;
    root.appendChild(ta);
    const forms = new EzClassifyUI(asContext(engine as never), { root });
    activeForms.push(forms);
    await wait(400);
    const comp = forms.components.get(ta) as MarkedTextArea;
    expect(comp).toBeInstanceOf(MarkedTextArea);
    return { ta, comp };
}

describe('MarkedTextArea: loaded markings are flagged only for corrections that change the field', () => {
    it('accepts a nonpublic Cedar Valley mark whose derived recipient no format writes', async () => {
        const value =
            '(CONFIDENTIAL//FINANCIAL INFORMATION) Purchasing notes.\n(RESTRICTED//SECURE ASSESSMENTS//KEEP SEALED) Exam packet.';
        const { ta, comp } = await mountTextarea(
            (await connectDemoContext({ contextId: 'cedar-valley' })).scheme,
            value,
        );

        const segments = comp.getSegments();
        expect(segments.map((s) => s.marking)).toEqual([
            '(CONFIDENTIAL//FINANCIAL INFORMATION)',
            '(RESTRICTED//SECURE ASSESSMENTS//KEEP SEALED)',
        ]);
        for (const segment of segments) {
            expect(segment.errors).toEqual([]);
            expect(segment.valid).toBe(true);
        }
        expect(root.querySelector('.marked-textarea-chip--invalid')).toBeNull();
        // Loaded text stays exactly as the author wrote it.
        expect(ta.value).toBe(value);
    });

    it('accepts a mark the engine read tolerantly, in any case or separator', async () => {
        const value = '(internal//oakwood, pinecrest) Bus plan.';
        const { comp } = await mountTextarea(
            (await connectDemoContext({ contextId: 'cedar-valley' })).scheme,
            value,
        );

        const [segment] = comp.getSegments();
        expect(segment.errors).toEqual([]);
        expect(segment.valid).toBe(true);
    });

    it('accepts levels whose part view spells the wrapper itself', async () => {
        const value =
            '(INTERNAL)\n\nStaff plan.\n\n(CONFIDENTIAL)\n\nStudent records.';
        const { ta, comp } = await mountTextarea(
            (await loadSelfWrappedLevelsContext()).scheme,
            value,
        );

        const segments = comp.getSegments();
        expect(segments.map((s) => s.marking)).toEqual([
            '(INTERNAL)',
            '(CONFIDENTIAL)',
        ]);
        for (const segment of segments) {
            expect(segment.errors).toEqual([]);
            expect(segment.valid).toBe(true);
        }
        expect(ta.value).toBe(value);
    });

    it('still flags a loaded mark the scheme rules refuse', async () => {
        const { comp } = await mountTextarea(
            (await connectDemoContext({ contextId: 'cedar-valley' })).scheme,
            '(PUBLIC//OAKWOOD) Lunch menu.',
        );

        const [segment] = comp.getSegments();
        expect(segment.valid).toBe(false);
        expect(segment.errors.join(' ')).toContain(
            'cannot be limited to selected schools',
        );
    });
});

describe('MarkedTextArea: a repair writes one wrapper', () => {
    it('keeps a typed level single-wrapped', async () => {
        const { ta, comp } = await mountTextarea(
            (await loadSelfWrappedLevelsContext()).scheme,
            '',
        );

        ta.value = '(INTERNAL) Staff plan.';
        ta.dispatchEvent(new Event('input', { bubbles: true }));
        await wait(600);

        expect(ta.value).toBe('(INTERNAL) Staff plan.');
        const [segment] = comp.getSegments();
        expect(segment.marking).toBe('(INTERNAL)');
        expect(segment.valid).toBe(true);
    });

    it('still normalizes a typed Cedar Valley mark into the field format', async () => {
        const { ta } = await mountTextarea(
            (await connectDemoContext({ contextId: 'cedar-valley' })).scheme,
            '',
        );

        ta.value = '(confidential//financial information) Notes.';
        ta.dispatchEvent(new Event('input', { bubbles: true }));
        await wait(600);

        // Repair still rewrites what the author typed into the scheme's part
        // view, wrapped once.
        expect(ta.value).toMatch(/^\([^()]+\) Notes\.$/);
        expect(ta.value).not.toBe(
            '(confidential//financial information) Notes.',
        );
    });
});
