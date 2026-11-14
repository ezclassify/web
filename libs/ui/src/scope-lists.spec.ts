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
 * field there shows them as one string and reads them back whole.
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
import { TagInput } from './components/tag-input';
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

    it('picks the same category for one scope named alone or on the page', async () => {
        // The level declares no scope, so it is on the default scope's surface
        // only. A select of the origin scope offers the origin's own category
        // however the host names that scope.
        const el = host();
        const select = new SingleSelect();
        destroyers.push(() => select.destroy());
        await select.init(el, await context(), { scope: 'origin' });

        const root = host();
        root.innerHTML = `
            <div id="select" data-ezclassify-controller="select"
                 data-ezclassify-scope="origin"></div>`;
        forms = new EzClassifyUI(await context(), { root });
        await demoRuntimeSettled();

        const label = (from: Element) =>
            from.querySelector('select')?.getAttribute('aria-label');
        expect(label(el)).toBe('Select Decision Type');
        expect(label(root)).toBe('Select Decision Type');
    });

    it('says so, and shows nothing, when the scheme has no category in the scopes it names', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const el = host();
        const select = new SingleSelect();
        destroyers.push(() => select.destroy());
        await select.init(el, await context(), { scope: 'nowhere' });

        expect(el.querySelector('select')).toBeNull();
        expect(warn.mock.calls.flat().join(' ')).toContain(
            'SingleSelect: the scheme has no category in data-ezclassify-scope "nowhere"',
        );
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

    it('is refused as an embedded mark when the format it names leaves a scope out', async () => {
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

    it('keeps a one-line field as it was when its format writes the marking on several lines, and says why', async () => {
        const root = host();
        root.innerHTML = `
            <input id="field" data-ezclassify-controller="marked-input"
                   data-ezclassify-scope="origin" value="quarterly report">`;
        forms = new EzClassifyUI(await context(), { root });
        await demoRuntimeSettled();
        const el = root.querySelector<HTMLInputElement>('#field')!;
        const field = forms.components.get(el) as MarkedInput;
        expect(field).toBeDefined();

        field.setAssertions(
            [
                ['origin_type', 'COPIED'],
                ['source_type', 'MANY_SOURCES'],
                ['release_type', 'NEVER'],
            ].map(([categoryId, conceptId]) => ({
                categoryId: categoryId!,
                conceptId: conceptId!,
                confidence: 'certain' as const,
                source: 'user',
            })),
        );
        await demoRuntimeSettled();

        // The origin block is written a line per field. An input would drop
        // the break and run the lines together into a different marking.
        expect(el.value).toBe('quarterly report');
        expect(
            root.querySelector('.ez-validation-errors__message')?.textContent,
        ).toBe(
            'Cannot write the marking in this field: format "origin/block" writes it on more than one line, and this field holds one line.',
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

describe('a text field that lists one scope', () => {
    it('fails to mount on a text input when its format writes the marking on several lines', async () => {
        const error = vi.spyOn(console, 'error').mockImplementation(() => {});
        const root = host();
        root.innerHTML = `
            <input type="text" id="field" data-ezclassify-controller="marking"
                   data-ezclassify-scope="origin">`;
        forms = new EzClassifyUI(await context(), { root });
        await demoRuntimeSettled();

        // A native input would drop the breaks of the origin block and read
        // the run-together lines back as a different marking.
        const logged = error.mock.calls.flat().join(' ');
        expect(logged).toContain('"marking" failed to mount');
        expect(logged).toContain(
            'MarkingField: format "origin/block" can write the marking on more than one line, and a text input holds one line.',
        );
        expect(
            root.querySelector('#field')?.closest('.marking-field-wrap'),
        ).toBeNull();
    });

    it('mounts on a text input when its format writes one line', async () => {
        const error = vi.spyOn(console, 'error').mockImplementation(() => {});
        const root = host();
        root.innerHTML = `
            <input type="text" id="field" data-ezclassify-controller="marking"
                   data-ezclassify-scope="label">`;
        forms = new EzClassifyUI(await context(), { root });
        await demoRuntimeSettled();

        expect(error.mock.calls.flat().join(' ')).not.toContain(
            'failed to mount',
        );
        expect(
            root.querySelector('#field')?.closest('.marking-field-wrap'),
        ).not.toBeNull();
    });

    it("fails to mount when the format it names writes another scope's surface", async () => {
        const error = vi.spyOn(console, 'error').mockImplementation(() => {});
        const root = host();
        root.innerHTML = `
            <textarea id="field" data-ezclassify-controller="marking"
                      data-ezclassify-scope="origin"
                      data-ezclassify-format="label/line"></textarea>`;
        forms = new EzClassifyUI(await context(), { root });
        await demoRuntimeSettled();

        const logged = error.mock.calls.flat().join(' ');
        expect(logged).toContain('"marking" failed to mount');
        expect(logged).toContain(
            'data-ezclassify-scope lists "origin", but its format "label/line" writes the surface of "label"',
        );
    });

    it("refuses an embedded mark of one scope whose format writes another scope's surface", async () => {
        const field = new MarkedInput();
        destroyers.push(() => field.destroy());
        const el = document.createElement('input');
        document.body.appendChild(el);

        await expect(
            field.init(el as never, await context(), {
                scopes: ['origin'],
                formatId: 'label/line',
            }),
        ).rejects.toThrow(
            'MarkedInput: data-ezclassify-scope lists "origin", but its format "label/line" writes the surface of "label"',
        );
    });
});

describe('a view that names no scope', () => {
    it.each([
        ['banner', 'div'],
        ['text', 'span'],
    ])(
        'a %s of a rolled-up marking shows its default scope only',
        async (controller, tag) => {
            const root = host();
            root.innerHTML = `
                <${tag} id="view" data-ezclassify-controller="${controller}"
                        data-ezclassify-aggregate></${tag}>
                <input type="hidden" id="m" data-ezclassify-marking>`;
            forms = new EzClassifyUI(await context(), { root });
            await demoRuntimeSettled();
            await forms.store.publishAssertions(
                'm',
                [
                    ['level', 'HIGH'],
                    ['origin_type', 'COPIED'],
                    ['source_type', 'MANY_SOURCES'],
                    ['release_type', 'NEVER'],
                ].map(([categoryId, conceptId]) => ({
                    categoryId: categoryId!,
                    conceptId: conceptId!,
                    confidence: 'certain' as const,
                    source: 'user',
                })),
            );
            await demoRuntimeSettled();

            // A rollup names no output, so it is written on every surface its
            // facts reach; the view shows the label line alone.
            const shown = () => root.querySelector('#view')?.textContent ?? '';
            await expect.poll(shown).toContain('HIGH');
            expect(shown()).not.toContain('Release');
            expect(shown()).not.toContain('Source');
        },
    );
});

describe('a component bound to a marking that names no scope', () => {
    const marking = [
        ['level', 'HIGH'],
        ['origin_type', 'COPIED'],
        ['source_type', 'MANY_SOURCES'],
        ['release_type', 'NEVER'],
    ].map(([categoryId, conceptId]) => ({
        categoryId: categoryId!,
        conceptId: conceptId!,
        confidence: 'certain' as const,
        source: 'user',
    }));
    const ids = (assertions: readonly { conceptId: string }[]) =>
        assertions.map((a) => a.conceptId).sort();

    /**
     * Mount `controller` bound to `m`, seed `m` with both scopes' facts, and
     * return the component.
     */
    async function bound(controller: string) {
        Element.prototype.scrollIntoView = vi.fn();
        const root = host();
        root.innerHTML = `
            <input type="hidden" id="m" data-ezclassify-marking>
            <input id="field" data-ezclassify-controller="${controller}"
                   data-ezclassify-bound-to="m">`;
        forms = new EzClassifyUI(await context(), { root });
        await demoRuntimeSettled();
        await forms.store.publishAssertions('m', marking);
        await demoRuntimeSettled();
        const el = root.querySelector<HTMLInputElement>('#field')!;
        // A tag input on a text input is an autocompleter over the host.
        const field = (forms.components.get(el) ??
            (
                forms as unknown as {
                    autocompleters: Map<Element, TagInput>;
                }
            ).autocompleters.get(el)) as MarkingField | TagInput;
        return { el, field };
    }

    it.each(['marking', 'tags'])(
        'a %s shows the default scope of the marking, not the other scopes it holds',
        async (controller) => {
            const { field } = await bound(controller);
            const shown = ids(field.getAssertions());
            expect(shown).toContain('HIGH');
            expect(shown).not.toContain('MANY_SOURCES');
            expect(shown).not.toContain('NEVER');
            expect(ids(forms!.store.get('m').assertions)).toEqual([
                'COPIED',
                'HIGH',
                'MANY_SOURCES',
                'NEVER',
            ]);
        },
    );

    it("a marking field shows its scope's text and an edit keeps the other scopes' facts", async () => {
        const { el, field } = await bound('marking');
        expect(el.value).toBe('HIGH');

        await (field as MarkingField).setValue('LOW');
        await demoRuntimeSettled();
        const held = ids(forms!.store.get('m').assertions);
        expect(held).toContain('LOW');
        expect(held).not.toContain('HIGH');
        expect(held).toContain('MANY_SOURCES');
        expect(held).toContain('NEVER');
    });
});

describe('a view that lists several scopes', () => {
    it.each([
        ['banner', 'div'],
        ['text', 'span'],
    ])(
        'a %s fails to mount, with the reason logged, when no one format writes them',
        async (controller, tag) => {
            const error = vi
                .spyOn(console, 'error')
                .mockImplementation(() => {});
            const root = host();
            root.innerHTML = `
                <input type="hidden" id="m" data-ezclassify-marking>
                <${tag} id="view" data-ezclassify-controller="${controller}"
                        data-ezclassify-source="m"
                        data-ezclassify-scope="label origin"></${tag}>`;
            forms = new EzClassifyUI(await context(), { root });
            await demoRuntimeSettled();

            const logged = error.mock.calls.flat().join(' ');
            expect(logged).toContain(`"${controller}" failed to mount`);
            expect(logged).toContain(
                'data-ezclassify-scope lists "label", "origin", but its format "label/line" does not write the categories of "origin"',
            );
        },
    );
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
        // A view that names no scope shows each bucket's default scope.
        expect(lines('line')).toEqual([
            expect.stringMatching(/HIGH$/),
            expect.stringMatching(/HIGH$/),
        ]);
        expect(lines('line').join(' ')).not.toContain('Release');
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

    const held = (assertions: readonly { conceptId: string }[]) =>
        assertions.map((a) => a.conceptId).sort();

    /** Mount one field on the kept scheme and return its host and instance. */
    async function mountField<T>(markup: string): Promise<{
        el: HTMLInputElement & HTMLTextAreaElement;
        field: T;
    }> {
        Element.prototype.scrollIntoView = vi.fn();
        const root = host();
        root.innerHTML = markup;
        forms = new EzClassifyUI(await keptContext(), { root });
        await demoRuntimeSettled();
        const el = root.querySelector<HTMLInputElement & HTMLTextAreaElement>(
            '#field',
        )!;
        const field = forms.components.get(el) as T;
        expect(field).toBeDefined();
        return { el, field };
    }

    it.each([
        // The kept view writes both scopes on one line, and the engine writes
        // a named view alone, so the retention block does not follow it.
        [
            'the scopes it lists',
            'retention sensitivity',
            'kept',
            'CONFIDENTIAL // KEEP 7 YEARS',
        ],
        // One scope is its own surface, written in its own default output.
        ['the one scope it lists', 'retention', null, 'KEEP 7 YEARS'],
    ])(
        'a text field writes %s as one string, reads it back, and keeps every fact in the store',
        async (_, scopes, format, written) => {
            const { el, field } = await mountField<MarkingField>(`
                <textarea id="field" data-ezclassify-controller="marking"
                          data-ezclassify-scope="${scopes}"
                          ${format ? `data-ezclassify-format="${format}"` : ''}></textarea>`);

            field.setAssertions(facts);
            await demoRuntimeSettled();
            expect(el.value).toBe(written);
            expect(held(forms!.store.get('field').assertions)).toEqual([
                'CONFIDENTIAL',
                'KEEP_7Y',
            ]);

            // The string it wrote reads back to the facts it was written
            // from, and a fact of a scope it does not list, which its text
            // cannot state, stays in the store.
            await field.setValue(written);
            await demoRuntimeSettled();
            expect(el.value).toBe(written);
            expect(held(forms!.store.get('field').assertions)).toEqual([
                'CONFIDENTIAL',
                'KEEP_7Y',
            ]);
        },
    );

    it.each([
        [
            'the scopes it lists',
            'retention sensitivity',
            'kept',
            '(CONFIDENTIAL // KEEP 7 YEARS) quarterly report',
            ['CONFIDENTIAL', 'KEEP_7Y'],
        ],
        [
            'the one scope it lists',
            'retention',
            null,
            '(KEEP 7 YEARS) quarterly report',
            ['KEEP_7Y'],
        ],
    ])(
        'a marked input writes %s as one mark and reads it back with no fact lost',
        async (_, scopes, format, written, read) => {
            const { el, field } = await mountField<MarkedInput>(`
                <input id="field" data-ezclassify-controller="marked-input"
                       data-ezclassify-scope="${scopes}"
                       ${format ? `data-ezclassify-format="${format}"` : ''}
                       value="quarterly report">`);

            field.setAssertions(facts);
            await demoRuntimeSettled();
            expect(el.value).toBe(written);
            expect(
                el
                    .closest('.marked-input-wrap')
                    ?.querySelector('.ez-validation-errors__message'),
            ).toBeNull();

            field.setValue(written);
            await demoRuntimeSettled();
            expect(el.value).toBe(written);
            expect(held(field.getAssertions())).toEqual(read);
        },
    );

    it('a marked text area reads a mark of the scopes it lists with no fact lost', async () => {
        const root = host();
        root.innerHTML = `
            <input type="hidden" id="document" data-ezclassify-marking>
            <textarea id="field" data-ezclassify-controller="marked-textarea"
                      data-ezclassify-bound-to="document"
                      data-ezclassify-scope="retention sensitivity"
                      data-ezclassify-format="kept"></textarea>`;
        root.querySelector('textarea')!.value =
            '(CONFIDENTIAL // KEEP 7 YEARS) First body.';
        forms = new EzClassifyUI(await keptContext(), { root });
        await demoRuntimeSettled();

        const [entry] = forms.store.getEntryIds!('document') ?? [];
        expect(entry).toBeDefined();
        expect(held(forms.store.get(entry!).assertions)).toEqual([
            'CONFIDENTIAL',
            'KEEP_7Y',
        ]);
    });

    it('a banner and a text view of one marking write both scopes in the format they name', async () => {
        const root = host();
        root.innerHTML = `
            <input type="hidden" id="m" data-ezclassify-marking>
            <div id="banner" data-ezclassify-controller="banner"
                 data-ezclassify-source="m"
                 data-ezclassify-scope="retention sensitivity"
                 data-ezclassify-format="kept"></div>
            <span id="text" data-ezclassify-controller="text"
                  data-ezclassify-source="m"
                  data-ezclassify-scope="retention sensitivity"
                  data-ezclassify-format="kept"></span>`;
        forms = new EzClassifyUI(await keptContext(), { root });
        await demoRuntimeSettled();
        await forms.store.publishAssertions('m', facts);
        await demoRuntimeSettled();

        await expect
            .poll(
                () =>
                    root.querySelector('#banner .status-banner-label')
                        ?.textContent,
            )
            .toBe('CONFIDENTIAL // KEEP 7 YEARS');
        expect(root.querySelector('#text')?.textContent).toBe(
            'CONFIDENTIAL // KEEP 7 YEARS',
        );
        expect(
            root.querySelector('#banner .status-banner-incomplete'),
        ).toBeNull();
    });

    it('a level view says it is incomplete when a bucket holds facts its scheme cannot write in the scopes', async () => {
        const plain = await connectDemoContext({
            draft: { scheme: SURFACES_SCHEME },
        });
        const root = host();
        root.innerHTML = `
            <div id="level" data-ezclassify-controller="banner"
                 data-ezclassify-aggregate
                 data-ezclassify-scope="retention sensitivity"
                 data-ezclassify-format="kept"></div>
            <section data-ezclassify-context="kept">
                <input type="hidden" id="a" data-ezclassify-marking>
            </section>
            <section data-ezclassify-context="plain">
                <input type="hidden" id="b" data-ezclassify-marking>
            </section>`;
        forms = new EzClassifyUI(
            { contexts: { kept: (await keptContext()) as never, plain } },
            { root },
        );
        await demoRuntimeSettled();
        await forms.store.publishAssertions('a', facts);
        await forms.store.publishAssertions('b', facts);
        await demoRuntimeSettled();

        const lines = () =>
            Array.from(
                root.querySelectorAll('#level .status-banner-bucket'),
            ).map((row) => [
                row.querySelector('.status-banner-bucket-label')?.textContent,
                row.querySelector('.status-banner-label')?.textContent,
            ]);
        // The plain scheme writes the keep only in its retention block, so no
        // one of its formats writes both scopes. Its bucket has nothing to
        // show, and the view says it may be missing a marking rather than
        // passing for the whole page.
        await expect
            .poll(() => lines())
            .toEqual([['kept: Surfaces', 'CONFIDENTIAL // KEEP 7 YEARS']]);
        expect(
            root.querySelector('#level .status-banner-incomplete'),
        ).not.toBeNull();
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
