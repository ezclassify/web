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
    const failure = new Error('runtime unreachable');
    const ui = forms;
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
function unverifiedNotice(): string | null {
    const shown = [
        ...document.querySelectorAll<HTMLElement>(
            '.ez-validation-errors, .marked-textarea-scan-notice, [id$="-scan-notice"], .ez-composer-note',
        ),
    ].filter((n) => !n.hidden && n.textContent?.includes(UNVERIFIED));
    return shown.length ? UNVERIFIED : null;
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
            expect(unverifiedNotice()).toBe(UNVERIFIED);
            expect(page.said).toContain(UNVERIFIED);
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
            expect(unverifiedNotice()).toBeNull();
        });
    },
);

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
