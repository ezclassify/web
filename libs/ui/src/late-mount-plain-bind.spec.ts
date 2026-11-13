/**
 * Regression coverage for the plain `data-ezclassify-marking` input that
 * arrives after its `EzClassifyUI` is already live.
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
import { EzClassifyUI } from './ezclassify-ui';
import {
    connectDemoContext,
    demoRuntimeSettled,
} from '../../../test-support/demo-runtime';

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
    await demoRuntimeSettled();
}

describe('a plain bound input mounted after construction', () => {
    let root: HTMLDivElement;
    let forms: EzClassifyUI | null;

    beforeEach(() => {
        document.body.innerHTML = '';
        root = document.createElement('div');
        root.innerHTML = `<input type="hidden" id="${MARKING_ID}" data-ezclassify-marking />`;
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
        input.setAttribute('data-ezclassify-bound-to', MARKING_ID);
        root.appendChild(input);
        await flush();
        return input;
    }

    it('settles instead of looping the observer forever', async () => {
        forms = new EzClassifyUI(
            await connectDemoContext({ contextId: 'cedar-valley' }),
            { root },
        );
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
        // A bound view shows the marking; it is never a rollup contributor.
        expect(forms.fields).not.toContain(input);
    });

    it('wraps exactly once when the input is present before construction', async () => {
        const input = document.createElement('input');
        input.id = 'plain-host';
        input.setAttribute('data-ezclassify-bound-to', MARKING_ID);
        root.appendChild(input);

        forms = new EzClassifyUI(
            await connectDemoContext({ contextId: 'cedar-valley' }),
            { root },
        );
        await flush();

        expect(root.querySelectorAll('.ez-plain-field-wrap')).toHaveLength(1);
        expect(
            input.parentElement?.classList.contains('ez-plain-field-wrap'),
        ).toBe(true);
        expect(
            root.querySelectorAll('.ez-plain-field-wrap > .ez-status-mark'),
        ).toHaveLength(1);
        // A bound view shows the marking; it is never a rollup contributor.
        expect(forms.fields).not.toContain(input);
    });

    it("leaves the host's own padding on the input, which the stylesheet's reserve sits over", async () => {
        const input = document.createElement('input');
        input.id = 'plain-host';
        input.setAttribute('data-ezclassify-bound-to', MARKING_ID);
        input.style.paddingInlineEnd = '0.5rem';
        root.appendChild(input);

        forms = new EzClassifyUI(
            await connectDemoContext({ contextId: 'cedar-valley' }),
            { root },
        );
        await flush();

        // The reserve is a rule on the wrap's input (status-mark.css), so it
        // follows the host's later styles instead of freezing them at bind.
        expect(input.parentElement?.classList).toContain('ez-plain-field-wrap');
        // The wrap's layout is the stylesheet's too: an inline display would
        // outrank the rule that keeps the wrap to the input's box.
        expect(input.parentElement?.getAttribute('style')).toBeNull();
        expect(input.style.paddingInlineEnd).toBe('0.5rem');
        forms.destroy();
        forms = null;
        expect(input.style.paddingInlineEnd).toBe('0.5rem');
    });

    it('hydrates from state published before it mounted', async () => {
        forms = new EzClassifyUI(
            await connectDemoContext({ contextId: 'cedar-valley' }),
            { root },
        );
        await flush();

        await forms.store.publishAssertions(MARKING_ID, STAGED);
        await flush();

        const rendered = forms.store.get(MARKING_ID).rendered;
        expect(rendered).not.toBe('');

        const input = await mountLateInput();

        expect(input.value).toBe(rendered);
    });

    it('leaves an unpublished marking alone', async () => {
        forms = new EzClassifyUI(
            await connectDemoContext({ contextId: 'cedar-valley' }),
            { root },
        );
        await flush();

        const input = await mountLateInput();

        expect(input.value).toBe('');
    });

    it('still reflects a commit that lands after it mounted', async () => {
        forms = new EzClassifyUI(
            await connectDemoContext({ contextId: 'cedar-valley' }),
            { root },
        );
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
        input.setAttribute('data-ezclassify-bound-to', MARKING_ID);
        root.appendChild(input);

        forms = new EzClassifyUI(
            await connectDemoContext({ contextId: 'cedar-valley' }),
            { root },
        );
        await flush();

        forms.destroy();
        forms = null;

        expect(input.parentElement).toBe(root);
        expect(root.querySelectorAll('.ez-plain-field-wrap')).toHaveLength(0);
        expect(root.querySelectorAll('.ez-status-mark')).toHaveLength(0);
    });

    it('unwraps the late input on destroy and leaves no residue', async () => {
        forms = new EzClassifyUI(
            await connectDemoContext({ contextId: 'cedar-valley' }),
            { root },
        );
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
