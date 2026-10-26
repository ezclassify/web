/**
 * Teardown while a component's `init()` is still in flight.
 *
 * AttachView schedules store wiring on each field's init() promise. Destroying
 * an instance before that promise settles must prevent later subscription to
 * its destroyed store and avoid a false mount error. Framework teardown can
 * occur in this window during conditional rendering, route changes, or React
 * StrictMode effect cleanup.
 *
 * The fields below are the demo's own shape. Both of its store seams are
 * deferred: `data-ezclassify-bound-to` wires through `wireSubscription`, and
 * `data-ezclassify-aggregate` through `wireReadSubscription`.
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Context } from '@ezclassify/engine';
import { EzClassifyUI } from './ezclassify-ui';
import { VanillaEzClassifyStore } from './store/ezclassify-store';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = resolve(__dirname, '../../../vendor/spec/fixtures/v1');

function newContext() {
    return Context.fromComponents({
        scheme: JSON.parse(
            readFileSync(resolve(fixturesDir, 'ref-scheme-1.json'), 'utf8'),
        ),
    });
}

/** Flush the async component-init chain and the rollup debounce behind it. */
async function settle(): Promise<void> {
    for (let index = 0; index < 6; index++) {
        await new Promise<void>((tick) => setTimeout(tick, 25));
    }
}

let container: HTMLDivElement;
let errors: string[];

beforeEach(() => {
    errors = [];
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
        errors.push(args.map((arg) => String(arg)).join(' '));
    });
    container = document.createElement('div');
    container.innerHTML = `
        <input type="hidden" id="doc-marking" data-ezclassify-rendered />
        <input id="tag-field"
               data-ezclassify-controller="tags"
               data-ezclassify-bound-to="doc-marking" />
        <div data-ezclassify-controller="card" data-ezclassify-aggregate></div>
    `;
    document.body.appendChild(container);
});

afterEach(() => {
    container.remove();
    vi.restoreAllMocks();
});

/** Every console error naming a torn-down store, whichever field raised it. */
function destroyedStoreErrors(): string[] {
    return errors.filter((line) => line.includes('store has been destroyed'));
}

/** One instance over the fixture above, sharing a store the caller owns. */
function mount(store: VanillaEzClassifyStore): EzClassifyUI {
    return new EzClassifyUI(newContext(), {
        root: container,
        rollupId: 'teardown-rollup',
        store,
    });
}

describe('an instance destroyed while its fields are initializing', () => {
    it('reaches no store at all once it is torn down', async () => {
        const context = newContext();
        const store = new VanillaEzClassifyStore(context.scheme);
        const subscribe = vi.spyOn(store, 'subscribe');
        const subscribeAggregate = vi.spyOn(store, 'subscribeAggregate');

        const ui = mount(store);
        // Destroyed in the same tick as the scan, before any init resolves.
        ui.destroy();
        const callsAtTeardown =
            subscribe.mock.calls.length + subscribeAggregate.mock.calls.length;
        await settle();

        expect(
            subscribe.mock.calls.length + subscribeAggregate.mock.calls.length,
        ).toBe(callsAtTeardown);
        store.destroy();
    });

    it('reports no failed mount when its store went with it', async () => {
        const context = newContext();
        const store = new VanillaEzClassifyStore(context.scheme);

        const ui = mount(store);
        // The order every integration tears down in: the instance, then the
        // store it owned alongside it.
        ui.destroy();
        store.destroy();
        await settle();

        expect(destroyedStoreErrors()).toEqual([]);
    });

    it('leaves the replacement instance free to wire the same fields', async () => {
        const first = new VanillaEzClassifyStore(newContext().scheme);
        const firstUi = mount(first);
        firstUi.destroy();
        first.destroy();

        // The StrictMode sequence: a second instance over the same committed
        // DOM, while the first one's inits are still in flight.
        const second = new VanillaEzClassifyStore(newContext().scheme);
        const secondUi = mount(second);
        await settle();

        expect(destroyedStoreErrors()).toEqual([]);
        expect(
            container.querySelectorAll('[data-ezclassify-mount]').length,
        ).toBeGreaterThan(0);

        secondUi.destroy();
        second.destroy();
    });
});
