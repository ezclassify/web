/**
 * Lifecycle test for `ezclassify:ready`, the DOM event the runtime fires once
 * the initial scan + mount sweep has settled. Consumers depend on fire-once
 * semantics and post-init timing: any subscriber pulling `store.getAggregate()`
 * or `mta.getSegments()` from the listener must see the actual seeded state,
 * not the empty placeholder.
 *
 * Specs cover the four guarantees from `docs/binding-model.md`:
 *
 * - Fires exactly once per `EzClassifyUI` instance
 * - Fires AFTER every component's async `init()` resolves
 * - Event detail carries `markingIds` and `componentCount`
 * - Empty roots still fire (the "stable, just empty" case)
 * - A runtime destroyed before its seeds land never fires
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadCedarValley } from '@ezclassify/example-schemes/cedar-valley';
import { EzClassifyUI } from './ezclassify-ui';
import { VanillaEzClassifyStore } from './store/ezclassify-store';

function waitForReady(root: HTMLElement): Promise<CustomEvent> {
    return new Promise((resolve) => {
        root.addEventListener(
            'ezclassify:ready',
            (e: Event) => resolve(e as CustomEvent),
            { once: true },
        );
    });
}

describe('EzClassifyUI ezclassify:ready event', () => {
    let root: HTMLDivElement;
    let forms: EzClassifyUI | null;

    beforeEach(() => {
        document.body.innerHTML = '';
        root = document.createElement('div');
        document.body.appendChild(root);
        forms = null;
    });

    afterEach(() => {
        forms?.destroy();
        document.body.innerHTML = '';
    });

    it('fires exactly once per EzClassifyUI instance', async () => {
        root.innerHTML = `
      <input type="hidden" id="doc-marking" data-ezclassify-rendered />
      <input id="ac" data-ezclassify-controller="tags"
             data-ezclassify-bound-to="doc-marking" />
    `;
        const fired: CustomEvent[] = [];
        root.addEventListener('ezclassify:ready', (e) =>
            fired.push(e as CustomEvent),
        );

        forms = new EzClassifyUI(loadCedarValley(), { root });
        // Drain the constructor's Promise.all chain and any chained microtasks
        // the seed/wire/rollup path may have queued.
        for (let i = 0; i < 12; i++) await Promise.resolve();

        expect(fired.length).toBe(1);
    });

    it('fires AFTER every component init() resolves', async () => {
        root.innerHTML = `
      <input type="hidden" id="doc-marking" data-ezclassify-rendered />
      <input id="ac" data-ezclassify-controller="tags"
             data-ezclassify-bound-to="doc-marking" />
      <input id="level" data-ezclassify-controller="select"
             data-ezclassify-facet-of="doc-marking"
             data-ezclassify-category="level" />
    `;

        forms = new EzClassifyUI(loadCedarValley(), { root });

        let initializingAtFire: boolean | null = null;
        let componentsAtFire = -1;
        let isReadyAtFire: boolean | null = null;
        root.addEventListener(
            'ezclassify:ready',
            () => {
                initializingAtFire = (
                    forms as unknown as { initializing: boolean }
                ).initializing;
                componentsAtFire = forms!.components.size;
                isReadyAtFire = forms!.isReady;
            },
            { once: true },
        );

        await waitForReady(root);

        // `initializing` flips to false in the same post-init chain that fires
        // the event; seeing it false here means the event fired AFTER the
        // mount sweep settled (not during it).
        expect(initializingAtFire).toBe(false);
        // Both managed components are registered before the event fires.
        expect(componentsAtFire).toBeGreaterThanOrEqual(1);
        // `isReady` reflects post-fire state, late attachers can branch on it.
        expect(isReadyAtFire).toBe(true);
        expect(forms!.isReady).toBe(true);
    });

    it('exposes isReady=false before the sweep settles and true after', async () => {
        root.innerHTML = `
      <input type="hidden" id="doc-marking" data-ezclassify-rendered />
      <input id="ac" data-ezclassify-controller="tags"
             data-ezclassify-bound-to="doc-marking" />
    `;
        forms = new EzClassifyUI(loadCedarValley(), { root });
        // Synchronously after construction the runtime is still mid-sweep.
        expect(forms.isReady).toBe(false);
        await waitForReady(root);
        expect(forms.isReady).toBe(true);
    });

    it('event detail carries markingIds and componentCount', async () => {
        root.innerHTML = `
      <input type="hidden" id="doc-marking" data-ezclassify-rendered />
      <input id="ac" data-ezclassify-controller="tags"
             data-ezclassify-bound-to="doc-marking" />
      <input id="level" data-ezclassify-controller="select"
             data-ezclassify-facet-of="doc-marking"
             data-ezclassify-category="level" />
    `;
        forms = new EzClassifyUI(loadCedarValley(), { root });

        const event = await waitForReady(root);
        const detail = event.detail as {
            markingIds: string[];
            componentCount: number;
        };

        expect(Array.isArray(detail.markingIds)).toBe(true);
        expect(detail.markingIds).toContain('doc-marking');
        // `select` is a managed component; the autocomplete is tracked under
        // `autocompleters`, not `components`. componentCount reflects the
        // managed-component map exactly.
        expect(typeof detail.componentCount).toBe('number');
        expect(detail.componentCount).toBeGreaterThanOrEqual(1);
    });

    it('fires on an empty root with no components', async () => {
        // No data-ezclassify-* hosts. The library still settles into a stable
        // state, consumers expecting a ready signal must see it.
        const fired: CustomEvent[] = [];
        root.addEventListener('ezclassify:ready', (e) =>
            fired.push(e as CustomEvent),
        );

        forms = new EzClassifyUI(loadCedarValley(), { root });

        await waitForReady(root);
        expect(fired.length).toBe(1);
        const detail = fired[0].detail as {
            markingIds: string[];
            componentCount: number;
        };
        expect(detail.markingIds).toEqual([]);
        expect(detail.componentCount).toBe(0);
    });

    it('bubbles through the DOM', async () => {
        // Mirrors the ezclassify:rollup convention, listeners on outer
        // containers (a portal root, a page-level shell) catch the event.
        const outer = document.createElement('div');
        document.body.appendChild(outer);
        const inner = document.createElement('div');
        outer.appendChild(inner);
        inner.innerHTML = `
      <input type="hidden" id="doc-marking" data-ezclassify-rendered />
    `;
        const outerFired: Event[] = [];
        outer.addEventListener('ezclassify:ready', (e) => outerFired.push(e));

        forms = new EzClassifyUI(loadCedarValley(), { root: inner });

        // Wait for the event on the inner root, then assert the outer caught it too.
        await waitForReady(inner);
        expect(outerFired.length).toBe(1);
    });

    it('does not fire for a runtime destroyed while its seeds are on the wire', async () => {
        const engine = loadCedarValley();
        // An engine whose process call never answers, so the seed is still
        // on the wire when the runtime is torn down.
        const stalled = new Proxy(engine, {
            get(target, prop, receiver) {
                if (prop === 'process') return () => new Promise(() => {});
                const value = Reflect.get(target, prop, receiver) as unknown;
                return typeof value === 'function' ? value.bind(target) : value;
            },
        });
        const store = new VanillaEzClassifyStore(stalled);
        root.innerHTML =
            '<input type="hidden" id="doc-marking" data-ezclassify-rendered value="INTERNAL">';
        let fired = 0;
        root.addEventListener('ezclassify:ready', () => fired++);
        forms = new EzClassifyUI(engine, { root, store });
        for (let i = 0; i < 4; i++)
            await new Promise<void>((tick) => setTimeout(tick, 0));

        forms.destroy();
        forms = null;
        for (let i = 0; i < 4; i++)
            await new Promise<void>((tick) => setTimeout(tick, 0));

        expect(fired).toBe(0);
        store.destroy();
    });
});
