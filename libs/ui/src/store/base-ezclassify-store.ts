/**
 * Shared base for the framework `EzClassifyStore` adapters.
 *
 * This base owns engine-facing commits, level and whole rollups, facet
 * refreshes and publication cycle protection.
 *
 * Each adapter supplies only a {@link ReactiveCell} factory for marking,
 * aggregate, and whole-rollup state; the cell hides whether reads/writes go
 * through a plain field, a Vue ref, or an Angular signal. Adapters keep their
 * legitimate per-framework differences: the cell factory decides the reactive
 * primitive, and {@link onDestroy} lets Angular skip the teardown writes that
 * would re-trigger its effect scheduler. `VanillaEzClassifyStore` itself is the
 * fourth subclass (a plain-field cell with no framework), so the reference
 * implementation and the adapters run the exact same engine-facing code.
 *
 * See `libs/ui/docs/binding-model.md` §8 ("state adapter pattern"). The shared
 * conformance suite runs against every adapter to keep their observable
 * behavior identical to `VanillaEzClassifyStore`.
 *
 * ## Ordering under a slow engine
 *
 * Every asynchronous path here is fire-and-forget from {@link commit}, so the
 * order results arrive in is the engine's business, not the store's. With an
 * in-process engine that resolves in a microtask, arrival order and issue order
 * are the same thing. Over a wire they are not: two publishes to one marking
 * can land out of order, and the older one would otherwise win by arriving
 * last. Each asynchronous path therefore carries its own latest-wins guard:
 *
 * - Markings: a per-marking sequence. Every write changes one of the marking's
 *   two layers (see {@link recompose}) and composes the marking again, and only
 *   the newest composition commits, so an older answer never lands over a newer
 *   layer and a hung call holds nothing up;
 * - Each level rollup and each whole rollup: a revision;
 * - Facet refreshes: a per-marking revision.
 *
 * Every superseded call is also aborted through the `signal` its adapter option
 * bag carries, so a remote engine stops paying for answers the store has
 * already decided to discard. A local engine ignores the signal and nothing
 * about the guards changes.
 */

import { acceptedValue, judgedAsHeld, keepsSource } from '../loaded-value';
import type {
    Assertion,
    ProcessingContext,
    Suggestion,
    Warning,
} from '@ezclassify/types';
import {
    assertionFactKey,
    assertionOriginKey,
    takenFromWhole,
    withoutTakenFromWhole,
} from '../assertion-identity';
// Type-only import: `ezclassify-store.ts` subclasses this module's
// `BaseEzClassifyStore` (its `VanillaEzClassifyStore`), so any runtime
// import back into it would make the cycle real and TDZ the class binding.
// Runtime helpers come from ./store-shared, which imports no store class.
import type {
    EzClassifyAggregate,
    EzClassifyState,
    EzClassifyStore,
    EzClassifyStoreAggregateResult,
    EzClassifyStoreBuckets,
    EzClassifyStoreEngine,
    EzClassifyStoreProcessResult,
    FacetState,
    PublishSource,
} from './ezclassify-store';
import {
    EMPTY_EZCLASSIFY_AGGREGATE,
    EMPTY_EZCLASSIFY_STATE,
    EMPTY_FACET_STATE,
    SOLE_BUCKET,
    destroyedStores,
    facetStateEqual,
    reflectingNativeSeed,
    storeWarnings,
    type BucketKey,
} from './store-shared';

/**
 * Per-category scope routing, resolved once from the engine's scheme metadata.
 * `byCategory` maps a category id to the scope it belongs to; a category absent
 * from the map (or whose scope equals `defaultScope`) is default-scope. The
 * index always resolves: `getSchemeMeta`/`listCategories` are required
 * capabilities (validated in the constructor), so there is no "scope routing
 * off" state; a scheme that declares no scopes simply yields an empty
 * `byCategory`, routing everything to the default scope by data rather than by
 * a missing-capability fallback.
 */
interface ScopeIndex {
    defaultScope: string | undefined;
    byCategory: Map<string, string>;
}

/**
 * One bucket's engine and what the store has read from its scheme metadata. The
 * scheme a bucket reads by does not change over the store's lifetime, so each
 * value is read once.
 */
interface ResolvedBucket {
    engine: EzClassifyStoreEngine;
    /**
     * The format the bucket's whole markings are written in, if the host names
     * one.
     */
    format?: string;
    /** `null` until first read. */
    scopeIndex: ScopeIndex | null;
    /** `undefined` until read, `null` when the scheme names none. */
    partFormat: string | null | undefined;
    /** `undefined` until read, `null` when the scheme names none. */
    wholeFormat: string | null | undefined;
}

/** A level of the rollup tree: a collection id, or `null` for the page. */
type LevelId = string | null;

const pendingAggregates = new WeakSet<EzClassifyAggregate>();

/**
 * Whether this view holds a previous result while the store waits for an
 * answer.
 */
export function isAggregatePending(aggregate: EzClassifyAggregate): boolean {
    return pendingAggregates.has(aggregate);
}

/** What one level rollup sends the engine, per bucket. */
interface LevelInputs {
    /** Contributor fact sets per bucket, in document order. */
    sets: Map<BucketKey, Assertion[][]>;
    /**
     * Buckets missing a contributor: a failed read, a partial read, a held
     * rollup.
     */
    stale: Set<BucketKey>;
}

/**
 * A comparable reading of a rolled-up state: what a listener or a parent level
 * would see change.
 */
function rollupDigest(state: EzClassifyState): string {
    return JSON.stringify([
        state.rendered,
        state.valid,
        state.stale === true,
        state.assertions.map(assertionFactKey),
        state.errors,
        state.displayColor ?? null,
    ]);
}

function aggregateDigest(aggregate: EzClassifyAggregate): string {
    return JSON.stringify(
        [...aggregate.byBucket]
            .sort(([left], [right]) =>
                left < right ? -1 : left > right ? 1 : 0,
            )
            .map(([bucket, state]) => [bucket, rollupDigest(state)]),
    );
}

function isEmptyState(state: EzClassifyState): boolean {
    return state.rendered === '' && state.assertions.length === 0;
}

/**
 * Split assertions into the default-scope set (safe to carry in the banner
 * projection) and the alternate-scope set (carried into committed state
 * untouched).
 *
 * @param assertions - The incoming assertions to route.
 * @param index - Resolved scope routing.
 * @returns The two disjoint assertion lists.
 */
function partitionByScope(
    assertions: Assertion[],
    index: ScopeIndex,
): { defaultScopeAssertions: Assertion[]; scopedAssertions: Assertion[] } {
    const defaultScopeAssertions: Assertion[] = [];
    const scopedAssertions: Assertion[] = [];
    for (const a of assertions) {
        const scope = index.byCategory.get(a.categoryId);
        // A category with no explicit scope, or one whose scope is the default
        // scope, is default-scope. An unknown category (not in the scheme) is
        // treated as default-scope so an out-of-scheme assertion still renders
        // rather than being silently withheld from the banner round-trip.
        if (scope === undefined || scope === index.defaultScope) {
            defaultScopeAssertions.push(a);
        } else {
            scopedAssertions.push(a);
        }
    }
    return { defaultScopeAssertions, scopedAssertions };
}

/**
 * Compare assertion sets by their authored semantic fields. Ordering is not
 * significant, and engine-added provenance does not make a committed marking a
 * correction. A changed category, concept, or captured value does.
 */
function assertionSetsEqual(left: Assertion[], right: Assertion[]): boolean {
    if (left.length !== right.length) return false;
    const signatures = (assertions: Assertion[]): string[] =>
        assertions.map(assertionFactKey).sort();
    const leftSignatures = signatures(left);
    const rightSignatures = signatures(right);
    return leftSignatures.every(
        (signature, index) => signature === rightSignatures[index],
    );
}

/**
 * Categories whose facts or assertion origins changed. A category present in
 * one set and missing from the other can be an explicit clear.
 */
function changedCategories(base: Assertion[], next: Assertion[]): Set<string> {
    const signaturesByCategory = (
        assertions: Assertion[],
    ): Map<string, string> => {
        const byCategory = new Map<string, string[]>();
        for (const a of assertions) {
            const list = byCategory.get(a.categoryId);
            const signature = assertionOriginKey(a);
            if (list) list.push(signature);
            else byCategory.set(a.categoryId, [signature]);
        }
        const flattened = new Map<string, string>();
        for (const [categoryId, list] of byCategory)
            flattened.set(categoryId, list.sort().join('|'));
        return flattened;
    };
    const baseSignatures = signaturesByCategory(base);
    const nextSignatures = signaturesByCategory(next);
    const changed = new Set<string>();
    for (const [categoryId, signature] of nextSignatures)
        if (baseSignatures.get(categoryId) !== signature)
            changed.add(categoryId);
    for (const categoryId of baseSignatures.keys())
        if (!nextSignatures.has(categoryId)) changed.add(categoryId);
    return changed;
}

/**
 * `base` with the assertions of every category `taken` selects replaced by that
 * category's assertions in `from`.
 */
function withCategoriesFrom(
    base: Assertion[],
    from: Assertion[],
    taken: (categoryId: string) => boolean,
): Assertion[] {
    return [
        ...base.filter((a) => !taken(a.categoryId)),
        ...from.filter((a) => taken(a.categoryId)),
    ];
}

const abortedComposition = Symbol('aborted composition');

/**
 * The engine's answer, or a sentinel as soon as `signal` aborts. A superseded
 * or torn-down composition settles at once even when the engine ignores the
 * signal and never answers. A synchronous answer passes straight through, so
 * the in-process engine keeps its single microtask.
 */
function answerOrAbort<T>(
    answer: T | PromiseLike<T>,
    signal: AbortSignal,
): T | Promise<T | typeof abortedComposition> {
    if (!isPromiseLike(answer)) return answer;
    return new Promise((resolve, reject) => {
        const abort = () => resolve(abortedComposition);
        answer.then(
            (value) => {
                signal.removeEventListener('abort', abort);
                resolve(value);
            },
            (error: unknown) => {
                signal.removeEventListener('abort', abort);
                reject(error);
            },
        );
        if (signal.aborted) abort();
        else signal.addEventListener('abort', abort, { once: true });
    });
}

function isPromiseLike<T>(value: T | PromiseLike<T>): value is PromiseLike<T> {
    return (
        typeof (value as { then?: unknown } | null | undefined)?.then ===
        'function'
    );
}

function stateSemanticSignature(state: EzClassifyState): string {
    // Serialize each row once and sort on the stored key. The comparator used
    // to stringify both operands on every comparison, which is O(n log n)
    // serializations of the same rows on a per-commit path. Same key, same
    // order, same output string.
    const keyed = state.assertions.map((assertion) => {
        const row = [
            assertion.categoryId,
            assertion.conceptId,
            assertion.value ?? null,
        ];
        return { row, key: assertionFactKey(assertion) };
    });
    keyed.sort((left, right) => left.key.localeCompare(right.key));
    const renders = Object.entries(state.renders).sort(([left], [right]) =>
        left.localeCompare(right),
    );
    return JSON.stringify([
        state.rendered,
        renders,
        keyed.map((entry) => entry.row),
        state.aggregate === true,
    ]);
}

/**
 * Each store's idle watch: whether a composition is on the wire, and who is
 * waiting for the last one to finish. Kept beside the class instead of on it so
 * the waiting stays inside this package; see {@link runWhenStoreIdle}.
 */
const idleWatches = new WeakMap<
    object,
    {
        busy: () => boolean;
        composing: (id: string) => boolean;
        waiting: Set<() => void>;
    }
>();

/**
 * Whether a composition for marking `id` is on the wire in `store`. Always
 * false for a store other than {@link BaseEzClassifyStore}.
 *
 * Package-internal: not part of the `@ezclassify/ui` entry.
 */
export function isMarkingComposing(store: object, id: string): boolean {
    return idleWatches.get(store)?.composing(id) ?? false;
}

/**
 * Run `run` once `store` has no marking composition on the wire.
 *
 * A view that reads several markings' committed values at once reads them
 * consistently only while none of them is being read again. A store other than
 * {@link BaseEzClassifyStore} offers no such signal and counts as idle.
 *
 * The store returns to idle when its last composition ends, and a waiter that
 * finds another one started by then waits again. Compositions start on seeds
 * and publishes, which follow the page's hosts and the user's actions, and each
 * engine call answers in bounded time (see {@link EzClassifyStoreEngine}), so
 * the waiting ends once those stop; there is no timer.
 *
 * Package-internal: not part of the `@ezclassify/ui` entry.
 *
 * @returns True when the store is idle now and `run` was not queued; false when
 *   `run` will be called once, after the store's next return to idle.
 */
export function runWhenStoreIdle(store: object, run: () => void): boolean {
    const watch = idleWatches.get(store);
    if (!watch?.busy()) return true;
    watch.waiting.add(run);
    return false;
}

/**
 * The engine capabilities a store must have to guarantee lossless transport,
 * paired with why each one is load-bearing. A missing member means the store
 * would have to fall back to a rendered-string path that silently drops
 * alternate-scope categories and capture-value free text; so the store refuses
 * to construct instead.
 */
const REQUIRED_CAPABILITIES: ReadonlyArray<{
    name: keyof EzClassifyStoreEngine;
    why: string;
}> = [
    {
        name: 'aggregateAssertions',
        why: 'rollup must run over structured assertion sets; aggregating rendered strings drops alternate-scope categories and capture values',
    },
    {
        name: 'getSchemeMeta',
        why: 'scope routing needs the scheme default scope; without it every assertion routes through the lossy banner round-trip',
    },
    {
        name: 'listCategories',
        why: 'scope routing needs each category’s scopes; without it every assertion routes through the lossy banner round-trip',
    },
];

/**
 * Validate that an engine can back a lossless store. Throws a clear error
 * naming the first missing capability and why it matters. A store that cannot
 * be lossless must not run, so the constructor refuses it rather than falling
 * back to rendered strings.
 *
 * @param engine - The candidate engine.
 * @throws {Error} If any required capability is absent.
 */
function assertLosslessCapabilities(engine: EzClassifyStoreEngine): void {
    const members = engine as unknown as Record<string, unknown>;
    for (const { name, why } of REQUIRED_CAPABILITIES) {
        if (typeof members[name] !== 'function') {
            throw new Error(
                `[ezclassify] EzClassifyStore requires engine.${name}(): ${why}. ` +
                    'The store refuses to run on an engine that would force a lossy ' +
                    'render-as-transport fallback. Provide a SchemeEngineAdapter (or an ' +
                    'adapter implementing this capability) to construct the store.',
            );
        }
    }
}

/**
 * A single reactive value cell. The adapter decides the backing primitive
 * (plain field, Vue `Ref`, Angular `WritableSignal`); the base store only reads
 * and writes through this interface, so it never touches the framework's
 * reactivity directly.
 */
export interface ReactiveCell<T> {
    get(): T;
    set(value: T): void;
}

interface MarkingListener {
    fn: (state: EzClassifyState) => void;
    source?: PublishSource;
}

interface MarkingEntry {
    cell: ReactiveCell<EzClassifyState>;
    listeners: Set<MarkingListener>;
}

/** A layer stated as text, with its reading once the engine has read it. */
interface TextLayer {
    text: string;
    /** The reading, including source completeness, before category edits. */
    read?: EzClassifyState;
}

/** A layer stated as assertions. */
interface AssertionLayer {
    assertions: Assertion[];
}

/**
 * The two layers a marking commits. The baseline is what its host was served
 * with, and only a seed sets it. The edit layer is what users and applications
 * wrote, and only a publish changes it.
 */
interface MarkingLayers {
    baseline?: TextLayer | AssertionLayer;
    edits: {
        /**
         * Separate contributors for a computed marking, before an explicit
         * edit.
         */
        aggregate?: Assertion[][];
        /** The latest rendered edit, which restates the whole default scope. */
        rendered?: TextLayer;
        /**
         * Per category, what the latest assertion edit gave it. An empty list
         * clears the category.
         */
        categories: Map<string, Assertion[]>;
    };
}

/** What one composition sends the engine. */
type Composition =
    | { kind: 'empty' }
    | { kind: 'aggregate'; contributors: Assertion[][] }
    | { kind: 'text'; layer: TextLayer; scoped: Assertion[] }
    | { kind: 'unread'; layer: TextLayer }
    | { kind: 'blocked'; layer: TextLayer; scoped: Assertion[] }
    | { kind: 'assertions'; assertions: Assertion[] };

/** The publish that asked for a composition, so its view can be told. */
interface Trigger {
    source?: PublishSource;
    rendered?: string;
    assertions?: Assertion[];
    readNative?: () => string;
}

/** The sequence and abort signal one composition travels with. */
interface PublishTicket {
    sequence: number;
    signal: AbortSignal;
}

/**
 * One engine read of a marking value, split around its single suspension point.
 * The caller awaits `answer` exactly once and passes the result to `settle`, so
 * a composition costs one microtask per engine answer however the read is
 * shared (see {@link BaseEzClassifyStore.rollupResult} for why the count
 * matters).
 */
interface MarkingRead {
    answer:
        EzClassifyStoreProcessResult | Promise<EzClassifyStoreProcessResult>;
    settle(result: EzClassifyStoreProcessResult): EzClassifyState;
}

/**
 * One category facet of one marking: the cell holding its allowability +
 * selection state, and the listeners that mirror that cell through the
 * framework-neutral {@link EzClassifyStore.subscribeFacet} contract.
 */
interface FacetEntry {
    cell: ReactiveCell<FacetState>;
    listeners: Set<(state: FacetState) => void>;
    /**
     * Whether the cell holds the answer for the marking's latest commit, or the
     * refresh computing that answer is on the wire. `false` until
     * {@link BaseEzClassifyStore.refreshFacets} has written an answer, and
     * `false` again once a refresh passes the entry over because nobody is
     * listening, since the cell then keeps an answer computed for an earlier
     * state. A refresh passes over every unlistened entry, including one run
     * for another category's first listener with no new commit behind it; the
     * cost is one recompute when the entry is next subscribed, which is what a
     * new subscriber cost before entries were kept.
     *
     * The cell is seeded with `EMPTY_FACET_STATE`, which is a legitimate
     * computed answer as well (an engine with no suggest capability produces
     * exactly it), so the diff guard needs to know the difference between "not
     * current" and "current and unchanged". Without this a facet on such an
     * engine would never see its first notification, and a listener arriving
     * after a commit it missed would be handed the earlier state's answer.
     */
    current: boolean;
}

/**
 * Engine-facing base for the framework store adapters. Subclasses implement
 * `createCell` (the only framework-specific seam) and may override `onDestroy`
 * to control teardown-time cell writes.
 */
export abstract class BaseEzClassifyStore implements EzClassifyStore {
    private readonly buckets: EzClassifyStoreBuckets;
    private readonly resolvedBuckets = new Map<BucketKey, ResolvedBucket>();
    /**
     * Markings `setBucket` placed; every other marking is in the default
     * bucket.
     */
    private readonly bucketByMarking = new Map<string, BucketKey>();

    private readonly markings = new Map<string, MarkingEntry>();
    /**
     * Markings that have committed at least once. A seeded or published marking
     * that has not is still reading its first value, and a rollup over it would
     * be a rollup of an incomplete contributor set.
     */
    private readonly committedMarkings = new Set<string>();
    /**
     * Markings whose read failed before they ever committed. They count as
     * settled, so a rollup is not held for an answer that is not coming, and a
     * rollup computed without them is flagged stale.
     */
    private readonly failedMarkings = new Set<string>();
    /**
     * Contributors that read only part of their source, each with the whole it
     * rolls up into, as `setIncompleteContributor` records them. They flag
     * their rollups stale the way a failed read does; unlike one, they still
     * commit what they read, so they never hold a rollup.
     */
    private readonly incompleteContributors = new Map<string, string | null>();
    /** Rollups asked for while a contributor was unsettled. */
    private readonly heldWholeRollups = new Set<string>();
    private readonly heldLevels = new Set<LevelId>();
    /** Levels whose pending notification must be followed by a settled one. */
    private readonly pendingLevelNotifications = new Set<LevelId>();
    private readonly entryLists = new Map<string, readonly string[]>();
    private readonly entryListListeners = new Map<
        string,
        Set<{
            listener: (ids: readonly string[]) => void;
            source?: PublishSource;
        }>
    >();
    /** Each declared collection with its parent, `null` for the page. */
    private readonly collections = new Map<string, string | null>();
    /** Wholes `setMembership` placed in a collection. */
    private readonly membershipByMarking = new Map<string, string>();
    private readonly noRollupMarkings = new Set<string>();
    /** Document order of node ids; `null` orders them by id. */
    private documentOrder: ((left: string, right: string) => number) | null =
        null;
    /**
     * One cell per level a view reads: the page (`null`), each collection, and
     * each whole whose parts rollup is read through `getAggregate`.
     */
    private readonly levelCells = new Map<
        LevelId,
        ReactiveCell<EzClassifyAggregate>
    >();
    private readonly levelListeners = new Map<
        LevelId,
        Set<(aggregate: EzClassifyAggregate) => void>
    >();
    private readonly partOfByMarking = new Map<string, string>();
    /** Parts with no whole on the page: see {@link setStandalonePart}. */
    private readonly standaloneParts = new Set<string>();
    /**
     * The output a marking's `rendered` is written in when the field that owns
     * it names one: see {@link setRenderedOutput}.
     */
    private readonly renderedOutputs = new Map<string, string>();
    /**
     * Observed context provenance is positive evidence of dependence, including
     * a stand-in that takes the whole's list. Absence cannot prove
     * independence; only the canonical metadata's explicit false permits that
     * optimization.
     */
    private readonly standInParts = new Set<string>();
    private readonly wholeRollupCells = new Map<
        string,
        ReactiveCell<EzClassifyState>
    >();
    private readonly wholeRollupListeners = new Map<
        string,
        Set<(state: EzClassifyState) => void>
    >();
    /** Latest-wins guards for asynchronous rollup computations. */
    private readonly levelRevisions = new Map<LevelId, number>();
    private readonly wholeRollupRevisions = new Map<string, number>();
    /** Latest-wins guard for the per-marking facet fan-out. */
    private readonly facetRevisions = new Map<string, number>();
    /** Each marking's baseline and edit layer; see {@link recompose}. */
    private readonly layers = new Map<string, MarkingLayers>();
    /**
     * The last composition sequence handed out per marking. Only a composition
     * holding it may commit.
     */
    private readonly publishSequences = new Map<string, number>();
    /** Markings with a facet listener waiting for a current answer. */
    private readonly facetsAwaitingRefresh = new Set<string>();
    /** Abort handles for the superseded call on each asynchronous path. */
    private readonly publishAborts = new Map<string, AbortController>();
    private readonly facetAborts = new Map<string, AbortController>();
    private readonly wholeRollupAborts = new Map<string, AbortController>();
    private readonly levelAborts = new Map<LevelId, AbortController>();
    /**
     * Facet state: markingId → categoryId → cell + listeners. The cell is the
     * state; the listener set is a view over it, so a framework that can read
     * the cell directly needs no mirror of its own.
     *
     * An entry outlives its last listener so its cell keeps the last computed
     * answer and a picker that remounts on the same category does not flash the
     * show-all fallback. Each entry holds a framework reactive primitive, so a
     * store that cycles through many markings accumulates one cell per
     * (marking, category) until {@link destroy}. `refreshFacets` still only
     * recomputes categories that currently have a listener, so the round-trip
     * budget is unchanged.
     */
    private readonly facetEntries = new Map<string, Map<string, FacetEntry>>();
    /**
     * Outputs this store's views asked for, per marking, with how many requests
     * hold each. A publish names exactly these (see {@link requestOutput}).
     */
    private readonly outputRequests = new Map<string, Map<string, number>>();
    /** Last canonical correction delivered to each publishing view, by marking. */
    private readonly sourceReconciliations = new Map<
        unknown,
        Map<string, string>
    >();
    protected destroyed = false;

    /**
     * @param engines - The engine every marking is read by, or `{ buckets }`
     *   when markings are read in several buckets (see
     *   {@link EzClassifyStoreBuckets}).
     * @param options.format - The format whole markings are written in, for a
     *   store over one engine. With `buckets`, each bucket names its own.
     * @throws When an engine lacks a capability lossless transport needs, or
     *   `format` is given with `buckets`.
     */
    constructor(
        engines: EzClassifyStoreEngine | { buckets: EzClassifyStoreBuckets },
        options?: { format?: string },
    ) {
        if ('buckets' in engines) {
            if (options?.format !== undefined) {
                throw new Error(
                    '[ezclassify] EzClassifyStore: with buckets, each bucket names its own format; the store-wide format option does not apply.',
                );
            }
            this.buckets = engines.buckets;
        } else {
            const sole = { engine: engines, format: options?.format };
            this.buckets = {
                defaultBucket: SOLE_BUCKET,
                resolve: (bucket) => {
                    if (bucket !== SOLE_BUCKET) {
                        throw new Error(
                            '[ezclassify] EzClassifyStore: a store over one engine holds only its sole bucket.',
                        );
                    }
                    return sole;
                },
            };
            // Refused at construction, before any marking needs it.
            this.resolveBucket(SOLE_BUCKET);
        }
        this.levelCells.set(null, this.createCell(EMPTY_EZCLASSIFY_AGGREGATE));
        idleWatches.set(this, {
            busy: () => this.publishAborts.size > 0,
            composing: (id) => this.publishAborts.has(id),
            waiting: new Set(),
        });
    }

    /**
     * Build a reactive cell seeded with `initial`. The single framework seam,
     * React returns a plain-field cell, Vue a `Ref`-backed cell, Angular a
     * `WritableSignal`-backed cell.
     *
     * Generic in the value type: marking, aggregate, and whole-rollup cells
     * hold an {@link EzClassifyState}, facet cells hold a {@link FacetState}. A
     * framework primitive does not care which, and an adapter that could
     * produce a cell for only one of them would force the other back into a
     * hand-rolled mirror.
     */
    protected abstract createCell<T>(initial: T): ReactiveCell<T>;

    /**
     * Adapter-specific teardown name used in the destroyed-store error message
     * (e.g. `[ezclassify/react] ReactEzClassifyStore`). Normalized to a single
     * convention across adapters.
     */
    protected abstract storeLabel(): string;

    /**
     * Hook invoked at the end of {@link destroy}, before the internal maps are
     * cleared, while cells still hold their values. Default zeroes the level
     * and whole-rollup cells. Angular overrides this to a no-op: writing a
     * signal during teardown re-triggers its effect scheduler, which re-enters
     * a destroyed store. The component tree is going away anyway.
     */
    protected onDestroy(): void {
        for (const cell of this.levelCells.values())
            cell.set(EMPTY_EZCLASSIFY_AGGREGATE);
        for (const cell of this.wholeRollupCells.values())
            cell.set(EMPTY_EZCLASSIFY_STATE);
    }

    /**
     * Live cell for the marking. Subclasses expose this through their own typed
     * accessor.
     */
    protected markingCell(id: string): ReactiveCell<EzClassifyState> {
        return this.ensureEntry(id).cell;
    }

    /**
     * Live cell for a level's rollup: the page when `nodeId` is omitted, else a
     * collection, or a whole for its parts rollup (see {@link getAggregate}).
     */
    protected aggregateStateCell(
        nodeId?: string,
    ): ReactiveCell<EzClassifyAggregate> {
        return this.ensureLevelCell(nodeId ?? null);
    }

    /** Live cell for a per-whole rollup. */
    protected wholeRollupCell(wholeId: string): ReactiveCell<EzClassifyState> {
        return this.ensureWholeRollupCell(wholeId);
    }

    /**
     * Live cell for one category facet of a marking. Parallel to
     * {@link markingCell} / {@link aggregateStateCell} / {@link wholeRollupCell};
     * subclasses expose it through their own typed accessor so a framework
     * binding can project the facet instead of mirroring it.
     *
     * The cell is written by {@link refreshFacets}, which only recomputes
     * categories that currently have a `subscribeFacet` listener. A binding
     * that wants a live cell therefore keeps a subscription open for as long as
     * it reads one; `createEzClassifyFacetBinding` does exactly that, which is
     * why all three framework projections sit on top of it.
     */
    protected facetCell(
        markingId: string,
        categoryId: string,
    ): ReactiveCell<FacetState> {
        return this.ensureFacetEntry(markingId, categoryId).cell;
    }

    get(id: string): EzClassifyState {
        return this.markings.get(id)?.cell.get() ?? EMPTY_EZCLASSIFY_STATE;
    }

    subscribe(
        id: string,
        listener: (state: EzClassifyState) => void,
        source?: PublishSource,
    ): () => void {
        this.assertAlive();
        const entry = this.ensureEntry(id);
        const wrapped: MarkingListener = { fn: listener, source };
        entry.listeners.add(wrapped);
        return () => {
            entry.listeners.delete(wrapped);
        };
    }

    requestOutput(id: string, output: string): () => void {
        this.assertAlive();
        this.assertDeclaredOutput(id, output, 'requestOutput');
        let held = this.outputRequests.get(id);
        if (!held) {
            held = new Map();
            this.outputRequests.set(id, held);
        }
        held.set(output, (held.get(output) ?? 0) + 1);
        let released = false;
        return () => {
            if (released) return;
            released = true;
            const current = this.outputRequests.get(id);
            const count = current?.get(output);
            if (!current || count === undefined) return;
            if (count > 1) current.set(output, count - 1);
            else current.delete(output);
            if (current.size === 0) this.outputRequests.delete(id);
        };
    }

    /** Throw unless the scheme of `id`'s bucket declares `output`. */
    private assertDeclaredOutput(
        id: string,
        output: string,
        caller: string,
    ): void {
        const declared = (
            this.bucketOf(id).engine.getSchemeMeta().formats ?? []
        ).map((layout) => layout.id);
        if (declared.includes(output)) return;
        const listed =
            declared.length > 0
                ? declared.map((one) => `"${one}"`).join(', ')
                : 'none';
        throw new Error(
            `${this.storeLabel()}: ${caller}("${output}") names an output the scheme does not declare. It declares ${listed}.`,
        );
    }

    /**
     * Publish an edit from the rendered side. A rendered banner string is, by
     * definition, **default-scope input**: a banner render format excludes
     * alternate-scope categories, so a string can only ever express the default
     * scope. The string therefore replaces the marking's default scope, and
     * earlier edits to default-scope categories with it; the alternate scope
     * (an authority block, a decommissioning block, …) is **preserved**.
     * Without that carry-through, editing the banner text would silently drop
     * the marking's authority-scope assertions, the same render-as-transport
     * loss `publishAssertions` guards against.
     *
     * An empty string clears the marking entirely (default and alternate
     * scope).
     *
     * The edit lands in the marking's edit layer, on top of whatever its host
     * was seeded with, whenever the seed arrives (see {@link seedRendered}).
     *
     * @returns Resolves once this publish has settled. A publish superseded by
     *   a newer change to the same marking, or cut short by {@link destroy},
     *   resolves without committing rather than rejecting; every other engine
     *   failure rejects.
     */
    publishRendered(
        id: string,
        rendered: string,
        source?: PublishSource,
    ): Promise<void> {
        if (this.destroyed) return Promise.reject(this.destroyedError());
        const unplaced = this.unplacedError(id);
        if (unplaced) return Promise.reject(unplaced);
        this.materializeAggregateEdit(id);
        const { edits } = this.layersOf(id);
        edits.rendered = { text: rendered };
        for (const categoryId of edits.categories.keys()) {
            if (this.isDefaultScope(id, categoryId))
                edits.categories.delete(categoryId);
        }
        // An empty string states nothing in either scope.
        if (!rendered) edits.categories.clear();
        return this.recompose(id, { source, rendered });
    }

    /**
     * Publish an edit from the assertion side.
     *
     * The incoming set is read as a per-category change against the state the
     * caller read: a facet picker publishes the WHOLE marking, read from
     * committed state with its own category swapped. Only the categories that
     * differ from committed state are taken from it, and they replace those
     * categories in the marking's edit layer. Two pickers on one marking
     * therefore never revert each other, even while the first one's round trip
     * is still open: picker B's publish carries picker A's category as it was
     * committed, which is not a change, so A's edit stands.
     *
     * A caller that edits known categories, such as a facet picker, names them
     * in `options.categories`. Each named category is then replaced by exactly
     * the assertions given for it, even where they equal what the caller read,
     * so putting back the value on screen while another write is still on the
     * wire is an edit too. Categories not named are ignored, and an empty list
     * names none, which is the same as leaving the option out.
     *
     * A category edit cannot replace text the engine could not read with the
     * part it did read. It retains that text and reconciles the picker to the
     * held assertions; the text must be corrected through a rendered publish
     * first. A fully read text that breaks a rule takes category edits.
     *
     * Capture values travel on the assertions, and alternate-scope categories
     * bypass the engine as always (see `readAssertions`).
     *
     * @returns Resolves once this publish has settled. A publish superseded by
     *   a newer change to the same marking, or cut short by {@link destroy},
     *   resolves without committing rather than rejecting; every other engine
     *   failure rejects.
     */
    publishAssertions(
        id: string,
        assertions: Assertion[],
        source?: PublishSource,
        options?: { categories?: readonly string[] },
    ): Promise<void> {
        if (this.destroyed) return Promise.reject(this.destroyedError());
        const unplaced = this.unplacedError(id);
        if (unplaced) return Promise.reject(unplaced);
        // A field that read this part against its whole says so before the
        // engine answers, so a whole that changes meanwhile reads it again.
        if (assertions.some(takenFromWhole)) this.standInParts.add(id);
        const { edits } = this.layersOf(id);
        const stated = options?.categories?.length
            ? options.categories
            : changedCategories(this.get(id).assertions, assertions);
        for (const categoryId of stated) {
            edits.categories.set(
                categoryId,
                assertions.filter((a) => a.categoryId === categoryId),
            );
        }
        return this.recompose(id, { source, assertions });
    }

    /** Publish separate contributors through the engine's aggregate operation. */
    publishAggregate(
        id: string,
        assertionSets: Assertion[][],
        source?: PublishSource,
    ): Promise<void> {
        if (this.destroyed) return Promise.reject(this.destroyedError());
        const unplaced = this.unplacedError(id);
        if (unplaced) return Promise.reject(unplaced);
        const { edits } = this.layersOf(id);
        edits.aggregate = assertionSets.map((set) => [...set]);
        delete edits.rendered;
        edits.categories.clear();
        return this.recompose(id, { source });
    }

    /** A later explicit edit starts from the computed value the author saw. */
    private materializeAggregateEdit(id: string): void {
        const { edits } = this.layersOf(id);
        if (!edits.aggregate) return;
        delete edits.aggregate;
        edits.categories.clear();
        for (const assertion of this.get(id).assertions) {
            const values = edits.categories.get(assertion.categoryId) ?? [];
            values.push(assertion);
            edits.categories.set(assertion.categoryId, values);
        }
    }

    /**
     * Seed a marking with the rendered value its host was served with.
     *
     * The seed is the marking's baseline, not an edit. The marking commits the
     * baseline with its edit layer on top, so a pick made before the seed,
     * while it is on the wire, or after it lands composes the same way: the
     * pick is kept, and so is every served category nobody edited. A later seed
     * replaces the baseline and keeps the edits.
     *
     * A rendered value states only the default scope, so a rendered baseline
     * contributes no alternate scope. The runtime seeds every marking host once
     * its fields have initialized.
     *
     * @returns Resolves once this seed's own composition has settled. A newer
     *   edit may still be landing on top; a seed superseded by one, or cut
     *   short by {@link destroy}, resolves without committing. An engine failure
     *   rejects.
     */
    seedRendered(id: string, rendered: string): Promise<void> {
        if (this.destroyed) return Promise.reject(this.destroyedError());
        const unplaced = this.unplacedError(id);
        if (unplaced) return Promise.reject(unplaced);
        this.layersOf(id).baseline = { text: rendered };
        return this.recompose(id);
    }

    /** @internal Seed a native field, checking that its served text still holds. */
    seedRenderedFromHost(id: string, readNative: () => string): Promise<void> {
        if (this.destroyed) return Promise.reject(this.destroyedError());
        const unplaced = this.unplacedError(id);
        if (unplaced) return Promise.reject(unplaced);
        this.layersOf(id).baseline = { text: readNative() };
        return this.recompose(id, { readNative });
    }

    /**
     * Compose the served text and native selections in the same seed.
     *
     * @internal
     */
    seedRenderedWithFacets(
        id: string,
        rendered: string,
        facets: ReadonlyMap<string, Assertion[]>,
    ): Promise<void> {
        if (this.destroyed) return Promise.reject(this.destroyedError());
        const unplaced = this.unplacedError(id);
        if (unplaced) return Promise.reject(unplaced);
        const layers = this.layersOf(id);
        layers.baseline = { text: rendered };
        for (const [category, assertions] of facets)
            layers.edits.categories.set(category, assertions);
        return this.recompose(id);
    }

    /**
     * Seed a marking with assertions its host already carries, such as the
     * leading mark a body editor parsed. Same contract as {@link seedRendered};
     * an assertion baseline contributes both scopes.
     */
    seedAssertions(id: string, assertions: Assertion[]): Promise<void> {
        if (this.destroyed) return Promise.reject(this.destroyedError());
        const unplaced = this.unplacedError(id);
        if (unplaced) return Promise.reject(unplaced);
        this.layersOf(id).baseline = { assertions };
        return this.recompose(id);
    }

    /**
     * Release a marking whose host has left the page: drop its baseline and its
     * edits and commit the empty marking, under a composition newer than
     * anything in flight, so it leaves its rollups and the next seed under the
     * same id starts from its own served value. A runtime torn down over hosts
     * that stay on the page releases nothing; the next runtime seeds the same
     * hosts under the same edits. A destroyed store has nothing to release.
     */
    releaseSeed(id: string): void {
        if (this.destroyed) return;
        this.layers.delete(id);
        void this.recompose(id);
    }

    /**
     * Commit the marking's baseline with its edit layer on top. Every change to
     * either layer calls this, and only the newest call commits: an older one
     * was composed from layers that have since changed.
     *
     * A composition whose default scope is stated by text with no category
     * edits over it sends the text; every other one sends assertions. Either
     * way that is one engine call, the same single suspension point a publish
     * has always had. The one exception is category edits over a text that has
     * not been read yet, which reads the text first and caches the reading on
     * its layer.
     *
     * A composition that fails leaves both layers and the committed value as
     * they were, and the next change composes them again. An engine reports a
     * value it cannot make sense of as an invalid state, not as a failure, so a
     * failure here is the engine being unreachable.
     */
    private async recompose(id: string, trigger: Trigger = {}): Promise<void> {
        let composition = this.compose(id);
        const publish = this.beginPublish(id);
        const awaitRead = <T>(answer: T | PromiseLike<T>) => {
            const result = answerOrAbort(answer, publish.signal);
            if (isPromiseLike(answer) && this.isNewest(id, publish.sequence))
                this.holdLevelForReading(id);
            return result;
        };
        let failed = false;
        try {
            if (composition.kind === 'unread') {
                const { layer } = composition;
                const read = this.readRendered(id, layer.text, publish, []);
                const answer = await awaitRead(read.answer);
                if (
                    answer === abortedComposition ||
                    !this.isNewest(id, publish.sequence)
                )
                    return;
                layer.read = read.settle(answer);
                composition = this.compose(id);
                // Still unread only if the layers changed, and the change that
                // did it composes again.
                if (composition.kind === 'unread') return;
            }
            let state: EzClassifyState;
            if (composition.kind === 'empty') {
                state = EMPTY_EZCLASSIFY_STATE;
            } else if (composition.kind === 'aggregate') {
                const whole = this.wholeContextOf(id);
                const result = await awaitRead(
                    this.bucketOf(id).engine.aggregateAssertions(
                        composition.contributors.map(withoutTakenFromWhole),
                        {
                            outputFormat: this.formatFor(id),
                            signal: publish.signal,
                            ...(whole ? { context: whole } : {}),
                        },
                    ),
                );
                if (
                    result === abortedComposition ||
                    !this.isNewest(id, publish.sequence)
                )
                    return;
                const edits = this.layersOf(id).edits.categories;
                if (edits.size > 0) {
                    // An explicit category edit starts from this contributor
                    // read, including categories a pending aggregate changed.
                    const assertions = withCategoriesFrom(
                        result.assertions,
                        [...edits.values()].flat(),
                        (category) => edits.has(category),
                    );
                    const read = this.readAssertions(id, assertions, publish);
                    const answer = await awaitRead(read.answer);
                    if (answer === abortedComposition) return;
                    state = read.settle(answer);
                } else state = this.fromProcessResult('', result);
            } else if (composition.kind === 'blocked') {
                // A category picker cannot correct text the parser did not
                // account for. Discard the pending category edits and reconcile
                // their sources, rather than silently dropping the unread text.
                const edits = this.layersOf(id).edits;
                for (const category of edits.categories.keys())
                    if (this.isDefaultScope(id, category))
                        edits.categories.delete(category);
                state = {
                    ...composition.layer.read!,
                    assertions: [
                        ...composition.layer.read!.assertions,
                        ...composition.scoped,
                    ],
                };
            } else if (composition.kind === 'text') {
                const { layer, scoped } = composition;
                const read = this.readRendered(id, layer.text, publish, scoped);
                const answer = await awaitRead(read.answer);
                if (answer === abortedComposition) return;
                state = read.settle(answer);
                if (this.isNewest(id, publish.sequence)) {
                    layer.read = {
                        ...state,
                        assertions: state.assertions.filter((a) =>
                            this.isDefaultScope(id, a.categoryId),
                        ),
                    };
                }
            } else {
                const read = this.readAssertions(
                    id,
                    composition.assertions,
                    publish,
                );
                const answer = await awaitRead(read.answer);
                if (answer === abortedComposition) return;
                state = read.settle(answer);
            }
            if (!this.isNewest(id, publish.sequence)) return;
            const restart = this.restartChangedNativeSeed(id, trigger, publish);
            if (restart) return restart;
            this.keepRepairs(id, state);
            // Settled before its commit asks for the rollups it contributes to.
            this.endPublish(id, publish);
            if (trigger.readNative) reflectingNativeSeed.add(state);
            try {
                this.commit(
                    id,
                    state,
                    trigger.source,
                    this.differsFromAsked(state, trigger),
                );
            } finally {
                if (trigger.readNative) reflectingNativeSeed.delete(state);
            }
        } catch (error) {
            // Superseded or torn down: this composition's own signal is
            // aborted, so the store has already decided to throw its answer
            // away. Settling is the contract (see beginPublish); rethrowing
            // would surface a cancellation nobody asked for.
            if (publish.signal.aborted) return;
            const restart = this.restartChangedNativeSeed(id, trigger, publish);
            if (restart) return restart;
            failed = true;
            if (!this.committedMarkings.has(id)) this.failedMarkings.add(id);
            throw error;
        } finally {
            this.endPublish(id, publish);
            // A facet that subscribed without a current answer while this was
            // on the wire waited for its commit; with none coming it is
            // computed now.
            if (failed) {
                this.refreshStaleFacets(id);
                // A first read that failed leaves its rollups missing it, and
                // they say so even when nothing else would compute them again.
                if (this.failedMarkings.has(id))
                    this.recomputeAround(id, this.levelOfWhole(id));
                // No commit is coming to ask for the rollups this read held.
                this.rerunHeldRollups();
            }
        }
    }

    /**
     * A native host can change while its initial read is on the wire. Read the
     * current text without committing the superseded answer. Explicit store
     * edits already have their own publish ticket and take precedence.
     */
    private restartChangedNativeSeed(
        id: string,
        { readNative }: Trigger,
        publish: PublishTicket,
    ): Promise<void> | undefined {
        if (!readNative || !this.isNewest(id, publish.sequence)) return;
        const layers = this.layersOf(id);
        const { baseline, edits } = layers;
        if (
            !baseline ||
            !('text' in baseline) ||
            edits.rendered ||
            edits.aggregate ||
            edits.categories.size > 0
        )
            return;
        const text = readNative();
        if (text === baseline.text) return;
        this.endPublish(id, publish);
        layers.baseline = { text };
        return this.recompose(id, { readNative });
    }

    /**
     * Rewrite each edited default-scope category from what the engine committed
     * for it, so a repair the engine made to an edit (dropping a value the
     * rules do not allow) is what the next composition sends, not the value it
     * repaired. Alternate-scope categories never reach the engine, so there is
     * no repair to keep, and an engine that fills defaults would otherwise add
     * one more to the edit on every commit.
     */
    private keepRepairs(id: string, state: EzClassifyState): void {
        const edits = this.layers.get(id)?.edits;
        if (!edits || edits.categories.size === 0) return;
        for (const categoryId of edits.categories.keys()) {
            if (!this.isDefaultScope(id, categoryId)) continue;
            edits.categories.set(
                categoryId,
                state.assertions.filter((a) => a.categoryId === categoryId),
            );
        }
    }

    /** Whether a composition for the marking is still on the wire. */
    private hasCompositionInFlight(id: string): boolean {
        return this.publishAborts.has(id);
    }

    /**
     * What the marking commits: the default scope from its rendered edit or
     * else its baseline, the alternate scope from an assertion baseline, then
     * each edited category replaced. An empty rendered edit cleared both
     * scopes, so only the categories edited after it remain.
     */
    private compose(id: string): Composition {
        const layers = this.layers.get(id);
        if (!layers) return { kind: 'empty' };
        const { baseline, edits } = layers;
        if (edits.aggregate)
            return { kind: 'aggregate', contributors: edits.aggregate };
        const stated = edits.rendered ?? baseline;
        const editedAssertions = [...edits.categories.values()].flat();
        const editedIn =
            (defaultScope: boolean) =>
            (categoryId: string): boolean =>
                edits.categories.has(categoryId) &&
                this.isDefaultScope(id, categoryId) === defaultScope;
        const baselineScoped =
            baseline && 'assertions' in baseline && edits.rendered?.text !== ''
                ? baseline.assertions.filter(
                      (a) => !this.isDefaultScope(id, a.categoryId),
                  )
                : [];
        const scoped = withCategoriesFrom(
            baselineScoped,
            editedAssertions,
            editedIn(false),
        );
        const editsDefaultScope = [...edits.categories.keys()].some(
            editedIn(true),
        );

        let defaults: Assertion[] = [];
        if (stated && 'assertions' in stated) {
            defaults = stated.assertions.filter((a) =>
                this.isDefaultScope(id, a.categoryId),
            );
        } else if (stated?.text) {
            if (!editsDefaultScope)
                return { kind: 'text', layer: stated, scoped };
            if (stated.read === undefined)
                return { kind: 'unread', layer: stated };
            if (stated.read.recognition?.status !== 'complete')
                return { kind: 'blocked', layer: stated, scoped };
            defaults = stated.read.assertions;
        } else if (
            stated &&
            edits.categories.size === 0 &&
            scoped.length === 0
        ) {
            // An empty value states nothing, so there is nothing to read.
            return { kind: 'empty' };
        }
        return {
            kind: 'assertions',
            assertions: [
                ...withCategoriesFrom(
                    defaults,
                    editedAssertions,
                    editedIn(true),
                ),
                ...scoped,
            ],
        };
    }

    /** Whether a commit should tell its source the result differs from its ask. */
    private differsFromAsked(
        state: EzClassifyState,
        trigger: Trigger,
    ): boolean {
        if (trigger.assertions)
            return !assertionSetsEqual(state.assertions, trigger.assertions);
        if (trigger.rendered !== undefined)
            return state.rendered !== trigger.rendered;
        return false;
    }

    /** The layers of a marking, created empty on first use. */
    private layersOf(id: string): MarkingLayers {
        let layers = this.layers.get(id);
        if (!layers) {
            layers = { edits: { categories: new Map() } };
            this.layers.set(id, layers);
        }
        return layers;
    }

    /** Whether a category belongs to the default scope of the marking's scheme. */
    private isDefaultScope(id: string, categoryId: string): boolean {
        const index = this.resolveScopeIndex(id);
        const scope = index.byCategory.get(categoryId);
        return scope === undefined || scope === index.defaultScope;
    }

    /**
     * Start the engine read of a rendered value. Settling keeps the reading's
     * default scope and adds `scoped`, the marking's alternate scope from its
     * layers: a rendered string cannot express it, so process() cannot have
     * produced it, and dropping it would re-introduce the scope loss.
     */
    private readRendered(
        id: string,
        rendered: string,
        publish: PublishTicket,
        scoped: Assertion[],
    ): MarkingRead {
        const whole = this.wholeContextOf(id);
        const { engine } = this.bucketOf(id);
        const processText = (text: string) =>
            engine.process(text, {
                outputFormat: this.formatFor(id),
                ...this.outputsFor(id),
                ...(whole ? { context: whole } : {}),
                signal: publish.signal,
            });
        return {
            // The marking holds what the engine settles the text on, judged
            // as that value (see judgedAsHeld). A superseded publish is
            // thrown away, so it judges nothing more.
            answer: judgedAsHeld(rendered, processText(rendered), (settled) =>
                publish.signal.aborted
                    ? settled
                    : processText(settled.rendered),
            ),
            settle: (result) => {
                const read = Object.assign(
                    this.fromProcessResult(rendered, result),
                    {
                        // The engine's writing, fixes included, verbatim.
                        rendered: acceptedValue(rendered, result),
                        // Where the author's text stands instead, the engine's
                        // account of its own writing is not about the value.
                        ...(keepsSource(result)
                            ? { assessment: undefined }
                            : {}),
                        // Keep this property even when absent from the response:
                        // receivers distinguish an unproven string read from an
                        // assertion-native state, which has no recognition field.
                        recognition: result.recognition,
                    },
                );
                const defaultScope = read.assertions.filter((a) =>
                    this.isDefaultScope(id, a.categoryId),
                );
                if (this.isNewest(id, publish.sequence)) {
                    this.noteStandIn(
                        id,
                        whole?.partOf !== undefined,
                        defaultScope,
                    );
                }
                if (
                    defaultScope.length !== read.assertions.length ||
                    scoped.length > 0
                )
                    read.assertions = [...defaultScope, ...scoped];
                return read;
            },
        };
    }

    /**
     * Start the engine read of an assertion set.
     *
     * The default-scope subset goes to the engine as a STRUCTURED assertion
     * array; never a rendered string. `engine.process(assertions[])` applies
     * the same repair and inference a render→process round trip would (and the
     * result still carries the banner `rendered` string, computed by the
     * engine), but because nothing ever flattens to a string, capture-value
     * free text on a default-scope assertion (`value: '20301231'`) survives; a
     * banner render emits only concept labels and would drop it. Core pins the
     * semantic equivalence of the string vs assertion-array input in its
     * lossless-transport tests.
     *
     * Alternate-scope assertions bypass the engine entirely: a banner-shaped
     * format excludes their categories, so passing them through would render ""
     * and drop them. Settling carries them straight into the state, untouched.
     */
    private readAssertions(
        id: string,
        intended: Assertion[],
        publish: PublishTicket,
    ): MarkingRead {
        const { defaultScopeAssertions, scopedAssertions } = partitionByScope(
            intended,
            this.resolveScopeIndex(id),
        );
        // A part's values taken from its whole are not sent back: the engine
        // takes them again from the whole as it stands now.
        const whole = this.wholeContextOf(id);
        const { engine } = this.bucketOf(id);
        const processFacts = (assertions: Assertion[]) =>
            engine.process(withoutTakenFromWhole(assertions), {
                outputFormat: this.formatFor(id),
                ...this.outputsFor(id),
                ...(whole ? { context: whole } : {}),
                signal: publish.signal,
            });
        return {
            // A repair the engine made is the marking now, and the marking is
            // judged as it stands (see judgedAsHeld).
            answer: judgedAsHeld(
                defaultScopeAssertions,
                processFacts(defaultScopeAssertions),
                (settled) =>
                    publish.signal.aborted
                        ? settled
                        : processFacts(settled.assertions),
            ),
            settle: (result) => {
                const state = this.fromProcessResult(result.rendered, result);
                if (this.isNewest(id, publish.sequence)) {
                    this.noteStandIn(
                        id,
                        whole?.partOf !== undefined,
                        state.assertions,
                        defaultScopeAssertions,
                    );
                }
                return scopedAssertions.length > 0
                    ? {
                          ...state,
                          assertions: [
                              ...state.assertions,
                              ...scopedAssertions,
                          ],
                      }
                    : state;
            },
        };
    }

    getAggregate(nodeId?: string): EzClassifyAggregate {
        return this.ensureLevelCell(nodeId ?? null).get();
    }

    subscribeAggregate(
        listener: (aggregate: EzClassifyAggregate) => void,
        nodeId?: string,
    ): () => void {
        this.assertAlive();
        const level = nodeId ?? null;
        this.ensureLevelCell(level);
        let listeners = this.levelListeners.get(level);
        if (!listeners) {
            listeners = new Set();
            this.levelListeners.set(level, listeners);
        }
        listeners.add(listener);
        return () => {
            const current = this.levelListeners.get(level);
            if (!current) return;
            current.delete(listener);
            if (current.size === 0) this.levelListeners.delete(level);
        };
    }

    setPartOf(markingId: string, wholeId: string | null): void {
        this.assertAlive();
        const prev = this.partOfByMarking.get(markingId);
        if (wholeId === null || wholeId === '') {
            if (prev === undefined) return;
            this.partOfByMarking.delete(markingId);
            this.standInParts.delete(markingId);
            this.rolesChanged(markingId);
            void this.recomputeWholeRollup(prev);
            // It is a whole of its own again, and contributes to its level.
            void this.recomputeLevel(this.levelOfWhole(markingId));
            return;
        }
        if (prev === wholeId) return;
        this.partOfByMarking.set(markingId, wholeId);
        this.rolesChanged(markingId);
        if (prev && prev !== wholeId) void this.recomputeWholeRollup(prev);
        void this.recomputeWholeRollup(wholeId);
        // A whole that became a part no longer contributes to its level, and
        // the level its new whole sits in now holds a whole with parts.
        if (prev === undefined)
            void this.recomputeLevel(this.levelOfWhole(markingId));
        void this.recomputeLevel(this.levelOfWhole(wholeId));
    }

    setStandalonePart(markingId: string, standalone: boolean): void {
        this.assertAlive();
        if (this.standaloneParts.has(markingId) === standalone) return;
        if (standalone) this.standaloneParts.add(markingId);
        else this.standaloneParts.delete(markingId);
        this.rolesChanged(markingId);
        void this.recomputeLevel(this.levelOfWhole(markingId));
    }

    setRenderedOutput(markingId: string, output: string | null): void {
        // A field torn down after its store has nothing to put back.
        if (this.destroyed && output === null) return;
        this.assertAlive();
        if ((this.renderedOutputs.get(markingId) ?? null) === output) return;
        if (output === null) this.renderedOutputs.delete(markingId);
        else {
            this.assertDeclaredOutput(markingId, output, 'setRenderedOutput');
            this.renderedOutputs.set(markingId, output);
        }
        // What was written in the old output is written again in the new
        // one. An empty marking has nothing to write; its next change is
        // written in the new output.
        this.dropReadings(markingId);
        const held = this.get(markingId);
        if (
            this.hasCompositionInFlight(markingId) ||
            (this.committedMarkings.has(markingId) &&
                (held.assertions.length > 0 || held.rendered !== ''))
        )
            this.recompose(markingId).catch(() => {});
    }

    setBucket(markingId: string, bucket: BucketKey): void {
        this.assertAlive();
        if (this.bucketKeyOf(markingId) === bucket) {
            this.bucketByMarking.set(markingId, bucket);
            return;
        }
        // Refuses a bucket the instance does not hold before anything moves.
        this.resolveBucket(bucket);
        const before = this.levelOfWhole(markingId);
        this.bucketByMarking.set(markingId, bucket);
        // Read by other rules now: what it read before says nothing.
        this.dropReadings(markingId);
        if (this.layers.has(markingId))
            this.recompose(markingId).catch(() => {});
        this.recomputeAround(markingId, before);
    }

    registerCollection(collectionId: string, parentId: string | null): void {
        this.assertAlive();
        if (!collectionId)
            throw new Error(`${this.storeLabel()}: a collection needs an id.`);
        for (
            let level: string | null = parentId;
            level !== null;
            level = this.collections.get(level) ?? null
        ) {
            if (level === collectionId) {
                throw new Error(
                    `${this.storeLabel()}: collection "${collectionId}" cannot be inside itself.`,
                );
            }
        }
        const declared = this.collections.has(collectionId);
        const previousParent = declared
            ? this.parentLevel(collectionId)
            : undefined;
        if (declared && this.collections.get(collectionId) === parentId) return;
        this.collections.set(collectionId, parentId);
        // Its members rolled up into the page while it was undeclared.
        void this.recomputeLevel(collectionId);
        if (previousParent !== undefined)
            void this.recomputeLevel(previousParent);
        void this.recomputeLevel(this.parentLevel(collectionId));
        void this.recomputeLevel(null);
    }

    unregisterCollection(collectionId: string): void {
        this.assertAlive();
        if (!this.collections.has(collectionId)) return;
        const parent = this.parentLevel(collectionId);
        this.collections.delete(collectionId);
        this.levelRevisions.set(
            collectionId,
            (this.levelRevisions.get(collectionId) ?? 0) + 1,
        );
        this.levelAborts.get(collectionId)?.abort();
        this.levelAborts.delete(collectionId);
        this.heldLevels.delete(collectionId);
        this.pendingLevelNotifications.delete(collectionId);
        this.writeLevel(collectionId, EMPTY_EZCLASSIFY_AGGREGATE);
        void this.recomputeLevel(parent);
        void this.recomputeLevel(null);
    }

    setMembership(markingId: string, collectionId: string | null): void {
        this.assertAlive();
        const before = this.levelOfWhole(markingId);
        if ((this.membershipByMarking.get(markingId) ?? null) === collectionId)
            return;
        if (collectionId === null || collectionId === '')
            this.membershipByMarking.delete(markingId);
        else this.membershipByMarking.set(markingId, collectionId);
        const after = this.levelOfWhole(markingId);
        if (after === before) return;
        void this.recomputeLevel(before);
        void this.recomputeLevel(after);
    }

    setNoRollup(markingId: string, noRollup: boolean): void {
        this.assertAlive();
        if (this.noRollupMarkings.has(markingId) === noRollup) return;
        if (noRollup) this.noRollupMarkings.add(markingId);
        else this.noRollupMarkings.delete(markingId);
        this.recomputeAround(markingId, this.levelOfWhole(markingId));
    }

    setDocumentOrder(
        compare: ((left: string, right: string) => number) | null,
    ): void {
        this.assertAlive();
        this.documentOrder = compare;
        for (const wholeId of new Set(this.partOfByMarking.values()))
            void this.recomputeWholeRollup(wholeId);
        for (const level of this.allLevels()) void this.recomputeLevel(level);
    }

    /** @internal */
    setIncompleteContributor(
        contributorId: string,
        wholeId: string | null,
        incomplete: boolean,
    ): void {
        this.assertAlive();
        const recorded = this.incompleteContributors.has(contributorId);
        const previous = this.incompleteContributors.get(contributorId) ?? null;
        if (incomplete) {
            if (recorded && previous === wholeId) return;
            this.incompleteContributors.set(contributorId, wholeId);
        } else {
            if (!recorded) return;
            this.incompleteContributors.delete(contributorId);
        }
        // Computed again rather than only flagged: clearing must also drop a
        // flag a computed value carries, and the computation is held like any
        // other while a contributor is still reading.
        for (const whole of new Set([previous, wholeId])) {
            if (whole === null)
                void this.recomputeLevel(this.levelOfWhole(contributorId));
            else {
                void this.recomputeWholeRollup(whole);
                void this.recomputeLevel(this.levelOfWhole(whole));
            }
        }
    }

    getWholeRollup(wholeId: string): EzClassifyState {
        return this.ensureWholeRollupCell(wholeId).get();
    }

    subscribeWholeRollup(
        wholeId: string,
        listener: (state: EzClassifyState) => void,
    ): () => void {
        this.assertAlive();
        let set = this.wholeRollupListeners.get(wholeId);
        if (!set) {
            set = new Set();
            this.wholeRollupListeners.set(wholeId, set);
        }
        set.add(listener);
        return () => {
            const s = this.wholeRollupListeners.get(wholeId);
            if (!s) return;
            s.delete(listener);
            if (s.size === 0) this.wholeRollupListeners.delete(wholeId);
        };
    }

    getFacet(markingId: string, categoryId: string): FacetState {
        return (
            this.facetEntries.get(markingId)?.get(categoryId)?.cell.get() ??
            EMPTY_FACET_STATE
        );
    }

    subscribeFacet(
        markingId: string,
        categoryId: string,
        listener: (state: FacetState) => void,
    ): () => void {
        this.assertAlive();
        const entry = this.ensureFacetEntry(markingId, categoryId);
        entry.listeners.add(listener);
        // Replay the computed answer to a listener that arrives after it. A
        // facet entry outlives its listeners, and `refreshFacets` skips a
        // category whose state has not changed, so without this a second view
        // on an already-current facet would never be told anything: it would
        // sit on the show-all fallback and its readiness signal would never
        // settle. Only a current entry replays. When a commit's refresh is
        // still on the wire, the replay is the previous answer and the refresh
        // follows it with the new one. A fresh facet, or one whose answer
        // predates a commit made while nobody listened (a control remounted by
        // the very change it depends on), is computed for its listener instead.
        if (entry.current) listener(entry.cell.get());
        else this.refreshFacetsSoon(markingId);
        return () => {
            const byCategory = this.facetEntries.get(markingId);
            byCategory?.get(categoryId)?.listeners.delete(listener);
        };
    }

    /**
     * Current immutable ordered entry list; markings remain in the normal
     * store.
     */
    getEntryIds(editorId: string): readonly string[] | undefined {
        return this.entryLists.get(editorId);
    }

    /**
     * Commit an editor's entry list without parsing text or duplicating marking
     * state.
     */
    setEntryIds(
        editorId: string,
        entryIds: readonly string[],
        source?: PublishSource,
    ): void {
        this.assertAlive();
        if (
            !editorId ||
            entryIds.some(
                (id) => typeof id !== 'string' || !id.trim() || id === editorId,
            ) ||
            new Set(entryIds).size !== entryIds.length
        ) {
            throw new Error(
                'Marking entries require unique nonempty IDs distinct from their editor.',
            );
        }
        const previous = this.getEntryIds(editorId);
        if (
            previous &&
            previous.length === entryIds.length &&
            previous.every((id, index) => id === entryIds[index])
        )
            return;
        const snapshot = Object.freeze([...entryIds]);
        this.entryLists.set(editorId, snapshot);
        for (const subscription of this.entryListListeners.get(editorId) ??
            []) {
            if (this.entryLists.get(editorId) !== snapshot) break;
            if (source && source.token === subscription.source?.token) continue;
            subscription.listener(snapshot);
        }
    }

    /**
     * Subscribe first, then read the entry list so hydration cannot miss a
     * commit.
     */
    subscribeEntries(
        editorId: string,
        listener: (ids: readonly string[]) => void,
        source?: PublishSource,
    ): () => void {
        this.assertAlive();
        let listeners = this.entryListListeners.get(editorId);
        if (!listeners) {
            listeners = new Set();
            this.entryListListeners.set(editorId, listeners);
        }
        const subscription = { listener, source };
        listeners.add(subscription);
        return () => {
            listeners.delete(subscription);
            if (!listeners.size) this.entryListListeners.delete(editorId);
        };
    }

    destroy(): void {
        if (this.destroyed) return;
        this.destroyed = true;
        destroyedStores.add(this);
        // Nothing in flight has a reader any more, so drop the requests rather
        // than let a torn-down store keep an engine busy.
        for (const controller of this.publishAborts.values())
            controller.abort();
        for (const controller of this.facetAborts.values()) controller.abort();
        for (const controller of this.wholeRollupAborts.values())
            controller.abort();
        for (const controller of this.levelAborts.values()) controller.abort();
        this.onDestroy();
        idleWatches.get(this)?.waiting.clear();
        this.markings.clear();
        this.committedMarkings.clear();
        this.failedMarkings.clear();
        this.incompleteContributors.clear();
        this.heldWholeRollups.clear();
        this.heldLevels.clear();
        this.pendingLevelNotifications.clear();
        this.entryLists.clear();
        this.entryListListeners.clear();
        this.levelListeners.clear();
        this.levelCells.clear();
        this.levelRevisions.clear();
        this.levelAborts.clear();
        this.collections.clear();
        this.membershipByMarking.clear();
        this.noRollupMarkings.clear();
        this.standaloneParts.clear();
        this.renderedOutputs.clear();
        this.bucketByMarking.clear();
        this.partOfByMarking.clear();
        this.standInParts.clear();
        this.layers.clear();
        this.facetsAwaitingRefresh.clear();
        this.wholeRollupListeners.clear();
        this.wholeRollupCells.clear();
        this.facetEntries.clear();
        this.outputRequests.clear();
        this.sourceReconciliations.clear();
        this.facetRevisions.clear();
        this.publishSequences.clear();
        this.publishAborts.clear();
        this.facetAborts.clear();
        this.wholeRollupAborts.clear();
    }

    protected assertAlive(): void {
        if (this.destroyed) throw this.destroyedError();
    }

    private destroyedError(): Error {
        return new Error(`${this.storeLabel()}: store has been destroyed`);
    }

    private ensureFacetEntry(
        markingId: string,
        categoryId: string,
    ): FacetEntry {
        let byCategory = this.facetEntries.get(markingId);
        if (!byCategory) {
            byCategory = new Map();
            this.facetEntries.set(markingId, byCategory);
        }
        let entry = byCategory.get(categoryId);
        if (!entry) {
            entry = {
                cell: this.createCell<FacetState>(EMPTY_FACET_STATE),
                listeners: new Set(),
                current: false,
            };
            byCategory.set(categoryId, entry);
        }
        return entry;
    }

    private ensureEntry(id: string): MarkingEntry {
        let entry = this.markings.get(id);
        if (!entry) {
            entry = {
                cell: this.createCell(EMPTY_EZCLASSIFY_STATE),
                listeners: new Set(),
            };
            this.markings.set(id, entry);
        }
        return entry;
    }

    /**
     * Open a composition for a marking: take the next sequence, abort whatever
     * composition for the same marking is still on the wire, and hand back the
     * signal this one travels with.
     *
     * Aborting the predecessor is safe precisely because this composition
     * supersedes it: it was composed from the same layers or newer ones, and
     * only the newest commits, so the only thing the abort changes is whether
     * the engine kept working on an answer nobody would read.
     *
     * The abort stays invisible to the superseded caller. A local engine
     * ignores the signal, but a wire adapter that honors it rejects the call,
     * and all four framework bindings publish fire-and-forget, one publish per
     * keystroke with nothing awaiting the promise. Surfacing the rejection
     * would mean an unhandled rejection per superseded keystroke, and one more
     * per teardown with a publish outstanding, for a cancellation the store
     * itself chose. So a composition settles when its own signal is aborted,
     * and rethrows everything else.
     */
    private beginPublish(id: string): PublishTicket {
        const sequence = (this.publishSequences.get(id) ?? 0) + 1;
        this.publishSequences.set(id, sequence);
        this.publishAborts.get(id)?.abort();
        const controller = new AbortController();
        this.publishAborts.set(id, controller);
        return { sequence, signal: controller.signal };
    }

    /** Close a composition, whether it committed, was superseded, or rejected. */
    private endPublish(id: string, publish: PublishTicket): void {
        if (this.publishAborts.get(id)?.signal !== publish.signal) return;
        this.publishAborts.delete(id);
        if (this.publishAborts.size > 0) return;
        // After the commit this composition is about to make, which can start
        // the next ones; a waiter re-checks and waits again if it did.
        queueMicrotask(() => {
            const watch = idleWatches.get(this);
            if (!watch || this.destroyed) return;
            const waiting = [...watch.waiting];
            watch.waiting.clear();
            for (const run of waiting) run();
        });
    }

    /** Whether a composition with this sequence is still the marking's newest. */
    private isNewest(id: string, sequence: number): boolean {
        return !this.destroyed && sequence === this.publishSequences.get(id);
    }

    private ensureWholeRollupCell(
        wholeId: string,
    ): ReactiveCell<EzClassifyState> {
        let cell = this.wholeRollupCells.get(wholeId);
        if (!cell) {
            cell = this.createCell(EMPTY_EZCLASSIFY_STATE);
            this.wholeRollupCells.set(wholeId, cell);
        }
        return cell;
    }

    /**
     * Whether a view can paint the store's own rendering in its native field.
     *
     * @internal
     */
    usesRenderedFormat(id: string, formatId: string): boolean {
        return (
            this.bucketKeyOf(id) !== undefined &&
            (this.formatFor(id) ?? '') === formatId
        );
    }

    /**
     * The render format one marking entry is published in.
     *
     * A bucket carries at most one format, the one the host page authors in,
     * and that is the WHOLE surface's format. Without one, a whole entry is
     * written in the scheme's default format, which is what every view showing
     * the marking's `rendered` reads it as. Naming it matters for a scheme that
     * writes each role in a view of its own: a publish that names no format is
     * written in the view of whatever role its text reads as, so part-spelled
     * text would put a part's spelling in a whole marking.
     *
     * A marking whose own field names its output ({@link setRenderedOutput}) is
     * written in that output, whatever its role.
     *
     * A marking registered through {@link setPartOf} is not on that surface: it
     * is a part of another marking, and a scheme writes its parts in its own
     * part format. The scheme's metadata names both, so the role of the entry
     * decides the format and no format id is spelled into this file. A scheme
     * that declares no part format falls back to the store's format, which is
     * what a scheme with one surface means.
     */
    private formatFor(id: string): string | undefined {
        // The field that owns the marking writes it in this output.
        const owned = this.renderedOutputs.get(id);
        if (owned !== undefined) return owned;
        const bucket = this.bucketOf(id);
        if (!this.partOfByMarking.has(id) && !this.standaloneParts.has(id)) {
            if (bucket.format) return bucket.format;
            if (bucket.wholeFormat === undefined) {
                bucket.wholeFormat =
                    bucket.engine.getSchemeMeta().defaultRenderFormat ?? null;
            }
            return bucket.wholeFormat ?? undefined;
        }
        if (bucket.partFormat === undefined) {
            bucket.partFormat =
                bucket.engine.getSchemeMeta().defaultPartRenderFormat ?? null;
        }
        return bucket.partFormat ?? bucket.format;
    }

    /**
     * The `outputs` option for a publish to `id`: the outputs its views hold,
     * or nothing when none does, so the engine writes no output nobody reads.
     */
    private outputsFor(id: string): { outputs?: string[] } {
        const held = this.outputRequests.get(id);
        return held ? { outputs: [...held.keys()] } : {};
    }

    /**
     * Resolve (and memoize, per bucket) the per-category scope routing of the
     * marking's scheme from the engine's scheme metadata. Always returns a real
     * index, `getSchemeMeta` and `listCategories` are required capabilities
     * (validated when the bucket resolves), so there is no null path: a scheme
     * with no declared scopes simply yields an empty `byCategory`, routing
     * everything to the default scope by data.
     *
     * A category is default-scope when it declares no explicit `scopes`, or
     * when its explicit scopes include the scheme's default scope. Otherwise it
     * is an alternate-scope category and its assertions bypass the banner
     * projection. This mirrors the engine's suggest-side rule
     * (build-suggestions.ts): an unscoped category belongs to the default
     * scope; an explicitly scoped category belongs to exactly the scopes it
     * names.
     */
    private resolveScopeIndex(id: string): ScopeIndex {
        const bucket = this.bucketOf(id);
        if (bucket.scopeIndex !== null) return bucket.scopeIndex;
        const meta = bucket.engine.getSchemeMeta();
        const categories = bucket.engine.listCategories();
        const defaultScope = meta.defaultScope;
        const byCategory = new Map<string, string>();
        for (const c of categories) {
            if (!c.scopes || c.scopes.length === 0) continue; // unscoped ⇒ default
            if (defaultScope && c.scopes.includes(defaultScope)) continue; // also in default
            // Alternate-scope category: route to its first declared scope. Only
            // the default-vs-not distinction matters for the round-trip; the
            // exact non-default scope id is retained so consumers can read it.
            byCategory.set(c.id, c.scopes[0]);
        }
        bucket.scopeIndex = { defaultScope, byCategory };
        return bucket.scopeIndex;
    }

    /**
     * The bucket key of a marking: where `setBucket` placed it, else the
     * default bucket. Undefined when it was not placed and there is no
     * default.
     */
    private bucketKeyOf(id: string): BucketKey | undefined {
        return this.bucketByMarking.get(id) ?? this.buckets.defaultBucket;
    }

    /**
     * The refusal for a seed or publish to a marking no bucket holds, or
     * `undefined` when it has one.
     */
    private unplacedError(id: string): Error | undefined {
        if (this.bucketKeyOf(id) !== undefined) return undefined;
        return new Error(
            `${this.storeLabel()}: marking "${id}" is in no bucket. The store holds several and names no default, so it is not read by whichever rules come first.`,
        );
    }

    /** The bucket a marking is read in. Throws when it is in none. */
    private bucketOf(id: string): ResolvedBucket {
        const key = this.bucketKeyOf(id);
        if (key === undefined) throw this.unplacedError(id)!;
        return this.resolveBucket(key);
    }

    /** One bucket, resolved and checked on first use. */
    private resolveBucket(key: BucketKey): ResolvedBucket {
        let bucket = this.resolvedBuckets.get(key);
        if (!bucket) {
            const { engine, format } = this.buckets.resolve(key);
            assertLosslessCapabilities(engine);
            bucket = {
                engine,
                ...(format !== undefined ? { format } : {}),
                scopeIndex: null,
                partFormat: undefined,
                wholeFormat: undefined,
            };
            this.resolvedBuckets.set(key, bucket);
        }
        return bucket;
    }

    private fromProcessResult(
        rendered: string,
        result: EzClassifyStoreProcessResult | EzClassifyStoreAggregateResult,
    ): EzClassifyState {
        const state: EzClassifyState = {
            rendered: result.rendered ?? rendered,
            // A process result says what writing `rendered` did; a rollup
            // writes no output of its own and says nothing.
            ...('renders' in result
                ? {
                      assessment: result.assessment,
                      renders: result.renders,
                      appliedFixes: result.appliedFixes ?? [],
                      proposedFixes: result.proposedFixes ?? [],
                  }
                : { renders: {}, aggregate: true as const }),
            assertions: result.assertions ?? [],
            valid: result.valid,
            errors: result.errors ?? [],
            displayColor: result.displayColor,
        };
        if ('warnings' in result && Array.isArray(result.warnings))
            storeWarnings.set(state, result.warnings as Warning[]);
        return state;
    }

    private commit(
        id: string,
        state: EzClassifyState,
        source?: PublishSource,
        reconcileSource = false,
    ): void {
        const entry = this.ensureEntry(id);
        const wholeReading = (value: EzClassifyState) =>
            JSON.stringify([
                value.rendered,
                value.valid,
                value.recognition?.status,
                value.assertions,
            ]);
        const before = wholeReading(entry.cell.get());
        entry.cell.set(state);
        this.committedMarkings.add(id);
        this.failedMarkings.delete(id);
        const correctionSignature = reconcileSource
            ? stateSemanticSignature(state)
            : null;
        for (const l of entry.listeners) {
            if (source && l.source && l.source.token === source.token) {
                if (!reconcileSource) continue;
                let byMarking = this.sourceReconciliations.get(source.token);
                if (!byMarking) {
                    byMarking = new Map();
                    this.sourceReconciliations.set(source.token, byMarking);
                }
                if (byMarking.get(id) === correctionSignature) continue;
                byMarking.set(id, correctionSignature!);
            }
            l.fn(state);
        }
        // A part reaches its level only through its whole's rollup; a whole
        // contributes its stated value to its level directly.
        const partOfWhole = this.partOfByMarking.get(id);
        if (partOfWhole) void this.recomputeWholeRollup(partOfWhole);
        else if (!this.standaloneParts.has(id) && !this.keptOut(id))
            void this.recomputeLevel(this.levelOfWhole(id));
        // Recompose only when contribution rules can read the changed whole.
        // Coverage diagnostics are refreshed independently by the bound views.
        if (wholeReading(state) !== before && this.hasDependentParts(id)) {
            this.rereadDependentParts(id);
            void this.recomputeWholeRollup(id);
        }
        this.rerunHeldRollups();
        void this.refreshFacets(id, state);
    }

    /**
     * Refresh a marking's facets once the listeners subscribing this tick have
     * all arrived. A facet with no current answer would otherwise wait for the
     * marking's next commit, which may never come. When a composition is
     * already on the wire its commit refreshes them, so this one is skipped.
     */
    private refreshFacetsSoon(markingId: string): void {
        if (this.facetsAwaitingRefresh.has(markingId)) return;
        this.facetsAwaitingRefresh.add(markingId);
        queueMicrotask(() => {
            if (!this.facetsAwaitingRefresh.delete(markingId)) return;
            if (this.hasCompositionInFlight(markingId)) return;
            void this.refreshFacets(markingId, this.get(markingId));
        });
    }

    /**
     * Compute the marking's facets if a listener is still waiting for an answer
     * for the marking as committed.
     */
    private refreshStaleFacets(markingId: string): void {
        const byCategory = this.facetEntries.get(markingId);
        if (!byCategory) return;
        for (const entry of byCategory.values()) {
            if (entry.listeners.size > 0 && !entry.current) {
                void this.refreshFacets(markingId, this.get(markingId));
                return;
            }
        }
    }

    /**
     * Recompute every subscribed category's allowable options for a committed
     * marking (each answered as if that category's own assertions were not
     * chosen), write the per-category {@link FacetState} into that facet's cell,
     * and notify its listeners, diffing so an unchanged category is neither
     * rewritten nor re-notified.
     *
     * Latest-wins by revision, like the level and whole rollups. Two commits in
     * quick succession open two overlapping fan-outs, and over a wire the older
     * one can resolve last; without the guard every facet picker would end up
     * showing the allowable options of a superseded marking state until the
     * next commit happened to fix it. The superseded fan-out is also aborted,
     * so its requests stop traveling.
     */
    private async refreshFacets(
        markingId: string,
        state: EzClassifyState,
    ): Promise<void> {
        if (this.destroyed) return;
        this.facetsAwaitingRefresh.delete(markingId);
        const byCategory = this.facetEntries.get(markingId);
        if (!byCategory) return;
        // A facet entry outlives its last listener so its cell keeps the last
        // computed answer; only categories with a live listener are recomputed.
        // An entry passed over is no longer current, so the next listener to
        // subscribe has it computed rather than replayed.
        const categoryIds: string[] = [];
        for (const [categoryId, entry] of byCategory) {
            if (entry.listeners.size > 0) categoryIds.push(categoryId);
            else entry.current = false;
        }
        if (categoryIds.length === 0) return;
        const revision = (this.facetRevisions.get(markingId) ?? 0) + 1;
        this.facetRevisions.set(markingId, revision);
        this.facetAborts.get(markingId)?.abort();
        const controller = new AbortController();
        this.facetAborts.set(markingId, controller);

        const suggestResultsPerCategory = await this.suggestForFacets(
            markingId,
            categoryIds,
            state,
            controller.signal,
        );
        if (this.destroyed) return;
        if (revision !== this.facetRevisions.get(markingId)) return;
        if (this.facetAborts.get(markingId) === controller)
            this.facetAborts.delete(markingId);
        for (let i = 0; i < categoryIds.length; i++) {
            const categoryId = categoryIds[i];
            const entry = byCategory.get(categoryId);
            if (!entry) continue;
            // Its listeners left while this was on the wire.
            if (entry.listeners.size === 0) {
                entry.current = false;
                continue;
            }
            const allowableOptions = suggestResultsPerCategory[i];
            const selectedAssertions = state.assertions.filter(
                (a) => a.categoryId === categoryId,
            );
            if (
                entry.current &&
                facetStateEqual(
                    entry.cell.get(),
                    allowableOptions,
                    selectedAssertions,
                )
            )
                continue;
            const newState: FacetState = {
                allowableOptions,
                selectedAssertions,
            };
            entry.current = true;
            entry.cell.set(newState);
            for (const listener of entry.listeners) listener(newState);
        }
    }

    /**
     * Resolve allowable options for each requested category, in the order the
     * ids were given. `null` for a category means "no answer": the engine
     * offers no suggest capability at all, the call that would have answered it
     * failed, or a batch call came back without that category in it. Consumers
     * read `null` as the show-all fallback, so a batched adapter and a
     * fanned-out one produce the same user-visible result for the same
     * failure.
     *
     * Prefers `suggestForCategories`, which answers a whole scope in one call
     * and owns the per-category exclusion itself. A form with a dozen facet
     * pickers costs a dozen round trips per commit through the `suggest`
     * fan-out and one per scope through the batch call; the resulting
     * {@link FacetState} is identical either way, which is why this is a feature
     * detection and not a contract change.
     *
     * @param categoryIds - Subscribed categories, in listener-registration
     *   order.
     * @param committed - The committed marking the options are computed
     *   against.
     * @param signal - Aborted when a newer refresh supersedes this one.
     * @returns One entry per requested category, positionally aligned.
     */
    private async suggestForFacets(
        markingId: string,
        categoryIds: string[],
        committed: EzClassifyState,
        signal: AbortSignal,
    ): Promise<(Suggestion[] | null)[]> {
        // A marking in no bucket has no rules to offer options by.
        if (this.bucketKeyOf(markingId) === undefined)
            return categoryIds.map(() => null);
        const { engine, format } = this.bucketOf(markingId);
        // What the marking states: values a part took from its whole are the
        // whole's, and the engine is never handed them back.
        const state = {
            ...committed,
            assertions: withoutTakenFromWhole(committed.assertions),
        };
        const scopeIndex = this.resolveScopeIndex(markingId);
        const scopeOf = (categoryId: string): string | undefined =>
            scopeIndex.byCategory.get(categoryId) ?? scopeIndex.defaultScope;

        if (engine.suggestForCategories) {
            // One call per distinct scope, not per category: the batch option
            // bag carries a single scope, and a marking's categories can span
            // an alternate scope (an authority block) as well as the default.
            const byScope = new Map<string | undefined, string[]>();
            for (const categoryId of categoryIds) {
                const scope = scopeOf(categoryId);
                const group = byScope.get(scope);
                if (group) group.push(categoryId);
                else byScope.set(scope, [categoryId]);
            }
            const answers = new Map<string, Suggestion[] | null>();
            await Promise.all(
                Array.from(byScope, async ([scope, group]) => {
                    try {
                        const results = await Promise.resolve(
                            engine.suggestForCategories!(
                                state.assertions,
                                group,
                                {
                                    outputFormat: format,
                                    surface: scope,
                                    signal,
                                },
                            ),
                        );
                        for (const categoryId of group) {
                            const result = results[categoryId];
                            // A category the response left out is "no answer",
                            // the same `null` the fan-out reports when its call
                            // fails: a partial response is a realistic wire
                            // outcome, and `[]` would tell every picker it has
                            // zero allowable options. An answered category with
                            // an empty suggestion list keeps meaning `[]`.
                            answers.set(
                                categoryId,
                                result === undefined
                                    ? null
                                    : result.suggestions.filter(
                                          (s) => s.categoryId === categoryId,
                                      ),
                            );
                        }
                    } catch {
                        for (const categoryId of group)
                            answers.set(categoryId, null);
                    }
                }),
            );
            return categoryIds.map(
                (categoryId) => answers.get(categoryId) ?? null,
            );
        }

        if (!engine.suggest) return categoryIds.map(() => null);
        return Promise.all(
            categoryIds.map(async (categoryId) => {
                const contextAssertions = state.assertions.filter(
                    (a) => a.categoryId !== categoryId,
                );
                try {
                    const result = await Promise.resolve(
                        engine.suggest!(contextAssertions, {
                            outputFormat: format,
                            surface: scopeOf(categoryId),
                            signal,
                        }),
                    );
                    return result.suggestions.filter(
                        (s) => s.categoryId === categoryId,
                    );
                } catch {
                    return null;
                }
            }),
        );
    }

    /**
     * The context a marking's parts are read in: parts of the marking's own
     * committed value. Undefined while it holds nothing.
     *
     * A part and a rollup over parts are read in the same context, the one the
     * engine's own rollups use. The engine judges each part, each contributor
     * to a rollup and the rollup itself by the part rules; whole-only rules
     * judge the whole's own value, not the rollup. A part's values that stand
     * for its whole are taken from this value again on every read, so a list
     * the whole has since changed is never carried forward.
     */
    private wholeContext(wholeId: string): ProcessingContext | undefined {
        const state = this.markings.get(wholeId)?.cell.get();
        if (!state || (!state.rendered && !state.assertions.length))
            return undefined;
        const canonical =
            state.valid &&
            (!state.recognition || state.recognition.status === 'complete');
        return {
            role: 'part',
            partOf: {
                rendered: state.rendered,
                ...(canonical ? { assertions: state.assertions } : {}),
            },
        };
    }

    /**
     * The context one marking is read in when it is a part: see
     * {@link wholeContext}, for its {@link setPartOf} parent. A part whose whole
     * holds nothing yet is still read as a part, so a rule that asks about the
     * whole is unresolved rather than judged by the whole rules, and so is one
     * with no whole on the page.
     */
    private wholeContextOf(id: string): ProcessingContext | undefined {
        const wholeId = this.partOfByMarking.get(id);
        if (wholeId) return this.wholeContext(wholeId) ?? { role: 'part' };
        return this.standaloneParts.has(id) ? { role: 'part' } : undefined;
    }

    /**
     * Read each potentially whole-dependent part again against the whole's new
     * value. Its readings depended on the old whole, so they are dropped, and
     * the part composes again. That supersedes a composition the part's own
     * field may have in flight, which loses nothing: the new one is composed
     * from the same layers, edits included.
     */
    private rereadDependentParts(wholeId: string): void {
        for (const [partId, parent] of this.partOfByMarking) {
            if (parent !== wholeId || !this.contributionDependsOnWhole(partId))
                continue;
            if (!this.layers.has(partId)) continue;
            this.dropReadings(partId);
            this.recompose(partId).catch(() => {});
        }
    }

    /**
     * Forget the cached readings of a marking's text layers. A part's text is
     * read against its role and its whole, so a reading taken before either
     * changed is read again on the next composition.
     */
    private dropReadings(id: string): void {
        const layers = this.layers.get(id);
        if (!layers) return;
        if (layers.baseline && 'text' in layers.baseline)
            layers.baseline.read = undefined;
        if (layers.edits.rendered) layers.edits.rendered.read = undefined;
    }

    /**
     * A marking's role or whole changed: drop its readings, and supersede a
     * composition still on the wire, which was read under the old ones and
     * would otherwise cache that reading when it answers.
     */
    private rolesChanged(id: string): void {
        this.dropReadings(id);
        if (this.hasCompositionInFlight(id)) this.recompose(id).catch(() => {});
    }

    /** Whether any contribution can depend on this whole's changed value. */
    private hasDependentParts(id: string): boolean {
        for (const [partId, parent] of this.partOfByMarking) {
            if (parent === id && this.contributionDependsOnWhole(partId))
                return true;
        }
        return false;
    }

    private contributionDependsOnWhole(partId: string): boolean {
        if (this.standInParts.has(partId)) return true;
        try {
            return (
                this.bucketOf(partId).engine.getSchemeMeta().roleAware !== false
            );
        } catch {
            return true;
        }
    }

    /**
     * Record whether a part stands for its whole's values after a read.
     *
     * Read against its whole, the part does exactly when the engine took values
     * from the whole for it. Read with no whole to take from, the engine cannot
     * say, so what the field sent decides (it read the part against the whole
     * on its side), and failing that the last answer stands.
     */
    private noteStandIn(
        id: string,
        readAgainstWhole: boolean,
        result: readonly Assertion[],
        sent: readonly Assertion[] = [],
    ): void {
        const stands = readAgainstWhole
            ? result.some(takenFromWhole)
            : sent.some(takenFromWhole) || this.standInParts.has(id);
        if (stands) this.standInParts.add(id);
        else this.standInParts.delete(id);
    }

    // -----------------------------------------------------------------------
    // The rollup tree
    // -----------------------------------------------------------------------

    /** The level a whole rolls up into: its declared collection, else the page. */
    private levelOfWhole(id: string): LevelId {
        const collection = this.membershipByMarking.get(id);
        return collection !== undefined && this.collections.has(collection)
            ? collection
            : null;
    }

    /** The level a collection rolls up into: its declared parent, else the page. */
    private parentLevel(collectionId: string): LevelId {
        const parent = this.collections.get(collectionId) ?? null;
        return parent !== null && this.collections.has(parent) ? parent : null;
    }

    private allLevels(): LevelId[] {
        return [null, ...this.collections.keys()];
    }

    private hasParts(wholeId: string): boolean {
        for (const parent of this.partOfByMarking.values())
            if (parent === wholeId) return true;
        return false;
    }

    /**
     * Whether a marking is kept out of every level. Only a whole with no parts
     * is: anywhere else `no-rollup` would drop content (see
     * {@link setNoRollup}).
     */
    private keptOut(id: string): boolean {
        return (
            this.noRollupMarkings.has(id) &&
            !this.partOfByMarking.has(id) &&
            !this.hasParts(id)
        );
    }

    /**
     * The bucket a whole and its parts are read in: the whole's own, else the
     * default, else that of its first placed part (a whole that is only named,
     * holding parts of one bucket).
     */
    private wholeBucketKey(wholeId: string): BucketKey | undefined {
        const own = this.bucketKeyOf(wholeId);
        if (own !== undefined) return own;
        for (const [partId, parent] of this.partOfByMarking) {
            if (parent !== wholeId) continue;
            const key = this.bucketByMarking.get(partId);
            if (key !== undefined) return key;
        }
        return undefined;
    }

    /**
     * The wholes a level holds: every marking that is not a part of any kind,
     * and every id a part names as its whole, placed in this level.
     */
    private wholesIn(level: LevelId): string[] {
        const ids = new Set<string>([
            ...this.markings.keys(),
            ...this.layers.keys(),
            ...this.partOfByMarking.values(),
        ]);
        return [...ids].filter(
            (id) =>
                !this.partOfByMarking.has(id) &&
                !this.standaloneParts.has(id) &&
                this.levelOfWhole(id) === level,
        );
    }

    private childCollections(level: LevelId): string[] {
        return [...this.collections.keys()].filter(
            (id) => this.parentLevel(id) === level,
        );
    }

    /**
     * Ids sorted in document order, or by id when the runtime gave none. Either
     * way the engine gets the same sets in the same order for the same tree,
     * whichever field finished mounting first.
     */
    private inDocumentOrder<T extends { id: string }>(nodes: T[]): T[] {
        const compare = this.documentOrder;
        return [...nodes].sort((left, right) =>
            compare
                ? compare(left.id, right.id)
                : left.id < right.id
                  ? -1
                  : left.id > right.id
                    ? 1
                    : 0,
        );
    }

    /** A whole's parts rollup, as a level with one bucket. */
    private wholeView(wholeId: string): EzClassifyAggregate {
        const state = this.wholeRollupCells.get(wholeId)?.get();
        const key = this.wholeBucketKey(wholeId);
        if (
            !state ||
            key === undefined ||
            (isEmptyState(state) && !state.stale)
        )
            return EMPTY_EZCLASSIFY_AGGREGATE;
        return { byBucket: new Map([[key, state]]) };
    }

    private ensureLevelCell(level: LevelId): ReactiveCell<EzClassifyAggregate> {
        let cell = this.levelCells.get(level);
        if (!cell) {
            cell = this.createCell(
                level !== null && !this.collections.has(level)
                    ? this.wholeView(level)
                    : EMPTY_EZCLASSIFY_AGGREGATE,
            );
            this.levelCells.set(level, cell);
        }
        return cell;
    }

    /** Commit a level's rollup and tell its listeners. */
    private writeLevel(level: LevelId, aggregate: EzClassifyAggregate): void {
        const cell = this.ensureLevelCell(level);
        if (cell.get() === aggregate) return;
        cell.set(aggregate);
        for (const listener of this.levelListeners.get(level) ?? [])
            listener(aggregate);
    }

    /** Bring a whole's level-shaped view up to its parts rollup. */
    private refreshWholeView(wholeId: string): void {
        if (this.collections.has(wholeId) || !this.levelCells.has(wholeId))
            return;
        const next = this.wholeView(wholeId);
        const current = this.levelCells.get(wholeId)!.get();
        if (aggregateDigest(next) === aggregateDigest(current)) return;
        this.writeLevel(wholeId, next);
    }

    /**
     * Compute again everything a change to one marking's role, bucket or
     * membership can reach: its whole's rollup when it is a part, its own and
     * its level's otherwise.
     */
    private recomputeAround(id: string, levelBefore: LevelId): void {
        const whole = this.partOfByMarking.get(id);
        if (whole !== undefined) {
            void this.recomputeWholeRollup(whole);
            void this.recomputeLevel(this.levelOfWhole(whole));
            return;
        }
        if (this.hasParts(id)) void this.recomputeWholeRollup(id);
        void this.recomputeLevel(levelBefore);
        const levelAfter = this.levelOfWhole(id);
        if (levelAfter !== levelBefore) void this.recomputeLevel(levelAfter);
    }

    /**
     * Roll up one level: the page, or a declared collection. Its members are
     * read as wholes, with no context. Each whole contributes its stated value
     * and its whole rollup, each child collection its own rollup, all as facts,
     * per bucket. A level that comes out unchanged stops there; one that
     * changed asks its parent again.
     */
    private async recomputeLevel(level: LevelId): Promise<void> {
        if (this.destroyed) return;
        if (level !== null && !this.collections.has(level)) return;
        const revision = (this.levelRevisions.get(level) ?? 0) + 1;
        this.levelRevisions.set(level, revision);
        this.levelAborts.get(level)?.abort();
        this.levelAborts.delete(level);
        // The answer that settles the last contributor computes it.
        if (!this.levelSettled(level)) {
            this.heldLevels.add(level);
            return;
        }
        this.heldLevels.delete(level);
        const controller = new AbortController();
        this.levelAborts.set(level, controller);
        const inputs = this.gatherLevel(level);
        // Single suspension point: see rollupResult.
        const result = this.rollupLevel(inputs);
        if (isPromiseLike(result))
            this.markLevelHeld(level, inputs.sets.keys());
        const results = await result;
        if (revision !== this.levelRevisions.get(level) || this.destroyed)
            return;
        if (this.levelAborts.get(level) === controller)
            this.levelAborts.delete(level);
        // A contributor started reading again while this was on the wire.
        if (!this.levelSettled(level)) {
            this.heldLevels.add(level);
            return;
        }
        const current = this.ensureLevelCell(level).get();
        const next = this.resolveLevel(current, results, inputs);
        if (
            this.pendingLevelNotifications.delete(level) ||
            aggregateDigest(next) !== aggregateDigest(current)
        ) {
            this.writeLevel(level, next);
            if (level !== null)
                void this.recomputeLevel(this.parentLevel(level));
        }
        this.rerunHeldRollups();
    }

    private holdLevelForReading(id: string): void {
        if (this.standaloneParts.has(id)) return;
        const whole = this.partOfByMarking.get(id) ?? id;
        if (this.keptOut(whole)) return;
        const bucket = this.wholeBucketKey(whole);
        if (bucket === undefined) return;
        const level = this.levelOfWhole(whole);
        this.heldLevels.add(level);
        this.markLevelHeld(level, [bucket]);
    }

    /** Keep settled facts visible while the adapter is still answering. */
    private markLevelHeld(level: LevelId, buckets: Iterable<BucketKey>): void {
        const current = this.ensureLevelCell(level).get();
        const byBucket = new Map(current.byBucket);
        let changed = false;
        for (const bucket of new Set([...byBucket.keys(), ...buckets])) {
            const held = this.heldState(
                byBucket.get(bucket) ?? EMPTY_EZCLASSIFY_STATE,
            );
            if (!held) continue;
            byBucket.set(bucket, held);
            changed = true;
        }
        if (!changed) return;
        const held = { byBucket };
        pendingAggregates.add(held);
        this.pendingLevelNotifications.add(level);
        this.writeLevel(level, held);
        if (level !== null && !this.destroyed) {
            const parent = this.parentLevel(level);
            this.heldLevels.add(parent);
            this.markLevelHeld(parent, byBucket.keys());
        }
    }

    /**
     * Whether every contributor to a level has settled: each whole it holds has
     * nothing pending, nor has its parts rollup, and each child collection
     * holds its own settled rollup.
     */
    private levelSettled(level: LevelId): boolean {
        for (const wholeId of this.wholesIn(level)) {
            if (this.keptOut(wholeId)) continue;
            if (!this.settled(wholeId) || this.wholeRollupPending(wholeId))
                return false;
        }
        for (const child of this.childCollections(level))
            if (this.levelPending(child)) return false;
        return true;
    }

    private levelPending(level: LevelId): boolean {
        return (
            this.heldLevels.has(level) ||
            this.levelAborts.has(level) ||
            !this.levelSettled(level)
        );
    }

    private wholeRollupPending(wholeId: string): boolean {
        if (!this.hasParts(wholeId)) return false;
        return (
            this.heldWholeRollups.has(wholeId) ||
            this.wholeRollupAborts.has(wholeId) ||
            !this.contributorsSettled(wholeId)
        );
    }

    /**
     * What a level sends the engine, per bucket, in document order, and which
     * of its buckets miss a contributor.
     */
    private gatherLevel(level: LevelId): LevelInputs {
        const sets = new Map<BucketKey, Assertion[][]>();
        const stale = new Set<BucketKey>();
        const touch = (bucket: BucketKey): Assertion[][] => {
            let list = sets.get(bucket);
            if (!list) {
                list = [];
                sets.set(bucket, list);
            }
            return list;
        };
        const incompleteWholes = new Set(this.incompleteContributors.values());
        const nodes = this.inDocumentOrder([
            ...this.wholesIn(level).map((id) => ({ id, collection: false })),
            ...this.childCollections(level).map((id) => ({
                id,
                collection: true,
            })),
        ]);
        for (const node of nodes) {
            if (node.collection) {
                for (const [bucket, state] of this.ensureLevelCell(
                    node.id,
                ).get().byBucket) {
                    const list = touch(bucket);
                    if (state.assertions.length) list.push(state.assertions);
                    if (state.stale) stale.add(bucket);
                }
                continue;
            }
            const wholeId = node.id;
            if (this.keptOut(wholeId)) continue;
            const bucket = this.wholeBucketKey(wholeId);
            if (bucket === undefined) continue;
            const stated = this.markings.get(wholeId)?.cell.get().assertions;
            if (stated?.length) touch(bucket).push(stated);
            if (this.hasParts(wholeId)) {
                const rollup = this.wholeRollupCells.get(wholeId)?.get();
                if (rollup?.assertions.length)
                    touch(bucket).push(rollup.assertions);
                if (rollup?.stale) stale.add(bucket);
                // No-rollup on a whole with parts would drop its content.
                if (this.noRollupMarkings.has(wholeId)) stale.add(bucket);
            }
            if (
                this.failedMarkings.has(wholeId) ||
                incompleteWholes.has(wholeId)
            )
                stale.add(bucket);
        }
        // A source that read only part of itself, rolling up into this level.
        for (const [contributorId, wholeId] of this.incompleteContributors) {
            if (wholeId !== null || this.levelOfWhole(contributorId) !== level)
                continue;
            const bucket = this.bucketKeyOf(contributorId);
            if (bucket !== undefined) stale.add(bucket);
            else for (const held of sets.keys()) stale.add(held);
        }
        return { sets, stale };
    }

    /**
     * One aggregate call per bucket that has contributors. Synchronous when
     * every engine answers synchronously, so a level costs one microtask like a
     * whole rollup does.
     */
    private rollupLevel(
        inputs: LevelInputs,
    ):
        | Map<BucketKey, EzClassifyState | null>
        | Promise<Map<BucketKey, EzClassifyState | null>> {
        const entries: Array<
            [
                BucketKey,
                EzClassifyState | null | Promise<EzClassifyState | null>,
            ]
        > = [];
        for (const [bucket, sets] of inputs.sets) {
            if (sets.length === 0) continue;
            entries.push([
                bucket,
                this.rollupResult(this.resolveBucket(bucket), sets),
            ]);
        }
        if (!entries.some(([, result]) => result instanceof Promise))
            return new Map(
                entries as Array<[BucketKey, EzClassifyState | null]>,
            );
        return Promise.all(
            entries.map(
                async ([bucket, result]) => [bucket, await result] as const,
            ),
        ).then((settled) => new Map(settled));
    }

    /**
     * A level's new rollup from its engine answers. A bucket whose call failed
     * holds its last value, flagged stale (see {@link heldState}); a bucket
     * missing a contributor is flagged stale, and appears even when nothing
     * else in it contributes. A bucket with no contributors leaves the level.
     */
    private resolveLevel(
        current: EzClassifyAggregate,
        results: Map<BucketKey, EzClassifyState | null>,
        inputs: LevelInputs,
    ): EzClassifyAggregate {
        const byBucket = new Map<BucketKey, EzClassifyState>();
        for (const [bucket, sets] of inputs.sets) {
            let state: EzClassifyState;
            if (sets.length === 0) {
                if (!inputs.stale.has(bucket)) continue;
                state = EMPTY_EZCLASSIFY_STATE;
            } else {
                state =
                    results.get(bucket) ??
                    this.heldState(
                        current.byBucket.get(bucket) ?? EMPTY_EZCLASSIFY_STATE,
                    ) ??
                    current.byBucket.get(bucket)!;
            }
            if (inputs.stale.has(bucket) && !state.stale)
                state = { ...state, stale: true };
            byBucket.set(bucket, state);
        }
        for (const bucket of inputs.stale) {
            if (!byBucket.has(bucket))
                byBucket.set(bucket, {
                    ...EMPTY_EZCLASSIFY_STATE,
                    stale: true,
                });
        }
        return byBucket.size === 0 ? EMPTY_EZCLASSIFY_AGGREGATE : { byBucket };
    }

    /** Roll up the parts of one whole, read against the whole's value. */
    private async recomputeWholeRollup(wholeId: string): Promise<void> {
        if (this.destroyed) return;
        const revision = (this.wholeRollupRevisions.get(wholeId) ?? 0) + 1;
        this.wholeRollupRevisions.set(wholeId, revision);
        this.wholeRollupAborts.get(wholeId)?.abort();
        this.wholeRollupAborts.delete(wholeId);
        // The commit that settles the last part computes it.
        if (!this.contributorsSettled(wholeId)) {
            this.heldWholeRollups.add(wholeId);
            return;
        }
        this.heldWholeRollups.delete(wholeId);
        const controller = new AbortController();
        this.wholeRollupAborts.set(wholeId, controller);
        const bucket = this.wholeBucketKey(wholeId);
        const { sets, mismatched } = this.gatherContributors(wholeId, bucket);
        const next = await (bucket === undefined || sets.length === 0
            ? EMPTY_EZCLASSIFY_STATE
            : this.rollupResult(
                  this.resolveBucket(bucket),
                  sets,
                  // Parts of a whole that holds nothing yet are still parts:
                  // read by the part rules, as each one is on its own (see
                  // wholeContextOf), never as wholes.
                  this.wholeContext(wholeId) ?? { role: 'part' },
              ));
        if (
            revision !== this.wholeRollupRevisions.get(wholeId) ||
            this.destroyed
        )
            return;
        if (this.wholeRollupAborts.get(wholeId) === controller)
            this.wholeRollupAborts.delete(wholeId);
        if (!this.contributorsSettled(wholeId)) {
            this.heldWholeRollups.add(wholeId);
            return;
        }
        const cell = this.ensureWholeRollupCell(wholeId);
        const before = cell.get();
        const resolved = this.flagMissing(
            wholeId,
            next ?? this.heldState(before),
            mismatched,
        );
        if (resolved !== null && !this.staysEmpty(cell, resolved)) {
            cell.set(resolved);
            for (const l of this.wholeRollupListeners.get(wholeId) ?? [])
                l(resolved);
        }
        // The whole's level reads this rollup as facts; an unchanged one
        // changes nothing above it.
        if (rollupDigest(cell.get()) !== rollupDigest(before)) {
            this.refreshWholeView(wholeId);
            void this.recomputeLevel(this.levelOfWhole(wholeId));
        }
        this.rerunHeldRollups();
    }

    /**
     * Whether a rollup over no contributors finds its rollup empty already. A
     * part registered before anything has been asked for it settles at once and
     * contributes nothing, so its rollup computes to the empty state it already
     * holds; telling its listeners would have a whole field read itself again
     * for nothing.
     */
    private staysEmpty(
        cell: ReactiveCell<EzClassifyState>,
        next: EzClassifyState,
    ): boolean {
        if (next !== EMPTY_EZCLASSIFY_STATE) return false;
        const current = cell.get();
        return (
            !current.stale &&
            current.rendered === '' &&
            current.assertions.length === 0
        );
    }

    /**
     * The value to publish when a rollup could not be computed: the last one
     * that could, flagged {@link EzClassifyState.stale}.
     *
     * Zeroing to {@link EMPTY_EZCLASSIFY_STATE} on failure is the wrong answer
     * once the engine is across a network. An aggregate banner that blanks
     * because a request failed reads as "this document carries no marking",
     * which is the one wrong answer a classification UI must never give. The
     * last resolved value is still the best information the store has, so it
     * stays on display and says out loud that it is held.
     *
     * @param current - The value the cell holds right now.
     * @returns The state to publish, or `null` when it already says this.
     */
    private heldState(current: EzClassifyState): EzClassifyState | null {
        if (current.stale) return null;
        return { ...current, stale: true };
    }

    /**
     * Whether every contributor to a whole's rollup has settled (see
     * {@link settled}): the parts registered under it and the whole itself,
     * since its parts are read against the whole's value. A rollup is computed
     * only from settled contributors, so the values it combines, and the
     * requests that carry them, depend on the markings and not on the order the
     * engine answered their reads in. Each contributor's commit, and each
     * failed read, asks for the rollup again, so the answer that settles the
     * last one computes it.
     */
    private contributorsSettled(wholeId: string): boolean {
        for (const [partId, parent] of this.partOfByMarking) {
            if (parent === wholeId && !this.settled(partId)) return false;
        }
        return this.settled(wholeId);
    }

    /**
     * Whether the store has nothing pending for marking `id`: no composition is
     * on the wire, and a read it was asked for has committed or failed. A
     * marking nobody has seeded or published was never asked for and is
     * settled; it contributes nothing until it is, and the commit of that first
     * read asks for the rollups again. Nothing here waits on a timer: every
     * engine call answers or rejects in bounded time (see
     * {@link EzClassifyStoreEngine}), so a marking that is asked for settles.
     */
    private settled(id: string): boolean {
        if (this.hasCompositionInFlight(id)) return false;
        if (!this.layers.has(id)) return true;
        return this.committedMarkings.has(id) || this.failedMarkings.has(id);
    }

    /**
     * Ask again for every rollup held while a contributor was unsettled: whole
     * rollups first, since the levels above them read them.
     */
    private rerunHeldRollups(): void {
        for (const wholeId of [...this.heldWholeRollups])
            void this.recomputeWholeRollup(wholeId);
        for (const level of [...this.heldLevels])
            void this.recomputeLevel(level);
    }

    /**
     * A whole rollup computed while a part's first read failed is missing that
     * part, one computed over a contributor that read only part of its source
     * is missing the rest, and one that had to leave out a part of another
     * bucket, or a part kept out of rollups, is missing that part. Each says it
     * is held rather than current.
     */
    private flagMissing(
        wholeId: string,
        state: EzClassifyState | null,
        mismatched: boolean,
    ): EzClassifyState | null {
        if (!state || state.stale) return state;
        if (mismatched) return { ...state, stale: true };
        for (const id of this.failedMarkings) {
            if (this.partOfByMarking.get(id) === wholeId)
                return { ...state, stale: true };
        }
        for (const parent of this.incompleteContributors.values()) {
            if (parent === wholeId) return { ...state, stale: true };
        }
        for (const id of this.noRollupMarkings) {
            if (this.partOfByMarking.get(id) === wholeId)
                return { ...state, stale: true };
        }
        return state;
    }

    /**
     * The parts of a whole, as structured assertion sets in document order.
     * Only structured sets are gathered: rollup runs through
     * `aggregateAssertions`, never rendered strings, so alternate-scope
     * categories and capture values survive the rollup. A part placed in
     * another bucket than its whole is left out (`mismatched`): its facts are
     * read by other rules.
     */
    private gatherContributors(
        wholeId: string,
        bucket: BucketKey | undefined,
    ): { sets: Assertion[][]; mismatched: boolean } {
        const parts = this.inDocumentOrder(
            [...this.partOfByMarking]
                .filter(([, parent]) => parent === wholeId)
                .map(([id]) => ({ id })),
        );
        const sets: Assertion[][] = [];
        let mismatched = false;
        for (const { id } of parts) {
            const assertions = this.markings.get(id)?.cell.get().assertions;
            if (this.bucketKeyOf(id) !== bucket) {
                if (this.layers.has(id) || assertions?.length)
                    mismatched = true;
                continue;
            }
            if (assertions?.length) sets.push(assertions);
        }
        return { sets, mismatched };
    }

    /**
     * Combine contributor assertion sets into a single rolled-up state via the
     * bucket engine's `aggregateAssertions`: the only rollup path. There is no
     * rendered-string fallback: `aggregateAssertions` is a required capability
     * (validated when the bucket resolves), so aggregating over structured
     * assertions is always available and authored alternate-scope categories +
     * capture values survive the rollup. Returns the empty state when there are
     * no contributors, and `null` when the engine could not answer: an empty
     * rollup and a failed one are different facts, and the caller holds the
     * last good value for the second (see {@link heldState}).
     *
     * NOT `async`: it returns either a state synchronously, or the raw engine
     * result (which may itself be sync or a Promise). The caller awaits it
     * exactly once. Wrapping this in its own `async` function would add a
     * second microtask tick to the fire-and-forget recompute, so a consumer
     * reading a cell right after `await publishRendered(...)` would see a stale
     * value.
     *
     * @param whole - The whole the contributors are parts of. Omitted for a
     *   level, whose contributors are wholes.
     */
    private rollupResult(
        bucket: ResolvedBucket,
        contributors: Assertion[][],
        whole?: ProcessingContext,
    ): EzClassifyState | null | Promise<EzClassifyState | null> {
        if (contributors.length === 0) {
            return EMPTY_EZCLASSIFY_STATE;
        }
        // Each part goes in as it was written. A value it took from its whole
        // is not sent back: the engine takes it again from `whole`, the whole
        // as it stands now.
        const assertionSets = contributors.map((set) =>
            withoutTakenFromWhole(set),
        );
        const opts = {
            ...(bucket.format ? { outputFormat: bucket.format } : {}),
            ...(whole ? { context: whole } : {}),
        };
        let result:
            | EzClassifyStoreAggregateResult
            | Promise<EzClassifyStoreAggregateResult>;
        try {
            result = bucket.engine.aggregateAssertions(assertionSets, opts);
        } catch {
            return null;
        }
        if (isPromiseLike(result)) {
            return Promise.resolve(result).then(
                (r) => this.fromProcessResult('', r),
                () => null,
            );
        }
        return this.fromProcessResult('', result);
    }
}
