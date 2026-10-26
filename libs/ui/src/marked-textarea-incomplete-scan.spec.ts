/**
 * A scan that stops before the end of a MarkedTextArea's text returns the
 * markings it reached and nothing past them, which reads exactly like prose
 * with no markings left in it. The field must not let that pass as a complete
 * reading: its status mark shows an error, the textarea is invalid, and the
 * rollups its portions feed are flagged stale, until a scan that reads the
 * whole text clears all three.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ScanOutcome } from '@ezclassify/types';
import { EzClassifyUI } from './ezclassify-ui';
import type { MarkedTextArea } from './components/marked-text-area';
import { VanillaEzClassifyStore } from './store/ezclassify-store';
import { t } from './i18n';
import { loadMultiScopeRegression } from '../test-fixtures/load-multi-scope-regression';

const FORM = `<form id="root">
    <input id="document" value="SCHOOL STAFF" data-ezclassify-controller="marking">
    <textarea id="body" data-ezclassify-controller="marked-textarea" data-ezclassify-part-of="document">(SS) First.
(ST) Second.</textarea>
</form>`;

/** A body whose second portion outranks its first. */
const PORTIONS_FORM = `<form id="root">
    <input id="document" value="DISTRICT COORDINATORS" data-ezclassify-controller="marking">
    <textarea id="body" data-ezclassify-controller="marked-textarea" data-ezclassify-part-of="document">(ST) First.
(DC) Second.</textarea>
    <div id="parts" data-ezclassify-controller="banner" data-ezclassify-aggregate="document"></div>
</form>`;

let ui: EzClassifyUI | undefined;
afterEach(() => {
    ui?.destroy();
    ui = undefined;
    document.body.innerHTML = '';
});

/**
 * The fixture engine, with a switch that changes how its scans end: `first`
 * stops after the first marking the way a region cap stops them (the markings
 * reached so far, and a limit report that says the text was not read to the
 * end), `none` stops before any marking, and `throw` fails the call.
 */
function stoppingEngine() {
    const engine = loadMultiScopeRegression();
    const control: {
        stopEarly: boolean;
        mode: 'first' | 'none' | 'throw';
    } = { stopEarly: false, mode: 'first' };
    const scan = engine.scan.bind(engine) as (
        ...args: unknown[]
    ) => ScanOutcome;
    const proxied = new Proxy(engine, {
        get(target, key, receiver) {
            if (key === 'scan')
                return (...args: unknown[]) => {
                    const outcome = scan(...args);
                    if (!control.stopEarly) return outcome;
                    if (control.mode === 'throw')
                        throw new Error('scan service unavailable');
                    return {
                        results: outcome.results.slice(
                            0,
                            control.mode === 'first' ? 1 : 0,
                        ),
                        limits: {
                            status: 'truncated',
                            regionsFound: outcome.results.length,
                            regionsCapped: true,
                        },
                    } satisfies ScanOutcome;
                };
            const value = Reflect.get(target, key, receiver);
            return typeof value === 'function' ? value.bind(target) : value;
        },
    });
    return { engine: proxied, control };
}

const ready = (root: HTMLElement) =>
    new Promise<void>((resolve) =>
        root.addEventListener('ezclassify:ready', () => resolve(), {
            once: true,
        }),
    );

async function settle() {
    for (let i = 0; i < 6; i++)
        await new Promise((resolve) => setTimeout(resolve, 20));
}

/** Edit the body and wait out the field's scan debounce. */
async function type(textarea: HTMLTextAreaElement, text: string) {
    textarea.value = text;
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 400));
    await settle();
}

describe('MarkedTextArea scan that does not read the whole text', () => {
    it('shows an error, invalidates the textarea and flags its rollups until a complete scan clears them', async () => {
        document.body.innerHTML = FORM;
        const root = document.querySelector<HTMLElement>('#root')!;
        const { engine, control } = stoppingEngine();
        const isReady = ready(root);
        ui = new EzClassifyUI(engine, { root });
        await isReady;
        await settle();
        const textarea = root.querySelector<HTMLTextAreaElement>('#body')!;
        const mark = root.querySelector<HTMLElement>(
            '.marked-textarea-hint-chrome > .ez-status-mark',
        )!;
        const message = t('mark.scanIncomplete');

        // A complete reading: nothing to report.
        expect(mark.classList.contains('ez-status-mark--error')).toBe(false);
        expect(textarea.validity.valid).toBe(true);
        expect(ui.store.getWholeRollup('document').stale).toBeUndefined();
        expect(ui.store.getAggregate().stale).toBeUndefined();

        control.stopEarly = true;
        await type(textarea, '(SS) First.\n(ST) Second.\n(SS) Third.');
        expect(mark.classList.contains('ez-status-mark--error')).toBe(true);
        expect(mark.getAttribute('aria-label')).toContain(message);
        expect(textarea.validity.customError).toBe(true);
        expect(textarea.validationMessage).toBe(message);
        // No line the scan never reached is called unrecognized.
        const field = ui.components.get(textarea) as MarkedTextArea;
        expect(
            field.getSegments().flatMap((segment) => segment.errors),
        ).toEqual([]);
        expect(ui.store.getWholeRollup('document').stale).toBe(true);
        expect(ui.store.getAggregate().stale).toBe(true);

        control.stopEarly = false;
        await type(textarea, '(SS) First.\n(ST) Second.');
        expect(mark.classList.contains('ez-status-mark--error')).toBe(false);
        expect(mark.getAttribute('aria-label')).not.toContain(message);
        expect(textarea.validity.valid).toBe(true);
        expect(ui.store.getWholeRollup('document').stale).toBeUndefined();
        expect(ui.store.getAggregate().stale).toBeUndefined();
    });

    it('clears only its own validity message when a complete scan lands', async () => {
        document.body.innerHTML = FORM;
        const root = document.querySelector<HTMLElement>('#root')!;
        const { engine, control } = stoppingEngine();
        const isReady = ready(root);
        ui = new EzClassifyUI(engine, { root });
        await isReady;
        await settle();
        const textarea = root.querySelector<HTMLTextAreaElement>('#body')!;
        control.stopEarly = true;
        await type(textarea, '(SS) First.\n(ST) Second.\n(SS) Third.');
        expect(textarea.validationMessage).toBe(t('mark.scanIncomplete'));
        // The host replaces it with a verdict of its own.
        textarea.setCustomValidity('Required by the host.');
        control.stopEarly = false;
        await type(textarea, '(SS) First.\n(ST) Second.');
        expect(textarea.validationMessage).toBe('Required by the host.');
    });

    it('leaves no flag behind in a store that outlives the runtime', async () => {
        document.body.innerHTML = FORM;
        const root = document.querySelector<HTMLElement>('#root')!;
        const { engine, control } = stoppingEngine();
        const store = new VanillaEzClassifyStore(engine);
        const isReady = ready(root);
        ui = new EzClassifyUI(engine, { root, store });
        await isReady;
        await settle();
        const textarea = root.querySelector<HTMLTextAreaElement>('#body')!;
        control.stopEarly = true;
        await type(textarea, '(SS) First.\n(ST) Second.\n(SS) Third.');
        expect(store.getAggregate().stale).toBe(true);
        ui.destroy();
        ui = undefined;
        await settle();
        expect(store.getAggregate().stale).toBeUndefined();
        expect(store.getWholeRollup('document').stale).toBeUndefined();
        store.destroy();
    });

    it('keeps the portions past where the scan stopped until a complete scan replaces them', async () => {
        document.body.innerHTML = PORTIONS_FORM;
        const root = document.querySelector<HTMLElement>('#root')!;
        const { engine, control } = stoppingEngine();
        const isReady = ready(root);
        ui = new EzClassifyUI(engine, { root });
        await isReady;
        await settle();
        const textarea = root.querySelector<HTMLTextAreaElement>('#body')!;
        const field = ui.components.get(textarea) as MarkedTextArea;
        const portions = () =>
            field
                .getSegments()
                .map((segment) => [segment.entryId, segment.marking]);
        const read = portions();
        expect(read.map(([, marking]) => marking)).toEqual(['(ST)', '(DC)']);
        expect(ui.store.getWholeRollup('document').rendered).toBe(
            'DISTRICT COORDINATORS',
        );

        // The scan reaches the first portion only. The second sits past where
        // it stopped, so it keeps its entry and still counts in the rollup.
        control.stopEarly = true;
        await type(textarea, '(ST) First, edited.\n(DC) Second.');
        expect(portions()).toEqual(read);
        expect(
            root.querySelectorAll('[data-marked-textarea-field]'),
        ).toHaveLength(2);
        expect(ui.store.getWholeRollup('document')).toMatchObject({
            rendered: 'DISTRICT COORDINATORS',
            stale: true,
        });

        // A complete scan is the authority again: it drops what the text no
        // longer holds.
        control.stopEarly = false;
        await type(textarea, '(ST) First, edited.');
        expect(portions().map(([, marking]) => marking)).toEqual(['(ST)']);
        const rollup = ui.store.getWholeRollup('document');
        expect(rollup.rendered).toBe('STUDENTS');
        expect(rollup.stale).toBeUndefined();
    });

    it('holds a portion past the cut whose mark was rewritten, across incomplete scans', async () => {
        document.body.innerHTML = PORTIONS_FORM;
        const root = document.querySelector<HTMLElement>('#root')!;
        const { engine, control } = stoppingEngine();
        const isReady = ready(root);
        ui = new EzClassifyUI(engine, { root });
        await isReady;
        await settle();
        const textarea = root.querySelector<HTMLTextAreaElement>('#body')!;
        const field = ui.components.get(textarea) as MarkedTextArea;
        const second = field.getSegments()[1];
        expect(second.marking).toBe('(DC)');

        // The second mark is rewritten lower past where the scan stops. Nothing
        // read the new mark, so the committed DC is held, not dropped, and the
        // rollup does not fall on the strength of unread text.
        control.stopEarly = true;
        await type(textarea, '(ST) First.\n(ST) Second.');
        const held = () =>
            field
                .getCommittedPortions()
                .find((portion) => portion.entryId === second.entryId);
        expect(held()?.assertions).toEqual(second.assertions);
        expect(field.getSegments().map((segment) => segment.marking)).toEqual([
            '(ST)',
        ]);
        expect(root.querySelector(`[id="${second.entryId}"]`)).not.toBeNull();
        expect(ui.store.getWholeRollup('document')).toMatchObject({
            rendered: 'DISTRICT COORDINATORS',
            stale: true,
        });

        // Another incomplete scan keeps holding it.
        await type(textarea, '(ST) First.\n(ST) Second.\nMore.');
        expect(held()?.assertions).toEqual(second.assertions);
        expect(ui.store.getWholeRollup('document').rendered).toBe(
            'DISTRICT COORDINATORS',
        );

        // A complete scan reads the new mark and replaces it.
        control.stopEarly = false;
        await type(textarea, '(ST) First.\n(ST) Second.');
        expect(held()).toBeUndefined();
        const rollup = ui.store.getWholeRollup('document');
        expect(rollup.rendered).toBe('STUDENTS');
        expect(rollup.stale).toBeUndefined();
    });

    it('says the rollup is incomplete on its banner and its rollup field while it is stale', async () => {
        document.body.innerHTML = PORTIONS_FORM;
        const root = document.querySelector<HTMLElement>('#root')!;
        const { engine, control } = stoppingEngine();
        const isReady = ready(root);
        ui = new EzClassifyUI(engine, { root });
        await isReady;
        await settle();
        const textarea = root.querySelector<HTMLTextAreaElement>('#body')!;
        const banner = root.querySelector<HTMLElement>(
            '#parts .status-banner',
        )!;
        const rollupField =
            root.querySelector<HTMLInputElement>('#ezclassify-rollup')!;
        const message = t('rollup.incomplete');
        expect(message).not.toBe('rollup.incomplete');
        const incomplete = () => ({
            banner: banner.classList.contains('status-banner--incomplete'),
            text: banner.textContent?.includes(message) ?? false,
            label: banner.getAttribute('aria-label')?.includes(message),
            field: rollupField.getAttribute('aria-invalid'),
            validity: rollupField.validity.customError,
        });
        expect(incomplete()).toEqual({
            banner: false,
            text: false,
            label: false,
            field: null,
            validity: false,
        });

        control.stopEarly = true;
        await type(textarea, '(ST) First.\n(DC) Second.\n(SA) Third.');
        expect(incomplete()).toEqual({
            banner: true,
            text: true,
            label: true,
            field: 'true',
            validity: true,
        });
        expect(rollupField.validationMessage).toBe(
            rollupField.willValidate ? message : '',
        );

        control.stopEarly = false;
        await type(textarea, '(ST) First.\n(DC) Second.');
        expect(incomplete()).toEqual({
            banner: false,
            text: false,
            label: false,
            field: null,
            validity: false,
        });
    });

    it('carries an incomplete inner whole up to the scope that contains it', async () => {
        document.body.innerHTML = `<form id="outer">
    <input id="cover" value="STUDENTS" data-ezclassify-controller="marking">
    <section id="inner"></section>
</form>`;
        const outerRoot = document.querySelector<HTMLElement>('#outer')!;
        const innerRoot = document.querySelector<HTMLElement>('#inner')!;
        const { engine, control } = stoppingEngine();
        const outer = new EzClassifyUI(engine, {
            root: outerRoot,
            rollupId: 'outer-rollup',
        });
        const inner = new EzClassifyUI(engine, {
            root: innerRoot,
            rollupId: 'inner-rollup',
        });
        let innerDestroyed = false;
        try {
            await settle();
            // The body arrives once both scopes are up, the way a framework
            // renders a nested region's content, so the inner scope owns it.
            innerRoot.insertAdjacentHTML(
                'afterbegin',
                `<textarea id="body" data-ezclassify-controller="marked-textarea">(ST) First.
(DC) Second.</textarea>`,
            );
            await new Promise((resolve) => setTimeout(resolve, 400));
            await settle();
            const textarea =
                innerRoot.querySelector<HTMLTextAreaElement>('#body')!;
            expect(inner.components.has(textarea)).toBe(true);
            const outerField =
                outerRoot.querySelector<HTMLInputElement>('#outer-rollup')!;
            const innerField =
                innerRoot.querySelector<HTMLInputElement>('#inner-rollup')!;
            expect(outerField.value).toBe('DISTRICT COORDINATORS');
            expect(outerField.hasAttribute('aria-invalid')).toBe(false);

            control.stopEarly = true;
            await type(textarea, '(ST) First.\n(DC) Second.\n(SA) Third.');
            expect(innerField.getAttribute('aria-invalid')).toBe('true');
            expect(outerField.getAttribute('aria-invalid')).toBe('true');
            expect(outerField.validity.customError).toBe(true);

            control.stopEarly = false;
            await type(textarea, '(ST) First.\n(DC) Second.');
            expect(innerField.hasAttribute('aria-invalid')).toBe(false);
            expect(outerField.hasAttribute('aria-invalid')).toBe(false);
            expect(outerField.validity.customError).toBe(false);

            // A scope that goes away while incomplete stops counting. Its
            // region leaves the page with it, so the outer scope does not take
            // the body over.
            control.stopEarly = true;
            await type(textarea, '(ST) First.\n(DC) Second.\n(SA) Third.');
            expect(outerField.getAttribute('aria-invalid')).toBe('true');
            innerRoot.remove();
            inner.destroy();
            innerDestroyed = true;
            await settle();
            expect(outerField.hasAttribute('aria-invalid')).toBe(false);
        } finally {
            if (!innerDestroyed) inner.destroy();
            outer.destroy();
        }
    });

    it('treats a scan that fails as one that did not read the text', async () => {
        document.body.innerHTML = PORTIONS_FORM;
        const root = document.querySelector<HTMLElement>('#root')!;
        const { engine, control } = stoppingEngine();
        const isReady = ready(root);
        ui = new EzClassifyUI(engine, { root });
        await isReady;
        await settle();
        const textarea = root.querySelector<HTMLTextAreaElement>('#body')!;
        const mark = root.querySelector<HTMLElement>(
            '.marked-textarea-hint-chrome > .ez-status-mark',
        )!;
        const failure = vi.spyOn(console, 'error').mockImplementation(() => {});
        control.stopEarly = true;
        control.mode = 'throw';
        await type(textarea, '(ST) First.\n(DC) Second.\n(SA) Third.');
        expect(failure).toHaveBeenCalled();
        failure.mockRestore();
        expect(mark.classList.contains('ez-status-mark--error')).toBe(true);
        expect(textarea.validationMessage).toBe(t('mark.scanIncomplete'));
        expect(ui.store.getAggregate().stale).toBe(true);
        expect(ui.store.getWholeRollup('document').stale).toBe(true);

        control.stopEarly = false;
        await type(textarea, '(ST) First.\n(DC) Second.');
        expect(mark.classList.contains('ez-status-mark--error')).toBe(false);
        expect(textarea.validity.valid).toBe(true);
        expect(ui.store.getAggregate().stale).toBeUndefined();
    });

    it('flags the marking bound to the first part when the scan read no part', async () => {
        document.body.innerHTML = `<form id="root">
    <input id="lead" type="hidden" value="STUDENTS" data-ezclassify-rendered>
    <textarea id="body" data-ezclassify-controller="marked-textarea" data-ezclassify-first-part-binding="lead">(ST) First.
(DC) Second.</textarea>
    <div id="lead-banner" data-ezclassify-controller="banner" data-ezclassify-source="lead"></div>
</form>`;
        const root = document.querySelector<HTMLElement>('#root')!;
        const { engine, control } = stoppingEngine();
        const isReady = ready(root);
        ui = new EzClassifyUI(engine, { root });
        await isReady;
        await settle();
        const textarea = root.querySelector<HTMLTextAreaElement>('#body')!;
        const banner = root.querySelector<HTMLElement>(
            '#lead-banner .status-banner',
        )!;
        const flagged = () =>
            banner.classList.contains('status-banner--incomplete');
        expect(flagged()).toBe(false);

        // A scan that reached the first part read it: nothing to flag on the
        // marking it is bound to.
        control.stopEarly = true;
        control.mode = 'first';
        await type(textarea, '(ST) First.\n(DC) Second.\n(SA) Third.');
        expect(flagged()).toBe(false);

        control.mode = 'none';
        await type(textarea, '(ST) First.\n(DC) Second.');
        expect(flagged()).toBe(true);
        expect(banner.textContent).toContain(t('rollup.incomplete'));

        control.stopEarly = false;
        await type(textarea, '(ST) First.');
        expect(flagged()).toBe(false);
    });

    it('announces the incomplete scan and says so in text, not color alone', async () => {
        document.body.innerHTML = PORTIONS_FORM;
        const root = document.querySelector<HTMLElement>('#root')!;
        const { engine, control } = stoppingEngine();
        const isReady = ready(root);
        ui = new EzClassifyUI(engine, { root });
        await isReady;
        await settle();
        const textarea = root.querySelector<HTMLTextAreaElement>('#body')!;
        const message = t('mark.scanIncomplete');
        // The notice and its announcer sit beside the field's wrapper.
        const container = textarea.closest(
            '.marked-textarea-wrap',
        )!.parentElement!;
        const notice = () =>
            container.querySelector<HTMLElement>(
                '.marked-textarea-scan-notice',
            );
        // The live region that speaks it follows the notice.
        const announcer = () => notice()?.nextElementSibling;
        expect(announcer()?.textContent ?? '').toBe('');
        expect(notice()?.hidden ?? true).toBe(true);

        control.stopEarly = true;
        await type(textarea, '(ST) First.\n(DC) Second.\n(SA) Third.');
        await new Promise((resolve) => requestAnimationFrame(resolve));
        expect(announcer()?.textContent).toBe(message);
        expect(announcer()?.getAttribute('aria-live')).toBe('polite');
        expect(notice()?.hidden).toBe(false);
        expect(notice()?.textContent).toContain(message);
        const describedBy = textarea.getAttribute('aria-describedby') ?? '';
        expect(describedBy.split(' ')).toContain(notice()!.id);

        control.stopEarly = false;
        await type(textarea, '(ST) First.\n(DC) Second.');
        expect(notice()?.hidden).toBe(true);
        expect(textarea.getAttribute('aria-describedby') ?? '').not.toContain(
            notice()!.id,
        );
    });
});
