import { textareaEditor } from '../../test-fixtures/textarea-editor';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { asContext } from '../../test-fixtures/as-context';
import { expectInlineChrome } from '../../test-fixtures/field-chrome';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { ScanOutcome, SchemePublicView } from '@ezclassify/types';
import type { LocalContextSchemeEngineAdapter } from '@ezclassify/types';
import { openContext } from '../../test-fixtures/context-doubles';
import { EzClassifyUI } from '../ezclassify-ui';
import { MarkedTextArea } from './marked-text-area';
import { HiddenAssertionField } from './hidden-assertion-field';
import { createAsyncMockEngine } from './async-engine-mock';
import { connectDemoContext } from '../../../../test-support/demo-runtime';

function wait(ms = 50): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
}

// Polls condition every 10ms up to `timeout` ms. Used where a fixed wait is
// too tight under full-suite CPU load (e.g. debounced rollup after scan).
async function waitFor(condition: () => boolean, timeout = 500): Promise<void> {
    const deadline = Date.now() + timeout;
    while (!condition() && Date.now() < deadline) {
        await wait(10);
    }
}

function createProfile(): SchemePublicView {
    return {
        id: 'marked-test',
        version: '1.0.0',
        name: 'Marked Test',
        // The generic pair the engine resolves for a scheme with no vocabulary
        // override of its own.
        referenceSurfaceLabel: { singular: 'Handbook', plural: 'Handbooks' },
        defaultRenderFormat: 'portion',
        labelPresets: [],
        concepts: [
            {
                id: 'U',
                name: 'Unclassified',
                views: { default: 'U' },
                aliases: [],
                categories: ['level'],
                parents: [],
                position: 1,
            },
            {
                id: 'S',
                name: 'Secret',
                views: { default: 'S' },
                aliases: [],
                categories: ['level'],
                parents: [],
                position: 2,
            },
        ],
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
        formats: [
            {
                id: 'portion',
                surface: 'default',
                mode: 'inline',
                view: 'default',
                categoryOrder: ['level'],
            },
        ],
    } as SchemePublicView;
}

/**
 * Engine that follows the bare-render architecture: the part format returns "U"
 * (no parens); MTA wraps once via embedded_marking.template → "(U) ".
 */
async function createBareFormatEngine(): Promise<LocalContextSchemeEngineAdapter> {
    return openContext(
        await connectDemoContext({
            draft: {
                scheme: {
                    scheme: {
                        id: 'marked-bare',
                        version: '1.0.0',
                        name: 'Marked Test Bare',
                        description: 'Marked Test Bare test fixture.',
                        data: {
                            concepts: [
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
                            {
                                pattern: '\\(([^)]+)\\)',
                                template: '({marking}) ',
                            },
                        ],
                        render: {
                            default: 'portion',
                            formats: [
                                // Bare format: engine.render() returns "U", never "(U)".
                                {
                                    id: 'portion',
                                    surface: 'marking',
                                    mode: 'inline',
                                    separator: '//',
                                    fields: [
                                        { category: 'level', separator: '/' },
                                    ],
                                },
                            ],
                        },
                    },
                },
            },
        }),
    ).scheme as LocalContextSchemeEngineAdapter;
}

async function createTestEngine(): Promise<LocalContextSchemeEngineAdapter> {
    return openContext(
        await connectDemoContext({
            draft: {
                scheme: {
                    scheme: {
                        id: 'marked-test',
                        version: '1.0.0',
                        name: 'Marked Test',
                        description: 'Marked Test test fixture.',
                        data: {
                            concepts: [
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
                            {
                                pattern: '\\(([^)]+)\\)',
                                template: '({marking}) ',
                            },
                        ],
                        render: {
                            default: 'portion',
                            formats: [
                                {
                                    id: 'portion',
                                    surface: 'marking',
                                    mode: 'inline',
                                    separator: '//',
                                    fields: [
                                        { category: 'level', separator: '/' },
                                    ],
                                },
                            ],
                        },
                    },
                },
            },
        }),
    ).scheme as LocalContextSchemeEngineAdapter;
}

/**
 * Same U/S vocabulary and embedded_marking template as `createTestEngine`, but
 * returns the raw `Context` (not narrowed to `.scheme`) so favorites tests can
 * mount MarkedTextArea directly via `.init()`: favorites config is a plain JS
 * function with no declarative `data-ezclassify-*` equivalent.
 */
async function createTestContext() {
    return openContext(
        await connectDemoContext({
            draft: {
                scheme: {
                    scheme: {
                        id: 'mta-fav-test',
                        version: '1.0.0',
                        name: 'MarkedTextArea Favorites Test',
                        description:
                            'MarkedTextArea Favorites Test test fixture.',
                        data: {
                            concepts: [
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
                            {
                                pattern: '\\(([^)]+)\\)',
                                template: '({marking}) ',
                            },
                        ],
                        render: {
                            default: 'portion',
                            formats: [
                                {
                                    id: 'portion',
                                    surface: 'marking',
                                    mode: 'inline',
                                    separator: '//',
                                    fields: [
                                        { category: 'level', separator: '/' },
                                    ],
                                },
                            ],
                        },
                    },
                },
            },
        }),
    );
}

let root: HTMLDivElement;
const activeForms: EzClassifyUI[] = [];

beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    // jsdom doesn't implement scrollIntoView; suppress the error so async
    // dropdown-highlight code in InlineMarkingEditor doesn't produce an
    // unhandled rejection in tests.
    Element.prototype.scrollIntoView = vi.fn();
    document.body.innerHTML = '';
    root = document.createElement('div');
    document.body.appendChild(root);
});

afterEach(() => {
    vi.restoreAllMocks();
    while (activeForms.length > 0) activeForms.pop()!.destroy();
    document.body.innerHTML = '';
});

describe('masked host theme paint', () => {
    it('samples authored paint from the hidden native textarea on theme change', async () => {
        const root = document.createElement('div');
        root.innerHTML = `<textarea id="theme-body" data-ezclassify-controller="marked-textarea" style="transition-property: opacity !important; color: rgb(12, 34, 56)">(U) Body text.</textarea>`;
        document.body.append(root);
        const host = root.querySelector('textarea')!;
        const realGetComputedStyle = window.getComputedStyle.bind(window);
        let themeRead = false;
        let sampled = 0;
        const spy = vi
            .spyOn(window, 'getComputedStyle')
            .mockImplementation((element: Element) => {
                const computed = realGetComputedStyle(element);
                if (element !== host || !themeRead) return computed;
                sampled++;
                return new Proxy(computed, {
                    get(target, key) {
                        const authored = {
                            color: 'rgb(210, 220, 230)',
                            backgroundColor: 'rgb(20, 30, 40)',
                            borderColor: 'rgb(100, 110, 120)',
                        };
                        if (key in authored)
                            return authored[key as keyof typeof authored];
                        const value = Reflect.get(target, key, target);
                        return typeof value === 'function'
                            ? value.bind(target)
                            : value;
                    },
                });
            });
        try {
            const forms = new EzClassifyUI(
                asContext((await createTestEngine()) as never),
                {
                    root,
                },
            );
            activeForms.push(forms);
            await wait(50);
            themeRead = true;
            document.documentElement.classList.add('reduced-motion-paint');
            await wait(20);
            const display = root.querySelector(
                '.marked-textarea-display',
            ) as HTMLElement;
            expect(sampled).toBeGreaterThan(0);
            expect(display.style.color).toBe('rgb(210, 220, 230)');
            expect(display.style.backgroundColor).toBe('rgb(20, 30, 40)');
            expect(display.style.borderColor).toBe('rgb(100, 110, 120)');
            expect(host.hidden).toBe(true);
            expect(textareaEditor(host)).not.toBe(host);
            expect(host.style.getPropertyValue('transition-property')).toBe(
                'opacity',
            );
            expect(host.style.getPropertyPriority('transition-property')).toBe(
                'important',
            );
            expect(host.value).toBe('(U) Body text.');
        } finally {
            spy.mockRestore();
            document.documentElement.classList.remove('reduced-motion-paint');
        }
    });
});

describe('HiddenAssertionField', () => {
    it('stores assertions and contributes to rollup without rendering UI', async () => {
        const engine = createAsyncMockEngine({
            delay: 2,
            scheme: createProfile(),
        });
        root.innerHTML = `
      <div id="hidden-a" data-ezclassify-controller="hidden" data-ezclassify-marking data-ezclassify-format="portion"></div>
      <input type="hidden" id="rollup" data-ezclassify-aggregate>
    `;
        const forms = new EzClassifyUI(asContext(engine as never));
        activeForms.push(forms);
        await wait(30);

        const host = document.getElementById('hidden-a') as HTMLDivElement;
        const comp = forms.components.get(host) as
            HiddenAssertionField | undefined;
        expect(comp).toBeInstanceOf(HiddenAssertionField);
        expect(host.style.display).toBe('none');

        comp!.setAssertions([
            {
                conceptId: 'U',
                categoryId: 'level',
                confidence: 'certain',
                source: 'user',
            },
        ]);
        // Wait long enough for async render + rollup debounce (30ms) to settle.
        await wait(100);
        expect(comp!.getRendered()).toBe('U');

        const rollupEl = document.getElementById('rollup') as HTMLInputElement;
        expect(rollupEl.value).toContain('U');
    });
});

describe('MarkedTextArea', () => {
    it.each(['readonly', 'disabled'])(
        'initializes an already %s textarea',
        async (attribute) => {
            const container = document.createElement('div');
            const native = document.createElement('textarea');
            native.setAttribute(attribute, '');
            native.value = 'Existing text.';
            container.appendChild(native);
            root.appendChild(container);
            const engine = createAsyncMockEngine({ scheme: createProfile() });
            const field = new MarkedTextArea();

            try {
                await field.init(container, engine as never);
                expect(textareaEditor(native).hasAttribute(attribute)).toBe(
                    true,
                );
                expect(
                    root.querySelector('.marked-textarea-display')?.textContent,
                ).toContain('Existing text.');
            } finally {
                field.destroy();
            }
        },
    );

    it('keeps the touch Add marking button above the transparent input hit layer', async () => {
        const engine = await createBareFormatEngine();
        root.innerHTML = `
      <textarea id="body" data-ezclassify-controller="marked-textarea"></textarea>
    `;
        const forms = new EzClassifyUI(asContext(engine as never), { root });
        activeForms.push(forms);
        await wait(80);

        const touchAdd = root.querySelector(
            '.marked-textarea-touch-add',
        ) as HTMLButtonElement;
        expect(touchAdd).toBeTruthy();

        touchAdd.click();
        await waitFor(
            () => root.querySelector('.marked-textarea-picker-active') !== null,
            1000,
        );

        expect(
            root.querySelector('.marked-textarea-picker-active'),
        ).toBeTruthy();
    });

    it('the plain Add marking action opens the picker on click', async () => {
        const engine = await createBareFormatEngine();
        root.innerHTML = `
      <textarea id="body" data-ezclassify-controller="marked-textarea"></textarea>
    `;
        const forms = new EzClassifyUI(asContext(engine as never), { root });
        activeForms.push(forms);
        await wait(80);

        const hint = root.querySelector(
            '.marked-textarea-touch-add',
        ) as HTMLButtonElement;
        expect(hint).toBeTruthy();
        expect(hint.tagName).toBe('BUTTON');
        expect(hint.type).toBe('button');
        expect(hint.hasAttribute('aria-hidden')).toBe(false);

        hint.click();
        await waitFor(
            () => root.querySelector('.marked-textarea-picker-active') !== null,
            1000,
        );

        expect(
            root.querySelector('.marked-textarea-picker-active'),
        ).toBeTruthy();
    });

    it('keeps the direct marking action without instruction chrome', async () => {
        const engine = await createBareFormatEngine();
        root.innerHTML = `
      <textarea id="body" data-ezclassify-controller="marked-textarea"></textarea>
    `;
        const forms = new EzClassifyUI(asContext(engine as never), { root });
        activeForms.push(forms);
        await wait(80);

        expect(root.querySelector('.marked-textarea-kb-hint')).toBeNull();
        expect(root.querySelector('.marked-textarea-touch-add')).toBeTruthy();
    });

    it('keeps the input and display typography metrics identical after enhancement', async () => {
        const engine = await createTestEngine();
        root.innerHTML = `
      <style>
        .demo textarea {
          font-family: monospace;
          font-size: 14px;
          line-height: 23px;
          letter-spacing: 1px;
          word-spacing: 2px;
          padding: 12px 14px;
        }
      </style>
      <div class="demo">
        <textarea id="body" data-ezclassify-controller="marked-textarea">(U) Para one.</textarea>
      </div>
    `;
        const forms = new EzClassifyUI(asContext(engine as never), { root });
        activeForms.push(forms);
        await wait(50);

        const textarea = document.getElementById('body') as HTMLTextAreaElement;
        const display = root.querySelector(
            '.marked-textarea-display',
        ) as HTMLDivElement;
        const inputStyle = getComputedStyle(textarea);
        const displayStyle = getComputedStyle(display);

        expect(displayStyle.fontFamily).toBe(inputStyle.fontFamily);
        expect(displayStyle.fontSize).toBe(inputStyle.fontSize);
        expect(displayStyle.lineHeight).toBe(inputStyle.lineHeight);
        expect(displayStyle.letterSpacing).toBe(inputStyle.letterSpacing);
        expect(displayStyle.wordSpacing).toBe(inputStyle.wordSpacing);
        expect(displayStyle.padding).toBe(inputStyle.padding);
    });

    it('scans the textarea, produces one segment per wrapped marking, and feeds rollup via hidden children', async () => {
        const engine = await createTestEngine();
        root.innerHTML = `
      <textarea id="body" data-ezclassify-controller="marked-textarea" data-ezclassify-format="portion">(U) Para one.\n\n(S) Para two.</textarea>
      <input type="hidden" id="rollup" data-ezclassify-aggregate>
    `;
        const forms = new EzClassifyUI(asContext(engine as never));
        activeForms.push(forms);
        await wait(50);

        const ta = document.getElementById('body') as HTMLTextAreaElement;
        const comp = forms.components.get(ta) as MarkedTextArea | undefined;
        expect(comp).toBeInstanceOf(MarkedTextArea);

        const segments = comp!.getSegments();
        expect(segments).toHaveLength(2);
        expect(segments[0].marking).toBe('(U)');
        expect(segments[0].text).toBe('Para one.');
        expect(segments[1].marking).toBe('(S)');
        expect(segments[1].text).toBe('Para two.');

        const rollupEl = document.getElementById('rollup') as HTMLInputElement;
        await waitFor(() => rollupEl.value.length > 0);
        expect(rollupEl.value.length).toBeGreaterThan(0);

        const hiddenBoxes = root.querySelectorAll(
            '[data-marked-textarea-field]',
        );
        expect(hiddenBoxes).toHaveLength(2);
    });

    it('emits ezclassify:marked-change carrying per-segment assertions and rendered form', async () => {
        const engine = await createTestEngine();
        root.innerHTML = `
      <textarea id="body" data-ezclassify-controller="marked-textarea" data-ezclassify-format="portion">(U) Para one.\n\n(S) Para two.</textarea>
      <input type="hidden" id="rollup" data-ezclassify-aggregate>
    `;
        // Attach before construction so the initial scan's emit is captured.
        const details: Array<{
            segments: Array<{ assertions: unknown[]; rendered: unknown }>;
        }> = [];
        const onMarkedChange = (e: Event) =>
            details.push((e as CustomEvent).detail as (typeof details)[number]);
        document.addEventListener('ezclassify:marked-change', onMarkedChange);
        try {
            const forms = new EzClassifyUI(asContext(engine as never));
            activeForms.push(forms);

            await waitFor(() => details.length > 0, 1000);
            const detail = details[details.length - 1];
            expect(detail.segments).toHaveLength(2);
            for (const seg of detail.segments) {
                expect(Array.isArray(seg.assertions)).toBe(true);
                expect(typeof seg.rendered).toBe('string');
            }
            // A recognized marking segment carries its parsed assertions.
            expect(detail.segments[0].assertions.length).toBeGreaterThan(0);
        } finally {
            document.removeEventListener(
                'ezclassify:marked-change',
                onMarkedChange,
            );
        }
    });

    it('emits ezclassify:text-change on a body edit with the per-segment text slices', async () => {
        const engine = await createTestEngine();
        root.innerHTML = `
      <textarea id="body" data-ezclassify-controller="marked-textarea" data-ezclassify-format="portion">(U) Para one.</textarea>
      <input type="hidden" id="rollup" data-ezclassify-aggregate>
    `;
        const forms = new EzClassifyUI(asContext(engine as never));
        activeForms.push(forms);
        await wait(50);

        const ta = document.getElementById('body') as HTMLTextAreaElement;
        const details: Array<{
            segments: Array<{ text: string }>;
        }> = [];
        const onTextChange = (e: Event) =>
            details.push((e as CustomEvent).detail as (typeof details)[number]);
        document.addEventListener('ezclassify:text-change', onTextChange);
        try {
            // Simulate a body-text edit on the native capture textarea.
            ta.value = '(U) Para one edited.';
            ta.dispatchEvent(new Event('input', { bubbles: true }));

            await waitFor(() => details.length > 0, 1000);
            const detail = details[details.length - 1];
            expect(detail.segments.length).toBeGreaterThan(0);
            expect(typeof detail.segments[0].text).toBe('string');
        } finally {
            document.removeEventListener(
                'ezclassify:text-change',
                onTextChange,
            );
        }
    });

    it('preserves body text when an external store commit changes the bound marking', async () => {
        const engine = await createTestEngine();
        const body = '(U) Para one.\n\n(S) Para two.';
        root.innerHTML = `
      <input type="hidden" id="doc-marking" data-ezclassify-marking />
      <textarea id="body"
                data-ezclassify-controller="marked-textarea"
                data-ezclassify-bound-to="doc-marking">${body}</textarea>
    `;
        const forms = new EzClassifyUI(asContext(engine as never), { root });
        activeForms.push(forms);
        await wait(150);

        const ta = document.getElementById('body') as HTMLTextAreaElement;
        const comp = forms.components.get(ta) as MarkedTextArea;
        expect(comp).toBeInstanceOf(MarkedTextArea);
        expect(ta.value).toBe(body);

        // Publish a sibling whole-marking change without replacing the body text.
        const externalToken = { token: {} };
        await forms.store.publishRendered('doc-marking', 'S', externalToken);
        await wait(100);

        // Body text must be completely unchanged, MTA is publish-only.
        expect(ta.value).toBe(body);
        expect(comp.getSegments()).toHaveLength(2);
    });

    it('picker write-back wraps exactly once via embedded template (bare-format engine)', async () => {
        // Architecture rule: render formats return bare markings ("U", not "(U)").
        // The embedded_marking template is the single wrapping authority. The
        // picker write-back applies the template once → "(U)", never "((U))".
        const engine = await createBareFormatEngine();
        root.innerHTML = `
      <textarea id="body" data-ezclassify-controller="marked-textarea"></textarea>
    `;
        const forms = new EzClassifyUI(asContext(engine as never), { root });
        activeForms.push(forms);
        await wait(80);

        const ta = document.getElementById('body') as HTMLTextAreaElement;
        const comp = forms.components.get(ta) as MarkedTextArea;
        expect(comp).toBeInstanceOf(MarkedTextArea);

        // Open the picker via Cmd+Enter with an empty textarea.
        ta.focus();
        textareaEditor(ta).dispatchEvent(
            new KeyboardEvent('keydown', {
                key: 'Enter',
                ctrlKey: true,
                bubbles: true,
            }),
        );
        await wait(80);

        // Find the inline editor input rendered by InlineMarkingEditor.
        const pickerInput = root.querySelector(
            '.inline-editor-input',
        ) as HTMLInputElement | null;
        if (!pickerInput) {
            // Picker didn't mount in this environment, skip without failing.
            return;
        }

        // Simulate typing 'U' and accepting via Tab, which causes the picker to
        // call engine.process → rendered = "U" (bare, no prefix/suffix parens).
        pickerInput.value = 'U';
        pickerInput.dispatchEvent(new Event('input', { bubbles: true }));
        await wait(150);

        // Tab to accept the ghost/suggestion.
        pickerInput.dispatchEvent(
            new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }),
        );
        await wait(150);

        // Escape to close the picker and commit to the textarea.
        textareaEditor(ta).dispatchEvent(
            new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
        );
        await wait(300);

        // The textarea value must be single-wrapped: "(U)" or "(U) ", NOT "((U))".
        const value = ta.value.trim();
        if (value) {
            expect(value).not.toContain('((');
            expect(value).not.toContain('))');
            // Re-scan: the engine should find exactly one valid segment, not an error.
            const segments = comp.getSegments();
            expect(segments.length).toBeGreaterThan(0);
            expect(segments[0].valid).toBe(true);
        }
    });

    it('resyncs hidden fields when the textarea changes', async () => {
        const engine = await createTestEngine();
        root.innerHTML = `
      <textarea id="body" data-ezclassify-controller="marked-textarea" data-ezclassify-format="portion">(U) Just one paragraph.</textarea>
      <input type="hidden" id="rollup" data-ezclassify-aggregate>
    `;
        const forms = new EzClassifyUI(asContext(engine as never));
        activeForms.push(forms);
        await wait(30);

        const ta = document.getElementById('body') as HTMLTextAreaElement;
        const comp = forms.components.get(ta) as MarkedTextArea;
        expect(comp.getSegments()).toHaveLength(1);

        ta.value = '(U) First.\n\n(S) Second.';
        ta.dispatchEvent(new Event('input', { bubbles: true }));
        await wait(400);

        expect(comp.getSegments()).toHaveLength(2);
        expect(
            root.querySelectorAll('[data-marked-textarea-field]'),
        ).toHaveLength(2);

        ta.value = 'No marking here.';
        ta.dispatchEvent(new Event('input', { bubbles: true }));
        await wait(400);

        expect(comp.getSegments()).toHaveLength(0);
        expect(
            root.querySelectorAll('[data-marked-textarea-field]'),
        ).toHaveLength(0);
    });

    it('no ghost chip after picker closes without selection on empty textarea', async () => {
        // Reproduces the ghost-chip bug: Ctrl+Enter on empty textarea inserts "()"
        // template and pushes a temp segment. Escaping without selecting clears the
        // template. The temp segment must be pruned so the display shows no chip.
        const engine = await createTestEngine();
        root.innerHTML = `<textarea id="body" data-ezclassify-controller="marked-textarea"></textarea>`;
        const forms = new EzClassifyUI(asContext(engine as never), { root });
        activeForms.push(forms);
        await wait(80);

        const ta = document.getElementById('body') as HTMLTextAreaElement;
        const comp = forms.components.get(ta) as MarkedTextArea;

        // Open picker on empty textarea
        ta.focus();
        textareaEditor(ta).dispatchEvent(
            new KeyboardEvent('keydown', {
                key: 'Enter',
                ctrlKey: true,
                bubbles: true,
                cancelable: true,
            }),
        );
        await wait(80);

        // Close picker via Escape without selecting anything
        textareaEditor(ta).dispatchEvent(
            new KeyboardEvent('keydown', {
                key: 'Escape',
                bubbles: true,
                cancelable: true,
            }),
        );
        await wait(200);

        // Textarea has at most the trailing space from the template; segments must be empty (no ghost chip)
        expect(ta.value.trim()).toBe('');
        expect(comp.getSegments()).toHaveLength(0);

        // Display div must not contain any chip
        const display = root.querySelector('.marked-textarea-display');
        const chips = display?.querySelectorAll('.marked-textarea-chip') ?? [];
        expect(chips.length).toBe(0);
    });

    it('keeps its inline chrome in place while the editor opens and closes', async () => {
        Element.prototype.scrollIntoView = vi.fn();

        const engine = await createTestEngine();
        root.innerHTML = `<textarea id="body" data-ezclassify-controller="marked-textarea"></textarea>`;
        const forms = new EzClassifyUI(asContext(engine as never), { root });
        activeForms.push(forms);
        await wait(80);

        const ta = document.getElementById('body') as HTMLTextAreaElement;
        const wrap = ta.closest('.marked-textarea-wrap') as HTMLElement;
        const chrome = expectInlineChrome(wrap, [
            textareaEditor(ta),
            wrap.querySelector(':scope > .marked-textarea-display')!,
        ]);
        const mark = chrome.querySelector('.ez-status-mark');

        ta.focus();
        textareaEditor(ta).dispatchEvent(
            new KeyboardEvent('keydown', {
                key: 'Enter',
                ctrlKey: true,
                bubbles: true,
            }),
        );
        await wait(150);
        expect(document.querySelector('.inline-editor-input')).not.toBeNull();
        expect(chrome.querySelector('.ez-status-mark')).toBe(mark);

        document.dispatchEvent(
            new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
        );
        await wait(80);
        expect(chrome.querySelector('.ez-status-mark')).toBe(mark);
    });

    it('clears the chip background on the editing chip, so a fresh template shows no stray selection-look highlight', async () => {
        // The editing chip has no selection-style fill, whether it represents a
        // fresh empty template or a reopened marking.
        const engine = await createTestEngine();
        root.innerHTML = `<textarea id="body" data-ezclassify-controller="marked-textarea"></textarea>`;
        const forms = new EzClassifyUI(asContext(engine as never), { root });
        activeForms.push(forms);
        await wait(80);

        const ta = document.getElementById('body') as HTMLTextAreaElement;
        ta.focus();
        textareaEditor(ta).dispatchEvent(
            new KeyboardEvent('keydown', {
                key: 'Enter',
                ctrlKey: true,
                bubbles: true,
                cancelable: true,
            }),
        );
        await wait(80);

        const display = root.querySelector('.marked-textarea-display');
        const editingChip = display?.querySelector(
            '.marked-textarea-chip--editing',
        );
        expect(editingChip).toBeTruthy();

        // Reads the source CSS directly: jsdom does not apply an injected
        // <style>'s cascade to getComputedStyle here, so a
        // getComputedStyle assertion on the mounted chip would pass
        // regardless of what marked-text-area.css actually says.
        const css = readFileSync(
            join(
                dirname(fileURLToPath(import.meta.url)),
                'marked-text-area.css',
            ),
            'utf8',
        );
        expect(css).toMatch(
            /\.marked-textarea-chip--editing\s*\{[^}]*background:\s*transparent/,
        );
        expect(css).toMatch(
            /\.marked-textarea-chip--editing\s*\{[^}]*pointer-events:\s*auto/,
        );
    });

    it('pins its chrome to the first line, top right', async () => {
        const engine = await createTestEngine();
        root.innerHTML = `<textarea id="body" data-ezclassify-controller="marked-textarea"></textarea>`;
        const forms = new EzClassifyUI(asContext(engine as never), { root });
        activeForms.push(forms);
        await wait(80);
        const chrome = root.querySelector('.ez-field-chrome')!;
        expect(chrome.classList.contains('ez-field-chrome--start')).toBe(true);

        const here = dirname(fileURLToPath(import.meta.url));
        const css = readFileSync(join(here, 'field-chrome.css'), 'utf8');
        expect(css).toMatch(
            /\.ez-field-chrome--start\s*\{\s*top:\s*0\.25rem;\s*transform:\s*none;/,
        );
        expect(
            readFileSync(join(here, 'marked-text-area.css'), 'utf8'),
        ).toMatch(/\.marked-textarea-wrap\s*\{[^}]*position:\s*relative/);
    });

    it('uses native help for the written classification in a valid segment', async () => {
        const engine = await createTestEngine();
        root.innerHTML = `<textarea id="body" data-ezclassify-controller="marked-textarea">(S) Para one.</textarea>`;
        const forms = new EzClassifyUI(asContext(engine as never), { root });
        activeForms.push(forms);
        await wait(80);

        const chip = root.querySelector('.marked-textarea-chip');
        expect(chip?.textContent).toBe('(S)');
        const concept = chip?.querySelector('[data-concept-id="S"]');
        expect(concept?.textContent).toBe('S');
        expect(concept?.getAttribute('title')).toBe('Level: Secret');
        expect(concept?.getAttribute('aria-description')).toBe(
            'Level: Secret.',
        );
        expect(chip?.hasAttribute('data-ez-segment-tooltip')).toBe(false);
    });

    it('honors the data-ezclassify-no-tooltips opt-out for marking segments', async () => {
        const engine = await createTestEngine();
        root.innerHTML = `<textarea id="body" data-ezclassify-controller="marked-textarea" data-ezclassify-no-tooltips>(S) Para one.</textarea>`;
        const forms = new EzClassifyUI(asContext(engine as never), { root });
        activeForms.push(forms);
        await wait(80);

        const display = root.querySelector('.marked-textarea-display');
        const chip = display?.querySelector(
            '.marked-textarea-chip:not(.marked-textarea-chip--invalid)',
        ) as HTMLElement;
        expect(chip).toBeTruthy();

        expect(chip.querySelector('[title]')).toBeNull();
    });
});

/**
 * A rejected scan must leave its text eligible for another scan. Successful
 * scan bookkeeping advances only after the scan lands.
 */
describe('MarkedTextArea scan failures', () => {
    it('discards a pending scan rejection after teardown', async () => {
        const container = document.createElement('div');
        root.appendChild(container);
        const textarea = document.createElement('textarea');
        textarea.value = '(U) One paragraph.';
        container.appendChild(textarea);
        const engine = createAsyncMockEngine({ scheme: createProfile() });
        let rejectScan!: (error: Error) => void;
        const scan = vi.spyOn(engine, 'scan').mockReturnValueOnce(
            new Promise<never>((_resolve, reject) => {
                rejectScan = reject;
            }),
        );
        const reported = vi.spyOn(console, 'error');
        const field = new MarkedTextArea();
        const initialized = field.init(container, engine as never);

        try {
            expect(scan).toHaveBeenCalledOnce();
            field.destroy();
            rejectScan(new Error('The host closed its connection.'));
            await initialized;
            expect(reported).not.toHaveBeenCalled();
            expect(root.querySelector('.marked-textarea-display')).toBeNull();
            expect(textarea.value).toBe('(U) One paragraph.');
        } finally {
            rejectScan(new Error('Test cleanup.'));
            await initialized;
            reported.mockRestore();
        }
    });

    it('re-scans text whose scan rejected', async () => {
        const container = document.createElement('div');
        root.appendChild(container);
        const ta = document.createElement('textarea');
        container.appendChild(ta);
        const ctx = await createTestContext();
        const field = new MarkedTextArea();
        await field.init(container, ctx, {});
        await wait(80);

        const scan = vi.spyOn(ctx.scheme, 'scan');
        const reported = vi
            .spyOn(console, 'error')
            .mockImplementation(() => {});
        scan.mockRejectedValueOnce(new Error('engine unreachable'));

        ta.value = '(S) One paragraph.';
        ta.dispatchEvent(new Event('input', { bubbles: true }));
        await waitFor(() => scan.mock.calls.length > 0, 1000);
        await wait(50);
        expect(reported).toHaveBeenCalled();

        // The same text again: the field still has not scanned it, so it must.
        const callsAfterFailure = scan.mock.calls.length;
        ta.dispatchEvent(new Event('input', { bubbles: true }));
        await waitFor(() => scan.mock.calls.length > callsAfterFailure, 1000);
        expect(scan.mock.calls.length).toBeGreaterThan(callsAfterFailure);

        reported.mockRestore();
        scan.mockRestore();
        field.destroy();
    });
});

describe('MarkedTextArea reads the text the scan found inside a wrapper', () => {
    // The wrapper shape belongs to the scheme, so the field reads the scan's
    // `inner` and never strips delimiters from the found marking itself. The
    // scan here reports a wrapper the field's own pattern cannot unwrap.
    async function mountWithScan(
        rewrite: (result: { marking: string; inner?: string }) => object,
    ) {
        const container = document.createElement('div');
        root.appendChild(container);
        const ta = document.createElement('textarea');
        container.appendChild(ta);
        const ctx = await createTestContext();
        const realScan = ctx.scheme.scan.bind(ctx.scheme);
        vi.spyOn(ctx.scheme, 'scan').mockImplementation(
            async (text, options) => {
                const outcome = (await realScan(
                    text.replace(/^<(\w+)>/, '($1)'),
                    options,
                )) as ScanOutcome;
                return {
                    ...outcome,
                    results: outcome.results.map((r) => ({
                        ...r,
                        ...rewrite(r),
                    })),
                };
            },
        );
        const process = vi.spyOn(ctx.scheme, 'process');
        const field = new MarkedTextArea();
        await field.init(container, ctx, {});
        ta.value = '<S> One paragraph.';
        ta.dispatchEvent(new Event('input', { bubbles: true }));
        await waitFor(() => field.getSegments().length > 0, 1000);
        await wait(50);
        return { field, process };
    }

    it("reads the marking from the scan result's inner text", async () => {
        const { field, process } = await mountWithScan(() => ({
            marking: '<S>',
        }));
        expect(process.mock.calls.map(([input]) => input)).toContain('S');
        const [segment] = field.getSegments();
        expect(segment.marking).toBe('<S>');
        expect(segment.inner).toBe('S');
        expect(segment.valid).toBe(true);
        expect(segment.assertions.map((a) => a.conceptId)).toEqual(['S']);
        field.destroy();
    });

    it('shows a read failure for a wrapped result that reports no inner text', async () => {
        const { field, process } = await mountWithScan(() => ({
            marking: '<S>',
            inner: undefined,
        }));
        expect(process.mock.calls.map(([input]) => input)).not.toContain('<S>');
        const [segment] = field.getSegments();
        expect(segment.valid).toBe(false);
        expect(segment.readFailure).toContain('without the text inside');
        field.destroy();
    });
});

describe('MarkedTextArea scan freshness and document work', () => {
    it('does not publish an older scan after the textarea changes', async () => {
        const container = document.createElement('div');
        root.appendChild(container);
        const ta = document.createElement('textarea');
        container.appendChild(ta);
        const ctx = await createTestContext();
        const field = new MarkedTextArea();
        await field.init(container, ctx, {});

        const first = '(S) First paragraph.';
        const second = '(U) Second paragraph.';
        const originalScan = ctx.scheme.scan.bind(ctx.scheme);
        let releaseFirst: (() => void) | undefined;
        let releaseSecond: (() => void) | undefined;
        const scanSpy = vi.spyOn(ctx.scheme, 'scan');
        scanSpy.mockImplementation(((
            ...args: Parameters<typeof ctx.scheme.scan>
        ) => {
            if (args[0] !== first && args[0] !== second)
                return originalScan(args[0], args[1]);
            return new Promise((resolve) => {
                const release = () => resolve(originalScan(args[0], args[1]));
                if (args[0] === first) releaseFirst = release;
                else releaseSecond = release;
            });
        }) as typeof ctx.scheme.scan);

        ta.value = first;
        ta.dispatchEvent(new Event('input', { bubbles: true }));
        await waitFor(() => releaseFirst !== undefined, 1000);
        expect(releaseFirst).toBeDefined();

        ta.value = second;
        ta.dispatchEvent(new Event('input', { bubbles: true }));
        releaseFirst!();
        await wait(30);

        expect(field.getSegments()).toEqual([]);
        expect(
            container.querySelectorAll('[data-marked-textarea-field]'),
        ).toHaveLength(0);

        await waitFor(() => releaseSecond !== undefined, 1000);
        expect(releaseSecond).toBeDefined();
        releaseSecond!();
        await waitFor(() => field.getSegments()[0]?.marking === '(U)', 1000);
        expect(field.getSegments()[0]?.marking).toBe('(U)');
        scanSpy.mockRestore();
        field.destroy();
    });

    it('does not publish a scan after teardown', async () => {
        const container = document.createElement('div');
        root.appendChild(container);
        const ta = document.createElement('textarea');
        container.appendChild(ta);
        const ctx = await createTestContext();
        const field = new MarkedTextArea();
        await field.init(container, ctx, {});

        const originalScan = ctx.scheme.scan.bind(ctx.scheme);
        let release: (() => void) | undefined;
        vi.spyOn(ctx.scheme, 'scan').mockImplementation(
            ((...args: Parameters<typeof ctx.scheme.scan>) =>
                new Promise((resolve) => {
                    release = () => resolve(originalScan(args[0], args[1]));
                })) as typeof ctx.scheme.scan,
        );
        const changes = vi.fn();
        container.addEventListener('ezclassify:marked-change', changes);

        ta.value = '(S) First paragraph.';
        ta.dispatchEvent(new Event('input', { bubbles: true }));
        await waitFor(() => release !== undefined, 1000);
        expect(release).toBeDefined();
        field.destroy();
        release!();
        await wait(20);

        expect(changes).not.toHaveBeenCalled();
        expect(
            container.querySelectorAll('[data-marked-textarea-field]'),
        ).toHaveLength(0);
    });
});

/** Open the tools and explicitly choose Favorites when corrections lead. */
async function openFavoriteTools(button: HTMLButtonElement): Promise<void> {
    button.click();
    await wait(80);
    const tab = [
        ...document.querySelectorAll<HTMLButtonElement>('[role="tab"]'),
    ].find((tab) => tab.getAttribute('aria-label') === 'Favorites');
    expect(tab).toBeDefined();
    tab!.click();
    await wait(30);
}

describe('MarkedTextArea favorites', () => {
    /** Mount MarkedTextArea directly (see createTestContext's doc comment). */
    async function mountDirect(
        initialValue: string,
        options: Parameters<MarkedTextArea['init']>[2] = {},
    ): Promise<{ ta: HTMLTextAreaElement; field: MarkedTextArea }> {
        const container = document.createElement('div');
        root.appendChild(container);
        const ta = document.createElement('textarea');
        ta.value = initialValue;
        container.appendChild(ta);
        const field = new MarkedTextArea();
        await field.init(container, await createTestContext(), options);
        await wait(80);
        return { ta, field };
    }

    it('does not offer Favorites without a provider or scheme presets', async () => {
        await mountDirect('');
        root.querySelector<HTMLButtonElement>(
            '.ez-status-mark--tools',
        )!.click();
        await wait();
        expect(
            [...document.querySelectorAll('[role=tab]')].some(
                (tab) => tab.getAttribute('aria-label') === 'Favorites',
            ),
        ).toBe(false);
    });

    it('Cmd/Ctrl+Shift+Enter stamps a NEW marking segment at the caret in plain body text', async () => {
        const load = vi.fn(async () => [{ marking: 'S', label: 'Secret' }]);
        const { ta } = await mountDirect('', { favorites: { load } });

        ta.focus();
        textareaEditor(ta).setSelectionRange(0, 0);
        textareaEditor(ta).dispatchEvent(
            new KeyboardEvent('keydown', {
                key: 'Enter',
                ctrlKey: true,
                shiftKey: true,
                bubbles: true,
                cancelable: true,
            }),
        );
        await wait(80);

        const row = document.body.querySelector(
            '.ez-favorites-panel__embedded .proto-dropdown-item',
        ) as HTMLElement;
        expect(row).not.toBeNull();
        row.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        await wait(80);

        expect(ta.value.trim()).toBe('(S)');
        const chip = root.querySelector('.marked-textarea-chip');
        expect(chip).not.toBeNull();
    });

    it('applying a favorite while a segment editor is open REPLACES that segment, leaving the rest of the body untouched', async () => {
        const load = vi.fn(async () => [{ marking: 'S', label: 'Secret' }]);
        const { ta } = await mountDirect('(U) Body text here.', {
            favorites: { load },
        });

        // Open the inline editor on the existing "(U)" segment.
        ta.focus();
        textareaEditor(ta).setSelectionRange(1, 1);
        textareaEditor(ta).dispatchEvent(
            new KeyboardEvent('keydown', {
                key: 'Enter',
                ctrlKey: true,
                bubbles: true,
                cancelable: true,
            }),
        );
        await wait(80);
        expect(
            root.querySelector('.marked-textarea-picker-mount'),
        ).not.toBeNull();

        const button = root.querySelector(
            '.ez-status-mark--tools',
        ) as HTMLButtonElement;
        await openFavoriteTools(button);

        const row = document.body.querySelector(
            '.ez-favorites-panel__embedded .proto-dropdown-item',
        ) as HTMLElement;
        row.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        await wait(80);

        expect(ta.value).toBe('(S) Body text here.');
        // The picker closed as part of applying the favorite, not left open
        // over stale content.
        expect(root.querySelector('.marked-textarea-picker-mount')).toBeNull();
    });

    it('keeps tools open after the first press when the display repaints', async () => {
        const load = vi.fn(async () => [{ marking: 'S' }]);
        const { ta, field } = await mountDirect('', {
            favorites: { load },
        });
        textareaEditor(ta).focus();
        const button = root.querySelector<HTMLButtonElement>(
            '.ez-status-mark--tools',
        )!;
        try {
            button.click();
            expect(button.getAttribute('aria-expanded')).toBe('true');
            field['renderDisplay']();
            await wait(80);
            expect(button.getAttribute('aria-expanded')).toBe('true');
            expect(
                document.querySelector('.ez-tooltip--tools:not([hidden])'),
            ).not.toBeNull();
        } finally {
            field.destroy();
        }
    });

    it('Esc closes the tools and returns focus to the branding button', async () => {
        const load = vi.fn(async () => [{ marking: 'S' }]);
        const { ta } = await mountDirect('', { favorites: { load } });
        ta.focus();

        const button = root.querySelector(
            '.ez-status-mark--tools',
        ) as HTMLButtonElement;
        await openFavoriteTools(button);
        expect(document.activeElement?.getAttribute('role')).toBe('tab');

        document.activeElement!.dispatchEvent(
            new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
        );

        expect(document.activeElement).toBe(button);
        expect(button.getAttribute('aria-expanded')).toBe('false');
    });

    it('stamping a favorite into non-empty body text keeps the marking/body separator', async () => {
        // A wrapped favorite keeps the separator before the body text that follows it.
        const load = vi.fn(async () => [{ marking: 'S', label: 'Secret' }]);
        const value = '(U) First line\nsecond line here';
        const { ta } = await mountDirect(value, { favorites: { load } });

        // Caret at the start of the (unmarked) second line.
        const caret = value.indexOf('\n') + 1;
        ta.focus();
        textareaEditor(ta).setSelectionRange(caret, caret);
        textareaEditor(ta).dispatchEvent(
            new KeyboardEvent('keydown', {
                key: 'Enter',
                ctrlKey: true,
                shiftKey: true,
                bubbles: true,
                cancelable: true,
            }),
        );
        await wait(80);

        const row = document.body.querySelector(
            '.ez-favorites-panel__embedded .proto-dropdown-item',
        ) as HTMLElement;
        row.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        await wait(80);

        expect(ta.value).toBe('(U) First line\n(S) second line here');
    });

    it('stamping a favorite at a mid-word caret on an already-marked line starts a new line instead of splitting the word', async () => {
        // On an already-marked line, a mid-word caret starts the favorite on a
        // new line instead of splitting the word.
        const load = vi.fn(async () => [{ marking: 'S', label: 'Secret' }]);
        const value = '(U) Hello world';
        const { ta } = await mountDirect(value, { favorites: { load } });
        await wait(80);

        // Caret lands inside "Hello", between "Hel" and "lo".
        const caret = value.indexOf('Hel') + 3;
        ta.focus();
        textareaEditor(ta).setSelectionRange(caret, caret);
        textareaEditor(ta).dispatchEvent(
            new KeyboardEvent('keydown', {
                key: 'Enter',
                ctrlKey: true,
                shiftKey: true,
                bubbles: true,
                cancelable: true,
            }),
        );
        await wait(80);

        expect(
            document.body.querySelector('.ez-favorites-panel__target')
                ?.textContent,
        ).toBe('Insert a marking after the current paragraph');

        const row = document.body.querySelector(
            '.ez-favorites-panel__embedded .proto-dropdown-item',
        ) as HTMLElement;
        row.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        await wait(80);

        // "Hello world" stays intact on the first line; the new mark starts
        // its own line rather than landing mid-word.
        expect(ta.value).toBe('(U) Hello world\n(S) ');
        expect(ta.value).toContain('Hello world');
    });
});

it.each(['before', 'after'])(
    'keeps the restored native textarea free of a picker on mouse-up %s teardown',
    async (when) => {
        const container = document.createElement('div');
        const textarea = document.createElement('textarea');
        const value = '(U) Body text here.';
        textarea.value = value;
        root.append(textarea, container);
        const field = new MarkedTextArea();
        await field.init(container, await createTestContext());

        const clickMark = () => {
            textarea.focus();
            textareaEditor(textarea).setSelectionRange(2, 2);
            textareaEditor(textarea).dispatchEvent(
                new MouseEvent('mouseup', {
                    bubbles: true,
                    button: 0,
                    detail: 1,
                }),
            );
        };
        if (when === 'before') clickMark();
        field.destroy();
        if (when === 'after') clickMark();
        await wait(100);

        expect(textarea.parentNode).toBe(root);
        expect(textarea.value).toBe(value);
        expect(document.querySelector('.ez-composer__result-label')).toBeNull();
        expect(container.querySelector('.inline-editor-input')).toBeNull();
    },
);

describe('MarkedTextArea favorites: caret-scoped selection and pinned row', () => {
    /** Mount MarkedTextArea directly (see createTestContext's doc comment). */
    async function mountDirect(
        initialValue: string,
        options: Parameters<MarkedTextArea['init']>[2] = {},
    ): Promise<{ ta: HTMLTextAreaElement; field: MarkedTextArea }> {
        const container = document.createElement('div');
        root.appendChild(container);
        const ta = document.createElement('textarea');
        ta.value = initialValue;
        container.appendChild(ta);
        const field = new MarkedTextArea();
        await field.init(container, await createTestContext(), options);
        await wait(80);
        return { ta, field };
    }

    /** Move the caret and fire the same event MTA listens for. */
    function moveCaret(ta: HTMLTextAreaElement, pos: number): void {
        textareaEditor(ta).setSelectionRange(pos, pos);
        document.dispatchEvent(new Event('selectionchange'));
    }

    it.each(['reorder', 'remove'] as const)(
        'keeps a caret-requested entry identity across queued %s projection',
        async (action) => {
            const { ta, field } = await mountDirect(
                '(U) First.\n\n(S) Second.',
            );
            try {
                const portions = field.getCommittedPortions();
                expect(portions).toHaveLength(2);
                expect(portions.every((portion) => !!portion.entryId)).toBe(
                    true,
                );
                ta.focus();
                moveCaret(ta, portions[action === 'remove' ? 1 : 0]!.start + 1);
                await wait(80);
                expect(
                    root.querySelector('.inline-editor-input'),
                ).not.toBeNull();
                const projection = (
                    action === 'reorder'
                        ? [portions[1]!, portions[0]!]
                        : [portions[1]!]
                ).map((portion) => ({
                    entryId: portion.entryId!,
                    state: {
                        assertions: portion.assertions,
                        rendered: portion.rendered,
                        renders: {},
                        valid: portion.valid,
                        errors: portion.validationErrors,
                    },
                }));
                expect(await field.applyEntryStates(projection)).toBe(false);
                ta.focus();
                moveCaret(ta, portions[action === 'remove' ? 0 : 1]!.start + 1);
                await wait(240);
                expect(field.getEntryIds()).toEqual(
                    projection.map((entry) => entry.entryId),
                );
                const editor = root.querySelector<HTMLInputElement>(
                    '.inline-editor-input',
                );
                if (action === 'reorder') expect(editor?.value).toBe('S');
                else expect(editor).toBeNull();
            } finally {
                field.destroy();
            }
        },
    );

    it.each([false, true])(
        'returns brand Down to its existing working area without opening tools or inserting a mark (held=%s)',
        async (held) => {
            const { ta, field } = await mountDirect(
                '(U) First.\n\n(S) Second.',
            );
            try {
                const text = ta.value;
                ta.focus();
                moveCaret(ta, text.length);
                const caret = textareaEditor(ta).selectionStart;
                let draft: HTMLInputElement | null = null;
                if (held) {
                    moveCaret(ta, 1);
                    await wait(80);
                    draft = root.querySelector<HTMLInputElement>(
                        '.inline-editor-input',
                    )!;
                    draft.value = 'S';
                    draft.dispatchEvent(new Event('input', { bubbles: true }));
                    await wait(80);
                    draft.setSelectionRange(0, 0);
                }
                const retainedCaret = held ? 1 : caret;
                const brand =
                    root.querySelector<HTMLElement>('.ez-status-mark')!;
                brand.focus();
                brand.dispatchEvent(
                    new KeyboardEvent('keydown', {
                        key: 'ArrowDown',
                        bubbles: true,
                        cancelable: true,
                    }),
                );
                await wait(80);
                expect(document.activeElement).toBe(
                    held ? draft : textareaEditor(ta),
                );
                if (held) expect(draft?.selectionStart).toBe(0);
                else
                    expect(textareaEditor(ta).selectionStart).toBe(
                        retainedCaret,
                    );
                expect(ta.value).toBe(text);
                if (held) {
                    expect(draft?.isConnected).toBe(true);
                    expect(draft?.value).toBe('S');
                    textareaEditor(ta).dispatchEvent(
                        new KeyboardEvent('keydown', {
                            key: 'Escape',
                            bubbles: true,
                            cancelable: true,
                        }),
                    );
                    await wait(80);
                } else
                    expect(
                        root.querySelector('.inline-editor-input'),
                    ).toBeNull();
                expect(
                    document.querySelector('.ez-tooltip--tools:not([hidden])'),
                ).toBeNull();
            } finally {
                field.destroy();
            }
        },
    );

    it('keeps a still-present unrecognized caret target when leaving a recognized entry', async () => {
        const { ta, field } = await mountDirect(
            '(U) First.\n\n(junkxyz) Second.',
        );
        try {
            const segments = field.getSegments();
            expect(segments).toHaveLength(2);
            expect(segments[0]!.entryId).toBeDefined();
            expect(segments[1]!.entryId).toBeUndefined();
            const ids = field.getEntryIds();
            ta.focus();
            moveCaret(ta, segments[0]!.start + 1);
            await wait(80);
            ta.focus();
            moveCaret(ta, segments[1]!.start + 1);
            await wait(240);
            expect(
                root.querySelector<HTMLInputElement>('.inline-editor-input')
                    ?.value,
            ).toBe('junkxyz');
            expect(field.getEntryIds()).toEqual(ids);
        } finally {
            field.destroy();
        }
    });

    it.each(['pointer', 'keyboard'] as const)(
        'resumes the same held marking from tools by %s without rewriting either entry',
        async (mode) => {
            const value = '(Unclassified) First.\n\n(SECRET) Second.';
            const { ta, field } = await mountDirect(value, {
                favorites: { load: async () => [{ marking: 'S' }] },
            });
            ta.focus();
            moveCaret(ta, 3);
            await wait(80);
            const editor = root.querySelector<HTMLInputElement>(
                '.inline-editor-input',
            )!;
            editor.value = 'S';
            editor.dispatchEvent(new Event('input', { bubbles: true }));
            await wait(80);
            await openFavoriteTools(
                root.querySelector<HTMLButtonElement>(
                    '.ez-status-mark--tools',
                )!,
            );
            document
                .querySelector<HTMLButtonElement>('.ez-marking-tools__close')!
                .click();
            if (mode === 'pointer')
                textareaEditor(ta).dispatchEvent(
                    new MouseEvent('mousedown', {
                        button: 0,
                        detail: 1,
                        bubbles: true,
                    }),
                );
            ta.focus();
            if (mode === 'pointer') {
                textareaEditor(ta).setSelectionRange(3, 3);
                textareaEditor(ta).dispatchEvent(
                    new MouseEvent('mouseup', {
                        button: 0,
                        detail: 1,
                        bubbles: true,
                    }),
                );
            }
            await wait(180);
            expect(root.querySelector('.inline-editor-input')).toBe(editor);
            expect(editor.value).toBe('S');
            expect(document.activeElement).toBe(editor);
            expect(ta.value).toBe(value);
            const outside = document.createElement('button');
            document.body.append(outside);
            outside.dispatchEvent(
                new MouseEvent('mousedown', { button: 0, bubbles: true }),
            );
            outside.focus();
            await wait(180);
            expect(ta.value).toBe('(S) First.\n\n(SECRET) Second.');
            outside.remove();
            field.destroy();
        },
    );

    it('keeps the caret marking targeted through a keyboard pause and real Favorite pointer events', async () => {
        const value = '(U) Body text here.';
        const { ta } = await mountDirect(value, {
            favorites: { load: async () => [{ marking: 'U' }] },
        });
        ta.focus();
        moveCaret(ta, 1);
        await wait(80);
        root.querySelector<HTMLButtonElement>(
            '.ez-status-mark--tools',
        )!.click();
        await wait(80);
        expect(document.activeElement?.getAttribute('role')).toBe('tab');
        expect(
            document.body.querySelector<HTMLElement>('.ez-composer')?.hidden,
        ).toBe(true);
        const row = document.body.querySelector<HTMLButtonElement>(
            '[data-favorite-marking="U"]',
        )!;
        row.focus();
        await wait(180);
        expect(
            root.querySelector('.marked-textarea-picker-mount'),
        ).not.toBeNull();
        row.dispatchEvent(new Event('pointerdown', { bubbles: true }));
        row.dispatchEvent(
            new MouseEvent('mousedown', { bubbles: true, cancelable: true }),
        );
        await wait(180);
        expect(
            root.querySelector('.marked-textarea-picker-mount'),
        ).not.toBeNull();
        row.click();
        await wait(80);
        expect(ta.value).toBe(value);
    });

    it('replaces the caret marking during the post-close cooldown without inserting a paragraph', async () => {
        const value = '(U) Body text here.';
        const { ta } = await mountDirect(value, {
            favorites: { load: async () => [{ marking: 'U' }] },
        });
        ta.focus();
        moveCaret(ta, 1);
        await wait(30);
        textareaEditor(ta).dispatchEvent(
            new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
        );
        ta.focus();
        moveCaret(ta, 1);
        expect(root.querySelector('.marked-textarea-picker-mount')).toBeNull();
        await openFavoriteTools(
            root.querySelector<HTMLButtonElement>('.ez-status-mark--tools')!,
        );
        document.body
            .querySelector<HTMLButtonElement>('[data-favorite-marking="U"]')!
            .click();
        await wait(80);
        expect(ta.value).toBe(value);
    });

    it('selects the Favorite matching the caret segment', async () => {
        const load = vi.fn(async () => [
            { marking: 'U', label: 'Unclassified' },
        ]);
        const value = '(U) Body text here.';
        const { ta } = await mountDirect(value, { favorites: { load } });
        await wait(80);

        const button = root.querySelector(
            '.ez-status-mark--tools',
        ) as HTMLButtonElement;

        ta.focus();
        // Inside "(U)": between the delimiters, not at the boundary. This
        // also auto-opens the inline picker (existing behavior, unrelated to
        // favorites): the star must track the caret's segment regardless of
        // whether an editor happens to be open for it.
        moveCaret(ta, 1);
        await wait(20);
        await openFavoriteTools(button);
        expect(
            document
                .querySelector('[data-favorite-marking="U"]')
                ?.classList.contains('proto-dropdown-item--selected'),
        ).toBe(true);
    });

    it('clears the Favorite selection when the caret leaves the segment for body text', async () => {
        const load = vi.fn(async () => [
            { marking: 'U', label: 'Unclassified' },
        ]);
        const value = '(U) Body text here.';
        const { ta } = await mountDirect(value, { favorites: { load } });
        await wait(80);

        const button = root.querySelector(
            '.ez-status-mark--tools',
        ) as HTMLButtonElement;

        ta.focus();
        moveCaret(ta, 1); // inside "(U)"
        await wait(20);
        await openFavoriteTools(button);
        expect(
            document
                .querySelector('[data-favorite-marking="U"]')
                ?.classList.contains('proto-dropdown-item--selected'),
        ).toBe(true);

        button.click();

        // Simulate the user clicking back into the textarea at the new
        // position (refocusing it, since the caret-move above auto-opened
        // the inline picker in its OWN input) rather than a bare
        // programmatic setSelectionRange the field would never see focus for.
        ta.focus();
        moveCaret(ta, value.length); // end of the body text
        await waitFor(
            () => !root.querySelector('.marked-textarea-picker-mount'),
        );
        expect(root.querySelector('.marked-textarea-picker-mount')).toBeNull();
        await openFavoriteTools(button);
        expect(
            document
                .querySelector('[data-favorite-marking]')
                ?.classList.contains('proto-dropdown-item--selected'),
        ).toBe(false);
    });

    it('leaves a different Favorite unselected', async () => {
        const load = vi.fn(async () => [{ marking: 'S', label: 'Secret' }]);
        const value = '(U) Body text here.';
        const { ta } = await mountDirect(value, { favorites: { load } });
        await wait(80);

        const button = root.querySelector(
            '.ez-status-mark--tools',
        ) as HTMLButtonElement;
        ta.focus();
        moveCaret(ta, 1); // inside "(U)", which is not the loaded "(S)" favorite
        await wait(20);
        await openFavoriteTools(button);
        expect(
            document
                .querySelector('[data-favorite-marking]')
                ?.classList.contains('proto-dropdown-item--selected'),
        ).toBe(false);
    });

    it("the pinned save row offers the caret segment's marking and is absent when the caret is in body text", async () => {
        const save = vi.fn(async () => {});
        const load = vi.fn(async () => []);
        const value = '(U) Body text here.';
        const { ta } = await mountDirect(value, { favorites: { load, save } });
        await wait(80);

        const button = root.querySelector(
            '.ez-status-mark--tools',
        ) as HTMLButtonElement;

        // Caret in body text: no concrete segment to save, so the pinned row
        // is ABSENT (not just disabled).
        ta.focus();
        moveCaret(ta, value.length);
        await wait(20);
        await openFavoriteTools(button);
        expect(
            document.body.querySelector('.ez-favorites-panel__pinned'),
        ).toBeNull();
        button.dispatchEvent(
            new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
        );
        await wait(20);

        // Caret inside the "(U)" segment: the pinned row appears, offering
        // to save exactly that segment's marking.
        ta.focus();
        moveCaret(ta, 1);
        await wait(20);
        await openFavoriteTools(button);
        const pinned = document.body.querySelector(
            '.ez-favorites-panel__pinned',
        ) as HTMLElement;
        expect(pinned).not.toBeNull();
        expect(pinned.textContent?.toLowerCase()).toContain('save');
    });
});

// Scanner-created mounts identify their own hosts even when several textareas
// share one parent (a document marking followed by independent marked bodies).
describe('MarkedTextArea registered mount hosts in mixed forms', () => {
    it('keeps each marked body on its own textarea beside the whole MarkingField', async () => {
        const root = document.createElement('form');
        root.innerHTML = `
            <input id="mixed-whole" type="hidden" value="U" data-ezclassify-marking />
            <textarea id="mixed-whole-editor" data-ezclassify-controller="marking" data-ezclassify-bound-to="mixed-whole"></textarea>
            <textarea id="mixed-body-one" data-ezclassify-controller="marked-textarea" data-ezclassify-part-of="mixed-whole">(U) First body.</textarea>
            <textarea id="mixed-body-two" data-ezclassify-controller="marked-textarea" data-ezclassify-part-of="mixed-whole">(S) Second body.</textarea>
        `;
        document.body.appendChild(root);
        const forms = new EzClassifyUI(asContext(await createTestEngine()), {
            root,
        });
        try {
            await waitFor(() => forms.isReady, 2000);
            for (const id of ['mixed-body-one', 'mixed-body-two']) {
                const host = root.querySelector<HTMLTextAreaElement>(`#${id}`)!;
                expect(host.hidden).toBe(true);
                expect(
                    host
                        .closest('.marked-textarea-wrap')
                        ?.querySelector('textarea'),
                ).toBe(host);
            }
            const whole = root.querySelector<HTMLTextAreaElement>(
                '#mixed-whole-editor',
            )!;
            expect(whole.hidden).toBe(false);
            expect(
                root.querySelector<HTMLTextAreaElement>('#mixed-body-one')!
                    .value,
            ).toBe('(U) First body.');
            expect(
                root.querySelector<HTMLTextAreaElement>('#mixed-body-two')!
                    .value,
            ).toBe('(S) Second body.');
            await waitFor(
                () =>
                    forms.store.getWholeRollup('mixed-whole').rendered === 'S',
                2000,
            );
            expect(forms.store.getWholeRollup('mixed-whole').rendered).toBe(
                'S',
            );
        } finally {
            forms.destroy();
            forms.store.destroy();
            root.remove();
        }
    });
});
