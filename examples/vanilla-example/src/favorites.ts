import type {
    FavoriteEntry,
    FavoritesConfig,
    FavoritesContext,
} from '@ezclassify/ui';

/** Keep Favorites for this page visit, independently for each scheme and scope. */
export function createVisitFavorites(): FavoritesConfig {
    const entries = new Map<string, FavoriteEntry[]>();
    const key = (context: FavoritesContext) =>
        JSON.stringify([context.schemeId, context.scope ?? null]);
    return {
        load: (context) =>
            (entries.get(key(context)) ?? []).map((entry) => ({ ...entry })),
        save: (marking, context) => {
            const id = key(context);
            const current = entries.get(id) ?? [];
            if (!current.some((entry) => entry.marking === marking))
                entries.set(id, [...current, { marking }]);
        },
        remove: (marking, context) => {
            const id = key(context);
            entries.set(
                id,
                (entries.get(id) ?? []).filter(
                    (entry) => entry.marking !== marking,
                ),
            );
        },
    };
}
