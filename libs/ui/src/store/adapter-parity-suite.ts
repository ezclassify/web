/**
 * Adapter parity contract suite: the permanent cross-framework gate for
 * lossless transport (the render-as-transport bug class).
 *
 * `BaseEzClassifyStore` owns all engine-facing logic; the React, Vue, Angular,
 * and vanilla adapters differ only in their reactive cell. A lossless-transport
 * fix that landed in one path but not another would be invisible to the
 * per-adapter unit specs, which each run in isolation. This suite runs the
 * identical scoped + capture-value scenario against every adapter, driven only
 * through the public store API; the same surface an authoring page drives
 * (`store.publishAssertions(id, [...others, ...scoped])` from framework
 * handlers).
 *
 * It is exported from `@ezclassify/ui` so each framework's vitest run imports
 * this single source file and executes it against its own store, and wired into
 * the normal `vitest run` for all four adapters. Any regression that drops an
 * alternate-scope category or a capture value on publish, rollup, or capture
 * fails here regardless of which adapter introduced it.
 *
 * The `driver` a caller supplies is a factory that, given a scoped engine,
 * constructs the adapter's store. That is the entire framework seam this suite
 * needs; the store IS the mount for the state contract; the reactive cell is
 * verified by each adapter's own binding spec.
 *
 * Reached through the `@ezclassify/ui/adapter-parity-suite` vitest alias, never
 * the package entry. The `-suite` suffix keeps it out of the declaration build
 * so a file that imports `vitest` cannot reach the published tarball (see
 * `tsconfig.lib.json`).
 */

import { describe, it, expect } from 'vitest';
import type { Assertion } from '@ezclassify/types';
import type {
    EzClassifyStore,
    EzClassifyStoreAggregateResult,
    EzClassifyStoreEngine,
    EzClassifyStoreProcessResult,
    FacetState,
} from './ezclassify-store';
import { captureFormState, restoreFormState } from '../serialization';
import { EMPTY_RENDER_ASSESSMENT } from '../engine-result-mock';

/**
 * A parity driver: constructs the adapter's store for a given engine. Named so
 * failures identify the framework.
 */
export interface AdapterParityDriver {
    /** Framework label, e.g. `React`, `Vue`, `Angular`, `Vanilla`. */
    name: string;
    /** Build the adapter's store on the supplied engine. */
    createStore(engine: EzClassifyStoreEngine): EzClassifyStore;
}

/** Category ids of the parity scheme, split by scope. */
const DEFAULT_SCOPE_CATEGORIES = new Set(['label']);

/**
 * A scoped engine that models the render-as-transport hazard: a default scope
 * `marking` (category `label`) and an alternate scope `details` (categories
 * `detail_kind`, `expires_on`, `issued_by`). `render` and the label projection
 * emit only default-scope categories and never a capture value; so any path
 * that transports state through a rendered string drops the scoped categories
 * and the captured free text.
 */
function createScopedEngine(): EzClassifyStoreEngine {
    const labelString = (assertions: Assertion[]): string =>
        assertions
            .filter((a) => DEFAULT_SCOPE_CATEGORIES.has(a.categoryId))
            .map((a) => `${a.categoryId}:${a.conceptId}`)
            .join(' ');
    return {
        process(input): EzClassifyStoreProcessResult {
            const assertions = Array.isArray(input) ? input : parseLabel(input);
            return {
                rendered: labelString(assertions),
                assessment: EMPTY_RENDER_ASSESSMENT,
                renders: {},
                assertions,
                valid: true,
                errors: [],
            };
        },
        render(assertions) {
            return labelString(assertions as Assertion[]);
        },
        aggregate(): EzClassifyStoreAggregateResult {
            // Present on the contract but never called by the store: rollup runs
            // through aggregateAssertions.
            return {
                rendered: '',
                assertions: [],
                valid: true,
                errors: [],
            };
        },
        aggregateAssertions(sets): EzClassifyStoreAggregateResult {
            const merged: Assertion[] = [];
            const seen = new Set<string>();
            for (const set of sets) {
                for (const a of set) {
                    const key = `${a.categoryId}:${a.conceptId}`;
                    if (!seen.has(key)) {
                        seen.add(key);
                        merged.push(a);
                    }
                }
            }
            return {
                rendered: labelString(merged),
                assertions: merged,
                valid: true,
                errors: [],
            };
        },
        suggest(_input, options) {
            if (options?.surface !== 'details') return { suggestions: [] };
            return {
                suggestions: [
                    {
                        conceptId: 'ISSUED',
                        categoryId: 'detail_kind',
                        label: 'Issued',
                        description: 'The state was issued by a named source.',
                        name: 'Issued',
                        views: { default: 'Issued' },
                        group: 'Details',
                        selected: false,
                        order: 0,
                    },
                ],
            };
        },
        getSchemeMeta: () => ({
            defaultScope: 'marking',
            scopes: [{ id: 'marking' }, { id: 'details' }],
            formats: [{ id: 'marking/long' }, { id: 'marking/short' }],
        }),
        listCategories: () => [
            { id: 'label', scopes: undefined },
            { id: 'detail_kind', scopes: ['details'] },
            { id: 'expires_on', scopes: ['details'] },
            { id: 'issued_by', scopes: ['details'] },
        ],
    };
}

/**
 * Parse a `cat:concept cat:concept` rendered string back to default-scope
 * assertions.
 */
function parseLabel(input: string): Assertion[] {
    const out: Assertion[] = [];
    for (const part of input.split(/\s+/)) {
        const [categoryId, conceptId] = part.split(':');
        if (categoryId && conceptId)
            out.push({ categoryId, conceptId } as Assertion);
    }
    return out;
}

const key = (a: Assertion): string => `${a.categoryId}:${a.conceptId}`;
const keys = (list: Assertion[]): string[] => list.map(key).sort();

async function flush(): Promise<void> {
    for (let i = 0; i < 6; i++) await Promise.resolve();
}

/**
 * Run the adapter parity contract suite against one framework's store driver.
 * Every adapter must pass this identical set of assertions; it is the permanent
 * lossless-transport gate.
 *
 * @param driver - Factory that builds the adapter's store on a supplied engine.
 */
export function runAdapterParitySuite(driver: AdapterParityDriver): void {
    describe(`adapter parity / ${driver.name}: lossless scoped transport`, () => {
        it('retains scoped assertions and capture values through publishAssertions (authoring-page shape)', async () => {
            const store = driver.createStore(createScopedEngine());
            // An authoring page publishes exactly this way from React
            // handlers: read live state, replace one category, republish
            // [...others, ...new].
            await store.publishAssertions('doc', [
                { categoryId: 'label', conceptId: 'LEVEL_A' } as Assertion,
                {
                    categoryId: 'detail_kind',
                    conceptId: 'ISSUED',
                } as Assertion,
                {
                    categoryId: 'expires_on',
                    conceptId: 'ON_DATE',
                    value: '20301231',
                } as Assertion,
            ]);
            const state = store.get('doc');
            // Scoped categories + capture value retained in state.
            expect(keys(state.assertions)).toEqual([
                'detail_kind:ISSUED',
                'expires_on:ON_DATE',
                'label:LEVEL_A',
            ]);
            expect(
                state.assertions.find((a) => a.categoryId === 'expires_on')
                    ?.value,
            ).toBe('20301231');
            // Absent from the rendered string: the render projection is display-only.
            expect(state.rendered).toBe('label:LEVEL_A');
            store.destroy();
        });

        it('refreshes an alternate-scope facet using its category scope', async () => {
            const store = driver.createStore(createScopedEngine());
            const snapshots: string[][] = [];
            const unsubscribe = store.subscribeFacet(
                'doc',
                'detail_kind',
                (state) =>
                    snapshots.push(
                        (state.allowableOptions ?? []).map(
                            (option) => option.conceptId,
                        ),
                    ),
            );

            await store.publishAssertions('doc', []);
            await flush();

            expect(snapshots.at(-1)).toEqual(['ISSUED']);
            unsubscribe();
            store.destroy();
        });

        it('holds facet state in a cell that tracks the listener stream', async () => {
            const store = driver.createStore(createScopedEngine());
            // Before anything is computed the cell reads as the show-all
            // fallback, the same answer an engine with no suggest gives.
            expect(store.getFacet('doc', 'detail_kind')).toEqual({
                allowableOptions: null,
                selectedAssertions: [],
            });

            const notified: FacetState[] = [];
            const unsubscribe = store.subscribeFacet(
                'doc',
                'detail_kind',
                (state) => notified.push(state),
            );
            await store.publishAssertions('doc', [
                {
                    categoryId: 'detail_kind',
                    conceptId: 'ISSUED',
                } as Assertion,
            ]);
            await flush();

            // The cell IS the state the listeners saw: a framework binding that
            // projects the cell and one that mirrors the stream cannot disagree.
            // Compared by value, not identity: a Vue `ref` hands back a reactive
            // proxy of what was written, which is the adapter doing its job.
            const cellState = store.getFacet('doc', 'detail_kind');
            expect(notified.at(-1)).toEqual(cellState);
            expect(
                (cellState.allowableOptions ?? []).map((o) => o.conceptId),
            ).toEqual(['ISSUED']);
            expect(
                cellState.selectedAssertions.map((a) => a.conceptId),
            ).toEqual(['ISSUED']);

            // The last computed answer outlives the subscription, so a picker
            // that remounts does not flash the show-all fallback.
            unsubscribe();
            expect(store.getFacet('doc', 'detail_kind')).toEqual(cellState);
            store.destroy();
        });

        it('retains scoped state across a part edit + whole rollup', async () => {
            const store = driver.createStore(createScopedEngine());
            store.setPartOf('part-1', 'whole');
            await store.publishAssertions('part-1', [
                { categoryId: 'label', conceptId: 'LEVEL_A' } as Assertion,
                {
                    categoryId: 'issued_by',
                    conceptId: 'NAMED',
                    value: 'R. Rivera',
                } as Assertion,
            ]);
            // Edit the part: swap the default-scope concept, carry the scoped assertion
            // back in the [...others, ...new] shape an authoring page uses.
            const current = store.get('part-1').assertions;
            const others = current.filter((a) => a.categoryId !== 'label');
            await store.publishAssertions('part-1', [
                ...others,
                { categoryId: 'label', conceptId: 'LEVEL_B' } as Assertion,
            ]);
            await flush();

            const rollup = store.getWholeRollup('whole');
            // Scoped assertion + capture value survive the rollup.
            expect(keys(rollup.assertions)).toContain('issued_by:NAMED');
            expect(
                rollup.assertions.find((a) => a.categoryId === 'issued_by')
                    ?.value,
            ).toBe('R. Rivera');
            // ...but the rolled-up rendered string carries only the default scope.
            expect(rollup.rendered).toBe('label:LEVEL_B');
            store.destroy();
        });

        it('names in each publish exactly the outputs its views hold', async () => {
            const named: Array<string[] | undefined> = [];
            const scoped = createScopedEngine();
            const engine: EzClassifyStoreEngine = {
                ...scoped,
                process(input, options) {
                    named.push(options?.outputs);
                    const result = scoped.process(
                        input,
                        options,
                    ) as EzClassifyStoreProcessResult;
                    // Like a real engine: an output is written only when named.
                    const renders = Object.fromEntries(
                        (options?.outputs ?? []).map((output) => [
                            output,
                            {
                                rendered: `${output} ${result.rendered}`,
                                assessment: EMPTY_RENDER_ASSESSMENT,
                            },
                        ]),
                    );
                    return { ...result, renders };
                },
            };
            const store = driver.createStore(engine);

            await store.publishRendered('doc', 'label:LEVEL_A');
            expect(named.at(-1)).toBeUndefined();
            expect(store.get('doc').renders).toEqual({});

            const releaseFirst = store.requestOutput('doc', 'marking/short');
            const releaseSecond = store.requestOutput('doc', 'marking/short');
            await store.publishRendered('doc', 'label:LEVEL_B');
            expect(named.at(-1)).toEqual(['marking/short']);
            expect(store.get('doc').renders['marking/short']?.rendered).toBe(
                'marking/short label:LEVEL_B',
            );

            // Still held by the second view.
            releaseFirst();
            releaseFirst();
            await store.publishAssertions('doc', [
                { categoryId: 'label', conceptId: 'LEVEL_A' } as Assertion,
            ]);
            expect(named.at(-1)).toEqual(['marking/short']);

            releaseSecond();
            await store.publishRendered('doc', 'label:LEVEL_B');
            expect(named.at(-1)).toBeUndefined();
            expect(store.get('doc').renders).toEqual({});
            store.destroy();
        });

        it('refuses to hold an output the scheme does not declare, and keeps publishing', async () => {
            const named: Array<string[] | undefined> = [];
            const scoped = createScopedEngine();
            const store = driver.createStore({
                ...scoped,
                process(input, options) {
                    named.push(options?.outputs);
                    return scoped.process(input, options);
                },
            });

            // A bare view id is a valid outputFormat but not an output a
            // publish can name.
            expect(() => store.requestOutput('doc', 'short')).toThrow(
                /"short".*declares "marking\/long", "marking\/short"/,
            );
            await store.publishRendered('doc', 'label:LEVEL_A');
            expect(named.at(-1)).toBeUndefined();
            expect(store.get('doc').rendered).toBe('label:LEVEL_A');
            store.destroy();
        });

        it('preserves scoped assertions when a rendered string is published over them (publishRendered)', async () => {
            const store = driver.createStore(createScopedEngine());
            await store.publishAssertions('doc', [
                { categoryId: 'label', conceptId: 'LEVEL_A' } as Assertion,
                {
                    categoryId: 'detail_kind',
                    conceptId: 'ISSUED',
                } as Assertion,
            ]);
            // A rendered-string publish is default-scope input; scoped survive.
            await store.publishRendered('doc', 'label:LEVEL_B');
            const state = store.get('doc');
            expect(keys(state.assertions)).toEqual([
                'detail_kind:ISSUED',
                'label:LEVEL_B',
            ]);
            store.destroy();
        });

        it('captureFormState → restoreFormState round-trips scoped + captured state into a fresh mount', async () => {
            const engine = createScopedEngine();
            const storeA = driver.createStore(engine);
            const fieldA = makeField('doc');
            const formsA = makeForms(storeA, engine, fieldA);
            await storeA.publishAssertions('doc', [
                { categoryId: 'label', conceptId: 'LEVEL_A' } as Assertion,
                {
                    categoryId: 'detail_kind',
                    conceptId: 'ISSUED',
                } as Assertion,
                {
                    categoryId: 'expires_on',
                    conceptId: 'ON_DATE',
                    value: '20301231',
                } as Assertion,
            ]);

            const snapshot = await captureFormState(formsA);
            expect(snapshot.version).toBe(1);

            const storeB = driver.createStore(engine);
            const fieldB = makeField('doc');
            const formsB = makeForms(storeB, engine, fieldB);
            restoreFormState(formsB, snapshot);
            await flush();

            const restored = storeB.get('doc').assertions;
            expect(keys(restored)).toEqual([
                'detail_kind:ISSUED',
                'expires_on:ON_DATE',
                'label:LEVEL_A',
            ]);
            expect(
                restored.find((a) => a.categoryId === 'expires_on')?.value,
            ).toBe('20301231');
            storeA.destroy();
            storeB.destroy();
        });
    });

    describe(`adapter parity / ${driver.name}: seeding keeps scoped transport`, () => {
        /**
         * What a host carrying scoped details and a captured date is served
         * with.
         */
        const served = (): Assertion[] => [
            { categoryId: 'label', conceptId: 'LEVEL_A' } as Assertion,
            { categoryId: 'detail_kind', conceptId: 'ISSUED' } as Assertion,
            {
                categoryId: 'expires_on',
                conceptId: 'ON_DATE',
                value: '20301231',
            } as Assertion,
        ];

        it('carries an edit made before the seed and keeps the served scoped assertions', async () => {
            const store = driver.createStore(createScopedEngine());
            await store.publishAssertions('doc', [
                { categoryId: 'label', conceptId: 'LEVEL_B' } as Assertion,
            ]);
            await store.seedAssertions('doc', served());

            const state = store.get('doc');
            expect(keys(state.assertions)).toEqual([
                'detail_kind:ISSUED',
                'expires_on:ON_DATE',
                'label:LEVEL_B',
            ]);
            expect(
                state.assertions.find((a) => a.categoryId === 'expires_on')
                    ?.value,
            ).toBe('20301231');
            store.destroy();
        });

        it('lands a scoped edit published during a rendered seed on top of it, capture value intact', async () => {
            const store = driver.createStore(createScopedEngine());
            const seed = store.seedRendered('doc', 'label:LEVEL_A');
            // Composed from what an authoring page can read now: the unseeded
            // marking, plus the scoped details it is adding.
            const edit = store.publishAssertions('doc', served().slice(1));
            await Promise.all([seed, edit]);

            const state = store.get('doc');
            expect(keys(state.assertions)).toEqual([
                'detail_kind:ISSUED',
                'expires_on:ON_DATE',
                'label:LEVEL_A',
            ]);
            expect(
                state.assertions.find((a) => a.categoryId === 'expires_on')
                    ?.value,
            ).toBe('20301231');
            store.destroy();
        });

        it('replaces scoped assertions nobody edited when a rendered value is seeded over them', async () => {
            const store = driver.createStore(createScopedEngine());
            await store.seedAssertions('doc', served());
            // The next page under the same id is served a rendered value,
            // which states only the default scope.
            await store.seedRendered('doc', 'label:LEVEL_B');

            expect(keys(store.get('doc').assertions)).toEqual([
                'label:LEVEL_B',
            ]);
            store.destroy();
        });

        it('lets a publish that names its category put back the value it read, scoped assertions intact', async () => {
            const store = driver.createStore(createScopedEngine());
            await store.seedAssertions('doc', served());
            const read = store.get('doc').assertions;
            const edit = store.publishAssertions('doc', [
                ...read.filter((a) => a.categoryId !== 'label'),
                { categoryId: 'label', conceptId: 'LEVEL_B' } as Assertion,
            ]);
            const back = store.publishAssertions('doc', read, undefined, {
                categories: ['label'],
            });
            await Promise.all([edit, back]);

            expect(keys(store.get('doc').assertions)).toEqual([
                'detail_kind:ISSUED',
                'expires_on:ON_DATE',
                'label:LEVEL_A',
            ]);
            store.destroy();
        });

        it('lets a rendered edit made before the seed replace only the default scope', async () => {
            const store = driver.createStore(createScopedEngine());
            await store.publishRendered('doc', 'label:LEVEL_B');
            await store.seedAssertions('doc', served());

            expect(keys(store.get('doc').assertions)).toEqual([
                'detail_kind:ISSUED',
                'expires_on:ON_DATE',
                'label:LEVEL_B',
            ]);
            store.destroy();
        });
    });
}

/** Make a bare input host with the given store id. */
function makeField(id: string): HTMLInputElement {
    const el = document.createElement('input');
    el.id = id;
    return el;
}

/**
 * Wrap a store as the minimal `EzClassifyUI`-shaped host the serialization API
 * consumes (`engine`, `store`, `fields`, `defaultFormat`, `getRollup`,
 * `recalculate`). The serialization functions only read these members.
 */
function makeForms(
    store: EzClassifyStore,
    engine: EzClassifyStoreEngine,
    field: HTMLInputElement,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- structural host stand-in for the serialization API's EzClassifyUI param
): any {
    return {
        engine,
        store,
        fields: [field],
        defaultFormat: '',
        getRollup: () => store.get(field.id).rendered,
        recalculate: () => {},
    };
}
