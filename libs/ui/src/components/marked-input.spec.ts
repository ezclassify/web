import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { openSurface, press, rowFor } from './composer/composer-harness';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Context } from '@ezclassify/engine';
import type { LocalSchemeEngineAdapter } from '@ezclassify/types';
import { MarkedInput } from './marked-input';
import { InlineMarkingEditor } from './inline-marking-editor';
import { EzClassifyUI } from '../ezclassify-ui';

/**
 * User interactions address the owned editor; form assertions use the original
 * host.
 */
function editingField(id: string): HTMLTextAreaElement | null {
    const host = document.getElementById(id);
    return (
        host
            ?.closest('.marked-input-wrap')
            ?.querySelector<HTMLTextAreaElement>('.marked-input-native') ?? null
    );
}
function nativeField(editor: Element): HTMLElement {
    return editor
        .closest('.marked-input-wrap')!
        .querySelector<HTMLInputElement>('input')!;
}

function wait(ms = 50): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
}

/**
 * Engine that uses the correct bare-render architecture: the part format
 * returns "U" (no wrapping parens); MI applies the embedded_marking template to
 * produce "(U) " exactly once. The template is a parameter so specs can cover
 * schemes that declare no trailing space (e.g. "({marking})").
 */
function createBareEngineWithTemplate(
    template: string,
): LocalSchemeEngineAdapter {
    return Context.fromComponents({
        scheme: {
            scheme: {
                id: 'mi-bare',
                version: '1.0.0',
                name: 'MarkedInput Bare Format Test',
                data: {
                    concepts: {
                        inline: [
                            {
                                id: 'U',
                                name: 'Unclassified',
                                views: { default: 'U' },
                                categories: ['level'],
                                parents: [],
                                aliases: [],
                                position: 1,
                                rank: 1,
                            },
                            {
                                id: 'S',
                                name: 'Secret',
                                views: { default: 'S' },
                                categories: ['level'],
                                parents: [],
                                aliases: [],
                                position: 2,
                                rank: 2,
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
                    ],
                },
                rules: [],
                embedded_marking: [{ pattern: '\\(([^)]+)\\)', template }],
                parse: {
                    case_sensitive: false,
                    strip_whitespace: true,
                },
                render: {
                    default: 'portion',
                    formats: [
                        // Bare format: engine.render() returns "U", not "(U)".
                        // The MI/MTA template applies the () wrapper exactly once.
                        {
                            id: 'portion',
                            surface: 'marking',
                            mode: 'inline',
                            separator: '//',
                            fields: [{ category: 'level', separator: '/' }],
                        },
                    ],
                },
            },
        },
    }).scheme as LocalSchemeEngineAdapter;
}

function createBareFormatEngine(): LocalSchemeEngineAdapter {
    return createBareEngineWithTemplate('({marking}) ');
}

function createTestEngine(): LocalSchemeEngineAdapter {
    return Context.fromComponents({
        scheme: {
            scheme: {
                id: 'mi-test',
                version: '1.0.0',
                name: 'MarkedInput Test',
                data: {
                    concepts: {
                        inline: [
                            {
                                id: 'U',
                                name: 'Unclassified',
                                views: { default: 'U' },
                                categories: ['level'],
                                parents: [],
                                aliases: [],
                                position: 1,
                                rank: 1,
                            },
                            {
                                id: 'S',
                                name: 'Secret',
                                views: { default: 'S' },
                                categories: ['level'],
                                parents: [],
                                aliases: [],
                                position: 2,
                                rank: 2,
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
                    ],
                },
                rules: [],
                embedded_marking: [
                    { pattern: '\\(([^)]+)\\)', template: '({marking}) ' },
                ],
                parse: {
                    case_sensitive: false,
                    strip_whitespace: true,
                },
                render: {
                    default: 'portion',
                    formats: [
                        {
                            id: 'portion',
                            surface: 'marking',
                            mode: 'inline',
                            separator: '//',
                            fields: [{ category: 'level', separator: '/' }],
                        },
                    ],
                },
            },
        },
    }).scheme as LocalSchemeEngineAdapter;
}

/**
 * Same S/U vocabulary and embedded_marking template as `createTestEngine`, but
 * returns the raw `Context` (not narrowed to `.scheme`) so favorites tests can
 * mount MarkedInput directly via `.init()`: favorites config is a plain JS
 * function with no declarative `data-ezclassify-*` equivalent.
 */
function createTestContext() {
    return Context.fromComponents({
        scheme: {
            scheme: {
                id: 'mi-fav-test',
                version: '1.0.0',
                name: 'MarkedInput Favorites Test',
                data: {
                    concepts: {
                        inline: [
                            {
                                id: 'U',
                                name: 'Unclassified',
                                views: { default: 'U' },
                                categories: ['level'],
                                parents: [],
                                aliases: [],
                                position: 1,
                                rank: 1,
                            },
                            {
                                id: 'S',
                                name: 'Secret',
                                views: { default: 'S' },
                                categories: ['level'],
                                parents: [],
                                aliases: [],
                                position: 2,
                                rank: 2,
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
                    ],
                },
                rules: [],
                embedded_marking: [
                    { pattern: '\\(([^)]+)\\)', template: '({marking}) ' },
                ],
                parse: {
                    case_sensitive: false,
                    strip_whitespace: true,
                },
                render: {
                    default: 'portion',
                    formats: [
                        {
                            id: 'portion',
                            surface: 'marking',
                            mode: 'inline',
                            separator: '//',
                            fields: [{ category: 'level', separator: '/' }],
                        },
                    ],
                },
            },
        },
    });
}

/**
 * Two-category engine for testing multi-category assertion preservation. Has
 * `level` (U/S) and `scope` (LOCAL/REGIONAL), the part format renders both so
 * we can detect when one category is silently dropped.
 */
function createMultiCategoryEngine(): LocalSchemeEngineAdapter {
    return Context.fromComponents({
        scheme: {
            scheme: {
                id: 'mi-multi',
                version: '1.0.0',
                name: 'MarkedInput Multi-Category Test',
                data: {
                    concepts: {
                        inline: [
                            {
                                id: 'U',
                                name: 'Unclassified',
                                views: { default: 'U' },
                                categories: ['level'],
                                parents: [],
                                aliases: [],
                                position: 1,
                                rank: 1,
                            },
                            {
                                id: 'S',
                                name: 'Secret',
                                views: { default: 'S' },
                                categories: ['level'],
                                parents: [],
                                aliases: [],
                                position: 2,
                                rank: 2,
                            },
                            {
                                id: 'LOCAL',
                                name: 'Local',
                                views: { default: 'LOCAL' },
                                categories: ['scope'],
                                parents: [],
                                aliases: [],
                                position: 1,
                                rank: 1,
                            },
                            {
                                id: 'REGIONAL',
                                name: 'Regional',
                                views: { default: 'REGIONAL' },
                                categories: ['scope'],
                                parents: [],
                                aliases: [],
                                position: 2,
                                rank: 2,
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
                            id: 'scope',
                            label: 'Scope',
                            required: false,
                            single: true,
                            rollup: 'max',
                            position: 2,
                        },
                    ],
                },
                rules: [],
                embedded_marking: [
                    { pattern: '\\(([^)]+)\\)', template: '({marking}) ' },
                ],
                parse: {
                    case_sensitive: false,
                    strip_whitespace: true,
                },
                render: {
                    default: 'long',
                    formats: [
                        {
                            id: 'long',
                            surface: 'marking',
                            mode: 'inline',
                            separator: '//',
                            fields: [
                                { category: 'level', separator: '/' },
                                { category: 'scope', separator: '/' },
                            ],
                        },
                        {
                            id: 'portion',
                            surface: 'marking',
                            mode: 'inline',
                            separator: '//',
                            fields: [
                                { category: 'level', separator: '/' },
                                { category: 'scope', separator: '/' },
                            ],
                        },
                    ],
                },
            },
        },
    }).scheme as LocalSchemeEngineAdapter;
}

let root: HTMLDivElement;
const activeForms: EzClassifyUI[] = [];

beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    document.body.innerHTML = '';
    root = document.createElement('div');
    document.body.appendChild(root);
});

afterEach(() => {
    vi.restoreAllMocks();
    while (activeForms.length > 0) activeForms.pop()!.destroy();
    document.body.innerHTML = '';
});

describe('MarkedInput', () => {
    it('mounts without error and enhances the input element', async () => {
        const engine = createTestEngine();
        root.innerHTML = `
      <input type="text" id="field" data-ezclassify-controller="marked-input">
    `;
        const forms = new EzClassifyUI(engine as never, {});
        activeForms.push(forms);
        await wait(50);

        const inputEl = editingField('field') as HTMLTextAreaElement;
        const comp = forms.components.get(nativeField(inputEl)) as
            MarkedInput | undefined;
        expect(comp).toBeInstanceOf(MarkedInput);
        // The native input is now inside a wrapper div
        expect(inputEl.closest('.marked-input-wrap')).toBeTruthy();
        // Display div exists alongside the input
        expect(
            inputEl
                .closest('.marked-input-wrap')
                ?.querySelector('.marked-input-display'),
        ).toBeTruthy();
    });

    it('the field wraps and grows to show the full chip without ellipsis', () => {
        // The full marking and free-text tail must wrap and grow the field.
        // jsdom has no layout engine, so these checks inspect the stylesheet
        // source directly.
        const here = dirname(fileURLToPath(import.meta.url));
        const css = readFileSync(join(here, 'marked-input.css'), 'utf8');

        expect(css).not.toMatch(/\.marked-input-chip[^{]*\{[^}]*max-width/);
        expect(css).not.toMatch(
            /\.marked-input-chip[^{]*\{[^}]*text-overflow:\s*ellipsis/,
        );
        // The host and display must wrap (not clip) so a long marking or
        // free-text tail grows the field vertically instead.
        expect(css).toMatch(
            /\.marked-input-display\s*\{[^}]*white-space:\s*pre-wrap/,
        );
        expect(css).toMatch(
            /\.marked-input-display\s*\{[^}]*overflow-wrap:\s*break-word/,
        );
        expect(css).toMatch(
            /textarea\.marked-input-native\s*\{[^}]*white-space:\s*pre-wrap/,
        );
    });

    it('the async style re-read derives font from the class-ON inherited state', async () => {
        // The native host uses its class-on inherited font while the display
        // mirrors those metrics. Temporarily unmasking authored colors must not
        // replace that font with the browser control default. Mock the two
        // computed states because jsdom does not apply the stylesheet cascade.
        const engine = createTestEngine();
        root.innerHTML = `<input type="text" id="field" data-ezclassify-controller="marked-input" value="(U) title">`;

        const CLASS_ON_FONT = '16px system-ui'; // what .marked-input-native (font: inherit) resolves to
        const CLASS_OFF_FONT = '13.3333px Arial'; // the UA default control font a bare <textarea> gets

        const target = () => editingField('field') as HTMLTextAreaElement;
        const realGetComputedStyle = window.getComputedStyle.bind(window);
        const spy = vi
            .spyOn(window, 'getComputedStyle')
            .mockImplementation((el: Element) => {
                if (
                    el !== document.getElementById('field') &&
                    !(
                        el.tagName === 'TEXTAREA' &&
                        el.parentElement?.classList.contains(
                            'marked-input-wrap',
                        )
                    )
                )
                    return realGetComputedStyle(el as Element);
                const classOn = (el as HTMLElement).classList.contains(
                    'marked-input-native',
                );
                return {
                    font: classOn ? CLASS_ON_FONT : CLASS_OFF_FONT,
                    padding: '0px',
                    borderWidth: '1px',
                    borderStyle: 'solid',
                    lineHeight: '24px',
                    color: classOn ? 'transparent' : 'rgb(17, 24, 39)',
                    backgroundColor: classOn
                        ? 'transparent'
                        : 'rgb(255, 255, 255)',
                    borderColor: classOn ? 'transparent' : 'rgb(209, 213, 219)',
                } as unknown as CSSStyleDeclaration;
            });

        try {
            const forms = new EzClassifyUI(engine as never, { root });
            activeForms.push(forms);
            await wait(50);
            // The re-read is deferred one requestAnimationFrame tick past mount.
            await new Promise<void>((resolve) =>
                requestAnimationFrame(() => resolve()),
            );
            await wait(20);

            const display = root.querySelector(
                '.marked-input-display',
            ) as HTMLElement;
            // Not a strict equality check: jsdom's CSSOM re-serializes the
            // `font` shorthand once `lineHeight` is also assigned (it folds
            // in as "<size> / <line-height> <family>"), so this checks the
            // parts that matter (which font-size/family won) rather than
            // the exact shorthand string.
            expect(display.style.font).toContain('16px');
            expect(display.style.font).toContain('system-ui');
            expect(display.style.font).not.toContain('13.3333px');
            expect(display.style.font).not.toContain('Arial');
            // The masked triplet must still come from the unmasked (class-off)
            // read: that part of the mechanism is intentional and must keep
            // working: it's the only way to see the host's real border/color
            // through the class's hard-coded transparent values.
            expect(display.style.backgroundColor).toBe('rgb(255, 255, 255)');
            target().dispatchEvent(new Event('focus'));
            target().dispatchEvent(new Event('blur'));
            expect(display.style.borderColor).toBe('rgb(209, 213, 219)');
        } finally {
            spy.mockRestore();
        }
    });

    it('keeps the chrome slot at the bottom of the field, out of normal flow', () => {
        // jsdom has no layout engine, so this reads the source CSS; the real
        // geometry needs a real browser.
        const here = dirname(fileURLToPath(import.meta.url));
        const css = readFileSync(join(here, 'marked-input.css'), 'utf8');
        expect(css).toMatch(
            /\.marked-input-hint-chrome\s*\{[^}]*position:\s*absolute[^}]*bottom:\s*0\.25rem/,
        );
        // The wrap remains the positioning context for the bottom chrome.
        expect(css).toMatch(
            /\.marked-input-wrap\s*\{[^}]*position:\s*relative/,
        );
    });

    it('keeps authored input paint through deferred refresh and theme changes', async () => {
        const engine = createTestEngine();
        root.innerHTML = `<input type="text" id="field" data-ezclassify-controller="marked-input" value="(U) title" style="color: rgb(12, 34, 56); background-color: rgb(245, 246, 247); border-color: rgb(67, 89, 101)">`;
        const native = document.getElementById('field') as HTMLInputElement;
        const realGetComputedStyle = window.getComputedStyle.bind(window);
        const spy = vi
            .spyOn(window, 'getComputedStyle')
            .mockImplementation((el: Element) => {
                const styles = realGetComputedStyle(el);
                // The owned textarea is an editing/measurement layer. Its paint can
                // differ from input-specific host CSS even while unmasked.
                if (
                    el.tagName !== 'TEXTAREA' ||
                    !el.closest('.marked-input-wrap')
                )
                    return styles;
                return new Proxy(styles, {
                    get(target, key) {
                        if (
                            key === 'color' ||
                            key === 'backgroundColor' ||
                            key === 'borderColor'
                        )
                            return 'rgba(0, 0, 0, 0)';
                        const value = Reflect.get(target, key, target);
                        return typeof value === 'function'
                            ? value.bind(target)
                            : value;
                    },
                });
            });
        try {
            const forms = new EzClassifyUI(engine as never, { root });
            activeForms.push(forms);
            await wait(50);
            await new Promise<void>((resolve) =>
                requestAnimationFrame(() => resolve()),
            );
            const display = root.querySelector(
                '.marked-input-display',
            ) as HTMLElement;
            expect(display.style.color).toBe('rgb(12, 34, 56)');
            expect(display.style.backgroundColor).toBe('rgb(245, 246, 247)');
            native.style.color = 'rgb(210, 220, 230)';
            native.style.backgroundColor = 'rgb(20, 30, 40)';
            native.style.borderColor = 'rgb(100, 110, 120)';
            document.documentElement.classList.add('mi-paint-theme');
            await wait(20);
            expect(display.style.color).toBe('rgb(210, 220, 230)');
            expect(display.style.backgroundColor).toBe('rgb(20, 30, 40)');
            const editor = editingField('field')!;
            editor.dispatchEvent(new Event('focus'));
            editor.dispatchEvent(new Event('blur'));
            expect(display.style.borderColor).toBe('rgb(100, 110, 120)');
            expect(editor.classList.contains('marked-input-native')).toBe(true);
            expect(native.value).toBe('(U) title');
        } finally {
            spy.mockRestore();
            document.documentElement.classList.remove('mi-paint-theme');
        }
    });

    it("draws the native input's edge, focused or not, like the rest of the field family", async () => {
        const engine = createTestEngine();
        root.innerHTML = `<input type="text" id="field" data-ezclassify-controller="marked-input" value="(U) title" style="border: 3px dashed rgb(1, 2, 3); border-radius: 5px">`;
        const forms = new EzClassifyUI(engine as never, { root });
        activeForms.push(forms);
        await wait(50);
        await new Promise<void>((resolve) =>
            requestAnimationFrame(() => resolve()),
        );
        const display = root.querySelector(
            '.marked-input-display',
        ) as HTMLElement;
        const editor = editingField('field')!;
        const edge = () => [
            display.style.borderWidth,
            display.style.borderStyle,
            display.style.borderColor,
            display.style.borderRadius,
        ];
        expect(edge()).toEqual(['3px', 'dashed', 'rgb(1, 2, 3)', '5px']);
        // The transparent capture layer shares the edge width, so its text
        // sits exactly over the display's.
        expect(editor.style.borderWidth).toBe('3px');
        editor.dispatchEvent(new Event('focus'));
        expect(edge()).toEqual(['3px', 'dashed', 'rgb(1, 2, 3)', '5px']);
        editor.dispatchEvent(new Event('blur'));
        expect(edge()).toEqual(['3px', 'dashed', 'rgb(1, 2, 3)', '5px']);
    });

    it('disconnects its theme MutationObserver on destroy (no observer leak)', async () => {
        const engine = createTestEngine();
        root.innerHTML = `
      <input type="text" id="field" data-ezclassify-controller="marked-input">
    `;
        const forms = new EzClassifyUI(engine as never, {});
        await wait(50);

        const inputEl = editingField('field') as HTMLTextAreaElement;
        const comp = forms.components.get(nativeField(inputEl)) as unknown as {
            _themeObserver: MutationObserver | null;
        };
        const observer = comp._themeObserver;
        // The theme observer must have been installed on mount.
        expect(observer).toBeInstanceOf(MutationObserver);
        const disconnectSpy = vi.spyOn(observer!, 'disconnect');

        forms.destroy();

        expect(disconnectSpy).toHaveBeenCalledTimes(1);
        expect(comp._themeObserver).toBeNull();
    });

    it('binds two BARE sibling marked-inputs each to its own element (no cross-leak)', async () => {
        const engine = createTestEngine();
        // Two marked-inputs as DIRECT siblings under one parent (root), with NO
        // per-field wrapper. The old parent-wide querySelector fallback bound BOTH
        // controllers to the first input; this asserts each binds its own.
        root.innerHTML = `
      <input type="text" id="a" data-ezclassify-controller="marked-input" value="(S) alpha">
      <input type="text" id="b" data-ezclassify-controller="marked-input" value="(U) bravo">
    `;
        const forms = new EzClassifyUI(engine as never, {});
        activeForms.push(forms);
        await wait(100);

        const inputA = editingField('a') as HTMLTextAreaElement;
        const inputB = editingField('b') as HTMLTextAreaElement;
        const compA = forms.components.get(nativeField(inputA)) as MarkedInput;
        const compB = forms.components.get(nativeField(inputB)) as MarkedInput;
        expect(compA).toBeInstanceOf(MarkedInput);
        expect(compB).toBeInstanceOf(MarkedInput);

        // Each controller enhanced ITS OWN native element, not both bound to A.
        expect((compA as unknown as { input: HTMLTextAreaElement }).input).toBe(
            inputA,
        );
        expect((compB as unknown as { input: HTMLTextAreaElement }).input).toBe(
            inputB,
        );
        const wrapA = inputA.closest('.marked-input-wrap');
        const wrapB = inputB.closest('.marked-input-wrap');
        expect(wrapA).toBeTruthy();
        expect(wrapB).toBeTruthy();
        expect(wrapA).not.toBe(wrapB);

        // Each reflects ITS OWN initial marking, not the first input's.
        expect(compA.getAssertions()[0]?.conceptId).toBe('S');
        expect(compB.getAssertions()[0]?.conceptId).toBe('U');

        // Editing A must not leak into B's value or parsed marking.
        compA.setValue('(S) alpha edited');
        await wait(80);
        expect(compA.getAssertions()[0]?.conceptId).toBe('S');
        expect(inputB.value).toBe('(U) bravo');
        expect(compB.getAssertions()[0]?.conceptId).toBe('U');
    });

    it('parses an initial marked value and exposes assertions', async () => {
        const engine = createTestEngine();
        root.innerHTML = `
      <input type="text" id="field" data-ezclassify-controller="marked-input" value="(U) report title">
    `;
        const forms = new EzClassifyUI(engine as never, {});
        activeForms.push(forms);
        await wait(80);

        const inputEl = editingField('field') as HTMLTextAreaElement;
        const comp = forms.components.get(nativeField(inputEl)) as MarkedInput;
        expect(comp).toBeInstanceOf(MarkedInput);

        // The rendered form is the extracted marking, assertions reflect it
        const assertions = comp.getAssertions();
        expect(assertions.length).toBeGreaterThan(0);
        expect(assertions[0].conceptId).toBe('U');

        // input.value must still hold the full marked string
        expect(inputEl.value).toBe('(U) report title');
    });

    it('keeps input.value in lockstep when setValue is called', async () => {
        const engine = createTestEngine();
        root.innerHTML = `
      <input type="text" id="field" data-ezclassify-controller="marked-input">
    `;
        const forms = new EzClassifyUI(engine as never, {});
        activeForms.push(forms);
        await wait(50);

        const inputEl = editingField('field') as HTMLTextAreaElement;
        const comp = forms.components.get(nativeField(inputEl)) as MarkedInput;

        comp.setValue('(S) quarterly figures');
        await wait(80);

        expect(inputEl.value).toBe('(S) quarterly figures');
        const assertions = comp.getAssertions();
        expect(assertions.some((a) => a.conceptId === 'S')).toBe(true);
    });

    it('updates value and assertions when setAssertions is called', async () => {
        const engine = createTestEngine();
        root.innerHTML = `
      <input type="text" id="field" data-ezclassify-controller="marked-input" value="(U) some text">
    `;
        const forms = new EzClassifyUI(engine as never, {});
        activeForms.push(forms);
        await wait(80);

        const inputEl = editingField('field') as HTMLTextAreaElement;
        const comp = forms.components.get(nativeField(inputEl)) as MarkedInput;

        comp.setAssertions([
            {
                conceptId: 'S',
                categoryId: 'level',
                confidence: 'certain',
                source: 'user',
            },
        ]);
        await wait(80);

        const assertions = comp.getAssertions();
        expect(assertions.some((a) => a.conceptId === 'S')).toBe(true);
        // The input.value must reflect the new marking
        expect(inputEl.value).toContain('S');
    });

    it('emits ezclassify:change event when mark changes', async () => {
        const engine = createTestEngine();
        root.innerHTML = `
      <input type="text" id="field" data-ezclassify-controller="marked-input">
    `;
        const forms = new EzClassifyUI(engine as never, {});
        activeForms.push(forms);
        await wait(50);

        const inputEl = editingField('field') as HTMLTextAreaElement;

        const events: CustomEvent[] = [];
        nativeField(inputEl).addEventListener('ezclassify:change', (e) =>
            events.push(e as CustomEvent),
        );

        inputEl.value = '(U) test';
        inputEl.dispatchEvent(new Event('input', { bubbles: true }));
        await wait(80);

        expect(events.length).toBeGreaterThan(0);
        const lastEvent = events[events.length - 1];
        expect((lastEvent.detail as Record<string, unknown>).rendered).toBe(
            'U',
        );
    });

    it('renders a chip for the marking in the display div', async () => {
        const engine = createTestEngine();
        root.innerHTML = `
      <input type="text" id="field" data-ezclassify-controller="marked-input" value="(U) memo text">
    `;
        const forms = new EzClassifyUI(engine as never, {});
        activeForms.push(forms);
        await wait(50);

        const inputEl = editingField('field') as HTMLTextAreaElement;
        const wrap = inputEl.closest('.marked-input-wrap')!;
        const display = wrap.querySelector('.marked-input-display')!;
        const chip = display.querySelector('.marked-input-chip');

        expect(chip).toBeTruthy();
        expect(chip?.textContent).toContain('(U)');
    });

    it('shows a concept dwell tooltip on hover over the marking chip', async () => {
        const engine = createTestEngine();
        root.innerHTML = `
      <input type="text" id="field" data-ezclassify-controller="marked-input" value="(U) memo text">
    `;
        const forms = new EzClassifyUI(engine as never, {});
        activeForms.push(forms);
        await wait(50);

        const inputEl = editingField('field') as HTMLTextAreaElement;
        const wrap = inputEl.closest('.marked-input-wrap')!;
        const display = wrap.querySelector('.marked-input-display')!;
        const chip = display.querySelector('.marked-input-chip') as HTMLElement;
        expect(chip).toBeTruthy();

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

    it('removes a VISIBLE segment tooltip and its listeners on destroy (no leak)', async () => {
        // Destroy must remove a visible segment tooltip and its Escape, scroll,
        // and resize listeners, including destruction during hover.
        const engine = createTestEngine();
        root.innerHTML = `
      <input type="text" id="field" data-ezclassify-controller="marked-input" value="(U) memo text">
    `;
        const forms = new EzClassifyUI(engine as never, {});
        await wait(50);

        const inputEl = editingField('field') as HTMLTextAreaElement;
        const wrap = inputEl.closest('.marked-input-wrap')!;
        const display = wrap.querySelector('.marked-input-display')!;
        const chip = display.querySelector('.marked-input-chip') as HTMLElement;

        chip.dispatchEvent(new Event('mouseenter'));
        await wait(350);
        const tip = document.body.querySelector(
            '.ez-tooltip',
        ) as HTMLElement | null;
        expect(tip).not.toBeNull();
        expect(tip!.hidden).toBe(false);

        forms.destroy();

        // Gone from the DOM entirely, not merely hidden: a hidden orphan node
        // still parented to body is the same leak with an extra step.
        expect(tip!.isConnected).toBe(false);
        expect(document.body.querySelector('.ez-tooltip')).toBeNull();
    });

    it('honors the data-ezclassify-no-tooltips opt-out for the marking chip', async () => {
        const engine = createTestEngine();
        root.innerHTML = `
      <input type="text" id="field" data-ezclassify-controller="marked-input" data-ezclassify-no-tooltips value="(U) memo text">
    `;
        const forms = new EzClassifyUI(engine as never, {});
        activeForms.push(forms);
        await wait(50);

        const inputEl = editingField('field') as HTMLTextAreaElement;
        const wrap = inputEl.closest('.marked-input-wrap')!;
        const display = wrap.querySelector('.marked-input-display')!;
        const chip = display.querySelector('.marked-input-chip') as HTMLElement;
        expect(chip).toBeTruthy();

        chip.dispatchEvent(new Event('mouseenter'));
        await wait(350);

        expect(document.body.querySelector('.ez-tooltip')).toBeNull();
    });

    it('clears assertions when the marking is removed from the value', async () => {
        const engine = createTestEngine();
        root.innerHTML = `
      <input type="text" id="field" data-ezclassify-controller="marked-input" value="(U) memo">
    `;
        const forms = new EzClassifyUI(engine as never, {});
        activeForms.push(forms);
        await wait(80);

        const inputEl = editingField('field') as HTMLTextAreaElement;
        const comp = forms.components.get(nativeField(inputEl)) as MarkedInput;

        expect(comp.getAssertions().length).toBeGreaterThan(0);

        inputEl.value = 'just plain text';
        inputEl.dispatchEvent(new Event('input', { bubbles: true }));
        await wait(80);

        expect(comp.getAssertions()).toHaveLength(0);
        expect(comp.getRendered()).toBe('');
    });

    it('opens and closes the picker via Ctrl+Enter', async () => {
        const engine = createTestEngine();
        root.innerHTML = `
      <input type="text" id="field" data-ezclassify-controller="marked-input">
    `;
        const forms = new EzClassifyUI(engine as never, {});
        activeForms.push(forms);
        await wait(50);

        const inputEl = editingField('field') as HTMLTextAreaElement;

        // Simulate Ctrl+Enter to open picker
        inputEl.dispatchEvent(
            new KeyboardEvent('keydown', {
                key: 'Enter',
                ctrlKey: true,
                bubbles: true,
            }),
        );
        await wait(50);

        // The picker active class lands on the mount container, a sibling of the wrap
        const mountContainer = document.querySelector(
            '[data-ezclassify-mount="marked-input"]',
        ) as HTMLElement;
        expect(mountContainer).toBeTruthy();
        expect(
            mountContainer?.classList.contains('marked-input-picker-active'),
        ).toBe(true);

        // Escape closes the picker
        inputEl.dispatchEvent(
            new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
        );
        await wait(20);

        expect(
            mountContainer?.classList.contains('marked-input-picker-active'),
        ).toBe(false);
    });

    it('keeps the status mark and ★ button in one slot, last in the wrap, while the editor opens and closes', async () => {
        Element.prototype.scrollIntoView = vi.fn();

        const engine = createTestEngine();
        root.innerHTML = `
      <input type="text" id="field" data-ezclassify-controller="marked-input">
    `;
        const forms = new EzClassifyUI(engine as never, {});
        activeForms.push(forms);
        await wait(50);

        const inputEl = editingField('field') as HTMLTextAreaElement;
        const wrap = inputEl.closest('.marked-input-wrap') as HTMLElement;
        const chrome = wrap.querySelector(
            ':scope > .marked-input-hint-chrome',
        ) as HTMLElement;
        const mark = chrome.querySelector('.ez-status-mark');
        expect(mark).toBeTruthy();
        // After the footer, so Tab reaches the field's fixes and hint first.
        expect(wrap.lastElementChild).toBe(chrome);
        expect(wrap.querySelectorAll('.ez-status-mark')).toHaveLength(1);

        inputEl.dispatchEvent(
            new KeyboardEvent('keydown', {
                key: 'Enter',
                ctrlKey: true,
                bubbles: true,
            }),
        );
        await wait(80);
        const editorInput = document.querySelector(
            '.inline-editor-input',
        ) as HTMLTextAreaElement;
        editorInput.value = 'U';
        editorInput.setSelectionRange(1, 1);
        editorInput.dispatchEvent(new Event('input'));
        await wait(80);
        expect(openSurface()).not.toBeNull();
        expect(chrome.querySelector('.ez-status-mark')).toBe(mark);

        inputEl.dispatchEvent(
            new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
        );
        await wait(50);
        expect(chrome.querySelector('.ez-status-mark')).toBe(mark);
    });

    it('with the picker open, clicking at the marking/free-text boundary lands the caret there without reopening the picker', async () => {
        // markEnd is the first free-text character. A click at that offset must
        // close the picker and leave the caret there, following the ordinary
        // outside-click then mouseup event order.
        const engine = createTestEngine();
        root.innerHTML = `
      <input type="text" id="field" data-ezclassify-controller="marked-input" value="(U) memo text">
    `;
        const forms = new EzClassifyUI(engine as never, {});
        activeForms.push(forms);
        await wait(50);

        const inputEl = editingField('field') as HTMLTextAreaElement;
        const mountContainer = document.querySelector(
            '[data-ezclassify-mount="marked-input"]',
        ) as HTMLElement;
        const markEnd = '(U)'.length; // 3: offset of the boundary space

        inputEl.focus();
        inputEl.dispatchEvent(new Event('focus'));
        inputEl.dispatchEvent(
            new KeyboardEvent('keydown', {
                key: 'Enter',
                ctrlKey: true,
                bubbles: true,
            }),
        );
        await wait(50);
        expect(
            mountContainer.classList.contains('marked-input-picker-active'),
        ).toBe(true);

        // Real click ordering: mousedown (bubbles to the document-level
        // outside-click handler, which closes the picker) fires before
        // mouseup on the field's own native input.
        inputEl.dispatchEvent(
            new MouseEvent('mousedown', { bubbles: true, cancelable: true }),
        );
        // The browser's own default action for that mousedown would have
        // placed the caret at the click point by the time mouseup fires;
        // simulate that here since jsdom does no real hit-testing.
        inputEl.setSelectionRange(markEnd, markEnd);
        inputEl.dispatchEvent(
            new MouseEvent('mouseup', {
                bubbles: true,
                cancelable: true,
                clientX: 100,
                clientY: 10,
            }),
        );
        await wait(80);

        expect(
            mountContainer.classList.contains('marked-input-picker-active'),
        ).toBe(false);
        expect(inputEl.selectionStart).toBe(markEnd);
        expect(inputEl.selectionEnd).toBe(markEnd);
    });

    it('the chip hit-test resolves adjacent integer clicks against fractional layout geometry', async () => {
        // Use a fractional chip rectangle and the adjacent integer coordinates
        // on each side of its edge to check which clicks enter marking edit mode.
        const engine = createTestEngine();
        root.innerHTML = `
      <input type="text" id="field" data-ezclassify-controller="marked-input" value="(U)">
    `;
        const forms = new EzClassifyUI(engine as never, {});
        activeForms.push(forms);
        await wait(50);

        const inputEl = editingField('field') as HTMLTextAreaElement;
        const mountContainer = document.querySelector(
            '[data-ezclassify-mount="marked-input"]',
        ) as HTMLElement;

        inputEl.focus();
        inputEl.dispatchEvent(new Event('focus'));
        await wait(20);

        const display = root.querySelector('.marked-input-display');
        const chip = display?.querySelector(
            '.marked-input-chip',
        ) as HTMLElement;
        expect(chip).toBeTruthy();

        // Real measured rect for a "(U)" MarkedInput chip (Chrome, 1400x900
        // viewport). jsdom has no layout engine, so this has to be stubbed,
        // but stubbing REAL fractional numbers instead of round integers is
        // what makes the boundary comparison mean anything.
        const realRect = {
            left: 917.3125,
            right: 938.390625,
            top: 393.921875,
            bottom: 410.921875,
            width: 21.078125,
            height: 17,
            x: 917.3125,
            y: 393.921875,
            toJSON: () => ({}),
        } as DOMRect;
        chip.getBoundingClientRect = () => realRect;

        const clickOffset = inputEl.value.length; // end of "(U)", no free text after it
        const midY = Math.round((realRect.top + realRect.bottom) / 2);

        function clickAt(clientX: number) {
            inputEl.setSelectionRange(clickOffset, clickOffset);
            inputEl.dispatchEvent(
                new MouseEvent('mouseup', {
                    bubbles: true,
                    cancelable: true,
                    clientX,
                    clientY: midY,
                }),
            );
        }

        // The last integer pixel still inside the chip (floor(right) = 938):
        // this is real ink, clicking it is clicking the marking itself, so
        // reopening the picker is the CORRECT, intentional behavior.
        clickAt(Math.floor(realRect.right));
        await wait(80);
        expect(
            mountContainer.classList.contains('marked-input-picker-active'),
            "a click on the chip's own last pixel should open the picker (this is clicking the marking, not past it)",
        ).toBe(true);

        // Close it and reset for the second half of the boundary check.
        inputEl.dispatchEvent(
            new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
        );
        await wait(80);

        // The first integer pixel past the chip (ceil(right) = 939): this is
        // free-text space (empty, since there's no text after the mark), so
        // the caret should land there and the picker should NOT reopen.
        clickAt(Math.ceil(realRect.right));
        await wait(80);

        expect(
            mountContainer.classList.contains('marked-input-picker-active'),
            'a click one pixel past the chip should not reopen the picker',
        ).toBe(false);
        expect(inputEl.selectionStart).toBe(clickOffset);
        expect(inputEl.selectionEnd).toBe(clickOffset);
    });

    it('with the picker open, clicking inside the free-text tail closes the picker and lands the caret at the click offset', async () => {
        const engine = createTestEngine();
        root.innerHTML = `
      <input type="text" id="field" data-ezclassify-controller="marked-input" value="(U) memo text">
    `;
        const forms = new EzClassifyUI(engine as never, {});
        activeForms.push(forms);
        await wait(50);

        const inputEl = editingField('field') as HTMLTextAreaElement;
        const mountContainer = document.querySelector(
            '[data-ezclassify-mount="marked-input"]',
        ) as HTMLElement;
        const clickOffset = inputEl.value.length; // end of "memo text"

        inputEl.focus();
        inputEl.dispatchEvent(new Event('focus'));
        inputEl.dispatchEvent(
            new KeyboardEvent('keydown', {
                key: 'Enter',
                ctrlKey: true,
                bubbles: true,
            }),
        );
        await wait(50);
        expect(
            mountContainer.classList.contains('marked-input-picker-active'),
        ).toBe(true);

        inputEl.dispatchEvent(
            new MouseEvent('mousedown', { bubbles: true, cancelable: true }),
        );
        inputEl.setSelectionRange(clickOffset, clickOffset);
        inputEl.dispatchEvent(
            new MouseEvent('mouseup', {
                bubbles: true,
                cancelable: true,
                clientX: 200,
                clientY: 10,
            }),
        );
        await wait(80);

        expect(
            mountContainer.classList.contains('marked-input-picker-active'),
        ).toBe(false);
        expect(inputEl.selectionStart).toBe(clickOffset);
        expect(inputEl.selectionEnd).toBe(clickOffset);
    });

    it('the shortcut pressed while a caret-driven open is mounting leaves one focused editor with its list open', async () => {
        // A caret-driven open can still be mounting when Ctrl+Enter arrives.
        // Only the current editor may take focus when mounting completes, and
        // the shortcut must leave its list open.
        const engine = createTestEngine();
        root.innerHTML = `
      <input type="text" id="field" data-ezclassify-controller="marked-input" value="(U) memo text">
    `;
        const forms = new EzClassifyUI(engine as never, {});
        activeForms.push(forms);
        await wait(50);

        const inputEl = editingField('field') as HTMLTextAreaElement;
        const mountContainer = document.querySelector(
            '[data-ezclassify-mount="marked-input"]',
        ) as HTMLElement;
        // Which editor finishes mounting first depends on engine timing, so
        // the assertion is on what each one did: only the editor that is
        // current when it finishes may take focus.
        const realFocus = InlineMarkingEditor.prototype.focus;
        const focusSpy = vi
            .spyOn(InlineMarkingEditor.prototype, 'focus')
            .mockImplementation(function (this: InlineMarkingEditor) {
                realFocus.call(this);
            });
        inputEl.setSelectionRange(1, 1);
        inputEl.focus();
        inputEl.dispatchEvent(new Event('focus'));
        document.dispatchEvent(new Event('selectionchange'));
        inputEl.dispatchEvent(
            new KeyboardEvent('keydown', {
                key: 'Enter',
                ctrlKey: true,
                bubbles: true,
            }),
        );
        await wait(80);

        expect(
            mountContainer.classList.contains('marked-input-picker-active'),
        ).toBe(true);
        const editors = document.querySelectorAll('.inline-editor-input');
        expect(editors).toHaveLength(1);
        expect(document.activeElement).toBe(editors[0]);
        expect(editors[0].getAttribute('aria-expanded')).toBe('true');
        // The superseded editor never mounted, so it never took focus.
        expect(focusSpy).toHaveBeenCalledTimes(1);
        focusSpy.mockRestore();
    });

    it('includes the visible shortcut hint in its accessible name', async () => {
        const engine = createTestEngine();
        root.innerHTML = `
      <input type="text" id="field" data-ezclassify-controller="marked-input" value="(U) memo text">
      <textarea id="body" data-ezclassify-controller="marked-textarea"></textarea>
    `;
        const forms = new EzClassifyUI(engine as never, {});
        activeForms.push(forms);
        await wait(50);

        for (const [selector, name] of [
            ['.marked-input-kb-hint', 'Set marking'],
            ['.marked-textarea-kb-hint', 'Add marking'],
        ] as const) {
            const hint = document.querySelector(selector) as HTMLButtonElement;
            expect(hint.tagName).toBe('BUTTON');
            expect(hint.getAttribute('aria-label')).toBe(hint.textContent);
            expect(hint.getAttribute('aria-label')?.toLowerCase()).toContain(
                name.toLowerCase(),
            );
            expect(hint.getAttribute('aria-keyshortcuts')).toMatch(
                /^(Meta|Control)\+Enter$/,
            );
            // Everything visible inside is decoration for a screen reader.
            for (const child of hint.children) {
                expect(child.getAttribute('aria-hidden')).toBe('true');
            }
        }
    });

    it('words the touch button like its key hint: MarkedInput sets its one mark, MarkedTextArea adds a portion mark', async () => {
        const engine = createTestEngine();
        root.innerHTML = `
      <input type="text" id="field" data-ezclassify-controller="marked-input" value="(U) memo text">
      <textarea id="body" data-ezclassify-controller="marked-textarea"></textarea>
    `;
        const forms = new EzClassifyUI(engine as never, {});
        activeForms.push(forms);
        await wait(50);

        for (const [field, verb] of [
            ['marked-input', 'Set marking'],
            ['marked-textarea', 'Add marking'],
        ] as const) {
            expect(
                document.querySelector(`.${field}-kb-hint`)!.textContent,
            ).toContain(verb.toLowerCase());
            expect(
                document.querySelector(`.${field}-touch-add`)!.textContent,
            ).toBe(`+ ${verb}`);
        }
    });

    it('draws no tail synthetic caret while the picker is open (single caret)', async () => {
        // The editing chip hosts the picker caret. While the picker is open,
        // the free-text display must not draw a second synthetic caret.
        const engine = createTestEngine();
        root.innerHTML = `
      <input type="text" id="field" data-ezclassify-controller="marked-input" value="(U) memo text">
    `;
        const forms = new EzClassifyUI(engine as never, {});
        activeForms.push(forms);
        await wait(80);

        const inputEl = editingField('field') as HTMLTextAreaElement;
        const comp = forms.components.get(nativeField(inputEl)) as MarkedInput;
        const wrap = inputEl.closest('.marked-input-wrap')!;
        const display = wrap.querySelector('.marked-input-display')!;

        // Focus with the caret in the free-text tail (selStart >= markEnd) so the
        // tail-caret branch is the one that would fire. This also proves the
        // harness: a focused field with no picker draws exactly one caret.
        inputEl.focus();
        inputEl.setSelectionRange(inputEl.value.length, inputEl.value.length);
        document.dispatchEvent(new Event('selectionchange'));
        await wait(20);
        expect(display.querySelectorAll('.marked-input-caret')).toHaveLength(1);

        // Open the picker; the inline editor's caret is now the sole caret, so
        // the display must carry zero of MarkedInput's own synthetic carets.
        inputEl.dispatchEvent(
            new KeyboardEvent('keydown', {
                key: 'Enter',
                ctrlKey: true,
                bubbles: true,
            }),
        );
        await wait(80);

        expect((comp as unknown as { picker: unknown }).picker).toBeTruthy();
        expect(
            display.querySelector('.marked-input-picker-mount'),
        ).toBeTruthy();
        expect(display.querySelectorAll('.marked-input-caret')).toHaveLength(0);
    });

    it('commits a suggestion selected with the mouse (mousedown then click)', async () => {
        // Mouse selection must commit the concept without the outside-click
        // handler dismissing its dropdown first. The dropdown lives beside the
        // picker mount to escape clipping. jsdom lacks scrollIntoView, so the
        // test supplies that browser method.
        Element.prototype.scrollIntoView = vi.fn();

        const engine = createTestEngine();
        root.innerHTML = `
      <input type="text" id="field" data-ezclassify-controller="marked-input">
    `;
        const forms = new EzClassifyUI(engine as never, {});
        activeForms.push(forms);
        await wait(50);

        const inputEl = editingField('field') as HTMLTextAreaElement;

        // Open the picker; focusing it opens the suggestion dropdown.
        inputEl.dispatchEvent(
            new KeyboardEvent('keydown', {
                key: 'Enter',
                ctrlKey: true,
                bubbles: true,
            }),
        );
        await wait(80);

        const mountContainer = document.querySelector(
            '[data-ezclassify-mount="marked-input"]',
        ) as HTMLElement;
        expect(
            mountContainer?.classList.contains('marked-input-picker-active'),
        ).toBe(true);

        // Type a filter so the dropdown surfaces a concrete concept option.
        const editorInput = document.querySelector(
            '.inline-editor-input',
        ) as HTMLTextAreaElement;
        editorInput.value = 'U';
        editorInput.setSelectionRange(1, 1);
        editorInput.dispatchEvent(new Event('input'));
        await wait(80);

        // The composer is open with a selectable concept row.
        const option = rowFor('U') as HTMLElement;
        expect(option).toBeTruthy();

        // Real mouse selection: mousedown (bubbles toward document) then click.
        option.dispatchEvent(
            new MouseEvent('mousedown', { bubbles: true, cancelable: true }),
        );
        option.dispatchEvent(
            new MouseEvent('click', { bubbles: true, cancelable: true }),
        );
        await wait(80);

        // A pressed row replaces the token in the draft; nothing is stored
        // until the commit (the composer's commit table), and the picker
        // stays open for the next fact.
        expect(editorInput.value.trim()).toBe('U');
        expect(inputEl.value).toBe('');
        expect(
            mountContainer?.classList.contains('marked-input-picker-active'),
        ).toBe(true);

        // Enter with no active row commits the result into the field value.
        press(editorInput, 'Enter');
        await wait(80);
        expect(inputEl.value).toMatch(/\((?:U|S)\)/);
    });

    it('the touch "Add marking" button opens the picker (same action as Ctrl+Enter)', async () => {
        const engine = createTestEngine();
        root.innerHTML = `
      <input type="text" id="field" data-ezclassify-controller="marked-input">
    `;
        const forms = new EzClassifyUI(engine as never, {});
        activeForms.push(forms);
        await wait(50);

        // The touch affordance is rendered (CSS hides it on fine pointers; the
        // element exists regardless) and clicking it opens the picker.
        const touchAdd = document.querySelector(
            '.marked-input-touch-add',
        ) as HTMLButtonElement;
        expect(touchAdd).toBeTruthy();
        expect(touchAdd.type).toBe('button');
        touchAdd.click();
        await wait(50);

        const mountContainer = document.querySelector(
            '[data-ezclassify-mount="marked-input"]',
        ) as HTMLElement;
        expect(
            mountContainer?.classList.contains('marked-input-picker-active'),
        ).toBe(true);
    });

    it('the "to set marking" keyboard hint is a real button, not decorative text, and opens the picker on click', async () => {
        const engine = createTestEngine();
        root.innerHTML = `
      <input type="text" id="field" data-ezclassify-controller="marked-input">
    `;
        const forms = new EzClassifyUI(engine as never, {});
        activeForms.push(forms);
        await wait(50);

        const hint = document.querySelector(
            '.marked-input-kb-hint',
        ) as HTMLButtonElement;
        expect(hint).toBeTruthy();
        // Real button semantics: focusable, correct type, no aria-hidden
        // hiding it from assistive tech now that it does something.
        expect(hint.tagName).toBe('BUTTON');
        expect(hint.type).toBe('button');
        expect(hint.hasAttribute('aria-hidden')).toBe(false);

        hint.click();
        await wait(50);

        const mountContainer = document.querySelector(
            '[data-ezclassify-mount="marked-input"]',
        ) as HTMLElement;
        expect(
            mountContainer?.classList.contains('marked-input-picker-active'),
        ).toBe(true);
    });

    it('omits the keyboard hint button entirely when hints are disabled', async () => {
        const engine = createTestEngine();
        root.innerHTML = `
      <input type="text" id="field" data-ezclassify-controller="marked-input" data-ezclassify-no-hints>
    `;
        const forms = new EzClassifyUI(engine as never, {});
        activeForms.push(forms);
        await wait(50);

        expect(document.querySelector('.marked-input-kb-hint')).toBeNull();
        // The touch button (never disabled) is unaffected by the opt-out.
        expect(document.querySelector('.marked-input-touch-add')).toBeTruthy();
    });

    it('setAssertions wraps exactly once via embedded template (bare-format engine)', async () => {
        // Architecture rule: render formats return bare markings ("S", not "(S)").
        // The embedded_marking template is the single authority that adds the ()
        // wrapper. setAssertions should produce "(S) title text", never "((S))".
        const engine = createBareFormatEngine();
        root.innerHTML = `
      <input type="text" id="field" data-ezclassify-controller="marked-input" value="(U) title text">
    `;
        const forms = new EzClassifyUI(engine as never, {});
        activeForms.push(forms);
        await wait(100);

        const inputEl = editingField('field') as HTMLTextAreaElement;
        const comp = forms.components.get(nativeField(inputEl)) as MarkedInput;
        expect(comp).toBeInstanceOf(MarkedInput);

        expect(inputEl.value).toBe('(U) title text');

        comp.setAssertions([
            {
                conceptId: 'S',
                categoryId: 'level',
                confidence: 'certain',
                source: 'user',
            },
        ]);
        await wait(100);

        // Exactly one wrap: "(S) title text", not "((S)) title text".
        expect(inputEl.value).not.toContain('((');
        expect(inputEl.value).not.toContain('))');
        expect(inputEl.value).toContain('S');
        expect(inputEl.value).toContain('title text');
        // The chip delimiters must appear exactly once.
        expect(inputEl.value.indexOf('(')).toBe(0);
    });

    it('keeps a separator space between marking and free text when the template has none', async () => {
        // Some schemes declare an embedded template WITHOUT a trailing space
        // ("({marking})"). Every external update then rebuilt the value as
        // "(S)quarterly report", gluing the text to the closing delimiter.
        const engine = createBareEngineWithTemplate('({marking})');
        root.innerHTML = `
      <input type="text" id="field" data-ezclassify-controller="marked-input" value="(U) quarterly report">
    `;
        const forms = new EzClassifyUI(engine as never, {});
        activeForms.push(forms);
        await wait(100);

        const inputEl = editingField('field') as HTMLTextAreaElement;
        const comp = forms.components.get(nativeField(inputEl)) as MarkedInput;
        expect(comp).toBeInstanceOf(MarkedInput);

        comp.setAssertions([
            {
                conceptId: 'S',
                categoryId: 'level',
                confidence: 'certain',
                source: 'user',
            },
        ]);
        await wait(100);

        expect(inputEl.value).toBe('(S) quarterly report');
    });

    it('preserves free text when an external store commit changes the marking', async () => {
        const engine = createTestEngine();
        // Marking host + MI bound to it, mirrors the demo's doc-marking pattern.
        root.innerHTML = `
      <input type="hidden" id="doc-marking" data-ezclassify-rendered />
      <input type="text" id="mi-field"
             data-ezclassify-controller="marked-input"
             data-ezclassify-bound-to="doc-marking" value="(U) report title">
    `;
        const forms = new EzClassifyUI(engine as never, { root });
        activeForms.push(forms);
        await wait(150);

        const inputEl = editingField('mi-field') as HTMLTextAreaElement;
        const comp = forms.components.get(nativeField(inputEl)) as MarkedInput;
        expect(comp).toBeInstanceOf(MarkedInput);
        // Confirm the initial free text is intact
        expect(inputEl.value).toBe('(U) report title');

        // Simulate a sibling component (e.g. SingleSelect) publishing a new marking
        // to the shared store, the external token prevents echo suppression.
        const externalToken = { token: {} };
        await forms.store.publishRendered('doc-marking', 'S', externalToken);
        await wait(100);

        // Marking part must be updated to Secret; free text must survive.
        expect(inputEl.value).toContain('report title');
        expect(inputEl.value).toContain('S');
        // The whole input value must NOT be just the rendered marking string.
        expect(inputEl.value.trim()).not.toBe('S');
        expect(inputEl.value.trim()).not.toBe('(S)');
    });

    it('does not show a stale invalid chip once a store seed replaces an unparseable placeholder marking', async () => {
        // A valid store seed must replace both the rendered placeholder and
        // its invalid parse state, keeping the chip consistent with its marking.
        const engine = createTestEngine();
        root.innerHTML = `
      <input type="hidden" id="doc-marking" data-ezclassify-rendered />
      <input type="text" id="mi-field"
             data-ezclassify-controller="marked-input"
             data-ezclassify-bound-to="doc-marking" value="(X) quarterly report">
    `;
        const forms = new EzClassifyUI(engine as never, { root });
        activeForms.push(forms);
        await wait(150);

        const inputEl = editingField('mi-field') as HTMLTextAreaElement;
        const comp = forms.components.get(nativeField(inputEl)) as MarkedInput;
        expect(comp).toBeInstanceOf(MarkedInput);

        // Confirm the placeholder actually parsed as invalid before the seed lands.
        const wrap = inputEl.closest('.marked-input-wrap') as HTMLElement;
        expect(
            wrap.querySelector('.marked-input-chip--invalid'),
            'placeholder marking should read invalid before the store seed',
        ).toBeTruthy();

        // Mirrors main.ts wireReadout(): seed the shared marking through the store
        // right after mount, same as the demo does on `ezclassify:ready`.
        await forms.store.publishRendered('doc-marking', 'S');
        await wait(150);

        expect(inputEl.value).toContain('S');
        expect(
            wrap.querySelector('.marked-input-chip--invalid'),
            'chip stayed invalid after a valid store seed replaced the marking',
        ).toBeFalsy();
    });

    it('picker on empty input: renderDisplay attaches the picker mount as an editing chip', async () => {
        const engine = createTestEngine();
        root.innerHTML = `<input type="text" id="field" data-ezclassify-controller="marked-input">`;
        const forms = new EzClassifyUI(engine as never, {});
        activeForms.push(forms);
        await wait(50);

        const inputEl = editingField('field') as HTMLTextAreaElement;
        // Directly call openPicker via the keydown simulation
        const downEvent = new KeyboardEvent('keydown', {
            key: 'Enter',
            ctrlKey: true,
            bubbles: true,
            cancelable: true,
        });
        inputEl.dispatchEvent(downEvent);
        await wait(100);

        // The editing chip should be rendered in the display even though the input is empty
        const display = root.querySelector('.marked-input-display');
        const editingChip = display?.querySelector(
            '.marked-input-chip--editing',
        );
        expect(editingChip).toBeTruthy();
    });

    it('setAssertions does not echo a short-format render back to the store', async () => {
        // setAssertions renders in the component part format. It must not echo
        // that rendering into a store which parses the default format.
        const engine = createTestEngine();
        root.innerHTML = `
      <input type="hidden" id="doc-marking" data-ezclassify-rendered />
      <input type="text" id="mi-field"
             data-ezclassify-controller="marked-input"
             data-ezclassify-bound-to="doc-marking" value="(U) quarterly report">
    `;
        const forms = new EzClassifyUI(engine as never, { root });
        activeForms.push(forms);
        await wait(150);

        // Seed the store from an external source (mirrors main.ts wireReadout).
        const stateUpdates: Array<{ rendered: string; valid: boolean }> = [];
        forms.store.subscribe('doc-marking', (s) =>
            stateUpdates.push({ rendered: s.rendered, valid: s.valid }),
        );

        await forms.store.publishRendered('doc-marking', 'S');
        await wait(200);

        // Only the seeded state (valid=true for 'S') should ever land in the store.
        // The setAssertions echo would produce valid=false via a bad short-format parse.
        const final = stateUpdates[stateUpdates.length - 1];
        expect(
            final?.valid,
            'store valid corrupted by setAssertions echo',
        ).toBe(true);
    });

    it('a synchronous clear beats an in-flight non-empty setAssertions call', async () => {
        // An empty setAssertions call must invalidate an earlier deferred apply.
        // The two calls run synchronously without an await, so the non-empty
        // process result is still queued when the clear occurs.
        const engine = createTestEngine();
        root.innerHTML = `
      <input type="text" id="field" data-ezclassify-controller="marked-input">
    `;
        const forms = new EzClassifyUI(engine as never, {});
        activeForms.push(forms);
        await wait(80);

        const inputEl = editingField('field') as HTMLTextAreaElement;
        const comp = forms.components.get(nativeField(inputEl)) as MarkedInput;

        comp.setAssertions([
            {
                conceptId: 'S',
                categoryId: 'level',
                confidence: 'certain',
                source: 'user',
            },
        ]);
        comp.setAssertions([]);
        await wait(80);

        expect(comp.getRendered()).toBe('');
        expect(comp.getAssertions()).toEqual([]);
        expect(inputEl.value.trim()).toBe('');
    });

    it('focus + picker open + close without user edit does not republish store (no wipe)', async () => {
        // Opening and closing the picker without editing must not emit a change
        // that republishes the part-formatted marking into the default-format store.
        const engine = createMultiCategoryEngine();
        root.innerHTML = `
      <input type="hidden" id="doc-marking" data-ezclassify-rendered />
      <input type="text" id="mi-field"
             data-ezclassify-controller="marked-input"
             data-ezclassify-bound-to="doc-marking">
    `;
        const forms = new EzClassifyUI(engine as never, { root });
        activeForms.push(forms);
        await wait(150);

        // Establish a full multi-category state in the store.
        await forms.store.publishAssertions('doc-marking', [
            {
                conceptId: 'S',
                categoryId: 'level',
                confidence: 'certain',
                source: 'user',
            },
            {
                conceptId: 'REGIONAL',
                categoryId: 'scope',
                confidence: 'certain',
                source: 'user',
            },
        ]);
        await wait(150);

        // Capture any new store commits from this point on (using external token so we're
        // not filtered by MI's own source token).
        const newCommits: Array<{
            rendered: string;
            assertions: Array<{ conceptId: string; categoryId: string }>;
        }> = [];
        forms.store.subscribe('doc-marking', (s) =>
            newCommits.push({
                rendered: s.rendered,
                assertions: s.assertions.map((a) => ({
                    conceptId: a.conceptId,
                    categoryId: a.categoryId,
                })),
            }),
        );

        const inputEl = editingField('mi-field') as HTMLTextAreaElement;

        // Ctrl+Enter opens picker
        inputEl.dispatchEvent(
            new KeyboardEvent('keydown', {
                key: 'Enter',
                ctrlKey: true,
                bubbles: true,
                cancelable: true,
            }),
        );
        await wait(120);

        // Escape closes picker without the user changing anything
        inputEl.dispatchEvent(
            new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
        );
        await wait(150);

        // No new store commit should have been triggered.
        expect(
            newCommits.length,
            'focus+blur must not republish to store',
        ).toBe(0);

        // Either way, the store must still hold both categories.
        const state = forms.store.get('doc-marking');
        expect(
            state.assertions.some((a) => a.conceptId === 'S'),
            'level:S was dropped',
        ).toBe(true);
        expect(
            state.assertions.some((a) => a.conceptId === 'REGIONAL'),
            'scope:REGIONAL was dropped',
        ).toBe(true);
    });

    it('adopts its stylesheet and builds a display layer with the correct class', async () => {
        const engine = createTestEngine();
        root.innerHTML = `
      <input type="text" id="field" data-ezclassify-controller="marked-input">
    `;
        const forms = new EzClassifyUI(engine as never, {});
        activeForms.push(forms);
        await wait(50);

        // The display layer must be present, it's what the :focus-within ring targets.
        const wrap = root.querySelector('.marked-input-wrap');
        expect(wrap).toBeTruthy();
        const display = wrap?.querySelector('.marked-input-display');
        expect(display).toBeTruthy();

        // The component's CSS is adopted onto the mount's root, never appended
        // as a style element, so a host page can forbid inline styles.
        const mountContainer = document.querySelector(
            '[data-ezclassify-mount="marked-input"]',
        ) as HTMLElement;
        expect(mountContainer?.querySelector('style')).toBeNull();
        expect(document.querySelector('style')).toBeNull();
        expect(document.adoptedStyleSheets.length).toBeGreaterThan(0);

        // The CSS source file defines :focus-within on .marked-input-wrap, verify
        // that the class names used in CSS align with what the component creates.
        expect(wrap?.classList.contains('marked-input-wrap')).toBe(true);
        expect(display?.classList.contains('marked-input-display')).toBe(true);
    });
});

describe('MarkedInput native input ownership', () => {
    it('enhances the registered input without capturing an adjacent body textarea', async () => {
        root.innerHTML = `<form><label for="title">Title</label><input id="title" name="title" required value="(U) memo" data-ezclassify-controller="marked-input"><textarea id="body">Body stays here</textarea></form>`;
        const native = root.querySelector<HTMLInputElement>('#title')!;
        const body = root.querySelector<HTMLTextAreaElement>('#body')!;
        const form = root.querySelector('form')!;
        const forms = new EzClassifyUI(createTestEngine() as never, { root });
        activeForms.push(forms);
        await wait(80);
        const editor = root.querySelector<HTMLTextAreaElement>(
            '.marked-input-native',
        )!;
        expect(editor).not.toBeNull();
        expect(editor).not.toBe(body);
        expect(editor.name).toBe('');
        expect(editor.id).toBe('');
        expect(native.parentElement).toBe(editor.parentElement);
        expect(new FormData(form).getAll('title')).toEqual(['(U) memo']);
        const events: EventTarget[] = [];
        form.addEventListener('input', (e) => events.push(e.target!));
        editor.value = '(S) changed';
        editor.dispatchEvent(new Event('input', { bubbles: true }));
        await wait(80);
        expect(native.value).toBe('(S) changed');
        expect(events).toEqual([native]);
        expect(body.value).toBe('Body stays here');
        native.focus();
        expect(document.activeElement).toBe(editor);
        native.readOnly = true;
        await wait();
        expect(editor.readOnly).toBe(true);
        native.readOnly = false;
        form.reset();
        await wait(80);
        expect(native.value).toBe('(U) memo');
        expect(editor.value).toBe(native.value);
        forms.destroy();
        await wait();
        expect(native.hidden).toBe(false);
        expect(form.querySelectorAll('textarea')).toHaveLength(1);
        expect(form.elements.namedItem('title')).toBe(native);
    });
    it('preserves native labels, validity, external writes, disabled state and canceled reset', async () => {
        root.innerHTML = `<form><fieldset><label for="title">Report title <a href="#help">Help</a></label><input type="text" id="title" name="title" required minlength="2" maxlength="100" aria-describedby="help" value="(U) original" data-ezclassify-controller="marked-input"></fieldset><p id="help">Title help</p></form>`;
        const native = root.querySelector<HTMLInputElement>('#title')!;
        const form = root.querySelector('form')!;
        const fieldset = root.querySelector('fieldset')!;
        native.setCustomValidity('Host error');
        const focus = native.focus;
        const validity = native.setCustomValidity;
        const forms = new EzClassifyUI(createTestEngine() as never, { root });
        activeForms.push(forms);
        await wait(80);
        const editor = root.querySelector<HTMLTextAreaElement>(
            '.marked-input-native',
        )!;
        expect(editor.required).toBe(true);
        expect(editor.minLength).toBe(2);
        expect(editor.maxLength).toBe(100);
        expect(editor.getAttribute('aria-describedby')).toBe('help');
        expect(native.labels).toHaveLength(1);
        expect(
            editor.getAttribute('aria-label') ??
                editor.getAttribute('aria-labelledby'),
        ).toBeTruthy();
        root.querySelector('label')!.click();
        expect(document.activeElement).toBe(editor);
        native.setCustomValidity('New host error');
        expect(native.validationMessage).toBe('New host error');
        native.value = '(S) external';
        native.dispatchEvent(new Event('input', { bubbles: true }));
        await wait(80);
        expect(editor.value).toBe(native.value);
        const events = vi.fn();
        form.addEventListener('input', events);
        const component = forms.components.get(native) as MarkedInput;
        component.setValue('(U) reflected');
        await wait(80);
        expect(native.value).toBe('(U) reflected');
        expect(events).not.toHaveBeenCalled();
        fieldset.disabled = true;
        await wait();
        expect(editor.matches(':disabled')).toBe(true);
        fieldset.disabled = false;
        native.readOnly = true;
        await wait();
        editor.dispatchEvent(
            new KeyboardEvent('keydown', {
                key: 'Enter',
                ctrlKey: true,
                bubbles: true,
            }),
        );
        await wait();
        expect(openSurface()).toBeNull();
        form.addEventListener('reset', (event) => event.preventDefault(), {
            once: true,
        });
        form.reset();
        await wait();
        expect(editor.value).toBe('(U) reflected');
        forms.destroy();
        await wait();
        expect(native.focus).toBe(focus);
        expect(native.setCustomValidity).toBe(validity);
        expect(native.validity.customError).toBe(true);
        native.readOnly = false;
        expect(native.validationMessage).toBe('New host error');
        expect(editor.readOnly).toBe(true);
    });
});

describe('MarkedInput: wrapping owned textarea editor', () => {
    it('a plain Enter never inserts a newline into the value (keeps Ctrl/Cmd+Enter accept semantics)', async () => {
        const engine = createTestEngine();
        root.innerHTML = `<input type="text" id="field" data-ezclassify-controller="marked-input" value="(U) memo">`;
        const forms = new EzClassifyUI(engine as never, { root });
        activeForms.push(forms);
        await wait(50);

        const inputEl = editingField('field') as HTMLTextAreaElement;
        inputEl.focus();
        inputEl.setSelectionRange(inputEl.value.length, inputEl.value.length);

        const before = inputEl.value;
        const downEvent = new KeyboardEvent('keydown', {
            key: 'Enter',
            bubbles: true,
            cancelable: true,
        });
        inputEl.dispatchEvent(downEvent);
        await wait(20);

        // Real textarea default action (insert "\n") never ran: preventDefault
        // was called and jsdom honors it the same way a real browser would.
        expect(downEvent.defaultPrevented).toBe(true);
        expect(inputEl.value).toBe(before);
        expect(inputEl.value).not.toContain('\n');

        // Shift+Enter is blocked too: there is no "soft newline" exception.
        const shiftEvent = new KeyboardEvent('keydown', {
            key: 'Enter',
            shiftKey: true,
            bubbles: true,
            cancelable: true,
        });
        inputEl.dispatchEvent(shiftEvent);
        expect(shiftEvent.defaultPrevented).toBe(true);
        expect(inputEl.value).toBe(before);

        // Ctrl+Enter is UNAFFECTED: it still opens the picker (accept
        // semantics preserved), the one Enter combination this guard must
        // not swallow.
        const mountContainer = document.querySelector(
            '[data-ezclassify-mount="marked-input"]',
        ) as HTMLElement;
        inputEl.dispatchEvent(
            new KeyboardEvent('keydown', {
                key: 'Enter',
                ctrlKey: true,
                bubbles: true,
            }),
        );
        await wait(50);
        expect(
            mountContainer.classList.contains('marked-input-picker-active'),
        ).toBe(true);
    });

    it('pasting multi-line text strips the newlines instead of inserting them', async () => {
        const engine = createTestEngine();
        root.innerHTML = `<input type="text" id="field" data-ezclassify-controller="marked-input" value="(U) ">`;
        const forms = new EzClassifyUI(engine as never, { root });
        activeForms.push(forms);
        await wait(50);

        const inputEl = editingField('field') as HTMLTextAreaElement;
        inputEl.focus();
        const caret = inputEl.value.length;
        inputEl.setSelectionRange(caret, caret);

        const events: Event[] = [];
        inputEl.addEventListener('input', (e) => events.push(e));

        const clipboardData = {
            getData: (type: string) =>
                type === 'text/plain' ? 'line one\nline two\r\nline three' : '',
        };
        const pasteEvent = new Event('paste', {
            bubbles: true,
            cancelable: true,
        }) as ClipboardEvent;
        Object.defineProperty(pasteEvent, 'clipboardData', {
            value: clipboardData,
        });
        inputEl.dispatchEvent(pasteEvent);

        expect(pasteEvent.defaultPrevented).toBe(true);
        expect(inputEl.value).not.toContain('\n');
        expect(inputEl.value).not.toContain('\r');
        expect(inputEl.value).toBe('(U) line one line two line three');
        // The paste's manual insertion dispatched its own native `input`
        // event (onInput() only runs off real events, never a direct call).
        expect(events.length).toBeGreaterThan(0);
    });

    it('a paste with no newlines is left to the browser default (not intercepted)', async () => {
        const engine = createTestEngine();
        root.innerHTML = `<input type="text" id="field" data-ezclassify-controller="marked-input" value="(U) ">`;
        const forms = new EzClassifyUI(engine as never, { root });
        activeForms.push(forms);
        await wait(50);

        const inputEl = editingField('field') as HTMLTextAreaElement;
        // Caret in the free-text tail, outside the marking region: this
        // test's intent is the newline/no-newline distinction, not the
        // marking-boundary guard (covered separately by the "caret inside
        // the marking region" regression below): a fresh unfocused
        // textarea defaults its caret to 0, which is INSIDE the marking and
        // would otherwise conflate the two.
        inputEl.focus();
        const end = inputEl.value.length;
        inputEl.setSelectionRange(end, end);

        const clipboardData = {
            getData: (type: string) =>
                type === 'text/plain' ? 'single line' : '',
        };
        const pasteEvent = new Event('paste', {
            bubbles: true,
            cancelable: true,
        }) as ClipboardEvent;
        Object.defineProperty(pasteEvent, 'clipboardData', {
            value: clipboardData,
        });
        inputEl.dispatchEvent(pasteEvent);

        expect(pasteEvent.defaultPrevented).toBe(false);
    });

    it('a paste with the caret inside the marking region routes into the picker without corrupting the token', async () => {
        // onKeydown already guards a typed printable key with the caret
        // inside the marking (collapsed selection, s < markEnd) by routing
        // it into the picker instead of letting it corrupt "(S)" before the
        // async auto-open gets a chance to fire. Paste has no keydown to
        // hook (Cmd+V isn't a length-1 printable key), so without its
        // own guard a paste landed the browser's default insertion (or,
        // for a newline-bearing clipboard, this handler's own manual
        // insertion) straight into the marking region, unprotected. This
        // covers the plain (no-newline) paste shape, which without the guard
        // would fall through untouched to the browser default (jsdom, unlike a
        // real browser, doesn't simulate that default insertion, so the
        // observable signal is defaultPrevented + whether the picker
        // opened, same as the sibling "left to the browser default" test
        // above).
        const engine = createTestEngine();

        root.innerHTML = `<input type="text" id="field" data-ezclassify-controller="marked-input" value="(S) report">`;
        const forms = new EzClassifyUI(engine as never, { root });
        activeForms.push(forms);
        await wait(50);

        const inputEl = editingField('field') as HTMLTextAreaElement;
        const mountContainer = document.querySelector(
            '[data-ezclassify-mount="marked-input"]',
        ) as HTMLElement;
        const before = inputEl.value;

        inputEl.focus();
        inputEl.setSelectionRange(2, 2); // inside "(S)": markEnd is 3

        const clipboardData = {
            getData: (type: string) => (type === 'text/plain' ? 'X' : ''),
        };
        const pasteEvent = new Event('paste', {
            bubbles: true,
            cancelable: true,
        }) as ClipboardEvent;
        Object.defineProperty(pasteEvent, 'clipboardData', {
            value: clipboardData,
        });
        inputEl.dispatchEvent(pasteEvent);
        await wait(50);

        expect(pasteEvent.defaultPrevented).toBe(true);
        // No manual insertion happened either: the token is untouched.
        expect(inputEl.value).toBe(before);
        expect(
            mountContainer.classList.contains('marked-input-picker-active'),
        ).toBe(true);
    });

    it('original input retains its label association', async () => {
        const engine = createTestEngine();
        root.innerHTML = `
      <label for="field">Title</label>
      <input type="text" id="field" data-ezclassify-controller="marked-input" value="(U) memo">
    `;
        const forms = new EzClassifyUI(engine as never, { root });
        activeForms.push(forms);
        await wait(50);

        const host = document.getElementById('field') as HTMLInputElement;
        const label = root.querySelector('label')!;
        expect(host.labels?.length).toBe(1);
        expect(host.labels?.[0]).toBe(label);
    });

    it('form submit value is unchanged: still the flat "(U) title" string, no embedded newline', async () => {
        const engine = createTestEngine();
        root.innerHTML = `<form id="f"><input type="text" id="field" data-ezclassify-controller="marked-input" value="(U) report title"></form>`;
        const forms = new EzClassifyUI(engine as never, { root });
        activeForms.push(forms);
        await wait(50);

        const inputEl = editingField('field') as HTMLTextAreaElement;
        // What a form submission actually serializes is textarea.value:
        // a <textarea name="..."> submits its .value as plain text exactly
        // like an <input>; there is no framing/serialization difference.
        expect(inputEl.value).toBe('(U) report title');
        expect(inputEl.value).not.toContain('\n');
    });

    it('the marking-boundary character-offset math holds on content long enough to wrap in a real browser', async () => {
        // jsdom cannot measure wrapping. This test checks character-offset
        // boundary behavior on a long free-text tail at offsets corresponding
        // to marking and free-text positions.
        const engine = createTestEngine();
        const longTail =
            'the quarterly report covers several regional offices and includes a long narrative section that a real browser would wrap across many visual lines';
        root.innerHTML = `
      <input type="text" id="field" data-ezclassify-controller="marked-input" value="(U) ${longTail}">
    `;
        const forms = new EzClassifyUI(engine as never, { root });
        activeForms.push(forms);
        await wait(50);

        const inputEl = editingField('field') as HTMLTextAreaElement;
        const mountContainer = document.querySelector(
            '[data-ezclassify-mount="marked-input"]',
        ) as HTMLElement;
        const markEnd = '(U)'.length; // 3

        // "Click at the end of a wrapped visual line" mid-tail: some
        // arbitrary offset deep inside the free text, e.g. where a real
        // browser's 3rd wrapped line would end. Character-offset math does
        // not care that this position is visually on line 3: it only
        // knows cursorPos (60) is not < markEnd (3).
        inputEl.focus();
        inputEl.dispatchEvent(new Event('focus'));
        inputEl.setSelectionRange(60, 60);
        document.dispatchEvent(new Event('selectionchange'));
        await wait(30);
        expect(
            mountContainer.classList.contains('marked-input-picker-active'),
        ).toBe(false);
        expect(inputEl.selectionStart).toBe(60);

        // "Click at the very end of the (wrapped, multi-line) text":
        // selectionStart at value.length.
        const end = inputEl.value.length;
        inputEl.setSelectionRange(end, end);
        document.dispatchEvent(new Event('selectionchange'));
        await wait(30);
        expect(
            mountContainer.classList.contains('marked-input-picker-active'),
        ).toBe(false);
        expect(inputEl.selectionStart).toBe(end);

        // The character at markEnd is free text and must not reopen the picker.
        inputEl.setSelectionRange(markEnd, markEnd);
        document.dispatchEvent(new Event('selectionchange'));
        await wait(30);
        expect(
            mountContainer.classList.contains('marked-input-picker-active'),
        ).toBe(false);

        // An offset inside the marking must open the picker regardless of the
        // free-text tail length.
        inputEl.setSelectionRange(1, 1);
        document.dispatchEvent(new Event('selectionchange'));
        await wait(50);
        expect(
            mountContainer.classList.contains('marked-input-picker-active'),
        ).toBe(true);
    });
});

describe('MarkedInput: standalone self-publish to the page aggregate', () => {
    // A standalone marked-input without explicit binding attributes must
    // register as a marking host and publish edits into the page aggregate.

    it('auto-assigns a synthetic marking id when the host has none', async () => {
        const engine = createTestEngine();
        root.innerHTML = `<input type="text" data-ezclassify-controller="marked-input" value="(U) memo">`;
        const forms = new EzClassifyUI(engine as never, {});
        activeForms.push(forms);
        await wait(80);

        const el = root.querySelector<HTMLInputElement>('input')!;
        expect(el.id).toMatch(/^__ez-marked-input-/);
    });

    it('a marked field edit MOVES the page aggregate (the banner roll-up)', async () => {
        const engine = createTestEngine();
        // Two standalone marked-inputs, mirroring the Builder's name + a second
        // marked field. Start both unmarked so the aggregate is genuinely a rollup.
        // Each input lives in its own field wrapper, as the Builder renders them:
        // a marked-input resolves its native element from its parent, so two bare
        // siblings would both bind the first input.
        root.innerHTML = `
      <div class="field"><input type="text" id="mi-a" data-ezclassify-controller="marked-input"></div>
      <div class="field"><input type="text" id="mi-b" data-ezclassify-controller="marked-input"></div>
    `;
        const forms = new EzClassifyUI(engine as never, {});
        activeForms.push(forms);
        await wait(80);

        const a = editingField('mi-a') as HTMLTextAreaElement;
        const b = editingField('mi-b') as HTMLTextAreaElement;

        // Empty aggregate up front.
        expect(forms.store.getAggregate().assertions).toHaveLength(0);

        // Mark A (U), B (S). The 'max' rollup on `level` makes the aggregate S.
        a.value = '(U) alpha';
        a.dispatchEvent(new Event('input', { bubbles: true }));
        await wait(80);
        b.value = '(S) bravo';
        b.dispatchEvent(new Event('input', { bubbles: true }));
        await wait(80);

        const raised = forms.store.getAggregate();
        expect(
            raised.assertions.some((x) => x.conceptId === 'S'),
            'aggregate must include S after a marked-input edit',
        ).toBe(true);

        // Lower B back to (U). The aggregate must re-roll DOWN, no S left.
        b.value = '(U) bravo';
        b.dispatchEvent(new Event('input', { bubbles: true }));
        await wait(80);

        const lowered = forms.store.getAggregate();
        expect(
            lowered.assertions.some((x) => x.conceptId === 'S'),
            'aggregate must drop S after lowering the mark',
        ).toBe(false);
        expect(
            lowered.assertions.some((x) => x.conceptId === 'U'),
            'aggregate should still carry U',
        ).toBe(true);
    });

    it('clearing a marked-input mark drops its contribution from the aggregate', async () => {
        const engine = createTestEngine();
        root.innerHTML = `
      <input type="text" id="mi-only" data-ezclassify-controller="marked-input" value="(S) classified title">
    `;
        const forms = new EzClassifyUI(engine as never, {});
        activeForms.push(forms);
        await wait(80);

        expect(
            forms.store
                .getAggregate()
                .assertions.some((x) => x.conceptId === 'S'),
        ).toBe(true);

        // User deletes the marking, leaving plain text. The aggregate must clear.
        const el = editingField('mi-only') as HTMLTextAreaElement;
        el.value = 'classified title';
        el.dispatchEvent(new Event('input', { bubbles: true }));
        await wait(80);

        expect(forms.store.getAggregate().assertions).toHaveLength(0);
    });

    it('a marked-input with data-ezclassify-bound-to still binds to the named marking (not self)', async () => {
        // The auto-self-host path must NOT hijack an explicit bound-to. This guards
        // the condition that self-registration only kicks in without bound-to/facet-of.
        const engine = createTestEngine();
        root.innerHTML = `
      <input type="hidden" id="doc-marking" data-ezclassify-rendered />
      <input type="text" id="bound-mi" data-ezclassify-controller="marked-input"
             data-ezclassify-bound-to="doc-marking" value="(U) memo">
    `;
        const forms = new EzClassifyUI(engine as never, { root });
        activeForms.push(forms);
        await wait(80);

        // The edit lands under doc-marking, not under the input's own id.
        const bound = editingField('bound-mi') as HTMLTextAreaElement;
        bound.value = '(S) memo';
        bound.dispatchEvent(new Event('input', { bubbles: true }));
        await wait(80);

        expect(
            forms.store
                .get('doc-marking')
                .assertions.some((x) => x.conceptId === 'S'),
        ).toBe(true);
        expect(forms.store.get('bound-mi').assertions).toHaveLength(0);
    });
});

describe('MarkedInput favorites', () => {
    /** Mount MarkedInput directly (see createTestContext's doc comment). */
    async function mountDirect(
        options: Parameters<MarkedInput['init']>[2] = {},
    ): Promise<{
        input: HTMLTextAreaElement;
        field: MarkedInput;
        container: HTMLDivElement;
    }> {
        const container = document.createElement('div');
        root.appendChild(container);
        const native = document.createElement('input');
        native.type = 'text';
        const input = native;
        container.appendChild(input);
        const field = new MarkedInput();
        await field.init(container, createTestContext(), options);
        return {
            input: container.querySelector<HTMLTextAreaElement>(
                '.marked-input-native',
            )!,
            field,
            container,
        };
    }

    it('renders no ★ button when favorites is not wired', async () => {
        await mountDirect();
        expect(root.querySelector('.ez-favorites-button')).toBeNull();
    });

    it('applies a favorite by REPLACING the leading part mark, preserving free text', async () => {
        const load = vi.fn(async () => [{ marking: 'S', label: 'Secret' }]);
        const { input, field } = await mountDirect({ favorites: { load } });
        input.value = '(U) quarterly report';
        input.dispatchEvent(new Event('input', { bubbles: true }));
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

        expect(input.value).toBe('(S) quarterly report');
        expect(field.getAssertions().map((a) => a.conceptId)).toEqual(['S']);
    });

    it('applying a favorite while the inline picker is open closes the picker instead of leaving it stale', async () => {
        // Applying a favorite must close an open picker so its stale draft
        // cannot overwrite the applied marking.
        const load = vi.fn(async () => [{ marking: 'S', label: 'Secret' }]);
        const { input, container } = await mountDirect({
            favorites: { load },
        });
        input.value = '(U) quarterly report';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        await wait();

        input.focus();
        input.dispatchEvent(
            new KeyboardEvent('keydown', {
                key: 'Enter',
                ctrlKey: true,
                bubbles: true,
                cancelable: true,
            }),
        );
        await wait();
        expect(container.classList.contains('marked-input-picker-active')).toBe(
            true,
        );

        const button = root.querySelector(
            '.ez-favorites-button',
        ) as HTMLButtonElement;
        button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        await wait();

        const row = document.body.querySelector(
            '.ez-favorites-panel .proto-dropdown-item',
        ) as HTMLElement;
        row.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        await wait();

        expect(input.value).toBe('(S) quarterly report');
        expect(container.classList.contains('marked-input-picker-active')).toBe(
            false,
        );
        expect(root.querySelector('.inline-editor-input')).toBeNull();
    });
});
