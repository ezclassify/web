/**
 * @vitest-environment jsdom
 *
 * Forms library conformance runner for the EzClassify conformance plan.
 *
 * Reads every applicable plan file from the vendored spec bundle
 * (vendor/spec/plans/v1/) and runs each test case through the forms library
 * integration path:
 *
 *   - fromJSON mode: engine constructed via Context.fromComponents, then wrapped
 *     in EzClassifyUI; methods dispatched through forms.engine.
 *
 *   - fromLayers mode: engine constructed via Context.fromComponents with layers, wrapped
 *     in EzClassifyUI; methods dispatched through forms.engine.
 *
 * Skipped plan files (legitimate n/a for the forms UI library):
 *   - check-access.json, access decisions are not a forms-layer concern
 *   - registry.json, the forms library wraps one scheme engine, not a registry
 *
 * This proves the forms library correctly wraps SchemeEngine without mutating
 * it and that engine calls through the forms integration path produce conformant
 * results identical to the Node reference runner.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { Context, GuideEngine } from '@ezclassify/engine';
import type { LocalSchemeEngineAdapter } from '@ezclassify/types';
import { EzClassifyUI } from '@ezclassify/ui';

const __dirname = dirname(fileURLToPath(import.meta.url));
const specRoot = resolve(__dirname, '../../../vendor/spec');
const plansDir = resolve(specRoot, 'plans/v1');
const fixturesDir = resolve(specRoot, 'fixtures/v1');

/**
 * Plan files that genuinely do not apply to the forms UI library. Server-slice
 * plans (`slice: "server"`) are skipped separately.
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
function makeForms(engine: LocalSchemeEngineAdapter): {
    forms: EzClassifyUI;
    root: HTMLDivElement;
} {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const forms = new EzClassifyUI(engine, { root });
    return { forms, root };
}

// ---------------------------------------------------------------------------
// Method dispatch via the forms integration path
// ---------------------------------------------------------------------------

/**
 * Dispatch a plan method through the forms integration path.
 *
 * Construction: fromJSON, Context.fromComponents({ scheme: fixture }) wrapped
 * in EzClassifyUI fromLayers, Context.fromComponents({ scheme, layers })
 * wrapped in EzClassifyUI
 *
 * Dispatch: methods called on forms.engine (the SchemeEngine the forms instance
 * holds). This verifies the forms initialization path does not corrupt or
 * replace the engine.
 */
function runViaForms(
    fixture: string | string[],
    mode: string,
    method: string,
    args: unknown[],
    guideFixture?: string,
): unknown {
    let engine: LocalSchemeEngineAdapter;
    if (mode === 'fromLayers') {
        const layerNames = Array.isArray(fixture) ? fixture : [fixture];
        const [base, ...layers] = layerNames.map(loadFixture);
        engine = Context.fromComponents({ scheme: base, layers })
            .scheme as LocalSchemeEngineAdapter;
    } else {
        const profileData = loadFixture(
            Array.isArray(fixture) ? fixture[0] : fixture,
        );
        engine = Context.fromComponents({ scheme: profileData })
            .scheme as LocalSchemeEngineAdapter;
    }

    if (method === 'evaluateGuide') {
        if (!guideFixture)
            throw new Error(
                'evaluateGuide requires guideFixture in plan entry',
            );
        return GuideEngine.fromJSON(loadFixture(guideFixture)).evaluate(
            args[0] as string[],
            engine,
        );
    }
    if (method === 'evaluateMany') {
        if (!guideFixture)
            throw new Error('evaluateMany requires guideFixture in plan entry');
        return GuideEngine.fromJSON(loadFixture(guideFixture)).evaluateMany(
            args[0] as string[],
            engine,
        );
    }
    if (method === 'guideScan') {
        if (!guideFixture)
            throw new Error('guideScan requires guideFixture in plan entry');
        const hits = GuideEngine.fromJSON(loadFixture(guideFixture)).scan(
            args[0] as string,
        );
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
        return dispatchOnEngine(
            forms.engine as LocalSchemeEngineAdapter,
            method,
            args,
        );
    } finally {
        forms.destroy();
        root.remove();
    }
}

/** Dispatch a method call directly on a LocalSchemeEngineAdapter instance. */
function dispatchOnEngine(
    engine: LocalSchemeEngineAdapter,
    method: string,
    args: unknown[],
): unknown {
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
            // the first region's position next to the regions themselves.
            const { results: regions } = (
                engine.scan as (...a: unknown[]) => {
                    results: Array<{
                        marking?: string;
                        start?: number;
                        result?: { rendered?: string };
                    }>;
                }
            )(...args);
            return {
                count: regions.length,
                firstMarking: regions[0]?.marking ?? null,
                firstStart: regions[0]?.start ?? null,
                firstRendered: regions[0]?.result?.rendered ?? null,
                results: regions,
            };
        }
        case 'validate':
            return (engine.validate as (...a: unknown[]) => unknown)(...args);
        case 'normalize':
            return {
                result: (engine.normalize as (...a: unknown[]) => unknown)(
                    ...args,
                ),
            };
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
                    engine.render as (...a: unknown[]) => { rendered: string }
                )(assertions, formatId).rendered,
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
    // Server-slice plans (ctx* methods) run against a live REST deployment,
    // never against the in-process engine here.
    if (planDoc.slice === 'server') continue;
    const capability = basename(planFile, '.json');

    describe(`forms-conformance / ${capability}`, () => {
        for (const tc of planDoc.cases) {
            it(tc.name, () => {
                const mode = tc.mode ?? 'fromJSON';
                const actual = runViaForms(
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
