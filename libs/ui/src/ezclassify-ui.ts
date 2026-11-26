/**
 * `EzClassifyUI`: the runtime controller that scans the DOM, mounts views, and
 * binds them to the marking store.
 *
 * This file is deliberately one cohesive unit. The controller owns and mutates
 * a single graph of private per-instance state (the store-subscription map, the
 * mount-ownership id, the per-scheme contribution + child-signature maps, and
 * the ~20 per-field DOM maps), and every method here reaches into that private
 * state to keep it consistent across the scan / enhance / bind / teardown
 * lifecycle. The parts that touch only the shared runtime state
 * (`FormsContext`, whose members the class marks internal) have already been
 * extracted to free-function modules: `forms/rollup`, `forms/dom`,
 * `forms/state`, and `serialization`. Each takes the instance itself, so those
 * call sites are what hold the class to that shape. What remains is the
 * encapsulation boundary itself: pulling it out would force `private` fields
 * onto the shared shape or into per-field parameter lists, so it stays here by
 * design.
 */
import {
    isNativeSingleSelect,
    nativeChoiceGroup,
    readNativeFacetSelection,
    writeNativeChoiceGroup,
} from './native-control-host';
import {
    DECISION_FLOW_COMBINE,
    DecisionFlowForm,
    isNativeTextField,
    type NativeTextField,
} from './decision-flow-form';
import { acceptedValue, judgedAsHeld } from './loaded-value';
import { assertionFactKey, assertionOriginKey } from './assertion-identity';
import { fixAssertions } from './components/rule-errors';
import {
    type Assertion as EngineAssertion,
    type ContextSchemeEngineAdapter,
    type RenderAssessment,
    type RenderResult,
} from '@ezclassify/types';
import { type RenderColorMap } from './render-colors';
import { TagInput } from './components/tag-input';
import { DecisionFlow } from './components/decision-flow';
import {
    pendingTeardownWrite,
    tearingDownRuntime,
} from './components/teardown-write';
import type { ComponentInstance } from './components/component-base';
import {
    partsOption,
    type ComponentSchemeEngine,
} from './components/component-base-readonly';
import {
    ContextResolutionError,
    ContextSet,
    contextForScheme,
    contextStoreBuckets,
    PRIMARY_SCHEME_SELECTOR,
    schemeEngineOf,
    SINGLE_CONTEXT_KEY,
    type EzClassifyContexts,
    type ResolvedContext,
} from './context-binding';
import {
    ensureMarkingFavorites,
    type FavoritesConfig,
} from './components/favorites-panel';
import { bindTextToolsEdges } from './components/text-caret-edge';
import {
    dismissStatusMarkPopover,
    statusMarkOwnsNode,
    setStatusMarkError,
} from './components/status-mark';
import { observeNativeLock } from './components/dom-helpers';
import {
    setMarkingTarget,
    markingEntry,
    type MarkingTarget,
} from './components/marking-target';
import {
    cleanupTooltipForRoot,
    ensureStatusMark,
} from './components/component-utils';
import { HiddenAssertionField } from './components/hidden-assertion-field';
import type { MarkedTextArea } from './components/marked-text-area';
import { EMPTY_VALUE } from './text-utils';
import type {
    BucketScheme,
    FieldAssertion,
    RollupOutputError,
} from './forms/types';
import { cssEscape } from './forms/types';
import * as state from './forms/state';
import * as dom from './forms/dom';
import * as rollup from './forms/rollup';
import { injectDefaultStyles } from './styles';
import { adoptStyles, type AdoptedStyles } from './styles/adopt';
import {
    type BehaviorBinding,
    type ControllerName,
    scanElements,
    observeNewElements,
    flushObserver,
    harvestControllerOptions,
    isBehaviorBound,
    isOwnedBy,
    readBinding,
    EZ_SELECTOR,
    MOUNT_ROOT_ATTR,
} from './element-scanner';
import {
    classify,
    describeCollection,
    errorLevelOf,
    isMarkingController,
    isMarkingHost,
    listsBuckets,
    placeNestedRoot,
    COLLECTION_ATTR,
    CONTEXT_ATTR,
    MARKING_ATTR,
    MEMBER_OF_ATTR,
    hasParts,
    PART_OF_ATTR,
    SCHEME_ATTR,
    type BindingNode,
    type HostError,
    type HostErrorCode,
} from './binding-model';
import type {
    StatusBanner,
    StatusBannerBucket,
} from './components/status-banner';
import {
    bucketKey,
    bucketParts,
    destroyedStores,
    type BucketKey,
} from './store/store-shared';
import { reportPublishFailure } from './store/publish-failure';
import type { FieldComponentBase } from './components/field-component-base';
import {
    parseComponentOptions,
    resolveNativeInput,
    createMountContainer,
    createComponent,
    createHostComponent,
    buildComponentOptions,
} from './component-factory';
import {
    TranslateHostError,
    isTranslatedView,
    type TranslatedView,
} from './components/translated-view';
import type { ContextReference } from './components/context-reference';
import {
    assertWritesScopes,
    defaultSurfaceOf,
    holdsPart,
    resolveFormatAttr,
    resolveOutput,
    showsStandalonePart,
    viewOutputOf,
    wholeOfShownMarking,
} from './format-resolver';
import {
    factsInScopes,
    factsOfScopeSet,
    factsOutsideScopes,
    inDeclarationOrder,
    parseScopeList,
    reachesPastScopes,
    scopeSetOf,
    writesCategoryOf,
} from './scopes';
import { renderViewRefusalMessages, renderViewRefused } from './render-refusal';
import {
    setMountOwner,
    getMountOwner,
    clearMountOwner,
    getMountHost,
} from './mount-host-registry';
import * as registry from './mount-rollup-registry';
import type { ChildWhole } from './mount-rollup-registry';
import {
    VanillaEzClassifyStore,
    EMPTY_EZCLASSIFY_STATE,
    type EzClassifyAggregate,
    type EzClassifyState,
    type EzClassifyStore,
    type PublishSource,
} from './store/ezclassify-store';
import {
    BaseEzClassifyStore,
    isAggregatePending,
    isMarkingComposing,
    runWhenStoreIdle,
} from './store/base-ezclassify-store';
import { clearWholeReadGate, setWholeReadGate } from './whole-read-gate';
import { createEzClassifyFacetBinding } from './facet-binding';
import { MarkingUndo, valueSignature } from './components/marking-undo';
import {
    resolveAddedAttributes,
    restoreAddedAttributes,
    writeAddedAttributes,
    type AddedAttributes,
    type EzClassifyAttributes,
} from './added-attributes';

/**
 * The buckets of a level a view shows, in the store's order: those its own
 * `context` / `scheme` attributes name (every bucket when it names neither),
 * holding a marking or flagged stale. A bucket that misses a contributor stays,
 * so it never reads as empty.
 */
function shownBuckets(
    aggregate: EzClassifyAggregate,
    named: readonly BucketKey[],
): Array<[BucketKey, EzClassifyState]> {
    return Array.from(aggregate.byBucket.entries()).filter(
        ([key, state]) =>
            named.includes(key) &&
            (state.rendered !== '' ||
                state.assertions.length > 0 ||
                state.stale === true),
    );
}

/**
 * A marking as some of its scheme's scopes write it: the facts that belong to
 * those scopes, written in `format` when given, else in the default output of
 * the first of them for the role. Several scopes are written only by an output
 * that writes every one of them (see `assertWritesScopes`).
 *
 * @param engine - The scheme view the marking is in
 * @param assertions - The marking's facts
 * @param scopes - The scope ids to write
 * @param format - The output to write them in, if the view names one
 * @param part - Whether the marking is a part
 * @returns The text; empty when no fact belongs to the scopes, and null when
 *   facts do but the output cannot or will not write them, so the view can say
 *   its value is incomplete instead of showing a blank as if nothing were
 *   there
 */
async function writeFactsInScopes(
    engine: ContextSchemeEngineAdapter,
    assertions: readonly EngineAssertion[],
    scopes: readonly string[],
    format: string | null,
    part: boolean,
): Promise<string | null> {
    const meta = engine.getSchemeMeta();
    const categories = engine.listCategories();
    const facts = factsInScopes(assertions, categories, scopes, meta);
    if (facts.length === 0) return '';
    const output = format || viewOutputOf(meta, scopes, part);
    try {
        // A view checks its own scheme when it mounts. A level view also
        // shows buckets of other schemes, which only a write can check.
        assertWritesScopes(engine, categories, output, scopes, 'view');
        const written = await Promise.resolve(engine.render(facts, output));
        return renderViewRefused(written) ? null : written.rendered;
    } catch {
        return null;
    }
}

/**
 * The scopes a view writes a marking's facts in, or none when the marking's own
 * text already is what the view shows. A view that lists scopes writes those.
 * One that lists none shows the scheme's default scope, which the marking's
 * text holds alone only while no fact reaches another scope: a rolled-up
 * marking names no output, so it is written on every surface its facts reach.
 *
 * @param engine - The scheme view the marking is in
 * @param listed - The scope ids the view lists
 * @param assertions - The marking's facts
 * @returns The scope ids to write, or empty to show the marking's text
 */
function scopesToWrite(
    engine: ContextSchemeEngineAdapter,
    listed: readonly string[],
    assertions: readonly EngineAssertion[],
): string[] {
    if (listed.length > 0) return [...listed];
    const meta = engine.getSchemeMeta();
    const scopes = scopeSetOf(listed, meta);
    return scopes.length > 0 &&
        reachesPastScopes(assertions, engine.listCategories(), scopes, meta)
        ? scopes
        : [];
}

/**
 * Host errors that refuse an element for what it names elsewhere on the page,
 * so they can clear, or arise, when that other element comes, goes or is
 * renamed.
 */
const REFERENCE_ERRORS: ReadonlySet<string> = new Set<HostErrorCode>([
    'whole-missing',
    'member-of-unknown',
    'part-of-not-whole',
    'part-of-across-contexts',
    'no-rollup-on-whole-with-parts',
    'duplicate-marking-id',
]);

/**
 * Warn-once tracking for the scope-mismatch advisory, keyed by the offending
 * element so a framework re-rendering the same node never warns twice for it.
 */
const warnedScopeMismatch = new WeakSet<HTMLElement>();

/**
 * Per-view handle returned by `makeStoreBinding`. Captures the marking-id,
 * facet metadata, dedup token, and the echo-tracking fields used to break the
 * publish/subscribe cycle without a shared `settingValue` flag.
 */
interface StoreBinding {
    markingId: string;
    isFacet: boolean;
    category: string | undefined;
    token: PublishSource;
    lastSeenRendered: string;
    lastSeenViewSignature: string;
    viewRequest: number;
    lastSeenAssertionSig: string;
    lastSeenFactSig: string;
    /**
     * The view, a decision flow, states facts outside the scheme's default
     * scope. Text carries only the default scope, so from the first such
     * publish on, the binding publishes the view's facts instead of its text.
     */
    publishesFacts: boolean;
    publish(assertions: EngineAssertion[], rendered: string): void;
}

/** A resolved Context and scheme, as a host error names it. */
function describeBucket(resolved: ResolvedContext): string {
    const scheme = resolved.primary
        ? 'the primary scheme'
        : `scheme '${resolved.schemeSelector}'`;
    return resolved.contextKey
        ? `${scheme} of Context '${resolved.contextKey}'`
        : scheme;
}

/** Stable identity for one retained render, including refusal assessment. */
function renderViewSignature(view: RenderResult | undefined): string {
    return JSON.stringify(view ?? null);
}

/**
 * Deterministic, order-independent signature of an assertion list. Used to
 * detect echo commits in the store-binding cycle, two state observations with
 * the same signature mean nothing changed and the publish can be skipped
 * without re-triggering listeners.
 */
function signAssertions(
    assertions: readonly Pick<
        EngineAssertion,
        'conceptId' | 'categoryId' | 'value'
    >[],
): string {
    return assertions
        .map((a) => `${a.conceptId}|${a.categoryId}|${a.value ?? ''}`)
        .sort()
        .join('::');
}

/**
 * Views must see inferred choices become explicit even when their text stays
 * the same.
 */
function signAssertionOrigins(assertions: readonly EngineAssertion[]): string {
    return assertions.map(assertionOriginKey).sort().join('::');
}

/**
 * Compare public JSON state semantically, including stores that return cloned
 * snapshots.
 */
function signEntryState(state: EzClassifyState): string {
    return JSON.stringify(state, (_key, value: unknown) =>
        value !== null && typeof value === 'object' && !Array.isArray(value)
            ? Object.fromEntries(
                  Object.entries(value).sort(([left], [right]) =>
                      left.localeCompare(right),
                  ),
              )
            : value,
    );
}

/**
 * Top-level controller that binds one or more Contexts to DOM input fields,
 * managing tag inputs, validation, and rollup.
 *
 * Initialize it with the page's Context, or with `{ contexts }` keyed by the
 * names `data-ezclassify-context` uses when the page marks under several (see
 * `context-binding.ts`).
 *
 * The runtime state the extracted forms modules read and write (`FormsContext`)
 * lives on the instance but is marked internal, so it is stripped from the
 * published declarations. Integrators get the constructor, the store and root,
 * readiness, the registered components, rollup recalculation and reads,
 * assertion reads, clipboard copy, and teardown.
 */
export class EzClassifyUI {
    /**
     * The Contexts this runtime marks with, and how an element picks one.
     *
     * @internal
     */
    readonly contexts: ContextSet;
    /**
     * The element this runtime scans and owns. Events, scoped styles and the
     * mount boundary all hang off it.
     */
    root: HTMLElement;
    /**
     * Binding store used to cross-talk between views that name the same
     * marking-id via `data-ezclassify-bound-to` or `data-ezclassify-facet-of`.
     * Framework adapters can pass their own implementation (e.g.
     * `AngularSignalStore`) so the store entries plug into the framework's
     * native reactive primitive; the runtime treats it as a black-box
     * `EzClassifyStore`. When no store is supplied a `VanillaEzClassifyStore`
     * is instantiated against the bound engine so vanilla DOM use of
     * bound-to/facet-of works without a framework adapter. See
     * `docs/binding-model.md` §5 + §8.
     */
    store: EzClassifyStore;
    /**
     * The existing entry binding's projection, awaited by explicit marking
     * actions.
     */
    private readonly markedTextareaReflectors = new WeakMap<
        ComponentInstance,
        (entryId: string) => Promise<void>
    >();
    /**
     * Marking-ids whose host element (a marking host, see `binding-model.ts`)
     * exists in the scanned tree. Views naming a marking-id not in this set are
     * not registered with the store; they're free-floating hints, not binding
     * edges (e.g. the library/pantry pages use `facet-of="doc-section"` as a
     * category hint without a backing marking host).
     */
    private validMarkingIds = new Set<string>();
    /**
     * The host element of each marking this runtime manages, recorded when the
     * marking is registered. Teardown asks whether that element is still on the
     * page, not whatever element carries the id by then, which after a page
     * swap is the next page's host.
     */
    private readonly markingHosts = new Map<string, Element>();
    /**
     * Markings whose host has been seeded by the step that mounted it (see
     * {@link seedOnMount}). A host that a later scan registers again is not read
     * a second time; one that leaves is forgotten here, so mounting it again
     * seeds it again.
     */
    private readonly seededMarkings = new Set<string>();
    private readonly decisionFlowForms = new Map<string, DecisionFlowForm>();
    private readonly nativeFacetSeeds = new Map<
        string,
        Map<string, EngineAssertion[]>
    >();
    /**
     * The seeds of hosts mounted during the initial sweep, started together
     * once every init has resolved (see {@link seedOnMount}).
     */
    private initialSeeds: Array<() => Promise<void>> = [];
    /** Per-view subscription cleanup handles, keyed by the host element. */
    private storeUnsubscribers = new Map<HTMLElement, () => void>();
    /** Per whole field: the subscription that re-reads it when a part changes. */
    private partUnsubscribers = new Map<HTMLElement, () => void>();
    /**
     * Per store marking: the undo every field bound to it shares, fed the
     * marking's commits, and how many fields hold it.
     */
    private readonly markingUndos = new Map<
        string,
        { undo: MarkingUndo; users: number; stop: () => void }
    >();
    /** Per part field: the subscription that re-reads it when its whole changes. */
    private wholeUnsubscribers = new Map<HTMLElement, () => void>();
    /**
     * Per whole marking: the value the store last committed for it, and the
     * text its host showed at that moment. While the host still shows that
     * text, the commit is newer than the host: the whole's own field has not
     * written it back yet.
     */
    private wholeCommits = new Map<
        string,
        { rendered: string; host: string }
    >();
    /** Per field: the marking id of the host its draft is kept in. */
    private draftHosts = new WeakMap<object, string>();
    /** @internal */
    fields: HTMLInputElement[] = [];
    /**
     * The format whole markings are written in when a field names none: the
     * host's `format` option, else the only Context's scheme default. With
     * several Contexts and no host format it is empty; see {@link formatsOf}.
     *
     * @internal
     */
    defaultFormat: string;
    /**
     * The format a part is written in when a field names none, by the same rule
     * as {@link defaultFormat}.
     *
     * @internal
     */
    defaultPartFormat: string;
    /** The host's `format` option, applied in every Context. */
    private readonly hostFormat: string | undefined;
    /** @internal */
    tooltipConceptProperty?: string;
    /** @internal */
    domObserver: MutationObserver | null = null;
    /** @internal */
    autocompleters = new Map<HTMLInputElement, TagInput>();
    /** @internal */
    lastValidated = new Map<HTMLInputElement, string>();
    /** @internal */
    fieldAssertions = new Map<HTMLInputElement, FieldAssertion[]>();
    /** @internal */
    tooltipEl: HTMLElement | null = null;
    /** @internal */
    settingValue = false;
    /** @internal */
    colorMap: RenderColorMap = {};
    /**
     * Host-fed favorites surface, threaded into every scanner-mounted field's
     * `ComponentOptions`. Instance-level rather than a `data-ezclassify-*`
     * attribute on purpose: `load`/`save`/`remove` are functions, and
     * function-bearing config has no serializable data-attribute form (see
     * `docs/attributes.md` "Instance-level options"). Without a provider,
     * Favorites offers scheme presets when they are available.
     *
     * @internal
     */
    favorites?: FavoritesConfig;
    /**
     * Mounting and teardown write here; the public view is `components`.
     *
     * @internal
     */
    mounted = new Map<HTMLElement, ComponentInstance>();
    /**
     * The component this runtime mounted on each host element, as a read-only
     * view. A host reaches a mounted field through it, for example to load a
     * value with the component's own `setValue` instead of a raw DOM write.
     */
    get components(): ReadonlyMap<HTMLElement, ComponentInstance> {
        return this.mounted;
    }
    /** @internal */
    partOfMap = new Map<HTMLElement, string>();
    /** @internal */
    aggregates = new Map<
        string,
        {
            el: HTMLElement;
            state: import('./store/ezclassify-store').EzClassifyState;
        }
    >();
    /**
     * True during initialization: skips expensive operations until all
     * components are ready
     *
     * @internal
     */
    initializing = true;
    /** @internal */
    plainBehaviorCleanups = new Map<HTMLElement, () => void>();
    /**
     * Tracks pending component init promises for batched rollup after all inits
     * complete
     */
    private _pendingInits: Promise<void>[] = [];
    /**
     * Set to true at the very start of destroy() so closures that outlive the
     * instance silently no-op
     */
    private _destroyed = false;
    /**
     * `true` once the initial scan + mount sweep has settled and the
     * `ezclassify:ready` event has fired. Consumers whose listener might be
     * registered AFTER the constructor's async chain resolves (a re-mounted
     * React effect under StrictMode, for instance) should check this flag and
     * call their handler synchronously if it's already true, same pattern as
     * `document.readyState === 'complete'` for `load`.
     *
     * Part of the public surface; doubles as the "ready event already fired"
     * guard so the event is fire-once per instance.
     */
    isReady = false;
    /** Style elements injected by this instance, tracked for cleanup */
    private adoptedStyles: AdoptedStyles[] = [];
    /**
     * Per-instance counter for synthetic ids assigned to text controllers whose
     * host element has no `id`. Local to this EzClassifyUI so multiple mounts
     * on the same page never trample each other. The ids carry an instance
     * discriminator from `Math.random` to keep React strict-mode double-mounts
     * from colliding when the prior mount's id lingered in validMarkingIds for
     * a tick after the unmount.
     */
    private _textIdCounter = 0;
    /**
     * MarkedTextAreas whose last scan did not read their whole text, each with
     * the whole its portions roll up into, as reported to the store.
     */
    private readonly incompleteScans = new Map<string, string | null>();
    /**
     * Elements whose markup the binding model refused, each with the
     * contributors that hold the levels above it incomplete in the store: one
     * in the collection it sits in, and one in the whole that encloses it, if
     * any. Such an element stays unenhanced until its markup changes.
     */
    private readonly hostErrors = new Map<
        HTMLElement,
        {
            error: HostError | RollupOutputError;
            contributors: Array<{ id: string; wholeId: string | null }>;
        }
    >();
    /**
     * While markup that names other elements is read again, the message each of
     * those elements was refused with before, so a refusal that stands
     * unchanged is not reported twice.
     */
    private rereadErrors: ReadonlyMap<HTMLElement, string> | null = null;
    /** Where each scanned element sits in the marking tree, as last derived. */
    private readonly bindingNodes = new Map<HTMLElement, BindingNode>();
    /**
     * Collection containers this runtime declared to the store, with the id
     * each was declared under, so a container that leaves or is renamed is
     * removed under the id the store knows.
     */
    private readonly collections = new Map<HTMLElement, string>();
    private readonly collectionRollupUnsubscribers = new Map<
        HTMLElement,
        () => void
    >();
    /**
     * How many times each marking host has been registered. A teardown whose
     * store release lands after the host was registered again (a structural
     * change derives a subtree again in place) leaves the new registration.
     */
    private readonly hostEpochs = new WeakMap<HTMLElement, number>();
    /**
     * Hosts whose plain-input validation helper owns their value, so the host
     * write-back does not also write into them.
     */
    private readonly helperInputs = new WeakSet<HTMLElement>();
    /** Whether the outputs last showed an incomplete rollup. */
    private rollupIncompleteShown = false;
    /** What {@link add} wrote on each element, for {@link remove}. */
    private readonly addedAttributes = new Map<HTMLElement, AddedAttributes>();
    /** Stops the page-aggregate subscription that refreshes the outputs. */
    private unsubscribeIncomplete: (() => void) | null = null;
    private readonly _textIdSalt = Math.random().toString(36).slice(2, 8);
    /**
     * Stable per-instance id. Stamped on `this.root` as
     * `data-ezclassify-mount-root` so the element-scanner boundary can resolve
     * "which instance owns this element" via nearest-ancestor `closest()`, and
     * used as the key in the cross-instance mount-rollup registry. Randomized
     * so a StrictMode double-mount (old root lingering for a tick) never
     * collides.
     */
    private readonly _instanceId =
        'ez' + Math.random().toString(36).slice(2, 10);
    /**
     * The instance id, as FormsContext.mountInstanceId.
     *
     * @internal
     */
    get mountInstanceId(): string {
        return this._instanceId;
    }
    /**
     * Last contribution signature published upstream, per scheme id; guards
     * child→parent republish thrash (see signAssertions).
     */
    private _lastChildSig = new Map<string, string>();

    /**
     * @param contexts - The page's Context, or `{ contexts }` with each Context
     *   under the key `data-ezclassify-context` names it by. With several
     *   Contexts there is no default: markup assigns every marked element to
     *   one, and an element no ancestor assigns is a host error.
     * @param options - Presentation defaults, the root to scan (default
     *   `document.body`) and an optional store.
     * @throws TypeError when `contexts` is neither shape
     */
    constructor(
        contexts: EzClassifyContexts,
        options?: {
            format?: string;
            colorMap?: RenderColorMap;
            tooltipConceptProperty?: string;
            root?: HTMLElement;
            store?: EzClassifyStore;
            /**
             * Host-fed favorites surface applied to every scanner-mounted
             * field. See the `favorites` field doc comment above; this is the
             * only way a declarative host reaches it, there is no
             * `data-ezclassify-*` equivalent.
             */
            favorites?: FavoritesConfig;
        },
    ) {
        this.contexts = ContextSet.from(contexts);
        // Selectors other than the primary resolve against each Context's
        // scheme list. A local Context lists synchronously; a remote one
        // answers from the description it cached when it connected.
        const listing = this.contexts.load();
        this.root = options?.root ?? document.body;
        // Stamp the ownership boundary marker. Every element whose nearest
        // `data-ezclassify-mount-root` ancestor is THIS id is owned by this
        // instance; the scanner skips the rest. This is what stops an enclosing
        // instance from re-enhancing a field a nested instance already owns.
        this.root.setAttribute(MOUNT_ROOT_ATTR, this._instanceId);
        // The host's format is the one it authors whole markings in. A part is
        // written in the scheme's part default, as the store writes it. With
        // several Contexts each bucket takes its scheme's defaults instead
        // (see formatsOf); the host's format, when given, applies to all.
        const meta = this.contexts.single
            ? this.contexts.get(SINGLE_CONTEXT_KEY)!.scheme.getSchemeMeta()
            : undefined;
        this.hostFormat = options?.format;
        this.defaultFormat = options?.format ?? meta?.defaultRenderFormat ?? '';
        this.defaultPartFormat =
            meta?.defaultPartRenderFormat ?? this.defaultFormat;
        if (options?.colorMap) this.colorMap = options.colorMap;
        if (options?.tooltipConceptProperty)
            this.tooltipConceptProperty = options.tooltipConceptProperty;
        if (options?.favorites) this.favorites = options.favorites;
        this.store =
            options?.store ?? this.createStore(contexts, options?.format);

        // Every level's rollup lives in the store. When the page level moves
        // (any level below it moving moves the page), the outputs the host
        // placed are shown again, and a level the store holds as stale (a
        // contributor whose read failed, or one that read only part of its
        // source) makes those outputs incomplete whether or not a value moved.
        this.unsubscribeIncomplete = this.store.subscribeAggregate(
            (aggregate) => {
                this.refreshIncomplete();
                if (
                    !this._destroyed &&
                    !this.initializing &&
                    !isAggregatePending(aggregate)
                )
                    void rollup.updateRollup(this);
            },
        );

        // Register this instance in the cross-instance mount-rollup registry. The
        // ancestry edge (which parent scope this child contributes its whole into)
        // is INFERRED from the DOM: walk up from the root's parent to the nearest
        // enclosing mount root. A disjoint (independent) mount has no enclosing
        // root → no edge → it contributes upward to nothing, which is correct.
        registry.registerFlusher(this._instanceId, () => this.flushRollupNow());
        registry.registerReleaser(this._instanceId, {
            releaseElement: (host) => this.releaseElement(host),
            refreshIncomplete: () => this.refreshIncomplete(),
            reportHostError: (error) => this.reportHostError(error),
        });
        this.registerWithParentScope();
        // Reclaim-on-register: an ancestor instance constructed BEFORE this one
        // already enhanced the hosts now enclosed by this root (the outer-first
        // race; the region mounts before the field). Release each such host from
        // its ancestor owner so this instance becomes its sole owner. Makes
        // ownership order-independent.
        this.reclaimFromAncestors();

        injectDefaultStyles(
            this.root === document.body ? undefined : this.root,
        );
        this.enhance();
        this.observeDOM();
        this.injectScopedStyles();

        // An element that declares a scheme selector waits for its Context's
        // scheme list (see resolveContext); once every list is in, the tree
        // is read again so those elements mount. Already-mounted elements are
        // skipped by the mount guards.
        const listed =
            listing instanceof Promise
                ? listing.then(() => {
                      if (!this._destroyed) this.enhance();
                  })
                : undefined;

        // Wait for all component inits to complete, then seed the store from any
        // pre-existing host values, wire host write-back, and run a single rollup.
        // Guard: if destroy() was called before inits finish, skip the post-init
        // work, including the ready event, which would otherwise fire on a
        // torn-down instance.
        const mounted = listed
            ? listed.then(() => Promise.all(this._pendingInits))
            : Promise.all(this._pendingInits);
        mounted.then(async () => {
            if (this._destroyed) return;
            this.initializing = false;
            this._pendingInits = [];
            this.wireHostWriteback();
            await this.startInitialSeeds();
            // Torn down while the seeds were on the wire.
            if (this._destroyed) return;
            rollup.updateRollup(this);
            this.fireReady();
        });
    }

    /**
     * The scheme view of the instance's only Context.
     *
     * An instance with several Contexts has no instance-wide scheme: every
     * element marks with the Context it resolves (see {@link resolveContext}),
     * so reading this there is a defect in the caller and throws rather than
     * answering with one Context's rules for another's markup.
     *
     * @internal
     */
    get engine(): ComponentSchemeEngine {
        const only = this.contexts.single
            ? this.contexts.get(SINGLE_CONTEXT_KEY)
            : undefined;
        if (!only) {
            throw new ContextResolutionError(
                'context-unresolved',
                "[ezclassify] This EzClassifyUI holds several Contexts, so it has no single scheme; resolve the element's Context instead.",
                null,
            );
        }
        return only.scheme;
    }

    /**
     * The store this instance creates when the host passes none: one bucket per
     * (Context, scheme) pair that markup resolves, each read by that scheme's
     * view. With one Context its primary scheme is the default bucket; with
     * several there is none.
     */
    private createStore(
        source: EzClassifyContexts,
        format: string | undefined,
    ): EzClassifyStore {
        return new VanillaEzClassifyStore({
            buckets: contextStoreBuckets(source, { format }),
        });
    }

    /**
     * The Context and scheme `el` marks with.
     *
     * @throws ContextResolutionError when markup resolves none
     * @internal
     */
    resolveContext(el: Element): ResolvedContext {
        const host = this.boundMarkingHostOf(el);
        if (!host)
            return listsBuckets(el)
                ? this.contexts.resolveBucketList(el, this.root)
                : this.contexts.resolve(el, this.root);
        // A view bound to a marking marks in that marking's Context and
        // scheme, wherever the view sits. Read by its own placement, a view
        // outside the marking's data-ezclassify-scheme subtree would parse
        // the marking in another scheme and write that reading back.
        const resolved = this.contexts.resolve(host, this.root);
        this.refuseDisagreeingView(el, host, resolved);
        return resolved;
    }

    /**
     * The marking host a view's `data-ezclassify-bound-to`,
     * `data-ezclassify-facet-of` or `data-ezclassify-source` names, or null
     * when `el` shows none.
     */
    private boundMarkingHostOf(el: Element): Element | null {
        const id =
            el.getAttribute('data-ezclassify-bound-to') ??
            el.getAttribute('data-ezclassify-facet-of') ??
            el.getAttribute('data-ezclassify-source');
        if (!id || id === el.id) return null;
        return this.markingHosts.get(id) ?? null;
    }

    /**
     * Refuse a bound view whose own markup selects another Context or scheme
     * than the marking it binds. Markup the view does not declare follows the
     * marking.
     *
     * @throws ContextResolutionError when the view's declared Context or scheme
     *   disagrees with its marking's
     */
    private refuseDisagreeingView(
        el: Element,
        host: Element,
        marking: ResolvedContext,
    ): void {
        const declaresContext =
            this.contexts.declaredContextKey(el, this.root) !== null;
        const declaresScheme =
            this.contexts.declaredSchemeSelector(el, this.root) !== null;
        if (!declaresContext && !declaresScheme) return;
        const own = this.contexts.resolve(el, this.root);
        if (
            own.contextKey === marking.contextKey &&
            (!declaresScheme || own.bucket === marking.bucket)
        )
            return;
        throw new ContextResolutionError(
            'context-unresolved',
            `This view binds the marking '${host.id}', which marks in ${describeBucket(marking)}, ` +
                `but its own markup selects ${describeBucket(own)}. ` +
                'Move the view, or remove the data-ezclassify-context or data-ezclassify-scheme that disagrees.',
            el,
        );
    }

    /**
     * Every Context this instance holds, as a reference drawer takes them: the
     * only Context, or each under the key markup names it by.
     */
    private referenceSource(): EzClassifyContexts {
        if (this.contexts.single) return this.contexts.get(SINGLE_CONTEXT_KEY)!;
        return { contexts: Object.fromEntries(this.contexts.entries()) };
    }

    /**
     * Resolve the Context a component on `el` mounts with, or report `el` as a
     * host error and answer null. An element waiting on its Context's scheme
     * list answers null without an error: the tree is read again once the list
     * is in.
     */
    private contextForMount(el: HTMLElement): ResolvedContext | null {
        try {
            const resolved = this.resolveContext(el);
            schemeEngineOf(resolved, el);
            return resolved;
        } catch (err) {
            if (!(err instanceof ContextResolutionError)) throw err;
            if (err.code === 'scheme-pending') return null;
            this.reportHostError(
                {
                    code: 'context-unresolved',
                    message: `[ezclassify] ${err.message}`,
                    element: el,
                },
                null,
            );
            return null;
        }
    }

    /**
     * The formats a field on `el` writes when it names none: the host's
     * `format` option for whole markings, else its Context scheme's default,
     * and that scheme's part default for parts.
     *
     * @internal
     */
    formatsOf(el: Element): { whole: string; part: string } {
        const meta = schemeEngineOf(
            this.resolveContext(el),
            el,
        ).getSchemeMeta();
        const whole = this.hostFormat ?? meta.defaultRenderFormat ?? '';
        return { whole, part: meta.defaultPartRenderFormat ?? whole };
    }

    /** Scheme operations per bucket, so each bucket keeps one identity. */
    private readonly bucketSchemes = new Map<BucketKey, BucketScheme>();

    /**
     * The scheme operations for the bucket `el` reads in.
     *
     * @throws ContextResolutionError when `el` resolves no markable scheme
     * @internal
     */
    schemeOf(el: HTMLElement): BucketScheme {
        const resolved = this.resolveContext(el);
        const known = this.bucketSchemes.get(resolved.bucket);
        if (known) return known;
        const engine = schemeEngineOf(resolved, el);
        const scheme: BucketScheme = {
            bucket: resolved.bucket,
            adapter: engine,
            process: (input, options) => engine.process(input, options),
            validate: (input, options) => engine.validate(input, options),
            checkCoverage: (children, parent, options) =>
                engine.checkCoverage(children, parent, options),
            getSchemeMeta: () => engine.getSchemeMeta(),
        };
        this.bucketSchemes.set(resolved.bucket, scheme);
        return scheme;
    }

    /**
     * The buckets a Context key and a scheme selector name, `null` naming any.
     *
     * @internal
     */
    bucketsNamed(
        contextKey: string | null,
        schemeSelector: string | null,
    ): readonly BucketKey[] {
        return this.contexts.bucketsNamed(contextKey, schemeSelector);
    }

    /**
     * What a level view prints to name a bucket: its scheme's name, after the
     * Context key when the instance holds several Contexts. A scheme other than
     * the Context's primary is named by its own view, or by its selector when
     * that view cannot describe it.
     */
    private bucketLabel(bucket: BucketKey): string {
        const { contextKey, schemeSelector } = bucketParts(bucket);
        let name = schemeSelector;
        try {
            name =
                this.bucketEngine(bucket)?.getSchemeMeta().name ||
                schemeSelector;
        } catch {
            // A label never fails the view it names.
        }
        return contextKey ? `${contextKey}: ${name}` : name;
    }

    /**
     * The scheme view a bucket marks in, or null when its Context is gone.
     *
     * @throws ContextResolutionError when the Context no longer offers the
     *   bucket's scheme
     */
    private bucketEngine(bucket: BucketKey): ContextSchemeEngineAdapter | null {
        const { contextKey, schemeSelector } = bucketParts(bucket);
        const context = this.contexts.get(contextKey);
        if (!context) return null;
        return schemeEngineOf({
            contextKey,
            context,
            schemeSelector,
            primary: schemeSelector === PRIMARY_SCHEME_SELECTOR,
            bucket,
        });
    }

    /**
     * The store's rollup of one level, by bucket: `null` for the instance root,
     * else a collection's or a whole's id.
     *
     * @internal
     */
    aggregateOf(
        levelId: string | null,
    ): ReadonlyMap<BucketKey, EzClassifyState> {
        return this.store.getAggregate(levelId ?? undefined).byBucket;
    }

    /**
     * True once this instance has been torn down.
     *
     * @internal
     */
    get destroyed(): boolean {
        return this._destroyed;
    }

    /**
     * Fire `ezclassify:ready` once the initial scan + mount sweep has settled.
     * Consumers subscribe to per-marking / aggregate listeners up front, then
     * use this event to pull initial state in one shot; no polling, no
     * per-component direct reads.
     *
     * Fire-once semantics: the event fires exactly once per `EzClassifyUI`
     * instance, after the initial sweep. Components mounted later via the
     * mutation observer do not re-fire it (see `docs/binding-model.md`
     * §lifecycle). Coverage of that case is a post-1.0 follow-up.
     *
     * The sweep includes the seeds, so the event waits on the engine. An engine
     * across a network has to time its calls out: a call it never answers holds
     * the event back. A runtime destroyed first never fires it.
     */
    private fireReady(): void {
        if (this.isReady) return;
        this.isReady = true;
        this.root.dispatchEvent(
            new CustomEvent('ezclassify:ready', {
                bubbles: true,
                detail: {
                    markingIds: Array.from(this.validMarkingIds),
                    componentCount: this.mounted.size,
                },
            }),
        );
    }

    /**
     * Seed the store from a marking host's served value, once, in the step that
     * mounts it: a host with no controller once it and its part edge are
     * registered, a controller once its init has resolved, and a
     * MarkedTextArea's portions once the textarea's has. A host mounted after
     * the initial sweep is seeded the same way.
     *
     * The initial sweep holds its seeds and starts them together once every
     * init has resolved (see {@link startInitialSeeds}). The inits read the
     * engine and answer in any order; a seed started as each one resolved would
     * let a part commit, and its whole roll up, before a sibling part had been
     * asked for, and the rollups the page sends would depend on that order.
     *
     * A seed sets the marking's baseline, not an edit (see
     * `EzClassifyStore.seedRendered`): a selection a field or an application
     * published before this runs, or while it is on the wire, stays on top of
     * the served value instead of being replaced by it. Every host is seeded,
     * empty or not and whatever the store already holds.
     *
     * A body editor is seeded from its MARK, not its value. `marked-input` and
     * `marked-textarea` are marking hosts whose `.value` is the author's prose
     * with a marking embedded in it; handing that whole string to
     * `seedRendered` asks the engine to read a marking out of a sentence, it
     * reads none, and the empty commit travels straight back through the
     * component's own store subscription and erases the mark that was typed.
     * The component has already parsed its leading mark by the time the seed
     * runs, so its assertions are the marking this host actually carries.
     *
     * @param mounted - The controller's init, when the host has one. Its seed
     *   waits for it; an init that fails still seeds the served value.
     */
    private seedOnMount(
        id: string,
        host: HTMLElement,
        mounted?: unknown,
        watchNative = false,
    ): void {
        if (this.seededMarkings.has(id)) return;
        this.seededMarkings.add(id);
        const start = (): Promise<void> => {
            // Released, or replaced by another host under the same id, while
            // its init or the initial sweep was still running.
            if (this._destroyed || this.markingHosts.get(id) !== host)
                return Promise.resolve();
            const mountedField = () =>
                this.mounted.get(host) ??
                this.autocompleters.get(host as HTMLInputElement);
            const component = mountedField();
            const readNative = watchNative
                ? () =>
                      component?.readStoreSeedText?.() ??
                      (host as HTMLInputElement).value ??
                      ''
                : undefined;
            return this.seedMarkingHost(id, host, readNative).catch((error) => {
                if (mountedField() === component)
                    component?.showFailedStoreSeed?.();
                throw error;
            });
        };
        // A host whose init has settled starts at once. The initial sweep's
        // inits have all settled when it starts its seeds, so they go out
        // together, in the order the hosts mounted, and each reads its host
        // before any commit can write back into it.
        let settled = !(mounted instanceof Promise);
        if (mounted instanceof Promise)
            mounted.then(
                () => (settled = true),
                () => (settled = true),
            );
        const seed = (): Promise<void> =>
            settled
                ? start()
                : (mounted as Promise<unknown>).then(start, start);
        if (this.initializing) this.initialSeeds.push(seed);
        else void seed().catch(() => {});
    }

    /**
     * Start the seeds of the hosts the initial sweep mounted, together, and
     * settle once all of them have. A seed that fails leaves its marking to the
     * store's failure handling.
     */
    private async startInitialSeeds(): Promise<void> {
        const seeds = this.initialSeeds;
        this.initialSeeds = [];
        await Promise.all(seeds.map((seed) => seed().catch(() => {})));
    }

    /**
     * Seed the portions of a MarkedTextArea once its init has resolved. The
     * textarea creates a host for each portion it parsed while it mounts, and
     * it is what knows they are its served value; a portion created later by an
     * edit is published by the textarea instead.
     */
    private seedPortionsOnMount(
        component: MarkedTextArea,
        mounted: unknown,
    ): void {
        const seedPortions = () => {
            if (this._destroyed) return;
            for (const segment of component.getSegments()) {
                const host = segment.entryId
                    ? this.markingHosts.get(segment.entryId)
                    : undefined;
                if (host instanceof HTMLElement)
                    this.seedOnMount(segment.entryId!, host);
            }
        };
        if (mounted instanceof Promise)
            void mounted.then(seedPortions, () => {});
        else seedPortions();
    }

    private async seedMarkingHost(
        id: string,
        host: HTMLElement,
        readNative?: () => string,
    ): Promise<void> {
        const flow = this.decisionFlowForms.get(id);
        if (flow) {
            const facets = this.nativeFacetSeeds.get(id);
            this.nativeFacetSeeds.delete(id);
            return flow.seed(facets);
        }

        const assertions = this.bodyEditorMark(host);
        if (assertions) return this.store.seedAssertions(id, assertions);

        const rendered = (host as HTMLInputElement).value ?? '';
        const facets = this.nativeFacetSeeds.get(id);
        this.nativeFacetSeeds.delete(id);
        if (!facets?.size) {
            if (readNative && this.store.seedRenderedFromHost)
                return this.store.seedRenderedFromHost(id, readNative);
            return this.store.seedRendered(id, rendered);
        }

        const selected = [...facets.values()].flat();
        if (!rendered) return this.store.seedAssertions(id, selected);

        // The store composes the native edits over the served text, preserving
        // its other categories and any unread text.
        if (this.store.seedRenderedWithFacets && this.usesDefaultStoreSeed())
            return this.store.seedRenderedWithFacets(id, rendered, facets);
        await Promise.all([
            this.store.seedRendered(id, rendered),
            this.store.publishAssertions(id, selected, undefined, {
                categories: [...facets.keys()],
            }),
        ]);
    }

    private usesDefaultStoreSeed(): boolean {
        // The built-in shortcuts must still honor a caller's custom seed.
        return (
            !(this.store instanceof BaseEzClassifyStore) ||
            this.store.seedRendered ===
                BaseEzClassifyStore.prototype.seedRendered
        );
    }

    /** Capture the authored inputs before a picker replaces or disables them. */
    private captureNativeFacet(
        el: HTMLElement,
        id: string,
        category: string,
    ): void {
        const host = this.markingHosts.get(id);
        if (!(host instanceof HTMLInputElement) || host.type !== 'hidden')
            return;
        const values = readNativeFacetSelection(el, !!host.value);
        if (!values) return;

        const known = new Set(
            schemeEngineOf(this.resolveContext(el), el)
                .getConceptsInCategory(category)
                .map((concept) => concept.id),
        );
        if (values.some((value) => !known.has(value))) return;

        let facets = this.nativeFacetSeeds.get(id);
        if (!facets) this.nativeFacetSeeds.set(id, (facets = new Map()));
        facets.set(
            category,
            values.map((conceptId): EngineAssertion => ({
                categoryId: category,
                conceptId,
                source: 'user',
                confidence: 'certain',
            })),
        );
    }

    /**
     * The marking a body-editor host carries, or `undefined` when the host is
     * not a body editor.
     *
     * `marked-input` and `marked-textarea` own their content: the element's
     * value is prose and the marking is a leading mark embedded in it, which
     * the component matched against the scheme's embedded-marking pattern
     * during its own init. That parsed set is the host's marking; the body
     * around it never is.
     *
     * An empty array is a body editor with no mark yet, which is a real answer
     * and distinct from the `undefined` that means "not a body editor".
     */
    private bodyEditorMark(host: HTMLElement): EngineAssertion[] | undefined {
        const controller = host.getAttribute('data-ezclassify-controller');
        if (
            controller !== 'marked-input' &&
            controller !== 'marked-textarea' &&
            !host.hasAttribute('data-marked-textarea-entry-managed')
        )
            return undefined;
        const component = this.mounted.get(host);
        if (!component || typeof component.getAssertions !== 'function')
            return undefined;
        return component.getAssertions() as EngineAssertion[];
    }

    /**
     * Subscribe each writable `data-ezclassify-marking` host to its store entry
     * so commits (whether `publishRendered` or `publishAssertions` from sibling
     * views) reflect in the host's `.value`. That's what makes the hidden-input
     * pattern from `docs/binding-model.md` §3 integrate with native `FormData`:
     * server submits see the current rendered string even when authoring
     * happens through a bound-to tag input or facet pickers. It also unblocks
     * `forms/rollup`'s facet-group contribution row, which reads
     * `parentEl.value` for the parent marking.
     *
     * Skipped:
     *
     * - Hosts that carry `data-ezclassify-controller`. The controller's own
     *   onChange writes `nativeInput.value` directly (see `attachView`), and
     *   `hidden` / `marked-textarea` controllers manage their own value path.
     *   Doubling up here would be redundant and risks a write race.
     * - Hosts that aren't writable elements (`input` / `textarea`). The aggregate
     *   A non-input marking host has no `.value` to write.
     * - Inputs whose validation helper is wired to the store: the helper writes
     *   the marking in the input's own format.
     *
     * Cycle protection: programmatic `.value =` assignment does not fire
     * `input` / `change` events in any browser, so there's no DOM-side path
     * back to the store. The `data-ez-state="sync"` sentinel is a forward guard
     * for any future code that wires a host-input → publish listener.
     */
    private wireHostWriteback(): void {
        for (const id of this.validMarkingIds) {
            const host = this.root.querySelector<HTMLElement>(
                '#' + cssEscape(id),
            );
            if (!host || this.decisionFlowForms.has(id)) continue;
            if (host.hasAttribute('data-ezclassify-controller')) continue;
            if (host.tagName !== 'INPUT' && host.tagName !== 'TEXTAREA')
                continue;
            if (this.storeUnsubscribers.has(host)) continue;
            if (this.helperInputs.has(host)) continue;
            const writableHost = host as HTMLInputElement | HTMLTextAreaElement;
            const unsubscribe = this.store.subscribe(
                id,
                (state: EzClassifyState) => {
                    // A refused state's text is the engine's marker. Nobody
                    // reads this host but the form it submits with, so it
                    // holds nothing rather than the last marking, and says so.
                    const refused = renderViewRefused(state);
                    host.toggleAttribute('data-ezclassify-invalid', refused);
                    const next = refused ? '' : state.rendered;
                    if (writableHost.value === next) return;
                    host.dataset.ezState = 'sync';
                    try {
                        writableHost.value = next;
                    } finally {
                        delete host.dataset.ezState;
                    }
                    // Any store commit that shifts the host's rendered string is a rollup
                    // input change too, the facet-group contribution pass reads
                    // `parentEl.value`. Without this nudge, a publish that arrives after
                    // the per-click onChange already scheduled its rollup (or one that
                    // arrives with no DOM click at all, e.g. a sibling-view publish) would
                    // leave the rollup looking at the stale host value.
                    rollup.updateRollup(this);
                },
            );
            this.storeUnsubscribers.set(host, unsubscribe);
        }
    }

    /**
     * Whether a facet is where its marking's refusal is said: the first facet
     * of a marking no field shows. A field showing the marking says why it
     * could not be written; a hidden host cannot.
     */
    private facetSpeaksFor(facet: HTMLElement, markingId: string): boolean {
        const shows = (el: Element) => {
            const controller = el.getAttribute('data-ezclassify-controller');
            return controller
                ? controller !== 'hidden'
                : (el as HTMLInputElement).type !== 'hidden';
        };
        const host = this.markingHosts.get(markingId);
        if (host && shows(host)) return false;
        const id = cssEscape(markingId);
        const views = this.root.querySelectorAll(
            `[data-ezclassify-bound-to="${id}"]`,
        );
        if (Array.from(views).some(shows)) return false;
        return (
            this.root.querySelector(`[data-ezclassify-facet-of="${id}"]`) ===
            facet
        );
    }

    private enhance(): void {
        // Discover marking-id host elements first so the view pass can validate
        // bound-to / facet-of references against a known set. An attribute that
        // points at a missing host stays as a free-floating hint (no store edge);
        // attributes that point at a real host get wired through the store.
        this.collectMarkingHosts(this.root);
        this.orderByDocument();
        scanElements(
            this.root,
            this._instanceId,
            (el, binding) => this.bindBehavior(el, binding),
            (el, controller, options) =>
                this.attachView(el, controller, options),
        );
    }

    private observeDOM(): void {
        this.domObserver = observeNewElements(
            this.root,
            this._instanceId,
            (el, binding) => {
                // Late-added marking hosts must register before any sibling view
                // that names them gets attached; the same order enhance() runs.
                this.collectMarkingHosts(el);
                this.bindBehavior(el, binding);
            },
            (el, controller, options) =>
                this.attachView(el, controller, options),
            (el) => {
                this.invalidateDecisionFlow(el);
                this.teardownElement(el);
                this.clearHostError(el);
                this.bindingNodes.delete(el);
                // An element that left the root is no longer this instance's;
                // what add wrote on it stays, as its markup.
                this.addedAttributes.delete(el);
                this.unregisterCollectionOf(el);
            },
            (el, membershipOnly) => this.rederive(el, membershipOnly),
            () => this.rederiveDependents(),
        );
    }

    /**
     * Index the marking hosts under `root` before attaching views, so a view
     * that names a host can find it whatever the document order. A marking host
     * with no DOM id gets a generated one; a host whose markup the binding
     * model refuses is not indexed (see {@link nodeOf}).
     */
    private collectMarkingHosts(root: HTMLElement): void {
        const index = (el: HTMLElement) => {
            if (!isOwnedBy(el, this._instanceId)) return;
            if (!isMarkingHost(el)) return;
            if (!el.id) {
                const controller =
                    el.getAttribute('data-ezclassify-controller') ?? 'marking';
                el.id = `__ez-${controller}-${this._textIdSalt}-${this._textIdCounter++}`;
            }
            const node = this.nodeOf(el);
            if (node.error) return;
            // A marking id names one marking. A second host under an id a
            // live host already holds would write another Context's (or
            // another field's) value into it, so it is refused.
            const holder = this.markingHosts.get(el.id);
            if (holder && holder !== el && holder.isConnected) {
                this.reportHostError(
                    {
                        code: 'duplicate-marking-id',
                        message: `[ezclassify] Two marking hosts use the id "${el.id}". A marking id names one marking; give each host its own id.`,
                        element: el,
                    },
                    null,
                );
                return;
            }
            this.hostEpochs.set(el, (this.hostEpochs.get(el) ?? 0) + 1);
            this.markingHosts.set(el.id, el);
            this.validMarkingIds.add(el.id);
        };
        index(root);
        root.querySelectorAll<HTMLElement>(
            `[${MARKING_ATTR}], [data-ezclassify-controller]`,
        ).forEach(index);
    }

    /**
     * Derive where `el` sits in the marking tree, record it, and report a host
     * error when its markup is refused. Reporting is idempotent per element.
     */
    private nodeOf(el: HTMLElement): BindingNode {
        const node = classify(el, this.root);
        this.bindingNodes.set(el, node);
        if (node.error) this.reportHostError(node.error, node.wholeId ?? null);
        return node;
    }

    /**
     * Where `el` sits in the marking tree, as last derived; undefined for an
     * element this runtime has not scanned. The roll-up reads contributors
     * through it: a view, an ignored element or a refused one never
     * contributes.
     *
     * @internal
     */
    bindingNodeOf(el: HTMLElement): BindingNode | undefined {
        return this.bindingNodes.get(el);
    }

    /**
     * Whether `el`'s marking feeds the levels above it.
     *
     * @internal
     */
    isContributor(el: HTMLElement): boolean {
        return this.bindingNodes.get(el)?.contributes === true;
    }

    /**
     * Record a host error: the element stays unenhanced, an
     * `ezclassify:host-error` event says why, and the levels above it read as
     * incomplete until its markup changes: the collection it sits in, and the
     * whole that encloses it (see {@link errorLevelOf}), with every level above
     * those. The roll-up reports the outputs it refuses to fill the same way.
     *
     * @param error - What is refused, and on which element
     * @param wholeId - The whole whose rollup the element would have fed, when
     *   the markup names one; otherwise the enclosing `whole` container's
     * @internal
     */
    reportHostError(
        error: HostError | RollupOutputError,
        wholeId: string | null = null,
    ): void {
        if (this._destroyed || this.hostErrors.has(error.element)) return;
        const level = errorLevelOf(error.element, this.root);
        const whole = wholeId ?? level.wholeId;
        const next = () =>
            `__ez-host-error-${this._textIdSalt}-${this._textIdCounter++}`;
        const contributors: Array<{ id: string; wholeId: string | null }> = [
            { id: next(), wholeId: null },
            ...(whole ? [{ id: next(), wholeId: whole }] : []),
        ];
        this.hostErrors.set(error.element, { error, contributors });
        // Placed before it is flagged, so its level is computed once.
        this.store.setMembership(contributors[0].id, level.collectionId);
        for (const contributor of contributors)
            this.store.setIncompleteContributor?.(
                contributor.id,
                contributor.wholeId,
                true,
            );
        if (this.rereadErrors?.get(error.element) === error.message) {
            this.refreshIncomplete();
            return;
        }
        console.error(error.message);
        error.element.dispatchEvent(
            new CustomEvent('ezclassify:host-error', {
                bubbles: true,
                composed: true,
                detail: { code: error.code, message: error.message },
            }),
        );
        this.refreshIncomplete();
    }

    /** Forget the host error recorded for `el`, if any. */
    private clearHostError(el: HTMLElement): void {
        const entry = this.hostErrors.get(el);
        if (!entry) return;
        this.hostErrors.delete(el);
        this.releaseErrorContributors(entry.contributors);
        this.refreshIncomplete();
    }

    /** Clear the store's record of a host error's contributors. */
    private releaseErrorContributors(
        contributors: ReadonlyArray<{ id: string; wholeId: string | null }>,
    ): void {
        for (const contributor of contributors)
            this.store.setIncompleteContributor?.(
                contributor.id,
                contributor.wholeId,
                false,
            );
        this.store.setMembership(contributors[0].id, null);
    }

    /**
     * Declare a `data-ezclassify-collection` container to the store, inside its
     * parent collection or the page. A refused one is a host error.
     */
    private registerCollectionOf(el: HTMLElement): void {
        const node = describeCollection(el, this.root);
        if (!node) return;
        if (node.error) {
            this.reportHostError(node.error, null);
            return;
        }
        this.placeCollection(el, node);
    }

    private placeCollection(el: HTMLElement, node: BindingNode): void {
        if (this.collections.get(el) !== node.id) {
            this.unregisterCollectionOf(el);
            this.collections.set(el, node.id!);
            this.collectionRollupUnsubscribers.set(
                el,
                this.store.subscribeAggregate((aggregate) => {
                    if (!isAggregatePending(aggregate))
                        void rollup.updateRollup(this);
                }, node.id!),
            );
        }
        this.store.registerCollection(node.id!, node.collectionId ?? null);
    }

    private unregisterCollectionOf(el: HTMLElement): void {
        const id = this.collections.get(el);
        if (id === undefined) return;
        this.collectionRollupUnsubscribers.get(el)?.();
        this.collectionRollupUnsubscribers.delete(el);
        this.collections.delete(el);
        this.store.unregisterCollection(id);
    }

    /**
     * Place a marking host's marking in the store: a part under its whole, a
     * whole in its collection, each in the bucket its Context and scheme
     * resolve to.
     */
    private placeMarking(
        el: HTMLElement,
        node: BindingNode,
        bucket: BucketKey,
    ): void {
        const id = el.id;
        if (!id || !this.validMarkingIds.has(id)) return;
        try {
            this.store.setBucket(id, bucket);
        } catch (err) {
            // A store the host built may hold fewer buckets than the markup
            // names, such as one over a Context's primary scheme alone. The
            // marking is refused on its element, never read in another bucket.
            this.reportHostError(
                {
                    code: 'context-unresolved',
                    message: `[ezclassify] marking "${id}" is in a bucket the store cannot read: ${err instanceof Error ? err.message : String(err)}`,
                    element: el,
                },
                null,
            );
            return;
        }
        // Set before its whole goes and cleared after one comes, so a marking
        // is never a whole of the level in between.
        const standalone = node.kind === 'part' && node.wholeId === undefined;
        if (standalone) this.store.setStandalonePart(id, true);
        if (node.kind === 'part') {
            this.store.setPartOf(id, node.wholeId ?? null);
        } else if (node.kind === 'whole') {
            this.store.setPartOf(id, null);
            this.store.setMembership(id, node.collectionId ?? null);
            this.store.setNoRollup(id, !node.contributes);
        }
        if (!standalone) this.store.setStandalonePart(id, false);
    }

    /**
     * Order the store's contributors as their elements stand in the document,
     * so a roll-up that keeps the first or last value reads the page's order.
     */
    private orderByDocument(): void {
        const elementOf = (id: string): Element | undefined => {
            const host = this.markingHosts.get(id);
            if (host) return host;
            const scope = this.scopeWholes.get(id);
            if (scope) return scope.root;
            for (const [el, collection] of this.collections)
                if (collection === id) return el;
            return undefined;
        };
        this.store.setDocumentOrder((left, right) => {
            const a = elementOf(left);
            const b = elementOf(right);
            if (!a || !b || a === b)
                return left < right ? -1 : left > right ? 1 : 0;
            return a.compareDocumentPosition(b) &
                Node.DOCUMENT_POSITION_FOLLOWING
                ? -1
                : 1;
        });
    }

    /**
     * Derive the subtree under `el` again after a structural attribute changed
     * (see {@link rederiveScope}), and then each part elsewhere on the page that
     * names a whole inside it: whether that part is accepted depends on where
     * its whole now sits.
     */
    private rederive(el: HTMLElement, membershipOnly = false): void {
        if (this._destroyed) return;
        if (membershipOnly && this.rederiveMembership(el)) {
            void rollup.updateRollup(this);
            return;
        }
        this.invalidateDecisionFlow(el);
        this.rederiveScope(el);
        if (!this.root.contains(el)) return;
        const wholes = new Set<string>();
        for (const host of [
            el,
            ...Array.from(el.querySelectorAll<HTMLElement>('[id]')),
        ])
            if (host.id) wholes.add(host.id);
        for (const part of Array.from(
            this.root.querySelectorAll<HTMLElement>(`[${PART_OF_ATTR}]`),
        )) {
            if (el.contains(part)) continue;
            const named = part.getAttribute(PART_OF_ATTR)?.trim();
            if (named && wholes.has(named)) this.rederiveScope(part);
        }
    }

    /**
     * Refresh only collection edges when a membership mutation keeps every
     * binding valid. Anything that changes a marking's role or makes its markup
     * invalid goes through the normal detach and rederive path.
     */
    private rederiveMembership(scope: HTMLElement): boolean {
        const hosts = [
            scope,
            ...scope.querySelectorAll<HTMLElement>(EZ_SELECTOR),
        ].filter((host) => isOwnedBy(host, this._instanceId));
        const placements = hosts.map((host) => ({
            host,
            before: this.bindingNodes.get(host),
            next: classify(host, this.root),
            collection: describeCollection(host, this.root),
        }));
        if (
            placements.some(
                ({ host, before, next, collection }) =>
                    this.hostErrors.has(host) ||
                    next.error ||
                    collection?.error ||
                    before?.wholeId !== next.wholeId ||
                    (next.kind === 'whole' &&
                        (before?.kind !== 'whole' ||
                            before.id !== next.id ||
                            before.contextKey !== next.contextKey ||
                            before.schemeSelector !== next.schemeSelector ||
                            before.contributes !== next.contributes)),
            )
        )
            return false;
        for (const { host, collection } of placements) {
            if (collection) this.placeCollection(host, collection);
            else this.unregisterCollectionOf(host);
        }
        for (const { host, next } of placements) {
            this.bindingNodes.set(host, next);
            if (next.kind === 'whole' && next.id)
                this.store.setMembership(next.id, next.collectionId ?? null);
        }
        return true;
    }

    /**
     * Derive again the markup whose reading depends on other elements, after
     * elements that carry ids or collections came, went or were renamed: each
     * element refused for what it names (a missing whole or collection, a whole
     * of another Context, an id another host holds), and each part whose whole
     * has left the page.
     */
    private rederiveDependents(): void {
        for (const [id, group] of this.decisionFlowForms) {
            if (group.whole.id !== id) this.invalidateDecisionFlow(group.whole);
        }
        if (this._destroyed) return;
        const stale = new Set<HTMLElement>();
        for (const [el, { error }] of this.hostErrors)
            if (REFERENCE_ERRORS.has(error.code)) stale.add(el);
        for (const [el, node] of this.bindingNodes)
            if (
                node.kind === 'part' &&
                !node.error &&
                node.wholeId &&
                !el.ownerDocument.getElementById(node.wholeId)
            )
                stale.add(el);
        for (const [el, node] of this.bindingNodes)
            if (
                node.kind === 'whole' &&
                !node.error &&
                el.hasAttribute(MEMBER_OF_ATTR) &&
                classify(el, this.root).error
            )
                stale.add(el);
        // Reading an element again that is still refused for the same reason
        // tells the host nothing new.
        const before = new Map<HTMLElement, string>();
        for (const el of stale) {
            const message = this.hostErrors.get(el)?.error.message;
            if (message !== undefined) before.set(el, message);
        }
        this.rereadErrors = before;
        try {
            for (const el of stale)
                if (el.isConnected && this.root.contains(el))
                    this.rederiveScope(el);
        } finally {
            this.rereadErrors = null;
        }
    }

    /**
     * Derive the subtree under `el` again: tear down what this runtime built
     * there and scan it afresh, so every host reads its new place in the tree.
     * Hosts keep their DOM and their committed values; a draft is kept through
     * teardown.
     */
    private rederiveScope(el: HTMLElement): void {
        if (this._destroyed) return;
        const scope = el === this.root || this.root.contains(el) ? el : null;
        if (!scope) return;
        // The scope itself counts when it still declares a binding, and when it
        // has stopped declaring one this runtime had read: its enhancement goes.
        const scopeRead =
            scope !== this.root &&
            (isBehaviorBound(scope) ||
                this.isBuilt(scope) ||
                this.bindingNodes.has(scope) ||
                this.hostErrors.has(scope));
        const affected = [
            ...(scopeRead ? [scope] : []),
            ...Array.from(scope.querySelectorAll<HTMLElement>(EZ_SELECTOR)),
        ].filter((host) => isOwnedBy(host, this._instanceId));
        for (const host of affected) {
            if (this.isBuilt(host)) this.teardownElement(host);
            this.clearHostError(host);
            this.bindingNodes.delete(host);
        }
        for (const container of this.collections.keys())
            if (scope.contains(container))
                this.unregisterCollectionOf(container);
        this.collectMarkingHosts(scope);
        const behave = (host: HTMLElement, binding: BehaviorBinding) =>
            this.bindBehavior(host, binding);
        const view = (
            host: HTMLElement,
            controller: ControllerName,
            options: Record<string, string>,
        ) => this.attachView(host, controller, options);
        if (scope !== this.root && isBehaviorBound(scope)) {
            behave(scope, readBinding(scope));
            const controller = scope.getAttribute('data-ezclassify-controller');
            if (controller)
                view(
                    scope,
                    controller as ControllerName,
                    harvestControllerOptions(
                        scope,
                        controller as ControllerName,
                    ),
                );
        }
        scanElements(scope, this._instanceId, behave, view);
        if (!this.initializing) rollup.updateRollup(this);
    }

    /** Whether this runtime built anything for `host`. */
    private isBuilt(host: HTMLElement): boolean {
        return (
            this.mounted.has(host) ||
            this.fields.includes(host as HTMLInputElement) ||
            this.plainBehaviorCleanups.has(host) ||
            this.storeUnsubscribers.has(host) ||
            this.partOfMap.has(host) ||
            (!!host.id && this.markingHosts.get(host.id) === host)
        );
    }

    /**
     * Join the enclosing instance's tree, inferred from the DOM: the nearest
     * mount root above this one is the parent scope, and this scope's wholes
     * are members of the parent's nearest collection enclosing this root. A
     * disjoint mount has no parent and contributes to nothing. A root inside a
     * `whole` container cannot be placed: the parent records a host error and
     * this scope contributes nothing to it.
     */
    private registerWithParentScope(): void {
        const parentRootEl = this.root.parentElement?.closest(
            '[' + MOUNT_ROOT_ATTR + ']',
        ) as HTMLElement | null;
        const parentId = parentRootEl?.getAttribute(MOUNT_ROOT_ATTR) ?? null;
        if (!parentRootEl || !parentId || parentId === this._instanceId) return;
        const placed = placeNestedRoot(this.root, parentRootEl);
        if (placed.error) {
            registry.instanceById(parentId)?.reportHostError?.(placed.error);
            return;
        }
        registry.addChild(
            parentId,
            this._instanceId,
            this.asRegistryChild(placed.collectionId),
        );
    }

    // ---------------------------------------------------------------------------
    // Cross-instance mount-rollup (nested-scope contribution)
    // ---------------------------------------------------------------------------

    /**
     * This scope's last-computed page rollup, one whole per bucket. The
     * upstream contribution payload, read by a parent scope's rollup pass.
     */
    private _childWholes = new Map<BucketKey, ChildWhole>();

    /**
     * Run this scope's rollup immediately (no debounce). Invoked by a child's
     * `onRollupComputed` so a leaf change settles up the scope tree
     * synchronously.
     *
     * @internal
     */
    flushRollupNow(): void {
        this.syncChildScopes();
        void rollup.flushRollupNow(this);
    }

    /**
     * The wholes nested scopes contribute, by the marking id this scope's store
     * holds each under: one per child scope and bucket.
     */
    private readonly scopeWholes = new Map<
        string,
        { key: string; root: HTMLElement; signature: string }
    >();
    private scopeWholeCounter = 0;

    /**
     * Carry each nested scope's rolled-up wholes into this scope's store, as
     * wholes of the collection the scope sits in. A scope's page rollup is a
     * whole in this tree: the store reads its facts the way it reads any
     * whole's, in the same bucket, so a nested island and a field beside it
     * roll up together and different buckets never merge. A whole a scope no
     * longer contributes leaves the store.
     *
     * A child that holds one Context is read in the Context this scope resolves
     * where the child's root stands. A child that names its Contexts by key is
     * read under the same keys. A child this scope cannot place is a host error
     * on the child's root, and this scope's levels read as incomplete.
     */
    private syncChildScopes(): void {
        if (this._destroyed) return;
        const live = new Set<string>();
        const idByKey = new Map<string, string>();
        for (const [id, whole] of this.scopeWholes) idByKey.set(whole.key, id);
        for (const child of registry.childrenOf(this._instanceId)) {
            for (const whole of child.childWholes().values()) {
                const bucket = this.parentBucketOf(child, whole.bucket);
                if (bucket === undefined) continue;
                const key = `${child.instanceId}\u001f${bucket}`;
                let id = idByKey.get(key);
                if (!id) {
                    id = `__ez-scope-${this._textIdSalt}-${this.scopeWholeCounter++}`;
                    idByKey.set(key, id);
                }
                live.add(id);
                const signature = signAssertions(whole.assertions);
                const known = this.scopeWholes.get(id);
                if (known?.signature === signature) continue;
                if (!known) {
                    this.store.setBucket(id, bucket);
                    this.store.setMembership(id, child.collectionId);
                }
                this.scopeWholes.set(id, {
                    key,
                    root: child.root,
                    signature,
                });
                void this.store
                    .seedAssertions(id, whole.assertions)
                    .catch((error: unknown) =>
                        reportPublishFailure('nested scope', id, error),
                    );
            }
        }
        for (const id of Array.from(this.scopeWholes.keys())) {
            if (live.has(id)) continue;
            this.scopeWholes.delete(id);
            this.store.releaseSeed(id);
        }
    }

    /**
     * The bucket in this scope a nested scope's bucket is read in, or
     * undefined, after reporting a host error on the child's root, when this
     * scope holds no such Context.
     */
    private parentBucketOf(
        child: registry.RegistryChild,
        childBucket: BucketKey,
    ): BucketKey | undefined {
        const { contextKey, schemeSelector } = bucketParts(childBucket);
        let key = contextKey;
        if (contextKey === SINGLE_CONTEXT_KEY) {
            const resolved = this.contextForMount(child.root);
            if (!resolved) return undefined;
            key = resolved.contextKey;
        }
        const bucket = bucketKey(key, schemeSelector);
        if (this.bucketsNamed(key, schemeSelector || null).includes(bucket))
            return bucket;
        this.reportHostError(
            {
                code: 'context-unresolved',
                message: `[ezclassify] A nested EzClassifyUI marks in ${contextKey ? `Context '${contextKey}'` : 'its Context'}${schemeSelector ? `, scheme '${schemeSelector}'` : ''}, which this EzClassifyUI does not hold.`,
                element: child.root,
            },
            null,
        );
        return undefined;
    }

    /**
     * Receive this scope's page rollup, one whole per bucket, at the end of
     * each rollup run. Record it, and, if the contribution changed (signature
     * guard), synchronously notify the parent scope to re-aggregate. The
     * signature guard prevents republish thrash when nothing actually moved.
     *
     * @internal
     */
    onRollupComputed(
        byBucket: ReadonlyMap<
            BucketKey,
            { rendered: string; assertions: EngineAssertion[] }
        >,
    ): void {
        const wholes = new Map<BucketKey, ChildWhole>();
        for (const [bucket, level] of byBucket)
            wholes.set(bucket, {
                bucket,
                rendered: level.rendered,
                assertions: level.assertions,
            });
        this._childWholes = wholes;
        // A stable signature of the contribution: its facts, per bucket.
        const sig = Array.from(wholes.values())
            .map(
                (whole) =>
                    `${whole.bucket}=${signAssertions(whole.assertions)}`,
            )
            .sort()
            .join('|');
        const prev = this._lastChildSig.get('@self');
        if (sig === prev) return;
        this._lastChildSig.set('@self', sig);
        registry.notifyParent(this._instanceId);
    }

    /**
     * Whether the rollup this scope shows may be missing markings: a
     * MarkedTextArea in it did not read all of its text, an element's markup
     * was refused, the store holds the page aggregate as stale, or a scope
     * nested inside it says the same of the whole it contributes. A scope being
     * torn down contributes nothing.
     */
    private rollupIncomplete(): boolean {
        if (this._destroyed) return false;
        return (
            this.incompleteScans.size > 0 ||
            this.hostErrors.size > 0 ||
            Array.from(this.store.getAggregate().byBucket.values()).some(
                (bucket) => bucket.stale === true,
            ) ||
            registry
                .childrenOf(this._instanceId)
                .some((child) => child.incomplete?.() === true)
        );
    }

    /**
     * Carry {@link rollupIncomplete} to the outputs the host placed: while the
     * rollup they hold may be missing markings, each is invalid (custom
     * validity and `aria-invalid`), and the enclosing scope is told so it can
     * say the same of the whole it builds from this one. Reads no engine: it
     * only reports what is known.
     *
     * @internal
     */
    refreshIncomplete(fromRollup = false): void {
        const incomplete = this.rollupIncomplete();
        if (incomplete === this.rollupIncompleteShown) return;
        // Raised at once, cleared only by a rollup pass: an output may still
        // hold the value computed while something was unread, and only a pass
        // run after that recomputes it. Ask for one rather than wait for it.
        if (!incomplete && !fromRollup) {
            if (!this._destroyed && !this.initializing)
                void rollup.updateRollup(this);
            return;
        }
        this.rollupIncompleteShown = incomplete;
        rollup.setOutputsIncomplete(this, incomplete);
        registry.notifyParentIncomplete(this._instanceId);
    }

    /**
     * The registry view of this instance: its current wholes, one per bucket,
     * as members of `collectionId` in the parent's tree.
     */
    private asRegistryChild(
        collectionId: string | null,
    ): registry.RegistryChild {
        return {
            instanceId: this._instanceId,
            root: this.root,
            collectionId,
            // What this scope's outputs show: raised at once, cleared by
            // the pass that recomputes the whole the parent reads.
            incomplete: () => !this._destroyed && this.rollupIncompleteShown,
            childWholes: (): Map<BucketKey, ChildWhole> => {
                const out = new Map<BucketKey, ChildWhole>();
                for (const [bucket, whole] of this._childWholes) {
                    if (!whole.rendered && whole.assertions.length === 0)
                        continue;
                    out.set(bucket, whole);
                }
                return out;
            },
        };
    }

    /**
     * Reclaim-on-register sweep. An ancestor instance constructed before this
     * one may already have enhanced hosts that now sit under this instance's
     * root (the outer-first race). For each such host, ask the owning ancestor
     * to release it so this instance can become its sole owner. Makes ownership
     * order-independent.
     */
    private reclaimFromAncestors(): void {
        const mounts = this.root.querySelectorAll<HTMLElement>(
            '[data-ezclassify-mount]',
        );
        for (const mount of Array.from(mounts)) {
            // The registry, not DOM position: a text editor field's host sits
            // inside the wrapper that precedes its mount.
            const host = getMountHost(mount);
            if (!host || !host.hasAttribute('data-ezclassify-controller'))
                continue;
            // Only reclaim hosts this instance would itself own under the boundary.
            if (!isOwnedBy(host, this._instanceId)) continue;
            const owner = getMountOwner(host);
            if (owner && owner !== this._instanceId) {
                const ancestor = registry.instanceById(owner);
                ancestor?.releaseElement(host);
                clearMountOwner(host);
            }
        }
    }

    /**
     * Public-to-the-package release path used by the reclaim sweep on a peer
     * instance: tear down everything this instance wired for `host` so another
     * instance can take ownership. Delegates to the unified teardown.
     *
     * @internal
     */
    releaseElement(host: HTMLElement): void {
        this.teardownElement(host);
    }

    /**
     * The value the store has committed for the marking `el` holds, or for the
     * marking a source view shows. `undefined` when the store has nothing for
     * it yet, or when the field holds a draft it has not committed.
     *
     * @internal
     */
    committedRendering(el: HTMLElement): string | undefined {
        if (this.holdsDraft(el)) return undefined;
        const id =
            el.id && this.validMarkingIds.has(el.id)
                ? el.id
                : el.getAttribute('data-ezclassify-source');
        if (!id || !this.validMarkingIds.has(id)) return undefined;
        const committed = this.store.get(id);
        if (!committed.rendered && committed.assertions.length === 0)
            return undefined;
        return committed.rendered.trim();
    }

    /** Whether the field on `el` holds text it has not committed. */
    private holdsDraft(el: HTMLElement): boolean {
        const component: ComponentInstance | undefined =
            this.mounted.get(el) ??
            this.autocompleters.get(el as HTMLInputElement);
        return !!component?.pendingDraft?.();
    }

    /**
     * See FormsContext.whenStoreIdle.
     *
     * @internal
     */
    whenStoreIdle(run: () => void): boolean {
        return runWhenStoreIdle(this.store, run);
    }

    /**
     * The text the host of whole `wholeId` shows: a field's value, an
     * uncommitted draft included.
     */
    private wholeHostText(wholeId: string): string {
        const host =
            this.fields.find((field) => field.id === wholeId) ??
            [...this.mounted.keys()].find((el) => el.id === wholeId);
        return (host as HTMLInputElement | undefined)?.value?.trim() ?? '';
    }

    /**
     * The current markings of the parts that name `wholeId`: the same
     * contributors the rollup compares with that whole. A part the store holds
     * is read from its committed state, the value the store rolls up, unless
     * its field holds an uncommitted draft; a part the store has not committed
     * yet is left out until it has, and the rollup notification that follows
     * reads the whole again. Any other part is read the way the rollup reads it
     * (see rollup.elementRendered). Blank markings (a part not marked yet) are
     * left out.
     */
    private partMarkingsOf(wholeId: string): string[] {
        const contributors = rollup
            .partitionContributorsByParent(this)
            .get(wholeId);
        return (contributors ?? [])
            .map((el) =>
                (el.id &&
                this.validMarkingIds.has(el.id) &&
                !this.holdsDraft(el)
                    ? this.store.get(el.id).rendered
                    : rollup.elementRendered(this, el)
                ).trim(),
            )
            .filter(Boolean);
    }

    /**
     * Unified teardown for a single host (and its `data-ezclassify`
     * descendants). Reused by `destroy()`, the removedNodes observer, and the
     * reclaim sweep; one path so component destruction, map cleanup, store
     * unwind, and mount sibling removal always happen together, mirroring the
     * proven `unregisterHiddenField` teardown sequence.
     *
     * @internal
     */
    teardownElement(host: HTMLElement): void {
        // Recurse the removed subtree first: a removed container must release every
        // enhanced descendant, not just its top node.
        host.querySelectorAll<HTMLElement>(
            `[data-ezclassify-controller], [${MARKING_ATTR}]`,
        ).forEach((desc) => {
            if (desc !== host) this.teardownElement(desc);
        });
        const epoch = this.hostEpochs.get(host);

        const input = host as HTMLInputElement;

        // Tag-input fields live in this.fields + this.autocompleters.
        const fieldIdx = this.fields.indexOf(input);
        if (fieldIdx >= 0) this.fields.splice(fieldIdx, 1);
        const ac = this.autocompleters.get(input);
        if (ac) {
            this.keepDraft(ac);
            try {
                ac.destroy();
            } catch {
                /* already gone */
            }
            this.autocompleters.delete(input);
        }

        // Declarative components.
        const comp = this.mounted.get(host);
        if (comp) {
            this.keepDraft(comp);
            try {
                comp.destroy();
            } catch {
                /* already gone */
            }
            this.mounted.delete(host);
        }

        // Per-field maps.
        this.fieldAssertions.delete(input);
        this.lastValidated.delete(input);

        // Relationship maps.
        this.partOfMap.delete(host);

        // Plain-behavior cleanups.
        const plainCleanup = this.plainBehaviorCleanups.get(host);
        if (plainCleanup) {
            try {
                plainCleanup();
            } catch {
                /* ignore */
            }
            this.plainBehaviorCleanups.delete(host);
        }

        // Part refresh for a whole field, whole refresh for a part.
        this.partUnsubscribers.get(host)?.();
        this.partUnsubscribers.delete(host);
        this.wholeUnsubscribers.get(host)?.();
        this.wholeUnsubscribers.delete(host);
        clearWholeReadGate(host);
        // A whole mounted again under this id starts from its own host.
        if (host.id) this.wholeCommits.delete(host.id);

        // A field removed with a draft open commits it before it finishes
        // tearing down; its store wiring stays until that write has landed.
        const unsub = this.storeUnsubscribers.get(host);
        this.storeUnsubscribers.delete(host);
        const releaseStore = () => {
            // Store subscription.
            if (unsub) {
                try {
                    unsub();
                } catch {
                    /* ignore */
                }
            }

            // Store-state unwind: if this host self-registered a marking,
            // drop its part-of edge, release its seed and empty it so
            // subscribers see it leave the aggregate, and forget the marking
            // id. Routed through the store, never a hostless parent-store
            // marking.
            // A structural change may have registered the host again while
            // its draft was being written; that registration stays.
            if (this.hostEpochs.get(host) !== epoch) return;
            if (host.id && this.validMarkingIds.has(host.id)) {
                this.store.setPartOf(host.id, null);
                this.store.releaseSeed(host.id);
                this.store.setStandalonePart(host.id, false);
                this.markingHosts.delete(host.id);
                this.validMarkingIds.delete(host.id);
                this.seededMarkings.delete(host.id);
            }
        };
        const write =
            (comp && pendingTeardownWrite(comp)) ??
            (ac && pendingTeardownWrite(ac));
        if (write) void write.then(releaseStore);
        else releaseStore();

        // Remove the orphan mount sibling if it is still attached. A host that
        // stays on the page (its markup changed, or `remove` was called) is
        // shown again; a mount that still applies hides it when it remounts.
        const sibling = host.nextElementSibling as HTMLElement | null;
        if (sibling?.hasAttribute('data-ezclassify-mount')) {
            sibling.remove();
            if (host.isConnected && host.style.display === 'none')
                host.style.display = '';
        }

        clearMountOwner(host);

        // A removal changes the aggregate: schedule a rollup so the banner moves.
        if (!this._destroyed && !this.initializing) rollup.updateRollup(this);
    }

    /**
     * Behavior pass: register engine wiring for an element. The binding model
     * says where the element sits in the marking tree; a refused element is
     * left unenhanced. Records part and whole placement in the store, and (for
     * a plain marking input without a controller) registers the element as a
     * rollup-contributing field. Never mutates the DOM beyond the single status
     * wrapper required for plain enhanced inputs.
     */
    private bindBehavior(el: HTMLElement, binding: BehaviorBinding): void {
        if (el.hasAttribute(COLLECTION_ATTR)) this.registerCollectionOf(el);
        // Markup already refused (a duplicate marking id) stays unenhanced.
        if (this.hostErrors.has(el)) return;
        const node = this.nodeOf(el);
        if (node.error) return;
        // A newly inserted sibling view can precede its host in the observer's
        // scan. Index its existing target before wiring the subscription.
        const targetId = binding.boundTo ?? binding.facetOf ?? binding.source;
        if (targetId) {
            const target = this.root.querySelector<HTMLElement>(
                '#' + cssEscape(targetId),
            );
            if (target) this.collectMarkingHosts(target);
        }
        // A part's whole comes from structure: its `whole` container or its
        // `part-of`. A body editor that is not a marking itself routes its
        // portions to the whole it sits in the same way.
        if (node.kind === 'part' || node.kind === 'whole') {
            // A marking is read in the bucket its Context and scheme resolve
            // to. Markup that resolves none is a host error on the element,
            // never a throw out of the scan; one still waiting on its
            // Context's scheme list is read again once the list is in.
            const resolved = this.contextForMount(el);
            if (!resolved) return;
            if (node.wholeId) this.partOfMap.set(el, node.wholeId);
            this.placeMarking(el, node, resolved.bucket);
        } else if (node.wholeId) this.partOfMap.set(el, node.wholeId);
        // A marking host with no controller is mounted by this step, after its
        // placement so its first read already reads it as a part.
        if (
            el.id &&
            this.markingHosts.get(el.id) === el &&
            this.validMarkingIds.has(el.id) &&
            !el.hasAttribute('data-ezclassify-controller')
        )
            this.seedOnMount(el.id, el);

        // Non-input elements with data-ezclassify-source (e.g. <output>) mirror
        // a named marking's rendered string by subscribing to the in-memory store.
        // When the element ALSO carries a controller attribute, skip this bare
        // text-mirror path, attachView() will mount the component and
        // wireReadSubscription owns the store subscription. A text-mirror wired
        // here would overwrite the component's DOM on every store update and leak
        // a subscription (storeUnsubscribers would be overwritten without calling
        // the old unsub). The two paths must be mutually exclusive per element.
        const hasController = !!el.getAttribute('data-ezclassify-controller');
        if (isTranslatedView(el)) {
            this.attachTranslatedView(el);
            return;
        }
        if (
            binding.source &&
            el.tagName !== 'INPUT' &&
            el.tagName !== 'TEXTAREA' &&
            !hasController
        ) {
            const sourceId = binding.source;
            if (this.validMarkingIds.has(sourceId)) {
                // A mirror that names scopes shows those scopes' own output,
                // as a text view does (see writeInScopes): an authority block
                // mirror shows the authority block, not the banner. Only the
                // newest state's write is shown.
                const viewScopes = parseScopeList(
                    el.getAttribute('data-ezclassify-scope'),
                );
                let scopedWrite = 0;
                const update = (s: EzClassifyState) => {
                    const write = ++scopedWrite;
                    if (viewScopes.length === 0 || renderViewRefused(s)) {
                        el.textContent = s.rendered || EMPTY_VALUE;
                        return;
                    }
                    void this.writeInScopes(el, s.assertions, viewScopes)
                        .catch(() => null)
                        .then((text) => {
                            if (write !== scopedWrite || this._destroyed)
                                return;
                            el.textContent = text || EMPTY_VALUE;
                        });
                };
                const unsub = this.store.subscribe(sourceId, update);
                this.storeUnsubscribers.set(el, unsub);
                update(this.store.get(sourceId));
            }
            return;
        }

        // A native select that is a facet of a marking is a category picker:
        // nothing else it could be, so it needs no opt-in.
        const controllerName = el.getAttribute('data-ezclassify-controller');
        const isPlainBehavior = !controllerName;
        if (
            isPlainBehavior &&
            el.tagName === 'SELECT' &&
            binding.facetOf &&
            binding.category &&
            this.validMarkingIds.has(binding.facetOf)
        ) {
            this.attachPlainSelectBehavior(
                el as HTMLSelectElement,
                binding.facetOf,
                binding.category,
            );
            return;
        }
        // A plain marking <input> with no controller is a rollup-contributing
        // field; a view never is. A visible text input that is a marking, or
        // edits one (`bound-to`), gets the validation helper; a hidden,
        // checkbox or radio input only holds a value.
        if (isPlainBehavior && el.tagName === 'INPUT') {
            const input = el as HTMLInputElement;
            const holdsMarking = node.kind === 'part' || node.kind === 'whole';
            if (holdsMarking && !this.fields.includes(input))
                this.fields.push(input);
            const helped =
                (holdsMarking || !!binding.boundTo) &&
                input.type !== 'hidden' &&
                input.type !== 'checkbox' &&
                input.type !== 'radio';
            // Re-entrancy guard, and it must come BEFORE the wrap below.
            // `plainBehaviorCleanups` is this path's record of "already
            // enhanced": every bind branch registers an entry (even the input
            // types attachPlainInputBehavior declines to wire), and
            // teardownElement drops it when the input really leaves the tree.
            //
            // Without the guard, an input appended AFTER construction pins the
            // main thread. The observer's addedNodes record runs bindBehavior,
            // which creates the wrap span and moves the input into it; that
            // mutation queues a fresh record for the span, whose scanElements
            // pass finds the same still-bound input and wraps it again, forever.
            // Each turn enqueues the next observer microtask, so the loop never
            // yields to the macrotask queue and no test timeout can fire. The
            // check has to precede the DOM mutation: the identical guard
            // inside attachPlainInputBehavior sits after it and stops only the
            // duplicate listener wiring, not the wrapping.
            if (helped && !this.plainBehaviorCleanups.has(input)) {
                const priorParent = input.parentNode;
                const nextSibling = input.nextSibling;
                const statusWrap = document.createElement('span');
                // Its layout is status-mark.css's, adopted with the mark.
                statusWrap.className = 'ez-plain-field-wrap';
                priorParent?.insertBefore(statusWrap, input);
                statusWrap.appendChild(input);
                // Wire two-way store sync with the marking the input holds or
                // edits, so sibling views (tag inputs, etc.) stay in step with
                // it and its commits reach the levels above it.
                const boundId =
                    binding.boundTo ?? (holdsMarking ? input.id : undefined);
                const sb =
                    boundId && this.validMarkingIds.has(boundId)
                        ? this.makeStoreBinding(
                              input,
                              boundId,
                              false,
                              undefined,
                          )
                        : null;
                if (sb) this.helperInputs.add(input);
                this.attachPlainInputBehavior(input, binding, sb, statusWrap);
                const priorCleanup = this.plainBehaviorCleanups.get(input);
                this.plainBehaviorCleanups.set(input, () => {
                    priorCleanup?.();
                    if (input.parentNode === statusWrap) {
                        if (priorParent) {
                            // The sibling captured at bind time may be gone by
                            // now: destroy() removes the rollup hidden input
                            // (and other injected nodes) before it runs these
                            // cleanups, and it is exactly the node that follows
                            // an input appended straight to the scanner root.
                            // insertBefore against a detached reference throws
                            // NotFoundError and aborts the rest of teardown, so
                            // fall back to appending.
                            const ref =
                                nextSibling?.parentNode === priorParent
                                    ? nextSibling
                                    : null;
                            priorParent.insertBefore(input, ref);
                        }
                        statusWrap.remove();
                    }
                });
            }
        }
    }

    /**
     * Bind a native select in place. EzClassify owns only its option data,
     * selected concept ids, and validation attributes; the browser or a
     * third-party enhancer continues to own rendering, focus, and keyboard
     * behavior.
     */
    private attachPlainSelectBehavior(
        select: HTMLSelectElement,
        markingId: string,
        categoryId: string,
    ): void {
        if (this.plainBehaviorCleanups.has(select)) return;

        const binding = createEzClassifyFacetBinding(
            this.store,
            markingId,
            categoryId,
        );
        const placeholder =
            !select.multiple &&
            select.options.length > 0 &&
            select.options[0]?.value === ''
                ? select.options[0].text
                : 'Choose one';

        const unsubscribe = binding.subscribe((snapshot) => {
            const selected = new Set(snapshot.selectedConceptIds);
            const fragment = document.createDocumentFragment();

            if (!select.multiple) {
                fragment.append(new Option(placeholder, ''));
            }

            for (const choice of snapshot.allowableOptions ?? []) {
                const option = new Option(choice.label, choice.conceptId);
                option.selected = selected.has(choice.conceptId);
                option.disabled = choice.gated === true;
                fragment.append(option);
            }

            select.replaceChildren(fragment);
            select.setAttribute(
                'aria-invalid',
                String(!snapshot.marking.valid),
            );
            select.dispatchEvent(
                new CustomEvent('ezclassify:sync', {
                    bubbles: true,
                    detail: snapshot,
                }),
            );
        });

        const onChange = () => {
            void binding.setSelected(
                Array.from(
                    select.selectedOptions,
                    (option) => option.value,
                ).filter(Boolean),
            );
        };
        select.addEventListener('change', onChange);

        this.plainBehaviorCleanups.set(select, () => {
            select.removeEventListener('change', onChange);
            unsubscribe();
            binding.destroy();
        });
    }

    /** Full store marking shared by its associated editable views. */
    private createMarkingTarget(
        el: HTMLElement,
        associatedId: string,
        controller?: ControllerName,
        component?: ComponentInstance,
    ): MarkingTarget {
        const entry = () => (component ? markingEntry(component) : undefined);
        const targetId = () =>
            controller === 'marked-textarea' ? entry()?.id() : associatedId;
        const host = this.markingHosts.get(associatedId) ?? el;
        const engine = schemeEngineOf(this.resolveContext(host), host);
        const outputFormat = () => {
            const formats = this.formatsOf(host);
            if (controller === 'marked-textarea') return formats.part;
            if (controller === 'marked-input' && host.id === associatedId)
                return component?.writtenOutput?.() || formats.part;
            return formats[holdsPart(host) ? 'part' : 'whole'];
        };
        const publish = async (id: string, operation: () => Promise<void>) => {
            const finish = entry()?.prepareApply();
            try {
                await operation();
                if (component && !this._destroyed)
                    await this.markedTextareaReflectors.get(component)?.(id);
            } finally {
                if (typeof finish === 'function') finish();
            }
        };
        return {
            schemeId: engine.getSchemeMeta().id,
            get scheme() {
                return engine.getScheme();
            },
            scope: host.getAttribute('data-ezclassify-scope') ?? undefined,
            get formatId() {
                return outputFormat();
            },
            read: (marking) =>
                engine.validate(
                    marking,
                    partsOption(
                        controller !== 'marked-input' &&
                            controller !== 'marked-textarea'
                            ? () => this.partMarkingsOf(associatedId)
                            : undefined,
                        { outputFormat: outputFormat() },
                    ),
                ),
            applyPreset: (presetId) =>
                engine.applyPreset(presetId, { outputFormat: outputFormat() }),
            getCurrent: () => {
                const id = targetId();
                if (!id) return { rendered: '', valid: false };
                const state = this.store.get(id);
                return {
                    rendered: state.rendered,
                    valid: state.valid && state.assertions.length > 0,
                };
            },
            onApply: (marking, signal) => {
                if (this._destroyed || signal.aborted) return;
                const id = targetId();
                if (!id) return;
                return publish(id, () =>
                    this.store.publishRendered(id, marking),
                );
            },
            applyFix: (fix, signal) => {
                if (this._destroyed || signal.aborted) return;
                const id = targetId();
                if (!id) return;
                const categories = [
                    ...new Set(
                        [...fix.adds, ...fix.removes].map(
                            ({ categoryId }) => categoryId,
                        ),
                    ),
                ];
                if (!categories.length) return;
                return publish(id, () => {
                    const current = this.store.get(id).assertions;
                    const kept = new Map(
                        current.map((fact) => [assertionFactKey(fact), fact]),
                    );
                    const facts = fixAssertions(fix, current).map(
                        (fact) => kept.get(assertionFactKey(fact)) ?? fact,
                    );
                    return this.store.publishAssertions(id, facts, undefined, {
                        categories,
                    });
                });
            },
        };
    }

    /**
     * Wire a plain input that holds or views a marking without a controller.
     * When `storeBinding` is provided the input participates in a named marking
     * via the store (publishes on commit, reflects sibling view commits back
     * in).
     */
    private attachPlainInputBehavior(
        input: HTMLInputElement,
        binding: BehaviorBinding,
        storeBinding?: StoreBinding | null,
        statusWrap?: HTMLElement,
    ): void {
        if (this.plainBehaviorCleanups.has(input)) return;
        if (
            input.type === 'hidden' ||
            input.type === 'checkbox' ||
            input.type === 'radio'
        )
            return;

        // Per-input render-format override. When absent `fmt` is the format
        // the store writes the marking's `rendered` in: the part default for an
        // input that shows a part, `this.defaultFormat` for any other. When
        // present (e.g. a part editor bound to a marking whose scheme default
        // is the whole/banner form), the input both commits and reflects
        // sibling commits in this format. An input bound to a marking shows the
        // store's committed state, so its spelling is resolved to the output
        // the store's publishes can write.
        const formats = this.formatsOf(input);
        const renderedIn = holdsPart(input) ? formats.part : formats.whole;
        const spelled = resolveFormatAttr(input) || renderedIn;
        const output = storeBinding
            ? this.outputNamed(input, spelled)
            : undefined;
        const fmt = output ?? spelled;
        // While this input commits, the store's answer to its own publish is
        // painted by the commit, which announces it the way a host form expects.
        let commitsInFlight = 0;
        let toolsHeld = false;
        let disposed = false;

        /**
         * A committed state as this input shows it: the state's own rendering
         * in the format it is written in, and for any other the output the
         * publish wrote. Undefined where the state holds no write of it: a
         * rollup, a commit from before this input asked for it, or a spelling
         * only the engine can resolve.
         */
        const writtenIn = (
            s: EzClassifyState,
        ):
            | (Pick<RenderResult, 'rendered'> & {
                  assessment?: RenderAssessment;
              })
            | undefined =>
            fmt === renderedIn
                ? { rendered: s.rendered, assessment: s.assessment }
                : s.renders[fmt];
        /** The scheme view of the Context this input resolves. */
        const engineOf = () =>
            schemeEngineOf(this.resolveContext(input), input);
        /** Write a committed state's facts in this input's format. */
        const writeFacts = async (s: EzClassifyState): Promise<RenderResult> =>
            engineOf().render(s.assertions, fmt);
        /** Project committed state without publishing native text. */
        const readCommittedState = async (sb: StoreBinding) => {
            const committed = this.store.get(sb.markingId);
            const written =
                writtenIn(committed) ?? (await writeFacts(committed));
            return {
                ...written,
                assertions: committed.assertions,
                valid: committed.valid,
                errors: committed.errors,
            };
        };
        /**
         * Commit typed text as the marking's state: one publish, which is the
         * read every view of the marking shares, then that state as this input
         * shows it. Text the input already shows from the store is that state's
         * own writing, so leaving the field unchanged reads nothing.
         */
        const commitThroughStore = async (sb: StoreBinding, raw: string) => {
            if (raw !== sb.lastSeenRendered) {
                commitsInFlight += 1;
                try {
                    await this.store.publishRendered(
                        sb.markingId,
                        raw,
                        sb.token,
                    );
                } finally {
                    commitsInFlight -= 1;
                }
            }
            return readCommittedState(sb);
        };

        const processText = (text: string) =>
            engineOf().process(text, { outputFormat: fmt });

        const paintResult = async (
            raw: string,
            result:
                | Awaited<ReturnType<typeof commitThroughStore>>
                | Awaited<ReturnType<typeof processText>>,
        ): Promise<void> => {
            // A refused projection is the opaque marker and nothing else, so
            // writing it here would replace the author's own text with a
            // marker and then report the field as holding a marking it does
            // not hold. Leave the typed text alone and say why it could not be
            // written, the way every other path that paints a render does.
            if (renderViewRefused(result)) {
                this.fieldAssertions.set(
                    input,
                    state.toFieldAssertions(result.assertions),
                );
                this.setPlainInputValidation(input, false, [
                    ...(result.errors ?? []).map((error) => error.message),
                    ...renderViewRefusalMessages(fmt, result),
                ]);
                return;
            }
            const rendered = storeBinding
                ? result.rendered
                : acceptedValue(raw, result);
            // Host Form Contract: rewriting the value on commit must emit the
            // field's normal bubbling input event (guarded by settingValue so
            // component-side listeners ignore the self-dispatch). Unchanged
            // value: no write, no event.
            if (input.value !== rendered) {
                this.settingValue = true;
                input.value = rendered;
                input.dispatchEvent(new Event('input', { bubbles: true }));
                this.settingValue = false;
            }
            this.fieldAssertions.set(
                input,
                state.toFieldAssertions(result.assertions),
            );
            this.lastValidated.set(input, rendered);
            if (storeBinding) storeBinding.lastSeenRendered = rendered;
            this.setPlainInputValidation(
                input,
                result.valid,
                (result.errors ?? []).map((error) => error.message),
            );
            await rollup.updateRollup(this);
            input.dispatchEvent(
                new CustomEvent('ezclassify:change', {
                    bubbles: true,
                    detail: {
                        assertions: result.assertions,
                        rendered,
                    },
                }),
            );
        };

        const commitValue = async (): Promise<void> => {
            const raw = input.value;
            if (!raw.trim()) {
                this.fieldAssertions.delete(input);
                this.lastValidated.delete(input);
                this.setPlainInputValidation(input, true, []);
                await rollup.updateRollup(this);
                input.dispatchEvent(
                    new CustomEvent('ezclassify:change', {
                        bubbles: true,
                        detail: {
                            assertions: [],
                            rendered: '',
                        },
                    }),
                );
                if (storeBinding) storeBinding.publish([], '');
                return;
            }

            // Either way `rendered` is written in `fmt`, and its own assessment
            // says whether that write was refused.
            const result = storeBinding
                ? await commitThroughStore(storeBinding, raw)
                : await Promise.resolve(
                      judgedAsHeld(raw, processText(raw), (settled) =>
                          processText(settled.rendered),
                      ),
                  );
            await paintResult(raw, result);
        };

        const mark = statusWrap
            ? ensureStatusMark(statusWrap, {
                  shape: 'input',
                  tools: true,
                  keyboardRoot: statusWrap,
                  root: this.root,
                  onToolsOpen: () => {
                      toolsHeld = true;
                  },
              })
            : null;
        const releaseLock = mark
            ? observeNativeLock(input, (locked) => {
                  (mark as HTMLButtonElement).disabled = locked;
                  if (locked) dismissStatusMarkPopover(mark);
              })
            : undefined;
        const releaseTextEdges =
            statusWrap && mark
                ? bindTextToolsEdges(
                      statusWrap,
                      () => input,
                      () => mark,
                  )
                : undefined;
        const target = storeBinding
            ? this.createMarkingTarget(input, storeBinding.markingId)
            : null;
        const favorites =
            statusWrap && target
                ? ensureMarkingFavorites(statusWrap, {
                      root: this.root,
                      config: this.favorites,
                      ...target,
                      onApply: async (marking, signal) => {
                          if (
                              disposed ||
                              signal.aborted ||
                              input.matches(':disabled, [readonly]')
                          )
                              return;
                          if (!storeBinding) return;
                          toolsHeld = false;
                          // Retire the previous projection before publishing;
                          // a later commit may legitimately restore that value.
                          storeBinding.viewRequest += 1;
                          storeBinding.lastSeenViewSignature = '';
                          commitsInFlight += 1;
                          try {
                              await target.onApply(marking, signal);
                          } finally {
                              commitsInFlight -= 1;
                          }
                          if (disposed || signal.aborted) return;
                          const viewRequest = ++storeBinding.viewRequest;
                          const result = await readCommittedState(storeBinding);
                          if (
                              disposed ||
                              signal.aborted ||
                              viewRequest !== storeBinding.viewRequest
                          )
                              return;
                          await paintResult(marking, result);
                      },
                      focusField: () => input.focus(),
                  })
                : null;
        const handleBlur = (event: FocusEvent) => {
            if (
                event.relatedTarget instanceof Node &&
                statusMarkOwnsNode(mark, event.relatedTarget)
            ) {
                toolsHeld = true;
                return;
            }
            if (toolsHeld && !event.relatedTarget) return;
            toolsHeld = false;
            void commitValue();
        };
        const resumeDraft = () => {
            toolsHeld = false;
        };
        const leaveTools = () => {
            if (!toolsHeld) return;
            // Closing the dialog restores its branding button synchronously.
            // Only the completed focus move decides whether the author left.
            queueMicrotask(() => {
                if (disposed || !toolsHeld) return;
                const active = input.ownerDocument.activeElement;
                if (
                    active === input ||
                    (active && statusMarkOwnsNode(mark, active))
                )
                    return;
                toolsHeld = false;
                void commitValue();
            });
        };
        input.addEventListener('blur', handleBlur);
        input.addEventListener('focus', resumeDraft);
        input.ownerDocument.addEventListener('focusout', leaveTools);
        let storeUnsub: (() => void) | undefined;
        if (storeBinding) {
            // Reflect commits from other views (tag inputs, etc.) back into the input.
            const applyState = (s: EzClassifyState) => {
                if (
                    commitsInFlight > 0 ||
                    (toolsHeld && input.value !== storeBinding.lastSeenRendered)
                )
                    return;
                const sourceErrors = s.errors.map((error) => error.message);
                // An empty canonical view can still have a nonempty alternate.
                // Only a genuinely empty store bypasses format selection.
                const emptyState =
                    !s.rendered &&
                    s.assertions.length === 0 &&
                    Object.keys(s.renders).length === 0;
                if (!fmt || fmt === renderedIn || emptyState) {
                    // `rendered` carries its own assessment: whether writing
                    // it was refused is said there, with no output named.
                    const refused = renderViewRefused(s);
                    const errors = [
                        ...sourceErrors,
                        ...renderViewRefusalMessages(fmt || renderedIn, s),
                    ];
                    const signature = JSON.stringify({
                        rendered: s.rendered,
                        valid: s.valid,
                        errors,
                        assessment: s.assessment,
                    });
                    if (signature === storeBinding.lastSeenViewSignature)
                        return;
                    storeBinding.viewRequest += 1;
                    storeBinding.lastSeenRendered = s.rendered;
                    storeBinding.lastSeenViewSignature = signature;
                    this.setPlainInputValidation(
                        input,
                        s.valid && !refused,
                        errors,
                    );
                    if (!refused && input.value !== s.rendered)
                        input.value = s.rendered;
                    return;
                }
                // The publish that committed this state wrote the output this
                // input asked the store for. Select that render directly:
                // reprocessing the canonical string would discard typed
                // assertion values and repeat a potentially remote operation
                // for every bound field.
                const view = s.renders[fmt];
                if (!view) {
                    // No write of this output in the state: write it from the
                    // facts instead.
                    const unwrittenSignature = JSON.stringify({
                        format: fmt,
                        assertions: signAssertions(s.assertions),
                        valid: s.valid,
                        errors: sourceErrors,
                    });
                    if (
                        unwrittenSignature ===
                        storeBinding.lastSeenViewSignature
                    )
                        return;
                    storeBinding.lastSeenViewSignature = unwrittenSignature;
                    const viewRequest = ++storeBinding.viewRequest;
                    void Promise.resolve()
                        .then(() => writeFacts(s))
                        .then(
                            (written) => {
                                if (viewRequest !== storeBinding.viewRequest)
                                    return;
                                if (renderViewRefused(written)) {
                                    this.setPlainInputValidation(input, false, [
                                        ...sourceErrors,
                                        ...renderViewRefusalMessages(
                                            fmt,
                                            written,
                                        ),
                                    ]);
                                    return;
                                }
                                storeBinding.lastSeenRendered =
                                    written.rendered;
                                this.setPlainInputValidation(
                                    input,
                                    s.valid,
                                    sourceErrors,
                                );
                                if (input.value !== written.rendered)
                                    input.value = written.rendered;
                            },
                            () => {
                                if (viewRequest !== storeBinding.viewRequest)
                                    return;
                                this.setPlainInputValidation(input, false, [
                                    `Format "${fmt}" is unavailable.`,
                                ]);
                            },
                        );
                    return;
                }
                const signature = JSON.stringify({
                    view: renderViewSignature(view),
                    valid: s.valid,
                    errors: sourceErrors,
                });
                if (signature === storeBinding.lastSeenViewSignature) return;
                storeBinding.lastSeenViewSignature = signature;
                storeBinding.viewRequest += 1;
                if (renderViewRefused(view)) {
                    this.setPlainInputValidation(input, false, [
                        ...sourceErrors,
                        ...renderViewRefusalMessages(fmt, view),
                    ]);
                    return;
                }
                storeBinding.lastSeenRendered = view.rendered;
                this.setPlainInputValidation(input, s.valid, sourceErrors);
                if (input.value !== view.rendered) input.value = view.rendered;
            };
            // An input that shows the marking in an output of its own asks the
            // store for it, so each publish writes it in the same call.
            const releaseOutput =
                output && output !== renderedIn
                    ? this.store.requestOutput(storeBinding.markingId, output)
                    : undefined;
            const unsubscribe = this.store.subscribe(
                storeBinding.markingId,
                applyState,
                storeBinding.token,
            );
            storeUnsub = () => {
                unsubscribe();
                releaseOutput?.();
            };
            // A subscription only delivers FUTURE commits, so a plain input
            // mounted after its marking was published would paint empty against
            // populated state. Same hydrate-at-mount step the component and
            // marked-input store wirings run.
            this.hydrateFromStore(storeBinding.markingId, applyState);
        }

        this.plainBehaviorCleanups.set(input, () => {
            if (storeBinding) storeBinding.viewRequest += 1;
            disposed = true;
            releaseTextEdges?.();
            releaseLock?.();
            favorites?.destroy();
            if (mark) dismissStatusMarkPopover(mark);
            input.removeEventListener('blur', handleBlur);
            input.removeEventListener('focus', resumeDraft);
            input.ownerDocument.removeEventListener('focusout', leaveTools);
            storeUnsub?.();
        });
    }

    /**
     * The output the store's scheme lists under a field's format spelling (see
     * {@link resolveOutput}), the one a publish can name and `renders` keys.
     * Undefined for a spelling only the engine can resolve, such as a format
     * that is one of a view's forms: such a field writes the committed facts
     * itself.
     *
     * @param el - The field, whose Context's scheme lists the outputs
     * @param spelling - The format the field names
     */
    private outputNamed(el: HTMLElement, spelling: string): string | undefined {
        const meta = schemeEngineOf(
            this.resolveContext(el),
            el,
        ).getSchemeMeta();
        const outputs = meta.formats ?? [];
        return resolveOutput(
            outputs,
            spelling,
            defaultSurfaceOf(outputs, meta.defaultRenderFormat),
        );
    }

    private setPlainInputValidation(
        input: HTMLInputElement,
        valid: boolean,
        _errors: string[],
    ): void {
        const container = input.parentElement;
        if (container?.classList.contains('ez-plain-field-wrap'))
            setStatusMarkError(
                container,
                valid
                    ? null
                    : _errors.filter(Boolean).join('\n') ||
                          'This marking is invalid.',
            );
        if (valid) {
            container?.removeAttribute('data-ezclassify-invalid');
            input.removeAttribute('aria-invalid');
            input.setCustomValidity('');
            return;
        }
        container?.setAttribute('data-ezclassify-invalid', '');
        input.setAttribute('aria-invalid', 'true');
        input.setCustomValidity(
            _errors.filter(Boolean).join('\n') || 'This marking is invalid.',
        );
    }

    /**
     * Log a component init() rejection instead of silently discarding it. Every
     * `component.init()` call below is wrapped in `.catch()` so one
     * misconfigured field can never take down the scanner's pass over the rest
     * of the page. Logging keeps that failure visible: without it, the host
     * stays a plain native `<input>`/`<textarea>` with no indication of why,
     * for example a marking controller on an unsupported native field type.
     */
    private logInitFailure(
        el: HTMLElement,
        controller: ControllerName,
        err: unknown,
    ): void {
        const message = err instanceof Error ? err.message : String(err);
        console.error(
            `[ezclassify] "${controller}" failed to mount on`,
            el,
            `-- the field is left unenhanced (native element only). ${message}`,
        );
    }

    /**
     * Before a field goes away, put the marking its uncommitted draft reads to
     * into the marking host it is bound to. Whatever reads that host next (a
     * runtime rebuilt in the same turn, a form submit) gets that marking
     * instead of the one before it. Only a draft that reads completely is kept,
     * as its reading's rendering (see ComponentInstance.pendingDraft): typed
     * text the engine has not accepted never lands in the host. The field still
     * commits the draft through its own path on the way out (see
     * teardown-write.ts); this keeps it when the store it would commit to is
     * being torn down with it.
     */
    private keepDraft(c: object): void {
        const markingId = this.draftHosts.get(c);
        if (!markingId) return;
        const draft = (c as ComponentInstance).pendingDraft?.();
        if (draft == null) return;
        const host = this.root.ownerDocument.getElementById(markingId);
        if (host && 'value' in host) (host as HTMLInputElement).value = draft;
    }

    /**
     * Destroy one component, isolating a throw so it can't abort the rest of
     * `destroy()`'s teardown loop. A component whose init() rejected (see
     * {@link logInitFailure}) never finished setting up its own fields
     * (wrap/footer/chrome slots), so a bare `c.destroy()` on it throws, and
     * `Map.forEach`/`Array.forEach` stop dead on the first throwing callback,
     * silently skipping every component still left to tear down and leaking
     * their listeners/observers for the page's lifetime. This is the exact "one
     * bad field can't take the rest of the page down" guarantee `attachView`'s
     * init `.catch()` already gives on mount, applied symmetrically on
     * unmount.
     */
    private destroySafely(c: { destroy(): void }): void {
        this.keepDraft(c);
        try {
            c.destroy();
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            console.error(
                '[ezclassify] a component threw during destroy(); skipping it and continuing teardown.',
                message,
            );
        }
    }

    /**
     * Whether a view's facts include one of a scope other than the scheme's
     * default, by the scope its category belongs to.
     *
     * @param el - The view's host
     * @param assertions - The facts the view publishes
     */
    private statesOtherScopes(
        el: HTMLElement,
        assertions: readonly EngineAssertion[],
    ): boolean {
        if (assertions.length === 0) return false;
        const engine = schemeEngineOf(this.resolveContext(el), el);
        const meta = engine.getSchemeMeta();
        if (!meta.defaultScope) return false;
        return reachesPastScopes(
            assertions,
            engine.listCategories(),
            [meta.defaultScope],
            meta,
        );
    }

    /**
     * The facts of a marking a component shows: those of the scopes it writes,
     * the scheme's default scope when it lists none. A scheme with no default
     * scope writes its marking whole, so every fact is shown.
     *
     * @param el - The component's host
     * @param assertions - The marking's facts
     */
    private factsOfOwnScopes(
        el: HTMLElement,
        assertions: readonly EngineAssertion[],
    ): EngineAssertion[] {
        if (assertions.length === 0) return [];
        const engine = schemeEngineOf(this.resolveContext(el), el);
        return factsOfScopeSet(
            assertions,
            this.viewScopes(el),
            engine.listCategories(),
            engine.getSchemeMeta(),
        );
    }

    /**
     * The categories a view writes: those of the scopes it lists, the scheme's
     * default scope when it lists none, every category when the scheme declares
     * no scopes.
     *
     * @param el - The view's host
     */
    private categoriesWritten(el: HTMLElement): string[] {
        const engine = schemeEngineOf(this.resolveContext(el), el);
        const categories = engine.listCategories();
        const writes = writesCategoryOf(
            this.viewScopes(el),
            categories,
            engine.getSchemeMeta(),
        );
        return categories
            .map((category) => category.id)
            .filter((id) => writes(id));
    }

    /**
     * Whether a view writes scopes other than the scheme's default scope alone,
     * so its text is not the marking's default-scope text.
     *
     * @param el - The view's host
     */
    private writesPastDefaultScope(el: HTMLElement): boolean {
        const listed = this.viewScopes(el);
        if (listed.length === 0) return false;
        const meta = schemeEngineOf(
            this.resolveContext(el),
            el,
        ).getSchemeMeta();
        return listed.length > 1 || listed[0] !== meta.defaultScope;
    }

    /**
     * The facts a view's publish leaves in the store: the held facts of the
     * scopes it does not write, which its own facts cannot state (see
     * {@link factsOutsideScopes}).
     *
     * @param el - The view's host
     * @param held - The marking's facts in the store
     * @param own - The facts the view publishes
     */
    private factsOfOtherScopes(
        el: HTMLElement,
        held: readonly EngineAssertion[],
        own: readonly EngineAssertion[],
    ): EngineAssertion[] {
        if (held.length === 0) return [];
        const engine = schemeEngineOf(this.resolveContext(el), el);
        const meta = engine.getSchemeMeta();
        return factsOutsideScopes(
            held,
            own,
            engine.listCategories(),
            scopeSetOf(this.viewScopes(el), meta),
            meta,
        );
    }

    /**
     * A view's marking as the scopes it names write it: the facts that belong
     * to those scopes, written in the output of the first of them in the
     * scheme's declaration order, the view's own `data-ezclassify-format` when
     * it names one. A marking spans its scopes, and the text a view of one
     * scope reads is that scope's own surface, not the marking's whole text: an
     * authority view shows the authority block, not the classification line
     * beside it. Empty when no fact belongs to the named scopes.
     *
     * @param el - The view's host
     * @param assertions - The marking's facts
     * @param scopes - The scope ids the view names
     * @returns The text the view shows, or null when the facts of the scopes
     *   could not be written (see `writeFactsInScopes`)
     */
    private writeInScopes(
        el: HTMLElement,
        assertions: readonly EngineAssertion[],
        scopes: readonly string[],
    ): Promise<string | null> {
        return writeFactsInScopes(
            schemeEngineOf(this.resolveContext(el), el),
            assertions,
            scopes,
            resolveFormatAttr(el),
            holdsPart(el),
        );
    }

    /**
     * One bucket of a level view's marking as the scopes the view names write
     * it, in that bucket's own scheme (see {@link writeInScopes}). The view's
     * `data-ezclassify-format` applies to a bucket whose scheme lists that
     * output; another bucket takes its own scheme's default for the scopes.
     * Null, as for a write that fails, for a bucket with facts whose scheme no
     * longer resolves.
     *
     * @param el - The view's host
     * @param bucket - The bucket
     * @param assertions - The bucket's facts
     * @param scopes - The scope ids the view names
     */
    private writeBucketInScopes(
        el: HTMLElement,
        bucket: BucketKey,
        assertions: readonly EngineAssertion[],
        scopes: readonly string[],
    ): Promise<string | null> {
        const engine = this.bucketEngine(bucket);
        if (!engine) return Promise.resolve(assertions.length > 0 ? null : '');
        const meta = engine.getSchemeMeta();
        const format = resolveFormatAttr(el);
        const listed =
            format &&
            resolveOutput(
                meta.formats ?? [],
                format,
                inDeclarationOrder(scopes, meta)[0],
            ) !== undefined;
        return writeFactsInScopes(
            engine,
            assertions,
            scopes,
            listed ? format : null,
            false,
        );
    }

    /**
     * Warn when a control names only scopes its category does not belong to.
     *
     * `data-ezclassify-scope` on a control says which scope the author means
     * that control to author in. It is not what routes the assertions: the
     * store reads scope membership from the loaded scheme, through
     * `getSchemeMeta().defaultScope` and each category's declared `scopes`. The
     * two are normally the same answer, and when they are not the failure is
     * silent and expensive. A category the scheme reports as default-scope has
     * its assertions run through the whole-marking render format, and a format
     * that excludes that category renders them to nothing, so they never reach
     * the marking's committed state and no subscriber ever sees them. The
     * control looks like it published and nothing happened.
     *
     * That is worth saying out loud, because the two ways to get here are a
     * typo in the attribute and a scheme projection that reached the client
     * without its scope data, and neither is discoverable from the symptom.
     * Warn-once per element, like the scanner's own advisories.
     *
     * @param el - The control host being enhanced.
     * @param opts - Its parsed options, carrying the listed scopes and the
     *   category.
     */
    private warnOnScopeMismatch(
        el: HTMLElement,
        opts: Record<string, unknown>,
    ): void {
        const listed = Array.isArray(opts.scopes)
            ? (opts.scopes as string[])
            : [];
        const categoryId = opts.categoryId;
        if (listed.length === 0) return;
        if (typeof categoryId !== 'string' || !categoryId) return;
        if (warnedScopeMismatch.has(el)) return;

        const engine = schemeEngineOf(this.resolveContext(el), el);
        const category = engine
            .listCategories()
            .find((c) => c.id === categoryId);
        // An unknown category is a different mistake, and the components report
        // it themselves with better context than this could.
        if (!category) return;
        const defaultScope = engine.getSchemeMeta().defaultScope;
        if (
            listed.some(
                (scope) =>
                    category.scopes?.includes(scope) || scope === defaultScope,
            )
        )
            return;

        warnedScopeMismatch.add(el);
        console.warn(
            `[ezclassify] control declares data-ezclassify-scope="${listed.join(' ')}" for ` +
                `category "${categoryId}", but the loaded scheme reports that category in ` +
                `${category.scopes?.length ? `scope(s) ${category.scopes.join(', ')}` : 'no scope of its own'}. ` +
                'Scope routing follows the scheme, not this attribute, so assertions from this ' +
                'control are treated as default-scope: if the whole-marking render format excludes ' +
                `"${categoryId}" they render to nothing and never reach committed state, and a ` +
                'store subscriber will never see them. Check the attribute spelling, and check that ' +
                'the scheme this runtime served carries its scope declarations.',
        );
    }

    /**
     * View pass: instantiate the appropriate component for the controller,
     * create its mount container, and wire onChange callbacks. Called after
     * `bindBehavior` so the behavior layer is already in place.
     */
    /**
     * Mount a `data-ezclassify-translate` view: the marking it shows (its
     * `source`) or the level it shows (its `aggregate`), in the bucket the view
     * resolves, translated through the crosswalk it names. A view never
     * contributes. Markup it refuses (a form control or controller host, no
     * Context, no crosswalk to use) is a host error.
     */
    private attachTranslatedView(el: HTMLElement): void {
        if (this.hostErrors.has(el) || this.mounted.has(el)) return;
        const owner = getMountOwner(el);
        if (owner && owner !== this._instanceId) return;
        const resolved = this.contextForMount(el);
        if (!resolved) return;
        setMountOwner(el, this._instanceId);
        const component = createHostComponent(el, null) as TranslatedView;
        const container = createMountContainer(el, null);
        this.mounted.set(el, component);
        const show = (s: EzClassifyState) => {
            component.setIncomplete(s.stale === true);
            component.setAssertions(s.assertions);
        };
        const wire = () => {
            if (this._destroyed || this.mounted.get(el) !== component) return;
            if (el.hasAttribute('data-ezclassify-aggregate')) {
                const raw =
                    el.getAttribute('data-ezclassify-aggregate')?.trim() ?? '';
                const levelId = (raw === 'true' ? '' : raw) || undefined;
                const apply = (aggregate: EzClassifyAggregate) =>
                    show(
                        aggregate.byBucket.get(resolved.bucket) ?? {
                            ...EMPTY_EZCLASSIFY_STATE,
                        },
                    );
                this.storeUnsubscribers.set(
                    el,
                    this.store.subscribeAggregate(apply, levelId),
                );
                apply(this.store.getAggregate(levelId));
                return;
            }
            const source = el.getAttribute('data-ezclassify-source');
            if (source && this.validMarkingIds.has(source)) {
                this.storeUnsubscribers.set(
                    el,
                    this.store.subscribe(source, show),
                );
                show(this.store.get(source));
            }
        };
        const init = component
            .init(container, resolved.context, {
                schemeSelector: resolved.primary
                    ? undefined
                    : resolved.schemeSelector,
            })
            .then(wire)
            .catch((err: unknown) => {
                if (!(err instanceof TranslateHostError)) {
                    console.error(
                        '[ezclassify] A translated view failed to mount on',
                        el,
                        err,
                    );
                    return;
                }
                this.mounted.delete(el);
                this.destroySafely(component);
                this.reportHostError(
                    {
                        code: 'translate-refused',
                        message: `[ezclassify] ${err.message}`,
                        element: el,
                    },
                    null,
                );
            });
        this._pendingInits.push(init);
    }

    private invalidateDecisionFlow(el: HTMLElement): void {
        const group = [...this.decisionFlowForms.values()].find(
            ({ natives, whole }) =>
                el.contains(whole) ||
                natives.some((native) => el.contains(native)),
        );
        if (!group) return;
        this.teardownElement(group.natives[0]);
        queueMicrotask(() => {
            if (this._destroyed) return;
            for (const native of group.natives) {
                if (
                    this.root.contains(native) &&
                    native.getAttribute('data-ezclassify-controller') ===
                        'decisionflow'
                )
                    this.attachView(
                        native,
                        'decisionflow',
                        harvestControllerOptions(native, 'decisionflow'),
                    );
            }
            this.wireHostWriteback();
        });
    }

    private scopedFlowFields(
        el: HTMLElement,
        markingId: string,
    ): NativeTextField[] {
        if (
            !isNativeTextField(el) ||
            !el.hasAttribute(DECISION_FLOW_COMBINE) ||
            !this.markingHosts.has(markingId)
        )
            return [];
        const selector = `[data-ezclassify-controller="decisionflow"][${DECISION_FLOW_COMBINE}][data-ezclassify-bound-to="${cssEscape(markingId)}"]`;
        return Array.from(this.root.querySelectorAll(selector)).filter(
            (candidate): candidate is NativeTextField =>
                isNativeTextField(candidate) &&
                isOwnedBy(candidate, this._instanceId) &&
                !this.nodeOf(candidate).error &&
                candidate.form === el.form &&
                parseScopeList(candidate.getAttribute('data-ezclassify-scope'))
                    .length === 1,
        );
    }

    private viewScopes(el: HTMLElement): string[] {
        const group =
            el.getAttribute('data-ezclassify-controller') === 'decisionflow'
                ? this.decisionFlowForms.get(
                      el.getAttribute('data-ezclassify-bound-to') ?? '',
                  )
                : undefined;
        return group?.natives[0] === el
            ? group.scopes
            : parseScopeList(el.getAttribute('data-ezclassify-scope'));
    }

    private wireDirectDecisionFlow(
        native: NativeTextField,
        component: ComponentInstance,
        mount: HTMLElement,
    ): void {
        const display = native.style.display;
        native.style.display = 'none';
        const read = () => {
            if (!this.settingValue) void component.setValue(native.value);
        };
        const reset = (event: Event) => {
            queueMicrotask(() => {
                if (
                    !event.defaultPrevented &&
                    this.mounted.get(native) === component
                )
                    read();
            });
        };
        native.addEventListener('input', read);
        const form = native.form;
        form?.addEventListener('reset', reset);
        this.plainBehaviorCleanups.set(native, () => {
            native.removeEventListener('input', read);
            form?.removeEventListener('reset', reset);
            native.style.display = display;
            mount.remove();
        });
    }

    private attachView(
        el: HTMLElement,
        controller: ControllerName,
        rawOptions: Record<string, string>,
    ): void {
        // Markup the binding model refused stays unenhanced.
        if (this.hostErrors.has(el)) return;
        // A translated view mounts on the behavior pass, whatever controller
        // its host also names (the view refuses one as a host error).
        if (isTranslatedView(el)) return;
        // Defense-in-depth claim guard (non-optional): if this host is already
        // owned by a DIFFERENT live instance, do not re-enhance it. The scanner
        // boundary is the primary defense; this guards the residual races (a stale
        // marker mid-reclaim, a duplicate emit). Same-instance re-enhancement is
        // handled by the dedup guards below.
        const currentOwner = getMountOwner(el);
        if (currentOwner && currentOwner !== this._instanceId) return;

        // The Context the component marks with, from the nearest
        // `data-ezclassify-context` (or the only Context) and the nearest
        // `data-ezclassify-scheme` (or the primary scheme). An element that
        // resolves none stays unenhanced as a host error. A reference drawer
        // shows every Context the instance holds and marks in none, so it
        // resolves no Context of its own.
        if (
            controller === 'select' &&
            el.tagName === 'SELECT' &&
            !isNativeSingleSelect(el)
        ) {
            this.logInitFailure(
                el,
                controller,
                new Error(
                    'Use a single-value select for the dropdown controller.',
                ),
            );
            return;
        }
        const wholeIdForFlow =
            controller === 'decisionflow'
                ? el.getAttribute('data-ezclassify-bound-to')
                : null;
        let flowForm: DecisionFlowForm | undefined;
        if (wholeIdForFlow) {
            const natives = this.scopedFlowFields(el, wholeIdForFlow);
            if (natives.length > 1) {
                const lead = natives[0];
                const existing = this.decisionFlowForms.get(wholeIdForFlow);
                if (
                    existing &&
                    existing.natives.length === natives.length &&
                    existing.natives.every(
                        (native, index) => native === natives[index],
                    )
                )
                    return;
                if (existing) this.teardownElement(existing.natives[0]);
                for (const native of natives) {
                    if (this.mounted.has(native)) this.teardownElement(native);
                }
                if (lead !== el) {
                    this.attachView(
                        lead,
                        controller,
                        harvestControllerOptions(lead, controller),
                    );
                    return;
                }
                const whole = this.markingHosts.get(wholeIdForFlow);
                const resolvedWhole =
                    whole instanceof HTMLElement
                        ? this.contextForMount(whole)
                        : null;
                try {
                    if (
                        !(whole instanceof HTMLInputElement) ||
                        whole.type !== 'hidden' ||
                        whole.hasAttribute('data-ezclassify-controller') ||
                        !resolvedWhole ||
                        natives.some(
                            (native) =>
                                this.contextForMount(native)?.bucket !==
                                resolvedWhole.bucket,
                        )
                    )
                        throw new Error(
                            'Scoped DecisionFlow fields must share a hidden whole in the same Context and scheme.',
                        );
                    flowForm = new DecisionFlowForm(
                        natives,
                        whole,
                        schemeEngineOf(resolvedWhole, whole),
                        this.store,
                    );
                } catch (error) {
                    this.logInitFailure(el, controller, error);
                    return;
                }
            }
        }
        if (this.mounted.has(el)) return;
        const drawer = controller === 'context-reference';
        const resolved = drawer ? null : this.contextForMount(el);
        if (!drawer && !resolved) return;

        // Skip duplicates
        if (controller === 'tags') {
            if (this.fields.includes(el as HTMLInputElement)) return;
            this.fields.push(el as HTMLInputElement);
        } else {
            if (this.mounted.has(el)) return;
        }

        // Record ownership so the claim guard and reclaim sweep on other instances
        // can see this host belongs to us.
        setMountOwner(el, this._instanceId);

        // A field that shows a part reads it as a part: the field names its whole
        // in `data-ezclassify-part-of`, or the host it is bound to or is a facet of does.
        const partOfId =
            this.partOfMap.get(el) ?? wholeOfShownMarking(el) ?? undefined;
        // `data-ezclassify-facet-of`: marks this picker as one category facet of a
        // larger marking; the field whose id is given holds the complete
        // marking. Facets don't carry their own validation surface; the
        // host renders validation once at the parent marking. The attribute's
        // mere presence suppresses this component's validation display; the
        // value is a forward hint to host code that wants to know which parent
        // marking these facets compose into.
        const facetOfId = el.getAttribute('data-ezclassify-facet-of');
        const boundToId = el.getAttribute('data-ezclassify-bound-to');

        // Marking-id this view binds through the store. `bound-to` means the
        // whole marking; `facet-of` means one category slice. Either resolves
        // to a marking host; if the host isn't present in the DOM
        // (free-floating hint), `storeBinding` stays null.
        //
        // Marking hosts are indexed before the view pass, including any source
        // view that precedes its control in DOM order.
        //
        // A controller that is a marking host (no bound-to / facet-of)
        // self-publishes under its own id. This is the path the MarkedTextArea
        // uses for its per-part hidden fields; each hidden box is a marking
        // object in its own right (binding-model §16), and its commits need to
        // land in the store so the levels above it pick them up. Marking
        // controllers take the same path without `data-ezclassify-marking`.
        const selfRenderedId =
            isMarkingHost(el) && el.id && this.validMarkingIds.has(el.id)
                ? el.id
                : undefined;
        const storeMarkingId = boundToId ?? facetOfId ?? selfRenderedId;
        const facetCategory = facetOfId
            ? (el.getAttribute('data-ezclassify-category') ?? undefined)
            : undefined;
        const storeEligible =
            !!storeMarkingId && this.validMarkingIds.has(storeMarkingId);
        let storeBinding =
            storeEligible &&
            !el.hasAttribute('data-marked-textarea-entry-managed')
                ? this.makeStoreBinding(
                      el,
                      storeMarkingId!,
                      !!facetOfId,
                      facetCategory,
                  )
                : null;
        const entryCollectionOnly =
            controller === 'marked-textarea' &&
            !storeBinding &&
            !!el.id &&
            !!(
                this.store.getEntryIds &&
                this.store.setEntryIds &&
                this.store.subscribeEntries
            );
        if (entryCollectionOnly)
            storeBinding = this.makeStoreBinding(el, el.id, false, undefined);
        // A MarkedTextArea part holds the assertions the field read and no
        // text of its own, so it publishes them as they are, from its first
        // change on, the way a MarkedInput does. Its rendering is one format's
        // spelling of those assertions, and a part written in another of the
        // scheme's formats (a short form the field read, say) need not read
        // back the same from it.
        if (
            storeBinding &&
            controller === 'hidden' &&
            !facetOfId &&
            el.hasAttribute('data-marked-textarea-field')
        ) {
            this.publishStructurally(storeBinding);
        } else if (storeBinding && controller === 'hidden' && !facetOfId) {
            this.publishUnwrittenFacts(storeBinding);
        }

        // Parse the harvested options bag into typed component options.
        const opts = parseComponentOptions(el, rawOptions);
        if (flowForm) {
            this.decisionFlowForms.set(wholeIdForFlow!, flowForm);
            opts.scopes = flowForm.scopes;
            opts.scope = undefined;
            opts.nativeFields = flowForm.natives;
        }
        this.warnOnScopeMismatch(el, opts);

        if (
            this.initializing &&
            facetOfId &&
            facetCategory &&
            storeBinding &&
            (controller === 'select' ||
                controller === 'selector' ||
                controller === 'checklist')
        )
            this.captureNativeFacet(el, facetOfId, facetCategory);

        // Resolve the native input element (source of truth)
        const category = el.getAttribute('data-ezclassify-category');
        const choiceGroup = category ? nativeChoiceGroup(el) : undefined;
        const nativeInput = resolveNativeInput(el, controller);

        // Create mount container
        const container = createMountContainer(el, controller);

        // onChange: write rendered value to the native input, trigger rollup,
        // and (when bound to a store-tracked marking) publish the new state so
        // sibling views naming the same marking-id stay in sync.
        const onChange = (assertions: EngineAssertion[], rendered: string) => {
            if (flowForm) {
                storeBinding?.publish(assertions, rendered);
                return;
            }
            if (controller === 'tags') {
                this.fieldAssertions.set(
                    nativeInput,
                    state.toFieldAssertions(assertions),
                );
                this.lastValidated.set(nativeInput, rendered);
            }
            if (choiceGroup) {
                writeNativeChoiceGroup(
                    el,
                    choiceGroup,
                    new Set(
                        assertions
                            .filter(
                                (assertion) =>
                                    assertion.categoryId === category,
                            )
                            .map((assertion) => assertion.conceptId),
                    ),
                );
            }
            if (
                !choiceGroup &&
                controller !== 'hidden' &&
                controller !== 'marked-textarea' &&
                controller !== 'marked-input' &&
                controller !== 'text' &&
                !(controller === 'select' && isNativeSingleSelect(el)) &&
                !component?.preservesNativeDraft &&
                nativeInput.value !== rendered
            ) {
                this.settingValue = true;
                nativeInput.value = rendered;
                nativeInput.dispatchEvent(
                    new Event('input', { bubbles: true }),
                );
                this.settingValue = false;
            }
            rollup.updateRollup(this);
            el.dispatchEvent(
                new CustomEvent('ezclassify:change', {
                    bubbles: true,
                    detail: { assertions, rendered },
                }),
            );
            // marked-textarea publishes from its own input listener; its
            // onChange args carry only embedded-part assertions, not the
            // whole-marking string the bound-to view publishes.
            if (storeBinding && controller !== 'marked-textarea') {
                storeBinding.publish(assertions, rendered);
            }
        };

        // Build component options with framework plumbing
        const componentOpts = buildComponentOptions(opts, {
            onChange,
            tooltipConceptProperty: this.tooltipConceptProperty,
            root: this.root,
            facetOf: facetOfId ?? undefined,
            colorMap:
                (opts.colorMap as
                    | import('./components/component-base').ComponentOptions['colorMap']
                    | undefined) ?? this.colorMap,
            favorites: this.favorites,
        });
        if (holdsPart(el)) componentOpts.holdsPart = true;

        // A field that holds a whole marking judges it against the parts that
        // name it: every process call carries their current markings (see
        // ComponentOptions.resolveParts). A facet is one category of a marking,
        // not the whole, so it never does.
        // A facet's composer judges its draft with what the rest of its
        // marking holds (see ComponentOptions.resolveFacetSiblings).
        if (facetOfId && facetCategory && storeEligible) {
            componentOpts.resolveFacetJudgment = () =>
                this.store.get(facetOfId);
            componentOpts.resolveFacetSiblings = () =>
                this.store
                    .get(facetOfId)
                    .assertions.filter((a) => a.categoryId !== facetCategory);
            // Named now: by the time a refusal is said, the Context may be gone.
            const writes =
                resolveFormatAttr(el) ||
                this.formatsOf(el)[holdsPart(el) ? 'part' : 'whole'];
            componentOpts.resolveFacetRefusal = () => {
                const held = this.store.get(facetOfId);
                return renderViewRefused(held) &&
                    this.facetSpeaksFor(el, facetOfId)
                    ? renderViewRefusalMessages(writes, held)
                    : [];
            };
        }

        const wholeId = facetOfId ? undefined : storeMarkingId;
        if (wholeId && storeEligible) {
            componentOpts.resolveParts = () => this.partMarkingsOf(wholeId);
        }

        // Part-of fields resolve their context dynamically (reads the whole's current value)
        if (partOfId) {
            componentOpts.resolveContext = (): {
                role: 'part';
                partOf?: { rendered: string };
            } => {
                const host = this.wholeHostText(partOfId);
                // A part refreshed by a store commit of its whole reads that
                // commit, not the host it has not reached yet, so every part
                // compares itself with the same whole whenever the whole's
                // field answers.
                const committed = this.wholeCommits.get(partOfId);
                const wholeRendered =
                    committed && committed.host === host
                        ? committed.rendered.trim()
                        : host;
                if (wholeRendered) {
                    return {
                        role: 'part',
                        partOf: { rendered: wholeRendered },
                    };
                }
                return { role: 'part' };
            };
        } else if (showsStandalonePart(el)) {
            // With no whole on the page, rules that ask about the whole stay
            // unresolved and the whole's own rules never judge the part.
            componentOpts.resolveContext = () => ({ role: 'part' });
        }

        // TagInput-specific options. The explicit render format is not among
        // them any more: `parseComponentOptions` reads
        // `data-ezclassify-format` off every controller host, so TagInput's own
        // whole-format resolution still applies when none is declared and every
        // other controller honors the attribute the same way.
        if (controller === 'tags') {
            // Category color coding is on by default; author opts out with
            // data-ezclassify-tags-color-coding="false".
            if ('color-coding' in rawOptions)
                componentOpts.colorCoding =
                    rawOptions['color-coding'] !== 'false';
        }

        // Marked-textarea specific options. Per binding-model §16, hidden part
        // markings are part-of the textarea's own marking (not the page rollup).
        // Resolve which marking the parts chain into, in priority order:
        //   1. data-ezclassify-bound-to=X: the textarea writes to X
        //   2. data-ezclassify-marking + el.id: the textarea IS marking el.id
        //   3. the whole it sits in (its `whole` container or `part-of`): the
        //      textarea is a pass-through to that whole (it isn't itself a
        //      marking host), so parts chain straight up to it. Without this,
        //      its parts would route to its DOM id, leaving the whole's rollup
        //      empty.
        //   4. el.id: fallback for parts that
        //      have no declared parent.
        if (controller === 'marked-textarea') {
            componentOpts.entryStoreManaged =
                !!storeBinding &&
                !!(
                    this.store.getEntryIds &&
                    this.store.setEntryIds &&
                    this.store.subscribeEntries
                );
            const textareaMarkingId =
                el.getAttribute('data-ezclassify-bound-to') ||
                (isMarkingHost(el) ? el.id : undefined) ||
                partOfId ||
                el.id;
            if (textareaMarkingId) componentOpts.partOfId = textareaMarkingId;

            // A scan that stopped early leaves the rest of the text unread, so
            // the rollups the portions feed are missing whatever it holds. The
            // store counts the textarea as an incomplete contributor and flags
            // them stale until a complete scan clears it.
            const contributorId =
                el.id ||
                `__ez-marked-textarea-${this._textIdSalt}-${this._textIdCounter++}`;
            componentOpts.onScanCompleteness = (complete: boolean) => {
                // destroy() clears every record itself: the store can outlive
                // this runtime, and a record left behind would flag rollups no
                // field can clear.
                if (this._destroyed) return;
                const wholeId = textareaMarkingId || null;
                if (complete) this.incompleteScans.delete(contributorId);
                else this.incompleteScans.set(contributorId, wholeId);
                this.store.setIncompleteContributor?.(
                    contributorId,
                    wholeId,
                    !complete,
                );
                this.refreshIncomplete();
            };

            componentOpts.registerHiddenField = (
                hiddenEl: HTMLElement,
            ): HiddenAssertionField | null => {
                if (this._destroyed) return null;
                // The marked-textarea programmatically creates `data-ezclassify-controller="hidden"`
                // child elements. Run them through the scanner's normal callbacks so
                // behavior bindings and view mounting stay consistent.
                const ctrl = hiddenEl.getAttribute(
                    'data-ezclassify-controller',
                );
                if (ctrl === 'hidden') {
                    // Register this part as a marking host before bindBehavior runs so
                    // attachView's self-rendered path sees its id in validMarkingIds and
                    // wires it through the store. Without this step the part's edits
                    // never enter the page aggregate or its parent's whole-rollup.
                    this.collectMarkingHosts(hiddenEl);
                    this.bindBehavior(hiddenEl, readBinding(hiddenEl));
                    this.attachView(
                        hiddenEl,
                        'hidden',
                        harvestControllerOptions(hiddenEl, 'hidden'),
                    );
                }
                return (
                    (this.mounted.get(hiddenEl) as
                        HiddenAssertionField | undefined) ?? null
                );
            };
            componentOpts.unregisterHiddenField = (
                hiddenEl: HTMLElement,
            ): void => {
                if (this._destroyed) return;
                // Tear down the per-part store wiring the registerHiddenField path
                // set up. Order matters: drop the part-of edge first so any
                // recompute triggered by the publish below isn't using a stale parent.
                if (hiddenEl.id) {
                    this.store.setPartOf(hiddenEl.id, null);
                    this.validMarkingIds.delete(hiddenEl.id);
                    // Release and empty the part so subscribers see it drop out
                    // of the page aggregate even before the DOM node is removed.
                    this.store.releaseSeed(hiddenEl.id);
                    this.markingHosts.delete(hiddenEl.id);
                    this.seededMarkings.delete(hiddenEl.id);
                }
                const unsub = this.storeUnsubscribers.get(hiddenEl);
                if (unsub) {
                    unsub();
                    this.storeUnsubscribers.delete(hiddenEl);
                }
                this.partOfMap.delete(hiddenEl);
                this.mounted.delete(hiddenEl);
                this.bindingNodes.delete(hiddenEl);
                this.clearHostError(hiddenEl);
            };
        }

        // Instantiate component
        const component = createComponent(controller);
        if (!component) return;
        if (storeBinding && resolved) {
            setMarkingTarget(
                component,
                this.createMarkingTarget(
                    el,
                    storeBinding.markingId,
                    controller,
                    component,
                ),
            );
        }
        // The marking host a field's uncommitted draft is kept in if the field
        // goes away mid-edit (see keepDraft). Only a field holding the whole
        // marking: a facet is one category of it.
        if (storeBinding && !facetOfId && storeMarkingId)
            this.draftHosts.set(component, storeMarkingId);

        // A standalone field and its store read the same value in the same
        // format. Use the store's seed for both. A field with its own format,
        // surface or coverage inputs still needs its own judgment.
        let storeSeedFormat: string | undefined;
        if (
            component.useStoreSeed &&
            this.store.seedRenderedFromHost &&
            this.usesDefaultStoreSeed() &&
            (controller === 'marking' || controller === 'tags') &&
            selfRenderedId &&
            !componentOpts.holdsPart &&
            !componentOpts.scopes?.length &&
            !componentOpts.formatId &&
            !hasParts(this.root, selfRenderedId)
        ) {
            const meta = schemeEngineOf(resolved!, el).getSchemeMeta();
            const format =
                (controller === 'marking'
                    ? meta.defaultWholeRenderFormat
                    : undefined) ??
                meta.defaultRenderFormat ??
                '';
            if (this.store.usesRenderedFormat?.(selfRenderedId, format)) {
                storeSeedFormat = format;
                component.useStoreSeed();
            }
        }

        // The component marks with the Context its element resolved.
        const mounted = drawer
            ? (component as ContextReference).init(
                  container,
                  this.referenceSource(),
                  componentOpts,
              )
            : component.init(
                  container,
                  contextForScheme(resolved!, el),
                  componentOpts,
              );

        if (flowForm && wholeIdForFlow) {
            const group = flowForm;
            const whole = this.markingHosts.get(
                wholeIdForFlow,
            ) as HTMLInputElement;
            this.storeUnsubscribers.get(whole)?.();
            this.storeUnsubscribers.delete(whole);
            group.connect(
                container,
                () => (component as DecisionFlow).formEditPending,
                (state) => {
                    rollup.updateRollup(this);
                    el.dispatchEvent(
                        new CustomEvent('ezclassify:change', {
                            bubbles: true,
                            detail: {
                                assertions: state.assertions,
                                rendered: whole.value,
                            },
                        }),
                    );
                },
            );
            this.plainBehaviorCleanups.set(el, () => {
                group.destroy();
                if (this.decisionFlowForms.get(wholeIdForFlow) === group)
                    this.decisionFlowForms.delete(wholeIdForFlow);
            });
            if (!this.initializing)
                void Promise.resolve(mounted).then(
                    () => group.syncNative(),
                    () => {},
                );
        } else if (controller === 'decisionflow' && isNativeTextField(el)) {
            this.wireDirectDecisionFlow(el, component, container);
        }

        const initPromise =
            choiceGroup && category && mounted instanceof Promise
                ? mounted.then(async () => {
                      const readGroup = async () => {
                          if (
                              this._destroyed ||
                              this.mounted.get(el) !== component
                          )
                              return;
                          await component.setAssertions(
                              choiceGroup.inputs
                                  .filter(
                                      (input) =>
                                          input.checked && !input.disabled,
                                  )
                                  .map((input): EngineAssertion => ({
                                      categoryId: category,
                                      conceptId: input.value,
                                      source: 'user',
                                      confidence: 'certain',
                                  })),
                          );
                      };
                      await readGroup();
                      if (this._destroyed || this.mounted.get(el) !== component)
                          return;
                      const form = choiceGroup.inputs[0]?.form;
                      if (!form) return;
                      const reset = (event: Event) => {
                          queueMicrotask(() => {
                              if (!event.defaultPrevented) void readGroup();
                          });
                      };
                      form.addEventListener('reset', reset);
                      this.plainBehaviorCleanups.set(el, () =>
                          form.removeEventListener('reset', reset),
                      );
                  })
                : mounted;
        if (initPromise !== mounted && initPromise instanceof Promise)
            this._pendingInits.push(
                initPromise.catch((err) =>
                    this.logInitFailure(el, controller, err),
                ),
            );

        if (componentOpts.resolveParts && wholeId) {
            // A part committing changes what the whole has to cover, so the
            // field reads its value again. The store already fans every part
            // commit to the whole's rollup listeners.
            const wirePartRefresh = () => {
                if (this._destroyed || !component.refreshParts) return;
                this.partUnsubscribers.set(
                    el,
                    this.store.subscribeWholeRollup(wholeId, () =>
                        component.refreshParts?.(),
                    ),
                );
                // No parts have no new coverage to judge. Re-reading a repaired
                // standalone field here would replace its authored report.
                if (this.partMarkingsOf(wholeId).length > 0)
                    component.refreshParts();
            };
            if (initPromise instanceof Promise) {
                void initPromise.then(wirePartRefresh, () => {});
            } else {
                wirePartRefresh();
            }
        }

        if (partOfId && this.validMarkingIds.has(partOfId)) {
            // A part reads in its whole's context, so a change to the whole
            // changes what the part shows about it: a part that could not be
            // compared with an invalid whole is compared again once the whole
            // is valid. Only a new value or validity counts; the part's own
            // publishes reach this marking's listeners too.
            const wireWholeRefresh = () => {
                if (this._destroyed || !component.refreshWhole) return;
                // While the whole is being read again, this part's marks wait
                // for the value the store commits for it (see whole-read-gate).
                if (controller === 'marked-textarea')
                    setWholeReadGate(
                        el,
                        (resume) =>
                            !this.initializing &&
                            isMarkingComposing(this.store, partOfId) &&
                            !runWhenStoreIdle(this.store, resume),
                    );
                const seen = this.store.get(partOfId);
                let key = `${seen.valid}\u001f${seen.rendered}`;
                this.wholeUnsubscribers.set(
                    el,
                    this.store.subscribe(partOfId, (state) => {
                        this.wholeCommits.set(partOfId, {
                            rendered: state.rendered,
                            host: this.wholeHostText(partOfId),
                        });
                        const next = `${state.valid}\u001f${state.rendered}`;
                        if (next === key) return;
                        key = next;
                        // After this publish's other listeners, which write
                        // the whole's host that the part's context reads.
                        queueMicrotask(() => {
                            if (!this._destroyed) component.refreshWhole?.();
                        });
                    }),
                );
            };
            if (initPromise instanceof Promise) {
                void initPromise.then(wireWholeRefresh, () => {});
            } else {
                wireWholeRefresh();
            }
        }

        if (storeBinding) {
            const wireSubscription = () => {
                // `init()` is asynchronous, so this runs a microtask or more
                // after the scan that scheduled it, and by then this instance
                // may have been torn down: React's StrictMode runs a host's
                // effect setup, its cleanup and the setup again against one
                // committed tree, so the first instance is always destroyed
                // mid-init. Subscribing now would reach a store its owner
                // already destroyed, which raises, and the raise is reported
                // as the field failing to mount even though the live instance
                // enhanced it perfectly well.
                if (
                    this._destroyed ||
                    (controller === 'decisionflow' &&
                        this.mounted.get(el) !== component)
                )
                    return;
                if (controller === 'marked-textarea') {
                    this.wireMarkedTextareaStore(
                        el as HTMLTextAreaElement,
                        storeBinding,
                        !entryCollectionOnly,
                    );
                } else if (controller === 'text') {
                    // The text controller is a producer only. Sibling commits don't
                    // push back into the host's textContent; the consumer owns the
                    // visible text. Skip the subscribe-side wiring.
                } else if (controller === 'marked-input') {
                    this.wireMarkedInputStore(component, storeBinding);
                } else {
                    this.wireComponentStore(
                        component,
                        storeBinding,
                        !!facetOfId,
                        facetCategory,
                        storeSeedFormat,
                    );
                }
            };
            if (initPromise instanceof Promise) {
                const p = initPromise
                    .then(wireSubscription)
                    .catch((err) => this.logInitFailure(el, controller, err));
                this._pendingInits.push(p);
            } else {
                wireSubscription();
            }
        }

        if (controller === 'tags') {
            const autocompleter = component as TagInput;
            this.autocompleters.set(nativeInput, autocompleter);

            // Listen for external changes to the native input. Registered with a
            // teardown so a released/destroyed instance stops reacting to the
            // input: on the StrictMode-remount and cross-instance reclaim paths
            // the native input node is preserved (destroy() moves it out of its
            // wrapper), so without an explicit removeEventListener this handler
            // would fire on a destroyed autocompleter, and stack one stale
            // listener per remount.
            const externalInputHandler = (): void => {
                if (this.settingValue) return;
                if (nativeInput.value !== autocompleter.getRendered()) {
                    autocompleter.setValue(nativeInput.value);
                }
            };
            nativeInput.addEventListener('input', externalInputHandler);
            const priorCleanup = this.plainBehaviorCleanups.get(nativeInput);
            this.plainBehaviorCleanups.set(nativeInput, () => {
                nativeInput.removeEventListener('input', externalInputHandler);
                priorCleanup?.();
            });

            // Seed assertions after init
            const seedPromise = (
                initPromise instanceof Promise ? initPromise : Promise.resolve()
            ).then(() => {
                const assertions = autocompleter.getAssertions();
                if (assertions.length > 0) {
                    this.fieldAssertions.set(
                        nativeInput,
                        state.toFieldAssertions(assertions),
                    );
                    this.lastValidated.set(
                        nativeInput,
                        autocompleter.getRendered(),
                    );
                }
            });
            // A store-bound field's init failure is already logged by its
            // subscription chain above; log it here only when there is none.
            this._pendingInits.push(
                seedPromise.catch((err) => {
                    if (!storeBinding) this.logInitFailure(el, controller, err);
                }),
            );
        } else {
            this.mounted.set(el, component);

            // One-way reads. Defer wiring until the component's own init() resolves so
            // setAssertions() is never called before this.engine and the DOM are ready.
            // Mirror the storeBinding wireSubscription pattern: push the deferred
            // promise into _pendingInits so the constructor's Promise.all waits for it.
            //   data-ezclassify-aggregate                → mirror the page aggregate
            //   data-ezclassify-aggregate="<whole-id>"   → mirror that whole's rollup
            //   data-ezclassify-source="<id>"            → mirror a named marking
            const wireReadSubscription = () => {
                // Same deferred-teardown window as `wireSubscription` above:
                // an instance destroyed while `init()` was in flight must not
                // reach back into the store its owner has already destroyed.
                if (this._destroyed) return;
                if (typeof component.setAssertions !== 'function') return;
                const source = el.hasAttribute('data-ezclassify-aggregate')
                    ? null
                    : el.getAttribute('data-ezclassify-source');
                // A view that can say its value may be missing markings (the
                // banner) is told so: a value the store flags stale.
                const showIncomplete = (
                    component as { setIncomplete?: (value: boolean) => void }
                ).setIncomplete?.bind(component);
                // A view that names scopes shows those scopes' own output (see
                // writeInScopes). Only the newest state's write is shown.
                const writesText =
                    controller === 'text' || controller === 'banner';
                const viewScopes = writesText
                    ? parseScopeList(el.getAttribute('data-ezclassify-scope'))
                    : [];
                let scopedWrite = 0;
                const applyState = (s: EzClassifyState) => {
                    // Body editors (marked-input, marked-textarea) own their content,
                    // pushing aggregate/source state into them would overwrite the user's
                    // authored text. The bound-to wiring for these components handles
                    // their own store seam separately.
                    if (
                        controller === 'marked-input' ||
                        controller === 'marked-textarea'
                    )
                        return;
                    // A refused state's text is the engine's marker, which no
                    // view reads: the text says the facts could not be written,
                    // and a banner shows no marking and says it may be missing.
                    const refused = renderViewRefused(s);
                    showIncomplete?.(s.stale === true || refused);
                    // setAssertions() only re-renders; it never reads the marking,
                    // so read-derived state freezes at mount time: the text
                    // controller's validity/aria-invalid, and the banner's
                    // displayColor for rule-driven schemes. Route both through
                    // setValue(rendered), which reads the marking with validate,
                    // so that state tracks.
                    const write = ++scopedWrite;
                    // A view writes its own scopes, the default one when it
                    // lists none (see scopesToWrite).
                    const scopes =
                        writesText && !refused
                            ? scopesToWrite(
                                  schemeEngineOf(this.resolveContext(el), el),
                                  viewScopes,
                                  s.assertions ?? [],
                              )
                            : viewScopes;
                    if (refused && controller === 'text') {
                        component!.setAssertions(s.assertions ?? []);
                    } else if (
                        scopes.length > 0 &&
                        typeof component.setValue === 'function'
                    ) {
                        const setValue = component.setValue.bind(component);
                        void this.writeInScopes(
                            el,
                            refused ? [] : s.assertions,
                            scopes,
                        )
                            .catch(() => null)
                            .then((text) => {
                                if (write !== scopedWrite || this._destroyed)
                                    return;
                                // Facts the scopes hold but no write shows
                                // leave the view's value incomplete.
                                if (text === null) showIncomplete?.(true);
                                void setValue(text ?? '');
                            });
                    } else if (
                        (controller === 'text' || controller === 'banner') &&
                        typeof component.setValue === 'function'
                    ) {
                        void component.setValue(
                            refused ? '' : (s.rendered ?? ''),
                        );
                    } else {
                        component!.setAssertions(s.assertions ?? []);
                    }
                };

                if (el.hasAttribute('data-ezclassify-aggregate')) {
                    const banner =
                        controller === 'banner'
                            ? (component as ComponentInstance & {
                                  showRollup: StatusBanner['showRollup'];
                                  setBuckets(
                                      buckets: readonly StatusBannerBucket[],
                                  ): void;
                              })
                            : null;
                    const showBannerRollup = (state: EzClassifyState) => {
                        if (!banner) return;
                        const write = ++scopedWrite;
                        const refused = renderViewRefused(state);
                        const incomplete = state.stale === true || refused;
                        const show = (rendered: string | null) => {
                            if (write !== scopedWrite || this._destroyed)
                                return;
                            banner.showRollup(
                                refused || rendered === null
                                    ? []
                                    : state.assertions,
                                rendered ?? '',
                                refused || rendered === null
                                    ? undefined
                                    : state.displayColor,
                                incomplete || rendered === null,
                            );
                        };
                        if (refused) {
                            show('');
                            return;
                        }
                        if (incomplete) showIncomplete?.(true);
                        const engine = schemeEngineOf(
                            this.resolveContext(el),
                            el,
                        );
                        const meta = engine.getSchemeMeta();
                        const format =
                            resolveFormatAttr(el) ??
                            meta.defaultWholeRenderFormat ??
                            meta.defaultRenderFormat;
                        const scopes = scopesToWrite(
                            engine,
                            viewScopes,
                            state.assertions,
                        );
                        if (scopes.length > 0) {
                            void this.writeInScopes(
                                el,
                                state.assertions,
                                scopes,
                            )
                                .catch(() => null)
                                .then(show);
                        } else if (
                            format &&
                            format !== this.formatsOf(el).whole &&
                            state.assertions.length > 0
                        ) {
                            void Promise.resolve()
                                .then(() =>
                                    engine.render(state.assertions, format),
                                )
                                .then((result) =>
                                    show(
                                        renderViewRefused(result)
                                            ? null
                                            : result.rendered,
                                    ),
                                )
                                .catch(() => show(null));
                        } else show(state.rendered);
                    };
                    // React renders boolean JSX attributes as `="true"`, not `=""`.
                    // Treat "true" and "" identically: both mean "page aggregate, no whole id".
                    const rawWhole =
                        el.getAttribute('data-ezclassify-aggregate')?.trim() ??
                        '';
                    // The level: a whole (its parts' rollup), a collection (its
                    // members'), or the page when the value is empty.
                    const levelId =
                        (rawWhole === 'true' ? '' : rawWhole) || undefined;
                    // A level view filters buckets by its own attributes only:
                    // a default set on an outer element must not hide a bucket.
                    const named = () =>
                        this.bucketsNamed(
                            el.getAttribute(CONTEXT_ATTR),
                            el.getAttribute(SCHEME_ATTR),
                        );
                    const showsBuckets = banner?.setBuckets.bind(banner);
                    const applyLevel = (aggregate: EzClassifyAggregate) => {
                        const buckets = named();
                        const shown = shownBuckets(aggregate, buckets);
                        // A view that can name buckets names each one whenever
                        // the level could hold more than one, so a lone marking
                        // never reads as the only Context's.
                        if (
                            buckets.length > 1 &&
                            shown.length > 0 &&
                            showsBuckets
                        ) {
                            // Every bucket on its own labeled line, in its own
                            // scheme's colors. Buckets never merge.
                            const write = ++scopedWrite;
                            const lines = shown.map(([key, state]) => {
                                const refused = renderViewRefused(state);
                                return {
                                    key,
                                    label: this.bucketLabel(key),
                                    rendered: refused ? '' : state.rendered,
                                    colors: refused
                                        ? null
                                        : (state.displayColor ?? null),
                                    stale: refused || state.stale === true,
                                };
                            });
                            const incomplete = lines.some((line) => line.stale);
                            if (incomplete) showIncomplete?.(true);
                            // Each bucket is shown as the view's scopes write
                            // it in its own scheme: the listed ones, else that
                            // scheme's default (see scopesToWrite).
                            const bucketScopes = shown.map(([key, state]) => {
                                if (renderViewRefused(state)) return [];
                                if (viewScopes.length > 0) return viewScopes;
                                const engine = this.bucketEngine(key);
                                return engine
                                    ? scopesToWrite(
                                          engine,
                                          viewScopes,
                                          state.assertions,
                                      )
                                    : [];
                            });
                            if (bucketScopes.every((s) => s.length === 0)) {
                                showIncomplete?.(incomplete);
                                showsBuckets(lines);
                                return;
                            }
                            // Shown once every write lands.
                            void Promise.all(
                                shown.map(([key, state], at) =>
                                    bucketScopes[at]!.length === 0
                                        ? Promise.resolve(lines[at]!.rendered)
                                        : this.writeBucketInScopes(
                                              el,
                                              key,
                                              state.assertions,
                                              bucketScopes[at]!,
                                          ).catch(() => null),
                                ),
                            ).then((texts) => {
                                if (write !== scopedWrite || this._destroyed)
                                    return;
                                // A bucket with facts that no write shows is a
                                // blank line, so the view says it may be
                                // missing markings.
                                showIncomplete?.(
                                    incomplete ||
                                        texts.some((text) => text === null),
                                );
                                showsBuckets(
                                    lines.map((line, at) => ({
                                        ...line,
                                        rendered: texts[at] ?? '',
                                    })),
                                );
                            });
                            return;
                        }
                        if (shown.length <= 1) {
                            const state =
                                shown[0]?.[1] ?? EMPTY_EZCLASSIFY_STATE;
                            if (banner) showBannerRollup(state);
                            else applyState(state);
                            return;
                        }
                        // Several buckets and a view that shows one: showing
                        // any one of them would hide the others.
                        applyState({
                            ...EMPTY_EZCLASSIFY_STATE,
                            stale: true,
                        });
                    };
                    const unsub = this.store.subscribeAggregate(
                        applyLevel,
                        levelId,
                    );
                    this.storeUnsubscribers.set(el, unsub);
                    applyLevel(this.store.getAggregate(levelId));
                } else {
                    if (source) {
                        // A marking-id reference: mirror that named marking.
                        if (this.validMarkingIds.has(source)) {
                            const unsub = this.store.subscribe(
                                source,
                                applyState,
                            );
                            this.storeUnsubscribers.set(el, unsub);
                            applyState(this.store.get(source));
                        }
                        // Free-floating hint: no marking host registered. Leave blank.
                    }
                }
            };

            if (initPromise instanceof Promise) {
                const p = initPromise
                    .then(wireReadSubscription)
                    .catch((err) => this.logInitFailure(el, controller, err));
                this._pendingInits.push(p);
            } else {
                wireReadSubscription();
            }
        }
        // A controller that is its own marking host is seeded once its editor
        // and subscription are ready. A MarkedTextArea's portion hosts are
        // seeded by the textarea that parsed them.
        if (selfRenderedId && !el.hasAttribute('data-marked-textarea-field'))
            this.seedOnMount(
                selfRenderedId,
                el,
                initPromise,
                storeSeedFormat !== undefined,
            );
        if (controller === 'marked-textarea')
            this.seedPortionsOnMount(component as MarkedTextArea, initPromise);
    }

    /**
     * Build the per-view binding handle that wires an element's edits into the
     * shared `EzClassifyStore` and reflects sibling commits back into the
     * view.
     *
     * Cycle protection uses two seams together. The store's `PublishSource`
     * dedup ensures a publisher never gets fired back at its own commit. To
     * stop the second hop (subscribe-driven view update → echo publish from the
     * receiver), each binding tracks the last state it received and skips the
     * publish when its onChange args still represent that same state.
     */
    private makeStoreBinding(
        el: HTMLElement,
        markingId: string,
        isFacet: boolean,
        category: string | undefined,
    ): StoreBinding {
        const token: PublishSource = { token: el };
        const handle: StoreBinding = {
            markingId,
            isFacet,
            category,
            token,
            lastSeenRendered: '',
            lastSeenViewSignature: '',
            viewRequest: 0,
            lastSeenAssertionSig: '',
            lastSeenFactSig: '',
            publishesFacts: false,
            publish: (assertions: EngineAssertion[], rendered: string) => {
                // A torn-down runtime publishes nothing; the Context it read
                // through may be gone with it.
                if (this._destroyed) return;
                if (isFacet) {
                    const cat = category ?? '';
                    const filtered = assertions.filter(
                        (a) => a.categoryId === cat,
                    );
                    const sig = signAssertionOrigins(filtered);
                    if (sig === handle.lastSeenAssertionSig) return;
                    handle.lastSeenAssertionSig = sig;
                    const current = this.store.get(markingId);
                    const others = current.assertions.filter(
                        (a) => a.categoryId !== cat,
                    );
                    this.publishOrForget(
                        handle,
                        this.store.publishAssertions(
                            markingId,
                            [...others, ...filtered],
                            token,
                            category ? { categories: [category] } : undefined,
                        ),
                    );
                } else {
                    // A marking's text states its default scope only, so a
                    // view of other scopes, one whose facts reach past the
                    // default (a decision flow across scopes, a text field
                    // holding a fact of another scope), or one bound to a
                    // marking that holds facts of other scopes publishes its
                    // facts, which keep every scope. Its text would lose them.
                    handle.publishesFacts ||=
                        this.writesPastDefaultScope(el) ||
                        this.statesOtherScopes(el, assertions) ||
                        this.statesOtherScopes(
                            el,
                            this.store.get(markingId).assertions,
                        );
                    if (handle.publishesFacts) {
                        // The view states the facts of its own scopes only,
                        // so the store keeps the ones of every other scope.
                        const facts = [
                            ...this.factsOfOtherScopes(
                                el,
                                this.store.get(markingId).assertions,
                                assertions,
                            ),
                            ...assertions,
                        ];
                        const sig = signAssertionOrigins(facts);
                        if (sig === handle.lastSeenAssertionSig) return;
                        handle.lastSeenAssertionSig = sig;
                        handle.lastSeenRendered = rendered;
                        this.publishOrForget(
                            handle,
                            this.store.publishAssertions(
                                markingId,
                                facts,
                                token,
                            ),
                        );
                        return;
                    }
                    const facts = signAssertions(assertions);
                    const origins = signAssertionOrigins(assertions);
                    if (
                        rendered === handle.lastSeenRendered &&
                        (facts !== handle.lastSeenFactSig ||
                            origins === handle.lastSeenAssertionSig)
                    )
                        return;
                    handle.lastSeenRendered = rendered;
                    handle.lastSeenFactSig = facts;
                    handle.lastSeenAssertionSig = origins;
                    // A value the engine read in full goes to the store as
                    // its facts. Its text would be read again as stated
                    // throughout, so a value a rule added would reach every
                    // other view as the author's own, with no change to
                    // explain. Text the engine could not read stays text, on
                    // either side: a marking whose text the store could not
                    // read takes no category edit (see publishAssertions), so
                    // only a text replaces it.
                    const view: ComponentInstance | undefined =
                        this.mounted.get(el) ??
                        this.autocompleters.get(el as HTMLInputElement);
                    const held = this.store.get(markingId).recognition;
                    if (
                        assertions.length > 0 &&
                        view?.readsWhole?.() &&
                        (held === undefined || held.status === 'complete')
                    ) {
                        // The view states every category it writes, as its
                        // text would: one it left empty is cleared, and one
                        // equal to the committed value still replaces an edit
                        // on the wire.
                        this.publishOrForget(
                            handle,
                            this.store.publishAssertions(
                                markingId,
                                assertions,
                                token,
                                { categories: this.categoriesWritten(el) },
                            ),
                        );
                        return;
                    }
                    this.publishOrForget(
                        handle,
                        this.store.publishRendered(markingId, rendered, token),
                    );
                }
            },
        };
        return handle;
    }

    /**
     * Report a publish the store rejected after a user edit, unless the page is
     * being torn down: a torn-down store rejects every publish by design.
     */
    private reportFailedPublish(
        label: string,
        markingId: string,
        error: unknown,
    ): void {
        if (this._destroyed || destroyedStores.has(this.store)) return;
        reportPublishFailure(label, markingId, error);
    }

    /**
     * Send a view's publish to the store. A publish the store rejects (its
     * runtime call failed) leaves the store's previous value in place, so the
     * binding forgets what it last sent: the view's next publish of the same
     * value is sent again rather than taken for one the store already holds.
     * The failure is reported the way every failed publish is.
     *
     * @param handle - The binding that published
     * @param publish - The store's publish, as it was sent
     */
    private publishOrForget(
        handle: StoreBinding,
        publish: Promise<unknown>,
    ): void {
        const sent = {
            rendered: handle.lastSeenRendered,
            facts: handle.lastSeenFactSig,
            origins: handle.lastSeenAssertionSig,
        };
        this.trackShare(handle.token, 'value', publish, (error) => {
            if (
                handle.lastSeenRendered === sent.rendered &&
                handle.lastSeenFactSig === sent.facts &&
                handle.lastSeenAssertionSig === sent.origins
            ) {
                handle.lastSeenRendered = '';
                handle.lastSeenFactSig = '';
                handle.lastSeenAssertionSig = '';
            }
            this.reportFailedPublish('field', handle.markingId, error);
        });
    }

    /**
     * Whether each field's publishes reached the store, by channel (its value,
     * a portion's entry, its rollup): the newest publish of each and whether it
     * failed. Only the newest publish of a channel decides it, so an older one
     * that settles late changes nothing.
     */
    private readonly shareStates = new WeakMap<
        object,
        Map<string, { seq: number; failed: boolean }>
    >();
    private shareSeq = 0;

    /**
     * Follow one publish a field made: a rejection runs `onFail`, and the field
     * reports itself unverified while the newest publish of any of its channels
     * was rejected (see FieldComponentBase.setShareFailed). A torn- down page
     * tells no field anything.
     *
     * @param source - The publish source, whose token is the field's element
     * @param channel - Which of the field's publishes this is
     * @param publish - The store's publish, as it was sent
     * @param onFail - Runs when the store rejects it
     * @param onLand - Runs when the store takes it
     */
    private trackShare(
        source: PublishSource,
        channel: string,
        publish: Promise<unknown>,
        onFail: (error: unknown) => void,
        onLand?: () => void,
    ): void {
        const owner = source.token;
        if (typeof owner !== 'object' || owner === null) {
            publish.then(onLand, onFail);
            return;
        }
        let channels = this.shareStates.get(owner);
        if (!channels) {
            channels = new Map();
            this.shareStates.set(owner, channels);
        }
        const seq = ++this.shareSeq;
        const failed = channels.get(channel)?.failed ?? false;
        channels.set(channel, { seq, failed });
        const settle = (rejected: boolean) => {
            const state = channels.get(channel);
            if (!state || state.seq !== seq) return;
            state.failed = rejected;
            if (this._destroyed || destroyedStores.has(this.store)) return;
            const field =
                this.mounted.get(owner as HTMLElement) ??
                this.autocompleters.get(owner as HTMLInputElement);
            if (field && 'setShareFailed' in field)
                (field as FieldComponentBase).setShareFailed(
                    [...channels.values()].some((one) => one.failed),
                );
        };
        publish.then(
            () => {
                onLand?.();
                settle(false);
            },
            (error: unknown) => {
                onFail(error);
                settle(true);
            },
        );
    }

    /**
     * Push a marking's already-committed state into a view that just wired its
     * subscription.
     *
     * `store.subscribe` only ever delivers FUTURE commits, so a view that
     * mounts after its marking was published sees nothing and paints empty
     * against populated state. That is the normal ordering for any
     * conditionally rendered control: the host publishes, the host's render
     * reacts to what it published, and the controls that state calls for are
     * born after the commit they exist to display. The gov demo's authority
     * block is the case that surfaced it, staged assertions left the
     * Derivatively Classified By capture blank and the Multiple Sources card
     * unselected while the store (and the scheme's own authority-block render)
     * proved the state was there.
     *
     * A marking that was never committed is skipped: `EMPTY_EZCLASSIFY_STATE`
     * is the store's identity sentinel for "no publish has landed", so a virgin
     * marking keeps the pre-existing mount behavior exactly, the view's own
     * initial value stands and the host seed still runs. Each caller's own
     * dedup slot (`lastSeenRendered` / `lastSeenAssertionSig`) is advanced by
     * `apply`, so hydrating never double-fires against the first real commit
     * and never fights an in-flight edit the view itself published.
     */
    private hydrateFromStore(
        markingId: string,
        apply: (state: EzClassifyState) => void,
    ): void {
        const committed = this.store.get(markingId);
        if (committed === EMPTY_EZCLASSIFY_STATE) return;
        apply(committed);
    }

    /**
     * Subscribe a regular component (tags, select, checklist, …) to its bound
     * marking. `bound-to` views receive the full rendered string; `facet-of`
     * views receive only the assertions filtered to their category.
     *
     * For facet components, also wires a `subscribeFacet` subscription so the
     * store can push per-category allowable options (from a single suggest call
     * per marking commit) rather than having each picker call suggest itself.
     */
    private wireComponentStore(
        component: ComponentInstance,
        binding: StoreBinding,
        isFacet: boolean,
        category: string | undefined,
        storeSeedFormat: string | undefined,
    ): void {
        const host = binding.token.token as HTMLElement;
        if (!isFacet && isMarkingController(host))
            binding.lastSeenRendered = component.getRendered();
        const boundGuide =
            host.getAttribute('data-ezclassify-controller') ===
                'guide-checklist' &&
            host.hasAttribute('data-ezclassify-bound-to');
        const applyState = (state: EzClassifyState) => {
            if (isFacet) {
                const cat = category ?? '';
                const filtered = state.assertions.filter(
                    (a) => a.categoryId === cat,
                );
                const sig = signAssertionOrigins(filtered);
                if (sig === binding.lastSeenAssertionSig) return;
                binding.lastSeenAssertionSig = sig;
                component.setAssertions(filtered);
            } else if (boundGuide) {
                // Copy writes the associated marking, while the checklist's
                // computed result stays independent. Its own commit must
                // refresh the Current marking row just like a sibling edit.
                binding.lastSeenRendered = state.rendered;
                component.setAssertions(
                    this.factsOfOwnScopes(host, state.assertions ?? []),
                );
            } else if (binding.publishesFacts) {
                // The view publishes facts, so its own echo is the same facts.
                const sig = signAssertionOrigins(state.assertions);
                if (sig === binding.lastSeenAssertionSig) return;
                binding.lastSeenAssertionSig = sig;
                binding.lastSeenRendered = state.rendered;
                if (!state.valid && component.applyStoreState) {
                    component.applyStoreState(state);
                    return;
                }
                component.setAssertions(
                    this.factsOfOwnScopes(host, state.assertions ?? []),
                );
            } else {
                const useStoreSeed =
                    storeSeedFormat !== undefined &&
                    this.store.usesRenderedFormat?.(
                        binding.markingId,
                        storeSeedFormat,
                    );
                const facts = signAssertions(state.assertions);
                const origins = signAssertionOrigins(state.assertions);
                if (
                    !useStoreSeed &&
                    state.rendered === binding.lastSeenRendered &&
                    (facts !== binding.lastSeenFactSig ||
                        origins === binding.lastSeenAssertionSig)
                )
                    return;
                binding.lastSeenFactSig = facts;
                binding.lastSeenAssertionSig = origins;
                // A refused state's text is the engine's marker. The field
                // still holds its last value, so that stays the value this
                // binding has seen and the field's echo of it publishes nothing.
                if (!renderViewRefused(state))
                    binding.lastSeenRendered = state.rendered;
                // Unknown text has no assertion identity. Keep the canonical
                // reading intact so a receiver cannot echo a shortened or
                // empty marking over the input the engine refused.
                if (
                    (useStoreSeed ||
                        !state.valid ||
                        ('recognition' in state &&
                            state.recognition?.status !== 'complete')) &&
                    component.applyStoreState
                ) {
                    component.applyStoreState(state);
                    return;
                }
                // The store already owns the canonical structured state. Reflect that
                // state directly instead of asking every receiving component to parse
                // the rendered transport again. This is both lossless and important
                // for selector-style views: their UI is driven by assertion identity,
                // and a format-specific rendered string may not be parseable through
                // the receiver's view format. Interactive components reprocess the
                // assertions and the binding's lastSeenRendered guard absorbs that
                // subscriber-driven onChange echo.
                //
                // A component shows the facts of the scopes it writes, the
                // scheme's default scope when it lists none, whatever else the
                // marking holds. Its echo of them states the same marking, so
                // the facts guard absorbs it once its publish keeps the rest.
                component.setAssertions(
                    this.factsOfOwnScopes(host, state.assertions ?? []),
                );
            }
        };

        const unsubState = this.store.subscribe(
            binding.markingId,
            applyState,
            boundGuide ? undefined : binding.token,
        );
        this.hydrateFromStore(binding.markingId, applyState);

        // Whether a marking could be written is known once the store has
        // committed it, and a facet's own publish is not echoed back to it, so
        // this listens with no publisher's identity.
        const refreshRefusal = isFacet
            ? component.refreshFacetRefusal?.bind(component)
            : undefined;
        const unsubRefusal = refreshRefusal
            ? this.store.subscribe(binding.markingId, refreshRefusal)
            : undefined;
        refreshRefusal?.();

        // Wire the per-category facet allowability subscription for facet pickers.
        // The store owns the suggest traffic for every subscribed category on a
        // commit, and decides whether that is one batched call or a fan-out; the
        // store supplies baseline allowability; a component can also ask beside
        // its current additive choices through the shared composer path.
        let unsubFacet: (() => void) | undefined;
        if (
            isFacet &&
            category &&
            typeof component.applyAllowableOptions === 'function'
        ) {
            unsubFacet = this.store.subscribeFacet(
                binding.markingId,
                category,
                (facetState) => {
                    component.applyAllowableOptions!(
                        facetState.allowableOptions,
                    );
                },
            );
        }

        const releaseUndo = component.shareUndo
            ? this.shareMarkingUndo(component, binding.markingId)
            : undefined;

        this.storeUnsubscribers.set(binding.token.token as HTMLElement, () => {
            unsubState();
            unsubRefusal?.();
            unsubFacet?.();
            releaseUndo?.();
        });
    }

    /**
     * Give a field the undo of the store marking it is bound to: one per
     * marking, so every field bound to it shows the same offer, and it hears
     * every value the store commits for the marking, whichever field or host
     * wrote it.
     *
     * @returns Releases the field's hold; the last release stops listening
     */
    private shareMarkingUndo(
        component: ComponentInstance,
        markingId: string,
    ): () => void {
        let entry = this.markingUndos.get(markingId);
        if (!entry) {
            const undo = new MarkingUndo();
            const stop = this.store.subscribe(markingId, (state) =>
                undo.observe(valueSignature(state.rendered, state.assertions)),
            );
            entry = { undo, users: 0, stop };
            this.markingUndos.set(markingId, entry);
        }
        const held = entry;
        held.users++;
        component.shareUndo!(held.undo);
        return () => {
            if (--held.users > 0) return;
            held.stop();
            if (this.markingUndos.get(markingId) === held)
                this.markingUndos.delete(markingId);
        };
    }

    /**
     * Bind ordered portion IDs and their ordinary marking states while the
     * textarea retains source/body ownership. A parent aggregate contributes to
     * scalar displays but cannot select a paragraph in a multi-entry body.
     * Custom scalar-only stores retain the existing publication contract.
     */
    private wireMarkedTextareaStore(
        textarea: HTMLTextAreaElement,
        binding: StoreBinding,
        publishParent = true,
    ): void {
        const component = this.mounted.get(textarea) as MarkedTextArea;
        if (publishParent && !this.store.publishAggregate)
            throw new Error(
                'A bound MarkedTextArea requires store.publishAggregate to preserve the engine aggregate verdict.',
            );
        const collections =
            this.store.getEntryIds &&
            this.store.setEntryIds &&
            this.store.subscribeEntries
                ? {
                      get: this.store.getEntryIds.bind(this.store),
                      set: this.store.setEntryIds.bind(this.store),
                      subscribe: this.store.subscribeEntries.bind(this.store),
                  }
                : null;
        let stopped = false;
        let queued = false;
        let reflecting: Promise<void> | null = null;
        let reflectAgain = false;
        let reflectRevision = 0;
        let sourceAmbiguous = false;
        let lastPublishedSig: string | undefined;
        const local = new Map<string, EngineAssertion[]>();
        /** Portions whose newest publish the store rejected. */
        const unshared = new Set<string>();
        const entrySubscriptions = new Map<string, () => void>();
        /**
         * Entries this textarea added to its collection whose state the store
         * has not committed yet. Until it does, `store.get` answers the empty
         * marking for them, and reflecting that would render an empty token
         * over a portion mark the body still carries.
         */
        const awaitingCommit = new Set<string>();
        const awaitNew = (ids: readonly string[]) => {
            const committed = collections?.get(binding.markingId) ?? [];
            for (const id of ids)
                if (!committed.includes(id)) awaitingCommit.add(id);
        };
        const snapshotLocal = () => {
            for (const segment of component.getCommittedPortions())
                if (segment.entryId)
                    local.set(segment.entryId, segment.assertions);
        };
        const reflectOnce = async () => {
            if (!collections || stopped || this._destroyed || sourceAmbiguous)
                return;
            const ids = collections.get(binding.markingId) ?? [];
            try {
                const revision = reflectRevision;
                // An entry still awaiting its first commit keeps the portion
                // the body holds; the commit that settles it reflects again.
                const segments = component.getCommittedPortions();
                const stateOf = (entryId: string): EzClassifyState => {
                    const portion = awaitingCommit.has(entryId)
                        ? segments.find((one) => one.entryId === entryId)
                        : undefined;
                    return portion
                        ? {
                              rendered: portion.rendered,
                              renders: {},
                              assertions: portion.assertions,
                              valid: portion.valid,
                              errors: portion.validationErrors ?? [],
                          }
                        : this.store.get(entryId);
                };
                const states = ids.map((entryId) => ({
                    entryId,
                    state: stateOf(entryId),
                }));
                const signatures = states.map(({ state }) =>
                    signEntryState(state),
                );
                const current = () =>
                    !stopped &&
                    !this._destroyed &&
                    revision === reflectRevision &&
                    JSON.stringify(collections.get(binding.markingId) ?? []) ===
                        JSON.stringify(ids) &&
                    states.every(
                        ({ entryId }, index) =>
                            signEntryState(stateOf(entryId)) ===
                            signatures[index],
                    );
                const applied = await component.applyEntryStates(
                    states,
                    current,
                );
                if (applied) snapshotLocal();
                else if (!current() && !stopped && !this._destroyed)
                    reflectAgain = true;
            } catch (error) {
                // A failed remote rendering leaves the entire body untouched.
                textarea.dispatchEvent(
                    new CustomEvent('ezclassify:entry-error', {
                        bubbles: true,
                        detail: { error },
                    }),
                );
            }
        };
        const reflect = async () => {
            if (!collections || stopped || this._destroyed || sourceAmbiguous)
                return;
            if (reflecting) reflectAgain = true;
            else {
                const run = async () => {
                    try {
                        do {
                            reflectAgain = false;
                            await reflectOnce();
                        } while (reflectAgain && !stopped && !this._destroyed);
                    } finally {
                        reflecting = null;
                    }
                };
                reflecting = run();
            }
            // A caller applying an entry waits for the active pass and its
            // latest queued state, including a pass started as this one ends.
            while (reflecting) await reflecting;
        };
        this.markedTextareaReflectors.set(component, async (entryId) => {
            awaitingCommit.delete(entryId);
            ++reflectRevision;
            await reflect();
        });
        const scheduleReflect = () => {
            ++reflectRevision;
            if (queued || stopped) return;
            queued = true;
            queueMicrotask(() => {
                queued = false;
                void reflect();
            });
        };
        const wireEntries = (ids: readonly string[]) => {
            for (const [id, unsubscribe] of entrySubscriptions)
                if (!ids.includes(id)) {
                    unsubscribe();
                    entrySubscriptions.delete(id);
                    awaitingCommit.delete(id);
                }
            for (const id of ids)
                if (!entrySubscriptions.has(id)) {
                    entrySubscriptions.set(
                        id,
                        this.store.subscribe(id, () => {
                            awaitingCommit.delete(id);
                            scheduleReflect();
                        }),
                    );
                }
        };
        const publishAggregate = (
            segments: ReturnType<MarkedTextArea['getCommittedPortions']>,
        ) => {
            if (!publishParent || stopped) return;
            const sets = segments.map((segment) => segment.assertions);
            const signature = JSON.stringify(sets.map(signAssertions));
            if (signature === lastPublishedSig) return;
            lastPublishedSig = signature;
            this.trackShare(
                binding.token,
                'aggregate',
                this.store.publishAggregate!(
                    binding.markingId,
                    sets,
                    binding.token,
                ),
                (error) => {
                    if (signature === lastPublishedSig)
                        lastPublishedSig = undefined;
                    this.reportFailedPublish(
                        'aggregate',
                        binding.markingId,
                        error,
                    );
                },
            );
        };
        /**
         * Publish each portion's change against what this textarea last told
         * the store. A portion the store has never been told about publishes in
         * full, even when it holds nothing yet, so its entry always commits.
         */
        const publishEntries = (
            segments: ReturnType<MarkedTextArea['getCommittedPortions']>,
        ) => {
            for (const segment of segments) {
                if (!segment.entryId) continue;
                // A portion whose last publish the store rejected is told
                // again in full, whatever this textarea last sent.
                const told =
                    local.has(segment.entryId) &&
                    !unshared.has(segment.entryId);
                const previous = told ? (local.get(segment.entryId) ?? []) : [];
                const categories = [
                    ...new Set(
                        [...previous, ...segment.assertions].map(
                            (assertion) => assertion.categoryId,
                        ),
                    ),
                ].filter(
                    (category) =>
                        signAssertions(
                            previous.filter(
                                (assertion) =>
                                    assertion.categoryId === category,
                            ),
                        ) !==
                        signAssertions(
                            segment.assertions.filter(
                                (assertion) =>
                                    assertion.categoryId === category,
                            ),
                        ),
                );
                if (categories.length || !told) {
                    const entryId = segment.entryId;
                    const sent = segment.assertions;
                    this.trackShare(
                        binding.token,
                        `entry:${entryId}`,
                        this.store.publishAssertions(
                            entryId,
                            sent,
                            binding.token,
                            { categories },
                        ),
                        (error) => {
                            // The store kept the entry's previous value: the
                            // next change publishes this portion in full.
                            unshared.add(entryId);
                            this.reportFailedPublish('portion', entryId, error);
                        },
                        () => unshared.delete(entryId),
                    );
                }
            }
        };
        const handler = (event: Event) => {
            const detail = (event as CustomEvent<{ origin?: string }>).detail;
            const segments = component.getCommittedPortions();
            if (detail?.origin !== 'store') {
                if (
                    textarea
                        .getAttribute('data-ezclassify-entry-conflict')
                        ?.startsWith('ambiguous-')
                )
                    textarea.removeAttribute('data-ezclassify-entry-conflict');
                sourceAmbiguous = false;
                if (collections) {
                    const ids = component.getEntryIds();
                    awaitNew(ids);
                    collections.set(binding.markingId, ids, binding.token);
                    wireEntries(ids);
                    publishEntries(segments);
                }
                snapshotLocal();
                // A source edit may have ended the draft that held a remote update.
                scheduleReflect();
            }
            publishAggregate(segments);
        };
        textarea.addEventListener('ezclassify:marked-change', handler);
        const unsubscribeMembership = collections?.subscribe(
            binding.markingId,
            (ids) => {
                wireEntries(ids);
                scheduleReflect();
            },
            binding.token,
        );
        if (collections) {
            const current = collections.get(binding.markingId);
            if (current === undefined) {
                // This textarea is the collection's source. Its entries are
                // seeded from their portions as it mounts (seedPortionsOnMount).
                const ids = component.getEntryIds();
                awaitNew(ids);
                collections.set(binding.markingId, ids, binding.token);
            }
            wireEntries(collections.get(binding.markingId) ?? []);
            if (current !== undefined) {
                const localIds = component.getEntryIds();
                if (
                    localIds.length &&
                    !localIds.some((id) => current.includes(id))
                ) {
                    sourceAmbiguous = true;
                    textarea.setAttribute(
                        'data-ezclassify-entry-conflict',
                        'ambiguous-source-entries',
                    );
                } else scheduleReflect();
            }
        }
        snapshotLocal();
        const unsubscribeParent =
            collections && publishParent
                ? this.store.subscribe(
                      binding.markingId,
                      (state) => {
                          if (this.initializing) return;
                          const ids = collections.get(binding.markingId) ?? [];
                          if (ids.length !== 1) {
                              textarea.setAttribute(
                                  'data-ezclassify-entry-conflict',
                                  'ambiguous-parent',
                              );
                              textarea.dispatchEvent(
                                  new CustomEvent('ezclassify:entry-conflict', {
                                      bubbles: true,
                                      detail: {
                                          reason: 'ambiguous-parent',
                                          entryIds: ids,
                                      },
                                  }),
                              );
                              return;
                          }
                          void this.store
                              .publishAssertions(
                                  ids[0]!,
                                  state.assertions,
                                  binding.token,
                              )
                              .catch((error: unknown) =>
                                  this.reportFailedPublish(
                                      'portion',
                                      ids[0]!,
                                      error,
                                  ),
                              );
                      },
                      binding.token,
                  )
                : null;
        this.storeUnsubscribers.set(textarea, () => {
            stopped = true;
            unsubscribeMembership?.();
            unsubscribeParent?.();
            this.markedTextareaReflectors.delete(component);
            for (const unsubscribe of entrySubscriptions.values())
                unsubscribe();
            textarea.removeEventListener('ezclassify:marked-change', handler);
        });
    }

    /**
     * Point a binding's outbound publish at `publishAssertions`, so the
     * assertions the field resolved reach the store as they are rather than
     * through its rendered string, which the store would parse again.
     *
     * The dedup slot is a closure-local that starts undefined so the FIRST
     * publish always lands, even an empty one. signAssertions([]) is '', which
     * would collide with the binding's '' init value and silently swallow the
     * very publish that drops a cleared field out of the page aggregate.
     */
    private publishStructurally(binding: StoreBinding): void {
        let lastPublishedSig: string | undefined;
        binding.publish = (
            assertions: EngineAssertion[],
            _rendered: string,
        ) => {
            const sig = signAssertions(assertions);
            if (sig === lastPublishedSig) return;
            lastPublishedSig = sig;
            this.trackShare(
                binding.token,
                'value',
                this.store.publishAssertions(
                    binding.markingId,
                    assertions,
                    binding.token,
                ),
                (error) => {
                    // The store kept its previous value: send this again next
                    // time rather than take it for one the store holds.
                    if (sig === lastPublishedSig) lastPublishedSig = undefined;
                    this.reportFailedPublish('field', binding.markingId, error);
                },
            );
        };
    }

    /**
     * A hidden field holds no text for facts the engine could not write, and
     * publishing the empty text would drop them. Those facts go to the store as
     * they are, unless the store already holds them.
     */
    private publishUnwrittenFacts(binding: StoreBinding): void {
        const publishText = binding.publish;
        binding.publish = (assertions: EngineAssertion[], rendered: string) => {
            if (rendered || assertions.length === 0) {
                publishText(assertions, rendered);
                return;
            }
            const held = this.store.get(binding.markingId).assertions;
            if (signAssertions(held) === signAssertions(assertions)) return;
            this.trackShare(
                binding.token,
                'value',
                this.store.publishAssertions(
                    binding.markingId,
                    assertions,
                    binding.token,
                ),
                (error) =>
                    this.reportFailedPublish('field', binding.markingId, error),
            );
        };
    }

    /**
     * Wire a MarkedInput's bound-to seam. Unlike plain components whose store
     * subscriber calls setValue (which replaces the whole input value),
     * MarkedInput carries free text after the marking: e.g. "(U) report title".
     * Pushing only the new rendered string via setValue destroys that free
     * text.
     *
     * Instead, call setAssertions so the component re-renders only the marking
     * chip from the new assertions and splices the free text back in.
     *
     * Outbound publish override: MI renders in part format (a short inline
     * form), which the store would re-parse with the default (long) format and
     * silently drop what does not round-trip. It publishes its assertions
     * instead (see {@link publishStructurally}).
     *
     * Echo prevention: setAssertions does not call emitChange, so pushing new
     * assertions into the component never loops back into the store. The
     * lastSeenRendered guard skips redundant re-renders when the store
     * publishes the same rendered value twice; it is not involved in echo
     * prevention.
     */
    private wireMarkedInputStore(
        component: ComponentInstance,
        binding: StoreBinding,
    ): void {
        this.publishStructurally(binding);
        // The field's own marking is written in the output the field shows,
        // so a view reading the store's `rendered` sees what the field does.
        const host = binding.token.token as HTMLElement;
        const owned =
            host.id === binding.markingId
                ? component.writtenOutput?.()
                : undefined;
        if (owned) this.store.setRenderedOutput(binding.markingId, owned);

        const applyState = (state: EzClassifyState) => {
            if (state.rendered === binding.lastSeenRendered) return;
            binding.lastSeenRendered = state.rendered;
            // The store reflecting the field's own marking back (the host seed,
            // or its own publish) changes nothing the field holds. Applying it
            // would rewrite the author's mark as the repaired render and clear
            // the errors the engine reported on what the author wrote. The
            // field holds the facts of its own scopes only.
            const own = this.factsOfOwnScopes(host, state.assertions ?? []);
            if (
                signAssertions(own) ===
                signAssertions(component.getAssertions() as EngineAssertion[])
            )
                return;
            // setAssertions rebuilds input.value as "<new-marking> <existing-free-text>".
            // setValue would replace the entire value with just the rendered string.
            component.setAssertions(own);
        };

        const unsubscribe = this.store.subscribe(
            binding.markingId,
            applyState,
            binding.token,
        );
        this.hydrateFromStore(binding.markingId, applyState);
        this.storeUnsubscribers.set(host, () => {
            unsubscribe();
            if (owned) this.store.setRenderedOutput(binding.markingId, null);
        });
    }

    /**
     * Adopt the controller CSS onto the root the component is mounted in, so a
     * shadow-root mount gets it inside its own root rather than in the
     * document.
     */
    private injectScopedStyles(): void {
        this.adoptedStyles.push(
            adoptStyles(dom.getControllerStyles(), this.root),
        );
    }

    /**
     * Show the concept tooltip for `field` at a viewport position.
     *
     * @internal
     */
    showConceptTooltip(
        field: HTMLInputElement,
        conceptId: string,
        x: number,
        y: number,
    ): void {
        dom.showConceptTooltip(this, field, conceptId, x, y);
    }

    /**
     * Show every level's rollup in the outputs the host placed now, without
     * waiting for the next change. The rollups themselves live in the store:
     * read them with `store.getAggregate(levelId?)`.
     *
     * @returns Resolves once the outputs show the store's current rollups
     */
    recalculate(): Promise<void> {
        return rollup.flushRollupNow(this);
    }

    /** Get all assertions across every field and component, deduplicated. */
    getAllAssertions(): FieldAssertion[] {
        const seen = new Set<string>();
        const result: FieldAssertion[] = [];
        const add = (a: FieldAssertion) => {
            const key =
                a.conceptId + '::' + a.categoryId + '::' + (a.value ?? '');
            if (seen.has(key)) return;
            seen.add(key);
            result.push(a);
        };

        for (const f of this.fields) {
            const stored = this.fieldAssertions.get(f);
            if (stored) stored.forEach(add);
        }
        for (const [, comp] of this.mounted) {
            for (const a of comp.getAssertions()) {
                add({
                    conceptId: a.conceptId,
                    categoryId: a.categoryId,
                    ...(a.value ? { value: a.value } : {}),
                });
            }
        }
        return result;
    }

    /**
     * Release every marking this runtime manages whose host has left the page.
     * The store can outlive the runtime, as an application provider's does.
     *
     * A host still on the page is left alone: the runtime is being remounted
     * over it (a StrictMode double mount, or a remount over the same DOM), and
     * the next runtime seeds it again under the same edits. A host that has
     * left takes its marking with it, which keeps its edits off the next page's
     * seed under the same id. Frameworks tear a runtime down on both sides of
     * removing its DOM (Vue before, React after), so a host still attached now
     * is checked again once this task's teardown has run.
     *
     * A host that leaves while a transition still shows it (a Vue
     * `<Transition>` without `mode="out-in"`) is attached at both checks, so
     * its marking is left alone and its edits stay with the marking id.
     */
    private releaseSeeds(): void {
        const store = this.store;
        for (const [id, host] of this.markingHosts) {
            if (!host.isConnected) {
                store.releaseSeed(id);
                continue;
            }
            queueMicrotask(() => {
                if (!host.isConnected) store.releaseSeed(id);
            });
        }
        this.markingHosts.clear();
        this.seededMarkings.clear();
        this.initialSeeds = [];
        // The wholes nested scopes contributed belong to this scope's tree.
        for (const id of this.scopeWholes.keys()) store.releaseSeed(id);
        this.scopeWholes.clear();
    }

    /**
     * Enhance an element already on the page, for a page whose markup you
     * cannot edit (a SharePoint or Jira page, say). Writes
     * `data-ezclassify-controller` and the given attributes onto `element`,
     * then reads it, so it ends exactly as if the page's HTML had declared
     * them: a marking inside a `data-ezclassify-whole` container is a part of
     * that whole, one inside a collection is a member, and one inside a
     * `data-ezclassify-ignore` region is refused with an
     * `ezclassify:host-error` event like any marked element there.
     *
     * Calling it again on the same element replaces what the earlier call
     * wrote.
     *
     * ```ts
     * ui.add(titleInput, 'marking');
     * ui.add(bodyInput, 'marking', { partOf: 'document' });
     * ```
     *
     * @param element - An element inside this instance's root
     * @param controller - The controller to mount, as
     *   `data-ezclassify-controller` names it (`'marking'`, `'banner'`, ...)
     * @param attributes - Further attributes, keyed by name after
     *   `data-ezclassify-` in camelCase: `{ partOf: 'document' }` writes
     *   `data-ezclassify-part-of="document"`, `{ noRollup: true }` a
     *   presence-only one
     * @throws TypeError when the controller is unknown or an attribute key is
     *   not one `add` can write
     * @throws Error when this instance is destroyed, or `element` is not inside
     *   its root or belongs to a nested instance
     */
    add(
        element: HTMLElement,
        controller: ControllerName,
        attributes?: EzClassifyAttributes,
    ): void {
        if (this._destroyed)
            throw new Error(
                '[ezclassify] add() was called on a destroyed EzClassifyUI.',
            );
        if (
            !(element instanceof HTMLElement) ||
            element === this.root ||
            !this.root.contains(element) ||
            !isOwnedBy(element, this._instanceId)
        )
            throw new Error(
                "[ezclassify] add() takes an element inside this EzClassifyUI's root, outside any nested root.",
            );
        const resolved = resolveAddedAttributes(controller, attributes);
        const previous = this.addedAttributes.get(element);
        if (previous) restoreAddedAttributes(element, previous);
        const record: AddedAttributes = new Map();
        writeAddedAttributes(element, resolved, record);
        this.addedAttributes.set(element, record);
        // The observer reads the change the way it reads any script's; flushing
        // it now makes the element's enhancement synchronous with this call.
        if (this.domObserver) flushObserver(this.domObserver);
    }

    /**
     * Undo {@link add}: take off the attributes it wrote on `element`, put back
     * any value the page had there, and tear down the enhancement. The element
     * then reads as its own markup says. An element `add` never touched is left
     * alone.
     *
     * @param element - An element passed to {@link add}
     */
    remove(element: HTMLElement): void {
        const record = this.addedAttributes.get(element);
        if (!record) return;
        this.addedAttributes.delete(element);
        restoreAddedAttributes(element, record);
        // The observer derives the element again from what is left, which
        // tears down the enhancement add built. An element that left the root
        // was torn down when it left, and is no longer recorded.
        if (this.domObserver) flushObserver(this.domObserver);
    }

    /**
     * Copy the marking `field` holds to the clipboard, followed by its scheme,
     * format, assertions and validity.
     */
    async copyMarkingToClipboard(field: HTMLInputElement): Promise<void> {
        return rollup.copyMarkingToClipboard(this, field);
    }

    /**
     * Tear down every component, listener, observer and injected style this
     * runtime added, and withdraw its contribution from any parent scope. The
     * store is left alone: it can outlive the runtime.
     */
    destroy(): void {
        this._destroyed = true;
        // Stop hearing the store first. Releasing this instance's markings
        // below commits them empty, and a store its host owns lives on: a view
        // still listening would read again through a Context that may already
        // be gone with this instance.
        this.storeUnsubscribers.forEach((unsubscribe) => unsubscribe());
        this.storeUnsubscribers.clear();
        this.partUnsubscribers.forEach((unsubscribe) => unsubscribe());
        this.partUnsubscribers.clear();
        this.wholeUnsubscribers.forEach((unsubscribe) => unsubscribe());
        this.wholeUnsubscribers.clear();
        // Zero out this scope's contribution, notify the parent to re-aggregate
        // (the page banner loses this scope's whole) while the edge still exists,
        // THEN drop the edge from the registry.
        const hadParentContribution = this._childWholes.size > 0;
        this._childWholes = new Map();
        if (hadParentContribution) registry.notifyParent(this._instanceId);
        // A destroyed scope reports itself complete, so the enclosing scope
        // stops counting what this one could not read.
        if (this.rollupIncompleteShown)
            registry.notifyParentIncomplete(this._instanceId);
        this.unsubscribeIncomplete?.();
        this.unsubscribeIncomplete = null;
        registry.removeChild(this._instanceId);
        // Clear the boundary marker synchronously so a StrictMode remount can't
        // resolve a stale owner mid-teardown.
        this.root.removeAttribute(MOUNT_ROOT_ATTR);
        tearingDownRuntime(() =>
            this.autocompleters.forEach((c) => this.destroySafely(c)),
        );
        this.autocompleters.clear();
        if (this.domObserver) {
            this.domObserver.disconnect();
            this.domObserver = null;
        }
        // Fulfill the documented teardown contract for the rollup process cache.
        // The cache is keyed by schemeId, so a live-edit host that mutates a
        // scheme under the same id (for example a live scheme editor) would otherwise get
        // stale coverage/process results carried across an unmount/remount.
        // Only this instance's Context partitions go: a peer instance on the
        // same page keeps the work it has already done.
        for (const [, context] of this.contexts.entries())
            rollup.clearRollupProcessCache(context.scheme);
        for (const { adapter } of this.bucketSchemes.values())
            rollup.clearRollupProcessCache(adapter);
        dom.hideConceptTooltip(this);
        this.releaseSeeds();
        for (const [contributorId, wholeId] of this.incompleteScans)
            this.store.setIncompleteContributor?.(
                contributorId,
                wholeId,
                false,
            );
        this.incompleteScans.clear();
        for (const { contributors } of this.hostErrors.values())
            this.releaseErrorContributors(contributors);
        this.hostErrors.clear();
        this.bindingNodes.clear();
        for (const el of this.collections.keys())
            this.unregisterCollectionOf(el);
        // Release cross-instance ownership of every host this instance enhanced so a
        // remount on the same DOM (StrictMode), or a peer instance, can re-claim
        // them. Done before the component/field maps are cleared below.
        this.mounted.forEach((_c, el) => clearMountOwner(el));
        this.fields.forEach((f) => clearMountOwner(f));
        // Destroy declarative components
        tearingDownRuntime(() =>
            this.mounted.forEach((c) => this.destroySafely(c)),
        );
        this.mounted.clear();
        // Remove mount containers and restore visibility of hidden controller elements.
        // createMountContainer inserts a [data-ezclassify-mount] sibling after each
        // interactive controller element and hides the original; destroy() must undo both.
        // Clear mounted selection outputs so the next runtime does not seed
        // itself from the previous scheme. Tags and DecisionFlow write back
        // to native form fields whose values belong to the host.
        this.root
            .querySelectorAll<HTMLElement>('[data-ezclassify-mount]')
            .forEach((mount) => {
                const prev = mount.previousElementSibling as HTMLElement | null;
                if (
                    prev?.hasAttribute('data-ezclassify-controller') &&
                    prev.style.display === 'none'
                ) {
                    prev.style.display = '';
                    const controller = prev.getAttribute(
                        'data-ezclassify-controller',
                    );
                    if (prev.tagName === 'FIELDSET') {
                        if (
                            controller === 'selector' ||
                            controller === 'checklist'
                        ) {
                            mount.remove();
                            return;
                        }
                        const hidden = prev.querySelector<HTMLInputElement>(
                            'input[type="hidden"]',
                        );
                        if (hidden) hidden.value = '';
                    } else if (
                        'value' in prev &&
                        controller !== 'decisionflow' &&
                        controller !== 'tags'
                    ) {
                        (prev as HTMLInputElement).value = '';
                    }
                }
                mount.remove();
            });
        this.aggregates.clear();
        this.plainBehaviorCleanups.forEach((cleanup) => cleanup());
        this.plainBehaviorCleanups.clear();
        this.wholeCommits.clear();
        // Clean up scoped tooltips
        cleanupTooltipForRoot(this.root);
        // Remove injected style elements
        for (const adopted of this.adoptedStyles) adopted.release();
        this.adoptedStyles = [];
        this.fields = [];
        // What add wrote goes with the runtime that wrote it. Last, so the
        // mount cleanup above still finds the controllers it restores.
        for (const [element, record] of this.addedAttributes)
            restoreAddedAttributes(element, record);
        this.addedAttributes.clear();
    }
}
