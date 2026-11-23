/**
 * The runtime reads the marking tree from markup: whole containers make parts,
 * collections and member-of place wholes, views never contribute, refused
 * markup stays unenhanced and holds the levels above it incomplete, and a
 * structural attribute change derives its subtree again.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
    Assertion,
    ContextAdapter,
    SchemeEngineAdapter,
} from '@ezclassify/types';
import { EzClassifyUI } from './ezclassify-ui';
import { mockRenderFormats } from './render-format-layout-mock';
import { __resetMountRollupRegistry } from './mount-rollup-registry';
import { BaseEzClassifyStore } from './store/base-ezclassify-store';
import { VanillaEzClassifyStore } from './store/ezclassify-store';

vi.mock('./styles.css?inline', () => ({ default: '' }));

const concepts = [
    {
        id: 'A',
        name: 'Option A',
        views: { default: 'A' },
        categories: ['level'],
    },
    {
        id: 'B',
        name: 'Option B',
        views: { default: 'B' },
        categories: ['level'],
    },
];

function read(text: string): Assertion[] {
    return concepts
        .filter((c) => text.includes(c.views.default))
        .map((c) => ({
            conceptId: c.id,
            categoryId: 'level',
            confidence: 'certain' as const,
            source: 'parse' as const,
        }));
}

function spell(assertions: Assertion[]): string {
    return assertions.map((a) => a.conceptId).join('');
}

function createContext(): ContextAdapter {
    const valid = {
        notices: [],
        errors: [],
        valid: true,
        complete: true,
        appliedFixes: [],
    };
    const scheme = {
        getScheme: () => ({
            ...scheme.getSchemeMeta(),
            referenceSurfaceLabel: {
                singular: 'Handbook',
                plural: 'Handbooks',
            },
            categories: scheme.listCategories(),
            concepts,
            labelPresets: [],
        }),
        getSchemeMeta: () => ({
            id: 'test',
            version: '1.0.0',
            name: 'Test',
            defaultRenderFormat: 'default',
            formats: mockRenderFormats([
                {
                    id: 'default',
                    surface: 'default',
                    mode: 'inline',
                    separator: '',
                    view: 'default',
                    fields: [{ category: 'level', separator: '' }],
                },
            ] as never),
            scopes: [],
        }),
        listCategories: () => [
            { id: 'level', label: 'Level', single: true, order: 0 },
        ],
        getConceptsInCategory: () => concepts,
        render: vi.fn((assertions: Assertion[]) => ({
            rendered: spell(assertions),
            assessment: valid,
        })),
        process: vi.fn(
            (
                input: string | Assertion[],
                options?: { assertions?: Assertion[] },
            ) => {
                const assertions = Array.isArray(input)
                    ? input
                    : [...read(input), ...(options?.assertions ?? [])];
                return {
                    assertions,
                    rendered: spell(assertions),
                    valid: true,
                    errors: [],
                    recognition: {
                        status: 'complete',
                        inputFormat: 'default',
                        surface: 'default',
                        unmatched: [],
                        corrections: [],
                    },
                };
            },
        ),
        validate: vi.fn((input: string) => ({
            assertions: read(input),
            valid: true,
            errors: [],
        })),
        suggest: vi.fn(() => ({ suggestions: [] })),
        aggregate: vi.fn((values: string[]) => ({
            assertions: read(values.join('')),
            rendered: values.join(''),
            valid: true,
        })),
        aggregateAssertions: vi.fn((sets: Assertion[][]) => ({
            assertions: sets.flat(),
            rendered: spell(sets.flat()),
            valid: true,
        })),
        describeConcept: (id: string) => ({ lines: [id] }),
    } as unknown as SchemeEngineAdapter;
    return { scheme, audit: vi.fn() } as unknown as ContextAdapter;
}

async function mount(html: string): Promise<EzClassifyUI> {
    document.body.innerHTML = html;
    const ui = new EzClassifyUI(createContext());
    await new Promise((r) => setTimeout(r, 0));
    return ui;
}

const settle = () => new Promise((r) => setTimeout(r, 0));

let ui: EzClassifyUI | undefined;

beforeEach(() => {
    __resetMountRollupRegistry();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
    ui?.destroy();
    ui = undefined;
    document.body.innerHTML = '';
    vi.restoreAllMocks();
});

function deferred() {
    let resolve!: () => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<void>((done, failed) => {
        resolve = () => done();
        reject = failed;
    });
    return { promise, resolve, reject };
}

describe('marking adapter calls', () => {
    it('processes each mounted standalone marking once without aborting its read', async () => {
        document.body.innerHTML = `
            <input id="a" type="hidden" data-ezclassify-marking value="A">
            <input id="b" data-ezclassify-controller="marking" value="B">
            <textarea id="c" data-ezclassify-controller="marking">A</textarea>
            <input id="d" data-ezclassify-controller="tags" value="B">
            <div data-ezclassify-controller="banner" data-ezclassify-aggregate></div>`;
        const context = createContext();
        ui = new EzClassifyUI(context);
        await expect.poll(() => ui?.isReady).toBe(true);

        const calls = vi.mocked(context.scheme.process).mock.calls;
        expect(calls.map(([input]) => input)).toEqual(['A', 'B', 'A', 'B']);
        for (const [id, conceptId] of [
            ['b', 'B'],
            ['c', 'A'],
            ['d', 'B'],
        ]) {
            const host = document.querySelector<HTMLInputElement>(`#${id}`)!;
            const field =
                ui.components.get(host) ?? ui.autocompleters.get(host);
            expect(field?.getAssertions()).toEqual([
                expect.objectContaining({ conceptId }),
            ]);
        }
        expect(calls.every(([, options]) => !options?.signal?.aborted)).toBe(
            true,
        );
    });

    it.each(['marking', 'tags'])(
        'keeps a newer native edit while the %s field’s mount read settles',
        async (controller) => {
            document.body.innerHTML = `<input id="a" value="A" data-ezclassify-controller="${controller}">`;
            const input = document.querySelector<HTMLInputElement>('#a')!;
            const context = createContext();
            const process = vi.mocked(context.scheme.process);
            const read = process.getMockImplementation()!;
            const old = deferred();
            const edited = deferred();
            process.mockImplementation(((
                ...args: Parameters<SchemeEngineAdapter['process']>
            ) => {
                const [value] = args;
                const answer = read(...args);
                if (value === 'A') return old.promise.then(() => answer);
                if (value === 'B') return edited.promise.then(() => answer);
                return answer;
            }) as never);

            ui = new EzClassifyUI(context);
            await expect
                .poll(() => process.mock.calls.some(([value]) => value === 'A'))
                .toBe(true);
            input.value = 'B';
            input.dispatchEvent(new Event('input', { bubbles: true }));
            await expect
                .poll(
                    () =>
                        process.mock.calls.filter(([value]) => value === 'B')
                            .length,
                )
                .toBe(1);
            old.resolve();
            await expect
                .poll(
                    () =>
                        process.mock.calls.filter(([value]) => value === 'B')
                            .length,
                )
                .toBe(2);
            expect(input.value).toBe('B');
            expect(ui.store.get('a').rendered).toBe('');

            edited.resolve();
            await expect.poll(() => ui?.isReady).toBe(true);
            await expect.poll(() => ui?.store.get('a').rendered).toBe('B');
            expect(input.value).toBe('B');
        },
    );

    it.each(['succeeds', 'fails'])(
        'reads native text assigned without an event when the mount read %s',
        async (outcome) => {
            document.body.innerHTML =
                '<input id="a" value="A" data-ezclassify-controller="marking">';
            const input = document.querySelector<HTMLInputElement>('#a')!;
            const context = createContext();
            const process = vi.mocked(context.scheme.process);
            const read = process.getMockImplementation()!;
            const old = deferred();
            process.mockImplementationOnce(((
                ...args: Parameters<SchemeEngineAdapter['process']>
            ) => old.promise.then(() => read(...args))) as never);

            ui = new EzClassifyUI(context);
            await expect.poll(() => process.mock.calls[0]?.[0]).toBe('A');
            input.value = 'B';
            if (outcome === 'succeeds') old.resolve();
            else old.reject(new Error('The initial read failed'));
            await expect.poll(() => ui?.store.get('a').rendered).toBe('B');
            expect(input.value).toBe('B');
            expect(
                process.mock.calls.filter(([value]) => value === 'B'),
            ).toHaveLength(1);
        },
    );

    it.each([
        ['input', 'A'],
        ['input', 'AA'],
        ['textarea', 'A'],
        ['textarea', 'AA'],
    ])(
        'keeps an uncommitted %s draft when the initial read renders %s',
        async (tag, canonical) => {
            document.body.innerHTML =
                tag === 'input'
                    ? '<input id="a" value="A" data-ezclassify-controller="marking">'
                    : '<textarea id="a" data-ezclassify-controller="marking">A</textarea>';
            const native = document.querySelector<HTMLInputElement>('#a')!;
            const context = createContext();
            const process = vi.mocked(context.scheme.process);
            const read = process.getMockImplementation()!;
            const old = deferred();
            process.mockImplementationOnce(((
                ...args: Parameters<SchemeEngineAdapter['process']>
            ) =>
                old.promise.then(() => ({
                    ...read(...args),
                    rendered: canonical,
                }))) as never);

            ui = new EzClassifyUI(context);
            await expect.poll(() => process.mock.calls[0]?.[0]).toBe('A');
            const editor = document.querySelector<HTMLTextAreaElement>(
                'textarea.marking-field-host',
            )!;
            editor.focus();
            editor.value = 'B';
            editor.dispatchEvent(new Event('input', { bubbles: true }));
            expect(native.value).toBe('B');
            const reflected: string[] = [];
            native.addEventListener('input', () =>
                reflected.push(native.value),
            );

            old.resolve();
            await expect.poll(() => ui?.isReady).toBe(true);
            expect(ui.store.get('a').rendered).toBe(canonical);
            expect(native.value).toBe('B');
            expect(editor.value).toBe('B');
            expect(reflected).toEqual([]);

            for (let press = 0; press < 2; press++)
                editor.dispatchEvent(
                    new KeyboardEvent('keydown', {
                        key: 'Escape',
                        bubbles: true,
                    }),
                );
            expect(editor.value).toBe(canonical);
            expect(native.value).toBe(canonical);
        },
    );

    it('applies native facet selections before later edits on injected stores', async () => {
        document.body.innerHTML = `
            <input id="a" type="hidden" data-ezclassify-marking value="A">
            <select id="facet" data-ezclassify-controller="select"
                    data-ezclassify-facet-of="a" data-ezclassify-category="level">
                <option value="A" selected>A</option>
                <option value="B">B</option>
            </select>`;
        document.querySelector<HTMLSelectElement>('#facet')!.value = 'B';
        const context = createContext();
        const store = new VanillaEzClassifyStore(context.scheme);
        const gate = deferred();
        const seed = store.seedRendered.bind(store);
        vi.spyOn(store, 'seedRendered').mockImplementation(
            async (id, value) => {
                await gate.promise;
                await seed(id, value);
            },
        );
        const publish = vi.spyOn(store, 'publishAssertions');

        try {
            ui = new EzClassifyUI(context, { store });
            await expect
                .poll(() => publish.mock.calls[0]?.[1][0]?.conceptId)
                .toBe('B');
            await store.publishAssertions('a', read('A'), undefined, {
                categories: ['level'],
            });
            gate.resolve();
            await expect.poll(() => ui?.isReady).toBe(true);
            expect(store.get('a').rendered).toBe('A');
        } finally {
            gate.resolve();
            ui?.destroy();
            ui = undefined;
            store.destroy();
        }
    });

    it('reads served text once when a native facet changes its initial selection', async () => {
        document.body.innerHTML = `
            <input id="a" type="hidden" data-ezclassify-marking value="A">
            <select id="facet" data-ezclassify-controller="select"
                    data-ezclassify-facet-of="a" data-ezclassify-category="level">
                <option value="A" selected>A</option>
                <option value="B">B</option>
            </select>`;
        document.querySelector<HTMLSelectElement>('#facet')!.value = 'B';
        const context = createContext();
        ui = new EzClassifyUI(context);
        await expect.poll(() => ui?.isReady).toBe(true);

        const calls = vi.mocked(context.scheme.process).mock.calls;
        expect(calls.filter(([input]) => input === 'A')).toHaveLength(1);
        expect(calls.every(([, options]) => !options?.signal?.aborted)).toBe(
            true,
        );
        expect(ui.store.get('a').rendered).toBe('B');
    });

    it('updates collection membership from committed facts without remounting or reading the marking', async () => {
        document.body.innerHTML = `
            <section data-ezclassify-collection="folder"></section>
            <input id="a" data-ezclassify-controller="marking" value="A">
            <input id="out" type="hidden" data-ezclassify-aggregate="folder">
            <div id="banner" data-ezclassify-controller="banner" data-ezclassify-aggregate="folder"></div>`;
        const context = createContext();
        ui = new EzClassifyUI(context);
        await expect.poll(() => ui?.isReady).toBe(true);
        const marking = document.getElementById('a')!;
        const output = document.querySelector<HTMLInputElement>('#out')!;
        const bannerText = () =>
            document.querySelector('#banner .status-banner-label')?.textContent;
        const component = ui.components.get(marking);
        expect(component).toBeDefined();
        const process = vi.mocked(context.scheme.process);
        const validate = vi.mocked(context.scheme.validate);
        process.mockClear();
        validate.mockClear();

        marking.setAttribute('data-ezclassify-member-of', 'folder');
        await expect.poll(() => output.value).toBe('A');
        expect(bannerText()).toBe('A');
        expect(ui.components.get(marking) === component).toBe(true);
        marking.removeAttribute('data-ezclassify-member-of');
        await expect.poll(() => output.value).toBe('');
        expect(bannerText()).toBe('No marking');
        expect(ui.components.get(marking) === component).toBe(true);
        expect(process).not.toHaveBeenCalled();
        expect(validate).not.toHaveBeenCalled();
    });

    it('adds and removes a collection around a known marking without rereading it', async () => {
        document.body.innerHTML = `
            <section id="region">
                <input id="whole" type="hidden" data-ezclassify-marking value="A">
            </section>`;
        const context = createContext();
        ui = new EzClassifyUI(context);
        await expect.poll(() => ui?.isReady).toBe(true);
        const process = vi.mocked(context.scheme.process);
        const validate = vi.mocked(context.scheme.validate);
        process.mockClear();
        validate.mockClear();
        const region = document.querySelector('#region')!;
        region.setAttribute('data-ezclassify-collection', 'folder');
        await expect
            .poll(
                () =>
                    [...ui!.store.getAggregate('folder').byBucket.values()][0]
                        ?.rendered,
            )
            .toBe('A');
        region.removeAttribute('data-ezclassify-collection');
        await expect
            .poll(() => ui!.store.getAggregate('folder').byBucket.size)
            .toBe(0);
        expect(process).not.toHaveBeenCalled();
        expect(validate).not.toHaveBeenCalled();
    });

    it('shows an unchecked collection marking as incomplete without displaying a rollup', async () => {
        document.body.innerHTML = `
            <section data-ezclassify-collection="folder">
                <input id="unchecked" type="hidden" data-ezclassify-marking value="A">
            </section>
            <input id="out" type="hidden" data-ezclassify-aggregate="folder">
            <div id="banner" data-ezclassify-controller="banner" data-ezclassify-aggregate="folder"></div>`;
        const context = createContext();
        vi.mocked(context.scheme.process).mockImplementationOnce(() => {
            throw new Error('Adapter offline');
        });
        ui = new EzClassifyUI(context);
        await expect.poll(() => ui?.isReady).toBe(true);
        const banner = document.querySelector('#banner .status-banner')!;
        await expect
            .poll(() => banner.classList.contains('status-banner--incomplete'))
            .toBe(true);
        expect(banner.querySelector('.status-banner-label')?.textContent).toBe(
            'No marking',
        );
        const output = document.querySelector<HTMLInputElement>('#out')!;
        await expect
            .poll(() => output.getAttribute('aria-invalid'))
            .toBe('true');
        expect(output.value).toBe('');
        expect(context.scheme.aggregateAssertions).not.toHaveBeenCalled();
        expect(context.scheme.validate).not.toHaveBeenCalled();
    });

    it('skips aggregation when a marking excluded from rollups commits', async () => {
        document.body.innerHTML = `
            <input id="a" type="hidden" data-ezclassify-marking value="A">
            <input id="b" type="hidden" data-ezclassify-marking data-ezclassify-no-rollup value="A">
            <input id="out" type="hidden" data-ezclassify-aggregate>`;
        const context = createContext();
        ui = new EzClassifyUI(context);
        const output = document.querySelector<HTMLInputElement>('#out')!;
        await expect.poll(() => output.value).toBe('A');
        const aggregate = vi.mocked(context.scheme.aggregateAssertions);
        aggregate.mockClear();

        await ui.store.publishRendered('b', 'B');
        await ui.flushRollupNow();
        expect(ui.store.get('b').rendered).toBe('B');
        expect(output.value).toBe('A');
        expect(aggregate).not.toHaveBeenCalled();
    });
});

it('names each mounted banner independently and supports silent updates', async () => {
    ui = await mount(`
        <input id="a" type="hidden" data-ezclassify-marking value="A">
        <div id="page" data-ezclassify-controller="banner" data-ezclassify-aggregate
            data-ezclassify-banner-label="Detected on this page"></div>
        <div id="screen" data-ezclassify-controller="banner" data-ezclassify-source="a"
            data-ezclassify-banner-label="Visible on screen" data-ezclassify-banner-no-live></div>`);
    const page = document.querySelector('#page .status-banner')!;
    const screen = document.querySelector('#screen .status-banner')!;
    expect(page.getAttribute('aria-label')).toBe('Detected on this page: A');
    expect(page.getAttribute('aria-live')).toBe('polite');
    expect(screen.getAttribute('aria-label')).toBe('Visible on screen: A');
    expect(screen.getAttribute('aria-live')).toBe('off');
    expect(screen.getAttribute('role')).toBe('group');

    await ui.store.publishRendered('a', 'B');
    await expect
        .poll(() => page.getAttribute('aria-label'))
        .toBe('Detected on this page: B');
    expect(screen.getAttribute('aria-label')).toBe('Visible on screen: B');
    expect(screen.getAttribute('aria-live')).toBe('off');
});

describe('whole containers', () => {
    it('places every host in the container under the whole it names', async () => {
        document.body.innerHTML = `
            <form data-ezclassify-whole="doc">
                <input id="doc" type="hidden" data-ezclassify-marking value="A">
                <input id="p1" type="hidden" data-ezclassify-marking value="A">
                <input id="p2" type="hidden" data-ezclassify-marking value="B">
            </form>`;
        const setPartOf = vi.spyOn(BaseEzClassifyStore.prototype, 'setPartOf');
        ui = new EzClassifyUI(createContext());
        await settle();
        expect(ui.partOfMap.get(document.getElementById('p1')!)).toBe('doc');
        expect(ui.partOfMap.get(document.getElementById('p2')!)).toBe('doc');
        expect(ui.partOfMap.has(document.getElementById('doc')!)).toBe(false);
        expect(setPartOf).toHaveBeenCalledWith('p1', 'doc');
        expect(setPartOf).toHaveBeenCalledWith('p2', 'doc');
        expect(setPartOf).not.toHaveBeenCalledWith('doc', 'doc');
    });
});

describe('views never contribute', () => {
    it('keeps a hidden aggregate sink out of the contributing fields', async () => {
        ui = await mount(`
            <input id="a" type="hidden" data-ezclassify-marking value="A">
            <input id="sink" type="hidden" name="pageMarking" data-ezclassify-aggregate>`);
        const sink = document.getElementById('sink') as HTMLInputElement;
        expect(ui.fields).toContain(document.getElementById('a'));
        expect(ui.fields).not.toContain(sink);
        expect(ui.isContributor(sink)).toBe(false);
        expect(ui.isContributor(document.getElementById('a')!)).toBe(true);
        // The runtime no longer stamps a view to keep it out.
        expect(sink.hasAttribute('data-ezclassify-no-rollup')).toBe(false);
    });

    it('keeps a plain bound-to editor out of the contributing fields', async () => {
        ui = await mount(`
            <input id="a" type="hidden" data-ezclassify-marking value="A">
            <input id="edit" data-ezclassify-bound-to="a">`);
        expect(ui.fields).not.toContain(document.getElementById('edit'));
    });
});

describe('plain select', () => {
    it('binds a facet select without an opt-in attribute', async () => {
        ui = await mount(`
            <input id="m" type="hidden" data-ezclassify-marking value="A">
            <select id="s" data-ezclassify-facet-of="m" data-ezclassify-category="level"></select>`);
        const select = document.getElementById('s') as HTMLSelectElement;
        expect(ui.plainBehaviorCleanups.has(select)).toBe(true);
    });
});

describe('collections', () => {
    it('declares collections and places wholes in them by nesting and member-of', async () => {
        document.body.innerHTML = `
            <section data-ezclassify-collection="folderA">
                <input id="m1" type="hidden" data-ezclassify-marking value="A">
                <section data-ezclassify-collection="folderB"></section>
            </section>
            <input id="m2" type="hidden" data-ezclassify-marking data-ezclassify-member-of="folderB" value="B">
            <input id="m3" type="hidden" data-ezclassify-marking value="B">`;
        const registerCollection = vi.spyOn(
            BaseEzClassifyStore.prototype,
            'registerCollection',
        );
        const setMembership = vi.spyOn(
            BaseEzClassifyStore.prototype,
            'setMembership',
        );
        ui = new EzClassifyUI(createContext());
        await settle();
        expect(registerCollection).toHaveBeenCalledWith('folderA', null);
        expect(registerCollection).toHaveBeenCalledWith('folderB', 'folderA');
        expect(setMembership).toHaveBeenCalledWith('m1', 'folderA');
        expect(setMembership).toHaveBeenCalledWith('m2', 'folderB');
        expect(setMembership).toHaveBeenCalledWith('m3', null);
    });
});

describe('host errors', () => {
    it('leaves a marked field inside an ignore region unenhanced, says why, and holds the page incomplete', async () => {
        document.body.innerHTML = `
            <input id="a" type="hidden" data-ezclassify-marking value="A">
            <ul data-ezclassify-ignore>
                <li><input id="m" data-ezclassify-controller="marking" value="B"></li>
            </ul>`;
        const errors: CustomEvent[] = [];
        document.body.addEventListener('ezclassify:host-error', (e) =>
            errors.push(e as CustomEvent),
        );
        ui = new EzClassifyUI(createContext());
        await settle();
        const field = document.getElementById('m')!;
        expect(errors.map((e) => e.detail.code)).toEqual(['marked-in-ignore']);
        expect(errors[0].target).toBe(field);
        expect(ui.components.has(field)).toBe(false);
        expect(ui.isContributor(field)).toBe(false);
        expect(
            Array.from(ui.store.getAggregate().byBucket.values()).some(
                (bucket) => bucket.stale === true,
            ),
        ).toBe(true);
    });

    it('enhances the same field once the ignore region is lifted', async () => {
        ui = await mount(`
            <div id="region" data-ezclassify-ignore>
                <input id="m" data-ezclassify-controller="marking" value="B">
            </div>`);
        const field = document.getElementById('m')!;
        expect(ui.components.has(field)).toBe(false);

        document
            .getElementById('region')!
            .removeAttribute('data-ezclassify-ignore');
        await settle();
        await settle();
        expect(ui.components.has(field)).toBe(true);
        expect(ui.isContributor(field)).toBe(true);
        expect(
            Array.from(ui.store.getAggregate().byBucket.values()).some(
                (bucket) => bucket.stale === true,
            ),
        ).toBe(false);
    });

    it('refuses a nested instance mounted inside a whole container', async () => {
        ui = await mount(`
            <form data-ezclassify-whole="doc">
                <input id="doc" type="hidden" data-ezclassify-marking value="A">
                <div id="island"></div>
            </form>`);
        const errors: string[] = [];
        document.body.addEventListener('ezclassify:host-error', (e) =>
            errors.push((e as CustomEvent).detail.code),
        );
        const island = new EzClassifyUI(createContext(), {
            root: document.getElementById('island')!,
        });
        await settle();
        expect(errors).toEqual(['nested-root-in-whole']);
        island.destroy();
    });
});

describe('structural changes', () => {
    it('reads a host as a part once its container becomes a whole container', async () => {
        ui = await mount(`
            <form id="f">
                <input id="doc" type="hidden" data-ezclassify-marking value="A">
                <input id="p" type="hidden" data-ezclassify-marking value="B">
            </form>`);
        const part = document.getElementById('p')!;
        expect(ui.partOfMap.has(part)).toBe(false);

        document
            .getElementById('f')!
            .setAttribute('data-ezclassify-whole', 'doc');
        await settle();
        expect(ui.partOfMap.get(part)).toBe('doc');
        expect(ui.bindingNodeOf(part)?.kind).toBe('part');
    });
});
