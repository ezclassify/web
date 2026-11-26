/**
 * A field's value the store could not take. The store's publish makes a runtime
 * call of its own, after the field's, and rejects when that call fails; the
 * store then keeps its previous value, so the banner, rollups and hidden fields
 * show the old one. The field keeps what the user entered and reports itself
 * unverified, the way a failed check of its text does, until a later publish of
 * it lands. Committing the value it holds sends it again.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EzClassifyUI } from './ezclassify-ui';
import { asContext } from '../test-fixtures/as-context';
import { createUnverifiableContext } from '../test-fixtures/unverifiable-context';
import { textareaEditor } from '../test-fixtures/textarea-editor';
import { press, typeText, wait } from './components/composer/composer-harness';

const UNVERIFIED =
    'This text could not be checked. The result shown may be out of date.';
const NOT_SHARED =
    'Your entry is kept, but it has not reached the rest of the page yet.';

let root: HTMLDivElement;
let forms: EzClassifyUI | null = null;

beforeEach(() => {
    root = document.createElement('div');
    document.body.appendChild(root);
    Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
    forms?.destroy();
    forms = null;
    root.remove();
    vi.restoreAllMocks();
});

type Kind = 'marking' | 'tags' | 'marked-input' | 'marked-textarea';

interface Page {
    /** The field's host, the element the page authored. */
    host: HTMLInputElement | HTMLTextAreaElement;
    /** Every `ezclassify:unverified-change` the host sent, in order. */
    events: boolean[];
    /** What the page's live regions said. */
    said: string[];
    /** The developer-facing reports of failed publishes. */
    reports: () => string[];
    /** Whether the store refuses publishes; flip to let them through. */
    store: { refuse: boolean };
    runtime: { down: boolean };
    /** Open the field for editing, as a keyboard user does. */
    open(): Promise<void>;
    /** The input the user types into while editing. */
    input(): HTMLInputElement | HTMLTextAreaElement;
    /** Commit what is typed. */
    commit(): Promise<void>;
}

/** Reject the store's publishes while `store.refuse` is set. */
function refuseStorePublishes(ui: EzClassifyUI, store: { refuse: boolean }) {
    const failure = new Error('runtime unreachable');
    for (const method of [
        'publishAssertions',
        'publishRendered',
        'publishAggregate',
    ] as const) {
        const real = (ui.store[method] as (...a: unknown[]) => unknown).bind(
            ui.store,
        );
        vi.spyOn(ui.store, method).mockImplementation(((...args: unknown[]) =>
            store.refuse ? Promise.reject(failure) : real(...args)) as never);
    }
}

/**
 * Mount one field bound to the page marking `doc`, with publishes to the store
 * rejected until `store.refuse` is cleared.
 */
async function mountBound(kind: Kind): Promise<Page> {
    const tag = kind === 'marked-textarea' ? 'textarea' : 'input';
    root.innerHTML = `<input type="hidden" id="doc" data-ezclassify-marking>
        <label for="f">Marking</label>
        <${tag} id="f" data-ezclassify-controller="${kind}" data-ezclassify-bound-to="doc"></${tag}>`;
    const runtime = { down: false };
    const context = await createUnverifiableContext(runtime);
    const ready = new Promise((resolve) =>
        root.addEventListener('ezclassify:ready', resolve, { once: true }),
    );
    forms = new EzClassifyUI(asContext(context as never), { root });
    await ready;
    await wait();
    const store = { refuse: true };
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const reports = () =>
        errors.mock.calls
            .map((call) => String(call[0]))
            .filter((line) => line.includes('the previous value stands'));
    refuseStorePublishes(forms!, store);
    const host = document.getElementById('f') as
        HTMLInputElement | HTMLTextAreaElement;
    const events: boolean[] = [];
    host.addEventListener('ezclassify:unverified-change', (event) =>
        events.push((event as CustomEvent).detail.unverified),
    );
    const said: string[] = [];
    new MutationObserver(() => {
        for (const region of document.querySelectorAll('[aria-live]')) {
            const text = region.textContent?.trim();
            if (text && said.at(-1) !== text) said.push(text);
        }
    }).observe(document.body, {
        subtree: true,
        childList: true,
        characterData: true,
    });
    const input = () =>
        kind === 'tags'
            ? root.querySelector<HTMLInputElement>('.tag-input-filter')!
            : kind === 'marking'
              ? root.querySelector<HTMLTextAreaElement>('.marking-field-host')!
              : root.querySelector<HTMLInputElement>('.inline-editor-input')!;
    const open = async () => {
        if (kind === 'marking' || kind === 'tags') {
            input().focus();
            press(input(), 'ArrowDown');
            await wait();
            return;
        }
        host.focus();
        textareaEditor(host as HTMLTextAreaElement).setSelectionRange(0, 0);
        press(document.activeElement as HTMLElement, 'Enter', {
            ctrlKey: true,
        });
        await wait(150);
    };
    const commit = async () => {
        press(input(), 'Enter');
        await wait(250);
    };
    return {
        host,
        events,
        said,
        reports,
        store,
        runtime,
        open,
        input,
        commit,
    };
}

/** Type a marking into an empty field and commit it. */
async function enter(page: Page, text: string): Promise<void> {
    await page.open();
    typeText(page.input(), text);
    await wait(120);
    await page.commit();
}

/** The field's notice that its result may be out of date, when shown. */
function shown(text: string): number {
    return (
        [
            ...document.querySelectorAll<HTMLElement>(
                '.ez-validation-errors, .marked-textarea-scan-notice, [id$="-scan-notice"], .ez-composer-note',
            ),
        ]
            .filter((n) => !n.hidden && n.isConnected)
            .map((n) => n.textContent ?? '')
            .join(' ')
            .split(text).length - 1
    );
}

/** The field's notice that its value has not reached the page, when shown. */
function notSharedNotice(): string | null {
    return shown(NOT_SHARED) > 0 ? NOT_SHARED : null;
}

describe.each(['marking', 'tags', 'marked-input', 'marked-textarea'] as const)(
    'a %s whose value the store could not take',
    (kind) => {
        it('stays unverified until a later publish lands, and committing the same value sends it again', async () => {
            const page = await mountBound(kind);
            const store = forms!.store;

            await enter(page, 'secret');

            expect(store.get('doc').assertions).toEqual([]);
            expect(page.host.hasAttribute('data-ezclassify-unverified')).toBe(
                true,
            );
            expect(page.events).toEqual([true]);
            expect(notSharedNotice()).toBe(NOT_SHARED);
            expect(shown(UNVERIFIED)).toBe(0);
            expect(page.said.some((text) => text.includes(NOT_SHARED))).toBe(
                true,
            );
            expect(page.reports().length).toBeGreaterThan(0);

            page.store.refuse = false;
            await page.open();
            await page.commit();

            expect(
                store.get('doc').assertions.map((a) => a.conceptId),
            ).toContain('S');
            expect(page.host.hasAttribute('data-ezclassify-unverified')).toBe(
                false,
            );
            expect(page.events).toEqual([true, false]);
            expect(notSharedNotice()).toBeNull();
        });

        it('is shared again once the page holds the same value, whoever put it there', async () => {
            const page = await mountBound(kind);
            await enter(page, 'secret');
            expect(page.events).toEqual([true]);

            page.store.refuse = false;
            await forms!.store.publishRendered('doc', 'SECRET');
            await wait(400);

            expect(
                forms!.store.get('doc').assertions.map((a) => a.conceptId),
            ).toContain('S');
            expect(page.host.hasAttribute('data-ezclassify-unverified')).toBe(
                false,
            );
            expect(page.events).toEqual([true, false]);
            expect(notSharedNotice()).toBeNull();
        });
    },
);

describe('a MarkedTextArea portion whose publish failed', () => {
    it('leaves nothing unshared once it is deleted from the text', async () => {
        const page = await mountBound('marked-textarea');
        await enter(page, 'secret');
        expect(page.events).toEqual([true]);

        page.store.refuse = false;
        page.host.value = '';
        page.host.dispatchEvent(new Event('input', { bubbles: true }));
        await wait(700);

        expect(page.host.hasAttribute('data-ezclassify-unverified')).toBe(
            false,
        );
        expect(page.events).toEqual([true, false]);
    });
});

describe('a MarkingField publish that a newer publish to its marking superseded', () => {
    it('is not shared when the newer publish did not land either', async () => {
        root.innerHTML = `<input type="hidden" id="doc" data-ezclassify-marking>
            <label for="f">Marking</label>
            <input id="f" data-ezclassify-controller="marking" data-ezclassify-bound-to="doc">`;
        const context = await createUnverifiableContext({ down: false });
        // The field's value is read slowly, and the page's newer value cannot
        // be read at all.
        const read = context.scheme.process.bind(context.scheme);
        const holds = (args: unknown[], concept: string) =>
            JSON.stringify(args).includes(`"conceptId":"${concept}"`);
        context.scheme.process = ((...args: Parameters<typeof read>) =>
            JSON.stringify(args).includes('UNCLASSIFIED') || holds(args, 'U')
                ? Promise.reject(new Error('runtime unreachable'))
                : holds(args, 'S')
                  ? new Promise((resolve) => setTimeout(resolve, 80)).then(() =>
                        read(...args),
                    )
                  : read(...args)) as typeof read;
        const ready = new Promise((resolve) =>
            root.addEventListener('ezclassify:ready', resolve, { once: true }),
        );
        forms = new EzClassifyUI(asContext(context as never), { root });
        await ready;
        await wait();
        vi.spyOn(console, 'error').mockImplementation(() => {});
        const store = forms.store;
        const sent = vi.spyOn(store, 'publishAssertions');
        const host = document.getElementById('f')!;
        const editor = root.querySelector<HTMLTextAreaElement>(
            '.marking-field-host',
        )!;
        editor.focus();
        typeText(editor, 'secret');
        await wait(120);
        press(editor, 'Enter');
        await vi.waitFor(() => expect(sent).toHaveBeenCalled(), {
            timeout: 2000,
        });
        await store.publishRendered('doc', 'UNCLASSIFIED').catch(() => {});
        await wait(400);

        expect(store.get('doc').assertions).toEqual([]);
        expect(editor.value).toBe('SECRET');
        expect(host.hasAttribute('data-ezclassify-unverified')).toBe(true);
    });
});

describe('a MarkingField that failed a check and could not share its value', () => {
    it('stays unverified while either holds: a check that lands does not clear a stale store', async () => {
        const page = await mountBound('marking');
        const store = forms!.store;
        await enter(page, 'secret');
        expect(page.events).toEqual([true]);
        const held = page.input().value;

        page.runtime.down = true;
        await page.open();
        typeText(page.input(), `${held} zzz`);
        await wait(150);
        // Both causes hold: the open list says each once.
        const list =
            document.querySelector(
                '.ez-composer:not([hidden]) .ez-composer__result',
            )?.textContent ?? '';
        expect(list.split(UNVERIFIED).length - 1).toBe(1);
        expect(list.split(NOT_SHARED).length - 1).toBe(1);
        page.runtime.down = false;
        typeText(page.input(), held);
        await wait(150);
        expect(page.host.hasAttribute('data-ezclassify-unverified')).toBe(true);
        expect(page.events).toEqual([true]);

        page.store.refuse = false;
        await page.commit();

        expect(store.get('doc').assertions.map((a) => a.conceptId)).toContain(
            'S',
        );
        expect(page.host.hasAttribute('data-ezclassify-unverified')).toBe(
            false,
        );
        expect(page.events).toEqual([true, false]);
    });

    it('stays unverified while either holds: a publish that lands does not clear a failed check', async () => {
        const page = await mountBound('marking');
        page.store.refuse = false;
        const field = forms!.components.get(page.host) as unknown as {
            setShareFailed(failed: boolean): void;
        };
        page.runtime.down = true;
        await page.open();
        typeText(page.input(), 'secret');
        await wait(150);
        expect(page.events).toEqual([true]);

        field.setShareFailed(true);
        field.setShareFailed(false);
        expect(page.host.hasAttribute('data-ezclassify-unverified')).toBe(true);
        expect(page.events).toEqual([true]);

        page.runtime.down = false;
        typeText(page.input(), 'secret ');
        await wait(150);
        expect(page.host.hasAttribute('data-ezclassify-unverified')).toBe(
            false,
        );
        expect(page.events).toEqual([true, false]);
    });
});

describe.each(['select', 'selector', 'checklist'] as const)(
    '%s control whose value the store could not take',
    (kind) => {
        async function mountChoice() {
            root.innerHTML = `<input type="hidden" id="doc" data-ezclassify-marking>
            <div id="f" data-ezclassify-controller="${kind}"
                 data-ezclassify-facet-of="doc"
                 data-ezclassify-category="${kind === 'checklist' ? 'caveat' : 'level'}"></div>`;
            const context = await createUnverifiableContext({ down: false });
            const ready = new Promise((resolve) =>
                root.addEventListener('ezclassify:ready', resolve, {
                    once: true,
                }),
            );
            forms = new EzClassifyUI(asContext(context as never), { root });
            await ready;
            await wait();
            const store = { refuse: true };
            vi.spyOn(console, 'error').mockImplementation(() => {});
            refuseStorePublishes(forms, store);
            return { store };
        }

        it('stays unverified until the held value is sent again when focus leaves', async () => {
            const { store } = await mountChoice();
            const host = document.getElementById('f')!;
            const choose = async () => {
                if (kind === 'select') {
                    const select =
                        root.querySelector<HTMLSelectElement>('select')!;
                    select.value = 'S';
                    select.dispatchEvent(
                        new Event('change', { bubbles: true }),
                    );
                } else if (kind === 'selector') {
                    root.querySelector<HTMLElement>(
                        '.category-selector-btn[data-concept-id="S"]',
                    )!.click();
                } else {
                    root.querySelector<HTMLElement>(
                        '.category-checklist-checkbox[data-concept-id="NF"]',
                    )!.click();
                }
                await wait(250);
            };
            const concept = kind === 'checklist' ? 'NF' : 'S';
            const unverified = () =>
                host.hasAttribute('data-ezclassify-unverified');

            await choose();
            expect(
                forms!.store.get('doc').assertions.map((a) => a.conceptId),
            ).not.toContain(concept);
            expect(unverified()).toBe(true);
            expect(
                [...root.querySelectorAll('.ez-validation-errors')]
                    .map((n) => n.textContent)
                    .join(' '),
            ).toContain(`${NOT_SHARED} Leave the field to try again.`);

            store.refuse = false;
            const control = root.querySelector<HTMLElement>(
                'select, .category-selector-btn, .category-checklist-checkbox, [data-concept-id]',
            )!;
            control.focus();
            control.blur();
            await wait(250);

            expect(
                forms!.store.get('doc').assertions.map((a) => a.conceptId),
            ).toContain(concept);
            expect(unverified()).toBe(false);
        });
    },
);

describe('a field torn down while its value is not shared', () => {
    it('stops following the page: its watch is released and a later commit reaches nothing of it', async () => {
        const store = { refuse: true };
        root.innerHTML = `<input type="hidden" id="doc" data-ezclassify-marking>
            <label for="f">Marking</label>
            <input id="f" data-ezclassify-controller="marking" data-ezclassify-bound-to="doc">`;
        const context = await createUnverifiableContext({ down: false });
        const ready = new Promise((resolve) =>
            root.addEventListener('ezclassify:ready', resolve, { once: true }),
        );
        forms = new EzClassifyUI(asContext(context as never), { root });
        await ready;
        await wait();
        vi.spyOn(console, 'error').mockImplementation(() => {});
        refuseStorePublishes(forms, store);

        // Every store watch opened from here on, and whether it is still held.
        const held = new Set<number>();
        const subscribe = forms.store.subscribe.bind(forms.store);
        let opened = 0;
        vi.spyOn(forms.store, 'subscribe').mockImplementation(((
            ...args: Parameters<typeof subscribe>
        ) => {
            const id = opened++;
            held.add(id);
            const stop = subscribe(...args);
            return () => {
                held.delete(id);
                stop();
            };
        }) as typeof subscribe);

        const host = document.getElementById('f') as HTMLInputElement;
        const editor = root.querySelector<HTMLTextAreaElement>(
            '.marking-field-host',
        )!;
        editor.focus();
        typeText(editor, 'secret');
        await wait(120);
        press(editor, 'Enter');
        await wait(400);
        expect(host.hasAttribute('data-ezclassify-unverified')).toBe(true);
        expect(held.size).toBeGreaterThan(0);

        const recheck = vi.spyOn(
            forms as unknown as { recheckShare(owner: object): void },
            'recheckShare',
        );
        host.remove();
        await wait(300);
        store.refuse = false;
        await forms.store.publishRendered('doc', 'SECRET');
        await wait(100);

        expect(recheck).not.toHaveBeenCalled();
        expect(held.size).toBe(0);
    });
});
