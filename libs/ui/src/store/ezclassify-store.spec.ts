import { describe, it, expect, vi } from 'vitest';
import {
    createPassThroughEngine,
    runEzClassifyStoreConformance,
    runEzClassifyStoreBudgetConformance,
    runEzClassifyStoreSeedConformance,
} from '@ezclassify/testing-utils';
import { loadMultiScopeRegression } from '../../test-fixtures/load-multi-scope-regression';
import {
    VanillaEzClassifyStore,
    type EzClassifyStoreEngine,
} from './ezclassify-store';
import type { SchemeEngineAdapter } from '@ezclassify/types';
import { EMPTY_RENDER_ASSESSMENT } from '../engine-result-mock';

function passThrough(): EzClassifyStoreEngine {
    return createPassThroughEngine();
}

runEzClassifyStoreConformance(() => new VanillaEzClassifyStore(passThrough()), {
    suiteName: 'VanillaEzClassifyStore',
});

runEzClassifyStoreBudgetConformance(
    (engine) => new VanillaEzClassifyStore(engine),
    { suiteName: 'VanillaEzClassifyStore' },
);

runEzClassifyStoreSeedConformance(
    (engine) => new VanillaEzClassifyStore(engine),
    { suiteName: 'VanillaEzClassifyStore' },
);

// Integration-flavored coverage for the two aggregate axes. The
// store-conformance suite above pins the per-API behavior; these tests
// pin the *scenarios* the gov-marking demo's section-1 rollup +
// page-classification banners depend on.
describe('VanillaEzClassifyStore: page aggregate vs whole-rollup', () => {
    /**
     * Drain enough microtasks for the chained recompute promises
     * (`recomputeAggregate` and `recomputeWholeRollup`) to settle.
     */
    const flush = async () => {
        for (let i = 0; i < 4; i++) await Promise.resolve();
    };

    it('page aggregate includes the whole, the parts, and standalone markings', async () => {
        const store = new VanillaEzClassifyStore(passThrough());
        store.setPartOf('p1', 'doc');
        store.setPartOf('p2', 'doc');
        await store.publishRendered('doc', 'level:public');
        await store.publishRendered('p1', 'level:secret');
        await store.publishRendered('p2', 'origin:army');
        await store.publishRendered('side', 'tag:standalone');
        await flush();
        const agg = store.getAggregate();
        for (const expected of [
            'level:public',
            'level:secret',
            'origin:army',
            'tag:standalone',
        ]) {
            expect(agg.rendered).toContain(expected);
        }
    });

    it("whole-rollup includes only the named whole's parts, not the whole, not other parts, not standalones", async () => {
        const store = new VanillaEzClassifyStore(passThrough());
        store.setPartOf('p1', 'doc');
        store.setPartOf('p2', 'doc');
        store.setPartOf('other-part', 'other-doc');
        await store.publishRendered('doc', 'level:public');
        await store.publishRendered('p1', 'level:secret');
        await store.publishRendered('p2', 'origin:army');
        await store.publishRendered('other-part', 'level:other');
        await store.publishRendered('side', 'tag:standalone');
        await flush();
        const rollup = store.getWholeRollup('doc');
        expect(rollup.rendered).toContain('level:secret');
        expect(rollup.rendered).toContain('origin:army');
        expect(rollup.rendered).not.toContain('level:public');
        expect(rollup.rendered).not.toContain('level:other');
        expect(rollup.rendered).not.toContain('tag:standalone');
    });

    it('editing a part fires both the page-aggregate and the whole-rollup listener for that part', async () => {
        const store = new VanillaEzClassifyStore(passThrough());
        store.setPartOf('p1', 'doc');
        const aggCb = vi.fn();
        const docRollupCb = vi.fn();
        store.subscribeAggregate(aggCb);
        store.subscribeWholeRollup('doc', docRollupCb);
        aggCb.mockClear();
        docRollupCb.mockClear();
        await store.publishRendered('p1', 'level:secret');
        await flush();
        expect(aggCb).toHaveBeenCalled();
        expect(docRollupCb).toHaveBeenCalled();
        const aggLast = aggCb.mock.calls[aggCb.mock.calls.length - 1]?.[0];
        const rollupLast =
            docRollupCb.mock.calls[docRollupCb.mock.calls.length - 1]?.[0];
        expect(aggLast.rendered).toContain('level:secret');
        expect(rollupLast.rendered).toContain('level:secret');
    });

    it('editing the whole fires page-aggregate but NOT its own whole-rollup', async () => {
        const store = new VanillaEzClassifyStore(passThrough());
        // A whole isn't part-of itself, no setPartOf call. Subscribers should
        // see a page-aggregate movement, not a whole-rollup tick.
        const aggCb = vi.fn();
        const docRollupCb = vi.fn();
        store.subscribeAggregate(aggCb);
        store.subscribeWholeRollup('doc', docRollupCb);
        aggCb.mockClear();
        docRollupCb.mockClear();
        await store.publishRendered('doc', 'level:public');
        await flush();
        expect(aggCb).toHaveBeenCalled();
        expect(docRollupCb).not.toHaveBeenCalled();
    });
});

// These tests use the multi-scope fixture to verify the store calls
// engine.aggregate rather than engine.process(joined). The joined-string path
// is incorrect because a space-concatenation of separate markings is not a
// valid input for a scheme parser, and max/union/intersect rollup semantics
// are only available through the aggregator, not the parser. A concat path
// would give these tests the wrong level (or empty).
describe('VanillaEzClassifyStore: aggregate uses engine.aggregate', () => {
    const flush = async () => {
        for (let i = 0; i < 4; i++) await Promise.resolve();
    };

    it('two standalone markings with different tiers → page aggregate is the max level', async () => {
        const store = new VanillaEzClassifyStore(
            loadMultiScopeRegression() as unknown as EzClassifyStoreEngine,
        );
        await store.publishRendered('low', 'STUDENTS');
        await store.publishRendered('high', 'DISTRICT COORDINATORS');
        await flush();
        expect(store.getAggregate().rendered).toBe('DISTRICT COORDINATORS');
    });

    it('three parts under one whole → getWholeRollup returns max level', async () => {
        const store = new VanillaEzClassifyStore(
            loadMultiScopeRegression() as unknown as EzClassifyStoreEngine,
        );
        store.setPartOf('p1', 'doc');
        store.setPartOf('p2', 'doc');
        store.setPartOf('p3', 'doc');
        await store.publishRendered('p1', 'STUDENTS');
        await store.publishRendered('p2', 'SCHOOL STAFF');
        await store.publishRendered('p3', 'DISTRICT COORDINATORS');
        await flush();
        expect(store.getWholeRollup('doc').rendered).toBe(
            'DISTRICT COORDINATORS',
        );
    });

    it('three parts under one whole → page aggregate also reaches max level', async () => {
        const store = new VanillaEzClassifyStore(
            loadMultiScopeRegression() as unknown as EzClassifyStoreEngine,
        );
        store.setPartOf('p1', 'doc');
        store.setPartOf('p2', 'doc');
        store.setPartOf('p3', 'doc');
        // The whole itself (doc) is at STATE ASSESSMENT STAFF, higher than any part
        await store.publishRendered('doc', 'STATE ASSESSMENT STAFF');
        await store.publishRendered('p1', 'STUDENTS');
        await store.publishRendered('p2', 'SCHOOL STAFF');
        await store.publishRendered('p3', 'DISTRICT COORDINATORS');
        await flush();
        // Page aggregate = whole + all parts. Max level wins: STATE ASSESSMENT STAFF.
        expect(store.getAggregate().rendered).toBe('STATE ASSESSMENT STAFF');
        // Whole-rollup = parts only (doc excluded per binding-model §1.x). Max of parts: DISTRICT_COORDINATORS.
        expect(store.getWholeRollup('doc').rendered).toBe(
            'DISTRICT COORDINATORS',
        );
    });
});

// Regression: when each contributor's rendered string would not parse
// against the scheme's default render format, the store must NOT round-trip
// through the parser. It should pass each contributor's assertion set to the
// engine's assertion-side aggregate so the level survives.
//
// Models the banner-vs-part round-trip bug. A banner-format scheme (where
// rendered strings look like "TIER 3") would silently produce empty assertions
// if asked to re-parse part-format strings like "(T3//NET-G)". The store
// should never go through that round-trip.
describe('VanillaEzClassifyStore: aggregateAssertions skips string round-trip', () => {
    const flush = async () => {
        for (let i = 0; i < 4; i++) await Promise.resolve();
    };

    // Engine where `aggregate(strings)` is intentionally broken, only
    // `aggregateAssertions` returns useful results. Proves the store calls
    // the assertion-side API now.
    const assertionOnlyEngine = (): EzClassifyStoreEngine => ({
        process(input) {
            const rendered = typeof input === 'string' ? input : '';
            const assertions: { categoryId: string; conceptId: string }[] = [];
            if (typeof input === 'string' && input.includes(':')) {
                const [categoryId, conceptId] = input.split(':');
                if (categoryId && conceptId)
                    assertions.push({ categoryId, conceptId });
            } else if (Array.isArray(input)) {
                for (const a of input)
                    assertions.push(
                        a as { categoryId: string; conceptId: string },
                    );
            }
            return {
                rendered,
                assessment: EMPTY_RENDER_ASSESSMENT,
                renders: {},
                assertions: assertions as unknown as never,
                valid: true,
                errors: [],
            };
        },
        render(assertions) {
            return (assertions as { categoryId: string; conceptId: string }[])
                .map((a) => `${a.categoryId}:${a.conceptId}`)
                .join(' ');
        },
        aggregate() {
            // Deliberately broken: proves the store never calls this path.
            return { rendered: '', assertions: [], valid: false, errors: [] };
        },
        aggregateAssertions(assertionSets) {
            const merged = assertionSets.flat();
            const rendered = (
                merged as { categoryId: string; conceptId: string }[]
            )
                .map((a) => `${a.categoryId}:${a.conceptId}`)
                .join(' ');
            return { rendered, assertions: merged, valid: true, errors: [] };
        },
        getSchemeMeta: () => ({ scopes: [] }),
        listCategories: () => [],
    });

    it('page aggregate uses aggregateAssertions when contributors carry assertions', async () => {
        const store = new VanillaEzClassifyStore(assertionOnlyEngine());
        await store.publishRendered('a', 'level:secret');
        await store.publishRendered('b', 'origin:army');
        await flush();
        const agg = store.getAggregate();
        expect(agg.rendered).toContain('level:secret');
        expect(agg.rendered).toContain('origin:army');
    });

    it('whole-rollup uses aggregateAssertions when contributors carry assertions', async () => {
        const store = new VanillaEzClassifyStore(assertionOnlyEngine());
        store.setPartOf('p1', 'doc');
        store.setPartOf('p2', 'doc');
        await store.publishRendered('p1', 'level:secret');
        await store.publishRendered('p2', 'origin:army');
        await flush();
        const rollup = store.getWholeRollup('doc');
        expect(rollup.rendered).toContain('level:secret');
        expect(rollup.rendered).toContain('origin:army');
    });
});

// The lossy `aggregate(strings)` fallback for engines lacking
// `aggregateAssertions` was DELETED. A store that cannot roll up over
// structured assertions cannot guarantee lossless transport, so it refuses to
// construct rather than silently drop alternate-scope categories and capture
// values one layer up in the rollup. The required-capability contract is pinned
// here.
describe('VanillaEzClassifyStore: required capabilities (no lossy fallback)', () => {
    const base = (): Record<string, unknown> => ({
        process: () => ({
            rendered: '',
            assertions: [],
            valid: true,
            errors: [],
        }),
        render: () => '',
        aggregate: () => ({
            rendered: '',
            assertions: [],
            valid: true,
            errors: [],
        }),
        aggregateAssertions: () => ({
            rendered: '',
            assertions: [],
            valid: true,
            errors: [],
        }),
        getSchemeMeta: () => ({ scopes: [] }),
        listCategories: () => [],
    });

    it('throws naming aggregateAssertions when it is absent', () => {
        const engine = { ...base() };
        delete engine.aggregateAssertions;
        expect(
            () =>
                new VanillaEzClassifyStore(
                    engine as unknown as EzClassifyStoreEngine,
                ),
        ).toThrow(/requires engine\.aggregateAssertions/);
    });

    it('throws naming getSchemeMeta when it is absent', () => {
        const engine = { ...base() };
        delete engine.getSchemeMeta;
        expect(
            () =>
                new VanillaEzClassifyStore(
                    engine as unknown as EzClassifyStoreEngine,
                ),
        ).toThrow(/requires engine\.getSchemeMeta/);
    });

    it('throws naming listCategories when it is absent', () => {
        const engine = { ...base() };
        delete engine.listCategories;
        expect(
            () =>
                new VanillaEzClassifyStore(
                    engine as unknown as EzClassifyStoreEngine,
                ),
        ).toThrow(/requires engine\.listCategories/);
    });

    it('constructs when all three required capabilities are present', () => {
        expect(
            new VanillaEzClassifyStore(
                base() as unknown as EzClassifyStoreEngine,
            ),
        ).toBeDefined();
    });
});

// ---------------------------------------------------------------------------
// subscribeFacet, per-category availability driven by a single suggest call
// ---------------------------------------------------------------------------

describe('VanillaEzClassifyStore: subscribeFacet: suggest call budget per marking change', () => {
    const flush = async () => {
        for (let i = 0; i < 8; i++) await Promise.resolve();
    };

    it('calls suggest once per subscribed category (own-category exclusion fix)', async () => {
        const suggestSpy = vi.fn().mockReturnValue({ suggestions: [] });
        const engine: EzClassifyStoreEngine = {
            process: (input) => ({
                rendered: typeof input === 'string' ? input : 'a:b',
                assessment: EMPTY_RENDER_ASSESSMENT,
                renders: {},
                assertions:
                    typeof input === 'string'
                        ? [
                              {
                                  conceptId: 'b',
                                  categoryId: 'a',
                                  confidence: 'certain',
                                  source: 'user',
                              },
                          ]
                        : (input as never),
                valid: true,
                errors: [],
            }),
            render: (assertions) =>
                (assertions as { categoryId: string; conceptId: string }[])
                    .map((a) => `${a.categoryId}:${a.conceptId}`)
                    .join(' '),
            aggregate: () => ({
                rendered: '',
                assertions: [],
                valid: true,
                errors: [],
            }),
            suggest: suggestSpy,
            aggregateAssertions: () => ({
                rendered: '',
                assertions: [],
                valid: true,
                errors: [],
            }),
            getSchemeMeta: () => ({ scopes: [] }),
            listCategories: () => [],
        };
        const store = new VanillaEzClassifyStore(engine);

        // Two separate category facets subscribed to the same marking.
        const tierCb = vi.fn();
        const compartmentCb = vi.fn();
        store.subscribeFacet('doc', 'level', tierCb);
        store.subscribeFacet('doc', 'test_section', compartmentCb);

        await store.publishAssertions('doc', [
            {
                conceptId: 'SCHOOL_STAFF',
                categoryId: 'level',
                confidence: 'certain',
                source: 'user',
            },
        ]);
        await flush();

        // One suggest call per subscribed category (2 here), each excludes that
        // category's own assertions so single-select facets can offer all options.
        expect(suggestSpy).toHaveBeenCalledTimes(2);

        store.destroy();
    });

    it('does not call suggest when there are no facet subscribers', async () => {
        const suggestSpy = vi.fn().mockReturnValue({ suggestions: [] });
        const engine: EzClassifyStoreEngine = {
            process: () => ({
                rendered: 'x',
                assessment: EMPTY_RENDER_ASSESSMENT,
                renders: {},
                assertions: [],
                valid: true,
                errors: [],
            }),
            render: () => 'x',
            aggregate: () => ({
                rendered: '',
                assertions: [],
                valid: true,
                errors: [],
            }),
            suggest: suggestSpy,
            aggregateAssertions: () => ({
                rendered: '',
                assertions: [],
                valid: true,
                errors: [],
            }),
            getSchemeMeta: () => ({ scopes: [] }),
            listCategories: () => [],
        };
        const store = new VanillaEzClassifyStore(engine);

        await store.publishRendered('doc', 'x');
        await flush();

        expect(suggestSpy).not.toHaveBeenCalled();

        store.destroy();
    });
});

describe('VanillaEzClassifyStore: subscribeFacet: sibling-gating and no-churn', () => {
    const flush = async () => {
        for (let i = 0; i < 6; i++) await Promise.resolve();
    };

    it('from_school facet is notified when level changes to the gating value', async () => {
        const engine =
            loadMultiScopeRegression() as unknown as EzClassifyStoreEngine &
                SchemeEngineAdapter;
        const store = new VanillaEzClassifyStore(engine);

        const cb = vi.fn();
        store.subscribeFacet('doc', 'from_school', cb);

        // No level → school choices gated out
        await store.publishAssertions('doc', []);
        await flush();

        const firstCall = cb.mock.calls[cb.mock.calls.length - 1]?.[0];
        const gatedOut = firstCall?.allowableOptions ?? [];

        // Level = SCHOOL_STAFF → school choices become available
        await store.publishAssertions('doc', [
            {
                conceptId: 'SCHOOL_STAFF',
                categoryId: 'level',
                confidence: 'certain',
                source: 'user',
            },
        ]);
        await flush();

        const secondCall = cb.mock.calls[cb.mock.calls.length - 1]?.[0];
        const unGated = secondCall?.allowableOptions ?? [];

        // After SCHOOL_STAFF, school choices are available; they were not before.
        expect(unGated.length).toBeGreaterThan(gatedOut.length);
        expect(
            unGated.some(
                (s: { categoryId: string }) => s.categoryId === 'from_school',
            ),
        ).toBe(true);

        store.destroy();
    });

    it('unaffected facet is not notified when its allowable set is unchanged', async () => {
        const engine =
            loadMultiScopeRegression() as unknown as EzClassifyStoreEngine &
                SchemeEngineAdapter;
        const store = new VanillaEzClassifyStore(engine);

        const tierCb = vi.fn();
        // Subscribe to a category that won't change across the two commits below.
        store.subscribeFacet('doc', 'level', tierCb);

        // First publish, primes the cache; listener should fire.
        await store.publishAssertions('doc', [
            {
                conceptId: 'SCHOOL_STAFF',
                categoryId: 'level',
                confidence: 'certain',
                source: 'user',
            },
        ]);
        await flush();
        const callsAfterFirst = tierCb.mock.calls.length;

        // Second identical publish, same assertions, same suggest results for level.
        // The diff should detect no change and the level listener should NOT fire again.
        await store.publishAssertions('doc', [
            {
                conceptId: 'SCHOOL_STAFF',
                categoryId: 'level',
                confidence: 'certain',
                source: 'user',
            },
        ]);
        await flush();

        expect(tierCb.mock.calls.length).toBe(callsAfterFirst);

        store.destroy();
    });
});

// VanillaEzClassifyStore is a BaseEzClassifyStore subclass that supplies only
// a plain-field cell (the same seam the framework adapters fill with a ref or
// signal). These tests pin the two vanilla-specific pieces so a change to the
// subclass, as opposed to the shared base, fails here next to the class it covers.
describe('VanillaEzClassifyStore: plain-cell subclass seam', () => {
    it('publishing after destroy() rejects with the vanilla store label', async () => {
        const store = new VanillaEzClassifyStore(passThrough());
        store.destroy();
        await expect(
            store.publishRendered('doc', 'level:secret'),
        ).rejects.toThrow(
            '[ezclassify] EzClassifyStore: store has been destroyed',
        );
    });

    it('reads committed state back synchronously through the plain-field cell', async () => {
        const store = new VanillaEzClassifyStore(passThrough());
        await store.publishRendered('doc', 'level:secret');
        // No flush: the cell is a plain field, so the state written by the commit
        // must be visible the moment publishRendered resolves.
        expect(store.get('doc').rendered).toBe('level:secret');
        expect(store.get('doc').valid).toBe(true);
        store.destroy();
    });
});
