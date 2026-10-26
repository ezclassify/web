/**
 * Regression coverage for `useEzClassify`'s `favorites` option.
 *
 * `docs/attributes.md` in `@ezclassify/ui` claims framework integrations
 * "accept and forward the same option" as the vanilla `EzClassifyUI`
 * constructor's `favorites` config. Before this test existed that claim was
 * false for Vue too: `UseEzClassifyOptions` had no `favorites` field and the
 * `new EzClassifyUI(...)` call never threaded one through, so a Vue host had no
 * way to turn the ★ surface on (mirrors
 * `use-scheme-engine-favorites-option.spec.tsx` in `@ezclassify/react` and
 * `libs/ui/src/ezclassify-ui-favorites-option.spec.ts` for the vanilla
 * declarative case).
 */
import { describe, it, expect, afterEach } from 'vitest';
import { defineComponent, h, nextTick } from 'vue';
import { mount, type VueWrapper } from '@vue/test-utils';
import { Context } from '@ezclassify/engine';
import type { SchemeEngineAdapter } from '@ezclassify/types';
import type { FavoritesConfig } from '@ezclassify/ui';
import { useEzClassify } from './index';

const MINIMAL_SCHEME = {
    scheme: {
        id: 'test',
        version: '1.0.0',
        default_scope: 'marking',
        scopes: [{ id: 'marking', label: 'Marking' }],
        name: 'Test',
        description: '',
        data: {
            categories: [
                {
                    id: 'level',
                    label: 'Level',
                    required: true,
                    single: true,
                    rollup: 'max',
                    position: 0,
                    hierarchy_root: true,
                },
            ],
            concepts: {
                inline: [
                    {
                        id: 'HIGH',
                        name: 'High',
                        views: { default: 'HIGH' },
                        categories: ['level'],
                        parents: [],
                        aliases: [],
                        position: 0,
                        rank: 0,
                    },
                ],
            },
        },
        rules: [],
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
                    separator: '//',
                    fields: [{ category: 'level', separator: '/' }],
                },
            ],
        },
    },
};

const noopFavorites: FavoritesConfig = { load: () => [] };

let wrapper: VueWrapper | null = null;
let root: HTMLDivElement | null = null;

afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
    root?.remove();
    root = null;
});

function mountTagsField(favorites?: FavoritesConfig): HTMLDivElement {
    root = document.createElement('div');
    document.body.appendChild(root);
    const engine = Context.fromComponents({ scheme: MINIMAL_SCHEME })
        .scheme as SchemeEngineAdapter;
    const localRoot = root;
    const App = defineComponent({
        setup() {
            useEzClassify(engine, { root: localRoot, favorites });
            return () => h('div');
        },
    });
    const el = document.createElement('div');
    document.body.appendChild(el);
    localRoot.innerHTML = '<input data-ezclassify-controller="tags" />';
    wrapper = mount(App, { attachTo: el });
    return localRoot;
}

async function flush(): Promise<void> {
    await nextTick();
    for (let i = 0; i < 4; i++) {
        await new Promise<void>((r) => setTimeout(r, 25));
    }
}

describe('useEzClassify({ favorites })', () => {
    it('forwards favorites through to EzClassifyUI: the ★ button renders on a scanner-mounted field', async () => {
        const mountedRoot = mountTagsField(noopFavorites);
        await flush();

        expect(
            mountedRoot.querySelector('.ez-favorites-button'),
        ).not.toBeNull();
    });

    it('renders no ★ button when favorites is omitted (default, unchanged)', async () => {
        const mountedRoot = mountTagsField();
        await flush();

        expect(mountedRoot.querySelector('.ez-favorites-button')).toBeNull();
    });
});
