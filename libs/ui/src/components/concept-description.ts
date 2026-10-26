/**
 * Concept-description resolution shared by every dwell surface: dropdown rows,
 * painted marking tokens, TagInput chips, and MarkedTextArea/MarkedInput
 * segment chips. One algorithm, several callers, so the same concept reads the
 * same way no matter which field surfaced it.
 *
 * The shared resolver owns the detail text and resolution cache used by these
 * dwell surfaces.
 */

import type { ConceptDescription } from '@ezclassify/types';
import {
    isAddressableSchemeEngine,
    type ComponentSchemeEngine,
} from './component-base-readonly';

/**
 * The engine surface this module reads: any component scheme engine, local or
 * remote. `describeConcept` is required by the adapter contract, and
 * {@link assertDescribesConcepts} refuses an engine that lacks it.
 */
export type ConceptDescriptionEngine = ComponentSchemeEngine;

/**
 * Refuse an engine that cannot describe concepts.
 *
 * Every field that shows concept detail calls this once, where it binds its
 * engine, so a non-conforming adapter fails at that boundary rather than on
 * each hover. {@link resolveConceptDescription} repeats the check as a defensive
 * guard.
 *
 * @param engine - The engine the component is binding
 * @param componentLabel - Names the component in the error
 * @throws {Error} If the engine does not implement `describeConcept`.
 */
export function assertDescribesConcepts(
    engine: ConceptDescriptionEngine,
    componentLabel: string,
): void {
    if (typeof engine.describeConcept !== 'function') {
        throw new Error(
            `[ezclassify] ${componentLabel} requires engine.describeConcept(): ` +
                'every dwell surface reads concept detail from the engine. Provide ' +
                'a SchemeEngineAdapter (or an adapter implementing this capability).',
        );
    }
}

/**
 * Everything {@link resolveConceptDescription} needs to answer "what is this
 * concept?"
 */
export interface ConceptDescriptionSource {
    engine: ConceptDescriptionEngine;
    /**
     * Threaded into the multi-profile `describeConcept` call when the engine
     * supports it.
     */
    schemeId?: string;
    /** Whether the engine accepts an explicit scheme selector. */
    schemeAddressing?: boolean;
    /** Concept view key to request (e.g. a scheme's `description` view). */
    tooltipConceptProperty?: string;
    /**
     * Resolved text keyed `${conceptId}:${categoryId}`. Callers own the cache's
     * lifetime (typically one per field instance) so repeat hovers of the same
     * concept skip the engine call, and an async result can be written back for
     * a later poll to pick up.
     */
    cache: Map<string, string>;
}

/**
 * Concept ids currently awaiting a remote `describeConcept` response, keyed by
 * the caller's own cache instance so two fields never share in-flight state.
 * `attachTooltip`'s hover/long-press poll and the dropdown's active-row
 * `aria-describedby` sync both call {@link resolveConceptDescription} repeatedly
 * (up to ~10x at 200ms) while waiting for a result. Pending entries deduplicate
 * those polls and per-assertion segment lookups into one call per concept.
 */
const pendingByCache = new WeakMap<Map<string, string>, Set<string>>();

/**
 * How long a failed `describeConcept` keeps a concept from being requested
 * again, per cache.
 *
 * A failed lookup stays in cooldown across the tooltip's poll budget (10
 * attempts at 200ms in `tooltip-manager.ts`). After cooldown, a later hover can
 * retry a recovered remote.
 */
const FAILED_LOOKUP_COOLDOWN_MS = 5_000;

/** When each failed lookup happened, keyed by the caller's own cache. */
const failedByCache = new WeakMap<Map<string, string>, Map<string, number>>();

function failedKeysFor(cache: Map<string, string>): Map<string, number> {
    let keys = failedByCache.get(cache);
    if (!keys) {
        keys = new Map();
        failedByCache.set(cache, keys);
    }
    return keys;
}

function pendingKeysFor(cache: Map<string, string>): Set<string> {
    let keys = pendingByCache.get(cache);
    if (!keys) {
        keys = new Set();
        pendingByCache.set(cache, keys);
    }
    return keys;
}

/**
 * Resolve the detail text for one concept: definition, usage guidance, and any
 * applicable rules, formatted as the line-based content `showTooltip` in
 * `tooltip-manager.ts` parses into structured sections (a header line,
 * blank-line-separated `Description:`/`Usage:`/`Rules:` blocks).
 *
 * Returns the cached or synchronously-available text immediately. When the
 * engine's answer is a Promise (a remote client), returns `undefined` and
 * caches the result once it resolves; callers that show content asynchronously
 * (a hover/long-press poll, the dropdown's active-row `aria-describedby` sync
 * retry) call this again on each attempt and pick the resolved text up from
 * cache. A concept already awaiting that Promise also returns `undefined`
 * without issuing a second request.
 *
 * @throws {Error} If the engine does not implement `describeConcept`.
 */
export function resolveConceptDescription(
    conceptId: string,
    categoryId: string,
    source: ConceptDescriptionSource,
): string | undefined {
    const cacheKey = `${conceptId}:${categoryId}`;
    // has(), not truthiness: a concept can legitimately resolve to an empty
    // description (no documentation authored for it), and that empty result is
    // as final as a non-empty one.
    if (source.cache.has(cacheKey)) return source.cache.get(cacheKey);

    const pending = pendingKeysFor(source.cache);
    if (pending.has(cacheKey)) return undefined;

    const failed = failedKeysFor(source.cache);
    const failedAt = failed.get(cacheKey);
    if (failedAt !== undefined) {
        if (Date.now() - failedAt < FAILED_LOOKUP_COOLDOWN_MS) return undefined;
        failed.delete(cacheKey);
    }

    const { engine } = source;
    assertDescribesConcepts(engine, 'resolveConceptDescription');

    const opts = source.tooltipConceptProperty
        ? { view: source.tooltipConceptProperty }
        : undefined;
    let result;
    try {
        result =
            source.schemeAddressing && isAddressableSchemeEngine(engine)
                ? engine.describeConcept(
                      conceptId,
                      categoryId,
                      source.schemeId ?? '',
                      opts,
                  )
                : engine.describeConcept(conceptId, categoryId, opts);
    } catch {
        failed.set(cacheKey, Date.now());
        return undefined;
    }

    if (result && typeof result === 'object' && !('then' in result)) {
        const text = (result as ConceptDescription).lines.join('\n');
        source.cache.set(cacheKey, text);
        return text;
    }

    if (result && typeof result === 'object' && 'then' in result) {
        pending.add(cacheKey);
        (result as Promise<ConceptDescription>)
            .then((desc) => {
                source.cache.set(cacheKey, desc.lines.join('\n'));
                failed.delete(cacheKey);
            })
            .catch(() => {
                // The failure is recorded rather than surfaced: a tooltip
                // is optional content, and the caller is a poll tick with
                // no place to show an error. What matters is that the next
                // tick stops asking for a while.
                failed.set(cacheKey, Date.now());
            })
            .finally(() => pending.delete(cacheKey));
        return undefined;
    }

    return undefined;
}

/**
 * One concept-detail resolver plus the shared opt-out check every dwell surface
 * reads.
 */
export interface ConceptDescriber {
    /** Resolve one concept's tooltip text; see {@link resolveConceptDescription}. */
    resolve(conceptId: string, categoryId: string): string | undefined;
    /**
     * Whether tooltips are enabled right now (host opt-out, e.g.
     * `data-ezclassify-no-tooltips`).
     */
    enabled(): boolean;
}

/**
 * Everything {@link createConceptDescriber} reads to answer a resolve/enabled
 * call. Accessors, not plain fields: `engine`/`schemeId`/`options` live on the
 * calling field instance and are assigned during its async `init()`, typically
 * after the describer itself is constructed as a class field, so each accessor
 * must read the current value at call time rather than one captured at
 * construction. Accessors also let a caller hand over `() => this.engine`
 * without exposing `this` itself, which would otherwise fail structurally on
 * any `protected`/`private` field of the same name.
 */
export interface ConceptDescriberHost {
    engine: () => ConceptDescriptionEngine;
    schemeId?: () => string | undefined;
    schemeAddressing?: () => boolean;
    options: () => {
        tooltipConceptProperty?: string;
        tooltips?: boolean;
    };
}

/**
 * Build one concept describer for a field instance: a private resolution cache
 * plus the resolve/enabled pair every dwell surface (dropdown rows, painted
 * tokens, segment chips) shares.
 */
export function createConceptDescriber(
    host: ConceptDescriberHost,
): ConceptDescriber {
    const cache = new Map<string, string>();
    return {
        resolve: (conceptId, categoryId) =>
            resolveConceptDescription(conceptId, categoryId, {
                engine: host.engine(),
                schemeId: host.schemeId?.(),
                schemeAddressing: host.schemeAddressing?.(),
                tooltipConceptProperty: host.options().tooltipConceptProperty,
                cache,
            }),
        enabled: () => host.options().tooltips !== false,
    };
}
