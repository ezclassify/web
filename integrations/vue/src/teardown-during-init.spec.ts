/**
 * The Vue half of the shared teardown-during-init contract.
 *
 * `libs/ui/src/teardown-during-init.spec.ts` pins the rule at the seam where it
 * is implemented: an `EzClassifyUI` destroyed while its fields are still
 * initializing reaches no store afterwards. This file proves Vue's own teardown
 * lands in that window, because `useEzClassify` builds the instance and the
 * store together and `releaseStore` destroys both on unmount. A component
 * removed by a `v-if` or a route change before its fields settle is the
 * ordinary case.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { defineComponent, h, nextTick } from 'vue';
import { mount } from '@vue/test-utils';
import { loadCedarValley } from '@ezclassify/example-schemes/cedar-valley';
import { useEzClassify } from './index';

/** Flush the async component-init chain and the rollup debounce behind it. */
async function settle(): Promise<void> {
    for (let index = 0; index < 6; index++) {
        await new Promise<void>((tick) => setTimeout(tick, 25));
    }
    await nextTick();
}

let root: HTMLDivElement;
let errors: string[];

beforeEach(() => {
    errors = [];
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
        errors.push(args.map((arg) => String(arg)).join(' '));
    });
    root = document.createElement('div');
    document.body.appendChild(root);
});

afterEach(() => {
    root.remove();
    vi.restoreAllMocks();
});

/** Every console error naming a torn-down store, whichever field raised it. */
function destroyedStoreErrors(): string[] {
    return errors.filter((line) => line.includes('store has been destroyed'));
}

/** The demo's field shape: one deferred store seam of each kind. */
const Host = defineComponent({
    setup() {
        useEzClassify(loadCedarValley(), { root });
        return () =>
            h('div', [
                h('input', {
                    'type': 'hidden',
                    'id': 'doc-marking',
                    'data-ezclassify-rendered': '',
                }),
                h('input', {
                    'id': 'tag-field',
                    'data-ezclassify-controller': 'tags',
                    'data-ezclassify-bound-to': 'doc-marking',
                }),
                h('div', {
                    'data-ezclassify-controller': 'card',
                    'data-ezclassify-aggregate': '',
                }),
            ]);
    },
});

describe('a Vue host unmounted while its fields are initializing', () => {
    it('reports no failed mount', async () => {
        const wrapper = mount(Host, { attachTo: root });
        wrapper.unmount();
        await settle();

        expect(destroyedStoreErrors()).toEqual([]);
    });

    it('lets the next host wire the same fields', async () => {
        mount(Host, { attachTo: root }).unmount();
        const second = mount(Host, { attachTo: root });
        await settle();

        expect(destroyedStoreErrors()).toEqual([]);
        second.unmount();
    });
});
