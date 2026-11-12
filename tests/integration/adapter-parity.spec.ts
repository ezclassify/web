/**
 * Contract-parity suite: a local Context's scheme operations vs a REST
 * client's.
 *
 * The two adapters are meant to be interchangeable behind one interface. Every
 * UI surface in this repo, the store, the forms controller, and all three
 * framework bindings, is written against the Context-bound scheme adapter and
 * is supposed to behave the same whether the host composed a local Context or
 * pointed the same code at a REST deployment. A fetch mock cannot catch a wrong
 * assumption about the wire, because the mock is written from the same
 * assumption, so each adapter tested only against itself proves nothing about
 * parity.
 *
 * So this suite runs one operation set against BOTH adapters and requires the
 * same answer: `Context.fromComponents({ scheme }).scheme` on one side and
 * `EzClassifyClient.scheme` on the other, with the client driven over real HTTP
 * against a real `@ezclassify/rest-api` (see `rest-api-server.ts`). Every
 * operation covered here is one the store, the forms controller, or a framework
 * binding actually calls.
 *
 * Comparisons use `toEqual`, which ignores keys whose value is `undefined`: a
 * projection that sets a key to `undefined` and one that omits it are the same
 * thing to a caller. A key that is _populated_ on one side and missing on the
 * other is a failure.
 *
 * Where the adapters differ, the difference has its own test in the `documented
 * asymmetries` block below, observed against the running server. When such a
 * gap closes, its pin fails and the operation moves into the parity table.
 */
import { describe, it, expect, beforeAll, afterAll, inject } from 'vitest';
import { Context } from '@ezclassify/engine';
import type {
    Assertion,
    LocalContextSchemeEngineAdapter,
    RemoteContextSchemeEngineAdapter,
} from '@ezclassify/types';
import { connectContext, type EzClassifyClient } from '@ezclassify/rest-client';
import { PARITY_SCHEME_IDS, paritySchemeJson } from './rest-api-server';

/** Either side of the comparison, under its own Context-bound contract. */
type ContextSchemeAdapter =
    LocalContextSchemeEngineAdapter | RemoteContextSchemeEngineAdapter;

/** Connect a client to one parity Context. */
function connectClient(
    contextId: string,
    contextToken: string,
): Promise<EzClassifyClient> {
    return connectContext({
        baseUrl: inject('restApiBaseUrl'),
        contextId,
        contextVersion: '1.0.0',
        contextToken,
        applicationId: 'web-parity',
        headers: inject('restApiCallerHeaders'),
    });
}

/**
 * One operation, run identically against both adapters. `run` receives the
 * adapter under the shared interface, never a concrete class, so a test can
 * only use surface both are contractually required to have.
 */
interface ParityOperation {
    name: string;
    run(
        adapter: ContextSchemeAdapter,
        fixture: SchemeFixture,
    ): unknown | Promise<unknown>;
}

/**
 * Scheme-derived operands, so one operation table runs against every example
 * scheme instead of hard-coding concept ids per scheme.
 */
interface SchemeFixture {
    schemeId: string;
    /** All category ids, in declaration order. */
    categoryIds: string[];
    /** Two concept ids in the first category, lowest and highest rank. */
    lowConceptId: string;
    highConceptId: string;
    /** The first category's id. */
    primaryCategoryId: string;
    /** Every render-format id the scheme declares. */
    formatIds: string[];
    /** A concept with a capture-value input, when the scheme has one. */
    captureConcept?: { conceptId: string; categoryId: string };
}

const user = (
    conceptId: string,
    categoryId: string,
    value?: string,
): Assertion =>
    ({
        conceptId,
        categoryId,
        confidence: 'certain',
        source: 'user',
        ...(value === undefined ? {} : { value }),
    }) as Assertion;

/** Build the operand fixture by reading the scheme through the local adapter. */
function buildFixture(
    engine: LocalContextSchemeEngineAdapter,
    schemeId: string,
): SchemeFixture {
    const categories = engine.listCategories();
    const primary = categories[0]!;
    const concepts = engine.getConceptsInCategory(primary.id);
    const ranked = [...concepts].sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0));
    let captureConcept: SchemeFixture['captureConcept'];
    for (const category of categories) {
        const withInput = engine
            .getConceptsInCategory(category.id)
            .find((c) => c.textInput !== undefined);
        if (withInput) {
            captureConcept = {
                conceptId: withInput.id,
                categoryId: category.id,
            };
            break;
        }
    }

    return {
        schemeId,
        categoryIds: categories.map((c) => c.id),
        lowConceptId: ranked[0]!.id,
        highConceptId: ranked[ranked.length - 1]!.id,
        primaryCategoryId: primary.id,
        formatIds: (engine.getSchemeMeta().formats ?? []).map((f) => f.id),
        captureConcept,
    };
}

/**
 * Sort concept-view arrays by id so content parity is testable independently of
 * order.
 */
const byId = <T extends { id: string }>(views: T[]): T[] =>
    [...views].sort((a, b) => a.id.localeCompare(b.id));

/**
 * The operation set. Every entry is a call the store, the forms controller, or
 * a framework binding makes against the Context-bound scheme adapter.
 */
const PARITY_OPERATIONS: ParityOperation[] = [
    // ── Profile reads ────────────────────────────────────────────────────────
    {
        name: 'connected',
        run: (a) => a.connected,
    },
    {
        name: 'getScheme()',
        run: (a) => a.getScheme(),
    },
    {
        name: 'getSchemeMeta()',
        run: (a) => a.getSchemeMeta(),
    },
    {
        name: 'listCategories()',
        run: (a) => a.listCategories(),
    },
    {
        name: 'getConceptsInCategory() content, every category',
        run: (a, f) =>
            f.categoryIds.map((id) => byId(a.getConceptsInCategory(id))),
    },
    {
        name: 'getConceptsInCategory() order, every category',
        run: (a, f) =>
            f.categoryIds.map((id) =>
                a.getConceptsInCategory(id).map((c) => c.id),
            ),
    },

    // ── process: the store's write path ──────────────────────────────────────
    {
        name: 'process(markingString)',
        run: (a, f) => a.process(f.highConceptId),
    },
    {
        // `BaseEzClassifyStore.publishAssertions` calls exactly this.
        name: 'process(Assertion[])',
        run: (a, f) => a.process([user(f.highConceptId, f.primaryCategoryId)]),
    },
    {
        // Clearing the last facet selection publishes an empty array.
        name: 'process([])',
        run: (a) => a.process([]),
    },
    {
        name: 'process("", { assertions })',
        run: (a, f) =>
            a.process('', {
                assertions: [user(f.highConceptId, f.primaryCategoryId)],
            }),
    },
    {
        name: 'process(Assertion[]) with a capture value',
        run: (a, f) =>
            f.captureConcept
                ? a.process([
                      user(f.lowConceptId, f.primaryCategoryId),
                      user(
                          f.captureConcept.conceptId,
                          f.captureConcept.categoryId,
                          'Ruiz, M.',
                      ),
                  ])
                : null,
    },
    {
        name: 'process(markingString, { outputFormat }) for every format',
        run: async (a, f) => {
            const out = [];
            for (const format of f.formatIds) {
                out.push(
                    await a.process(f.highConceptId, { outputFormat: format }),
                );
            }
            return out;
        },
    },
    {
        name: 'process(unparseable input)',
        run: (a) => a.process('NOT_A_MARKING_IN_ANY_SCHEME'),
    },

    // ── render ───────────────────────────────────────────────────────────────
    {
        name: 'render(assertions) for every format',
        run: async (a, f) => {
            const out = [];
            for (const format of f.formatIds) {
                out.push(
                    await a.render(
                        [user(f.highConceptId, f.primaryCategoryId)],
                        format,
                    ),
                );
            }
            return out;
        },
    },

    // ── suggest: the facet subscription path ─────────────────────────────────
    {
        name: 'suggest("")',
        run: (a) => a.suggest(''),
    },
    {
        // `subscribeFacet` computes allowable options by calling suggest with
        // the committed assertion array.
        name: 'suggest(Assertion[])',
        run: (a, f) => a.suggest([user(f.highConceptId, f.primaryCategoryId)]),
    },
    {
        name: 'suggest(Assertion[], { surface })',
        run: (a, f) => {
            const scopes = a.getSchemeMeta().scopes ?? [];
            if (scopes.length === 0) return null;
            return a.suggest([user(f.highConceptId, f.primaryCategoryId)], {
                surface: scopes[scopes.length - 1]!.id,
            });
        },
    },

    // ── rollup ───────────────────────────────────────────────────────────────
    {
        name: 'aggregate(markingStrings)',
        run: (a, f) => a.aggregate([f.lowConceptId, f.highConceptId]),
    },
    {
        name: 'aggregateAssertions(assertionSets)',
        run: (a, f) =>
            a.aggregateAssertions([
                [user(f.lowConceptId, f.primaryCategoryId)],
                [user(f.highConceptId, f.primaryCategoryId)],
                [],
            ]),
    },
    {
        name: 'checkCoverage(covered)',
        run: (a, f) => a.checkCoverage([f.lowConceptId], f.highConceptId),
    },
    {
        name: 'checkCoverage(uncovered)',
        run: (a, f) => a.checkCoverage([f.highConceptId], f.lowConceptId),
    },

    // ── the rest of the surface the UI reads ─────────────────────────────────
    {
        name: 'collectNotices(assertions)',
        run: (a, f) =>
            a.collectNotices([user(f.highConceptId, f.primaryCategoryId)]),
    },
    {
        name: 'scan(documentText)',
        run: (a, f) =>
            a.scan(
                `Question 1 is ${f.lowConceptId} and question 2 is ${f.highConceptId}.`,
            ),
    },
    {
        name: 'describeConcept(conceptId, categoryId)',
        run: (a, f) => a.describeConcept(f.highConceptId, f.primaryCategoryId),
    },
];

describe.each(PARITY_SCHEME_IDS)('adapter parity: %s', (schemeId) => {
    let context: Context;
    let local: LocalContextSchemeEngineAdapter;
    let client: EzClassifyClient;
    let remote: RemoteContextSchemeEngineAdapter;
    let fixture: SchemeFixture;

    beforeAll(async () => {
        // The server composed its Context from the identical document at
        // startup, so any difference below is the adapter, not the input.
        context = Context.fromComponents({
            scheme: paritySchemeJson(schemeId),
        });
        local = context.scheme;
        client = await connectClient(
            schemeId,
            inject('restApiContextTokens')[schemeId]!,
        );
        remote = client.scheme;

        fixture = buildFixture(local, schemeId);
    });

    afterAll(() => {
        client?.destroy();
        context?.destroy();
    });

    it.each(PARITY_OPERATIONS.map((op) => [op.name, op] as const))(
        '%s answers the same on both adapters',
        async (_name, op) => {
            const localResult = await op.run(local, fixture);
            const remoteResult = await op.run(remote, fixture);
            expect(remoteResult).toEqual(localResult);
        },
    );

    it('process(Assertion[], { assertions }) settles both lists as one marking on both adapters', async () => {
        // Facts handed in as the input and facts already chosen in
        // options.assertions describe one marking: the input's facts first,
        // then each chosen fact the input does not already state. So the call
        // answers exactly what the joined list answers, on either adapter.
        const handed = [user(fixture.highConceptId, fixture.primaryCategoryId)];
        const chosen = [user(fixture.lowConceptId, fixture.primaryCategoryId)];
        const settle = async (a: ContextSchemeAdapter) => ({
            both: await a.process(handed, { assertions: chosen }),
            joined: await a.process([...handed, ...chosen]),
        });
        const l = await settle(local);
        const c = await settle(remote);

        expect(l.both).toEqual(l.joined);
        expect(c.both).toEqual(c.joined);
        expect(c.both).toEqual(l.both);
        // The chosen fact changes the answer, so an adapter that drops
        // options.assertions cannot pass the comparisons above.
        expect(l.both).not.toEqual(await local.process(handed));
    });

    describe('documented asymmetries', () => {
        it('getFormatCoverage() is local-only', () => {
            // Optional on the remote Context contract, and the client does not
            // implement it: the REST contract has no format-coverage route. A
            // UI that needs to know whether a format is lossless has no answer
            // over REST, so it must treat `undefined` as "unknown" rather than
            // "lossy".
            expect(local.getFormatCoverage).toBeTypeOf('function');
            expect(remote.getFormatCoverage).toBeUndefined();
        });

        it('applyPreset() refuses an unknown preset on both adapters, one synchronously', async () => {
            // Both refuse and both name the preset; only the shape differs.
            // The local adapter throws synchronously while the remote one
            // returns a rejected promise, which is the practical consequence of
            // the `MaybePromise` return type: a caller must wrap the call
            // itself, not just await it, or the local path escapes the handler.
            const refusal = async (a: ContextSchemeAdapter) => {
                try {
                    await Promise.resolve(a.applyPreset('no-such-preset'));
                    return null;
                } catch (err) {
                    return (err as Error).message;
                }
            };
            expect(await refusal(local)).toMatch(/no-such-preset/);
            expect(await refusal(remote)).toMatch(/no-such-preset/);
            expect(() => local.applyPreset('no-such-preset')).toThrow();
            const pending = remote.applyPreset('no-such-preset');
            expect(pending).toBeInstanceOf(Promise);
            await expect(pending).rejects.toThrow();
        });

        it('a remote client refuses a Context its token does not name', async () => {
            // A local Context is composed from its documents and has nothing
            // to select. A remote client binds to the Context it names at
            // connect, and the server answers a Context the presented token
            // does not authorize as not found, so the bound client keeps
            // serving its own. An authentication failure would be a 401.
            await expect(
                connectClient(
                    'no-such-context',
                    inject('restApiContextTokens')[schemeId]!,
                ),
            ).rejects.toThrow(/API error 404 /);
            expect(remote.getScheme().id).toBe(schemeId);
        });
    });
});
