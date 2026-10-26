/**
 * `useEzClassifyFacet` is a projection of the store's cells, not a mirror of
 * them. These pin both halves of that: the controlled-field contract a Vue
 * select consumes, and the fact that a publish made straight against the store
 * moves the returned refs without anything routing through the composable. They
 * also pin that a pick made before a runtime has seeded the store survives that
 * seed, wherever the picker sits relative to the runtime.
 */
import { describe, it, expect, vi } from 'vitest';
import { defineComponent, h, nextTick, shallowRef } from 'vue';
import { mount } from '@vue/test-utils';
import { loadCedarValley } from '@ezclassify/example-schemes/cedar-valley';
import { VueRefStore, VueRefStoreKey } from './vue-ref-store';
import { useEzClassify } from '../index';
import { provideEzClassify } from './provide-ezclassify';
import {
    useEzClassifyFacet,
    type UseEzClassifyFacetReturn,
} from './useEzClassifyFacet';

async function flush(): Promise<void> {
    for (let i = 0; i < 8; i++) await Promise.resolve();
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
        const store = new VueRefStore(loadCedarValley());
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
        const suggest = vi.spyOn(store['engine']!, 'suggestForCategories');
        await store.publishRendered('document', 'INTERNAL');
        expect(suggest).not.toHaveBeenCalled();
        store.destroy();
    });

    it('exposes controlled value, options, validation, and updates', async () => {
        const store = new VueRefStore(loadCedarValley());
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
        const store = new VueRefStore(loadCedarValley());
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
        expect(() => mount(Child)).toThrow(/provideEzClassify|useEzClassify/);
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
function mountForm(served: string, pickInSetup = false) {
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
            useEzClassify(loadCedarValley(), { root });
            return () =>
                h('div', [
                    h('input', {
                        'type': 'hidden',
                        'id': 'doc-marking',
                        'data-ezclassify-rendered': '',
                        'value': served,
                    }),
                    h(Picker),
                ]);
        },
    });
    const ready = runtimeReady(root);
    const wrapper = mount(Form, { attachTo: root });
    return {
        ready,
        facet: () => facet,
        unmount: () => {
            wrapper.unmount();
            root.remove();
        },
    };
}

describe('useEzClassifyFacet before the runtime has mounted', () => {
    it('keeps a pick over the value the host was served with, on top of it', async () => {
        const form = mountForm('INTERNAL//DO NOT FORWARD');
        form.facet().setValue(['CONFIDENTIAL']);
        await settleRuntime(form.ready);

        expect(form.facet().value.value).toEqual(['CONFIDENTIAL']);
        expect(form.facet().rendered.value).toBe(
            'CONFIDENTIAL//DO NOT FORWARD',
        );
        form.unmount();
    });

    it('keeps a pick made during setup, before the runtime exists', async () => {
        const form = mountForm('INTERNAL', true);
        await settleRuntime(form.ready);

        expect(form.facet().value.value).toEqual(['CONFIDENTIAL']);
        form.unmount();
    });

    it('keeps a pick from a picker beside the runtime that shares the app store', async () => {
        // A picker in a toolbar and the form the runtime scans further down:
        // siblings under one provideEzClassify, so the picker is not inside
        // the subtree of the useEzClassify() that mounts the runtime.
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
                useEzClassify(undefined, { root });
                return () =>
                    h('input', {
                        'type': 'hidden',
                        'id': 'doc-marking',
                        'data-ezclassify-rendered': '',
                        'value': 'INTERNAL//DO NOT FORWARD',
                    });
            },
        });
        const App = defineComponent({
            setup() {
                provideEzClassify({ engine: loadCedarValley() });
                return () => h('div', [h(Picker), h(Form)]);
            },
        });
        const ready = runtimeReady(root);
        const wrapper = mount(App, { attachTo: root });
        facet.setValue(['CONFIDENTIAL']);
        await settleRuntime(ready);

        expect(facet.value.value).toEqual(['CONFIDENTIAL']);
        expect(facet.rendered.value).toBe('CONFIDENTIAL//DO NOT FORWARD');
        wrapper.unmount();
        root.remove();
    });
});

describe('useEzClassifyFacet when its runtime is re-created over the same hosts', () => {
    it('keeps a pick made under the first runtime', async () => {
        // The hosts live outside the component that mounts the runtime, so the
        // second runtime seeds the same hosts from the same store.
        const root = document.createElement('div');
        const host = document.createElement('input');
        host.type = 'hidden';
        host.id = 'doc-marking';
        host.setAttribute('data-ezclassify-rendered', '');
        host.value = 'INTERNAL//DO NOT FORWARD';
        const mountPoint = document.createElement('div');
        root.append(host, mountPoint);
        document.body.appendChild(root);
        const showRuntime = shallowRef(true);
        let facet!: UseEzClassifyFacetReturn;
        const Picker = defineComponent({
            setup() {
                facet = useEzClassifyFacet('doc-marking', 'level');
                return () => h('div');
            },
        });
        const Runtime = defineComponent({
            setup() {
                useEzClassify(undefined, { root });
                return () => h('div');
            },
        });
        const App = defineComponent({
            setup() {
                provideEzClassify({ engine: loadCedarValley() });
                return () =>
                    h('div', [
                        h(Picker),
                        showRuntime.value ? h(Runtime) : null,
                    ]);
            },
        });
        const firstReady = runtimeReady(root);
        const wrapper = mount(App, { attachTo: mountPoint });
        await settleRuntime(firstReady);
        facet.setValue(['CONFIDENTIAL']);
        await settleRuntime(Promise.resolve());
        expect(facet.rendered.value).toBe('CONFIDENTIAL//DO NOT FORWARD');

        showRuntime.value = false;
        await nextTick();
        const secondReady = runtimeReady(root);
        showRuntime.value = true;
        await nextTick();
        await settleRuntime(secondReady);

        expect(facet.value.value).toEqual(['CONFIDENTIAL']);
        expect(facet.rendered.value).toBe('CONFIDENTIAL//DO NOT FORWARD');
        wrapper.unmount();
        root.remove();
    });
});
