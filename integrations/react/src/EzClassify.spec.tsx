/**
 * The integration entry points through the package entry: one
 * `<EzClassifyProvider context>` names the Context, each `<EzClassify>` root
 * owns its store and runtime, and code inside a root reaches them through
 * hooks.
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    Component,
    useEffect,
    useMemo,
    useState,
    type ReactElement,
    type ReactNode,
} from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { Context } from '@ezclassify/engine';
import { schemeOnlyContext } from '../../../libs/ui/test-fixtures/context-doubles';
import type { ContextAdapter, FavoritesConfig } from '@ezclassify/ui';
import {
    EzClassify,
    EzClassifyProvider,
    ReactEzClassifyStore,
    useEzClassify,
    useEzClassifyStore,
    useEzClassifyUI,
    type EzClassifyOptions,
    type EzClassifyProviderProps,
} from './index';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = resolve(__dirname, '../../../vendor/spec/fixtures/v1');
const scheme: unknown = JSON.parse(
    readFileSync(resolve(fixturesDir, 'ref-scheme-1.json'), 'utf8'),
);

/** A Context over the reference scheme, with its own component engines. */
function makeContext(): ContextAdapter {
    return Context.fromComponents({ scheme }) as unknown as ContextAdapter;
}

/** Flush React effects plus the runtime's async component init. */
async function flush(): Promise<void> {
    await act(async () => {
        for (let index = 0; index < 6; index++) {
            await new Promise<void>((tick) => setTimeout(tick, 25));
        }
    });
}

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

/** Records what a component inside a root sees. */
function Probe({
    seen,
}: {
    seen: { store?: ReactEzClassifyStore; forms?: unknown }[];
}): null {
    const store = useEzClassifyStore();
    const forms = useEzClassifyUI();
    seen.push({ store, forms });
    return null;
}

function last<T>(items: T[]): T {
    const item = items[items.length - 1];
    if (item === undefined) throw new Error('nothing recorded');
    return item;
}

describe('<EzClassify> under <EzClassifyProvider context>', () => {
    it('gives the code inside a root its store and, once started, its runtime', async () => {
        const seen: { store?: ReactEzClassifyStore; forms?: unknown }[] = [];
        render(
            <EzClassifyProvider context={makeContext()}>
                <EzClassify>
                    <textarea data-ezclassify-controller="marking" />
                    <Probe seen={seen} />
                </EzClassify>
            </EzClassifyProvider>,
        );
        await flush();

        const { store, forms } = last(seen);
        expect(store).toBeInstanceOf(ReactEzClassifyStore);
        expect(forms).not.toBeNull();
        expect(
            document.querySelectorAll('[data-ezclassify-mount]'),
        ).toHaveLength(1);
    });

    it('scans only inside its own element, which carries no role', async () => {
        let root: HTMLElement | null = null;
        function Root(): null {
            root = useEzClassifyUI()?.root ?? null;
            return null;
        }
        const { container } = render(
            <EzClassifyProvider context={makeContext()}>
                <EzClassify>
                    <Root />
                </EzClassify>
            </EzClassifyProvider>,
        );
        await flush();

        expect(root).toBe(container.firstElementChild);
        expect((root as HTMLElement | null)?.hasAttribute('role')).toBe(false);
    });

    it('lets a bound field publish through the root store', async () => {
        // The publisher is skipped on its own commit, so a second component
        // shows what the root store now holds.
        function Editor(): ReactElement {
            const [, setRendered] = useEzClassify('doc');
            return <button onClick={() => setRendered('HIGH')}>mark</button>;
        }
        function Display(): ReactElement {
            const [state] = useEzClassify('doc');
            return <output>{state.rendered || 'empty'}</output>;
        }
        render(
            <EzClassifyProvider context={makeContext()}>
                <EzClassify>
                    <Editor />
                    <Display />
                </EzClassify>
            </EzClassifyProvider>,
        );
        await flush();
        await act(async () => {
            screen.getByRole('button').click();
        });
        await flush();

        expect(screen.getByRole('status').textContent).toBe('HIGH');
    });

    it('gives each root its own store', async () => {
        const first: { store?: ReactEzClassifyStore }[] = [];
        const second: { store?: ReactEzClassifyStore }[] = [];
        render(
            <EzClassifyProvider context={makeContext()}>
                <EzClassify>
                    <Probe seen={first} />
                </EzClassify>
                <EzClassify>
                    <Probe seen={second} />
                </EzClassify>
            </EzClassifyProvider>,
        );
        await flush();

        expect(last(first).store).not.toBe(last(second).store);
    });

    it('binds a store the application passes and leaves it alive on unmount', async () => {
        const context = makeContext();
        const store = new ReactEzClassifyStore(context.scheme);
        const seen: { store?: ReactEzClassifyStore }[] = [];
        const page = render(
            <EzClassifyProvider context={context}>
                <EzClassify store={store}>
                    <Probe seen={seen} />
                </EzClassify>
            </EzClassifyProvider>,
        );
        await flush();
        expect(last(seen).store).toBe(store);

        page.unmount();
        await flush();
        await expect(
            store.publishRendered('doc', 'HIGH'),
        ).resolves.toBeUndefined();
        store.destroy();
    });

    it('destroys the store it built when it unmounts', async () => {
        const seen: { store?: ReactEzClassifyStore }[] = [];
        const page = render(
            <EzClassifyProvider context={makeContext()}>
                <EzClassify>
                    <Probe seen={seen} />
                </EzClassify>
            </EzClassifyProvider>,
        );
        await flush();
        const store = last(seen).store;

        page.unmount();
        await flush();
        await expect(store?.publishRendered('doc', 'HIGH')).rejects.toThrow();
    });

    it('keeps the scanned subtree when its parent re-renders', async () => {
        // One Context for every pass, so only the parent's own render moves.
        const context = makeContext();
        function Stable({ tick }: { tick: number }): ReactElement {
            return (
                <EzClassifyProvider context={context}>
                    <span>{tick}</span>
                    <EzClassify>
                        <textarea
                            data-testid="host"
                            data-ezclassify-controller="marking"
                        />
                    </EzClassify>
                </EzClassifyProvider>
            );
        }
        const page = render(<Stable tick={0} />);
        await flush();
        const host = screen.getByTestId('host');
        const mount = document.querySelector('[data-ezclassify-mount]');

        page.rerender(<Stable tick={1} />);
        await flush();

        expect(screen.getByTestId('host')).toBe(host);
        expect(document.querySelector('[data-ezclassify-mount]')).toBe(mount);
        expect(mount?.isConnected).toBe(true);
    });

    it('surfaces a runtime that cannot start to the nearest error boundary', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        const context = makeContext();
        const released = new ReactEzClassifyStore(context.scheme);
        released.destroy();
        render(
            <EzClassifyProvider context={context}>
                <Boundary>
                    <EzClassify store={released}>
                        <textarea data-ezclassify-controller="marking" />
                    </EzClassify>
                </Boundary>
            </EzClassifyProvider>,
        );
        await flush();

        expect(screen.getByRole('alert').textContent).toMatch(/destroyed/i);
    });

    it('refuses a root with no provider above it', () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        expect(() => render(<EzClassify />)).toThrow(/EzClassifyProvider/);
    });
});

describe('<EzClassifyProvider> props', () => {
    it('refuses both `context` and `contexts`', () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        const context = makeContext();
        const props = {
            context,
            contexts: { a: context },
        } as unknown as EzClassifyProviderProps;
        expect(() => render(<EzClassifyProvider {...props} />)).toThrow(
            /not both/,
        );
    });

    it('refuses neither', () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        const props = {} as unknown as EzClassifyProviderProps;
        expect(() => render(<EzClassifyProvider {...props} />)).toThrow(
            /connected Context/,
        );
    });

    it('starts a root over several Contexts by key', async () => {
        const seen: { forms?: unknown }[] = [];
        render(
            <EzClassifyProvider
                contexts={{ first: makeContext(), second: makeContext() }}>
                <EzClassify>
                    <div data-ezclassify-context="first">
                        <textarea data-ezclassify-controller="marking" />
                    </div>
                    <div data-ezclassify-context="second">
                        <textarea data-ezclassify-controller="marking" />
                    </div>
                    <Probe seen={seen} />
                </EzClassify>
            </EzClassifyProvider>,
        );
        await flush();

        expect(last(seen).forms).not.toBeNull();
        expect(
            document.querySelectorAll('[data-ezclassify-mount]'),
        ).toHaveLength(2);
    });

    it('applies its presentation options to the roots below', async () => {
        const favorites: FavoritesConfig = { load: () => [] };
        function Page({ options }: { options?: EzClassifyOptions }) {
            return (
                <EzClassifyProvider context={makeContext()} options={options}>
                    <EzClassify>
                        <input data-ezclassify-controller="tags" id="tags" />
                    </EzClassify>
                </EzClassifyProvider>
            );
        }
        const withFavorites = render(<Page options={{ favorites }} />);
        await flush();
        expect(
            withFavorites.container.querySelector('.ez-favorites-button'),
        ).not.toBeNull();
        withFavorites.unmount();

        const without = render(<Page />);
        await flush();
        expect(
            without.container.querySelector('.ez-favorites-button'),
        ).toBeNull();
    });
});

describe('a Context composed inline in a render body', () => {
    /** Counts renders and the stores the root hands down. */
    interface Count {
        renders: number;
        stores: Set<ReactEzClassifyStore>;
    }

    function Stores({ count }: { count: Count }): null {
        count.stores.add(useEzClassifyStore());
        return null;
    }

    function Inline({
        engine,
        count,
    }: {
        engine: ContextAdapter['scheme'];
        count: Count;
    }): ReactElement {
        count.renders++;
        // A runaway re-initialization re-renders without bound; fail fast.
        if (count.renders > 50) throw new Error('render storm');
        // A fresh wrapper over the same scheme engine on every pass.
        const context = schemeOnlyContext(engine);
        return (
            <EzClassifyProvider context={context}>
                <EzClassify>
                    <input data-ezclassify-controller="tags" />
                    <Stores count={count} />
                </EzClassify>
            </EzClassifyProvider>
        );
    }

    it('builds one store across re-renders that hand over a new wrapper', async () => {
        const engine = makeContext().scheme;
        const count: Count = { renders: 0, stores: new Set() };
        const page = render(<Inline engine={engine} count={count} />);
        await flush();
        for (let pass = 0; pass < 5; pass++) {
            page.rerender(<Inline engine={engine} count={count} />);
            await flush();
        }

        expect(count.stores.size).toBe(1);
        expect(count.renders).toBeLessThan(20);
    });

    it('rebuilds when the Context is genuinely different', async () => {
        const count: Count = { renders: 0, stores: new Set() };
        const page = render(
            <Inline engine={makeContext().scheme} count={count} />,
        );
        await flush();
        page.rerender(<Inline engine={makeContext().scheme} count={count} />);
        await flush();

        expect(count.stores.size).toBe(2);
    });

    it('builds one store for a caller that memoizes the Context', async () => {
        const count: Count = { renders: 0, stores: new Set() };
        function Memoized(): ReactElement {
            const context = useMemo(() => makeContext(), []);
            const [, setTick] = useState(0);
            useEffect(() => setTick(1), []);
            return (
                <EzClassifyProvider context={context}>
                    <EzClassify>
                        <Stores count={count} />
                    </EzClassify>
                </EzClassifyProvider>
            );
        }
        render(<Memoized />);
        await flush();

        expect(count.stores.size).toBe(1);
    });
});

/** Shows what reached it as an alert, the way an application boundary would. */
class Boundary extends Component<{ children?: ReactNode }, { error: unknown }> {
    override state: { error: unknown } = { error: null };

    static getDerivedStateFromError(error: unknown): { error: unknown } {
        return { error };
    }

    override render(): ReactNode {
        if (this.state.error) {
            return <p role="alert">{String(this.state.error)}</p>;
        }
        return this.props.children;
    }
}
