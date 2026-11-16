/**
 * `createEzClassify({ options: { favorites } })` reaches every scanner-mounted
 * field.
 *
 * `docs/attributes.md` in `@ezclassify/ui` says framework integrations accept
 * and forward the same `favorites` option as the vanilla `EzClassifyUI`
 * constructor. Favorites persistence is host-fed and has no `data-ezclassify-*`
 * equivalent, so the plugin option is a Vue host's only way to turn the ★
 * surface on.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { defineComponent, h, nextTick } from 'vue';
import { mount, type VueWrapper } from '@vue/test-utils';
import type { FavoritesConfig } from '@ezclassify/ui';
import { createEzClassify, EzClassify } from './index';
import { connectDemoContext } from '../../../test-support/demo-runtime';

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
            concepts: [
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
        rules: [],
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

async function mountTagsField(
    favorites?: FavoritesConfig,
): Promise<HTMLDivElement> {
    root = document.createElement('div');
    document.body.appendChild(root);
    const context = await connectDemoContext({
        draft: { scheme: MINIMAL_SCHEME },
    });
    const App = defineComponent({
        setup() {
            return () =>
                h(EzClassify, null, () =>
                    h('input', { 'data-ezclassify-controller': 'tags' }),
                );
        },
    });
    wrapper = mount(App, {
        attachTo: root,
        global: {
            plugins: [createEzClassify({ context, options: { favorites } })],
        },
    });
    return root;
}

async function flush(): Promise<void> {
    await nextTick();
    for (let i = 0; i < 4; i++) {
        await new Promise<void>((r) => setTimeout(r, 25));
    }
}

describe('createEzClassify({ options: { favorites } })', () => {
    it('forwards favorites to every root: the ★ button renders on a scanner-mounted field', async () => {
        const mountedRoot = await mountTagsField(noopFavorites);
        await flush();

        expect(
            mountedRoot.querySelector('.ez-favorites-button'),
        ).not.toBeNull();
    });

    it('renders no ★ button when favorites is omitted', async () => {
        const mountedRoot = await mountTagsField();
        await flush();

        expect(mountedRoot.querySelector('.ez-favorites-button')).toBeNull();
    });
});
