/**
 * Two behaviors of marked fields in a marking-dense document with a marked host
 * added after the initial synchronous scan:
 *
 * Late hosts enhance once. Enhancing a keep-visible controller moves its native
 * node into a wrapper; element-scanner must not read that relocation as a
 * teardown-plus-re-add, or the MutationObserver loops destroy → re-enhance →
 * re-move forever. A still-connected relocated node is not a removal.
 *
 * Typing keeps every keystroke. The segment offsets that drive the caret-based
 * auto-open come from a DEBOUNCED scan, so mid-typing they lag the live text;
 * the inline marking editor auto-opens only when the segment offsets match the
 * live value, so it never opens over text still being typed. The single-line
 * marked-input (whose mark position updates synchronously) stays covered here
 * as a control.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { RemoteContextSchemeEngineAdapter } from '@ezclassify/types';
import { EzClassifyUI } from './ezclassify-ui';
import { MarkedTextArea } from './components/marked-text-area';
import { MarkedInput } from './components/marked-input';
import { asContext } from '../test-fixtures/as-context';
import { levelState } from './store/page-rollup-harness';
import { connectDemoContext } from '../../../test-support/demo-runtime';

function wait(ms = 30): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
}

/**
 * A Context whose scheme has an embedded-marking pattern, so marked fields can
 * scan segments.
 */
async function createMarkedContext() {
    return await connectDemoContext({
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
                        { pattern: '\\(([^)]+)\\)', template: '({marking}) ' },
                    ],
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
        },
    });
}

/** The scheme operations of {@link createMarkedContext}. */
async function createMarkedEngine(): Promise<RemoteContextSchemeEngineAdapter> {
    return (await createMarkedContext())
        .scheme as RemoteContextSchemeEngineAdapter;
}

let root: HTMLDivElement;
const activeForms: EzClassifyUI[] = [];

beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    // jsdom lacks scrollIntoView; the inline editor's dropdown code calls it.
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

describe('marked host added after mount enhances once, no observer loop', () => {
    it('enhances a marked-input added after mount exactly once', async () => {
        const engine = await createMarkedEngine();
        const forms = new EzClassifyUI(asContext(engine as never), { root });
        activeForms.push(forms);
        await wait(60);

        const destroySpy = vi.spyOn(MarkedInput.prototype, 'destroy');

        const input = document.createElement('input');
        input.type = 'text';
        input.id = 'late-input';
        input.setAttribute('data-ezclassify-controller', 'marked-input');
        root.appendChild(input);

        // A bounded settle window. An observer loop would never let it
        // complete; it is ample for the single enhancement's async init.
        await wait(300);

        // Enhanced exactly once: one wrapper, one component, host still connected.
        const wraps = root.querySelectorAll('.marked-input-wrap');
        expect(wraps).toHaveLength(1);
        expect(forms.components.get(input)).toBeInstanceOf(MarkedInput);
        expect(root.contains(input)).toBe(true);
        // No false teardown: the relocation was never read as a removal.
        expect(destroySpy).not.toHaveBeenCalled();
    });

    it('enhances a marked-textarea added after mount exactly once', async () => {
        const engine = await createMarkedEngine();
        const forms = new EzClassifyUI(asContext(engine as never), { root });
        activeForms.push(forms);
        await wait(60);

        const destroySpy = vi.spyOn(MarkedTextArea.prototype, 'destroy');

        const ta = document.createElement('textarea');
        ta.id = 'late-ta';
        ta.setAttribute('data-ezclassify-controller', 'marked-textarea');
        root.appendChild(ta);

        await wait(300);

        const wraps = root.querySelectorAll('.marked-textarea-wrap');
        expect(wraps).toHaveLength(1);
        expect(forms.components.get(ta)).toBeInstanceOf(MarkedTextArea);
        expect(root.contains(ta)).toBe(true);
        expect(destroySpy).not.toHaveBeenCalled();
    });
});

describe('marked-textarea keeps every keystroke, popup does not steal', () => {
    /** Type one char at the caret and mirror a browser's selectionchange. */
    async function typeChar(
        ta: HTMLTextAreaElement,
        ch: string,
    ): Promise<void> {
        const pos = ta.selectionStart ?? ta.value.length;
        ta.value = ta.value.slice(0, pos) + ch + ta.value.slice(pos);
        ta.setSelectionRange(pos + 1, pos + 1);
        ta.dispatchEvent(new Event('input', { bubbles: true }));
        document.dispatchEvent(new Event('selectionchange'));
        await wait(30);
    }

    it('typing ahead of a marking does not pop the inline editor mid-keystroke', async () => {
        const engine = await createMarkedEngine();
        root.innerHTML = `<textarea id="body" data-ezclassify-controller="marked-textarea">(S) hello</textarea>`;
        const forms = new EzClassifyUI(asContext(engine as never), { root });
        activeForms.push(forms);
        // Let the initial scan settle so the "(S)" segment exists.
        await wait(400);

        const ta = document.getElementById('body') as HTMLTextAreaElement;
        const comp = forms.components.get(ta) as MarkedTextArea;
        expect(comp).toBeInstanceOf(MarkedTextArea);
        expect(comp.getSegments()).toHaveLength(1);

        ta.focus();
        ta.dispatchEvent(new Event('focus'));

        // Caret to the very start (just before the marking), then type plain text.
        // The scan is debounced, so segment offsets stay stale as the text shifts
        // right; the editor must NOT auto-open against those stale offsets.
        ta.setSelectionRange(0, 0);
        document.dispatchEvent(new Event('selectionchange'));
        await wait(20);

        for (const ch of 'Xyz') {
            await typeChar(ta, ch);
            // The inline editor must never appear while typing is in flight.
            expect(root.querySelector('.inline-editor-input')).toBeNull();
        }

        await wait(400);
        // Every keystroke landed; nothing was stolen.
        expect(ta.value).toBe('Xyz(S) hello');
        expect(root.querySelector('.inline-editor-input')).toBeNull();
    });

    it('deliberate caret placement inside a settled marking still opens the editor', async () => {
        // The fix must not disable the marking-suggestion popup; a genuine caret
        // move into a marking (segments fresh) still opens it.
        const engine = await createMarkedEngine();
        root.innerHTML = `<textarea id="body" data-ezclassify-controller="marked-textarea">(S) hello</textarea>`;
        const forms = new EzClassifyUI(asContext(engine as never), { root });
        activeForms.push(forms);
        await wait(400);

        const ta = document.getElementById('body') as HTMLTextAreaElement;
        ta.focus();
        ta.dispatchEvent(new Event('focus'));

        // No pending edit: segments match the live value, caret moves inside "(S)".
        ta.setSelectionRange(1, 1);
        document.dispatchEvent(new Event('selectionchange'));
        await wait(60);

        expect(root.querySelector('.inline-editor-input')).not.toBeNull();
    });
});

describe('MarkedInput: a long value wraps instead of scrolling', () => {
    it('the host and display share identical wrap CSS and never mirror scrollLeft', async () => {
        // The host is a wrapping, auto-growing <textarea> (see the class doc
        // comment): a long value wraps onto more lines and the field grows
        // taller, so there is no horizontal scroll to mirror. jsdom
        // has no layout engine (documented throughout this suite and
        // marking-field.spec.ts), so this can't measure real wrapped line
        // counts; it proves the two layers are STILL configured to wrap
        // identically (same technique MarkingField's paint uses) by reading
        // the source CSS, and that scrollLeft is never written.
        const engine = await createMarkedEngine();
        root.innerHTML = `<input type="text" id="mi" data-ezclassify-controller="marked-input" value="(U) a very long title that overflows the field width">`;
        const forms = new EzClassifyUI(asContext(engine as never), { root });
        activeForms.push(forms);
        await wait(80);

        const input = root.querySelector<HTMLTextAreaElement>(
            '#mi + textarea, #mi ~ .marked-input-native',
        )!;
        const display = root.querySelector(
            '.marked-input-display',
        ) as HTMLDivElement;

        // A render (the initial mount above already ran one) never touches
        // scrollLeft on either layer: there is nothing to sync.
        expect(display.scrollLeft).toBe(0);
        expect(input.scrollLeft).toBe(0);

        const here = dirname(fileURLToPath(import.meta.url));
        const css = readFileSync(
            join(here, 'components', 'marked-input.css'),
            'utf8',
        );
        expect(css).toMatch(
            /textarea\.marked-input-native\s*\{[^}]*white-space:\s*pre-wrap/,
        );
        expect(css).toMatch(
            /textarea\.marked-input-native\s*\{[^}]*overflow-wrap:\s*break-word/,
        );
        expect(css).toMatch(
            /\.marked-input-display\s*\{[^}]*white-space:\s*pre-wrap/,
        );
        expect(css).toMatch(
            /\.marked-input-display\s*\{[^}]*overflow-wrap:\s*break-word/,
        );
    });
});

describe('MarkedInput: corrupted mark surfaces as invalid, never a silent downgrade', () => {
    it('flags a mark with an unrecognized token and keeps the prior published state', async () => {
        const engine = await createMarkedEngine();
        root.innerHTML = `<input type="text" id="mi" data-ezclassify-controller="marked-input" value="(S) classified title">`;
        const forms = new EzClassifyUI(asContext(engine as never), { root });
        activeForms.push(forms);
        await wait(80);

        expect(
            levelState(forms.store).assertions.some((a) => a.conceptId === 'S'),
        ).toBe(true);

        // A keystroke lands inside the token: "(Sx)". The engine parses this
        // to zero assertions WITHOUT reporting an error.
        const input = root.querySelector<HTMLTextAreaElement>(
            '#mi + textarea, #mi ~ .marked-input-native',
        )!;
        input.value = '(Sx) classified title';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        await wait(80);

        // Invalid affordance is rendered ...
        const chip = root.querySelector('.marked-input-chip');
        expect(chip?.classList.contains('marked-input-chip--invalid')).toBe(
            true,
        );
        // ... its title carries the engine's message naming the unread text ...
        expect(chip?.getAttribute('title')).toMatch(/"sx"/i);
        // ... and the published state did NOT silently downgrade.
        expect(
            levelState(forms.store).assertions.some((a) => a.conceptId === 'S'),
        ).toBe(true);
    });

    it('a valid mark renders without the invalid class', async () => {
        const engine = await createMarkedEngine();
        root.innerHTML = `<input type="text" id="mi" data-ezclassify-controller="marked-input" value="(U) memo">`;
        const forms = new EzClassifyUI(asContext(engine as never), { root });
        activeForms.push(forms);
        await wait(80);

        const chip = root.querySelector('.marked-input-chip');
        expect(chip).toBeTruthy();
        expect(chip?.classList.contains('marked-input-chip--invalid')).toBe(
            false,
        );
    });
});

describe('MarkedInput: text selection survives and is visible', () => {
    it('select-all is not collapsed and does not force-open the picker', async () => {
        const engine = await createMarkedEngine();
        root.innerHTML = `<input type="text" id="mi" data-ezclassify-controller="marked-input" value="(U) hello world">`;
        const forms = new EzClassifyUI(asContext(engine as never), { root });
        activeForms.push(forms);
        await wait(80);

        const input = root.querySelector<HTMLTextAreaElement>(
            '#mi + textarea, #mi ~ .marked-input-native',
        )!;
        input.focus();
        input.setSelectionRange(0, input.value.length);
        document.dispatchEvent(new Event('selectionchange'));
        await wait(60);

        // Selection survives: not collapsed to after the mark.
        expect(input.selectionStart).toBe(0);
        expect(input.selectionEnd).toBe(input.value.length);
        // No picker mounted.
        const mountContainer = document.querySelector(
            '[data-ezclassify-mount="marked-input"]',
        ) as HTMLElement;
        expect(
            mountContainer?.classList.contains('marked-input-picker-active'),
        ).toBe(false);
        // The display renders visible selection highlight spans.
        expect(
            root.querySelectorAll('.marked-input-selection').length,
        ).toBeGreaterThan(0);
    });

    it('a collapsed caret inside the chip still opens the picker', async () => {
        const engine = await createMarkedEngine();
        root.innerHTML = `<input type="text" id="mi" data-ezclassify-controller="marked-input" value="(U) hello">`;
        const forms = new EzClassifyUI(asContext(engine as never), { root });
        activeForms.push(forms);
        await wait(80);

        const input = root.querySelector<HTMLTextAreaElement>(
            '#mi + textarea, #mi ~ .marked-input-native',
        )!;
        input.focus();
        input.setSelectionRange(1, 1);
        document.dispatchEvent(new Event('selectionchange'));
        await wait(80);

        const mountContainer = document.querySelector(
            '[data-ezclassify-mount="marked-input"]',
        ) as HTMLElement;
        expect(
            mountContainer?.classList.contains('marked-input-picker-active'),
        ).toBe(true);
    });
});

describe('MarkedInput: printable keystroke inside the mark routes to the picker', () => {
    it('prevents the raw edit and opens the picker instead', async () => {
        const engine = await createMarkedEngine();
        root.innerHTML = `<input type="text" id="mi" data-ezclassify-controller="marked-input" value="(S) title">`;
        const forms = new EzClassifyUI(asContext(engine as never), { root });
        activeForms.push(forms);
        await wait(80);

        const input = root.querySelector<HTMLTextAreaElement>(
            '#mi + textarea, #mi ~ .marked-input-native',
        )!;
        input.focus();
        input.setSelectionRange(2, 2);

        const ev = new KeyboardEvent('keydown', {
            key: 'x',
            bubbles: true,
            cancelable: true,
        });
        input.dispatchEvent(ev);
        await wait(80);

        expect(ev.defaultPrevented).toBe(true);
        expect(input.value).toBe('(S) title');
        const mountContainer = document.querySelector(
            '[data-ezclassify-mount="marked-input"]',
        ) as HTMLElement;
        expect(
            mountContainer?.classList.contains('marked-input-picker-active'),
        ).toBe(true);
    });
});

describe('MarkedTextArea: add-marking always yields a recognized segment', () => {
    it('inserts the template at the start of the current line, not mid-line', async () => {
        const engine = await createMarkedEngine();
        root.innerHTML = `<textarea id="body" data-ezclassify-controller="marked-textarea">Report body paragraph.</textarea>`;
        const forms = new EzClassifyUI(asContext(engine as never), { root });
        activeForms.push(forms);
        await wait(200);

        const ta = document.getElementById('body') as HTMLTextAreaElement;
        const comp = forms.components.get(ta) as MarkedTextArea;

        // Touch "+ Add marking": caret goes to the END of the unterminated
        // line; the template must still land at the line START, where a part
        // mark leads the paragraph it marks.
        const touchAdd = root.querySelector(
            '.marked-textarea-touch-add',
        ) as HTMLButtonElement;
        touchAdd.click();
        await wait(120);

        expect(ta.value.startsWith('(')).toBe(true);

        // Pick a concept in the inline editor, then close it.
        const editorInput = document.querySelector(
            '.inline-editor-input',
        ) as HTMLTextAreaElement;
        expect(editorInput).toBeTruthy();
        editorInput.value = 'U';
        editorInput.dispatchEvent(new Event('input'));
        await wait(80);
        // Exit right (a COMMIT path; Escape now cancels the edit).
        editorInput.setSelectionRange(
            editorInput.value.length,
            editorInput.value.length,
        );
        editorInput.dispatchEvent(
            new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }),
        );
        await wait(400);

        // Exactly one recognized segment carrying the picked concept.
        const segments = comp.getSegments();
        expect(segments).toHaveLength(1);
        expect(segments[0].start).toBe(0);
        expect(segments[0].assertions.some((a) => a.conceptId === 'U')).toBe(
            true,
        );
        expect(ta.value).toContain('Report body paragraph.');
    });
});

describe('Escape cancels the marking picker instead of committing junk', () => {
    it('MarkedTextArea: junk typed in the picker is discarded on Escape', async () => {
        const engine = await createMarkedEngine();
        root.innerHTML = `<textarea id="esc-ta" data-ezclassify-controller="marked-textarea"></textarea>`;
        const forms = new EzClassifyUI(asContext(engine as never), { root });
        activeForms.push(forms);
        await wait(200);

        const ta = document.getElementById('esc-ta') as HTMLTextAreaElement;

        // Open the picker via Ctrl+Enter (inserts the "()" template).
        ta.focus();
        ta.setSelectionRange(0, 0);
        ta.dispatchEvent(
            new KeyboardEvent('keydown', {
                key: 'Enter',
                ctrlKey: true,
                bubbles: true,
                cancelable: true,
            }),
        );
        await wait(120);

        const editorInput = document.querySelector(
            '.inline-editor-input',
        ) as HTMLTextAreaElement;
        expect(editorInput).toBeTruthy();
        editorInput.value = 'junkxyz';
        editorInput.dispatchEvent(new Event('input'));
        await wait(80);

        ta.dispatchEvent(
            new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
        );
        await wait(400);

        // Escape cancels: the field is back to its pre-open value; no
        // "(junkxyz)" persisted as text that reads like a marking.
        expect(ta.value).toBe('');
        const comp = forms.components.get(ta) as MarkedTextArea;
        expect(comp.getSegments()).toHaveLength(0);
    });

    it('MarkedTextArea: Escape on an edited existing marking restores the original', async () => {
        const engine = await createMarkedEngine();
        root.innerHTML = `<textarea id="esc-ta2" data-ezclassify-controller="marked-textarea">(U) body text.</textarea>`;
        const forms = new EzClassifyUI(asContext(engine as never), { root });
        activeForms.push(forms);
        await wait(200);

        const ta = document.getElementById('esc-ta2') as HTMLTextAreaElement;

        // Open the picker on the existing marking.
        ta.focus();
        ta.setSelectionRange(1, 1);
        ta.dispatchEvent(
            new KeyboardEvent('keydown', {
                key: 'Enter',
                ctrlKey: true,
                bubbles: true,
                cancelable: true,
            }),
        );
        await wait(120);

        const editorInput = document.querySelector(
            '.inline-editor-input',
        ) as HTMLTextAreaElement;
        expect(editorInput).toBeTruthy();

        // Accept "S" via the dropdown (a real committed edit inside the
        // editor), THEN Escape: the pre-open marking must come back.
        editorInput.value = 'S';
        editorInput.dispatchEvent(new Event('input'));
        await wait(80);
        editorInput.dispatchEvent(
            new KeyboardEvent('keydown', { key: 'Tab', cancelable: true }),
        );
        await wait(200);

        ta.dispatchEvent(
            new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
        );
        await wait(400);

        expect(ta.value).toBe('(U) body text.');
        const comp = forms.components.get(ta) as MarkedTextArea;
        const segments = comp.getSegments();
        expect(segments).toHaveLength(1);
        expect(segments[0].assertions.some((a) => a.conceptId === 'U')).toBe(
            true,
        );
    });

    it('MarkedInput: Escape restores the pre-open value', async () => {
        const engine = await createMarkedEngine();
        root.innerHTML = `<input type="text" id="esc-mi" data-ezclassify-controller="marked-input" value="(U) report title">`;
        const forms = new EzClassifyUI(asContext(engine as never), { root });
        activeForms.push(forms);
        await wait(200);

        const input = root.querySelector<HTMLTextAreaElement>(
            '#esc-mi + textarea, #esc-mi ~ .marked-input-native',
        )!;

        input.focus();
        input.setSelectionRange(input.value.length, input.value.length);
        input.dispatchEvent(
            new KeyboardEvent('keydown', {
                key: 'Enter',
                ctrlKey: true,
                bubbles: true,
                cancelable: true,
            }),
        );
        await wait(120);

        const editorInput = document.querySelector(
            '.inline-editor-input',
        ) as HTMLTextAreaElement;
        expect(editorInput).toBeTruthy();

        // Replace the marking with S via the editor, then cancel with Escape.
        editorInput.value = 'S';
        editorInput.dispatchEvent(new Event('input'));
        await wait(80);
        editorInput.dispatchEvent(
            new KeyboardEvent('keydown', { key: 'Tab', cancelable: true }),
        );
        await wait(200);

        input.dispatchEvent(
            new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
        );
        await wait(300);

        expect(input.value).toBe('(U) report title');
    });
});

describe('Unrecognized wrapped text is flagged, never silently unmarked', () => {
    it('MarkedTextArea: line-leading junk parens get the invalid-chip treatment', async () => {
        const engine = await createMarkedEngine();
        root.innerHTML = `<textarea id="junk-ta" data-ezclassify-controller="marked-textarea"></textarea>`;
        const forms = new EzClassifyUI(asContext(engine as never), { root });
        activeForms.push(forms);
        await wait(200);

        const ta = document.getElementById('junk-ta') as HTMLTextAreaElement;
        const comp = forms.components.get(ta) as MarkedTextArea;

        // Junk that matches the wrapper pattern but parses to nothing: the
        // engine scan drops it entirely, and it must not render as ordinary
        // unmarked prose while READING like a marking.
        ta.value = '(junkxyz) sensitive-looking paragraph.';
        ta.dispatchEvent(new Event('input', { bubbles: true }));
        await wait(500);

        const segments = comp.getSegments();
        expect(segments).toHaveLength(1);
        expect(segments[0].valid).toBe(false);
        expect(segments[0].marking).toBe('(junkxyz)');
        expect(segments[0].errors[0]).toContain('Unrecognized marking');

        // The display gives it the invalid-chip treatment.
        const invalidChip = root.querySelector(
            '.marked-textarea-chip--invalid',
        );
        expect(invalidChip).toBeTruthy();
        expect(invalidChip!.textContent).toBe('(junkxyz)');

        // No hidden part field is registered for the junk span.
        expect(
            root.ownerDocument.querySelectorAll('[data-marked-textarea-field]'),
        ).toHaveLength(0);
    });

    it('MarkedTextArea: recognized markings are not affected by the junk flagging', async () => {
        const engine = await createMarkedEngine();
        root.innerHTML = `<textarea id="mix-ta" data-ezclassify-controller="marked-textarea">(U) first line.\n(junkxyz) second line.</textarea>`;
        const forms = new EzClassifyUI(asContext(engine as never), { root });
        activeForms.push(forms);
        await wait(400);

        const ta = document.getElementById('mix-ta') as HTMLTextAreaElement;
        const comp = forms.components.get(ta) as MarkedTextArea;
        const segments = comp.getSegments();
        expect(segments).toHaveLength(2);
        expect(segments[0].valid).toBe(true);
        expect(segments[0].assertions.some((a) => a.conceptId === 'U')).toBe(
            true,
        );
        expect(segments[1].valid).toBe(false);
        expect(segments[1].marking).toBe('(junkxyz)');
    });

    it('MarkedTextArea: flags an indented mark the scan could not read', async () => {
        const engine = await createMarkedEngine();
        root.innerHTML = `<textarea id="indent-ta" data-ezclassify-controller="marked-textarea">(U) one.\n  (zzz) indented.</textarea>`;
        const forms = new EzClassifyUI(asContext(engine as never), { root });
        activeForms.push(forms);
        await wait(400);

        const ta = document.getElementById('indent-ta') as HTMLTextAreaElement;
        const comp = forms.components.get(ta) as MarkedTextArea;
        const segments = comp.getSegments();
        // The scan reports "(zzz)" as unread and leading its paragraph.
        expect(segments.map((s) => [s.marking, s.start, s.valid])).toEqual([
            ['(U)', 0, true],
            ['(zzz)', 11, false],
        ]);
    });

    it('MarkedTextArea: leaves an unread wrapped token inside a line as prose', async () => {
        const engine = await createMarkedEngine();
        root.innerHTML = `<textarea id="cite-ta" data-ezclassify-controller="marked-textarea">(S) see section (a) below.</textarea>`;
        const forms = new EzClassifyUI(asContext(engine as never), { root });
        activeForms.push(forms);
        await wait(400);

        const ta = document.getElementById('cite-ta') as HTMLTextAreaElement;
        const comp = forms.components.get(ta) as MarkedTextArea;
        const segments = comp.getSegments();
        expect(segments).toHaveLength(1);
        expect(segments[0].marking).toBe('(S)');
        expect(segments[0].text).toBe('see section (a) below.');
        expect(
            root.querySelectorAll('.marked-textarea-chip--invalid'),
        ).toHaveLength(0);
    });

    it('MarkedTextArea: an unread mark after another mark on its line stays prose', async () => {
        const engine = await createMarkedEngine();
        root.innerHTML = `<textarea id="after-ta" data-ezclassify-controller="marked-textarea">(S)(QQ) first.\n(S) (QQ) second.</textarea>`;
        const forms = new EzClassifyUI(asContext(engine as never), { root });
        activeForms.push(forms);
        await wait(400);

        const ta = document.getElementById('after-ta') as HTMLTextAreaElement;
        const comp = forms.components.get(ta) as MarkedTextArea;
        const segments = comp.getSegments();
        // The scan reports both "(QQ)" marks as unread and not leading: only
        // the "(S)" before each one stands where a part mark goes.
        expect(segments.map((s) => [s.marking, s.start, s.valid])).toEqual([
            ['(S)', 0, true],
            ['(S)', 15, true],
        ]);
        expect(
            root.querySelectorAll('.marked-textarea-chip--invalid'),
        ).toHaveLength(0);
    });
});

describe('MarkedTextArea shows the part marks the engine reads', () => {
    it('shows a mid-line mark the scan reads and audit counts as a part', async () => {
        const context = await createMarkedContext();
        const engine = context.scheme as RemoteContextSchemeEngineAdapter;
        const text = '(S) see section (U) below.';
        // The engine reads the mid-line "(U)" in both operations.
        const scanned = (
            (await engine.scan(text)) as {
                results: { marking: string; start: number }[];
            }
        ).results;
        expect(scanned.map((r) => [r.marking, r.start])).toEqual([
            ['(S)', 0],
            ['(U)', 16],
        ]);
        const audited = (await context.audit({ text })).result.parts;
        expect(audited.map((part) => part.marking)).toEqual(['(S)', '(U)']);
        root.innerHTML = `<textarea id="mid-ta" data-ezclassify-controller="marked-textarea">${text}</textarea>`;
        const forms = new EzClassifyUI(asContext(engine as never), { root });
        activeForms.push(forms);
        await wait(400);

        const ta = document.getElementById('mid-ta') as HTMLTextAreaElement;
        const comp = forms.components.get(ta) as MarkedTextArea;
        const segments = comp.getSegments();
        expect(
            segments.map((s) => [s.marking, s.start, s.end, s.valid, s.text]),
        ).toEqual([
            ['(S)', 0, 3, true, 'see section'],
            ['(U)', 16, 19, true, 'below.'],
        ]);
        expect(
            root.ownerDocument.querySelectorAll('[data-marked-textarea-field]'),
        ).toHaveLength(2);
    });
});

describe('Marked fields carry one enhancement status mark', () => {
    it('MarkedInput mounts a single quiet mark in its footer chrome slot at init', async () => {
        // The mark lives in the bottom hint row's chrome slot, right-aligned opposite
        // the ⌘+Enter tip, not floating over the field's own content.
        const engine = await createMarkedEngine();
        root.innerHTML = `<input type="text" id="mark-mi" data-ezclassify-controller="marked-input" value="(U) title">`;
        const forms = new EzClassifyUI(asContext(engine as never), { root });
        activeForms.push(forms);
        await wait(200);

        const wrap = root.querySelector('.marked-input-wrap')!;
        const chrome = wrap.querySelector('.marked-input-hint-chrome')!;
        const marks = chrome.querySelectorAll(':scope > .ez-status-mark');
        expect(marks).toHaveLength(1);
        expect(marks[0].classList.contains('ez-status-mark--quiet')).toBe(true);
        expect(marks[0].classList.contains('ez-status-mark--chrome')).toBe(
            true,
        );
        // Not floating over the field: the OLD absolute-overlay shape.
        expect(marks[0].classList.contains('ez-status-mark--input')).toBe(
            false,
        );
    });

    it('MarkedTextArea mounts a single quiet mark in its footer chrome slot at init', async () => {
        // Same chrome slot as MarkedInput above.
        const engine = await createMarkedEngine();
        root.innerHTML = `<textarea id="mark-ta" data-ezclassify-controller="marked-textarea">(U) first.\n(S) second.</textarea>`;
        const forms = new EzClassifyUI(asContext(engine as never), { root });
        activeForms.push(forms);
        await wait(300);

        const wrap = root.querySelector('.marked-textarea-wrap')!;
        const chrome = wrap.querySelector('.marked-textarea-hint-chrome')!;
        const marks = chrome.querySelectorAll(':scope > .ez-status-mark');
        expect(marks).toHaveLength(1);
        expect(marks[0].classList.contains('ez-status-mark--quiet')).toBe(true);
        expect(marks[0].classList.contains('ez-status-mark--chrome')).toBe(
            true,
        );
        // Never a per-segment star, no matter how many markings exist.
        expect(root.querySelector('.marked-textarea-autofix-star')).toBeNull();
    });
});
