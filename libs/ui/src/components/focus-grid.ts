/** Physical navigation among a control's already eligible option elements. */
export type FocusGridArrow =
    'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown';

/** Group vertically overlapping boxes into rows, ordered top then physical x. */
export function focusGridRows<T extends HTMLElement>(
    items: readonly T[],
): T[][] {
    const ordered = items
        .map((item, index) => ({
            item,
            index,
            rect: item.getBoundingClientRect(),
        }))
        .sort(
            (a, b) =>
                a.rect.top - b.rect.top ||
                a.rect.left - b.rect.left ||
                a.index - b.index,
        );
    const rows: { top: number; bottom: number; members: typeof ordered }[] = [];
    for (const entry of ordered) {
        const row = rows.find(
            (candidate) =>
                (entry.rect.top < candidate.bottom &&
                    entry.rect.bottom > candidate.top) ||
                (entry.rect.top === candidate.top &&
                    entry.rect.bottom === candidate.bottom),
        );
        if (row) {
            row.top = Math.min(row.top, entry.rect.top);
            row.bottom = Math.max(row.bottom, entry.rect.bottom);
            row.members.push(entry);
        } else
            rows.push({
                top: entry.rect.top,
                bottom: entry.rect.bottom,
                members: [entry],
            });
    }
    return rows
        .sort((a, b) => a.top - b.top)
        .map((row) =>
            row.members
                .sort((a, b) => a.rect.left - b.rect.left || a.index - b.index)
                .map(({ item }) => item),
        );
}

/** Same-row horizontal neighbor or nearest center in the adjacent row; no wrap. */
export function focusGridNeighbor<T extends HTMLElement>(
    items: readonly T[],
    current: T,
    key: FocusGridArrow,
): T | null {
    const rows = focusGridRows(items);
    const index = rows.findIndex((row) => row.includes(current));
    if (index < 0) return null;
    const row = rows[index];
    if (key === 'ArrowLeft' || key === 'ArrowRight')
        return (
            row[row.indexOf(current) + (key === 'ArrowRight' ? 1 : -1)] ?? null
        );
    const adjacent = rows[index + (key === 'ArrowDown' ? 1 : -1)];
    if (!adjacent) return null;
    const rect = current.getBoundingClientRect();
    const center = (rect.left + rect.right) / 2;
    const distance = (item: T) => {
        const box = item.getBoundingClientRect();
        return Math.abs((box.left + box.right) / 2 - center);
    };
    return adjacent.reduce((best, item) =>
        distance(item) < distance(best) ? item : best,
    );
}
