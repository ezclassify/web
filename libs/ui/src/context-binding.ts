/**
 * The Contexts one `EzClassifyUI` instance marks with, and how an element in
 * its tree picks one of them.
 *
 * A page that marks under one rule set hands the instance that Context:
 *
 * ```ts
 * new EzClassifyUI(context);
 * ```
 *
 * A page that marks under several hands them over by key, and markup names the
 * key on the nearest ancestor of the elements it governs:
 *
 * ```ts
 * new EzClassifyUI({ contexts: { capco, cui } });
 * ```
 *
 * ```html
 * <body data-ezclassify-context="capco">
 *     <section data-ezclassify-context="cui">…</section>
 * </body>
 * ```
 *
 * There is no implicit default. With several Contexts an element that no
 * ancestor assigns to one is refused, because guessing would validate it
 * against a rule set the host never chose. With one Context the attribute has
 * nothing to choose between, so an element that carries one is refused too.
 *
 * Inside a Context, `data-ezclassify-scheme` names one of the schemes the
 * Context holds by its Context-local selector (the key `describeSchemes`
 * reports and REST `?scheme=` takes). Without it an element marks in the
 * Context's primary scheme, and naming the primary's selector is the same as
 * naming nothing. An element marks in whichever scheme it selects: the primary
 * through `context.scheme`, any other through `context.schemeView(selector)`.
 *
 * Both attributes are read from the element itself and its ancestors up to the
 * instance root, never beyond it: markup above the root belongs to whatever
 * scope encloses it.
 *
 * Every element that marks resolves to a {@link BucketKey}, the pair (Context
 * key, scheme selector). Rollups group by it and never merge across it, so the
 * same scheme under two Contexts stays two buckets. In a key the only Context
 * of a single-Context instance and the primary scheme of any Context are both
 * the empty string, so a page that names neither has the one bucket a store
 * over one engine holds.
 */

import {
    isContextAdapter,
    type ContextAdapter,
    type ContextSchemeDescriptor,
    type ContextSchemeEngineAdapter,
} from '@ezclassify/types';
import {
    bucketKey,
    bucketParts,
    SOLE_BUCKET,
    type BucketKey,
} from './store/store-shared';
import type { EzClassifyStoreBuckets } from './store/ezclassify-store';

export { bucketKey, bucketParts, type BucketKey } from './store/store-shared';

/** Attribute naming the Context key an element and its subtree mark with. */
export const CONTEXT_ATTR = 'data-ezclassify-context';

/** Attribute naming the Context-local scheme selector for a subtree. */
export const SCHEME_ATTR = 'data-ezclassify-scheme';

/** Several Contexts for one instance, each under the key markup names it by. */
export interface EzClassifyContextMap {
    readonly contexts: Readonly<Record<string, ContextAdapter>>;
}

/** What an `EzClassifyUI` is initialized with: one Context, or several by key. */
export type EzClassifyContexts = ContextAdapter | EzClassifyContextMap;

/**
 * Key of the one Context an instance initialized with a single Context holds.
 * Markup never names it.
 */
export const SINGLE_CONTEXT_KEY = '';

/** Selector of a Context's primary scheme in a {@link BucketKey}. */
export const PRIMARY_SCHEME_SELECTOR = '';

/** Separates the two halves of a bucket key; never valid in a Context key. */
const BUCKET_SEPARATOR = '\u001f';

/** The Context and scheme an element marks with. */
export interface ResolvedContext {
    /** The Context's key on the instance ({@link SINGLE_CONTEXT_KEY} for one). */
    readonly contextKey: string;
    /** The Context itself. */
    readonly context: ContextAdapter;
    /**
     * Context-local selector of the scheme, or {@link PRIMARY_SCHEME_SELECTOR}
     * for the primary scheme, however the markup reached it.
     */
    readonly schemeSelector: string;
    /** Whether that scheme is the Context's primary scheme. */
    readonly primary: boolean;
    /** The bucket the element rolls up into. */
    readonly bucket: BucketKey;
}

/**
 * Why an element's Context or scheme did not resolve.
 *
 * - `context-unresolved`: no Context, an unknown key, or a key on a
 *   single-Context instance.
 * - `scheme-unresolved`: the selector names no scheme the Context holds, or the
 *   Context could not list its schemes.
 * - `scheme-pending`: the Context has not listed its schemes yet. The runtime
 *   reads the element again once it has.
 */
export type ContextResolutionCode =
    'context-unresolved' | 'scheme-unresolved' | 'scheme-pending';

/**
 * An element whose Context or scheme cannot be resolved. The element is a host
 * error: it is left unenhanced and never treated as absent from a rollup.
 */
export class ContextResolutionError extends Error {
    override readonly name = 'ContextResolutionError';

    /**
     * @param code - Why it did not resolve
     * @param message - What is wrong, and how the markup fixes it
     * @param element - The element that could not be resolved
     */
    constructor(
        readonly code: ContextResolutionCode,
        message: string,
        readonly element: Element | null,
    ) {
        super(message);
    }
}

/** What loading one Context's scheme list produced. */
type SchemeList =
    | { readonly state: 'pending' }
    | { readonly state: 'loaded'; readonly schemes: ContextSchemeDescriptor[] }
    | { readonly state: 'failed'; readonly reason: string };

/**
 * The Contexts of one instance, with the scheme lists their selectors resolve
 * against.
 */
export class ContextSet {
    /** Whether the instance was given one Context rather than a keyed map. */
    readonly single: boolean;
    private readonly byKey: ReadonlyMap<string, ContextAdapter>;
    private readonly schemeLists = new Map<string, SchemeList>();

    private constructor(single: boolean, byKey: Map<string, ContextAdapter>) {
        this.single = single;
        this.byKey = byKey;
        for (const key of byKey.keys())
            this.schemeLists.set(key, { state: 'pending' });
    }

    /**
     * Read what the host initialized the instance with.
     *
     * @param source - One Context, or `{ contexts }` keyed by markup name
     * @throws TypeError when `source` is neither, a key is empty or holds the
     *   bucket separator, or a value is not a Context
     */
    static from(source: EzClassifyContexts): ContextSet {
        if (source && typeof source === 'object' && isContext(source)) {
            return new ContextSet(
                true,
                new Map([[SINGLE_CONTEXT_KEY, source]]),
            );
        }
        if (
            !source ||
            typeof source !== 'object' ||
            !('contexts' in source) ||
            !source.contexts ||
            typeof source.contexts !== 'object'
        ) {
            throw new TypeError(
                '[@ezclassify/ui] EzClassifyUI takes a Context, or { contexts: { <key>: Context, ... } } for several.',
            );
        }
        const byKey = new Map<string, ContextAdapter>();
        for (const [key, context] of Object.entries(source.contexts)) {
            if (key.trim() === '' || key.includes(BUCKET_SEPARATOR)) {
                throw new TypeError(
                    `[@ezclassify/ui] Context key ${JSON.stringify(key)} cannot be named in markup; use a non-empty key.`,
                );
            }
            if (
                !context ||
                typeof context !== 'object' ||
                !isContext(context)
            ) {
                throw new TypeError(
                    `[@ezclassify/ui] contexts.${key} is not a Context.`,
                );
            }
            byKey.set(key, context);
        }
        if (byKey.size === 0) {
            throw new TypeError(
                '[@ezclassify/ui] { contexts } names no Context.',
            );
        }
        return new ContextSet(false, byKey);
    }

    /** The keys markup can name, in the order the host gave them. */
    get keys(): readonly string[] {
        return [...this.byKey.keys()];
    }

    /** Every Context with its key. */
    entries(): IterableIterator<[string, ContextAdapter]> {
        return this.byKey.entries();
    }

    /**
     * The Context under a key.
     *
     * @param key - A key the host gave, or {@link SINGLE_CONTEXT_KEY}
     */
    get(key: string): ContextAdapter | undefined {
        return this.byKey.get(key);
    }

    /**
     * Learn which schemes each Context holds, so declared selectors resolve.
     * Completes synchronously when every Context answers synchronously (a local
     * Context), and returns a promise otherwise. A Context that cannot list its
     * schemes still marks in its primary scheme; only an element that declares
     * a selector in it is a host error, naming the reason.
     */
    load(): void | Promise<void> {
        const waits: Promise<void>[] = [];
        for (const [key, context] of this.byKey) {
            if (this.schemeLists.get(key)?.state !== 'pending') continue;
            let answer:
                ContextSchemeDescriptor[] | Promise<ContextSchemeDescriptor[]>;
            try {
                answer = context.describeSchemes();
            } catch (err) {
                this.schemeLists.set(key, failed(err));
                continue;
            }
            if (Array.isArray(answer)) {
                this.schemeLists.set(key, loaded(answer));
                continue;
            }
            waits.push(
                Promise.resolve(answer).then(
                    (schemes) => {
                        this.schemeLists.set(key, loaded(schemes));
                    },
                    (err: unknown) => {
                        this.schemeLists.set(key, failed(err));
                    },
                ),
            );
        }
        if (waits.length === 0) return;
        return Promise.all(waits).then(() => undefined);
    }

    /**
     * The Context key an element declares, from itself or the nearest ancestor
     * up to `root`.
     *
     * @param el - The element
     * @param root - The instance root; nothing above it is read
     */
    declaredContextKey(el: Element, root: Element): string | null {
        return declaredWithin(el, root, CONTEXT_ATTR);
    }

    /**
     * The scheme selector an element declares, from itself or the nearest
     * ancestor up to `root`.
     *
     * @param el - The element
     * @param root - The instance root; nothing above it is read
     */
    declaredSchemeSelector(el: Element, root: Element): string | null {
        return declaredWithin(el, root, SCHEME_ATTR);
    }

    /**
     * The Context and scheme an element marks with.
     *
     * @param el - The element
     * @param root - The instance root
     * @throws ContextResolutionError when no Context or no scheme resolves
     */
    resolve(el: Element, root: Element): ResolvedContext {
        const contextKey = this.resolveContextKey(el, root);
        const context = this.byKey.get(contextKey)!;
        const declared = this.declaredSchemeSelector(el, root);
        if (declared === null) {
            return primaryOf(contextKey, context);
        }
        const list = this.schemeLists.get(contextKey)!;
        const label = this.single ? 'the Context' : `Context '${contextKey}'`;
        if (list.state === 'pending') {
            throw new ContextResolutionError(
                'scheme-pending',
                `${SCHEME_ATTR}="${declared}" cannot be read yet: ${label} has not reported its schemes.`,
                el,
            );
        }
        if (list.state === 'failed') {
            throw new ContextResolutionError(
                'scheme-unresolved',
                `${SCHEME_ATTR}="${declared}" cannot be read: ${label} could not list its schemes (${list.reason}).`,
                el,
            );
        }
        const selected = list.schemes.find((s) => s.selector === declared);
        if (!selected) {
            throw new ContextResolutionError(
                'scheme-unresolved',
                `${SCHEME_ATTR}="${declared}" names no scheme ${label} holds. ` +
                    `It holds: ${list.schemes.map((s) => s.selector).join(', ') || 'none'}.`,
                el,
            );
        }
        if (selected.roles.includes('primary')) {
            return primaryOf(contextKey, context);
        }
        return {
            contextKey,
            context,
            schemeSelector: selected.selector,
            primary: false,
            bucket: bucketKey(contextKey, selected.selector),
        };
    }

    /**
     * The buckets a Context key and a scheme selector name, `null` naming any.
     * A selector naming a Context's primary scheme names its primary bucket.
     * Selectors other than the primary are known only once the Context's scheme
     * list has loaded.
     *
     * @param contextKey - A Context key, or null for every Context
     * @param schemeSelector - A Context-local selector, or null for every
     *   scheme of the Context
     */
    bucketsNamed(
        contextKey: string | null,
        schemeSelector: string | null,
    ): BucketKey[] {
        const named: BucketKey[] = [];
        for (const key of this.byKey.keys()) {
            if (contextKey !== null && contextKey !== key) continue;
            const list = this.schemeLists.get(key);
            const schemes = list?.state === 'loaded' ? list.schemes : [];
            const primary = schemes.find((s) => s.roles.includes('primary'));
            if (
                schemeSelector === null ||
                schemeSelector === PRIMARY_SCHEME_SELECTOR ||
                schemeSelector === primary?.selector
            ) {
                named.push(bucketKey(key, PRIMARY_SCHEME_SELECTOR));
            }
            for (const scheme of schemes) {
                if (scheme === primary || scheme.roles.includes('primary'))
                    continue;
                if (
                    schemeSelector === null ||
                    schemeSelector === scheme.selector
                )
                    named.push(bucketKey(key, scheme.selector));
            }
        }
        return named;
    }

    private resolveContextKey(el: Element, root: Element): string {
        const declared = this.declaredContextKey(el, root);
        if (this.single) {
            if (declared !== null) {
                throw new ContextResolutionError(
                    'context-unresolved',
                    `${CONTEXT_ATTR}="${declared}" has nothing to select: this EzClassifyUI was given one Context. ` +
                        'Remove the attribute, or initialize with { contexts: { ... } }.',
                    el,
                );
            }
            return SINGLE_CONTEXT_KEY;
        }
        const keys = this.keys.map((k) => `'${k}'`).join(', ');
        if (declared === null) {
            throw new ContextResolutionError(
                'context-unresolved',
                `No ${CONTEXT_ATTR} on this element or an ancestor, and this EzClassifyUI holds several Contexts (${keys}). ` +
                    `Name one with ${CONTEXT_ATTR} on the element or an enclosing element.`,
                el,
            );
        }
        if (!this.byKey.has(declared)) {
            throw new ContextResolutionError(
                'context-unresolved',
                `${CONTEXT_ATTR}="${declared}" names no Context this EzClassifyUI holds (${keys}).`,
                el,
            );
        }
        return declared;
    }
}

/**
 * The scheme operations for a resolved element: the Context's primary view, or
 * the view `schemeView` binds to the selected scheme. The selector picks the
 * view; operations on it take none.
 *
 * {@link ContextSet.resolve} has already checked the selector against the
 * schemes the Context lists, so a Context that still refuses the view is a
 * fault in the Context. It is reported as `scheme-unresolved`, never answered
 * with the primary.
 *
 * @param resolved - What {@link ContextSet.resolve} returned for the element
 * @param element - The element, carried on the error
 * @throws ContextResolutionError when the Context gives no view for the scheme
 */
export function schemeEngineOf(
    resolved: ResolvedContext,
    element: Element | null = null,
): ContextSchemeEngineAdapter {
    if (resolved.primary) return resolved.context.scheme;
    return viewOf(resolved.context, resolved.schemeSelector, element);
}

/**
 * The Context surfaces a scheme-bound Context leaves out. A Context's guides
 * and access policy each target a scheme of their own, and the component
 * surface does not say which, so a component bound to one of the Context's
 * other schemes gets neither. A guide's rollup copied into a field read in
 * another scheme would be another scheme's marking, and the access handbook
 * would list rules that field's marking may not be judged by.
 */
const UNBOUND_SURFACES: ReadonlySet<PropertyKey> = new Set(['guide', 'access']);

/** Contexts bound to one of their non-primary schemes, per selector. */
const schemeBoundContexts = new WeakMap<
    ContextAdapter,
    Map<string, ContextAdapter>
>();

/**
 * The Context a component on a resolved element marks with: the element's
 * Context, whose `scheme` is the scheme the element selects. A component reads
 * and writes through `context.scheme`, so a field under
 * `data-ezclassify-scheme` is parsed, rendered and offered choices by that
 * scheme rather than the primary. It has no guide or access surface (see
 * {@link UNBOUND_SURFACES}); everything else is the Context's own. The bound
 * Context is built once per Context and selector.
 *
 * @param resolved - What {@link ContextSet.resolve} returned for the element
 * @param element - The element, carried on the error
 * @throws ContextResolutionError when the Context gives no view for the scheme
 */
export function contextForScheme(
    resolved: ResolvedContext,
    element: Element | null = null,
): ContextAdapter {
    if (resolved.primary) return resolved.context;
    const { context, schemeSelector } = resolved;
    let bound = schemeBoundContexts.get(context);
    if (!bound) {
        bound = new Map();
        schemeBoundContexts.set(context, bound);
    }
    const known = bound.get(schemeSelector);
    if (known) return known;
    const scheme = viewOf(context, schemeSelector, element);
    // The Context may hold `scheme` as a frozen property, which a proxy over
    // it could not answer differently, so the proxy stands over an empty
    // object and forwards everything else to the Context.
    const view = new Proxy({} as ContextAdapter, {
        get(_, property) {
            if (property === 'scheme') return scheme;
            if (UNBOUND_SURFACES.has(property)) return undefined;
            const value = Reflect.get(context, property, context);
            return typeof value === 'function' ? value.bind(context) : value;
        },
        has(_, property) {
            if (UNBOUND_SURFACES.has(property)) return false;
            return Reflect.has(context, property);
        },
    });
    bound.set(schemeSelector, view);
    return view;
}

/**
 * The buckets of a store over the Contexts an `EzClassifyUI` is given, each
 * read by the scheme its key names: a Context's primary scheme through
 * `context.scheme`, another scheme it holds through
 * `context.schemeView(selector)`. A framework root that builds its own store
 * hands it this, so the store reads every bucket the way the runtime resolves
 * it, including a field marked in a Context's second scheme.
 *
 * With one Context the default bucket is its primary scheme, as in a store over
 * that scheme alone. With several there is no default bucket: a marking markup
 * assigns to no Context is refused rather than read by whichever Context comes
 * first.
 *
 * @param source - One Context, or the Contexts by the key markup names them
 *   with
 * @param options - `format`: the format whole markings are written in, in every
 *   bucket. Omitted, a bucket names none and the store writes in its scheme's
 *   default format, so one Context sends what a store over its scheme alone
 *   sends
 * @returns The store's bucket resolver
 * @throws TypeError when `source` is neither a Context nor a map of Contexts
 */
export function contextStoreBuckets(
    source: EzClassifyContexts,
    options?: { format?: string },
): EzClassifyStoreBuckets {
    const set = ContextSet.from(source);
    const format = options?.format;
    return {
        ...(set.single ? { defaultBucket: SOLE_BUCKET } : {}),
        resolve: (bucket) => {
            const { contextKey, schemeSelector } = bucketParts(bucket);
            const context = set.get(contextKey);
            if (!context) {
                throw new ContextResolutionError(
                    'context-unresolved',
                    `No Context '${contextKey}' among the Contexts this store reads.`,
                    null,
                );
            }
            const engine =
                schemeSelector === PRIMARY_SCHEME_SELECTOR
                    ? context.scheme
                    : viewOf(context, schemeSelector, null);
            return format ? { engine, format } : { engine };
        },
    };
}

/**
 * The view a Context binds to one of its non-primary schemes. A Context that
 * gives none (it does not hold the selector, or cannot bind it) is refused as
 * `scheme-unresolved`, never answered with the primary.
 */
function viewOf(
    context: ContextAdapter,
    selector: string,
    element: Element | null,
): ContextSchemeEngineAdapter {
    try {
        return context.schemeView(selector);
    } catch (err) {
        throw new ContextResolutionError(
            'scheme-unresolved',
            `${SCHEME_ATTR}="${selector}" has no scheme view in its Context (${err instanceof Error ? err.message : String(err)}).`,
            element,
        );
    }
}

/** The primary scheme of a Context, resolved. */
function primaryOf(
    contextKey: string,
    context: ContextAdapter,
): ResolvedContext {
    return {
        contextKey,
        context,
        schemeSelector: PRIMARY_SCHEME_SELECTOR,
        primary: true,
        bucket: bucketKey(contextKey, PRIMARY_SCHEME_SELECTOR),
    };
}

/** Whether a value carries the composed Context surface. */
function isContext(value: object): value is ContextAdapter {
    return isContextAdapter(value as ContextAdapter);
}

/** The value of `attr` on `el` or its nearest ancestor up to `root`. */
function declaredWithin(
    el: Element,
    root: Element,
    attr: string,
): string | null {
    for (let at: Element | null = el; at; at = at.parentElement) {
        const value = at.getAttribute(attr);
        if (value !== null) return value;
        if (at === root) break;
    }
    return null;
}

function loaded(schemes: ContextSchemeDescriptor[]): SchemeList {
    return { state: 'loaded', schemes };
}

function failed(err: unknown): SchemeList {
    return {
        state: 'failed',
        reason: err instanceof Error ? err.message : String(err),
    };
}
