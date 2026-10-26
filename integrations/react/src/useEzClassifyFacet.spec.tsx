import React, { StrictMode, useEffect, useState, type ReactNode } from 'react';
import {
    act,
    cleanup,
    render,
    renderHook,
    waitFor,
} from '@testing-library/react';
import { loadCedarValley } from '@ezclassify/example-schemes/cedar-valley';
import {
    EzClassifyProvider,
    EzClassifyStoreProvider,
    ReactEzClassifyStore,
    useEzClassifyFacet,
    useEzClassifyStore,
    useSchemeEngine,
    type UseEzClassifyFacetReturn,
} from '@ezclassify/react';
import { publishFacetSelection } from '@ezclassify/ui';

describe('useEzClassifyFacet', () => {
    it('owns one native subscription per cell and releases both on unmount', async () => {
        const store = new ReactEzClassifyStore(loadCedarValley());
        const marking = vi.spyOn(store, 'subscribe');
        const facet = vi.spyOn(store, 'subscribeFacet');
        const wrapper = ({ children }: { children: ReactNode }) => (
            <EzClassifyStoreProvider store={store}>
                {children}
            </EzClassifyStoreProvider>
        );
        const { result, unmount } = renderHook(
            () => useEzClassifyFacet('document', 'level'),
            { wrapper },
        );
        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(marking).toHaveBeenCalledTimes(1);
        expect(facet).toHaveBeenCalledTimes(1);
        unmount();
        const suggest = vi.spyOn(store['engine']!, 'suggestForCategories');
        await store.publishRendered('document', 'INTERNAL');
        expect(suggest).not.toHaveBeenCalled();
        store.destroy();
    });

    it('exposes controlled value, options, validation, and updates', async () => {
        const store = new ReactEzClassifyStore(loadCedarValley());
        await store.publishRendered('document', 'INTERNAL');
        const wrapper = ({ children }: { children: ReactNode }) => (
            <EzClassifyStoreProvider store={store}>
                {children}
            </EzClassifyStoreProvider>
        );
        const { result, unmount } = renderHook(
            () => useEzClassifyFacet('document', 'level'),
            { wrapper },
        );

        await waitFor(() => {
            expect(result.current.options.length).toBeGreaterThan(0);
        });
        expect(result.current.value).toContain('INTERNAL');

        act(() => result.current.setValue(['CONFIDENTIAL']));
        await waitFor(() => {
            expect(result.current.value).toEqual(['CONFIDENTIAL']);
            expect(result.current.rendered).toContain('CONFIDENTIAL');
        });

        unmount();
        store.destroy();
    });

    it('projects the store cells rather than holding a copy of them', async () => {
        const store = new ReactEzClassifyStore(loadCedarValley());
        const wrapper = ({ children }: { children: ReactNode }) => (
            <EzClassifyStoreProvider store={store}>
                {children}
            </EzClassifyStoreProvider>
        );
        const { result, unmount } = renderHook(
            () => useEzClassifyFacet('document', 'level'),
            { wrapper },
        );
        await waitFor(() => {
            expect(result.current.options.length).toBeGreaterThan(0);
        });

        // A publish made straight against the store, with nothing routed through
        // the hook, still moves the hook: the cells are the state, not a mirror
        // the hook keeps in step.
        await act(async () => {
            await store.publishRendered('document', 'INTERNAL');
        });
        await waitFor(() => {
            expect(result.current.value).toEqual(['INTERNAL']);
        });
        expect(result.current.options).toEqual(
            store.getFacet('document', 'level').allowableOptions,
        );
        expect(result.current.rendered).toBe(store.get('document').rendered);

        unmount();
        store.destroy();
    });
});

/**
 * Wait for the runtime's seed, then let the edits that land on top of it
 * finish. The in-process engine answers synchronously, so one macrotask drains
 * them.
 */
async function settleRuntime(ready: Promise<void>): Promise<void> {
    await act(async () => {
        await ready;
        await new Promise<void>((tick) => setTimeout(tick, 0));
    });
}

describe('useEzClassifyFacet before the runtime has mounted', () => {
    let facet: UseEzClassifyFacetReturn | null = null;

    afterEach(() => {
        cleanup();
        facet = null;
    });

    function Picker({ pickInEffect }: { pickInEffect: boolean }) {
        const field = useEzClassifyFacet('doc-marking', 'level');
        facet = field;
        useEffect(() => {
            // A child's effect runs before its parent's, so this pick is made
            // before useSchemeEngine has even constructed the runtime.
            if (pickInEffect) field.setValue(['CONFIDENTIAL']);
            // eslint-disable-next-line react-hooks/exhaustive-deps
        }, []);
        return null;
    }

    function Form({
        engine,
        served,
        pickInEffect,
    }: {
        engine?: ReturnType<typeof loadCedarValley>;
        served: string;
        pickInEffect: boolean;
    }) {
        const { Container } = useSchemeEngine(engine);
        return (
            <Container>
                <input
                    type="hidden"
                    id="doc-marking"
                    data-ezclassify-rendered=""
                    defaultValue={served}
                />
                <Picker pickInEffect={pickInEffect} />
            </Container>
        );
    }

    /**
     * A form whose runtime mounts over a marking host served with `INTERNAL//DO
     * NOT FORWARD`, and a facet picker inside it whose effect picks before the
     * runtime exists.
     */
    it('keeps a pick made before the runtime exists, on top of the served value', async () => {
        const ready = new Promise<void>((resolve) =>
            document.addEventListener('ezclassify:ready', () => resolve(), {
                once: true,
            }),
        );
        act(() => {
            render(
                <Form
                    engine={loadCedarValley()}
                    served="INTERNAL//DO NOT FORWARD"
                    pickInEffect
                />,
            );
        });
        await settleRuntime(ready);

        expect(facet!.value).toEqual(['CONFIDENTIAL']);
        expect(facet!.rendered).toBe('CONFIDENTIAL//DO NOT FORWARD');
    });
});

/**
 * An application-level provider owns the store, a toolbar outside the form
 * picks a level, and the form whose runtime seeds the marking mounts later.
 * Under StrictMode that runtime is mounted, torn down and mounted again over
 * the same host before it seeds.
 */
describe.each([false, true])(
    'a pick made before the form mounts, under an application provider (StrictMode %s)',
    (strict) => {
        let toolbar: {
            store: ReturnType<typeof useEzClassifyStore>;
            facet: UseEzClassifyFacetReturn;
        } | null = null;
        let showForm: (show: boolean) => void = () => {};

        afterEach(() => {
            cleanup();
            toolbar = null;
        });

        function Toolbar() {
            toolbar = {
                store: useEzClassifyStore(),
                facet: useEzClassifyFacet('doc-marking', 'level'),
            };
            return null;
        }
        function Form() {
            const { Container } = useSchemeEngine();
            return (
                <Container>
                    <input
                        type="hidden"
                        id="doc-marking"
                        data-ezclassify-rendered=""
                        defaultValue="INTERNAL//DO NOT FORWARD"
                    />
                </Container>
            );
        }
        function Page() {
            const [show, setShow] = useState(false);
            showForm = setShow;
            return (
                <>
                    <Toolbar />
                    {show ? <Form /> : null}
                </>
            );
        }

        function mountApp(): void {
            const app = (
                <EzClassifyProvider engine={loadCedarValley()}>
                    <Page />
                </EzClassifyProvider>
            );
            act(() => {
                render(strict ? <StrictMode>{app}</StrictMode> : app);
            });
        }

        async function mountForm(): Promise<void> {
            const ready = new Promise<void>((resolve) =>
                document.addEventListener('ezclassify:ready', () => resolve(), {
                    once: true,
                }),
            );
            act(() => showForm(true));
            await settleRuntime(ready);
        }

        it('keeps a pick published to the store', async () => {
            mountApp();
            await act(async () => {
                await publishFacetSelection(
                    toolbar!.store,
                    'doc-marking',
                    'level',
                    ['CONFIDENTIAL'],
                );
            });

            await mountForm();

            expect(toolbar!.store.get('doc-marking').rendered).toBe(
                'CONFIDENTIAL//DO NOT FORWARD',
            );
        });

        it('keeps a pick made in a toolbar facet', async () => {
            mountApp();
            await act(async () => {
                toolbar!.facet.setValue(['CONFIDENTIAL']);
                await new Promise<void>((tick) => setTimeout(tick, 0));
            });
            expect(toolbar!.facet.value).toEqual(['CONFIDENTIAL']);

            await mountForm();

            expect(toolbar!.facet.rendered).toBe(
                'CONFIDENTIAL//DO NOT FORWARD',
            );
        });
    },
);
