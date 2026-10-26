/**
 * Externally published store state reaches every bound view.
 *
 * A host can stage a marking's state programmatically:
 * `store.publishAssertions(id, [...])` with no view involved (a scenario
 * loader, a server-restored draft, a sibling page section). Every view bound to
 * that marking is supposed to show the result.
 *
 * Two moments matter:
 *
 * - **Live**: the publish lands while the view is already mounted. The store's
 *   per-marking subscription fires and the view re-renders.
 * - **At mount**: the publish already happened when the view mounts. Nothing
 *   fires; a subscription only delivers FUTURE commits, so the view has to
 *   hydrate at mount or it paints empty against a populated store.
 *
 * The at-mount case is the normal one for any conditionally rendered control:
 * the host publishes state, the host's own render reacts to that state and
 * mounts the controls the state calls for, and every one of those controls is
 * born after the commit it exists to display.
 *
 * The multi-scope fixture supplies each shape this has to hold for:
 * `comes_from` (an alternate-scope single-select card group),
 * `marked_by`/`MARKED_BY_TEXT` (a card carrying free-text capture), and
 * `artifact` (a default-scope multi-select the checklist counts).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { Assertion } from '@ezclassify/types';
import { loadMultiScopeRegression } from '../test-fixtures/load-multi-scope-regression';
import { EzClassifyUI } from './ezclassify-ui';

const MARKING_ID = 'doc-marking';

/** The staged authority-block-shaped state a host publishes in one call. */
const STAGED: Assertion[] = [
    {
        conceptId: 'STATE_ASSESSMENT_STAFF',
        categoryId: 'level',
        confidence: 'certain',
        source: 'user',
    },
    {
        conceptId: 'NEW_ITEM',
        categoryId: 'comes_from',
        confidence: 'certain',
        source: 'user',
    },
    {
        conceptId: 'MARKED_BY_TEXT',
        categoryId: 'marked_by',
        confidence: 'certain',
        source: 'user',
        value: 'M. Chen, Review Board Secretariat',
    },
    {
        conceptId: 'TEST',
        categoryId: 'artifact',
        confidence: 'certain',
        source: 'user',
    },
    {
        conceptId: 'ANSWER_KEY',
        categoryId: 'artifact',
        confidence: 'certain',
        source: 'user',
    },
];

/** The facet views, as a host renders them once the staged state resolves. */
const VIEWS_HTML = `
  <div id="source-policy-host" data-ezclassify-controller="select"
       data-ezclassify-facet-of="${MARKING_ID}"
       data-ezclassify-scope="office_record"
       data-ezclassify-category="comes_from"></div>
  <div id="labeled-by-host" data-ezclassify-controller="select"
       data-ezclassify-facet-of="${MARKING_ID}"
       data-ezclassify-scope="office_record"
       data-ezclassify-category="marked_by"></div>
  <div id="artifact-host" data-ezclassify-controller="checklist"
       data-ezclassify-facet-of="${MARKING_ID}"
       data-ezclassify-category="artifact"></div>
`;

async function flush(): Promise<void> {
    for (let i = 0; i < 40; i++) await Promise.resolve();
}

describe('externally published store state reaches bound views', () => {
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

    /**
     * The component's rendered subtree. The runtime hides the declarative host
     * element and mounts the component into a sibling `[data-ezclassify-mount]`
     * div, so every DOM assertion below reads from there, not from the host.
     */
    function mountOf(hostId: string): HTMLElement {
        const mount = root.querySelector<HTMLElement>(
            `#${hostId} + [data-ezclassify-mount]`,
        );
        expect(mount, `no mount rendered for #${hostId}`).not.toBeNull();
        return mount!;
    }

    /** The card group a facet select rendered, resolved from its host element. */
    function cards(hostId: string): HTMLElement[] {
        return Array.from(
            mountOf(hostId).querySelectorAll<HTMLElement>('.select-card'),
        );
    }

    /** The label text of the card the view is showing as selected. */
    function selectedCardLabel(hostId: string): string | undefined {
        const select =
            mountOf(hostId).querySelector<HTMLSelectElement>(
                '.select-dropdown',
            );
        if (select) {
            return select.selectedOptions[0]?.value
                ? (select.selectedOptions[0].textContent ?? undefined)
                : undefined;
        }
        const selected = cards(hostId).find(
            (c) => c.getAttribute('aria-checked') === 'true',
        );
        return (
            selected?.querySelector('.select-card-label')?.textContent ??
            undefined
        );
    }

    /** The value sitting in a selected card's free-text capture input. */
    function captureValue(hostId: string): string | undefined {
        const field = mountOf(hostId).querySelector<HTMLInputElement>(
            '.select-card-text-field',
        );
        return field?.value;
    }

    /** The checklist's "N of M" counter text. */
    function counterText(hostId: string): string | undefined {
        return (
            mountOf(hostId).querySelector<HTMLElement>(
                '.category-checklist-count',
            )?.textContent ?? undefined
        );
    }

    /** The concept ids the checklist is showing as checked. */
    function checkedConceptIds(hostId: string): string[] {
        return Array.from(
            mountOf(hostId).querySelectorAll<HTMLInputElement>(
                '.category-checklist-checkbox',
            ),
        )
            .filter((cb) => cb.checked)
            .map((cb) => cb.dataset.conceptId ?? '');
    }

    /** Append the facet views and let the mutation observer attach them. */
    async function mountViews(): Promise<void> {
        const holder = document.createElement('div');
        holder.innerHTML = VIEWS_HTML;
        while (holder.firstChild) root.appendChild(holder.firstChild);
        await flush();
    }

    it('hydrates a view that mounts AFTER the state was published', async () => {
        forms = new EzClassifyUI(loadMultiScopeRegression(), { root });
        await flush();

        await forms.store.publishAssertions(MARKING_ID, STAGED);
        await flush();

        // Sanity: the store really is holding the staged state.
        const committed = forms.store.get(MARKING_ID);
        expect(
            committed.assertions.some((a) => a.conceptId === 'NEW_ITEM'),
        ).toBe(true);

        await mountViews();

        expect(selectedCardLabel('source-policy-host')).toBe('NEW ITEM');
        expect(captureValue('labeled-by-host')).toBe(
            'M. Chen, Review Board Secretariat',
        );
        expect(counterText('artifact-host')).toBe('2 of 4');
        expect(checkedConceptIds('artifact-host').sort()).toEqual([
            'ANSWER_KEY',
            'TEST',
        ]);
    });

    it('hydrates a view when the state is published AFTER it mounts', async () => {
        forms = new EzClassifyUI(loadMultiScopeRegression(), { root });
        await flush();
        await mountViews();

        expect(selectedCardLabel('source-policy-host')).toBeUndefined();

        await forms.store.publishAssertions(MARKING_ID, STAGED);
        await flush();

        expect(selectedCardLabel('source-policy-host')).toBe('NEW ITEM');
        expect(captureValue('labeled-by-host')).toBe(
            'M. Chen, Review Board Secretariat',
        );
        expect(counterText('artifact-host')).toBe('2 of 4');
        expect(checkedConceptIds('artifact-host').sort()).toEqual([
            'ANSWER_KEY',
            'TEST',
        ]);
    });

    it('leaves an unpublished marking alone when a view mounts against it', async () => {
        forms = new EzClassifyUI(loadMultiScopeRegression(), { root });
        await flush();
        await mountViews();

        expect(selectedCardLabel('source-policy-host')).toBeUndefined();
        expect(forms.store.get(MARKING_ID).assertions).toEqual([]);
        // Nothing is selected, and the checklist offers the one artifact the
        // rules allow while nothing else on the marking is chosen.
        expect(counterText('artifact-host')).toBe('0 of 1');
    });

    it('does not fight an edit the view itself published', async () => {
        forms = new EzClassifyUI(loadMultiScopeRegression(), { root });
        await flush();
        await mountViews();

        // The view's own pick round-trips through the store and comes back at
        // the same subscription the hydrate step shares. It must land once and
        // stay put, not get re-applied or reverted by the echo.
        const host = root.querySelector<HTMLElement>('#source-policy-host')!;
        const select = (
            forms as unknown as {
                components: Map<
                    HTMLElement,
                    { setAssertions(a: Assertion[]): void }
                >;
            }
        ).components.get(host)!;
        select.setAssertions([
            {
                conceptId: 'FROM_TEST_BANK',
                categoryId: 'comes_from',
                confidence: 'certain',
                source: 'user',
            },
        ]);
        await flush();

        expect(selectedCardLabel('source-policy-host')).toBe('FROM TEST BANK');
        expect(
            forms.store
                .get(MARKING_ID)
                .assertions.filter((a) => a.categoryId === 'comes_from')
                .map((a) => a.conceptId),
        ).toEqual(['FROM_TEST_BANK']);
    });
});

/**
 * The same hydrate-at-mount contract across every remaining controller that
 * binds marking state. `select` / `checklist` are covered above; these are the
 * rest of the marking-bound surface. `text` (a producer-only readonly host) and
 * `marked-textarea` uses ordered entry membership rather than this scalar
 * hydration path; its entry editing and source ownership have separate
 * coverage. The producer-only text controller has no hydration step. Plain
 * `data-ezclassify-bind` inputs are a behavior path, not a component view, and
 * are not covered here.
 */
describe('hydrate-at-mount covers every marking-bound controller', () => {
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

    /**
     * Start the runtime, publish the staged state, then append `html` and let
     * the mutation observer mount it against the already-populated marking.
     */
    async function mountAfterPublish(html: string): Promise<void> {
        forms = new EzClassifyUI(loadMultiScopeRegression(), { root });
        await flush();
        await forms.store.publishAssertions(MARKING_ID, STAGED);
        await flush();
        const holder = document.createElement('div');
        holder.innerHTML = html;
        while (holder.firstChild) root.appendChild(holder.firstChild);
        await flush();
    }

    function mountOf(hostId: string): HTMLElement {
        const mount = root.querySelector<HTMLElement>(
            `#${hostId} + [data-ezclassify-mount]`,
        );
        expect(mount, `no mount rendered for #${hostId}`).not.toBeNull();
        return mount!;
    }

    it('selector: the published concept shows as the checked option', async () => {
        await mountAfterPublish(`
          <div id="selector-host" data-ezclassify-controller="selector"
               data-ezclassify-facet-of="${MARKING_ID}"
               data-ezclassify-category="artifact"></div>`);

        const checked = Array.from(
            mountOf('selector-host').querySelectorAll<HTMLElement>(
                '[aria-checked="true"]',
            ),
        ).map((el) => el.textContent?.trim());
        expect(checked).toContain('TEST');
        expect(checked).toContain('ANSWER KEY');
    });

    it('tags: the published concepts show as chips in the input', async () => {
        await mountAfterPublish(`
          <input id="tags-host" data-ezclassify-controller="tags"
                 data-ezclassify-bound-to="${MARKING_ID}" />`);

        const input = root.querySelector<HTMLInputElement>('#tags-host')!;
        expect(input.value).toBe(forms!.store.get(MARKING_ID).rendered);
        expect(input.value).toContain('STATE ASSESSMENT STAFF');
    });

    it('hidden: the published assertions land in the headless field', async () => {
        await mountAfterPublish(`
          <div id="hidden-host" data-ezclassify-controller="hidden"
               data-ezclassify-bound-to="${MARKING_ID}"></div>`);

        const host = root.querySelector<HTMLElement>('#hidden-host')!;
        const field = (
            forms as unknown as {
                components: Map<HTMLElement, { getRendered(): string }>;
            }
        ).components.get(host)!;
        expect(field.getRendered()).toBe(forms!.store.get(MARKING_ID).rendered);
    });

    it('marked-input: the published marking shows in the inline control', async () => {
        await mountAfterPublish(`
          <input type="text" id="marked-host" data-ezclassify-controller="marked-input"
                    data-ezclassify-bound-to="${MARKING_ID}">`);

        const host = root.querySelector<HTMLElement>('#marked-host')!;
        const field = (
            forms as unknown as {
                components: Map<HTMLElement, { getAssertions(): Assertion[] }>;
            }
        ).components.get(host)!;
        expect(
            field
                .getAssertions()
                .some((a) => a.conceptId === 'STATE_ASSESSMENT_STAFF'),
        ).toBe(true);
    });
});
