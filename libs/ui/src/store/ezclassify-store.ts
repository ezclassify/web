/**
 * Marking store: the binding-layer state container for `@ezclassify/ui`.
 *
 * Per `libs/ui/docs/binding-model.md` §1–§8: the library tracks a small graph
 * of marking objects, each keyed by id. Views (autocompleters, facet pickers,
 * banners, cards, …) bind to a marking through `data-ezclassify-*` attributes;
 * the runtime wires every bound view through this store. Publish + subscribe
 * happen against the store, never against the DOM directly. The page-level
 * aggregate is a separate computed marking the store synthesizes from its
 * contributors.
 *
 * `@ezclassify/ui` ships the interface and a `VanillaEzClassifyStore` reference
 * implementation. Framework adapters (`@ezclassify/angular`,
 * `@ezclassify/react`, `@ezclassify/vue`) implement the same interface backed
 * by their framework's native reactive primitive; see §8 "state adapter
 * pattern" in the doc. `adapter-parity-suite.ts` runs against all four
 * implementations to keep their observable behavior identical.
 */

import type {
    Assertion,
    Change,
    Fix,
    ProcessResult,
    ConceptColor,
    ValidationError,
    ProcessingContext,
    RenderAssessment,
    RenderResultsByFormat,
    Suggestion,
} from '@ezclassify/types';
import {
    BaseEzClassifyStore,
    type ReactiveCell,
} from './base-ezclassify-store';

/**
 * Minimal subset of the engine surface a `EzClassifyStore` needs. Defined
 * locally so the store contract does not pull in the full `SchemeEngineAdapter`
 * shape. EzClassify supports only its own engines behind this surface, the
 * in-process engine and the REST client; custom external engines are not
 * supported.
 *
 * ## The lossless-transport contract
 *
 * The store's single architectural guarantee is that authored state
 * (alternate-scope categories, capture-value free text) survives every publish,
 * rollup, and capture round-trip byte-identically. That guarantee only holds if
 * the store never flattens an assertion set to a rendered string and re-parses
 * it: a scheme's banner render format writes only the categories its field tree
 * binds, leaving alternate-scope ones out, and emits only concept labels (never
 * `assertion.value`), so a render→process round-trip silently drops both.
 *
 * `aggregateAssertions`, `getSchemeMeta`, and `listCategories` are therefore
 * **required**, not optional. They are precisely the members that let the store
 * roll up and route by structured assertions instead of strings:
 *
 * - `aggregateAssertions`: rollup runs over each contributor's true assertion
 *   set. Without it the store would have to `aggregate(renderedStrings)`, which
 *   re-introduces the drop one layer up.
 * - `getSchemeMeta` + `listCategories`: scope routing, so a `publishAssertions`
 *   partitions default-scope (banner) from alternate-scope categories. Without
 *   them every assertion would route through the lossy banner round-trip.
 *
 * A store that cannot be lossless must not run. `BaseEzClassifyStore`'s
 * constructor validates these at construction and throws, naming the missing
 * capability; see {@link BaseEzClassifyStore}. Both shipped adapters satisfy all
 * three, so the gate is a guard against a hand-rolled adapter, not a known gap.
 * An adapter that cannot serve them is refused at construction; there is no
 * rendered-string fallback.
 *
 * ## Ordering and cancellation
 *
 * The store assumes nothing about the order engine calls answer in. Every
 * publish carries a per-marking sequence, every rollup and facet refresh
 * carries a revision, and a superseded call's result is discarded on arrival
 * instead of committed. Option bags carry an optional `signal` so an adapter
 * that talks over a wire can drop the superseded request rather than pay for a
 * response nobody will read; an in-process engine may ignore it.
 *
 * Every call must resolve or reject in bounded time. A rollup waits for the
 * reads of its contributors, and the store sets no timer of its own: a call
 * that never answers holds the rollups that read it. An adapter that talks over
 * a wire times its requests out and rejects. A rejected read counts as settled:
 * the marking keeps the value it last committed, and a rollup computed without
 * one that never committed is flagged {@link EzClassifyState.stale}.
 */
export interface EzClassifyStoreEngine {
    process(
        input: string | Assertion[],
        options?: {
            outputFormat?: string;
            /**
             * The outputs to write into `renders`. The store names only the
             * ones its views hold (see {@link EzClassifyStore.requestOutput}).
             */
            outputs?: string[];
            context?: ProcessingContext;
            signal?: AbortSignal;
        },
    ): EzClassifyStoreProcessResult | Promise<EzClassifyStoreProcessResult>;
    /**
     * Optional render capability; the store never uses rendered strings as
     * transport.
     */
    render?(assertions: Assertion[], format?: string): unknown;
    /**
     * Aggregate (roll up) multiple marking strings into a combined marking.
     * Each category's rollup operator (max, union, intersect, …) is applied per
     * scheme.
     *
     * Retained on the contract for engines/consumers that still hold rendered
     * strings, but the store itself never calls it: rollup runs through
     * {@link aggregateAssertions} over structured assertion sets so authored
     * alternate-scope categories and capture values survive. Re-parsing
     * rendered strings drops both silently; that is the render-as-transport bug
     * class this store is built to avoid.
     */
    aggregate(
        inputs: string[],
        options?: { inputFormat?: string; outputFormat?: string },
    ): EzClassifyStoreAggregateResult | Promise<EzClassifyStoreAggregateResult>;
    /**
     * Aggregate already-parsed assertion sets: the assertion-side sibling of
     * {@link aggregate}, and the only rollup path the store uses. The rollup
     * math runs over each contributor's true structured form
     * (`entry.state.assertions`) instead of round-tripping through the scheme's
     * parser, so alternate-scope categories and capture-value free text are
     * preserved.
     *
     * **Required.** An engine without it cannot back a store: the store refuses
     * to construct rather than fall back to the lossy {@link aggregate} path.
     */
    aggregateAssertions(
        assertionSets: Assertion[][],
        options?: {
            outputFormat?: string;
            /**
             * The whole the contributors are parts of. A contributor that
             * writes a word for its whole's values takes them from here.
             */
            context?: ProcessingContext;
            /** Cancellation of a superseded contributor read. */
            signal?: AbortSignal;
        },
    ): EzClassifyStoreAggregateResult | Promise<EzClassifyStoreAggregateResult>;
    /**
     * Return the concepts addable to a marking given the current assertion
     * context. Used by the store to drive per-category facet availability
     * without requiring each facet picker to make its own redundant suggest
     * call.
     *
     * Optional: when neither this nor {@link suggestForCategories} is present,
     * facet subscriptions receive a `null` `allowableOptions` and the facet
     * picker falls back to showing all concepts.
     *
     * Note: the store calls the single-scheme overload. Multi-scheme engines
     * need a separate adapter that threads schemeId if required.
     */
    suggest?(
        input: string | Assertion[],
        options?: {
            outputFormat?: string;
            surface?: string;
            assertions?: Assertion[];
            signal?: AbortSignal;
        },
    ): { suggestions: Suggestion[] } | Promise<{ suggestions: Suggestion[] }>;
    /**
     * Answer several categories at once against one committed assertion set,
     * keyed by category id. Each category is answered as if its own assertions
     * were not chosen yet, so a picker offers the alternatives to the current
     * selection rather than only what is still addable beside it. The adapter
     * owns that exclusion; the store sends the committed set once.
     *
     * Optional, and feature-detected: an adapter that implements it collapses
     * the store's facet fan-out from one call per subscribed category to one
     * call per scope. An adapter without it keeps the {@link suggest} fan-out,
     * which produces the same {@link FacetState} at more round trips.
     */
    suggestForCategories?(
        assertions: Assertion[],
        categoryIds: string[],
        options?: {
            outputFormat?: string;
            surface?: string;
            signal?: AbortSignal;
        },
    ):
        | Record<string, { suggestions: Suggestion[] }>
        | Promise<Record<string, { suggestions: Suggestion[] }>>;
    /**
     * Scheme identity + scope configuration. The store reads `defaultScope` and
     * the scope list to decide which incoming assertions belong to a marking's
     * default (banner) scope versus an alternate scope.
     *
     * **Required.** Paired with {@link listCategories}, this is how
     * `publishAssertions` partitions default-scope from alternate-scope
     * categories. Without it every assertion would route through the lossy
     * banner round-trip, so the store refuses to construct.
     */
    getSchemeMeta(schemeId?: string): EzClassifyStoreSchemeMeta;
    /**
     * Resolved category descriptors. The store reads each category's `scopes`
     * to map an assertion's `categoryId` to its scope (assertions carry no
     * scope of their own; scope is scheme metadata keyed by category).
     *
     * **Required**, paired with {@link getSchemeMeta}: the store partitions by
     * scope only with both present. Without it every assertion would route
     * through the lossy banner round-trip, so the store refuses to construct.
     */
    listCategories(schemeId?: string): EzClassifyStoreCategoryMeta[];
}

/**
 * Minimal scheme-metadata subset the store consumes: the scope fields it routes
 * assertions by, the formats it publishes whole and part entries in, and the
 * outputs a view may ask for. A subset of the engine's `SchemeMetaView`.
 */
export interface EzClassifyStoreSchemeMeta {
    /**
     * Explicit false proves contribution rules ignore the whole; absent is
     * unknown.
     */
    roleAware?: boolean;
    /** Default scope ID applied to categories that declare no explicit scopes. */
    defaultScope?: string;
    /** Available scopes: id and display label. */
    scopes?: Array<{ id: string; label?: string }>;
    /**
     * The format a whole marking is written in when the store names none of its
     * own. A scheme that writes each role in a view of its own would otherwise
     * write a marking in whatever role its text happens to read as.
     */
    defaultRenderFormat?: string;
    /**
     * The format a part of a marking is written in. A marking registered
     * through `setPartOf` is on the part surface, not the whole surface the
     * store's own format names, so it publishes in this one. Absent means the
     * scheme writes one surface and the store's format covers it.
     */
    defaultPartRenderFormat?: string;
    /**
     * The outputs the scheme declares, each by the id a publish names it with
     * and its result keys it by in `renders`.
     */
    formats?: Array<{ id: string }>;
}

/**
 * Minimal category-metadata subset the store consumes for scope routing. A
 * subset of the engine's `CategoryView`; only id + scopes are read.
 */
export interface EzClassifyStoreCategoryMeta {
    /** Unique category identifier: matches an assertion's `categoryId`. */
    id: string;
    /**
     * Scope IDs this category is visible in. Empty or absent means the category
     * belongs to the scheme's default scope only (or all scopes when the scheme
     * declares no default), mirroring the engine's suggest-side scope rule.
     */
    scopes?: string[];
}

/**
 * Combined allowability + selection state for one category facet of a marking.
 * Delivered by {@link EzClassifyStore.subscribeFacet} whenever either side
 * changes.
 */
export interface FacetState {
    /**
     * Concepts the engine considers addable in this category given the full
     * current marking context.
     *
     * - `null`: the store's engine does not implement `suggest`; the facet picker
     *   should fall back to showing all concepts.
     * - `[]` (empty array): the engine ran and returned no suggestions for this
     *   category (e.g. all concepts are gated by a sibling selection); the
     *   picker should show only already-selected concepts so the user can
     *   deselect them.
     * - Non-empty array; the set of concepts the engine considers addable or
     *   already selected.
     */
    allowableOptions: Suggestion[] | null;
    /** The assertions the user has already selected for this category. */
    selectedAssertions: Assertion[];
}

/** Subset of `ProcessResult` the store consumes. Other fields are ignored. */
export interface EzClassifyStoreProcessResult {
    /** Whether recognition accounted for every character of supplied text. */
    recognition?: ProcessResult['recognition'];
    rendered: string;
    /** What writing `rendered` wrote, left out, or could not write. */
    assessment: RenderAssessment;
    /** The outputs the publish named in `outputs`, and only those. */
    renders: RenderResultsByFormat;
    assertions: Assertion[];
    valid: boolean;
    errors: ValidationError[];
    /** What the engine changed on its own while processing. */
    appliedFixes?: Change[];
    /** The ways to make the result valid, each a whole marking. */
    proposedFixes?: Fix[];
    /** What was read before repair, present when repair changed it. */
    assertionsBeforeRepair?: Assertion[];
    /** Portable scheme-derived default; host/component overrides are not stored. */
    displayColor?: ConceptColor;
}

/** Subset of `AggregateResult` the store consumes for computed rollups. */
export interface EzClassifyStoreAggregateResult {
    rendered: string;
    assertions: Assertion[];
    valid: boolean;
    errors: ValidationError[];
    /** Portable scheme-derived default; host/component overrides are not stored. */
    displayColor?: ConceptColor;
}

/**
 * Per-marking state held by the store. Both representations are kept in sync by
 * the engine round-trip, so consumers reading either side see consistent data
 * regardless of which side last published. See doc §4.
 */
export interface EzClassifyState {
    /** Recognition of a supplied string; absent for structured/computed states. */
    recognition?: ProcessResult['recognition'];
    rendered: string;
    /**
     * What writing `rendered` wrote, left out, or could not write. Present when
     * the state came from a publish; a rolled-up state has none.
     */
    assessment?: RenderAssessment;
    /**
     * The outputs this marking's views asked for (see
     * {@link EzClassifyStore.requestOutput}), written by the publish that
     * committed the state. Empty when no view holds one, and on a rolled-up
     * state.
     */
    renders: RenderResultsByFormat;
    assertions: Assertion[];
    valid: boolean;
    errors: ValidationError[];
    /**
     * What the engine changed on its own while reading this state, each change
     * once. Present when the state came from a publish; a rolled-up state has
     * none.
     */
    appliedFixes?: Change[];
    /**
     * The ways to make this state valid, each a whole marking. Present when the
     * state came from a publish; a rolled-up state has none.
     */
    proposedFixes?: Fix[];
    /** Portable scheme-derived default; host/component overrides are not stored. */
    displayColor?: ConceptColor;
    /** Present only when this state came from `aggregateAssertions`. */
    aggregate?: true;
    /**
     * `true` when a rolled-up state is held rather than fresh: the last rollup
     * the store attempted for it failed, so the previous value is still on
     * display and no longer reflects the current contributors.
     *
     * Only the two rolled-up surfaces carry this: the page aggregate
     * (`getAggregate`/`subscribeAggregate`) and a whole rollup
     * (`getWholeRollup`/`subscribeWholeRollup`). A per-marking state from
     * `get`/`subscribe` is the direct result of a publish, which either commits
     * or does not, so it is always absent there, as it is on
     * {@link FacetState}.
     *
     * Absent means the state is the result of a rollup that actually ran, or
     * that it is not a rollup at all. A remote engine makes the difference
     * load-bearing: a dropped connection would otherwise blank an aggregate
     * banner, which reads as "unclassified" rather than "unknown". Holding the
     * last good value and saying so lets a consumer render an unresolved
     * treatment instead of a confident lie, and the flag clears itself on the
     * next rollup that succeeds.
     */
    stale?: boolean;
}

/**
 * Identifies the view that initiated a publish. Carried back through subscribe
 * callbacks so each view can skip an unchanged self-echo and avoid the "publish
 * → subscribe → republish" cycle. If engine processing commits a different
 * canonical value, the source view is notified so its displayed selection
 * reconciles with the store. Compared by identity; the token is opaque to the
 * store.
 */
export interface PublishSource {
    token: unknown;
}

/**
 * Optional ordered membership for body editors with a variable number of marks.
 * IDs identify ordinary store markings, not copies of their state. Membership
 * carries no prose: each editor owns its source text and its entry/body spans.
 */
export interface MarkingEntriesStore {
    /**
     * Immutable current membership; undefined means no membership has been
     * committed.
     */
    getEntryIds(collectionId: string): readonly string[] | undefined;
    /** Commit unique nonempty entry IDs; the collection cannot contain itself. */
    setEntryIds(
        collectionId: string,
        entryIds: readonly string[],
        source?: PublishSource,
    ): void;
    /**
     * Observe committed membership. Read getEntryIds after subscribing for
     * hydration.
     */
    subscribeEntries(
        collectionId: string,
        listener: (entryIds: readonly string[]) => void,
        source?: PublishSource,
    ): () => void;
}

/**
 * The store contract every implementation honors. `subscribe` and
 * `subscribeAggregate` fire synchronously on the commit that follows a publish;
 * both return an unsubscribe handle. Implementations must not fan a publish
 * back to the originating view when `PublishSource.token` matches a registered
 * listener token when the committed result is unchanged; that's how cycles are
 * broken at the seam between views and the framework reactivity layer. A
 * canonicalized or repaired result is delivered to the source as well as the
 * other views.
 *
 * Aggregate axes the store exposes:
 *
 * - **Page aggregate**; combination of every marking in the store. One per page.
 *   Subscribed via `subscribeAggregate`.
 * - **Whole rollup**; combination of only the markings that have been associated
 *   with a whole id through `setPartOf(child, whole)`. One per whole.
 *   Subscribed via `subscribeWholeRollup(wholeId)`.
 *
 * The runtime calls `setPartOf` whenever it registers a marking that carries
 * `data-ezclassify-part-of`. The store itself doesn't read DOM; it tracks the
 * relationship through this method and recomputes the whole-rollups when their
 * contributors commit.
 *
 * A rollup combines settled contributors only: it is computed once the store
 * has nothing pending for any contributor, so what it sends the engine follows
 * from the markings and not from the order their reads were answered in. A
 * contributor is settled when no read of it is on the wire and the read it was
 * asked for has committed or failed. One nobody has seeded or published was
 * never asked for: it is settled and contributes nothing until it is. The
 * answer that settles the last contributor computes the rollup.
 */
export interface EzClassifyStore extends Partial<MarkingEntriesStore> {
    /**
     * Get the current state for `id`. Returns the empty state when the marking
     * is unknown.
     */
    get(id: string): EzClassifyState;

    /** Subscribe to state changes for `id`. Fires synchronously on every commit. */
    subscribe(
        id: string,
        listener: (state: EzClassifyState) => void,
        source?: PublishSource,
    ): () => void;

    /**
     * Ask for `output` beside `rendered` in every state committed for `id` from
     * now on, in `renders`. A process writes only the outputs it is asked for,
     * so the store names in a publish exactly the outputs some view of that
     * marking holds, and none once the last hold is released.
     *
     * A state committed before the request, and a rolled-up state, have no
     * entry for it. A view that holds an output writes it from the state's
     * `assertions` when the entry is missing.
     *
     * @param id - The marking the output is for
     * @param output - An output the scheme declares, spelled as a key of
     *   `renders` is: one of the ids its metadata lists in `formats`
     * @returns Releases this request
     * @throws When the scheme declares no such output. A process refuses to
     *   name one, so holding it would make every later publish for `id` fail.
     */
    requestOutput(id: string, output: string): () => void;

    /**
     * Publish an edit from the rendered side. Triggers `engine.process`
     * internally. The string restates the marking's whole default scope; its
     * alternate scope is kept. An empty string clears the marking.
     *
     * Every publish is an edit. It lands in the marking's edit layer, on top of
     * whatever its host was seeded with, before the seed, while it is on the
     * wire, or after it lands (see {@link seedRendered}).
     */
    publishRendered(
        id: string,
        rendered: string,
        source?: PublishSource,
    ): Promise<void>;

    /**
     * Publish an edit from the assertion side. Triggers `engine.process`
     * internally. The set is read as a per-category change against the state
     * the caller read: the categories that differ from it replace those
     * categories in the marking's edit layer, so a concurrent edit to another
     * category is kept.
     *
     * A caller that edits known categories, such as a facet picker, names them
     * in `options.categories`; each is then replaced by exactly the assertions
     * given for it, so putting back the value the caller read is an edit too.
     */
    publishAssertions(
        id: string,
        assertions: Assertion[],
        source?: PublishSource,
        options?: { categories?: readonly string[] },
    ): Promise<void>;

    /**
     * Publish a computed marking from separate contributors. The store asks the
     * engine to aggregate them and retains its complete validity/errors;
     * reprocessing only the resulting facts would lose contributor failures.
     * Built-in stores provide this capability. Custom stores used by a bound
     * MarkedTextArea must provide it as well.
     */
    publishAggregate?(
        id: string,
        assertionSets: Assertion[][],
        source?: PublishSource,
    ): Promise<void>;

    /**
     * Seed a marking with the rendered value its host was served with. The
     * runtime seeds every marking host once its fields have initialized.
     *
     * A marking commits two layers: the baseline its host was served with,
     * which only a seed sets, and the edits users and applications wrote, which
     * only a publish changes. The committed value is always the engine's
     * reading of the baseline with the edits on top, so the order a seed and an
     * edit arrive in cannot change it: a pick survives the seed, and so does
     * every served category nobody edited. A later seed replaces the baseline
     * and keeps the edits. A rendered value states only the default scope, so a
     * rendered baseline contributes no alternate scope.
     *
     * @returns Resolves once this seed's own read has settled; a newer edit may
     *   still be landing on top.
     */
    seedRendered(id: string, rendered: string): Promise<void>;

    /**
     * Seed a marking with assertions its host already carries, such as the
     * leading mark a body editor parsed. Same contract as {@link seedRendered};
     * an assertion baseline contributes both scopes.
     */
    seedAssertions(id: string, assertions: Assertion[]): Promise<void>;

    /**
     * Release a marking whose host has left the page. Its baseline and its
     * edits are dropped and the empty marking is committed, so it leaves the
     * page aggregate and the next seed under the same id starts from its own
     * served value. That is not an edit. A destroyed store has nothing to
     * release.
     */
    releaseSeed(id: string): void;

    /** Get the current page-aggregate state. */
    getAggregate(): EzClassifyState;

    /** Subscribe to aggregate state changes. */
    subscribeAggregate(listener: (state: EzClassifyState) => void): () => void;

    /**
     * Associate a marking with a whole (parent) for whole-rollup computation.
     * Pass `null` for `wholeId` to clear the relationship: used when a part
     * field is torn down or when a part-of attribute is removed. Idempotent:
     * calling with the same pair twice is a no-op.
     */
    setPartOf(markingId: string, wholeId: string | null): void;

    /**
     * Record whether a contributor read only part of its source: a marked text
     * area whose scan stopped before the end of its text. The rollups it feeds
     * (the page aggregate and, with `wholeId`, that whole's rollup) are then
     * computed from what it did read and flagged {@link EzClassifyState.stale},
     * the way a contributor whose read failed flags them, until it is cleared.
     *
     * @param contributorId - Identifies the source; one record per id
     * @param wholeId - The whole its markings roll up into, or `null`
     * @param incomplete - `true` to record it, `false` to clear it
     * @internal
     */
    setIncompleteContributor?(
        contributorId: string,
        wholeId: string | null,
        incomplete: boolean,
    ): void;

    /**
     * Get the current rollup of every marking whose `setPartOf` named `wholeId`
     * as its parent. The whole itself is NOT included; this is the aggregate of
     * the parts only, the value a "computed part rollup" display should
     * subscribe to.
     */
    getWholeRollup(wholeId: string): EzClassifyState;

    /**
     * Subscribe to changes in the rollup of parts under `wholeId`. Fires when a
     * contributor commit (a marking with `setPartOf(.., wholeId)`) leaves every
     * part, and the whole, settled. It does not fire on a commit of the whole
     * itself.
     */
    subscribeWholeRollup(
        wholeId: string,
        listener: (state: EzClassifyState) => void,
    ): () => void;

    /**
     * Current combined allowability + selection state for one category facet of
     * a marking. The synchronous read that pairs with {@link subscribeFacet},
     * exactly as {@link get} pairs with {@link subscribe}.
     *
     * Returns the show-all fallback (`allowableOptions: null`, no selection)
     * for a facet the store has not computed yet. A facet is recomputed only
     * while it has at least one `subscribeFacet` listener, so a caller that
     * polls this without subscribing reads a value that never advances.
     */
    getFacet(markingId: string, categoryId: string): FacetState;

    /**
     * Subscribe a facet view to combined allowability + selection state for one
     * category of a marking. The listener fires whenever either
     * `allowableOptions` or `selectedAssertions` changes, with diffing to
     * suppress no-op notifications.
     *
     * A facet the store has already computed replays its current state to the
     * new listener immediately, so a control that binds a facet another control
     * is already on starts from the same values instead of waiting for a change
     * that may never come. While a commit's facet answer is still on the wire,
     * that replay is the previous answer and the new one follows it. A facet
     * with no computed state yet is computed once its first listener
     * subscribes, unless a commit that will compute it is already on the way.
     *
     * A facet that missed a commit while nobody listened to it is computed
     * again in the same way, not replayed. A control remounted by the very
     * change its options depend on gets the options for that change, not the
     * ones its predecessor showed.
     *
     * Each subscribed category is answered as if its own assertions were not
     * chosen yet, so a single-select category that already holds a committed
     * concept still surfaces the alternatives to it. An engine that implements
     * `suggestForCategories` answers every category of a scope in one call; one
     * that implements only `suggest` is fanned out, one call per category.
     *
     * Requires `EzClassifyStoreEngine.suggest` (or `suggestForCategories`) to
     * be implemented. Facets on engines that offer neither receive a `null`
     * `allowableOptions` (show-all fallback; the listener is called on every
     * commit in that case).
     */
    subscribeFacet(
        markingId: string,
        categoryId: string,
        listener: (state: FacetState) => void,
    ): () => void;

    /**
     * Tear the store down. Disconnects all listeners and releases the engine
     * reference.
     */
    destroy(): void;
}

// Shared by every store implementation; defined in ./store-shared so the
// runtime import graph between this module and base-ezclassify-store stays
// acyclic. Re-exported here (and from the package root) as the helpers'
// public home.
export {
    EMPTY_EZCLASSIFY_STATE,
    EMPTY_FACET_STATE,
    facetStateEqual,
} from './store-shared';

/**
 * Reference `EzClassifyStore` implementation, backed by a plain `Map`. Used as
 * the default store inside `@ezclassify/ui` when no framework adapter is in
 * play, and as the behavioral oracle for the shared conformance suite; every
 * framework-backed implementation must match this one's observable behavior.
 *
 * All engine-facing logic (commit + cycle protection, aggregate and
 * whole-rollup recompute, facet refresh, destroy semantics) lives in
 * `BaseEzClassifyStore`; this class supplies only the plain-field
 * {@link ReactiveCell}. That is the same "cell factory is the only framework
 * seam" shape the React/Vue/Angular adapters use, with no framework at all.
 *
 * Aggregate semantics: the store maintains a list of contributor ids; the
 * aggregate state is the engine-rendered combination of every contributor's
 * structured assertions, recomputed through `aggregateAssertions` once a
 * contributor commit leaves every contributor settled. Until contributors are
 * registered or a marking is published, the aggregate is
 * `EMPTY_EZCLASSIFY_STATE`.
 *
 * Cycle protection: when a listener registers with a `PublishSource.token`, an
 * unchanged publish whose `source.token` matches that listener's token is not
 * fired back to that listener. Canonicalized or repaired commits are returned
 * to the source so it cannot display state that disagrees with the store. See
 * doc §5.
 */
export class VanillaEzClassifyStore extends BaseEzClassifyStore {
    protected createCell<T>(initial: T): ReactiveCell<T> {
        let value = initial;
        return {
            get: () => value,
            set: (next: T) => {
                value = next;
            },
        };
    }

    protected storeLabel(): string {
        return '[ezclassify] EzClassifyStore';
    }
}
