/**
 * The scopes a host names, and which of them a category belongs to.
 *
 * `data-ezclassify-scope` holds a space-separated list of scope ids, the way
 * `class` holds class names: `"classification authority"` names two. Every
 * component that reads scope reads the list through {@link parseScopeList}, so
 * one host spells it one way for all of them. There is no keyword for every
 * scope; a host lists the ones it means.
 *
 * Which scope a category belongs to is the scheme's to say. A category that
 * declares scopes belongs to those. One that declares none is on the marking as
 * a whole, which the default scope writes, the same rule validation applies
 * when it demands a required category only on the surface that owns it.
 */

/** The parts of a scheme's metadata scope membership is read from. */
export interface ScopeSource {
    /** The scheme's scopes, in declaration order. */
    scopes?: ReadonlyArray<{ id: string; label: string }>;
    /** The scope a category that declares none belongs to. */
    defaultScope?: string;
}

/**
 * The scope ids a `data-ezclassify-scope` value lists, in the order written,
 * each once.
 *
 * @param value - The attribute value, or undefined when the host names none
 * @returns The listed scope ids; empty when the value lists none
 */
export function parseScopeList(value: string | null | undefined): string[] {
    if (!value) return [];
    return [...new Set(value.split(/\s+/).filter(Boolean))];
}

/**
 * The scopes a component writes: the ones its host lists, or the scheme's
 * default scope when it lists none. Empty for a scheme that declares no default
 * scope, whose marking is written whole.
 *
 * @param listed - The scope ids the host lists (see {@link parseScopeList})
 * @param meta - The scheme's scope metadata
 */
export function scopeSetOf(
    listed: readonly string[],
    meta: ScopeSource,
): string[] {
    if (listed.length > 0) return [...listed];
    return meta.defaultScope ? [meta.defaultScope] : [];
}

/**
 * Whether any of a marking's facts belongs to a scope the scheme declares
 * outside `scopes`, by the scope membership of its category. A fact in a
 * category of several scopes reaches each of them.
 *
 * @param assertions - The marking's facts
 * @param categories - The scheme's categories, with the scopes they declare
 * @param scopes - The scope ids a component writes
 * @param meta - The scheme's scope metadata
 */
export function reachesPastScopes(
    assertions: ReadonlyArray<{ categoryId: string }>,
    categories: ReadonlyArray<{ id: string; scopes?: readonly string[] }>,
    scopes: readonly string[],
    meta: ScopeSource,
): boolean {
    const listed = new Set(scopes);
    const others = (meta.scopes ?? [])
        .map((scope) => scope.id)
        .filter((id) => !listed.has(id));
    return (
        others.length > 0 &&
        factsInScopes(assertions, categories, others, meta).length > 0
    );
}

/**
 * The scopes a category belongs to: the ones it declares, or the default scope
 * when it declares none. Empty for a scheme that declares no scopes.
 *
 * @param category - The category, with the scopes it declares
 * @param meta - The scheme's scope metadata
 */
export function scopesOfCategory(
    category: { scopes?: readonly string[] },
    meta: ScopeSource,
): string[] {
    if (category.scopes?.length) return [...category.scopes];
    return meta.defaultScope ? [meta.defaultScope] : [];
}

/**
 * Order scope ids the way the scheme declares its scopes. Ids the scheme does
 * not declare keep their relative order after the declared ones.
 *
 * @param ids - The scope ids to order
 * @param meta - The scheme's scope metadata
 */
export function inDeclarationOrder(
    ids: Iterable<string>,
    meta: ScopeSource,
): string[] {
    const order = new Map(
        (meta.scopes ?? []).map((scope, index) => [scope.id, index]),
    );
    return [...new Set(ids)].sort(
        (a, b) =>
            (order.get(a) ?? Number.MAX_SAFE_INTEGER) -
            (order.get(b) ?? Number.MAX_SAFE_INTEGER),
    );
}

/**
 * The display label the scheme gives a scope, or its id when it gives none.
 *
 * @param scope - The scope id
 * @param meta - The scheme's scope metadata
 */
export function scopeLabel(scope: string, meta: ScopeSource): string {
    return meta.scopes?.find((s) => s.id === scope)?.label ?? scope;
}

/**
 * The facts of a marking that belong to any of the given scopes, by the scope
 * membership of their categories. A fact in a category the scheme does not
 * declare belongs to no scope and is left out.
 *
 * @param assertions - The marking's facts
 * @param categories - The scheme's categories, with the scopes they declare
 * @param scopes - The scope ids to keep
 * @param meta - The scheme's scope metadata
 */
export function factsInScopes<T extends { categoryId: string }>(
    assertions: readonly T[],
    categories: ReadonlyArray<{ id: string; scopes?: readonly string[] }>,
    scopes: readonly string[],
    meta: ScopeSource,
): T[] {
    const listed = new Set(scopes);
    const byId = new Map(categories.map((c) => [c.id, c]));
    return assertions.filter((a) => {
        const category = byId.get(a.categoryId);
        return (
            category !== undefined &&
            scopesOfCategory(category, meta).some((s) => listed.has(s))
        );
    });
}

/**
 * The categories of the listed scopes, scope by scope in the scheme's
 * declaration order and each scope's categories in category order. A category
 * that belongs to several listed scopes is listed once, under the first of
 * them. A scope with no category of its own is left out.
 *
 * @param categories - The scheme's categories, in category order
 * @param scopes - The scope ids to list
 * @param meta - The scheme's scope metadata
 */
export function categoriesByScope<
    T extends { id: string; scopes?: readonly string[] },
>(
    categories: readonly T[],
    scopes: readonly string[],
    meta: ScopeSource,
): Array<{ scope: string; categories: T[] }> {
    const placed = new Set<string>();
    const groups: Array<{ scope: string; categories: T[] }> = [];
    for (const scope of inDeclarationOrder(scopes, meta)) {
        const own = categories.filter(
            (category) =>
                !placed.has(category.id) &&
                scopesOfCategory(category, meta).includes(scope),
        );
        for (const category of own) placed.add(category.id);
        if (own.length > 0) groups.push({ scope, categories: own });
    }
    return groups;
}
