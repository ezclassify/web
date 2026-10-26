/**
 * Contract-parity suite: `LocalSchemeEngineAdapter` vs `EzClassifyClient`.
 *
 * The two adapters are meant to be interchangeable behind one interface. Every
 * UI surface in this repo, the store, the forms controller, and all three
 * framework bindings, is written against `SchemeEngineAdapter` and is supposed
 * to behave the same whether the host wired up a local engine or pointed the
 * same code at a REST deployment. A fetch mock cannot catch a wrong assumption
 * about the wire, because the mock is written from the same assumption, so each
 * adapter tested only against itself proves nothing about parity.
 *
 * So this suite runs one operation set against BOTH adapters and requires the
 * same answer, with the client driven over real HTTP against a real
 * `@ezclassify/rest-api` (see `rest-api-server.ts`). Every operation covered
 * here is one the store, the forms controller, or a framework binding actually
 * calls.
 *
 * Comparisons use `toEqual`, which ignores keys whose value is `undefined`: a
 * projection that sets a key to `undefined` and one that omits it are the same
 * thing to a caller. A key that is _populated_ on one side and missing on the
 * other is a failure.
 *
 * Where the adapters differ, the difference has its own test in the `documented
 * asymmetries` block below. Some are the contract's own: a Context-bound client
 * has no scheme selection, for one. The rest pin current behavior and name what
 * has to change to remove it; when such a gap closes, its pin fails and the
 * operation moves into the parity table.
 */
import { describe, it, expect, beforeAll, afterAll, inject } from 'vitest';
import { createLocalEngine } from '@ezclassify/engine';
import type {
    Assertion,
    LocalSchemeEngineAdapter,
    SchemeEngineAdapter,
    RemoteContextSchemeEngineAdapter,
} from '@ezclassify/types';
import { EzClassifyClient } from '@ezclassify/rest-client';
import { PARITY_SCHEME_IDS, paritySchemeJson } from './rest-api-server';

/**
 * One operation, run identically against both adapters. `run` receives the
 * adapter under the shared interface, never a concrete class, so a test can
 * only use surface both are contractually required to have.
 */
interface ParityOperation {
    name: string;
    run(
        adapter: SchemeEngineAdapter | RemoteContextSchemeEngineAdapter,
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
    engine: LocalSchemeEngineAdapter,
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
 * a framework binding makes against `SchemeEngineAdapter`.
 */
const PARITY_OPERATIONS: ParityOperation[] = [
    // ── Profile reads ────────────────────────────────────────────────────────
    {
        name: 'connected',
        run: (a) => a.connected,
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
    {
        name: 'getConceptsInCategory({ nested: true }) content',
        run: (a, f) =>
            f.categoryIds.map((id) => {
                const nested = a.getConceptsInCategory(id, { nested: true });
                return byId(
                    nested.map((n) => ('concept' in n ? n.concept : n)),
                ).map((c) => c.id);
            }),
    },
    {
        name: 'uncoveredAssertions()',
        run: (a, f) =>
            a.uncoveredAssertions(
                [user(f.highConceptId, f.primaryCategoryId)],
                [user(f.lowConceptId, f.primaryCategoryId)],
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
    let local: LocalSchemeEngineAdapter;
    let client: EzClassifyClient;
    let fixture: SchemeFixture;

    beforeAll(async () => {
        local = createLocalEngine();
        await local.loadScheme(JSON.parse(paritySchemeJson(schemeId)));

        // The server loaded the identical document at startup, so any
        // difference below is the adapter, not the input.
        client = await EzClassifyClient.connect(inject('restApiBaseUrl'), {
            contextId: schemeId,
            contextVersion: '1.0.0',
            contextToken: inject('restApiContextTokens')[schemeId],
        });

        fixture = buildFixture(local, schemeId);
    });

    afterAll(() => {
        client?.destroy();
        local?.destroy();
    });

    it.each(PARITY_OPERATIONS.map((op) => [op.name, op] as const))(
        '%s answers the same on both adapters',
        async (_name, op) => {
            const localResult = await op.run(local, fixture);
            const clientResult = await op.run(client, fixture);
            expect(clientResult).toEqual(localResult);
        },
    );

    it('process(Assertion[], { assertions }) settles both lists as one marking on both adapters', async () => {
        // Facts handed in as the input and facts already chosen in
        // options.assertions describe one marking: the input's facts first,
        // then each chosen fact the input does not already state. So the call
        // answers exactly what the joined list answers, on either adapter.
        const handed = [user(fixture.highConceptId, fixture.primaryCategoryId)];
        const chosen = [user(fixture.lowConceptId, fixture.primaryCategoryId)];
        const settle = async (
            a: LocalSchemeEngineAdapter | EzClassifyClient,
        ) => ({
            both: await a.process(handed, { assertions: chosen }),
            joined: await a.process([...handed, ...chosen]),
        });
        const l = await settle(local);
        const c = await settle(client);

        expect(l.both).toEqual(l.joined);
        expect(c.both).toEqual(c.joined);
        expect(c.both).toEqual(l.both);
        // The chosen fact changes the answer, so an adapter that drops
        // options.assertions cannot pass the comparisons above.
        expect(l.both).not.toEqual(await local.process(handed));
    });

    describe('documented asymmetries', () => {
        it('getScheme() agrees on the public view, and only the local adapter adds internal scheme fields', () => {
            // The contract types getScheme() as SchemePublicView. The client
            // returns exactly that; SchemeEngine returns its internal Scheme,
            // a superset whose concepts are raw Concepts rather than
            // ConceptViews. Narrowing SchemeEngine.getScheme() is a core-side
            // change: pin the fields both are required to agree on.
            const l = local.getScheme() as unknown as Record<string, unknown>;
            const c = client.getScheme() as unknown as Record<string, unknown>;
            for (const field of [
                'id',
                'version',
                'name',
                'description',
                'mode',
                'colorFrom',
                'defaultScope',
                'roleAware',
                'definition',
                'guidance',
            ]) {
                expect(c[field], field).toEqual(l[field]);
            }
            expect(
                (c['concepts'] as Array<{ id: string }>).map((x) => x.id),
            ).toEqual(
                (l['concepts'] as Array<{ id: string }>).map((x) => x.id),
            );
            expect(
                (c['categories'] as Array<{ id: string }>).map((x) => x.id),
            ).toEqual(
                (l['categories'] as Array<{ id: string }>).map((x) => x.id),
            );
        });

        it('scheme selection is local-only: a Context-bound client serves the one scheme its Context names', () => {
            // RemoteContextSchemeEngineAdapter omits listSchemes() and
            // getDefaultScheme(): the Context chosen at connect owns the
            // composition, so there is nothing to list or select. What the
            // local adapter reports as its default is the scheme the client
            // serves.
            const listed = local.listSchemes?.() ?? [];
            expect(listed.map((s) => s.id)).toEqual([schemeId]);
            expect(local.getDefaultScheme?.()?.id).toBe(schemeId);
            const bound = client as unknown as Record<string, unknown>;
            expect(bound['listSchemes']).toBeUndefined();
            expect(bound['getDefaultScheme']).toBeUndefined();
            const served = client.getScheme();
            const fallback = local.getDefaultScheme?.();
            expect({
                id: served.id,
                version: served.version,
                name: served.name,
                description: served.description,
            }).toEqual({
                id: fallback?.id,
                version: fallback?.version,
                name: fallback?.name,
                description: fallback?.description,
            });
        });

        it('getFormatCoverage() is local-only', () => {
            // Declared optional on SchemeEngineAdapter: remote support waits on
            // the wire workstream. A UI that needs to know whether a format is
            // lossless has no answer over REST, so it must treat `undefined` as
            // "unknown" rather than "lossy".
            expect(local.getFormatCoverage).toBeTypeOf('function');
            expect(
                (client as unknown as SchemeEngineAdapter).getFormatCoverage,
            ).toBeUndefined();
        });

        it('neither scheme adapter offers an access check at all', () => {
            // Access checks belong to AccessEngine.check and Context.checkContextAccess.
            // Neither scheme adapter exposes checkAccess.
            expect(
                (local as unknown as Record<string, unknown>).checkAccess,
            ).toBeUndefined();
            expect(
                (client as unknown as Record<string, unknown>).checkAccess,
            ).toBeUndefined();
        });

        it('applyPreset() refuses an unknown preset on both adapters, one synchronously', async () => {
            // Both refuse and both name the preset; only the shape differs.
            // The local adapter throws synchronously while the remote one
            // returns a rejected promise, which is the practical consequence of
            // the `MaybePromise` return type: a caller must wrap the call
            // itself, not just await it, or the local path escapes the handler.
            const refusal = async (
                a: SchemeEngineAdapter | RemoteContextSchemeEngineAdapter,
            ) => {
                try {
                    await Promise.resolve(a.applyPreset('no-such-preset'));
                    return null;
                } catch (err) {
                    return (err as Error).message;
                }
            };
            expect(await refusal(local)).toMatch(/no-such-preset/);
            expect(await refusal(client)).toMatch(/no-such-preset/);
            expect(() => local.applyPreset('no-such-preset')).toThrow();
            const remote = client.applyPreset('no-such-preset');
            expect(remote).toBeInstanceOf(Promise);
            await expect(remote).rejects.toThrow();
        });

        it('refuses an unknown local scheme or a remote Context outside its token', async () => {
            expect(() => local.getScheme('no-such-scheme')).toThrow();
            // A remote client is Context-bound: getScheme() accepts no id.
            // Exercise the unsupported selection through its connection API.
            await expect(
                EzClassifyClient.connect(inject('restApiBaseUrl'), {
                    contextId: 'no-such-context',
                    contextVersion: '1.0.0',
                    contextToken: inject('restApiContextTokens')[schemeId],
                }),
            ).rejects.toThrow();
            expect(client.getScheme().id).toBe(schemeId);
        });
    });
});
