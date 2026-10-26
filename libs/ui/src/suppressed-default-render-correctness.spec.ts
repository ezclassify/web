/**
 * A scheme-suppressed default-fill concept must never leak into a rendered
 * surface, on any field.
 *
 * The multi-scope regression fixture suppresses `from_school` from every render
 * format specifically when its value is the default concept (OUR_SCHOOL); see
 * the scheme's `render.suppress` rule and `default_concept: OUR_SCHOOL`. The
 * engine still auto-fills OUR_SCHOOL as a real, `inferred`-confidence assertion
 * whenever the category ends up empty (its own default-fill rule, unrelated to
 * the render suppression), so a field bound to the whole marking has a live
 * assertion for a concept that must never appear in anything it RENDERS.
 *
 * Every rendered surface (a native input's `.value`, a painted display's text,
 * a field's `getRendered()`) must derive from the engine's own process() output
 * and therefore honor that suppression. STATE views (a chip, a dropdown's
 * checked row) are a different contract: they represent the assertion set, not
 * the rendered string, and correctly show OUR_SCHOOL as selected/inferred.
 * Composing a "rendered" surface from raw assertions instead of the engine's
 * actual rendered string is what this guards against: it would show
 * OUR_SCHOOL's label somewhere the suppression rule says it must not appear.
 *
 * TagInput and MarkingField are both covered here (bound to the same whole)
 * because they build their "rendered" surfaces two different ways (TagInput's
 * native input is a pure store mirror, MarkingField's textarea/ display both
 * derive from its OWN `_lastRendered`) and correctness in one does not
 * guarantee the other.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { rows } from './components/composer/composer-harness';
import { loadMultiScopeRegression } from '../test-fixtures/load-multi-scope-regression';
import { EzClassifyUI } from './ezclassify-ui';
import type { TagInput } from './components/tag-input';
import type { MarkingField } from './components/marking-field';

const HTML = `
  <input type="hidden" id="doc-marking" data-ezclassify-rendered />
  <input id="tags" data-ezclassify-controller="tags"
         data-ezclassify-bound-to="doc-marking" />
  <textarea id="marking" data-ezclassify-controller="marking"
         data-ezclassify-bound-to="doc-marking"></textarea>
`;

async function flush(): Promise<void> {
    for (let i = 0; i < 8; i++) await Promise.resolve();
    await new Promise((r) => setTimeout(r, 20));
}

describe('suppressed default-fill assertion never leaks into a rendered surface', () => {
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

    it('deleting OAKWOOD auto-fills OUR_SCHOOL as state, absent from every rendered surface, on both TagInput and MarkingField', async () => {
        forms = new EzClassifyUI(loadMultiScopeRegression(), { root });
        await flush();

        // TagInput ('tags') is registered in the runtime's own `autocompleters`
        // map, not `components` (see ezclassify-ui.ts's mount branch for
        // `controller === 'tags'`);
        // every other field, including MarkingField, is in `components`.
        const tags = (
            forms as unknown as {
                autocompleters: Map<HTMLElement, TagInput>;
            }
        ).autocompleters.get(root.querySelector('#tags')!)!;
        const marking = (
            forms as unknown as {
                components: Map<HTMLElement, MarkingField>;
            }
        ).components.get(root.querySelector('#marking')!)!;

        // Start with an explicit, certain branch pick: rendered as the
        // leading part mark.
        tags.setAssertions([
            {
                conceptId: 'OAKWOOD',
                categoryId: 'from_school',
                confidence: 'certain',
                source: 'user',
            },
            {
                conceptId: 'STATE_ASSESSMENT_STAFF',
                categoryId: 'level',
                confidence: 'certain',
                source: 'user',
            },
        ]);
        await flush();

        let state = forms.store.get('doc-marking');
        expect(state.rendered).toContain('OAKWOOD');
        expect(state.rendered).not.toContain('OUR SCHOOL');

        // Delete OAKWOOD. The engine's default-fill rule auto-asserts
        // OUR_SCHOOL into the now-empty from_school category.
        tags.setAssertions([
            {
                conceptId: 'STATE_ASSESSMENT_STAFF',
                categoryId: 'level',
                confidence: 'certain',
                source: 'user',
            },
        ]);
        await flush();

        state = forms.store.get('doc-marking');
        const branchAssertion = state.assertions.find(
            (a) => a.categoryId === 'from_school',
        );
        // Sanity check the fixture actually exercises the default-fill path;
        // if the engine ever stops auto-filling here, this test would
        // otherwise pass for the wrong reason (nothing to suppress).
        expect(branchAssertion?.conceptId).toBe('OUR_SCHOOL');

        // Rendered surfaces: OUR SCHOOL must be absent from ALL of them.
        expect(state.rendered).not.toContain('OUR SCHOOL');
        expect(root.querySelector<HTMLInputElement>('#tags')!.value).toBe(
            state.rendered,
        );
        expect(
            root.querySelector<HTMLInputElement>('#tags')!.value,
        ).not.toContain('OUR SCHOOL');

        const markingHost =
            root.querySelector<HTMLTextAreaElement>('#marking')!;
        expect(markingHost.value).toBe(state.rendered);
        expect(markingHost.value).not.toContain('OUR SCHOOL');
        expect(marking.getRendered()).toBe(state.rendered);

        const paintedDisplay = root.querySelector('.marking-field-display')!;
        expect(paintedDisplay.textContent).toBe(state.rendered);
        expect(paintedDisplay.textContent).not.toContain('OUR SCHOOL');

        // State surfaces: OUR SCHOOL correctly SHOWS as selected.
        const chips = [
            ...root.querySelectorAll(
                '[data-ezclassify-mount="tags"] .proto-tag',
            ),
        ];
        const ourSchoolChip = chips.find(
            (c) => (c as HTMLElement).dataset.conceptId === 'OUR_SCHOOL',
        );
        expect(ourSchoolChip).toBeDefined();

        // Focus alone never opens the picker; ArrowDown is the request.
        markingHost.focus();
        markingHost.dispatchEvent(
            new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }),
        );
        await flush();
        const checkedRow = rows().find(
            (row) =>
                row.dataset.conceptId === 'OUR_SCHOOL' &&
                row.dataset.categoryId === 'from_school',
        );
        expect(checkedRow?.getAttribute('aria-selected')).toBe('true');
        const otherCategory = rows().find(
            (row) =>
                row.dataset.conceptId === 'OUR_SCHOOL' &&
                row.dataset.categoryId === 'questions_from',
        );
        expect(otherCategory?.getAttribute('aria-selected')).toBe('false');
        expect(
            checkedRow?.querySelector('.ez-composer__check')?.textContent,
        ).toBe('\u2713');
    });
});
