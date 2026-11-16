/**
 * Canonicalization helpers shared by the recorder and replayer.
 *
 * Both sides must derive identical recording keys from the same logical
 * request, so path and body normalization lives in one place and is applied
 * consistently when recording and when looking up.
 */

/**
 * Strip trailing slashes from a request path so that `/items/` and `/items`
 * resolve to the same recording key. Internal slashes are preserved.
 */
export function normalizePath(path: string): string {
    return path.replace(/\/+$/, '');
}

/**
 * Serialize a value to JSON with object keys sorted at every level. Array order
 * is preserved. Two payloads that differ only in key order produce identical
 * output, which keeps recording keys stable across clients that emit keys in
 * different orders.
 */
export function stableJson(value: unknown): string {
    return JSON.stringify(value, stableReplacer);
}

function stableReplacer(_key: string, val: unknown): unknown {
    if (val !== null && typeof val === 'object' && !Array.isArray(val)) {
        const sorted: Record<string, unknown> = {};
        for (const k of Object.keys(val as Record<string, unknown>).sort()) {
            sorted[k] = (val as Record<string, unknown>)[k];
        }
        return sorted;
    }
    return val;
}
