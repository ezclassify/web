/**
 * Public-API surface test: imports go through the package entry
 * (`@ezclassify/vue` → src/index.ts, the same resolution the built package
 * exposes). Pins the initialization contract: `createEzClassify({ context })`
 * once, then an `<EzClassify>` root whose store every component inside it binds
 * through, with a root owning its store unless the host passes one.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
    defineComponent,
    h,
    inject,
    nextTick,
    resolveComponent,
    shallowRef,
    type Component,
    type WritableComputedRef,
} from 'vue';
import { mount, type VueWrapper } from '@vue/test-utils';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bucketKey } from '@ezclassify/ui';
import type { EzClassifyClient } from '@ezclassify/rest-client';
import {
    createEzClassify,
    EzClassify,
    useEzClassify,
    useEzClassifyFacet,
    useEzClassifyState,
    useEzClassifyUI,
    VueRefStore,
    VueRefStoreKey,
    type EzClassifyProvision,
    type UseEzClassifyFacetReturn,
} from '@ezclassify/vue';
import * as entry from '@ezclassify/vue';
import { openContext } from '../../../libs/ui/test-fixtures/context-doubles';
import { connectDemoContext } from '../../../test-support/demo-runtime';

const testProfile = {
    scheme: {
        id: 'public-api-test',
        version: '1.0.0',
        name: 'Public API Test',
        description: 'Public API Test test fixture.',
        data: {
            categories: [
                {
                    id: 'f1',
                    label: 'F1',
                    required: false,
                    single: false,
                    rollup: 'union',
                },
            ],
            concepts: [
                {
                    id: 'A',
                    name: 'A',
                    views: { default: 'A' },
                    categories: ['f1'],
                    position: 0,
                    aliases: [],
                    parents: [],
                },
            ],
        },
        render: {
            default: 'default',
            formats: [
                {
                    id: 'default',
                    surface: 'marking',
                    mode: 'inline',
                    separator: '/',
                    fields: [{ category: 'f1' }],
                },
            ],
        },
        rules: [],
        rollup_pipelines: [],
    },
};

async function buildContext(): Promise<EzClassifyClient> {
    return await connectDemoContext({ draft: { scheme: testProfile } });
}

let wrapper: VueWrapper | null = null;

afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
    document.body.innerHTML = '';
});

/** Mount `child` inside one `<EzClassify>` root of an app using the plugin. */
async function mountInRoot(
    child: Component,
    given?: EzClassifyProvision,
    rootProps: Record<string, unknown> = {},
): Promise<VueWrapper> {
    const options = given ?? { context: await buildContext() };
    const App = defineComponent({
        setup() {
            return () => h(EzClassify, rootProps, { default: () => h(child) });
        },
    });
    wrapper = mount(App, {
        attachTo: document.body,
        global: { plugins: [createEzClassify(options)] },
    });
    return wrapper;
}

describe('public API: entry points', () => {
    it('exports the plugin, the root component and the binding composables', () => {
        expect(typeof createEzClassify).toBe('function');
        expect(typeof EzClassify).toBe('object');
        expect(typeof useEzClassify).toBe('function');
        expect(typeof useEzClassifyState).toBe('function');
        expect(typeof useEzClassifyFacet).toBe('function');
    });

    it('exports no initialization path beside the plugin and the root', () => {
        expect(Object.keys(entry)).not.toContain('provideEzClassify');
        expect(Object.keys(entry)).not.toContain('useEzClassifyProvision');
    });
});

describe('createEzClassify', () => {
    it('refuses options naming neither one Context nor several', () => {
        expect(() =>
            createEzClassify({} as unknown as EzClassifyProvision),
        ).toThrow(/exactly one of \{ context \} or \{ contexts \}/);
    });

    it('refuses options naming both one Context and several', async () => {
        const context = await buildContext();
        expect(() =>
            createEzClassify({
                context,
                contexts: { main: context },
            } as unknown as EzClassifyProvision),
        ).toThrow(/exactly one of/);
    });

    it('refuses an empty Context map', () => {
        expect(() => createEzClassify({ contexts: {} })).toThrow(
            /at least one Context/,
        );
    });

    it('registers <EzClassify> globally, so a template can use it unimported', async () => {
        let state: ReturnType<typeof useEzClassifyState> | null = null;
        const Child = defineComponent({
            setup() {
                state = useEzClassifyState('doc');
                return () => h('div');
            },
        });
        const App = defineComponent({
            setup() {
                return () =>
                    h(resolveComponent('EzClassify') as Component, null, {
                        default: () => h(Child),
                    });
            },
        });
        wrapper = mount(App, {
            attachTo: document.body,
            global: {
                plugins: [createEzClassify({ context: await buildContext() })],
            },
        });
        await nextTick();

        expect(state).not.toBeNull();
        expect(state!.value.rendered).toBe('');
    });
});

describe('<EzClassify>', () => {
    it('refuses to mount without the plugin', () => {
        const App = defineComponent({
            setup: () => () => h(EzClassify),
        });
        expect(() => mount(App)).toThrow(/createEzClassify/);
    });

    it('renders a plain wrapper with no role and runs the scanner over it', async () => {
        const host = await mountInRoot(
            defineComponent({ setup: () => () => h('form') }),
        );
        await nextTick();

        const root = host.element as HTMLElement;
        expect(root.tagName).toBe('DIV');
        expect(root.getAttribute('role')).toBeNull();
        expect(root.hasAttribute('data-ezclassify-mount-root')).toBe(true);
        expect(root.querySelector('form')).not.toBeNull();
    });

    it('gives a descendant a two-way marking binding through its store', async () => {
        let marking: WritableComputedRef<string> | null = null;
        await mountInRoot(
            defineComponent({
                setup() {
                    marking = useEzClassify('doc');
                    return () => h('div');
                },
            }),
        );
        await nextTick();

        expect(marking!.value).toBe('');
        marking!.value = 'A';
        await vi.waitFor(() => expect(marking!.value).toBe('A'));
    });

    it('gives a facet composable the root store', async () => {
        let facet: UseEzClassifyFacetReturn | null = null;
        await mountInRoot(
            defineComponent({
                setup() {
                    facet = useEzClassifyFacet('doc', 'f1');
                    return () => h('div');
                },
            }),
        );
        await nextTick();

        await vi.waitFor(() =>
            expect(facet!.options.value.length).toBeGreaterThan(0),
        );
        facet!.setValue(['A']);
        await vi.waitFor(() => expect(facet!.value.value).toEqual(['A']));
    });

    it('gives a descendant its runtime, which marks up an element the page did not', async () => {
        let ui: ReturnType<typeof useEzClassifyUI> | null = null;
        await mountInRoot(
            defineComponent({
                setup() {
                    ui = useEzClassifyUI();
                    return () => h('input', { id: 'title', value: 'A' });
                },
            }),
        );
        await nextTick();
        const runtime = ui!.value!;
        expect(runtime.root).toBe(wrapper!.element);

        const title = document.getElementById('title') as HTMLInputElement;
        runtime.add(title, 'marking');

        expect(runtime.components.has(title)).toBe(true);
        await vi.waitFor(() =>
            expect(runtime.store.get('title').rendered).toBe('A'),
        );
        runtime.remove(title);
        expect(title.hasAttribute('data-ezclassify-controller')).toBe(false);

        wrapper!.unmount();
        wrapper = null;
        expect(ui!.value).toBeNull();
    });

    it('refuses useEzClassifyUI outside a root', () => {
        const App = defineComponent({
            setup() {
                useEzClassifyUI();
                return () => h('div');
            },
        });
        expect(() => mount(App)).toThrow(/inside an <EzClassify> root/);
    });

    it('builds its own store over the Context scheme and destroys it on unmount', async () => {
        const spied = openContext(await buildContext());
        const meta = vi.spyOn(spied.scheme, 'getSchemeMeta');
        let store: VueRefStore | null = null;
        const host = await mountInRoot(
            defineComponent({
                setup() {
                    store = useInjectedStore();
                    return () => h('div');
                },
            }),
            { context: spied },
        );
        await nextTick();

        expect(store).toBeInstanceOf(VueRefStore);
        expect(meta).toHaveBeenCalled();
        host.unmount();
        wrapper = null;
        await expect(store!.publishRendered('doc', 'A')).rejects.toThrow(
            /destroyed/,
        );
    });

    it("marks a field in one Context's second scheme, in its own bucket", async () => {
        const fixtures = resolve(
            dirname(fileURLToPath(import.meta.url)),
            '../../../vendor/spec/fixtures/v1',
        );
        const read = (name: string): unknown =>
            JSON.parse(readFileSync(resolve(fixtures, `${name}.json`), 'utf8'));
        const context = await connectDemoContext({
            draft: {
                schemes: [
                    { key: 'first', scheme: read('ref-scheme-1') },
                    { key: 'second', scheme: read('ref-scheme-2') },
                ],
                primaryScheme: 'first',
            },
        });
        let store: VueRefStore | null = null;
        await mountInRoot(
            defineComponent({
                setup() {
                    store = useInjectedStore();
                    return () =>
                        h('div', [
                            h('input', {
                                'id': 'memo',
                                'data-ezclassify-marking': '',
                                'value': 'HIGH',
                            }),
                            h('div', { 'data-ezclassify-scheme': 'second' }, [
                                h('input', {
                                    'id': 'note',
                                    'data-ezclassify-marking': '',
                                    'value': 'LOW//ALPHA',
                                }),
                            ]),
                        ]);
                },
            }),
            { context },
        );

        await vi.waitFor(() =>
            expect(store!.get('note').rendered).toBe('LOW//ALPHA'),
        );
        expect(store!.get('memo').rendered).toBe('HIGH');
        const buckets = store!.getAggregate().byBucket;
        expect([...buckets.keys()].sort()).toEqual(
            [bucketKey('', ''), bucketKey('', 'second')].sort(),
        );
    });

    it('binds a store the host passes and leaves it alive after unmount', async () => {
        const appStore = new VueRefStore((await buildContext()).scheme);
        let bound: VueRefStore | null = null;
        const host = await mountInRoot(
            defineComponent({
                setup() {
                    bound = useInjectedStore();
                    return () => h('div');
                },
            }),
            { context: await buildContext() },
            { store: appStore },
        );
        await nextTick();

        expect(bound).toBe(appStore);
        host.unmount();
        wrapper = null;
        await expect(
            appStore.publishRendered('doc', 'A'),
        ).resolves.toBeUndefined();
        expect(appStore.get('doc').rendered).toBe('A');
        appStore.destroy();
    });

    it('gives each root its own store, so two documents do not share state', async () => {
        const stores: VueRefStore[] = [];
        const Probe = defineComponent({
            setup() {
                stores.push(useInjectedStore());
                return () => h('div');
            },
        });
        const App = defineComponent({
            setup: () => () =>
                h('div', [
                    h(EzClassify, null, { default: () => h(Probe) }),
                    h(EzClassify, null, { default: () => h(Probe) }),
                ]),
        });
        wrapper = mount(App, {
            attachTo: document.body,
            global: {
                plugins: [createEzClassify({ context: await buildContext() })],
            },
        });
        await nextTick();

        expect(stores).toHaveLength(2);
        expect(stores[0]).not.toBe(stores[1]);
    });

    it('stops scanning when it leaves the tree', async () => {
        const show = shallowRef(true);
        const App = defineComponent({
            setup: () => () =>
                show.value
                    ? h(EzClassify, null, { default: () => h('form') })
                    : h('p'),
        });
        wrapper = mount(App, {
            attachTo: document.body,
            global: {
                plugins: [createEzClassify({ context: await buildContext() })],
            },
        });
        await nextTick();
        expect(
            document.body.querySelector('[data-ezclassify-mount-root]'),
        ).not.toBeNull();

        show.value = false;
        await nextTick();
        expect(
            document.body.querySelector('[data-ezclassify-mount-root]'),
        ).toBeNull();
    });
});

/** The store the nearest root provides, read through the exported key. */
function useInjectedStore(): VueRefStore {
    const store = inject(VueRefStoreKey);
    if (!store) throw new Error('no store in scope');
    return store;
}
