/**
 * A facet field (one category of a larger marking) edits its category in a
 * composer. What that composer says about the draft has to be true of the
 * marking the draft stores into: the other categories count as they stand. And
 * a closed composer leaves none of what it said behind in the document.
 */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Context } from '@ezclassify/engine';
import { EzClassifyUI } from '../ezclassify-ui';
import {
    openSurface,
    press,
    rowFor,
    typeText,
    wait,
} from './composer/composer-harness';

/** A required single-choice level and an optional multi-choice caveat. */
function createContext() {
    const concept = (
        id: string,
        label: string,
        category: string,
        position: number,
    ) => ({
        id,
        name: label.charAt(0) + label.slice(1).toLowerCase(),
        views: { default: label },
        categories: [category],
        parents: [],
        aliases: [],
        position,
        rank: position,
    });
    return Context.fromComponents({
        scheme: {
            scheme: {
                id: 'facet-composer',
                version: '1.0.0',
                name: 'Facet Composer',
                data: {
                    concepts: {
                        inline: [
                            concept('U', 'UNCLASSIFIED', 'level', 1),
                            concept('S', 'SECRET', 'level', 2),
                            concept('NF', 'NOFORN', 'caveat', 1),
                            concept('OC', 'ORCON', 'caveat', 2),
                        ],
                    },
                    categories: [
                        {
                            id: 'level',
                            label: 'Level',
                            required: true,
                            single: true,
                            rollup: 'max',
                            position: 1,
                        },
                        {
                            id: 'caveat',
                            label: 'Caveat',
                            required: false,
                            single: false,
                            rollup: 'union',
                            position: 2,
                        },
                    ],
                },
                rules: [],
                parse: { case_sensitive: false, strip_whitespace: true },
                render: {
                    default: 'default',
                    formats: [
                        {
                            id: 'default',
                            surface: 'marking',
                            mode: 'inline',
                            separator: '//',
                            fields: [
                                { category: 'level', separator: '/' },
                                { category: 'caveat', separator: '/' },
                            ],
                        },
                    ],
                },
            },
        },
    });
}

let root: HTMLDivElement;
let forms: EzClassifyUI | null = null;

beforeEach(() => {
    root = document.createElement('div');
    document.body.appendChild(root);
    Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
    forms?.destroy();
    forms = null;
    root.remove();
});

async function mount(): Promise<HTMLInputElement> {
    root.innerHTML = [
        '<input type="hidden" id="doc" data-ezclassify-rendered />',
        '<label for="caveats">Caveats</label>',
        '<input id="caveats" data-ezclassify-controller="tags" data-ezclassify-category="caveat" data-ezclassify-facet-of="doc" />',
    ].join('');
    forms = new EzClassifyUI(createContext() as never, { root });
    await wait();
    await forms.store.publishRendered('doc', 'SECRET');
    await wait();
    return root.querySelector<HTMLInputElement>('.tag-input-filter')!;
}

const resultText = () =>
    openSurface()?.querySelector('.ez-composer__result')?.textContent ?? '';

it('judges a picked caveat with the level the marking already holds', async () => {
    const input = await mount();
    expect(forms!.store.get('doc').rendered).toBe('SECRET');
    input.focus();
    press(input, 'ArrowDown');
    await wait();
    typeText(input, 'nof');
    await wait();
    rowFor('NOFORN')!.click();
    await wait();
    // The draft is the marking's level plus the picked caveat: nothing is
    // missing from it.
    expect(resultText()).not.toMatch(/Level/);
    press(input, 'Enter');
    await wait(150);
    expect(forms!.store.get('doc').rendered).toBe('SECRET//NOFORN');
});

it('says a level is missing when the marking holds none', async () => {
    const input = await mount();
    await forms!.store.publishRendered('doc', '');
    await wait();
    input.focus();
    press(input, 'ArrowDown');
    await wait();
    typeText(input, 'noforn');
    await wait();
    expect(resultText()).toMatch(/Level/);
});

it('leaves none of what the composer said in the document once it closes', async () => {
    const input = await mount();
    await forms!.store.publishRendered('doc', '');
    await wait();
    input.focus();
    press(input, 'ArrowDown');
    await wait();
    typeText(input, 'noforn');
    await wait();
    expect(resultText()).toMatch(/Level/);
    press(input, 'Escape');
    await wait();
    expect(openSurface()).toBeNull();
    const surfaces = [...document.querySelectorAll('.ez-composer')];
    expect(surfaces.length).toBeGreaterThan(0);
    for (const surface of surfaces) {
        expect(
            surface.querySelector('.ez-composer__result')?.textContent ?? '',
        ).toBe('');
        expect(surface.textContent).not.toMatch(/Level/);
    }
});

it('clears only the facet category and keeps the rest of the shared marking', async () => {
    await mount();
    await forms!.store.publishRendered('doc', 'SECRET//NOFORN');
    await wait();
    const clear = root.querySelector<HTMLButtonElement>('.ez-clear-button')!;
    expect(clear.getAttribute('aria-disabled')).toBe('false');
    clear.click();
    await vi.waitFor(() =>
        expect(forms!.store.get('doc').rendered).toBe('SECRET'),
    );
    expect(forms!.store.get('doc').assertions.map((a) => a.conceptId)).toEqual([
        'S',
    ]);
    expect(openSurface()).toBeNull();
});
