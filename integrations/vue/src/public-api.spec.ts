/**
 * Public-API surface test: imports go through the package entry
 * (`@ezclassify/vue` → src/index.ts, same resolution the built package exposes)
 * rather than deep composable paths. Guards against exports silently falling
 * off the entry point, and pins the provision contract: one app-level
 * `provideEzClassify({ engine })` is enough for a descendant to run the forms
 * runtime and bind markings without restating the engine, and a per-call engine
 * argument overrides it for that subtree.
 */
import { describe, it, expect, vi } from 'vitest';
import {
    defineComponent,
    getCurrentInstance,
    h,
    inject,
    nextTick,
    ref,
    type WritableComputedRef,
} from 'vue';
import { mount } from '@vue/test-utils';
import { Context } from '@ezclassify/engine';
import type { SchemeEngineAdapter } from '@ezclassify/types';
import {
    provideEzClassify,
    useEzClassify,
    useEzClassifyFacet,
    useEzClassifyProvision,
    VueRefStore,
    VueRefStoreKey,
    type UseEzClassifyFacetReturn,
} from '@ezclassify/vue';

const testProfile = {
    scheme: {
        id: 'public-api-test',
        version: '1.0.0',
        name: 'Public API Test',
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
            concepts: {
                inline: [
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
        },
        parse: {
            case_sensitive: false,
            strip_whitespace: true,
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

function buildEngine(): SchemeEngineAdapter {
    return Context.fromComponents({ scheme: testProfile })
        .scheme as SchemeEngineAdapter;
}

describe('public API: provision surface', () => {
    it('exports the provision composables from the package entry', () => {
        expect(typeof provideEzClassify).toBe('function');
        expect(typeof useEzClassifyProvision).toBe('function');
        expect(typeof useEzClassify).toBe('function');
        expect(typeof useEzClassifyFacet).toBe('function');
    });

    it('takes a composed context and binds the store to its scheme surface', async () => {
        const context = Context.fromComponents({ scheme: testProfile });
        let store: VueRefStore | null = null;

        const Child = defineComponent({
            setup() {
                store = inject(VueRefStoreKey) ?? null;
                return () => h('div');
            },
        });
        const Root = defineComponent({
            setup() {
                provideEzClassify({ engine: context });
                return () => h(Child);
            },
        });
        mount(Root);
        await nextTick();

        expect(store).not.toBeNull();
        await store!.publishRendered('doc', 'A');
        expect(store!.get('doc').rendered).toBe('A');
    });

    it('gives a descendant a marking binding without any useEzClassify() call', async () => {
        const engine = buildEngine();
        let banner: WritableComputedRef<string> | null = null;

        const Child = defineComponent({
            setup() {
                banner = useEzClassify('doc');
                return () => h('div');
            },
        });
        const Root = defineComponent({
            setup() {
                provideEzClassify({ engine });
                return () => h(Child);
            },
        });
        mount(Root);
        await nextTick();

        expect(banner).not.toBeNull();
        expect(banner!.value).toBe('');
        banner!.value = 'A';
        await vi.waitFor(() => expect(banner!.value).toBe('A'));
    });

    it('gives a facet composable a store without any useEzClassify() call', async () => {
        const engine = buildEngine();
        let facet: UseEzClassifyFacetReturn | null = null;

        const Child = defineComponent({
            setup() {
                facet = useEzClassifyFacet('doc', 'f1');
                return () => h('div');
            },
        });
        const Root = defineComponent({
            setup() {
                provideEzClassify({ engine });
                return () => h(Child);
            },
        });
        mount(Root);
        await nextTick();

        await vi.waitFor(() =>
            expect(facet!.options.value.length).toBeGreaterThan(0),
        );
        facet!.setValue(['A']);
        await vi.waitFor(() => expect(facet!.value.value).toEqual(['A']));
    });

    it('lets a descendant run useEzClassify() with no engine argument', async () => {
        const engine = buildEngine();
        let store: VueRefStore | null = null;

        const Child = defineComponent({
            setup() {
                const root = document.createElement('div');
                const bound = useEzClassify(null, { root });
                return () => {
                    store = bound.store.value;
                    return h('div');
                };
            },
        });
        const Root = defineComponent({
            setup() {
                provideEzClassify({ engine });
                return () => h(Child);
            },
        });
        mount(Root);
        await nextTick();

        expect(store).toBeInstanceOf(VueRefStore);
        await store!.publishRendered('doc', 'A');
        expect(store!.get('doc').rendered).toBe('A');
    });

    it('binds the app-level store rather than building a second one over the same engine', async () => {
        const engine = buildEngine();
        const appStore = new VueRefStore(engine);
        let bound: VueRefStore | null = null;

        const Child = defineComponent({
            setup() {
                const root = document.createElement('div');
                const result = useEzClassify(null, { root });
                return () => {
                    bound = result.store.value;
                    return h('div');
                };
            },
        });
        const Root = defineComponent({
            setup() {
                provideEzClassify({ engine, store: appStore });
                return () => h(Child);
            },
        });
        const wrapper = mount(Root);
        await nextTick();

        expect(bound).toBe(appStore);
        // A store the app owns survives the composable that borrowed it.
        wrapper.unmount();
        await expect(
            appStore.publishRendered('doc', 'A'),
        ).resolves.toBeUndefined();
        appStore.destroy();
    });

    /**
     * A bootstrap component that fetches the engine and registers it app-wide
     * is inside a component scope while it does so, and it can be removed from
     * the tree afterwards. The store it registered belongs to the app, so it
     * has to outlive that scope; tearing it down there would leave every
     * binding below talking to a destroyed store.
     */
    it('keeps an app-provided store alive past the scope that registered it', async () => {
        const engine = buildEngine();
        let appStore: VueRefStore | undefined;

        const Bootstrap = defineComponent({
            setup() {
                const app = getCurrentInstance()!.appContext.app;
                provideEzClassify({ engine }, app);
                appStore = app.runWithContext(() => inject(VueRefStoreKey));
                return () => h('span');
            },
        });
        const Root = defineComponent({
            setup() {
                const registering = ref(true);
                return { registering };
            },
            render(this: { registering: boolean }) {
                return this.registering ? h(Bootstrap) : h('div');
            },
        });

        const wrapper = mount(Root);
        await nextTick();
        expect(appStore).toBeInstanceOf(VueRefStore);

        // The bootstrap component leaves the tree; the app it configured stays.
        (wrapper.vm as unknown as { registering: boolean }).registering = false;
        await nextTick();

        await expect(
            appStore!.publishRendered('doc', 'A'),
        ).resolves.toBeUndefined();
        expect(appStore!.get('doc').rendered).toBe('A');
        appStore!.destroy();
        wrapper.unmount();
    });

    it('treats a per-call engine as an override of the app-level default', async () => {
        const appEngine = buildEngine();
        const overrideEngine = buildEngine();
        const spy = vi.spyOn(overrideEngine, 'getSchemeMeta');
        let store: VueRefStore | null = null;

        const Child = defineComponent({
            setup() {
                const root = document.createElement('div');
                const bound = useEzClassify(overrideEngine, { root });
                return () => {
                    store = bound.store.value;
                    return h('div');
                };
            },
        });
        const Root = defineComponent({
            setup() {
                provideEzClassify({ engine: appEngine });
                return () => h(Child);
            },
        });
        mount(Root);
        await nextTick();

        expect(store).toBeInstanceOf(VueRefStore);
        // Scope routing reads the bound engine's metadata, so the override is
        // what actually backs the store.
        await store!.publishAssertions('doc', [
            {
                categoryId: 'f1',
                conceptId: 'A',
                confidence: 'certain',
                source: 'user',
            },
        ]);
        expect(spy).toHaveBeenCalled();
    });

    it('merges per-call options over the app-level options', async () => {
        const engine = buildEngine();
        const inherited = document.createElement('div');
        const overridden = document.createElement('div');

        function mountWith(
            root: HTMLElement,
            options: { rollupId?: string },
        ): void {
            const Child = defineComponent({
                setup() {
                    useEzClassify(engine, { root, ...options });
                    return () => h('div');
                },
            });
            const Root = defineComponent({
                setup() {
                    provideEzClassify({
                        engine,
                        options: { rollupId: 'app-rollup' },
                    });
                    return () => h(Child);
                },
            });
            mount(Root);
        }

        mountWith(inherited, {});
        mountWith(overridden, { rollupId: 'call-rollup' });
        await nextTick();

        // A key the call does not set keeps the app-level value; a key it does
        // set wins. The rollup sink is named after the option in force.
        expect(inherited.querySelector('#app-rollup')).not.toBeNull();
        expect(overridden.querySelector('#call-rollup')).not.toBeNull();
        expect(overridden.querySelector('#app-rollup')).toBeNull();
    });

    it('reads the app-level provision back through useEzClassifyProvision', () => {
        let seen: ReturnType<typeof useEzClassifyProvision>;

        const Child = defineComponent({
            setup() {
                seen = useEzClassifyProvision();
                return () => h('div');
            },
        });
        const Root = defineComponent({
            setup() {
                provideEzClassify({
                    engine: buildEngine(),
                    options: { format: 'default', rollupId: 'app-rollup' },
                });
                return () => h(Child);
            },
        });
        mount(Root);

        expect(seen?.options?.rollupId).toBe('app-rollup');
        expect(seen?.options?.format).toBe('default');
    });
});
