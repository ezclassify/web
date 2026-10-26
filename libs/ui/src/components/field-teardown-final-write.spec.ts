/**
 * A field torn down with a draft still open writes that draft first.
 *
 * TagInput is not here: its text box filters the list and holds no draft of the
 * value, so leaving it commits nothing either.
 *
 * A host that removes a field (a dialog closing, a route change) can do it
 * while focus is still in the field and no blur has run: the draft the user
 * typed is complete, and nothing has asked the composer to commit it. Each
 * field of the family is mounted bound to a store, given a complete marking,
 * then removed from the document the way a host removes it. The store must hold
 * the typed marking afterwards.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Context } from '@ezclassify/engine';
import {
    cedarValleyAccessYaml,
    cedarValleyGuideYaml,
    cedarValleySchemeYaml,
} from '@ezclassify/example-schemes/cedar-valley';
import * as jsYaml from 'js-yaml';
import { EzClassifyUI } from '../ezclassify-ui';
import { pendingTeardownWrite } from './teardown-write';

/** Replace an input's text as typing does, caret at the end. */
function typeText(
    input: HTMLInputElement | HTMLTextAreaElement,
    text: string,
): void {
    input.value = text;
    input.setSelectionRange(text.length, text.length);
    input.dispatchEvent(new Event('input', { bubbles: true }));
}

const MARKING_ID = 'doc';

/** The cedar-valley example context, as the demos load it. */
function createContext(): Context {
    return Context.fromComponents({
        scheme: jsYaml.load(cedarValleySchemeYaml),
        guides: [jsYaml.load(cedarValleyGuideYaml)],
        access: jsYaml.load(cedarValleyAccessYaml),
    });
}

let root: HTMLDivElement;
let forms: EzClassifyUI | null = null;

beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn();
    root = document.createElement('div');
    document.body.appendChild(root);
});

afterEach(() => {
    forms?.destroy();
    forms = null;
    root.remove();
});

/**
 * Mount the fields and resolve once the runtime reports ready, however long
 * that takes. Every wait in this spec is on a signal the runtime gives, never a
 * guessed delay.
 */
async function mount(html: string): Promise<HTMLElement> {
    // The marking the fields are bound to, as a page declares it.
    root.innerHTML = `<input type="hidden" id="${MARKING_ID}" data-ezclassify-rendered />${html}`;
    await startRuntime();
    return root.querySelector<HTMLElement>('#host')!;
}

async function startRuntime(): Promise<void> {
    const ready = new Promise((resolve) =>
        root.addEventListener('ezclassify:ready', resolve, { once: true }),
    );
    forms = new EzClassifyUI(createContext(), { root });
    await ready;
}

/** Open the marked field's editor at the caret, the way Ctrl+Enter does. */
async function openEditor(
    host: HTMLTextAreaElement,
): Promise<HTMLInputElement> {
    host.focus();
    const capture = document.activeElement as HTMLTextAreaElement;
    capture.setSelectionRange(0, 0);
    capture.dispatchEvent(
        new KeyboardEvent('keydown', {
            key: 'Enter',
            ctrlKey: true,
            bubbles: true,
            cancelable: true,
        }),
    );
    return vi.waitFor(() => {
        const editor = document.querySelector<HTMLInputElement>(
            '.inline-editor-input',
        );
        expect(editor).not.toBeNull();
        return editor!;
    });
}

/** The runtime's component for a host (TagInput is kept apart). */
function componentOf(host: HTMLElement): { destroy(): void } {
    const runtime = forms as unknown as {
        components: Map<HTMLElement, { destroy(): void }>;
        autocompleters: Map<HTMLElement, { destroy(): void }>;
    };
    return runtime.components.get(host) ?? runtime.autocompleters.get(host)!;
}

/**
 * Wait for the final write a torn-down field starts, once teardown has begun (a
 * removed host is noticed by the runtime's observer, a turn later).
 */
async function finalWrite(component: object): Promise<void> {
    const write = await vi.waitFor(() => {
        const pending = pendingTeardownWrite(component);
        expect(pending).toBeDefined();
        return pending!;
    });
    await write;
}

/**
 * Destroy the field through the runtime's own handle, with focus still in it,
 * the way a framework wrapper unmounting the component does, and wait for its
 * final write.
 */
async function destroyComponent(host: HTMLElement): Promise<void> {
    const component = componentOf(host);
    component.destroy();
    await finalWrite(component);
}

/** Remove the host the way a page does, and wait for its final write. */
async function removeHost(host: HTMLElement): Promise<void> {
    const component = componentOf(host);
    host.remove();
    await finalWrite(component);
}

/** The concepts the store holds for the bound marking. */
const stored = () =>
    forms!.store
        .get(MARKING_ID)
        .assertions.map((a) => a.conceptId)
        .sort();
const TYPED = 'internal oakwood';
const EXPECTED = ['INTERNAL', 'OAKWOOD'];

describe('a field removed with a draft open writes the draft first', () => {
    it('MarkingField, removed from the page', async () => {
        const host = await mount(
            `<textarea id="host" data-ezclassify-controller="marking" data-ezclassify-bound-to="${MARKING_ID}"></textarea>`,
        );
        const input = host as HTMLTextAreaElement;
        input.focus();
        typeText(input, TYPED);
        expect(stored()).not.toContain('OAKWOOD');
        await removeHost(host);
        expect(stored()).toEqual(expect.arrayContaining(EXPECTED));
    });

    it('MarkingField, destroyed by its component handle', async () => {
        const host = await mount(
            `<textarea id="host" data-ezclassify-controller="marking" data-ezclassify-bound-to="${MARKING_ID}"></textarea>`,
        );
        const input = host as HTMLTextAreaElement;
        input.focus();
        typeText(input, TYPED);
        expect(stored()).not.toContain('OAKWOOD');
        await destroyComponent(host);
        expect(stored()).toEqual(expect.arrayContaining(EXPECTED));
    });

    it('TagInput', async () => {
        const host = await mount(
            `<input id="host" data-ezclassify-controller="tags" data-ezclassify-bound-to="${MARKING_ID}" />`,
        );
        const filter =
            root.querySelector<HTMLInputElement>('.tag-input-filter')!;
        filter.focus();
        typeText(filter, TYPED);
        expect(stored()).not.toContain('OAKWOOD');
        await removeHost(host);
        expect(stored()).toEqual(expect.arrayContaining(EXPECTED));
    });

    it('MarkedInput', async () => {
        const host = await mount(
            `<input type="text" id="host" data-ezclassify-controller="marked-input" data-ezclassify-bound-to="${MARKING_ID}">`,
        );
        const editor = await openEditor(host as HTMLTextAreaElement);
        typeText(editor, TYPED);
        expect(stored()).not.toContain('OAKWOOD');
        await removeHost(host);
        expect(stored()).toEqual(expect.arrayContaining(EXPECTED));
    });

    it('MarkedTextArea', async () => {
        const host = await mount(
            `<textarea id="host" data-ezclassify-controller="marked-textarea" data-ezclassify-bound-to="${MARKING_ID}"></textarea>`,
        );
        const editor = await openEditor(host as HTMLTextAreaElement);
        typeText(editor, TYPED);
        expect(stored()).not.toContain('OAKWOOD');
        await removeHost(host);
        expect(stored()).toEqual(expect.arrayContaining(EXPECTED));
    });
});

/** The composer's reading of a MarkingField's draft, when it has one. */
function reading(host: HTMLElement) {
    const field = (
        forms as unknown as {
            components: Map<
                HTMLElement,
                {
                    controller: {
                        snapshot(): {
                            reading: { complete: boolean } | null;
                            stale: boolean;
                        };
                    };
                }
            >;
        }
    ).components.get(host)!;
    const s = field.controller.snapshot();
    return s.stale ? null : s.reading;
}
const draftReads = (host: HTMLElement) => reading(host)?.complete === true;
const draftReadsIncomplete = (host: HTMLElement) =>
    reading(host)?.complete === false;

describe('a runtime rebuilt mid-edit', () => {
    it('keeps the typed draft in the marking host, so the next runtime reads it', async () => {
        const host = await mount(
            `<textarea id="host" data-ezclassify-controller="marking" data-ezclassify-bound-to="${MARKING_ID}"></textarea>`,
        );
        const input = host as HTMLTextAreaElement;
        input.focus();
        typeText(input, TYPED);

        // The draft has to have been read before it can be kept.
        await vi.waitFor(() => expect(draftReads(input)).toBe(true));

        // The host page swaps its runtime in the same turn, the way a policy
        // switch rebuilds the fields: the old store goes with the old runtime.
        forms!.destroy();
        const marking = document.getElementById(MARKING_ID) as HTMLInputElement;
        // Kept as the marking it reads to, not as the typed text.
        expect(marking.value).not.toBe(TYPED);
        expect(marking.value).toMatch(/INTERNAL/);

        await startRuntime();
        expect(stored()).toEqual(expect.arrayContaining(EXPECTED));
    });

    it('never keeps a draft that does not read', async () => {
        const host = await mount(
            `<textarea id="host" data-ezclassify-controller="marking" data-ezclassify-bound-to="${MARKING_ID}"></textarea>`,
        );
        const input = host as HTMLTextAreaElement;
        const marking = document.getElementById(MARKING_ID) as HTMLInputElement;
        const before = marking.value;
        input.focus();
        typeText(input, 'zzqq');
        // Read, and found not to read as a marking.
        await vi.waitFor(() => expect(draftReadsIncomplete(input)).toBe(true));

        forms!.destroy();
        expect(marking.value).toBe(before);

        await startRuntime();
        expect(stored()).toEqual([]);
    });

    it('never writes an unread draft into the marking host when the field is removed', async () => {
        const host = await mount(
            `<textarea id="host" data-ezclassify-controller="marking" data-ezclassify-bound-to="${MARKING_ID}"></textarea>`,
        );
        const input = host as HTMLTextAreaElement;
        const marking = document.getElementById(MARKING_ID) as HTMLInputElement;
        const before = marking.value;
        input.focus();
        typeText(input, 'zzqq');
        await vi.waitFor(() => expect(draftReadsIncomplete(input)).toBe(true));

        await removeHost(host);
        expect(marking.value).toBe(before);
        expect(stored()).toEqual([]);
    });
});

describe('a host the page removes stays removed', () => {
    it.each([
        ['marking', 'textarea'],
        ['marked-input', 'input'],
        ['marked-textarea', 'textarea'],
    ])('%s', async (controller, tag) => {
        const host = await mount(
            `<${tag} id="host" data-ezclassify-controller="${controller}" data-ezclassify-bound-to="${MARKING_ID}"></${tag}>`,
        );
        const component = componentOf(host);
        host.remove();
        await vi.waitFor(() => expect(componentOf(host)).not.toBe(component));
        // A detached host must stay detached after teardown so the scanner
        // cannot remount it.
        expect(host.isConnected).toBe(false);
        expect(root.querySelector('#host')).toBeNull();
    });
});
