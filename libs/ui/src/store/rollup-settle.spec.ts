/**
 * Rollups combine settled contributors only, so the requests a rollup sends
 * depend on the markings and not on the order the engine answered their reads
 * in.
 */
import { describe, it, expect } from 'vitest';
import {
    BaseEzClassifyStore,
    type ReactiveCell,
} from './base-ezclassify-store';
import { createLatencyEngineHarness } from './latency-engine-harness';

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

const PARTS = [
    ['part-b', 'cat:b'],
    ['part-a', 'cat:a'],
    ['part-c', 'cat:c'],
] as const;

/**
 * Seed three parts of one whole, answer their reads in `order`, and return
 * every rollup request the store sent.
 */
async function rollupRequestsAnswering(order: number[]): Promise<string[]> {
    const harness = createLatencyEngineHarness();
    const store = new TestStore(harness.engine);
    for (const [id] of PARTS) store.setPartOf(id, 'whole');
    for (const [id, rendered] of PARTS) void store.seedRendered(id, rendered);
    await harness.flush();
    const reads = harness.pending('process');
    expect(reads).toHaveLength(PARTS.length);
    for (const index of order) {
        reads[index]!.resolve();
        await harness.flush();
    }
    const requests: string[] = [];
    for (;;) {
        const rollups = harness.pending('aggregateAssertions');
        if (rollups.length === 0) break;
        for (const call of rollups) {
            requests.push(JSON.stringify(call.args[0]));
            call.resolve();
        }
        await harness.flush();
    }
    store.destroy();
    return requests;
}

describe('rollups over settled contributors', () => {
    it('sends no rollup of an incomplete part set and the same rollups in any answer order', async () => {
        const inOrder = await rollupRequestsAnswering([0, 1, 2]);
        const complete = JSON.stringify([
            [{ categoryId: 'cat', conceptId: 'a' }],
            [{ categoryId: 'cat', conceptId: 'b' }],
            [{ categoryId: 'cat', conceptId: 'c' }],
        ]);
        // One whole rollup and one page aggregate, both over all three parts.
        expect(inOrder).toEqual([complete, complete]);
        expect(await rollupRequestsAnswering([2, 1, 0])).toEqual(inOrder);
        expect(await rollupRequestsAnswering([1, 2, 0])).toEqual(inOrder);
    });

    it('recomputes from settled values after a later edit', async () => {
        const harness = createLatencyEngineHarness();
        const store = new TestStore(harness.engine);
        for (const [id] of PARTS) store.setPartOf(id, 'whole');
        for (const [id, rendered] of PARTS)
            void store.seedRendered(id, rendered);
        await harness.settleAll();
        expect(store.getWholeRollup('whole').rendered).toBe(
            'cat:a cat:b cat:c',
        );
        void store.publishRendered('part-a', 'cat:z');
        await harness.flush();
        // The edit is on the wire: nothing rolls up the part it replaces.
        expect(harness.pending('aggregateAssertions')).toHaveLength(0);
        await harness.settleAll();
        // Contributors combine in marking-id order: part-a's new value first.
        expect(store.getWholeRollup('whole').rendered).toBe(
            'cat:z cat:b cat:c',
        );
        store.destroy();
    });

    it('rolls up without a part whose first read failed, and says the rollup is held', async () => {
        const harness = createLatencyEngineHarness();
        const store = new TestStore(harness.engine);
        for (const [id] of PARTS) store.setPartOf(id, 'whole');
        const seeds = PARTS.map(([id, rendered]) =>
            store.seedRendered(id, rendered).catch(() => {}),
        );
        await harness.flush();
        const reads = harness.pending('process');
        reads[0]!.reject(new Error('connection dropped'));
        reads[1]!.resolve();
        reads[2]!.resolve();
        await Promise.all(seeds);
        await harness.settleAll();
        const rollup = store.getWholeRollup('whole');
        expect(rollup.rendered).toBe('cat:a cat:c');
        expect(rollup.stale).toBe(true);
        expect(store.getAggregate().stale).toBe(true);
        store.destroy();
    });

    it('flags the rollups of a contributor that read only part of its source until it reads all of it', async () => {
        const harness = createLatencyEngineHarness();
        const store = new TestStore(harness.engine);
        for (const [id] of PARTS) store.setPartOf(id, 'whole');
        store.setPartOf('elsewhere', 'other');
        for (const [id, rendered] of PARTS)
            void store.seedRendered(id, rendered);
        void store.seedRendered('elsewhere', 'cat:z');
        await harness.flush();
        // Recorded while the parts are still reading: the rollups wait for
        // them, as they do for any contributor on the wire, and nothing is
        // sent over an unsettled set.
        store.setIncompleteContributor('body', 'whole', true);
        await harness.flush();
        expect(harness.pending('aggregateAssertions')).toHaveLength(0);
        await harness.settleAll();
        const rollup = store.getWholeRollup('whole');
        expect(rollup.rendered).toBe('cat:a cat:b cat:c');
        expect(rollup.stale).toBe(true);
        expect(store.getAggregate().stale).toBe(true);
        // A whole it does not feed is current.
        expect(store.getWholeRollup('other').stale).toBeUndefined();

        store.setIncompleteContributor('body', 'whole', false);
        await harness.settleAll();
        expect(store.getWholeRollup('whole').rendered).toBe(
            'cat:a cat:b cat:c',
        );
        expect(store.getWholeRollup('whole').stale).toBeUndefined();
        expect(store.getAggregate().stale).toBeUndefined();
        store.destroy();
    });

    it('computes a rollup held for a part edit whose read then fails', async () => {
        const harness = createLatencyEngineHarness();
        const store = new TestStore(harness.engine);
        store.setPartOf('part-a', 'whole');
        store.setPartOf('part-b', 'whole');
        void store.seedRendered('part-a', 'cat:x');
        void store.seedRendered('part-b', 'cat:y');
        await harness.settleAll();
        const failing = store
            .publishRendered('part-a', 'cat:w')
            .catch(() => {});
        await harness.flush();
        void store.publishRendered('part-b', 'cat:z');
        await harness.flush();
        const [aRead, bRead] = harness.pending('process');
        bRead!.resolve();
        await harness.flush();
        aRead!.reject(new Error('connection dropped'));
        await failing;
        await harness.settleAll();
        // part-a keeps its committed value; part-b's raise reaches the rollup.
        expect(store.getWholeRollup('whole').rendered).toBe('cat:x cat:z');
        expect(store.getAggregate().rendered).toBe('cat:x cat:z');
        store.destroy();
    });

    it('computes a rollup held while its whole was read again with the same value', async () => {
        const harness = createLatencyEngineHarness();
        const store = new TestStore(harness.engine);
        store.setPartOf('part-a', 'whole');
        void store.seedRendered('whole', 'cat:w');
        void store.seedRendered('part-a', 'cat:x');
        await harness.settleAll();
        void store.publishRendered('whole', 'cat:w');
        await harness.flush();
        void store.publishRendered('part-a', 'cat:y');
        await harness.flush();
        const [wholeRead, partRead] = harness.pending('process');
        partRead!.resolve();
        await harness.flush();
        wholeRead!.resolve();
        await harness.settleAll();
        expect(store.getWholeRollup('whole').rendered).toBe('cat:y');
        store.destroy();
    });

    it('rolls up without a registered part nobody has seeded or published', async () => {
        const harness = createLatencyEngineHarness();
        const store = new TestStore(harness.engine);
        store.setPartOf('part-a', 'whole');
        store.setPartOf('part-b', 'whole');
        void store.seedRendered('part-b', 'cat:y');
        await harness.settleAll();
        // part-a was registered and never asked for: nothing is coming for
        // it, so it holds neither rollup.
        expect(store.getWholeRollup('whole').rendered).toBe('cat:y');
        expect(store.getAggregate().rendered).toBe('cat:y');
        expect(store.getWholeRollup('whole').stale).toBeUndefined();
        void store.seedRendered('part-a', 'cat:x');
        await harness.flush();
        // Once asked, it is a contributor like any other.
        expect(harness.pending('aggregateAssertions')).toHaveLength(0);
        await harness.settleAll();
        expect(store.getWholeRollup('whole').rendered).toBe('cat:x cat:y');
        expect(store.getAggregate().rendered).toBe('cat:x cat:y');
        void store.publishRendered('part-a', 'cat:z');
        await harness.settleAll();
        expect(store.getWholeRollup('whole').rendered).toBe('cat:z cat:y');
        store.destroy();
    });

    it('tells no one about a rollup that registering parts leaves empty', async () => {
        const harness = createLatencyEngineHarness();
        const store = new TestStore(harness.engine);
        const wholeRollups: string[] = [];
        const aggregates: string[] = [];
        store.subscribeWholeRollup('whole', (state) =>
            wholeRollups.push(state.rendered),
        );
        store.subscribeAggregate((state) => aggregates.push(state.rendered));
        store.setPartOf('part-a', 'whole');
        store.setPartOf('part-b', 'whole');
        await harness.settleAll();
        expect(wholeRollups).toEqual([]);
        void store.seedRendered('part-a', 'cat:x');
        void store.seedRendered('part-b', 'cat:y');
        await harness.settleAll();
        expect(wholeRollups).toEqual(['cat:x cat:y']);
        expect(aggregates).toEqual(['cat:x cat:y']);
        store.destroy();
    });
});
