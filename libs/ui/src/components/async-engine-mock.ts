/**
 * Async engine mock factory for testing components with remote (REST API)
 * engines.
 *
 * Produces an SchemeEngineAdapter-compliant mock where every method returns a
 * Promise, simulating the EzClassifyClient behavior. Includes controls for
 * latency, error injection, and request counting.
 */

import type {
    SchemePublicView,
    ConceptView,
    CategoryView,
    SchemeMetaView,
    RenderFormatLayout,
    Assertion,
    ScanOutcome,
} from '@ezclassify/types';
import { mockScanOutcome } from '../engine-result-mock';

/**
 * The layout the mock's default format writes. A remote adapter only ever
 * publishes the resolved layout, never the authored field tree, so the mock
 * that stands in for one publishes the same thing.
 */
const ASYNC_MOCK_RENDER_FORMATS: RenderFormatLayout[] = [
    {
        id: 'default',
        surface: 'default',
        mode: 'inline',
        view: 'default',
        separator: '//',
        categoryOrder: ['f1', 'f2'],
        categorySeparators: { f1: ',' },
    },
];

/**
 * Tuning knobs for the async engine mock: simulated latency and the profile it
 * serves.
 */
export interface AsyncMockOptions {
    /** Delay in ms before resolving each call (default: 10) */
    delay?: number;
    /**
     * Scheme to serve from getScheme() / getSchemeMeta() / listCategories() /
     * getConceptsInCategory()
     */
    scheme?: SchemePublicView;
}

/**
 * Promise-returning engine stand-in that mimics the REST API client, with
 * helpers to inject delays and failures for testing async UI flows.
 */
export interface AsyncMockEngine {
    getScheme: () => SchemePublicView;
    getSchemeMeta: () => SchemeMetaView;
    listCategories: () => CategoryView[];
    getConceptsInCategory: (categoryId: string) => ConceptView[];
    connected: boolean;
    process: (
        input: string | Assertion[],
        options?: { outputFormat?: string; assertions?: Assertion[] },
    ) => Promise<{ assertions: Assertion[]; rendered: string; valid: boolean }>;
    render: (
        assertions: Assertion[],
        format?: string,
    ) => Promise<{
        rendered: string;
        assessment: {
            emitted: never[];
            omitted: never[];
            collapsed: never[];
            conflicts: never[];
            unrepresentable: never[];
        };
    }>;
    suggest: (
        input: string,
        options?: unknown,
    ) => Promise<{ suggestions: never[] }>;
    aggregate: (
        inputs: string[],
        options?: unknown,
    ) => Promise<{ assertions: Assertion[]; rendered: string }>;
    aggregateAssertions: (
        assertionSets: Assertion[][],
        options?: unknown,
    ) => Promise<{ assertions: Assertion[]; rendered: string; valid: boolean }>;
    scan: (text: string, options?: unknown) => Promise<ScanOutcome>;
    describeConcept: (
        conceptId: string,
        categoryId: string,
    ) => Promise<{ name: string; lines: string[] }>;

    /** Test controls */
    _calls: { method: string; args: unknown[] }[];
    _setDelay: (ms: number) => void;
    _failNext: (method: string, error?: Error) => void;
    _callCount: (method: string) => number;
}

function createDefaultProfile(): SchemePublicView {
    const concepts: ConceptView[] = [
        {
            id: 'A',
            name: 'Concept A',
            views: { default: 'A' },
            aliases: [],
            categories: ['f1'],
            parents: [],
            position: 0,
        },
        {
            id: 'B',
            name: 'Concept B',
            views: { default: 'B' },
            aliases: [],
            categories: ['f1'],
            parents: [],
            position: 1,
        },
        {
            id: 'C',
            name: 'Concept C',
            views: { default: 'C' },
            aliases: [],
            categories: ['f2'],
            parents: [],
            position: 0,
        },
        {
            id: 'D',
            name: 'Concept D',
            views: { default: 'D' },
            aliases: [],
            categories: ['f2'],
            parents: [],
            position: 1,
        },
        {
            id: 'INF',
            name: 'Inferred',
            views: { default: 'INF' },
            aliases: [],
            categories: ['f1'],
            parents: ['A'],
            position: 2,
        },
    ];
    const categories: CategoryView[] = [
        {
            id: 'f1',
            label: 'Category 1',
            single: false,
            required: false,
            rollup: 'max',
        },
        {
            id: 'f2',
            label: 'Category 2',
            single: true,
            required: false,
            rollup: 'max',
        },
    ];
    return {
        id: 'test-async',
        version: '1.0',
        name: 'Async Test Scheme',
        description: '',
        concepts,
        categories,
        formats: [
            {
                id: 'default',
                surface: 'default',
                mode: 'inline',
                view: 'default',
            },
        ],
        defaultRenderFormat: 'default',
        referenceSurfaceLabel: {
            singular: 'Handbook',
            plural: 'Handbooks',
        },
    } as SchemePublicView;
}

/**
 * Builds a fully wired async mock engine with configurable latency, error
 * injection, and call tracking for component integration tests.
 */
export function createAsyncMockEngine(
    opts?: AsyncMockOptions,
): AsyncMockEngine {
    let delay = opts?.delay ?? 10;
    const scheme = opts?.scheme ?? createDefaultProfile();
    const calls: { method: string; args: unknown[] }[] = [];
    const failNextMap = new Map<string, Error>();

    function record(method: string, args: unknown[]) {
        calls.push({ method, args });
    }

    function delayed<T>(method: string, value: T): Promise<T> {
        return new Promise((resolve, reject) => {
            setTimeout(() => {
                const err = failNextMap.get(method);
                if (err) {
                    failNextMap.delete(method);
                    reject(err);
                } else {
                    resolve(value);
                }
            }, delay);
        });
    }

    /**
     * Simple process: parse comma-separated IDs back to assertions, simulate
     * inference. When pre-built assertions are provided, the parse stage is
     * skipped.
     */
    function processSync(
        input: string | Assertion[],
        preAssertions?: Assertion[],
    ): { assertions: Assertion[]; rendered: string; valid: boolean } {
        let assertions: Assertion[];
        // The store passes a structured assertion array as the first argument
        // (de-stringified publish). Treat it exactly like preAssertions.
        const arrayInput = Array.isArray(input) ? input : undefined;
        if (preAssertions ?? arrayInput) {
            assertions = (preAssertions ?? arrayInput ?? []).map((a) => ({
                ...a,
            }));
        } else {
            const text = typeof input === 'string' ? input : '';
            const ids = text
                ? text
                      .split(',')
                      .map((s) => s.trim())
                      .filter(Boolean)
                : [];
            assertions = ids.map((id) => {
                const concept = scheme.concepts.find((c) => c.id === id);
                return {
                    conceptId: id,
                    categoryId: concept?.categories[0] ?? 'f1',
                    confidence: 'certain' as const,
                    source: 'parse' as const,
                };
            });
        }
        // Simulate inference: A implies INF
        if (
            assertions.some((a) => a.conceptId === 'A') &&
            !assertions.some((a) => a.conceptId === 'INF')
        ) {
            assertions.push({
                conceptId: 'INF',
                categoryId: 'f1',
                confidence: 'inferred' as const,
                source: 'engine' as const,
            });
        }
        return {
            assertions,
            rendered: assertions.map((a) => a.conceptId).join(','),
            valid: true,
        };
    }

    /** Simple render: join concept IDs and report a lossless projection. */
    function renderSync(assertions: Assertion[]) {
        return {
            rendered: assertions.map((a) => a.conceptId).join(','),
            assessment: {
                emitted: [],
                omitted: [],
                collapsed: [],
                conflicts: [],
                unrepresentable: [],
            },
        };
    }

    const engine: AsyncMockEngine = {
        getScheme: () => scheme,
        getSchemeMeta: () => ({
            id: scheme.id,
            version: scheme.version,
            name: scheme.name,
            description: scheme.description,
            license: scheme.license,
            defaultRenderFormat: scheme.defaultRenderFormat,
            scopes: scheme.scopes,
            referenceSurfaceLabel: scheme.referenceSurfaceLabel ?? {
                singular: 'Handbook',
                plural: 'Handbooks',
            },
            formats: ASYNC_MOCK_RENDER_FORMATS,
        }),
        listCategories: () => scheme.categories,
        getConceptsInCategory: (categoryId: string) =>
            scheme.concepts.filter((c) => c.categories.includes(categoryId)),
        connected: true,

        process: (input, options) => {
            record('process', [input, options]);
            return delayed('process', processSync(input, options?.assertions));
        },

        render: (assertions, options) => {
            record('render', [assertions, options]);
            return delayed('render', renderSync(assertions as Assertion[]));
        },

        suggest: (input, options) => {
            record('suggest', [input, options]);
            const suggestions = scheme.concepts.map((c) => ({
                conceptId: c.id,
                categoryId: c.categories[0],
                label: c.name,
                name: c.name,
                views: c.views,
                group:
                    scheme.categories.find((f) => f.id === c.categories[0])
                        ?.label ?? c.categories[0],
            }));
            return delayed('suggest', { suggestions } as never);
        },

        aggregate: (inputs, options) => {
            record('aggregate', [inputs, options]);
            const allIds = inputs.flatMap((i) =>
                i
                    .split(',')
                    .map((s) => s.trim())
                    .filter(Boolean),
            );
            const unique = [...new Set(allIds)];
            return delayed('aggregate', {
                assertions: [],
                rendered: unique.join(','),
            });
        },

        aggregateAssertions: (assertionSets, options) => {
            record('aggregateAssertions', [assertionSets, options]);
            const merged: Assertion[] = [];
            const seen = new Set<string>();
            for (const set of assertionSets) {
                for (const a of set) {
                    const key = `${a.categoryId}:${a.conceptId}`;
                    if (!seen.has(key)) {
                        seen.add(key);
                        merged.push({ ...a });
                    }
                }
            }
            return delayed('aggregateAssertions', {
                assertions: merged,
                rendered: merged.map((a) => a.conceptId).join(','),
                valid: true,
            });
        },

        scan: (text, options) => {
            record('scan', [text, options]);
            return delayed('scan', mockScanOutcome());
        },

        describeConcept: (conceptId, categoryId) => {
            record('describeConcept', [conceptId, categoryId]);
            const concept = scheme.concepts.find((c) => c.id === conceptId);
            const category = scheme.categories.find((f) => f.id === categoryId);
            const lines = [
                `${category?.label ?? categoryId}: ${concept?.name ?? conceptId}`,
                '',
                'Rules:',
                '  Test rule for ' + conceptId,
            ];
            return delayed('describeConcept', {
                name: concept?.name ?? conceptId,
                lines,
            });
        },

        _calls: calls,
        _setDelay: (ms: number) => {
            delay = ms;
        },
        _failNext: (method: string, error?: Error) => {
            failNextMap.set(
                method,
                error ?? new Error('Mock failure: ' + method),
            );
        },
        _callCount: (method: string) =>
            calls.filter((c) => c.method === method).length,
    };

    return engine;
}
