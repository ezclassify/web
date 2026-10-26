/**
 * Ordering, cancellation, and availability tests for `BaseEzClassifyStore`
 * under an engine that answers out of order.
 *
 * Every case here is unreachable with an in-process engine: a synchronous
 * engine resolves in issue order, so the store's latest-wins guards never have
 * to do anything. Over a wire they do. `createLatencyEngineHarness` hands the
 * resolution order to the test, so each guard can be proven by resolving an
 * older call after a newer one and asserting the newer answer survived.
 *
 * The sibling `base-ezclassify-store.spec.ts` covers the store's behavior with
 * a synchronous engine; this file covers only what latency introduces.
 */

import { describe, it, expect } from 'vitest';
import {
    BaseEzClassifyStore,
    type ReactiveCell,
} from './base-ezclassify-store';
import type { EzClassifyState, FacetState } from './ezclassify-store';
import { createLatencyEngineHarness } from './latency-engine-harness';
import { publishFacetSelection } from '../facet-binding';
import type { Assertion, Suggestion } from '@ezclassify/types';

class TestStore extends BaseEzClassifyStore {
    protected createCell<T>(initial: T): ReactiveCell<T> {
        let value = initial;
        return {
            get: () => value,
            set: (next) => {
                value = next;
            },
        };
    }
    protected storeLabel(): string {
        return '[ezclassify/test] TestStore';
    }
}

function assertion(categoryId: string, conceptId: string): Assertion {
    return { categoryId, conceptId } as Assertion;
}

function suggestion(categoryId: string, conceptId: string): Suggestion {
    return {
        categoryId,
        conceptId,
        label: conceptId,
        views: {},
    } as unknown as Suggestion;
}

function conceptIdsOf(state: EzClassifyState): string[] {
    return state.assertions.map((a) => `${a.categoryId}:${a.conceptId}`).sort();
}

describe('BaseEzClassifyStore publish ordering', () => {
    it('drops a superseded publish whose result arrives after the newer commit', async () => {
        const harness = createLatencyEngineHarness();
        const store = new TestStore(harness.engine);

        const first = store.publishAssertions('doc', [
            assertion('classification', 'SECRET'),
        ]);
        const second = store.publishAssertions('doc', [
            assertion('classification', 'TOP_SECRET'),
        ]);
        await harness.flush();

        const [older, newer] = harness.pending('process');
        newer.resolve();
        await harness.flush();
        older.resolve();
        await Promise.all([first, second]);
        await harness.settleAll();

        expect(conceptIdsOf(store.get('doc'))).toEqual([
            'classification:TOP_SECRET',
        ]);
    });

    it('drops a superseded rendered publish the same way', async () => {
        const harness = createLatencyEngineHarness();
        const store = new TestStore(harness.engine);

        const first = store.publishRendered('doc', 'classification:SECRET');
        const second = store.publishRendered(
            'doc',
            'classification:TOP_SECRET',
        );
        await harness.flush();

        const [older, newer] = harness.pending('process');
        newer.resolve();
        await harness.flush();
        older.resolve();
        await Promise.all([first, second]);
        await harness.settleAll();

        expect(store.get('doc').rendered).toBe('classification:TOP_SECRET');
    });

    it('aborts the superseded publish rather than leave it on the wire', async () => {
        const harness = createLatencyEngineHarness();
        const store = new TestStore(harness.engine);

        const first = store.publishAssertions('doc', [
            assertion('classification', 'SECRET'),
        ]);
        const second = store.publishAssertions('doc', [
            assertion('classification', 'TOP_SECRET'),
        ]);
        await harness.flush();

        const [older, newer] = harness.pending('process');
        expect(older.aborted).toBe(true);
        expect(newer.aborted).toBe(false);

        newer.resolve();
        older.resolve();
        await Promise.all([first, second]);
        await harness.settleAll();
    });

    it('leaves a single publish untouched by the ordering guard', async () => {
        const harness = createLatencyEngineHarness();
        const store = new TestStore(harness.engine);

        const publish = store.publishAssertions('doc', [
            assertion('classification', 'SECRET'),
        ]);
        await harness.flush();
        harness.pending('process')[0].resolve();
        await publish;
        await harness.settleAll();

        expect(conceptIdsOf(store.get('doc'))).toEqual([
            'classification:SECRET',
        ]);
    });
});

describe('BaseEzClassifyStore concurrent facet publishes', () => {
    it('keeps a sibling picker selection that had not committed yet', async () => {
        const harness = createLatencyEngineHarness();
        const store = new TestStore(harness.engine);

        // Both pickers read committed state and publish the whole marking,
        // which is the read-modify-write shape every facet control has.
        const first = publishFacetSelection(store, 'doc', 'classification', [
            'SECRET',
        ]);
        const second = publishFacetSelection(store, 'doc', 'sci', ['HCS']);
        await harness.flush();

        for (const call of harness.pending('process')) call.resolve();
        await Promise.all([first, second]);
        await harness.settleAll();

        expect(conceptIdsOf(store.get('doc'))).toEqual([
            'classification:SECRET',
            'sci:HCS',
        ]);
    });

    it('keeps both selections when the older publish resolves last', async () => {
        const harness = createLatencyEngineHarness();
        const store = new TestStore(harness.engine);

        const first = publishFacetSelection(store, 'doc', 'classification', [
            'SECRET',
        ]);
        const second = publishFacetSelection(store, 'doc', 'sci', ['HCS']);
        await harness.flush();

        const [older, newer] = harness.pending('process');
        newer.resolve();
        await harness.flush();
        older.resolve();
        await Promise.all([first, second]);
        await harness.settleAll();

        expect(conceptIdsOf(store.get('doc'))).toEqual([
            'classification:SECRET',
            'sci:HCS',
        ]);
    });

    it('lets a picker clear its own category without reviving it', async () => {
        const harness = createLatencyEngineHarness();
        const store = new TestStore(harness.engine);

        const initial = store.publishAssertions('doc', [
            assertion('classification', 'SECRET'),
            assertion('sci', 'HCS'),
        ]);
        await harness.flush();
        harness.pending('process')[0].resolve();
        await initial;
        await harness.settleAll();

        const clear = publishFacetSelection(store, 'doc', 'sci', []);
        const other = publishFacetSelection(store, 'doc', 'classification', [
            'TOP_SECRET',
        ]);
        await harness.flush();
        for (const call of harness.pending('process')) call.resolve();
        await Promise.all([clear, other]);
        await harness.settleAll();

        expect(conceptIdsOf(store.get('doc'))).toEqual([
            'classification:TOP_SECRET',
        ]);
    });

    it('keeps a category an in-flight publish added when a sibling clears everything', async () => {
        const harness = createLatencyEngineHarness();
        const store = new TestStore(harness.engine);

        const initial = store.publishAssertions('doc', [
            assertion('classification', 'SECRET'),
        ]);
        await harness.flush();
        harness.pending('process')[0].resolve();
        await initial;
        await harness.settleAll();

        // A clear-all published against committed state is a delta over the
        // categories the caller could see, not a global truth. It removes
        // `classification`, which it read, and leaves `sci` alone because the
        // in-flight publish added it after the clearing view last read state.
        // Pinned deliberately: a reader who expects clear-all to win outright
        // is reading the wrong model, not finding a bug.
        const adding = store.publishAssertions('doc', [
            assertion('classification', 'SECRET'),
            assertion('sci', 'HCS'),
        ]);
        const clearing = store.publishAssertions('doc', []);
        await harness.flush();
        for (const call of harness.pending('process')) call.resolve();
        await Promise.all([adding, clearing]);
        await harness.settleAll();

        expect(conceptIdsOf(store.get('doc'))).toEqual(['sci:HCS']);
    });

    it('lets a full-set publish with nothing in flight clear what it omits', async () => {
        const harness = createLatencyEngineHarness();
        const store = new TestStore(harness.engine);

        const first = publishFacetSelection(store, 'doc', 'classification', [
            'SECRET',
        ]);
        await harness.flush();
        harness.pending('process')[0].resolve();
        await first;
        await harness.settleAll();

        // Nothing is in flight, so every category the caller read and left out
        // is a change, and the publish clears it.
        const replace = store.publishAssertions('doc', [
            assertion('sci', 'HCS'),
        ]);
        await harness.flush();
        harness.pending('process')[0].resolve();
        await replace;
        await harness.settleAll();

        expect(conceptIdsOf(store.get('doc'))).toEqual(['sci:HCS']);
    });
});

describe('BaseEzClassifyStore facet refresh ordering', () => {
    it('ignores the superseded fan-out when it resolves last', async () => {
        const harness = createLatencyEngineHarness();
        const store = new TestStore(harness.engine);
        const seen: FacetState[] = [];
        store.subscribeFacet('doc', 'sci', (state) => seen.push(state));

        const first = store.publishAssertions('doc', [
            assertion('classification', 'SECRET'),
        ]);
        await harness.flush();
        harness.pending('process')[0].resolve();
        await first;
        await harness.flush();
        const staleFanOut = harness.pending('suggest');

        const second = store.publishAssertions('doc', [
            assertion('classification', 'TOP_SECRET'),
        ]);
        await harness.flush();
        harness.pending('process')[0].resolve();
        await second;
        await harness.flush();

        // The newer commit's options land, then the older commit's arrive. A
        // local engine ignores the abort, so the superseded answer still shows
        // up and the revision is what has to reject it.
        const freshFanOut = harness
            .pending('suggest')
            .filter((call) => !staleFanOut.includes(call));
        for (const call of freshFanOut) {
            call.resolve({ suggestions: [suggestion('sci', 'FRESH')] });
        }
        await harness.flush();
        for (const call of staleFanOut) {
            call.resolve({ suggestions: [suggestion('sci', 'STALE')] });
        }
        await harness.settleAll();

        const last = seen[seen.length - 1];
        expect(last.allowableOptions?.map((s) => s.conceptId)).toEqual([
            'FRESH',
        ]);
    });

    it('aborts the superseded fan-out', async () => {
        const harness = createLatencyEngineHarness();
        const store = new TestStore(harness.engine);
        store.subscribeFacet('doc', 'sci', () => {});

        const first = store.publishAssertions('doc', [
            assertion('classification', 'SECRET'),
        ]);
        await harness.flush();
        harness.pending('process')[0].resolve();
        await first;
        await harness.flush();
        const staleFanOut = harness.pending('suggest');
        expect(staleFanOut.length).toBeGreaterThan(0);

        const second = store.publishAssertions('doc', [
            assertion('classification', 'TOP_SECRET'),
        ]);
        await harness.flush();
        harness.pending('process')[0].resolve();
        await second;
        await harness.flush();

        expect(staleFanOut.every((call) => call.aborted)).toBe(true);
        await harness.settleAll();
    });
});

describe('BaseEzClassifyStore batched facet suggest', () => {
    it('asks suggestForCategories once per scope instead of once per category', async () => {
        const harness = createLatencyEngineHarness({
            suggestForCategories: true,
            defaultScope: 'banner',
            scopes: { authority: ['authority-block'] },
        });
        const store = new TestStore(harness.engine);
        const seen: FacetState[] = [];
        store.subscribeFacet('doc', 'classification', () => {});
        store.subscribeFacet('doc', 'sci', (state) => seen.push(state));
        store.subscribeFacet('doc', 'authority', () => {});

        const publish = store.publishAssertions('doc', [
            assertion('classification', 'SECRET'),
        ]);
        await harness.flush();
        harness.pending('process')[0].resolve();
        await publish;
        await harness.flush();

        const batched = harness.pending('suggestForCategories');
        // Two scopes: the banner categories in one call, the authority block in
        // another. Three categories would have cost three calls fanned out.
        expect(batched.length).toBe(2);
        expect(harness.issued('suggest')).toBe(0);
        expect(batched[0].args[1]).toEqual(['classification', 'sci']);
        expect(batched[1].args[1]).toEqual(['authority']);

        batched[0].resolve({
            classification: {
                suggestions: [suggestion('classification', 'X')],
            },
            sci: { suggestions: [suggestion('sci', 'HCS')] },
        });
        batched[1].resolve();
        await harness.settleAll();

        expect(seen[seen.length - 1].allowableOptions).toEqual([
            suggestion('sci', 'HCS'),
        ]);
    });

    it('reports a category the batch response left out as no answer, not as an empty option set', async () => {
        const harness = createLatencyEngineHarness({
            suggestForCategories: true,
            defaultScope: 'banner',
        });
        const store = new TestStore(harness.engine);
        const seen: FacetState[] = [];
        store.subscribeFacet('doc', 'classification', () => {});
        store.subscribeFacet('doc', 'sci', (state) => seen.push(state));

        const publish = store.publishAssertions('doc', [
            assertion('classification', 'SECRET'),
        ]);
        await harness.flush();
        harness.pending('process')[0].resolve();
        await publish;
        await harness.flush();

        // A server that drops an unknown or out-of-scope category id answers
        // for the rest. `[]` would tell the picker it has no allowable options
        // at all; the fan-out reports the same failure as `null`, the show-all
        // fallback, and the batch path has to agree with it.
        harness.pending('suggestForCategories')[0].resolve({
            classification: {
                suggestions: [suggestion('classification', 'TOP_SECRET')],
            },
        });
        await harness.settleAll();

        expect(seen.length).toBeGreaterThan(0);
        expect(seen[seen.length - 1].allowableOptions).toBeNull();
    });

    it('falls back to the per-category fan-out when the adapter has no batch call', async () => {
        const harness = createLatencyEngineHarness();
        const store = new TestStore(harness.engine);
        store.subscribeFacet('doc', 'classification', () => {});
        store.subscribeFacet('doc', 'sci', () => {});

        const publish = store.publishAssertions('doc', [
            assertion('classification', 'SECRET'),
        ]);
        await harness.flush();
        harness.pending('process')[0].resolve();
        await publish;
        await harness.flush();

        expect(harness.pending('suggest').length).toBe(2);
        await harness.settleAll();
    });
});

describe('BaseEzClassifyStore aggregate ordering', () => {
    it('ignores the superseded rollup when it resolves last', async () => {
        const harness = createLatencyEngineHarness();
        const store = new TestStore(harness.engine);
        const seen: EzClassifyState[] = [];
        store.subscribeAggregate((state) => seen.push(state));

        const first = store.publishAssertions('doc', [
            assertion('classification', 'SECRET'),
        ]);
        await harness.flush();
        harness.pending('process')[0].resolve();
        await first;
        await harness.flush();
        // The rollup for a one-marking page is on the wire and stays there.
        const staleRollup = harness.pending('aggregateAssertions');
        expect(staleRollup.length).toBe(1);

        const second = store.publishAssertions('other', [
            assertion('sci', 'HCS'),
        ]);
        await harness.flush();
        harness.pending('process')[0].resolve();
        await second;
        await harness.flush();

        // The two-marking rollup lands first, then the one-marking rollup it
        // superseded. A local engine ignores the abort, so the older answer
        // still arrives and the revision is the only thing that can reject it.
        // Letting it through would drop `other` from the page banner, which no
        // edit asked for.
        const freshRollup = harness
            .pending('aggregateAssertions')
            .filter((call) => !staleRollup.includes(call));
        expect(freshRollup.length).toBe(1);
        for (const call of freshRollup) call.resolve();
        await harness.flush();
        for (const call of staleRollup) call.resolve();
        await harness.settleAll();

        expect(conceptIdsOf(store.getAggregate())).toEqual([
            'classification:SECRET',
            'sci:HCS',
        ]);
        expect(conceptIdsOf(seen[seen.length - 1])).toEqual([
            'classification:SECRET',
            'sci:HCS',
        ]);
    });
});

describe('BaseEzClassifyStore aggregate availability', () => {
    it('holds the last rollup and flags it stale when the engine fails', async () => {
        const harness = createLatencyEngineHarness();
        const store = new TestStore(harness.engine);
        const seen: EzClassifyState[] = [];
        store.subscribeAggregate((state) => seen.push(state));

        const first = store.publishAssertions('doc', [
            assertion('classification', 'SECRET'),
        ]);
        await harness.flush();
        harness.pending('process')[0].resolve();
        await first;
        await harness.settleAll();

        const good = store.getAggregate();
        expect(conceptIdsOf(good)).toEqual(['classification:SECRET']);
        expect(good.stale).toBeUndefined();

        const second = store.publishAssertions('other', [
            assertion('sci', 'HCS'),
        ]);
        await harness.flush();
        harness.pending('process')[0].resolve();
        await second;
        await harness.flush();
        for (const call of harness.pending('aggregateAssertions'))
            call.reject(new Error('network down'));
        await harness.settleAll();

        const held = store.getAggregate();
        expect(held.stale).toBe(true);
        expect(conceptIdsOf(held)).toEqual(['classification:SECRET']);
        expect(seen[seen.length - 1]).toBe(held);
    });

    it('clears the stale flag on the next rollup that succeeds', async () => {
        const harness = createLatencyEngineHarness();
        const store = new TestStore(harness.engine);

        const first = store.publishAssertions('doc', [
            assertion('classification', 'SECRET'),
        ]);
        await harness.flush();
        harness.pending('process')[0].resolve();
        await first;
        await harness.flush();
        for (const call of harness.pending('aggregateAssertions'))
            call.reject(new Error('network down'));
        await harness.settleAll();
        expect(store.getAggregate().stale).toBe(true);

        const second = store.publishAssertions('doc', [
            assertion('classification', 'TOP_SECRET'),
        ]);
        await harness.flush();
        harness.pending('process')[0].resolve();
        await second;
        await harness.settleAll();

        expect(store.getAggregate().stale).toBeUndefined();
        expect(conceptIdsOf(store.getAggregate())).toEqual([
            'classification:TOP_SECRET',
        ]);
    });

    it('holds a whole rollup the same way', async () => {
        const harness = createLatencyEngineHarness();
        const store = new TestStore(harness.engine);
        store.setPartOf('part', 'whole');

        const first = store.publishAssertions('part', [
            assertion('classification', 'SECRET'),
        ]);
        await harness.flush();
        harness.pending('process')[0].resolve();
        await first;
        await harness.settleAll();
        expect(conceptIdsOf(store.getWholeRollup('whole'))).toEqual([
            'classification:SECRET',
        ]);

        const second = store.publishAssertions('part', [
            assertion('classification', 'TOP_SECRET'),
        ]);
        await harness.flush();
        harness.pending('process')[0].resolve();
        await second;
        await harness.flush();
        for (const call of harness.pending('aggregateAssertions'))
            call.reject(new Error('network down'));
        await harness.settleAll();

        const held = store.getWholeRollup('whole');
        expect(held.stale).toBe(true);
        expect(conceptIdsOf(held)).toEqual(['classification:SECRET']);
    });

    it('omits unsupported cancellation options from the rollup call', async () => {
        const harness = createLatencyEngineHarness();
        const store = new TestStore(harness.engine);

        const publish = store.publishAssertions('doc', [
            assertion('classification', 'SECRET'),
        ]);
        await harness.flush();
        harness.pending('process')[0].resolve();
        await publish;
        await harness.flush();

        const rollup = harness.pending('aggregateAssertions')[0];
        expect(rollup.signal).toBeUndefined();
        await harness.settleAll();
    });
});

describe('BaseEzClassifyStore publishes over an abort-honoring adapter', () => {
    // The default harness models the local engine: it takes the abort signal
    // and ignores it, so a superseded call still answers and only the store's
    // revision guards reject the answer. A fetch-based adapter rejects instead,
    // and the store aborts the predecessor on every publish, so the same edit
    // that is silent locally would surface a cancellation over the wire.

    it('settles a superseded publish instead of rejecting it', async () => {
        const harness = createLatencyEngineHarness({ rejectOnAbort: true });
        const store = new TestStore(harness.engine);

        const superseded = store.publishAssertions('doc', [
            assertion('classification', 'SECRET'),
        ]);
        const winner = store.publishAssertions('doc', [
            assertion('classification', 'TOP_SECRET'),
        ]);
        await harness.flush();

        await expect(superseded).resolves.toBeUndefined();

        harness.pending('process')[0].resolve();
        await winner;
        await harness.settleAll();

        expect(conceptIdsOf(store.get('doc'))).toEqual([
            'classification:TOP_SECRET',
        ]);
    });

    it('settles a rendered publish that destroy cut short', async () => {
        const harness = createLatencyEngineHarness({ rejectOnAbort: true });
        const store = new TestStore(harness.engine);

        const publish = store.publishRendered('doc', 'classification:SECRET');
        await harness.flush();
        store.destroy();

        await expect(publish).resolves.toBeUndefined();
    });

    it('still rejects a publish the engine failed for its own reasons', async () => {
        const harness = createLatencyEngineHarness({ rejectOnAbort: true });
        const store = new TestStore(harness.engine);

        const publish = store.publishAssertions('doc', [
            assertion('classification', 'SECRET'),
        ]);
        await harness.flush();
        harness.pending('process')[0].reject(new Error('scheme not loaded'));

        await expect(publish).rejects.toThrow('scheme not loaded');
    });

    it('raises no unhandled rejection for a burst of fire-and-forget publishes', async () => {
        const harness = createLatencyEngineHarness({ rejectOnAbort: true });
        const store = new TestStore(harness.engine);
        const unhandled: unknown[] = [];
        const record = (reason: unknown): void => {
            unhandled.push(reason);
        };
        process.on('unhandledRejection', record);
        try {
            // The per-keystroke shape every binding uses: publish, do not await.
            // Each keystroke aborts the one before it.
            void store.publishRendered('doc', 'classification:S');
            void store.publishRendered('doc', 'classification:SE');
            void store.publishRendered('doc', 'classification:SECRET');
            await harness.flush();
            harness.pending('process')[0].resolve();
            await harness.settleAll();
            await new Promise((resolve) => setTimeout(resolve, 0));
        } finally {
            process.off('unhandledRejection', record);
        }

        expect(unhandled).toEqual([]);
        expect(store.get('doc').rendered).toBe('classification:SECRET');
    });
});

describe('BaseEzClassifyStore teardown under latency', () => {
    it('aborts in-flight work and commits nothing after destroy', async () => {
        const harness = createLatencyEngineHarness();
        const store = new TestStore(harness.engine);

        const publish = store.publishAssertions('doc', [
            assertion('classification', 'SECRET'),
        ]);
        await harness.flush();
        const inFlight = harness.pending('process')[0];
        store.destroy();
        expect(inFlight.aborted).toBe(true);

        inFlight.resolve();
        await publish;
        expect(store.getAggregate().assertions).toEqual([]);
    });
});
