/**
 * Seeds and edits under an engine that answers late.
 *
 * A marking commits two layers: the baseline its host was served with, set only
 * by a seed, and the edits users and applications wrote on top. A seed arrives
 * only after every field on the page has initialized, and over a wire an edit
 * can be published before it, while it is on the wire, or after it lands.
 * Whatever the order, the marking has to settle on the served value with the
 * edits on top: never the served value alone, which loses the pick, and never
 * the pick alone, which silently drops the served categories nobody touched.
 *
 * `createLatencyEngineHarness` parks every engine call, so each case decides
 * exactly when each one is answered.
 */

import { describe, it, expect } from 'vitest';
import type { Assertion } from '@ezclassify/types';
import { VanillaEzClassifyStore } from './ezclassify-store';
import { createLatencyEngineHarness } from './latency-engine-harness';
import {
    createEzClassifyFacetBinding,
    publishFacetSelection,
} from '../facet-binding';

const SERVED = 'level:INTERNAL handling:DNF';

function facts(store: VanillaEzClassifyStore, id = 'doc'): string[] {
    return store
        .get(id)
        .assertions.map((a) => `${a.categoryId}:${a.conceptId}`)
        .sort();
}

function assertion(categoryId: string, conceptId: string): Assertion {
    return { categoryId, conceptId } as Assertion;
}

function setup(options?: Parameters<typeof createLatencyEngineHarness>[0]) {
    const harness = createLatencyEngineHarness(options);
    const store = new VanillaEzClassifyStore(harness.engine);
    return { harness, store };
}

/** A scheme with an alternate scope, `authority`, beside the default one. */
function scopedSetup() {
    return setup({
        defaultScope: 'banner',
        scopes: { authority: ['authority'] },
    });
}

/** Answer every call except `held`, until the store stops making new ones. */
async function answerAllBut(
    harness: ReturnType<typeof createLatencyEngineHarness>,
    held: unknown,
): Promise<void> {
    for (let round = 0; round < 8; round++) {
        for (const method of ['process', 'aggregateAssertions'] as const) {
            for (const call of harness.pending(method))
                if (call !== held) call.resolve();
        }
        await harness.flush();
    }
}

describe('a seed and an edit, in any order', () => {
    it('lands an edit committed before the seed on the served value', async () => {
        const { harness, store } = setup();
        const pick = publishFacetSelection(store, 'doc', 'level', ['SECRET']);
        await harness.settleAll();
        await pick;

        const seed = store.seedRendered('doc', SERVED);
        await harness.settleAll();
        await seed;

        expect(facts(store)).toEqual(['handling:DNF', 'level:SECRET']);
    });

    it('lands an edit still on the wire when the seed arrives', async () => {
        const { harness, store } = setup();
        const pick = publishFacetSelection(store, 'doc', 'level', ['SECRET']);
        const seed = store.seedRendered('doc', SERVED);
        await harness.settleAll();
        await Promise.all([pick, seed]);

        expect(facts(store)).toEqual(['handling:DNF', 'level:SECRET']);
    });

    it('lands an edit published while the seed is on the wire on top of it', async () => {
        const { harness, store } = setup();
        const seed = store.seedRendered('doc', SERVED);
        // Composed from what the picker can read now: the unseeded marking.
        const pick = publishFacetSelection(store, 'doc', 'level', ['SECRET']);
        await harness.settleAll();
        await Promise.all([seed, pick]);

        expect(facts(store)).toEqual(['handling:DNF', 'level:SECRET']);
    });

    it('never commits a value missing a served category while the seed is landing', async () => {
        const { harness, store } = setup();
        const committed: string[][] = [];
        store.subscribe('doc', () => committed.push(facts(store)));
        const pick = publishFacetSelection(store, 'doc', 'level', ['SECRET']);
        await harness.flush();
        const seed = store.seedRendered('doc', SERVED);
        await harness.flush();
        // The pick's own answer comes back first.
        harness.pending('process')[0].resolve();
        await harness.settleAll();
        await Promise.all([pick, seed]);

        expect(committed).toEqual([['handling:DNF', 'level:SECRET']]);
    });

    it('lets a typed edit restate the whole default scope over the seed', async () => {
        const { harness, store } = setup();
        const typed = store.publishRendered('doc', 'level:SECRET');
        const seed = store.seedRendered('doc', SERVED);
        await harness.settleAll();
        await Promise.all([typed, seed]);

        expect(facts(store)).toEqual(['level:SECRET']);
    });

    it('keeps a typed edit under an edit made while the seed was on the wire', async () => {
        const { harness, store } = setup();
        const typed = store.publishRendered('doc', 'level:SECRET');
        await harness.flush();
        const seed = store.seedRendered('doc', SERVED);
        const pick = store.publishAssertions('doc', [
            assertion('handling', 'LOCAL'),
        ]);
        await harness.settleAll();
        await Promise.all([typed, seed, pick]);

        expect(facts(store)).toEqual(['handling:LOCAL', 'level:SECRET']);
    });

    it('honors the last keystroke, even a clear, typed while the seed is on the wire', async () => {
        const { harness, store } = setup();
        const seed = store.seedRendered('doc', SERVED);
        const typed = store.publishRendered('doc', 'level:SECRET');
        const cleared = store.publishRendered('doc', '');
        await harness.settleAll();
        await Promise.all([seed, typed, cleared]);

        expect(store.get('doc').rendered).toBe('');
    });

    it('treats a publish that restates what its caller read as no change', async () => {
        const { harness, store } = setup();
        const seed = store.seedRendered('doc', SERVED);
        const pick = publishFacetSelection(store, 'doc', 'level', ['SECRET']);
        // A second view composed from the same unseeded marking, with level
        // as it read it.
        const sibling = store.publishAssertions('doc', []);
        await harness.settleAll();
        await Promise.all([seed, pick, sibling]);

        expect(facts(store)).toEqual(['handling:DNF', 'level:SECRET']);
    });

    it('commits the served value when nothing was edited', async () => {
        const { harness, store } = setup();
        const seed = store.seedRendered('doc', SERVED);
        await harness.settleAll();
        await seed;

        expect(store.get('doc').rendered).toBe(SERVED);
    });

    it('seeds from assertions the host carries the same way', async () => {
        const { harness, store } = setup();
        const pick = publishFacetSelection(store, 'doc', 'level', ['SECRET']);
        const seed = store.seedAssertions('doc', [
            assertion('level', 'INTERNAL'),
            assertion('handling', 'DNF'),
        ]);
        await harness.settleAll();
        await Promise.all([pick, seed]);

        expect(facts(store)).toEqual(['handling:DNF', 'level:SECRET']);
    });

    it('lands only the newest of several edits to one category over a later seed', async () => {
        const { harness, store } = setup();
        for (const level of ['SECRET', 'INTERNAL', 'RESTRICTED']) {
            const pick = publishFacetSelection(store, 'doc', 'level', [level]);
            await harness.settleAll();
            await pick;
        }

        const seed = store.seedRendered('doc', SERVED);
        await harness.settleAll();
        await seed;

        expect(facts(store)).toEqual(['handling:DNF', 'level:RESTRICTED']);
    });

    it('keeps a category the engine inferred out of the edits', async () => {
        const { harness, store } = setup();
        const older = store.publishAssertions('doc', [
            assertion('level', 'RESTRICTED'),
        ]);
        void older;
        const newer = store.publishAssertions('doc', [
            assertion('level', 'SECRET'),
        ]);
        await harness.flush();
        const [olderCall, newerCall] = harness.pending('process');
        // The engine infers a handling caveat for the newer pick.
        newerCall.resolve({
            rendered: 'level:SECRET handling:DNF',
            assessment: {},
            renders: {},
            assertions: [
                assertion('level', 'SECRET'),
                assertion('handling', 'DNF'),
            ],
            valid: true,
            errors: [],
        });
        await newer;
        expect(facts(store)).toEqual(['handling:DNF', 'level:SECRET']);

        const seed = store.seedRendered('doc', 'level:INTERNAL handling:LOCAL');
        await answerAllBut(harness, olderCall);
        await seed;

        expect(facts(store)).toEqual(['handling:LOCAL', 'level:SECRET']);
    });

    it('tells a publishing view the committed value when its edit lands on a seed', async () => {
        const { harness, store } = setup();
        const token = {};
        const told: string[] = [];
        store.subscribe('doc', (state) => told.push(state.rendered), { token });
        const inFlight = store.publishAssertions(
            'doc',
            [assertion('level', 'SECRET')],
            { token },
        );
        const seed = store.seedRendered('doc', SERVED);
        const during = store.publishAssertions(
            'doc',
            [assertion('handling', 'LOCAL')],
            { token },
        );
        await harness.settleAll();
        await Promise.all([inFlight, seed, during]);

        expect(facts(store)).toEqual(['handling:LOCAL', 'level:SECRET']);
        expect(told.at(-1)).toBe(store.get('doc').rendered);
    });
});

describe('seeds of the same marking', () => {
    it('keeps the edits under a later seed', async () => {
        const { harness, store } = setup();
        const first = store.seedRendered('doc', 'level:INTERNAL');
        await harness.settleAll();
        await first;
        const pick = publishFacetSelection(store, 'doc', 'level', ['SECRET']);
        await harness.settleAll();
        await pick;

        const second = store.seedRendered(
            'doc',
            'level:RESTRICTED handling:DNF',
        );
        await harness.settleAll();
        await second;

        expect(facts(store)).toEqual(['handling:DNF', 'level:SECRET']);
    });

    it('takes two seeds in a row, the second as the baseline, and keeps an edit made between them', async () => {
        const { harness, store } = setup();
        const first = store.seedRendered('doc', 'level:INTERNAL');
        const pick = publishFacetSelection(store, 'doc', 'handling', ['DNF']);
        const second = store.seedRendered('doc', 'level:RESTRICTED');
        await harness.settleAll();
        await Promise.all([first, pick, second]);

        expect(facts(store)).toEqual(['handling:DNF', 'level:RESTRICTED']);
    });

    it('takes only the default scope from a rendered baseline', async () => {
        const { harness, store } = scopedSetup();
        const first = store.seedAssertions('doc', [
            assertion('level', 'INTERNAL'),
            assertion('authority', 'DERIVED'),
        ]);
        await harness.settleAll();
        await first;

        const second = store.seedRendered('doc', 'level:SECRET');
        await harness.settleAll();
        await second;

        expect(facts(store)).toEqual(['level:SECRET']);
    });

    it('keeps an alternate-scope edit under a rendered seed', async () => {
        const { harness, store } = scopedSetup();
        const edit = publishFacetSelection(store, 'doc', 'authority', [
            'ORIGINAL',
        ]);
        const seed = store.seedRendered('doc', SERVED);
        await harness.settleAll();
        await Promise.all([edit, seed]);

        expect(facts(store)).toEqual([
            'authority:ORIGINAL',
            'handling:DNF',
            'level:INTERNAL',
        ]);
    });

    it('keeps an alternate-scope edit and a typed edit on the wire under a rendered seed', async () => {
        const { harness, store } = scopedSetup();
        const edit = store.publishAssertions('doc', [
            assertion('authority', 'DERIVED'),
        ]);
        await harness.settleAll();
        await edit;
        const typed = store.publishRendered('doc', 'level:SECRET');
        await harness.flush();
        const seed = store.seedRendered('doc', SERVED);
        await harness.settleAll();
        await Promise.all([typed, seed]);

        expect(facts(store)).toEqual(['authority:DERIVED', 'level:SECRET']);
    });

    it('seeds a part and its whole with an edit to the part between them', async () => {
        const { harness, store } = setup();
        store.setPartOf('part', 'whole');
        await harness.settleAll();
        const part = store.seedRendered('part', 'level:INTERNAL');
        const whole = store.seedRendered('whole', SERVED);
        const pick = publishFacetSelection(store, 'part', 'handling', [
            'LOCAL',
        ]);
        await harness.settleAll();
        await Promise.all([part, whole, pick]);

        expect(facts(store, 'part')).toEqual([
            'handling:LOCAL',
            'level:INTERNAL',
        ]);
    });
    it('keeps an alternate-scope edit when the marking is seeded again with the value it shows', async () => {
        const { harness, store } = scopedSetup();
        const first = store.seedRendered('doc', 'level:INTERNAL');
        await harness.settleAll();
        await first;
        const edit = store.publishAssertions('doc', [
            assertion('level', 'INTERNAL'),
            assertion('authority', 'DERIVED'),
        ]);
        await harness.settleAll();
        await edit;
        const shown = store.get('doc').rendered;

        // A runtime mounted again over the host seeds the value it shows.
        const second = store.seedRendered('doc', shown);
        await harness.settleAll();
        await second;

        expect(facts(store)).toEqual(['authority:DERIVED', 'level:INTERNAL']);
    });

    it('keeps the edits when the marking is seeded again with an empty value', async () => {
        const { harness, store } = setup();
        const first = store.seedRendered('doc', 'level:INTERNAL');
        await harness.settleAll();
        await first;
        const pick = publishFacetSelection(store, 'doc', 'level', ['SECRET']);
        await harness.settleAll();
        await pick;

        const second = store.seedRendered('doc', '');
        await harness.settleAll();
        await second;

        expect(facts(store)).toEqual(['level:SECRET']);
    });
});

describe('releasing a seed', () => {
    it('stops the engine working on a released seed', async () => {
        const { harness, store } = setup();
        void store.seedRendered('doc', SERVED);
        await harness.flush();

        store.releaseSeed('doc');

        expect(harness.pending('process')[0].aborted).toBe(true);
    });

    it('starts over after a release: the next seed carries only a pick made after it', async () => {
        const { harness, store } = setup();
        const first = store.seedRendered('doc', 'level:INTERNAL');
        await harness.settleAll();
        await first;
        const stale = publishFacetSelection(store, 'doc', 'handling', [
            'LOCAL',
        ]);
        await harness.settleAll();
        await stale;
        store.releaseSeed('doc');
        const pick = publishFacetSelection(store, 'doc', 'level', ['SECRET']);
        await harness.settleAll();
        await pick;

        const second = store.seedRendered('doc', SERVED);
        await harness.settleAll();
        await second;

        expect(facts(store)).toEqual(['handling:DNF', 'level:SECRET']);
    });

    it('serves the next page its own value after a release', async () => {
        const { harness, store } = scopedSetup();
        const first = store.seedRendered('doc', 'level:INTERNAL');
        await harness.settleAll();
        await first;
        const edit = store.publishAssertions('doc', [
            assertion('level', 'INTERNAL'),
            assertion('authority', 'DERIVED'),
        ]);
        await harness.settleAll();
        await edit;
        store.releaseSeed('doc');

        const second = store.seedRendered('doc', 'level:SECRET');
        await harness.settleAll();
        await second;

        expect(facts(store)).toEqual(['level:SECRET']);
    });

    it('clears a marking released while its seed is on the wire, and keeps it clear', async () => {
        const { harness, store } = setup();
        const seed = store.seedRendered('doc', SERVED);
        await harness.flush();

        store.releaseSeed('doc');
        await harness.settleAll();
        await seed;

        expect(store.get('doc').rendered).toBe('');
    });

    it('starts the next seed over after a release while the earlier seed was on the wire', async () => {
        const { harness, store } = setup();
        const first = store.seedRendered('doc', 'level:INTERNAL');
        await harness.flush();
        store.releaseSeed('doc');
        await harness.settleAll();
        await first;

        const pick = publishFacetSelection(store, 'doc', 'level', ['SECRET']);
        await harness.settleAll();
        await pick;
        const second = store.seedRendered('doc', SERVED);
        await harness.settleAll();
        await second;

        expect(facts(store)).toEqual(['handling:DNF', 'level:SECRET']);
    });

    it('drops an edit on the wire when its marking is released', async () => {
        const { harness, store } = setup();
        const seed = store.seedRendered('doc', SERVED);
        const pick = publishFacetSelection(store, 'doc', 'level', ['SECRET']);
        await harness.flush();

        store.releaseSeed('doc');
        await harness.settleAll();
        await Promise.all([seed, pick]);

        expect(store.get('doc').rendered).toBe('');
    });
});

describe('a slow, failing or torn-down engine', () => {
    it('keeps the seed and later edits moving when an edit on the wire never answers', async () => {
        const { harness, store } = setup();
        void store.publishRendered('doc', 'level:SECRET');
        await harness.flush();
        const [neverAnswers] = harness.pending('process');

        const seed = store.seedRendered('doc', SERVED);
        const later = store.publishAssertions('doc', [
            assertion('handling', 'LOCAL'),
        ]);
        await answerAllBut(harness, neverAnswers);
        await Promise.all([seed, later]);

        expect(facts(store)).toEqual(['handling:LOCAL', 'level:SECRET']);
    });

    it('keeps the committed value when the served value cannot be read, and lands both layers on the next change', async () => {
        const { harness, store } = setup();
        const first = store.seedRendered('doc', SERVED);
        await harness.settleAll();
        await first;
        const pick = publishFacetSelection(store, 'doc', 'level', ['SECRET']);
        await harness.settleAll();
        await pick;
        const committed: string[][] = [];
        store.subscribe('doc', () => committed.push(facts(store)));

        const reseed = store.seedRendered(
            'doc',
            'level:INTERNAL handling:LOCAL',
        );
        await harness.flush();
        harness.pending('process')[0].reject(new Error('network'));
        await expect(reseed).rejects.toThrow('network');
        await harness.settleAll();
        expect(committed).toEqual([]);
        expect(facts(store)).toEqual(['handling:DNF', 'level:SECRET']);

        const next = store.publishAssertions('doc', [
            ...store.get('doc').assertions,
            assertion('region', 'EAST'),
        ]);
        await harness.settleAll();
        await next;

        expect(facts(store)).toEqual([
            'handling:LOCAL',
            'level:SECRET',
            'region:EAST',
        ]);
    });

    it('keeps a served marking when a seed of it again fails', async () => {
        const { harness, store } = setup();
        const first = store.seedRendered('doc', SERVED);
        await harness.settleAll();
        await first;

        const again = store.seedRendered('doc', SERVED);
        await harness.flush();
        harness.pending('process')[0].reject(new Error('network'));
        await expect(again).rejects.toThrow('network');
        await harness.settleAll();

        expect(store.get('doc').rendered).toBe(SERVED);
    });

    it('lands an edit made after a seed failed, and the next seed under it', async () => {
        const { harness, store } = setup();
        const seed = store.seedRendered('doc', SERVED);
        await harness.flush();
        harness.pending('process')[0].reject();
        await expect(seed).rejects.toThrow();
        await harness.settleAll();
        const pick = publishFacetSelection(store, 'doc', 'level', ['SECRET']);
        await harness.settleAll();
        await pick;

        const retry = store.seedRendered('doc', SERVED);
        await harness.settleAll();
        await retry;

        expect(facts(store)).toEqual(['handling:DNF', 'level:SECRET']);
    });

    it('keeps an edit whose engine call failed for the next composition', async () => {
        const { harness, store } = setup();
        const pick = publishFacetSelection(store, 'doc', 'level', ['SECRET']);
        await harness.flush();
        harness.pending('process')[0].reject();
        await expect(pick).rejects.toThrow();

        const seed = store.seedRendered('doc', SERVED);
        await harness.settleAll();
        await seed;

        expect(facts(store)).toEqual(['handling:DNF', 'level:SECRET']);
    });

    it('settles everything on the wire when the store is destroyed, even if the engine never answers', async () => {
        const { harness, store } = setup();
        const pick = store.publishRendered('doc', 'level:SECRET');
        const seed = store.seedRendered('doc', SERVED);
        const later = publishFacetSelection(store, 'doc', 'handling', [
            'LOCAL',
        ]);
        await harness.flush();

        store.destroy();

        await expect(Promise.all([pick, seed, later])).resolves.toBeDefined();
    });

    it('makes no further engine call for a seed once the store is destroyed', async () => {
        const { harness, store } = setup();
        const pick = publishFacetSelection(store, 'doc', 'level', ['SECRET']);
        await harness.settleAll();
        await pick;
        const seed = store.seedRendered('doc', SERVED);
        await harness.flush();
        const issued = harness.issued('process');

        store.destroy();
        harness.pending('process')[0]?.resolve();
        await seed;

        expect(harness.issued('process')).toBe(issued);
    });
});

describe('facets and repairs', () => {
    it('computes a facet first subscribed while a seed that fails is on the wire', async () => {
        const { harness, store } = setup();
        const seed = store.seedRendered('doc', SERVED);
        await harness.flush();
        const binding = createEzClassifyFacetBinding(store, 'doc', 'level', {
            token: {},
        });
        const stop = binding.subscribe(() => {});
        await harness.flush();

        harness.pending('process')[0].reject(new Error('network'));
        await expect(seed).rejects.toThrow('network');
        await harness.settleAll();

        await expect(binding.ready).resolves.toBeUndefined();
        expect(store.getFacet('doc', 'level').allowableOptions).not.toBeNull();
        stop();
        binding.destroy();
    });

    it('computes a facet first subscribed while an edit that fails is on the wire', async () => {
        const { harness, store } = setup();
        const typed = store.publishRendered('doc', 'level:SECRET');
        await harness.flush();
        const binding = createEzClassifyFacetBinding(store, 'doc', 'level', {
            token: {},
        });
        const stop = binding.subscribe(() => {});
        await harness.flush();

        harness.pending('process')[0].reject(new Error('network'));
        await expect(typed).rejects.toThrow('network');
        await harness.settleAll();

        await expect(binding.ready).resolves.toBeUndefined();
        expect(store.getFacet('doc', 'level').allowableOptions).not.toBeNull();
        stop();
        binding.destroy();
    });

    it('keeps a repair the engine made to an edit', async () => {
        const { harness, store } = setup();
        const first = store.publishAssertions('doc', [
            assertion('level', 'INTERNAL'),
            assertion('handling', 'DNF'),
        ]);
        await harness.flush();
        // The rules do not allow the handling caveat with this level, so the
        // engine drops it.
        harness.pending('process')[0].resolve({
            rendered: 'level:INTERNAL',
            assessment: {},
            renders: {},
            assertions: [assertion('level', 'INTERNAL')],
            valid: true,
            errors: [],
        });
        await first;
        await harness.settleAll();

        const pick = publishFacetSelection(store, 'doc', 'level', ['SECRET']);
        await harness.flush();
        const sent = (harness.pending('process')[0].args[0] as Assertion[]).map(
            (a) => `${a.categoryId}:${a.conceptId}`,
        );
        await harness.settleAll();
        await pick;

        expect(sent).toEqual(['level:SECRET']);
        expect(facts(store)).toEqual(['level:SECRET']);
    });

    it('keeps an alternate-scope edit as written when the engine fills defaults', async () => {
        const { harness, store } = scopedSetup();
        // Answer the way an engine does when no surface is named: it fills the
        // default of every category the input left out, the alternate-scope
        // one the store never sends included.
        async function answer(): Promise<void> {
            for (let round = 0; round < 6; round++) {
                for (const call of harness.pending('process')) {
                    const sent = (
                        Array.isArray(call.args[0]) ? call.args[0] : []
                    ) as Assertion[];
                    const out = sent.some((a) => a.categoryId === 'authority')
                        ? sent
                        : [...sent, assertion('authority', 'DEFAULT')];
                    call.resolve({
                        rendered: '',
                        assessment: {},
                        renders: {},
                        assertions: out,
                        valid: true,
                        errors: [],
                    });
                }
                for (const call of harness.pending('aggregateAssertions'))
                    call.resolve();
                await harness.flush();
            }
        }
        const edit = publishFacetSelection(store, 'doc', 'authority', [
            'MANUAL',
        ]);
        await answer();
        await edit;

        const counts: number[] = [];
        for (const level of ['SECRET', 'INTERNAL', 'SECRET']) {
            const pick = publishFacetSelection(store, 'doc', 'level', [level]);
            await answer();
            await pick;
            counts.push(
                store
                    .get('doc')
                    .assertions.filter((a) => a.categoryId === 'authority')
                    .length,
            );
        }

        expect(counts).toEqual([counts[0], counts[0], counts[0]]);
    });

    it('lets a picker put back the value it shows while its own pick is on the wire', async () => {
        const { harness, store } = setup();
        const seed = store.seedRendered('doc', SERVED);
        await harness.settleAll();
        await seed;
        const binding = createEzClassifyFacetBinding(store, 'doc', 'level', {
            token: {},
        });

        const pick = binding.setSelected(['SECRET']);
        // The picker still shows the committed level, and the user picks it
        // again before the first pick has answered.
        const back = binding.setSelected(['INTERNAL']);
        await harness.settleAll();
        await Promise.all([pick, back]);

        expect(facts(store)).toEqual(['handling:DNF', 'level:INTERNAL']);
        binding.destroy();
    });

    it('reads a marking again under its new role when it becomes a part while a read is on the wire', async () => {
        const { harness, store } = setup();
        const seed = store.seedRendered('part', 'level:INTERNAL');
        await harness.flush();
        const [underOldRole] = harness.pending('process');

        store.setPartOf('part', 'whole');
        await harness.flush();
        // The read taken before the marking was a part answers first.
        underOldRole.resolve();
        await harness.flush();
        const pick = publishFacetSelection(store, 'part', 'handling', [
            'LOCAL',
        ]);
        await harness.flush();

        // Nothing taken under the old role was kept, so the pick reads the
        // served text again, as a part.
        const latest = harness.pending('process').at(-1)!;
        expect(typeof latest.args[0]).toBe('string');
        expect(
            (latest.args[1] as { context?: { role?: string } }).context?.role,
        ).toBe('part');
        await harness.settleAll();
        await Promise.all([seed, pick]);
    });

    it('treats an empty category list like leaving the option out', async () => {
        const { harness, store } = setup();
        const seed = store.seedRendered('doc', SERVED);
        await harness.settleAll();
        await seed;

        const edit = store.publishAssertions(
            'doc',
            [assertion('level', 'SECRET'), assertion('handling', 'DNF')],
            undefined,
            { categories: [] },
        );
        await harness.settleAll();
        await edit;

        expect(facts(store)).toEqual(['handling:DNF', 'level:SECRET']);
    });
});
