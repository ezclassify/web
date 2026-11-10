/**
 * The marking tree a page spells in markup, read end to end through the real
 * engine: Contexts and their buckets, collections of wholes with parts, the
 * outputs a host places, and the regions markup fences off.
 *
 * Each case drives `EzClassifyUI` over a DOM fragment and reads what a host
 * reads: the outputs it placed, the banner it placed, the store's levels, and
 * the `ezclassify:host-error` events markup it got wrong raises.
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Context } from '@ezclassify/engine';
import { EzClassifyUI } from './ezclassify-ui';
import { VanillaEzClassifyStore } from './store/ezclassify-store';
import { bucketKey, SOLE_BUCKET } from './store/store-shared';
import { levelState } from './store/page-rollup-harness';

const fixtures = resolve(
    dirname(fileURLToPath(import.meta.url)),
    '../../../vendor/spec/fixtures/v1',
);

function scheme(name: string): unknown {
    return JSON.parse(readFileSync(resolve(fixtures, `${name}.json`), 'utf8'));
}

/** A Context over the reference scheme: `level` rolls up by max. */
function reference() {
    return Context.fromComponents({ scheme: scheme('ref-scheme-1') });
}

/** A Context over the second reference scheme, with its own vocabulary. */
function second() {
    return Context.fromComponents({ scheme: scheme('ref-scheme-2') });
}

let root: HTMLElement;
const instances: EzClassifyUI[] = [];

function mount(...args: ConstructorParameters<typeof EzClassifyUI>) {
    const ui = new EzClassifyUI(args[0], { root, ...args[1] });
    instances.push(ui);
    return ui;
}

function output(id: string): HTMLInputElement {
    return root.querySelector<HTMLInputElement>(`#${id}`)!;
}

/** Type a marking into a plain marking input and commit it. */
function commit(id: string, value: string): void {
    const input = output(id);
    input.value = value;
    input.dispatchEvent(new FocusEvent('blur', { bubbles: true }));
}

/** The host errors raised under the root, by code. */
function hostErrors(): string[] {
    return errors.map((e) => e.code);
}

let errors: Array<{ code: string; message: string }> = [];
const collect = (e: Event) =>
    errors.push((e as CustomEvent<{ code: string; message: string }>).detail);

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

describe('a page with two Contexts', () => {
    // The page's default Context is markup on an outer element; the CUI-like
    // section names its own. The page-level views name none, so they see both.
    beforeEach(() => root.setAttribute('data-ezclassify-context', 'ref'));

    const markup = `
        <input id="memo" data-ezclassify-marking value="HIGH">
        <section data-ezclassify-context="share">
            <input id="note" data-ezclassify-marking value="LOW//ALPHA">
        </section>
        <div id="banner" data-ezclassify-controller="banner" data-ezclassify-aggregate></div>
        <input type="hidden" id="ref-page" data-ezclassify-aggregate data-ezclassify-context="ref">
        <input type="hidden" id="share-page" data-ezclassify-aggregate data-ezclassify-context="share">
        <input type="hidden" id="ambiguous" data-ezclassify-aggregate>`;

    it('rolls each Context up in its own bucket and never merges them', async () => {
        root.innerHTML = markup;
        const ui = mount({ contexts: { ref: reference(), share: second() } });
        await expect.poll(() => output('ref-page').value).toBe('HIGH');
        await expect.poll(() => output('share-page').value).toBe('LOW//ALPHA');

        const page = ui.store.getAggregate().byBucket;
        expect([...page.keys()].sort()).toEqual(
            [bucketKey('ref', ''), bucketKey('share', '')].sort(),
        );
    });

    it('shows every bucket on the page banner, each labeled', async () => {
        root.innerHTML = markup;
        mount({ contexts: { ref: reference(), share: second() } });
        const banner = root.querySelector<HTMLElement>('#banner')!;
        await expect
            .poll(() => banner.textContent ?? '')
            .toMatch(/ref: Reference Scheme 1[\s\S]*HIGH/);
        expect(banner.textContent).toMatch(
            /share: Reference Scheme 2[\s\S]*LOW\/\/ALPHA/,
        );
    });

    it('labels the one marking the page banner shows while the other Context holds none', async () => {
        root.innerHTML = `
            <input id="memo" data-ezclassify-marking value="HIGH">
            <section data-ezclassify-context="share">
                <input id="note" data-ezclassify-marking value="">
            </section>
            <div id="banner" data-ezclassify-controller="banner" data-ezclassify-aggregate></div>`;
        mount({ contexts: { ref: reference(), share: second() } });
        const banner = root.querySelector<HTMLElement>('#banner')!;
        await expect
            .poll(() => banner.textContent ?? '')
            .toMatch(/ref: Reference Scheme 1[\s\S]*HIGH/);
        expect(
            banner.querySelector('.status-banner')!.getAttribute('aria-label'),
        ).toMatch(/^Page marking\. ref: Reference Scheme 1: HIGH/);
    });

    it('refuses an output that names no bucket when the page holds two', async () => {
        root.innerHTML = markup;
        mount({ contexts: { ref: reference(), share: second() } });
        await expect.poll(hostErrors).toContain('aggregate-bucket-ambiguous');
        expect(output('ambiguous').value).toBe('');
        expect(output('ambiguous').getAttribute('aria-invalid')).toBe('true');
    });

    it('refuses a part whose whole is read in the other Context', async () => {
        root.innerHTML = `
            <input id="memo" data-ezclassify-marking value="HIGH">
            <section data-ezclassify-context="share">
                <input id="stray" data-ezclassify-marking data-ezclassify-part-of="memo" value="LOW">
            </section>
            <input type="hidden" id="ref-page" data-ezclassify-aggregate data-ezclassify-context="ref">`;
        const ui = mount({ contexts: { ref: reference(), share: second() } });
        await expect.poll(hostErrors).toContain('part-of-across-contexts');
        // The refused part is unread, so the page says it may be missing a
        // marking instead of reading HIGH as complete.
        await expect.poll(() => output('ref-page').value).toBe('HIGH');
        await expect
            .poll(() => output('ref-page').getAttribute('aria-invalid'))
            .toBe('true');
        expect(ui.store.get('stray').rendered).toBe('');
    });
});

describe('a collection tree with parts', () => {
    const tree = `
        <input type="hidden" id="page" data-ezclassify-aggregate>
        <section data-ezclassify-collection="folder-a">
            <input type="hidden" id="folder-a-out" data-ezclassify-aggregate="folder-a">
            <article data-ezclassify-whole="memo1">
                <input id="memo1" data-ezclassify-marking value="LOW">
                <input id="memo1-p1" data-ezclassify-marking value="MED">
            </article>
            <input id="memo2" data-ezclassify-marking value="LOW">
        </section>
        <section data-ezclassify-collection="folder-b">
            <input type="hidden" id="folder-b-out" data-ezclassify-aggregate="folder-b">
            <input id="memo3" data-ezclassify-marking value="LOW">
        </section>`;

    it('rolls a folder up from its wholes, each whole read with its parts', async () => {
        root.innerHTML = tree;
        const ui = mount(reference());
        // memo1 states LOW but its part is MED: the folder reads the whole with
        // its parts rollup, so MED reaches the folder and the page.
        await expect.poll(() => output('folder-a-out').value).toBe('MED');
        await expect.poll(() => output('folder-b-out').value).toBe('LOW');
        await expect.poll(() => output('page').value).toBe('MED');
        expect(levelState(ui.store, 'memo1').rendered).toBe('MED');
    });

    it('reads the same page marking as the same wholes and parts laid out flat', async () => {
        root.innerHTML = tree;
        mount(reference());
        await expect.poll(() => output('page').value).toBe('MED');
        const nested = output('page').value;
        for (const ui of instances.splice(0)) ui.destroy();

        root.innerHTML = `
            <input type="hidden" id="page" data-ezclassify-aggregate>
            <input id="memo1" data-ezclassify-marking value="LOW">
            <input id="memo1-p1" data-ezclassify-marking data-ezclassify-part-of="memo1" value="MED">
            <input id="memo2" data-ezclassify-marking value="LOW">
            <input id="memo3" data-ezclassify-marking value="LOW">`;
        mount(reference());
        await expect.poll(() => output('page').value).toBe(nested);
    });
});

describe('an output the host places', () => {
    it('goes down when a part goes down: it never feeds its own value back', async () => {
        root.innerHTML = `
            <form data-ezclassify-whole="doc">
                <input id="doc" data-ezclassify-marking value="LOW">
                <input id="part" data-ezclassify-marking value="LOW">
                <input type="hidden" id="page" name="pageMarking" data-ezclassify-aggregate>
            </form>`;
        mount(reference());
        await expect.poll(() => output('page').value).toBe('LOW');

        commit('part', 'HIGH');
        await expect.poll(() => output('page').value).toBe('HIGH');

        commit('part', 'LOW');
        await expect.poll(() => output('page').value).toBe('LOW');
    });
});

describe('a region markup fences off', () => {
    it('fails closed on a marked element inside an ignored subtree', async () => {
        root.innerHTML = `
            <input id="memo" data-ezclassify-marking value="LOW">
            <div data-ezclassify-ignore>
                <input id="hidden-high" data-ezclassify-marking value="HIGH">
            </div>
            <input type="hidden" id="page" data-ezclassify-aggregate>`;
        const ui = mount(reference());
        await expect.poll(hostErrors).toContain('marked-in-ignore');
        // The refused marking is not read, and the page says it may be missing
        // one rather than reading LOW as complete.
        await expect.poll(() => output('page').value).toBe('LOW');
        await expect
            .poll(() => output('page').getAttribute('aria-invalid'))
            .toBe('true');
        expect(ui.store.get('hidden-high').rendered).toBe('');
    });

    it('reads nothing in a product listing that quotes markings as text', async () => {
        root.innerHTML = `
            <input id="memo" data-ezclassify-marking value="LOW">
            <ul data-ezclassify-ignore>
                <li>Source: Report 12, marked HIGH/CTRL-A</li>
                <li>Source: Report 14, marked MED</li>
            </ul>
            <input type="hidden" id="page" data-ezclassify-aggregate>`;
        const ui = mount(reference());
        await expect.poll(() => output('page').value).toBe('LOW');
        await new Promise((r) => setTimeout(r, 100));
        expect(output('page').value).toBe('LOW');
        expect(output('page').hasAttribute('aria-invalid')).toBe(false);
        expect(hostErrors()).toEqual([]);
        expect([...ui.store.getAggregate().byBucket.keys()]).toEqual([
            SOLE_BUCKET,
        ]);
    });
});

describe('a translated view', () => {
    /**
     * The reference Context with a crosswalk out of its scheme. The engine is
     * real; only the crosswalk's answer is staged, so the case reads what the
     * runtime hands the crosswalk and what it shows of the answer.
     */
    function translating() {
        const context = reference();
        const translate = vi.fn(
            async (input: { crosswalkId: string; marking: unknown }) => ({
                resolution: {
                    contextId: 'ref',
                    resolvedVersion: '1.0.0',
                    artifacts: [],
                    sources: [],
                },
                result: {
                    status: 'complete',
                    crosswalk: {
                        kind: 'crosswalk',
                        id: input.crosswalkId,
                        version: '1.0.0',
                    },
                    outcomes: [],
                    selections: [],
                    target: {
                        assertions: [],
                        rendered: 'TRANSLATED',
                        valid: true,
                        errors: [],
                        notices: [],
                        appliedFixes: [],
                    },
                },
                operationLimitations: [],
            }),
        );
        const proxied = new Proxy(context, {
            get(target, property, receiver) {
                if (property === 'translate') return translate;
                const value = Reflect.get(target, property, receiver);
                return typeof value === 'function' ? value.bind(target) : value;
            },
        });
        return { context: proxied, translate };
    }

    it('translates the page rollup it shows and never contributes to it', async () => {
        root.innerHTML = `
            <input id="memo" data-ezclassify-marking value="HIGH">
            <div id="view" data-ezclassify-aggregate data-ezclassify-translate="ref-to-label"></div>
            <input type="hidden" id="page" data-ezclassify-aggregate>`;
        const { context, translate } = translating();
        const ui = mount(context);
        const view = root.querySelector<HTMLElement>('#view')!;
        await expect
            .poll(
                () =>
                    view.querySelector('.ez-translated-view__marking')
                        ?.textContent,
            )
            .toBe('TRANSLATED');
        const last = translate.mock.calls.at(-1)![0] as {
            crosswalkId: string;
            marking: Array<{ conceptId: string }>;
        };
        expect(last.crosswalkId).toBe('ref-to-label');
        expect(last.marking.map((a) => a.conceptId)).toContain('HIGH');
        expect(output('page').value).toBe('HIGH');
        expect(ui.store.getAggregate().byBucket.size).toBe(1);
    });

    it('refuses a translated view on a form control', async () => {
        root.innerHTML = `
            <input id="memo" data-ezclassify-marking value="HIGH">
            <input id="view" data-ezclassify-source="memo" data-ezclassify-translate="ref-to-label">`;
        mount(translating().context);
        await expect.poll(hostErrors).toContain('translate-refused');
    });
});

describe('marking ids', () => {
    it('refuses a second marking host under an id another one holds', async () => {
        root.setAttribute('data-ezclassify-context', 'ref');
        root.innerHTML = `
            <input id="memo" data-ezclassify-marking value="LOW">
            <section data-ezclassify-context="share">
                <input id="memo" data-ezclassify-marking value="HIGH">
            </section>
            <input type="hidden" id="ref-page" data-ezclassify-aggregate data-ezclassify-context="ref">`;
        mount({ contexts: { ref: reference(), share: second() } });
        await expect.poll(hostErrors).toContain('duplicate-marking-id');
        await expect.poll(() => output('ref-page').value).toBe('LOW');
        expect(output('ref-page').getAttribute('aria-invalid')).toBe('true');
    });
});

describe('a refused element inside a collection', () => {
    const folders = (inside: string) => `
        <input type="hidden" id="page" data-ezclassify-aggregate>
        <section data-ezclassify-collection="fa">
            <input type="hidden" id="fa-out" data-ezclassify-aggregate="fa">
            <input id="m1" data-ezclassify-marking value="LOW">
            ${inside}
        </section>
        <section data-ezclassify-collection="fb">
            <input id="m2" data-ezclassify-marking value="LOW">
        </section>`;

    it('leaves its own folder incomplete, not only the page', async () => {
        root.innerHTML = folders(`
            <div data-ezclassify-ignore>
                <input id="hidden-high" data-ezclassify-marking value="HIGH">
            </div>`);
        const ui = mount(reference());
        await expect.poll(hostErrors).toContain('marked-in-ignore');
        await expect.poll(() => output('fa-out').value).toBe('LOW');
        await expect.poll(() => levelState(ui.store, 'fa').stale).toBe(true);
        expect(levelState(ui.store).stale).toBe(true);
        expect(levelState(ui.store, 'fb').stale).toBeUndefined();
    });

    it('leaves the folder incomplete for a second host under one id', async () => {
        root.innerHTML = folders(
            `<input id="m1" data-ezclassify-marking value="HIGH">`,
        );
        const ui = mount(reference());
        await expect.poll(hostErrors).toContain('duplicate-marking-id');
        await expect.poll(() => levelState(ui.store, 'fa').stale).toBe(true);
        expect(levelState(ui.store, 'fb').stale).toBeUndefined();
    });

    it('refuses a part-of naming no element, and the folder says it is incomplete', async () => {
        root.innerHTML = folders(
            `<input id="p1" data-ezclassify-marking data-ezclassify-part-of="typo" value="HIGH">`,
        );
        const ui = mount(reference());
        await expect.poll(hostErrors).toContain('whole-missing');
        await expect.poll(() => output('fa-out').value).toBe('LOW');
        await expect.poll(() => levelState(ui.store, 'fa').stale).toBe(true);
        // The refused part is never rolled up under a whole only it names.
        expect(output('page').value).toBe('LOW');
        expect(ui.store.get('p1').rendered).toBe('');
    });

    it("leaves a whole's own rollup incomplete for a refused part inside it", async () => {
        root.innerHTML = folders(`
            <article data-ezclassify-whole="memo1">
                <input id="memo1" data-ezclassify-marking value="LOW">
                <input id="memo1-p1" data-ezclassify-marking data-ezclassify-part-of="m2" value="HIGH">
            </article>`);
        const ui = mount(reference());
        await expect.poll(hostErrors).toContain('part-of-disagrees');
        await expect.poll(() => levelState(ui.store, 'memo1').stale).toBe(true);
        expect(levelState(ui.store, 'fa').stale).toBe(true);
    });
});

describe('markup that names another element', () => {
    it('reads a part again once the whole it names appears', async () => {
        root.innerHTML = `
            <input type="hidden" id="page" data-ezclassify-aggregate>
            <form id="form" data-ezclassify-whole="doc">
                <input id="p1" data-ezclassify-marking value="HIGH">
            </form>`;
        const ui = mount(reference());
        await expect.poll(hostErrors).toContain('whole-missing');
        await expect.poll(() => levelState(ui.store).stale).toBe(true);

        const doc = document.createElement('input');
        doc.id = 'doc';
        doc.setAttribute('data-ezclassify-marking', '');
        doc.value = 'LOW';
        root.querySelector('#form')!.prepend(doc);

        await expect.poll(() => output('page').value).toBe('HIGH');
        await expect.poll(() => levelState(ui.store).stale).toBeUndefined();
        expect(levelState(ui.store, 'doc').rendered).toBe('HIGH');
    });

    it('refuses a part once the whole it names moves to another Context', async () => {
        root.setAttribute('data-ezclassify-context', 'ref');
        root.innerHTML = `
            <div id="box"><input id="memo" data-ezclassify-marking value="LOW"></div>
            <input id="stray" data-ezclassify-marking data-ezclassify-part-of="memo" value="HIGH">
            <input type="hidden" id="ref-page" data-ezclassify-aggregate data-ezclassify-context="ref">`;
        mount({ contexts: { ref: reference(), share: second() } });
        await expect.poll(() => output('ref-page').value).toBe('HIGH');
        expect(hostErrors()).toEqual([]);

        root.querySelector('#box')!.setAttribute(
            'data-ezclassify-context',
            'share',
        );
        await expect.poll(hostErrors).toContain('part-of-across-contexts');
    });
});

describe('a field that selects a scheme', () => {
    /**
     * A crosswalk Context: the reference scheme is its primary and the second
     * reference scheme the crosswalk's target. Both engines are real; the
     * Context's scheme list and its view of the second scheme are composed here
     * the way a crosswalk Context reports them.
     */
    function crosswalking() {
        const context = reference();
        const target = second().scheme;
        const schemes = [
            {
                selector: 'ref-scheme-1',
                id: 'ref-scheme-1',
                version: '1.0.0',
                roles: ['primary', 'crosswalk-source'],
            },
            {
                selector: 'ref-scheme-2',
                id: 'ref-scheme-2',
                version: '1.0.0',
                roles: ['crosswalk-target'],
            },
        ];
        const schemeView = vi.fn((selector: string) => {
            if (selector === 'ref-scheme-2') return target;
            throw new Error(`no scheme '${selector}'`);
        });
        const proxied = new Proxy(context, {
            get(on, property, receiver) {
                if (property === 'describeSchemes') return () => schemes;
                if (property === 'schemeView') return schemeView;
                const value = Reflect.get(on, property, receiver);
                return typeof value === 'function' ? value.bind(on) : value;
            },
        });
        return { context: proxied, schemeView };
    }

    const twoSchemes = `
        <input id="memo" data-ezclassify-marking value="HIGH">
        <div data-ezclassify-scheme="ref-scheme-2">
            <input id="note" data-ezclassify-marking value="LOW//ALPHA">
        </div>
        <div id="banner" data-ezclassify-controller="banner" data-ezclassify-aggregate></div>
        <input type="hidden" id="first-page" data-ezclassify-aggregate data-ezclassify-scheme="ref-scheme-1">
        <input type="hidden" id="second-page" data-ezclassify-aggregate data-ezclassify-scheme="ref-scheme-2">`;

    it("marks in the Context's second scheme, in its own bucket", async () => {
        root.innerHTML = twoSchemes;
        const { context, schemeView } = crosswalking();
        const ui = mount(context);
        await expect.poll(() => output('first-page').value).toBe('HIGH');
        await expect.poll(() => output('second-page').value).toBe('LOW//ALPHA');

        expect(hostErrors()).toEqual([]);
        expect(schemeView).toHaveBeenCalledWith('ref-scheme-2');
        const page = ui.store.getAggregate().byBucket;
        expect([...page.keys()].sort()).toEqual(
            [bucketKey('', ''), bucketKey('', 'ref-scheme-2')].sort(),
        );
        expect(page.get(bucketKey('', 'ref-scheme-2'))!.rendered).toBe(
            'LOW//ALPHA',
        );
    });

    it('reads a field by its own scheme, and keeps both on the page banner, labeled', async () => {
        root.innerHTML = twoSchemes;
        const { context } = crosswalking();
        const ui = mount(context);
        const banner = root.querySelector<HTMLElement>('#banner')!;
        await expect
            .poll(() => banner.textContent ?? '')
            .toMatch(/Reference Scheme 1[\s\S]*HIGH/);
        expect(banner.textContent).toMatch(
            /Reference Scheme 2[\s\S]*LOW\/\/ALPHA/,
        );

        // The second scheme's vocabulary is not the primary's: the same text
        // reads differently in each bucket.
        commit('memo', 'LOW//ALPHA');
        await expect.poll(() => output('first-page').value).toBe('LOW');
        expect(ui.store.get('memo').rendered).toBe('LOW');
        expect(ui.store.get('note').rendered).toBe('LOW//ALPHA');
        expect(output('second-page').value).toBe('LOW//ALPHA');
    });

    it('reads a second-scheme marking its bound views edit by that scheme alone', async () => {
        root.innerHTML = `
            <div data-ezclassify-scheme="ref-scheme-2">
                <input type="hidden" id="note" data-ezclassify-marking value="LOW//ALPHA">
                <fieldset data-ezclassify-controller="selector" data-ezclassify-bound-to="note"></fieldset>
                <input id="typed-note" data-ezclassify-bound-to="note">
            </div>`;
        // The engine's own two-scheme Context.
        const context = Object.freeze(
            Context.fromComponents({
                schemes: [
                    { key: 'ref-scheme-1', scheme: scheme('ref-scheme-1') },
                    { key: 'ref-scheme-2', scheme: scheme('ref-scheme-2') },
                ],
                primaryScheme: 'ref-scheme-1',
            } as Parameters<typeof Context.fromComponents>[0]),
        );
        const ui = mount(context);
        await expect.poll(() => output('typed-note').value).toBe('LOW//ALPHA');
        await new Promise((resolve) => setTimeout(resolve, 50));

        expect(hostErrors()).toEqual([]);
        expect(ui.store.get('note').rendered).toBe('LOW//ALPHA');
        expect(output('typed-note').value).toBe('LOW//ALPHA');
    });

    function twoSchemeEngineContext() {
        // The engine's own two-scheme Context.
        return Object.freeze(
            Context.fromComponents({
                schemes: [
                    { key: 'ref-scheme-1', scheme: scheme('ref-scheme-1') },
                    { key: 'ref-scheme-2', scheme: scheme('ref-scheme-2') },
                ],
                primaryScheme: 'ref-scheme-1',
            } as Parameters<typeof Context.fromComponents>[0]),
        );
    }

    it("marks a bound view in its marking's scheme wherever the view sits", async () => {
        root.innerHTML = `
            <div data-ezclassify-scheme="ref-scheme-2">
                <input type="hidden" id="note" data-ezclassify-marking value="LOW//ALPHA">
            </div>
            <fieldset data-ezclassify-controller="selector" data-ezclassify-bound-to="note"></fieldset>
            <input id="typed-note" data-ezclassify-bound-to="note">`;
        const ui = mount(twoSchemeEngineContext());
        await expect.poll(() => output('typed-note').value).toBe('LOW//ALPHA');
        await new Promise((resolve) => setTimeout(resolve, 50));

        expect(hostErrors()).toEqual([]);
        expect(ui.store.get('note').rendered).toBe('LOW//ALPHA');
    });

    it('refuses a bound view whose own markup selects another scheme than its marking', async () => {
        root.innerHTML = `
            <div data-ezclassify-scheme="ref-scheme-2">
                <input type="hidden" id="note" data-ezclassify-marking value="LOW//ALPHA">
            </div>
            <div data-ezclassify-scheme="ref-scheme-1">
                <fieldset data-ezclassify-controller="selector" data-ezclassify-bound-to="note"></fieldset>
            </div>
            <input id="typed-note" data-ezclassify-bound-to="note">`;
        const ui = mount(twoSchemeEngineContext());
        await expect.poll(() => output('typed-note').value).toBe('LOW//ALPHA');
        await expect.poll(() => hostErrors()).toEqual(['context-unresolved']);

        expect(errors[0]!.message).toMatch(/binds the marking 'note'/);
        expect(ui.store.get('note').rendered).toBe('LOW//ALPHA');
    });

    it('refuses a field per element when the store the host gave cannot read its scheme', async () => {
        root.innerHTML = twoSchemes;
        const { context } = crosswalking();
        mount(context, { store: new VanillaEzClassifyStore(context.scheme) });
        await expect.poll(hostErrors).toContain('context-unresolved');
        expect(errors.at(-1)!.message).toMatch(/marking "note"/);
        await expect.poll(() => output('first-page').value).toBe('HIGH');
        await expect
            .poll(() => output('first-page').getAttribute('aria-invalid'))
            .toBe('true');
    });

    it('is a host error, never a throw, when the Context holds no such scheme', async () => {
        root.innerHTML = `
            <input type="hidden" id="page" data-ezclassify-aggregate>
            <input id="m0" data-ezclassify-marking value="LOW">
            <div data-ezclassify-scheme="tier">
                <input id="m1" data-ezclassify-marking value="HIGH">
            </div>`;
        const ui = mount(reference());
        await expect.poll(hostErrors).toContain('context-unresolved');
        expect(errors.at(-1)!.message).toMatch(
            /names no scheme the Context holds/,
        );
        await expect.poll(() => output('page').value).toBe('LOW');
        await expect
            .poll(() => output('page').getAttribute('aria-invalid'))
            .toBe('true');
        expect(ui.store.get('m1').rendered).toBe('');
    });

    it('is a host error under several Contexts, and when the attribute arrives later', async () => {
        root.setAttribute('data-ezclassify-context', 'a');
        root.innerHTML = `
            <input type="hidden" id="pa" data-ezclassify-aggregate data-ezclassify-context="a">
            <input id="m0" data-ezclassify-marking value="LOW">
            <div id="section"><input id="m1" data-ezclassify-marking value="HIGH"></div>`;
        mount({ contexts: { a: reference(), b: reference() } });
        await expect.poll(() => output('pa').value).toBe('HIGH');

        root.querySelector('#section')!.setAttribute(
            'data-ezclassify-scheme',
            'tier',
        );
        await expect.poll(hostErrors).toContain('context-unresolved');
        await expect.poll(() => output('pa').value).toBe('LOW');
        await expect
            .poll(() => output('pa').getAttribute('aria-invalid'))
            .toBe('true');
    });
});
