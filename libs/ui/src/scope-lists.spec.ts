/**
 * Every component that reads scope reads a list of them, against the engine.
 *
 * The scheme (see `two-scope-flow-scheme.ts`) writes a level line and an origin
 * block, each in a format of its own, so no one format writes both. These specs
 * pin what each kind of component does with a host that lists both scopes: a
 * picker offers the categories of each, scope by scope, labeled by scope; a
 * text field is refused, because one string cannot carry both; and a level view
 * shows every bucket as the scopes it names write it. A variant of the surfaces
 * scheme has a format that writes both of its scopes in one line, so a text
 * field there shows them as one string.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ContextAdapter } from '@ezclassify/types';
import {
    connectDemoContext,
    demoRuntimeSettled,
} from '../../../test-support/demo-runtime';
import {
    openContext,
    type OpenContext,
} from '../test-fixtures/context-doubles';
import { TWO_SCOPE_FLOW_SCHEME } from '../test-fixtures/two-scope-flow-scheme';
import { SURFACES_SCHEME } from '../test-fixtures/surfaces-scheme';
import { EzClassifyUI } from './ezclassify-ui';
import { CategorySelector } from './components/category-selector';
import { SingleSelect } from './components/single-select';
import { MarkingField } from './components/marking-field';
import { MarkedInput } from './components/marked-input';
import { openSurface, press } from './components/composer/composer-harness';

let connection: Promise<ContextAdapter> | undefined;

/** A fresh view of the draft Context, whose operations a spec may spy on. */
async function context(): Promise<OpenContext> {
    connection ??= connectDemoContext({
        draft: { scheme: TWO_SCOPE_FLOW_SCHEME },
    });
    return openContext(await connection);
}

let forms: EzClassifyUI | null = null;
const destroyers: Array<() => void> = [];

afterEach(() => {
    forms?.destroy();
    forms = null;
    for (const destroy of destroyers.splice(0)) {
        try {
            destroy();
        } catch {
            // A field refused at init has nothing to tear down.
        }
    }
    document.body.innerHTML = '';
    vi.restoreAllMocks();
});

function host(): HTMLDivElement {
    const el = document.createElement('div');
    document.body.appendChild(el);
    return el;
}

describe('a category selector that lists several scopes', () => {
    async function mount(scopes: string[]) {
        const el = host();
        const selector = new CategorySelector();
        destroyers.push(() => selector.destroy());
        await selector.init(el, await context(), {
            scopes,
            scope: scopes.length === 1 ? scopes[0] : undefined,
        });
        return el;
    }
    const layout = (el: HTMLElement) =>
        Array.from(
            el.querySelectorAll(
                '.category-selector-group-heading, .category-selector-label',
            ),
        ).map((node) => node.textContent);

    it("offers each scope's categories, scope by scope, under the scope's label", async () => {
        // Listed out of order on purpose: the scheme declares label first.
        const el = await mount(['origin', 'label']);

        expect(layout(el)).toEqual([
            'Label Line',
            'Level',
            'Origin Block',
            'Decision Type',
            'Decided By',
            'Source',
            'Reason',
            'Release',
            'Exemption Code',
        ]);
    });

    it('offers one scope its categories alone, with no scope headings', async () => {
        const el = await mount(['origin']);

        expect(layout(el)).toEqual([
            'Decision Type',
            'Decided By',
            'Source',
            'Reason',
            'Release',
            'Exemption Code',
        ]);
    });
});

describe('a single select that lists several scopes', () => {
    it("picks the first single-choice category in the scheme's scope order", async () => {
        const mount = async (scopes: string[]) => {
            const el = host();
            const select = new SingleSelect();
            destroyers.push(() => select.destroy());
            await select.init(el, await context(), {
                scopes,
                scope: scopes.length === 1 ? scopes[0] : undefined,
            });
            return el.querySelector('select')?.getAttribute('aria-label');
        };

        expect(await mount(['origin', 'label'])).toBe('Select Level');
        expect(await mount(['origin'])).toBe('Select Decision Type');
    });
});

describe('a text field that lists several scopes', () => {
    it('is refused at init, naming the scopes and the format, when no one format writes them', async () => {
        const field = new MarkingField();
        destroyers.push(() => field.destroy());

        const el = document.createElement('textarea');
        document.body.appendChild(el);

        await expect(
            field.init(el as never, await context(), {
                scopes: ['origin', 'label'],
            }),
        ).rejects.toThrow(
            'MarkingField: data-ezclassify-scope lists "label", "origin", but its format "label/line" does not write the categories of "origin"',
        );
    });

    it('is refused for a format it names that leaves a scope out', async () => {
        const field = new MarkedInput();
        destroyers.push(() => field.destroy());
        const el = document.createElement('input');
        document.body.appendChild(el);

        await expect(
            field.init(el as never, await context(), {
                scopes: ['label', 'origin'],
                formatId: 'origin/block',
            }),
        ).rejects.toThrow(
            'MarkedInput: data-ezclassify-scope lists "label", "origin", but its format "origin/block" does not write the categories of "label"',
        );
    });

    it('mounts on one scope, which needs no format to write another', async () => {
        const error = vi.spyOn(console, 'error').mockImplementation(() => {});
        const root = host();
        root.innerHTML = `
            <textarea id="field" data-ezclassify-controller="marking"
                      data-ezclassify-scope="origin"></textarea>`;
        forms = new EzClassifyUI(await context(), { root });
        await demoRuntimeSettled();

        expect(error.mock.calls.flat().join(' ')).not.toContain(
            'failed to mount',
        );
        expect(
            root.querySelector('#field')?.closest('.marking-field-wrap'),
        ).not.toBeNull();
    });

    it('fails to mount on the page, with the reason logged', async () => {
        const error = vi.spyOn(console, 'error').mockImplementation(() => {});
        const root = host();
        root.innerHTML = `
            <input id="field" data-ezclassify-controller="marking"
                   data-ezclassify-scope="label origin">`;
        forms = new EzClassifyUI(await context(), { root });
        await demoRuntimeSettled();

        const logged = error.mock.calls.flat().join(' ');
        expect(logged).toContain('"marking" failed to mount');
        expect(
            root.querySelector('#field')?.closest('.marking-field-wrap'),
        ).toBeNull();
        expect(logged).toContain(
            'data-ezclassify-scope lists "label", "origin", but its format "label/line" does not write the categories of "origin"',
        );
    });
});

describe('a tag input that lists several scopes', () => {
    it("asks the engine about the whole marking and offers every listed scope's categories", async () => {
        Element.prototype.scrollIntoView = vi.fn();
        const ctx = await context();
        const suggest = vi.spyOn(ctx.scheme, 'suggest');
        const process = vi.spyOn(ctx.scheme, 'process');
        const root = host();
        root.innerHTML = `
            <input id="tags" data-ezclassify-controller="tags"
                   data-ezclassify-scope="label origin">`;
        forms = new EzClassifyUI(ctx, { root });
        await demoRuntimeSettled();
        const filter =
            root.querySelector<HTMLInputElement>('.tag-input-filter')!;
        filter.focus();
        press(filter, 'ArrowDown');
        await demoRuntimeSettled();

        // A list of scopes is no surface: the field asks each listed scope on
        // its own surface, never on a surface named "label origin".
        const surfaces = [...suggest.mock.calls, ...process.mock.calls].map(
            ([, options]) =>
                (options as { surface?: string } | undefined)?.surface,
        );
        expect(surfaces).not.toContain('label origin');
        expect(new Set(surfaces.filter(Boolean))).toEqual(
            new Set(['label', 'origin']),
        );
        const scopes = Array.from(
            openSurface()?.querySelectorAll('.ez-composer__group-scope') ?? [],
        ).map((node) => node.textContent);
        expect(new Set(scopes)).toEqual(
            new Set(['Label Line', 'Origin Block']),
        );
    });
});

describe('a level view across buckets that names a scope', () => {
    it('shows every bucket as that scope writes it', async () => {
        const first = await connectDemoContext({
            draft: { scheme: TWO_SCOPE_FLOW_SCHEME },
        });
        const second = await connectDemoContext({
            draft: { scheme: TWO_SCOPE_FLOW_SCHEME },
        });
        const root = host();
        root.innerHTML = `
            <div id="block" data-ezclassify-controller="banner"
                 data-ezclassify-aggregate data-ezclassify-scope="origin"></div>
            <div id="line" data-ezclassify-controller="banner"
                 data-ezclassify-aggregate></div>
            <section data-ezclassify-context="first">
                <input type="hidden" id="a" data-ezclassify-marking>
            </section>
            <section data-ezclassify-context="second">
                <input type="hidden" id="b" data-ezclassify-marking>
            </section>`;
        forms = new EzClassifyUI({ contexts: { first, second } }, { root });
        await demoRuntimeSettled();
        const facts = (release: string) =>
            [
                ['level', 'HIGH'],
                ['origin_type', 'COPIED'],
                ['release_type', release],
            ].map(([categoryId, conceptId]) => ({
                categoryId: categoryId!,
                conceptId: conceptId!,
                confidence: 'certain' as const,
                source: 'user',
            }));
        await forms.store.publishAssertions('a', facts('NEVER'));
        await forms.store.publishAssertions('b', facts('EXEMPT'));
        await demoRuntimeSettled();

        const lines = (id: string) =>
            Array.from(
                root.querySelectorAll(`#${id} .status-banner-bucket`),
            ).map((row) => row.textContent);
        await expect
            .poll(() => lines('block').join(' | '))
            .toMatch(/Release: Never.*\|.*Release: Exempt/);
        expect(lines('block').join(' ')).not.toContain('HIGH');
        // A view that names no scope shows each bucket's whole marking.
        expect(lines('line')).toEqual([
            expect.stringMatching(/HIGH\nRelease: Never$/),
            expect.stringMatching(/HIGH\nRelease: Exempt$/),
        ]);
    });
});

/**
 * The surfaces scheme with its retention category in both scopes and one more
 * sensitivity view, `kept`, whose format writes that category on the same line
 * as the sensitivity ones. A format writes the categories of its own surface,
 * so a category one format writes with another scope's belongs to both.
 */
const KEPT_SCHEME = (() => {
    const doc = structuredClone(SURFACES_SCHEME);
    const keep = doc.scheme.data.categories.find((c) => c.id === 'keep')!;
    keep.scopes = ['sensitivity', 'retention'];
    const render = doc.scheme.render;
    render.formats.push({
        id: 'kept_line',
        surface: 'sensitivity',
        mode: 'inline',
        separator: ' // ',
        fields: [
            { category: 'level' },
            { category: 'sharing' },
            { category: 'keep' },
        ],
    });
    (render.surfaces[0]!.views as Array<Record<string, unknown>>).push({
        id: 'kept',
        format: 'kept_line',
    });
    return doc;
})();

describe('a text field whose format writes every scope it lists', () => {
    let kept: Promise<ContextAdapter> | undefined;
    const keptContext = async () => {
        kept ??= connectDemoContext({ draft: { scheme: KEPT_SCHEME } });
        return openContext(await kept);
    };
    const facts = [
        ['level', 'CONFIDENTIAL'],
        ['keep', 'KEEP_7Y'],
    ].map(([categoryId, conceptId]) => ({
        categoryId: categoryId!,
        conceptId: conceptId!,
        confidence: 'certain' as const,
        source: 'user',
    }));

    it('writes both scopes as one string and keeps both facts in the store', async () => {
        Element.prototype.scrollIntoView = vi.fn();
        const root = host();
        root.innerHTML = `
            <textarea id="field" data-ezclassify-controller="marking"
                      data-ezclassify-scope="retention sensitivity"
                      data-ezclassify-format="kept"></textarea>`;
        forms = new EzClassifyUI(await keptContext(), { root });
        await demoRuntimeSettled();
        const el = root.querySelector<HTMLTextAreaElement>('#field')!;
        const field = forms.components.get(el) as MarkingField;
        expect(field).toBeDefined();

        field.setAssertions(facts);
        await demoRuntimeSettled();

        // The kept view writes both scopes on one line. The engine writes a
        // whole marking on every surface it has facts for, and the scheme
        // puts the keep in both scopes, so the retention block follows.
        expect(el.value).toBe('CONFIDENTIAL // KEEP 7 YEARS\nKEEP 7 YEARS');
        expect(
            forms.store.get('field').assertions.map((a) => a.conceptId),
        ).toEqual(expect.arrayContaining(['CONFIDENTIAL', 'KEEP_7Y']));
    });

    it('is refused when it names no format, as the default whole output leaves the keep out', async () => {
        const field = new MarkingField();
        destroyers.push(() => field.destroy());
        const el = document.createElement('textarea');
        document.body.appendChild(el);

        await expect(
            field.init(el as never, await keptContext(), {
                scopes: ['sensitivity', 'retention'],
            }),
        ).rejects.toThrow(
            'MarkingField: data-ezclassify-scope lists "sensitivity", "retention", but its format "sensitivity/full" does not write the categories of "sensitivity", "retention"',
        );
    });
});
