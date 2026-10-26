/**
 * Bound MarkedTextArea portions contribute assertions to their shared marking.
 * The scheme's rollup rules resolve same-category values independently of
 * typing order; different categories combine. Replacing the portion set keeps
 * stale teardown publishes from clearing the newly committed result.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { SchemeEngineAdapter } from '@ezclassify/types';
import { loadMultiScopeRegression } from '../test-fixtures/load-multi-scope-regression';
import { EzClassifyUI } from './ezclassify-ui';

const HTML = `
  <input type="hidden" id="doc-marking" data-ezclassify-rendered />
  <textarea id="body" data-ezclassify-controller="marked-textarea"
         data-ezclassify-bound-to="doc-marking"></textarea>
`;

async function flush(): Promise<void> {
    for (let i = 0; i < 8; i++) await Promise.resolve();
    await new Promise((r) => setTimeout(r, 20));
}

/** MarkedTextArea debounces its segment scan by SYNC_DEBOUNCE_MS (300ms). */
async function flushAfterTyping(): Promise<void> {
    await new Promise((r) => setTimeout(r, 400));
    await flush();
}

describe('MarkedTextArea bound-to: multi-segment publish rolls up per the documented union + rollup-rule contract', () => {
    let root: HTMLDivElement;
    let forms: EzClassifyUI | null;

    beforeEach(() => {
        document.body.innerHTML = '';
        root = document.createElement('div');
        root.innerHTML = HTML;
        document.body.appendChild(root);
        forms = null;
    });

    afterEach(() => {
        forms?.destroy();
        document.body.innerHTML = '';
    });

    it("two segments asserting the same single-select category resolve via that category's rollup rule (max rank), not typing order", async () => {
        forms = new EzClassifyUI(loadMultiScopeRegression(), { root });
        await flush();

        const ta = root.querySelector<HTMLTextAreaElement>('#body')!;
        ta.focus();
        // DISTRICT_COORDINATORS is typed SECOND but ranks below STATE_ASSESSMENT_STAFF (rank:
        // top) in the scheme, so this case alone only rules out "last segment
        // wins": a "first segment wins" implementation would ALSO land on
        // STATE_ASSESSMENT_STAFF here since it's typed first, and would pass this
        // assertion for the wrong reason. The companion test below reverses
        // the typing order to rule out first-wins too; together the two
        // pin that rank (not typing order in either direction) decides it.
        ta.value =
            '(STATE ASSESSMENT STAFF) First paragraph.\n(DISTRICT COORDINATORS) Second paragraph.';
        ta.dispatchEvent(new Event('input', { bubbles: true }));
        await flushAfterTyping();

        const state = forms.store.get('doc-marking');
        expect(state.rendered).toBe('STATE ASSESSMENT STAFF');
        expect(
            state.assertions.filter((a) => a.categoryId === 'level'),
        ).toHaveLength(1);
        expect(
            state.assertions.find((a) => a.categoryId === 'level')?.conceptId,
        ).toBe('STATE_ASSESSMENT_STAFF');
    });

    it('reversed typing order (higher-rank segment typed SECOND) still resolves to the higher rank, ruling out first-segment-wins too', async () => {
        forms = new EzClassifyUI(loadMultiScopeRegression(), { root });
        await flush();

        const ta = root.querySelector<HTMLTextAreaElement>('#body')!;
        ta.focus();
        // Same two concepts as the test above, typing order flipped: now
        // STATE_ASSESSMENT_STAFF (the higher rank) is typed SECOND. A first-wins
        // implementation would land on DISTRICT_COORDINATORS here and fail; a
        // rank-driven `level: rollup: max` still lands on STATE_ASSESSMENT_STAFF
        // either way.
        ta.value =
            '(DISTRICT COORDINATORS) First paragraph.\n(STATE ASSESSMENT STAFF) Second paragraph.';
        ta.dispatchEvent(new Event('input', { bubbles: true }));
        await flushAfterTyping();

        const state = forms.store.get('doc-marking');
        expect(state.rendered).toBe('STATE ASSESSMENT STAFF');
        expect(
            state.assertions.filter((a) => a.categoryId === 'level'),
        ).toHaveLength(1);
        expect(
            state.assertions.find((a) => a.categoryId === 'level')?.conceptId,
        ).toBe('STATE_ASSESSMENT_STAFF');
    });

    it('ignores an older portion aggregate that answers after a replacement', async () => {
        const engine: SchemeEngineAdapter = loadMultiScopeRegression();
        const aggregate = engine.aggregateAssertions.bind(engine);
        let release!: () => void;
        const gate = new Promise<void>((resolve) => {
            release = resolve;
        });
        let held = false;
        vi.spyOn(engine, 'aggregateAssertions').mockImplementation(
            (...args) => {
                const result = aggregate(...args);
                if (
                    !held &&
                    args[0].length === 2 &&
                    args[0].some((set) =>
                        set.some(
                            (a) => a.conceptId === 'STATE_ASSESSMENT_STAFF',
                        ),
                    )
                ) {
                    held = true;
                    return gate.then(() => result);
                }
                return result;
            },
        );
        forms = new EzClassifyUI(engine, { root });
        await flush();
        const textarea = root.querySelector<HTMLTextAreaElement>('#body')!;
        textarea.value =
            '(STATE ASSESSMENT STAFF) First.\n(DISTRICT COORDINATORS) Second.';
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
        await vi.waitFor(() => expect(held).toBe(true));
        textarea.value = '(STUDENTS) First.\n(STUDENTS) Second.';
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
        try {
            await vi.waitFor(() =>
                expect(forms!.store.get('doc-marking').rendered).toBe(
                    'STUDENTS',
                ),
            );
        } finally {
            release();
        }
        await flushAfterTyping();
        expect(forms.store.get('doc-marking').rendered).toBe('STUDENTS');
    });

    it('two segments asserting different categories union together on doc-marking', async () => {
        forms = new EzClassifyUI(loadMultiScopeRegression(), { root });
        await flush();

        const ta = root.querySelector<HTMLTextAreaElement>('#body')!;
        ta.focus();
        ta.value =
            '(STATE ASSESSMENT STAFF) First paragraph.\n(MATH) Second paragraph.';
        ta.dispatchEvent(new Event('input', { bubbles: true }));
        await flushAfterTyping();

        const state = forms.store.get('doc-marking');
        expect(state.rendered).toBe('STATE ASSESSMENT STAFF//MATH');
        expect(
            state.assertions.some(
                (a) =>
                    a.categoryId === 'level' &&
                    a.conceptId === 'STATE_ASSESSMENT_STAFF',
            ),
        ).toBe(true);
        expect(
            state.assertions.some(
                (a) =>
                    a.categoryId === 'test_section' && a.conceptId === 'MATH',
            ),
        ).toBe(true);
    });
});

describe('MarkedTextArea bound-to: replacement parts cannot be cleared by stale teardown publishes', () => {
    let root: HTMLDivElement;
    let forms: EzClassifyUI | null;

    beforeEach(() => {
        document.body.innerHTML = '';
        root = document.createElement('div');
        root.innerHTML = `
          <input type="hidden" id="doc-marking" data-ezclassify-rendered />
          <textarea id="body" data-ezclassify-controller="marked-textarea"
                    data-ezclassify-bound-to="doc-marking"></textarea>
        `;
        document.body.appendChild(root);
        forms = null;
    });

    afterEach(() => {
        forms?.destroy();
        document.body.innerHTML = '';
    });

    it('keeps the replacement segment set in the parent aggregate', async () => {
        forms = new EzClassifyUI(loadMultiScopeRegression(), { root });
        await flush();

        const textarea = root.querySelector<HTMLTextAreaElement>('#body')!;
        textarea.value =
            '(STATE ASSESSMENT STAFF) First paragraph.\n(DISTRICT COORDINATORS) Second paragraph.';
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
        await flushAfterTyping();
        expect(forms.store.get('doc-marking').rendered).toBe(
            'STATE ASSESSMENT STAFF',
        );

        textarea.value =
            '(STUDENTS) First paragraph.\n(STUDENTS) Second paragraph.';
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
        await flushAfterTyping();

        expect(forms.store.get('doc-marking').rendered).toBe('STUDENTS');
    });
});
