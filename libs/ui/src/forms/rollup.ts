import type { FormsContext, FieldAssertion } from './types';
import {
    roleNoun,
    type Assertion,
    type AggregateResult,
    type CoverageReport,
    type ProcessResult,
    type ValidationError,
    type Vocabulary,
} from '@ezclassify/types';
import type { EzClassifyState } from '../store/ezclassify-store';
import { cssEscape } from './types';
import { getFormat, toFieldAssertions } from './state';
import { showCopiedIndicator } from './dom';
import { getMountHost } from '../mount-host-registry';
import * as registry from '../mount-rollup-registry';
import {
    indexCoverageTargets,
    removeCoverageAction,
    syncCoverageAction,
} from '../components/coverage-action';
import {
    defaultSchemeOf,
    isAddressableSchemeEngine,
    resolveProfile,
} from '../components/component-base-readonly';

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

/** One contributing field's identity and value in the rollup. */
export interface ContributionDescriptor {
    /** The field's rendered (or raw) value that was contributed. */
    value: string;
    /**
     * The id of the source element. For hidden synthetic inputs inside a
     * marked-textarea, this resolves to the parent textarea's id; not the
     * hidden field's auto-generated id.
     */
    sourceId: string;
    /**
     * A human-readable label for the source element. Resolution order:
     * aria-label → <label for=id> text → placeholder → id.
     */
    sourceLabel: string;
    /** Data-ezclassify-controller value of the source element, or null. */
    controller: string | null;
}

/**
 * Resolve a display label for an element. Priority: aria-label → <label for=id>
 * text → placeholder → id.
 */
function resolveLabel(el: HTMLElement): string {
    const aria = el.getAttribute('aria-label');
    if (aria) return aria;
    const id = el.id;
    if (id) {
        const doc = el.ownerDocument ?? document;
        const label = doc.querySelector<HTMLElement>(
            `label[for="${cssEscape(id)}"]`,
        );
        const labelText = label?.textContent?.trim();
        if (labelText) return labelText;
    }
    const placeholder = (el as HTMLInputElement).placeholder;
    if (placeholder) return placeholder;
    return id ?? '';
}

/**
 * Resolve the field a contribution is attributed to.
 *
 * A controller can contribute through synthetic fields it keeps inside its own
 * mount container (a marked text area keeps one hidden field per marking it
 * finds in the body text). The person-facing field is the host the mount was
 * created for, which the mount-host registry records. DOM position cannot name
 * it: a text editor field moves its host into a wrapper, and a host page can
 * place other elements between that wrapper and the mount.
 */
function resolveContributionSource(el: HTMLElement): {
    sourceId: string;
    sourceLabel: string;
    controller: string | null;
} {
    const mount = el.closest<HTMLElement>('[data-ezclassify-mount]');
    const host = mount ? getMountHost(mount) : undefined;
    if (mount && host) {
        return {
            sourceId: host.id ?? '',
            sourceLabel: resolveLabel(host),
            controller:
                host.getAttribute('data-ezclassify-controller') ??
                mount.getAttribute('data-ezclassify-mount'),
        };
    }
    return {
        sourceId: el.id ?? '',
        sourceLabel: resolveLabel(el),
        controller: el.getAttribute('data-ezclassify-controller'),
    };
}

//
// The rollup flow validates a tree of related markings on every form change:
// one `process()` per parent, one per child pair. With N parts + M unique
// parents, one keystroke can produce O(N+M) engine calls, and every call is a
// network round-trip under EzClassifyClient.
//
// We cache the result of `process(rendered, { format, context })` keyed by the
// tuple (schemeId, rendered, role, partOfRendered). The cache is LRU with a
// cap of 256 entries, large enough to hold the common work of a form session
// (typically 10–30 distinct markings × 2 roles), small enough to survive long
// sessions without leaking memory. Cleared on session destroy and exposed as
// `clearRollupProcessCache()` for tests.
//
// Each engine gets its own partition. A page may register several contexts, and
// two of them can carry the same scheme id over a different guide or access
// composition, which is exactly what decides whether a marking validates. A
// single shared table keyed on the scheme id alone would hand one context's
// answer to the other, and one context's teardown would throw away every other
// context's work.
interface ProcessCacheKey {
    schemeId: string;
    rendered: string;
    role: 'whole' | 'part';
    partOfRendered: string;
    format: string;
}

const MAX_CACHE_ENTRIES = 256;

/** One LRU table per engine, plus the generation it was created under. */
interface EnginePartition {
    generation: number;
    entries: Map<string, ProcessResult>;
    pending: Map<string, Promise<ProcessResult>>;
}

const processCaches = new WeakMap<object, EnginePartition>();

// Bumped by a clear-all. Partitions are held weakly, so there is no list to walk
// and no way to empty them one by one; a stale generation retires a partition on
// its next use instead. Holding the engines strongly to get that list would keep
// a destroyed session's engine and its results alive.
let cacheGeneration = 0;

/** The cache for `engine`, rebuilt if a clear-all has happened since. */
function partitionFor(engine: object): EnginePartition {
    const existing = processCaches.get(engine);
    if (existing && existing.generation === cacheGeneration) {
        return existing;
    }
    const fresh: EnginePartition = {
        generation: cacheGeneration,
        entries: new Map<string, ProcessResult>(),
        pending: new Map<string, Promise<ProcessResult>>(),
    };
    processCaches.set(engine, fresh);
    return fresh;
}

function cacheKey(k: ProcessCacheKey): string {
    return `${k.schemeId}\x1f${k.role}\x1f${k.format}\x1f${k.partOfRendered}\x1f${k.rendered}`;
}

/**
 * Run `engine.process` through the rollup LRU cache so repeated rollup
 * validations of the same (profile, role, rendered, partOf) tuple reuse their
 * prior result instead of re-hitting the engine or the wire.
 */
export async function processRollupMarking(
    ctx: FormsContext,
    schemeId: string,
    rendered: string,
    context: { role: 'whole' | 'part'; partOf?: { rendered: string } },
): Promise<ProcessResult> {
    const key = cacheKey({
        schemeId,
        rendered,
        role: context.role,
        partOfRendered: context.partOf?.rendered ?? '',
        format: ctx.defaultFormat,
    });
    const partition = partitionFor(ctx.engine);
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
        ctx.schemeAddressing && isAddressableSchemeEngine(ctx.engine)
            ? ctx.engine.process(rendered, schemeId, {
                  outputFormat: ctx.defaultFormat,
                  context,
              })
            : ctx.engine.process(rendered, {
                  outputFormat: ctx.defaultFormat,
                  context,
              }),
    )
        .then((result) => {
            partition.entries.set(key, result as ProcessResult);
            // Evict oldest when over the cap.
            if (partition.entries.size > MAX_CACHE_ENTRIES) {
                const oldestKey = partition.entries.keys().next().value;
                if (oldestKey !== undefined)
                    partition.entries.delete(oldestKey);
            }
            return result as ProcessResult;
        })
        .finally(() => partition.pending.delete(key));
    partition.pending.set(key, pending);
    return pending;
}

/**
 * Clear the rollup process cache.
 *
 * @param engine - Clear only this engine's partition. Omit to clear every
 *   partition, which is what a test wants between cases.
 */
export function clearRollupProcessCache(engine?: object): void {
    if (engine) {
        contributionRollups.delete(engine);
        processCaches.delete(engine);
        return;
    }
    contributionRollups = new WeakMap();
    cacheGeneration++;
}

/**
 * Resolve the profile id for a rollup-contributing element. Components carry
 * their resolved schemeId on a private `schemeId` field (set in init via
 * resolveProfile). Unenhanced inputs use that same resolver so an ambiguous
 * multi-scheme page cannot silently assign them to the primary scheme.
 */
function profileIdForElement(ctx: FormsContext, el: HTMLElement): string {
    const comp =
        ctx.mounted.get(el) ?? ctx.autocompleters.get(el as HTMLInputElement);
    // Components carry the resolved schemeId: read it directly.
    if (comp) {
        const fromComp = (comp as unknown as { schemeId?: string }).schemeId;
        if (fromComp) return fromComp;
    }
    return resolveProfile(el, ctx.engine, undefined, ctx.schemeAddressing);
}

/** Set `data-rendered-<schemeId>` on the rollup target; remove stale entries. */
function setPerProfileRendered(
    target: HTMLElement,
    byScheme: Map<string, string>,
): void {
    // Remove any data-rendered-* attribute whose scheme isn't in the new set.
    for (const attr of Array.from(target.attributes)) {
        if (!attr.name.startsWith('data-rendered-')) continue;
        const id = attr.name.slice('data-rendered-'.length);
        if (!byScheme.has(id)) target.removeAttribute(attr.name);
    }
    for (const [schemeId, rendered] of byScheme) {
        target.setAttribute(`data-rendered-${schemeId}`, rendered);
    }
}

/**
 * Group every part-of child by the id of its declared parent marking; see
 * binding-model §2. The map's keys are parent marking-ids (never empty); values
 * are the live child elements that point at that parent. Iteration order
 * matches insertion order in `ctx.partOfMap`.
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
 * The marking an element holds, as the rollup reads it: the store's committed
 * value where the store has one (see FormsContext.committedRendering), else an
 * enhanced field's component rendering, or an unenhanced field's own value.
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
async function getElementRendered(
    ctx: FormsContext,
    el: HTMLElement,
): Promise<{ rendered: string; assertions: FieldAssertion[] }> {
    // Every enhanced field has a component with cached assertions; use it
    const comp = componentOf(ctx, el);
    return {
        rendered: elementRendered(ctx, el),
        assertions: comp ? toFieldAssertions(comp.getAssertions()) : [],
    };
}

/**
 * Build a one-shot id → element index over all fields and components, so a
 * rollup pass that resolves many declared parents (each a
 * `data-ezclassify-part-of` target, identified by its `id`) does one linear
 * build and then O(1) lookups, instead of a per-parent rescan of every field
 * and component (O(parents × elements) → O(elements + parents)). Precedence:
 * fields win over components, and the first match for a given id wins within
 * each; so `buildParentIndex(ctx).get(id) ?? null` resolves the whole/context
 * element for a part exactly as a fields-then-components search would.
 */
function buildParentIndex(ctx: FormsContext): Map<string, HTMLElement> {
    const index = new Map<string, HTMLElement>();
    for (const f of ctx.fields) {
        if (f.id && !index.has(f.id)) index.set(f.id, f);
    }
    for (const [el] of ctx.mounted) {
        if (el.id && !index.has(el.id)) index.set(el.id, el);
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
            // Insert AFTER the visible component: which, for interactive
            // autocompleters, is a sibling div that declarative-attrs added
            // immediately after the now-hidden native input. A plain
            // `closest('[data-ezclassify-mount]')` search walks UP from the
            // native input and never finds the sibling mount, so the notice
            // ended up inserted before the mount (i.e., visually ABOVE the
            // autocomplete). Look at the next sibling first, fall back to
            // ancestor lookup for read-only components that mount in place.
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
 * Debounce window (ms) for collapsing async rollup bursts: e.g. when multiple
 * hidden fields complete their async renders at slightly different times, we
 * want the rollup to fire ONCE after the last one, not once per completion.
 * Each rollup runs ~5 engine calls, so collapsing 4 bursts into 1 saves ~15
 * round-trips.
 */
const ROLLUP_DEBOUNCE_MS = 30;

/**
 * Recalculate the aggregate marking from all visible form fields and
 * components. Debounces async bursts: multiple calls within ROLLUP_DEBOUNCE_MS
 * are collapsed into a single rollup run after the quiet period. Each call's
 * returned promise resolves after that single run completes.
 */
export function updateRollup(ctx: FormsContext): Promise<void> {
    if (!ctx.rollupField) return Promise.resolve();
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
            // Swallow any error so a deferred rollup can never surface as an unhandled
            // rejection; the rollup is display-only and self-heals on the next input.
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
 * Run a rollup immediately, bypassing the {@link updateRollup} debounce timer.
 * Used by the cross-instance contribution path: when a child scope's whole
 * changes it calls its parent's flush synchronously so the parent re-aggregates
 * within the child's settle window instead of waiting out a second debounce.
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

let contributionRollups = new WeakMap<
    object,
    Map<string, Promise<AggregateResult>>
>();

/**
 * Reuse an unchanged contribution rollup only when the canonical metadata
 * explicitly proves the scheme does not read whole-dependent rules. Coverage
 * remains a separate operation against the current whole. Missing metadata is
 * not evidence of independence, including adapters from an older deployment.
 */
export function aggregateRollupMarkings(
    ctx: FormsContext,
    inputs: string[],
    schemeId?: string,
): Promise<AggregateResult> {
    let independent = false;
    let identity: [string, string] | undefined;
    try {
        const metadata =
            ctx.schemeAddressing && isAddressableSchemeEngine(ctx.engine)
                ? ctx.engine.getSchemeMeta(schemeId)
                : ctx.engine.getSchemeMeta();
        independent = metadata.roleAware === false;
        identity = [metadata.id, metadata.version];
    } catch {
        /* Unknown adapters must recompute. */
    }
    const key = JSON.stringify([
        identity,
        schemeId ?? null,
        ctx.defaultFormat,
        inputs,
    ]);
    let cache = contributionRollups.get(ctx.engine);
    if (independent && cache?.has(key)) return cache.get(key)!;
    let result: Promise<AggregateResult>;
    try {
        // Invoke now, as the uncached rollup did. Deferring the call itself
        // changes the ordering of edits and controlled asynchronous aggregates.
        result = Promise.resolve(
            ctx.schemeAddressing &&
                schemeId &&
                isAddressableSchemeEngine(ctx.engine)
                ? ctx.engine.aggregate(inputs, schemeId, {
                      outputFormat: ctx.defaultFormat,
                  })
                : ctx.engine.aggregate(inputs, {
                      outputFormat: ctx.defaultFormat,
                  }),
        );
    } catch (error) {
        result = Promise.reject(error);
    }
    if (independent) {
        if (!cache) {
            cache = new Map();
            contributionRollups.set(ctx.engine, cache);
        }
        // A mounted page can edit indefinitely; keep only its recent inputs.
        if (cache.size >= MAX_CACHE_ENTRIES)
            cache.delete(cache.keys().next().value!);
        cache.set(key, result);
        void result.catch(() => {
            if (cache?.get(key) === result) cache.delete(key);
        });
    }
    return result;
}

async function runRollupNow(ctx: FormsContext): Promise<void> {
    if (!ctx.rollupField) return;
    if (ctx.initializing) return;

    const seq = ++rollupSeq;
    pendingRollups.set(ctx, seq);
    const isCurrent = () =>
        !!ctx.rollupField && pendingRollups.get(ctx) === seq;
    await Promise.resolve();
    if (!isCurrent()) return;
    // Read every contributor from one settled state: a pass taken while a
    // marking is being read again would combine old and new values, and which
    // ones depends on the order the engine answered in. The store's return to
    // idle runs the pass.
    if (ctx.whenStoreIdle && !ctx.whenStoreIdle(() => void updateRollup(ctx)))
        return;

    // Collect (rendered, schemeId) pairs from fields and components in the
    // default scope. Scoped components (authority, declass, etc.) are excluded
    // because they have their own rollup if needed.
    const valuesByScheme = new Map<string, string[]>();
    const contributions: ContributionDescriptor[] = [];
    const pushValue = (schemeId: string, rendered: string) => {
        if (!rendered) return;
        let bucket = valuesByScheme.get(schemeId);
        if (!bucket) {
            bucket = [];
            valuesByScheme.set(schemeId, bucket);
        }
        bucket.push(rendered);
    };

    // Group facets by their shared marking ID.
    // Facet leaves (data-ezclassify-facet-of) are category-scoped views of a
    // parent marking. Their rendered strings can include sibling categories,
    // so the parent marking is the one value this group contributes.
    type FacetGroup = { values: string[]; schemeId: string };
    const facetParentIndex = buildParentIndex(ctx);
    const facetGroupsByParent = new Map<string, FacetGroup>();
    for (const f of ctx.fields) {
        const parentId = f.getAttribute('data-ezclassify-facet-of');
        if (!parentId) continue;
        const g = facetGroupsByParent.get(parentId) ?? {
            values: [],
            schemeId: profileIdForElement(ctx, f),
        };
        if (!facetParentIndex.has(parentId)) {
            const raw = f.value.trim();
            if (raw) g.values.push(raw);
        }
        facetGroupsByParent.set(parentId, g);
    }
    for (const [el, comp] of ctx.mounted) {
        const parentId = el.getAttribute('data-ezclassify-facet-of');
        if (!parentId) continue;
        const g = facetGroupsByParent.get(parentId) ?? {
            values: [],
            schemeId: profileIdForElement(ctx, el),
        };
        if (!facetParentIndex.has(parentId)) {
            const rendered = comp.getRendered();
            if (rendered) g.values.push(rendered);
        }
        facetGroupsByParent.set(parentId, g);
    }
    const facetParentIds = new Set(facetGroupsByParent.keys());

    for (const f of ctx.fields) {
        if (f.hasAttribute('data-ezclassify-no-rollup')) continue;
        if (f.getAttribute('data-ezclassify-scope')) continue;
        if (f.getAttribute('data-ezclassify-facet-of')) {
            continue;
        }
        if (f.id && facetParentIds.has(f.id)) continue; // parent: added in facet-group pass below
        const raw = ctx.committedRendering?.(f) ?? f.value.trim();
        if (raw) {
            pushValue(profileIdForElement(ctx, f), raw);
            contributions.push({ value: raw, ...resolveContributionSource(f) });
        }
    }

    for (const [el, comp] of ctx.mounted) {
        if (el.getAttribute('data-ezclassify-scope')) continue;
        if (el.hasAttribute('data-ezclassify-no-rollup')) continue;
        if (el.getAttribute('data-ezclassify-facet-of')) {
            continue;
        }
        if (el.id && facetParentIds.has(el.id)) continue; // parent: added in facet-group pass below
        const rendered = ctx.committedRendering?.(el) ?? comp.getRendered();
        if (rendered) {
            pushValue(profileIdForElement(ctx, el), rendered);
            contributions.push({
                value: rendered,
                ...resolveContributionSource(el),
            });
        }
    }

    // Add one value and contribution row per facet group. The parent is the
    // canonical combined marking. A sibling facet may still hold its previous
    // whole-valued render after a change, so aggregating leaves here can make a
    // lowered tier appear to remain at its old rank. Without a parent, combine
    // the leaves through the engine before contributing the group.
    for (const [parentId, group] of facetGroupsByParent) {
        const parentEl = facetParentIndex.get(parentId) ?? null;
        if (
            parentEl?.hasAttribute('data-ezclassify-no-rollup') ||
            parentEl?.getAttribute('data-ezclassify-scope')
        ) {
            continue;
        }
        let contribValue: string;
        let contribSourceId: string;
        let contribSourceLabel: string;
        let contribController: string | null;

        if (parentEl) {
            const parentComp = ctx.mounted.get(parentEl);
            contribValue = parentComp
                ? parentComp.getRendered()
                : ((parentEl as HTMLInputElement).value?.trim() ?? '');
            const src = resolveContributionSource(parentEl);
            contribSourceId = src.sourceId;
            contribSourceLabel = src.sourceLabel;
            contribController = src.controller;
        } else {
            if (group.values.length === 0) continue;
            // No parent element in the DOM: combine the leaf values for display.
            const aggResult = await aggregateRollupMarkings(
                ctx,
                group.values,
                group.schemeId,
            );
            if (!isCurrent()) return;
            contribValue = aggResult.rendered;
            contribSourceId = parentId;
            contribSourceLabel = parentId;
            contribController = null;
        }

        if (!contribValue) continue;
        pushValue(group.schemeId, contribValue);
        contributions.push({
            value: contribValue,
            sourceId: contribSourceId,
            sourceLabel: contribSourceLabel,
            controller: contribController,
        });
    }

    // Merge nested child-scope contributions. Each child instance registered
    // under this scope (inferred DOM ancestry, see mount-rollup-registry) feeds
    // its already-rolled-up WHOLE, one per scheme id, into this scope's
    // per-scheme buckets. The child's raw leaf fields are owned solely by the
    // child (the ownership boundary), so the parent never double-counts them; it
    // composes the child's whole exactly like the engine's part→whole model.
    // Distinct scheme ids land in distinct buckets (cross-family independence,
    // never co-aggregated into one engine.aggregate call); the same scheme id
    // co-aggregates losslessly.
    for (const child of registry.childrenOf(ctx.mountInstanceId)) {
        for (const [schemeId, whole] of child.childWholesByScheme()) {
            if (!whole.rendered) continue;
            pushValue(schemeId, whole.rendered);
            contributions.push({
                value: whole.rendered,
                sourceId: child.instanceId,
                sourceLabel: child.instanceId,
                controller: null,
            });
        }
    }

    // Re-check rollupField after async operations: it may have been cleared.
    if (!isCurrent()) return;

    const renderedByScheme = new Map<string, string>();

    for (const [schemeId, vals] of valuesByScheme) {
        if (vals.length === 0) continue;
        const aggregated = await aggregateRollupMarkings(ctx, vals, schemeId);
        if (!isCurrent()) return;
        renderedByScheme.set(schemeId, aggregated.rendered);
    }

    // Choose the value for the rollup input's `.value` field.
    // Single-scheme contribution → use that scheme's rendered rollup.
    // Multi-scheme contribution → prefer the engine's default scheme, else the
    // first contributing scheme, else empty. Combined-render output is deferred.
    let newValue = '';
    if (renderedByScheme.size === 1) {
        newValue = renderedByScheme.values().next().value ?? '';
    } else if (renderedByScheme.size > 1) {
        const defaultId = defaultSchemeOf(ctx.engine)?.id;
        if (defaultId && renderedByScheme.has(defaultId)) {
            newValue = renderedByScheme.get(defaultId) ?? '';
        } else {
            newValue = renderedByScheme.values().next().value ?? '';
        }
    }

    // Always update the per-scheme data-rendered-* attributes so multi-scheme
    // pages can read each scheme's rolled-up marking off the target element.
    setPerProfileRendered(ctx.rollupField, renderedByScheme);

    // Publish this scope's per-scheme wholes upstream. The owning instance
    // records them and, if its contribution changed, synchronously re-aggregates
    // its parent scope (depth-2+ settle): bypassing the parent's debounce so a
    // leaf edit reaches the page banner within this settle window.
    ctx.onRollupComputed?.(renderedByScheme);
    if (!isCurrent()) return;

    const changed = ctx.rollupField.value !== newValue;

    if (changed) {
        ctx.rollupField.value = newValue;
        ctx.rollupField.dispatchEvent(
            realmEvent(ctx.rollupField, 'Event', 'input', { bubbles: true }),
        );
        ctx.rollupField.dispatchEvent(
            realmEvent(ctx.rollupField, 'Event', 'change', { bubbles: true }),
        );
        if (!isCurrent()) return;
        await updateGroupRollups(ctx, isCurrent);
        if (!isCurrent()) return;
    }

    // The value is what the scope could read. Whether that is all of it is a
    // separate fact the rollup field carries as its validity.
    ctx.refreshIncomplete?.(true);

    // Compute assertions for the aggregated rollup value once so every consumer
    // gets them from the event instead of re-processing the same string.
    let rollupAssertions: Assertion[] = [];
    if (newValue) {
        let primarySchemeId: string;
        if (renderedByScheme.size === 1) {
            primarySchemeId = renderedByScheme.keys().next().value ?? '';
        } else {
            const defaultId = defaultSchemeOf(ctx.engine)?.id;
            primarySchemeId =
                renderedByScheme.size > 1 &&
                defaultId &&
                renderedByScheme.has(defaultId)
                    ? defaultId
                    : renderedByScheme.size > 0
                      ? (renderedByScheme.keys().next().value ?? '')
                      : (defaultSchemeOf(ctx.engine)?.id ?? '');
        }
        try {
            const processed = await processRollupMarking(
                ctx,
                primarySchemeId,
                newValue,
                { role: 'whole' },
            );
            if (!isCurrent()) return;
            rollupAssertions = processed.assertions ?? [];
        } catch {
            // leave empty, display-only, not load-bearing
        }
    }

    // Always dispatch ezclassify:rollup so multi-scheme listeners receive the
    // updated byScheme map even when the default-scheme rendered value is
    // unchanged (e.g. adding a second scheme's marking leaves the primary rollup
    // value the same but adds a new entry to byScheme).
    ctx.rollupField.dispatchEvent(
        realmEvent(ctx.rollupField, 'CustomEvent', 'ezclassify:rollup', {
            bubbles: true,
            detail: {
                rendered: newValue,
                byScheme: Object.fromEntries(renderedByScheme),
                contributions,
                assertions: rollupAssertions,
            },
        }),
    );
    if (!isCurrent()) return;

    // Always validate parent-child: a parent may have changed even if the rollup didn't.
    // Per binding-model §16, this runs the partition pass: every distinct parent
    // declared via data-ezclassify-part-of gets its own checkCoverage call.
    if (!ctx.initializing) {
        await runPartitionCoverage(ctx, isCurrent);
        if (!isCurrent()) return;
        await updateConditionalVisibility(ctx, isCurrent);
    }
}

/**
 * Per-parent coverage pass: multi-whole partitioning (binding-model §2/§7). For
 * each declared parent marking, group its child contributors, run one
 * `engine.checkCoverage(children, parent)` call per group, write the parent's
 * computed state into `ctx.aggregates`, and dispatch coverage events on the
 * child elements. Parent-side changes propagate here too, when a parent's
 * rendered string shifts, every child currently pointing at it is re-checked
 * and the failing ones receive a fresh `ezclassify:coverage-error` event
 * without any silent child mutation (§7 forbids that).
 */
async function runPartitionCoverage(
    ctx: FormsContext,
    isCurrent: () => boolean,
): Promise<void> {
    const partitions = partitionContributorsByParent(ctx);
    if (partitions.size === 0) return;
    if (!ctx.aggregates) ctx.aggregates = new Map();

    type ParentBucket = {
        parentEl: HTMLElement;
        parentId: string;
        parentRendered: string;
        childEls: HTMLElement[];
        childRendereds: string[];
        childAssertions: Map<HTMLElement, FieldAssertion[]>;
    };

    const buckets: ParentBucket[] = [];
    const reportByParent = new Map<HTMLElement, CoverageReport | null>();
    const parentIndex = buildParentIndex(ctx);

    for (const [parentId, childEls] of partitions) {
        const parentEl = parentIndex.get(parentId) ?? null;
        if (!parentEl) continue;
        const parentInfo = await getElementRendered(ctx, parentEl);
        if (!isCurrent()) return;
        const childRendereds: string[] = [];
        const childAssertions = new Map<HTMLElement, FieldAssertion[]>();
        for (const childEl of childEls) {
            const r = await getElementRendered(ctx, childEl);
            if (!isCurrent()) return;
            childRendereds.push(r.rendered);
            childAssertions.set(childEl, r.assertions);
        }
        buckets.push({
            parentEl,
            parentId,
            parentRendered: parentInfo.rendered,
            childEls,
            childRendereds,
            childAssertions,
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
                    profileIdForElement(ctx, bucket.parentEl),
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
            const schemeId = profileIdForElement(ctx, bucket.parentEl);
            const nonEmptyChildren = bucket.childRendereds.filter((c) => !!c);
            if (nonEmptyChildren.length === 0) {
                reportByParent.set(bucket.parentEl, null);
                return;
            }
            try {
                const report = await Promise.resolve(
                    ctx.schemeAddressing &&
                        isAddressableSchemeEngine(ctx.engine)
                        ? ctx.engine.checkCoverage(
                              nonEmptyChildren,
                              bucket.parentRendered,
                              schemeId,
                              { outputFormat: ctx.defaultFormat },
                          )
                        : ctx.engine.checkCoverage(
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
        const nonEmptyChildren = bucket.childRendereds.filter(Boolean);
        if (
            !bucket.parentRendered &&
            nonEmptyChildren.length > 0 &&
            coverageTargets.hasInteractiveAuthor(bucket.parentId)
        ) {
            const schemeId = profileIdForElement(ctx, bucket.parentEl);
            const aggregate = await aggregateRollupMarkings(
                ctx,
                nonEmptyChildren,
                schemeId,
            );
            if (!isCurrent()) return;
            if (aggregate.rendered) {
                // An empty whole lacks everything its parts need and carries
                // nothing of its own, so nothing is in excess.
                actionReport = {
                    covered: false,
                    missing: aggregate.assertions ?? [],
                    missingLabels: [],
                    excess: [],
                    excessLabels: [],
                    rendered: aggregate.rendered,
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

    // Publish per-parent aggregate state. Each parent's EzClassifyState reflects
    // its own coverage outcome; a failed coverage marks the parent's slot
    // invalid without touching any child marking (§7).
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
            ctx,
            bucket.parentEl,
            bucket.parentRendered,
            renderedForState,
            report,
            !owned.has(bucket.parentEl),
        );
    }

    // Per-child validation: dispatch the general ezclassify:validation event,
    // plus ezclassify:coverage-error per binding-model §7 when a child
    // contributes to a failed coverage check.
    await validateChildrenAgainstParents(
        ctx,
        buckets,
        reportByParent,
        isCurrent,
    );
}

function dispatchParentValidation(
    ctx: FormsContext,
    parentEl: HTMLElement,
    parentRendered: string,
    rolledUp: string,
    report: CoverageReport | null,
    notice: boolean,
): void {
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
    const schemeId = profileIdForElement(ctx, parentEl);
    const meta = ctx.schemeAddressing
        ? ctx.engine.getScheme(schemeId)
        : ctx.engine.getSchemeMeta();
    const vocabulary = (meta as unknown as { vocabulary?: Vocabulary })
        .vocabulary;
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
 * Per-partition child validation. Walks the buckets produced by
 * `runPartitionCoverage`, reads each child through the engine with its declared
 * parent as `partOf` context (cached), and dispatches the general
 * `ezclassify:validation` event on each child, plus the coverage-specific
 * `ezclassify:coverage-error` event on each child that exceeds its parent.
 *
 * Whether a child exceeds its parent is the child's own result: the engine
 * reports it as the part's `_exceeds_whole` error. The rollup attributes
 * nothing itself, so a child under a clean parent stays clean when an unrelated
 * parent on the same page fails coverage, and a child is never faulted for a
 * finding no single part causes, which stays on the parent.
 */
async function validateChildrenAgainstParents(
    ctx: FormsContext,
    buckets: Array<{
        parentEl: HTMLElement;
        parentId: string;
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

    // Process each child once with its parent's rendered string as partOf
    // context; preserves the engine's parent-aware validation path
    // (e.g. country inheritance) and lets the rollup process-cache reuse
    // results across passes.
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
                        profileIdForElement(ctx, childEl),
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
            // on the child. The library never mutates the child to fit a changed
            // parent; the author resolves the conflict.
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

/**
 * Show/hide elements based on whether a parent element has specific concept
 * assertions.
 *
 * Elements with
 * `data-ezclassify-show-when-parent-has="parentId:CONCEPT1,CONCEPT2"` are shown
 * when the parent has ANY of the listed concepts, hidden otherwise.
 *
 * Elements with
 * `data-ezclassify-hide-when-parent-has="parentId:CONCEPT1,CONCEPT2"` are
 * hidden when the parent has ANY of the listed concepts, shown otherwise.
 */
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

async function processConditionalElements(
    ctx: FormsContext,
    selector: string,
    showWhenMatch: boolean,
    isCurrent: () => boolean,
): Promise<void> {
    const els = ctx.root.querySelectorAll<HTMLElement>(`[${selector}]`);
    if (els.length === 0) return;
    const parentIndex = buildParentIndex(ctx);
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

        const parent = await getElementRendered(ctx, parentEl);
        if (!isCurrent()) return;
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
    isCurrent: () => boolean,
): Promise<void> {
    await processConditionalElements(
        ctx,
        'data-ezclassify-show-when-parent-has',
        true,
        isCurrent,
    );
    if (!isCurrent()) return;
    await processConditionalElements(
        ctx,
        'data-ezclassify-hide-when-parent-has',
        false,
        isCurrent,
    );
}

async function updateGroupRollups(
    ctx: FormsContext,
    isCurrent: () => boolean,
): Promise<void> {
    const groups = new Map<string, HTMLInputElement[]>();
    for (const field of ctx.fields) {
        const group = field.getAttribute('data-ezclassify-group');
        if (group) {
            const list = groups.get(group) ?? [];
            list.push(field);
            groups.set(group, list);
        }
    }

    for (const [groupName, groupFields] of groups) {
        if (!isCurrent()) return;
        const rollupEl = ctx.root.querySelector(
            '#' + cssEscape(groupName + '-rollup'),
        ) as HTMLInputElement | null;
        if (!rollupEl) continue;

        const values: string[] = [];
        const contributions: ContributionDescriptor[] = [];
        for (const f of groupFields) {
            const raw = f.value.trim();
            if (raw) {
                values.push(raw);
                contributions.push({
                    value: raw,
                    ...resolveContributionSource(f),
                });
            }
        }

        let assertions: Assertion[] = [];
        const byScheme: Record<string, string> = {};
        if (values.length === 0) {
            rollupEl.value = '';
        } else {
            // Group rollup uses the rollup target's own scheme id when set, else the
            // engine default. Per-group rollups don't currently mix schemes.
            const groupProfileId =
                rollupEl.getAttribute('data-ezclassify-scheme') ??
                defaultSchemeOf(ctx.engine)?.id;
            const aggregated = await aggregateRollupMarkings(
                ctx,
                values,
                groupProfileId,
            );
            if (!isCurrent()) return;
            rollupEl.value = aggregated.rendered;
            assertions = aggregated.assertions ?? [];
            if (groupProfileId) {
                byScheme[groupProfileId] = aggregated.rendered;
            }
        }
        rollupEl.dispatchEvent(
            realmEvent(rollupEl, 'Event', 'change', { bubbles: true }),
        );

        rollupEl.dispatchEvent(
            realmEvent(rollupEl, 'CustomEvent', 'ezclassify:rollup', {
                bubbles: true,
                detail: {
                    rendered: rollupEl.value,
                    byScheme,
                    contributions,
                    assertions,
                },
            }),
        );
    }
}

/**
 * Copy the field's rendered marking, profile metadata, and assertions to the
 * clipboard.
 */
export async function copyMarkingToClipboard(
    ctx: FormsContext,
    field: HTMLInputElement,
): Promise<void> {
    const lastValid = ctx.lastValidated.get(field) ?? field.value.trim();
    if (!lastValid) return;

    const format = getFormat(ctx, field);
    const schemeId = profileIdForElement(ctx, field);
    // Copying reads the stored marking; nothing here corrects it.
    const result = await Promise.resolve(
        ctx.schemeAddressing && isAddressableSchemeEngine(ctx.engine)
            ? ctx.engine.validate(lastValid, schemeId, { outputFormat: format })
            : ctx.engine.validate(lastValid, { outputFormat: format }),
    );
    const scheme = ctx.engine.getScheme(schemeId);
    const assertions = result.assertions.map((a) => a.conceptId).join(', ');

    const text = [
        result.rendered,
        '---',
        `Scheme: ${scheme.name} v${scheme.version}`,
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
