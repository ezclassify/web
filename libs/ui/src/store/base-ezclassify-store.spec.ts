/**
 * Unit tests for the shared `BaseEzClassifyStore` and the now-exported
 * `facetStateEqual` helper. The three framework adapters subclass
 * `BaseEzClassifyStore` and supply only their reactive cell; these tests use a
 * minimal plain-field cell subclass so the engine-facing logic (commit + cycle
 * protection, aggregate / whole-rollup recompute, facet refresh, destroy
 * semantics) is exercised without pulling in a framework runtime.
 *
 * The cross-framework parity suite (`adapter-parity-suite.ts`) covers
 * observable parity with `VanillaEzClassifyStore`; this file pins the base's
 * own contract and the seam each adapter overrides.
 */

import { describe, it, expect, vi } from 'vitest';
import {
    BaseEzClassifyStore,
    type ReactiveCell,
} from './base-ezclassify-store';
import {
    EMPTY_EZCLASSIFY_STATE,
    facetStateEqual,
    type EzClassifyState,
    type EzClassifyStoreEngine,
    type EzClassifyStoreProcessResult,
    type FacetState,
} from './ezclassify-store';
import type { Assertion, Suggestion } from '@ezclassify/types';
import { EMPTY_RENDER_ASSESSMENT, mockAssertion } from '../engine-result-mock';

function passThroughEngine(
    extra?: Partial<EzClassifyStoreEngine>,
): EzClassifyStoreEngine {
    return {
        process(input): EzClassifyStoreProcessResult {
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
            const rendered =
                typeof input === 'string'
                    ? input
                    : assertions
                          .map((a) => `${a.categoryId}:${a.conceptId}`)
                          .join(' ');
            return {
                rendered,
                assessment: EMPTY_RENDER_ASSESSMENT,
                renders: {},
                assertions,
                valid: true,
                errors: [],
            };
        },
        render(assertions) {
            return (assertions as Assertion[])
                .map((a) => `${a.categoryId}:${a.conceptId}`)
                .join(' ');
        },
        aggregate(inputs: string[]): EzClassifyStoreProcessResult {
            const rendered = inputs.join(' ');
            return {
                rendered,
                assessment: EMPTY_RENDER_ASSESSMENT,
                renders: {},
                assertions: [],
                valid: true,
                errors: [],
            };
        },
        aggregateAssertions(sets: Assertion[][]): EzClassifyStoreProcessResult {
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
                rendered: merged
                    .map((a) => `${a.categoryId}:${a.conceptId}`)
                    .join(' '),
                assessment: EMPTY_RENDER_ASSESSMENT,
                renders: {},
                assertions: merged,
                valid: true,
                errors: [],
            };
        },
        // Required capabilities. This base passthrough declares a scheme with no
        // alternate scopes, so scope routing resolves to an empty index and every
        // assertion is default-scope by data (not by a missing-capability fallback).
        getSchemeMeta: () => ({ scopes: [] }),
        listCategories: () => [],
        ...extra,
    };
}

/** Plain-field reactive cell, mirroring the React adapter's backing primitive. */
class PlainCell<T> implements ReactiveCell<T> {
    private value: T;
    constructor(initial: T) {
        this.value = initial;
    }
    get(): T {
        return this.value;
    }
    set(next: T): void {
        this.value = next;
    }
}

/** Drain pending microtasks so the fire-and-forget facet refresh settles. */
async function flushMicrotasks(): Promise<void> {
    for (let i = 0; i < 5; i++) await Promise.resolve();
}

class TestStore extends BaseEzClassifyStore {
    protected createCell<T>(initial: T): ReactiveCell<T> {
        return new PlainCell(initial);
    }
    protected storeLabel(): string {
        return '[ezclassify/test] TestStore';
    }
}

/**
 * Store that records onDestroy invocation, to prove adapters can override
 * teardown.
 */
class NoTeardownStore extends TestStore {
    onDestroyCalls = 0;
    protected override onDestroy(): void {
        this.onDestroyCalls++;
        // Intentionally do NOT zero cells, mirrors the Angular override.
    }
}

describe('BaseEzClassifyStore', () => {
    it('retains every rendered view and assessment with typed assertions', async () => {
        const assertion = {
            categoryId: 'date',
            conceptId: 'declassify-on',
            value: '2030-12-31',
        } as Assertion;
        const renders = {
            whole: {
                rendered: 'DECLASSIFY ON 2030-12-31',
                assessment: {
                    emitted: [],
                    omitted: [],
                    collapsed: [],
                    conflicts: [],
                    unrepresentable: [],
                },
            },
            compact: {
                rendered: 'D:2030-12-31',
                assessment: {
                    emitted: [],
                    omitted: [],
                    collapsed: [],
                    conflicts: [],
                    unrepresentable: [],
                },
            },
        };
        const engine = passThroughEngine({
            process() {
                return {
                    rendered: renders.whole.rendered,
                    assessment: EMPTY_RENDER_ASSESSMENT,
                    renders,
                    assertions: [assertion],
                    valid: true,
                    errors: [],
                };
            },
        });
        const store = new TestStore(engine);

        await store.publishAssertions('document', [assertion]);

        expect(store.get('document').assertions[0]?.value).toBe('2030-12-31');
        expect(store.get('document').renders).toEqual(renders);
    });

    it('retains the engine aggregate verdict instead of reprocessing its facts', async () => {
        const assertion = mockAssertion({
            categoryId: 'level',
            conceptId: 'HIGH',
        });
        const errors = [
            {
                constraintId: '_invalid_contributor',
                message: 'A contributor is invalid.',
            },
        ];
        const engine = passThroughEngine({
            aggregateAssertions: () => ({
                rendered: 'HIGH',
                assertions: [assertion],
                valid: false,
                errors,
            }),
        });
        const process = vi.spyOn(engine, 'process');
        const store = new TestStore(engine);
        await store.publishAggregate('doc', [[assertion]]);
        expect(store.get('doc')).toMatchObject({
            rendered: 'HIGH',
            valid: false,
            errors,
            aggregate: true,
        });
        expect(process).not.toHaveBeenCalled();
        store.destroy();
    });

    it('overlays a category edit on a pending aggregate without losing new untouched categories', async () => {
        const pending = mockAssertion({
            categoryId: 'section',
            conceptId: 'NEW',
        });
        const chosen = mockAssertion({
            categoryId: 'level',
            conceptId: 'CHOSEN',
        });
        let release!: () => void;
        const gate = new Promise<void>((resolve) => {
            release = resolve;
        });
        const engine = passThroughEngine({
            aggregateAssertions: (sets) =>
                gate.then(() => ({
                    rendered: 'section:NEW',
                    assertions: sets.flat(),
                    valid: true,
                    errors: [],
                })),
        });
        const store = new TestStore(engine);
        const aggregate = store.publishAggregate('doc', [[pending]]);
        const edit = store.publishAssertions('doc', [chosen], undefined, {
            categories: ['level'],
        });
        release();
        await Promise.all([aggregate, edit]);
        expect(store.get('doc').assertions).toEqual([pending, chosen]);
        await store.seedRendered('doc', 'section:OLD');
        expect(store.get('doc').assertions).toEqual([pending, chosen]);
        store.destroy();
    });

    it('returns the empty state for unknown markings', () => {
        const store = new TestStore(passThroughEngine());
        expect(store.get('nope')).toBe(EMPTY_EZCLASSIFY_STATE);
    });

    it('commits a published marking and notifies subscribers', async () => {
        const store = new TestStore(passThroughEngine());
        const seen: EzClassifyState[] = [];
        store.subscribe('doc', (s) => seen.push(s));
        await store.publishRendered('doc', 'cat:concept');
        expect(store.get('doc').rendered).toBe('cat:concept');
        expect(seen.at(-1)?.assertions).toEqual([
            { categoryId: 'cat', conceptId: 'concept' },
        ]);
    });

    it('carries engine-derived display colors through markings and rollups', async () => {
        const markingColor = { background: '#123456', text: '#ffffff' };
        const rollupColor = { background: '#654321', text: '#ffffff' };
        const engine = passThroughEngine({
            process(input) {
                const base = passThroughEngine().process(input);
                if (base instanceof Promise)
                    throw new Error('unexpected async result');
                return { ...base, displayColor: markingColor };
            },
            aggregateAssertions(sets) {
                const base = passThroughEngine().aggregateAssertions(sets);
                if (base instanceof Promise)
                    throw new Error('unexpected async result');
                return { ...base, displayColor: rollupColor };
            },
        });
        const store = new TestStore(engine);
        store.setPartOf('doc', 'whole');

        await store.publishRendered('doc', 'cat:concept');
        await flushMicrotasks();

        expect(store.get('doc').displayColor).toEqual(markingColor);
        expect(store.getAggregate().displayColor).toEqual(rollupColor);
        expect(store.getWholeRollup('whole').displayColor).toEqual(rollupColor);
    });

    it('skips the originating listener via PublishSource token (cycle protection)', async () => {
        const store = new TestStore(passThroughEngine());
        const source = { token: Symbol('view') };
        const fn = vi.fn();
        store.subscribe('doc', fn, source);
        await store.publishRendered('doc', 'cat:c', source);
        expect(fn).not.toHaveBeenCalled();
        await store.publishRendered('doc', 'cat:d');
        expect(fn).toHaveBeenCalledTimes(1);
    });

    it('reconciles the originating listener when processing changes its assertions', async () => {
        const store = new TestStore(
            passThroughEngine({
                process(input) {
                    if (!Array.isArray(input)) {
                        return passThroughEngine().process(input);
                    }
                    return {
                        rendered: 'section:math',
                        assessment: EMPTY_RENDER_ASSESSMENT,
                        renders: {},
                        assertions: [
                            mockAssertion({
                                categoryId: 'section',
                                conceptId: 'math',
                            }),
                        ],
                        valid: true,
                        errors: [],
                    };
                },
            }),
        );
        const source = { token: Symbol('single-select') };
        const fn = vi.fn();
        store.subscribe('doc', fn, source);

        await store.publishAssertions(
            'doc',
            [mockAssertion({ categoryId: 'section', conceptId: 'reading' })],
            source,
        );

        expect(fn).toHaveBeenCalledTimes(1);
        expect(fn).toHaveBeenLastCalledWith(
            expect.objectContaining({
                rendered: 'section:math',
                assertions: [
                    mockAssertion({
                        categoryId: 'section',
                        conceptId: 'math',
                    }),
                ],
            }),
        );
    });

    it('delivers the same canonical correction to its source only once', async () => {
        const store = new TestStore(
            passThroughEngine({
                process() {
                    return {
                        rendered: 'section:math',
                        assessment: EMPTY_RENDER_ASSESSMENT,
                        renders: {},
                        assertions: [
                            mockAssertion({
                                categoryId: 'section',
                                conceptId: 'math',
                            }),
                        ],
                        valid: true,
                        errors: [],
                    };
                },
            }),
        );
        const source = { token: Symbol('corrected-view') };
        const fn = vi.fn();
        store.subscribe('doc', fn, source);
        const authored = [
            mockAssertion({ categoryId: 'section', conceptId: 'reading' }),
        ];

        await store.publishAssertions('doc', authored, source);
        await store.publishAssertions('doc', authored, source);

        expect(fn).toHaveBeenCalledTimes(1);
    });

    it('short-circuits an empty rendered publish to the empty state', async () => {
        const store = new TestStore(passThroughEngine());
        await store.publishRendered('doc', 'cat:c');
        await store.publishRendered('doc', '');
        expect(store.get('doc')).toBe(EMPTY_EZCLASSIFY_STATE);
    });

    it('recomputes the page aggregate from contributor assertions', async () => {
        const store = new TestStore(passThroughEngine());
        const agg: EzClassifyState[] = [];
        store.subscribeAggregate((s) => agg.push(s));
        await store.publishRendered('a', 'cat:x');
        await store.publishRendered('b', 'cat:y');
        await flushMicrotasks();
        expect(agg.length).toBeGreaterThan(0);
        expect(store.getAggregate().assertions).toEqual([
            { categoryId: 'cat', conceptId: 'x' },
            { categoryId: 'cat', conceptId: 'y' },
        ]);
    });

    it('rolls up only the parts under a whole', async () => {
        const store = new TestStore(passThroughEngine());
        store.setPartOf('p1', 'whole');
        store.setPartOf('p2', 'whole');
        const seen: EzClassifyState[] = [];
        store.subscribeWholeRollup('whole', (s) => seen.push(s));
        await store.publishRendered('p1', 'cat:x');
        await store.publishRendered('p2', 'cat:y');
        await store.publishRendered('unrelated', 'cat:z');
        await flushMicrotasks();
        const rollup = store.getWholeRollup('whole');
        expect(rollup.assertions).toEqual([
            { categoryId: 'cat', conceptId: 'x' },
            { categoryId: 'cat', conceptId: 'y' },
        ]);
    });

    it('publishes a part-surface entry in the scheme part format', async () => {
        // The store carries the whole surface's format. A marking that is a
        // part of another marking is a different surface, and the scheme names
        // the format that surface writes. Nothing here spells a format id: the
        // part format comes from the scheme metadata.
        const formats: (string | undefined)[] = [];
        const store = new TestStore(
            passThroughEngine({
                process(input, options): EzClassifyStoreProcessResult {
                    formats.push(options?.outputFormat);
                    const assertions = Array.isArray(input) ? [...input] : [];
                    return {
                        rendered: typeof input === 'string' ? input : '',
                        assessment: EMPTY_RENDER_ASSESSMENT,
                        renders: {},
                        assertions,
                        valid: true,
                        errors: [],
                    };
                },
                getSchemeMeta: () => ({
                    scopes: [],
                    defaultPartRenderFormat: 'short',
                }),
            }),
            { format: 'banner' },
        );
        store.setPartOf('portion', 'body');

        await store.publishRendered('portion', 'cat:x');
        expect(formats.at(-1)).toBe('short');

        await store.publishAssertions('portion', [
            { categoryId: 'cat', conceptId: 'x' } as Assertion,
        ]);
        expect(formats.at(-1)).toBe('short');

        // A marking that is nobody's part still publishes in the store's own
        // format, which is the control that proves the part branch is the
        // surface and not a blanket override.
        await store.publishRendered('standalone', 'cat:y');
        expect(formats.at(-1)).toBe('banner');
    });

    it('falls back to the store format when the scheme names no part format', async () => {
        const formats: (string | undefined)[] = [];
        const store = new TestStore(
            passThroughEngine({
                process(input, options): EzClassifyStoreProcessResult {
                    formats.push(options?.outputFormat);
                    return {
                        rendered: typeof input === 'string' ? input : '',
                        assessment: EMPTY_RENDER_ASSESSMENT,
                        renders: {},
                        assertions: Array.isArray(input) ? [...input] : [],
                        valid: true,
                        errors: [],
                    };
                },
            }),
            { format: 'banner' },
        );
        store.setPartOf('portion', 'body');

        await store.publishRendered('portion', 'cat:x');
        expect(formats.at(-1)).toBe('banner');
    });

    it('keeps the newest whole rollup when async computations finish out of order', async () => {
        const pending: Array<{
            assertions: Assertion[];
            resolve: (value: EzClassifyStoreProcessResult) => void;
        }> = [];
        const store = new TestStore(
            passThroughEngine({
                aggregateAssertions(sets) {
                    const assertions = sets.flat();
                    return new Promise<EzClassifyStoreProcessResult>(
                        (resolve) => pending.push({ assertions, resolve }),
                    );
                },
            }),
        );
        store.setPartOf('p1', 'whole');
        store.setPartOf('p2', 'whole');

        await store.publishRendered('p1', 'cat:x');
        await store.publishRendered('p2', 'cat:y');
        expect(pending).toHaveLength(4);

        const olderWhole = pending[1];
        const newestWhole = pending[3];
        newestWhole.resolve({
            rendered: 'cat:x cat:y',
            assessment: EMPTY_RENDER_ASSESSMENT,
            renders: {},
            assertions: newestWhole.assertions,
            valid: true,
            errors: [],
        });
        await flushMicrotasks();
        olderWhole.resolve({
            rendered: 'cat:x',
            assessment: EMPTY_RENDER_ASSESSMENT,
            renders: {},
            assertions: olderWhole.assertions,
            valid: true,
            errors: [],
        });
        await flushMicrotasks();

        expect(store.getWholeRollup('whole').assertions).toEqual([
            { categoryId: 'cat', conceptId: 'x' },
            { categoryId: 'cat', conceptId: 'y' },
        ]);
    });

    it('delivers per-category facet state via engine.suggest', async () => {
        const suggestions: Suggestion[] = [
            { categoryId: 'cat', conceptId: 'opt1' } as Suggestion,
            { categoryId: 'cat', conceptId: 'opt2' } as Suggestion,
        ];
        const store = new TestStore(
            passThroughEngine({ suggest: () => ({ suggestions }) }),
        );
        const seen: FacetState[] = [];
        store.subscribeFacet('doc', 'cat', (s) => seen.push(s));
        await store.publishRendered('doc', 'cat:opt1');
        await flushMicrotasks();
        expect(seen.at(-1)?.allowableOptions).toEqual(suggestions);
        expect(seen.at(-1)?.selectedAssertions).toEqual([
            { categoryId: 'cat', conceptId: 'opt1' },
        ]);
    });

    describe('a facet listener arriving after a commit its facet missed', () => {
        // `code` offers the codes of whichever `path` the marking holds, like
        // a list of codes keyed by the path chosen above it.
        function pathCodes(context: Assertion[]): {
            suggestions: Suggestion[];
        } {
            const path = context.find((a) => a.categoryId === 'path');
            return {
                suggestions: path
                    ? [
                          {
                              categoryId: 'code',
                              conceptId: `${path.conceptId}-1`,
                          } as Suggestion,
                      ]
                    : [],
            };
        }
        const offered = (seen: FacetState[]) =>
            seen.map((state) =>
                state.allowableOptions?.map((o) => o.conceptId),
            );

        it('gets the options for the marking as committed now', async () => {
            const store = new TestStore(
                passThroughEngine({ suggest: pathCodes }),
            );
            const stopFirst = store.subscribeFacet('doc', 'code', () => {});
            await store.publishRendered('doc', 'path:A');
            await flushMicrotasks();
            stopFirst();

            await store.publishRendered('doc', 'path:B');
            await flushMicrotasks();
            const seen: FacetState[] = [];
            store.subscribeFacet('doc', 'code', (state) => seen.push(state));
            await flushMicrotasks();

            expect(offered(seen)).toEqual([['B-1']]);
        });

        it('gets them when its predecessor left while that commit was being answered', async () => {
            // A control remounted by the change it depends on: the old one is
            // still subscribed when the change commits, and the new one
            // subscribes after the facet answer for it has landed.
            let hold = false;
            let answer: (() => void) | undefined;
            const store = new TestStore(
                passThroughEngine({
                    suggest: (context: Assertion[]) => {
                        const result = pathCodes(context);
                        if (!hold) return result;
                        return new Promise((resolve) => {
                            answer = () => resolve(result);
                        });
                    },
                }),
            );
            const stopFirst = store.subscribeFacet('doc', 'code', () => {});
            await store.publishRendered('doc', 'path:A');
            await flushMicrotasks();

            hold = true;
            await store.publishRendered('doc', 'path:B');
            stopFirst();
            hold = false;
            answer!();
            await flushMicrotasks();
            const seen: FacetState[] = [];
            store.subscribeFacet('doc', 'code', (state) => seen.push(state));
            await flushMicrotasks();

            expect(offered(seen)).toEqual([['B-1']]);
        });
    });

    it('signals show-all (null) facets when the engine has no suggest', async () => {
        const store = new TestStore(passThroughEngine());
        const seen: FacetState[] = [];
        store.subscribeFacet('doc', 'cat', (s) => seen.push(s));
        await store.publishRendered('doc', 'cat:opt1');
        await flushMicrotasks();
        expect(seen.at(-1)?.allowableOptions).toBeNull();
    });

    it('throws the normalized destroyed-store error after destroy', () => {
        const store = new TestStore(passThroughEngine());
        store.destroy();
        expect(() => store.subscribe('doc', () => {})).toThrow(
            '[ezclassify/test] TestStore: store has been destroyed',
        );
    });

    it('is idempotent on repeated destroy', () => {
        const store = new TestStore(passThroughEngine());
        store.destroy();
        expect(() => store.destroy()).not.toThrow();
    });

    it('invokes the onDestroy hook exactly once (adapter teardown seam)', () => {
        const store = new NoTeardownStore(passThroughEngine());
        store.destroy();
        store.destroy();
        expect(store.onDestroyCalls).toBe(1);
    });
});

// ---------------------------------------------------------------------------
// Scope-preserving publishAssertions
// ---------------------------------------------------------------------------
//
// publishAssertions must preserve scope-attributed assertions. A whole
// marking's banner render format binds no field to an alternate-scope
// category, so `render([authority-scope assertion])` returns "", and a
// render → process → commit round trip would discard every scope-attributed
// assertion.
//
// This engine models that faithfully. Scheme: default scope `marking`, alternate
// scope `authority`. Category `banner` is default-scope; `authority_type` and
// `classified_by` are authority-scope. `render` mirrors a banner format, it
// only emits default-scope categories, so an authority-only set renders "".

/** CategoryId → scope for the scoped test scheme. */
const SCOPED_SCHEME_CATEGORIES = [
    { id: 'banner', scopes: undefined },
    { id: 'authority_type', scopes: ['authority'] },
    { id: 'classified_by', scopes: ['authority'] },
];
const DEFAULT_SCOPE_CATEGORIES = new Set(['banner']);

function scopedEngine(): EzClassifyStoreEngine {
    return passThroughEngine({
        getSchemeMeta: () => ({
            defaultScope: 'marking',
            scopes: [
                { id: 'marking', label: 'Marking' },
                { id: 'authority', label: 'Authority Block' },
            ],
        }),
        listCategories: () => SCOPED_SCHEME_CATEGORIES,
        // Banner render: emit only default-scope categories. An authority-only
        // set renders "", exactly the shape that caused the drop.
        render(assertions) {
            return (assertions as Assertion[])
                .filter((a) => DEFAULT_SCOPE_CATEGORIES.has(a.categoryId))
                .map((a) => `${a.categoryId}:${a.conceptId}`)
                .join(' ');
        },
    });
}

const asKeys = (list: Assertion[]): string[] =>
    list.map((a) => `${a.categoryId}:${a.conceptId}`).sort();

describe('BaseEzClassifyStore: scope-preserving publishAssertions', () => {
    it('commits both default-scope and authority-scope assertions', async () => {
        const store = new TestStore(scopedEngine());
        await store.publishAssertions('doc', [
            { categoryId: 'banner', conceptId: 'SECRET' } as Assertion,
            {
                categoryId: 'classified_by',
                conceptId: 'JANE_DOE',
            } as Assertion,
        ]);
        expect(asKeys(store.get('doc').assertions)).toEqual([
            'banner:SECRET',
            'classified_by:JANE_DOE',
        ]);
    });

    it('leaves the rendered banner string unchanged by authority assertions', async () => {
        const store = new TestStore(scopedEngine());
        await store.publishAssertions('doc', [
            { categoryId: 'banner', conceptId: 'SECRET' } as Assertion,
        ]);
        const bannerOnly = store.get('doc').rendered;

        const store2 = new TestStore(scopedEngine());
        await store2.publishAssertions('doc', [
            { categoryId: 'banner', conceptId: 'SECRET' } as Assertion,
            {
                categoryId: 'authority_type',
                conceptId: 'ORIGINAL',
            } as Assertion,
        ]);
        // The banner render must be byte-identical: authority assertions never
        // reach the render call.
        expect(store2.get('doc').rendered).toBe(bannerOnly);
        expect(store2.get('doc').rendered).toBe('banner:SECRET');
    });

    it('commits an authority-only publish without dropping it (renders "")', async () => {
        const store = new TestStore(scopedEngine());
        await store.publishAssertions('doc', [
            {
                categoryId: 'authority_type',
                conceptId: 'ORIGINAL',
            } as Assertion,
        ]);
        expect(store.get('doc').rendered).toBe('');
        expect(asKeys(store.get('doc').assertions)).toEqual([
            'authority_type:ORIGINAL',
        ]);
    });

    it('does not shed scoped assertions across a republish/rollup cycle', async () => {
        const store = new TestStore(scopedEngine());
        store.setPartOf('doc', 'whole');
        await store.publishAssertions('doc', [
            { categoryId: 'banner', conceptId: 'SECRET' } as Assertion,
            {
                categoryId: 'classified_by',
                conceptId: 'JANE_DOE',
            } as Assertion,
        ]);
        // Republish carrying the already-committed assertions back in (the shape
        // ezclassify-ui uses when a facet re-emits: [...others, ...filtered]).
        const current = store.get('doc').assertions;
        await store.publishAssertions('doc', [...current]);
        await flushMicrotasks();
        expect(asKeys(store.get('doc').assertions)).toEqual([
            'banner:SECRET',
            'classified_by:JANE_DOE',
        ]);
        // The scoped assertion also survives into the whole-rollup contributors.
        expect(asKeys(store.getWholeRollup('whole').assertions)).toContain(
            'classified_by:JANE_DOE',
        );
    });

    it('preserves capture-value free text on a default-scope assertion (B2)', async () => {
        // The default-scope subset runs through process(assertions[]), not a
        // render→process round-trip. A render emits only concept labels, so a
        // round trip would drop the captured value ('20301231'); it must
        // survive byte-identically.
        const store = new TestStore(scopedEngine());
        const declassDate: Assertion = {
            categoryId: 'banner',
            conceptId: 'DECLASS_ON',
            value: '20301231',
        } as Assertion;
        await store.publishAssertions('doc', [declassDate]);
        const committed = store
            .get('doc')
            .assertions.find((a) => a.conceptId === 'DECLASS_ON');
        expect(committed?.value).toBe('20301231');
    });

    it('never round-trips a default-scope publish through a rendered string (B2)', async () => {
        // render() must not be consulted for a default-scope publish, the whole
        // point of de-stringification. Prove it by failing the test if render is
        // called on the default subset.
        const engine = scopedEngine();
        const renderSpy = vi.fn(engine.render);
        engine.render = renderSpy as typeof engine.render;
        const store = new TestStore(engine);
        await store.publishAssertions('doc', [
            {
                categoryId: 'banner',
                conceptId: 'DECLASS_ON',
                value: '20301231',
            } as Assertion,
        ]);
        expect(renderSpy).not.toHaveBeenCalled();
    });

    it('preserves alternate-scope assertions across a publishRendered banner edit (B7)', async () => {
        // Publish scoped authority assertions, then edit the banner via a
        // rendered string. A rendered string is default-scope input by
        // definition; the scoped authority assertions must survive unchanged.
        const store = new TestStore(scopedEngine());
        await store.publishAssertions('doc', [
            { categoryId: 'banner', conceptId: 'SECRET' } as Assertion,
            {
                categoryId: 'classified_by',
                conceptId: 'JANE_DOE',
                value: 'J. Doe, OCA',
            } as Assertion,
        ]);
        await store.publishRendered('doc', 'banner:TOP_SECRET');
        const committed = store.get('doc').assertions;
        expect(asKeys(committed)).toEqual([
            'banner:TOP_SECRET',
            'classified_by:JANE_DOE',
        ]);
        // The scoped capture value survives too.
        expect(
            committed.find((a) => a.categoryId === 'classified_by')?.value,
        ).toBe('J. Doe, OCA');
        // The banner reflects the new default-scope string.
        expect(store.get('doc').rendered).toBe('banner:TOP_SECRET');
    });

    it('clears alternate-scope assertions when publishRendered gets an empty string (B7)', async () => {
        const store = new TestStore(scopedEngine());
        await store.publishAssertions('doc', [
            { categoryId: 'banner', conceptId: 'SECRET' } as Assertion,
            {
                categoryId: 'classified_by',
                conceptId: 'JANE_DOE',
            } as Assertion,
        ]);
        await store.publishRendered('doc', '');
        expect(store.get('doc').assertions).toEqual([]);
    });

    it('treats an unknown (out-of-scheme) category as default-scope and preserves it', async () => {
        // A category the scheme does not list is treated as default-scope. Now
        // that the default-scope subset runs through `process(assertions[])`
        // instead of a lossy render→process round-trip, the unknown category is
        // preserved rather than dropped by the banner render, and it is NOT
        // parked as a scoped assertion.
        const store = new TestStore(scopedEngine());
        await store.publishAssertions('doc', [
            { categoryId: 'banner', conceptId: 'SECRET' } as Assertion,
            { categoryId: 'mystery', conceptId: 'X' } as Assertion,
        ]);
        expect(asKeys(store.get('doc').assertions)).toEqual([
            'banner:SECRET',
            'mystery:X',
        ]);
    });

    it('treats every assertion as default-scope when the scheme declares no scopes', async () => {
        // passThroughEngine declares an empty scope list, so the resolved index
        // is empty and every assertion is default-scope. The default subset now
        // runs through process(assertions[]), the engine still computes the
        // rendered banner from the result.
        const store = new TestStore(passThroughEngine());
        await store.publishAssertions('doc', [
            { categoryId: 'cat', conceptId: 'x' } as Assertion,
        ]);
        expect(store.get('doc').rendered).toBe('cat:x');
        expect(asKeys(store.get('doc').assertions)).toEqual(['cat:x']);
    });

    it('refuses to construct on an engine missing a required capability', () => {
        const noAggregate = {
            ...passThroughEngine(),
        } as Partial<EzClassifyStoreEngine>;
        delete noAggregate.aggregateAssertions;
        expect(
            () => new TestStore(noAggregate as EzClassifyStoreEngine),
        ).toThrow(/requires engine\.aggregateAssertions/);
    });
});

describe('facetStateEqual', () => {
    const prev = (
        allowable: Suggestion[] | null,
        selected: Assertion[],
    ): FacetState => ({
        allowableOptions: allowable,
        selectedAssertions: selected,
    });

    it('treats null vs non-null allowable as different', () => {
        expect(facetStateEqual(prev(null, []), [], [])).toBe(false);
        expect(facetStateEqual(prev([], []), null, [])).toBe(false);
    });

    it('returns true when concept+category pairs match', () => {
        const a: Suggestion[] = [
            { categoryId: 'c', conceptId: 'x' } as Suggestion,
        ];
        const sel: Assertion[] = [
            { categoryId: 'c', conceptId: 'y' } as Assertion,
        ];
        expect(
            facetStateEqual(
                prev(a, sel),
                [{ categoryId: 'c', conceptId: 'x' } as Suggestion],
                [{ categoryId: 'c', conceptId: 'y' } as Assertion],
            ),
        ).toBe(true);
    });

    it('ignores order in the allowable + selected sets', () => {
        const a: Suggestion[] = [
            { categoryId: 'c', conceptId: 'x' } as Suggestion,
            { categoryId: 'c', conceptId: 'y' } as Suggestion,
        ];
        expect(
            facetStateEqual(
                prev(a, []),
                [
                    { categoryId: 'c', conceptId: 'y' } as Suggestion,
                    { categoryId: 'c', conceptId: 'x' } as Suggestion,
                ],
                [],
            ),
        ).toBe(true);
    });

    it('returns false when an allowable concept differs', () => {
        const a: Suggestion[] = [
            { categoryId: 'c', conceptId: 'x' } as Suggestion,
        ];
        expect(
            facetStateEqual(
                prev(a, []),
                [{ categoryId: 'c', conceptId: 'z' } as Suggestion],
                [],
            ),
        ).toBe(false);
    });

    it('returns false when selection length differs', () => {
        expect(
            facetStateEqual(
                prev([], [{ categoryId: 'c', conceptId: 'x' } as Assertion]),
                [],
                [],
            ),
        ).toBe(false);
    });
});
