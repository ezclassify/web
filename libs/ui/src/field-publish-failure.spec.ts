/**
 * A field's value the store could not take. The store's publish makes a runtime
 * call of its own, after the field's, and rejects when that call fails; the
 * store then keeps its previous value. The binding must neither swallow that
 * nor take the failed value for one the store holds.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EzClassifyUI } from './ezclassify-ui';
import { asContext } from '../test-fixtures/as-context';
import { createUnverifiableContext } from '../test-fixtures/unverifiable-context';
import { press, typeText, wait } from './components/composer/composer-harness';
import { expectConsoleError } from '../../../test-support/fail-on-console-error';

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

describe('a MarkingField commit the store could not take', () => {
    it('is reported, and the same value published again reaches the store', async () => {
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
        const store = forms.store;
        const failure = new Error('runtime unreachable');
        let refuse = true;
        for (const method of [
            'publishAssertions',
            'publishRendered',
        ] as const) {
            const real = store[method].bind(store) as (
                ...args: unknown[]
            ) => Promise<unknown>;
            vi.spyOn(store, method).mockImplementation(((...args: unknown[]) =>
                refuse ? Promise.reject(failure) : real(...args)) as never);
        }
        const editor = root.querySelector<HTMLTextAreaElement>(
            '.marking-field-host',
        )!;
        editor.focus();
        typeText(editor, 'secret');
        await wait(100);
        press(editor, 'Enter');
        await wait(200);

        // The field shows the commit; the store, and so every other view of
        // the marking, keeps the value it had.
        expect(editor.value).toBe('SECRET');
        expect(store.get('doc').rendered).toBe('');
        expectConsoleError(
            '[ezclassify] field: publishing marking "doc" failed; the previous value stands.',
            failure,
        );

        refuse = false;
        const field = forms.components.get(
            document.getElementById('f')!,
        ) as unknown as { setValue(value: string): Promise<void> };
        await field.setValue('SECRET');
        await wait(200);

        expect(store.get('doc').rendered).toBe('SECRET');
    });
});
