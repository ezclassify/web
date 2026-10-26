/**
 * The ★ favorites surface is function-bearing config (`load`/`save`/`remove`
 * hooks), so it has no `data-ezclassify-*` attribute form: a declarative host's
 * only way to reach it is the `EzClassifyUI` constructor's `favorites` option,
 * threaded into every scanner-mounted field's `ComponentOptions` (see
 * `buildComponentOptions` in ezclassify-ui.ts). Before that threading existed,
 * a purely declarative page (any host that doesn't construct field components
 * directly) had no way to turn favorites on at all: the field components
 * support it, but nothing wired it from a markup-scanned mount to the option
 * they read.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadCedarValley } from '@ezclassify/example-schemes/cedar-valley';
import { EzClassifyUI } from './ezclassify-ui';
import type { FavoritesConfig } from './components/favorites-panel';

const noopFavorites: FavoritesConfig = {
    load: () => [],
};

let root: HTMLDivElement;
let forms: EzClassifyUI | null;

beforeEach(() => {
    root = document.createElement('div');
    document.body.appendChild(root);
    forms = null;
});

afterEach(() => {
    forms?.destroy();
    root.remove();
});

describe('EzClassifyUI({ favorites }) threads into scanner-mounted fields', () => {
    it('renders the ★ button on a declaratively-mounted MarkingField when the constructor supplies favorites', async () => {
        root.innerHTML = `<textarea id="mf" data-ezclassify-controller="marking"></textarea>`;
        forms = new EzClassifyUI(loadCedarValley(), {
            root,
            favorites: noopFavorites,
        });
        await new Promise((r) => setTimeout(r, 100));

        expect(root.querySelector('.ez-favorites-button')).not.toBeNull();
    });

    it('never renders the ★ button when the constructor omits favorites (default)', async () => {
        root.innerHTML = `<textarea id="mf" data-ezclassify-controller="marking"></textarea>`;
        forms = new EzClassifyUI(loadCedarValley(), { root });
        await new Promise((r) => setTimeout(r, 100));

        expect(root.querySelector('.ez-favorites-button')).toBeNull();
    });

    it('renders the ★ button on a declaratively-mounted TagInput too, the same instance-level option covering every scanner-mounted field', async () => {
        root.innerHTML = `<input id="tags" data-ezclassify-controller="tags" />`;
        forms = new EzClassifyUI(loadCedarValley(), {
            root,
            favorites: noopFavorites,
        });
        await new Promise((r) => setTimeout(r, 100));

        expect(root.querySelector('.ez-favorites-button')).not.toBeNull();
    });
});
