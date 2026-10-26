/**
 * Behavior of VanillaEzClassifyStore and bindEzClassifyToObject around their
 * trickier contracts: store/host-value lockstep, facet category scoping,
 * rendered-string round-trips, part-of rollup moves, null-result guards,
 * destroy semantics, and subscription cleanup.
 *
 * These run in jsdom alongside ezclassify-ui-ezclassify-store.spec.ts, which
 * covers the common store paths.
 */

import { describe, it, expect, vi } from 'vitest';
import {
    VanillaEzClassifyStore,
    type EzClassifyStoreEngine,
    type EzClassifyStoreProcessResult,
    EMPTY_EZCLASSIFY_STATE,
} from './ezclassify-store';
import {
    bindEzClassifyToObject,
    writeDocPath,
} from '../bind-ezclassify-to-object';
import type { Assertion, Suggestion } from '@ezclassify/types';
import { EMPTY_RENDER_ASSESSMENT } from '../engine-result-mock';

/**
 * A complete {@link Suggestion} for a concept, so a case can name the two fields
 * it cares about without restating the display members the store never reads.
 */
function suggestion(categoryId: string, conceptId: string): Suggestion {
    return {
        categoryId,
        conceptId,
        label: conceptId,
        description: '',
        name: conceptId,
        views: {},
        group: categoryId,
        selected: false,
        order: 0,
        source: 'parse',
    };
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** Drain microtasks so fire-and-forget async tasks settle. */
const flush = async (ticks = 6): Promise<void> => {
    for (let i = 0; i < ticks; i++) await Promise.resolve();
};

/** Complete process result for the deliberately format-free test engines. */
const processResult = (
    rendered: string,
    assertions: Assertion[] = [],
): EzClassifyStoreProcessResult => ({
    rendered,
    assessment: EMPTY_RENDER_ASSESSMENT,
    renders: {},
    assertions,
    valid: true,
    errors: [],
});

/** Minimal pass-through engine: process returns input, render joins assertions. */
function passThroughEngine(
    overrides: Partial<EzClassifyStoreEngine> = {},
): EzClassifyStoreEngine {
    return {
        process(input): EzClassifyStoreProcessResult {
            const rendered =
                typeof input === 'string'
                    ? input
                    : (input as Assertion[])
                          .map((a) => `${a.categoryId}:${a.conceptId}`)
                          .join(' ');
            const assertions: Assertion[] =
                typeof input === 'string'
                    ? input
                          .split(/\s+/)
                          .filter((p) => p.includes(':'))
                          .map((p) => {
                              const [cat, con] = p.split(':');
                              return {
                                  categoryId: cat,
                                  conceptId: con,
                                  confidence: 'certain',
                                  source: 'parse',
                              } as Assertion;
                          })
                    : (input as Assertion[]);
            return processResult(rendered, assertions);
        },
        render(assertions) {
            return (assertions as Assertion[])
                .map((a) => `${a.categoryId}:${a.conceptId}`)
                .join(' ');
        },
        aggregate(inputs: string[]): EzClassifyStoreProcessResult {
            return processResult(inputs.join(' '));
        },
        aggregateAssertions(sets: Assertion[][]): EzClassifyStoreProcessResult {
            const merged = sets.flat();
            return processResult(
                merged.map((a) => `${a.categoryId}:${a.conceptId}`).join(' '),
                merged,
            );
        },
        getSchemeMeta: () => ({ scopes: [] }),
        listCategories: () => [],
        ...overrides,
    };
}

// ---------------------------------------------------------------------------
// 1. Store + host-value lockstep commit  (rendered-is-primary contract)
// ---------------------------------------------------------------------------

describe('store + host-value lockstep (rendered-is-primary)', () => {
    it('store.get().rendered and the bound doc field update on the same commit tick', async () => {
        const store = new VanillaEzClassifyStore(passThroughEngine());
        const doc: { classification: string } = { classification: '' };
        const handle = bindEzClassifyToObject(store, doc, {
            'doc-marking': 'classification',
        });

        await store.publishRendered('doc-marking', 'level:S');

        // Both sides reflect the same rendered string, no partial-update window.
        expect(store.get('doc-marking').rendered).toBe('level:S');
        expect(doc.classification).toBe('level:S');

        handle.dispose();
        store.destroy();
    });

    it('publishAssertions updates both store.assertions and the bound doc field', async () => {
        const store = new VanillaEzClassifyStore(passThroughEngine());
        const doc: { tags?: Assertion[] } = {};
        const handle = bindEzClassifyToObject(store, doc, {
            'tag-marking': { path: 'tags', mode: 'assertions' },
        });

        const assertions: Assertion[] = [
            {
                categoryId: 'level',
                conceptId: 'S',
                confidence: 'certain',
                source: 'user',
            },
        ];
        await store.publishAssertions('tag-marking', assertions);

        // The engine re-parses the rendered string, so source changes from 'user' to 'parse'.
        // Check conceptId/categoryId which survive the round-trip.
        expect(store.get('tag-marking').assertions[0]).toMatchObject({
            conceptId: 'S',
            categoryId: 'level',
        });
        expect(doc.tags?.[0]).toMatchObject({
            conceptId: 'S',
            categoryId: 'level',
        });

        handle.dispose();
        store.destroy();
    });

    it('empty publish resets both store and doc to EMPTY_EZCLASSIFY_STATE.rendered', async () => {
        const store = new VanillaEzClassifyStore(passThroughEngine());
        const doc: { classification: string } = { classification: 'level:S' };
        const handle = bindEzClassifyToObject(store, doc, {
            'doc-marking': 'classification',
        });

        // Seed a non-empty state first
        await store.publishRendered('doc-marking', 'level:S');
        expect(store.get('doc-marking').rendered).toBe('level:S');

        // Empty publish resets the marking
        await store.publishRendered('doc-marking', '');
        expect(store.get('doc-marking').rendered).toBe(
            EMPTY_EZCLASSIFY_STATE.rendered,
        );
        expect(doc.classification).toBe('');

        handle.dispose();
        store.destroy();
    });
});

// ---------------------------------------------------------------------------
// 2. Facet category scoping
// ---------------------------------------------------------------------------

describe('subscribeFacet: category scoping (facet category is a hard scope)', () => {
    it('selectedAssertions contains only assertions from the subscribed categoryId', async () => {
        const store = new VanillaEzClassifyStore(passThroughEngine());
        const facetStates: { selectedAssertions: Assertion[] }[] = [];
        store.subscribeFacet('doc', 'level', (s) => facetStates.push(s));

        await store.publishAssertions('doc', [
            {
                categoryId: 'level',
                conceptId: 'S',
                confidence: 'certain',
                source: 'user',
            },
            {
                categoryId: 'caveat',
                conceptId: 'NF',
                confidence: 'certain',
                source: 'user',
            },
        ]);
        await flush();

        const last = facetStates[facetStates.length - 1];
        expect(last).toBeDefined();
        // Only the 'level' assertion is scoped to this facet
        expect(
            last.selectedAssertions.every((a) => a.categoryId === 'level'),
        ).toBe(true);
        expect(last.selectedAssertions.some((a) => a.conceptId === 'S')).toBe(
            true,
        );
        // 'caveat' assertions must NOT appear
        expect(
            last.selectedAssertions.some((a) => a.categoryId === 'caveat'),
        ).toBe(false);

        store.destroy();
    });

    it('allowableOptions from suggest are filtered to only the subscribed categoryId', async () => {
        const allSuggestions: Suggestion[] = [
            suggestion('level', 'U'),
            suggestion('level', 'S'),
            suggestion('caveat', 'NF'),
        ];
        const engine = passThroughEngine({
            suggest: vi.fn().mockResolvedValue({ suggestions: allSuggestions }),
        });
        const store = new VanillaEzClassifyStore(engine);
        const facetStates: { allowableOptions: Suggestion[] | null }[] = [];
        store.subscribeFacet('doc', 'level', (s) => facetStates.push(s));

        await store.publishRendered('doc', 'level:S');
        await flush();

        const last = facetStates[facetStates.length - 1];
        expect(last).toBeDefined();
        expect(last.allowableOptions).not.toBeNull();
        // Only level suggestions appear
        expect(
            last.allowableOptions!.every((s) => s.categoryId === 'level'),
        ).toBe(true);
        // caveat suggestion filtered out
        expect(
            last.allowableOptions!.some((s) => s.categoryId === 'caveat'),
        ).toBe(false);

        store.destroy();
    });

    it('facet with no-suggest engine receives null allowableOptions (show-all fallback)', async () => {
        // Engine without suggest, triggers the else branch in refreshFacets (line 502).
        const engine: EzClassifyStoreEngine = {
            process: () => processResult('x'),
            render: () => 'x',
            aggregate: () => processResult(''),
            aggregateAssertions: () => processResult(''),
            getSchemeMeta: () => ({ scopes: [] }),
            listCategories: () => [],
            // suggest intentionally absent
        };
        const store = new VanillaEzClassifyStore(engine);
        const facetStates: { allowableOptions: Suggestion[] | null }[] = [];
        store.subscribeFacet('doc', 'level', (s) => facetStates.push(s));

        await store.publishRendered('doc', 'x');
        await flush();

        const last = facetStates[facetStates.length - 1];
        expect(last).toBeDefined();
        // null = show-all fallback
        expect(last.allowableOptions).toBeNull();

        store.destroy();
    });

    it('second subscribeFacet to the same marking+category reuses the existing listener set', async () => {
        const store = new VanillaEzClassifyStore(passThroughEngine());
        const cb1 = vi.fn();
        const cb2 = vi.fn();
        const unsub1 = store.subscribeFacet('doc', 'level', cb1);
        const unsub2 = store.subscribeFacet('doc', 'level', cb2); // reuses existing set

        await store.publishRendered('doc', 'level:S');
        await flush();

        expect(cb1).toHaveBeenCalled();
        expect(cb2).toHaveBeenCalled();

        // Unsubscribe one; the other still receives updates.
        unsub1();
        cb2.mockClear();
        await store.publishRendered('doc', 'level:U');
        await flush();
        expect(cb2).toHaveBeenCalled();

        unsub2();
        store.destroy();
    });

    it('facetStateEqual skips listener when allowable null→null and selected unchanged', async () => {
        const engine: EzClassifyStoreEngine = {
            process: () => processResult('x'),
            render: () => 'x',
            aggregate: () => processResult(''),
            aggregateAssertions: () => processResult(''),
            getSchemeMeta: () => ({ scopes: [] }),
            listCategories: () => [],
            // no suggest → null allowable
        };
        const store = new VanillaEzClassifyStore(engine);
        const cb = vi.fn();
        store.subscribeFacet('doc', 'level', cb);

        await store.publishRendered('doc', 'x');
        await flush();
        const callsAfterFirst = cb.mock.calls.length;

        // Second identical publish: same null allowable, same empty selected.
        // Diff detects no change → listener must NOT fire again.
        await store.publishRendered('doc', 'x');
        await flush();
        expect(cb.mock.calls.length).toBe(callsAfterFirst);

        store.destroy();
    });

    it('facetStateEqual fires when allowableOptions goes from null to non-null', async () => {
        // First publish: no suggest → null allowable
        let suggestEnabled = false;
        const engine: EzClassifyStoreEngine = {
            process: () => processResult('x'),
            render: () => 'x',
            aggregate: () => processResult(''),
            aggregateAssertions: () => processResult(''),
            getSchemeMeta: () => ({ scopes: [] }),
            listCategories: () => [],
            suggest: (_, _opts) => {
                if (!suggestEnabled) throw new Error('suggest not ready');
                return {
                    suggestions: [suggestion('level', 'U')],
                };
            },
        };
        const store = new VanillaEzClassifyStore(engine);
        const facetStates: { allowableOptions: Suggestion[] | null }[] = [];
        store.subscribeFacet('doc', 'level', (s) => facetStates.push(s));

        // First commit: suggest throws → null allowable cached
        await store.publishRendered('doc', 'x');
        await flush();

        // Enable suggest and commit again: null → non-null → nullability mismatch detected
        suggestEnabled = true;
        await store.publishRendered('doc', 'x');
        await flush();

        // There should be at least 2 distinct states
        expect(facetStates.length).toBeGreaterThanOrEqual(2);
        const last = facetStates[facetStates.length - 1];
        expect(last.allowableOptions).not.toBeNull();

        store.destroy();
    });

    it('facetStateEqual fires when same-length allowable set has a different element', async () => {
        // Line 246 is `if (!prevKeys.has(...)) return false`, fires when lengths match but
        // a concept in nextAllowable was NOT in the previous set.  A length reduction
        // exits at line 243 before reaching line 246, so both lists must be the same length.
        let suggestCount = 0;
        const suggestionSetA: Suggestion[] = [
            suggestion('level', 'U'),
            suggestion('level', 'S'),
        ];
        const suggestionSetB: Suggestion[] = [
            suggestion('level', 'U'),
            suggestion('level', 'TS'),
        ];
        const engine: EzClassifyStoreEngine = {
            process: () => processResult('x'),
            render: () => 'x',
            aggregate: () => processResult(''),
            aggregateAssertions: () => processResult(''),
            getSchemeMeta: () => ({ scopes: [] }),
            listCategories: () => [],
            suggest: () => {
                suggestCount++;
                // Both sets have length 2; set B swaps 'S' for 'TS' → same length, different element.
                return {
                    suggestions:
                        suggestCount === 1 ? suggestionSetA : suggestionSetB,
                };
            },
        };
        const store = new VanillaEzClassifyStore(engine);
        const facetStates: { allowableOptions: Suggestion[] | null }[] = [];
        store.subscribeFacet('doc', 'level', (s) => facetStates.push(s));

        await store.publishRendered('doc', 'x');
        await flush(10);
        // Second commit: same length but TS != S → !prevKeys.has(TS) → return false → listener fires
        await store.publishRendered('doc', 'x');
        await flush(10);

        expect(facetStates.length).toBeGreaterThanOrEqual(2);
        const last = facetStates[facetStates.length - 1];
        expect(last.allowableOptions?.some((s) => s.conceptId === 'TS')).toBe(
            true,
        );

        store.destroy();
    });
});

// ---------------------------------------------------------------------------
// 3. Rendered-string round-trips
// ---------------------------------------------------------------------------

describe('rendered-string round-trips', () => {
    it('publishRendered preserves the input string in store.get().rendered', async () => {
        const store = new VanillaEzClassifyStore(passThroughEngine());
        await store.publishRendered('m1', 'level:S//caveat:NF');
        expect(store.get('m1').rendered).toBe('level:S//caveat:NF');
        store.destroy();
    });

    it('publishAssertions renders then stores consistently', async () => {
        const store = new VanillaEzClassifyStore(passThroughEngine());
        const assertions: Assertion[] = [
            {
                categoryId: 'level',
                conceptId: 'S',
                confidence: 'certain',
                source: 'user',
            },
        ];
        await store.publishAssertions('m1', assertions);
        expect(store.get('m1').rendered).toBe('level:S');
        // The engine processes the assertion array directly (no string round-trip);
        // the rendered banner comes back on the result. concept+category survive.
        expect(store.get('m1').assertions[0]).toMatchObject({
            conceptId: 'S',
            categoryId: 'level',
        });
        store.destroy();
    });

    it('publishAssertions with format option passes it to engine.process (de-stringified)', async () => {
        const renderSpy = vi.fn().mockReturnValue('SHOULD-NOT-BE-CALLED');
        const processSpy = vi.fn().mockReturnValue({
            rendered: 'FORMATTED',
            assertions: [],
            valid: true,
            errors: [],
        });
        const engine = passThroughEngine({
            render: renderSpy,
            process: processSpy,
        });
        // Store with a named format, the default-scope subset goes straight to
        // engine.process(assertions[]) with the format; render is never consulted
        // (de-stringification: no render→process round-trip that could drop
        // capture values).
        const store = new VanillaEzClassifyStore(engine, { format: 'banner' });
        await store.publishAssertions('m1', []);
        expect(processSpy).toHaveBeenCalledWith(
            [],
            expect.objectContaining({ outputFormat: 'banner' }),
        );
        expect(renderSpy).not.toHaveBeenCalled();
        store.destroy();
    });
});

// ---------------------------------------------------------------------------
// 4. setPartOf edge cases
// ---------------------------------------------------------------------------

describe('VanillaEzClassifyStore: setPartOf edge cases', () => {
    it('setPartOf with empty string clears the relationship', async () => {
        const store = new VanillaEzClassifyStore(passThroughEngine());
        store.setPartOf('p1', 'doc');

        const rollupCb = vi.fn();
        store.subscribeWholeRollup('doc', rollupCb);
        rollupCb.mockClear();

        // Empty string is treated like null, clears the part-of edge.
        store.setPartOf('p1', '');
        await flush();

        // After clearing, publishing p1 should NOT trigger doc's rollup.
        await store.publishRendered('p1', 'level:S');
        await flush();
        const rollupAfter = store.getWholeRollup('doc');
        expect(rollupAfter.rendered).toBe('');

        store.destroy();
    });

    it('moving a marking between wholes recomputes both', async () => {
        const store = new VanillaEzClassifyStore(passThroughEngine());
        store.setPartOf('p1', 'doc-a');

        await store.publishRendered('p1', 'level:S');
        await flush();

        expect(store.getWholeRollup('doc-a').rendered).toContain('level:S');
        expect(store.getWholeRollup('doc-b').rendered).toBe('');

        // Move p1 to doc-b: doc-a rollup should become empty; doc-b gains p1
        store.setPartOf('p1', 'doc-b');
        await flush();

        expect(store.getWholeRollup('doc-b').rendered).toContain('level:S');
        // doc-a no longer has p1 as a contributor
        expect(store.getWholeRollup('doc-a').rendered).toBe('');

        store.destroy();
    });
});

// ---------------------------------------------------------------------------
// 5. fromProcessResult null-guard branches (lines 538–541)
// ---------------------------------------------------------------------------

describe('VanillaEzClassifyStore: fromProcessResult null guards', () => {
    it('uses the rendered param when result.rendered is null', async () => {
        const engine: EzClassifyStoreEngine = {
            // Returns a result missing the rendered field
            process: (_input) => ({
                rendered: null as unknown as string,
                assessment: EMPTY_RENDER_ASSESSMENT,
                renders: {},
                assertions: [],
                valid: true,
                errors: [],
            }),
            render: () => '',
            aggregate: () => processResult(''),
            aggregateAssertions: () => processResult(''),
            getSchemeMeta: () => ({ scopes: [] }),
            listCategories: () => [],
        };
        const store = new VanillaEzClassifyStore(engine);
        await store.publishRendered('m1', 'level:S');
        // When result.rendered is null, falls back to the `rendered` param
        expect(store.get('m1').rendered).toBe('level:S');
        store.destroy();
    });

    it('uses [] when result.assertions is null', async () => {
        const engine: EzClassifyStoreEngine = {
            process: () => ({
                rendered: 'x',
                assessment: EMPTY_RENDER_ASSESSMENT,
                renders: {},
                assertions: null as unknown as Assertion[],
                valid: true,
                errors: [],
            }),
            render: () => '',
            aggregate: () => processResult(''),
            aggregateAssertions: () => processResult(''),
            getSchemeMeta: () => ({ scopes: [] }),
            listCategories: () => [],
        };
        const store = new VanillaEzClassifyStore(engine);
        await store.publishRendered('m1', 'x');
        expect(store.get('m1').assertions).toEqual([]);
        store.destroy();
    });

    it('uses [] when result.errors is null', async () => {
        const engine: EzClassifyStoreEngine = {
            process: () => ({
                rendered: 'x',
                assessment: EMPTY_RENDER_ASSESSMENT,
                renders: {},
                assertions: [],
                valid: true,
                errors: null as unknown as never[],
            }),
            render: () => '',
            aggregate: () => processResult(''),
            aggregateAssertions: () => processResult(''),
            getSchemeMeta: () => ({ scopes: [] }),
            listCategories: () => [],
        };
        const store = new VanillaEzClassifyStore(engine);
        await store.publishRendered('m1', 'x');
        expect(store.get('m1').errors).toEqual([]);
        store.destroy();
    });
});

// ---------------------------------------------------------------------------
// 6. destroy() idempotence + post-destroy guards
// ---------------------------------------------------------------------------

describe('VanillaEzClassifyStore: destroy idempotence', () => {
    it('calling destroy() twice does not throw', () => {
        const store = new VanillaEzClassifyStore(passThroughEngine());
        store.destroy();
        expect(() => store.destroy()).not.toThrow();
    });

    it('destroyed store rejects assertAlive calls', () => {
        const store = new VanillaEzClassifyStore(passThroughEngine());
        store.destroy();
        expect(() => store.subscribe('x', () => {})).toThrow(/destroyed/);
    });
});

// ---------------------------------------------------------------------------
// 7. destroyed-during-flight guards in refreshFacets and recomputeAggregate
//
// These tests use the void+destroy pattern:
//   void store.publishRendered(...) , starts async, suspends at `await engine.process`
//   store.destroy()                 , sets destroyed=true synchronously before the microtask resumes
//   await flush()                   , when publishRendered resumes, commit fires void refreshFacets /
//                                      void recomputeAggregate; both hit `if (this.destroyed) return`
//
// This is the only way to cover those guards: the AWAIT+destroy pattern arrives too late
// because by then commit() has already started the void tasks and they've already passed
// their synchronous `if (this.destroyed)` check.
// ---------------------------------------------------------------------------

describe('VanillaEzClassifyStore: destroyed-during-flight guards', () => {
    it('refreshFacets destroyed check fires when store is destroyed mid-flight', async () => {
        const store = new VanillaEzClassifyStore(passThroughEngine());
        const cb = vi.fn();
        // Subscribe a facet so refreshFacets gets past the byCategory guard
        store.subscribeFacet('doc', 'level', cb);

        // Fire-and-forget: publishRendered suspends at `await engine.process`.
        void store.publishRendered('doc', 'level:S');
        // Destroy synchronously before the microtask resumes.
        store.destroy();

        // Drain: publishRendered resumes → commit → void refreshFacets
        // → `if (this.destroyed) return` is TRUE → exits immediately.
        await flush(10);
        expect(cb).not.toHaveBeenCalled();
    });

    it('recomputeAggregate destroyed check fires when store is destroyed mid-flight', async () => {
        const store = new VanillaEzClassifyStore(passThroughEngine());
        const aggCb = vi.fn();
        store.subscribeAggregate(aggCb);

        void store.publishRendered('m1', 'level:S');
        store.destroy();

        await flush(10);
        // recomputeAggregate exited at `if (this.destroyed) return`; also aggregateListeners was cleared.
        expect(aggCb).not.toHaveBeenCalled();
    });

    it('destroying a store prevents listeners from being called after a synchronous setPartOf rollup', async () => {
        // Whole-rollup recompute is called synchronously from setPartOf → recomputeWholeRollup starts
        // synchronously; destroyed check runs synchronously.
        // To cover it we need destroyed=true before setPartOf fires recomputeWholeRollup,
        // but setPartOf calls assertAlive() first, so this path is effectively a safety net only.
        // Instead, verify the observable: after destroy no rollup listener fires.
        const store = new VanillaEzClassifyStore(passThroughEngine());
        const rollupCb = vi.fn();
        store.subscribeWholeRollup('doc', rollupCb);
        store.setPartOf('p1', 'doc');
        await store.publishRendered('p1', 'level:S');
        await flush(10);
        store.destroy();
        rollupCb.mockClear();

        // Any pending microtasks won't call listeners, store is destroyed.
        await flush(10);
        expect(rollupCb).not.toHaveBeenCalled();
    });
});

// ---------------------------------------------------------------------------
// 8. recomputeAggregate/recomputeWholeRollup with format option
// ---------------------------------------------------------------------------

describe('VanillaEzClassifyStore: format option propagation in aggregate paths', () => {
    const flush = async () => {
        for (let i = 0; i < 8; i++) await Promise.resolve();
    };

    it('recomputeAggregate passes format to aggregateAssertions', async () => {
        const aggSpy = vi.fn().mockReturnValue({
            rendered: 'R',
            assertions: [],
            valid: true,
            errors: [],
        });
        const engine = passThroughEngine({ aggregateAssertions: aggSpy });
        const store = new VanillaEzClassifyStore(engine, { format: 'banner' });
        await store.publishRendered('m1', 'level:S');
        await flush();
        // aggregateAssertions was called with the format option
        expect(aggSpy).toHaveBeenCalledWith(
            expect.any(Array),
            expect.objectContaining({ outputFormat: 'banner' }),
        );
        store.destroy();
    });

    it('recomputeWholeRollup passes format to aggregateAssertions', async () => {
        const aggSpy = vi.fn().mockReturnValue({
            rendered: 'R',
            assertions: [],
            valid: true,
            errors: [],
        });
        const engine = passThroughEngine({ aggregateAssertions: aggSpy });
        const store = new VanillaEzClassifyStore(engine, { format: 'banner' });
        store.setPartOf('p1', 'doc');
        await store.publishRendered('p1', 'level:S');
        await flush();
        // aggregateAssertions was called at least once for the whole-rollup with format
        const callsWithFormat = aggSpy.mock.calls.filter(
            (args) => args[1]?.outputFormat === 'banner',
        );
        expect(callsWithFormat.length).toBeGreaterThan(0);
        store.destroy();
    });
});

// ---------------------------------------------------------------------------
// 9. subscribeWholeRollup cleanup edge cases
// ---------------------------------------------------------------------------

describe('VanillaEzClassifyStore: subscribeWholeRollup cleanup', () => {
    it('unsubscribing the last listener removes the wholeId key from the listener map', async () => {
        const store = new VanillaEzClassifyStore(passThroughEngine());
        const cb = vi.fn();
        const unsub = store.subscribeWholeRollup('doc', cb);
        // Unsubscribing when it's the only listener: cleans up the map entry.
        unsub();
        // After unsub, further whole-rollup commits don't reach the listener.
        store.setPartOf('p1', 'doc');
        await store.publishRendered('p1', 'level:S');
        await flush();
        expect(cb).not.toHaveBeenCalled();
        store.destroy();
    });

    it('second subscribeWholeRollup on the same wholeId reuses existing set', async () => {
        // First subscribe creates the Set; second subscribe finds it already exists.
        const store = new VanillaEzClassifyStore(passThroughEngine());
        const cb1 = vi.fn();
        const cb2 = vi.fn();
        const unsub1 = store.subscribeWholeRollup('doc', cb1);
        const unsub2 = store.subscribeWholeRollup('doc', cb2); // reuses existing Set

        store.setPartOf('p1', 'doc');
        await store.publishRendered('p1', 'level:S');
        await flush();

        // Both listeners fire from the same set.
        expect(cb1).toHaveBeenCalled();
        expect(cb2).toHaveBeenCalled();

        // Unsub cb1 while cb2 still registered → set is non-empty → map entry kept.
        unsub1();
        cb2.mockClear();
        await store.publishRendered('p1', 'level:U');
        await flush();
        expect(cb2).toHaveBeenCalled();

        unsub2();
        store.destroy();
    });

    it('subscribeWholeRollup double-unsub is a no-op', () => {
        // First unsub removes the only listener and deletes the map key.
        // Second unsub: map.get(wholeId) = undefined → early return.
        const store = new VanillaEzClassifyStore(passThroughEngine());
        const cb = vi.fn();
        const unsub = store.subscribeWholeRollup('doc', cb);
        unsub(); // clears the set and removes the key
        expect(() => unsub()).not.toThrow(); // second call: s is undefined → early return
        store.destroy();
    });

    it('setPartOf with empty string and no prior edge exits early', () => {
        // When wholeId is '' and prevWhole === undefined (no prior setPartOf for this markingId),
        // the code returns early without attempting any recompute.
        const store = new VanillaEzClassifyStore(passThroughEngine());
        // No prior setPartOf for 'never-set' → prevWhole === undefined.
        expect(() => store.setPartOf('never-set', '')).not.toThrow();
        // Nothing was recomputed; whole-rollup state is still empty.
        expect(store.getWholeRollup('doc').rendered).toBe('');
        store.destroy();
    });
});

// ---------------------------------------------------------------------------
// 10. subscribeFacet cleanup edge cases
// ---------------------------------------------------------------------------

describe('VanillaEzClassifyStore: subscribeFacet cleanup edge cases', () => {
    it('unsub after byCategory map is gone returns early via !bc guard', () => {
        // Single markingId + single category: first unsub deletes both the category set AND
        // the marking-level byCategory map → second unsub hits `if (!bc) return` at line 426.
        const store = new VanillaEzClassifyStore(passThroughEngine());
        const cb = vi.fn();
        const unsub = store.subscribeFacet('doc', 'level', cb);
        unsub(); // removes set + removes byCategory entry (only category gone)
        expect(() => unsub()).not.toThrow(); // bc is gone → early return
        store.destroy();
    });

    it('second unsub of a category finds Set gone while byCategory still exists', () => {
        // Two different categories under the SAME marking: when one is unsubscribed the byCategory
        // map for the marking stays (the other category keeps it alive).  Double-unsubbing the
        // first category now finds bc non-null but bc.get(categoryId) is undefined.
        const store = new VanillaEzClassifyStore(passThroughEngine());
        const cb1 = vi.fn();
        const cb2 = vi.fn();
        const unsub1 = store.subscribeFacet('doc', 'level', cb1);
        store.subscribeFacet('doc', 'caveat', cb2); // keeps byCategory alive

        // First unsub: level Set deleted; byCategory survives (caveat still there).
        unsub1();
        // Second unsub: bc = facetListeners.get('doc') → non-null; bc.get('level') → undefined
        // → `if (!s) return` at line 428 fires.
        expect(() => unsub1()).not.toThrow();

        store.destroy();
    });
});

// ---------------------------------------------------------------------------
// 11. bindEzClassifyToObject edge cases
// ---------------------------------------------------------------------------

describe('bindEzClassifyToObject: edge cases', () => {
    it('dispose() is idempotent', () => {
        const store = new VanillaEzClassifyStore(passThroughEngine());
        const handle = bindEzClassifyToObject(store, {}, { doc: 'path' });
        handle.dispose();
        expect(() => handle.dispose()).not.toThrow();
        store.destroy();
    });

    it('writeDocPath throws when obj is null', () => {
        expect(() => writeDocPath(null, 'some.path', 'val')).toThrow(
            /target doc is not an object/,
        );
    });

    it('writeDocPath throws when obj is a primitive', () => {
        expect(() =>
            writeDocPath(42 as unknown as object, 'some.path', 'val'),
        ).toThrow(/target doc is not an object/);
    });
});
