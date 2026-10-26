/**
 * `useEzClassifyFacet` under StrictMode, which mounts every effect, cleans it
 * up, and mounts it again. A field has to keep working after that sequence: its
 * change callback must still publish, and its facet must still be computed,
 * whether its store comes from a store provider or is owned by an application
 * provider. An `<Activity>` that hides and shows the provider runs the same
 * sequence with commits in between, and the provider must hand down a live
 * store again.
 */
import React, { Activity, StrictMode, useState } from 'react';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { loadCedarValley } from '@ezclassify/example-schemes/cedar-valley';
import {
    EzClassifyProvider,
    EzClassifyStoreProvider,
    ReactEzClassifyStore,
    useEzClassifyFacet,
    useEzClassifyStore,
    type UseEzClassifyFacetReturn,
} from '@ezclassify/react';

afterEach(() => cleanup());

describe('useEzClassifyFacet under StrictMode', () => {
    it('publishes a selection after its effect has been mounted twice', async () => {
        const store = new ReactEzClassifyStore(loadCedarValley());
        let field: UseEzClassifyFacetReturn | null = null;
        function Picker() {
            field = useEzClassifyFacet('document', 'level');
            return null;
        }
        render(
            <StrictMode>
                <EzClassifyStoreProvider store={store}>
                    <Picker />
                </EzClassifyStoreProvider>
            </StrictMode>,
        );
        await waitFor(() => {
            expect(field!.options.length).toBeGreaterThan(0);
        });

        act(() => field!.setValue(['CONFIDENTIAL']));

        await waitFor(() => {
            expect(field!.value).toEqual(['CONFIDENTIAL']);
        });
        expect(store.get('document').rendered).toContain('CONFIDENTIAL');
        store.destroy();
    });

    it('publishes a selection under an application provider after its effects have been mounted twice', async () => {
        let field: UseEzClassifyFacetReturn | null = null;
        function Picker() {
            field = useEzClassifyFacet('document', 'level');
            return null;
        }
        render(
            <StrictMode>
                <EzClassifyProvider engine={loadCedarValley()}>
                    <Picker />
                </EzClassifyProvider>
            </StrictMode>,
        );
        await waitFor(() => {
            expect(field!.options.length).toBeGreaterThan(0);
        });

        act(() => field!.setValue(['CONFIDENTIAL']));

        await waitFor(() => {
            expect(field!.value).toEqual(['CONFIDENTIAL']);
        });
    });

    it('keeps an application provider and its fields working after an Activity hides and shows them', async () => {
        let field: UseEzClassifyFacetReturn | null = null;
        let store: ReturnType<typeof useEzClassifyStore> | null = null;
        let setMode: (mode: 'visible' | 'hidden') => void = () => {};
        function Picker() {
            store = useEzClassifyStore();
            field = useEzClassifyFacet('document', 'level');
            return null;
        }
        const engine = loadCedarValley();
        function App() {
            const [mode, set] = useState<'visible' | 'hidden'>('visible');
            setMode = set;
            return (
                <Activity mode={mode}>
                    <EzClassifyProvider engine={engine}>
                        <Picker />
                    </EzClassifyProvider>
                </Activity>
            );
        }
        const settle = () =>
            act(async () => {
                await new Promise<void>((tick) => setTimeout(tick, 0));
            });
        render(<App />);
        await settle();
        act(() => setMode('hidden'));
        await settle();
        act(() => setMode('visible'));
        await settle();

        expect(() => store!.subscribe('document', () => {})()).not.toThrow();
        act(() => field!.setValue(['CONFIDENTIAL']));
        await waitFor(() => {
            expect(field!.value).toEqual(['CONFIDENTIAL']);
        });
    });

    it('still refuses a subscription to an application store destroyed under the provider', () => {
        const store = new ReactEzClassifyStore(loadCedarValley());
        render(
            <EzClassifyProvider store={store}>
                <></>
            </EzClassifyProvider>,
        );
        store.destroy();

        expect(() => store.subscribe('document', () => {})).toThrow(
            /destroyed/,
        );
    });
});
