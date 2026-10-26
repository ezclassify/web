/**
 * The store and the plain inputs bound to it, over a scheme that writes each
 * role in a view of its own. A publish that names no output is written in the
 * view of whatever role its text reads as, so every write the UI shows has to
 * name the view it is for.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Context } from '@ezclassify/engine';
import { SURFACES_SCHEME } from '../test-fixtures/surfaces-scheme';
import { EzClassifyUI } from './ezclassify-ui';
import { VanillaEzClassifyStore } from './store/ezclassify-store';
import {
    openSurface,
    press,
    typeText,
} from './components/composer/composer-harness';

const wait = (ms = 150) => new Promise((r) => setTimeout(r, ms));

function createEngine() {
    return Context.fromComponents({ scheme: SURFACES_SCHEME }).scheme;
}

describe('a store over a scheme that writes each role in its own view', () => {
    it('writes a whole marking in the whole default, whatever role its text reads as', async () => {
        const store = new VanillaEzClassifyStore(createEngine());

        await store.publishRendered('doc', 'CONF // PARTNERS');

        expect(store.get('doc').rendered).toBe('CONFIDENTIAL // PARTNERS');
        expect(store.get('doc').renders).toEqual({});
        store.destroy();
    });

    it('writes a part in the part default', async () => {
        const store = new VanillaEzClassifyStore(createEngine());
        await store.publishRendered('doc', 'CONFIDENTIAL // PARTNERS');
        store.setPartOf('para', 'doc');

        await store.publishRendered('para', 'CONFIDENTIAL // PARTNERS');

        expect(store.get('para').rendered).toBe('CONF // PARTNERS');
        store.destroy();
    });

    it('writes a held output beside rendered, and refuses one the scheme does not declare', async () => {
        const store = new VanillaEzClassifyStore(createEngine());
        store.requestOutput('doc', 'sensitivity/short');
        // A bare view id is a valid outputFormat, but a publish names an
        // output by its address.
        expect(() => store.requestOutput('doc', 'short')).toThrow(
            /"short".*"sensitivity\/short", "sensitivity\/full"/,
        );

        await store.publishRendered('doc', 'CONFIDENTIAL // PARTNERS');

        const state = store.get('doc');
        expect(state.rendered).toBe('CONFIDENTIAL // PARTNERS');
        expect(Object.keys(state.renders)).toEqual(['sensitivity/short']);
        expect(state.renders['sensitivity/short']?.rendered).toBe(
            'CONF // PARTNERS',
        );
        store.destroy();
    });
});

describe('plain inputs bound to a marking on that scheme', () => {
    let forms: EzClassifyUI | null = null;

    afterEach(() => {
        forms?.destroy();
        forms = null;
        document.body.innerHTML = '';
        vi.restoreAllMocks();
    });

    async function mount(shortFormat = 'sensitivity/short') {
        const root = document.createElement('div');
        root.innerHTML = `
            <input type="hidden" id="doc" data-ezclassify-rendered />
            <input id="full" data-ezclassify-bind data-ezclassify-bound-to="doc"
                   data-ezclassify-format="sensitivity/full" />
            <input id="short" data-ezclassify-bind data-ezclassify-bound-to="doc"
                   data-ezclassify-format="${shortFormat}" />
            <input id="plain" data-ezclassify-bind data-ezclassify-bound-to="doc" />`;
        document.body.appendChild(root);
        const engine = createEngine();
        forms = new EzClassifyUI(engine as never, { root });
        await wait();
        return {
            engine,
            value: (id: string) =>
                root.querySelector<HTMLInputElement>(`#${id}`)!.value,
            input: (id: string) =>
                root.querySelector<HTMLInputElement>(`#${id}`)!,
        };
    }

    it('show part-spelled text a host publishes, each in its own view', async () => {
        const { value } = await mount();

        await forms!.store.publishRendered('doc', 'CONF // PARTNERS');
        await wait();

        expect(value('full')).toBe('CONFIDENTIAL // PARTNERS');
        expect(value('plain')).toBe('CONFIDENTIAL // PARTNERS');
        expect(value('short')).toBe('CONF // PARTNERS');
    });

    it('commit typed text with the one publish every view shares', async () => {
        const { engine, value, input } = await mount();
        const process = vi.spyOn(engine, 'process');
        const render = vi.spyOn(engine, 'render');

        const short = input('short');
        short.value = 'CONFIDENTIAL // PARTNERS';
        short.dispatchEvent(new Event('blur'));
        await wait(300);

        // The marking is read once, by the store's publish, which writes the
        // short input's output in the same call. The page rollup reads its own
        // aggregate as a whole, apart from the commit.
        const commits = process.mock.calls.filter(
            ([, ...rest]) =>
                !(rest.at(-1) as { context?: unknown } | undefined)?.context,
        );
        expect(commits).toHaveLength(1);
        expect(commits[0][0]).toBe('CONFIDENTIAL // PARTNERS');
        expect(commits[0].at(-1)).toMatchObject({
            outputFormat: 'sensitivity/full',
            outputs: ['sensitivity/short'],
        });
        expect(render).not.toHaveBeenCalled();
        expect(value('short')).toBe('CONF // PARTNERS');
        expect(value('full')).toBe('CONFIDENTIAL // PARTNERS');
        expect(value('plain')).toBe('CONFIDENTIAL // PARTNERS');
    });

    it('read nothing when the author leaves an input unchanged', async () => {
        const { engine, value, input } = await mount();
        await forms!.store.publishRendered('doc', 'CONFIDENTIAL // PARTNERS');
        await wait();
        const process = vi.spyOn(engine, 'process');
        const changes: unknown[] = [];
        const short = input('short');
        short.addEventListener('ezclassify:change', (event) =>
            changes.push((event as CustomEvent).detail),
        );

        short.dispatchEvent(new Event('blur'));
        await wait(300);

        const commits = process.mock.calls.filter(
            ([, ...rest]) =>
                !(rest.at(-1) as { context?: unknown } | undefined)?.context,
        );
        expect(commits).toHaveLength(0);
        expect(value('short')).toBe('CONF // PARTNERS');
        expect(changes).toHaveLength(1);
    });

    it('resolve a bare view id to that view on the default surface and ask the store for it', async () => {
        const { engine, value } = await mount('short');
        const process = vi.spyOn(engine, 'process');
        const render = vi.spyOn(engine, 'render');

        await forms!.store.publishRendered('doc', 'CONFIDENTIAL // PARTNERS');
        await wait();

        expect(process.mock.calls[0][1]).toMatchObject({
            outputs: ['sensitivity/short'],
        });
        expect(render).not.toHaveBeenCalled();
        expect(value('short')).toBe('CONF // PARTNERS');
    });
});

describe('a marked field that names a bare view on that scheme', () => {
    let forms: EzClassifyUI | null = null;

    afterEach(() => {
        forms?.destroy();
        forms = null;
        document.body.innerHTML = '';
        vi.restoreAllMocks();
    });

    it('reads and writes its mark in that view on the default surface', async () => {
        const engine = createEngine();
        const process = vi.spyOn(engine, 'process');
        const root = document.createElement('div');
        root.innerHTML = `
            <input type="text" id="title" data-ezclassify-controller="marked-input"
                      data-ezclassify-format="full" value="(CONF // PARTNERS) Report">`;
        document.body.appendChild(root);

        forms = new EzClassifyUI(engine as never, { root });
        await wait();

        // The scheme marks its default surface on its scope list and names no
        // default scope, so the surface comes from its default output. Left
        // unresolved, the field would fall back to the part default.
        expect(process.mock.calls.length).toBeGreaterThan(0);
        for (const call of process.mock.calls) {
            expect(call.at(-1)).toMatchObject({
                outputFormat: 'sensitivity/full',
            });
        }
    });
});

describe('fields that show a part on that scheme and name no format', () => {
    let forms: EzClassifyUI | null = null;

    afterEach(() => {
        forms?.destroy();
        forms = null;
        document.body.innerHTML = '';
        vi.restoreAllMocks();
    });

    async function mount(fields: string) {
        const root = document.createElement('div');
        root.innerHTML = `
            <input type="hidden" id="doc" data-ezclassify-rendered />
            <input type="hidden" id="para" data-ezclassify-rendered
                   data-ezclassify-part-of="doc" />
            ${fields}`;
        document.body.appendChild(root);
        const engine = createEngine();
        forms = new EzClassifyUI(engine as never, { root });
        await wait();
        return {
            engine,
            input: (id: string) =>
                root.querySelector<HTMLInputElement>(`#${id}`)!,
        };
    }

    it('show a part bound to a tag input in the part default', async () => {
        const { input } = await mount(`
            <input id="tags" data-ezclassify-controller="tags"
                   data-ezclassify-format="" data-ezclassify-bound-to="para" />`);

        await forms!.store.publishRendered('para', 'CONFIDENTIAL // PARTNERS');
        await wait();

        expect(forms!.store.get('para').rendered).toBe('CONF // PARTNERS');
        expect(input('tags').value).toBe('CONF // PARTNERS');
    });

    it('show a part bound to a plain input as the store holds it, asking for no output', async () => {
        const { input } = await mount(`
            <input id="plain" data-ezclassify-bind data-ezclassify-bound-to="para" />`);
        const requestOutput = vi.spyOn(forms!.store, 'requestOutput');

        await forms!.store.publishRendered('para', 'CONFIDENTIAL // PARTNERS');
        await wait();

        expect(input('plain').value).toBe('CONF // PARTNERS');
        expect(requestOutput).not.toHaveBeenCalled();
    });

    it('write the text typed into a part field in the part default', async () => {
        const { engine, input } = await mount(`
            <input id="portion" data-ezclassify-bind data-ezclassify-part-of="doc" />`);
        const process = vi.spyOn(engine, 'process');

        const portion = input('portion');
        portion.value = 'CONFIDENTIAL // PARTNERS';
        portion.dispatchEvent(new Event('blur'));
        await wait(300);

        expect(
            process.mock.calls.some(
                ([text, ...rest]) =>
                    text === 'CONFIDENTIAL // PARTNERS' &&
                    (rest.at(-1) as { outputFormat?: string }).outputFormat ===
                        'sensitivity/short',
            ),
        ).toBe(true);
        expect(portion.value).toBe('CONF // PARTNERS');
    });
});

describe('the needed strip of a field that writes one surface', () => {
    let forms: EzClassifyUI | null = null;

    afterEach(() => {
        forms?.destroy();
        forms = null;
        document.body.innerHTML = '';
        vi.restoreAllMocks();
    });

    /** The surfaces scheme with a category the retention surface requires. */
    function retentionRequired() {
        const doc = structuredClone(SURFACES_SCHEME);
        const keep = doc.scheme.data.categories.find((c) => c.id === 'keep')!;
        (keep as { required?: boolean }).required = true;
        return Context.fromComponents({ scheme: doc }).scheme;
    }

    it("names what the field's own surface lacks and nothing another surface requires", async () => {
        Element.prototype.scrollIntoView = vi.fn();
        const root = document.createElement('div');
        root.innerHTML = `
            <label for="overall">Overall</label>
            <textarea id="overall" data-ezclassify-controller="marking"></textarea>`;
        document.body.appendChild(root);
        forms = new EzClassifyUI(retentionRequired() as never, { root });
        await wait();
        const host = root.querySelector<HTMLTextAreaElement>('#overall')!;

        host.focus();
        press(host, 'ArrowDown');
        await wait();
        typeText(host, 'PARTNERS');
        await wait();

        const strip = openSurface()!.querySelector('.ez-composer__needs')!;
        expect(strip.hasAttribute('hidden')).toBe(false);
        expect(
            [...strip.querySelectorAll('button')].map((b) => b.textContent),
        ).toEqual(['Level']);
    });
});
