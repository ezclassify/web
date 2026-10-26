/**
 * Public-API surface test: imports go through the package entry
 * (`@ezclassify/react` → src/index.ts, same resolution the built package
 * exposes) rather than deep lib paths. Guards against exports silently falling
 * off the entry point, and pins the provision contract: one app-level
 * `<EzClassifyProvider engine={...}>` is enough for a descendant to run the
 * forms runtime and bind markings without restating the engine, and a per-call
 * engine argument overrides it for that subtree.
 */
import { render, renderHook, screen, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { Context } from '@ezclassify/engine';
import type { SchemeEngineAdapter } from '@ezclassify/types';
import {
    EzClassifyProvider,
    ReactEzClassifyStore,
    useEzClassify,
    useEzClassifyProvision,
    useEzClassifyStore,
    useSchemeEngine,
    type UseSchemeEngineOptions,
} from '@ezclassify/react';

const testProfile = {
    scheme: {
        id: 'public-api-test',
        version: '1.0.0',
        default_scope: 'marking',
        scopes: [{ id: 'marking', label: 'Marking' }],
        name: 'Public API Test',
        description: '',
        data: {
            categories: [
                {
                    id: 'level',
                    label: 'Level',
                    required: true,
                    single: true,
                    rollup: 'max',
                    position: 0,
                    hierarchy_root: true,
                },
            ],
            concepts: {
                inline: [
                    {
                        id: 'LEVEL-LOW',
                        name: 'Level Low',
                        views: { default: 'LEVEL-LOW' },
                        categories: ['level'],
                        parents: [],
                        position: 0,
                        rank: 0,
                    },
                    {
                        id: 'LEVEL-HIGH',
                        name: 'Level High',
                        views: { default: 'LEVEL-HIGH' },
                        categories: ['level'],
                        parents: [],
                        position: 1,
                        rank: 1,
                    },
                ],
            },
        },
        rules: [],
        parse: {
            case_sensitive: false,
            strip_whitespace: true,
        },
        render: {
            default: 'default',
            formats: [
                {
                    id: 'default',
                    surface: 'marking',
                    mode: 'inline',
                    fields: [{ category: 'level', separator: '/' }],
                },
            ],
        },
    },
};

function buildEngine(): SchemeEngineAdapter {
    return Context.fromComponents({ scheme: testProfile })
        .scheme as SchemeEngineAdapter;
}

function wrapperFor(
    props: Omit<Parameters<typeof EzClassifyProvider>[0], 'children'>,
) {
    return ({ children }: { children?: ReactNode }) =>
        createElement(EzClassifyProvider, { ...props, children });
}

describe('public API: provision surface', () => {
    it('exports the provision surface from the package entry', () => {
        expect(typeof EzClassifyProvider).toBe('function');
        expect(typeof useEzClassifyProvision).toBe('function');
        expect(typeof useSchemeEngine).toBe('function');
    });

    it('gives a descendant a store without any useSchemeEngine call', async () => {
        const engine = buildEngine();
        const { result } = renderHook(() => useEzClassify('doc'), {
            wrapper: wrapperFor({ engine }),
        });
        expect(result.current[0].rendered).toBe('');
    });

    it('takes a composed context and binds the store to its scheme surface', async () => {
        const context = Context.fromComponents({ scheme: testProfile });
        const { result } = renderHook(() => useEzClassifyStore(), {
            wrapper: wrapperFor({ engine: context }),
        });
        const store = result.current;
        expect(store).toBeInstanceOf(ReactEzClassifyStore);
        await store.publishRendered('doc', 'LEVEL-HIGH');
        expect(store.get('doc').rendered).toBe('LEVEL-HIGH');
    });

    it('lets useSchemeEngine() mount the scanner with no engine argument', async () => {
        const engine = buildEngine();
        const seen: ReturnType<typeof useSchemeEngine>[] = [];
        function Host() {
            const bound = useSchemeEngine();
            seen.push(bound);
            return createElement(bound.Container, {});
        }
        render(
            createElement(EzClassifyProvider, { engine }, createElement(Host)),
        );
        await waitFor(() => expect(seen[seen.length - 1].forms).not.toBeNull());
        expect(seen[seen.length - 1].store).toBeInstanceOf(
            ReactEzClassifyStore,
        );
    });

    it('binds the app-level store rather than building a second one over the same engine', async () => {
        const engine = buildEngine();
        const appStore = new ReactEzClassifyStore(engine);
        const { result, unmount } = renderHook(() => useSchemeEngine(), {
            wrapper: wrapperFor({ store: appStore }),
        });
        expect(result.current.store).toBe(appStore);

        // A store the app owns survives the hook that borrowed it.
        unmount();
        await expect(
            appStore.publishRendered('doc', 'LEVEL-LOW'),
        ).resolves.toBeUndefined();
        appStore.destroy();
    });

    it('treats a per-call engine as an override with its own store', async () => {
        const appEngine = buildEngine();
        const appStore = new ReactEzClassifyStore(appEngine);
        const overrideEngine = buildEngine();
        const seen: ReturnType<typeof useSchemeEngine>[] = [];
        function Host() {
            const bound = useSchemeEngine(overrideEngine);
            seen.push(bound);
            return createElement(bound.Container, {});
        }
        render(
            createElement(
                EzClassifyProvider,
                { store: appStore },
                createElement(Host),
            ),
        );
        await waitFor(() => expect(seen[seen.length - 1].store).not.toBeNull());
        expect(seen[seen.length - 1].store).not.toBe(appStore);
        appStore.destroy();
    });

    it('merges per-call options over the app-level options', async () => {
        const engine = buildEngine();
        const seen: ReturnType<typeof useSchemeEngine>[] = [];
        function Host({ options }: { options?: UseSchemeEngineOptions }) {
            const bound = useSchemeEngine(null, options);
            seen.push(bound);
            return createElement(bound.Container, {});
        }
        async function rollupIdFor(
            options?: UseSchemeEngineOptions,
        ): Promise<string | undefined> {
            seen.length = 0;
            render(
                createElement(
                    EzClassifyProvider,
                    { engine, options: { rollupId: 'app-rollup' } },
                    createElement(Host, { options }),
                ),
            );
            await waitFor(() =>
                expect(seen[seen.length - 1].forms).not.toBeNull(),
            );
            // The container is empty, so the only hidden input under the
            // runtime's root is the rollup sink it created.
            return seen[
                seen.length - 1
            ].forms?.root.querySelector<HTMLInputElement>(
                'input[type="hidden"]',
            )?.id;
        }

        // A key the call does not set keeps the app-level value; a key it does
        // set wins. The rollup sink is named after the option in force.
        expect(await rollupIdFor()).toBe('app-rollup');
        expect(await rollupIdFor({ rollupId: 'call-rollup' })).toBe(
            'call-rollup',
        );
    });

    it('reads the app-level provision back through useEzClassifyProvision', () => {
        const engine = buildEngine();
        function Probe() {
            const provision = useEzClassifyProvision();
            return createElement(
                'div',
                { 'data-testid': 'rollup' },
                provision?.options.rollupId ?? 'none',
            );
        }
        render(
            createElement(
                EzClassifyProvider,
                { engine, options: { rollupId: 'app-rollup' } },
                createElement(Probe),
            ),
        );
        expect(screen.getByTestId('rollup').textContent).toBe('app-rollup');
    });
});
