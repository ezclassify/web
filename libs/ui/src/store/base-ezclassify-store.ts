/**
 * Shared base for the framework `EzClassifyStore` adapters.
 *
 * This base owns engine-facing commits, aggregate and whole-rollup recomputes,
 * facet refreshes and publication cycle protection.
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
 * - The page aggregate and each whole rollup: a revision, already present;
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
} from '@ezclassify/types';
import {
    assertionFactKey,
    takenFromWhole,
    withoutTakenFromWhole,
} from '../assertion-identity';
// Type-only import: `ezclassify-store.ts` subclasses this module's
// `BaseEzClassifyStore` (its `VanillaEzClassifyStore`), so any runtime
// import back into it would make the cycle real and TDZ the class binding.
// Runtime helpers come from ./store-shared, which imports no store class.
import type {
    EzClassifyState,
    EzClassifyStore,
    EzClassifyStoreAggregateResult,
    EzClassifyStoreEngine,
    EzClassifyStoreProcessResult,
    FacetState,
    PublishSource,
} from './ezclassify-store';
import {
    EMPTY_EZCLASSIFY_STATE,
    EMPTY_FACET_STATE,
    facetStateEqual,
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
 * The category ids whose authored content differs between two assertion sets. A
 * category present in one set and absent from the other counts as changed,
 * which is how a cleared category is told apart from an untouched one.
 */
function changedCategories(base: Assertion[], next: Assertion[]): Set<string> {
    const signaturesByCategory = (
        assertions: Assertion[],
    ): Map<string, string> => {
        const byCategory = new Map<string, string[]>();
        for (const a of assertions) {
            const list = byCategory.get(a.categoryId);
            const signature = assertionFactKey(a);
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

/**
 * The engine's answer, or a rejection as soon as `signal` aborts. A superseded
 * or torn-down composition settles at once even when the engine ignores the
 * signal and never answers. A synchronous answer passes straight through, so
 * the in-process engine keeps its single microtask.
 */
function answerOrAbort<T>(
    answer: T | PromiseLike<T>,
    signal: AbortSignal,
): T | Promise<T> {
    if (!isPromiseLike(answer)) return answer;
    return new Promise<T>((resolve, reject) => {
        answer.then(resolve, reject);
        signal.addEventListener('abort', () => reject(signal.reason), {
            once: true,
        });
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
    protected readonly engine: EzClassifyStoreEngine;
    protected readonly format?: string;

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
    private aggregateHeld = false;
    private readonly entryCollections = new Map<string, readonly string[]>();
    private readonly entryCollectionListeners = new Map<
        string,
        Set<{
            listener: (ids: readonly string[]) => void;
            source?: PublishSource;
        }>
    >();
    private readonly aggregateCell: ReactiveCell<EzClassifyState>;
    private readonly aggregateListeners = new Set<
        (state: EzClassifyState) => void
    >();
    private readonly partOfByMarking = new Map<string, string>();
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
    /** Latest-wins guards for asynchronous aggregate computations. */
    private aggregateRevision = 0;
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
    private aggregateAbort: AbortController | null = null;
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
    // Resolved lazily on the first assertion publish and memoized: the scheme
    // bound to a store does not change over its lifetime, and getSchemeMeta /
    // listCategories walk the whole category set. `null` = not yet computed. The
    // resolved value is always a real index; the capabilities are required, so
    // there is no "routing off" sentinel.
    private scopeIndexCache: ScopeIndex | null = null;
    /**
     * Memoized part-surface format from the scheme metadata, resolved on first
     * use. `undefined` = not yet read, `null` = read and the scheme names none.
     * The scheme bound to a store does not change over its lifetime.
     */
    private partFormatCache: string | null | undefined = undefined;
    /** The whole entries' format, memoized the same way. */
    private wholeFormatCache: string | null | undefined = undefined;

    constructor(engine: EzClassifyStoreEngine, options?: { format?: string }) {
        assertLosslessCapabilities(engine);
        this.engine = engine;
        this.format = options?.format;
        this.aggregateCell = this.createCell(EMPTY_EZCLASSIFY_STATE);
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
     * cleared, while cells still hold their values. Default zeroes the
     * aggregate and whole-rollup cells. Angular overrides this to a no-op:
     * writing a signal during teardown re-triggers its effect scheduler, which
     * re-enters a destroyed store. The component tree is going away anyway.
     */
    protected onDestroy(): void {
        this.aggregateCell.set(EMPTY_EZCLASSIFY_STATE);
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

    /** Live cell for the page-level aggregate. */
    protected aggregateStateCell(): ReactiveCell<EzClassifyState> {
        return this.aggregateCell;
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
        const declared = (this.engine.getSchemeMeta().formats ?? []).map(
            (layout) => layout.id,
        );
        if (!declared.includes(output)) {
            const listed =
                declared.length > 0
                    ? declared.map((one) => `"${one}"`).join(', ')
                    : 'none';
            throw new Error(
                `${this.storeLabel()}: requestOutput("${output}") names an output the scheme does not declare. It declares ${listed}.`,
            );
        }
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
        this.materializeAggregateEdit(id);
        const { edits } = this.layersOf(id);
        edits.rendered = { text: rendered };
        for (const categoryId of edits.categories.keys()) {
            if (this.isDefaultScope(categoryId))
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
        this.layersOf(id).baseline = { text: rendered };
        return this.recompose(id);
    }

    /**
     * Seed a marking with assertions its host already carries, such as the
     * leading mark a body editor parsed. Same contract as {@link seedRendered};
     * an assertion baseline contributes both scopes.
     */
    seedAssertions(id: string, assertions: Assertion[]): Promise<void> {
        if (this.destroyed) return Promise.reject(this.destroyedError());
        this.layersOf(id).baseline = { assertions };
        return this.recompose(id);
    }

    /**
     * Release a marking whose host has left the page: drop its baseline and its
     * edits and commit the empty marking, under a composition newer than
     * anything in flight, so it leaves the page aggregate and the next seed
     * under the same id starts from its own served value. A runtime torn down
     * over hosts that stay on the page releases nothing; the next runtime seeds
     * the same hosts under the same edits. A destroyed store has nothing to
     * release.
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
        let failed = false;
        try {
            if (composition.kind === 'unread') {
                const { layer } = composition;
                const read = this.readRendered(id, layer.text, publish, []);
                const reading = read.settle(
                    await answerOrAbort(read.answer, publish.signal),
                );
                if (!this.isNewest(id, publish.sequence)) return;
                layer.read = reading;
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
                const result = await answerOrAbort(
                    this.engine.aggregateAssertions(
                        composition.contributors.map(withoutTakenFromWhole),
                        {
                            outputFormat: this.formatFor(id),
                            signal: publish.signal,
                            ...(whole ? { context: whole } : {}),
                        },
                    ),
                    publish.signal,
                );
                if (!this.isNewest(id, publish.sequence)) return;
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
                    state = read.settle(
                        await answerOrAbort(read.answer, publish.signal),
                    );
                } else state = this.fromProcessResult('', result);
            } else if (composition.kind === 'blocked') {
                // A category picker cannot correct text the parser did not
                // account for. Discard the pending category edits and reconcile
                // their sources, rather than silently dropping the unread text.
                const edits = this.layersOf(id).edits;
                for (const category of edits.categories.keys())
                    if (this.isDefaultScope(category))
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
                state = read.settle(
                    await answerOrAbort(read.answer, publish.signal),
                );
                if (this.isNewest(id, publish.sequence)) {
                    layer.read = {
                        ...state,
                        assertions: state.assertions.filter((a) =>
                            this.isDefaultScope(a.categoryId),
                        ),
                    };
                }
            } else {
                const read = this.readAssertions(
                    id,
                    composition.assertions,
                    publish,
                );
                state = read.settle(
                    await answerOrAbort(read.answer, publish.signal),
                );
            }
            if (!this.isNewest(id, publish.sequence)) return;
            this.keepRepairs(id, state);
            // Settled before its commit asks for the rollups it contributes to.
            this.endPublish(id, publish);
            this.commit(
                id,
                state,
                trigger.source,
                this.differsFromAsked(state, trigger),
            );
        } catch (error) {
            // Superseded or torn down: this composition's own signal is
            // aborted, so the store has already decided to throw its answer
            // away. Settling is the contract (see beginPublish); rethrowing
            // would surface a cancellation nobody asked for.
            if (publish.signal.aborted) return;
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
                // No commit is coming to ask for the rollups this read held.
                this.rerunHeldRollups();
            }
        }
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
            if (!this.isDefaultScope(categoryId)) continue;
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
                this.isDefaultScope(categoryId) === defaultScope;
        const baselineScoped =
            baseline && 'assertions' in baseline && edits.rendered?.text !== ''
                ? baseline.assertions.filter(
                      (a) => !this.isDefaultScope(a.categoryId),
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
                this.isDefaultScope(a.categoryId),
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

    /** Whether a category belongs to the scheme's default scope. */
    private isDefaultScope(categoryId: string): boolean {
        const index = this.resolveScopeIndex();
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
        const processText = (text: string) =>
            this.engine.process(text, {
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
                const read = {
                    ...this.fromProcessResult(rendered, result),
                    // The engine's writing, fixes included, verbatim.
                    rendered: acceptedValue(rendered, result),
                    // Where the author's text stands instead, the engine's
                    // account of its own writing is not about the value.
                    ...(keepsSource(result) ? { assessment: undefined } : {}),
                    // Keep this property even when absent from the response:
                    // receivers distinguish an unproven string read from an
                    // assertion-native state, which has no recognition field.
                    recognition: result.recognition,
                };
                const defaultScope = read.assertions.filter((a) =>
                    this.isDefaultScope(a.categoryId),
                );
                if (this.isNewest(id, publish.sequence)) {
                    this.noteStandIn(
                        id,
                        whole?.partOf !== undefined,
                        defaultScope,
                    );
                }
                return defaultScope.length === read.assertions.length &&
                    scoped.length === 0
                    ? read
                    : { ...read, assertions: [...defaultScope, ...scoped] };
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
            this.resolveScopeIndex(),
        );
        // A part's values taken from its whole are not sent back: the engine
        // takes them again from the whole as it stands now.
        const whole = this.wholeContextOf(id);
        const processFacts = (assertions: Assertion[]) =>
            this.engine.process(withoutTakenFromWhole(assertions), {
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

    getAggregate(): EzClassifyState {
        return this.aggregateCell.get();
    }

    subscribeAggregate(listener: (state: EzClassifyState) => void): () => void {
        this.assertAlive();
        this.aggregateListeners.add(listener);
        return () => {
            this.aggregateListeners.delete(listener);
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
            return;
        }
        if (prev === wholeId) return;
        this.partOfByMarking.set(markingId, wholeId);
        this.rolesChanged(markingId);
        if (prev && prev !== wholeId) void this.recomputeWholeRollup(prev);
        void this.recomputeWholeRollup(wholeId);
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
        void this.recomputeAggregate();
        for (const whole of new Set([previous, wholeId]))
            if (whole !== null) void this.recomputeWholeRollup(whole);
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
     * Current immutable ordered membership; markings remain in the normal
     * store.
     */
    getEntryIds(collectionId: string): readonly string[] | undefined {
        return this.entryCollections.get(collectionId);
    }

    /**
     * Commit collection membership without parsing text or duplicating marking
     * state.
     */
    setEntryIds(
        collectionId: string,
        entryIds: readonly string[],
        source?: PublishSource,
    ): void {
        this.assertAlive();
        if (
            !collectionId ||
            entryIds.some(
                (id) =>
                    typeof id !== 'string' || !id.trim() || id === collectionId,
            ) ||
            new Set(entryIds).size !== entryIds.length
        ) {
            throw new Error(
                'Marking entries require unique nonempty IDs distinct from the collection.',
            );
        }
        const previous = this.getEntryIds(collectionId);
        if (
            previous &&
            previous.length === entryIds.length &&
            previous.every((id, index) => id === entryIds[index])
        )
            return;
        const snapshot = Object.freeze([...entryIds]);
        this.entryCollections.set(collectionId, snapshot);
        for (const subscription of this.entryCollectionListeners.get(
            collectionId,
        ) ?? []) {
            if (this.entryCollections.get(collectionId) !== snapshot) break;
            if (source && source.token === subscription.source?.token) continue;
            subscription.listener(snapshot);
        }
    }

    /** Subscribe first, then read membership so hydration cannot miss a commit. */
    subscribeEntries(
        collectionId: string,
        listener: (ids: readonly string[]) => void,
        source?: PublishSource,
    ): () => void {
        this.assertAlive();
        let listeners = this.entryCollectionListeners.get(collectionId);
        if (!listeners) {
            listeners = new Set();
            this.entryCollectionListeners.set(collectionId, listeners);
        }
        const subscription = { listener, source };
        listeners.add(subscription);
        return () => {
            listeners.delete(subscription);
            if (!listeners.size)
                this.entryCollectionListeners.delete(collectionId);
        };
    }

    destroy(): void {
        if (this.destroyed) return;
        this.destroyed = true;
        // Nothing in flight has a reader any more, so drop the requests rather
        // than let a torn-down store keep an engine busy.
        for (const controller of this.publishAborts.values())
            controller.abort();
        for (const controller of this.facetAborts.values()) controller.abort();
        for (const controller of this.wholeRollupAborts.values())
            controller.abort();
        this.aggregateAbort?.abort();
        this.aggregateAbort = null;
        this.onDestroy();
        idleWatches.get(this)?.waiting.clear();
        this.markings.clear();
        this.committedMarkings.clear();
        this.failedMarkings.clear();
        this.incompleteContributors.clear();
        this.heldWholeRollups.clear();
        this.entryCollections.clear();
        this.entryCollectionListeners.clear();
        this.aggregateListeners.clear();
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
     * The render format one marking entry is published in.
     *
     * A store carries at most one format, the one the host page authors in, and
     * that is the WHOLE surface's format. Without one, a whole entry is written
     * in the scheme's default format, which is what every view showing the
     * marking's `rendered` reads it as. Naming it matters for a scheme that
     * writes each role in a view of its own: a publish that names no format is
     * written in the view of whatever role its text reads as, so part-spelled
     * text would put a part's spelling in a whole marking.
     *
     * A marking registered through {@link setPartOf} is not on that surface: it
     * is a part of another marking, and a scheme writes its parts in its own
     * part format. The scheme's metadata names both, so the role of the entry
     * decides the format and no format id is spelled into this file. A scheme
     * that declares no part format falls back to the store's format, which is
     * what a scheme with one surface means.
     */
    private formatFor(id: string): string | undefined {
        if (!this.partOfByMarking.has(id)) {
            if (this.format) return this.format;
            if (this.wholeFormatCache === undefined) {
                this.wholeFormatCache =
                    this.engine.getSchemeMeta().defaultRenderFormat ?? null;
            }
            return this.wholeFormatCache ?? undefined;
        }
        if (this.partFormatCache === undefined) {
            this.partFormatCache =
                this.engine.getSchemeMeta().defaultPartRenderFormat ?? null;
        }
        return this.partFormatCache ?? this.format;
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
     * Resolve (and memoize) the per-category scope routing from the engine's
     * scheme metadata. Always returns a real index, `getSchemeMeta` and
     * `listCategories` are required capabilities (validated in the
     * constructor), so there is no null path: a scheme with no declared scopes
     * simply yields an empty `byCategory`, routing everything to the default
     * scope by data.
     *
     * A category is default-scope when it declares no explicit `scopes`, or
     * when its explicit scopes include the scheme's default scope. Otherwise it
     * is an alternate-scope category and its assertions bypass the banner
     * projection. This mirrors the engine's suggest-side rule
     * (build-suggestions.ts): an unscoped category belongs to the default
     * scope; an explicitly scoped category belongs to exactly the scopes it
     * names.
     */
    private resolveScopeIndex(): ScopeIndex {
        if (this.scopeIndexCache !== null) {
            return this.scopeIndexCache;
        }
        const meta = this.engine.getSchemeMeta();
        const categories = this.engine.listCategories();
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
        const index: ScopeIndex = { defaultScope, byCategory };
        this.scopeIndexCache = index;
        return index;
    }

    private fromProcessResult(
        rendered: string,
        result: EzClassifyStoreProcessResult | EzClassifyStoreAggregateResult,
    ): EzClassifyState {
        return {
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
        void this.recomputeAggregate();
        const partOfWhole = this.partOfByMarking.get(id);
        if (partOfWhole) void this.recomputeWholeRollup(partOfWhole);
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
     * Latest-wins by revision, like the aggregate and whole-rollup recomputes.
     * Two commits in quick succession open two overlapping fan-outs, and over a
     * wire the older one can resolve last; without the guard every facet picker
     * would end up showing the allowable options of a superseded marking state
     * until the next commit happened to fix it. The superseded fan-out is also
     * aborted, so its requests stop traveling.
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
        categoryIds: string[],
        committed: EzClassifyState,
        signal: AbortSignal,
    ): Promise<(Suggestion[] | null)[]> {
        // What the marking states: values a part took from its whole are the
        // whole's, and the engine is never handed them back.
        const state = {
            ...committed,
            assertions: withoutTakenFromWhole(committed.assertions),
        };
        const scopeIndex = this.resolveScopeIndex();
        const scopeOf = (categoryId: string): string | undefined =>
            scopeIndex.byCategory.get(categoryId) ?? scopeIndex.defaultScope;

        if (this.engine.suggestForCategories) {
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
                            this.engine.suggestForCategories!(
                                state.assertions,
                                group,
                                {
                                    outputFormat: this.format,
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

        if (!this.engine.suggest) return categoryIds.map(() => null);
        return Promise.all(
            categoryIds.map(async (categoryId) => {
                const contextAssertions = state.assertions.filter(
                    (a) => a.categoryId !== categoryId,
                );
                try {
                    const result = await Promise.resolve(
                        this.engine.suggest!(contextAssertions, {
                            outputFormat: this.format,
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
     * whole is unresolved rather than judged by the whole rules.
     */
    private wholeContextOf(id: string): ProcessingContext | undefined {
        const wholeId = this.partOfByMarking.get(id);
        if (!wholeId) return undefined;
        return this.wholeContext(wholeId) ?? { role: 'part' };
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
            return this.engine.getSchemeMeta().roleAware !== false;
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

    /**
     * The whole the page aggregate reads its parts against. One aggregate call
     * takes one whole, so there is one only while every marking on the page is
     * that whole or one of its parts. Otherwise there is none, and a part that
     * stands for its whole's values contributes only what it wrote. The whole
     * is then a contributor too, read in its own value like its parts.
     */
    private sharedWholeContext(): ProcessingContext | undefined {
        const wholes = new Set(this.partOfByMarking.values());
        if (wholes.size !== 1) return undefined;
        const [wholeId] = wholes;
        for (const [id, entry] of this.markings) {
            if (entry.cell.get().assertions.length === 0) continue;
            if (id !== wholeId && this.partOfByMarking.get(id) !== wholeId) {
                return undefined;
            }
        }
        return this.wholeContext(wholeId);
    }

    private async recomputeAggregate(): Promise<void> {
        if (this.destroyed) return;
        const revision = ++this.aggregateRevision;
        this.aggregateAbort?.abort();
        // The commit that settles the last contributor computes it.
        this.aggregateHeld = !this.contributorsSettled(null);
        if (this.aggregateHeld) return;
        const controller = new AbortController();
        this.aggregateAbort = controller;
        // Single suspension point: see rollupResult. Awaiting a delegated async
        // helper instead would add a microtask tick, desyncing observers that read
        // a cell right after `await publishRendered(...)`.
        const next = await this.rollupResult(
            this.gatherContributors(null),
            this.sharedWholeContext(),
        );
        if (revision !== this.aggregateRevision || this.destroyed) return;
        if (this.aggregateAbort === controller) this.aggregateAbort = null;
        // A contributor started reading again while this was on the wire.
        if (!this.contributorsSettled(null)) {
            this.aggregateHeld = true;
            return;
        }
        const resolved = this.flagMissing(
            null,
            next ?? this.heldState(this.aggregateCell.get()),
        );
        if (resolved === null || this.staysEmpty(this.aggregateCell, resolved))
            return;
        this.aggregateCell.set(resolved);
        this.fireAggregate(resolved);
    }

    private fireAggregate(state: EzClassifyState): void {
        for (const l of this.aggregateListeners) l(state);
    }

    private async recomputeWholeRollup(wholeId: string): Promise<void> {
        if (this.destroyed) return;
        const revision = (this.wholeRollupRevisions.get(wholeId) ?? 0) + 1;
        this.wholeRollupRevisions.set(wholeId, revision);
        this.wholeRollupAborts.get(wholeId)?.abort();
        // The commit that settles the last part computes it.
        if (!this.contributorsSettled(wholeId)) {
            this.heldWholeRollups.add(wholeId);
            return;
        }
        this.heldWholeRollups.delete(wholeId);
        const controller = new AbortController();
        this.wholeRollupAborts.set(wholeId, controller);
        const next = await this.rollupResult(
            this.gatherContributors(wholeId),
            this.wholeContext(wholeId),
        );
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
        const resolved = this.flagMissing(
            wholeId,
            next ?? this.heldState(cell.get()),
        );
        if (resolved === null || this.staysEmpty(cell, resolved)) return;
        cell.set(resolved);
        const set = this.wholeRollupListeners.get(wholeId);
        if (!set) return;
        for (const l of set) l(resolved);
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
     * Whether every contributor to a rollup has settled (see {@link settled}). A
     * rollup is computed only from settled contributors, so the values it
     * combines, and the requests that carry them, depend on the markings and
     * not on the order the engine answered their reads in. Each contributor's
     * commit, and each failed read, asks for the rollup again, so the answer
     * that settles the last one computes it.
     *
     * With `wholeId` null the contributors are the page aggregate's: every
     * registered part and every marking something has seeded or published.
     * Otherwise they are the parts registered under `wholeId` and the whole
     * itself, since a whole rollup reads its parts against the whole's value.
     */
    private contributorsSettled(wholeId: string | null): boolean {
        for (const [partId, parent] of this.partOfByMarking) {
            if (
                (wholeId === null || parent === wholeId) &&
                !this.settled(partId)
            )
                return false;
        }
        if (wholeId === null) {
            for (const id of this.layers.keys())
                if (!this.settled(id)) return false;
            return true;
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

    /** Ask again for every rollup held while a contributor was unsettled. */
    private rerunHeldRollups(): void {
        if (this.aggregateHeld) void this.recomputeAggregate();
        for (const wholeId of [...this.heldWholeRollups])
            void this.recomputeWholeRollup(wholeId);
    }

    /**
     * A rollup computed while a contributor's first read failed is missing that
     * contributor, and one computed over a contributor that read only part of
     * its source is missing the rest, so either says it is held rather than
     * current.
     */
    private flagMissing(
        wholeId: string | null,
        state: EzClassifyState | null,
    ): EzClassifyState | null {
        if (!state || state.stale) return state;
        for (const id of this.failedMarkings) {
            const parent = this.partOfByMarking.get(id);
            if (wholeId === null ? true : parent === wholeId)
                return { ...state, stale: true };
        }
        for (const parent of this.incompleteContributors.values()) {
            if (wholeId === null ? true : parent === wholeId)
                return { ...state, stale: true };
        }
        return state;
    }

    /**
     * Collect contributor assertion sets. With `wholeId` null, every marking
     * contributes (page aggregate); otherwise only the markings whose
     * `setPartOf` named `wholeId` contribute (whole rollup).
     *
     * Only structured assertion sets are gathered: rollup runs through
     * `aggregateAssertions`, never rendered strings, so alternate-scope
     * categories and capture values survive the rollup. Sets are ordered by
     * marking id.
     */
    private gatherContributors(wholeId: string | null): Assertion[][] {
        const ids =
            wholeId === null
                ? [...this.markings.keys()]
                : [...this.partOfByMarking]
                      .filter(([, parent]) => parent === wholeId)
                      .map(([markingId]) => markingId);
        // Registration order follows whichever field finished mounting first.
        // Sorting by id gives the engine the same sets in the same order for the
        // same markings on every load.
        const assertionSets: Assertion[][] = [];
        for (const id of ids.sort()) {
            const assertions = this.markings.get(id)?.cell.get().assertions;
            if (assertions?.length) assertionSets.push(assertions);
        }
        return assertionSets;
    }

    /**
     * Combine contributor assertion sets into a single rolled-up state via
     * `engine.aggregateAssertions`: the only rollup path. There is no
     * rendered-string fallback: `aggregateAssertions` is a required capability
     * (validated in the constructor), so aggregating over structured assertions
     * is always available and authored alternate-scope categories + capture
     * values survive the rollup. Returns the empty state when there are no
     * contributors, and `null` when the engine could not answer: an empty
     * rollup and a failed one are different facts, and the caller holds the
     * last good value for the second (see {@link heldState}).
     *
     * NOT `async`: it returns either a state synchronously, or the raw engine
     * result (which may itself be sync or a Promise). The caller awaits it
     * exactly once. Wrapping this in its own `async` function would add a
     * second microtask tick to the fire-and-forget recompute, so a consumer
     * reading a cell right after `await publishRendered(...)` would see a stale
     * value; the per-framework adapters awaited the engine call inline before
     * this was extracted, and that timing is preserved here.
     */
    private rollupResult(
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
            ...(this.format ? { outputFormat: this.format } : {}),
            ...(whole ? { context: whole } : {}),
        };
        let result:
            | EzClassifyStoreAggregateResult
            | Promise<EzClassifyStoreAggregateResult>;
        try {
            result = this.engine.aggregateAssertions(assertionSets, opts);
        } catch {
            return null;
        }
        if (result instanceof Promise) {
            return result.then(
                (r) => this.fromProcessResult('', r),
                () => null,
            );
        }
        return this.fromProcessResult('', result);
    }
}
