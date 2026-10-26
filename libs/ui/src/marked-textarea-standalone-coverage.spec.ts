/**
 * A MarkedTextArea with no `bound-to` and no `part-of` is the parent of its own
 * part markings: they name the textarea so its aggregate can be published. That
 * aggregate is not an authored whole. The rollup must not mount the
 * whole-over-parts correction beside the textarea, because applying it would
 * write a bare marking string over the body text.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadMultiScopeRegression } from '../test-fixtures/load-multi-scope-regression';
import { EzClassifyUI } from './ezclassify-ui';

const HTML = `
  <textarea id="body" data-ezclassify-controller="marked-textarea"></textarea>
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

describe('standalone MarkedTextArea: parts roll up to the textarea without a whole correction', () => {
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

    it.each([
        '(SA) First paragraph.\n(DC) Second paragraph.',
        '(STATE ASSESSMENT STAFF) First paragraph.\n(DISTRICT COORDINATORS) Second paragraph.',
    ])(
        'preserves prose and mounts no whole-over-parts control for %s',
        async (body) => {
            forms = new EzClassifyUI(loadMultiScopeRegression(), { root });
            await flush();

            const ta = root.querySelector<HTMLTextAreaElement>('#body')!;
            ta.focus();
            ta.value = body;
            ta.dispatchEvent(new Event('input', { bubbles: true }));
            await flushAfterTyping();

            const parts = [
                ...root.querySelectorAll<HTMLElement>(
                    '[data-ezclassify-part-of="body"]',
                ),
            ];
            // Parts publish in the textarea's hidden (short) format.
            expect(parts.map((p) => forms!.store.get(p.id).rendered)).toEqual([
                'SA',
                'DC',
            ]);
            expect(root.querySelector('.ez-coverage-action')).toBeNull();
            // The store is canonical and the body is the author's. This scheme
            // spells each part two ways, and whichever spelling was typed is
            // the one that stays on the page: the parts above publish the same
            // canonical marking either way, so rewriting the prose would buy
            // nothing and would move text the author did not ask to move.
            expect(ta.value).toBe(body);
        },
    );
});
