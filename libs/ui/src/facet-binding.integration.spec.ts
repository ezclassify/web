import { describe, expect, it } from 'vitest';
import { Context } from '@ezclassify/engine';
import scheme from '@ezclassify/example-schemes/schemes/cedar-valley-handling@1.0.0.json';
import { loadCedarValley } from '@ezclassify/example-schemes/cedar-valley';
import {
    EzClassifyUI,
    VanillaEzClassifyStore,
    createEzClassifyFacetBinding,
} from '@ezclassify/ui';

describe('third-party control integration', () => {
    it('drives native single and multiple selects without controller attributes', async () => {
        const context = Context.fromComponents({ scheme });
        const store = new VanillaEzClassifyStore(context.scheme);
        const tierBinding = createEzClassifyFacetBinding(
            store,
            'document',
            'level',
        );
        const handlingBinding = createEzClassifyFacetBinding(
            store,
            'document',
            'handling',
        );
        const level = document.createElement('select');
        const handling = document.createElement('select');
        handling.multiple = true;

        const stopTier = tierBinding.subscribe((snapshot) => {
            level.replaceChildren(
                ...(snapshot.allowableOptions ?? []).map((choice) => {
                    const option = new Option(choice.label, choice.conceptId);
                    option.selected = snapshot.selectedConceptIds.includes(
                        choice.conceptId,
                    );
                    option.disabled = choice.gated === true;
                    return option;
                }),
            );
        });
        const stopHandling = handlingBinding.subscribe((snapshot) => {
            handling.replaceChildren(
                ...(snapshot.allowableOptions ?? []).map((choice) => {
                    const option = new Option(choice.label, choice.conceptId);
                    option.selected = snapshot.selectedConceptIds.includes(
                        choice.conceptId,
                    );
                    option.disabled = choice.gated === true;
                    return option;
                }),
            );
        });
        level.addEventListener('change', () => {
            void tierBinding.setSelected(level.value ? [level.value] : []);
        });
        handling.addEventListener('change', () => {
            void handlingBinding.setSelected(
                Array.from(handling.selectedOptions, (option) => option.value),
            );
        });

        await Promise.all([tierBinding.ready, handlingBinding.ready]);
        expect(level.options.length).toBe(4);
        expect(handling.options.length).toBe(4);
        expect(level.hasAttribute('data-ezclassify-controller')).toBe(false);

        level.value = 'INTERNAL';
        level.dispatchEvent(new Event('change'));
        await vi.waitFor(() => {
            expect(
                store
                    .get('document')
                    .assertions.some(
                        (assertion) =>
                            assertion.categoryId === 'level' &&
                            assertion.conceptId === 'INTERNAL',
                    ),
            ).toBe(true);
        });
        await vi.waitFor(() => {
            expect(
                Array.from(handling.options, (option) => option.value),
            ).toEqual(
                expect.arrayContaining([
                    'DO_NOT_FORWARD',
                    'REDACT_BEFORE_RELEASE',
                    'KEEP_SEALED',
                    'COLLECT_AFTER_USE',
                ]),
            );
        });

        for (const option of Array.from(handling.options)) {
            option.selected =
                option.value === 'DO_NOT_FORWARD' ||
                option.value === 'COLLECT_AFTER_USE';
        }
        handling.dispatchEvent(new Event('change'));
        await vi.waitFor(() => {
            const selected = store
                .get('document')
                .assertions.filter(
                    (assertion) => assertion.categoryId === 'handling',
                )
                .map((assertion) => assertion.conceptId);
            expect(selected).toEqual(
                expect.arrayContaining(['DO_NOT_FORWARD', 'COLLECT_AFTER_USE']),
            );
        });

        stopTier();
        stopHandling();
        tierBinding.destroy();
        handlingBinding.destroy();
        store.destroy();
    });

    it('gives a binding created on an already-resolved facet the same values as the first', async () => {
        const context = Context.fromComponents({ scheme });
        const store = new VanillaEzClassifyStore(context.scheme);

        const first = createEzClassifyFacetBinding(store, 'document', 'level');
        const stopFirst = first.subscribe(() => {});
        await first.ready;
        const settled = first.getSnapshot().allowableOptions;
        expect(settled).not.toBeNull();

        // A second control binds the same (marking, category) after the store
        // has already computed and cached that facet. It must see the cached
        // answer, not wait forever for a change that will never come.
        const second = createEzClassifyFacetBinding(store, 'document', 'level');
        const seen: (typeof settled)[] = [];
        const stopSecond = second.subscribe((snapshot) => {
            seen.push(snapshot.allowableOptions);
        });

        expect(second.getSnapshot().allowableOptions).toEqual(settled);
        expect(seen[0]).toEqual(settled);
        await expect(
            Promise.race([
                second.ready.then(() => 'ready' as const),
                new Promise<'hung'>((resolve) =>
                    setTimeout(() => resolve('hung'), 50),
                ),
            ]),
        ).resolves.toBe('ready');

        stopFirst();
        stopSecond();
        first.destroy();
        second.destroy();
        store.destroy();
    });
});

/** Resolves once the runtime mounted on `root` has seeded the store. */
function runtimeReady(root: HTMLElement): Promise<void> {
    return new Promise((resolve) =>
        root.addEventListener('ezclassify:ready', () => resolve(), {
            once: true,
        }),
    );
}

/**
 * Wait for a runtime's seed, then let the edits that land on top of it finish.
 * The in-process engine answers synchronously, so one macrotask drains them.
 */
async function settle(ready: Promise<void>): Promise<void> {
    await ready;
    await new Promise<void>((tick) => setTimeout(tick, 0));
}

/** A marking host served with `value`, the way a page renders one. */
function markingHost(value: string): HTMLInputElement {
    const host = document.createElement('input');
    host.type = 'hidden';
    host.id = 'doc-marking';
    host.setAttribute('data-ezclassify-rendered', '');
    host.value = value;
    return host;
}

/**
 * A page whose marking host was served with `served`, a facet binding made the
 * way an adapter makes it during component setup, and a runtime constructed
 * after it. `pickFirst` picks before the runtime exists at all; otherwise the
 * test picks while the runtime is still initializing its fields.
 */
function mountPage(served: string, pickFirst = false) {
    const root = document.createElement('div');
    root.appendChild(markingHost(served));
    document.body.appendChild(root);
    const engine = loadCedarValley();
    const store = new VanillaEzClassifyStore(engine);
    const binding = createEzClassifyFacetBinding(
        store,
        'doc-marking',
        'level',
        {
            token: {},
        },
    );
    if (pickFirst) void binding.setSelected(['CONFIDENTIAL']);
    const ready = runtimeReady(root);
    const ui = new EzClassifyUI(engine, { root, store });
    return {
        store,
        binding,
        ready,
        teardown() {
            binding.destroy();
            ui.destroy();
            store.destroy();
            root.remove();
        },
    };
}

describe('facet binding before the runtime has seeded the store', () => {
    it('lands the pick on top of the other served categories', async () => {
        const page = mountPage('INTERNAL//DO NOT FORWARD');
        void page.binding.setSelected(['CONFIDENTIAL']);
        await settle(page.ready);

        expect(page.store.get('doc-marking').rendered).toBe(
            'CONFIDENTIAL//DO NOT FORWARD',
        );
        page.teardown();
    });

    it('keeps a pick made before the runtime exists', async () => {
        const page = mountPage('INTERNAL//DO NOT FORWARD', true);
        await settle(page.ready);

        expect(page.store.get('doc-marking').rendered).toBe(
            'CONFIDENTIAL//DO NOT FORWARD',
        );
        page.teardown();
    });
});

/**
 * One store outliving the runtimes mounted over it, the way an application
 * provider keeps its store across page navigations. Each page serves its own
 * document under the same marking id.
 */
describe('a store shared by one page after another', () => {
    const engine = loadCedarValley();

    function openPage(store: VanillaEzClassifyStore, served: string) {
        const root = document.createElement('div');
        const host = markingHost(served);
        root.appendChild(host);
        document.body.appendChild(root);
        const ready = runtimeReady(root);
        const ui = new EzClassifyUI(engine, { root, store });
        return {
            host,
            ready,
            close() {
                ui.destroy();
                root.remove();
            },
        };
    }

    it('serves the next page its own value after the previous host was removed', async () => {
        const store = new VanillaEzClassifyStore(engine);
        const first = openPage(store, 'INTERNAL');
        await settle(first.ready);
        first.host.remove();
        await settle(Promise.resolve());
        expect(store.get('doc-marking').rendered).toBe('');
        first.close();

        const second = openPage(store, 'RESTRICTED//DO NOT FORWARD');
        await settle(second.ready);

        expect(store.get('doc-marking').rendered).toBe(
            'RESTRICTED//DO NOT FORWARD',
        );
        second.close();
        store.destroy();
    });

    it('keeps the served value under a pick made between two runtimes over the same host', async () => {
        const store = new VanillaEzClassifyStore(engine);
        const root = document.createElement('div');
        root.appendChild(markingHost('INTERNAL//DO NOT FORWARD'));
        document.body.appendChild(root);
        const firstReady = runtimeReady(root);
        const first = new EzClassifyUI(engine, { root, store });
        await settle(firstReady);
        const committed: string[] = [];
        store.subscribe('doc-marking', (state) =>
            committed.push(state.rendered),
        );
        first.destroy();
        await settle(Promise.resolve());

        const binding = createEzClassifyFacetBinding(
            store,
            'doc-marking',
            'level',
            { token: {} },
        );
        await binding.setSelected(['CONFIDENTIAL']);
        const secondReady = runtimeReady(root);
        const second = new EzClassifyUI(engine, { root, store });
        await settle(secondReady);

        expect(committed.length).toBeGreaterThan(0);
        for (const value of committed)
            expect(value).toContain('DO NOT FORWARD');
        binding.destroy();
        second.destroy();
        store.destroy();
        root.remove();
    });

    it('lands a seed still on the wire when its runtime is torn down over the same host', async () => {
        // Every answer arrives on a later task, the way a remote engine's does.
        const late = new Proxy(engine, {
            get(target, prop, receiver) {
                const value = Reflect.get(target, prop, receiver) as unknown;
                if (prop === 'process' && typeof value === 'function') {
                    return async (...args: unknown[]) => {
                        await new Promise<void>((tick) => setTimeout(tick, 5));
                        return (value as (...a: unknown[]) => unknown).apply(
                            target,
                            args,
                        );
                    };
                }
                return typeof value === 'function' ? value.bind(target) : value;
            },
        });
        const store = new VanillaEzClassifyStore(late);
        const root = document.createElement('div');
        root.appendChild(markingHost('INTERNAL//DO NOT FORWARD'));
        document.body.appendChild(root);
        const runtime = new EzClassifyUI(engine, { root, store });
        // Let the fields initialize and the seed go on the wire.
        for (let i = 0; i < 3; i++)
            await new Promise<void>((tick) => setTimeout(tick, 0));

        runtime.destroy();
        await new Promise<void>((tick) => setTimeout(tick, 30));

        expect(store.get('doc-marking').rendered).toBe(
            'INTERNAL//DO NOT FORWARD',
        );
        store.destroy();
        root.remove();
    });

    it('keeps a pick when a runtime is re-created over the same host', async () => {
        const store = new VanillaEzClassifyStore(engine);
        const root = document.createElement('div');
        root.appendChild(markingHost('INTERNAL//DO NOT FORWARD'));
        document.body.appendChild(root);
        const firstReady = runtimeReady(root);
        const first = new EzClassifyUI(engine, { root, store });
        await settle(firstReady);
        const binding = createEzClassifyFacetBinding(
            store,
            'doc-marking',
            'level',
            { token: {} },
        );
        await binding.setSelected(['CONFIDENTIAL']);
        first.destroy();
        await settle(Promise.resolve());

        const secondReady = runtimeReady(root);
        const second = new EzClassifyUI(engine, { root, store });
        await settle(secondReady);

        expect(store.get('doc-marking').rendered).toBe(
            'CONFIDENTIAL//DO NOT FORWARD',
        );
        binding.destroy();
        second.destroy();
        store.destroy();
        root.remove();
    });

    it('serves the next page its own value when a router swaps the page under the same root first', async () => {
        const store = new VanillaEzClassifyStore(engine);
        const root = document.createElement('div');
        const first = document.createElement('section');
        first.appendChild(markingHost('INTERNAL'));
        root.appendChild(first);
        document.body.appendChild(root);
        const firstReady = runtimeReady(root);
        const firstRuntime = new EzClassifyUI(engine, { root, store });
        await settle(firstReady);
        const binding = createEzClassifyFacetBinding(
            store,
            'doc-marking',
            'level',
            { token: {} },
        );
        await binding.setSelected(['CONFIDENTIAL']);
        binding.destroy();

        // The next page's host carries the same id, and it is in place before
        // the first page's runtime is torn down.
        const second = document.createElement('section');
        second.appendChild(markingHost('RESTRICTED//DO NOT FORWARD'));
        root.replaceChild(second, first);
        firstRuntime.destroy();
        await settle(Promise.resolve());
        const secondReady = runtimeReady(root);
        const secondRuntime = new EzClassifyUI(engine, { root, store });
        await settle(secondReady);

        expect(store.get('doc-marking').rendered).toBe(
            'RESTRICTED//DO NOT FORWARD',
        );
        secondRuntime.destroy();
        store.destroy();
        root.remove();
    });

    it('serves the next page its own value when a host mounted after ready leaves with its runtime', async () => {
        const store = new VanillaEzClassifyStore(engine);
        const root = document.createElement('div');
        const first = document.createElement('section');
        root.appendChild(first);
        document.body.appendChild(root);
        const firstReady = runtimeReady(root);
        const firstRuntime = new EzClassifyUI(engine, { root, store });
        await settle(firstReady);
        // A section rendered conditionally, after the runtime is ready.
        first.appendChild(markingHost('INTERNAL'));
        await settle(Promise.resolve());
        const binding = createEzClassifyFacetBinding(
            store,
            'doc-marking',
            'level',
            { token: {} },
        );
        await binding.setSelected(['CONFIDENTIAL']);
        binding.destroy();

        // The DOM goes first and the runtime is torn down in the same task,
        // before its observer could see the host leave.
        first.remove();
        firstRuntime.destroy();
        await settle(Promise.resolve());
        const second = document.createElement('section');
        second.appendChild(markingHost('RESTRICTED//DO NOT FORWARD'));
        root.appendChild(second);
        const secondReady = runtimeReady(root);
        const secondRuntime = new EzClassifyUI(engine, { root, store });
        await settle(secondReady);

        expect(store.get('doc-marking').rendered).toBe(
            'RESTRICTED//DO NOT FORWARD',
        );
        secondRuntime.destroy();
        store.destroy();
        root.remove();
    });

    it('carries a pick made on the next page before its runtime has seeded it', async () => {
        const store = new VanillaEzClassifyStore(engine);
        const first = openPage(store, 'INTERNAL');
        await settle(first.ready);
        first.close();
        await settle(Promise.resolve());

        const binding = createEzClassifyFacetBinding(
            store,
            'doc-marking',
            'level',
            { token: {} },
        );
        await binding.setSelected(['CONFIDENTIAL']);
        const second = openPage(store, 'RESTRICTED//DO NOT FORWARD');
        await settle(second.ready);

        expect(store.get('doc-marking').rendered).toBe(
            'CONFIDENTIAL//DO NOT FORWARD',
        );
        binding.destroy();
        second.close();
        store.destroy();
    });

    it('serves the next page its own value after a host picked before its seed was removed', async () => {
        // The pick lands before the first page's runtime reads its empty host.
        const store = new VanillaEzClassifyStore(engine);
        const binding = createEzClassifyFacetBinding(
            store,
            'doc-marking',
            'level',
            { token: {} },
        );
        await binding.setSelected(['CONFIDENTIAL']);
        binding.destroy();
        const first = openPage(store, '');
        await settle(first.ready);
        expect(store.get('doc-marking').rendered).toBe('CONFIDENTIAL');
        first.host.remove();
        await settle(Promise.resolve());
        expect(store.get('doc-marking').rendered).toBe('');
        first.close();

        const second = openPage(store, 'RESTRICTED//DO NOT FORWARD');
        await settle(second.ready);

        expect(store.get('doc-marking').rendered).toBe(
            'RESTRICTED//DO NOT FORWARD',
        );
        second.close();
        store.destroy();
    });

    it('does not carry a pick made on the previous page onto the next one', async () => {
        const store = new VanillaEzClassifyStore(engine);
        const first = openPage(store, 'INTERNAL');
        await settle(first.ready);
        const binding = createEzClassifyFacetBinding(
            store,
            'doc-marking',
            'level',
            { token: {} },
        );
        await binding.setSelected(['CONFIDENTIAL']);
        expect(store.get('doc-marking').rendered).toBe('CONFIDENTIAL');
        binding.destroy();
        first.close();

        const second = openPage(store, 'RESTRICTED//DO NOT FORWARD');
        await settle(second.ready);

        expect(store.get('doc-marking').rendered).toBe(
            'RESTRICTED//DO NOT FORWARD',
        );
        second.close();
        store.destroy();
    });
});
