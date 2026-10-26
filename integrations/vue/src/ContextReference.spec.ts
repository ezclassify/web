/**
 * Tests for the Vue ContextReference binding. Proves the component is a thin
 * map onto the controller's declarative attributes and CSS variables, and that
 * a default-slot custom tab renders the marker element the controller scans
 * for: the same shared mapper output the React and Angular bindings emit.
 */

import { describe, it, expect, afterEach } from 'vitest';
import {
    defineComponent,
    h,
    nextTick,
    ref,
    type Ref,
    type VNodeChild,
} from 'vue';
import { mount, type VueWrapper } from '@vue/test-utils';
import yaml from 'js-yaml';
import { Context } from '@ezclassify/engine';
import {
    cedarValleySchemeYaml,
    cedarValleyGuideYaml,
    cedarValleyAccessYaml,
} from '@ezclassify/example-schemes/cedar-valley';
import { useEzClassify } from './index';
import { ContextReference, ContextReferenceTab } from './ContextReference';

if (typeof window !== 'undefined' && !window.matchMedia) {
    Object.defineProperty(window, 'matchMedia', {
        writable: true,
        value: () => ({
            matches: false,
            addListener: () => {},
            removeListener: () => {},
        }),
    });
}

describe('Vue <ContextReference>', () => {
    it('maps presentation props onto the controller attributes and CSS vars', () => {
        const wrapper = mount(ContextReference, {
            props: {
                placement: 'left',
                size: '24rem',
                open: true,
                tabs: ['handbook', 'access'],
                offset: { top: '60px' },
            },
        });
        const host = wrapper.element as HTMLElement;
        expect(host.getAttribute('data-ezclassify-controller')).toBe(
            'context-reference',
        );
        expect(
            host.getAttribute('data-ezclassify-context-reference-placement'),
        ).toBe('left');
        expect(
            host.getAttribute('data-ezclassify-context-reference-size'),
        ).toBe('24rem');
        expect(
            host.hasAttribute('data-ezclassify-context-reference-open'),
        ).toBe(true);
        expect(
            host.getAttribute('data-ezclassify-context-reference-tabs'),
        ).toBe('handbook,access');
        expect(host.style.getPropertyValue('--ez-context-ref-offset-top')).toBe(
            '60px',
        );
    });

    it('renders a default-slot custom tab as the marker element', () => {
        const wrapper = mount(ContextReference, {
            slots: {
                default: () =>
                    h(
                        ContextReferenceTab,
                        { id: 'developers', label: 'Developers' },
                        { default: () => h('p', 'dev panel') },
                    ),
            },
        });
        const tab = wrapper.element.querySelector('[data-ezclassify-tab]');
        expect(tab).toBeTruthy();
        expect(tab?.getAttribute('data-ezclassify-tab-id')).toBe('developers');
        expect(tab?.getAttribute('data-ezclassify-tab-label')).toBe(
            'Developers',
        );
        expect(tab?.textContent).toContain('dev panel');
    });
});

/**
 * The controller must never reparent a slot-rendered custom-tab node out of
 * Vue's control. These drive the real Vue renderer through the scanner:
 * enhancement happens, then Vue mutates its slotted children.
 */
describe('Vue <ContextReference> reactive lifecycle', () => {
    let wrapper: VueWrapper | null = null;
    let root: HTMLDivElement | null = null;
    let showDev: Ref<boolean>;
    let showOps: Ref<boolean>;
    let swap: Ref<boolean>;
    let label: Ref<string>;

    afterEach(() => {
        wrapper?.unmount();
        wrapper = null;
        root?.remove();
        root = null;
    });

    function fullContext(): Context {
        return Context.fromComponents({
            scheme: yaml.load(cedarValleySchemeYaml),
            guides: [yaml.load(cedarValleyGuideYaml)],
            access: yaml.load(cedarValleyAccessYaml),
        });
    }

    function mountDrawer(): HTMLDivElement {
        root = document.createElement('div');
        document.body.appendChild(root);
        const localRoot = root;
        const engine = fullContext();
        const App = defineComponent({
            setup() {
                showDev = ref(true);
                showOps = ref(false);
                swap = ref(false);
                label = ref('dev content');
                useEzClassify(engine, { root: localRoot });
                return () => {
                    const dev = showDev.value
                        ? h(
                              ContextReferenceTab,
                              {
                                  key: 'dev',
                                  id: 'developers',
                                  label: 'Developers',
                              },
                              { default: () => h('p', label.value) },
                          )
                        : null;
                    const ops = showOps.value
                        ? h(
                              ContextReferenceTab,
                              { key: 'ops', id: 'ops', label: 'Ops' },
                              { default: () => h('p', 'ops content') },
                          )
                        : null;
                    const kids: VNodeChild[] = swap.value
                        ? [ops, dev]
                        : [dev, ops];
                    return h(
                        ContextReference,
                        { open: true },
                        { default: () => kids },
                    );
                };
            },
        });
        wrapper = mount(App, { attachTo: localRoot });
        return localRoot;
    }

    const flush = async () => {
        await nextTick();
        for (let i = 0; i < 4; i++) {
            await new Promise<void>((r) => setTimeout(r, 20));
        }
    };

    const ids = (c: HTMLElement) =>
        Array.from(
            c.querySelectorAll<HTMLButtonElement>('.ez-context-ref__tab'),
        ).map((t) => t.dataset.tabId);

    it('enhances a slotted custom tab into a tab projected in place', async () => {
        const r = mountDrawer();
        await flush();
        expect(ids(r)).toEqual([
            'handbook',
            'guidebook',
            'access',
            'developers',
        ]);
        const custom = r.querySelector('[data-ezclassify-tab]') as HTMLElement;
        // Never reparented: the node stays a direct child of the drawer host.
        expect(custom.parentElement?.classList.contains('ez-context-ref')).toBe(
            true,
        );
        expect(custom.getAttribute('role')).toBe('tabpanel');
    });

    it('removes a custom tab on a reactive removal without throwing', async () => {
        const r = mountDrawer();
        await flush();
        expect(ids(r)).toContain('developers');
        expect(() => {
            showDev.value = false;
        }).not.toThrow();
        await flush();
        expect(ids(r)).not.toContain('developers');
    });

    it('adds a custom tab on a reactive addition', async () => {
        const r = mountDrawer();
        await flush();
        showOps.value = true;
        await flush();
        expect(ids(r)).toContain('ops');
    });

    it('reorders custom tabs on a reactive reorder', async () => {
        const r = mountDrawer();
        showOps.value = true;
        await flush();
        expect(ids(r)).toEqual([
            'handbook',
            'guidebook',
            'access',
            'developers',
            'ops',
        ]);
        swap.value = true;
        await flush();
        expect(ids(r)).toEqual([
            'handbook',
            'guidebook',
            'access',
            'ops',
            'developers',
        ]);
    });

    it('updates custom panel content in place', async () => {
        const r = mountDrawer();
        await flush();
        label.value = 'updated content';
        await flush();
        expect(
            r.querySelector('#ez-context-ref-panel-developers')?.textContent,
        ).toContain('updated content');
    });

    it('unmounts without throwing', async () => {
        mountDrawer();
        await flush();
        expect(() => wrapper?.unmount()).not.toThrow();
    });
});
