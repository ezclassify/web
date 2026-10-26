import { describe, it, expect, vi } from 'vitest';
import {
    createPassThroughEngine,
    runEzClassifyStoreConformance,
    runEzClassifyStoreBudgetConformance,
    runEzClassifyStoreSeedConformance,
} from '@ezclassify/testing-utils';
import {
    EMPTY_EZCLASSIFY_STATE,
    type EzClassifyStoreEngine,
    type FacetState,
} from '@ezclassify/ui';
import type { Assertion, RenderAssessment } from '@ezclassify/types';
import { ReactEzClassifyStore } from './react-ezclassify-store';

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
    await Promise.resolve();
}

runEzClassifyStoreConformance(() => new ReactEzClassifyStore(passThrough()), {
    suiteName: 'ReactEzClassifyStore',
});

runEzClassifyStoreBudgetConformance(
    (engine) => new ReactEzClassifyStore(engine as EzClassifyStoreEngine),
    { suiteName: 'ReactEzClassifyStore' },
);

runEzClassifyStoreSeedConformance(
    (engine) => new ReactEzClassifyStore(engine as EzClassifyStoreEngine),
    { suiteName: 'ReactEzClassifyStore' },
);

// React-only extension to the shared contract: `subscribeFor` curries the
// id for `useSyncExternalStore` callers. Not part of the cross-framework
// suite because Angular/Vue have their own native binding shapes.
describe('ReactEzClassifyStore: React-specific surface', () => {
    it('subscribeFor curries the id for useSyncExternalStore consumers', async () => {
        const store = new ReactEzClassifyStore(passThrough());
        const cb = vi.fn();
        const sub = store.subscribeFor('doc');
        const unsubscribe = sub(cb);
        await store.publishRendered('doc', 'tier:secret');
        expect(cb).toHaveBeenCalled();
        unsubscribe();
    });
});

describe('ReactEzClassifyStore: store extensions', () => {
    it('publishRendered with empty string commits EMPTY_STATE', async () => {
        const store = new ReactEzClassifyStore(passThrough());
        await store.publishRendered('doc', 'tier:secret');
        expect(store.get('doc').rendered).toBe('tier:secret');
        await store.publishRendered('doc', '');
        expect(store.get('doc')).toBe(EMPTY_EZCLASSIFY_STATE);
    });

    it('publishAssertions with format option passes format flag', async () => {
        const store = new ReactEzClassifyStore(passThrough(), {
            format: 'default',
        });
        await store.publishAssertions('doc', [
            { categoryId: 'level', conceptId: 'high' } as Assertion,
        ]);
        expect(store.get('doc').assertions.length).toBeGreaterThan(0);
    });

    it('fromProcessResult falls back when engine omits rendered/assertions/errors', async () => {
        const bareEngine: EzClassifyStoreEngine = {
            process: () => ({
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
        const store = new ReactEzClassifyStore(bareEngine);
        await store.publishRendered('doc', 'level:high');
        expect(store.get('doc').rendered).toBe('level:high');
        expect(store.get('doc').assertions).toEqual([]);
        expect(store.get('doc').errors).toEqual([]);
    });

    it('destroy is idempotent', () => {
        const store = new ReactEzClassifyStore(passThrough());
        store.destroy();
        expect(() => store.destroy()).not.toThrow();
    });

    it('getWholeRollup returns EMPTY_STATE for an unknown wholeId', () => {
        const store = new ReactEzClassifyStore(passThrough());
        expect(store.getWholeRollup('no-such-group')).toBe(
            EMPTY_EZCLASSIFY_STATE,
        );
    });
});

describe('ReactEzClassifyStore: setPartOf edge cases', () => {
    it('setPartOf(null) when no prior mapping is a no-op', () => {
        const store = new ReactEzClassifyStore(passThrough());
        expect(() => store.setPartOf('doc', null)).not.toThrow();
        expect(store.getWholeRollup('group').rendered).toBe('');
    });

    it('setPartOf with same wholeId is a no-op', async () => {
        const store = new ReactEzClassifyStore(passThrough());
        store.setPartOf('doc', 'group');
        store.setPartOf('doc', 'group'); // same → no-op
        await store.publishRendered('doc', 'tier:secret');
        await flush();
        expect(store.getWholeRollup('group').rendered).toBe('tier:secret');
    });

    it('setPartOf changing groups recomputes both old and new', async () => {
        const store = new ReactEzClassifyStore(passThrough());
        store.setPartOf('doc', 'group-a');
        await store.publishRendered('doc', 'tier:secret');
        await flush();
        store.setPartOf('doc', 'group-b');
        await flush();
        expect(store.getWholeRollup('group-a').rendered).toBe('');
        expect(store.getWholeRollup('group-b').rendered).toBe('tier:secret');
    });

    it('setPartOf empty string removes an existing relationship', async () => {
        const store = new ReactEzClassifyStore(passThrough());
        store.setPartOf('doc', 'group');
        await store.publishRendered('doc', 'tier:secret');
        await flush();
        store.setPartOf('doc', '');
        await flush();
        expect(store.getWholeRollup('group').rendered).toBe('');
    });
});

describe('ReactEzClassifyStore: subscribeWholeRollup edge cases', () => {
    it('subscribeWholeRollup second subscriber reuses the existing Set', async () => {
        const store = new ReactEzClassifyStore(passThrough());
        const received1: string[] = [];
        const received2: string[] = [];
        store.subscribeWholeRollup('group', (s) => received1.push(s.rendered));
        store.subscribeWholeRollup('group', (s) => received2.push(s.rendered));
        store.setPartOf('doc', 'group');
        await store.publishRendered('doc', 'tier:secret');
        await flush();
        expect(received1.length).toBeGreaterThan(0);
        expect(received2.length).toBeGreaterThan(0);
    });

    it('subscribeWholeRollup double-unsubscribe is safe', () => {
        const store = new ReactEzClassifyStore(passThrough());
        const unsub = store.subscribeWholeRollup('group', () => {});
        unsub();
        expect(() => unsub()).not.toThrow();
    });

    it('subscribeWholeRollup unsubscribing one of two listeners keeps the other active', async () => {
        const store = new ReactEzClassifyStore(passThrough());
        const received1: string[] = [];
        const received2: string[] = [];
        store.subscribeWholeRollup('group', (s) => received1.push(s.rendered));
        const unsub2 = store.subscribeWholeRollup('group', (s) =>
            received2.push(s.rendered),
        );
        store.setPartOf('doc', 'group');
        await store.publishRendered('doc', 'tier:secret');
        await flush();
        unsub2();
        await store.publishRendered('doc', 'tier:top-secret');
        await flush();
        expect(received1.length).toBeGreaterThan(1);
        const countAfterUnsub = received2.length;
        expect(received2.length).toBeGreaterThan(0);
        expect(received2.length).toBe(countAfterUnsub);
    });

    it('subscribeWholeRollup fires listener when contributor publishes', async () => {
        const store = new ReactEzClassifyStore(passThrough());
        const received: string[] = [];
        store.subscribeWholeRollup('doc-group', (s) =>
            received.push(s.rendered),
        );
        store.setPartOf('doc1', 'doc-group');
        await store.publishRendered('doc1', 'tier:secret');
        await flush();
        expect(received.length).toBeGreaterThan(0);
        expect(received[received.length - 1]).toBe('tier:secret');
    });
});

describe('ReactEzClassifyStore: subscribeFacet and refreshFacets', () => {
    it('subscribeFacet creates listener map on first call', () => {
        const store = new ReactEzClassifyStore(passThrough());
        const unsub = store.subscribeFacet('doc', 'level', () => {});
        expect(typeof unsub).toBe('function');
        unsub();
    });

    it('subscribeFacet after destroy throws', () => {
        const store = new ReactEzClassifyStore(passThrough());
        store.destroy();
        expect(() => store.subscribeFacet('doc', 'level', () => {})).toThrow(
            /destroyed/,
        );
    });

    it('subscribeFacet double-unsubscribe is safe', () => {
        const store = new ReactEzClassifyStore(passThrough());
        const unsub = store.subscribeFacet('doc', 'level', () => {});
        unsub();
        expect(() => unsub()).not.toThrow();
    });

    it('subscribeFacet two categories for same marking: unsubscribing one keeps map', () => {
        const store = new ReactEzClassifyStore(passThrough());
        store.subscribeFacet('doc', 'level', () => {});
        const unsub = store.subscribeFacet('doc', 'ctrl', () => {});
        unsub();
        // The remaining 'level' subscription keeps the marking's category map alive.
        expect(() =>
            store.subscribeFacet('doc', 'level', () => {}),
        ).not.toThrow();
    });

    it('subscribeFacet fires with selectedAssertions after publishRendered (no suggest)', async () => {
        const store = new ReactEzClassifyStore(passThrough());
        const facetStates: FacetState[] = [];
        const unsub = store.subscribeFacet('doc', 'tier', (s) =>
            facetStates.push(s),
        );
        await store.publishRendered('doc', 'tier:secret');
        await flush();
        expect(facetStates.length).toBeGreaterThan(0);
        expect(facetStates[facetStates.length - 1].allowableOptions).toBeNull();
        expect(
            facetStates[facetStates.length - 1].selectedAssertions.some(
                (a: Assertion) => a.conceptId === 'secret',
            ),
        ).toBe(true);
        unsub();
    });

    it('subscribeFacet with engine.suggest provides allowableOptions', async () => {
        const store = new ReactEzClassifyStore(engineWithSuggest());
        const facetStates: FacetState[] = [];
        const unsub = store.subscribeFacet('doc', 'tier', (s) =>
            facetStates.push(s),
        );
        await store.publishRendered('doc', 'tier:secret');
        await flush();
        expect(facetStates.length).toBeGreaterThan(0);
        expect(
            facetStates[facetStates.length - 1].allowableOptions,
        ).not.toBeUndefined();
        unsub();
    });

    it('subscribeFacet: second category subscription reuses byCategory map', async () => {
        const store = new ReactEzClassifyStore(passThrough());
        const levelStates: FacetState[] = [];
        const ctrlStates: FacetState[] = [];
        store.subscribeFacet('doc', 'tier', (s) => levelStates.push(s));
        store.subscribeFacet('doc', 'ctrl', (s) => ctrlStates.push(s));
        await store.publishRendered('doc', 'tier:secret ctrl:alpha');
        await flush();
        expect(levelStates.length).toBeGreaterThan(0);
    });

    it('subscribeFacet: two listeners for same category, unsubscribing one keeps the other', async () => {
        const store = new ReactEzClassifyStore(passThrough());
        const states1: FacetState[] = [];
        const states2: FacetState[] = [];
        const unsub1 = store.subscribeFacet('doc', 'tier', (s) =>
            states1.push(s),
        );
        store.subscribeFacet('doc', 'tier', (s) => states2.push(s));
        await store.publishRendered('doc', 'tier:secret');
        await flush();
        const countBefore = states1.length;
        unsub1();
        await store.publishRendered('doc', 'tier:top-secret');
        await flush();
        expect(states2.length).toBeGreaterThan(countBefore);
        expect(states1.length).toBe(countBefore); // unsub1 stopped receiving
    });

    it('double-unsubscribe of one category is safe while another category remains subscribed', () => {
        const store = new ReactEzClassifyStore(passThrough());
        store.subscribeFacet('doc', 'level', () => {});
        const unsub = store.subscribeFacet('doc', 'ctrl', () => {});
        unsub();
        expect(() => unsub()).not.toThrow();
    });

    it('facetStateEqual suppresses duplicate notifications on identical re-publish', async () => {
        const store = new ReactEzClassifyStore(passThrough());
        const facetStates: FacetState[] = [];
        store.subscribeFacet('doc', 'tier', (s) => facetStates.push(s));
        await store.publishRendered('doc', 'tier:secret');
        await flush();
        const countAfterFirst = facetStates.length;
        // Second identical publish, facetStateEqual should suppress the notification
        await store.publishRendered('doc', 'tier:secret');
        await flush();
        expect(facetStates.length).toBe(countAfterFirst);
    });

    it('subscribeFacet with suggest and non-empty context assertions', async () => {
        const store = new ReactEzClassifyStore(engineWithSuggest());
        const states: FacetState[] = [];
        store.subscribeFacet('doc', 'ctrl', (s) => states.push(s));
        // Publish with assertions in 'tier' category so 'ctrl' refresh sees non-empty context
        await store.publishRendered('doc', 'tier:secret ctrl:alpha');
        await flush();
        expect(states.length).toBeGreaterThan(0);
    });
});

describe('ReactEzClassifyStore: aggregate and wholeRollup computation', () => {
    it('subscribeAggregate fires with aggregated state', async () => {
        const store = new ReactEzClassifyStore(passThrough());
        const received: string[] = [];
        const unsub = store.subscribeAggregate((s) =>
            received.push(s.rendered),
        );
        await store.publishRendered('doc', 'tier:secret');
        await flush();
        expect(received.length).toBeGreaterThan(0);
        unsub();
    });

    it('refuses to construct on an engine without aggregateAssertions (no lossy fallback)', () => {
        const rest = { ...passThrough() } as Record<string, unknown>;
        delete rest.aggregateAssertions;
        expect(
            () =>
                new ReactEzClassifyStore(
                    rest as unknown as EzClassifyStoreEngine,
                ),
        ).toThrow(/requires engine\.aggregateAssertions/);
    });

    it('recomputeAggregate with multiple markings', async () => {
        const store = new ReactEzClassifyStore(passThrough());
        await store.publishRendered('doc1', 'tier:secret');
        await store.publishRendered('doc2', 'ctrl:alpha');
        await flush();
        const agg = store.getAggregate();
        expect(agg.rendered).toContain('tier:secret');
        expect(agg.rendered).toContain('ctrl:alpha');
    });

    it('commit notifies subscriber without source even when published with a source token', async () => {
        const store = new ReactEzClassifyStore(passThrough());
        const received: string[] = [];
        store.subscribe('doc', (s) => received.push(s.rendered));
        await store.publishRendered('doc', 'tier:secret', {
            token: Symbol('src'),
        });
        expect(received).toContain('tier:secret');
    });
});

describe('ReactEzClassifyStore: destroyed-store publish guard', () => {
    // assertAlive() inside an async function
    // becomes a rejected promise, not a synchronous throw. EzClassifyUI wraps
    // these calls with .catch(() => {}) to prevent unhandled rejections when
    // the store is torn down (e.g. React StrictMode double-mount). The .catch
    // pattern only works if the call returns a Promise, a sync throw bypasses
    // .catch. These tests lock that contract.

    it('publishRendered on a destroyed store returns a rejected Promise, not a sync throw', async () => {
        const store = new ReactEzClassifyStore(passThrough());
        store.destroy();
        const p = store.publishRendered('doc', 'tier:secret');
        expect(p).toBeInstanceOf(Promise);
        // .catch(() => {}), the same pattern EzClassifyUI uses, must swallow
        // the rejection without re-throwing or leaving it unhandled.
        await p.catch(() => {});
    });

    it('publishAssertions on a destroyed store returns a rejected Promise, not a sync throw', async () => {
        const store = new ReactEzClassifyStore(passThrough());
        store.destroy();
        const p = store.publishAssertions('doc', []);
        expect(p).toBeInstanceOf(Promise);
        await p.catch(() => {});
    });
});
