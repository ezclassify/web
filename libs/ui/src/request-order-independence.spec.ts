/**
 * A form's engine requests follow from its markings and the user's actions,
 * never from the order a remote engine happens to answer in. A replay server
 * that answers only recorded requests depends on that.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { EzClassifyUI } from './ezclassify-ui';
import { loadMultiScopeRegression } from '../test-fixtures/load-multi-scope-regression';

const REMOTE = new Set([
    'process',
    'validate',
    'render',
    'scan',
    'aggregate',
    'aggregateAssertions',
    'checkCoverage',
    'suggest',
    'suggestForCategories',
]);

/**
 * The local engine answering each remote call after `delayOf(n)` ms, where `n`
 * counts calls, and recording every request it was sent.
 */
function remoteEngine(delayOf: (call: number) => number) {
    const engine = loadMultiScopeRegression();
    const requests = new Set<string>();
    let calls = 0;
    const remote = new Proxy(engine, {
        get(target, key, receiver) {
            const value = Reflect.get(target, key, receiver);
            if (typeof value !== 'function') return value;
            if (!REMOTE.has(String(key))) return value.bind(target);
            return (...args: unknown[]) => {
                requests.add(
                    `${String(key)} ${JSON.stringify(args, (name, field) =>
                        name === 'signal' ? undefined : field,
                    )}`,
                );
                const delay = delayOf(calls++);
                return new Promise((resolve, reject) =>
                    setTimeout(() => {
                        try {
                            resolve(Reflect.apply(value, target, args));
                        } catch (error) {
                            reject(error);
                        }
                    }, delay),
                );
            };
        },
    });
    return { remote, requests };
}

const FORM = `<form id="root">
    <input id="document" value="SCHOOL STAFF" data-ezclassify-controller="marking">
    <input id="attachment" value="STUDENTS" data-ezclassify-controller="marking" data-ezclassify-part-of="document">
    <input id="summary" value="DISTRICT COORDINATORS" data-ezclassify-controller="tags" data-ezclassify-part-of="document">
    <input id="title" value="(ST) Title" data-ezclassify-controller="marked-input" data-ezclassify-part-of="document">
    <textarea id="body" data-ezclassify-controller="marked-textarea" data-ezclassify-part-of="document">(SS) First.
(ST) Second.</textarea>
    <div data-ezclassify-controller="banner" data-ezclassify-source="document"></div>
    <div data-ezclassify-controller="banner" data-ezclassify-aggregate="document"></div>
</form>`;

let ui: EzClassifyUI | undefined;
afterEach(() => {
    ui?.destroy();
    ui = undefined;
    document.body.innerHTML = '';
});

async function settle() {
    for (let i = 0; i < 8; i++)
        await new Promise((resolve) => setTimeout(resolve, 60));
}

/** Mount the form, set the whole from the application, and report. */
async function run(delayOf: (call: number) => number) {
    document.body.innerHTML = FORM;
    const { remote, requests } = remoteEngine(delayOf);
    ui = new EzClassifyUI(remote, {
        root: document.querySelector<HTMLElement>('#root')!,
    });
    await settle();
    await ui.store.publishRendered('document', 'STATE ASSESSMENT STAFF');
    await settle();
    // One action that both commits a portion mark and changes the whole, the
    // way pressing a button that sets the whole leaves an open mark editor.
    const body = document.querySelector<HTMLTextAreaElement>('#body')!;
    body.value = body.value.replace('(SS)', '(DC)');
    body.dispatchEvent(new Event('blur'));
    void ui.store.publishRendered('document', 'SCHOOL STAFF');
    await settle();
    const values = [...document.querySelectorAll<HTMLInputElement>('[id]')]
        .filter((el) => 'value' in el)
        .map((el) => `${el.id}=${el.value}`);
    const rollup = ui.store.getWholeRollup('document').rendered;
    ui.destroy();
    ui = undefined;
    return { requests: [...requests].sort(), values, rollup };
}

describe('engine requests under any answer order', () => {
    it('sends the same requests and settles on the same values', async () => {
        const inOrder = await run(() => 1);
        const reversed = await run((call) => 40 - (call % 8) * 5);
        const shuffled = await run(
            (call) => [17, 3, 29, 11, 0, 23, 7][call % 7]!,
        );
        expect(reversed.requests).toEqual(inOrder.requests);
        expect(shuffled.requests).toEqual(inOrder.requests);
        expect(reversed.values).toEqual(inOrder.values);
        expect(shuffled.values).toEqual(inOrder.values);
        expect(shuffled.rollup).toBe(inOrder.rollup);
        expect(inOrder.rollup).not.toBe('');
        // The body keeps its portion marks.
        expect(inOrder.values).toContain('body=(DC) First.\n(ST) Second.');
    }, 30_000);

    it('binds a field to its own host, never the first input its form holds', async () => {
        document.body.innerHTML = FORM;
        const { remote } = remoteEngine(() => 1);
        ui = new EzClassifyUI(remote, {
            root: document.querySelector<HTMLElement>('#root')!,
        });
        await settle();
        const summary = document.querySelector<HTMLInputElement>('#summary')!;
        const tags = ui.autocompleters.get(summary)!;
        expect(
            (tags as unknown as { enhancedInput: HTMLInputElement })
                .enhancedInput,
        ).toBe(summary);
        // The whole's host carries the whole's marking only.
        expect(
            document.querySelector<HTMLInputElement>('#document')!.value,
        ).toBe('SCHOOL STAFF');
    });
});
