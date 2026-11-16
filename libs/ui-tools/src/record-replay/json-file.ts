/**
 * Deterministic JSON file writing shared by both recordings-file writers.
 * Object keys are sorted recursively so the on-disk JSON is stable across runs
 * and diffs cleanly in version control.
 */
import { writeFileSync } from 'node:fs';

/** Write `data` as pretty-printed JSON with sorted keys and a trailing newline. */
export function writeSortedJsonFile(filePath: string, data: unknown): void {
    writeFileSync(
        filePath,
        JSON.stringify(data, sortedKeysReplacer, 2) + '\n',
        'utf8',
    );
}

function sortedKeysReplacer(_key: string, val: unknown): unknown {
    if (val !== null && typeof val === 'object' && !Array.isArray(val)) {
        const sorted: Record<string, unknown> = {};
        for (const k of Object.keys(val as Record<string, unknown>).sort()) {
            sorted[k] = (val as Record<string, unknown>)[k];
        }
        return sorted;
    }
    return val;
}
