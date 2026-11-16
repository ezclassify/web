/**
 * `useEzClassifyRollup(id?, bucket?)` reads one level's roll-up from the root
 * store: one bucket per Context and scheme, never merged, and never picked
 * silently when there is a choice.
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ReactNode } from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import {
    act,
    cleanup,
    render,
    renderHook,
    screen,
} from '@testing-library/react';
import {
    EMPTY_EZCLASSIFY_STATE,
    bucketKey,
    type BucketKey,
    type ContextAdapter,
    type EzClassifyState,
} from '@ezclassify/ui';
import { EzClassifyProvider } from './EzClassifyProvider';
import { EzClassify } from './EzClassify';
import { EzClassifyStoreProvider } from './useEzClassify';
import {
    useEzClassifyRollup,
    type EzClassifyBucket,
} from './useEzClassifyRollup';
import type { ReactEzClassifyStore } from './react-ezclassify-store';
import { connectDemoContext } from '../../../test-support/demo-runtime';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = resolve(__dirname, '../../../vendor/spec/fixtures/v1');
const scheme: unknown = JSON.parse(
    readFileSync(resolve(fixturesDir, 'ref-scheme-1.json'), 'utf8'),
);

async function makeContext(): Promise<ContextAdapter> {
    return (await connectDemoContext({
        draft: { scheme },
    })) as unknown as ContextAdapter;
}

const PRIMARY = bucketKey('', '');
const TIER = bucketKey('', 'tier');

function state(rendered: string): EzClassifyState {
    return { ...EMPTY_EZCLASSIFY_STATE, rendered };
}

/**
 * The aggregate half of a store: levels by id, each holding buckets keyed by
 * Context and scheme, with a commit that notifies the level's listeners.
 */
class LevelStore {
    readonly levels = new Map<
        string | undefined,
        Map<BucketKey, EzClassifyState>
    >();
    readonly listeners = new Map<string | undefined, Set<() => void>>();
    readonly reads: (string | undefined)[] = [];

    getAggregate(id?: string): { byBucket: Map<BucketKey, EzClassifyState> } {
        this.reads.push(id);
        return { byBucket: new Map(this.levels.get(id) ?? []) };
    }

    subscribeAggregate(listener: () => void, id?: string): () => void {
        let set = this.listeners.get(id);
        if (!set) this.listeners.set(id, (set = new Set()));
        set.add(listener);
        return () => set.delete(listener);
    }

    commit(
        id: string | undefined,
        key: BucketKey,
        value: EzClassifyState,
    ): void {
        let level = this.levels.get(id);
        if (!level) this.levels.set(id, (level = new Map()));
        level.set(key, value);
        for (const listener of this.listeners.get(id) ?? []) listener();
    }
}

/** Mount the hook under a provider and the given store. */
function mount(
    store: LevelStore,
    provider:
        | { context: ContextAdapter }
        | { contexts: Record<string, ContextAdapter> },
    id?: string,
    bucket?: EzClassifyBucket,
) {
    const wrapper = ({ children }: { children?: ReactNode }) => (
        <EzClassifyProvider {...provider}>
            <EzClassifyStoreProvider
                store={store as unknown as ReactEzClassifyStore}>
                {children}
            </EzClassifyStoreProvider>
        </EzClassifyProvider>
    );
    return renderHook(() => useEzClassifyRollup(id, bucket), { wrapper });
}

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

describe('useEzClassifyRollup on one Context', () => {
    it('is empty before anything at the level is marked', async () => {
        const { result } = mount(new LevelStore(), {
            context: await makeContext(),
        });
        expect(result.current).toBe(EMPTY_EZCLASSIFY_STATE);
    });

    it('reads the page when given no id, and the named level otherwise', async () => {
        const store = new LevelStore();
        store.levels.set(undefined, new Map([[PRIMARY, state('PAGE')]]));
        store.levels.set('folder', new Map([[PRIMARY, state('FOLDER')]]));

        expect(
            mount(store, { context: await makeContext() }).result.current
                .rendered,
        ).toBe('PAGE');
        expect(
            mount(store, { context: await makeContext() }, 'folder').result
                .current.rendered,
        ).toBe('FOLDER');
    });

    it('follows the level as the store commits', async () => {
        const store = new LevelStore();
        const { result } = mount(
            store,
            { context: await makeContext() },
            'doc',
        );
        act(() => store.commit('doc', PRIMARY, state('HIGH')));
        expect(result.current.rendered).toBe('HIGH');
        act(() => store.commit('doc', PRIMARY, state('LOW')));
        expect(result.current.rendered).toBe('LOW');
    });

    it('keeps its reference when a commit leaves its bucket unchanged', async () => {
        const store = new LevelStore();
        const value = state('HIGH');
        store.levels.set('doc', new Map([[PRIMARY, value]]));
        const { result } = mount(
            store,
            { context: await makeContext() },
            'doc',
        );
        const first = result.current;
        act(() => store.commit('doc', PRIMARY, value));
        expect(result.current).toBe(first);
    });

    it('picks the scheme it names on a Context with several', async () => {
        const store = new LevelStore();
        store.levels.set(
            undefined,
            new Map([
                [PRIMARY, state('ONE')],
                [TIER, state('TWO')],
            ]),
        );
        const { result } = mount(
            store,
            { context: await makeContext() },
            undefined,
            {
                scheme: 'tier',
            },
        );
        expect(result.current.rendered).toBe('TWO');
    });

    it('reads the primary scheme when it names none, whatever another scheme holds', async () => {
        const store = new LevelStore();
        const { result } = mount(store, { context: await makeContext() });
        expect(result.current).toBe(EMPTY_EZCLASSIFY_STATE);
        // Data reaching a second scheme never makes a mounted reader throw.
        act(() => store.commit(undefined, TIER, state('TWO')));
        expect(result.current).toBe(EMPTY_EZCLASSIFY_STATE);
        act(() => store.commit(undefined, PRIMARY, state('ONE')));
        expect(result.current.rendered).toBe('ONE');
    });

    it('stops listening when it unmounts', async () => {
        const store = new LevelStore();
        const { unmount } = mount(
            store,
            { context: await makeContext() },
            'doc',
        );
        expect(store.listeners.get('doc')?.size).toBe(1);
        unmount();
        expect(store.listeners.get('doc')?.size).toBe(0);
    });
});

describe('useEzClassifyRollup on several Contexts', () => {
    const contexts = async () => ({
        capco: await makeContext(),
        cui: await makeContext(),
    });

    it('reads the Context it names and never the other', async () => {
        const store = new LevelStore();
        store.levels.set(
            undefined,
            new Map([
                [bucketKey('capco', ''), state('A')],
                [bucketKey('cui', ''), state('B')],
            ]),
        );
        const { result } = mount(
            store,
            { contexts: await contexts() },
            undefined,
            {
                context: 'cui',
            },
        );
        expect(result.current.rendered).toBe('B');
    });

    it('must name a Context', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        const held = await contexts();
        expect(() => mount(new LevelStore(), { contexts: held })).toThrow(
            /must name its Context.*capco, cui/,
        );
    });

    it('refuses a Context the provider does not hold', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        const held = await contexts();
        expect(() =>
            mount(new LevelStore(), { contexts: held }, undefined, {
                context: 'other',
            }),
        ).toThrow(/does not hold/);
    });
});

describe('useEzClassifyRollup in a root', () => {
    it('shows the page roll-up of a marked field, and lowers with it', async () => {
        function Page() {
            const page = useEzClassifyRollup();
            return <output data-testid="page">{page.rendered}</output>;
        }
        render(
            <EzClassifyProvider context={await makeContext()}>
                <EzClassify>
                    <input
                        id="doc"
                        data-ezclassify-controller="marking"
                        defaultValue="HIGH"
                    />
                    <div
                        data-ezclassify-controller="banner"
                        data-ezclassify-aggregate
                    />
                    <Page />
                </EzClassify>
            </EzClassifyProvider>,
        );
        await settle();
        expect(screen.getByTestId('page').textContent).toBe('HIGH');

        const forms = document.getElementById('doc') as HTMLInputElement;
        await act(async () => {
            forms.value = 'LOW';
            forms.dispatchEvent(new Event('input', { bubbles: true }));
            forms.dispatchEvent(new Event('change', { bubbles: true }));
        });
        await settle();
        expect(screen.getByTestId('page').textContent).toBe('LOW');
    });
});

async function settle(): Promise<void> {
    await act(async () => {
        for (let index = 0; index < 8; index++) {
            await new Promise<void>((tick) => setTimeout(tick, 25));
        }
    });
}
