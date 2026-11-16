/**
 * `useEzClassifyFacet` under StrictMode, which mounts every effect, cleans it
 * up, and mounts it again. A field has to keep working after that sequence: its
 * change callback must still publish, and its facet must still be computed,
 * whether its store is one the application passes or one its root owns. An
 * `<Activity>` that hides and shows the root runs the same sequence with
 * commits in between, and the root must hand down a live store again.
 */
import React, { Activity, StrictMode, useState } from 'react';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import {
    EzClassify,
    EzClassifyProvider,
    ReactEzClassifyStore,
    useEzClassifyFacet,
    useEzClassifyStore,
    type UseEzClassifyFacetReturn,
} from '@ezclassify/react';
import {
    connectDemoContext,
    demoRuntimeSettled,
} from '../../../test-support/demo-runtime';

afterEach(() => cleanup());

describe('useEzClassifyFacet under StrictMode', () => {
    it('publishes a selection after its effect has been mounted twice', async () => {
        const context = await connectDemoContext({ contextId: 'cedar-valley' });
        const store = new ReactEzClassifyStore(context.scheme);
        let field: UseEzClassifyFacetReturn | null = null;
        function Picker() {
            field = useEzClassifyFacet('document', 'level');
            return null;
        }
        render(
            <StrictMode>
                <EzClassifyProvider context={context}>
                    <EzClassify store={store}>
                        <Picker />
                    </EzClassify>
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
        expect(store.get('document').rendered).toContain('CONFIDENTIAL');
        store.destroy();
    });

    it('publishes a selection to the store its root owns after its effects have been mounted twice', async () => {
        let field: UseEzClassifyFacetReturn | null = null;
        function Picker() {
            field = useEzClassifyFacet('document', 'level');
            return null;
        }
        render(
            <StrictMode>
                <EzClassifyProvider
                    context={await connectDemoContext({
                        contextId: 'cedar-valley',
                    })}>
                    <EzClassify>
                        <Picker />
                    </EzClassify>
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

    it('keeps a root and its fields working after an Activity hides and shows them', async () => {
        let field: UseEzClassifyFacetReturn | null = null;
        let store: ReturnType<typeof useEzClassifyStore> | null = null;
        let setMode: (mode: 'visible' | 'hidden') => void = () => {};
        function Picker() {
            store = useEzClassifyStore();
            field = useEzClassifyFacet('document', 'level');
            return null;
        }
        const context = await connectDemoContext({ contextId: 'cedar-valley' });
        function App() {
            const [mode, set] = useState<'visible' | 'hidden'>('visible');
            setMode = set;
            return (
                <Activity mode={mode}>
                    <EzClassifyProvider context={context}>
                        <EzClassify>
                            <Picker />
                        </EzClassify>
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

    it('still refuses a subscription to an application store destroyed under its root', async () => {
        const context = await connectDemoContext({ contextId: 'cedar-valley' });
        const store = new ReactEzClassifyStore(context.scheme);
        render(
            <EzClassifyProvider context={context}>
                <EzClassify store={store} />
            </EzClassifyProvider>,
        );
        await demoRuntimeSettled();
        store.destroy();

        expect(() => store.subscribe('document', () => {})).toThrow(
            /destroyed/,
        );
    });
});
