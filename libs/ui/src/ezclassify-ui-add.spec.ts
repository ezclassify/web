/**
 * Pages the host cannot edit: `ui.add` and `ui.remove` mark up an element a
 * script finds on the page, and the runtime reads attributes a script sets
 * after initialization the way it reads the page's HTML.
 *
 * Each case drives `EzClassifyUI` through the real engine over the reference
 * scheme (`level` rolls up by max) and reads what a host reads: the outputs it
 * placed, the store, and the `ezclassify:host-error` events.
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EzClassifyUI } from './ezclassify-ui';
import { connectDemoContext } from '../../../test-support/demo-runtime';

const fixtures = resolve(
    dirname(fileURLToPath(import.meta.url)),
    '../../../vendor/spec/fixtures/v1',
);

async function reference() {
    return await connectDemoContext({
        draft: {
            scheme: JSON.parse(
                readFileSync(resolve(fixtures, 'ref-scheme-1.json'), 'utf8'),
            ),
        },
    });
}

let root: HTMLElement;
const instances: EzClassifyUI[] = [];
let errors: string[] = [];
const collect = (e: Event) =>
    errors.push((e as CustomEvent<{ code: string }>).detail.code);

async function mount(): Promise<EzClassifyUI> {
    const ui = new EzClassifyUI(await reference(), { root });
    instances.push(ui);
    return ui;
}

function el(id: string): HTMLInputElement {
    return root.querySelector<HTMLInputElement>(`#${id}`)!;
}

async function ready(ui: EzClassifyUI): Promise<void> {
    await expect.poll(() => ui.isReady).toBe(true);
}

beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    errors = [];
    root = document.createElement('div');
    document.body.appendChild(root);
    root.addEventListener('ezclassify:host-error', collect);
});

afterEach(() => {
    for (const ui of instances.splice(0)) ui.destroy();
    root.remove();
    vi.restoreAllMocks();
});

describe('ui.add', () => {
    it('marks up an element after initialization and reads it as the HTML would', async () => {
        root.innerHTML = `
            <input id="memo" data-ezclassify-marking value="LOW">
            <input id="title" value="HIGH">
            <input type="hidden" id="page" data-ezclassify-aggregate>`;
        const ui = await mount();
        await ready(ui);
        await expect.poll(() => el('page').value).toBe('LOW');

        ui.add(el('title'), 'marking');

        expect(el('title').getAttribute('data-ezclassify-controller')).toBe(
            'marking',
        );
        expect(ui.components.has(el('title'))).toBe(true);
        await expect.poll(() => el('page').value).toBe('HIGH');
        expect(ui.store.get('title').rendered).toBe('HIGH');
    });

    it('marks up an element before initialization has finished', async () => {
        root.innerHTML = `
            <input id="title" value="HIGH">
            <input type="hidden" id="page" data-ezclassify-aggregate>`;
        const ui = await mount();
        expect(ui.isReady).toBe(false);

        ui.add(el('title'), 'marking');

        await ready(ui);
        await expect.poll(() => el('page').value).toBe('HIGH');
    });

    it('reads an element inside a whole container as a part of that whole', async () => {
        root.innerHTML = `
            <form data-ezclassify-whole="doc">
                <input id="doc" data-ezclassify-marking value="LOW">
                <input id="section" value="HIGH">
                <input type="hidden" id="doc-parts" data-ezclassify-aggregate="doc">
            </form>`;
        const ui = await mount();
        await ready(ui);

        ui.add(el('section'), 'marking');

        await expect.poll(() => el('doc-parts').value).toBe('HIGH');
    });

    it('reads an element inside a collection as a member of it', async () => {
        root.innerHTML = `
            <section data-ezclassify-collection="folder">
                <input id="memo" value="MED">
                <input type="hidden" id="folder-out" data-ezclassify-aggregate="folder">
            </section>`;
        const ui = await mount();
        await ready(ui);

        ui.add(el('memo'), 'marking');

        await expect.poll(() => el('folder-out').value).toBe('MED');
    });

    it('writes the attributes it is given in the attribute vocabulary', async () => {
        root.innerHTML = `
            <input id="doc" data-ezclassify-marking value="LOW">
            <input id="section" value="HIGH">
            <input type="hidden" id="doc-parts" data-ezclassify-aggregate="doc">`;
        const ui = await mount();
        await ready(ui);

        ui.add(el('section'), 'marking', { partOf: 'doc' });

        expect(el('section').getAttribute('data-ezclassify-part-of')).toBe(
            'doc',
        );
        await expect.poll(() => el('doc-parts').value).toBe('HIGH');
    });

    it('refuses an element inside an ignored subtree, failing the page closed', async () => {
        root.innerHTML = `
            <input id="memo" data-ezclassify-marking value="LOW">
            <div data-ezclassify-ignore>
                <input id="quoted" value="HIGH">
            </div>
            <input type="hidden" id="page" data-ezclassify-aggregate>`;
        const ui = await mount();
        await ready(ui);
        await expect.poll(() => el('page').value).toBe('LOW');

        ui.add(el('quoted'), 'marking');

        expect(errors).toContain('marked-in-ignore');
        expect(ui.components.has(el('quoted'))).toBe(false);
        await expect
            .poll(() => el('page').getAttribute('aria-invalid'))
            .toBe('true');
        expect(el('page').value).toBe('LOW');
    });

    it('refuses a controller it does not know and leaves the element as it was', async () => {
        root.innerHTML = `<input id="title" value="HIGH">`;
        const ui = await mount();

        expect(() => ui.add(el('title'), 'MarkingField' as never)).toThrowError(
            TypeError,
        );
        expect(() =>
            ui.add(el('title'), 'marking', { controller: 'banner' }),
        ).toThrowError(TypeError);
        expect(() =>
            ui.add(el('title'), 'marking', { 'part-of': 'doc' }),
        ).toThrowError(TypeError);
        expect(el('title').getAttributeNames()).toEqual(['id', 'value']);
    });

    it('refuses an element outside its root', async () => {
        const ui = await mount();
        const outside = document.createElement('input');
        document.body.appendChild(outside);
        try {
            expect(() => ui.add(outside, 'marking')).toThrowError(
                /inside this EzClassifyUI's root/,
            );
            expect(() => ui.add(root, 'marking')).toThrowError(
                /inside this EzClassifyUI's root/,
            );
        } finally {
            outside.remove();
        }
    });
});

describe('ui.remove', () => {
    it('removes the controller and attributes add wrote, and the page reads without it', async () => {
        root.innerHTML = `
            <input id="memo" data-ezclassify-marking value="LOW">
            <input id="title" value="HIGH">
            <input type="hidden" id="page" data-ezclassify-aggregate>`;
        const ui = await mount();
        await ready(ui);
        ui.add(el('title'), 'marking');
        await expect.poll(() => el('page').value).toBe('HIGH');

        ui.remove(el('title'));

        expect(el('title').getAttributeNames()).toEqual(['id', 'value']);
        expect(ui.components.has(el('title'))).toBe(false);
        await expect.poll(() => el('page').value).toBe('LOW');
    });

    it("puts back the page's own attributes", async () => {
        root.innerHTML = `
            <input id="doc" data-ezclassify-marking value="LOW">
            <input id="other" data-ezclassify-marking value="LOW">
            <input id="section" data-ezclassify-part-of="doc" value="HIGH">
            <input type="hidden" id="doc-parts" data-ezclassify-aggregate="doc">`;
        const ui = await mount();
        await ready(ui);
        ui.add(el('section'), 'marking', { partOf: 'other' });

        ui.remove(el('section'));

        expect(el('section').getAttribute('data-ezclassify-part-of')).toBe(
            'doc',
        );
        expect(el('section').hasAttribute('data-ezclassify-controller')).toBe(
            false,
        );
    });

    it('leaves an element add never touched alone', async () => {
        root.innerHTML = `
            <input id="memo" data-ezclassify-controller="marking" value="LOW">
            <input type="hidden" id="page" data-ezclassify-aggregate>`;
        const ui = await mount();
        await ready(ui);
        await expect.poll(() => el('page').value).toBe('LOW');

        ui.remove(el('memo'));

        expect(el('memo').getAttribute('data-ezclassify-controller')).toBe(
            'marking',
        );
        expect(ui.components.has(el('memo'))).toBe(true);
    });

    it('goes with the runtime when it is destroyed', async () => {
        root.innerHTML = `<input id="title" value="HIGH">`;
        const ui = await mount();
        await ready(ui);
        ui.add(el('title'), 'marking', { partOf: 'doc' });

        ui.destroy();

        expect(el('title').getAttributeNames()).toEqual(['id', 'value']);
    });
});

describe('attributes a script sets after initialization', () => {
    it('reads a marking a script declares, and drops it when the script removes it', async () => {
        root.innerHTML = `
            <input id="memo" data-ezclassify-marking value="LOW">
            <input id="title" value="HIGH">
            <input type="hidden" id="page" data-ezclassify-aggregate>`;
        const ui = await mount();
        await ready(ui);
        await expect.poll(() => el('page').value).toBe('LOW');

        el('title').setAttribute('data-ezclassify-controller', 'marking');
        await expect.poll(() => el('page').value).toBe('HIGH');
        expect(ui.components.has(el('title'))).toBe(true);

        el('title').removeAttribute('data-ezclassify-controller');
        await expect.poll(() => el('page').value).toBe('LOW');
        expect(ui.components.has(el('title'))).toBe(false);
    });

    it('moves a marking into a whole when a script declares the container', async () => {
        root.innerHTML = `
            <form id="form">
                <input id="doc" data-ezclassify-marking value="LOW">
                <input id="section" data-ezclassify-marking value="HIGH">
            </form>
            <input type="hidden" id="doc-parts" data-ezclassify-aggregate="doc">`;
        const ui = await mount();
        await ready(ui);

        el('form').setAttribute('data-ezclassify-whole', 'doc');

        await expect.poll(() => el('doc-parts').value).toBe('HIGH');
    });

    it('shows a picker host again when its controller is taken off', async () => {
        root.innerHTML = `<input id="pick" value="">`;
        const ui = await mount();
        await ready(ui);
        const field = el('pick');

        ui.add(field, 'select');
        expect(field.style.display).toBe('none');
        expect(
            field.nextElementSibling?.hasAttribute('data-ezclassify-mount'),
        ).toBe(true);

        ui.remove(field);
        expect(field.style.display).toBe('');
        expect(field.nextElementSibling).toBeNull();
    });
});
