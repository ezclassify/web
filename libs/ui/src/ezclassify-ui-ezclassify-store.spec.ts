/**
 * Runtime wireup tests for `EzClassifyUI` + `EzClassifyStore` cross-talk.
 *
 * Each spec mounts the scanner's binding pass on a small DOM with
 * `data-ezclassify-rendered` + `data-ezclassify-bound-to` /
 * `data-ezclassify-facet-of` siblings, then drives one view's component surface
 * (tag input `setValue` / select `addAssertion`) and asserts the others were
 * fanned the new state through the store.
 *
 * The multi-scope fixture is the fixture engine, its `level` and `from_school`
 * categories are both `single: true`, which is exactly the shape the
 * four-fields demo from `docs/binding-model.md` §11 needs.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { openSurface } from './components/composer/composer-harness';
import { loadMultiScopeRegression } from '../test-fixtures/load-multi-scope-regression';
import { EzClassifyUI } from './ezclassify-ui';
import {
    VanillaEzClassifyStore,
    type EzClassifyState,
} from './store/ezclassify-store';
import type { Assertion, ProcessResult, RenderResult } from '@ezclassify/types';
import type { TagInput } from './components/tag-input';
import type { SingleSelect } from './components/single-select';

const FOUR_FIELDS_HTML = `
  <input type="hidden" id="doc-marking" data-ezclassify-rendered />
  <input id="ac" data-ezclassify-controller="tags"
         data-ezclassify-bound-to="doc-marking" />
  <input id="level" data-ezclassify-controller="select"
         data-ezclassify-facet-of="doc-marking"
         data-ezclassify-category="level" />
  <input id="branch" data-ezclassify-controller="select"
         data-ezclassify-facet-of="doc-marking"
         data-ezclassify-category="from_school" />
`;

/**
 * Mount the runtime on `root` and resolve once it reports ready (its mount
 * sweep and store seeding have settled), however long that takes.
 */
async function mountReady(
    root: HTMLElement,
    engine = loadMultiScopeRegression(),
): Promise<EzClassifyUI> {
    const ready = new Promise((resolve) =>
        root.addEventListener('ezclassify:ready', resolve, { once: true }),
    );
    const forms = new EzClassifyUI(engine, { root });
    await ready;
    return forms;
}

/** Resolve on the next `type` event `target` dispatches. */
function nextEvent(target: EventTarget, type: string): Promise<Event> {
    return new Promise((resolve) =>
        target.addEventListener(type, resolve, { once: true }),
    );
}

async function flush(): Promise<void> {
    // The store's publish path is `engine.process` async + commit; let
    // microtasks drain a couple of times so subscriber-driven reprocesses
    // get to run before we assert.
    for (let i = 0; i < 6; i++) {
        await Promise.resolve();
    }
}

describe('EzClassifyUI store wireup', () => {
    let root: HTMLDivElement;
    let forms: EzClassifyUI | null;

    beforeEach(() => {
        document.body.innerHTML = '';
        root = document.createElement('div');
        root.innerHTML = FOUR_FIELDS_HTML;
        document.body.appendChild(root);
        forms = null;
    });

    afterEach(() => {
        forms?.destroy();
        document.body.innerHTML = '';
    });

    it('indexes standalone marking and tags before source views and contributes once per part', async () => {
        root.innerHTML = `
          <output id="mirror" data-ezclassify-source="part"></output>
          <input id="whole" type="hidden" data-ezclassify-rendered value="DISTRICT COORDINATORS">
          <input id="part" data-ezclassify-controller="marking" data-ezclassify-part-of="whole" value="DISTRICT COORDINATORS">
          <input id="tags-part" data-ezclassify-controller="tags" data-ezclassify-part-of="whole" value="STUDENTS">
          <input id="bound" data-ezclassify-controller="marking" data-ezclassify-bound-to="part">
          <input id="facet" data-ezclassify-controller="tags" data-ezclassify-facet-of="part" data-ezclassify-category="level">
        `;
        const engine = loadMultiScopeRegression();
        const high = (await engine.process('DISTRICT COORDINATORS')).rendered;
        const low = (await engine.process('STUDENTS')).rendered;
        forms = await mountReady(root, engine);
        // This registration fixture needs a whole that actually covers both parts.
        expect(forms.store.get('part').valid).toBe(true);
        expect(forms.store.get('part').errors).toEqual([]);
        expect(forms.store.get('tags-part').valid).toBe(true);
        expect(forms.store.get('part').rendered).toBe('DC');
        expect(forms.store.get('tags-part').rendered).toBe('ST');
        expect(root.querySelector('#mirror')!.textContent).toBe('DC');
        await vi.waitFor(() =>
            expect(forms!.store.getWholeRollup('whole').rendered).toBe(high),
        );
        const changes: string[] = [];
        const unsubscribe = forms.store.subscribe('part', (state) =>
            changes.push(state.rendered),
        );
        await forms.store.publishRendered('part', 'STUDENTS');
        await flush();
        expect(changes).toContain('ST');
        expect(root.querySelector('#mirror')!.textContent).toBe('ST');
        expect(forms.store.get('bound').rendered).toBe('');
        expect(forms.store.get('facet').rendered).toBe('');
        unsubscribe();
        root.querySelector('#part')!.remove();
        await new Promise((resolve) => setTimeout(resolve, 50));
        await vi.waitFor(() =>
            expect(forms!.store.getWholeRollup('whole').rendered).toBe(low),
        );
    });

    it('indexes a late standalone host before its earlier sibling source view', async () => {
        forms = await mountReady(root);
        const group = document.createElement('section');
        group.innerHTML = `<output id="late-preview" data-ezclassify-source="late"></output><input id="late" value="STUDENTS" data-ezclassify-controller="marking">`;
        root.appendChild(group);
        await vi.waitFor(() =>
            expect(forms!.store.get('late').rendered).toBe('STUDENTS'),
        );
        await vi.waitFor(() =>
            expect(root.querySelector('#late-preview')!.textContent).toBe(
                'STUDENTS',
            ),
        );
        group.remove();
        await vi.waitFor(() =>
            expect(forms!.store.get('late').rendered).toBe(''),
        );
    });

    it('gives category-filtered standalone tags one identity and leaves explicit views unregistered', async () => {
        root.innerHTML = `
          <input data-ezclassify-controller="tags" data-ezclassify-category="level" value="STUDENTS">
          <input id="whole" value="STUDENTS" data-ezclassify-controller="marking">
          <input id="read" data-ezclassify-controller="marking" data-ezclassify-source="whole">
          <input id="aggregate" data-ezclassify-controller="marking" data-ezclassify-aggregate>
          <input id="bound" data-ezclassify-controller="marking" data-ezclassify-bound-to="whole">
          <input id="facet" data-ezclassify-controller="tags" data-ezclassify-facet-of="whole" data-ezclassify-category="level">
        `;
        forms = await mountReady(root);
        const categoryHost = root.querySelector<HTMLInputElement>(
            'input[data-ezclassify-category="level"]',
        )!;
        expect(categoryHost.id).toMatch(/^__ez-tags-/);
        expect(
            forms.store
                .get(categoryHost.id)
                .assertions.some((a) => a.conceptId === 'STUDENTS'),
        ).toBe(true);
        for (const id of ['read', 'aggregate', 'bound', 'facet'])
            expect(forms.store.get(id).assertions).toHaveLength(0);
        const sameStore = forms.store;
        const stableId = categoryHost.id;
        forms.destroy();
        forms = new EzClassifyUI(loadMultiScopeRegression(), {
            root,
            store: sameStore,
        });
        await vi.waitFor(() =>
            expect(
                forms!.store
                    .get(stableId)
                    .assertions.some((a) => a.conceptId === 'STUDENTS'),
            ).toBe(true),
        );
        expect(categoryHost.id).toBe(stableId);
    });

    it('exposes a default VanillaEzClassifyStore when none is supplied', () => {
        forms = new EzClassifyUI(loadMultiScopeRegression(), { root });
        expect(forms.store).toBeInstanceOf(VanillaEzClassifyStore);
    });

    it('keeps unrecognized store text visible and invalid in both authoring views', async () => {
        root.innerHTML = `
          <input type="hidden" id="doc-marking" data-ezclassify-rendered />
          <textarea id="marking" data-ezclassify-controller="marking"
                    data-ezclassify-bound-to="doc-marking">UNKNOWN-VOCABULARY</textarea>
          <input id="tags" data-ezclassify-controller="tags"
                 data-ezclassify-bound-to="doc-marking" value="UNKNOWN-VOCABULARY" />
        `;
        forms = await mountReady(root);
        await forms.store.publishRendered('doc-marking', 'UNKNOWN-VOCABULARY');
        await flush();
        const state = forms.store.get('doc-marking');
        expect(state.rendered).toBe('UNKNOWN-VOCABULARY');
        expect(state.valid).toBe(false);
        expect(
            state.errors.some(
                (error) => error.constraintId === '_unmatched_token',
            ),
        ).toBe(true);
        expect(root.querySelector('.marking-field-display')?.textContent).toBe(
            'UNKNOWN-VOCABULARY',
        );
        expect(root.querySelector<HTMLInputElement>('#tags')?.value).toBe(
            'UNKNOWN-VOCABULARY',
        );
        expect(
            root.querySelectorAll('[data-ezclassify-invalid]').length,
        ).toBeGreaterThanOrEqual(2);
        const markingErrors = root.querySelector<HTMLElement>(
            '.marking-field-wrap > .ez-validation-errors',
        );
        expect(markingErrors).not.toBeNull();
        expect(markingErrors!.hidden).toBe(false);
        expect(markingErrors!.textContent).toContain('not recognized');
        await forms.store.publishRendered('doc-marking', 'STUDENTS//UNKNOWN');
        await flush();
        const mixed = forms.store.get('doc-marking');
        expect(mixed.rendered).toContain('UNKNOWN');
        expect(
            mixed.assertions.some(
                (assertion) => assertion.conceptId === 'STUDENTS',
            ),
        ).toBe(true);
        expect(mixed.valid).toBe(false);
        expect(root.querySelector('.marking-field-display')?.textContent).toBe(
            mixed.rendered,
        );
        expect(root.querySelector<HTMLInputElement>('#tags')?.value).toBe(
            mixed.rendered,
        );
        await forms.store.publishRendered('doc-marking', 'STUDENTS');
        await flush();
        expect(forms.store.get('doc-marking').valid).toBe(true);
        expect(root.querySelector<HTMLInputElement>('#tags')?.value).toBe(
            'STUDENTS',
        );
        expect(markingErrors!.hidden).toBe(true);
        await forms.store.publishRendered('doc-marking', '');
        await flush();
        expect(markingErrors!.hidden).toBe(true);
    });

    it('keeps a canonical unknown reading when an older component reprocess finishes later', async () => {
        root.innerHTML = `
          <input type="hidden" id="doc-marking" data-ezclassify-rendered />
          <textarea id="marking" data-ezclassify-controller="marking"
                    data-ezclassify-bound-to="doc-marking"></textarea>
        `;
        const engine = loadMultiScopeRegression();
        forms = await mountReady(root, engine);
        const known = engine.process('STUDENTS');
        const unknown = engine.process('UNKNOWN-VOCABULARY');
        let finish!: (result: ProcessResult) => void;
        const pending = new Promise<ProcessResult>((resolve) => {
            finish = resolve;
        });
        vi.spyOn(engine, 'process').mockImplementationOnce(
            () => pending as never,
        );
        const field = forms.components.get(root.querySelector('#marking')!)!;
        field.setAssertions(known.assertions);
        field.applyStoreState!(unknown);
        finish(known);
        await flush();
        expect(root.querySelector('.marking-field-display')?.textContent).toBe(
            unknown.rendered,
        );
        expect(forms.store.get('doc-marking').rendered).toBe(unknown.rendered);
        expect(forms.store.get('doc-marking').valid).toBe(false);
    });

    it('uses the caller-supplied store when one is passed', () => {
        const engine = loadMultiScopeRegression();
        const store = new VanillaEzClassifyStore(engine);
        forms = new EzClassifyUI(engine, { root, store });
        expect(forms.store).toBe(store);
    });

    it('bound-to MTA: external store commits do not overwrite the textarea body', async () => {
        // MarkedTextArea is a body editor, it is the source of truth for its own
        // content. A sibling component changing the same marking must NOT replace
        // the textarea with just the marking string (that would wipe all free text
        // and part markings the user authored).
        document.body.innerHTML = '';
        const root2 = document.createElement('div');
        const initialBody = '(STUDENTS) Intro text here.';
        root2.innerHTML = `
      <input type="hidden" id="doc-marking" data-ezclassify-rendered />
      <input id="ac" data-ezclassify-controller="tags"
             data-ezclassify-bound-to="doc-marking" />
      <textarea id="mta" data-ezclassify-controller="marked-textarea"
                data-ezclassify-bound-to="doc-marking">${initialBody}</textarea>
    `;
        document.body.appendChild(root2);
        forms = new EzClassifyUI(loadMultiScopeRegression(), {
            root: root2,
        });
        await flush();

        const textarea = root2.querySelector<HTMLTextAreaElement>('#mta')!;
        // Sanity: textarea starts with the authored content.
        expect(textarea.value).toBe(initialBody);

        // External commit (e.g. autocomplete sibling changing the marking).
        await forms.store.publishRendered('doc-marking', 'STUDENTS');
        await flush();

        // MTA is publish-only, it must still show the original body, not just
        // the bare rendered string the sibling published.
        expect(textarea.value).toBe(initialBody);
    });

    it('bound-to MTA: typing body prose never rewrites the shared marking state', async () => {
        // The textarea contains prose and embedded part marks. Its raw input
        // events must not overwrite the shared whole-marking state.
        document.body.innerHTML = '';
        const root2 = document.createElement('div');
        const initialBody = '(STUDENTS) Intro text here.';
        root2.innerHTML = `
      <input type="hidden" id="doc-marking" data-ezclassify-rendered />
      <textarea id="mta" data-ezclassify-controller="marked-textarea"
                data-ezclassify-bound-to="doc-marking">${initialBody}</textarea>
    `;
        document.body.appendChild(root2);
        forms = await mountReady(root2);

        const textarea = root2.querySelector<HTMLTextAreaElement>('#mta')!;
        const before = forms.store.get('doc-marking');

        // Body-only edit: append prose after the marked paragraph. The field
        // reports the text change once its debounced scan has run; anything
        // it would publish has been published by then.
        const scanned = nextEvent(textarea, 'ezclassify:text-change');
        textarea.value = initialBody + ' More prose typed by the user.';
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
        await scanned;
        await flush();

        const after = forms.store.get('doc-marking');
        expect(after.rendered).not.toContain('More prose');
        expect(after.rendered).not.toBe(textarea.value);
        expect(after.rendered).toBe(before.rendered);
    });

    it('bound-to MTA: a marking-segment change publishes segment assertions, not raw text', async () => {
        document.body.innerHTML = '';
        const root2 = document.createElement('div');
        root2.innerHTML = `
      <input type="hidden" id="doc-marking" data-ezclassify-rendered />
      <textarea id="mta" data-ezclassify-controller="marked-textarea"
                data-ezclassify-bound-to="doc-marking">(STUDENTS) Intro text.</textarea>
    `;
        document.body.appendChild(root2);
        forms = await mountReady(root2);

        const textarea = root2.querySelector<HTMLTextAreaElement>('#mta')!;
        // The store's publish of the new segment, whenever it lands.
        const published = new Promise<void>((resolve) => {
            const stop = forms!.store.subscribe('doc-marking', (next) => {
                if (
                    !next.assertions.some(
                        (a) => a.conceptId === 'DISTRICT_COORDINATORS',
                    )
                )
                    return;
                stop();
                resolve();
            });
        });
        // Change the part mark itself so the segment set changes.
        textarea.value = '(DISTRICT COORDINATORS) Intro text.';
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
        await published;

        const state = forms.store.get('doc-marking');
        // The store received structured assertions from the recognized segment;
        // never the textarea's raw body text.
        expect(state.rendered).not.toContain('Intro text');
        expect(
            state.assertions.some(
                (a) => a.conceptId === 'DISTRICT_COORDINATORS',
            ),
        ).toBe(true);
    });

    it('bound-to MarkingField: an external store commit never pops its dropdown open while unfocused', async () => {
        // Commit write-back emits a bubbling native input event, including a
        // sibling publish echoed through the shared store. An unfocused field
        // must not open its suggestion dropdown in response.
        document.body.innerHTML = '';
        const root2 = document.createElement('div');
        root2.innerHTML = `
      <input type="hidden" id="doc-marking" data-ezclassify-rendered />
      <input id="ac" data-ezclassify-controller="tags"
             data-ezclassify-bound-to="doc-marking" />
      <textarea id="mf" data-ezclassify-controller="marking"
                data-ezclassify-bound-to="doc-marking"></textarea>
    `;
        document.body.appendChild(root2);
        forms = await mountReady(root2);

        const mf = root2.querySelector<HTMLTextAreaElement>('#mf')!;
        expect(document.activeElement).not.toBe(mf);
        expect(mf.getAttribute('aria-expanded')).toBe('false');

        // Wait for the sibling commit to echo into this field and for any
        // resulting reading to settle.
        await forms.store.publishRendered('doc-marking', 'STUDENTS');
        await vi.waitFor(() => expect(mf.value).toBe('STUDENTS'));
        await flush();

        expect(document.activeElement).not.toBe(mf);
        expect(mf.getAttribute('aria-expanded')).toBe('false');
        expect(openSurface()).toBeNull();
    });

    it('facet-of → bound-to: a level facet pick reflects on the tag-input view', async () => {
        forms = new EzClassifyUI(loadMultiScopeRegression(), { root });
        await flush();

        await forms.store.publishAssertions('doc-marking', [
            {
                conceptId: 'STUDENTS',
                categoryId: 'level',
                confidence: 'certain',
                source: 'user',
            },
        ]);
        await flush();

        const ac = root.querySelector<HTMLInputElement>('#ac')!;
        // TagInput's value stays in the whole format so the forms rollup
        // can process it. Chip labels are separate DOM, not the value.
        expect(ac.value).toContain('STUDENTS');
    });

    it('facet-of → facet-of merging: different categories stay isolated; same-category siblings stay in sync', async () => {
        forms = new EzClassifyUI(loadMultiScopeRegression(), { root });
        await flush();

        // The level facet publishes STUDENTS; the school facet receives only the school slice
        // (engine inference may add a default branch, but the level picker
        // should not be displaced by the branch picker's emit).
        await forms.store.publishAssertions('doc-marking', [
            {
                conceptId: 'STUDENTS',
                categoryId: 'level',
                confidence: 'certain',
                source: 'user',
            },
        ]);
        await flush();

        const stateAfterLevel = forms.store.get('doc-marking');
        expect(
            stateAfterLevel.assertions.some(
                (a) => a.conceptId === 'STUDENTS' && a.categoryId === 'level',
            ),
        ).toBe(true);

        // School facet now picks OAKWOOD. The merge must preserve level.
        const branchComponent = root.querySelector<HTMLElement>('#branch')!;
        const components = (
            forms as unknown as { components: Map<HTMLElement, SingleSelect> }
        ).components;
        const branchSelect = components.get(branchComponent)!;
        expect(branchSelect).toBeDefined();

        // Add the branch assertion via the same path a click would take:
        // setAssertions exercises the component's reprocess → onChange → publish chain.
        branchSelect.setAssertions([
            {
                conceptId: 'OAKWOOD',
                categoryId: 'from_school',
                confidence: 'certain',
                source: 'user',
            },
        ]);
        await flush();

        const merged = forms.store.get('doc-marking');
        const levelStill = merged.assertions.some(
            (a) => a.conceptId === 'STUDENTS' && a.categoryId === 'level',
        );
        const branchPicked = merged.assertions.some(
            (a) => a.conceptId === 'OAKWOOD' && a.categoryId === 'from_school',
        );
        expect(levelStill).toBe(true);
        expect(branchPicked).toBe(true);
    });

    it('source dedup: a publisher does not receive its own commit', async () => {
        forms = new EzClassifyUI(loadMultiScopeRegression(), { root });
        await flush();

        // Grab the autocomplete component instance via the runtime's internal map.
        const acEl = root.querySelector<HTMLInputElement>('#ac')!;
        const autocompleters = (
            forms as unknown as {
                autocompleters: Map<HTMLInputElement, TagInput>;
            }
        ).autocompleters;
        const autocomplete = autocompleters.get(acEl)!;
        expect(autocomplete).toBeDefined();

        // Spy on setValue, if the publisher were fired back at on its own
        // commit, setValue would be invoked. Token dedup + the echo guard
        // together must prevent that.
        let setValueCalls = 0;
        const origSetValue = autocomplete.setValue.bind(autocomplete);
        autocomplete.setValue = ((v: string) => {
            setValueCalls++;
            return origSetValue(v);
        }) as typeof autocomplete.setValue;

        await forms.store.publishRendered(
            'doc-marking',
            'STUDENTS',
            { token: acEl }, // pretend the autocomplete itself published
        );
        await flush();

        expect(setValueCalls).toBe(0);
    });

    it('detaches the native-input listener on destroy so a torn-down autocompleter stops reacting', async () => {
        forms = new EzClassifyUI(loadMultiScopeRegression(), { root });
        await flush();

        const acEl = root.querySelector<HTMLInputElement>('#ac')!;
        const autocompleters = (
            forms as unknown as {
                autocompleters: Map<HTMLInputElement, TagInput>;
            }
        ).autocompleters;
        const autocomplete = autocompleters.get(acEl)!;
        expect(autocomplete).toBeDefined();

        // destroy() preserves the native input node (StrictMode-remount / reclaim
        // path), so its `input` listener must be removed or it will keep firing
        // on the destroyed autocompleter and stack one stale listener per remount.
        let setValueCalls = 0;
        const origSetValue = autocomplete.setValue.bind(autocomplete);
        autocomplete.setValue = ((v: string) => {
            setValueCalls++;
            return origSetValue(v);
        }) as typeof autocomplete.setValue;

        forms.destroy();

        // A user typing into the preserved input after teardown must not reach the
        // destroyed autocompleter.
        acEl.value = 'SOME EXTERNAL EDIT';
        acEl.dispatchEvent(new Event('input', { bubbles: true }));
        await flush();

        expect(setValueCalls).toBe(0);
    });

    it('ignores free-floating facet hints whose target marking has no rendered host', async () => {
        document.body.innerHTML = '';
        const root3 = document.createElement('div');
        root3.innerHTML = `
      <input id="level" data-ezclassify-controller="select"
             data-ezclassify-facet-of="missing-marking"
             data-ezclassify-category="level" />
    `;
        document.body.appendChild(root3);
        forms = new EzClassifyUI(loadMultiScopeRegression(), {
            root: root3,
        });
        await flush();

        // No throw, no warn, no subscription created.
        expect(forms.store.get('missing-marking').rendered).toBe('');
    });

    it('writes store rendered state back into the marking host on commit', async () => {
        forms = new EzClassifyUI(loadMultiScopeRegression(), { root });
        await flush();

        await forms.store.publishAssertions('doc-marking', [
            {
                conceptId: 'STUDENTS',
                categoryId: 'level',
                confidence: 'certain',
                source: 'user',
            },
        ]);
        await flush();

        const host = document.getElementById('doc-marking') as HTMLInputElement;
        expect(host.value).toBe('STUDENTS');
    });

    it('writes back on publishRendered too, not just publishAssertions', async () => {
        forms = new EzClassifyUI(loadMultiScopeRegression(), { root });
        await flush();

        await forms.store.publishRendered(
            'doc-marking',
            'DISTRICT COORDINATORS',
        );
        await flush();

        const host = document.getElementById('doc-marking') as HTMLInputElement;
        expect(host.value).toBe('DISTRICT COORDINATORS');
    });

    it('keeps the native host in step when a ready handler publishes the seed', async () => {
        const ready = new Promise<void>((resolve) => {
            root.addEventListener(
                'ezclassify:ready',
                () => {
                    forms?.store
                        .publishRendered('doc-marking', 'DISTRICT COORDINATORS')
                        .then(resolve);
                },
                { once: true },
            );
        });

        forms = new EzClassifyUI(loadMultiScopeRegression(), { root });
        await ready;
        await flush();

        const host = document.getElementById('doc-marking') as HTMLInputElement;
        expect(host.value).toBe('DISTRICT COORDINATORS');
        expect(forms.store.get('doc-marking').rendered).toBe(
            'DISTRICT COORDINATORS',
        );
    });

    it('does not write back to host elements that own a controller', async () => {
        // The writeback path that mirrors store commits into a hidden input's
        // `.value` is the wireHostWriteback subscription. When the host carries
        // its own controller, that path must stay out of the way so the
        // controller's onChange remains the only writer of the input value.
        //
        // (The newer self-rendered store-binding path may still register a
        // wireComponentStore subscription on the host, that one feeds
        // component.setValue, which goes through the same controller path the
        // onChange writes use, so there's no double-write.)
        document.body.innerHTML = '';
        const root5 = document.createElement('div');
        root5.innerHTML = `
      <input id="ac-host" data-ezclassify-controller="tags"
             data-ezclassify-rendered />
    `;
        document.body.appendChild(root5);
        forms = new EzClassifyUI(loadMultiScopeRegression(), {
            root: root5,
        });
        await flush();

        const acHost = document.getElementById('ac-host') as HTMLInputElement;
        // Publish a sibling-style update, the host carries an autocomplete
        // controller, so its `.value` should only move through the controller
        // (which fires an input event). If wireHostWriteback wired itself in
        // alongside the controller, we'd see `.value` set directly with no
        // input dispatch, and the test below would still match, what we're
        // really guarding is the absence of double-writes, so observe events.
        let inputEvents = 0;
        acHost.addEventListener('input', () => {
            inputEvents += 1;
        });
        await forms.store.publishRendered('ac-host', 'STUDENTS');
        await flush();
        // The autocomplete component dispatches the input event when its
        // setValue settles. The writeback path would have set .value
        // directly without dispatching, so exactly one event is the
        // signature of the controller writing without a duplicate.
        expect(inputEvents).toBeLessThanOrEqual(1);
    });

    it('seeds the store from a non-empty rendered host value during init', async () => {
        document.body.innerHTML = '';
        const root4 = document.createElement('div');
        root4.innerHTML = `
      <input type="hidden" id="doc-marking" value="STUDENTS" data-ezclassify-rendered />
      <input id="ac" data-ezclassify-controller="tags"
             data-ezclassify-bound-to="doc-marking" />
    `;
        document.body.appendChild(root4);
        forms = new EzClassifyUI(loadMultiScopeRegression(), {
            root: root4,
        });
        await flush();

        const state = forms.store.get('doc-marking');
        expect(state.rendered).toBe('STUDENTS');
    });

    it('reflects a plain bound input commit into a whole-marking category selector', async () => {
        document.body.innerHTML = '';
        const root5 = document.createElement('div');
        root5.innerHTML = `
      <input type="hidden" id="doc-marking" data-ezclassify-rendered />
      <fieldset id="whole-selector" data-ezclassify-controller="selector"
                data-ezclassify-bound-to="doc-marking"></fieldset>
      <input id="typed-marking" name="typed-marking" data-ezclassify-bind
             data-ezclassify-bound-to="doc-marking" />
    `;
        document.body.appendChild(root5);
        // Wait on what the runtime reports, not on a guessed delay: the mount
        // sweep and the commit (a debounced rollup, then the store publish)
        // take as long as the machine takes.
        forms = await mountReady(root5);

        const typed = root5.querySelector<HTMLInputElement>('#typed-marking')!;
        // The commit ends in the store publish; resolve on that, whenever it
        // lands.
        const published = new Promise<string>((resolve) => {
            const stop = forms!.store.subscribe('doc-marking', (state) => {
                if (!state.rendered) return;
                stop();
                resolve(state.rendered);
            });
        });
        typed.focus();
        typed.value = 'DISTRICT COORDINATORS';
        typed.blur();

        expect(await published).toBe('DISTRICT COORDINATORS');
        // The selector paints what the store fanned out to it.
        await vi.waitFor(() => {
            const selected = root5.querySelector<HTMLElement>(
                '[data-ezclassify-mount="selector"] [data-concept-id="DISTRICT_COORDINATORS"]',
            );
            expect(selected?.getAttribute('aria-checked')).toBe('true');
        });
    });

    it('uses the retained alternate view without reprocessing and refuses an unrepresentable view', async () => {
        document.body.innerHTML = '';
        const root5 = document.createElement('div');
        root5.innerHTML = `
      <input type="hidden" id="doc-marking" data-ezclassify-rendered />
      <input id="short-view" value="safe prior value" data-ezclassify-bind
             data-ezclassify-bound-to="doc-marking"
             data-ezclassify-format="short" />
    `;
        document.body.appendChild(root5);
        const engine = loadMultiScopeRegression();
        const originalProcess = engine.process.bind(engine);
        let processCalls = 0;
        engine.process = ((input: string | Assertion[], ...rest: unknown[]) => {
            processCalls += 1;
            const result = Reflect.apply(originalProcess, engine, [
                input,
                ...rest,
            ]) as ProcessResult;
            if (!Array.isArray(input)) return result;
            const refused = input[0]?.value === 'REFUSE';
            const invalid = input[0]?.value === 'INVALID';
            // Like a real engine, `short` is written only when it is named,
            // so the view showing it proves the store named it.
            const named = (
                rest[0] as { outputs?: string[] } | undefined
            )?.outputs?.includes('short');
            return {
                ...result,
                assertions: input,
                rendered:
                    input[0]?.value === 'EMPTY DEFAULT' ? '' : result.rendered,
                valid: !invalid,
                errors: invalid
                    ? [
                          {
                              constraintId: 'invalid-test',
                              message: 'The source marking is invalid.',
                          },
                      ]
                    : [],
                renders: named
                    ? {
                          short: {
                              rendered: refused
                                  ? '[unrepresentable:value-lossy]'
                                  : `SHORT ${String(input[0]?.value)}`,
                              assessment: {
                                  emitted: [],
                                  omitted: [],
                                  collapsed: [],
                                  conflicts: [],
                                  unrepresentable: refused
                                      ? [
                                            {
                                                conceptId:
                                                    input[0]?.conceptId ?? '',
                                                reason: 'value-lossy',
                                            },
                                        ]
                                      : [],
                              },
                          },
                      }
                    : {},
            };
        }) as typeof engine.process;
        forms = new EzClassifyUI(engine, { root: root5 });
        await flush();
        processCalls = 0;
        const shortView = root5.querySelector<HTMLInputElement>('#short-view')!;
        const typedAssertion = {
            categoryId: 'level',
            conceptId: 'STUDENTS',
            value: '2030-12-31',
        } as Assertion;

        await forms.store.publishAssertions('doc-marking', [typedAssertion]);
        await flush();

        expect(processCalls).toBe(1);
        expect(shortView.value).toBe('SHORT 2030-12-31');
        expect(
            forms.store.get('doc-marking').renders.short?.assessment
                .unrepresentable,
        ).toEqual([]);

        processCalls = 0;
        await forms.store.publishAssertions('doc-marking', [
            { ...typedAssertion, value: 'REFUSE' },
        ]);
        await flush();

        expect(processCalls).toBe(1);
        expect(shortView.value).toBe('SHORT 2030-12-31');
        expect(shortView.getAttribute('aria-invalid')).toBe('true');
        expect(shortView.validationMessage).toContain('value-lossy');
        expect(
            forms.store.get('doc-marking').renders.short?.assessment
                .unrepresentable,
        ).toHaveLength(1);

        await forms.store.publishAssertions('doc-marking', [
            { ...typedAssertion, value: 'INVALID' },
        ]);
        await flush();
        expect(shortView.value).toBe('SHORT INVALID');
        expect(shortView.getAttribute('aria-invalid')).toBe('true');
        expect(shortView.validationMessage).toBe(
            'The source marking is invalid.',
        );

        processCalls = 0;
        await forms.store.publishAssertions('doc-marking', [
            { ...typedAssertion, value: 'EMPTY DEFAULT' },
        ]);
        await flush();
        expect(forms.store.get('doc-marking').rendered).toBe('');
        expect(shortView.value).toBe('SHORT EMPTY DEFAULT');
        expect(shortView.validationMessage).toBe('');
        expect(processCalls).toBe(1);
    });

    it('renders structured aggregate assertions for an alternate-format binding', async () => {
        document.body.innerHTML = '';
        const root5 = document.createElement('div');
        root5.innerHTML = `
      <input type="hidden" id="doc-marking" data-ezclassify-rendered />
      <input id="short-rollup" value="safe prior value" data-ezclassify-bind
             data-ezclassify-bound-to="doc-marking"
             data-ezclassify-format="short" />
    `;
        document.body.appendChild(root5);
        const engine = loadMultiScopeRegression();
        const originalProcess = engine.process.bind(engine);
        const originalRender = engine.render.bind(engine);
        const renderValues: Array<string | undefined> = [];
        const resolveSlow: Array<(result: RenderResult) => void> = [];
        engine.process = ((input: string | Assertion[], ...rest: unknown[]) => {
            if (!Array.isArray(input))
                return Reflect.apply(originalProcess, engine, [input, ...rest]);
            const processed = Reflect.apply(originalProcess, engine, [
                input,
                ...rest,
            ]) as ProcessResult;
            return {
                ...processed,
                assertions: input,
            };
        }) as typeof engine.process;
        engine.aggregateAssertions = ((sets: Assertion[][]) => {
            const assertions = sets.flat();
            const invalid = assertions[0]?.value === 'INVALID';
            return {
                rendered: `ROLLUP ${String(assertions[0]?.value)}`,
                assertions,
                valid: !invalid,
                errors: invalid
                    ? [
                          {
                              constraintId: 'invalid-test',
                              message: 'The aggregate source is invalid.',
                          },
                      ]
                    : [],
            };
        }) as typeof engine.aggregateAssertions;
        engine.render = ((assertions: Assertion[], format?: string) => {
            renderValues.push(assertions[0]?.value);
            if (format !== 'short') return originalRender(assertions, format);
            if (assertions[0]?.value === 'THROW') {
                throw new Error('synchronous render failure');
            }
            if (assertions[0]?.value?.startsWith('SLOW')) {
                return new Promise<RenderResult>((resolve) => {
                    resolveSlow.push(resolve);
                });
            }
            const refused = assertions[0]?.value === 'REFUSE';
            return {
                rendered: refused
                    ? '[unrepresentable:value-lossy]'
                    : `SHORT ${String(assertions[0]?.value)}`,
                assessment: {
                    emitted: [],
                    omitted: [],
                    collapsed: [],
                    conflicts: [],
                    unrepresentable: refused
                        ? [
                              {
                                  conceptId: assertions[0]?.conceptId ?? '',
                                  reason: 'value-lossy',
                              },
                          ]
                        : [],
                },
            } satisfies RenderResult;
        }) as typeof engine.render;
        forms = new EzClassifyUI(engine, { root: root5 });
        await flush();
        const input = root5.querySelector<HTMLInputElement>('#short-rollup')!;
        type AggregateState = EzClassifyState;
        const notifyAggregate = (aggregate: AggregateState): void => {
            const entries = (
                forms!.store as unknown as {
                    markings: Map<
                        string,
                        {
                            listeners: Set<{
                                fn(state: AggregateState): void;
                            }>;
                        }
                    >;
                }
            ).markings;
            for (const listener of entries.get('doc-marking')?.listeners ?? [])
                listener.fn(aggregate);
        };
        const commitAggregate = async (
            value: string,
        ): Promise<AggregateState> => {
            await forms!.store.publishAssertions('rollup-source', [
                {
                    categoryId: 'level',
                    conceptId: 'STUDENTS',
                    confidence: 'certain',
                    source: 'user',
                    value,
                },
            ]);
            await flush();
            const aggregate = forms!.store.getAggregate();
            expect(aggregate.aggregate).toBe(true);
            expect(aggregate.assertions[0]?.value).toBe(value);
            notifyAggregate(aggregate);
            await flush();
            return aggregate;
        };

        await commitAggregate('2030-12-31');
        expect(renderValues).toContain('2030-12-31');
        expect(input.value).toBe('SHORT 2030-12-31');

        await commitAggregate('REFUSE');
        expect(input.value).toBe('SHORT 2030-12-31');
        expect(input.getAttribute('aria-invalid')).toBe('true');
        expect(input.validationMessage).toContain('value-lossy');

        await commitAggregate('INVALID');
        expect(input.value).toBe('SHORT INVALID');
        expect(input.getAttribute('aria-invalid')).toBe('true');
        expect(input.validationMessage).toBe(
            'The aggregate source is invalid.',
        );

        const pending = await commitAggregate('SLOW');
        notifyAggregate(pending);
        await flush();
        resolveSlow[0]?.({
            rendered: 'SHORT SLOW',
            assessment: {
                emitted: [],
                omitted: [],
                collapsed: [],
                conflicts: [],
                unrepresentable: [],
            },
        });
        await flush();
        expect(input.value).toBe('SHORT SLOW');

        await commitAggregate('THROW');
        await flush();
        expect(input.value).toBe('SHORT SLOW');
        expect(input.getAttribute('aria-invalid')).toBe('true');
        expect(input.validationMessage).toContain('unavailable');

        await commitAggregate('SLOW-OLD');
        await commitAggregate('LATEST');
        expect(input.value).toBe('SHORT LATEST');
        resolveSlow[1]?.({
            rendered: 'SHORT SLOW-OLD',
            assessment: {
                emitted: [],
                omitted: [],
                collapsed: [],
                conflicts: [],
                unrepresentable: [],
            },
        });
        await flush();
        expect(input.value).toBe('SHORT LATEST');
    });

    it('keeps an invalid default-format store result invalid', async () => {
        document.body.innerHTML = '';
        const root5 = document.createElement('div');
        root5.innerHTML = `
      <input type="hidden" id="doc-marking" data-ezclassify-rendered />
      <input id="default-view" data-ezclassify-bind
             data-ezclassify-bound-to="doc-marking" />
    `;
        document.body.appendChild(root5);
        forms = new EzClassifyUI(loadMultiScopeRegression(), {
            root: root5,
        });
        await flush();
        const input = root5.querySelector<HTMLInputElement>('#default-view')!;

        const state: EzClassifyState = {
            rendered: 'invalid marking',
            renders: {},
            assertions: [],
            valid: false,
            errors: [
                {
                    constraintId: 'invalid-test',
                    message: 'The marking is invalid for this scheme.',
                },
            ],
        };
        const entries = (
            forms.store as unknown as {
                markings: Map<
                    string,
                    {
                        cell: { set(value: EzClassifyState): void };
                        listeners: Set<{ fn(value: EzClassifyState): void }>;
                    }
                >;
            }
        ).markings;
        const entry = entries.get('doc-marking');
        entry?.cell.set(state);
        for (const listener of entry?.listeners ?? []) listener.fn(state);
        await flush();

        expect(input.getAttribute('aria-invalid')).toBe('true');
        expect(input.validationMessage).toBe(
            'The marking is invalid for this scheme.',
        );

        // `rendered` says through its own assessment that writing it was
        // refused; no output has to be named for the input to see it.
        const refusedState: EzClassifyState = {
            rendered: 'replacement that must not be displayed',
            assessment: {
                emitted: [],
                omitted: [],
                collapsed: [],
                conflicts: [],
                unrepresentable: [
                    {
                        conceptId: 'STUDENTS',
                        reason: 'value-lossy',
                    },
                ],
            },
            assertions: [],
            valid: true,
            errors: [],
            renders: {},
        };
        entry?.cell.set(refusedState);
        for (const listener of entry?.listeners ?? [])
            listener.fn(refusedState);
        await flush();

        expect(input.value).toBe('invalid marking');
        expect(input.getAttribute('aria-invalid')).toBe('true');
        expect(input.validationMessage).toContain('value-lossy');
    });

    it('does not produce an unhandled rejection when the store is destroyed before a component onChange fires', async () => {
        // Internal onChange publication catches a destroyed-store rejection.
        // Vitest treats any uncaught rejection as a failure.
        forms = new EzClassifyUI(loadMultiScopeRegression(), { root });
        await flush();

        const components = (
            forms as unknown as { components: Map<HTMLElement, SingleSelect> }
        ).components;
        const branchEl = root.querySelector<HTMLElement>('#branch')!;
        const branchSelect = components.get(branchEl)!;
        expect(branchSelect).toBeDefined();

        // Destroy the store to simulate the unmount teardown timing.
        forms.store.destroy();

        // setAssertions drives reprocess → onAssertionsChanged → onChange →
        // handle.publish → store.publishAssertions(...).catch(() => {}). The
        // store throws "store has been destroyed" on publishAssertions; the
        // .catch guard absorbs it before it becomes an unhandled rejection.
        branchSelect.setAssertions([
            {
                conceptId: 'OAKWOOD',
                categoryId: 'from_school',
                confidence: 'certain',
                source: 'user',
            },
        ]);
        await flush();
    });

    it('does not write a refused render into the input the author typed in', async () => {
        // Committing a plain input writes the engine's rendered text back into
        // the field. A refused render is the opaque marker and nothing else, so
        // without a gate the author's own text is replaced by that marker and
        // the field is reported as holding a marking it does not hold. Every
        // other path that paints a render checks the assessment first; this one
        // is that check.
        document.body.innerHTML = '';
        const root = document.createElement('div');
        root.innerHTML = `
      <input type="hidden" id="doc-marking" data-ezclassify-rendered />
      <input id="typed-view" data-ezclassify-bind
             data-ezclassify-bound-to="doc-marking"
             data-ezclassify-format="short" />
    `;
        document.body.appendChild(root);

        const engine = loadMultiScopeRegression();
        const originalProcess = engine.process.bind(engine);
        engine.process = ((input: string | Assertion[], ...rest: unknown[]) => {
            const result = Reflect.apply(originalProcess, engine, [
                input,
                ...rest,
            ]) as ProcessResult;
            if (Array.isArray(input)) return result;
            const refusal: RenderResult = {
                rendered: '[unrepresentable:value-lossy]',
                assessment: {
                    emitted: [],
                    omitted: [],
                    collapsed: [],
                    conflicts: [],
                    unrepresentable: [
                        {
                            conceptId: 'DISTRICT_COORDINATORS',
                            reason: 'value-lossy',
                        },
                    ],
                },
            };
            // The commit is the store's publish, which names the input's own
            // format as an output, so the refusal is that output's write.
            return {
                ...result,
                renders: { ...result.renders, short: refusal },
            };
        }) as typeof engine.process;

        forms = await mountReady(root, engine);

        const typed = root.querySelector<HTMLInputElement>('#typed-view')!;
        typed.focus();
        typed.value = 'DISTRICT COORDINATORS';
        typed.blur();
        // The commit ends by saying why the view refused the value; wait for
        // that, however long the engine takes.
        await vi.waitFor(() =>
            expect(typed.validationMessage).toContain('value-lossy'),
        );

        expect(typed.value).toBe('DISTRICT COORDINATORS');
        expect(typed.value).not.toContain('unrepresentable');
        expect(typed.getAttribute('aria-invalid')).toBe('true');
        expect(typed.validationMessage).toContain('value-lossy');
    });
});
