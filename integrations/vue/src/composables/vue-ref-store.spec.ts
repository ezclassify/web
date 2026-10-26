import { describe, it, expect, vi } from 'vitest';
import {
    EMPTY_EZCLASSIFY_STATE,
    type EzClassifyStoreEngine,
    type EzClassifyStoreProcessResult,
    type FacetState,
} from '@ezclassify/ui';
import type { Assertion, RenderAssessment } from '@ezclassify/types';
import {
    createPassThroughEngine,
    runEzClassifyStoreConformance,
    runEzClassifyStoreBudgetConformance,
    runEzClassifyStoreSeedConformance,
} from '@ezclassify/testing-utils';
import { VueRefStore } from './vue-ref-store';

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

// The shared suite covers the cross-framework EzClassifyStore contract
// (commit, subscribe, whole-rollup, facet, recompute budget). Everything
// below it is Vue-specific surface or store error-handling that the
// pass-through conformance engine does not exercise.
runEzClassifyStoreConformance(() => new VueRefStore(passThrough()), {
    suiteName: 'VueRefStore',
});

runEzClassifyStoreBudgetConformance(
    (engine) => new VueRefStore(engine as EzClassifyStoreEngine),
    {
        suiteName: 'VueRefStore',
    },
);

runEzClassifyStoreSeedConformance(
    (engine) => new VueRefStore(engine as EzClassifyStoreEngine),
    { suiteName: 'VueRefStore' },
);

async function flush(): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
}

// Vue-only extension: `refFor(id)` exposes the live Ref so templates and
// computed() consumers bind directly to Vue reactivity. Not part of the
// shared suite, React/Angular bind through different primitives.
describe('VueRefStore: live refs for template binding', () => {
    it('refFor returns a ref that updates when its marking commits', async () => {
        const store = new VueRefStore(passThrough());
        const r = store.refFor('doc');
        expect(r.value).toBe(EMPTY_EZCLASSIFY_STATE);
        await store.publishRendered('doc', 'tier:secret');
        expect(r.value.rendered).toBe('tier:secret');
    });

    it('aggregateRef returns a ref that updates when any contributor commits', async () => {
        const store = new VueRefStore(passThrough());
        const r = store.aggregateRef();
        expect(r.value).toBe(EMPTY_EZCLASSIFY_STATE);
        await store.publishRendered('doc', 'tier:secret');
        expect(r.value.rendered).toBe('tier:secret');
    });

    it('wholeRollupRef returns a ref that updates when one of the whole’s parts commits', async () => {
        const store = new VueRefStore(passThrough());
        store.setPartOf('doc', 'group');
        const r = store.wholeRollupRef('group');
        expect(r.value).toBe(EMPTY_EZCLASSIFY_STATE);
        await store.publishRendered('doc', 'tier:secret');
        expect(r.value.rendered).toBe('tier:secret');
    });
});

describe('VueRefStore: tolerates engines that omit optional result fields', () => {
    it('substitutes the input string and empty arrays when the engine returns undefined', async () => {
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
        const store = new VueRefStore(bareEngine);
        await store.publishRendered('doc', 'tier:high');
        expect(store.get('doc').rendered).toBe('tier:high');
        expect(store.get('doc').assertions).toEqual([]);
        expect(store.get('doc').errors).toEqual([]);
    });
});

describe('VueRefStore: recovers when the engine throws during recompute', () => {
    it('holds the last rollup value and flags it stale when aggregateAssertions() throws', async () => {
        const faultyEngine: EzClassifyStoreEngine = {
            process: (input) => ({
                rendered: input as string,
                assessment: EMPTY_RENDER_ASSESSMENT,
                renders: {},
                assertions: [
                    { categoryId: 'tier', conceptId: 'secret' } as Assertion,
                ],
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
            aggregateAssertions: () => {
                throw new Error('aggregateAssertions failed');
            },
            getSchemeMeta: () => ({ scopes: [] }),
            listCategories: () => [],
        };
        const store = new VueRefStore(faultyEngine);
        store.setPartOf('doc', 'group');
        const r = store.wholeRollupRef('group');
        await store.publishRendered('doc', 'tier:secret');
        await flush();
        // A failed rollup keeps the last value it could compute and says it is
        // held; blanking an aggregate banner would read as "no marking", which
        // is the one wrong answer a classification UI must never give. Nothing
        // had rolled up yet here, so the held value is the empty state, and the
        // point of the assertion is the flag that comes with it.
        expect(r.value).toEqual({ ...EMPTY_EZCLASSIFY_STATE, stale: true });
    });

    it('reports null allowableOptions for a category when suggest() throws', async () => {
        const throwingSuggest: EzClassifyStoreEngine = {
            ...passThrough(),
            suggest: () => {
                throw new Error('suggest error');
            },
        } as unknown as EzClassifyStoreEngine;
        const store = new VueRefStore(throwingSuggest);
        const states: FacetState[] = [];
        store.subscribeFacet('doc', 'tier', (s) => states.push(s));
        await store.publishRendered('doc', 'tier:secret');
        await flush();
        expect(states.length).toBeGreaterThan(0);
        expect(states[0].allowableOptions).toBeNull();
    });
});

describe('VueRefStore: facet listeners only fire when the facet state changes', () => {
    it('suppresses the notification when an identical state is re-published', async () => {
        const engineWithSuggest: EzClassifyStoreEngine = {
            ...passThrough(),
            suggest: vi.fn().mockReturnValue({ suggestions: [] }),
        } as unknown as EzClassifyStoreEngine;
        const store = new VueRefStore(engineWithSuggest);
        const states: FacetState[] = [];
        store.subscribeFacet('doc', 'tier', (s) => states.push(s));
        await store.publishRendered('doc', 'tier:secret');
        await flush();
        const countAfterFirst = states.length;
        await store.publishRendered('doc', 'tier:secret');
        await flush();
        expect(states.length).toBe(countAfterFirst);
    });

    it('reports null allowableOptions when the engine offers no suggest()', async () => {
        const states: FacetState[] = [];
        const engineNoSuggest: EzClassifyStoreEngine = {
            process: (input) => ({
                rendered: input as string,
                assessment: EMPTY_RENDER_ASSESSMENT,
                renders: {},
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
        };
        const store = new VueRefStore(engineNoSuggest);
        store.subscribeFacet('doc', 'tier', (s) => states.push(s));
        await store.publishRendered('doc', 'tier:a');
        await flush();
        expect(states[0].allowableOptions).toBeNull();
    });

    it('fires when the allowableOptions count changes', async () => {
        let callCount = 0;
        const engineSuggestToggle: EzClassifyStoreEngine = {
            process: (input: string | Assertion[]) => ({
                rendered: input as string,
                renders: {},
                assertions: [
                    { categoryId: 'tier', conceptId: 'a' } as Assertion,
                ],
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
            suggest: vi
                .fn()
                .mockReturnValueOnce({
                    suggestions: [{ categoryId: 'tier', conceptId: 'a' }],
                })
                .mockReturnValue({
                    suggestions: [
                        { categoryId: 'tier', conceptId: 'a' },
                        { categoryId: 'tier', conceptId: 'b' },
                    ],
                }),
        } as unknown as EzClassifyStoreEngine;
        const store = new VueRefStore(engineSuggestToggle);
        store.subscribeFacet('doc', 'tier', () => {
            callCount++;
        });
        await store.publishRendered('doc', 'tier:a');
        await flush();
        await store.publishRendered('doc', 'tier:a');
        await flush();
        expect(callCount).toBeGreaterThanOrEqual(2);
    });

    it('fires when allowableOptions keeps its count but changes content', async () => {
        let call = 0;
        const toggleContent: EzClassifyStoreEngine = {
            process: (input: string | Assertion[]) => ({
                rendered: input as string,
                renders: {},
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
            suggest: () => {
                call++;
                // One suggestion each time, but a different concept, same length, different content.
                const conceptId = call === 1 ? 'a' : 'b';
                return {
                    suggestions: [
                        {
                            categoryId: 'tier',
                            conceptId,
                            score: 1,
                        } as unknown as import('@ezclassify/types').Suggestion,
                    ],
                };
            },
        } as unknown as EzClassifyStoreEngine;
        const store = new VueRefStore(toggleContent);
        const states: FacetState[] = [];
        store.subscribeFacet('doc', 'tier', (s) => states.push(s));
        await store.publishRendered('doc', 'tier:a');
        await flush();
        const countAfterFirst = states.length;
        await store.publishRendered('doc', 'tier:a');
        await flush();
        expect(states.length).toBeGreaterThan(countAfterFirst);
    });

    it('fires when allowableOptions shares a prefix but diverges later in the list', async () => {
        let call = 0;
        const stableFirstEngine: EzClassifyStoreEngine = {
            process: (input: string | Assertion[]) => ({
                rendered: input as string,
                renders: {},
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
            suggest: () => {
                call++;
                const second = call === 1 ? 'b' : 'c'; // first element stays 'a', second element changes
                return {
                    suggestions: [
                        {
                            categoryId: 'tier',
                            conceptId: 'a',
                            score: 1,
                        } as unknown as import('@ezclassify/types').Suggestion,
                        {
                            categoryId: 'tier',
                            conceptId: second,
                            score: 1,
                        } as unknown as import('@ezclassify/types').Suggestion,
                    ],
                };
            },
        } as unknown as EzClassifyStoreEngine;
        const store = new VueRefStore(stableFirstEngine);
        const states: FacetState[] = [];
        store.subscribeFacet('doc', 'tier', (s) => states.push(s));
        await store.publishRendered('doc', 'tier:a');
        await flush();
        const countAfterFirst = states.length;
        await store.publishRendered('doc', 'tier:a');
        await flush();
        expect(states.length).toBeGreaterThan(countAfterFirst);
    });

    it('fires when the selected-assertion count changes', async () => {
        let call = 0;
        const changingCountEngine: EzClassifyStoreEngine = {
            process: () => {
                call++;
                const assertions =
                    call === 1
                        ? [{ categoryId: 'tier', conceptId: 'a' } as Assertion]
                        : [];
                return {
                    rendered: `call-${call}`,
                    assessment: EMPTY_RENDER_ASSESSMENT,
                    renders: {},
                    assertions,
                    valid: true,
                    errors: [],
                };
            },
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
        const store = new VueRefStore(changingCountEngine);
        const states: FacetState[] = [];
        store.subscribeFacet('doc', 'tier', (s) => states.push(s));
        await store.publishRendered('doc', 'tier:a');
        await flush();
        const countAfterFirst = states.length;
        await store.publishRendered('doc', 'tier:b');
        await flush();
        expect(states.length).toBeGreaterThan(countAfterFirst);
    });

    it('fires when the selected assertions keep their count but change content', async () => {
        let publishCount = 0;
        const changingAssertionsEngine: EzClassifyStoreEngine = {
            process: () => {
                publishCount++;
                const conceptId = publishCount <= 1 ? 'secret' : 'top';
                return {
                    rendered: `tier:${conceptId}`,
                    assessment: EMPTY_RENDER_ASSESSMENT,
                    renders: {},
                    assertions: [
                        { categoryId: 'tier', conceptId } as Assertion,
                    ],
                    valid: true,
                    errors: [],
                };
            },
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
        const store = new VueRefStore(changingAssertionsEngine);
        const states: FacetState[] = [];
        store.subscribeFacet('doc', 'tier', (s) => states.push(s));
        await store.publishRendered('doc', 'tier:secret');
        await flush();
        const countAfterFirst = states.length;
        await store.publishRendered('doc', 'tier:top');
        await flush();
        expect(states.length).toBeGreaterThan(countAfterFirst);
    });
});

describe('VueRefStore: facet subscription bookkeeping', () => {
    it('supports two categories on one marking and unsubscribing one independently', () => {
        const store = new VueRefStore(passThrough());
        store.subscribeFacet('doc', 'level', () => {});
        const unsub = store.subscribeFacet('doc', 'ctrl', () => {});
        expect(() => unsub()).not.toThrow();
        // The remaining 'level' subscription is unaffected.
        expect(() =>
            store.subscribeFacet('doc', 'level', () => {}),
        ).not.toThrow();
    });

    it('keeps a category alive while another listener on it remains', () => {
        const store = new VueRefStore(passThrough());
        store.subscribeFacet('doc', 'level', () => {});
        const unsub1 = store.subscribeFacet('doc', 'ctrl', () => {});
        store.subscribeFacet('doc', 'ctrl', () => {});
        unsub1();
        expect(() =>
            store.subscribeFacet('doc', 'ctrl', () => {}),
        ).not.toThrow();
    });

    it('double-unsubscribe is safe', () => {
        const store = new VueRefStore(passThrough());
        const unsub = store.subscribeFacet('doc', 'level', () => {});
        unsub();
        expect(() => unsub()).not.toThrow();
    });

    it('passes through the format option when refreshing facets', async () => {
        const store = new VueRefStore(passThrough(), {
            format: 'default',
        });
        store.subscribeFacet('doc', 'level', () => {});
        await store.publishRendered('doc', 'level:secret tier:ts');
        await flush();
        expect(store.get('doc').rendered).toBe('level:secret tier:ts');
    });
});

describe('VueRefStore: whole-rollup recompute', () => {
    it('resets the rollup to the empty state when its last part publishes empty', async () => {
        const store = new VueRefStore(passThrough(), {
            format: 'default',
        });
        store.setPartOf('doc', 'group');
        const r = store.wholeRollupRef('group');
        await store.publishRendered('doc', 'tier:secret');
        await flush();
        expect(r.value.rendered).toBeTruthy();
        await store.publishRendered('doc', '');
        await flush();
        expect(r.value).toEqual(EMPTY_EZCLASSIFY_STATE);
    });

    it('fires the rollup listener when a part publishes', async () => {
        const store = new VueRefStore(passThrough());
        store.setPartOf('doc', 'group');
        const states: EzClassifyStoreProcessResult[] = [];
        store.subscribeWholeRollup('group', (s) =>
            states.push(s as unknown as EzClassifyStoreProcessResult),
        );
        await store.publishRendered('doc', 'tier:secret');
        await flush();
        expect(states.length).toBeGreaterThan(0);
    });

    it('supports two rollup listeners and unsubscribing one independently', () => {
        const store = new VueRefStore(passThrough());
        const unsub1 = store.subscribeWholeRollup('group', () => {});
        const unsub2 = store.subscribeWholeRollup('group', () => {});
        unsub1();
        expect(() => unsub2()).not.toThrow();
    });

    it('double-unsubscribe is safe', () => {
        const store = new VueRefStore(passThrough());
        const unsub = store.subscribeWholeRollup('group', () => {});
        unsub();
        expect(() => unsub()).not.toThrow();
    });
});

describe('VueRefStore: aggregate recompute', () => {
    it('resets the aggregate to the empty state when every marking is empty', async () => {
        const store = new VueRefStore(passThrough());
        store.subscribeAggregate(() => {});
        await store.publishRendered('doc', '');
        await flush();
        expect(store.getAggregate()).toEqual(EMPTY_EZCLASSIFY_STATE);
    });

    it('stops calling an aggregate listener after it unsubscribes', async () => {
        const store = new VueRefStore(passThrough());
        const calls: unknown[] = [];
        const unsub = store.subscribeAggregate((s) => calls.push(s));
        await store.publishRendered('doc', 'tier:secret');
        await flush();
        const afterFirst = calls.length;
        unsub();
        await store.publishRendered('doc', 'tier:top');
        await flush();
        expect(calls.length).toBe(afterFirst);
    });
});

describe('VueRefStore: marking subscriptions', () => {
    it('stops calling a marking listener after it unsubscribes', async () => {
        const store = new VueRefStore(passThrough());
        const states: unknown[] = [];
        const unsub = store.subscribe('doc', (s) => states.push(s));
        await store.publishRendered('doc', 'tier:secret');
        const after = states.length;
        unsub();
        await store.publishRendered('doc', 'tier:top');
        expect(states.length).toBe(after);
    });
});

describe('VueRefStore: setPartOf', () => {
    it('is a no-op when clearing a marking that was never assigned', () => {
        const store = new VueRefStore(passThrough());
        expect(() => store.setPartOf('doc', null)).not.toThrow();
    });

    it('is a no-op when re-assigning a marking to the same whole', () => {
        const store = new VueRefStore(passThrough());
        store.setPartOf('doc', 'group');
        expect(() => store.setPartOf('doc', 'group')).not.toThrow();
    });

    it('moves a marking from one whole to another', async () => {
        const store = new VueRefStore(passThrough());
        store.setPartOf('doc', 'group-a');
        await store.publishRendered('doc', 'tier:secret');
        await flush();
        store.setPartOf('doc', 'group-b');
        await flush();
        expect(store.getWholeRollup('group-b').rendered).toBe('tier:secret');
    });
});

describe('VueRefStore: publishAssertions', () => {
    it('renders the published assertions through the engine', async () => {
        const store = new VueRefStore(passThrough(), {
            format: 'default',
        });
        await store.publishAssertions('doc', [
            { categoryId: 'tier', conceptId: 'secret' } as Assertion,
        ]);
        expect(store.get('doc').rendered).toBeTruthy();
    });
});

describe('VueRefStore: destroyed-store guard', () => {
    it('rejects publishRendered after destroy', async () => {
        const store = new VueRefStore(passThrough());
        store.destroy();
        await expect(store.publishRendered('doc', 'x')).rejects.toThrow(
            'destroyed',
        );
    });

    it('double-destroy is safe', () => {
        const store = new VueRefStore(passThrough());
        store.destroy();
        expect(() => store.destroy()).not.toThrow();
    });
});
