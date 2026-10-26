/**
 * A child's `useEzClassifyFacet` binds to the store `useEzClassify` provides
 * during setup, before the parent mounts. Mounting must keep that store for an
 * unchanged engine, or the child's facet is left subscribed to a destroyed
 * store: loading forever, with no options.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { defineComponent, h, nextTick, type ShallowRef } from 'vue';
import { mount, type VueWrapper } from '@vue/test-utils';
import { loadCedarValley } from '@ezclassify/example-schemes/cedar-valley';
import {
    useEzClassify,
    useEzClassifyFacet,
    type UseEzClassifyFacetReturn,
    type VueRefStore,
} from './index';

/** Flush the async component-init chain and the rollup debounce behind it. */
async function settle(): Promise<void> {
    for (let index = 0; index < 8; index++) {
        await new Promise<void>((tick) => setTimeout(tick, 25));
    }
    await nextTick();
}

let wrapper: VueWrapper | undefined;
let root: HTMLDivElement | undefined;

afterEach(() => {
    wrapper?.unmount();
    root?.remove();
    wrapper = undefined;
    root = undefined;
});

describe('useEzClassify with a facet in a child component', () => {
    it('keeps the setup-time store, so the child facet loads and a pick renders', async () => {
        root = document.createElement('div');
        document.body.appendChild(root);
        const mountRoot = root;
        let facet!: UseEzClassifyFacetReturn;
        let store!: ShallowRef<VueRefStore | null>;

        const Child = defineComponent({
            setup() {
                facet = useEzClassifyFacet('document-marking', 'handling');
                return () => h('div');
            },
        });
        const Parent = defineComponent({
            setup() {
                ({ store } = useEzClassify(loadCedarValley(), {
                    root: mountRoot,
                }));
                return () =>
                    h('div', [
                        h('input', {
                            'type': 'hidden',
                            'id': 'document-marking',
                            'value': 'INTERNAL',
                            'data-ezclassify-rendered': '',
                        }),
                        h(Child),
                    ]);
            },
        });

        wrapper = mount(Parent, { attachTo: mountRoot });
        const setupStore = store.value;
        await settle();

        expect(setupStore).not.toBeNull();
        expect(store.value).toBe(setupStore);
        expect(facet.loading.value).toBe(false);
        expect(facet.options.value.length).toBeGreaterThan(0);

        const pick = facet.options.value[0].conceptId;
        facet.setValue([pick]);
        await settle();

        expect(facet.value.value).toContain(pick);
        expect(facet.rendered.value.length).toBeGreaterThan(0);
    });
});
