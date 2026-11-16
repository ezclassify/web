import type {
    BucketAggregate,
    BucketScheme,
    FieldAssertion,
    FormsContext,
    RollupOutputErrorCode,
} from './types';
import {
    roleNoun,
    type Assertion,
    type CoverageReport,
    type ProcessResult,
    type ValidationError,
} from '@ezclassify/types';
import type { EzClassifyState } from '../store/ezclassify-store';
import { bucketParts, type BucketKey } from '../store/store-shared';
import {
    COLLECTION_ATTR,
    CONTEXT_ATTR,
    CONTROLLER_ATTR,
    SCHEME_ATTR,
    viewAttrOf,
} from '../binding-model';
import { showsStandalonePart } from '../format-resolver';
import { getFormat, toFieldAssertions } from './state';
import { showCopiedIndicator } from './dom';
import { isOwnedBy } from '../element-scanner';
import { TRANSLATE_ATTRIBUTE } from '../components/translated-view';
import { t } from '../i18n';
import {
    indexCoverageTargets,
    removeCoverageAction,
    syncCoverageAction,
} from '../components/coverage-action';

/**
 * Construct a DOM event from the target element's own realm.
 *
 * An element can live in a different realm than the module's global scope, most
 * obviously inside an `<iframe>`, where the element's `CustomEvent`/`Event`
 * constructors differ from the top window's. Dispatching an event built with
 * the wrong realm's constructor throws "Failed to execute 'dispatchEvent':
 * parameter 1 is not of type 'Event'". (The same mismatch appears under jsdom,
 * where Node's global `CustomEvent` shadows jsdom's `window.CustomEvent`.)
 * Resolve the constructor from `el.ownerDocument.defaultView` so the event
 * always belongs to the element's realm, falling back to the module global when
 * there is no view.
 */
function realmEvent(
    el: Element,
    kind: 'CustomEvent',
    type: string,
    init?: CustomEventInit,
): CustomEvent;
function realmEvent(
    el: Element,
    kind: 'Event',
    type: string,
    init?: EventInit,
): Event;
function realmEvent(
    el: Element,
    kind: 'CustomEvent' | 'Event',
    type: string,
    init?: CustomEventInit | EventInit,
): Event {
    const view = el.ownerDocument?.defaultView as
        (Window & typeof globalThis) | null | undefined;
    const Ctor = (view?.[kind] ?? globalThis[kind]) as new (
        t: string,
        i?: CustomEventInit | EventInit,
    ) => Event;
    return new Ctor(type, init);
}

/** One bucket of a level, as the `ezclassify:rollup` event carries it. */
export interface RollupBucketDetail {
    /** The Context key, or `null` for an instance built from one Context. */
    context: string | null;
    /** The Context-local scheme selector, or `null` for its primary scheme. */
    scheme: string | null;
    rendered: string;
    assertions: Assertion[];
    /**
     * The rollup may be missing markings: a contributor's read failed or read
     * only part of its source, so this is the last value the store could
     * compute.
     */
    stale: boolean;
}

/**
 * The `ezclassify:rollup` event detail. One event fires on a level's element
 * (the instance root for the page, a collection's container, a whole's host)
 * each time that level's rollup changes.
 */
export interface RollupEventDetail {
    /** The level: `null` for the instance root, else a whole or collection id. */
    level: string | null;
    /**
     * Every bucket of the level that holds a contributor or misses one, in the
     * store's order. Buckets never merge.
     */
    buckets: RollupBucketDetail[];
}

//
// The coverage pass reads each whole and each of its parts on every form
// change: one `process()` per whole, one per part. With N parts and M wholes,
// one keystroke can produce O(N+M) engine calls, and every call is a network
// round-trip under a remote Context.
//
// We cache the result of `process(rendered, { format, context })` keyed by the
// tuple (bucket, rendered, role, partOfRendered, format). The cache is LRU with
// a cap of 256 entries, large enough to hold the common work of a form session
// (typically 10-30 distinct markings x 2 roles), small enough to survive long
// sessions without leaking memory. Cleared on session destroy and exposed as
// `clearRollupProcessCache()` for tests.
//
// Each adapter gets its own partition. Two Contexts can carry the same scheme
// over a different guide or access composition, which is exactly what decides
// whether a marking validates. A single shared table would hand one Context's
// answer to the other, and one Context's teardown would throw away every other
// Context's work.
interface ProcessCacheKey {
    bucket: BucketKey;
    rendered: string;
    role: 'whole' | 'part';
    partOfRendered: string;
    format: string;
}

const MAX_CACHE_ENTRIES = 256;

/** One LRU table per adapter, plus the generation it was created under. */
interface AdapterPartition {
    generation: number;
    entries: Map<string, ProcessResult>;
    pending: Map<string, Promise<ProcessResult>>;
}

const processCaches = new WeakMap<object, AdapterPartition>();

// Bumped by a clear-all. Partitions are held weakly, so there is no list to walk
// and no way to empty them one by one; a stale generation retires a partition on
// its next use instead. Holding the adapters strongly to get that list would
// keep a destroyed session's adapter and its results alive.
let cacheGeneration = 0;

/** The cache for `adapter`, rebuilt if a clear-all has happened since. */
function partitionFor(adapter: object): AdapterPartition {
    const existing = processCaches.get(adapter);
    if (existing && existing.generation === cacheGeneration) {
        return existing;
    }
    const fresh: AdapterPartition = {
        generation: cacheGeneration,
        entries: new Map<string, ProcessResult>(),
        pending: new Map<string, Promise<ProcessResult>>(),
    };
    processCaches.set(adapter, fresh);
    return fresh;
}

function cacheKey(k: ProcessCacheKey): string {
    return `${k.bucket}\x1f${k.role}\x1f${k.format}\x1f${k.partOfRendered}\x1f${k.rendered}`;
}

/**
 * Run `scheme.process` through the rollup LRU cache so repeated reads of the
 * same (bucket, role, rendered, partOf) tuple reuse their prior result instead
 * of re-hitting the engine or the wire.
 */
export async function processRollupMarking(
    ctx: Pick<FormsContext, 'defaultFormat'>,
    scheme: BucketScheme,
    rendered: string,
    context: { role: 'whole' | 'part'; partOf?: { rendered: string } },
): Promise<ProcessResult> {
    const key = cacheKey({
        bucket: scheme.bucket,
        rendered,
        role: context.role,
        partOfRendered: context.partOf?.rendered ?? '',
        format: ctx.defaultFormat,
    });
    const partition = partitionFor(scheme.adapter);
    const hit = partition.entries.get(key);
    if (hit) {
        // LRU: move to the end
        partition.entries.delete(key);
        partition.entries.set(key, hit);
        return hit;
    }
    const inFlight = partition.pending.get(key);
    if (inFlight) return inFlight;
    const pending = Promise.resolve(
        scheme.process(rendered, {
            outputFormat: ctx.defaultFormat,
            context,
        }),
    )
        .then((result) => {
            partition.entries.set(key, result);
            // Evict oldest when over the cap.
            if (partition.entries.size > MAX_CACHE_ENTRIES) {
                const oldestKey = partition.entries.keys().next().value;
                if (oldestKey !== undefined)
                    partition.entries.delete(oldestKey);
            }
            return result;
        })
        .finally(() => partition.pending.delete(key));
    partition.pending.set(key, pending);
    return pending;
}

/**
 * Clear the rollup process cache.
 *
 * @param adapter - Clear only this adapter's partition. Omit to clear every
 *   partition, which is what a test wants between cases.
 */
export function clearRollupProcessCache(adapter?: object): void {
    if (adapter) {
        processCaches.delete(adapter);
        return;
    }
    cacheGeneration++;
}

/**
 * The scheme operations for `el`'s bucket, or `null` when `el` resolves no
 * Context. Such an element is a host error the binding reports; the rollup
 * leaves it out rather than read it against a Context it does not belong to.
 */
function schemeFor(ctx: FormsContext, el: HTMLElement): BucketScheme | null {
    try {
        return ctx.schemeOf(el);
    } catch {
        return null;
    }
}

/**
 * Group every part by the id of its whole; see binding-model §2. The map's keys
 * are whole marking ids (never empty); values are the live part elements of
 * that whole. Iteration order matches insertion order in `ctx.partOfMap`.
 */
export function partitionContributorsByParent(
    ctx: FormsContext,
): Map<string, HTMLElement[]> {
    const partitions = new Map<string, HTMLElement[]>();
    for (const [childEl, parentId] of ctx.partOfMap) {
        if (!parentId) continue;
        let bucket = partitions.get(parentId);
        if (!bucket) {
            bucket = [];
            partitions.set(parentId, bucket);
        }
        bucket.push(childEl);
    }
    return partitions;
}

/**
 * The marking an element holds, as the coverage pass reads it: the store's
 * committed value where the store has one (see
 * FormsContext.committedRendering), else an enhanced field's component
 * rendering, or an unenhanced field's own value.
 */
export function elementRendered(ctx: FormsContext, el: HTMLElement): string {
    const committed = ctx.committedRendering?.(el);
    if (committed !== undefined) return committed;
    const comp = componentOf(ctx, el);
    if (comp) return comp.getRendered();
    return (el as HTMLInputElement).value?.trim() ?? '';
}

function componentOf(ctx: FormsContext, el: HTMLElement) {
    return (
        ctx.mounted.get(el) ?? ctx.autocompleters.get(el as HTMLInputElement)
    );
}

/**
 * Get rendered marking for an element (field or component). Returns the
 * rendered string and the assertions.
 */
function getElementRendered(
    ctx: FormsContext,
    el: HTMLElement,
): { rendered: string; assertions: FieldAssertion[] } {
    // Every enhanced field has a component with cached assertions; use it
    const comp = componentOf(ctx, el);
    return {
        rendered: elementRendered(ctx, el),
        assertions: comp ? toFieldAssertions(comp.getAssertions()) : [],
    };
}

/**
 * Whether an element is a view: it shows a marking and holds none. A view never
 * stands in for the marking it shows, so it is never resolved as a whole.
 */
function isView(el: HTMLElement): boolean {
    return viewAttrOf(el) !== null;
}

/**
 * Build a one-shot id → marking host index over all fields and components, so a
 * pass that resolves many wholes does one linear build and then O(1) lookups,
 * instead of a per-whole rescan of every field and component. Precedence:
 * fields win over components, and the first match for a given id wins within
 * each. Views are never indexed: a view's id names the view, not a marking.
 */
function buildParentIndex(ctx: FormsContext): Map<string, HTMLElement> {
    const index = new Map<string, HTMLElement>();
    for (const f of ctx.fields) {
        if (f.id && !index.has(f.id) && !isView(f)) index.set(f.id, f);
    }
    for (const [el] of ctx.mounted) {
        if (el.id && !index.has(el.id) && !isView(el)) index.set(el.id, el);
    }
    return index;
}

function capitalize(s: string): string {
    return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * The notice each element's validation shows, so an element only ever updates
 * its own. Looking a notice up by class inside the element's container would
 * find a sibling's (a whole and its part in one container) and overwrite it.
 */
const notices = new WeakMap<HTMLElement, HTMLElement>();

/**
 * Dispatch the validation event on an element and manage visual feedback.
 *
 * @param notice - Show the failure as a notice beside the element. False for a
 *   whole whose field reports its own coverage error; the event still fires.
 */
function dispatchValidation(
    el: HTMLElement,
    result: {
        valid: boolean;
        parentRendered: string;
        childRendered: string;
        error?: string;
    },
    notice = true,
): void {
    el.dispatchEvent(
        realmEvent(el, 'CustomEvent', 'ezclassify:validation', {
            bubbles: true,
            detail: result,
        }),
    );

    if (!result.valid && notice) {
        el.setAttribute('data-ezclassify-error', '');
        // This element's own notice, made on first use.
        let notice = notices.get(el) ?? null;
        if (!notice?.isConnected) {
            notice?.remove();
            notice = document.createElement('div');
            notices.set(el, notice);
            notice.className = 'ez-parent-validation-notice';
            notice.setAttribute('role', 'alert');
            notice.setAttribute('aria-live', 'assertive');
            notice.setAttribute('data-ezclassify', '');
            // Insert after the visible component. For an interactive
            // autocompleter that is a sibling mount placed right after the
            // hidden native input; walking up with `closest` from the input
            // would never find it and would put the notice above the field.
            // Read-only components mount in place, so fall back to ancestors.
            const siblingMount = el.nextElementSibling as HTMLElement | null;
            const isSiblingMount = siblingMount?.hasAttribute(
                'data-ezclassify-mount',
            )
                ? siblingMount
                : null;
            const insertAfter =
                isSiblingMount ??
                el.closest('[data-ezclassify-mount]') ??
                el.closest('[data-ezclassify]') ??
                el;
            insertAfter.parentNode?.insertBefore(
                notice,
                insertAfter.nextSibling,
            );
        }
        notice.textContent = result.error ?? '';
        notice.style.display = '';
    } else {
        el.removeAttribute('data-ezclassify-error');
        const notice = notices.get(el);
        if (notice) {
            notice.style.display = 'none';
            notice.textContent = '';
        }
    }
}

const pendingRollups = new WeakMap<FormsContext, number>();
interface PendingDebounce {
    timer: ReturnType<typeof setTimeout>;
    resolvers: Array<() => void>;
}
const pendingRollupDebounces = new WeakMap<FormsContext, PendingDebounce>();
let rollupSeq = 0;
/**
 * Debounce window (ms) for collapsing async bursts: when several fields finish
 * their reads at slightly different times, the pass runs once after the last
 * one, not once per completion.
 */
const ROLLUP_DEBOUNCE_MS = 30;

/**
 * Show the store's rollups on the page and check every whole against its parts.
 * Debounces async bursts: multiple calls within ROLLUP_DEBOUNCE_MS are
 * collapsed into a single run after the quiet period. Each call's returned
 * promise resolves after that single run completes.
 */
export function updateRollup(ctx: FormsContext): Promise<void> {
    if (ctx.destroyed) return Promise.resolve();
    if (ctx.initializing) return Promise.resolve();

    // A queued edit supersedes work already in flight, even while this edit
    // waits for the debounce timer to fire.
    pendingRollups.set(ctx, ++rollupSeq);

    const existing = pendingRollupDebounces.get(ctx);
    if (existing) clearTimeout(existing.timer);
    const resolvers = existing ? existing.resolvers : [];

    return new Promise<void>((resolve) => {
        resolvers.push(resolve);
        const timer = setTimeout(() => {
            pendingRollupDebounces.delete(ctx);
            // Fire-and-forget: this runs after a debounce timer, possibly once the
            // host has detached the form (or, under a test runner, after teardown).
            // Swallow any error so a deferred pass can never surface as an
            // unhandled rejection; the next input runs it again.
            void runRollupNow(ctx)
                .catch(() => {})
                .finally(() => {
                    for (const r of resolvers) r();
                });
        }, ROLLUP_DEBOUNCE_MS);
        pendingRollupDebounces.set(ctx, { timer, resolvers });
    });
}

/**
 * Run a pass immediately, bypassing the {@link updateRollup} debounce timer.
 * Used by the cross-instance contribution path: when a nested instance's rollup
 * changes it calls its enclosing instance's flush so that instance shows it
 * within the nested instance's settle window instead of waiting out a second
 * debounce.
 */
export function flushRollupNow(ctx: FormsContext): Promise<void> {
    const pending = pendingRollupDebounces.get(ctx);
    if (pending) {
        clearTimeout(pending.timer);
        pendingRollupDebounces.delete(ctx);
    }
    const run = runRollupNow(ctx);
    if (pending) {
        const resolvePending = () => {
            for (const resolve of pending.resolvers) resolve();
        };
        void run.then(resolvePending, resolvePending);
    }
    return run;
}

async function runRollupNow(ctx: FormsContext): Promise<void> {
    if (ctx.destroyed) return;
    if (ctx.initializing) return;

    const seq = ++rollupSeq;
    pendingRollups.set(ctx, seq);
    const isCurrent = () => !ctx.destroyed && pendingRollups.get(ctx) === seq;
    await Promise.resolve();
    if (!isCurrent()) return;
    // Show every level from one settled state: a pass taken while a marking is
    // being read again would show old and new values side by side, and which
    // ones depends on the order the engine answered in. The store's return to
    // idle runs the pass.
    if (ctx.whenStoreIdle && !ctx.whenStoreIdle(() => void updateRollup(ctx)))
        return;

    // Every value shown below is the store's rollup of contributor facts. No
    // field's text is read back into a rollup, so an output the host placed can
    // never feed its own value into the rollup it shows.
    const parentIndex = buildParentIndex(ctx);
    const partitions = partitionContributorsByParent(ctx);
    const levels = collectLevels(ctx, parentIndex, partitions);
    writeOutputs(ctx, levels, parentIndex);
    announceLevels(ctx, levels);

    // What this instance contributes to an enclosing one: its root's rollup,
    // facts included.
    ctx.onRollupComputed?.(levels.get(null)?.byBucket ?? new Map());
    if (!isCurrent()) return;

    // The values are what the scope could read. Whether that is all of it is
    // a separate fact the outputs carry as their validity.
    ctx.refreshIncomplete?.(true);

    await runPartitionCoverage(ctx, partitions, parentIndex, isCurrent);
    if (!isCurrent()) return;
    await updateConditionalVisibility(ctx, parentIndex, isCurrent);
}

// ---------------------------------------------------------------------------
// Levels and the outputs that show them
// ---------------------------------------------------------------------------

interface Level {
    /** `null` for the instance root, else the whole or collection id. */
    id: string | null;
    /** Where the level's `ezclassify:rollup` event fires. */
    el: HTMLElement;
    byBucket: ReadonlyMap<BucketKey, BucketAggregate>;
}

const AGGREGATE_ATTR = 'data-ezclassify-aggregate';

/** The elements under the instance root that this instance owns. */
function ownedMatches(ctx: FormsContext, selector: string): HTMLElement[] {
    const found: HTMLElement[] = [];
    if (ctx.root.matches(selector)) found.push(ctx.root);
    for (const el of ctx.root.querySelectorAll<HTMLElement>(selector)) {
        if (isOwnedBy(el, ctx.mountInstanceId)) found.push(el);
    }
    return found;
}

/**
 * Every level this instance shows: the instance root, each collection it owns
 * and each whole with parts, each with the store's rollup by bucket.
 */
function collectLevels(
    ctx: FormsContext,
    parentIndex: Map<string, HTMLElement>,
    partitions: Map<string, HTMLElement[]>,
): Map<string | null, Level> {
    const levels = new Map<string | null, Level>();
    levels.set(null, {
        id: null,
        el: ctx.root,
        byBucket: ctx.aggregateOf(null),
    });
    for (const el of ownedMatches(ctx, `[${COLLECTION_ATTR}]`)) {
        if (el === ctx.root) continue;
        const id = el.getAttribute(COLLECTION_ATTR) ?? '';
        if (!id || levels.has(id)) continue;
        levels.set(id, { id, el, byBucket: ctx.aggregateOf(id) });
    }
    for (const wholeId of partitions.keys()) {
        const el = parentIndex.get(wholeId);
        if (!el || levels.has(wholeId)) continue;
        levels.set(wholeId, {
            id: wholeId,
            el,
            byBucket: ctx.aggregateOf(wholeId),
        });
    }
    return levels;
}

/** A level's rollup as the event carries it. */
function eventDetail(level: Level): RollupEventDetail {
    const buckets: RollupBucketDetail[] = [];
    for (const [key, aggregate] of level.byBucket) {
        const stale = aggregate.stale === true;
        // A bucket that misses a contributor stays, so it never reads as empty.
        if (!aggregate.rendered && aggregate.assertions.length === 0 && !stale)
            continue;
        const { contextKey, schemeSelector } = bucketParts(key);
        buckets.push({
            context: contextKey || null,
            scheme: schemeSelector || null,
            rendered: aggregate.rendered,
            assertions: aggregate.assertions,
            stale,
        });
    }
    return { level: level.id, buckets };
}

/** The last detail each level announced, by instance, to skip repeats. */
const announced = new WeakMap<FormsContext, Map<string | null, string>>();

/**
 * Fire `ezclassify:rollup` on each level whose rollup changed since the last
 * pass, and on each level the first time it is seen.
 */
function announceLevels(
    ctx: FormsContext,
    levels: Map<string | null, Level>,
): void {
    let last = announced.get(ctx);
    if (!last) {
        last = new Map();
        announced.set(ctx, last);
    }
    for (const id of [...last.keys()]) if (!levels.has(id)) last.delete(id);
    for (const level of levels.values()) {
        const detail = eventDetail(level);
        const signature = JSON.stringify(detail);
        if (last.get(level.id) === signature) continue;
        last.set(level.id, signature);
        level.el.dispatchEvent(
            realmEvent(level.el, 'CustomEvent', 'ezclassify:rollup', {
                bubbles: true,
                detail,
            }),
        );
    }
}

/** How one output resolved: the bucket it shows, or why it shows none. */
type OutputResolution =
    | { level: string | null; bucket: BucketKey }
    | { error: RollupOutputErrorCode; message: string };

/**
 * The level an output names. A bare attribute (or `"true"`, as a framework
 * writes a boolean) is the instance root: moving the markup can only widen what
 * it shows, never lower it.
 */
function outputLevel(el: HTMLElement): string | null {
    const value = (el.getAttribute(AGGREGATE_ATTR) ?? '').trim();
    return value === '' || value === 'true' ? null : value;
}

/**
 * Resolve an output's bucket. Its own `data-ezclassify-context` and
 * `data-ezclassify-scheme` filter the buckets this instance can hold; an
 * inherited one never does, so a default set on an outer element cannot hide a
 * bucket from the page. Exactly one bucket may remain: an output holds one
 * marking, and choosing one of several for it would submit one scheme's value
 * as the page's.
 */
function resolveOutput(
    ctx: FormsContext,
    el: HTMLElement,
    levels: Map<string | null, Level>,
    parentIndex: Map<string, HTMLElement>,
): OutputResolution {
    const level = outputLevel(el);
    if (level !== null && !levels.has(level) && !parentIndex.has(level)) {
        return {
            error: 'aggregate-level-unknown',
            message: `data-ezclassify-aggregate="${level}" names no whole or collection.`,
        };
    }
    const candidates = ctx.bucketsNamed(
        el.getAttribute(CONTEXT_ATTR),
        el.getAttribute(SCHEME_ATTR),
    );
    if (candidates.length === 1) return { level, bucket: candidates[0] };
    if (candidates.length === 0) {
        return {
            error: 'aggregate-bucket-unknown',
            message:
                'data-ezclassify-aggregate names a Context or scheme this page does not hold.',
        };
    }
    return {
        error: 'aggregate-bucket-ambiguous',
        message:
            'data-ezclassify-aggregate matches several Contexts or schemes on this page: name one with its own data-ezclassify-context and data-ezclassify-scheme.',
    };
}

/** What the runtime last wrote on each output. */
interface OutputState {
    /** The resolution's identity, so a host error is reported once. */
    resolutionKey: string;
    /** The bucket shown, when the output resolved one. */
    bucket?: BucketKey;
    /** The level shown, when the output resolved one. */
    level?: string | null;
    /** The host-error message, when it did not. */
    error?: string;
    /** The custom-validity message this runtime set, if any. */
    validity: string | null;
}

const outputStates = new WeakMap<HTMLElement, OutputState>();

/** Whether each instance's rollup may be missing markings it could not read. */
const instanceIncomplete = new WeakMap<FormsContext, boolean>();

function holdsValue(el: HTMLElement): el is HTMLInputElement {
    return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA';
}

/**
 * Every output this instance owns: an aggregate element with no controller and
 * no translation, both of which mount a view that shows the level itself.
 */
function ownedOutputs(ctx: FormsContext): HTMLElement[] {
    return ownedMatches(
        ctx,
        `[${AGGREGATE_ATTR}]:not([${CONTROLLER_ATTR}]):not([${TRANSLATE_ATTRIBUTE}])`,
    );
}

/**
 * Write each output the host placed: an input holds its level's value in its
 * bucket and any other element shows it as text. An output names its bucket
 * with its own `data-ezclassify-context` and `data-ezclassify-scheme`, so a
 * page with several buckets places one output per bucket it submits.
 */
function writeOutputs(
    ctx: FormsContext,
    levels: Map<string | null, Level>,
    parentIndex: Map<string, HTMLElement>,
): void {
    for (const el of ownedOutputs(ctx)) {
        const resolution = resolveOutput(ctx, el, levels, parentIndex);
        const resolutionKey = JSON.stringify(resolution);
        const previous = outputStates.get(el);
        const state: OutputState = {
            resolutionKey,
            validity: previous?.validity ?? null,
        };
        outputStates.set(el, state);
        if ('error' in resolution) {
            state.error = resolution.message;
            writeOutputValue(el, '');
            applyOutputValidity(ctx, el, state, false);
            if (previous?.resolutionKey !== resolutionKey)
                ctx.reportHostError?.({
                    code: resolution.error,
                    message: resolution.message,
                    element: el,
                });
            continue;
        }
        state.bucket = resolution.bucket;
        state.level = resolution.level;
        const aggregate =
            levels.get(resolution.level)?.byBucket.get(resolution.bucket) ??
            ctx.aggregateOf(resolution.level).get(resolution.bucket);
        writeOutputValue(el, aggregate?.rendered ?? '');
        applyOutputValidity(ctx, el, state, aggregate?.stale === true);
    }
}

/** Write an output's value, announcing a change the way an edit would. */
function writeOutputValue(el: HTMLElement, rendered: string): void {
    if (holdsValue(el)) {
        if (el.value === rendered) return;
        el.value = rendered;
        el.dispatchEvent(realmEvent(el, 'Event', 'input', { bubbles: true }));
        el.dispatchEvent(realmEvent(el, 'Event', 'change', { bubbles: true }));
    } else if (el.textContent !== rendered) {
        el.textContent = rendered;
    }
}

/**
 * Carry an output's state as its validity: a host error, or a value that may be
 * missing markings (the instance could not read everything, or the store holds
 * this bucket from an earlier rollup). Clearing removes only the message this
 * runtime set, so a host's own message survives.
 */
function applyOutputValidity(
    ctx: FormsContext,
    el: HTMLElement,
    state: OutputState,
    stale: boolean,
): void {
    const message =
        state.error ??
        (stale || instanceIncomplete.get(ctx) === true
            ? t('rollup.incomplete')
            : null);
    const field = holdsValue(el) ? el : null;
    if (message) {
        field?.setCustomValidity(message);
        el.setAttribute('aria-invalid', 'true');
        state.validity = message;
        return;
    }
    if (state.validity !== null) {
        // A field barred from constraint validation (a hidden input) reports no
        // message, so only a validated field can show that a host replaced
        // this one.
        if (
            field &&
            (!field.willValidate || field.validationMessage === state.validity)
        )
            field.setCustomValidity('');
        el.removeAttribute('aria-invalid');
        state.validity = null;
    }
}

/**
 * Mark every output this instance owns as possibly missing markings, or clear
 * that. The instance calls it from `refreshIncomplete` with what it knows it
 * could not read: a text area that did not scan all of its text, an aggregate
 * the store holds as stale, or a nested instance that says the same.
 */
export function setOutputsIncomplete(
    ctx: FormsContext,
    incomplete: boolean,
): void {
    instanceIncomplete.set(ctx, incomplete);
    for (const el of ownedOutputs(ctx)) {
        const state = outputStates.get(el);
        if (!state) continue;
        const stale =
            state.bucket !== undefined && state.level !== undefined
                ? ctx.aggregateOf(state.level).get(state.bucket)?.stale === true
                : false;
        applyOutputValidity(ctx, el, state, stale);
    }
}

// ---------------------------------------------------------------------------
// Each whole against its parts
// ---------------------------------------------------------------------------

/**
 * Per-whole coverage pass: multi-whole partitioning (binding-model §2/§7). For
 * each whole, read its parts in the part role against it, run one
 * `checkCoverage(parts, whole)` call, write the whole's computed state into
 * `ctx.aggregates`, and dispatch coverage events on the parts. A change to the
 * whole is checked here too: when the whole's rendered string shifts, every
 * part currently in it is re-checked and the failing ones receive a fresh
 * `ezclassify:coverage-error` event without any silent change to the part (§7
 * forbids that).
 *
 * A whole and its parts read in one bucket. A part whose Context or scheme
 * differs from its whole's is a host error the binding reports; it is not read
 * against a whole of another rule set.
 */
async function runPartitionCoverage(
    ctx: FormsContext,
    partitions: Map<string, HTMLElement[]>,
    parentIndex: Map<string, HTMLElement>,
    isCurrent: () => boolean,
): Promise<void> {
    if (partitions.size === 0) return;
    if (!ctx.aggregates) ctx.aggregates = new Map();

    type ParentBucket = {
        parentEl: HTMLElement;
        parentId: string;
        scheme: BucketScheme;
        parentRendered: string;
        childEls: HTMLElement[];
        childRendereds: string[];
    };

    const buckets: ParentBucket[] = [];
    const reportByParent = new Map<HTMLElement, CoverageReport | null>();

    for (const [parentId, partEls] of partitions) {
        const parentEl = parentIndex.get(parentId) ?? null;
        if (!parentEl) continue;
        const scheme = schemeFor(ctx, parentEl);
        if (!scheme) continue;
        const childEls = partEls.filter(
            (el) => schemeFor(ctx, el)?.bucket === scheme.bucket,
        );
        buckets.push({
            parentEl,
            parentId,
            scheme,
            parentRendered: getElementRendered(ctx, parentEl).rendered,
            childEls,
            childRendereds: childEls.map(
                (el) => getElementRendered(ctx, el).rendered,
            ),
        });
    }

    if (buckets.length === 0) return;

    // Whether each whole reads as a valid marking. Its coverage is checked
    // only while it does: an invalid whole says nothing about what its parts
    // may carry, and it is checked again once it is valid. The engine holds
    // each part to the same rule when it compares the part with its whole.
    const parentValid = new Map<HTMLElement, boolean>();
    await Promise.all(
        buckets.map(async (bucket) => {
            if (!bucket.parentRendered) {
                parentValid.set(bucket.parentEl, true);
                return;
            }
            try {
                const result = await processRollupMarking(
                    ctx,
                    bucket.scheme,
                    bucket.parentRendered,
                    { role: 'whole' },
                );
                parentValid.set(bucket.parentEl, result.valid);
            } catch {
                parentValid.set(bucket.parentEl, false);
            }
        }),
    );
    if (!isCurrent()) return;

    await Promise.all(
        buckets.map(async (bucket) => {
            if (
                !bucket.parentRendered ||
                parentValid.get(bucket.parentEl) === false
            ) {
                reportByParent.set(bucket.parentEl, null);
                return;
            }
            const nonEmptyChildren = bucket.childRendereds.filter((c) => !!c);
            if (nonEmptyChildren.length === 0) {
                reportByParent.set(bucket.parentEl, null);
                return;
            }
            try {
                const report = await Promise.resolve(
                    bucket.scheme.checkCoverage(
                        nonEmptyChildren,
                        bucket.parentRendered,
                        { outputFormat: ctx.defaultFormat },
                    ),
                );
                reportByParent.set(bucket.parentEl, report);
            } catch {
                // Coverage the engine cannot certify is not a finding about
                // the parts; there is nothing to report until it can.
                reportByParent.set(bucket.parentEl, null);
            }
        }),
    );
    if (!isCurrent()) return;

    // A whole whose editable field judges it against its parts reports its own
    // coverage error and fixes. The rollup adds nothing beside it: one source.
    const coverageTargets = indexCoverageTargets(ctx);
    const owned = new Set(
        buckets
            .filter((bucket) =>
                coverageTargets.owns(bucket.parentId, bucket.parentEl),
            )
            .map((bucket) => bucket.parentEl),
    );

    for (const bucket of buckets) {
        if (!isCurrent()) return;
        const writable = coverageTargets.writable(
            bucket.parentId,
            bucket.parentEl,
        );
        if (owned.has(bucket.parentEl)) {
            removeCoverageAction(writable);
            continue;
        }
        let actionReport = reportByParent.get(bucket.parentEl) ?? null;
        if (
            !bucket.parentRendered &&
            bucket.childRendereds.some(Boolean) &&
            coverageTargets.hasInteractiveAuthor(bucket.parentId)
        ) {
            // The store's rollup of the parts' facts, in the whole's bucket.
            const parts = ctx
                .aggregateOf(bucket.parentId)
                .get(bucket.scheme.bucket);
            if (parts?.rendered) {
                // An empty whole lacks everything its parts need and carries
                // nothing of its own, so nothing is in excess.
                actionReport = {
                    covered: false,
                    missing: parts.assertions,
                    missingLabels: [],
                    excess: [],
                    excessLabels: [],
                    rendered: parts.rendered,
                };
            }
        }
        syncCoverageAction(
            ctx,
            bucket.parentId,
            writable,
            bucket.parentRendered,
            actionReport,
        );
    }

    // Publish per-whole state. Each whole's EzClassifyState reflects its own
    // coverage outcome; a failed coverage marks the whole's slot invalid without
    // touching any part (§7).
    for (const bucket of buckets) {
        if (!isCurrent()) return;
        const report = reportByParent.get(bucket.parentEl) ?? null;
        const renderedForState = report?.rendered ?? bucket.parentRendered;
        const state: EzClassifyState = {
            rendered: renderedForState,
            renders: {},
            assertions: [],
            valid: report ? report.covered : true,
            errors: [],
        };
        ctx.aggregates.set(bucket.parentId, { el: bucket.parentEl, state });
        dispatchParentValidation(
            bucket,
            renderedForState,
            report,
            !owned.has(bucket.parentEl),
        );
    }

    // Per-part validation: dispatch the general ezclassify:validation event,
    // plus ezclassify:coverage-error per binding-model §7 when a part exceeds
    // its whole.
    await validateChildrenAgainstParents(
        ctx,
        buckets,
        reportByParent,
        isCurrent,
    );
}

function dispatchParentValidation(
    bucket: {
        parentEl: HTMLElement;
        parentRendered: string;
        scheme: BucketScheme;
    },
    rolledUp: string,
    report: CoverageReport | null,
    notice: boolean,
): void {
    const { parentEl, parentRendered } = bucket;
    if (!parentRendered || !rolledUp || !report) {
        dispatchValidation(parentEl, {
            valid: true,
            parentRendered: '',
            childRendered: '',
        });
        return;
    }
    if (report.covered) {
        dispatchValidation(parentEl, {
            valid: true,
            parentRendered,
            childRendered: rolledUp,
        });
        return;
    }
    const vocabulary = bucket.scheme.getSchemeMeta().vocabulary;
    const wholeLabel = roleNoun(vocabulary, 'whole');
    const partLabel = roleNoun(vocabulary, 'part');
    const excess =
        report.excessLabels.length > 0
            ? `carries ${report.excessLabels.join(', ')} beyond what the ${roleNoun(vocabulary, 'part', 2)} allow`
            : '';
    let error: string;
    if (report.missingLabels.length > 0) {
        const missing = `${capitalize(wholeLabel)} marking does not cover ${partLabel} content: missing ${report.missingLabels.join(', ')}`;
        error = excess ? `${missing}, and ${excess}` : missing;
    } else if (excess) {
        error = `${capitalize(wholeLabel)} marking ${excess}`;
    } else {
        error = `${capitalize(wholeLabel)} marking does not match computed ${partLabel} rollup ${rolledUp}`;
    }
    dispatchValidation(
        parentEl,
        {
            valid: false,
            parentRendered,
            childRendered: rolledUp,
            error,
        },
        notice,
    );
}

/**
 * The constraint id of the error the engine gives a part that exceeds its
 * whole: the whole lacks something the part needs, or carries something the
 * part does not allow. The engine compares a part with its whole whenever the
 * whole reads as a valid marking and the part is valid on its own.
 */
const EXCEEDS_WHOLE = '_exceeds_whole';

/**
 * Per-whole part validation. Reads each part through the engine in the part
 * role with its whole as `partOf` (cached), and dispatches the general
 * `ezclassify:validation` event on each part, plus the coverage-specific
 * `ezclassify:coverage-error` event on each part that exceeds its whole.
 *
 * Whether a part exceeds its whole is the part's own result: the engine reports
 * it as the part's `_exceeds_whole` error. The rollup attributes nothing
 * itself, so a part under a clean whole stays clean when an unrelated whole on
 * the same page fails coverage, and a part is never faulted for a finding no
 * single part causes, which stays on the whole.
 */
async function validateChildrenAgainstParents(
    ctx: FormsContext,
    buckets: Array<{
        parentEl: HTMLElement;
        parentId: string;
        scheme: BucketScheme;
        parentRendered: string;
        childEls: HTMLElement[];
        childRendereds: string[];
    }>,
    reportByParent: Map<HTMLElement, CoverageReport | null>,
    isCurrent: () => boolean,
): Promise<void> {
    type ChildInfo = {
        rendered: string;
        exceeds: ValidationError[];
    };
    const childProcessed = new Map<HTMLElement, ChildInfo>();

    await Promise.all(
        buckets.flatMap((bucket) =>
            bucket.childEls.map(async (childEl, i) => {
                const childRendered = bucket.childRendereds[i];
                const partContext = bucket.parentRendered
                    ? {
                          role: 'part' as const,
                          partOf: { rendered: bucket.parentRendered },
                      }
                    : { role: 'part' as const };
                let processed: ProcessResult;
                try {
                    processed = await processRollupMarking(
                        ctx,
                        bucket.scheme,
                        childRendered,
                        partContext,
                    );
                } catch {
                    // A part the engine cannot read against its whole reports
                    // that through its own field; the rollup leaves it alone.
                    return;
                }
                if (!isCurrent()) return;
                const errors = processed.errors ?? [];
                childProcessed.set(childEl, {
                    rendered: processed.rendered,
                    exceeds: errors.filter(
                        ({ constraintId }) => constraintId === EXCEEDS_WHOLE,
                    ),
                });
                componentOf(ctx, childEl)?.updateValidationErrors?.(
                    errors,
                    processed.proposedFixes ?? [],
                    processed.warnings ?? [],
                );
            }),
        ),
    );
    if (!isCurrent()) return;

    for (const bucket of buckets) {
        if (!isCurrent()) return;
        const report = reportByParent.get(bucket.parentEl) ?? null;
        for (const childEl of bucket.childEls) {
            if (!isCurrent()) return;
            const child = childProcessed.get(childEl);
            if (!child) continue;
            if (child.exceeds.length === 0) {
                dispatchValidation(childEl, {
                    valid: true,
                    parentRendered: bucket.parentRendered,
                    childRendered: child.rendered,
                });
                continue;
            }

            // A component shows the engine's error with the rest of its rule
            // errors, so only a field with none gets the notice: the same
            // error is never shown twice.
            dispatchValidation(
                childEl,
                {
                    valid: false,
                    parentRendered: bucket.parentRendered,
                    childRendered: child.rendered,
                    error: child.exceeds
                        .map(({ message }) => message)
                        .join(' '),
                },
                !componentOf(ctx, childEl),
            );

            // Binding-model §7: every failure surfaces as ezclassify:coverage-error
            // on the part. The library never changes the part to fit a changed
            // whole; the author resolves the conflict.
            childEl.dispatchEvent(
                realmEvent(
                    childEl,
                    'CustomEvent',
                    'ezclassify:coverage-error',
                    {
                        bubbles: true,
                        detail: {
                            childId: childEl.id,
                            parentId: bucket.parentId,
                            childRendered: child.rendered,
                            parentRendered: bucket.parentRendered,
                            report,
                        },
                    },
                ),
            );
        }
    }
}

// ---------------------------------------------------------------------------
// Conditional sections
// ---------------------------------------------------------------------------

/** Clear assertions from all ezclassify components inside an element */
function clearChildComponentAssertions(
    ctx: FormsContext,
    container: HTMLElement,
): void {
    for (const [el, comp] of ctx.mounted) {
        if (container.contains(el) && comp.getAssertions().length > 0) {
            comp.setAssertions([]);
        }
    }
}

/**
 * Show/hide elements based on whether a marking has specific concept
 * assertions.
 *
 * Elements with
 * `data-ezclassify-show-when-parent-has="markingId:CONCEPT1,CONCEPT2"` are
 * shown when the marking has ANY of the listed concepts, hidden otherwise.
 *
 * Elements with
 * `data-ezclassify-hide-when-parent-has="markingId:CONCEPT1,CONCEPT2"` are
 * hidden when the marking has ANY of the listed concepts, shown otherwise.
 */
function processConditionalElements(
    ctx: FormsContext,
    parentIndex: Map<string, HTMLElement>,
    selector: string,
    showWhenMatch: boolean,
    isCurrent: () => boolean,
): void {
    const els = ctx.root.querySelectorAll<HTMLElement>(`[${selector}]`);
    for (const el of els) {
        if (!isCurrent()) return;
        const attr = el.getAttribute(selector);
        if (!attr) continue;
        const colonIdx = attr.indexOf(':');
        if (colonIdx < 0) continue;
        const parentId = attr.slice(0, colonIdx);
        const conceptList = attr.slice(colonIdx + 1);
        if (!parentId || !conceptList) continue;

        const concepts = conceptList.split(',').map((s) => s.trim());
        const parentEl = parentIndex.get(parentId) ?? null;
        if (!parentEl) {
            if (showWhenMatch) el.style.display = 'none';
            continue;
        }

        const parent = getElementRendered(ctx, parentEl);
        const hasAnyConcept = parent.assertions.some((a) =>
            concepts.includes(a.conceptId),
        );
        const wasVisible = el.style.display !== 'none';
        const shouldBeVisible = showWhenMatch ? hasAnyConcept : !hasAnyConcept;
        el.style.display = shouldBeVisible ? '' : 'none';

        // When a section hides, clear its child component assertions
        if (wasVisible && !shouldBeVisible) {
            clearChildComponentAssertions(ctx, el);
        }
    }
}

async function updateConditionalVisibility(
    ctx: FormsContext,
    parentIndex: Map<string, HTMLElement>,
    isCurrent: () => boolean,
): Promise<void> {
    processConditionalElements(
        ctx,
        parentIndex,
        'data-ezclassify-show-when-parent-has',
        true,
        isCurrent,
    );
    if (!isCurrent()) return;
    processConditionalElements(
        ctx,
        parentIndex,
        'data-ezclassify-hide-when-parent-has',
        false,
        isCurrent,
    );
}

/**
 * Copy the field's rendered marking, scheme metadata, and assertions to the
 * clipboard.
 */
export async function copyMarkingToClipboard(
    ctx: FormsContext,
    field: HTMLInputElement,
): Promise<void> {
    const lastValid = ctx.lastValidated.get(field) ?? field.value.trim();
    if (!lastValid) return;
    const scheme = schemeFor(ctx, field);
    if (!scheme) return;

    const format = getFormat(ctx, field);
    // Copying reads the stored marking; nothing here corrects it.
    const result = await Promise.resolve(
        scheme.validate(lastValid, {
            outputFormat: format,
            ...(showsStandalonePart(field)
                ? { context: { role: 'part' as const } }
                : {}),
        }),
    );
    const meta = scheme.getSchemeMeta();
    const assertions = result.assertions.map((a) => a.conceptId).join(', ');

    const text = [
        result.rendered,
        '---',
        `Scheme: ${meta.name} v${meta.version}`,
        `Format: ${format}`,
        `Assertions: ${assertions}`,
        `Valid: ${result.valid}`,
    ].join('\n');

    try {
        await navigator.clipboard.writeText(text);
        showCopiedIndicator(field);
    } catch {
        // Clipboard API may be unavailable
    }
}
