/**
 * When the suggestion list opens on a marking in MarkedInput and
 * MarkedTextArea. A plain click on a marking opens it with its list, the caret
 * at the click; a drag or a double-click is a text selection. The keyboard
 * moving the caret into a marking opens the editor and no list. Ctrl/Cmd+Enter
 * and the chevron at the marking's end open the list. While the list is open,
 * Up and Down move in it and Escape closes it. In the single-line field Down
 * opens a closed list; in the text area Up and Down move lines instead, so a
 * document whose every paragraph starts with a marking can be walked with Down
 * without a list opening.
 *
 * Jsdom has no layout and no native caret movement, so these cases fire the
 * events a browser fires (press, caret move, release, key) and play the
 * browser's line move themselves where a case needs it.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { openContext } from '../../test-fixtures/context-doubles';
import { MarkedTextArea } from './marked-text-area';
import { MarkedInput } from './marked-input';
import { SURFACES_SCHEME } from '../../test-fixtures/surfaces-scheme';
import { openSurface, press, wait } from './composer/composer-harness';
import {
    connectDemoContext,
    demoRuntimeSettled,
} from '../../../../test-support/demo-runtime';

const PARAGRAPHS = [
    '(INTERNAL) Planning notes.',
    '(PUBLIC) Published background.',
    '(INTERNAL) Budget figures.',
    '(PUBLIC) Press summary.',
];

let root: HTMLDivElement;
const fields: Array<{ destroy(): void }> = [];

beforeEach(() => {
    // jsdom has no scrollIntoView; the composer calls it on the active row.
    Element.prototype.scrollIntoView = vi.fn();
    document.body.innerHTML = '';
    root = document.createElement('div');
    document.body.appendChild(root);
});

afterEach(async () => {
    while (fields.length > 0) fields.pop()!.destroy();
    await demoRuntimeSettled();
    document.body.innerHTML = '';
    vi.restoreAllMocks();
});

async function context() {
    return openContext(await connectDemoContext({ contextId: 'cedar-valley' }));
}

/** Let a caret move, an open or a close land. */
async function settle(): Promise<void> {
    await wait(60);
    await demoRuntimeSettled();
    await wait(40);
}

/**
 * The surfaces scheme marking its parts in square brackets, so a field that
 * draws a parenthesis of its own shows a delimiter the text does not have.
 */
const BRACKETED_SCHEME = (() => {
    const doc = structuredClone(SURFACES_SCHEME);
    doc.scheme.embedded_marking = [
        { pattern: '\\[(.+?)\\]', template: '[{marking}] ' },
    ];
    return doc;
})();

async function bracketedContext() {
    return openContext(
        await connectDemoContext({ draft: { scheme: BRACKETED_SCHEME } }),
    );
}

async function mountTextArea(
    value: string,
    ctx?: Awaited<ReturnType<typeof context>>,
): Promise<{ ta: HTMLTextAreaElement; container: HTMLDivElement }> {
    const container = document.createElement('div');
    root.appendChild(container);
    const ta = document.createElement('textarea');
    ta.value = value;
    container.appendChild(ta);
    const field = new MarkedTextArea();
    fields.push(field);
    await field.init(container, ctx ?? (await context()), {});
    await settle();
    return { ta, container };
}

async function mountInput(
    value: string,
    ctx?: Awaited<ReturnType<typeof context>>,
): Promise<{ input: HTMLTextAreaElement; container: HTMLDivElement }> {
    const container = document.createElement('div');
    root.appendChild(container);
    const native = document.createElement('input');
    native.type = 'text';
    native.value = value;
    container.appendChild(native);
    const field = new MarkedInput();
    fields.push(field);
    await field.init(container, ctx ?? (await context()), {});
    await settle();
    const input = container.querySelector<HTMLTextAreaElement>(
        '.marked-input-native',
    )!;
    return { input, container };
}

function editorInput(): HTMLInputElement | null {
    return document.querySelector<HTMLInputElement>('.inline-editor-input');
}

function chevron(): HTMLButtonElement | null {
    return document.querySelector<HTMLButtonElement>('.inline-editor-chevron');
}

/** Move the caret the way the keyboard does: no press, one caret move. */
async function caretTo(
    field: HTMLTextAreaElement,
    position: number,
): Promise<void> {
    field.focus();
    field.setSelectionRange(position, position);
    document.dispatchEvent(new Event('selectionchange'));
    await settle();
}

/**
 * A mouse press on `field` that lands at `start` and drags to `end`, then its
 * release: `detail` 1 for a plain click, 2 for the second press of a
 * double-click.
 */
async function pressAndRelease(
    field: HTMLTextAreaElement,
    start: number,
    end = start,
    detail = 1,
): Promise<void> {
    field.focus();
    field.dispatchEvent(
        new MouseEvent('mousedown', { bubbles: true, button: 0, detail }),
    );
    // The press puts the caret where it lands; a drag then extends it.
    field.setSelectionRange(start, start);
    document.dispatchEvent(new Event('selectionchange'));
    await settle();
    if (end !== start) {
        field.setSelectionRange(start, end);
        document.dispatchEvent(new Event('selectionchange'));
        await wait(30);
    }
    field.dispatchEvent(
        new MouseEvent('mouseup', { bubbles: true, button: 0, detail }),
    );
    await settle();
}

/** Offset of `column` on line `line` (0-based) of `value`. */
function offsetOf(value: string, line: number, column: number): number {
    const lines = value.split('\n');
    let offset = 0;
    for (let i = 0; i < line; i++) offset += lines[i].length + 1;
    return offset + column;
}

/** Record whether the list ever opened from now on. */
function watchListOpens(): { opened: () => boolean; stop: () => void } {
    let opened = false;
    const check = () => {
        if (openSurface()) opened = true;
    };
    const observer = new MutationObserver(check);
    observer.observe(document.body, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: ['hidden'],
    });
    return {
        opened: () => {
            check();
            return opened;
        },
        stop: () => observer.disconnect(),
    };
}

describe('MarkedTextArea: when the list opens', () => {
    const value = PARAGRAPHS.slice(0, 2).join('\n');

    it('a plain click on a marking opens it with its list, the caret at the click', async () => {
        const { ta } = await mountTextArea(value);
        // Between "IN" and "TERNAL" in "(INTERNAL)".
        await pressAndRelease(ta, 3);
        expect(editorInput()?.value).toBe('INTERNAL');
        expect(openSurface()).not.toBeNull();
        expect(editorInput()?.selectionStart).toBe(2);
        expect(document.activeElement).toBe(editorInput());
    });

    it('a drag across a marking selects text and opens nothing', async () => {
        const { ta } = await mountTextArea(value);
        await pressAndRelease(ta, 1, 15);
        expect(editorInput()).toBeNull();
        expect(openSurface()).toBeNull();
        expect([ta.selectionStart, ta.selectionEnd]).toEqual([1, 15]);
    });

    it('the second press of a double-click opens nothing', async () => {
        const { ta } = await mountTextArea(value);
        await pressAndRelease(ta, 3, 3, 2);
        expect(openSurface()).toBeNull();
    });

    it('the keyboard moving the caret into a marking opens the editor without its list', async () => {
        const { ta } = await mountTextArea(value);
        await caretTo(ta, 3);
        const input = editorInput()!;
        expect(input.value).toBe('INTERNAL');
        expect(openSurface()).toBeNull();
        expect(input.getAttribute('aria-expanded')).toBe('false');
    });

    it('Ctrl+Enter opens the list of the marking the caret is in', async () => {
        const { ta } = await mountTextArea(value);
        await caretTo(ta, 3);
        press(editorInput()!, 'Enter', { ctrlKey: true });
        await settle();
        expect(openSurface()).not.toBeNull();
        expect(editorInput()!.getAttribute('aria-expanded')).toBe('true');
    });

    it('Down with the list closed goes back to the text at the same place, for the browser to move a line', async () => {
        const { ta } = await mountTextArea(value);
        await caretTo(ta, 3);
        const input = editorInput()!;
        input.setSelectionRange(2, 2);
        const down = press(input, 'ArrowDown');
        // The browser's own caret move has to run, now in the textarea.
        expect(down.defaultPrevented).toBe(false);
        expect(document.activeElement).toBe(ta);
        expect(ta.selectionStart).toBe(3);
        await settle();
        expect(openSurface()).toBeNull();
    });

    it('Up with the list closed goes back to the text too', async () => {
        const { ta } = await mountTextArea(value);
        const second = offsetOf(value, 1, 3);
        await caretTo(ta, second);
        const input = editorInput()!;
        input.setSelectionRange(2, 2);
        const up = press(input, 'ArrowUp');
        expect(up.defaultPrevented).toBe(false);
        expect(document.activeElement).toBe(ta);
        expect(ta.selectionStart).toBe(second);
        await settle();
        expect(openSurface()).toBeNull();
    });

    it('while the list is open Down moves in it; after Escape closes it, Down moves to the text', async () => {
        const { ta } = await mountTextArea(value);
        await caretTo(ta, 3);
        const input = editorInput()!;
        press(input, 'Enter', { ctrlKey: true });
        await settle();
        expect(openSurface()).not.toBeNull();

        const inList = press(input, 'ArrowDown');
        expect(inList.defaultPrevented).toBe(true);
        expect(input.getAttribute('aria-activedescendant')).toBeTruthy();
        expect(document.activeElement).toBe(input);

        press(input, 'Escape');
        await settle();
        expect(openSurface()).toBeNull();
        expect(document.activeElement).toBe(input);

        const next = press(input, 'ArrowDown');
        expect(next.defaultPrevented).toBe(false);
        expect(document.activeElement).toBe(ta);
        await settle();
        expect(openSurface()).toBeNull();
    });

    it('walking Down through paragraphs that each start with a marking opens no list', async () => {
        const doc = PARAGRAPHS.join('\n');
        const { ta } = await mountTextArea(doc);
        const watch = watchListOpens();
        let editorsSeen = 0;
        for (let line = 0; line < PARAGRAPHS.length; line++) {
            // The browser moves the caret a line, into the next marking.
            await caretTo(ta, offsetOf(ta.value, line, 3));
            const input = editorInput();
            if (input) {
                editorsSeen++;
                const down = press(input, 'ArrowDown');
                expect(down.defaultPrevented).toBe(false);
                expect(document.activeElement).toBe(ta);
            } else {
                const down = press(ta, 'ArrowDown');
                expect(down.defaultPrevented).toBe(false);
            }
            await settle();
        }
        watch.stop();
        // The caret did enter markings, and none of them opened a list.
        expect(editorsSeen).toBeGreaterThan(0);
        expect(watch.opened()).toBe(false);
    });

    it('a click on the marking already in the editor opens its list', async () => {
        const { ta } = await mountTextArea(value);
        await caretTo(ta, 3);
        const input = editorInput()!;
        input.setSelectionRange(1, 1);
        input.dispatchEvent(
            new MouseEvent('click', { bubbles: true, detail: 1 }),
        );
        await settle();
        expect(openSurface()).not.toBeNull();
        expect(document.activeElement).toBe(input);
    });
});

describe('MarkedInput: when the list opens', () => {
    const value = '(PUBLIC) District report';

    it('a plain click on the marking opens it with its list, the caret at the click', async () => {
        const { input } = await mountInput(value);
        // Between "PU" and "BLIC".
        await pressAndRelease(input, 3);
        expect(editorInput()?.value).toBe('PUBLIC');
        expect(openSurface()).not.toBeNull();
        expect(editorInput()?.selectionStart).toBe(2);
    });

    it('a drag across the marking selects text and opens nothing', async () => {
        const { input } = await mountInput(value);
        await pressAndRelease(input, 1, 14);
        expect(editorInput()).toBeNull();
        expect(openSurface()).toBeNull();
    });

    it('the keyboard moving the caret into the marking opens the editor without its list', async () => {
        const { input } = await mountInput(value);
        await caretTo(input, 0);
        expect(editorInput()?.value).toBe('PUBLIC');
        expect(openSurface()).toBeNull();
    });

    it('Down opens the closed list in the single-line field, and moves in it once open', async () => {
        const { input } = await mountInput(value);
        await caretTo(input, 0);
        const editor = editorInput()!;
        const open = press(editor, 'ArrowDown');
        expect(open.defaultPrevented).toBe(true);
        await settle();
        expect(openSurface()).not.toBeNull();
        expect(editor.getAttribute('aria-expanded')).toBe('true');

        press(editor, 'Escape');
        await settle();
        expect(openSurface()).toBeNull();
        press(editor, 'ArrowDown');
        await settle();
        expect(openSurface()).not.toBeNull();
    });
});

describe('the chevron at the end of the marking', () => {
    it('is a named button that shows and hides the list without taking focus', async () => {
        const { ta } = await mountTextArea(PARAGRAPHS.slice(0, 2).join('\n'));
        await caretTo(ta, 3);
        const input = editorInput()!;
        const button = chevron()!;
        expect(button.getAttribute('aria-label')).toBe('Show suggestions');
        expect(button.getAttribute('aria-expanded')).toBe('false');
        expect(button.tabIndex).toBe(-1);
        const list = document.getElementById(
            button.getAttribute('aria-controls')!,
        );
        expect(list?.getAttribute('role')).toBe('listbox');

        const down = new MouseEvent('mousedown', {
            bubbles: true,
            cancelable: true,
        });
        button.dispatchEvent(down);
        // Focus stays in the marking's text, so typing still filters.
        expect(down.defaultPrevented).toBe(true);
        button.click();
        await settle();
        expect(openSurface()).not.toBeNull();
        expect(button.getAttribute('aria-expanded')).toBe('true');
        expect(input.getAttribute('aria-expanded')).toBe('true');
        expect(document.activeElement).toBe(input);

        button.click();
        await settle();
        expect(openSurface()).toBeNull();
        expect(button.getAttribute('aria-expanded')).toBe('false');
        expect(input.getAttribute('aria-expanded')).toBe('false');
    });

    it('stands in for the closing delimiter, which keeps its width', async () => {
        const { input, container } = await mountInput(
            '(PUBLIC) District report',
        );
        await caretTo(input, 0);
        const close = container.querySelector(
            '.marked-input-chip--editing .inline-editor-close',
        );
        expect(close?.textContent).toBe(')');
        expect(chevron()).not.toBeNull();
        // Touch keeps its own way to the list.
        expect(
            container.querySelector('.marked-input-touch-add'),
        ).not.toBeNull();
    });

    it('stands on the delimiters the scheme writes in the single-line field', async () => {
        const { input, container } = await mountInput(
            '[CONFIDENTIAL] Budget figures.',
            await bracketedContext(),
        );
        await caretTo(input, 1);
        const chip = container.querySelector('.marked-input-chip--editing');
        expect(chip?.firstChild?.textContent).toBe('[');
        expect(chip?.querySelector('.inline-editor-close')?.textContent).toBe(
            ']',
        );
        expect(chevron()).not.toBeNull();
    });

    it('stands on the delimiters the scheme writes in the text area', async () => {
        const { ta, container } = await mountTextArea(
            '[CONFIDENTIAL] Budget figures.\n[INTERNAL] Notes.',
            await bracketedContext(),
        );
        await caretTo(ta, 1);
        const chip = container.querySelector('.marked-textarea-chip--editing');
        expect(chip?.firstChild?.textContent).toBe('[');
        expect(chip?.querySelector('.inline-editor-close')?.textContent).toBe(
            ']',
        );
        expect(chevron()).not.toBeNull();
    });
});
