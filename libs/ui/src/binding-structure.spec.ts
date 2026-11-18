/**
 * The runtime reads the marking tree from markup: whole containers make parts,
 * collections and member-of place wholes, views never contribute, refused
 * markup stays unenhanced and holds the levels above it incomplete, and a
 * structural attribute change derives its subtree again.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
    Assertion,
    ContextAdapter,
    SchemeEngineAdapter,
} from '@ezclassify/types';
import { EzClassifyUI } from './ezclassify-ui';
import { mockRenderFormats } from './render-format-layout-mock';
import { __resetMountRollupRegistry } from './mount-rollup-registry';
import { BaseEzClassifyStore } from './store/base-ezclassify-store';

vi.mock('./styles.css?inline', () => ({ default: '' }));

const concepts = [
    {
        id: 'A',
        name: 'Option A',
        views: { default: 'A' },
        categories: ['level'],
    },
    {
        id: 'B',
        name: 'Option B',
        views: { default: 'B' },
        categories: ['level'],
    },
];

function read(text: string): Assertion[] {
    return concepts
        .filter((c) => text.includes(c.views.default))
        .map((c) => ({
            conceptId: c.id,
            categoryId: 'level',
            confidence: 'certain' as const,
            source: 'parse' as const,
        }));
}

function spell(assertions: Assertion[]): string {
    return assertions.map((a) => a.conceptId).join('');
}

function createContext(): ContextAdapter {
    const valid = {
        notices: [],
        errors: [],
        valid: true,
        complete: true,
        appliedFixes: [],
    };
    const scheme = {
        getScheme: () => ({
            ...scheme.getSchemeMeta(),
            referenceSurfaceLabel: {
                singular: 'Handbook',
                plural: 'Handbooks',
            },
            categories: scheme.listCategories(),
            concepts,
            labelPresets: [],
        }),
        getSchemeMeta: () => ({
            id: 'test',
            version: '1.0.0',
            name: 'Test',
            defaultRenderFormat: 'default',
            formats: mockRenderFormats([
                {
                    id: 'default',
                    surface: 'default',
                    mode: 'inline',
                    separator: '',
                    view: 'default',
                    fields: [{ category: 'level', separator: '' }],
                },
            ] as never),
            scopes: [],
        }),
        listCategories: () => [
            { id: 'level', label: 'Level', single: true, order: 0 },
        ],
        getConceptsInCategory: () => concepts,
        render: vi.fn((assertions: Assertion[]) => ({
            rendered: spell(assertions),
            assessment: valid,
        })),
        process: vi.fn((input: string | Assertion[]) => {
            const assertions = Array.isArray(input) ? input : read(input);
            return {
                assertions,
                rendered: spell(assertions),
                valid: true,
                errors: [],
                recognition: {
                    status: 'complete',
                    inputFormat: 'default',
                    surface: 'default',
                    unmatched: [],
                    corrections: [],
                },
            };
        }),
        validate: vi.fn(() => ({ valid: true, errors: [] })),
        suggest: vi.fn(() => ({ suggestions: [] })),
        aggregate: vi.fn((values: string[]) => ({
            assertions: read(values.join('')),
            rendered: values.join(''),
            valid: true,
        })),
        aggregateAssertions: vi.fn((sets: Assertion[][]) => ({
            assertions: sets.flat(),
            rendered: spell(sets.flat()),
            valid: true,
        })),
        describeConcept: (id: string) => ({ lines: [id] }),
    } as unknown as SchemeEngineAdapter;
    return { scheme, audit: vi.fn() } as unknown as ContextAdapter;
}

async function mount(html: string): Promise<EzClassifyUI> {
    document.body.innerHTML = html;
    const ui = new EzClassifyUI(createContext());
    await new Promise((r) => setTimeout(r, 0));
    return ui;
}

const settle = () => new Promise((r) => setTimeout(r, 0));

let ui: EzClassifyUI | undefined;

beforeEach(() => {
    __resetMountRollupRegistry();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
    ui?.destroy();
    ui = undefined;
    document.body.innerHTML = '';
    vi.restoreAllMocks();
});

describe('whole containers', () => {
    it('places every host in the container under the whole it names', async () => {
        document.body.innerHTML = `
            <form data-ezclassify-whole="doc">
                <input id="doc" type="hidden" data-ezclassify-marking value="A">
                <input id="p1" type="hidden" data-ezclassify-marking value="A">
                <input id="p2" type="hidden" data-ezclassify-marking value="B">
            </form>`;
        const setPartOf = vi.spyOn(BaseEzClassifyStore.prototype, 'setPartOf');
        ui = new EzClassifyUI(createContext());
        await settle();
        expect(ui.partOfMap.get(document.getElementById('p1')!)).toBe('doc');
        expect(ui.partOfMap.get(document.getElementById('p2')!)).toBe('doc');
        expect(ui.partOfMap.has(document.getElementById('doc')!)).toBe(false);
        expect(setPartOf).toHaveBeenCalledWith('p1', 'doc');
        expect(setPartOf).toHaveBeenCalledWith('p2', 'doc');
        expect(setPartOf).not.toHaveBeenCalledWith('doc', 'doc');
    });
});

describe('views never contribute', () => {
    it('keeps a hidden aggregate sink out of the contributing fields', async () => {
        ui = await mount(`
            <input id="a" type="hidden" data-ezclassify-marking value="A">
            <input id="sink" type="hidden" name="pageMarking" data-ezclassify-aggregate>`);
        const sink = document.getElementById('sink') as HTMLInputElement;
        expect(ui.fields).toContain(document.getElementById('a'));
        expect(ui.fields).not.toContain(sink);
        expect(ui.isContributor(sink)).toBe(false);
        expect(ui.isContributor(document.getElementById('a')!)).toBe(true);
        // The runtime no longer stamps a view to keep it out.
        expect(sink.hasAttribute('data-ezclassify-no-rollup')).toBe(false);
    });

    it('keeps a plain bound-to editor out of the contributing fields', async () => {
        ui = await mount(`
            <input id="a" type="hidden" data-ezclassify-marking value="A">
            <input id="edit" data-ezclassify-bound-to="a">`);
        expect(ui.fields).not.toContain(document.getElementById('edit'));
    });
});

describe('plain select', () => {
    it('binds a facet select without an opt-in attribute', async () => {
        ui = await mount(`
            <input id="m" type="hidden" data-ezclassify-marking value="A">
            <select id="s" data-ezclassify-facet-of="m" data-ezclassify-category="level"></select>`);
        const select = document.getElementById('s') as HTMLSelectElement;
        expect(ui.plainBehaviorCleanups.has(select)).toBe(true);
    });
});

describe('collections', () => {
    it('declares collections and places wholes in them by nesting and member-of', async () => {
        document.body.innerHTML = `
            <section data-ezclassify-collection="folderA">
                <input id="m1" type="hidden" data-ezclassify-marking value="A">
                <section data-ezclassify-collection="folderB"></section>
            </section>
            <input id="m2" type="hidden" data-ezclassify-marking data-ezclassify-member-of="folderB" value="B">
            <input id="m3" type="hidden" data-ezclassify-marking value="B">`;
        const registerCollection = vi.spyOn(
            BaseEzClassifyStore.prototype,
            'registerCollection',
        );
        const setMembership = vi.spyOn(
            BaseEzClassifyStore.prototype,
            'setMembership',
        );
        ui = new EzClassifyUI(createContext());
        await settle();
        expect(registerCollection).toHaveBeenCalledWith('folderA', null);
        expect(registerCollection).toHaveBeenCalledWith('folderB', 'folderA');
        expect(setMembership).toHaveBeenCalledWith('m1', 'folderA');
        expect(setMembership).toHaveBeenCalledWith('m2', 'folderB');
        expect(setMembership).toHaveBeenCalledWith('m3', null);
    });
});

describe('host errors', () => {
    it('leaves a marked field inside an ignore region unenhanced, says why, and holds the page incomplete', async () => {
        document.body.innerHTML = `
            <input id="a" type="hidden" data-ezclassify-marking value="A">
            <ul data-ezclassify-ignore>
                <li><input id="m" data-ezclassify-controller="marking" value="B"></li>
            </ul>`;
        const errors: CustomEvent[] = [];
        document.body.addEventListener('ezclassify:host-error', (e) =>
            errors.push(e as CustomEvent),
        );
        ui = new EzClassifyUI(createContext());
        await settle();
        const field = document.getElementById('m')!;
        expect(errors.map((e) => e.detail.code)).toEqual(['marked-in-ignore']);
        expect(errors[0].target).toBe(field);
        expect(ui.components.has(field)).toBe(false);
        expect(ui.isContributor(field)).toBe(false);
        expect(
            Array.from(ui.store.getAggregate().byBucket.values()).some(
                (bucket) => bucket.stale === true,
            ),
        ).toBe(true);
    });

    it('enhances the same field once the ignore region is lifted', async () => {
        ui = await mount(`
            <div id="region" data-ezclassify-ignore>
                <input id="m" data-ezclassify-controller="marking" value="B">
            </div>`);
        const field = document.getElementById('m')!;
        expect(ui.components.has(field)).toBe(false);

        document
            .getElementById('region')!
            .removeAttribute('data-ezclassify-ignore');
        await settle();
        await settle();
        expect(ui.components.has(field)).toBe(true);
        expect(ui.isContributor(field)).toBe(true);
        expect(
            Array.from(ui.store.getAggregate().byBucket.values()).some(
                (bucket) => bucket.stale === true,
            ),
        ).toBe(false);
    });

    it('refuses a nested instance mounted inside a whole container', async () => {
        ui = await mount(`
            <form data-ezclassify-whole="doc">
                <input id="doc" type="hidden" data-ezclassify-marking value="A">
                <div id="island"></div>
            </form>`);
        const errors: string[] = [];
        document.body.addEventListener('ezclassify:host-error', (e) =>
            errors.push((e as CustomEvent).detail.code),
        );
        const island = new EzClassifyUI(createContext(), {
            root: document.getElementById('island')!,
        });
        await settle();
        expect(errors).toEqual(['nested-root-in-whole']);
        island.destroy();
    });
});

describe('structural changes', () => {
    it('reads a host as a part once its container becomes a whole container', async () => {
        ui = await mount(`
            <form id="f">
                <input id="doc" type="hidden" data-ezclassify-marking value="A">
                <input id="p" type="hidden" data-ezclassify-marking value="B">
            </form>`);
        const part = document.getElementById('p')!;
        expect(ui.partOfMap.has(part)).toBe(false);

        document
            .getElementById('f')!
            .setAttribute('data-ezclassify-whole', 'doc');
        await settle();
        expect(ui.partOfMap.get(part)).toBe('doc');
        expect(ui.bindingNodeOf(part)?.kind).toBe('part');
    });
});
