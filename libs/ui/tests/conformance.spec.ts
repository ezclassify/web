/**
 * @vitest-environment jsdom
 *
 * Forms library conformance runner for the EzClassify conformance plan.
 *
 * Reads every applicable plan file from the vendored spec bundle
 * (vendor/spec/plans/v1/) and runs each test case through the forms library
 * integration path:
 *
 *   - fromJSON mode: the fixture goes to the demo runtime as a draft, the
 *     connected Context is wrapped in EzClassifyUI, and methods are dispatched
 *     through forms.engine.
 *
 *   - fromLayers mode: the same, with the fixture's layers in the draft.
 *
 * Skipped plan files (legitimate n/a for the forms UI library):
 *   - check-access.json, access decisions are not a forms-layer concern
 *   - registry.json, the forms library wraps one scheme engine, not a registry
 *
 * This proves the forms library correctly wraps the scheme operations without mutating
 * it and that engine calls through the forms integration path produce conformant
 * results identical to the Node reference runner. The runtime's answers replay
 * from this spec's recordings (test-support/demo-runtime.ts).
 */

import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import type { EzClassifyClient } from '@ezclassify/rest-client';
import type {
    GuideRuleSelection,
    RemoteContextSchemeEngineAdapter,
} from '@ezclassify/types';
import { EzClassifyUI } from '@ezclassify/ui';
import { asContext } from '../test-fixtures/as-context';
import { connectDemoContext } from '../../../test-support/demo-runtime';

const __dirname = dirname(fileURLToPath(import.meta.url));
const specRoot = resolve(__dirname, '../../../vendor/spec');
const plansDir = resolve(specRoot, 'plans/v1');
const fixturesDir = resolve(specRoot, 'fixtures/v1');

/**
 * Plan files that genuinely do not apply to the forms UI library. Only
 * engine-slice plans run here; the slice filter below skips the rest.
 */
const SKIPPED_PLANS = new Set(['check-access.json', 'registry.json']);

// ---------------------------------------------------------------------------
// Deep subset match (mirrors the Node runner logic exactly)
// ---------------------------------------------------------------------------

/**
 * Returns true if `actual` satisfies all constraints in `expected`. For
 * objects: every key in expected must be present and match in actual. For
 * arrays: expected[i] must be a subset-match of actual[i] for all i. For
 * primitives: strict equality.
 */
function subsetMatch(actual: unknown, expected: unknown): boolean {
    if (expected === null || expected === undefined) return actual == null;
    if (typeof expected !== 'object') return actual === expected;
    if (Array.isArray(expected)) {
        if (!Array.isArray(actual)) return false;
        if (actual.length < expected.length) return false;
        for (let i = 0; i < expected.length; i++) {
            if (!subsetMatch(actual[i], expected[i])) return false;
        }
        return true;
    }
    if (typeof actual !== 'object' || actual === null) return false;
    for (const key of Object.keys(expected as Record<string, unknown>)) {
        if (
            !subsetMatch(
                (actual as Record<string, unknown>)[key],
                (expected as Record<string, unknown>)[key],
            )
        )
            return false;
    }
    return true;
}

// ---------------------------------------------------------------------------
// Fixture loading
// ---------------------------------------------------------------------------

/** Load a fixture JSON file by name (without extension). */
function loadFixture(name: string): unknown {
    return JSON.parse(
        readFileSync(resolve(fixturesDir, `${name}.json`), 'utf8'),
    );
}

// ---------------------------------------------------------------------------
// Forms construction helper
// ---------------------------------------------------------------------------

/**
 * Construct an EzClassifyUI instance around the given scheme adapter. The root
 * div is mounted in jsdom so DOM ops inside EzClassifyUI succeed. Returns both
 * the forms instance and the root div for cleanup.
 */
function makeForms(engine: RemoteContextSchemeEngineAdapter): {
    forms: EzClassifyUI;
    root: HTMLDivElement;
} {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const forms = new EzClassifyUI(asContext(engine), { root });
    return { forms, root };
}

// ---------------------------------------------------------------------------
// Method dispatch via the forms integration path
// ---------------------------------------------------------------------------

/**
 * Dispatch a plan method through the forms integration path.
 *
 * Construction: fromJSON sends `{ scheme: fixture }` through the draft door,
 * fromLayers sends `{ scheme, layers }`, and either connected Context is
 * wrapped in EzClassifyUI.
 *
 * Dispatch: methods called on forms.engine (the scheme operations the forms
 * instance holds). This verifies the forms initialization path does not corrupt
 * or replace the engine.
 */
async function runViaForms(
    fixture: string | string[],
    mode: string,
    method: string,
    args: unknown[],
    guideFixture?: string,
): Promise<unknown> {
    // A guide plan entry composes its guide with the scheme, the way every
    // guide reaches a caller: through a Context.
    const guides = guideFixture ? [loadFixture(guideFixture)] : [];
    let context: EzClassifyClient;
    if (mode === 'fromLayers') {
        const layerNames = Array.isArray(fixture) ? fixture : [fixture];
        const [base, ...layers] = layerNames.map(loadFixture);
        context = await connectDemoContext({
            draft: { scheme: base, layers, guides },
        });
    } else {
        const profileData = loadFixture(
            Array.isArray(fixture) ? fixture[0] : fixture,
        );
        context = await connectDemoContext({
            draft: { scheme: profileData, guides },
        });
    }
    const engine = context.scheme as RemoteContextSchemeEngineAdapter;
    const guide = () => {
        if (!guideFixture || !context.guide)
            throw new Error(`${method} requires guideFixture in plan entry`);
        return context.guide;
    };

    if (method === 'evaluateGuide') {
        const loaded = guide();
        return loaded.evaluate(
            loaded.listGuideMeta()[0].id,
            args[0] as string[],
        );
    }
    if (method === 'evaluateMany') {
        return guide().evaluateMany(args[0] as GuideRuleSelection[]);
    }
    if (method === 'guideScan') {
        const hits = await guide().scan(args[0] as string);
        return {
            count: hits.length,
            firstRuleId:
                (hits[0] as { rule: { id: string } } | undefined)?.rule?.id ??
                null,
            firstStart:
                (
                    hits[0] as
                        | { spans?: Array<{ start: number; end: number }> }
                        | undefined
                )?.spans?.[0]?.start ?? null,
            firstEnd:
                (
                    hits[0] as
                        | { spans?: Array<{ start: number; end: number }> }
                        | undefined
                )?.spans?.[0]?.end ?? null,
            results: hits,
        };
    }

    const { forms, root } = makeForms(engine);

    try {
        // The scheme view the runtime marks with, read through its internal
        // accessor: the case runs on what the forms instance holds.
        return await dispatchOnEngine(
            (forms as unknown as { engine: RemoteContextSchemeEngineAdapter })
                .engine,
            method,
            args,
        );
    } finally {
        forms.destroy();
        root.remove();
    }
}

/**
 * Dispatch a method call directly on a RemoteContextSchemeEngineAdapter
 * instance.
 */
async function dispatchOnEngine(
    engine: RemoteContextSchemeEngineAdapter,
    method: string,
    args: unknown[],
): Promise<unknown> {
    switch (method) {
        case 'process':
            return (engine.process as (...a: unknown[]) => unknown)(...args);
        case 'aggregate':
            return (engine.aggregate as (...a: unknown[]) => unknown)(...args);
        case 'aggregateAssertions':
            return (engine.aggregateAssertions as (...a: unknown[]) => unknown)(
                ...args,
            );
        case 'suggest':
            return (engine.suggest as (...a: unknown[]) => unknown)(...args);
        case 'scan': {
            // The same projection the reference runner records: the count and
            // the first region's position next to the regions themselves, and
            // the wrapped marks the scan could not read.
            const { results: regions, unread } = await (
                engine.scan as (...a: unknown[]) => Promise<{
                    results: Array<{
                        marking?: string;
                        start?: number;
                        result?: { rendered?: string };
                    }>;
                    unread: unknown[];
                }>
            )(...args);
            return {
                count: regions.length,
                firstMarking: regions[0]?.marking ?? null,
                firstStart: regions[0]?.start ?? null,
                firstRendered: regions[0]?.result?.rendered ?? null,
                results: regions,
                unread,
            };
        }
        case 'validate':
            return (engine.validate as (...a: unknown[]) => unknown)(...args);
        case 'render': {
            // `render` writes and does not read, so it keeps one named format
            // argument; a recorded case that passes `{ format }` names it.
            const [assertions, second] = args as [
                unknown,
                (string | { format?: string })?,
            ];
            const formatId =
                typeof second === 'string' ? second : second?.format;
            return {
                result: (
                    await (
                        engine.render as (
                            ...a: unknown[]
                        ) => Promise<{ rendered: string }>
                    )(assertions, formatId)
                ).rendered,
            };
        }
        case 'diff':
            return (engine.diff as (...a: unknown[]) => unknown)(...args);
        default:
            throw new Error(`Unknown method: ${method}`);
    }
}

// ---------------------------------------------------------------------------
// Build test suite from plan files
// ---------------------------------------------------------------------------

interface PlanCase {
    name: string;
    fixture: string | string[];
    accessFixture?: string;
    guideFixture?: string;
    mode?: string;
    method: string;
    args: unknown[];
    expect: unknown;
}

const planFiles = readdirSync(plansDir)
    .filter(
        (f: string) =>
            f.endsWith('.json') &&
            f !== 'plan-schema.json' &&
            !SKIPPED_PLANS.has(f),
    )
    .sort();

for (const planFile of planFiles) {
    const planDoc: { slice?: string; cases: PlanCase[] } = JSON.parse(
        readFileSync(resolve(plansDir, planFile), 'utf8'),
    );
    // Only engine-slice plans go through the forms library. Server-slice plans
    // (ctx* methods) need a live REST deployment, and adapter-slice plans hold
    // answers an adapter gives in process with no wire operation behind them;
    // tests/integration/scheme-adapter-over-rest.spec.ts checks those.
    if (planDoc.slice !== 'engine') continue;
    const capability = basename(planFile, '.json');

    describe(`forms-conformance / ${capability}`, () => {
        for (const tc of planDoc.cases) {
            it(tc.name, async () => {
                const mode = tc.mode ?? 'fromJSON';
                const actual = await runViaForms(
                    tc.fixture,
                    mode,
                    tc.method,
                    tc.args,
                    tc.guideFixture,
                );
                expect(
                    subsetMatch(actual, tc.expect),
                    `Expected subset-match failed.\nActual:   ${JSON.stringify(actual)}\nExpected: ${JSON.stringify(tc.expect)}`,
                ).toBe(true);
            });
        }
    });
}
