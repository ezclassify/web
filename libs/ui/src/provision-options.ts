/**
 * One definition of "options merged over the app-level ones, key by key", which
 * is the sentence all three framework READMEs use for the same contract, and
 * one definition of the bag being merged.
 *
 * Both live here rather than in any one framework package because the three had
 * drifted: React skipped override keys whose value was `undefined`, Angular and
 * Vue spread the override bag whole, so an explicit `{ format: undefined }`
 * erased the application's format on two of them and not on the third.
 */

import type { RenderColorMap } from './render-colors';
import type { FavoritesConfig } from './components';

/**
 * Presentation choices for a marking UI scope, optionally inherited and
 * overridden key by key. These do not configure a client or policy engine.
 *
 * Every framework package names this shape for its own provision API
 * (`EzClassifyOptions` in Angular and Vue, `UseSchemeEngineOptions` in React).
 * They are the same options going to the same place: `EzClassifyUI`. Keeping
 * one definition means a new presentation option reaches all three at once.
 *
 * A package extends it where its own runtime genuinely differs, which so far is
 * only Vue's `root`.
 */
export interface EzClassifyPresentationOptions {
    /** ID of the hidden input that receives the aggregated rollup value. */
    rollupId?: string;
    /**
     * Context-defined render format ID for this UI scope; omitted uses its
     * default.
     */
    format?: string;
    /** Color map for render-color labels. */
    colorMap?: RenderColorMap;
    /** Concept property shown in tooltips. */
    tooltipConceptProperty?: string;
    /**
     * Host-owned favorites persistence for every scanner-mounted field that
     * supports it (tags/marked-textarea/marked-input/marking). Unset means the
     * favorites control does not render; see {@link FavoritesConfig} and
     * `docs/attributes.md`.
     */
    favorites?: FavoritesConfig;
}

/**
 * Merge a scope's presentation overrides over the application's defaults.
 *
 * A key the override does not carry, or carries as `undefined`, keeps the
 * default. That is deliberate: an optional property left off and one set to
 * `undefined` are the same value in TypeScript, so treating the explicit
 * `undefined` as an erasure would make `{ format: maybeUndefined }` silently
 * drop an application-wide setting. Clearing a default is not something this
 * contract offers; a scope that wants no format asks for the format it wants.
 *
 * Both sides accept `null` as well as `undefined`: Angular's optional injection
 * answers `null` for a token nobody provided, and a caller should not have to
 * launder that before merging.
 *
 * @param defaults - Application-level options, if any.
 * @param overrides - The scope's own options, if any.
 * @returns A new bag holding the defaults with the overrides applied.
 */
export function mergeProvisionOptions<T extends object>(
    defaults: T | null | undefined,
    overrides: T | null | undefined,
): T {
    const merged = { ...defaults } as T;
    for (const [key, value] of Object.entries(overrides ?? {})) {
        if (value !== undefined) {
            (merged as Record<string, unknown>)[key] = value;
        }
    }
    return merged;
}
