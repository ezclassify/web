/**
 * Engine stand-in whose every asynchronous answer is held open until a test
 * releases it.
 *
 * `async-engine-mock.ts` covers "the engine returns promises". It cannot cover
 * the defect class this harness exists for, because a fixed delay still
 * resolves calls in the order they were issued. The races the store guards
 * against are the ones where a network delivers answers in a DIFFERENT order
 * than the store asked for them: an older publish committing over a newer one,
 * a superseded facet fan-out repainting every picker, a suggest for an
 * abandoned key overwriting the current one. None of them can happen with an
 * in-process engine, and none of them are reachable by a test that can only
 * choose how LONG a call takes.
 *
 * So this harness gives up latency simulation entirely and hands the test the
 * resolution order directly: every call parks in
 * {@link LatencyEngineHarness.pending}, and the test resolves them in whatever
 * order it wants to prove. A test writes the reordering it is worried about and
 * asserts the store still lands on the newest truth.
 *
 * Test support only. Nothing here is exported from the package entry, and the
 * `-harness` suffix keeps the file out of the declaration build, so it stays
 * out of the published tarball as well (see `tsconfig.lib.json`).
 */

import type { Assertion, Suggestion } from '@ezclassify/types';
import type {
    EzClassifyStoreCategoryMeta,
    EzClassifyStoreEngine,
    EzClassifyStoreProcessResult,
    EzClassifyStoreSchemeMeta,
} from './ezclassify-store';
import { EMPTY_RENDER_ASSESSMENT } from '../engine-result-mock';

/** The engine members this harness parks. Everything else answers synchronously. */
export type LatencyEngineMethod =
    'process' | 'suggest' | 'suggestForCategories' | 'aggregateAssertions';

/**
 * One engine call the store has made and is still waiting on.
 *
 * `resolve()` with no argument answers with the harness's own passthrough
 * computation, which is what most tests want; pass a value to answer with
 * something specific (a suggestion list, a repaired assertion set).
 */
export interface PendingEngineCall {
    readonly method: LatencyEngineMethod;
    /**
     * Positional arguments the store passed, for assertions about the call
     * itself.
     */
    readonly args: readonly unknown[];
    /** The signal from the call's option bag, if the store threaded one. */
    readonly signal: AbortSignal | undefined;
    /** True once the store has aborted this call. */
    readonly aborted: boolean;
    resolve(value?: unknown): void;
    reject(error?: unknown): void;
}

/** Scheme shape the harness serves from its synchronous, cached-profile views. */
export interface LatencyEngineHarnessOptions {
    /** Category id to declared scopes, for the store's scope routing. */
    scopes?: Record<string, string[]>;
    /** The scheme's default scope id. */
    defaultScope?: string;
    /** Offer `suggest`. Default true. */
    suggest?: boolean;
    /** Offer `suggestForCategories`. Default false. */
    suggestForCategories?: boolean;
    /**
     * Reject an outstanding call as soon as the store aborts its signal, the
     * way a fetch-based adapter does. Default false, which models the local
     * engine: it takes the signal and ignores it, so an aborted call still
     * answers normally and only the store's own revision guards can reject it.
     *
     * Both behaviors are real, and the store has to be correct under each: with
     * this off, the tests prove a superseded answer cannot land; with it on,
     * they prove a superseded call cannot surface its cancellation to a
     * caller.
     */
    rejectOnAbort?: boolean;
}

/** A parked engine plus the controls a test drives it with. */
export interface LatencyEngineHarness {
    readonly engine: EzClassifyStoreEngine;
    /** Outstanding calls to `method`, oldest first. */
    pending(method: LatencyEngineMethod): PendingEngineCall[];
    /** How many calls to `method` have been made in total. */
    issued(method: LatencyEngineMethod): number;
    /**
     * Resolve everything outstanding, oldest first, repeatedly until the store
     * stops making new calls. Used to settle the cascade a commit kicks off
     * (aggregate, whole rollups, facets) when the test does not care about its
     * ordering.
     */
    settleAll(): Promise<void>;
    /** Drain pending microtasks so fire-and-forget work reaches its next await. */
    flush(): Promise<void>;
}

/** What a fetch-based adapter rejects an aborted request with. */
function abortError(): Error {
    const error = new Error('[harness] engine call aborted');
    error.name = 'AbortError';
    return error;
}

function renderAssertions(assertions: Assertion[]): string {
    return assertions.map((a) => `${a.categoryId}:${a.conceptId}`).join(' ');
}

/**
 * The passthrough answer for a `process` call, mirroring the local engine's
 * shape.
 */
function processAnswer(
    input: string | Assertion[],
): EzClassifyStoreProcessResult {
    const assertions: Assertion[] = [];
    if (typeof input === 'string') {
        for (const part of input.split(/\s+/)) {
            const [categoryId, conceptId] = part.split(':');
            if (categoryId && conceptId)
                assertions.push({ categoryId, conceptId } as Assertion);
        }
    } else {
        assertions.push(...input);
    }
    return {
        rendered:
            typeof input === 'string' ? input : renderAssertions(assertions),
        ...(typeof input === 'string'
            ? {
                  recognition: {
                      status: 'complete' as const,
                      inputFormat: 'default',
                      unmatched: [],
                      corrections: [],
                  },
              }
            : {}),
        assessment: EMPTY_RENDER_ASSESSMENT,
        renders: {},
        assertions,
        valid: true,
        errors: [],
    };
}

/**
 * The passthrough answer for an `aggregateAssertions` call: the deduplicated
 * union.
 */
function aggregateAnswer(
    assertionSets: Assertion[][],
): EzClassifyStoreProcessResult {
    const merged: Assertion[] = [];
    const seen = new Set<string>();
    for (const set of assertionSets) {
        for (const a of set) {
            const key = `${a.categoryId}:${a.conceptId}`;
            if (seen.has(key)) continue;
            seen.add(key);
            merged.push(a);
        }
    }
    return {
        rendered: renderAssertions(merged),
        assessment: EMPTY_RENDER_ASSESSMENT,
        renders: {},
        assertions: merged,
        valid: true,
        errors: [],
    };
}

/**
 * Build a parked engine and its controls.
 *
 * @param options - Scheme scope routing and which suggest capabilities to
 *   offer.
 * @returns The engine to construct a store with, plus the call controls.
 */
export function createLatencyEngineHarness(
    options: LatencyEngineHarnessOptions = {},
): LatencyEngineHarness {
    const outstanding: PendingEngineCall[] = [];
    const issued = new Map<LatencyEngineMethod, number>();

    function park(
        method: LatencyEngineMethod,
        args: readonly unknown[],
        signal: AbortSignal | undefined,
        answer: () => unknown,
    ): Promise<unknown> {
        issued.set(method, (issued.get(method) ?? 0) + 1);
        return new Promise((resolveFn, rejectFn) => {
            const settle = (finish: () => void): void => {
                const at = outstanding.indexOf(call);
                if (at === -1) return;
                outstanding.splice(at, 1);
                finish();
            };
            const call: PendingEngineCall = {
                method,
                args,
                signal,
                get aborted() {
                    return signal?.aborted ?? false;
                },
                resolve(value?: unknown) {
                    settle(() =>
                        resolveFn(value === undefined ? answer() : value),
                    );
                },
                reject(error?: unknown) {
                    settle(() =>
                        rejectFn(
                            error ?? new Error('[harness] engine call failed'),
                        ),
                    );
                },
            };
            outstanding.push(call);
            if (options.rejectOnAbort && signal) {
                if (signal.aborted) call.reject(abortError());
                else
                    signal.addEventListener(
                        'abort',
                        () => call.reject(abortError()),
                        { once: true },
                    );
            }
        });
    }

    const optionSignal = (bag: unknown): AbortSignal | undefined =>
        (bag as { signal?: AbortSignal } | undefined)?.signal;

    const engine: EzClassifyStoreEngine = {
        process(input, opts) {
            return park('process', [input, opts], optionSignal(opts), () =>
                processAnswer(input),
            ) as Promise<EzClassifyStoreProcessResult>;
        },
        render(assertions) {
            return renderAssertions(assertions);
        },
        aggregate(inputs) {
            return {
                rendered: inputs.join(' '),
                renders: {},
                assertions: [],
                valid: true,
                errors: [],
            };
        },
        aggregateAssertions(assertionSets, opts) {
            return park(
                'aggregateAssertions',
                [assertionSets, opts],
                optionSignal(opts),
                () => aggregateAnswer(assertionSets),
            ) as Promise<EzClassifyStoreProcessResult>;
        },
        getSchemeMeta(): EzClassifyStoreSchemeMeta {
            return {
                defaultScope: options.defaultScope,
                scopes: options.defaultScope
                    ? [{ id: options.defaultScope }]
                    : [],
            };
        },
        listCategories(): EzClassifyStoreCategoryMeta[] {
            return Object.entries(options.scopes ?? {}).map(([id, scopes]) => ({
                id,
                scopes,
            }));
        },
    };

    if (options.suggest !== false) {
        engine.suggest = (input, opts) =>
            park('suggest', [input, opts], optionSignal(opts), () => ({
                suggestions: [] as Suggestion[],
            })) as Promise<{ suggestions: Suggestion[] }>;
    }
    if (options.suggestForCategories) {
        engine.suggestForCategories = (assertions, categoryIds, opts) =>
            park(
                'suggestForCategories',
                [assertions, categoryIds, opts],
                optionSignal(opts),
                () =>
                    Object.fromEntries(
                        categoryIds.map((categoryId) => [
                            categoryId,
                            { suggestions: [] as Suggestion[] },
                        ]),
                    ),
            ) as Promise<Record<string, { suggestions: Suggestion[] }>>;
    }

    const flush = async (): Promise<void> => {
        for (let i = 0; i < 10; i++) await Promise.resolve();
    };

    return {
        engine,
        pending(method) {
            return outstanding.filter((call) => call.method === method);
        },
        issued(method) {
            return issued.get(method) ?? 0;
        },
        async settleAll() {
            // Each round of answers can start the next round (a commit fans out
            // to aggregate, rollups, and facets), so keep going until a flush
            // produces nothing new. The bound is a runaway guard, not a budget.
            for (let round = 0; round < 20; round++) {
                if (outstanding.length === 0) {
                    await flush();
                    if (outstanding.length === 0) return;
                }
                for (const call of [...outstanding]) call.resolve();
                await flush();
            }
            throw new Error(
                '[harness] engine calls never stopped arriving; a test is probably looping',
            );
        },
        flush,
    };
}
