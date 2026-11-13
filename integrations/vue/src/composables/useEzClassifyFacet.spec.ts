/**
 * `useEzClassifyFacet` is a projection of the store's cells, not a mirror of
 * them. These pin both halves of that: the controlled-field contract a Vue
 * select consumes, and the fact that a publish made straight against the store
 * moves the returned refs without anything routing through the composable. They
 * also pin that a pick made before a runtime has seeded the store survives that
 * seed, wherever the picker sits inside the root.
 */
import { describe, it, expect, vi } from 'vitest';
import { defineComponent, h, nextTick } from 'vue';
import { mount } from '@vue/test-utils';
import { VueRefStore, VueRefStoreKey } from './vue-ref-store';
import { createEzClassify, EzClassify } from '../index';
import {
    useEzClassifyFacet,
    type UseEzClassifyFacetReturn,
} from './useEzClassifyFacet';
import { openOperations } from '../../../../libs/ui/test-fixtures/context-doubles';
import {
    connectDemoContext,
    demoRuntimeSettled,
} from '../../../../test-support/demo-runtime';

async function flush(): Promise<void> {
    await demoRuntimeSettled();
    await nextTick();
}

function mountFacet(store: VueRefStore): {
    facet: UseEzClassifyFacetReturn;
    unmount: () => void;
} {
    let facet!: UseEzClassifyFacetReturn;
    const Child = defineComponent({
        setup() {
            facet = useEzClassifyFacet('document', 'level');
            return () => h('div');
        },
    });
    const Parent = defineComponent({
        setup() {
            return () => h(Child);
        },
    });
    const wrapper = mount(Parent, {
        global: { provide: { [VueRefStoreKey as symbol]: store } },
    });
    return { facet, unmount: () => wrapper.unmount() };
}

describe('useEzClassifyFacet', () => {
    it('retains only facet liveness and releases it without marking snapshots', async () => {
        const engine = openOperations(
            (await connectDemoContext({ contextId: 'cedar-valley' })).scheme,
        );
        const store = new VueRefStore(engine);
        const marking = vi.spyOn(store, 'subscribe');
        const facetSubscription = vi.spyOn(store, 'subscribeFacet');
        const read = vi.spyOn(store, 'get');
        const { facet, unmount } = mountFacet(store);
        await flush();
        expect(facet.loading.value).toBe(false);
        expect(facetSubscription).toHaveBeenCalledTimes(1);
        expect(marking).not.toHaveBeenCalled();
        read.mockClear();
        facetSubscription.mock.calls[0][2](store.getFacet('document', 'level'));
        expect(read).not.toHaveBeenCalled();
        unmount();
        const suggest = vi.spyOn(engine, 'suggestForCategories');
        await store.publishRendered('document', 'INTERNAL');
        expect(suggest).not.toHaveBeenCalled();
        store.destroy();
    });

    it('exposes controlled value, options, validation, and updates', async () => {
        const store = new VueRefStore(
            (await connectDemoContext({ contextId: 'cedar-valley' })).scheme,
        );
        await store.publishRendered('document', 'INTERNAL');
        const { facet, unmount } = mountFacet(store);
        await flush();

        expect(facet.options.value.length).toBeGreaterThan(0);
        expect(facet.value.value).toContain('INTERNAL');
        expect(facet.loading.value).toBe(false);

        facet.setValue(['CONFIDENTIAL']);
        await flush();
        expect(facet.value.value).toEqual(['CONFIDENTIAL']);
        expect(facet.rendered.value).toContain('CONFIDENTIAL');

        unmount();
        store.destroy();
    });

    it('projects the store cells rather than holding a copy of them', async () => {
        const store = new VueRefStore(
            (await connectDemoContext({ contextId: 'cedar-valley' })).scheme,
        );
        const { facet, unmount } = mountFacet(store);
        await flush();

        await store.publishRendered('document', 'INTERNAL');
        await flush();

        expect(facet.value.value).toEqual(['INTERNAL']);
        expect(facet.options.value).toEqual(
            store.getFacet('document', 'level').allowableOptions,
        );
        expect(facet.rendered.value).toBe(store.get('document').rendered);

        unmount();
        store.destroy();
    });

    it('refuses to run without a store in scope', () => {
        const Child = defineComponent({
            setup() {
                useEzClassifyFacet('document', 'level');
                return () => h('div');
            },
        });
        expect(() => mount(Child)).toThrow(/inside an <EzClassify> root/);
    });
});

/** Resolves once the runtime mounted on `root` has seeded the store. */
function runtimeReady(root: HTMLElement): Promise<void> {
    return new Promise((resolve) =>
        root.addEventListener('ezclassify:ready', () => resolve(), {
            once: true,
        }),
    );
}

/**
 * Wait for the runtime's seed, then let the edits that land on top of it
 * finish. The in-process engine answers synchronously, so one macrotask drains
 * them.
 */
async function settleRuntime(ready: Promise<void>): Promise<void> {
    await ready;
    await new Promise<void>((tick) => setTimeout(tick, 0));
    await nextTick();
}

/**
 * A form whose runtime mounts over a marking host served with `served`, and a
 * facet picker below it. `pickInSetup` makes the pick before the runtime has
 * even been created; otherwise the test picks right after mount, while the
 * runtime is still initializing its fields.
 */
async function mountForm(served: string, pickInSetup = false) {
    const root = document.createElement('div');
    document.body.appendChild(root);
    let facet!: UseEzClassifyFacetReturn;
    const Picker = defineComponent({
        setup() {
            facet = useEzClassifyFacet('doc-marking', 'level');
            if (pickInSetup) facet.setValue(['CONFIDENTIAL']);
            return () => h('div');
        },
    });
    const Form = defineComponent({
        setup() {
            return () =>
                h(EzClassify, null, () => [
                    h('input', {
                        'type': 'hidden',
                        'id': 'doc-marking',
                        'data-ezclassify-marking': '',
                        'value': served,
                    }),
                    h(Picker),
                ]);
        },
    });
    const ready = runtimeReady(root);
    const wrapper = mount(Form, await withPlugin(root));
    return {
        ready,
        facet: () => facet,
        unmount: () => {
            wrapper.unmount();
            root.remove();
        },
    };
}

/** Mount options: attached under `root`, with the plugin installed. */
async function withPlugin(root: HTMLElement) {
    return {
        attachTo: root,
        global: {
            plugins: [
                createEzClassify({
                    context: await connectDemoContext({
                        contextId: 'cedar-valley',
                    }),
                }),
            ],
        },
    };
}

describe('useEzClassifyFacet before the runtime has mounted', () => {
    it('keeps a pick over the value the host was served with, on top of it', async () => {
        const form = await mountForm('INTERNAL//DO NOT FORWARD');
        form.facet().setValue(['CONFIDENTIAL']);
        await settleRuntime(form.ready);

        expect(form.facet().value.value).toEqual(['CONFIDENTIAL']);
        expect(form.facet().rendered.value).toBe(
            'CONFIDENTIAL//DO NOT FORWARD',
        );
        form.unmount();
    });

    it('keeps a pick made during setup, before the runtime exists', async () => {
        const form = await mountForm('INTERNAL', true);
        await settleRuntime(form.ready);

        expect(form.facet().value.value).toEqual(['CONFIDENTIAL']);
        form.unmount();
    });

    it('keeps a pick from a picker in a toolbar beside the form, under one root', async () => {
        // A picker in a toolbar and the form further down: siblings, not
        // parent and child, sharing state because one root holds both.
        const root = document.createElement('div');
        document.body.appendChild(root);
        let facet!: UseEzClassifyFacetReturn;
        const Picker = defineComponent({
            setup() {
                facet = useEzClassifyFacet('doc-marking', 'level');
                return () => h('div');
            },
        });
        const Form = defineComponent({
            setup() {
                return () =>
                    h('form', [
                        h('input', {
                            'type': 'hidden',
                            'id': 'doc-marking',
                            'data-ezclassify-marking': '',
                            'value': 'INTERNAL//DO NOT FORWARD',
                        }),
                    ]);
            },
        });
        const App = defineComponent({
            setup() {
                return () => h(EzClassify, null, () => [h(Picker), h(Form)]);
            },
        });
        const ready = runtimeReady(root);
        const wrapper = mount(App, await withPlugin(root));
        facet.setValue(['CONFIDENTIAL']);
        await settleRuntime(ready);

        expect(facet.value.value).toEqual(['CONFIDENTIAL']);
        expect(facet.rendered.value).toBe('CONFIDENTIAL//DO NOT FORWARD');
        wrapper.unmount();
        root.remove();
    });
});
