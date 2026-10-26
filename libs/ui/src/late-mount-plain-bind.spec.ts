/**
 * Regression coverage for the plain `data-ezclassify-bind` input that arrives
 * after its `EzClassifyUI` is already live.
 *
 * The behavior pass wraps such an input in a `span.ez-plain-field-wrap` so the
 * enhancement status mark has somewhere to sit. During the initial scan that is
 * harmless: the wrap happens before the mutation observer is watching. Append
 * the same input later and the wrap fed itself. The observer's `addedNodes`
 * record ran the behavior pass, which created the wrap and moved the input into
 * it; the move queued a record for the new span, whose scan found the same
 * still-bound input and wrapped it again. Every turn enqueued the next observer
 * microtask, so the loop never yielded to the macrotask queue: vitest's own
 * `testTimeout` could not fire and the run simply stopped making progress.
 *
 * The guard that stops it lives in `bindBehavior`, ahead of the DOM mutation.
 * With the loop gone, the same path can finally hydrate from the store, so a
 * late input picks up a marking that was published before it existed.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { Assertion } from '@ezclassify/types';
import { loadCedarValley } from '@ezclassify/example-schemes/cedar-valley';
import { EzClassifyUI } from './ezclassify-ui';

const MARKING_ID = 'doc-marking';

/** State a host stages into the marking with no view involved. */
const STAGED: Assertion[] = [
    {
        conceptId: 'CONFIDENTIAL',
        categoryId: 'level',
        confidence: 'certain',
        source: 'user',
    },
];

async function flush(): Promise<void> {
    for (let i = 0; i < 40; i++) await Promise.resolve();
}

describe('a plain bound input mounted after construction', () => {
    let root: HTMLDivElement;
    let forms: EzClassifyUI | null;

    beforeEach(() => {
        document.body.innerHTML = '';
        root = document.createElement('div');
        root.innerHTML = `<input type="hidden" id="${MARKING_ID}" data-ezclassify-rendered />`;
        document.body.appendChild(root);
        forms = null;
    });

    afterEach(() => {
        forms?.destroy();
        document.body.innerHTML = '';
    });

    /** The late-arriving plain input, appended so the observer picks it up. */
    async function mountLateInput(): Promise<HTMLInputElement> {
        const input = document.createElement('input');
        input.id = 'plain-host';
        input.setAttribute('data-ezclassify-bind', '');
        input.setAttribute('data-ezclassify-bound-to', MARKING_ID);
        root.appendChild(input);
        await flush();
        return input;
    }

    it('settles instead of looping the observer forever', async () => {
        forms = new EzClassifyUI(loadCedarValley(), { root });
        await flush();

        const input = await mountLateInput();

        // The late-mounted host settles with one wrapper instead of an observer loop.
        expect(input.isConnected).toBe(true);
        expect(root.querySelectorAll('.ez-plain-field-wrap')).toHaveLength(1);
        expect(
            input.parentElement?.classList.contains('ez-plain-field-wrap'),
        ).toBe(true);
        expect(
            root.querySelectorAll('.ez-plain-field-wrap > .ez-status-mark'),
        ).toHaveLength(1);
        expect(forms.fields.filter((f) => f === input)).toHaveLength(1);
    });

    it('wraps exactly once when the input is present before construction', async () => {
        const input = document.createElement('input');
        input.id = 'plain-host';
        input.setAttribute('data-ezclassify-bind', '');
        input.setAttribute('data-ezclassify-bound-to', MARKING_ID);
        root.appendChild(input);

        forms = new EzClassifyUI(loadCedarValley(), { root });
        await flush();

        expect(root.querySelectorAll('.ez-plain-field-wrap')).toHaveLength(1);
        expect(
            input.parentElement?.classList.contains('ez-plain-field-wrap'),
        ).toBe(true);
        expect(
            root.querySelectorAll('.ez-plain-field-wrap > .ez-status-mark'),
        ).toHaveLength(1);
        expect(forms.fields.filter((f) => f === input)).toHaveLength(1);
    });

    it('hydrates from state published before it mounted', async () => {
        forms = new EzClassifyUI(loadCedarValley(), { root });
        await flush();

        await forms.store.publishAssertions(MARKING_ID, STAGED);
        await flush();

        const rendered = forms.store.get(MARKING_ID).rendered;
        expect(rendered).not.toBe('');

        const input = await mountLateInput();

        expect(input.value).toBe(rendered);
    });

    it('leaves an unpublished marking alone', async () => {
        forms = new EzClassifyUI(loadCedarValley(), { root });
        await flush();

        const input = await mountLateInput();

        expect(input.value).toBe('');
    });

    it('still reflects a commit that lands after it mounted', async () => {
        forms = new EzClassifyUI(loadCedarValley(), { root });
        await flush();

        const input = await mountLateInput();
        expect(input.value).toBe('');

        await forms.store.publishAssertions(MARKING_ID, STAGED);
        await flush();

        expect(input.value).toBe(forms.store.get(MARKING_ID).rendered);
    });

    it('unwraps an initial-scan input on destroy and leaves no residue', async () => {
        // The rollup hidden input captured as a sibling is removed during
        // teardown. Unwrapping must tolerate that stale sibling reference.
        const input = document.createElement('input');
        input.id = 'plain-host';
        input.setAttribute('data-ezclassify-bind', '');
        input.setAttribute('data-ezclassify-bound-to', MARKING_ID);
        root.appendChild(input);

        forms = new EzClassifyUI(loadCedarValley(), { root });
        await flush();

        forms.destroy();
        forms = null;

        expect(input.parentElement).toBe(root);
        expect(root.querySelectorAll('.ez-plain-field-wrap')).toHaveLength(0);
        expect(root.querySelectorAll('.ez-status-mark')).toHaveLength(0);
    });

    it('unwraps the late input on destroy and leaves no residue', async () => {
        forms = new EzClassifyUI(loadCedarValley(), { root });
        await flush();

        const input = await mountLateInput();
        expect(root.querySelectorAll('.ez-plain-field-wrap')).toHaveLength(1);

        forms.destroy();
        forms = null;

        expect(input.parentElement).toBe(root);
        expect(root.querySelectorAll('.ez-plain-field-wrap')).toHaveLength(0);
        expect(root.querySelectorAll('.ez-status-mark')).toHaveLength(0);
    });
});
