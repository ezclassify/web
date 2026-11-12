/**
 * The Vue half of the shared teardown-during-init contract.
 *
 * `libs/ui/src/teardown-during-init.spec.ts` pins the rule at the seam where it
 * is implemented: an `EzClassifyUI` destroyed while its fields are still
 * initializing reaches no store afterwards. This file proves Vue's own teardown
 * lands in that window, because `<EzClassify>` builds the instance and its
 * store together and destroys both on unmount. A root removed by a `v-if` or a
 * route change before its fields settle is the ordinary case.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { defineComponent, h, nextTick } from 'vue';
import { mount } from '@vue/test-utils';
import { loadCedarValleyContext } from '../../../test-support/community-content';
import { createEzClassify, EzClassify } from './index';

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
        return () =>
            h(EzClassify, null, () => [
                h('input', {
                    'type': 'hidden',
                    'id': 'doc-marking',
                    'data-ezclassify-marking': '',
                }),
                h('input', {
                    'id': 'tag-field',
                    'data-ezclassify-controller': 'tags',
                    'data-ezclassify-bound-to': 'doc-marking',
                }),
                h('div', {
                    'data-ezclassify-controller': 'banner',
                    'data-ezclassify-aggregate': '',
                }),
            ]);
    },
});

/** Mount options: attached to the page, with the plugin installed. */
function options() {
    return {
        attachTo: root,
        global: {
            plugins: [createEzClassify({ context: loadCedarValleyContext() })],
        },
    };
}

describe('a Vue host unmounted while its fields are initializing', () => {
    it('reports no failed mount', async () => {
        const wrapper = mount(Host, options());
        wrapper.unmount();
        await settle();

        expect(destroyedStoreErrors()).toEqual([]);
    });

    it('lets the next host wire the same fields', async () => {
        mount(Host, options()).unmount();
        const second = mount(Host, options());
        await settle();

        expect(destroyedStoreErrors()).toEqual([]);
        second.unmount();
    });
});
