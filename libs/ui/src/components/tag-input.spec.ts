/**
 * Unit tests for TagInput: mount, add-by-commit, chip removal (mouse and
 * keyboard), Backspace-pops-last, the native input event dispatch (Host Form
 * Contract), parity with the shared composer (footer present, no mode header),
 * and destroy cleanup.
 *
 * Mounted declaratively through EzClassifyUI (data-ezclassify-controller
 * markup), the same path every real consumer uses; this also exercises the
 * "tags" controller registration in component-factory/element-scanner.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    allSurfaces,
    leave,
    openSurface,
    press,
    resultValue,
    rowFor,
    rowLabels,
    rows,
    typeText,
} from './composer/composer-harness';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { LocalSchemeEngineAdapter } from '@ezclassify/types';
import { EzClassifyUI } from '../ezclassify-ui';
import { TagInput } from './tag-input';
import { Context } from '@ezclassify/engine';

function wait(ms = 60): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
}

/**
 * A small real (non-mocked) scheme so suggest()/process() behave like a genuine
 * engine: a single-select `level` category and a multi-select `caveat`
 * category, rendered as "LEVEL//CAVEAT,CAVEAT". Same shape as MarkingField's
 * test scheme, since TagInput inherits the identical whole-marking value
 * contract.
 */
function createTestEngine(): LocalSchemeEngineAdapter {
    return Context.fromComponents({
        scheme: {
            scheme: {
                id: 'ti-test',
                version: '1.0.0',
                name: 'TagInput Test',
                data: {
                    concepts: {
                        inline: [
                            {
                                id: 'U',
                                name: 'Unclassified',
                                views: { default: 'UNCLASSIFIED' },
                                categories: ['level'],
                                parents: [],
                                aliases: [],
                                position: 1,
                                rank: 1,
                            },
                            {
                                id: 'S',
                                name: 'Secret',
                                views: { default: 'SECRET' },
                                categories: ['level'],
                                parents: [],
                                aliases: [],
                                position: 2,
                                rank: 2,
                            },
                            {
                                id: 'NF',
                                name: 'No Foreign',
                                views: { default: 'NOFORN' },
                                categories: ['caveat'],
                                parents: [],
                                aliases: [],
                                position: 1,
                                rank: 1,
                            },
                            {
                                id: 'ORCON',
                                name: 'Originator Controlled',
                                views: { default: 'ORCON' },
                                categories: ['caveat'],
                                parents: [],
                                aliases: [],
                                position: 2,
                                rank: 1,
                            },
                            {
                                id: 'REL',
                                name: 'Releasable',
                                views: { default: 'REL' },
                                categories: ['caveat'],
                                parents: [],
                                aliases: [],
                                position: 3,
                                rank: 1,
                            },
                            {
                                id: 'USA',
                                name: 'United States',
                                views: { default: 'USA' },
                                categories: ['rel_countries'],
                                parents: [],
                                aliases: [],
                                position: 1,
                                rank: 1,
                            },
                            {
                                id: 'GBR',
                                name: 'United Kingdom',
                                views: { default: 'GBR' },
                                categories: ['rel_countries'],
                                parents: [],
                                aliases: [],
                                position: 2,
                                rank: 1,
                            },
                        ],
                    },
                    categories: [
                        {
                            id: 'level',
                            label: 'Level',
                            required: false,
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
                        {
                            id: 'rel_countries',
                            label: 'REL Countries',
                            required: false,
                            single: false,
                            rollup: 'union',
                            position: 3,
                        },
                    ],
                },
                rules: [
                    {
                        id: 'rel-countries-require-rel',
                        when: {
                            category: 'rel_countries',
                            is: 'has_content',
                        },
                        action: 'require',
                        target: 'REL',
                        category: 'caveat',
                    },
                ],
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
                            // REL heads rel_countries. A header and the list it
                            // heads are paired in the format tree: one
                            // fixed-concept field beside one list field.
                            fields: [
                                { category: 'level', separator: '/' },
                                {
                                    category: 'caveat',
                                    separator: '/',
                                    exclude_concepts: ['REL'],
                                },
                                {
                                    name: 'Releasability phrase',
                                    separator: '//',
                                    fields: [
                                        { concept: 'REL', category: 'caveat' },
                                        {
                                            category: 'rel_countries',
                                            separator: '/',
                                        },
                                    ],
                                },
                            ],
                        },
                    ],
                },
            },
        },
    }).scheme as LocalSchemeEngineAdapter;
}

/**
 * The same scheme as `createTestEngine`, but returning the raw `Context` (not
 * narrowed to `.scheme`) so favorites tests can mount TagInput directly via
 * `.init()`: favorites config is a plain JS function with no declarative
 * `data-ezclassify-*` attribute equivalent, the same reasoning
 * `inline-marking-editor.spec.ts` already documents for its own direct mounts.
 */
function createTestContext(): Context {
    return Context.fromComponents({
        scheme: {
            scheme: {
                id: 'ti-fav-test',
                version: '1.0.0',
                name: 'TagInput Favorites Test',
                data: {
                    concepts: {
                        inline: [
                            {
                                id: 'S',
                                name: 'Secret',
                                views: { default: 'SECRET' },
                                categories: ['level'],
                                parents: [],
                                aliases: [],
                                position: 1,
                                rank: 2,
                            },
                            {
                                id: 'NF',
                                name: 'No Foreign',
                                views: { default: 'NOFORN' },
                                categories: ['caveat'],
                                parents: [],
                                aliases: [],
                                position: 1,
                                rank: 1,
                            },
                        ],
                    },
                    categories: [
                        {
                            id: 'level',
                            label: 'Level',
                            required: false,
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

/**
 * A stand-in for `window.visualViewport` (jsdom has none). The iOS keyboard
 * shrinks and pans only the visual viewport; `window.innerHeight` stays put.
 */
class FakeVisualViewport extends EventTarget {
    width = 390;
    height = 844;
    offsetTop = 0;
    offsetLeft = 0;
}

function installVisualViewport(vv: FakeVisualViewport | undefined): void {
    Object.defineProperty(window, 'visualViewport', {
        configurable: true,
        value: vv,
    });
}

function viewportRect(top: number, bottom: number): DOMRect {
    return {
        left: 16,
        right: 374,
        top,
        bottom,
        width: 358,
        height: bottom - top,
        x: 16,
        y: top,
        toJSON: () => ({}),
    } as DOMRect;
}

/** Bottom edge the open list actually paints at: top plus its clamped height. */
function paintedBottom(dropdown: HTMLElement, items: HTMLElement): number {
    const top = Number.parseFloat(dropdown.style.top);
    return top + Number.parseFloat(items.style.maxHeight);
}

let root: HTMLDivElement;
let forms: EzClassifyUI | null = null;

/** Mount a single TagInput declaratively and return its input + instance. */
async function mountTagInput(
    initialValue = '',
): Promise<{ input: HTMLInputElement; tags: TagInput }> {
    root.innerHTML = `<input id="ti" type="text" data-ezclassify-controller="tags" value="${initialValue}" />`;
    forms = new EzClassifyUI(createTestEngine() as never, { root });
    await wait();
    const input = document.getElementById('ti') as HTMLInputElement;
    const tags = (
        forms as unknown as {
            autocompleters: Map<HTMLInputElement, TagInput>;
        }
    ).autocompleters.get(input) as TagInput;
    expect(tags).toBeInstanceOf(TagInput);
    return { input, tags };
}

/**
 * Mount a TagInput from an arbitrary `data-ezclassify-*` attribute string, for
 * cases mountTagInput's fixed "tags" markup can't exercise (extra controller
 * options).
 */
async function mountTagInputWith(
    controllerAttrs: string,
    initialValue = '',
): Promise<{ input: HTMLInputElement; tags: TagInput }> {
    root.innerHTML = `<input id="ti" type="text" ${controllerAttrs} value="${initialValue}" />`;
    forms = new EzClassifyUI(createTestEngine() as never, { root });
    await wait();
    const input = document.getElementById('ti') as HTMLInputElement;
    const tags = (
        forms as unknown as {
            autocompleters: Map<HTMLInputElement, TagInput>;
        }
    ).autocompleters.get(input) as TagInput;
    expect(tags).toBeInstanceOf(TagInput);
    return { input, tags };
}

/**
 * Jsdom has no ClipboardEvent/DataTransfer constructors, so a real paste event
 * can't be built the way a browser would deliver one. Fake the one property
 * TagInput's paste handler actually reads.
 */
function makePasteEvent(text: string): Event {
    const evt = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(evt, 'clipboardData', {
        value: { getData: () => text },
        configurable: true,
    });
    return evt;
}

beforeEach(() => {
    root = document.createElement('div');
    document.body.appendChild(root);
    // jsdom does not implement scrollIntoView; the dropdown render calls it
    // when a highlighted item is present.
    Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
    forms?.destroy();
    forms = null;
    root.remove();
    vi.restoreAllMocks();
});

describe('TagInput', () => {
    it('preserves its own native host appearance instead of replacing it with library colors', async () => {
        root.innerHTML = `
            <input style="background-color: pink" />
            <input id="ti" type="text" data-ezclassify-controller="tags"
                style="background-color: rgb(242, 244, 246); color: rgb(20, 30, 40); border: 2px solid rgb(60, 70, 80); border-radius: 9px; font: 18px Georgia; min-height: 48px" />`;
        forms = new EzClassifyUI(createTestEngine() as never, { root });
        await wait();
        const wrap = root.querySelector<HTMLElement>('.tag-input-wrap')!;
        expect(wrap.style.backgroundColor).toBe('rgb(242, 244, 246)');
        expect(wrap.style.color).toBe('rgb(20, 30, 40)');
        expect(wrap.style.borderColor).toBe('rgb(60, 70, 80)');
        expect(wrap.style.borderWidth).toBe('2px');
        expect(wrap.style.borderRadius).toBe('9px');
        expect(wrap.style.fontFamily).toBe('Georgia');
        expect(wrap.style.minHeight).toBe('48px');
        const drawer = wrap.querySelector<HTMLElement>('.ez-field-drawer')!;
        expect(drawer.style.backgroundColor).toBe(wrap.style.backgroundColor);
        expect(
            drawer.style.getPropertyValue('--ez-field-drawer-border-color'),
        ).toBe(wrap.style.borderColor);
    });

    it('follows native host style changes and stops observing after teardown', async () => {
        const { input } = await mountTagInputWith(
            'data-ezclassify-controller="tags" style="background-color: rgb(240, 240, 240)"',
        );
        const wrap = root.querySelector<HTMLElement>('.tag-input-wrap')!;
        input.style.backgroundColor = 'rgb(30, 40, 50)';
        input.style.borderColor = 'rgb(120, 130, 140)';
        await wait();
        expect(wrap.style.backgroundColor).toBe('rgb(30, 40, 50)');
        expect(wrap.style.borderColor).toBe('rgb(120, 130, 140)');
        expect(
            wrap.querySelector<HTMLElement>('.ez-field-drawer')!.style
                .backgroundColor,
        ).toBe('rgb(30, 40, 50)');
        forms!.destroy();
        forms = null;
        expect(input.style.display).not.toBe('none');
        expect(input.style.backgroundColor).toBe('rgb(30, 40, 50)');
        input.style.backgroundColor = 'rgb(50, 60, 70)';
        await wait();
        expect(wrap.style.backgroundColor).toBe('rgb(30, 40, 50)');
    });

    it('follows a nested host theme without changing the document theme', async () => {
        const sheet = document.createElement('style');
        sheet.textContent =
            '.native-theme input { background-color: rgb(240, 240, 240) } .native-theme.dark input { background-color: rgb(30, 40, 50) }';
        document.head.appendChild(sheet);
        try {
            root.className = 'native-theme';
            await mountTagInput();
            const wrap = root.querySelector<HTMLElement>('.tag-input-wrap')!;
            expect(wrap.style.backgroundColor).toBe('rgb(240, 240, 240)');
            root.classList.add('dark');
            await wait();
            expect(wrap.style.backgroundColor).toBe('rgb(30, 40, 50)');
        } finally {
            sheet.remove();
        }
    });

    it('retains the explicit library-styled input opt-in', async () => {
        root.innerHTML =
            '<input style="background-color: pink" /><div id="mount"></div>';
        const component = new TagInput();
        const mount = root.querySelector<HTMLDivElement>('#mount')!;
        try {
            await component.init(mount, createTestEngine() as never, {
                styleInputs: true,
            });
            expect(mount.classList.contains('ez-styled-inputs')).toBe(true);
            expect(
                mount.querySelector<HTMLElement>('.tag-input-wrap')!.style
                    .backgroundColor,
            ).toBe('');
        } finally {
            component.destroy();
        }
    });

    it('lets a forced component palette override the host and restores host colors in auto mode', async () => {
        root.innerHTML =
            '<input style="background-color: pink" /><div id="mount"></div>';
        const component = new TagInput();
        const mount = root.querySelector<HTMLDivElement>('#mount')!;
        try {
            await component.init(mount, createTestEngine() as never, {
                colorScheme: 'dark',
            });
            const wrap = mount.querySelector<HTMLElement>('.tag-input-wrap')!;
            const drawer = wrap.querySelector<HTMLElement>('.ez-field-drawer')!;
            expect(wrap.style.backgroundColor).toBe('');
            expect(drawer.style.backgroundColor).toBe('');
            component.setColorScheme('auto');
            await wait();
            expect(wrap.style.backgroundColor).toBe('rgb(255, 192, 203)');
            expect(drawer.style.backgroundColor).toBe(
                wrap.style.backgroundColor,
            );
            component.setColorScheme('dark');
            await wait();
            expect(wrap.style.backgroundColor).toBe('');
            expect(drawer.style.backgroundColor).toBe('');
            expect(
                drawer.style.getPropertyValue('--ez-field-drawer-border-color'),
            ).toBe('');
        } finally {
            component.destroy();
        }
    });

    it('mounts, hiding the native input and rendering a filter input inside a chip wrap', async () => {
        const { input } = await mountTagInput('SECRET');

        expect(input.style.display).toBe('none');
        const wrap = root.querySelector('.tag-input-wrap') as HTMLDivElement;
        expect(wrap).not.toBeNull();
        const filter = wrap.querySelector(
            '.tag-input-filter',
        ) as HTMLInputElement;
        expect(filter).not.toBeNull();
        expect(filter.getAttribute('role')).toBe('combobox');
        expect(filter.getAttribute('aria-autocomplete')).toBe('list');

        // The seeded value renders as a chip, not raw text in the filter.
        const chip = wrap.querySelector('.proto-tag') as HTMLElement;
        expect(chip).not.toBeNull();
        expect(chip.textContent).toContain('SECRET');
        expect(filter.value).toBe('');
    });

    it('shows a concept dwell tooltip on chip hover', async () => {
        await mountTagInput('SECRET');
        const chip = root.querySelector('.proto-tag') as HTMLElement;

        expect(document.body.querySelector('.ez-tooltip')).toBeNull();
        chip.dispatchEvent(new Event('mouseenter'));
        await wait(350);

        const tip = document.body.querySelector(
            '.ez-tooltip',
        ) as HTMLElement | null;
        expect(tip).not.toBeNull();
        expect(tip!.hidden).toBe(false);

        chip.dispatchEvent(new Event('mouseleave'));
        await wait();
        expect(tip!.hidden).toBe(true);
    });

    it('honors the data-ezclassify-no-tooltips opt-out for chips', async () => {
        const { input } = await mountTagInputWith(
            'data-ezclassify-controller="tags" data-ezclassify-no-tooltips',
            'SECRET',
        );
        expect(input).not.toBeNull();
        const chip = root.querySelector('.proto-tag') as HTMLElement;
        chip.dispatchEvent(new Event('mouseenter'));
        await wait(350);

        expect(document.body.querySelector('.ez-tooltip')).toBeNull();
    });

    it('opens the picker on a request (ArrowDown or a press), listing available concepts, but not on focus alone', async () => {
        await mountTagInput('');
        const filter = root.querySelector(
            '.tag-input-filter',
        ) as HTMLInputElement;
        filter.focus();
        await wait();
        // Focus alone never opens it: a keyboard user tabbing through a form
        // must not have a popup land on every field.
        expect(openSurface()).toBeNull();

        press(filter, 'ArrowDown');
        await wait();
        expect(openSurface()).not.toBeNull();
        expect(rowLabels().length).toBeGreaterThan(0);
    });

    it('offers concepts from every category when no category binding is set', async () => {
        await mountTagInput('');
        const filter = root.querySelector(
            '.tag-input-filter',
        ) as HTMLInputElement;
        filter.focus();
        press(filter, 'ArrowDown');
        await wait();

        const labels = rowLabels();
        expect(labels).toContain('UNCLASSIFIED');
        expect(labels).toContain('SECRET');
        expect(labels).toContain('NOFORN');
        expect(labels).toContain('ORCON');
    });

    it('scopes the suggestion dropdown to the bound category', async () => {
        // A category-bound field offers only concepts accepted by that facet.
        await mountTagInputWith(
            'data-ezclassify-controller="tags" data-ezclassify-category="caveat"',
        );
        const filter = root.querySelector(
            '.tag-input-filter',
        ) as HTMLInputElement;
        filter.focus();
        press(filter, 'ArrowDown');
        await wait();

        const labels = rowLabels();
        expect(labels).toContain('NOFORN');
        expect(labels).toContain('ORCON');
        expect(labels).not.toContain('UNCLASSIFIED');
        expect(labels).not.toContain('SECRET');

        // The filtered (typing) path goes through the same scoping: typing a
        // query that matches an off-category concept surfaces nothing.
        typeText(filter, 'SEC');
        await wait();
        expect(rowLabels()).not.toContain('SECRET');
    });

    it('mounts the status mark + favorites button inside a bottom-hanging chrome drawer', async () => {
        // The mark and ★ button live in a small drawer attached to the field's
        // bottom-right edge, not floating over the chips.
        await mountTagInput('');
        const wrap = root.querySelector('.tag-input-wrap') as HTMLElement;
        const drawer = wrap.querySelector(':scope > .ez-field-drawer');
        expect(drawer).not.toBeNull();
        expect(drawer!.classList.contains('ez-field-drawer--bottom')).toBe(
            true,
        );
        const mark = drawer!.querySelector(':scope > .ez-status-mark');
        expect(mark).not.toBeNull();
        expect(mark!.classList.contains('ez-status-mark--chrome')).toBe(true);
    });

    it('mirrors the drawer to the top when the dropdown opens below the field (the default), and back on close', async () => {
        // The drawer sits on the edge opposite the picker. With jsdom's zero-size
        // layout the picker opens below, so the drawer moves to the free top edge.
        await mountTagInput('');
        const wrap = root.querySelector('.tag-input-wrap') as HTMLElement;
        const drawer = wrap.querySelector('.ez-field-drawer') as HTMLElement;
        const filter = root.querySelector(
            '.tag-input-filter',
        ) as HTMLInputElement;
        expect(drawer.classList.contains('ez-field-drawer--bottom')).toBe(true);

        filter.focus();
        press(filter, 'ArrowDown');
        await wait();

        const surface = openSurface()!;
        expect(surface.dataset.side).toBe('below');
        expect(drawer.classList.contains('ez-field-drawer--top')).toBe(true);
        expect(drawer.classList.contains('ez-field-drawer--bottom')).toBe(
            false,
        );

        await leave(filter);

        expect(drawer.classList.contains('ez-field-drawer--bottom')).toBe(true);
        expect(drawer.classList.contains('ez-field-drawer--top')).toBe(false);
    });

    it('the drawer classes actually resolve to opposite physical edges (not just opposite names)', () => {
        // Geometry, not just class names: jsdom has no layout engine and
        // (per tag-input's own keyboard-hint CSS-source test below) doesn't
        // apply the author stylesheet cascade to getComputedStyle for a
        // plain <style> injection, so this reads the real CSS source: same
        // pattern used there. A class-name assertion alone could pass while
        // the surface is unusable; this would
        // catch someone swapping the --top/--bottom rule BODIES (the tests
        // around this one only prove the JS picks the right CLASS NAME; this
        // proves that class name still means what it says on screen).
        const here = dirname(fileURLToPath(import.meta.url));
        const css = readFileSync(join(here, 'field-chrome-drawer.css'), 'utf8');
        expect(css).toMatch(
            /\.ez-field-drawer--bottom\s*\{[^}]*top:\s*calc\(100% - var\(--ez-field-margin-bottom, 0px\)\)/,
        );
        expect(css).toMatch(
            /\.ez-field-drawer--top\s*\{[^}]*bottom:\s*calc\(100% - var\(--ez-field-margin-top, 0px\)\)/,
        );
    });

    it('keeps the focus ring inside the field border and continues it onto the drawer', () => {
        // The inset focus ring stays inside the field border and continues onto
        // the drawer in either orientation. The drawer carries the same ring
        // color so the compound shape reads as one highlighted unit.
        const here = dirname(fileURLToPath(import.meta.url));
        const css = readFileSync(join(here, 'tag-input.css'), 'utf8');
        expect(css).toMatch(
            /\.tag-input-wrap:focus-within:not\(:has\(> \.ez-clear-button:focus\)\)\s*\{[^}]*outline-offset:\s*-2px/,
        );
        expect(css).toMatch(
            /\.tag-input-wrap:focus-within:not\(:has\(> \.ez-clear-button:focus\)\)\s*>\s*\.ez-field-drawer\s*\{[^}]*border-color:/,
        );
    });

    it('keeps the drawer at the bottom when the dropdown flips open above the field, so neither hides the other', async () => {
        await mountTagInput('');
        const wrap = root.querySelector('.tag-input-wrap') as HTMLElement;
        const drawer = wrap.querySelector('.ez-field-drawer') as HTMLElement;
        const filter = root.querySelector(
            '.tag-input-filter',
        ) as HTMLInputElement;

        // Pin the field off the bottom of the (jsdom default 768px) viewport
        // so spaceBelow goes negative and the picker must open above.
        const offBottom = {
            top: 900,
            bottom: 950,
            left: 10,
            right: 300,
            width: 290,
            height: 50,
            x: 10,
            y: 900,
            toJSON: () => ({}),
        } as DOMRect;
        wrap.getBoundingClientRect = () => offBottom;
        filter.getBoundingClientRect = () => offBottom;

        filter.focus();
        press(filter, 'ArrowDown');
        await wait();

        expect(openSurface()!.dataset.side).toBe('above');
        // The picker occupies the field's TOP edge, so the drawer stays on
        // the bottom: moving it to the same top edge would bury
        // it under the opaque, higher-z-index picker.
        expect(drawer.classList.contains('ez-field-drawer--bottom')).toBe(true);
        expect(drawer.classList.contains('ez-field-drawer--top')).toBe(false);

        await leave(filter);

        expect(drawer.classList.contains('ez-field-drawer--bottom')).toBe(true);
        expect(drawer.classList.contains('ez-field-drawer--top')).toBe(false);
    });

    it('adds an assertion and a chip when a picked suggestion is committed', async () => {
        const { tags } = await mountTagInput('');
        const filter = root.querySelector(
            '.tag-input-filter',
        ) as HTMLInputElement;
        filter.focus();
        typeText(filter, 'SEC');
        await wait(100);

        const row = rowFor('SECRET')!;
        expect(row).toBeTruthy();
        row.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        await wait();
        // The press fills the draft; the commit table stores on Enter.
        expect(tags.getAssertions()).toEqual([]);
        press(filter, 'Enter');
        await wait(100);

        expect(tags.getAssertions().map((a) => a.conceptId)).toEqual(['S']);
        const chip = root.querySelector('.proto-tag') as HTMLElement;
        expect(chip.textContent).toContain('SECRET');
        expect(filter.value).toBe('');
        // No separator or marking-syntax text ever appears between chips.
        expect(root.querySelector('.proto-sep')).toBeNull();
    });

    it('removes a chip with the mouse via its remove button', async () => {
        const { tags } = await mountTagInput('SECRET//NOFORN');
        expect(tags.getAssertions().length).toBe(2);

        const chips = Array.from(root.querySelectorAll('.proto-tag'));
        const nofornChip = chips.find((c) =>
            c.textContent?.includes('NOFORN'),
        ) as HTMLElement;
        const removeBtn = nofornChip.querySelector(
            '.proto-tag-remove',
        ) as HTMLButtonElement;
        expect(removeBtn).not.toBeNull();
        removeBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        await wait();

        expect(
            tags
                .getAssertions()
                .map((a) => a.conceptId)
                .sort(),
        ).toEqual(['S']);
    });

    it('removing a header chip also removes its owned assertions before inference can restore it', async () => {
        const { input, tags } = await mountTagInput('SECRET//REL//USA/GBR');
        const relChip = Array.from(root.querySelectorAll('.proto-tag')).find(
            (chip) => chip.textContent?.includes('REL'),
        ) as HTMLElement;
        const removeBtn = relChip.querySelector(
            '.proto-tag-remove',
        ) as HTMLButtonElement;

        removeBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        await wait();

        expect(tags.getAssertions().map((a) => a.conceptId)).toEqual(['S']);
        expect(input.value).toBe('SECRET');
    });

    it('shows selected concepts as checked picker rows and removes one when tapped', async () => {
        const { input, tags } = await mountTagInput('SECRET//REL//USA/GBR');
        const filter = root.querySelector(
            '.tag-input-filter',
        ) as HTMLInputElement;

        filter.focus();
        press(filter, 'ArrowDown');
        await wait(80);

        const checkedRows = rows().filter(
            (r) => r.getAttribute('aria-selected') === 'true',
        );
        expect(checkedRows.length).toBeGreaterThanOrEqual(2);
        const relRow = rowFor('REL')!;
        expect(relRow.getAttribute('aria-selected')).toBe('true');
        expect(relRow.querySelector('.ez-composer__check')?.textContent).toBe(
            '\u2713',
        );
        expect(relRow.textContent).toContain('removes it');

        relRow.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        await wait(100);
        // The removal is in the draft; nothing is stored until the commit.
        expect(input.value).toBe('SECRET//REL//USA/GBR');
        press(filter, 'Enter');
        await wait(100);

        expect(tags.getAssertions().map((a) => a.conceptId)).toEqual(['S']);
        expect(input.value).toBe('SECRET');
    });

    it('removes a focused chip with Backspace/Delete (keyboard roving focus)', async () => {
        const { tags } = await mountTagInput('SECRET//NOFORN');
        const chips = Array.from(
            root.querySelectorAll('.proto-tag'),
        ) as HTMLSpanElement[];
        expect(chips.length).toBe(2);
        const nofornChip = chips.find((c) =>
            c.textContent?.includes('NOFORN'),
        )!;

        nofornChip.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        await wait();
        expect(nofornChip.classList.contains('active')).toBe(true);

        nofornChip.dispatchEvent(
            new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true }),
        );
        await wait();

        expect(
            tags
                .getAssertions()
                .map((a) => a.conceptId)
                .sort(),
        ).toEqual(['S']);
    });

    it('roves focus between chips with Left/Right arrows', async () => {
        await mountTagInput('SECRET//NOFORN');
        const chips = Array.from(
            root.querySelectorAll('.proto-tag'),
        ) as HTMLSpanElement[];
        expect(chips.length).toBe(2);

        chips[0].dispatchEvent(new MouseEvent('click', { bubbles: true }));
        await wait();
        expect(chips[0].classList.contains('active')).toBe(true);

        chips[0].dispatchEvent(
            new KeyboardEvent('keydown', {
                key: 'ArrowRight',
                bubbles: true,
            }),
        );
        await wait();
        expect(chips[0].classList.contains('active')).toBe(false);
        expect(chips[1].classList.contains('active')).toBe(true);

        chips[1].dispatchEvent(
            new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }),
        );
        await wait();
        expect(chips[1].classList.contains('active')).toBe(false);
        expect(chips[0].classList.contains('active')).toBe(true);
    });

    it('Backspace in an empty filter removes the last chip', async () => {
        const { tags } = await mountTagInput('SECRET//NOFORN');
        const filter = root.querySelector(
            '.tag-input-filter',
        ) as HTMLInputElement;
        expect(filter.value).toBe('');

        filter.dispatchEvent(
            new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true }),
        );
        await wait();

        // Backspace-on-empty-filter focuses the last chip first (Gmail-style),
        // it does not delete on the very first press.
        const chips = Array.from(
            root.querySelectorAll('.proto-tag'),
        ) as HTMLSpanElement[];
        const lastChip = chips[chips.length - 1];
        expect(lastChip.classList.contains('active')).toBe(true);

        lastChip.dispatchEvent(
            new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true }),
        );
        await wait();

        expect(tags.getAssertions().length).toBe(1);
    });

    it('dispatches a bubbling native input event when a chip is added, carrying the rendered marking', async () => {
        const { input } = await mountTagInput('');
        const filter = root.querySelector(
            '.tag-input-filter',
        ) as HTMLInputElement;

        let firedValue: string | null = null;
        input.addEventListener('input', () => {
            firedValue = input.value;
        });

        filter.focus();
        typeText(filter, 'SEC');
        await wait(100);
        rowFor('SECRET')!.dispatchEvent(
            new MouseEvent('click', { bubbles: true }),
        );
        await wait();
        expect(firedValue).toBeNull();
        press(filter, 'Enter');
        await wait(100);

        expect(firedValue).toBe('SECRET');
        expect(input.value).toBe('SECRET');
    });

    it('shares the picker footer with every other field and never shows a mode header', async () => {
        await mountTagInput('');
        const filter = root.querySelector(
            '.tag-input-filter',
        ) as HTMLInputElement;
        filter.focus();
        press(filter, 'ArrowDown');
        await wait();

        const surface = openSurface()!;
        const footers = surface.querySelectorAll('.ez-composer__footer');
        expect(footers.length).toBe(1);
        expect(footers[0].textContent).toContain('Enter');
        expect(footers[0].getAttribute('aria-hidden')).toBe('true');
        expect(surface.querySelector('[class*="mode-header"]')).toBeNull();
    });

    it('cleans up on destroy: removes the portaled picker and restores the native input', async () => {
        const { input } = await mountTagInput('SECRET');
        expect(allSurfaces().length).toBeGreaterThan(0);

        forms?.destroy();
        forms = null;

        expect(allSurfaces()).toEqual([]);
        expect(root.querySelector('.tag-input-wrap')).toBeNull();
        expect(input.parentNode).not.toBeNull();
    });

    it("pressing Space on a focused chip's remove button removes the chip (not just Enter)", async () => {
        const { tags } = await mountTagInput('SECRET//NOFORN');
        const chips = Array.from(
            root.querySelectorAll('.proto-tag'),
        ) as HTMLSpanElement[];
        const nofornChip = chips.find((c) =>
            c.textContent?.includes('NOFORN'),
        )!;

        nofornChip.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        await wait();
        const removeBtn = nofornChip.querySelector(
            '.proto-tag-remove',
        ) as HTMLButtonElement;
        expect(removeBtn.tabIndex).toBe(0);

        // Space's keydown must NOT redirect focus to the filter input when it
        // targets the remove button itself: that would move focus off the
        // button before its own keyup-triggered click fires, and the chip
        // would never be removed. Dispatch directly on the button, as a real
        // keyboard interaction would, so the bubble path through the chip's
        // handler is exercised with the button as e.target.
        removeBtn.dispatchEvent(
            new KeyboardEvent('keydown', {
                key: ' ',
                bubbles: true,
                cancelable: true,
            }),
        );
        // A real browser fires the button's click on the Space keyup; jsdom
        // does not synthesize that activation, so fire it explicitly to
        // finish the interaction the same way a real Space press would.
        removeBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        await wait();

        expect(
            tags
                .getAssertions()
                .map((a) => a.conceptId)
                .sort(),
        ).toEqual(['S']);
    });

    it('does not steal focus to the filter input when Space targets the remove button', async () => {
        await mountTagInput('SECRET');
        const chip = root.querySelector('.proto-tag') as HTMLSpanElement;
        chip.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        await wait();
        const removeBtn = chip.querySelector(
            '.proto-tag-remove',
        ) as HTMLButtonElement;
        const filter = root.querySelector(
            '.tag-input-filter',
        ) as HTMLInputElement;

        removeBtn.dispatchEvent(
            new KeyboardEvent('keydown', {
                key: ' ',
                bubbles: true,
                cancelable: true,
            }),
        );

        expect(document.activeElement).not.toBe(filter);
    });

    it('pasting a whole marking into an empty filter drafts it as the whole value; Enter replaces the chip set', async () => {
        const { tags } = await mountTagInput('UNCLASSIFIED//ORCON');
        const filter = root.querySelector(
            '.tag-input-filter',
        ) as HTMLInputElement;
        filter.focus();

        filter.dispatchEvent(makePasteEvent('SECRET//NOFORN'));
        await wait(60);
        // Shown before it is stored: the result row reads the paste alone,
        // and the chips it drops are marked.
        expect(resultValue()).toBe('SECRET//NOFORN');
        expect(
            [
                ...openSurface()!.querySelectorAll(
                    '.ez-composer__change--removed',
                ),
            ].map((m) => m.textContent),
        ).toEqual(['\u2212 UNCLASSIFIED', '\u2212 ORCON']);
        expect(
            tags
                .getAssertions()
                .map((a) => a.conceptId)
                .sort(),
        ).toEqual(['ORCON', 'U']);

        press(filter, 'Enter');
        await wait(100);
        expect(
            tags
                .getAssertions()
                .map((a) => a.conceptId)
                .sort(),
        ).toEqual(['NF', 'S']);
        expect(filter.value).toBe('');
        expect(tags.getRendered()).toBe('SECRET//NOFORN');
    });

    it('pasting text that is not a recognizable marking lands as ordinary filter text', async () => {
        const { tags } = await mountTagInput('');
        const filter = root.querySelector(
            '.tag-input-filter',
        ) as HTMLInputElement;
        filter.focus();

        filter.dispatchEvent(makePasteEvent('not a marking at all'));
        await wait(60);

        expect(tags.getAssertions()).toEqual([]);
        expect(filter.value).toBe('not a marking at all');
    });

    it('a loaded value it cannot fully read is edited whole from the filter', async () => {
        const { input } = await mountTagInput('SECRET//BOGUS');
        expect(input.value).toBe('SECRET//BOGUS');
        const filter = root.querySelector(
            '.tag-input-filter',
        ) as HTMLInputElement;
        filter.focus();
        await wait(100);
        expect(filter.value).toBe('SECRET//BOGUS');
    });

    /**
     * TagInput's text adds to its chips. Typing changes only the draft and the
     * result row; the chips and getAssertions() change at a commit, the same
     * commit table as every other field (Enter, or leaving the field).
     */
    it("the filter box's own typing never mutates assertions; only a commit does", async () => {
        const { tags } = await mountTagInput('SECRET//NOFORN');
        const filter = root.querySelector(
            '.tag-input-filter',
        ) as HTMLInputElement;
        const ids = () =>
            tags
                .getAssertions()
                .map((a) => a.conceptId)
                .sort();
        const before = ids();
        expect(before).toEqual(['NF', 'S']);

        // Typing another concept's label exactly changes nothing stored,
        // however complete the draft reads.
        filter.focus();
        typeText(filter, 'UNCLASSIFIED');
        await wait(100);
        expect(ids()).toEqual(before);
        expect(resultValue()).toBe('UNCLASSIFIED//NOFORN');

        // Deleting the typed text changes nothing either.
        typeText(filter, '');
        await wait(100);
        expect(ids()).toEqual(before);

        // Leaving with text that does not read stores nothing and keeps the
        // text on screen, marked invalid.
        typeText(filter, 'zzz');
        await wait(100);
        await leave(filter);
        expect(ids()).toEqual(before);
        expect(filter.value).toBe('zzz');
        expect(filter.getAttribute('aria-invalid')).toBe('true');

        // Leaving with a complete draft is the commit, the same one Enter
        // makes in every other field.
        filter.focus();
        typeText(filter, 'UNCLASSIFIED');
        await wait(100);
        await leave(filter);
        expect(ids()).toEqual(['NF', 'U']);
    });

    /**
     * The composer's catalog is asked for without the marking as context, so a
     * concept the user is typing never drops out of the list because the draft
     * already reads it.
     */
    it('typed filter text never hides the concept being typed from the list', async () => {
        await mountTagInput('SECRET//NOFORN');
        const filter = root.querySelector(
            '.tag-input-filter',
        ) as HTMLInputElement;
        filter.focus();

        // ORCON is unaccepted and in a multi-select category, so nothing
        // about SECRET//NOFORN already committed should suppress it: it
        // must keep showing while the user types its own name.
        typeText(filter, 'ORCON');
        await wait(150);

        expect(rowLabels()).toContain('ORCON');
    });

    it('renders a live preview bar only when the host opts in via show-preview', async () => {
        const { input } = await mountTagInputWith(
            'data-ezclassify-controller="tags" data-ezclassify-tags-show-preview',
            'SECRET//NOFORN',
        );
        await wait();
        const preview = root.querySelector('.proto-preview');
        expect(preview).not.toBeNull();
        expect(preview!.textContent).toBe('SECRET//NOFORN');
        expect(input.value).toBe('SECRET//NOFORN');
    });

    it('renders no preview bar by default', async () => {
        await mountTagInput('SECRET');
        expect(root.querySelector('.proto-preview')).toBeNull();
    });

    it('opts out of category color coding via data-ezclassify-tags-color-coding="false"', async () => {
        await mountTagInputWith(
            'data-ezclassify-controller="tags" data-ezclassify-tags-color-coding="false"',
            'SECRET',
        );
        const chip = root.querySelector('.proto-tag') as HTMLElement;
        expect(chip.style.getPropertyValue('--ez-tag-bg')).toBe('');
    });
});

describe('TagInput on a phone with the on-screen keyboard up', () => {
    afterEach(() => {
        installVisualViewport(undefined);
    });

    it('repositions the open list inside the shrunken visual viewport', async () => {
        const vv = new FakeVisualViewport();
        installVisualViewport(vv);
        await mountTagInput();
        const wrap = root.querySelector('.tag-input-wrap') as HTMLElement;
        const filter = root.querySelector(
            '.tag-input-filter',
        ) as HTMLInputElement;
        wrap.getBoundingClientRect = () => viewportRect(300, 340);
        filter.getBoundingClientRect = () => viewportRect(300, 340);
        filter.focus();
        press(filter, 'ArrowDown');
        await wait();
        const surface = openSurface() as HTMLDivElement;
        const items = surface.querySelector(
            '.ez-composer__scroll',
        ) as HTMLDivElement;
        // jsdom lays nothing out; give the list a real natural height.
        Object.defineProperty(items, 'scrollHeight', {
            configurable: true,
            value: 400,
        });

        vv.height = 450;
        vv.dispatchEvent(new Event('resize'));

        // The side is chosen once per open, but the keyboard left less than
        // a usable list's room below the field, so the list moves above once
        // rather than sit under the keyboard or over the field.
        expect(surface.dataset.side).toBe('above');
        expect(Number.parseFloat(surface.style.top)).toBeGreaterThanOrEqual(8);
        expect(paintedBottom(surface, items)).toBeLessThanOrEqual(300);
    });
});

describe('TagInput CSS: keyboard-hint reveal and coarse-pointer chip spacing target the actual wrap class', () => {
    // jsdom does not apply the author-stylesheet cascade for pseudo-class
    // selectors like :focus-within (verified empirically: getComputedStyle
    // never reflects rules from an injected <style> here, regardless of
    // focus state), so a rendered/computed-style assertion can't catch a
    // stale selector the way it could in a real browser. This asserts
    // directly against the source CSS instead, read from disk since the
    // `?inline` import is stubbed to an empty string under the test
    // transform (see mobile-font-floor.spec.ts for the same pattern): the
    // class TagInput actually applies to its wrap (see the "mounts" test
    // above) must be the class these rules target, so a future rename of one
    // without the other fails loudly here instead of shipping an invisible
    // hint bar again.
    const here = dirname(fileURLToPath(import.meta.url));
    const readCss = (name: string): string =>
        readFileSync(join(here, name), 'utf8');

    it('reveals the keyboard hints inside the ★ drawer, not via a hover/focus-within floating pill', () => {
        // Keyboard hints are visible inside the drawer. Drawer-scoped styling
        // must not depend on hover or focus-within selectors on the field wrapper.
        const css = readCss('component-utils.css');
        expect(css).toContain('.ez-field-drawer > .proto-kbd-hints');
        expect(css).not.toContain(
            '.tag-input-wrap:focus-within > .proto-kbd-hints',
        );
        expect(css).not.toContain('.tag-input-wrap:hover > .proto-kbd-hints');
        expect(css).not.toContain('.autocomplete-wrap');
    });

    it('keeps the key hints off the top-edge drawer, where the label sits', () => {
        // The drawer mirrors to the top edge while the composer is open below
        // or an error list is showing, and there it hangs into the label's
        // line. Only the status mark and star go with it.
        const css = readCss('component-utils.css');
        expect(css).toMatch(
            /\.ez-field-drawer--top > \.proto-kbd-hints \{\s*display: none;/,
        );
        expect(
            css.indexOf('.ez-field-drawer--top > .proto-kbd-hints'),
        ).toBeGreaterThan(css.indexOf('.ez-field-drawer > .proto-kbd-hints'));
    });

    /**
     * Simulates the CSS cascade for one property on one selector across an
     * arbitrary number of concatenated stylesheets, the way a browser actually
     * resolves it: last declaration wins at equal specificity, in document
     * order, including declarations reached only through a matching @media
     * block. This exists because jsdom's `getComputedStyle` does not consult an
     * injected `<style>` element's rules at all here (verified empirically; see
     * the drawer-geometry test above), so a `getComputedStyle` assertion on a
     * mounted component would pass regardless of what the CSS actually says.
     * Walking `CSSStyleSheet. cssRules` directly sidesteps that gap: it's real
     * CSS parsing (jsdom supports it), not layout or style application, so it
     * reflects genuine cascade behavior, including a shorthand like `gap: 0` in
     * a LATER stylesheet silently winning over an earlier `row-gap` set by
     * itself, exactly the defect this guards against (component-utils.css's
     * `row-gap` rule was dead in production because tag-input.css's
     * `.tag-input-wrap { gap: 0; }` always loads after it in the real
     * `COMPONENT_CSS + tagInputCss` concatenation and wins on source order).
     */
    function cascadedGap(
        cssFiles: string[],
        selector: string,
        coarsePointer: boolean,
    ): { rowGap?: string; columnGap?: string } {
        const style = document.createElement('style');
        style.textContent = cssFiles.join('\n');
        document.head.appendChild(style);
        let rowGap: string | undefined;
        let columnGap: string | undefined;
        const applyDeclarations = (decl: CSSStyleDeclaration) => {
            const gap = decl.getPropertyValue('gap');
            if (gap) {
                rowGap = gap;
                columnGap = gap;
            }
            const rg = decl.getPropertyValue('row-gap');
            if (rg) rowGap = rg;
            const cg = decl.getPropertyValue('column-gap');
            if (cg) columnGap = cg;
        };
        const walk = (rules: CSSRuleList) => {
            for (const rule of Array.from(rules)) {
                if (rule instanceof CSSMediaRule) {
                    const isCoarseBlock = /pointer:\s*coarse/.test(
                        rule.conditionText,
                    );
                    if (isCoarseBlock && !coarsePointer) continue;
                    walk(rule.cssRules);
                } else if (
                    rule instanceof CSSStyleRule &&
                    rule.selectorText === selector
                ) {
                    applyDeclarations(rule.style);
                }
            }
        };
        walk((style.sheet as CSSStyleSheet).cssRules);
        document.head.removeChild(style);
        return { rowGap, columnGap };
    }

    it('resolves a real touch-safe row-gap on .tag-input-wrap through the ACTUAL injected concatenation order', () => {
        // injectComponentStyles emits COMPONENT_CSS + tagInputCss; read the
        // files in that order to match a mounted TagInput.
        const componentUtilsCss = readCss('component-utils.css');
        const tagInputCss = readCss('tag-input.css');
        const fine = cascadedGap(
            [componentUtilsCss, tagInputCss],
            '.tag-input-wrap',
            false,
        );
        expect(fine.rowGap).toBe('0.375rem');
        const coarse = cascadedGap(
            [componentUtilsCss, tagInputCss],
            '.tag-input-wrap',
            true,
        );
        // Wrapped chip rows on a phone need the larger gap or the enlarged
        // remove-button hit overlays (component-utils.css,
        // `.proto-tag-remove::after`) cross rows and a tap can remove the
        // wrong chip.
        expect(coarse.rowGap).toBe('0.5rem');
    });

    it('keeps picker short forms readable and lets a row wrap instead of clipping', () => {
        const style = document.createElement('style');
        style.textContent = readCss('composer/composer.css');
        document.head.appendChild(style);
        const find = (selector: string): CSSStyleDeclaration => {
            for (const rule of Array.from(
                (style.sheet as CSSStyleSheet).cssRules,
            )) {
                if (
                    rule instanceof CSSStyleRule &&
                    rule.selectorText === selector
                )
                    return rule.style;
            }
            throw new Error(`no rule found for ${selector}`);
        };
        expect(find('.ez-composer__line').getPropertyValue('flex-wrap')).toBe(
            'wrap',
        );
        const short = find('.ez-composer__short');
        expect(short.getPropertyValue('overflow-wrap')).toBe('anywhere');
        expect(short.getPropertyValue('text-overflow')).toBe('');
        // The category tag never shrinks away; the long form is what gives.
        expect(
            find('.ez-composer__category').getPropertyValue('flex-shrink'),
        ).toBe('0');
        document.head.removeChild(style);
    });

    it('styles picker rows and the no-match status only in the shared composer stylesheet', () => {
        // Every field's picker is the same composer, so its row and status
        // styling lives once, in the stylesheet that travels with the
        // portaled surface, never in one field's own CSS.
        const shared = readCss('composer/composer.css');
        const tagInputOnly = readCss('tag-input.css');
        expect(shared).toContain('.ez-composer__row');
        expect(shared).toContain('.ez-composer__status');
        expect(tagInputOnly).not.toContain('.ez-composer');
    });
});

describe('TagInput favorites', () => {
    /** Mount TagInput directly (see createTestContext's doc comment). */
    async function mountDirect(
        options: Parameters<TagInput['init']>[2] = {},
    ): Promise<{ input: HTMLInputElement; tags: TagInput }> {
        const container = document.createElement('div');
        root.appendChild(container);
        const input = document.createElement('input');
        input.type = 'text';
        container.appendChild(input);
        const tags = new TagInput();
        await tags.init(container, createTestContext(), options);
        return { input, tags };
    }

    it('renders no ★ button when favorites is not wired', async () => {
        await mountDirect();
        expect(root.querySelector('.ez-favorites-button')).toBeNull();
    });

    it('renders the ★ button and applies a favorite by REPLACING the whole chip set', async () => {
        const load = vi.fn(async () => [{ marking: 'SECRET//NOFORN' }]);
        const { input, tags } = await mountDirect({ favorites: { load } });
        await wait();

        const button = root.querySelector(
            '.ez-favorites-button',
        ) as HTMLButtonElement;
        expect(button).not.toBeNull();

        button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        await wait();
        const row = document.body.querySelector(
            '.ez-favorites-panel .proto-dropdown-item',
        ) as HTMLElement;
        row.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        await wait();

        expect(
            tags
                .getAssertions()
                .map((a) => a.conceptId)
                .sort(),
        ).toEqual(['NF', 'S']);
        expect(input.value).toBe('SECRET//NOFORN');
        expect(
            root.querySelectorAll('.proto-tag, [class*="tag"]').length,
        ).toBeGreaterThan(0);
    });

    it('offers Remove (not Save) when the current chip set already matches a loaded favorite', async () => {
        const remove = vi.fn(async () => {});
        const load = vi.fn(async () => [{ marking: 'SECRET' }]);
        const { tags } = await mountDirect({
            favorites: { load, save: vi.fn(), remove },
        });
        tags.setValue('SECRET');
        await wait();

        const button = root.querySelector(
            '.ez-favorites-button',
        ) as HTMLButtonElement;
        button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        await wait();

        const pinned = document.body.querySelector(
            '.ez-favorites-panel__pinned',
        ) as HTMLElement;
        expect(pinned.textContent?.toLowerCase()).toContain('remove');

        pinned.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        await wait();
        expect(remove).toHaveBeenCalledWith('SECRET');
    });
});

describe('TagInput keyboard hints in the ★ drawer', () => {
    /** Mount TagInput directly (see createTestContext's doc comment). */
    async function mountDirect(
        options: Parameters<TagInput['init']>[2] = {},
    ): Promise<{ input: HTMLInputElement; tags: TagInput }> {
        const container = document.createElement('div');
        root.appendChild(container);
        const input = document.createElement('input');
        input.type = 'text';
        container.appendChild(input);
        const tags = new TagInput();
        await tags.init(container, createTestContext(), options);
        return { input, tags };
    }

    it('mounts the hints inside the ★ drawer, ahead of the status mark, not floating over the chips', async () => {
        await mountDirect();
        const drawer = root.querySelector('.ez-field-drawer') as HTMLElement;
        expect(drawer).not.toBeNull();
        const hints = drawer.querySelector(':scope > .proto-kbd-hints');
        expect(hints).not.toBeNull();
        // Hints (left) must precede the status mark (right) as DOM order is
        // what gives the drawer's shrink-wrapped flex row its "hints left,
        // status+star right" layout.
        const statusMark = drawer.querySelector(':scope > .ez-status-mark');
        expect(statusMark).not.toBeNull();
        const children = [...drawer.children];
        expect(children.indexOf(hints as Element)).toBeLessThan(
            children.indexOf(statusMark as Element),
        );
        // Not a direct child of the chip wrap.
        const wrap = root.querySelector('.tag-input-wrap') as HTMLElement;
        expect(wrap.querySelector(':scope > .proto-kbd-hints')).toBeNull();
    });

    it('honors the no-hints opt-out: hints absent, status mark still present', async () => {
        await mountDirect({ hints: false });
        const drawer = root.querySelector('.ez-field-drawer') as HTMLElement;
        const hints = drawer.querySelector(
            '.proto-kbd-hints',
        ) as HTMLElement | null;
        // The element still exists (layout code assumes it does) but is hidden.
        expect(hints).not.toBeNull();
        expect(hints!.style.display).toBe('none');
        expect(drawer.querySelector('.ez-status-mark')).not.toBeNull();
    });
});
