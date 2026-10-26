/**
 * The UI store, driven through `EzClassifyClient`, against a running REST API.
 *
 * This is the configuration the product ships for a REST deployment.
 * `@ezclassify/ui` has a store suite that runs on hand-written engines and
 * `@ezclassify/rest-client` has a request-shape suite that runs on a fetch
 * mock; this is where the two meet. `BaseEzClassifyStore.publishAssertions`
 * calls `engine.process(assertions)`, and every facet write, every headless
 * `setSelected`, and every rollup depends on the client sending that over the
 * wire in a shape the server accepts.
 *
 * So these specs assert behavior a mock cannot vouch for: that a selection
 * published through the store survives the round trip, that the facet
 * subscription that drives every picker receives options, and that the headless
 * binding a third-party control uses works over the wire.
 */
import { describe, it, expect, beforeAll, afterAll, inject } from 'vitest';
import {
    VanillaEzClassifyStore,
    createEzClassifyFacetBinding,
    type EzClassifyStoreEngine,
    type FacetState,
} from '@ezclassify/ui';
import { EzClassifyClient } from '@ezclassify/rest-client';
import type { Assertion } from '@ezclassify/types';

const SCHEME_ID = 'cedar-valley-handling';
const CATEGORY = 'level';

describe('EzClassifyStore over a REST deployment', () => {
    let client: EzClassifyClient;
    let store: VanillaEzClassifyStore;
    let low: string;
    let high: string;
    /** The rendered view of `high` in the scheme's default format. */
    let highRendered: string;

    beforeAll(async () => {
        client = await EzClassifyClient.connect(inject('restApiBaseUrl'), {
            contextId: SCHEME_ID,
            contextVersion: '1.0.0',
            contextToken: inject('restApiContextTokens')[SCHEME_ID],
        });
        // The client IS the store's engine: this is the supported deployment
        // shape, `@ezclassify/ui` pointed at the REST API.
        store = new VanillaEzClassifyStore(
            client as unknown as EzClassifyStoreEngine,
        );

        const ranked = [...client.getConceptsInCategory(CATEGORY)].sort(
            (a, b) => (a.rank ?? 0) - (b.rank ?? 0),
        );
        low = ranked[0]!.id;
        high = ranked[ranked.length - 1]!.id;
        highRendered = ranked[ranked.length - 1]!.views['default'] ?? high;
    });

    afterAll(() => {
        store?.destroy();
        client?.destroy();
    });

    const user = (conceptId: string): Assertion =>
        ({
            conceptId,
            categoryId: CATEGORY,
            confidence: 'certain',
            source: 'user',
        }) as Assertion;

    it('publishAssertions() round-trips a selection through the server', async () => {
        await store.publishAssertions('marking-1', [user(high)]);
        const state = store.get('marking-1');
        expect(state.assertions.map((a) => a.conceptId)).toContain(high);
        expect(state.rendered).toBe(highRendered);
        expect(state.valid).toBe(true);
    });

    it('publishAssertions([]) clears the marking rather than erroring', async () => {
        await store.publishAssertions('marking-clear', [user(high)]);
        await store.publishAssertions('marking-clear', []);
        expect(store.get('marking-clear').assertions).toEqual([]);
        expect(store.get('marking-clear').rendered).toBe('');
    });

    it('replacing a selection replaces it, it does not accumulate', async () => {
        await store.publishAssertions('marking-2', [user(low)]);
        await store.publishAssertions('marking-2', [user(high)]);
        expect(
            store.get('marking-2').assertions.map((a) => a.conceptId),
        ).toEqual([high]);
    });

    it('subscribeFacet() delivers allowable options from the server', async () => {
        // The store fires the per-category suggest as a detached task after it
        // commits, so wait for the notification rather than for the publish.
        const notified: FacetState[] = [];
        let arrived: () => void;
        const firstNotification = new Promise<void>((resolve) => {
            arrived = resolve;
        });
        const unsubscribe = store.subscribeFacet(
            'marking-3',
            CATEGORY,
            (state) => {
                notified.push(state);
                arrived();
            },
        );
        await store.publishAssertions('marking-3', [user(low)]);
        await firstNotification;
        unsubscribe();

        const last = notified[notified.length - 1]!;
        expect(last.selectedAssertions.map((a) => a.conceptId)).toEqual([low]);
        expect(last.allowableOptions?.length).toBeGreaterThan(0);
    });

    it('the headless facet binding writes a selection over the wire', async () => {
        // This is the seam third-party select controls use: setSelected()
        // lands in publishAssertions() with the whole category's assertion
        // array.
        const binding = createEzClassifyFacetBinding(
            store,
            'marking-4',
            CATEGORY,
        );
        await binding.ready;
        await binding.setSelected([high]);

        const snapshot = binding.getSnapshot();
        expect(snapshot.selectedConceptIds).toEqual([high]);
        expect(snapshot.marking.assertions.map((a) => a.conceptId)).toEqual([
            high,
        ]);
        expect(snapshot.marking.valid).toBe(true);
        binding.destroy();
    });

    it('the page aggregate rolls up markings published through the server', async () => {
        await store.publishAssertions('agg-a', [user(low)]);
        await store.publishAssertions('agg-b', [user(high)]);
        // `max` rollup on the ranked category: the aggregate takes the higher.
        expect(
            store.getAggregate().assertions.map((a) => a.conceptId),
        ).toContain(high);
    });
});
