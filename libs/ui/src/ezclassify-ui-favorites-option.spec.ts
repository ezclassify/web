/**
 * Host Favorites hooks reach scanner-mounted fields through the UI constructor.
 * The branding popover reflects that same option for every declarative field.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { EzClassifyUI } from './ezclassify-ui';
import type { FavoritesConfig } from './components/favorites-panel';
import { connectDemoContext } from '../../../test-support/demo-runtime';

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
    it('offers a Favorites tab on a declaratively-mounted MarkingField', async () => {
        root.innerHTML = `<textarea id="mf" data-ezclassify-controller="marking"></textarea>`;
        forms = new EzClassifyUI(
            await connectDemoContext({ contextId: 'cedar-valley' }),
            {
                root,
                favorites: noopFavorites,
            },
        );
        await new Promise((r) => setTimeout(r, 100));

        root.querySelector<HTMLButtonElement>('.ez-status-mark')!.click();
        expect(
            [...document.querySelectorAll('[role=tab]')].map(
                (tab) => tab.textContent,
            ),
        ).toContain('Favorites');
    });

    it('omits Favorites when the constructor has no provider and the scheme has no presets', async () => {
        root.innerHTML = `<textarea id="mf" data-ezclassify-controller="marking"></textarea>`;
        forms = new EzClassifyUI(
            await connectDemoContext({ contextId: 'cedar-valley' }),
            { root },
        );
        await new Promise((r) => setTimeout(r, 100));

        root.querySelector<HTMLButtonElement>('.ez-status-mark')!.click();
        expect(
            [...document.querySelectorAll('[role=tab]')].map(
                (tab) => tab.textContent,
            ),
        ).not.toContain('Favorites');
    });

    it('offers the same Favorites tab on a declaratively-mounted TagInput', async () => {
        root.innerHTML = `<input id="tags" data-ezclassify-controller="tags" />`;
        forms = new EzClassifyUI(
            await connectDemoContext({ contextId: 'cedar-valley' }),
            {
                root,
                favorites: noopFavorites,
            },
        );
        await new Promise((r) => setTimeout(r, 100));

        root.querySelector<HTMLButtonElement>('.ez-status-mark')!.click();
        expect(
            [...document.querySelectorAll('[role=tab]')].map(
                (tab) => tab.textContent,
            ),
        ).toContain('Favorites');
    });
});
