import { describe, it, expect } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import type { Assertion, RenderAssessment } from '@ezclassify/types';
import {
    type EzClassifyStoreEngine,
    type EzClassifyStoreProcessResult,
} from '@ezclassify/ui';
import { ReactEzClassifyStore } from './react-ezclassify-store';
import {
    EzClassifyStoreProvider,
    useEzClassify,
    useEzClassifyAssertions,
} from './useEzClassify';

/** What a write that wrote everything it was given reports. */
const EMPTY_RENDER_ASSESSMENT: RenderAssessment = {
    emitted: [],
    omitted: [],
    collapsed: [],
    conflicts: [],
    unrepresentable: [],
};

function passThroughEngine(): EzClassifyStoreEngine {
    return {
        process(input): EzClassifyStoreProcessResult {
            const rendered =
                typeof input === 'string'
                    ? input
                    : (input as Assertion[])
                          .map((a) => `${a.categoryId}:${a.conceptId}`)
                          .join(' ');
            return {
                rendered,
                assessment: EMPTY_RENDER_ASSESSMENT,
                renders: {},
                assertions: [],
                valid: true,
                errors: [],
            };
        },
        render(assertions) {
            return (assertions as Assertion[])
                .map((a) => `${a.categoryId}:${a.conceptId}`)
                .join(' ');
        },
        aggregate: () => ({
            rendered: '',
            assertions: [],
            valid: true,
            errors: [],
        }),
        aggregateAssertions: (sets: Assertion[][]) => {
            const merged = sets.flat();
            return {
                rendered: merged
                    .map((a) => `${a.categoryId}:${a.conceptId}`)
                    .join(' '),
                assertions: merged,
                valid: true,
                errors: [],
            };
        },
        getSchemeMeta: () => ({ scopes: [] }),
        listCategories: () => [],
    };
}

function Marking({ id }: { id: string }) {
    const [state, setRendered] = useEzClassify(id);
    return (
        <div>
            <span data-testid="rendered">{state.rendered}</span>
            <button onClick={() => setRendered('tier:secret')}>publish</button>
        </div>
    );
}

describe('useEzClassify hook', () => {
    it('renders the empty state, then the published value', async () => {
        const store = new ReactEzClassifyStore(passThroughEngine());
        render(
            <EzClassifyStoreProvider store={store}>
                <Marking id="doc" />
            </EzClassifyStoreProvider>,
        );
        expect(screen.getByTestId('rendered').textContent).toBe('');
        await act(async () => {
            await store.publishRendered('doc', 'tier:secret');
        });
        expect(screen.getByTestId('rendered').textContent).toBe('tier:secret');
    });

    it('useEzClassifyAssertions publishes assertions to the store', async () => {
        const store = new ReactEzClassifyStore(passThroughEngine());
        function AssertionMarking({ id }: { id: string }) {
            const [state, setAssertions] = useEzClassifyAssertions(id);
            return (
                <div>
                    <span data-testid="rendered">{state.rendered}</span>
                    <button
                        onClick={() =>
                            setAssertions([
                                {
                                    categoryId: 'tier',
                                    conceptId: 'secret',
                                } as Assertion,
                            ])
                        }>
                        publish
                    </button>
                </div>
            );
        }
        render(
            <EzClassifyStoreProvider store={store}>
                <AssertionMarking id="doc" />
            </EzClassifyStoreProvider>,
        );
        expect(screen.getByTestId('rendered').textContent).toBe('');
        await act(async () => {
            await store.publishAssertions('doc', [
                { categoryId: 'tier', conceptId: 'secret' } as Assertion,
            ]);
        });
        expect(screen.getByTestId('rendered').textContent).not.toBe('');
    });

    it('reports a failed publish instead of leaking an unhandled rejection', async () => {
        // A REST-backed engine rejects on a 5xx or a dropped connection. The
        // setter returns void by contract, so the promise has to be handled
        // here or the rejection escapes the component; under Node and SSR
        // hosts that treat unhandled rejections as fatal, it takes the process
        // with it.
        const failing = passThroughEngine();
        failing.process = () => Promise.reject(new Error('gateway timeout'));
        const store = new ReactEzClassifyStore(failing);
        const unhandled: unknown[] = [];
        const onUnhandled = (event: PromiseRejectionEvent) => {
            unhandled.push(event.reason);
        };
        window.addEventListener('unhandledrejection', onUnhandled);
        const errors: unknown[] = [];
        const origErr = console.error;
        console.error = (...args: unknown[]) => errors.push(args);

        try {
            render(
                <EzClassifyStoreProvider store={store}>
                    <Marking id="doc" />
                </EzClassifyStoreProvider>,
            );
            await act(async () => {
                screen.getByText('publish').click();
                await Promise.resolve();
                await Promise.resolve();
            });
        } finally {
            console.error = origErr;
            window.removeEventListener('unhandledrejection', onUnhandled);
        }

        expect(unhandled).toEqual([]);
        expect(JSON.stringify(errors)).toContain('publishing marking');
        expect(screen.getByTestId('rendered').textContent).toBe('');
    });

    it('throws when used without a provider', () => {
        function NoProvider() {
            useEzClassify('doc');
            return null;
        }
        // React 19 surfaces the error via the boundary; explicit assertion via console suppression.
        const origErr = console.error;
        console.error = () => {};
        try {
            expect(() => render(<NoProvider />)).toThrow(
                /EzClassifyStoreProvider/,
            );
        } finally {
            console.error = origErr;
        }
    });
});
