/**
 * Unit tests for MarkingField: mount, focus/blur mode switching, typed-tail
 * filtering + accept, checked-row removal, click-to-edit, the native input
 * event dispatch (Host Form Contract), blur reconciliation, mount-time host
 * correction, keyboard/AT reachability at rest, an async (remote-shaped)
 * engine, and destroy cleanup.
 *
 * Mounted declaratively through EzClassifyUI (data-ezclassify-controller
 * markup), the same path every real consumer uses; this also exercises the
 * "marking" controller registration in component-factory/element-scanner.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    activeRow,
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
import { MarkingField } from './marking-field';
import { Context } from '@ezclassify/engine';

function wait(ms = 60): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
}

/**
 * A small real (non-mocked) scheme so suggest()/process() behave like a genuine
 * engine: a single-select `level` category and a multi-select `caveat`
 * category, rendered as "LEVEL//CAVEAT,CAVEAT".
 *
 * `withSuppressedCategory` adds a third, single-select `branch` category
 * (concept `MAIN`, label "OUR SCHOOL") that no field of the render format
 * binds: a certain, user-asserted concept whose label never appears in the
 * rendered string, mirroring how a real scheme (e.g. cedar-valley's
 * `from_school`) can suppress a concept from display without making it any less
 * part of the marking.
 */
function createTestEngine(
    opts: {
        withSuppressedCategory?: boolean;
        /**
         * Adds a caveat concept (SPECAT) whose label shares a leading "S" with
         * the `level` category's SECRET: lets a test type a filter that
         * prefix-matches both an already-selected single-select value and an
         * addable concept in a different category, the shape the
         * single-select-suppression + auto-highlight cases need.
         */
        withOverlappingCaveat?: boolean;
        /**
         * Adds SI, TK, and REL caveat concepts, the vocabulary the
         * state-resurrection case uses ("SECRET//SI/TK/NOFORN" deleted down to
         * "SECRET//" then REL picked from the dropdown).
         */
        withReleasabilityConcepts?: boolean;
        /**
         * Add a render-suppressed category whose value comes only from its
         * default_concept.
         */
        withSuppressedCategoryDefault?: boolean;
        /**
         * Frames every caveat value with "(" and ")" via the field's `each`
         * affix, so the rendered string is "SECRET//(NOFORN)/(ORCON)". Lets a
         * test prove the paint claims a value's own framing rather than leaving
         * it as undecorated text beside the token it belongs to.
         */
        withEachAffix?: boolean;
    } = {},
): LocalSchemeEngineAdapter {
    const hasBranchCategory =
        opts.withSuppressedCategory || opts.withSuppressedCategoryDefault;
    const categories = [
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
        ...(hasBranchCategory
            ? [
                  {
                      id: 'branch',
                      label: 'Branch',
                      required: false,
                      single: true,
                      rollup: 'max',
                      position: 3,
                      ...(opts.withSuppressedCategoryDefault
                          ? { default_concept: 'MAIN' }
                          : {}),
                  },
              ]
            : []),
    ];
    const concepts = [
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
        // Multi-word label (unlike every other concept above), always
        // available: used to prove the paint splits a label into per-word
        // underlined runs without needing withSuppressedCategory's
        // never-rendered branch category.
        {
            id: 'ONHOLD',
            name: 'On Hold',
            views: { default: 'ON HOLD' },
            categories: ['caveat'],
            parents: [],
            aliases: [],
            position: 3,
            rank: 1,
        },
        ...(hasBranchCategory
            ? [
                  {
                      id: 'MAIN',
                      name: 'Our School',
                      views: { default: 'OUR SCHOOL' },
                      categories: ['branch'],
                      parents: [],
                      aliases: [],
                      position: 1,
                      rank: 1,
                  },
              ]
            : []),
        ...(opts.withOverlappingCaveat
            ? [
                  {
                      id: 'SPECAT',
                      name: 'Special Category',
                      views: { default: 'SPECAT' },
                      categories: ['caveat'],
                      parents: [],
                      aliases: [],
                      position: 4,
                      rank: 1,
                  },
              ]
            : []),
        ...(opts.withReleasabilityConcepts
            ? [
                  {
                      id: 'SI',
                      name: 'Special Intelligence',
                      views: { default: 'SI' },
                      categories: ['caveat'],
                      parents: [],
                      aliases: [],
                      position: 5,
                      rank: 1,
                  },
                  {
                      id: 'TK',
                      name: 'Talent Keyhole',
                      views: { default: 'TK' },
                      categories: ['caveat'],
                      parents: [],
                      aliases: [],
                      position: 6,
                      rank: 1,
                  },
                  {
                      id: 'REL',
                      name: 'Releasable',
                      views: { default: 'REL' },
                      categories: ['caveat'],
                      parents: [],
                      aliases: [],
                      position: 7,
                      rank: 1,
                  },
              ]
            : []),
    ];
    return Context.fromComponents({
        scheme: {
            scheme: {
                id: 'mf-test',
                version: '1.0.0',
                name: 'MarkingField Test',
                data: {
                    concepts: { inline: concepts },
                    categories,
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
                            // Deliberately binds no field to 'branch' when that
                            // category is present: its concept is
                            // certain/asserted but never rendered.
                            fields: [
                                { category: 'level', separator: '/' },
                                {
                                    category: 'caveat',
                                    separator: '/',
                                    ...(opts.withEachAffix
                                        ? {
                                              each: {
                                                  prefix: '(',
                                                  suffix: ')',
                                              },
                                          }
                                        : {}),
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
 * Wrap a real (synchronous) engine so process()/render()/suggest() return
 * Promises, the shape a genuine remote (REST) adapter actually has. Everything
 * else (scheme/meta lookups) stays synchronous, matching what
 * ComponentBase.init() reads synchronously. The underlying call runs
 * immediately (so a spy on the wrapped engine counts calls as soon as they
 * happen); only the PROMISE settles `delayMs` later, isolating async timing to
 * exactly where a remote adapter actually has it.
 */
function toAsyncAdapter(
    engine: LocalSchemeEngineAdapter,
    delayMs = 10,
): LocalSchemeEngineAdapter {
    const asyncMethods = new Set(['process', 'render', 'suggest']);
    return new Proxy(engine as object, {
        get(target, prop, receiver) {
            const value = Reflect.get(target, prop, receiver);
            if (typeof value !== 'function') return value;
            if (asyncMethods.has(prop as string)) {
                return (...args: unknown[]) => {
                    const result = (
                        value as (...a: unknown[]) => unknown
                    ).apply(target, args);
                    return new Promise((resolve) =>
                        setTimeout(() => resolve(result), delayMs),
                    );
                };
            }
            return (value as (...a: unknown[]) => unknown).bind(target);
        },
    }) as LocalSchemeEngineAdapter;
}

/**
 * Wrap an engine so the strings it renders carry no per-value framing while the
 * scheme it publishes still declares one.
 *
 * This is the divergence a REMOTE adapter really has, and the reason the token
 * tree's module header says the layout is not the string: the projected scheme
 * a field reads and the marking a server rendered can come from different
 * scheme versions, so the layout can promise framing the text has not got.
 * Strips only the parentheses `withEachAffix` frames its values with.
 */
function withUnframedRender(
    engine: LocalSchemeEngineAdapter,
): LocalSchemeEngineAdapter {
    const unframe = (value: unknown): unknown => {
        if (typeof value === 'string') return value.replace(/[()]/g, '');
        if (value === null || typeof value !== 'object') return value;
        const result = value as Record<string, unknown>;
        if (typeof result.rendered === 'string') {
            return {
                ...result,
                rendered: result.rendered.replace(/[()]/g, ''),
            };
        }
        return value;
    };
    return new Proxy(engine as object, {
        get(target, prop, receiver) {
            const value = Reflect.get(target, prop, receiver);
            if (typeof value !== 'function') return value;
            if (prop !== 'process' && prop !== 'render') {
                return (value as (...a: unknown[]) => unknown).bind(target);
            }
            return (...args: unknown[]) =>
                unframe(
                    (value as (...a: unknown[]) => unknown).apply(target, args),
                );
        },
    }) as LocalSchemeEngineAdapter;
}

/**
 * Same S/NF vocabulary as `createTestEngine`, but returns the raw `Context`
 * (not narrowed to `.scheme`): `EzClassifyUI`'s constructor accepts either, and
 * the favorites tests below use the Context form since that's what
 * `mountWithFavorites` (and the vanilla-declarative
 * `ezclassify-ui-favorites-option.spec.ts` it mirrors) exercise.
 */
function createTestContext(): Context {
    return Context.fromComponents({
        scheme: {
            scheme: {
                id: 'mf-fav-test',
                version: '1.0.0',
                name: 'MarkingField Favorites Test',
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

/**
 * Mount a single MarkingField declaratively and return its host + instance. The
 * host is a <textarea> (see the class doc comment: a single-line <input> cannot
 * wrap), so the initial value is set via text content, not a `value`
 * attribute.
 */
async function mount(
    initialValue = '',
): Promise<{ input: HTMLTextAreaElement; field: MarkingField }> {
    root.innerHTML = `<textarea id="mf" data-ezclassify-controller="marking">${initialValue}</textarea>`;
    forms = new EzClassifyUI(createTestEngine() as never, { root });
    await wait();
    const input = document.getElementById('mf') as HTMLTextAreaElement;
    const field = forms.components.get(input) as MarkingField;
    expect(field).toBeInstanceOf(MarkingField);
    return { input, field };
}

/** Focus the field and ask for the picker, as a keyboard user does. */
async function openPicker(input: HTMLTextAreaElement): Promise<void> {
    input.focus();
    press(input, 'ArrowDown');
    await wait();
}

/** Type into the field and let its reading land. */
async function typeIn(
    input: HTMLTextAreaElement,
    text: string,
    settle = 60,
): Promise<void> {
    typeText(input, text);
    await wait(settle);
}

/** Enter with no active row: the composer's commit. */
async function commit(input: HTMLTextAreaElement): Promise<void> {
    press(input, 'Enter');
    await wait(120);
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

describe('MarkingField native text input', () => {
    async function mountInput(extra = '', hostValidity = '') {
        root.innerHTML = `<form><label for="native-mark">Marking label</label><input id="native-mark" name="marking" type="text" value="SECRET" data-ezclassify-controller="marking" ${extra}></form>`;
        const input = root.querySelector<HTMLInputElement>('#native-mark')!;
        input.setCustomValidity(hostValidity);
        forms = new EzClassifyUI(createTestEngine() as never, { root });
        await wait();
        const editor = input
            .closest('.marking-field-wrap')
            ?.querySelector<HTMLTextAreaElement>('textarea.marking-field-host');
        expect(editor).toBeInstanceOf(HTMLTextAreaElement);
        const field = forms.components.get(input) as MarkingField;
        expect(field).toBeInstanceOf(MarkingField);
        return {
            input,
            editor: editor!,
            field,
            form: root.querySelector('form')!,
        };
    }

    it('owns one unnamed wrapping editor while retaining the original form control and label', async () => {
        const { input, editor, form } = await mountInput(
            'aria-describedby="help"',
        );
        expect(input.type).toBe('text');
        expect(input.name).toBe('marking');
        expect(input.hidden).toBe(true);
        expect(editor.name).toBe('');
        expect(editor.hasAttribute('data-ezclassify-controller')).toBe(false);
        expect(editor.getAttribute('aria-describedby')).toContain('help');
        expect(editor.getAttribute('aria-labelledby')).toBe(
            root.querySelector('label')!.id,
        );
        expect([...new FormData(form).entries()]).toEqual([
            ['marking', 'SECRET'],
        ]);
        root.querySelector('label')!.click();
        expect(document.activeElement).toBe(editor);
        editor.blur();
        input.focus();
        expect(document.activeElement).toBe(editor);
        await wait();
        expect(
            root.querySelectorAll('textarea.marking-field-host'),
        ).toHaveLength(1);
        expect(forms!.components.size).toBe(1);
    });

    it.each(['a', 'button'])(
        'preserves a label descendant %s action without redirecting focus',
        async (tag) => {
            const { editor } = await mountInput();
            const child = document.createElement(tag);
            if (child instanceof HTMLAnchorElement)
                child.href = '#marking-help';
            if (child instanceof HTMLButtonElement) child.type = 'button';
            child.textContent = 'Help';
            root.querySelector('label')!.appendChild(child);
            const action = vi.fn();
            child.addEventListener('click', action);
            const click = new MouseEvent('click', {
                bubbles: true,
                cancelable: true,
            });
            child.dispatchEvent(click);
            expect(action).toHaveBeenCalledOnce();
            expect(click.defaultPrevented).toBe(false);
            expect(document.activeElement).not.toBe(editor);
        },
    );

    it('mirrors live drafts and forwards native events once from the original control', async () => {
        const { input, editor, form, field } = await mountInput();
        const events: Event[] = [];
        form.addEventListener('input', (e) => events.push(e));
        form.addEventListener('change', (e) => events.push(e));
        editor.focus();
        await typeIn(editor, 'UNCLASSIFIED');
        expect(input.value).toBe('UNCLASSIFIED');
        expect([...new FormData(form).entries()]).toEqual([
            ['marking', 'UNCLASSIFIED'],
        ]);
        expect(events.map((e) => [e.type, e.target])).toEqual([
            ['input', input],
        ]);
        events.length = 0;
        await commit(editor);
        expect(field.getRendered()).toBe('UNCLASSIFIED');
        expect(events.map((e) => [e.type, e.target])).toEqual([
            ['input', input],
        ]);
        events.length = 0;
        editor.dispatchEvent(new Event('change', { bubbles: true }));
        expect(events.map((e) => [e.type, e.target])).toEqual([
            ['change', input],
        ]);
    });

    it('keeps invalid draft text in the native form value while retaining committed assertions', async () => {
        const { input, editor, form, field } = await mountInput();
        editor.focus();
        await typeIn(editor, 'SECRET//UNCLASSIFIED');
        await leave(editor);
        expect(editor.value).toBe('SECRET//UNCLASSIFIED');
        expect(input.value).toBe(editor.value);
        expect(new FormData(form).get('marking')).toBe(editor.value);
        expect(editor.getAttribute('aria-invalid')).toBe('true');
        expect(input.checkValidity()).toBe(false);
        expect(document.activeElement).toBe(editor);
        expect(field.getAssertions().map((a) => a.conceptId)).toEqual(['S']);
    });

    it('honors live host validity clears and updates after a valid edit', async () => {
        const { input, editor, field } = await mountInput(
            '',
            'Server rejected previous value',
        );
        input.setCustomValidity('');
        editor.focus();
        await typeIn(editor, 'UNCLASSIFIED');
        await commit(editor);
        expect(input.validity.valid).toBe(true);
        expect(input.validationMessage).toBe('');
        input.setCustomValidity('Server requires another review');
        await typeIn(editor, 'SECRET');
        await commit(editor);
        expect(input.validity.customError).toBe(true);
        expect(input.validationMessage).toBe('Server requires another review');
        field.destroy();
        await wait();
        expect(Object.hasOwn(input, 'setCustomValidity')).toBe(false);
        expect(input.validationMessage).toBe('Server requires another review');
        input.setCustomValidity('');
        expect(input.validity.valid).toBe(true);
    });

    it('keeps composer errors ahead of host validity and restores the latest host state on teardown', async () => {
        const { input, editor, field } = await mountInput(
            '',
            'Previous host error',
        );
        editor.focus();
        await typeIn(editor, 'SECRET//UNCLASSIFIED');
        await leave(editor);
        expect(editor.validity.customError).toBe(true);
        const composerMessage = editor.validationMessage;
        input.setCustomValidity('');
        expect(input.validationMessage).toBe(composerMessage);
        input.setCustomValidity('Latest host error');
        expect(input.validationMessage).toBe(composerMessage);
        field.destroy();
        await wait(200);
        expect(root.contains(editor)).toBe(false);
        expect(input.validationMessage).toBe('Latest host error');
        expect(Object.hasOwn(input, 'setCustomValidity')).toBe(false);
    });

    it('reads external native value changes without duplicating their events', async () => {
        const { input, editor, field } = await mountInput();
        const listener = vi.fn();
        input.addEventListener('input', listener);
        input.value = 'UNCLASSIFIED';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        await wait(120);
        expect(editor.value).toBe('UNCLASSIFIED');
        expect(field.getRendered()).toBe('UNCLASSIFIED');
        expect(listener).toHaveBeenCalledOnce();
    });

    it('mirrors native constraints and reset, and focuses the editor for invalid required input', async () => {
        const { input, editor, form, field } = await mountInput('required');
        expect(editor.required).toBe(true);
        input.disabled = true;
        input.readOnly = true;
        await wait();
        expect(editor.disabled).toBe(true);
        expect(editor.readOnly).toBe(true);
        expect([...new FormData(form).entries()]).toEqual([]);
        input.disabled = false;
        input.readOnly = false;
        await wait();
        await field.setValue('UNCLASSIFIED');
        form.reset();
        await wait(120);
        expect(input.value).toBe('SECRET');
        expect(editor.value).toBe('SECRET');
        expect(field.getRendered()).toBe('SECRET');
        input.value = '';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        await wait(120);
        expect(input.checkValidity()).toBe(false);
        expect(document.activeElement).toBe(editor);
    });

    it('preserves author sizing and input-specific theme selectors on the owned editor', async () => {
        const { input, editor } = await mountInput('style="min-height: 44px"');
        const style = document.createElement('style');
        style.textContent =
            '[data-theme="native-test"] input#native-mark { background-color: rgb(10, 20, 30); }';
        root.appendChild(style);
        const previous = document.documentElement.getAttribute('data-theme');
        try {
            document.documentElement.setAttribute('data-theme', 'native-test');
            await wait();
            expect(editor.style.minHeight).toBe('44px');
            expect(
                (root.querySelector('.marking-field-display') as HTMLElement)
                    .style.minHeight,
            ).toBe('44px');
            expect(editor.style.backgroundColor).toBe('rgb(10, 20, 30)');
            expect(getComputedStyle(input).backgroundColor).toBe(
                editor.style.backgroundColor,
            );
        } finally {
            if (previous === null)
                document.documentElement.removeAttribute('data-theme');
            else document.documentElement.setAttribute('data-theme', previous);
        }
    });

    it('retains native single-line paste semantics in both values', async () => {
        const { input, editor } = await mountInput();
        editor.focus();
        await typeIn(editor, 'SE\nCRET');
        expect(input.value).toBe('SECRET');
        expect(editor.value).toBe('SECRET');
    });

    it('keeps neighboring native fields independent without mount-time value events', async () => {
        root.innerHTML =
            '<input type="text" id="left" value="SECRET" data-ezclassify-controller="marking"><input type="text" id="right" value="UNCLASSIFIED" data-ezclassify-controller="marking">';
        const inputs = Array.from(root.querySelectorAll('input'));
        const nativeInput = vi.fn();
        inputs.forEach((input) => input.addEventListener('input', nativeInput));
        forms = new EzClassifyUI(createTestEngine() as never, { root });
        await wait(120);
        expect(inputs.map((input) => input.value)).toEqual([
            'SECRET',
            'UNCLASSIFIED',
        ]);
        expect(nativeInput).not.toHaveBeenCalled();
        expect(
            root.querySelectorAll('textarea.marking-field-host'),
        ).toHaveLength(2);
        const editor = inputs[1]
            .closest('.marking-field-wrap')!
            .querySelector('textarea')!;
        editor.focus();
        await typeIn(editor, 'SECRET//NOFORN');
        await commit(editor);
        expect(inputs.map((input) => input.value)).toEqual([
            'SECRET',
            'SECRET//NOFORN',
        ]);
        expect(
            (forms.components.get(inputs[0]) as MarkingField).getRendered(),
        ).toBe('SECRET');
    });

    it('keeps a dirty draft visible when committed state changes underneath it', async () => {
        const { input, editor, field } = await mountInput();
        editor.focus();
        await typeIn(editor, 'SECRET//');
        await field.setValue('UNCLASSIFIED');
        await wait();
        expect(field.getRendered()).toBe('UNCLASSIFIED');
        expect(editor.value).toBe('SECRET//');
        expect(input.value).toBe('SECRET//');
    });

    it('retains the typed value through destroy and remount while removing the old editor', async () => {
        const { input, editor } = await mountInput();
        editor.focus();
        await typeIn(editor, 'UNCLASSIFIED');
        forms!.destroy();
        forms = null;
        await wait(200);
        expect(input.value).toBe('UNCLASSIFIED');
        expect(root.contains(editor)).toBe(false);
        forms = new EzClassifyUI(createTestEngine() as never, { root });
        await wait(120);
        expect(
            root.querySelectorAll('textarea.marking-field-host'),
        ).toHaveLength(1);
        expect(
            (forms.components.get(input) as MarkingField).getRendered(),
        ).toBe('UNCLASSIFIED');
    });

    it('keeps readonly fields focusable without opening their picker', async () => {
        const { input, editor } = await mountInput('readonly');
        input.focus();
        press(editor, 'ArrowDown');
        await wait();
        expect(document.activeElement).toBe(editor);
        expect(openSurface()).toBeNull();
        expect(input.value).toBe('SECRET');
        expect(
            (root.querySelector('.ez-field-drawer') as HTMLElement).inert,
        ).toBe(true);
    });

    it('restores original attributes and value on teardown and mounts exactly one new editor', async () => {
        const { input, editor, field } = await mountInput(
            'autocomplete="on" spellcheck="true" style="color: red"',
        );
        await field.setValue('UNCLASSIFIED');
        field.destroy();
        await wait();
        expect(root.contains(input)).toBe(true);
        expect(root.contains(editor)).toBe(false);
        expect(input.hidden).toBe(false);
        expect(input.getAttribute('autocomplete')).toBe('on');
        expect(input.getAttribute('spellcheck')).toBe('true');
        expect(input.getAttribute('style')).toBe('color: red');
        expect(input.value).toBe('UNCLASSIFIED');
        forms!.destroy();
        forms = new EzClassifyUI(createTestEngine() as never, { root });
        await wait();
        expect(
            root.querySelectorAll('textarea.marking-field-host'),
        ).toHaveLength(1);
        expect(input.value).toBe('UNCLASSIFIED');
    });
});

describe('MarkingField', () => {
    it('keeps host block margins in the resting display and attached drawer', async () => {
        root.innerHTML =
            '<textarea id="mf" style="margin-top: 6px; margin-bottom: 8px" data-ezclassify-controller="marking">SECRET</textarea>';
        forms = new EzClassifyUI(createTestEngine() as never, { root });
        await wait();
        const display = root.querySelector<HTMLElement>(
            '.marking-field-display',
        )!;
        const drawer = root.querySelector<HTMLElement>('.ez-field-drawer')!;
        expect(display.style.marginTop).toBe('6px');
        expect(display.style.marginBottom).toBe('8px');
        expect(drawer.style.getPropertyValue('--ez-field-margin-top')).toBe(
            '6px',
        );
        expect(drawer.style.getPropertyValue('--ez-field-margin-bottom')).toBe(
            '8px',
        );
    });

    it('mounts, enhancing the host input in place with a painted display', async () => {
        const { input } = await mount('SECRET//NOFORN');

        expect(input.classList.contains('marking-field-host')).toBe(true);
        expect(input.closest('.marking-field-wrap')).not.toBeNull();

        // At rest (not focused): host is rendered invisible, never
        // display:none (see the "reachable at rest" test below for the
        // accessibility assertions) and the display is painted with tokens.
        expect(input.classList.contains('marking-field-host--resting')).toBe(
            true,
        );
        expect(input.style.display).not.toBe('none');
        const display = root.querySelector(
            '.marking-field-display',
        ) as HTMLDivElement;
        expect(display.style.display).not.toBe('none');
        const tokens = display.querySelectorAll('.marking-field-token');
        expect(Array.from(tokens).map((t) => t.textContent)).toEqual([
            'SECRET',
            'NOFORN',
        ]);
    });

    it('uses an existing textarea as its wrapping editor', async () => {
        // The textarea host permits a long marking to wrap without horizontal
        // scrolling or clipping.
        const { input } = await mount('SECRET');
        expect(input.tagName).toBe('TEXTAREA');
    });

    it('rejects a control that cannot hold a whole text marking', async () => {
        const container = document.createElement('div');
        root.appendChild(container);
        const input = document.createElement('input');
        input.type = 'number';
        container.appendChild(input);
        await expect(
            new MarkingField().init(container, createTestContext(), {}),
        ).rejects.toThrow(/textarea|text input/);
    });

    it('mirrors the host border/background onto the display, matching the other enhanced fields at rest', async () => {
        // captureAndMirrorStyles copies the host border, background, and padding
        // onto the display. Explicit host styles make the assertions check copied
        // values without relying on jsdom's incomplete textarea defaults.
        root.innerHTML = `<textarea id="mf" data-ezclassify-controller="marking" style="border: 3px solid rgb(10, 20, 30); background-color: rgb(40, 50, 60); padding: 7px;">SECRET</textarea>`;
        forms = new EzClassifyUI(createTestEngine() as never, { root });
        await wait();
        const display = root.querySelector(
            '.marking-field-display',
        ) as HTMLDivElement;
        expect(display.style.borderColor).toBe('rgb(10, 20, 30)');
        expect(display.style.backgroundColor).toBe('rgb(40, 50, 60)');
        expect(display.style.padding).toBe('7px');
    });

    it('grows the textarea to fit its content while editing instead of showing an internal scrollbar', async () => {
        const { input } = await mount('SECRET');
        input.dispatchEvent(new FocusEvent('focus'));
        await wait();
        // syncHostHeight() ran (via setEditingMode) and set an explicit
        // height rather than leaving the browser default in place.
        expect(input.style.height).not.toBe('');

        input.value = input.value + '//NOFORN//ORCON';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        // syncHostHeight() re-runs on every keystroke (see onInput), not just
        // on focus, so a growing value keeps the box in sync as it's typed
        // rather than only when the field is first entered.
        expect(input.style.height).not.toBe('');
    });

    it('accounts for the host border under box-sizing: border-box so the last line never clips', async () => {
        // Under border-box sizing, scrollHeight covers content and padding but
        // excludes borders. The host height must add both borders to keep the
        // last line visible. Stub a nonzero scrollHeight and real border widths
        // because jsdom has no layout engine.
        const { input } = await mount('SECRET');
        Object.defineProperty(input, 'scrollHeight', {
            configurable: true,
            value: 57,
        });
        input.style.borderTopWidth = '1px';
        input.style.borderBottomWidth = '1px';

        input.dispatchEvent(new FocusEvent('focus'));
        await wait();

        expect(input.style.height).toBe('59px');
    });

    it('clears the inline height on return to rest so inset:0 can stretch the host to match the display', async () => {
        // The resting host uses absolute positioning with inset:0 to match the
        // display. Returning to rest must clear the editing height so the
        // height does not over-constrain top and bottom (CSS2.1 10.6.4).
        const { input } = await mount('SECRET');
        input.dispatchEvent(new FocusEvent('focus'));
        await wait();
        // jsdom's scrollHeight is always 0 (see the border test above), so
        // force a real nonzero height directly to simulate what a real
        // browser's auto-grow would have left behind; otherwise this
        // assertion would pass on '' vacuously either way.
        input.style.height = '65px';

        input.dispatchEvent(new FocusEvent('blur'));
        await wait(250); // past BLUR_RECONCILE_DELAY_MS (150ms)

        expect(input.classList.contains('marking-field-host--resting')).toBe(
            true,
        );
        expect(input.style.height).toBe('');
    });

    it('wraps instead of clipping or scrolling horizontally, both editing and at rest', () => {
        // Read source CSS because jsdom does not apply the author stylesheet
        // cascade to these rules. Both editing and resting states must wrap
        // without nowrap or ellipsis.
        const here = dirname(fileURLToPath(import.meta.url));
        const css = readFileSync(join(here, 'marking-field.css'), 'utf8');

        expect(css).not.toContain('white-space: nowrap');
        expect(css).not.toContain('text-overflow: ellipsis');
        expect(css).toMatch(
            /\.marking-field-host\s*\{[^}]*white-space:\s*pre-wrap/,
        );
        expect(css).toMatch(
            /\.marking-field-display\s*\{[^}]*white-space:\s*pre-wrap/,
        );
    });

    it('keeps the host input in the tab order and accessibility tree at rest (never display:none)', async () => {
        const { input } = await mount('SECRET//NOFORN');

        // The actual bug: display:none removes an element from the tab order
        // and the accessibility tree entirely, so a keyboard/screen-reader
        // user tabbing through the form would skip the field altogether.
        expect(input.style.display).not.toBe('none');
        expect(input.hidden).toBe(false);
        expect(input.getAttribute('role')).toBe('combobox');
        expect(input.getAttribute('aria-expanded')).toBe('false');
        expect(input.hasAttribute('aria-controls')).toBe(true);

        // A <label for="..."> targeting this element keeps working: it is
        // still the same live <input>, not a hidden proxy.
        const label = document.createElement('label');
        label.htmlFor = input.id;
        input.parentNode?.insertBefore(label, input);
        expect(input.labels?.length).toBe(1);
    });

    it('enters edit mode on focus, and opens the picker on a request with the current concepts listed', async () => {
        const { input } = await mount('SECRET');
        input.focus();
        await wait();

        expect(input.classList.contains('marking-field-host--resting')).toBe(
            false,
        );
        // Focus alone never opens the picker.
        expect(openSurface()).toBeNull();
        press(input, 'ArrowDown');
        await wait();
        expect(openSurface()).not.toBeNull();
        expect(rows().length).toBeGreaterThan(0);
        expect(rowFor('SECRET')?.getAttribute('aria-selected')).toBe('true');
    });

    it('scopes the suggestion dropdown to the bound category', async () => {
        // A category-bound mount must offer only concepts accepted by that facet.
        root.innerHTML = `<textarea id="mf" data-ezclassify-controller="marking" data-ezclassify-category="caveat"></textarea>`;
        forms = new EzClassifyUI(createTestEngine() as never, { root });
        await wait();
        const input = document.getElementById('mf') as HTMLTextAreaElement;
        await openPicker(input);

        const labels = rowLabels();
        expect(labels).toContain('NOFORN');
        expect(labels).toContain('ORCON');
        expect(labels).not.toContain('UNCLASSIFIED');
        expect(labels).not.toContain('SECRET');
    });

    it('repositions the open picker on page scroll, same as every other field', async () => {
        // The open picker must follow the host's viewport position on page scroll.
        const { input } = await mount('SECRET');
        await openPicker(input);

        const surface = openSurface()!;
        const openTop = surface.style.top;

        // The host's viewport position changes as if the page scrolled.
        const wrap = input.closest('.marking-field-wrap') as HTMLElement;
        const moved = {
            left: 20,
            right: 220,
            top: 250,
            bottom: 282,
            width: 200,
            height: 32,
            x: 20,
            y: 250,
            toJSON: () => ({}),
        } as DOMRect;
        vi.spyOn(input, 'getBoundingClientRect').mockReturnValue(moved);
        vi.spyOn(wrap, 'getBoundingClientRect').mockReturnValue(moved);
        window.dispatchEvent(new Event('scroll'));

        expect(surface.style.top).not.toBe(openTop);
        expect(surface.style.top).toBe('286px');
    });

    it('moves the open list out from under the iOS keyboard when the visual viewport shrinks and pans', async () => {
        const vv = new FakeVisualViewport();
        installVisualViewport(vv);
        try {
            const { input } = await mount('SECRET');
            const wrap = input.closest('.marking-field-wrap') as HTMLElement;
            vi.spyOn(input, 'getBoundingClientRect').mockReturnValue(
                viewportRect(300, 340),
            );
            vi.spyOn(wrap, 'getBoundingClientRect').mockReturnValue(
                viewportRect(300, 340),
            );
            await openPicker(input);
            const surface = openSurface() as HTMLDivElement;
            const items = surface.querySelector(
                '.ez-composer__scroll',
            ) as HTMLDivElement;
            // jsdom lays nothing out; give the list a real natural height.
            Object.defineProperty(items, 'scrollHeight', {
                configurable: true,
                value: 400,
            });

            // Keyboard opens: 450px left visible. Only the visual viewport
            // reports it, so this resize is the only signal the field gets.
            // Less than a usable list is left below the field, so the list
            // moves above once rather than sit under the keyboard.
            vv.height = 450;
            vv.dispatchEvent(new Event('resize'));
            expect(surface.dataset.side).toBe('above');
            expect(Number.parseFloat(surface.style.top)).toBeGreaterThanOrEqual(
                8,
            );
            expect(paintedBottom(surface, items)).toBeLessThanOrEqual(300);

            // iOS then pans the visual viewport 200px down to keep the caret
            // in view: the visible band is y=200..650 with no resize event.
            vv.offsetTop = 200;
            vv.dispatchEvent(new Event('scroll'));
            expect(Number.parseFloat(surface.style.top)).toBeGreaterThanOrEqual(
                208,
            );
            expect(paintedBottom(surface, items)).toBeLessThanOrEqual(642);
        } finally {
            installVisualViewport(undefined);
        }
    });

    it('filters by the token being typed, arms the best match, Tab accepts it, and the commit stores it', async () => {
        const { input, field } = await mount('');
        input.focus();
        await typeIn(input, 'SEC');

        expect(activeRow(input)?.textContent).toContain('SECRET');

        const tab = press(input, 'Tab');
        await wait();
        expect(tab.defaultPrevented).toBe(true);
        expect(input.value).toBe('SECRET');
        // Accepting fills the draft; the commit (Enter or leaving) stores it.
        expect(field.getAssertions()).toEqual([]);
        await commit(input);

        expect(field.getRendered()).toBe('SECRET');
        expect(field.getAssertions().map((a) => a.conceptId)).toEqual(['S']);
    });

    it('shows already-selected concepts as checked rows and removes one on select', async () => {
        const { input, field } = await mount('SECRET//NOFORN');
        await openPicker(input);

        const checked = rows().filter(
            (r) => r.getAttribute('aria-selected') === 'true',
        );
        expect(checked.length).toBe(2);
        const nofornRow = rowFor('NOFORN')!;
        expect(nofornRow.getAttribute('aria-selected')).toBe('true');
        expect(
            nofornRow.querySelector('.ez-composer__check')?.textContent,
        ).toBe('\u2713');

        nofornRow.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        await wait();
        expect(input.value.trim()).toBe('SECRET');
        await commit(input);

        expect(
            field
                .getAssertions()
                .map((a) => a.conceptId)
                .sort(),
        ).toEqual(['S']);
        expect(field.getRendered()).toBe('SECRET');
    });

    it("keeps a filled single-choice category's selected member checked, never arms it, and arms the addable match instead", async () => {
        // The repro: a query that prefix-matches both the selected
        // single-choice value and an addable concept elsewhere must arm the
        // addable one. Arming the checked row made Enter a trap that removed
        // the value the user had.
        root.innerHTML = `<textarea id="mf" data-ezclassify-controller="marking">SECRET</textarea>`;
        forms = new EzClassifyUI(
            createTestEngine({ withOverlappingCaveat: true }) as never,
            { root },
        );
        await wait();
        const input = document.getElementById('mf') as HTMLTextAreaElement;
        input.focus();

        // "S" prefix-matches both SECRET (level, already selected) and
        // SPECAT (caveat, addable, a different category).
        await typeIn(input, 'SECRET/S', 120);

        // SECRET renders checked, its action is Remove, and it is not armed.
        const secret = rowFor('SECRET')!;
        expect(secret.getAttribute('aria-selected')).toBe('true');
        expect(secret.textContent).toContain('removes it');

        // Armed: SPECAT, the addable match.
        expect(activeRow(input)?.textContent).toContain('SPECAT');
        expect(activeRow(input)?.getAttribute('aria-selected')).toBe('false');

        // UNCLASSIFIED matches "s" only mid-word: it waits behind "more",
        // and when shown it says it replaces the selected value.
        expect(rowLabels()).not.toContain('UNCLASSIFIED');
        const more = rows().find((r) => r.dataset.kind === 'more')!;
        more.click();
        await wait();
        expect(rowFor('UNCLASSIFIED')?.textContent).toContain(
            'replaces SECRET',
        );
    });

    it('mounts the status mark + favorites button inside a bottom-hanging chrome drawer', async () => {
        // The mark and ★ button live in a small drawer attached to the field's
        // bottom-right edge, not floating over the field's own content.
        const { input } = await mount('SECRET');
        const wrap = input.closest('.marking-field-wrap') as HTMLElement;
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
        const { input } = await mount('SECRET');
        const wrap = input.closest('.marking-field-wrap') as HTMLElement;
        const drawer = wrap.querySelector('.ez-field-drawer') as HTMLElement;
        expect(drawer.classList.contains('ez-field-drawer--bottom')).toBe(true);

        await openPicker(input);

        expect(openSurface()!.dataset.side).toBe('below');
        expect(drawer.classList.contains('ez-field-drawer--top')).toBe(true);
        expect(drawer.classList.contains('ez-field-drawer--bottom')).toBe(
            false,
        );

        await leave(input);

        expect(drawer.classList.contains('ez-field-drawer--bottom')).toBe(true);
        expect(drawer.classList.contains('ez-field-drawer--top')).toBe(false);
    });

    it('the drawer classes actually resolve to opposite physical edges (not just opposite names)', () => {
        // Geometry, not just class names: jsdom has no layout engine and
        // (per the "wraps instead of clipping" test above) doesn't apply the
        // author stylesheet cascade to getComputedStyle for a plain <style>
        // injection, so this reads the real CSS source: the same pattern
        // used there. A class-name assertion alone could pass while the
        // surface is unusable; this
        // would catch someone swapping the --top/--bottom rule BODIES (both
        // tests above only prove the JS picks the right CLASS NAME; this
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

    it('continues the host focus ring onto the drawer, matching TagInput', () => {
        // The inset host focus ring continues onto the drawer so the field and
        // drawer read as one focused compound shape.
        const here = dirname(fileURLToPath(import.meta.url));
        const css = readFileSync(join(here, 'marking-field.css'), 'utf8');
        expect(css).toMatch(
            /\.marking-field-host:focus\s*\{[^}]*outline-offset:\s*-2px/,
        );
        expect(css).toMatch(
            /\.marking-field-wrap:focus-within:not\(:has\(> \.ez-clear-button:focus\)\)\s*>\s*\.ez-field-drawer\s*\{[^}]*border-color:/,
        );
    });

    it('keeps the drawer at the bottom when the dropdown flips open above the field, so neither hides the other', async () => {
        const { input } = await mount('SECRET');
        const wrap = input.closest('.marking-field-wrap') as HTMLElement;
        const drawer = wrap.querySelector('.ez-field-drawer') as HTMLElement;

        // Pin the field off the bottom of the (jsdom default 768px) viewport
        // so spaceBelow goes negative and the picker opens above.
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
        input.getBoundingClientRect = () => offBottom;
        wrap.getBoundingClientRect = () => offBottom;

        await openPicker(input);

        expect(openSurface()!.dataset.side).toBe('above');
        // The picker occupies the field's TOP edge, so the drawer stays on
        // the bottom.
        expect(drawer.classList.contains('ez-field-drawer--bottom')).toBe(true);
        expect(drawer.classList.contains('ez-field-drawer--top')).toBe(false);

        await leave(input);

        expect(drawer.classList.contains('ez-field-drawer--bottom')).toBe(true);
        expect(drawer.classList.contains('ez-field-drawer--top')).toBe(false);
    });

    it('paints per-token colors at rest and repaints on blur', async () => {
        const { input } = await mount('SECRET//NOFORN');
        input.focus();
        await wait();
        expect(input.classList.contains('marking-field-host--resting')).toBe(
            false,
        );

        await leave(input);

        expect(input.classList.contains('marking-field-host--resting')).toBe(
            true,
        );
        expect(input.style.display).not.toBe('none');
        const display = root.querySelector(
            '.marking-field-display',
        ) as HTMLDivElement;
        expect(display.style.display).not.toBe('none');
        const token = display.querySelector(
            '.marking-field-token',
        ) as HTMLElement;
        expect(token.style.getPropertyValue('--ez-token-underline')).not.toBe(
            '',
        );
        expect(openSurface()).toBeNull();
    });

    it('underlines a multi-word token label word-by-word, never the space between the words', async () => {
        // A multi-word label such as "ON HOLD" is underlined word-by-word, with
        // no underline on its internal space. setAssertions bypasses the fixture
        // tokenizer so this exercises buildTokenTree/paintToken directly.
        const { input, field } = await mount('');
        field.setAssertions([
            {
                conceptId: 'S',
                categoryId: 'level',
                confidence: 'certain',
                source: 'test',
            },
            {
                conceptId: 'ONHOLD',
                categoryId: 'caveat',
                confidence: 'certain',
                source: 'test',
            },
        ]);
        await wait();
        input.dispatchEvent(new FocusEvent('blur'));
        await wait(200);

        const display = root.querySelector(
            '.marking-field-display',
        ) as HTMLDivElement;
        const token = Array.from(
            display.querySelectorAll('.marking-field-token'),
        ).find((t) => t.textContent === 'ON HOLD') as HTMLElement;
        expect(token).toBeTruthy();

        // Two underlined word runs, one per real word, not one run
        // spanning the whole "ON HOLD" label.
        const runs = token.querySelectorAll('.marking-field-token-run');
        expect(Array.from(runs).map((r) => r.textContent)).toEqual([
            'ON',
            'HOLD',
        ]);
        // No run's own text is whitespace: the defect class this closes.
        for (const run of runs) {
            expect(run.textContent).not.toMatch(/^\s*$/);
        }
        // The space between the two words is a PLAIN text node, a direct
        // child of the token span, outside both run elements, never
        // decorated regardless of where a real line happens to wrap.
        const directTextChildren = Array.from(token.childNodes)
            .filter((n) => n.nodeType === Node.TEXT_NODE)
            .map((n) => n.textContent);
        expect(directTextChildren).toEqual([' ']);
        // Reconstructing the label from the DOM still round-trips to the
        // exact rendered text: splitting into runs must not lose or
        // reorder any character.
        expect(token.textContent).toBe('ON HOLD');
    });

    it('never puts an underline class on a structural separator between tokens or groups', async () => {
        const { input, field } = await mount('');
        field.setAssertions([
            {
                conceptId: 'S',
                categoryId: 'level',
                confidence: 'certain',
                source: 'test',
            },
            {
                conceptId: 'NF',
                categoryId: 'caveat',
                confidence: 'certain',
                source: 'test',
            },
        ]);
        await wait();
        input.dispatchEvent(new FocusEvent('blur'));
        await wait(200);

        const display = root.querySelector(
            '.marking-field-display',
        ) as HTMLDivElement;
        // "SECRET//NOFORN": the "//" category separator is a direct text
        // node of the display, never wrapped in the underlined run class.
        const runTexts = Array.from(
            display.querySelectorAll('.marking-field-token-run'),
        ).map((r) => r.textContent);
        expect(runTexts).toEqual(['SECRET', 'NOFORN']);
        expect(display.textContent).toBe('SECRET//NOFORN');
    });

    it("paints a value's own per-value affix inside the token it frames", async () => {
        // `each` is what the format writes around EVERY value of a field, so
        // the "(" and ")" of "(NOFORN)" belong to that value the way its
        // letters do. Painted outside the token span they read as loose
        // punctuation: the underline stops at the parenthesis and the concept
        // tooltip does not cover it.
        root.innerHTML = `<textarea id="mf" data-ezclassify-controller="marking"></textarea>`;
        forms = new EzClassifyUI(
            createTestEngine({ withEachAffix: true }) as never,
            { root },
        );
        await wait();
        const input = document.getElementById('mf') as HTMLTextAreaElement;
        const field = forms.components.get(input) as MarkingField;
        field.setAssertions([
            {
                conceptId: 'S',
                categoryId: 'level',
                confidence: 'certain',
                source: 'test',
            },
            {
                conceptId: 'NF',
                categoryId: 'caveat',
                confidence: 'certain',
                source: 'test',
            },
            {
                conceptId: 'ORCON',
                categoryId: 'caveat',
                confidence: 'certain',
                source: 'test',
            },
        ]);
        await wait();
        input.dispatchEvent(new FocusEvent('blur'));
        await wait(200);

        const display = root.querySelector(
            '.marking-field-display',
        ) as HTMLDivElement;
        // The framing is real: the engine wrote it, and the display's text is
        // still the rendered string character for character.
        expect(display.textContent).toBe('SECRET//(NOFORN)/(ORCON)');
        // Each framed value is one token, parentheses included. The "/" that
        // joins two values stays outside, because a separator joins values
        // rather than belonging to one.
        expect(
            Array.from(display.querySelectorAll('.marking-field-token')).map(
                (t) => t.textContent,
            ),
        ).toEqual(['SECRET', '(NOFORN)', '(ORCON)']);
        // Painted, not merely contained: the affix is underlined with the
        // value, so the token reads as one run instead of an underline that
        // starts after the parenthesis.
        expect(
            Array.from(
                display.querySelectorAll('.marking-field-token-run'),
            ).map((r) => r.textContent),
        ).toEqual(['SECRET', '(NOFORN)', '(ORCON)']);
    });

    it('claims no framing the rendered string does not actually carry', async () => {
        // The remote case the token tree's module header is about: the
        // projected layout a field reads and the string a server rendered can
        // come from different scheme versions, so the layout can promise a
        // framing the text has not got. The string is the authority; the
        // affix is decoration the paint takes only when it is really there.
        root.innerHTML = `<textarea id="mf" data-ezclassify-controller="marking"></textarea>`;
        forms = new EzClassifyUI(
            withUnframedRender(
                createTestEngine({ withEachAffix: true }),
            ) as never,
            { root },
        );
        await wait();
        const input = document.getElementById('mf') as HTMLTextAreaElement;
        const field = forms.components.get(input) as MarkingField;
        field.setAssertions([
            {
                conceptId: 'S',
                categoryId: 'level',
                confidence: 'certain',
                source: 'test',
            },
            {
                conceptId: 'NF',
                categoryId: 'caveat',
                confidence: 'certain',
                source: 'test',
            },
            // A second caveat, so a value that is NOT last has real
            // characters after it: a suffix claimed without looking would
            // swallow the "/" that joins the two.
            {
                conceptId: 'ORCON',
                categoryId: 'caveat',
                confidence: 'certain',
                source: 'test',
            },
        ]);
        await wait();
        input.dispatchEvent(new FocusEvent('blur'));
        await wait(200);

        const display = root.querySelector(
            '.marking-field-display',
        ) as HTMLDivElement;
        // The scheme is the same `withEachAffix` one whose layout declares "("
        // and ")" for the caveat category, and which the test above paints as
        // "(NOFORN)". Only the rendered string is different here, and the
        // paint took neither parenthesis, because neither is in the text.
        expect(display.textContent).toBe('SECRET//NOFORN/ORCON');
        expect(
            Array.from(display.querySelectorAll('.marking-field-token')).map(
                (t) => t.textContent,
            ),
        ).toEqual(['SECRET', 'NOFORN', 'ORCON']);
    });

    it('leaves framing alone when the rendered string did not write it around the value', async () => {
        // The affix is a layout fact and the string is the authority. Where
        // the two disagree (a runtime that suppressed the framing, a format
        // whose affix lands somewhere else), the paint must claim only what
        // is actually there, or it swallows characters that belong to a
        // separator or to the next value.
        const { input, field } = await mount('');
        field.setAssertions([
            {
                conceptId: 'S',
                categoryId: 'level',
                confidence: 'certain',
                source: 'test',
            },
            {
                conceptId: 'NF',
                categoryId: 'caveat',
                confidence: 'certain',
                source: 'test',
            },
        ]);
        await wait();
        input.dispatchEvent(new FocusEvent('blur'));
        await wait(200);

        const display = root.querySelector(
            '.marking-field-display',
        ) as HTMLDivElement;
        // Same scheme without `each`: nothing extra is claimed.
        expect(display.textContent).toBe('SECRET//NOFORN');
        expect(
            Array.from(display.querySelectorAll('.marking-field-token')).map(
                (t) => t.textContent,
            ),
        ).toEqual(['SECRET', 'NOFORN']);
    });

    it('underlines with text-decoration, not a border/padding box, so painting a token costs no line height', () => {
        // jsdom has no layout engine (see the drawer-geometry test above for
        // the same constraint/pattern): this reads the real CSS source. A
        // border-bottom+padding-bottom box sits IN the inline box model and
        // can push wrapped lines apart; text-decoration is a paint-only
        // effect with no box contribution, so line spacing stays identical to
        // unpainted text.
        const here = dirname(fileURLToPath(import.meta.url));
        const css = readFileSync(join(here, 'marking-field.css'), 'utf8');
        expect(css).toMatch(
            /\.marking-field-token-run\s*\{[^}]*text-decoration-line:\s*underline/,
        );
        expect(css).not.toMatch(
            /\.marking-field-token(?!-run)\s*\{[^}]*border-bottom/,
        );
        expect(css).not.toMatch(
            /\.marking-field-token(?!-run)\s*\{[^}]*padding-bottom/,
        );
    });

    it('shows a concept dwell tooltip on hover over a painted token at rest', async () => {
        const { input } = await mount('SECRET//NOFORN');
        input.dispatchEvent(new FocusEvent('blur'));
        await wait(200);

        const display = root.querySelector(
            '.marking-field-display',
        ) as HTMLDivElement;
        const token = display.querySelector(
            '.marking-field-token',
        ) as HTMLElement;

        expect(document.body.querySelector('.ez-tooltip')).toBeNull();
        token.dispatchEvent(new Event('mouseenter'));
        await wait(350);

        const tip = document.body.querySelector(
            '.ez-tooltip',
        ) as HTMLElement | null;
        expect(tip).not.toBeNull();
        expect(tip!.hidden).toBe(false);

        token.dispatchEvent(new Event('mouseleave'));
        await wait();
        expect(tip!.hidden).toBe(true);
    });

    it('honors the data-ezclassify-no-tooltips opt-out for painted tokens', async () => {
        root.innerHTML = `<div data-ezclassify-no-tooltips><textarea id="mf" data-ezclassify-controller="marking">SECRET</textarea></div>`;
        forms = new EzClassifyUI(createTestEngine() as never, { root });
        await wait();
        const input = document.getElementById('mf') as HTMLTextAreaElement;
        expect(input).not.toBeNull();

        const display = root.querySelector(
            '.marking-field-display',
        ) as HTMLDivElement;
        const token = display.querySelector(
            '.marking-field-token',
        ) as HTMLElement;
        token.dispatchEvent(new Event('mouseenter'));
        await wait(350);

        expect(document.body.querySelector('.ez-tooltip')).toBeNull();
    });

    it('returns to edit mode with the caret set on a click over the painted display', async () => {
        const { input } = await mount('SECRET');
        const display = root.querySelector(
            '.marking-field-display',
        ) as HTMLDivElement;

        const focusSpy = vi.spyOn(input, 'focus');
        display.dispatchEvent(
            new MouseEvent('mousedown', {
                bubbles: true,
                clientX: 5,
                clientY: 5,
            }),
        );
        await wait();

        expect(focusSpy).toHaveBeenCalled();
        expect(input.classList.contains('marking-field-host--resting')).toBe(
            false,
        );
        expect(display.style.display).toBe('none');
        expect(input.selectionStart).not.toBeNull();
    });

    it('dispatches a bubbling native input event when a commit changes the value, and not before', async () => {
        const { input } = await mount('');
        const events: Event[] = [];
        input.focus();
        await typeIn(input, 'SEC');
        input.addEventListener('input', (e) => events.push(e));

        press(input, 'Tab');
        await wait();
        // The accept only changed the draft: no host-form event yet.
        expect(events.length).toBe(0);

        await commit(input);
        expect(events.length).toBeGreaterThan(0);
        expect(events[0].bubbles).toBe(true);
        expect(input.value).toBe('SECRET');
    });

    it('reconciles typed-but-unaccepted text through the engine on blur (backspace and retype, never accepted from the dropdown)', async () => {
        const { input, field } = await mount('');
        input.dispatchEvent(new FocusEvent('focus'));
        await wait();

        // Type a full valid marking, backspace it to an invalid partial, then
        // retype it back to valid: entirely locally, never accepted via
        // Tab/Enter/a dropdown click.
        input.value = 'SECRET';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        await wait();
        input.value = 'SECR';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        await wait();
        input.value = 'SECRET';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        await wait();

        input.dispatchEvent(new FocusEvent('blur'));
        await wait(200);

        // After blur, host text, painted tokens, and getAssertions() must all
        // reflect the typed marking.
        expect(input.value).toBe('SECRET');
        expect(field.getRendered()).toBe('SECRET');
        expect(field.getAssertions().map((a) => a.conceptId)).toEqual(['S']);
        const display = root.querySelector(
            '.marking-field-display',
        ) as HTMLDivElement;
        const tokens = display.querySelectorAll('.marking-field-token');
        expect(Array.from(tokens).map((t) => t.textContent)).toEqual([
            'SECRET',
        ]);
    });

    it('keeps unrecognized typed text on blur as a visible invalid draft and stores nothing', async () => {
        const { input, field } = await mount('SECRET');
        input.focus();
        await typeIn(input, 'totally bogus');

        await leave(input);

        // Nothing is stored and the committed value is untouched; the text
        // stays on screen (not the placeholder, not the old paint), marked
        // invalid, with the reason under the field.
        expect(field.getAssertions().map((a) => a.conceptId)).toEqual(['S']);
        expect(field.getRendered()).toBe('SECRET');
        expect(input.value).toBe('totally bogus');
        expect(input.classList.contains('marking-field-host--resting')).toBe(
            false,
        );
        expect(input.getAttribute('aria-invalid')).toBe('true');
        const note = root.querySelector('.ez-composer-note') as HTMLElement;
        expect(note.hidden).toBe(false);
        expect(note.textContent).toContain('is not recognized');
        // A host form cannot submit the unsaved text as if it were the value.
        expect(input.validity.valid).toBe(false);
        expect(input.validationMessage).toContain('is not recognized');

        // Reverting the draft makes the field valid again.
        input.focus();
        press(input, 'Escape');
        await wait();
        expect(input.value).toBe('SECRET');
        expect(input.validity.valid).toBe(true);
    });

    it('names the broken rule, not "not recognized", for a fully read draft with two values in a single-choice category', async () => {
        const { input, field } = await mount('SECRET');
        input.focus();
        await typeIn(input, 'SECRET//UNCLASSIFIED');

        // While typing: the row says it will not save and why, with both
        // values still on screen for the rule to talk about.
        const result = openSurface()!.querySelector(
            '.ez-composer__result',
        ) as HTMLElement;
        expect(result.dataset.state).toBe('incomplete');
        expect(
            result.querySelector('.ez-composer__result-value')!.textContent,
        ).toBe('SECRET//UNCLASSIFIED');
        const rule = result.querySelector('.ez-composer__result-rule');
        expect(rule?.textContent).toMatch(/allows one value/);
        expect(rule?.textContent).not.toMatch(/not recognized/);

        await leave(input);

        // Nothing was stored and nothing was silently dropped: the text stays,
        // and the note under the field repeats the rule.
        expect(field.getAssertions().map((a) => a.conceptId)).toEqual(['S']);
        expect(input.value).toBe('SECRET//UNCLASSIFIED');
        expect(input.getAttribute('aria-invalid')).toBe('true');
        const note = root.querySelector('.ez-composer-note') as HTMLElement;
        expect(note.textContent).toMatch(/allows one value/);
        expect(note.textContent).not.toMatch(/not recognized/);
    });

    it('keeps a render-suppressed certain assertion across a keystroke instead of dropping it', async () => {
        root.innerHTML = `<textarea id="mf" data-ezclassify-controller="marking"></textarea>`;
        forms = new EzClassifyUI(
            createTestEngine({ withSuppressedCategory: true }) as never,
            { root },
        );
        await wait();
        const input = document.getElementById('mf') as HTMLTextAreaElement;
        const field = forms.components.get(input) as MarkingField;

        field.setAssertions([
            {
                conceptId: 'S',
                categoryId: 'level',
                confidence: 'certain',
                source: 'user',
            },
            {
                conceptId: 'MAIN',
                categoryId: 'branch',
                confidence: 'certain',
                source: 'user',
            },
        ]);
        await wait();

        // MAIN is certain/user-asserted but no field binds the 'branch'
        // category, so its label has no literal text anywhere in the
        // rendered/typed value.
        expect(field.getRendered()).toBe('SECRET');
        expect(input.value).toBe('SECRET');

        input.dispatchEvent(new FocusEvent('focus'));
        await wait();
        // One ordinary keystroke: a single space.
        input.value = input.value + ' ';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        await wait();

        expect(
            field
                .getAssertions()
                .map((a) => a.conceptId)
                .sort(),
        ).toEqual(['MAIN', 'S']);
    });

    it('un-checks a row live when its trailing text is deleted, without waiting for blur', async () => {
        const { input, field } = await mount('SECRET//NOFORN');
        input.focus();

        // Backspace "NOFORN" off the end, never accepted or removed via the
        // list.
        await typeIn(input, 'SECRET//', 120);

        expect(rowFor('NOFORN')?.getAttribute('aria-selected')).toBe('false');
        // Right after the separator the chosen level is not listed: it has no
        // next part to give.
        expect(rowFor('SECRET')).toBeUndefined();
        expect(resultValue()).toBe('SECRET');

        // Still focused, never committed: the stored value has not changed.
        expect(
            field
                .getAssertions()
                .map((a) => a.conceptId)
                .sort(),
        ).toEqual(['NF', 'S']);
    });

    // After a partial delete, accepting a dropdown row must reconcile with
    // the live typed marking before adding the new assertion. Deleted
    // concepts must stay deleted in the committed marking.
    it('does not resurrect deleted concepts when a new one is accepted after a partial delete', async () => {
        root.innerHTML = `<textarea id="mf" data-ezclassify-controller="marking">SECRET//SI/TK/NOFORN</textarea>`;
        forms = new EzClassifyUI(
            createTestEngine({ withReleasabilityConcepts: true }) as never,
            { root },
        );
        await wait();
        const input = document.getElementById('mf') as HTMLTextAreaElement;
        const field = forms.components.get(input) as MarkingField;
        input.focus();
        expect(
            field
                .getAssertions()
                .map((a) => a.conceptId)
                .sort(),
        ).toEqual(['NF', 'S', 'SI', 'TK']);

        // Delete "SI/TK/NOFORN" off the end, down to "SECRET//".
        await typeIn(input, 'SECRET//', 120);
        const relRow = rowFor('REL')!;
        expect(relRow).toBeTruthy();

        relRow.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        await wait();
        await commit(input);

        // Only the surviving prefix (SECRET) plus the accepted concept (REL):
        // SI/TK/NOFORN must NOT be back.
        expect(
            field
                .getAssertions()
                .map((a) => a.conceptId)
                .sort(),
        ).toEqual(['REL', 'S']);
        expect(field.getRendered()).toBe('SECRET//REL');
        expect(input.value).toBe('SECRET//REL');
    });

    it('does not resurrect deleted concepts when the survivor is removed via checked-row toggle-off after a partial delete', async () => {
        root.innerHTML = `<textarea id="mf" data-ezclassify-controller="marking">SECRET//SI/TK/NOFORN</textarea>`;
        forms = new EzClassifyUI(
            createTestEngine({ withReleasabilityConcepts: true }) as never,
            { root },
        );
        await wait();
        const input = document.getElementById('mf') as HTMLTextAreaElement;
        const field = forms.components.get(input) as MarkingField;
        input.focus();

        // Delete "TK/NOFORN" off the end, leaving "SECRET//SI/". SI is the
        // one surviving, still-checked caveat.
        await typeIn(input, 'SECRET//SI/', 120);
        const siRow = rowFor('SI')!;
        expect(siRow.getAttribute('aria-selected')).toBe('true');

        // Toggle SI off via its checked row.
        siRow.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        await wait();
        await commit(input);

        // TK/NOFORN stay gone; SI is removed too, leaving the level concept.
        expect(field.getAssertions().map((a) => a.conceptId)).toEqual(['S']);
        expect(field.getRendered()).toBe('SECRET');
    });

    it('carries a render-suppressed certain concept through an accept that follows a partial delete', async () => {
        root.innerHTML = `<textarea id="mf" data-ezclassify-controller="marking"></textarea>`;
        forms = new EzClassifyUI(
            createTestEngine({
                withSuppressedCategory: true,
                withReleasabilityConcepts: true,
            }) as never,
            { root },
        );
        await wait();
        const input = document.getElementById('mf') as HTMLTextAreaElement;
        const field = forms.components.get(input) as MarkingField;

        // No field of the render format binds MAIN's 'branch' category:
        // there is no text for a raw parse to ever recover it from.
        field.setAssertions([
            {
                conceptId: 'S',
                categoryId: 'level',
                confidence: 'certain',
                source: 'user',
            },
            {
                conceptId: 'SI',
                categoryId: 'caveat',
                confidence: 'certain',
                source: 'user',
            },
            {
                conceptId: 'TK',
                categoryId: 'caveat',
                confidence: 'certain',
                source: 'user',
            },
            {
                conceptId: 'NF',
                categoryId: 'caveat',
                confidence: 'certain',
                source: 'user',
            },
            {
                conceptId: 'MAIN',
                categoryId: 'branch',
                confidence: 'certain',
                source: 'user',
            },
        ]);
        await wait();
        expect(field.getRendered()).toBe('SECRET//NOFORN/SI/TK');

        input.focus();
        await typeIn(input, 'SECRET//', 120);
        const relRow = rowFor('REL')!;
        expect(relRow).toBeTruthy();
        relRow.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        await wait();
        await commit(input);

        // MAIN survives (carried forward, still invisible to the format);
        // SI/TK/NOFORN stay gone; REL is the new addition.
        expect(
            field
                .getAssertions()
                .map((a) => a.conceptId)
                .sort(),
        ).toEqual(['MAIN', 'REL', 'S']);
        expect(field.getRendered()).toBe('SECRET//REL');
    });

    describe('a complete token under the caret', () => {
        /**
         * Replace a prefilled marking with three tolerant tokens whose last one
         * is a complete concept, so the reading already carries it. Every way
         * of leaving that state must land on the same three facts.
         */
        async function typeThreeTokens(): Promise<{
            input: HTMLTextAreaElement;
            field: MarkingField;
        }> {
            root.innerHTML = `<textarea id="mf" data-ezclassify-controller="marking">UNCLASSIFIED//ORCON</textarea>`;
            forms = new EzClassifyUI(
                createTestEngine({ withReleasabilityConcepts: true }) as never,
                { root },
            );
            await wait();
            const input = document.getElementById('mf') as HTMLTextAreaElement;
            const field = forms.components.get(input) as MarkingField;
            input.focus();
            await typeIn(input, 'secret//si/tk', 120);
            return { input, field };
        }

        function conceptIds(field: MarkingField): string[] {
            return field
                .getAssertions()
                .map((a) => a.conceptId)
                .sort();
        }

        it('shows the token own concept checked, arms nothing, and names no action for it', async () => {
            const { input } = await typeThreeTokens();
            const row = rowFor('TK')!;
            expect(row.getAttribute('aria-selected')).toBe('true');
            expect(row.textContent).not.toContain('Remove');
            expect(activeRow(input)).toBeNull();
            expect(resultValue()).toBe('SECRET//SI/TK');
        });

        it('Enter commits all three facts', async () => {
            const { input, field } = await typeThreeTokens();
            await commit(input);
            expect(conceptIds(field)).toEqual(['S', 'SI', 'TK']);
            expect(field.getRendered()).toBe('SECRET//SI/TK');
            expect(input.value).toBe('SECRET//SI/TK');
        });

        it('Tab leaves the field and the blur commits all three facts', async () => {
            const { input, field } = await typeThreeTokens();
            const tab = press(input, 'Tab');
            expect(tab.defaultPrevented).toBe(false);
            await leave(input);
            expect(conceptIds(field)).toEqual(['S', 'SI', 'TK']);
            expect(input.value).toBe('SECRET//SI/TK');
        });

        it('a click on the row keeps all three facts', async () => {
            const { input, field } = await typeThreeTokens();
            rowFor('TK')!.dispatchEvent(
                new MouseEvent('click', { bubbles: true }),
            );
            await wait();
            await commit(input);
            expect(conceptIds(field)).toEqual(['S', 'SI', 'TK']);
            expect(input.value).toBe('SECRET//SI/TK');
        });

        it('blur lands on the same three facts', async () => {
            const { input, field } = await typeThreeTokens();
            await leave(input);
            expect(conceptIds(field)).toEqual(['S', 'SI', 'TK']);
            expect(input.value).toBe('SECRET//SI/TK');
        });

        it('a checked row removes its settled concept even while a token is typed', async () => {
            const { input, field } = await typeThreeTokens();
            await typeIn(input, 'secret//si/s', 120);
            const siRow = rowFor('SI')!;
            expect(siRow.getAttribute('aria-selected')).toBe('true');

            siRow.dispatchEvent(new MouseEvent('click', { bubbles: true }));
            await wait();
            await commit(input);

            expect(conceptIds(field)).toEqual(['S']);
            expect(input.value).toBe('SECRET');
        });

        it('Tab never removes a settled concept when it is the only match', async () => {
            const { input, field } = await typeThreeTokens();
            // Retyping a settled concept: its only match is its own row.
            await typeIn(input, 'secret//tk/tk', 120);
            const concepts = rows().filter((r) => r.dataset.kind === 'concept');
            expect(concepts).toHaveLength(1);
            expect(activeRow(input)).toBeNull();

            const tab = press(input, 'Tab');
            await wait();

            // Nothing was accepted, so Tab moves on, and nothing is stored
            // until the blur commit.
            expect(tab.defaultPrevented).toBe(false);
            expect(conceptIds(field)).toEqual(['ORCON', 'U']);
        });
    });

    it('reads the text as typed when a row is pressed an instant after a keystroke', async () => {
        root.innerHTML = `<textarea id="mf" data-ezclassify-controller="marking">SECRET//SI/TK/NOFORN</textarea>`;
        forms = new EzClassifyUI(
            createTestEngine({ withReleasabilityConcepts: true }) as never,
            { root },
        );
        await wait();
        const input = document.getElementById('mf') as HTMLTextAreaElement;
        const field = forms.components.get(input) as MarkingField;
        await openPicker(input);

        // The REL row from the PRE-keystroke render.
        const relRow = rowFor('REL')!;
        expect(relRow).toBeTruthy();

        // Delete "SI/TK/NOFORN" and press REL IMMEDIATELY, before the
        // keystroke's own reading lands.
        typeText(input, 'SECRET//');
        relRow.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        await wait();
        await commit(input);

        // The accept worked on "SECRET//" as typed, not the stale committed
        // value: SI/TK/NOFORN must not resurrect.
        expect(
            field
                .getAssertions()
                .map((a) => a.conceptId)
                .sort(),
        ).toEqual(['REL', 'S']);
        expect(field.getRendered()).toBe('SECRET//REL');
    });

    it('keeps a render-suppressed certain concept checked in the list across an unrelated keystroke', async () => {
        root.innerHTML = `<textarea id="mf" data-ezclassify-controller="marking"></textarea>`;
        forms = new EzClassifyUI(
            createTestEngine({ withSuppressedCategory: true }) as never,
            { root },
        );
        await wait();
        const input = document.getElementById('mf') as HTMLTextAreaElement;
        const field = forms.components.get(input) as MarkingField;

        field.setAssertions([
            {
                conceptId: 'S',
                categoryId: 'level',
                confidence: 'certain',
                source: 'user',
            },
            {
                conceptId: 'MAIN',
                categoryId: 'branch',
                confidence: 'certain',
                source: 'user',
            },
        ]);
        await wait();

        await openPicker(input);
        await typeIn(input, input.value + ' ', 120);

        // OUR SCHOOL has no literal text anywhere in the typed value (no
        // field binds branch): only a string match against its label could
        // drop it from the checked set.
        expect(rowFor('OUR SCHOOL')?.getAttribute('aria-selected')).toBe(
            'true',
        );
    });

    it('keeps a default-only, render-suppressed concept checked through an unrelated accept', async () => {
        root.innerHTML = `<textarea id="mf" data-ezclassify-controller="marking">SECRET</textarea>`;
        forms = new EzClassifyUI(
            createTestEngine({ withSuppressedCategoryDefault: true }) as never,
            { root },
        );
        await wait();
        const input = document.getElementById('mf') as HTMLTextAreaElement;
        const field = forms.components.get(input) as MarkingField;

        expect(
            field
                .getAssertions()
                .map((a) => a.conceptId)
                .sort(),
        ).toEqual(['MAIN', 'S']);

        await openPicker(input);
        const mainRowChecked = () =>
            rowFor('OUR SCHOOL')?.getAttribute('aria-selected') === 'true';
        expect(mainRowChecked()).toBe(true);

        await typeIn(input, input.value + ' ', 120);
        expect(mainRowChecked()).toBe(true);

        rowFor('NOFORN')!.dispatchEvent(
            new MouseEvent('click', { bubbles: true }),
        );
        await wait();
        expect(mainRowChecked()).toBe(true);
        await commit(input);

        expect(
            field
                .getAssertions()
                .map((a) => a.conceptId)
                .sort(),
        ).toEqual(['MAIN', 'NF', 'S']);
    });

    it('settles a rapid type-delete-type race on the final text, not an intermediate one', async () => {
        const { input, field } = await mount('SECRET//ORCON');
        input.focus();

        // Three input events back to back: only the last reading may land.
        typeText(input, 'SECRET//ORCO');
        typeText(input, 'SECRET');
        typeText(input, 'SECRET//NOFORN/');
        await wait(150);

        expect(rowFor('NOFORN')?.getAttribute('aria-selected')).toBe('true');
        expect(rowFor('ORCON')?.getAttribute('aria-selected')).toBe('false');
        expect(resultValue()).toBe('SECRET//NOFORN');
        // Still uncommitted: the stored value is the mounted marking.
        expect(
            field
                .getAssertions()
                .map((a) => a.conceptId)
                .sort(),
        ).toEqual(['ORCON', 'S']);
    });

    it('two MarkingFields sharing a parent each resolve to their OWN host, with no phantom input event on mount', async () => {
        root.innerHTML = `
            <textarea id="a" data-ezclassify-controller="marking">SECRET</textarea>
            <textarea id="b" data-ezclassify-controller="marking">NOFORN</textarea>
        `;
        const inputA = document.getElementById('a') as HTMLTextAreaElement;
        const inputB = document.getElementById('b') as HTMLTextAreaElement;
        const eventsOnB: Event[] = [];
        inputB.addEventListener('input', (e) => eventsOnB.push(e));

        forms = new EzClassifyUI(createTestEngine() as never, { root });
        await wait();

        const fieldA = forms.components.get(inputA) as MarkingField;
        const fieldB = forms.components.get(inputB) as MarkingField;
        expect(fieldA).toBeInstanceOf(MarkingField);
        expect(fieldB).toBeInstanceOf(MarkingField);

        // Base's naive "first input under the shared parent" lookup would
        // have bound BOTH fields to input #a; the mount-host-registry
        // correction must leave each field on its own input with its own
        // parsed value.
        expect(inputA.value).toBe('SECRET');
        expect(inputB.value).toBe('NOFORN');
        expect(fieldA.getAssertions().map((a) => a.conceptId)).toEqual(['S']);
        expect(fieldB.getAssertions().map((a) => a.conceptId)).toEqual(['NF']);
        // The correction must not announce itself as a user edit on the field
        // nobody touched.
        expect(eventsOnB).toHaveLength(0);
    });

    it('accepting and committing through an async (remote-shaped) engine reaches the same end state as a local one', async () => {
        root.innerHTML = `<textarea id="mf" data-ezclassify-controller="marking"></textarea>`;
        forms = new EzClassifyUI(toAsyncAdapter(createTestEngine()) as never, {
            root,
        });
        await wait();
        const input = document.getElementById('mf') as HTMLTextAreaElement;
        const field = forms.components.get(input) as MarkingField;

        input.focus();
        await typeIn(input, 'SEC', 150);
        press(input, 'Tab');
        await wait(150);
        press(input, 'Enter');
        await wait(200);

        expect(field.getRendered()).toBe('SECRET');
        expect(field.getAssertions().map((a) => a.conceptId)).toEqual(['S']);
        expect(input.value).toBe('SECRET');
    });

    it('releases the re-entrancy guard only once an async accept write actually lands, not synchronously', async () => {
        const real = createTestEngine();
        const suggestSpy = vi.spyOn(real, 'suggest');
        root.innerHTML = `<textarea id="mf" data-ezclassify-controller="marking"></textarea>`;
        forms = new EzClassifyUI(toAsyncAdapter(real) as never, { root });
        await wait(60);
        const input = document.getElementById('mf') as HTMLTextAreaElement;

        input.dispatchEvent(new FocusEvent('focus'));
        await wait(60);
        input.value = 'SEC';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        await wait(120);

        input.dispatchEvent(
            new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }),
        );
        // The accept's own refreshSuggestions() call now resolves its live
        // assertions (a process() call on the typed text) before its
        // suggest() call, so both settle asynchronously instead of the
        // suggest() firing synchronously within the keydown dispatch. Wait
        // for that chain to fully land before taking the baseline count.
        await wait(60);
        const callsAfterAcceptSettles = suggestSpy.mock.calls.length;

        // Let the async engine.process() write land (fires
        // onAssertionsChanged -> host-value write -> bubbling `input` event
        // this field listens to itself), then wait through a full debounce
        // window past that with nothing else happening. If the guard had
        // released synchronously instead of in onAssertionsChanged, that
        // bubbling event would have been treated as real typing and scheduled
        // one more suggest() call here.
        await wait(200);

        expect(suggestSpy.mock.calls.length).toBe(callsAfterAcceptSettles);
    });

    it('keeps what is typed while a commit is still being stored', async () => {
        // Engine reads wait while `holding`, so the commit's store round trip
        // is still out when the user types again.
        const real = createTestEngine();
        let holding = false;
        const held: Array<() => void> = [];
        const engine = new Proxy(real as object, {
            get(target, prop, receiver) {
                const value = Reflect.get(target, prop, receiver);
                if (typeof value !== 'function') return value;
                if (prop !== 'process') return value.bind(target);
                return (...args: unknown[]) => {
                    const result = value.apply(target, args);
                    if (!holding) return result;
                    return new Promise((r) => held.push(() => r(result)));
                };
            },
        });
        root.innerHTML = `<textarea id="mf" data-ezclassify-controller="marking"></textarea>`;
        forms = new EzClassifyUI(engine as never, { root });
        await wait();
        const input = document.getElementById('mf') as HTMLTextAreaElement;
        input.focus();
        await typeIn(input, 'SECRET NOFORN');

        holding = true;
        press(input, 'Enter');
        await wait(20);
        expect(held.length).toBeGreaterThan(0);

        // A real keystroke: keydown, the browser's own edit and input event,
        // keyup. Nothing moves the caret by script.
        input.dispatchEvent(
            new KeyboardEvent('keydown', { key: 'N', bubbles: true }),
        );
        input.value = 'SECRET NOFORN ORCON';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(
            new KeyboardEvent('keyup', { key: 'N', bubbles: true }),
        );

        holding = false;
        held.splice(0).forEach((release) => release());
        await wait(150);
        expect(input.value).toMatch(/ORCON/);
    });

    it('restores an authored rows attribute on destroy instead of deleting it', async () => {
        // Setup applies the JS-sized rows floor while enhanced. Destroy must
        // restore the authored rows attribute when returning the plain textarea.
        root.innerHTML = `<textarea id="mf" rows="4" data-ezclassify-controller="marking">SECRET</textarea>`;
        forms = new EzClassifyUI(createTestEngine() as never, { root });
        await wait();
        const input = document.getElementById('mf') as HTMLTextAreaElement;
        const field = forms.components.get(input) as MarkingField;
        expect(input.getAttribute('rows')).toBe('1');

        field.destroy();

        expect(input.getAttribute('rows')).toBe('4');
    });

    it('removes rows entirely on destroy when the author never set one', async () => {
        const { input, field } = await mount('SECRET');
        expect(input.getAttribute('rows')).toBe('1');

        field.destroy();

        expect(input.hasAttribute('rows')).toBe(false);
    });

    it('cleans up on destroy: restores the native input to a plain, unmarked, visible field and removes the portaled picker', async () => {
        const { input, field } = await mount('SECRET');
        await openPicker(input);
        const surface = openSurface()!;
        const surfaceId = surface.id;

        field.destroy();

        expect(root.querySelector('.marking-field-wrap')).toBeNull();
        expect(root.contains(input)).toBe(true);
        expect(document.getElementById(surfaceId)).toBeNull();

        // The re-parented input must be USABLE: no leftover classes,
        // resting-visibility state, or ARIA pointing at the removed list.
        expect(input.classList.contains('marking-field-host')).toBe(false);
        expect(input.classList.contains('marking-field-host--resting')).toBe(
            false,
        );
        expect(input.style.display).not.toBe('none');
        expect(input.hasAttribute('role')).toBe(false);
        expect(input.hasAttribute('aria-expanded')).toBe(false);
        expect(input.hasAttribute('aria-autocomplete')).toBe(false);
        expect(input.hasAttribute('aria-controls')).toBe(false);
        expect(input.hasAttribute('aria-activedescendant')).toBe(false);
    });

    it('never shows a tooltip popup from a keyboard highlight; the active row carries its definition, reachable via aria-describedby', async () => {
        const { input, field } = await mount('');
        await openPicker(input);
        // Group labels are not in the arrow path: the first ArrowDown lands
        // on the first concept row.
        press(input, 'ArrowDown');
        await wait();
        const row = activeRow(input);
        expect(row?.getAttribute('role')).toBe('option');

        // No popup appears from resting a keyboard highlight on a row.
        await wait(700);
        expect(document.body.querySelector('.ez-tooltip')).toBeNull();

        // The active row alone carries a one-line definition, referenced by
        // aria-describedby so a screen reader hears it with the row.
        const describedById =
            activeRow(input)!.getAttribute('aria-describedby');
        expect(describedById).toBeTruthy();
        const def = document.getElementById(describedById!);
        expect(def?.className).toBe('ez-composer__definition');
        expect(def?.textContent).not.toBe('');

        expect(() => field.destroy()).not.toThrow();
        await wait(700);
        expect(document.body.querySelector('.ez-tooltip')).toBeNull();
    });
});

/**
 * Mount a MarkingField declaratively through EzClassifyUI, the same
 * scanner-mounted path `mount()` above uses, with a `favorites` config passed
 * at the constructor level (the only way a declarative host reaches it; see
 * `ezclassify-ui-favorites-option.spec.ts`).
 *
 * The declarative textarea mount exercises the scanner's host resolution and
 * setup-time host validation before applying favorites.
 */
async function mountWithFavorites(
    favorites: import('./favorites-panel').FavoritesConfig | undefined,
    initialValue = '',
): Promise<{
    input: HTMLTextAreaElement;
    field: MarkingField;
    forms: EzClassifyUI;
}> {
    root.innerHTML = `<textarea id="mf-fav" data-ezclassify-controller="marking">${initialValue}</textarea>`;
    const forms = new EzClassifyUI(createTestContext(), {
        root,
        favorites,
    });
    await wait();
    const input = document.getElementById('mf-fav') as HTMLTextAreaElement;
    const field = forms.components.get(input) as MarkingField;
    expect(field).toBeInstanceOf(MarkingField);
    return { input, field, forms };
}

describe('MarkingField favorites', () => {
    let activeForms: EzClassifyUI | null = null;

    afterEach(() => {
        activeForms?.destroy();
        activeForms = null;
    });

    it('renders no ★ button when favorites is not wired', async () => {
        const { forms } = await mountWithFavorites(undefined);
        activeForms = forms;
        expect(root.querySelector('.ez-favorites-button')).toBeNull();
    });

    it('renders the ★ button, applies a favorite (replaces the marking), and reflects star-fill', async () => {
        const load = vi.fn(async () => [
            { marking: 'SECRET//NOFORN', label: 'Standard secret' },
        ]);
        const { input, field, forms } = await mountWithFavorites({ load });
        activeForms = forms;

        const button = root.querySelector(
            '.ez-favorites-button',
        ) as HTMLButtonElement;
        expect(button).not.toBeNull();

        button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        await wait();

        const row = document.body.querySelector(
            '.ez-favorites-panel .proto-dropdown-item',
        ) as HTMLElement;
        expect(row.textContent).toContain('Standard secret');
        row.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        await wait();

        expect(field.getRendered()).toBe('SECRET//NOFORN');
        expect(
            field
                .getAssertions()
                .map((a) => a.conceptId)
                .sort(),
        ).toEqual(['NF', 'S']);
        expect(input.value).toBe('SECRET//NOFORN');

        // Reopening now shows the applied favorite as the current one (star-fill).
        button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        await wait();
        expect(button.classList.contains('ez-favorites-button--active')).toBe(
            true,
        );
    });

    it('offers the pinned save row for a valid non-empty marking and calls config.save', async () => {
        const save = vi.fn(async () => {});
        const { forms } = await mountWithFavorites(
            { load: vi.fn(async () => []), save },
            'SECRET',
        );
        activeForms = forms;

        const button = root.querySelector(
            '.ez-favorites-button',
        ) as HTMLButtonElement;
        button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        await wait();

        const pinned = document.body.querySelector(
            '.ez-favorites-panel__pinned',
        ) as HTMLElement;
        expect(pinned).not.toBeNull();
        expect(pinned.textContent).toContain('SECRET');

        pinned.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        await wait();
        expect(save).toHaveBeenCalledWith('SECRET');
    });
});
