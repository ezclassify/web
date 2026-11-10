/**
 * The store's rollup tree: the page and collections read their members as
 * wholes (each whole's stated value plus its parts rollup, each child
 * collection's rollup), facts move between levels, contributors go to the
 * engine in document order, buckets never merge, and a missing contributor
 * flags every level above it.
 */
import { describe, it, expect } from 'vitest';
import type { Assertion, ProcessingContext } from '@ezclassify/types';
import {
    VanillaEzClassifyStore,
    type EzClassifyStoreEngine,
    type EzClassifyStoreProcessResult,
} from './ezclassify-store';
import { bucketKey, type BucketKey } from './store-shared';
import { bucketState, levelState } from './page-rollup-harness';
import { EMPTY_RENDER_ASSESSMENT } from '../engine-result-mock';

interface RollupCall {
    sets: string[][];
    context?: ProcessingContext;
}

/**
 * A synchronous engine over `category:concept` tokens. Its rollup keeps each
 * fact once, in the order it first appears, so a request's order is visible in
 * the result. It records every rollup request it answers.
 */
function recordingEngine(
    options: { fail?: (text: string) => boolean } = {},
): EzClassifyStoreEngine & { calls: RollupCall[] } {
    const calls: RollupCall[] = [];
    const key = (a: Assertion) => `${a.categoryId}:${a.conceptId}`;
    const result = (assertions: Assertion[]): EzClassifyStoreProcessResult => ({
        rendered: assertions.map(key).join(' '),
        assessment: EMPTY_RENDER_ASSESSMENT,
        renders: {},
        assertions,
        valid: true,
        errors: [],
    });
    return {
        calls,
        process(input) {
            if (typeof input === 'string' && options.fail?.(input))
                return Promise.reject(new Error('unreachable'));
            const assertions =
                typeof input === 'string'
                    ? input
                          .split(/\s+/)
                          .filter(Boolean)
                          .map((token) => {
                              const [categoryId, conceptId] = token.split(':');
                              return { categoryId, conceptId } as Assertion;
                          })
                    : [...input];
            return result(assertions);
        },
        aggregate: () => result([]),
        aggregateAssertions(sets, opts) {
            calls.push({
                sets: sets.map((set) => set.map(key)),
                ...(opts?.context ? { context: opts.context } : {}),
            });
            const merged = new Map<string, Assertion>();
            for (const set of sets)
                for (const a of set)
                    if (!merged.has(key(a))) merged.set(key(a), a);
            return result([...merged.values()]);
        },
        getSchemeMeta: () => ({ scopes: [] }),
        listCategories: () => [],
    };
}

async function settle(): Promise<void> {
    for (let i = 0; i < 20; i++) await Promise.resolve();
}

const rendered = (
    store: VanillaEzClassifyStore,
    nodeId?: string,
    bucket?: BucketKey,
) => levelState(store, nodeId, bucket).rendered;

describe('page rollup', () => {
    it('reads each whole as its stated value plus its parts rollup, never its raw parts', async () => {
        const engine = recordingEngine();
        const store = new VanillaEzClassifyStore(engine);
        store.setPartOf('p1', 'doc');
        store.setPartOf('p2', 'doc');
        await store.publishRendered('doc', 'level:low');
        await store.publishRendered('p1', 'level:high');
        await store.publishRendered('p2', 'origin:a');
        await settle();

        const pageCall = engine.calls.at(-1)!;
        expect(pageCall.sets).toEqual([
            ['level:low'],
            ['level:high', 'origin:a'],
        ]);
        // Read as wholes: no whole context on a level rollup.
        expect(pageCall.context).toBeUndefined();
        expect(rendered(store)).toBe('level:low level:high origin:a');
    });

    it('keeps a whole with no parts out when it is marked no-rollup', async () => {
        const engine = recordingEngine();
        const store = new VanillaEzClassifyStore(engine);
        await store.publishRendered('doc', 'level:low');
        await store.publishRendered('filter', 'level:high');
        store.setNoRollup('filter', true);
        await settle();
        expect(rendered(store)).toBe('level:low');
        expect(levelState(store).stale).toBeUndefined();

        store.setNoRollup('filter', false);
        await settle();
        expect(rendered(store)).toBe('level:low level:high');
    });

    it('still rolls up a whole with parts marked no-rollup, and says the page is incomplete', async () => {
        const store = new VanillaEzClassifyStore(recordingEngine());
        store.setPartOf('p1', 'doc');
        await store.publishRendered('doc', 'level:low');
        await store.publishRendered('p1', 'level:high');
        store.setNoRollup('doc', true);
        await settle();
        expect(rendered(store)).toBe('level:low level:high');
        expect(levelState(store).stale).toBe(true);
    });

    it('flags the whole rollup of a part marked no-rollup and keeps the part in it', async () => {
        const store = new VanillaEzClassifyStore(recordingEngine());
        store.setPartOf('p1', 'doc');
        await store.publishRendered('p1', 'level:high');
        store.setNoRollup('p1', true);
        await settle();
        expect(store.getWholeRollup('doc').rendered).toBe('level:high');
        expect(store.getWholeRollup('doc').stale).toBe(true);
        expect(levelState(store).stale).toBe(true);
    });
});

describe('whole rollup', () => {
    it('reads the parts of a whole that holds nothing as parts, never as wholes', async () => {
        const engine = recordingEngine();
        const store = new VanillaEzClassifyStore(engine);
        store.setPartOf('p1', 'doc');
        await store.publishRendered('p1', 'level:high');
        await settle();

        const partsCall = engine.calls.find(
            (call) => call.context !== undefined,
        );
        expect(partsCall?.sets).toEqual([['level:high']]);
        expect(partsCall?.context).toEqual({ role: 'part' });

        // Once the whole holds a value, its parts are read against it.
        engine.calls.length = 0;
        await store.publishRendered('doc', 'level:low');
        await store.publishRendered('p1', 'origin:a');
        await settle();
        const against = engine.calls.filter(
            (call) => call.context !== undefined,
        );
        expect(against.at(-1)?.context).toMatchObject({
            role: 'part',
            partOf: { rendered: 'level:low' },
        });
    });
});

describe('collections', () => {
    it('rolls a folder up into the page as the folder rollup facts', async () => {
        const engine = recordingEngine();
        const store = new VanillaEzClassifyStore(engine);
        store.registerCollection('folderA', null);
        store.setMembership('memo1', 'folderA');
        store.setMembership('memo2', 'folderA');
        store.setPartOf('portion1', 'memo1');
        await store.publishRendered('memo1', 'level:low');
        await store.publishRendered('portion1', 'level:high');
        await store.publishRendered('memo2', 'origin:a');
        await store.publishRendered('loose', 'origin:b');
        await settle();

        expect(rendered(store, 'folderA')).toBe(
            'level:low level:high origin:a',
        );
        const pageCall = engine.calls.at(-1)!;
        // The folder arrives as one contributor holding its facts.
        expect(pageCall.sets).toEqual([
            ['level:low', 'level:high', 'origin:a'],
            ['origin:b'],
        ]);
        expect(rendered(store)).toBe('level:low level:high origin:a origin:b');
        // A whole's own id reads its parts rollup.
        expect(rendered(store, 'memo1')).toBe('level:high');
    });

    it('nests: a child collection contributes to its parent, not to the page directly', async () => {
        const engine = recordingEngine();
        const store = new VanillaEzClassifyStore(engine);
        store.registerCollection('outer', null);
        store.registerCollection('inner', 'outer');
        store.setMembership('deep', 'inner');
        await store.publishRendered('deep', 'level:high');
        await settle();
        expect(rendered(store, 'inner')).toBe('level:high');
        expect(rendered(store, 'outer')).toBe('level:high');
        expect(rendered(store)).toBe('level:high');
        expect(engine.calls.at(-1)!.sets).toEqual([['level:high']]);
    });

    it('moves a whole between levels with setMembership', async () => {
        const store = new VanillaEzClassifyStore(recordingEngine());
        store.registerCollection('folderA', null);
        store.registerCollection('folderB', null);
        store.setMembership('memo', 'folderA');
        await store.publishRendered('memo', 'level:high');
        await settle();
        expect(rendered(store, 'folderA')).toBe('level:high');

        store.setMembership('memo', 'folderB');
        await settle();
        expect(rendered(store, 'folderA')).toBe('');
        expect(rendered(store, 'folderB')).toBe('level:high');
        expect(rendered(store)).toBe('level:high');
    });

    it('rolls the members of a removed collection up into the page', async () => {
        const store = new VanillaEzClassifyStore(recordingEngine());
        store.registerCollection('folderA', null);
        store.setMembership('memo', 'folderA');
        await store.publishRendered('memo', 'level:high');
        await settle();
        store.unregisterCollection('folderA');
        await settle();
        expect(store.getAggregate('folderA').byBucket.size).toBe(0);
        expect(rendered(store)).toBe('level:high');
    });

    it('refuses a collection inside itself', () => {
        const store = new VanillaEzClassifyStore(recordingEngine());
        store.registerCollection('a', null);
        store.registerCollection('b', 'a');
        expect(() => store.registerCollection('a', 'b')).toThrow(
            /inside itself/,
        );
        expect(() => store.registerCollection('a', 'a')).toThrow(
            /inside itself/,
        );
    });

    it('stops at the first level whose rollup did not change', async () => {
        const engine = recordingEngine();
        const store = new VanillaEzClassifyStore(engine);
        store.registerCollection('folderA', null);
        store.setMembership('memo1', 'folderA');
        store.setMembership('memo2', 'folderA');
        await store.publishRendered('memo1', 'level:high origin:x');
        await store.publishRendered('memo2', 'level:high');
        await settle();
        const before = engine.calls.length;
        // memo2 changes, but the folder's rollup holds the same facts: the
        // folder recomputes and the page is not asked.
        await store.publishRendered('memo2', 'origin:x');
        await settle();
        const after = engine.calls.slice(before);
        expect(after).toHaveLength(1);
        expect(after[0].sets).toEqual([
            ['level:high', 'origin:x'],
            ['origin:x'],
        ]);
        expect(rendered(store)).toBe('level:high origin:x');
    });
});

describe('document order', () => {
    it('sends contributors in the order the runtime gives, and again when it changes', async () => {
        const engine = recordingEngine();
        const store = new VanillaEzClassifyStore(engine);
        let order = ['b', 'a'];
        const compare = (left: string, right: string) =>
            order.indexOf(left) - order.indexOf(right);
        store.setDocumentOrder(compare);
        await store.publishRendered('a', 'origin:a');
        await store.publishRendered('b', 'origin:b');
        await settle();
        expect(engine.calls.at(-1)!.sets).toEqual([['origin:b'], ['origin:a']]);
        expect(rendered(store)).toBe('origin:b origin:a');

        order = ['a', 'b'];
        store.setDocumentOrder(compare);
        await settle();
        expect(engine.calls.at(-1)!.sets).toEqual([['origin:a'], ['origin:b']]);
        expect(rendered(store)).toBe('origin:a origin:b');
    });

    it('orders a whole rollup parts the same way', async () => {
        const engine = recordingEngine();
        const store = new VanillaEzClassifyStore(engine);
        store.setDocumentOrder((left, right) => (left < right ? 1 : -1));
        store.setPartOf('p1', 'doc');
        store.setPartOf('p2', 'doc');
        await store.publishRendered('p1', 'origin:a');
        await store.publishRendered('p2', 'origin:b');
        await settle();
        expect(store.getWholeRollup('doc').rendered).toBe('origin:b origin:a');
    });
});

describe('buckets', () => {
    const capco = bucketKey('capco', '');
    const cui = bucketKey('cui', '');
    const tier = bucketKey('capco', 'tier');

    function bucketedStore(defaultBucket?: BucketKey) {
        const engines = new Map<BucketKey, ReturnType<typeof recordingEngine>>([
            [capco, recordingEngine()],
            [cui, recordingEngine()],
            [tier, recordingEngine()],
        ]);
        const store = new VanillaEzClassifyStore({
            buckets: {
                ...(defaultBucket ? { defaultBucket } : {}),
                resolve: (bucket) => {
                    const engine = engines.get(bucket);
                    if (!engine) throw new Error(`no bucket ${bucket}`);
                    return { engine };
                },
            },
        });
        return { store, engines };
    }

    it('rolls each bucket up through its own engine and never merges them', async () => {
        const { store, engines } = bucketedStore();
        store.registerCollection('folder', null);
        for (const [id, bucket] of [
            ['a', capco],
            ['b', cui],
            ['c', tier],
            ['d', capco],
        ] as const) {
            store.setBucket(id, bucket);
            store.setMembership(id, 'folder');
        }
        await store.publishRendered('a', 'level:high');
        await store.publishRendered('b', 'level:high');
        await store.publishRendered('c', 'tier:two');
        await store.publishRendered('d', 'origin:x');
        await settle();

        const folder = store.getAggregate('folder');
        expect([...folder.byBucket.keys()].sort()).toEqual(
            [capco, cui, tier].sort(),
        );
        expect(bucketState(folder, capco).rendered).toBe('level:high origin:x');
        expect(bucketState(folder, cui).rendered).toBe('level:high');
        expect(bucketState(folder, tier).rendered).toBe('tier:two');
        // Each engine saw only its own bucket's facts.
        for (const call of engines.get(cui)!.calls)
            expect(call.sets.flat()).toEqual(['level:high']);
        // The page carries the same three buckets up from the folder.
        expect(bucketState(store.getAggregate(), cui).rendered).toBe(
            'level:high',
        );
    });

    it('leaves a part of another bucket out of its whole rollup and says so', async () => {
        const { store } = bucketedStore();
        store.setBucket('doc', capco);
        store.setBucket('p1', capco);
        store.setBucket('p2', cui);
        store.setPartOf('p1', 'doc');
        store.setPartOf('p2', 'doc');
        await store.publishRendered('doc', 'level:low');
        await store.publishRendered('p1', 'level:high');
        await store.publishRendered('p2', 'origin:x');
        await settle();
        const rollup = store.getWholeRollup('doc');
        expect(rollup.rendered).toBe('level:high');
        expect(rollup.stale).toBe(true);
        expect(bucketState(store.getAggregate(), capco).stale).toBe(true);
    });

    it('refuses to read a marking no bucket holds', async () => {
        const { store } = bucketedStore();
        await expect(
            store.publishRendered('lost', 'level:high'),
        ).rejects.toThrow(/in no bucket/);
        await expect(store.seedRendered('lost', 'level:high')).rejects.toThrow(
            /in no bucket/,
        );
        expect(() => store.setBucket('lost', bucketKey('nope', ''))).toThrow(
            /no bucket/,
        );
    });

    it('reads an unplaced marking in the default bucket', async () => {
        const { store } = bucketedStore(cui);
        await store.publishRendered('doc', 'level:high');
        await settle();
        expect([...store.getAggregate().byBucket.keys()]).toEqual([cui]);
    });

    it('refuses a store-wide format beside buckets', () => {
        expect(
            () =>
                new VanillaEzClassifyStore(
                    {
                        buckets: {
                            resolve: () => ({ engine: recordingEngine() }),
                        },
                    },
                    { format: 'banner' },
                ),
        ).toThrow(/each bucket names its own format/);
    });
});

describe('incomplete propagation', () => {
    it('flags every level above a whole whose first read failed, even with nothing else in it', async () => {
        const store = new VanillaEzClassifyStore(
            recordingEngine({ fail: (text) => text.includes('fail') }),
        );
        store.registerCollection('outer', null);
        store.registerCollection('inner', 'outer');
        store.setMembership('memo', 'inner');
        await expect(
            store.publishRendered('memo', 'cat:fail'),
        ).rejects.toThrow();
        await settle();
        for (const level of ['inner', 'outer', undefined]) {
            const state = levelState(store, level);
            expect(state.stale).toBe(true);
            expect(state.rendered).toBe('');
        }
    });

    it('flags the levels above a part whose first read failed', async () => {
        const store = new VanillaEzClassifyStore(
            recordingEngine({ fail: (text) => text.includes('fail') }),
        );
        store.registerCollection('folder', null);
        store.setMembership('doc', 'folder');
        store.setPartOf('p1', 'doc');
        store.setPartOf('p2', 'doc');
        await store.publishRendered('doc', 'level:low');
        await store.publishRendered('p1', 'level:high');
        await expect(store.publishRendered('p2', 'cat:fail')).rejects.toThrow();
        await settle();
        expect(store.getWholeRollup('doc').stale).toBe(true);
        expect(levelState(store, 'folder').stale).toBe(true);
        expect(levelState(store).stale).toBe(true);
        // What was read still counts: the levels are held, not blanked.
        expect(rendered(store)).toBe('level:low level:high');
    });

    it('flags the level of a source that read only part of itself', async () => {
        const store = new VanillaEzClassifyStore(recordingEngine());
        store.registerCollection('folder', null);
        store.setMembership('editor', 'folder');
        await store.publishRendered('editor', 'level:high');
        store.setIncompleteContributor('editor', null, true);
        await settle();
        expect(levelState(store, 'folder').stale).toBe(true);
        expect(levelState(store).stale).toBe(true);
        store.setIncompleteContributor('editor', null, false);
        await settle();
        expect(levelState(store, 'folder').stale).toBeUndefined();
        expect(levelState(store).stale).toBeUndefined();
    });
});

describe('reading a level', () => {
    it('returns the same object until the level changes', async () => {
        const store = new VanillaEzClassifyStore(recordingEngine());
        store.setPartOf('p1', 'doc');
        await store.publishRendered('p1', 'level:high');
        await settle();
        expect(store.getAggregate()).toBe(store.getAggregate());
        expect(store.getAggregate('doc')).toBe(store.getAggregate('doc'));
    });

    it('tells a level listener only when its rollup changes', async () => {
        const store = new VanillaEzClassifyStore(recordingEngine());
        const page: string[] = [];
        const folder: string[] = [];
        store.registerCollection('folder', null);
        store.setMembership('memo', 'folder');
        store.subscribeAggregate((aggregate) =>
            page.push(bucketState(aggregate).rendered),
        );
        store.subscribeAggregate(
            (aggregate) => folder.push(bucketState(aggregate).rendered),
            'folder',
        );
        await store.publishRendered('memo', 'level:high');
        await settle();
        await store.publishRendered('memo', 'level:high');
        await settle();
        expect(folder).toEqual(['level:high']);
        expect(page).toEqual(['level:high']);
    });
});
