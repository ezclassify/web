/**
 * The Context-bound scheme adapter the UI is written against, as the REST
 * client provides it over the demo runtime.
 *
 * Every UI surface in this repository (the store, the forms controller and the
 * three framework bindings) calls the Context-bound scheme adapter and nothing
 * else. This suite runs each operation those surfaces call through
 * `EzClassifyClient.scheme`, against the runtime the website Playground uses,
 * and holds the answers to what the UI depends on: a selection renders and
 * parses back, the empty marking is empty, the input and chosen facts settle as
 * one marking, every format renders, and the profile carries the optional
 * fields a scheme declares. Whether the wire answers what an in-process engine
 * would is the engine's own parity suite; this one is about the client. The one
 * answer the client derives without a request, format coverage, is checked
 * against the engine's recorded answers in the format-coverage conformance
 * plan.
 *
 * The answers come from the spec file's recordings in the public lane and from
 * a local demo runtime in record mode (`test-support/demo-runtime.ts`).
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import yaml from 'js-yaml';
import type {
    Assertion,
    FormatCoverage,
    RemoteContextSchemeEngineAdapter,
    SchemePublicView,
} from '@ezclassify/types';
import type { EzClassifyClient } from '@ezclassify/rest-client';
import {
    connectDemoContext,
    type DemoContextTarget,
} from '../../test-support/demo-runtime';
import multiScopeSource from '../../libs/ui/test-fixtures/multi-scope-regression.yaml?raw';

/**
 * What the annotated fixture adds to the multi-scope fixture. No built-in demo
 * scheme declares a definition, guidance and role-aware processing together, so
 * without this one the suite could not tell a wire that carries those optional
 * summary fields from one that drops them.
 */
const ANNOTATIONS = {
    definition: 'A district file marking, written once per file.',
    guidance: 'Mark the whole file first, then each part that differs.',
    role_aware: true,
} as const;

/** The multi-scope fixture with {@link ANNOTATIONS} on its scheme. */
function annotatedDraft(): DemoContextTarget {
    const document = yaml.load(multiScopeSource) as {
        scheme: Record<string, unknown>;
    };
    return {
        draft: {
            scheme: {
                ...document,
                scheme: { ...document.scheme, ...ANNOTATIONS },
            },
        },
    };
}

/** What a Context's scheme is known to declare, beyond what every one has. */
interface ContextTraits {
    /** Whether the scheme declares an embedded marking that scans read. */
    readsPartMarks: boolean;
}

/**
 * The built-in Contexts the operations run against, by name. Built in, so the
 * Playground serves the same documents and anyone can re-record them.
 */
const CONTEXTS: Array<[string, () => DemoContextTarget, ContextTraits]> = [
    // Single category, ranked concepts, three render formats.
    [
        'cedar-valley-protection',
        () => ({
            contextId: 'cedar-valley-protection',
            contextVersion: '1.0.0',
        }),
        { readsPartMarks: false },
    ],
    // Two categories, so category ordering and multi-category rollup are live.
    [
        'cedar-valley-handling',
        () => ({ contextId: 'cedar-valley-handling', contextVersion: '1.0.0' }),
        { readsPartMarks: false },
    ],
    // Scoped and context-aware, with thirteen categories and rules: the shape
    // that exercises scope resolution and whole and part render formats.
    [
        'cedar-valley',
        () => ({ contextId: 'cedar-valley', contextVersion: '1.0.0' }),
        // It declares an embedded marking, so document text carries part marks.
        { readsPartMarks: true },
    ],
];

/**
 * Scheme-derived operands, so one set of checks runs against every Context
 * instead of hard-coding concept ids per scheme.
 */
interface SchemeFixture {
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

/** Build the operands by reading the scheme through the adapter itself. */
function buildFixture(scheme: RemoteContextSchemeEngineAdapter): SchemeFixture {
    const categories = scheme.listCategories();
    const primary = categories[0]!;
    const ranked = [...scheme.getConceptsInCategory(primary.id)].sort(
        (a, b) => (a.rank ?? 0) - (b.rank ?? 0),
    );
    let captureConcept: SchemeFixture['captureConcept'];
    for (const category of categories) {
        const withInput = scheme
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
        lowConceptId: ranked[0]!.id,
        highConceptId: ranked[ranked.length - 1]!.id,
        primaryCategoryId: primary.id,
        formatIds: (scheme.getSchemeMeta().formats ?? []).map((f) => f.id),
        captureConcept,
    };
}

const conceptIds = (result: { assertions: Assertion[] }): string[] =>
    result.assertions.map((a) => a.conceptId);

describe.each(CONTEXTS)(
    'the scheme adapter over REST: %s',
    (_name, target, traits) => {
        let client: EzClassifyClient;
        let scheme: RemoteContextSchemeEngineAdapter;
        let f: SchemeFixture;
        let high: Assertion[];

        beforeAll(async () => {
            client = await connectDemoContext(target());
            scheme = client.scheme;
            f = buildFixture(scheme);
            high = [user(f.highConceptId, f.primaryCategoryId)];
        });

        afterAll(() => client?.destroy());

        describe('profile reads', () => {
            it('is connected and answers its reads synchronously', () => {
                expect(scheme.connected).toBe(true);
                expect(scheme.getScheme().id).toBeTruthy();
                expect(scheme.getSchemeMeta().id).toBe(scheme.getScheme().id);
            });

            it('lists every category with its concepts, in a stable order', () => {
                for (const category of scheme.listCategories()) {
                    const concepts = scheme.getConceptsInCategory(category.id);
                    expect(concepts.length).toBeGreaterThan(0);
                    expect(scheme.getConceptsInCategory(category.id)).toEqual(
                        concepts,
                    );
                }
            });
        });

        describe('process: the store write path', () => {
            it('renders a selection, and the rendering parses back to it', async () => {
                const chosen = await scheme.process(high);
                expect(conceptIds(chosen)).toContain(f.highConceptId);
                expect(chosen.rendered).not.toBe('');
                const parsed = await scheme.process(chosen.rendered);
                expect(conceptIds(parsed)).toContain(f.highConceptId);
            });

            it('process([]) is the empty marking, which clearing a facet publishes', async () => {
                const empty = await scheme.process([]);
                expect(empty.assertions).toEqual([]);
                expect(empty.rendered).toBe('');
            });

            it('process("", { assertions }) answers what the assertions answer', async () => {
                expect(await scheme.process('', { assertions: high })).toEqual(
                    await scheme.process(high),
                );
            });

            it('settles input and chosen facts as one marking', async () => {
                // Facts handed in as the input and facts already chosen in
                // options.assertions describe one marking: the input's facts first,
                // then each chosen fact the input does not already state.
                const chosen = [user(f.lowConceptId, f.primaryCategoryId)];
                const both = await scheme.process(high, { assertions: chosen });
                expect(both).toEqual(
                    await scheme.process([...high, ...chosen]),
                );
                // The chosen fact changes the answer, so a client that dropped
                // options.assertions could not pass the comparison above.
                expect(both).not.toEqual(await scheme.process(high));
            });

            it('process(outputFormat) and render() agree for every format', async () => {
                expect(f.formatIds.length).toBeGreaterThan(0);
                for (const format of f.formatIds) {
                    const processed = await scheme.process(high, {
                        outputFormat: format,
                    });
                    const rendered = await scheme.render(high, format);
                    expect(processed.rendered).toBe(rendered.rendered);
                }
            });

            it('refuses input no scheme can parse', async () => {
                const result = await scheme.process(
                    'NOT_A_MARKING_IN_ANY_SCHEME',
                );
                expect(result.valid).toBe(false);
            });
        });

        describe('suggest: the facet subscription path', () => {
            it('offers every concept of the first category, none chosen, with nothing chosen', async () => {
                const offered = await scheme.suggest('');
                const first = offered.suggestions.filter(
                    (s) => s.categoryId === f.primaryCategoryId,
                );
                expect(first.map((s) => s.conceptId).sort()).toEqual(
                    scheme
                        .getConceptsInCategory(f.primaryCategoryId)
                        .map((c) => c.id)
                        .sort(),
                );
                expect(offered.suggestions.some((s) => s.selected)).toBe(false);
            });

            it('marks a committed assertion chosen, with and without a surface', async () => {
                const chosen = (
                    offered: Awaited<ReturnType<typeof scheme.suggest>>,
                ) =>
                    offered.suggestions
                        .filter((s) => s.selected)
                        .map((s) => s.conceptId);
                expect(chosen(await scheme.suggest(high))).toEqual([
                    f.highConceptId,
                ]);
                const scopes = scheme.getSchemeMeta().scopes ?? [];
                expect(scopes.length).toBeGreaterThan(0);
                expect(
                    chosen(
                        await scheme.suggest(high, {
                            surface: scopes[scopes.length - 1]!.id,
                        }),
                    ),
                ).toEqual([f.highConceptId]);
            });
        });

        describe('rollup', () => {
            it('aggregate() of renderings and of assertion sets roll up the same marking', async () => {
                const low = await scheme.process([
                    user(f.lowConceptId, f.primaryCategoryId),
                ]);
                const top = await scheme.process(high);
                const byText = await scheme.aggregate([
                    low.rendered,
                    top.rendered,
                ]);
                const bySets = await scheme.aggregateAssertions([
                    [user(f.lowConceptId, f.primaryCategoryId)],
                    high,
                    [],
                ]);
                expect(byText.rendered).toBe(bySets.rendered);
            });

            it('checkCoverage() tells a covered child from an uncovered one', async () => {
                const covered = await scheme.checkCoverage(
                    [f.lowConceptId],
                    f.highConceptId,
                );
                expect(covered).toMatchObject({ covered: true, missing: [] });
                const uncovered = await scheme.checkCoverage(
                    [f.highConceptId],
                    f.lowConceptId,
                );
                expect(uncovered.covered).toBe(false);
                // The parent misses the child's own level.
                expect(uncovered.missing).toContainEqual(
                    expect.objectContaining({
                        categoryId: f.primaryCategoryId,
                        conceptId: f.highConceptId,
                    }),
                );
            });
        });

        describe('the rest of the surface the UI reads', () => {
            it('collectNotices() answers the notices a marking carries: none here', async () => {
                expect(await scheme.collectNotices(high)).toEqual([]);
            });

            it('scan() reads each part mark in document text, and nothing in prose', async () => {
                const prose = await scheme.scan(
                    `Question 1 is ${f.lowConceptId} and question 2 is ${f.highConceptId}.`,
                );
                expect(prose.results).toEqual([]);
                const marked = await scheme.scan(
                    `(${f.lowConceptId}) Lunch menu.\n(${f.highConceptId}) Exam packet.`,
                );
                if (!traits.readsPartMarks) {
                    // No embedded marking declared: a parenthesized word is prose.
                    expect(marked.results).toEqual([]);
                    return;
                }
                expect(marked.results.map((r) => r.marking)).toEqual([
                    `(${f.lowConceptId})`,
                    `(${f.highConceptId})`,
                ]);
                expect(conceptIds(marked.results[0]!.result)).toContain(
                    f.lowConceptId,
                );
                expect(conceptIds(marked.results[1]!.result)).toContain(
                    f.highConceptId,
                );
            });

            it('describeConcept() describes the concept it names', async () => {
                expect(
                    JSON.stringify(
                        await scheme.describeConcept(
                            f.highConceptId,
                            f.primaryCategoryId,
                        ),
                    ),
                ).toContain(f.highConceptId);
            });
        });

        describe('what a remote adapter does differently', () => {
            it('getFormatCoverage() answers every format from the profile, with no request', () => {
                // There is no format-coverage route. The client answers from the
                // categories and formats it already holds, synchronously and with
                // no request, so a composer can carry a committed value its
                // format cannot write. The proof of reconstruction needs the
                // format's field tree, which stays on the server, so a remote
                // answer never claims it. Which categories each answer covers is
                // checked against the engine's recorded answers further down.
                const profile = scheme.getScheme();
                expect(profile.formats.length).toBeGreaterThan(0);
                for (const format of profile.formats) {
                    const coverage = scheme.getFormatCoverage!(format.id);
                    expect(coverage).not.toBeInstanceOf(Promise);
                    expect(coverage.formatId).toBe(format.id);
                    expect(coverage.reconstruction.status).toBe('unknown');
                }
                expect(scheme.getFormatCoverage!()).toEqual(
                    scheme.getFormatCoverage!(profile.defaultRenderFormat),
                );
            });

            it('applyPreset() refuses an unknown preset with a rejected promise', async () => {
                // The return type is `MaybePromise`: a remote adapter rejects where
                // an in-process one would throw, so a caller wraps the call itself
                // rather than only awaiting it.
                const pending = scheme.applyPreset('no-such-preset');
                expect(pending).toBeInstanceOf(Promise);
                await expect(pending).rejects.toThrow(/no-such-preset/);
            });

            // Which Contexts a caller's token may reach is the REST API's to
            // enforce, and its own suites prove the refusal; the demo runtime
            // serves every Context to every caller.
            it('a client cannot bind to a Context the runtime does not serve', async () => {
                await expect(
                    connectDemoContext({
                        contextId: 'no-such-context',
                        contextVersion: '1.0.0',
                    }),
                ).rejects.toThrow(/API error 404 /);
                expect(scheme.getScheme().id).toBeTruthy();
            });
        });
    },
);

/** One case of the vendored `format-coverage` conformance plan. */
interface CoverageCase {
    name: string;
    method: string;
    args: string[];
    fixture: string;
}

/** One answer the engine recorded for that plan. */
interface RecordedAnswer {
    method: string;
    response: unknown;
}

const SPEC = path.resolve(import.meta.dirname, '../../vendor/spec');

function readSpec<T>(...segments: string[]): T {
    return JSON.parse(
        readFileSync(path.resolve(SPEC, ...segments), 'utf8'),
    ) as T;
}

/** Key-sorted compact JSON, the form a recording key is computed over. */
function canonical(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
    if (value && typeof value === 'object') {
        const entries = Object.entries(value as Record<string, unknown>)
            .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
            .map(
                ([key, member]) =>
                    `${JSON.stringify(key)}:${canonical(member)}`,
            );
        return `{${entries.join(',')}}`;
    }
    return JSON.stringify(value);
}

/**
 * The recording key of a case, as the conformance package defines it: the
 * SHA-256 of its method, arguments, fixture, mode, Context id and version, and
 * guide and access fixtures, joined by `|`. This plan's cases name no mode,
 * Context, guide or access fixture.
 */
function recordingKey(planCase: CoverageCase): string {
    const parts = [
        planCase.method,
        canonical(planCase.args),
        canonical(planCase.fixture),
        'fromJSON',
        '',
        '',
        '',
        '',
    ];
    return createHash('sha256').update(parts.join('|')).digest('hex');
}

/** A format's id and the categories it lays out, in its order. */
const layout = (formats: SchemePublicView['formats']) =>
    formats.map((f) => ({ id: f.id, categoryOrder: f.categoryOrder }));

describe('getFormatCoverage over REST answers what the engine recorded', () => {
    // The adapter-slice plan holds, for each fixture, the profile the engine
    // publishes and the coverage it reports for every output that profile
    // lists. Here the fixture goes through the draft door, the client reads the
    // profile the runtime serves, and each answer the client derives from it
    // must be the engine's.
    const plan = readSpec<{ cases: CoverageCase[] }>(
        'plans',
        'v1',
        'format-coverage.json',
    );
    const { responses } = readSpec<{
        responses: Record<string, RecordedAnswer>;
    }>('recordings', 'v1', 'format-coverage.recordings.json');

    function engineAnswer<T>(planCase: CoverageCase): T {
        const recorded = responses[recordingKey(planCase)];
        if (!recorded || recorded.method !== planCase.method) {
            throw new Error(`no recorded engine answer for ${planCase.name}`);
        }
        return recorded.response as T;
    }

    const fixtures = [...new Set(plan.cases.map((c) => c.fixture))];

    it('has a profile and coverage cases to check for every fixture', () => {
        expect(fixtures.length).toBeGreaterThan(0);
        for (const fixture of fixtures) {
            const methods = plan.cases
                .filter((c) => c.fixture === fixture)
                .map((c) => c.method);
            expect(methods).toContain('getScheme');
            expect(methods).toContain('getFormatCoverage');
        }
    });

    describe.each(fixtures)('%s', (fixture) => {
        const cases = plan.cases.filter((c) => c.fixture === fixture);
        let client: EzClassifyClient;

        beforeAll(async () => {
            client = await connectDemoContext({
                draft: {
                    scheme: readSpec<unknown>(
                        'fixtures',
                        'v1',
                        `${fixture}.json`,
                    ),
                },
            });
        });

        afterAll(() => client?.destroy());

        it.each(cases.filter((c) => c.method === 'getScheme'))(
            '$name: the profile lists the outputs the engine published',
            (planCase) => {
                const engine = engineAnswer<SchemePublicView>(planCase);
                expect(layout(client.scheme.getScheme().formats)).toEqual(
                    layout(engine.formats),
                );
            },
        );

        it.each(cases.filter((c) => c.method === 'getFormatCoverage'))(
            '$name: covers the categories the engine reported',
            (planCase) => {
                const engine = engineAnswer<FormatCoverage>(planCase);
                const coverage = client.scheme.getFormatCoverage!(
                    planCase.args[0],
                );
                expect(coverage.formatId).toBe(engine.formatId);
                expect(coverage.coveredCategories).toEqual(
                    engine.coveredCategories,
                );
                expect(coverage.valueLossyCategories).toEqual(
                    engine.valueLossyCategories,
                );
                expect(coverage.reconstruction.status).toBe('unknown');
            },
        );
    });
});

describe('the profile carries the optional fields a scheme declares', () => {
    it('definition, guidance and role-aware processing reach the client', async () => {
        const client = await connectDemoContext(annotatedDraft());
        try {
            expect(client.scheme.getSchemeMeta()).toMatchObject({
                definition: ANNOTATIONS.definition,
                guidance: ANNOTATIONS.guidance,
                roleAware: true,
            });
            expect(JSON.stringify(client.scheme.getScheme())).toContain(
                ANNOTATIONS.guidance,
            );
        } finally {
            client.destroy();
        }
    });
});

describe('a captured value', () => {
    it('is carried through process, on the fixture whose concept captures one', async () => {
        const client = await connectDemoContext(annotatedDraft());
        try {
            const f = buildFixture(client.scheme);
            expect(f.captureConcept).toBeDefined();
            const result = await client.scheme.process([
                user(f.lowConceptId, f.primaryCategoryId),
                user(
                    f.captureConcept!.conceptId,
                    f.captureConcept!.categoryId,
                    'Ruiz, M.',
                ),
            ]);
            expect(
                result.assertions.find(
                    (a) => a.conceptId === f.captureConcept!.conceptId,
                ),
            ).toMatchObject({ value: 'Ruiz, M.' });
        } finally {
            client.destroy();
        }
    });
});
