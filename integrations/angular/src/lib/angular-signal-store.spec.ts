import { describe, it, expect, vi } from 'vitest';
import {
    EMPTY_EZCLASSIFY_STATE,
    type EzClassifyStoreEngine,
    type FacetState,
} from '@ezclassify/ui';
import {
    createPassThroughEngine,
    runEzClassifyStoreConformance,
    runEzClassifyStoreBudgetConformance,
    runEzClassifyStoreSeedConformance,
} from '@ezclassify/testing-utils';
import type { Assertion, RenderAssessment } from '@ezclassify/types';
import { AngularSignalStore } from './angular-signal-store';

/** What a write that wrote everything it was given reports. */
const EMPTY_RENDER_ASSESSMENT: RenderAssessment = {
    emitted: [],
    omitted: [],
    collapsed: [],
    conflicts: [],
    unrepresentable: [],
};

function passThrough(): EzClassifyStoreEngine {
    return createPassThroughEngine() as EzClassifyStoreEngine;
}

function engineWithSuggest(): EzClassifyStoreEngine {
    return {
        ...passThrough(),
        suggest: vi.fn().mockReturnValue({ suggestions: [] }),
    } as unknown as EzClassifyStoreEngine;
}

async function flush(): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
}

runEzClassifyStoreConformance(() => new AngularSignalStore(passThrough()), {
    suiteName: 'AngularSignalStore',
});

runEzClassifyStoreBudgetConformance(
    (engine) => new AngularSignalStore(engine as EzClassifyStoreEngine),
    { suiteName: 'AngularSignalStore' },
);

runEzClassifyStoreSeedConformance(
    (engine) => new AngularSignalStore(engine as EzClassifyStoreEngine),
    { suiteName: 'AngularSignalStore' },
);

// Angular-only extension: `signalFor(id)` exposes the live WritableSignal so
// templates / effects bind directly to Angular reactivity. Not part of the
// shared suite, React/Vue have different native binding primitives.
describe('AngularSignalStore: Angular-specific surface', () => {
    it('signalFor returns a live signal that updates on commit', async () => {
        const store = new AngularSignalStore(passThrough());
        const sig = store.signalFor('doc');
        expect(sig()).toBe(EMPTY_EZCLASSIFY_STATE);
        await store.publishRendered('doc', 'tier:secret');
        expect(sig().rendered).toBe('tier:secret');
    });
});

describe('AngularSignalStore: aggregate signal and whole rollup', () => {
    it('publishRendered with empty string commits EMPTY_EZCLASSIFY_STATE', async () => {
        const store = new AngularSignalStore(passThrough());
        await store.publishRendered('doc', 'level:high');
        await store.publishRendered('doc', '');
        expect(store.get('doc')).toBe(EMPTY_EZCLASSIFY_STATE);
    });

    it('aggregateSignalRef returns a signal that tracks aggregate', async () => {
        const store = new AngularSignalStore(passThrough());
        const sig = store.aggregateSignalRef();
        expect(sig().rendered).toBe('');
        await store.publishRendered('doc', 'level:high');
        await flush();
        expect(sig().rendered).toBe('level:high');
    });

    it('subscribeAggregate unsubscribe stops further notifications', async () => {
        const store = new AngularSignalStore(passThrough());
        const received: string[] = [];
        const unsub = store.subscribeAggregate((s) =>
            received.push(s.rendered),
        );
        await store.publishRendered('doc', 'level:high');
        await flush();
        unsub();
        await store.publishRendered('doc', 'level:low');
        await flush();
        expect(received).toHaveLength(1);
        expect(received[0]).toBe('level:high');
    });

    it('refuses to construct on an engine without aggregateAssertions (no lossy fallback)', () => {
        const rest = { ...passThrough() } as Record<string, unknown>;
        delete rest.aggregateAssertions;
        expect(
            () =>
                new AngularSignalStore(
                    rest as unknown as EzClassifyStoreEngine,
                ),
        ).toThrow(/requires engine\.aggregateAssertions/);
    });

    it('recomputeAggregate with multiple markings using assertionSets path', async () => {
        const store = new AngularSignalStore(passThrough());
        await store.publishRendered('doc1', 'level:high');
        await store.publishRendered('doc2', 'ctrl:a');
        await flush();
        const agg = store.getAggregate();
        expect(agg.rendered).toContain('level:high');
        expect(agg.rendered).toContain('ctrl:a');
    });

    it('wholeRollupSignalRef returns live signal for whole group', async () => {
        const store = new AngularSignalStore(passThrough());
        const sig = store.wholeRollupSignalRef('doc-group');
        expect(sig().rendered).toBe('');
        store.setPartOf('doc1', 'doc-group');
        await store.publishRendered('doc1', 'level:high');
        await flush();
        expect(sig().rendered).toBe('level:high');
    });
});

describe('AngularSignalStore: setPartOf and whole rollup', () => {
    it('setPartOf null when no previous relationship is a no-op', () => {
        const store = new AngularSignalStore(passThrough());
        store.setPartOf('doc1', null);
        expect(store.getWholeRollup('group').rendered).toBe('');
    });

    it('setPartOf empty string removes an existing relationship', async () => {
        const store = new AngularSignalStore(passThrough());
        store.setPartOf('doc1', 'group');
        await store.publishRendered('doc1', 'level:high');
        await flush();
        store.setPartOf('doc1', '');
        await flush();
        expect(store.getWholeRollup('group').rendered).toBe('');
    });

    it('setPartOf with same wholeId is a no-op', async () => {
        const store = new AngularSignalStore(passThrough());
        store.setPartOf('doc1', 'group');
        store.setPartOf('doc1', 'group');
        await store.publishRendered('doc1', 'level:high');
        await flush();
        expect(store.getWholeRollup('group').rendered).toBe('level:high');
    });

    it('setPartOf changing groups recomputes both old and new group', async () => {
        const store = new AngularSignalStore(passThrough());
        store.setPartOf('doc1', 'group-a');
        await store.publishRendered('doc1', 'level:high');
        await flush();
        store.setPartOf('doc1', 'group-b');
        await flush();
        expect(store.getWholeRollup('group-a').rendered).toBe('');
        expect(store.getWholeRollup('group-b').rendered).toBe('level:high');
    });

    it('subscribeWholeRollup fires when a contributor publishes', async () => {
        const store = new AngularSignalStore(passThrough());
        const received: string[] = [];
        store.subscribeWholeRollup('doc-group', (s) =>
            received.push(s.rendered),
        );
        store.setPartOf('doc1', 'doc-group');
        await store.publishRendered('doc1', 'level:high');
        await flush();
        expect(received.length).toBeGreaterThanOrEqual(1);
        expect(received[received.length - 1]).toBe('level:high');
    });

    it('subscribeWholeRollup unsubscribe stops notifications', async () => {
        const store = new AngularSignalStore(passThrough());
        const received: string[] = [];
        const unsub = store.subscribeWholeRollup('doc-group', (s) =>
            received.push(s.rendered),
        );
        store.setPartOf('doc1', 'doc-group');
        await store.publishRendered('doc1', 'level:high');
        await flush();
        const countBeforeUnsub = received.length;
        unsub();
        await store.publishRendered('doc1', 'level:low');
        await flush();
        // No additional notifications after unsub
        expect(received.length).toBe(countBeforeUnsub);
    });
});

describe('AngularSignalStore: facet subscriptions', () => {
    it('subscribeFacet fires with selectedAssertions after publishRendered', async () => {
        const store = new AngularSignalStore(engineWithSuggest());
        const facetStates: FacetState[] = [];
        const unsub = store.subscribeFacet('doc', 'level', (s) =>
            facetStates.push(s),
        );
        await store.publishRendered('doc', 'level:high');
        await flush();
        expect(facetStates.length).toBeGreaterThan(0);
        const last = facetStates[facetStates.length - 1];
        expect(
            last.selectedAssertions.some(
                (a: Assertion) => a.conceptId === 'high',
            ),
        ).toBe(true);
        unsub();
    });

    it('subscribeFacet without engine.suggest provides null allowableOptions', async () => {
        const store = new AngularSignalStore(passThrough());
        const facetStates: FacetState[] = [];
        const unsub = store.subscribeFacet('doc', 'level', (s) =>
            facetStates.push(s),
        );
        await store.publishRendered('doc', 'level:high');
        await flush();
        expect(facetStates.length).toBeGreaterThan(0);
        expect(facetStates[facetStates.length - 1].allowableOptions).toBeNull();
        unsub();
    });

    it('subscribeFacet unsubscribe stops notifications for every removed listener', async () => {
        const store = new AngularSignalStore(passThrough());
        const seen1: FacetState[] = [];
        const seen2: FacetState[] = [];
        const unsub1 = store.subscribeFacet('doc', 'level', (s) =>
            seen1.push(s),
        );
        const unsub2 = store.subscribeFacet('doc', 'level', (s) =>
            seen2.push(s),
        );
        await store.publishRendered('doc', 'level:high');
        await flush();
        const count1 = seen1.length;
        const count2 = seen2.length;
        expect(count1).toBeGreaterThan(0);
        expect(count2).toBeGreaterThan(0);

        unsub1();
        unsub2();
        await store.publishRendered('doc', 'level:low');
        await flush();
        expect(seen1.length).toBe(count1);
        expect(seen2.length).toBe(count2);
    });

    it('subscribeFacet after destroy throws', () => {
        const store = new AngularSignalStore(passThrough());
        store.destroy();
        expect(() => store.subscribeFacet('doc', 'level', () => {})).toThrow(
            /destroyed/,
        );
    });

    it('facetStateEqual suppresses duplicate notifications for unchanged state', async () => {
        const store = new AngularSignalStore(engineWithSuggest());
        const facetStates: FacetState[] = [];
        store.subscribeFacet('doc', 'level', (s) => facetStates.push(s));
        await store.publishRendered('doc', 'level:high');
        await flush();
        const countAfterFirst = facetStates.length;
        await store.publishRendered('doc', 'level:high');
        await flush();
        expect(facetStates.length).toBe(countAfterFirst);
    });
});

describe('AngularSignalStore: format option and cycle protection', () => {
    it('publishAssertions with format option passes format to engine render/process', async () => {
        const store = new AngularSignalStore(passThrough(), {
            format: 'default',
        });
        await store.publishAssertions('doc', [
            { categoryId: 'level', conceptId: 'high' } as Assertion,
        ]);
        expect(store.get('doc').assertions.length).toBeGreaterThan(0);
    });

    it('commit notifies a listener that has no source even when publish has a source token', async () => {
        const store = new AngularSignalStore(passThrough());
        const received: string[] = [];
        // Subscribe WITHOUT source, l.source is undefined
        store.subscribe('doc', (s) => received.push(s.rendered));
        const sourceToken = Symbol('src');
        await store.publishRendered('doc', 'level:high', {
            token: sourceToken,
        });
        expect(received).toContain('level:high');
    });

    it('fromProcessResult falls back to input string / empty array when engine omits fields', async () => {
        const bareEngine: EzClassifyStoreEngine = {
            process: (_input) => ({
                rendered: undefined as unknown as string,
                assessment: EMPTY_RENDER_ASSESSMENT,
                renders: {},
                assertions: undefined as unknown as Assertion[],
                valid: true,
                errors: undefined as unknown as [],
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
        };
        const store = new AngularSignalStore(bareEngine);
        await store.publishRendered('doc', 'level:high');
        expect(store.get('doc').rendered).toBe('level:high');
        expect(store.get('doc').assertions).toEqual([]);
        expect(store.get('doc').errors).toEqual([]);
    });
});

describe('AngularSignalStore: whole rollup edge cases', () => {
    it('subscribeWholeRollup double-unsubscribe is safe', () => {
        const store = new AngularSignalStore(passThrough());
        const unsub = store.subscribeWholeRollup('group', () => {});
        unsub();
        expect(() => unsub()).not.toThrow();
    });

    it('subscribeWholeRollup with two listeners: unsubscribing one keeps the other', async () => {
        const store = new AngularSignalStore(passThrough());
        const received1: string[] = [];
        const received2: string[] = [];
        store.subscribeWholeRollup('group', (s) => received1.push(s.rendered));
        const unsub2 = store.subscribeWholeRollup('group', (s) =>
            received2.push(s.rendered),
        );
        store.setPartOf('doc', 'group');
        await store.publishRendered('doc', 'level:high');
        await flush();
        const received2BeforeUnsub = received2.length;
        unsub2();
        await store.publishRendered('doc', 'level:low');
        await flush();
        // Listener 1 stays active and sees both commits; listener 2 sees none after unsubscribe.
        expect(received1.length).toBeGreaterThan(1);
        expect(received2BeforeUnsub).toBeGreaterThan(0);
        expect(received2.length).toBe(received2BeforeUnsub);
    });
});

describe('AngularSignalStore: facet subscription edge cases', () => {
    it('subscribeFacet double-unsubscribe is safe', () => {
        const store = new AngularSignalStore(passThrough());
        const unsub = store.subscribeFacet('doc', 'level', () => {});
        unsub();
        expect(() => unsub()).not.toThrow();
    });

    it('subscribeFacet: two categories on one marking, unsubscribing one leaves the other registered', () => {
        const store = new AngularSignalStore(passThrough());
        store.subscribeFacet('doc', 'level', () => {});
        const unsub = store.subscribeFacet('doc', 'ctrl', () => {});
        unsub();
        // The remaining 'level' subscription keeps the marking's category map alive.
        expect(() =>
            store.subscribeFacet('doc', 'level', () => {}),
        ).not.toThrow();
    });
});

describe('AngularSignalStore: assertAlive guards', () => {
    it('subscribe after destroy throws', () => {
        const store = new AngularSignalStore(passThrough());
        store.destroy();
        expect(() => store.subscribe('doc', () => {})).toThrow(/destroyed/);
    });

    it('publishRendered after destroy throws', async () => {
        const store = new AngularSignalStore(passThrough());
        store.destroy();
        await expect(
            store.publishRendered('doc', 'level:high'),
        ).rejects.toThrow(/destroyed/);
    });

    it('subscribeAggregate after destroy throws', () => {
        const store = new AngularSignalStore(passThrough());
        store.destroy();
        expect(() => store.subscribeAggregate(() => {})).toThrow(/destroyed/);
    });

    it('setPartOf after destroy throws', () => {
        const store = new AngularSignalStore(passThrough());
        store.destroy();
        expect(() => store.setPartOf('doc', 'group')).toThrow(/destroyed/);
    });

    it('subscribeWholeRollup after destroy throws', () => {
        const store = new AngularSignalStore(passThrough());
        store.destroy();
        expect(() => store.subscribeWholeRollup('group', () => {})).toThrow(
            /destroyed/,
        );
    });

    it('destroy is idempotent', () => {
        const store = new AngularSignalStore(passThrough());
        store.destroy();
        expect(() => store.destroy()).not.toThrow();
    });
});
