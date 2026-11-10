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
import { acceptedValue, judgedAsHeld } from './loaded-value';
import {
    type Assertion as EngineAssertion,
    type RenderAssessment,
    type RenderResult,
} from '@ezclassify/types';
import { type RenderColorMap } from './render-colors';
import { TagInput } from './components/tag-input';
import {
    pendingTeardownWrite,
    tearingDownRuntime,
} from './components/teardown-write';
import type { ComponentInstance } from './components/component-base';
import type { ComponentSchemeEngine } from './components/component-base-readonly';
import {
    ContextResolutionError,
    ContextSet,
    contextStoreBuckets,
    schemeEngineOf,
    SINGLE_CONTEXT_KEY,
    type EzClassifyContextMap,
    type EzClassifyContexts,
    type ResolvedContext,
} from './context-binding';
import type { FavoritesConfig } from './components/favorites-panel';
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
    isMarkingController,
    isMarkingHost,
    placeNestedRoot,
    COLLECTION_ATTR,
    CONTEXT_ATTR,
    MARKING_ATTR,
    SCHEME_ATTR,
    type BindingNode,
    type HostError,
} from './binding-model';
import type { StatusBannerBucket } from './components/status-banner';
import { bucketKey, bucketParts, type BucketKey } from './store/store-shared';
import { reportPublishFailure } from './store/publish-failure';
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
import {
    defaultSurfaceOf,
    holdsPart,
    resolveFormatAttr,
    resolveOutput,
    wholeOfShownMarking,
} from './format-resolver';
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
    isMarkingComposing,
    runWhenStoreIdle,
} from './store/base-ezclassify-store';
import { clearWholeReadGate, setWholeReadGate } from './whole-read-gate';
import { createEzClassifyFacetBinding } from './facet-binding';

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
    lastSeenFacetSig: string;
    publish(assertions: EngineAssertion[], rendered: string): void;
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
    /**
     * The seeds of hosts mounted during the initial sweep, started together
     * once every init has resolved (see {@link seedOnMount}).
     */
    private initialSeeds: Array<() => Promise<void>> = [];
    /** Per-view subscription cleanup handles, keyed by the host element. */
    private storeUnsubscribers = new Map<HTMLElement, () => void>();
    /** Per whole field: the subscription that re-reads it when a part changes. */
    private partUnsubscribers = new Map<HTMLElement, () => void>();
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
     * `docs/attributes.md` "Instance-level options"). Omitted (undefined), the
     * ★ button never renders, same as leaving it unset on a
     * directly-constructed component.
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
     * contributor id that holds the levels above it incomplete in the store.
     * Such an element stays unenhanced until its markup changes.
     */
    private readonly hostErrors = new Map<
        HTMLElement,
        {
            error: HostError | RollupOutputError;
            contributorId: string;
            wholeId: string | null;
        }
    >();
    /** Where each scanned element sits in the marking tree, as last derived. */
    private readonly bindingNodes = new Map<HTMLElement, BindingNode>();
    /**
     * Collection containers this runtime declared to the store, with the id
     * each was declared under, so a container that leaves or is renamed is
     * removed under the id the store knows.
     */
    private readonly collections = new Map<HTMLElement, string>();
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
        this.unsubscribeIncomplete = this.store.subscribeAggregate(() => {
            this.refreshIncomplete();
            if (!this._destroyed && !this.initializing)
                void rollup.updateRollup(this);
        });

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
     * The store this instance creates when the host passes none: over the only
     * Context's scheme, or, with several Contexts, one bucket per (Context,
     * scheme) pair that markup resolves, with no default bucket.
     */
    private createStore(
        source: EzClassifyContexts,
        format: string | undefined,
    ): EzClassifyStore {
        if (this.contexts.single) {
            return new VanillaEzClassifyStore(
                this.engine,
                format ? { format } : undefined,
            );
        }
        return new VanillaEzClassifyStore({
            buckets: contextStoreBuckets(source as EzClassifyContextMap, {
                format,
            }),
        });
    }

    /**
     * The Context and scheme `el` marks with.
     *
     * @throws ContextResolutionError when markup resolves none
     * @internal
     */
    resolveContext(el: Element): ResolvedContext {
        return this.contexts.resolve(el, this.root);
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
     * Context key when the instance holds several Contexts, and the scheme
     * selector for a scheme other than the Context's primary.
     */
    private bucketLabel(bucket: BucketKey): string {
        const { contextKey, schemeSelector } = bucketParts(bucket);
        const context = this.contexts.get(contextKey);
        const name = schemeSelector
            ? schemeSelector
            : (context?.scheme.getSchemeMeta().name ?? '');
        return contextKey ? `${contextKey}: ${name}` : name;
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
    ): void {
        if (this.seededMarkings.has(id)) return;
        this.seededMarkings.add(id);
        const start = (): Promise<void> => {
            // Released, or replaced by another host under the same id, while
            // its init or the initial sweep was still running.
            if (this._destroyed || this.markingHosts.get(id) !== host)
                return Promise.resolve();
            return this.seedMarkingHost(id, host);
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

    private seedMarkingHost(id: string, host: HTMLElement): Promise<void> {
        const assertions = this.bodyEditorMark(host);
        return assertions
            ? this.store.seedAssertions(id, assertions)
            : this.store.seedRendered(
                  id,
                  (host as HTMLInputElement).value ?? '',
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
            if (!host) continue;
            if (host.hasAttribute('data-ezclassify-controller')) continue;
            if (host.tagName !== 'INPUT' && host.tagName !== 'TEXTAREA')
                continue;
            if (this.storeUnsubscribers.has(host)) continue;
            if (this.helperInputs.has(host)) continue;
            const writableHost = host as HTMLInputElement | HTMLTextAreaElement;
            const unsubscribe = this.store.subscribe(
                id,
                (state: EzClassifyState) => {
                    if (writableHost.value === state.rendered) return;
                    host.dataset.ezState = 'sync';
                    try {
                        writableHost.value = state.rendered;
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
                this.teardownElement(el);
                this.clearHostError(el);
                this.bindingNodes.delete(el);
                const collection = this.collections.get(el);
                if (collection !== undefined) {
                    this.store.unregisterCollection(collection);
                    this.collections.delete(el);
                }
            },
            (el) => this.rederive(el),
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
            this.validMarkingIds.add(el.id);
            this.markingHosts.set(el.id, el);
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
     * incomplete until its markup changes. The roll-up reports the outputs it
     * refuses to fill the same way.
     *
     * @param error - What is refused, and on which element
     * @param wholeId - The whole whose rollup the element would have fed, if
     *   any
     * @internal
     */
    reportHostError(
        error: HostError | RollupOutputError,
        wholeId: string | null = null,
    ): void {
        if (this._destroyed || this.hostErrors.has(error.element)) return;
        const contributorId = `__ez-host-error-${this._textIdSalt}-${this._textIdCounter++}`;
        this.hostErrors.set(error.element, { error, contributorId, wholeId });
        this.store.setIncompleteContributor?.(contributorId, wholeId, true);
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
        this.store.setIncompleteContributor?.(
            entry.contributorId,
            entry.wholeId,
            false,
        );
        this.refreshIncomplete();
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
        const previous = this.collections.get(el);
        if (previous !== undefined && previous !== node.id)
            this.store.unregisterCollection(previous);
        this.collections.set(el, node.id!);
        this.store.registerCollection(node.id!, node.collectionId ?? null);
    }

    /**
     * Place a marking host's marking in the store: a part under its whole, a
     * whole in its collection, each in the bucket its Context and scheme name.
     */
    private placeMarking(el: HTMLElement, node: BindingNode): void {
        const id = el.id;
        if (!id || !this.validMarkingIds.has(id)) return;
        const bucket = this.bucketOf(node);
        if (bucket) this.store.setBucket(id, bucket);
        if (node.kind === 'part') {
            this.store.setPartOf(id, node.wholeId ?? null);
        } else if (node.kind === 'whole') {
            this.store.setPartOf(id, null);
            this.store.setMembership(id, node.collectionId ?? null);
            this.store.setNoRollup(id, !node.contributes);
        }
    }

    /**
     * The bucket a node names, or undefined when it names neither a Context nor
     * a scheme, so the store's default bucket applies.
     */
    private bucketOf(node: BindingNode): BucketKey | undefined {
        if (node.contextKey === null && node.schemeSelector === null)
            return undefined;
        return bucketKey(node.contextKey ?? '', node.schemeSelector ?? '');
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
     * Derive the subtree under `el` again after a structural attribute changed:
     * tear down what this runtime built there and scan it afresh, so every host
     * reads its new place in the tree. Hosts keep their DOM and their committed
     * values; a draft is kept through teardown.
     */
    private rederive(el: HTMLElement): void {
        if (this._destroyed) return;
        const scope = el === this.root || this.root.contains(el) ? el : null;
        if (!scope) return;
        const affected = [
            ...(isBehaviorBound(scope) && scope !== this.root ? [scope] : []),
            ...Array.from(scope.querySelectorAll<HTMLElement>(EZ_SELECTOR)),
        ].filter((host) => isOwnedBy(host, this._instanceId));
        for (const host of affected) {
            if (this.isBuilt(host)) this.teardownElement(host);
            this.clearHostError(host);
            this.bindingNodes.delete(host);
        }
        for (const [container, id] of Array.from(this.collections))
            if (scope.contains(container)) {
                this.store.unregisterCollection(id);
                this.collections.delete(container);
            }
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

        // Remove the orphan mount sibling if it is still attached.
        const sibling = host.nextElementSibling as HTMLElement | null;
        if (sibling?.hasAttribute('data-ezclassify-mount')) sibling.remove();

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
        if (node.wholeId) this.partOfMap.set(el, node.wholeId);
        if (node.kind === 'part' || node.kind === 'whole')
            this.placeMarking(el, node);
        // A marking host with no controller is mounted by this step, after its
        // placement so its first read already reads it as a part.
        if (
            el.id &&
            this.markingHosts.get(el.id) === el &&
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
                const update = (s: EzClassifyState) => {
                    el.textContent = s.rendered || EMPTY_VALUE;
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
                statusWrap.className = 'ez-plain-field-wrap';
                statusWrap.style.position = 'relative';
                statusWrap.style.display = 'inline-block';
                priorParent?.insertBefore(statusWrap, input);
                statusWrap.appendChild(input);
                ensureStatusMark(statusWrap, {
                    shape: 'input',
                    root: this.root,
                });
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
                this.attachPlainInputBehavior(input, binding, sb);
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

        const processText = (text: string) =>
            engineOf().process(text, { outputFormat: fmt });

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

        const handleBlur = () => {
            void commitValue();
        };
        input.addEventListener('blur', handleBlur);

        let storeUnsub: (() => void) | undefined;
        if (storeBinding) {
            // Reflect commits from other views (tag inputs, etc.) back into the input.
            const applyState = (s: EzClassifyState) => {
                if (commitsInFlight > 0) return;
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
            input.removeEventListener('blur', handleBlur);
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
     * Warn when a control names a scope its category does not belong to.
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
     * @param opts - Its parsed options, carrying the declared scope and
     *   category.
     */
    private warnOnScopeMismatch(
        el: HTMLElement,
        opts: Record<string, unknown>,
    ): void {
        const declaredScope = opts.scope;
        const categoryId = opts.categoryId;
        if (typeof declaredScope !== 'string' || !declaredScope) return;
        if (typeof categoryId !== 'string' || !categoryId) return;
        if (warnedScopeMismatch.has(el)) return;

        const engine = schemeEngineOf(this.resolveContext(el), el);
        const category = engine
            .listCategories()
            .find((c) => c.id === categoryId);
        // An unknown category is a different mistake, and the components report
        // it themselves with better context than this could.
        if (!category) return;
        if (category.scopes?.includes(declaredScope)) return;

        const defaultScope = engine.getSchemeMeta().defaultScope;
        if (declaredScope === defaultScope) return;

        warnedScopeMismatch.add(el);
        console.warn(
            `[ezclassify] control declares data-ezclassify-scope="${declaredScope}" for ` +
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
        // resolves none stays unenhanced as a host error.
        if (this.mounted.has(el)) return;
        const resolved = this.contextForMount(el);
        if (!resolved) return;

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
        }

        // Parse the harvested options bag into typed component options.
        const opts = parseComponentOptions(el, rawOptions);
        this.warnOnScopeMismatch(el, opts);

        // Resolve the native input element (source of truth)
        const nativeInput = resolveNativeInput(el, controller);

        // Create mount container
        const container = createMountContainer(el, controller);

        // onChange: write rendered value to the native input, trigger rollup,
        // and (when bound to a store-tracked marking) publish the new state so
        // sibling views naming the same marking-id stay in sync.
        const onChange = (assertions: EngineAssertion[], rendered: string) => {
            if (controller === 'tags') {
                this.fieldAssertions.set(
                    nativeInput,
                    state.toFieldAssertions(assertions),
                );
                this.lastValidated.set(nativeInput, rendered);
            }
            if (
                controller !== 'hidden' &&
                controller !== 'marked-textarea' &&
                controller !== 'marked-input' &&
                controller !== 'text' &&
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
            componentOpts.resolveFacetSiblings = () =>
                this.store
                    .get(facetOfId)
                    .assertions.filter((a) => a.categoryId !== facetCategory);
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
        }

        // TagInput-specific options. The explicit render format is not among
        // them any more: `parseComponentOptions` reads
        // `data-ezclassify-format` off every controller host, so TagInput's own
        // whole-format resolution still applies when none is declared and every
        // other controller honors the attribute the same way.
        if (controller === 'tags') {
            const scope = el.getAttribute('data-ezclassify-scope');
            if (scope) componentOpts.scope = scope;
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
        // The marking host a field's uncommitted draft is kept in if the field
        // goes away mid-edit (see keepDraft). Only a field holding the whole
        // marking: a facet is one category of it.
        if (storeBinding && !facetOfId && storeMarkingId)
            this.draftHosts.set(component, storeMarkingId);

        // The component marks with the Context its element resolved.
        const initPromise = component.init(
            container,
            resolved.context,
            componentOpts,
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
                if (this._destroyed) return;
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
                    showIncomplete?.(s.stale === true);
                    // setAssertions() only re-renders; it never reads the marking,
                    // so read-derived state freezes at mount time: the text
                    // controller's validity/aria-invalid, and the banner's
                    // displayColor for rule-driven schemes. Route both through
                    // setValue(rendered), which reads the marking with validate,
                    // so that state tracks.
                    if (
                        (controller === 'text' || controller === 'banner') &&
                        typeof component.setValue === 'function'
                    ) {
                        void component.setValue(s.rendered ?? '');
                    } else {
                        component!.setAssertions(s.assertions ?? []);
                    }
                };

                if (el.hasAttribute('data-ezclassify-aggregate')) {
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
                    const showsBuckets = (
                        component as {
                            setBuckets?: (
                                buckets: readonly StatusBannerBucket[],
                            ) => void;
                        }
                    ).setBuckets?.bind(component);
                    const applyLevel = (aggregate: EzClassifyAggregate) => {
                        const shown = shownBuckets(aggregate, named());
                        if (shown.length > 1 && showsBuckets) {
                            // Every bucket on its own labeled line, in its own
                            // scheme's colors. Buckets never merge.
                            showsBuckets(
                                shown.map(([key, state]) => ({
                                    key,
                                    label: this.bucketLabel(key),
                                    rendered: state.rendered,
                                    colors: state.displayColor ?? null,
                                })),
                            );
                            showIncomplete?.(
                                shown.some(([, state]) => state.stale === true),
                            );
                            return;
                        }
                        showsBuckets?.([]);
                        if (shown.length <= 1) {
                            applyState(
                                shown[0]?.[1] ?? { ...EMPTY_EZCLASSIFY_STATE },
                            );
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
            this.seedOnMount(selfRenderedId, el, initPromise);
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
            lastSeenFacetSig: '',
            publish: (assertions: EngineAssertion[], rendered: string) => {
                if (isFacet) {
                    const cat = category ?? '';
                    const filtered = assertions.filter(
                        (a) => a.categoryId === cat,
                    );
                    const sig = signAssertions(filtered);
                    if (sig === handle.lastSeenFacetSig) return;
                    handle.lastSeenFacetSig = sig;
                    const current = this.store.get(markingId);
                    const others = current.assertions.filter(
                        (a) => a.categoryId !== cat,
                    );
                    this.store
                        .publishAssertions(
                            markingId,
                            [...others, ...filtered],
                            token,
                            category ? { categories: [category] } : undefined,
                        )
                        .catch(() => {});
                } else {
                    if (rendered === handle.lastSeenRendered) return;
                    handle.lastSeenRendered = rendered;
                    this.store
                        .publishRendered(markingId, rendered, token)
                        .catch(() => {});
                }
            },
        };
        return handle;
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
     * dedup slot (`lastSeenRendered` / `lastSeenFacetSig`) is advanced by
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
    ): void {
        const host = binding.token.token as HTMLElement;
        if (!isFacet && isMarkingController(host))
            binding.lastSeenRendered = component.getRendered();
        const applyState = (state: EzClassifyState) => {
            if (isFacet) {
                const cat = category ?? '';
                const filtered = state.assertions.filter(
                    (a) => a.categoryId === cat,
                );
                const sig = signAssertions(filtered);
                if (sig === binding.lastSeenFacetSig) return;
                binding.lastSeenFacetSig = sig;
                // Promote to user/certain so the component's reprocess pass treats
                // these as the user's intent and doesn't drop them as "inferred from
                // somewhere else", a level=STUDENTS that the engine added by
                // inference is still the slice this facet view exists to surface.
                const promoted = filtered.map((a) => ({
                    ...a,
                    confidence: 'certain' as const,
                    source: 'user' as const,
                }));
                component.setAssertions(promoted);
            } else {
                if (state.rendered === binding.lastSeenRendered) return;
                binding.lastSeenRendered = state.rendered;
                // Unknown text has no assertion identity. Keep the canonical
                // reading intact so a receiver cannot echo a shortened or
                // empty marking over the input the engine refused.
                if (
                    (!state.valid ||
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
                component.setAssertions(state.assertions ?? []);
            }
        };

        const unsubState = this.store.subscribe(
            binding.markingId,
            applyState,
            binding.token,
        );
        this.hydrateFromStore(binding.markingId, applyState);

        // Wire the per-category facet allowability subscription for facet pickers.
        // The store owns the suggest traffic for every subscribed category on a
        // commit, and decides whether that is one batched call or a fan-out; the
        // component never calls suggest itself.
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

        this.storeUnsubscribers.set(binding.token.token as HTMLElement, () => {
            unsubState();
            unsubFacet?.();
        });
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
        let reflecting = false;
        let reflectAgain = false;
        let reflectRevision = 0;
        let sourceAmbiguous = false;
        let lastPublishedSig: string | undefined;
        const local = new Map<string, EngineAssertion[]>();
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
        const reflect = async () => {
            if (!collections || stopped || this._destroyed || sourceAmbiguous)
                return;
            if (reflecting) {
                reflectAgain = true;
                return;
            }
            const ids = collections.get(binding.markingId) ?? [];
            reflecting = true;
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
                const applied = await component.applyEntryStates(
                    ids.map((entryId) => ({
                        entryId,
                        state: stateOf(entryId),
                    })),
                    () => !stopped && revision === reflectRevision,
                );
                if (applied) snapshotLocal();
            } catch (error) {
                // A failed remote rendering leaves the entire body untouched.
                textarea.dispatchEvent(
                    new CustomEvent('ezclassify:entry-error', {
                        bubbles: true,
                        detail: { error },
                    }),
                );
            } finally {
                reflecting = false;
                if (reflectAgain) {
                    reflectAgain = false;
                    scheduleReflect();
                }
            }
        };
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
            void this.store.publishAggregate!(
                binding.markingId,
                sets,
                binding.token,
            ).catch(() => {
                if (signature === lastPublishedSig)
                    lastPublishedSig = undefined;
            });
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
                const told = local.has(segment.entryId);
                const previous = local.get(segment.entryId) ?? [];
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
                if (categories.length || !told)
                    void this.store
                        .publishAssertions(
                            segment.entryId,
                            segment.assertions,
                            binding.token,
                            { categories },
                        )
                        .catch(() => {});
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
                              .catch(() => {});
                      },
                      binding.token,
                  )
                : null;
        this.storeUnsubscribers.set(textarea, () => {
            stopped = true;
            unsubscribeMembership?.();
            unsubscribeParent?.();
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
            this.store
                .publishAssertions(binding.markingId, assertions, binding.token)
                .catch(() => {});
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

        const applyState = (state: EzClassifyState) => {
            if (state.rendered === binding.lastSeenRendered) return;
            binding.lastSeenRendered = state.rendered;
            // The store reflecting the field's own marking back (the host seed,
            // or its own publish) changes nothing the field holds. Applying it
            // would rewrite the author's mark as the repaired render and clear
            // the errors the engine reported on what the author wrote.
            if (
                signAssertions(state.assertions ?? []) ===
                signAssertions(component.getAssertions() as EngineAssertion[])
            )
                return;
            // setAssertions rebuilds input.value as "<new-marking> <existing-free-text>".
            // setValue would replace the entire value with just the rendered string.
            component.setAssertions(state.assertions ?? []);
        };

        const unsubscribe = this.store.subscribe(
            binding.markingId,
            applyState,
            binding.token,
        );
        this.hydrateFromStore(binding.markingId, applyState);
        this.storeUnsubscribers.set(
            binding.token.token as HTMLElement,
            unsubscribe,
        );
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
        dom.hideConceptTooltip(this);
        this.releaseSeeds();
        for (const [contributorId, wholeId] of this.incompleteScans)
            this.store.setIncompleteContributor?.(
                contributorId,
                wholeId,
                false,
            );
        this.incompleteScans.clear();
        for (const { contributorId, wholeId } of this.hostErrors.values())
            this.store.setIncompleteContributor?.(
                contributorId,
                wholeId,
                false,
            );
        this.hostErrors.clear();
        this.bindingNodes.clear();
        for (const id of this.collections.values())
            this.store.unregisterCollection(id);
        this.collections.clear();
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
        // Also clear the native input value so the next EzClassifyUI doesn't seed itself
        // from this scheme's selections when it reads the element during init().
        this.root
            .querySelectorAll<HTMLElement>('[data-ezclassify-mount]')
            .forEach((mount) => {
                const prev = mount.previousElementSibling as HTMLElement | null;
                if (
                    prev?.hasAttribute('data-ezclassify-controller') &&
                    prev.style.display === 'none'
                ) {
                    prev.style.display = '';
                    if (prev.tagName === 'FIELDSET') {
                        const hidden = prev.querySelector<HTMLInputElement>(
                            'input[type="hidden"]',
                        );
                        if (hidden) hidden.value = '';
                    } else if ('value' in prev) {
                        (prev as HTMLInputElement).value = '';
                    }
                }
                mount.remove();
            });
        this.aggregates.clear();
        this.plainBehaviorCleanups.forEach((cleanup) => cleanup());
        this.plainBehaviorCleanups.clear();
        this.storeUnsubscribers.forEach((unsubscribe) => unsubscribe());
        this.storeUnsubscribers.clear();
        this.partUnsubscribers.forEach((unsubscribe) => unsubscribe());
        this.partUnsubscribers.clear();
        this.wholeUnsubscribers.forEach((unsubscribe) => unsubscribe());
        this.wholeUnsubscribers.clear();
        this.wholeCommits.clear();
        // Clean up scoped tooltips
        cleanupTooltipForRoot(this.root);
        // Remove injected style elements
        for (const adopted of this.adoptedStyles) adopted.release();
        this.adoptedStyles = [];
        this.fields = [];
    }
}
