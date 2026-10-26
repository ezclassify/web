/**
 * CategoryChecklist reflects its category's committed store state after an
 * external publish, whether the control mounts before or after that publish.
 * Selected concepts remain visible when availability updates hide other
 * options.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadMultiScopeRegression } from '../test-fixtures/load-multi-scope-regression';
import { EzClassifyUI } from './ezclassify-ui';

const CHECKLIST_FACET_HTML = `
  <input type="hidden" id="doc-marking" data-ezclassify-rendered />
  <div id="source-policy-checklist" data-ezclassify-controller="checklist"
       data-ezclassify-facet-of="doc-marking"
       data-ezclassify-scope="office_record"
       data-ezclassify-category="comes_from"></div>
`;

async function flush(): Promise<void> {
    for (let i = 0; i < 8; i++) await Promise.resolve();
}

/** The checklist's checked concept ids, read from the live DOM. */
function checkedConceptIds(root: HTMLElement): string[] {
    return [
        ...root.querySelectorAll<HTMLInputElement>(
            '[data-ezclassify-mount="checklist"] .category-checklist-checkbox',
        ),
    ]
        .filter((cb) => cb.checked)
        .map((cb) => cb.dataset.conceptId ?? '');
}

function countText(root: HTMLElement): string {
    return (
        root.querySelector(
            '[data-ezclassify-mount="checklist"] .category-checklist-count',
        )?.textContent ?? ''
    );
}

describe('CategoryChecklist hydrates from external store publishes', () => {
    let root: HTMLDivElement;
    let forms: EzClassifyUI | null;

    beforeEach(() => {
        document.body.innerHTML = '';
        root = document.createElement('div');
        document.body.appendChild(root);
        forms = null;
    });

    afterEach(() => {
        forms?.destroy();
        document.body.innerHTML = '';
    });

    const SCOPED_ASSERTION = {
        conceptId: 'NEW_ITEM',
        categoryId: 'comes_from',
        confidence: 'certain' as const,
        source: 'user' as const,
    };

    it('publish while mounted: checkbox reflects the external assertions', async () => {
        root.innerHTML = CHECKLIST_FACET_HTML;
        forms = new EzClassifyUI(loadMultiScopeRegression(), { root });
        await flush();

        await forms.store.publishAssertions('doc-marking', [SCOPED_ASSERTION]);
        await flush();

        expect(checkedConceptIds(root)).toContain('NEW_ITEM');
        expect(countText(root)).toMatch(/^1 of /);
    });

    it('publish after a facet allowability push: the new selection still renders checked', async () => {
        root.innerHTML = CHECKLIST_FACET_HTML;
        forms = new EzClassifyUI(loadMultiScopeRegression(), { root });
        await flush();

        // A default-scope commit first: triggers the store's suggest fan-out,
        // so the checklist receives an allowable-options push while nothing in
        // its category is selected.
        await forms.store.publishAssertions('doc-marking', [
            {
                conceptId: 'DISTRICT_COORDINATORS',
                categoryId: 'level',
                confidence: 'certain',
                source: 'user',
            },
        ]);
        await flush();

        // Now the external scoped publish lands.
        await forms.store.publishAssertions('doc-marking', [
            {
                conceptId: 'DISTRICT_COORDINATORS',
                categoryId: 'level',
                confidence: 'certain',
                source: 'user',
            },
            SCOPED_ASSERTION,
        ]);
        await flush();

        expect(checkedConceptIds(root)).toContain('NEW_ITEM');
        expect(countText(root)).toMatch(/^1 of /);
    });

    it('publish of a gated-out concept: the checklist rebuilds and shows it checked', async () => {
        root.innerHTML = CHECKLIST_FACET_HTML;
        forms = new EzClassifyUI(loadMultiScopeRegression(), { root });
        await flush();

        // Simulate a facet allowability push that gates every concept out
        // (engine ran, nothing available for this category). The list is now
        // the "No matching items" placeholder.
        const el = root.querySelector<HTMLElement>('#source-policy-checklist')!;
        const components = (
            forms as unknown as {
                components: Map<
                    HTMLElement,
                    {
                        applyAllowableOptions(o: unknown[] | null): void;
                        setAssertions(a: unknown[]): void;
                    }
                >;
            }
        ).components;
        const checklist = components.get(el)!;
        checklist.applyAllowableOptions([]);
        expect(checkedConceptIds(root)).toEqual([]);

        // The external update selects a concept the gate had hidden.
        // setAssertions is the entry the runtime's store listener calls; the
        // control must show the selection checked on its own, without waiting
        // for the store's next allowability push to rebuild the list (same
        // keep-selected-visible rule applyAllowableOptions applies when the
        // push arrives after the selection).
        checklist.setAssertions([SCOPED_ASSERTION]);

        expect(checkedConceptIds(root)).toContain('NEW_ITEM');
        expect(countText(root)).toMatch(/^1 of /);
    });

    it('mount after publish: checkbox reflects the pre-existing store state', async () => {
        // Marking host exists first; the publish lands before the checklist mounts.
        root.innerHTML = `<input type="hidden" id="doc-marking" data-ezclassify-rendered />`;
        forms = new EzClassifyUI(loadMultiScopeRegression(), { root });
        await flush();

        await forms.store.publishAssertions('doc-marking', [SCOPED_ASSERTION]);
        await flush();

        const late = document.createElement('div');
        late.id = 'source-policy-checklist';
        late.setAttribute('data-ezclassify-controller', 'checklist');
        late.setAttribute('data-ezclassify-facet-of', 'doc-marking');
        late.setAttribute('data-ezclassify-scope', 'office_record');
        late.setAttribute('data-ezclassify-category', 'comes_from');
        root.appendChild(late);
        await flush();
        await flush();

        expect(checkedConceptIds(root)).toContain('NEW_ITEM');
        expect(countText(root)).toMatch(/^1 of /);
    });
});
