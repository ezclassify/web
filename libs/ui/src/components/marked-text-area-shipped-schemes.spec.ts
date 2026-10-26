/**
 * MarkedTextArea against the example schemes the demos ship, whose shapes the
 * synthetic test engines do not reproduce.
 *
 * Cedar Valley derives an implicit recipient for every nonpublic file and its
 * render filter hides it, so no format ever writes it and no author can type
 * it. Pantry's part view spells its own parentheses: a concept renders as
 * "(gluten)", the same text the scheme's embedded pattern wraps.
 *
 * Two field behaviors have to hold for those shapes. A marking loaded into the
 * field is flagged for correction only when the correction would change what
 * the field says, and a repair writes the part mark with exactly one wrapper.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { loadCedarValley } from '@ezclassify/example-schemes/cedar-valley';
import { loadPantry } from '@ezclassify/example-schemes/pantry';
import { EzClassifyUI } from '../ezclassify-ui';
import { MarkedTextArea } from './marked-text-area';

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

async function mountTextarea(
    engine: ReturnType<typeof loadCedarValley> | ReturnType<typeof loadPantry>,
    value: string,
): Promise<{ ta: HTMLTextAreaElement; comp: MarkedTextArea }> {
    const ta = document.createElement('textarea');
    ta.id = 'body';
    ta.setAttribute('data-ezclassify-controller', 'marked-textarea');
    ta.value = value;
    root.appendChild(ta);
    const forms = new EzClassifyUI(engine as never, { root });
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
        const { ta, comp } = await mountTextarea(loadCedarValley(), value);

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
        const { comp } = await mountTextarea(loadCedarValley(), value);

        const [segment] = comp.getSegments();
        expect(segment.errors).toEqual([]);
        expect(segment.valid).toBe(true);
    });

    it('accepts Pantry tags whose part view spells the wrapper itself', async () => {
        const value = '(gluten)\n\nCreamy pasta.\n\n(dairy)\n\nButter sauce.';
        const { ta, comp } = await mountTextarea(loadPantry(), value);

        const segments = comp.getSegments();
        expect(segments.map((s) => s.marking)).toEqual(['(gluten)', '(dairy)']);
        for (const segment of segments) {
            expect(segment.errors).toEqual([]);
            expect(segment.valid).toBe(true);
        }
        expect(ta.value).toBe(value);
    });

    it('still flags a loaded mark the scheme rules refuse', async () => {
        const { comp } = await mountTextarea(
            loadCedarValley(),
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
    it('keeps a typed Pantry tag single-wrapped', async () => {
        const { ta, comp } = await mountTextarea(loadPantry(), '');

        ta.value = '(gluten) Creamy pasta.';
        ta.dispatchEvent(new Event('input', { bubbles: true }));
        await wait(600);

        expect(ta.value).toBe('(gluten) Creamy pasta.');
        const [segment] = comp.getSegments();
        expect(segment.marking).toBe('(gluten)');
        expect(segment.valid).toBe(true);
    });

    it('still normalizes a typed Cedar Valley mark into the field format', async () => {
        const { ta } = await mountTextarea(loadCedarValley(), '');

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
