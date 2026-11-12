/**
 * A child's `useEzClassifyFacet` binds to the store its `<EzClassify>` root
 * provides during setup, before the root mounts its scanner. The scanner must
 * seed that same store, or the child's facet is left on a store nothing drives:
 * loading forever, with no options.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { defineComponent, h, inject, nextTick } from 'vue';
import { mount, type VueWrapper } from '@vue/test-utils';
import { loadCedarValleyContext } from '../../../test-support/community-content';
import {
    createEzClassify,
    EzClassify,
    useEzClassifyFacet,
    VueRefStoreKey,
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

describe('<EzClassify> with a facet in a child component', () => {
    it('drives the setup-time store, so the child facet loads and a pick renders', async () => {
        root = document.createElement('div');
        document.body.appendChild(root);
        const mountRoot = root;
        let facet!: UseEzClassifyFacetReturn;
        let setupStore: VueRefStore | undefined;

        const Child = defineComponent({
            setup() {
                setupStore = inject(VueRefStoreKey);
                facet = useEzClassifyFacet('document-marking', 'handling');
                return () => h('div');
            },
        });
        const App = defineComponent({
            setup() {
                return () =>
                    h(EzClassify, null, {
                        default: () => [
                            h('input', {
                                'type': 'hidden',
                                'id': 'document-marking',
                                'value': 'INTERNAL',
                                'data-ezclassify-marking': '',
                            }),
                            h(Child),
                        ],
                    });
            },
        });

        wrapper = mount(App, {
            attachTo: mountRoot,
            global: {
                plugins: [
                    createEzClassify({ context: loadCedarValleyContext() }),
                ],
            },
        });
        await settle();

        expect(setupStore).toBeDefined();
        expect(facet.loading.value).toBe(false);
        expect(facet.options.value.length).toBeGreaterThan(0);

        const pick = facet.options.value[0].conceptId;
        facet.setValue([pick]);
        await settle();

        expect(facet.value.value).toContain(pick);
        expect(facet.rendered.value.length).toBeGreaterThan(0);
    });
});
