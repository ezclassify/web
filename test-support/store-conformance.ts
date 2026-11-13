/**
 * EzClassifyStore conformance harness.
 *
 * One suite, multiple implementations. `@ezclassify/ui` ships the store
 * contract and the reference `VanillaEzClassifyStore`; the framework adapters
 * (`@ezclassify/angular`, `@ezclassify/react`) reimplement the same contract
 * over their native reactive primitive: signal, external store. The harness
 * pins the observable behavior every implementation must match.
 *
 * The types below are structural-minimum mirrors of the surface declared in
 * `libs/ui/src/store/ezclassify-store.ts`. Re-stating them here is deliberate:
 * the suite states the least an implementation must offer, and a store that
 * offers more still passes. TypeScript's duck typing accepts the real
 * implementations against these locals; if the surfaces ever diverge, the
 * factory call site in each spec will stop compiling, which is the right
 * failure mode for a contract test.
 *
 * Four conformance functions are exported:
 *
 * - `runEzClassifyStoreConformance`: core publish/subscribe/aggregate contract
 * - `runEzClassifyStoreBudgetConformance`: recompute-budget (aggregateAssertions
 *   call count)
 * - `runEzClassifyStoreFacetConformance`: subscribeFacet category-scoping
 *   contract
 * - `runEzClassifyStoreSeedConformance`: seeds and edits under a late-answering
 *   engine
 */
import { describe, it, expect, vi } from 'vitest';
import type {
    Assertion,
    ProcessResult,
    RenderAssessment,
    RenderResultsByFormat,
    ValidationError,
    ProcessingContext,
} from '@ezclassify/types';

/** A single state slice held by the store for one marking id. */
export interface ConformanceState {
    rendered: string;
    renders: RenderResultsByFormat;
    assertions: Assertion[];
    valid: boolean;
    errors: ValidationError[];
    displayColor?: { background: string; text: string };
}

/**
 * A level's rollup: one state per bucket, each bucket rolled up through its own
 * engine. Mirrors `EzClassifyAggregate` in `@ezclassify/ui`.
 */
export interface ConformanceAggregate {
    readonly byBucket: ReadonlyMap<string, ConformanceState>;
}

/** Subset of `ProcessResult` the store consumes. Other fields are ignored. */
export interface ConformanceProcessResult {
    /** Recognition of string input; structured input carries no recognition. */
    recognition?: ProcessResult['recognition'];
    rendered: string;
    /** What `rendered` wrote of the facts, and what it could not write. */
    assessment: RenderAssessment;
    /** The outputs the request named in `outputs`, and only those. */
    renders: RenderResultsByFormat;
    assertions: Assertion[];
    valid: boolean;
    errors: ValidationError[];
}

/** Subset of `AggregateResult` the store consumes for computed rollups. */
export interface ConformanceAggregateResult {
    rendered: string;
    assertions: Assertion[];
    valid: boolean;
    errors: ValidationError[];
}

/**
 * Minimum engine surface a store needs. Matches `EzClassifyStoreEngine` in
 * `@ezclassify/ui`. The pass-through engine returned by
 * `createPassThroughEngine` satisfies it; so does any real
 * `SchemeEngineAdapter`.
 */
export interface ConformanceEngine {
    process(
        input: string | Assertion[],
        options?: {
            outputFormat?: string;
            outputs?: string[];
            context?: ProcessingContext;
            signal?: AbortSignal;
        },
    ): ConformanceProcessResult | Promise<ConformanceProcessResult>;
    render(
        assertions: Assertion[],
        formatOrOptions?: string | { format?: string },
    ): string | Promise<string>;
    aggregate(
        inputs: string[],
        options?: { inputFormat?: string; outputFormat?: string },
    ): ConformanceAggregateResult | Promise<ConformanceAggregateResult>;
    aggregateAssertions(
        assertionSets: Assertion[][],
        options?: { outputFormat?: string; signal?: AbortSignal },
    ): ConformanceAggregateResult | Promise<ConformanceAggregateResult>;
    /**
     * Scheme identity + scope configuration. The store reads `defaultScope` and
     * the scope list to route incoming assertions to their default (whole) or
     * alternate scope. Required by `EzClassifyStore`: an engine that omits it
     * cannot back a store.
     */
    getSchemeMeta(schemeId?: string): ConformanceSchemeMeta;
    /**
     * Resolved category descriptors. The store reads each category's `scopes`
     * to map an assertion's `categoryId` to its scope (assertions carry no
     * scope of their own: scope is scheme metadata keyed by category). Required
     * by `EzClassifyStore`, paired with {@link getSchemeMeta}.
     */
    listCategories(schemeId?: string): ConformanceCategoryMeta[];
}

/**
 * Minimal scheme-metadata subset the store consumes for scope routing. Mirrors
 * `EzClassifyStoreSchemeMeta` in `@ezclassify/ui`; a structural subset of the
 * engine's `SchemeMetaView`.
 */
export interface ConformanceSchemeMeta {
    /** Whether this engine reads whole-dependent rules. */
    roleAware?: boolean;
    /** Default scope ID applied to categories that declare no explicit scopes. */
    defaultScope?: string;
    /** Available scopes: id and display label. The default is `defaultScope`. */
    scopes?: Array<{ id: string; label?: string }>;
}

/**
 * Minimal category-metadata subset the store consumes for scope routing.
 * Mirrors `EzClassifyStoreCategoryMeta` in `@ezclassify/ui`; a structural
 * subset of the engine's `CategoryView`.
 */
export interface ConformanceCategoryMeta {
    /** Unique category identifier: matches an assertion's `categoryId`. */
    id: string;
    /** Scope IDs this category is visible in. Empty/absent means default scope. */
    scopes?: string[];
}

/** Source token used for cycle protection. Compared by identity. */
export interface ConformancePublishSource {
    token: unknown;
}

/** The store surface the conformance suite exercises. */
export interface ConformanceStore {
    get(id: string): ConformanceState;
    subscribe(
        id: string,
        listener: (state: ConformanceState) => void,
        source?: ConformancePublishSource,
    ): () => void;
    publishRendered(
        id: string,
        rendered: string,
        source?: ConformancePublishSource,
    ): Promise<void>;
    publishAssertions(
        id: string,
        assertions: Assertion[],
        source?: ConformancePublishSource,
        options?: { categories?: readonly string[] },
    ): Promise<void>;
    getAggregate(): ConformanceAggregate;
    subscribeAggregate(
        listener: (aggregate: ConformanceAggregate) => void,
    ): () => void;
    setPartOf(markingId: string, wholeId: string | null): void;
    getWholeRollup(wholeId: string): ConformanceState;
    subscribeWholeRollup(
        wholeId: string,
        listener: (state: ConformanceState) => void,
    ): () => void;
    destroy(): void;
}

/**
 * Minimal facet state delivered by `subscribeFacet`. Mirrors `FacetState` in
 * `@ezclassify/ui`, restated for the reason the module header gives.
 */
export interface ConformanceFacetState {
    /** Concepts the engine considers addable, or null when suggest is absent. */
    allowableOptions: unknown[] | null;
    /** Assertions currently selected for this category within this marking. */
    selectedAssertions: Assertion[];
}

/**
 * Extends `ConformanceStore` with `subscribeFacet`. All three framework
 * adapters implement this; the facet conformance suite requires it.
 */
export interface ConformanceFacetStore extends ConformanceStore {
    subscribeFacet(
        markingId: string,
        categoryId: string,
        listener: (state: ConformanceFacetState) => void,
    ): () => void;
}

/**
 * Shape every store reports for an unknown id. Compared structurally: the
 * adapters share a single `EMPTY_MARKING_STATE` import from `@ezclassify/ui`,
 * so referential identity holds in practice; the suite asserts the shape rather
 * than the identity so a divergent adapter that returns a fresh empty object
 * still passes.
 */
const EMPTY_STATE_SHAPE: ConformanceState = {
    rendered: '',
    renders: {},
    assertions: [],
    valid: false,
    errors: [],
    displayColor: undefined,
};

/**
 * Deterministic test engine. Parses `category:concept` tokens from rendered
 * strings and round-trips assertion arrays back to the same shape. Used by
 * every conformance run so all four implementations exercise an identical
 * engine path: variance shows up as a store bug, not an engine difference.
 *
 * Its one output is `default`, which writes every fact. Like a real engine, it
 * assesses the string it returns, writes into `renders` only the outputs a
 * process call names, and refuses one it does not declare.
 */
export function createPassThroughEngine(): ConformanceEngine {
    const processed = (
        rendered: string,
        assertions: Assertion[],
        outputs: readonly string[],
    ): ConformanceProcessResult => {
        const assessment: RenderAssessment = {
            emitted: assertions.map(({ categoryId, conceptId, value }) => ({
                categoryId,
                conceptId,
                ...(value !== undefined ? { value } : {}),
            })),
            omitted: [],
            collapsed: [],
            conflicts: [],
            unrepresentable: [],
        };
        const renders: RenderResultsByFormat = {};
        for (const output of outputs) {
            if (output !== 'default')
                throw new Error(
                    `The pass-through engine declares only the "default" output; "${output}" was named.`,
                );
            renders[output] = { rendered, assessment };
        }
        return {
            rendered,
            assessment,
            renders,
            assertions,
            valid: true,
            errors: [],
        };
    };
    return {
        process(input, options): ConformanceProcessResult {
            const rendered =
                typeof input === 'string'
                    ? input
                    : input
                          .map((a) => `${a.categoryId}:${a.conceptId}`)
                          .join(' ');
            const assertions: Assertion[] = [];
            if (typeof input === 'string' && input.includes(':')) {
                for (const part of input.split(/\s+/)) {
                    const [categoryId, conceptId] = part.split(':');
                    if (categoryId && conceptId)
                        assertions.push({ categoryId, conceptId } as Assertion);
                }
            } else if (Array.isArray(input)) {
                for (const a of input) assertions.push(a);
            }
            return {
                ...processed(rendered, assertions, options?.outputs ?? []),
                ...(typeof input === 'string'
                    ? {
                          recognition: {
                              status: 'complete' as const,
                              inputFormat: 'default',
                              unmatched: [],
                              corrections: [],
                          },
                      }
                    : {}),
            };
        },
        render(assertions) {
            return assertions
                .map((a) => `${a.categoryId}:${a.conceptId}`)
                .join(' ');
        },
        aggregate(inputs: string[]): ConformanceAggregateResult {
            // Union of all category:concept tokens across inputs. The pass-through
            // scheme has no rank ordering, so union is the correct no-op aggregation
            // for conformance tests that only care about firing / subscription
            // behavior, not scheme-specific rollup semantics.
            const assertions: Assertion[] = [];
            const seen = new Set<string>();
            for (const rendered of inputs) {
                for (const part of rendered.split(/\s+/)) {
                    const [categoryId, conceptId] = part.split(':');
                    if (categoryId && conceptId) {
                        const key = `${categoryId}:${conceptId}`;
                        if (!seen.has(key)) {
                            seen.add(key);
                            assertions.push({
                                categoryId,
                                conceptId,
                            } as Assertion);
                        }
                    }
                }
            }
            const rendered = assertions
                .map((a) => `${a.categoryId}:${a.conceptId}`)
                .join(' ');
            return { rendered, assertions, valid: true, errors: [] };
        },
        aggregateAssertions(
            assertionSets: Assertion[][],
        ): ConformanceAggregateResult {
            // Mirrors `aggregate` over already-parsed assertion arrays, no parser
            // round-trip. Same union semantics so the conformance suite's
            // page-aggregate scenarios behave identically across the two APIs.
            const merged: Assertion[] = [];
            const seen = new Set<string>();
            for (const set of assertionSets) {
                for (const a of set) {
                    const key = `${a.categoryId}:${a.conceptId}`;
                    if (!seen.has(key)) {
                        seen.add(key);
                        merged.push(a);
                    }
                }
            }
            const rendered = merged
                .map((a) => `${a.categoryId}:${a.conceptId}`)
                .join(' ');
            return { rendered, assertions: merged, valid: true, errors: [] };
        },
        getSchemeMeta(): ConformanceSchemeMeta {
            // The pass-through scheme is scopeless: no defaultScope, no scope
            // list. Every category therefore lands in the single default scope,
            // so publishAssertions never has to partition by scope.
            // process never reads options.context or inherits whole facts.
            return { roleAware: false };
        },
        listCategories(): ConformanceCategoryMeta[] {
            // Categories are synthesized on the fly from `category:concept`
            // tokens; there is no fixed category set and no per-category scope
            // metadata to report.
            return [];
        },
    };
}

/**
 * Run the shared `EzClassifyStore` conformance suite against a factory.
 *
 * The factory is called fresh for every test case: implementations must not
 * carry state between tests via module-level singletons. The describe block is
 * tagged with `suiteName` so failing runs across multiple adapter packages are
 * easy to triage.
 *
 * Spec coverage (mirrors `binding-model.md` §8):
 *
 * 1. `get` returns the empty shape for unknown ids.
 * 2. `publishRendered` writes both `rendered` and `assertions`.
 * 3. `publishAssertions` writes both `assertions` and `rendered` via
 *    render→process.
 * 4. `subscribe` fires synchronously on commit; not before.
 * 5. `subscribe` skips the publisher when `PublishSource.token` matches.
 * 6. `destroy` releases listeners and blocks further publishes.
 * 7. `getAggregate` recomputes when any contributor changes.
 */
export function runEzClassifyStoreConformance(
    factory: () => ConformanceStore,
    options: { suiteName?: string } = {},
): void {
    const suiteName = options.suiteName ?? 'EzClassifyStore conformance';

    describe(suiteName, () => {
        it('returns the empty state for an unknown id', () => {
            const store = factory();
            expect(store.get('nope')).toEqual(EMPTY_STATE_SHAPE);
        });

        it('publishRendered writes both rendered and assertions', async () => {
            const store = factory();
            await store.publishRendered('doc', 'tier:secret');
            const state = store.get('doc');
            expect(state.rendered).toBe('tier:secret');
            expect(state.assertions).toEqual([
                { categoryId: 'tier', conceptId: 'secret' },
            ]);
        });

        it('publishAssertions writes both assertions and rendered', async () => {
            const store = factory();
            await store.publishAssertions('doc', [
                { categoryId: 'tier', conceptId: 'top-secret' } as Assertion,
            ]);
            const state = store.get('doc');
            expect(state.rendered).toBe('tier:top-secret');
            expect(state.assertions[0]?.conceptId).toBe('top-secret');
        });

        it('subscribe fires synchronously on commit, never before', async () => {
            const store = factory();
            const cb = vi.fn();
            store.subscribe('doc', cb);
            expect(cb).not.toHaveBeenCalled();
            await store.publishRendered('doc', 'tier:secret');
            expect(cb).toHaveBeenCalledTimes(1);
            expect(cb.mock.calls[0]?.[0].rendered).toBe('tier:secret');
        });

        it('subscribe does not fire on the source view when PublishSource.token matches', async () => {
            const store = factory();
            const token = {};
            const echo = vi.fn();
            const other = vi.fn();
            store.subscribe('doc', echo, { token });
            store.subscribe('doc', other);
            await store.publishRendered('doc', 'tier:secret', { token });
            expect(echo).not.toHaveBeenCalled();
            expect(other).toHaveBeenCalledTimes(1);
        });

        it('destroy releases listeners and blocks further publishes', async () => {
            const store = factory();
            const cb = vi.fn();
            store.subscribe('doc', cb);
            store.destroy();
            await expect(
                store.publishRendered('doc', 'tier:secret'),
            ).rejects.toThrow(/destroyed/);
            expect(cb).not.toHaveBeenCalled();
        });

        it('getAggregate recomputes when any contributor changes', async () => {
            const store = factory();
            const aggCb = vi.fn();
            store.subscribeAggregate(aggCb);
            await store.publishRendered('a', 'tier:secret');
            await store.publishRendered('b', 'origin:army');
            // recomputeAggregate is fire-and-forget after commit; drain a few
            // microtasks so the engine.process call inside it has settled.
            await Promise.resolve();
            await Promise.resolve();
            // A store over one engine holds a single bucket.
            const buckets = [...store.getAggregate().byBucket.values()];
            expect(buckets).toHaveLength(1);
            expect(buckets[0]?.rendered).toContain('tier:secret');
            expect(buckets[0]?.rendered).toContain('origin:army');
            expect(aggCb).toHaveBeenCalled();
        });

        describe('whole rollup', () => {
            it('getWholeRollup includes only markings whose setPartOf names the whole', async () => {
                const store = factory();
                store.setPartOf('p1', 'doc');
                store.setPartOf('p2', 'doc');
                await store.publishRendered('doc', 'tier:public');
                await store.publishRendered('p1', 'tier:secret');
                await store.publishRendered('p2', 'origin:army');
                await store.publishRendered('standalone', 'tier:unrelated');
                await Promise.resolve();
                await Promise.resolve();
                const rollup = store.getWholeRollup('doc');
                // Whole rollup pulls in the two parts and nothing else.
                expect(rollup.rendered).toContain('tier:secret');
                expect(rollup.rendered).toContain('origin:army');
                expect(rollup.rendered).not.toContain('tier:public');
                expect(rollup.rendered).not.toContain('tier:unrelated');
            });

            it('a part commit fires both the page-aggregate listener and the matching whole-rollup listener', async () => {
                const store = factory();
                const aggCb = vi.fn();
                const wholeCb = vi.fn();
                store.subscribeAggregate(aggCb);
                store.subscribeWholeRollup('doc', wholeCb);
                store.setPartOf('p1', 'doc');
                await store.publishRendered('p1', 'tier:secret');
                await Promise.resolve();
                await Promise.resolve();
                expect(aggCb).toHaveBeenCalled();
                expect(wholeCb).toHaveBeenCalled();
                const lastWholeState = wholeCb.mock.calls[
                    wholeCb.mock.calls.length - 1
                ]?.[0] as ConformanceState;
                expect(lastWholeState.rendered).toContain('tier:secret');
            });

            it('committing the whole itself does NOT fire its whole-rollup listener', async () => {
                const store = factory();
                const wholeCb = vi.fn();
                store.subscribeWholeRollup('doc', wholeCb);
                // Whole has no setPartOf: it IS the whole, not a part.
                await store.publishRendered('doc', 'tier:public');
                await Promise.resolve();
                await Promise.resolve();
                expect(wholeCb).not.toHaveBeenCalled();
            });

            it('setPartOf(id, null) drops the part from the rollup on the next commit', async () => {
                const store = factory();
                store.setPartOf('p1', 'doc');
                await store.publishRendered('p1', 'tier:secret');
                await Promise.resolve();
                await Promise.resolve();
                expect(store.getWholeRollup('doc').rendered).toContain(
                    'tier:secret',
                );
                store.setPartOf('p1', null);
                await Promise.resolve();
                await Promise.resolve();
                expect(store.getWholeRollup('doc').rendered).not.toContain(
                    'tier:secret',
                );
            });
        });
    });
}

/**
 * Recompute budget conformance suite.
 *
 * Every `EzClassifyStore` implementation must call `engine.aggregateAssertions`
 * no more than twice per commit: at most once for the affected whole's rollup
 * and once for the page aggregate. Listeners on unaffected wholes must not
 * fire. This matches the contract in `binding-model.md` §1.5.
 *
 * Takes `(engine: ConformanceEngine) => ConformanceStore` so the spy engine can
 * be passed directly into the store constructor: the regular `() =>
 * ConformanceStore` factory bakes its engine in, which makes spy injection
 * impossible.
 *
 * Call this alongside `runEzClassifyStoreConformance` in each adapter's spec:
 *
 * ```ts
 * runEzClassifyStoreBudgetConformance((engine) => new MyStore(engine));
 * ```
 */
export function runEzClassifyStoreBudgetConformance(
    factory: (engine: ConformanceEngine) => ConformanceStore,
    options: { suiteName?: string } = {},
): void {
    const label = options.suiteName
        ? `${options.suiteName}: recompute budget`
        : 'EzClassifyStore: recompute budget';

    describe(label, () => {
        // Drain microtasks so fire-and-forget recompute promises settle.
        const flush = async () => {
            for (let i = 0; i < 4; i++) await Promise.resolve();
        };

        function makeSpyEngine() {
            const base = createPassThroughEngine();
            const aggregateSpy = vi.fn(
                (...args: Parameters<typeof base.aggregateAssertions>) =>
                    base.aggregateAssertions(...args),
            );
            const engine: ConformanceEngine = {
                ...base,
                aggregateAssertions: aggregateSpy,
            };
            return { engine, aggregateSpy };
        }

        it('part commit → 1 whole-rollup + 1 page-aggregate aggregateAssertions call; unaffected whole skipped', async () => {
            const { engine, aggregateSpy } = makeSpyEngine();
            const store = factory(engine);
            // Two wholes, each with two parts. Seed so every marking carries assertions.
            store.setPartOf('p1', 'whole-a');
            store.setPartOf('p2', 'whole-a');
            store.setPartOf('p3', 'whole-b');
            store.setPartOf('p4', 'whole-b');
            await store.publishRendered('p1', 'tier:secret');
            await store.publishRendered('p2', 'origin:army');
            await store.publishRendered('p3', 'tier:public');
            await store.publishRendered('p4', 'origin:navy');
            await flush();
            aggregateSpy.mockClear();
            // Edit one part of whole-a; whole-b's rollup must not recompute.
            await store.publishRendered('p1', 'tier:top-secret');
            await flush();
            // 1 for whole-a rollup + 1 for page aggregate.
            expect(aggregateSpy).toHaveBeenCalledTimes(2);
        });

        it('whole commit → page-aggregate only; whole-rollup aggregateAssertions not called', async () => {
            const { engine, aggregateSpy } = makeSpyEngine();
            const store = factory(engine);
            store.setPartOf('p1', 'whole-a');
            await store.publishRendered('p1', 'tier:secret');
            await flush();
            aggregateSpy.mockClear();
            // whole-a has no part-of edge: it IS the whole.
            await store.publishRendered('whole-a', 'tier:public');
            await flush();
            // Only the page aggregate recomputes; no rollup call.
            expect(aggregateSpy).toHaveBeenCalledTimes(1);
        });

        it('standalone commit → page-aggregate only; whole-rollup aggregateAssertions not called', async () => {
            const { engine, aggregateSpy } = makeSpyEngine();
            const store = factory(engine);
            store.setPartOf('p1', 'whole-a');
            await store.publishRendered('p1', 'tier:secret');
            await flush();
            aggregateSpy.mockClear();
            // standalone has no part-of edge and is not referenced as a whole by anything.
            await store.publishRendered('standalone', 'tier:top-secret');
            await flush();
            expect(aggregateSpy).toHaveBeenCalledTimes(1);
        });

        it("whole-rollup listener for unaffected whole does not fire on a different whole's part commit", async () => {
            const { engine } = makeSpyEngine();
            const store = factory(engine);
            store.setPartOf('p1', 'whole-a');
            store.setPartOf('p2', 'whole-b');
            await store.publishRendered('p1', 'tier:secret');
            await store.publishRendered('p2', 'tier:public');
            await flush();
            const wholeBListener = vi.fn();
            store.subscribeWholeRollup('whole-b', wholeBListener);
            wholeBListener.mockClear();
            // Edit a part of whole-a; whole-b's listener must stay silent.
            await store.publishRendered('p1', 'tier:top-secret');
            await flush();
            expect(wholeBListener).not.toHaveBeenCalled();
        });
    });
}

/**
 * Facet subscription contract suite.
 *
 * `subscribeFacet(markingId, categoryId, listener)` is the mechanism by which
 * category-scoped facet pickers bind to the store. This suite verifies the
 * three invariants that protect the UI layer from category bleed-through:
 *
 * 1. The listener fires after a commit to the subscribed marking.
 * 2. `selectedAssertions` contains ONLY assertions belonging to the subscribed
 *    category: assertions from other categories are excluded even when the
 *    rendered string carries them.
 * 3. Subscribing to category A does not deliver notifications when only category B
 *    changes on a different marking.
 *
 * The suite also checks that `get(id).rendered` after a commit equals the
 * published value: the invariant that lets `@ezclassify/ui` keep a host input's
 * `.value` in sync simply by writing `state.rendered`.
 *
 * Uses `createPassThroughEngine` throughout so engine differences don't
 * confound the store-level assertions. The engine has no `suggest` method, so
 * `allowableOptions` is expected to be `null` in all cases here.
 *
 * Call this alongside `runEzClassifyStoreConformance` in each adapter's spec
 * and in the cross-framework contract spec:
 *
 * ```ts
 * runEzClassifyStoreFacetConformance(
 *     () => new MyStore(createPassThroughEngine()),
 *     { suiteName: 'MyStore' },
 * );
 * ```
 */
export function runEzClassifyStoreFacetConformance(
    factory: () => ConformanceFacetStore,
    options: { suiteName?: string } = {},
): void {
    const label = options.suiteName
        ? `${options.suiteName}: facet contract`
        : 'EzClassifyStore: facet contract';

    describe(label, () => {
        const flush = async () => {
            for (let i = 0; i < 4; i++) await Promise.resolve();
        };

        it('subscribeFacet fires after publishRendered', async () => {
            const store = factory();
            const states: ConformanceFacetState[] = [];
            const unsub = store.subscribeFacet('doc', 'tier', (s) =>
                states.push(s),
            );
            await store.publishRendered('doc', 'tier:secret');
            await flush();
            expect(states.length).toBeGreaterThan(0);
            unsub();
        });

        it('subscribeFacet: selectedAssertions contains only the subscribed category', async () => {
            // Publish a marking with assertions in two categories. The facet
            // for 'tier' must only see 'tier' assertions in selectedAssertions:
            // 'ctrl' assertions must not bleed through.
            const store = factory();
            const tierStates: ConformanceFacetState[] = [];
            const ctrlStates: ConformanceFacetState[] = [];
            store.subscribeFacet('doc', 'tier', (s) => tierStates.push(s));
            store.subscribeFacet('doc', 'ctrl', (s) => ctrlStates.push(s));
            await store.publishRendered('doc', 'tier:secret ctrl:alpha');
            await flush();
            const tierLast = tierStates[tierStates.length - 1];
            const ctrlLast = ctrlStates[ctrlStates.length - 1];
            expect(tierLast).toBeDefined();
            expect(ctrlLast).toBeDefined();
            // Hard-scope: tier facet must contain only tier assertions.
            for (const a of tierLast.selectedAssertions) {
                expect((a as Assertion).categoryId).toBe('tier');
            }
            // Hard-scope: ctrl facet must contain only ctrl assertions.
            for (const a of ctrlLast.selectedAssertions) {
                expect((a as Assertion).categoryId).toBe('ctrl');
            }
        });

        it('subscribeFacet: does not cross-notify when a different marking commits', async () => {
            // Category A on marking 'doc1' must not fire when 'doc2' commits.
            const store = factory();
            const cb = vi.fn();
            store.subscribeFacet('doc1', 'tier', cb);
            // The store computes a facet once its first listener subscribes.
            await flush();
            cb.mockClear();
            await store.publishRendered('doc2', 'tier:secret');
            await flush();
            expect(cb).not.toHaveBeenCalled();
        });

        it('commit-rendered equals published value (state.rendered is input-value-ready)', async () => {
            // The store is the source of truth that @ezclassify/ui copies to
            // input.value. Verify the round-trip: what goes in via
            // publishRendered comes back out unchanged in get().rendered.
            const store = factory();
            await store.publishRendered('doc', 'tier:secret ctrl:alpha');
            const state = store.get('doc');
            expect(state.rendered).toBe('tier:secret ctrl:alpha');
        });

        it('subscribeFacet returns a working unsubscribe handle', async () => {
            const store = factory();
            const states: ConformanceFacetState[] = [];
            const unsub = store.subscribeFacet('doc', 'tier', (s) =>
                states.push(s),
            );
            await store.publishRendered('doc', 'tier:secret');
            await flush();
            const countBeforeUnsub = states.length;
            unsub();
            await store.publishRendered('doc', 'tier:top-secret');
            await flush();
            expect(states.length).toBe(countBeforeUnsub);
        });

        it('subscribeFacet: category hard-scope holds across multiple commits', async () => {
            const store = factory();
            const tierStates: ConformanceFacetState[] = [];
            store.subscribeFacet('doc', 'tier', (s) => tierStates.push(s));
            // First commit has both categories.
            await store.publishRendered('doc', 'tier:secret ctrl:alpha');
            await flush();
            // Second commit changes the ctrl category only (tier stays).
            await store.publishRendered('doc', 'tier:secret ctrl:bravo');
            await flush();
            for (const s of tierStates) {
                for (const a of s.selectedAssertions) {
                    expect((a as Assertion).categoryId).toBe('tier');
                }
            }
        });
    });
}

/**
 * Extends `ConformanceStore` with the seed lifecycle. A seed is the value a
 * marking's host was served with; the runtime seeds each host once its fields
 * have initialized, and releases the seed when the host leaves the page or the
 * runtime is torn down.
 */
export interface ConformanceSeedStore extends ConformanceStore {
    seedRendered(id: string, rendered: string): Promise<void>;
    seedAssertions(id: string, assertions: Assertion[]): Promise<void>;
    releaseSeed(id: string): void;
}

/**
 * Seed and edit conformance suite.
 *
 * A marking commits two layers: the baseline its host was served with, set only
 * by a seed, and the edits users and applications wrote, set only by a publish.
 * Whatever order a seed and an edit arrive in, the marking settles on the
 * served value with the edits on top: never the served value alone, which loses
 * a pick, and never the edit alone, which drops the served categories nobody
 * touched. A later seed replaces the baseline and keeps the edits. Releasing a
 * marking drops both layers and empties it.
 *
 * Every engine answer arrives on a later macrotask, the way a remote engine's
 * does, so a seed and an edit can both be in flight at once. Takes the same
 * engine-injecting factory as {@link runEzClassifyStoreBudgetConformance}.
 *
 * ```ts
 * runEzClassifyStoreSeedConformance((engine) => new MyStore(engine));
 * ```
 */
export function runEzClassifyStoreSeedConformance(
    factory: (engine: ConformanceEngine) => ConformanceSeedStore,
    options: { suiteName?: string } = {},
): void {
    const label = options.suiteName
        ? `${options.suiteName}: seeds and edits`
        : 'EzClassifyStore: seeds and edits';

    const served = 'tier:secret ctrl:alpha';

    function lateEngine(): ConformanceEngine {
        const base = createPassThroughEngine();
        return {
            ...base,
            async process(input, processOptions) {
                await new Promise((answer) => setTimeout(answer, 0));
                return base.process(input, processOptions);
            },
        };
    }

    /** A facet picker's publish: the marking it read, with one category swapped. */
    function pick(
        store: ConformanceSeedStore,
        categoryId: string,
        conceptId: string,
    ): Promise<void> {
        return store.publishAssertions('doc', [
            ...store
                .get('doc')
                .assertions.filter((a) => a.categoryId !== categoryId),
            { categoryId, conceptId } as Assertion,
        ]);
    }

    function facts(store: ConformanceSeedStore): string[] {
        return store
            .get('doc')
            .assertions.map((a) => `${a.categoryId}:${a.conceptId}`)
            .sort();
    }

    describe(label, () => {
        it('lands an edit made before the seed on the served value', async () => {
            const store = factory(lateEngine());
            await pick(store, 'tier', 'top-secret');
            await store.seedRendered('doc', served);

            expect(facts(store)).toEqual(['ctrl:alpha', 'tier:top-secret']);
        });

        it('lands an edit still on the wire when the seed arrives', async () => {
            const store = factory(lateEngine());
            const edit = pick(store, 'tier', 'top-secret');
            await Promise.all([edit, store.seedRendered('doc', served)]);

            expect(facts(store)).toEqual(['ctrl:alpha', 'tier:top-secret']);
        });

        it('lands an edit published during the seed on top of it', async () => {
            const store = factory(lateEngine());
            const seed = store.seedRendered('doc', served);
            const edit = pick(store, 'tier', 'top-secret');
            await Promise.all([seed, edit]);

            expect(facts(store)).toEqual(['ctrl:alpha', 'tier:top-secret']);
        });

        it('commits the served value when nothing was edited', async () => {
            const store = factory(lateEngine());
            await store.seedRendered('doc', served);

            expect(store.get('doc').rendered).toBe(served);
        });

        it('keeps the edits under a later seed', async () => {
            const store = factory(lateEngine());
            await store.seedRendered('doc', 'tier:secret');
            await pick(store, 'tier', 'top-secret');

            await store.seedRendered('doc', served);

            expect(facts(store)).toEqual(['ctrl:alpha', 'tier:top-secret']);
        });

        it('takes two seeds in a row, the second as the baseline, and keeps an edit made between them', async () => {
            const store = factory(lateEngine());
            const first = store.seedRendered('doc', 'tier:secret');
            const edit = pick(store, 'ctrl', 'alpha');
            const second = store.seedRendered('doc', 'tier:confidential');
            await Promise.all([first, edit, second]);

            expect(facts(store)).toEqual(['ctrl:alpha', 'tier:confidential']);
        });

        it('lets a publish that names its category put back the value its caller read', async () => {
            const store = factory(lateEngine());
            await store.seedRendered('doc', served);
            const read = store.get('doc').assertions;
            const edit = pick(store, 'tier', 'top-secret');
            // The caller still shows the served tier and picks it again before
            // the first pick has answered.
            const back = store.publishAssertions('doc', read, undefined, {
                categories: ['tier'],
            });
            await Promise.all([edit, back]);

            expect(facts(store)).toEqual(['ctrl:alpha', 'tier:secret']);
        });

        it('seeds from assertions the same way', async () => {
            const store = factory(lateEngine());
            const edit = pick(store, 'tier', 'top-secret');
            const seed = store.seedAssertions('doc', [
                { categoryId: 'tier', conceptId: 'secret' } as Assertion,
                { categoryId: 'ctrl', conceptId: 'alpha' } as Assertion,
            ]);
            await Promise.all([edit, seed]);

            expect(facts(store)).toEqual(['ctrl:alpha', 'tier:top-secret']);
        });

        it('starts over after a release', async () => {
            const store = factory(lateEngine());
            await store.seedRendered('doc', 'tier:secret');
            await pick(store, 'ctrl', 'bravo');
            store.releaseSeed('doc');
            expect(store.get('doc').rendered).toBe('');

            await store.seedRendered('doc', served);

            expect(facts(store)).toEqual(['ctrl:alpha', 'tier:secret']);
        });

        it('clears a marking released while its seed is on the wire', async () => {
            const store = factory(lateEngine());
            const seed = store.seedRendered('doc', served);
            store.releaseSeed('doc');
            await seed;

            expect(store.get('doc').rendered).toBe('');
        });
    });
}
