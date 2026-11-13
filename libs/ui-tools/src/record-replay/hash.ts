import { createHash } from 'node:crypto';
import { normalizePath, stableJson } from './normalize';

/**
 * Derive the lookup key for one recorded request: the SHA-256 of its normalized
 * path joined with its key-stable JSON body. The same path and body always map
 * to the same key regardless of trailing slashes or body key order, so a
 * recorder and a replayer agree on the key without coordination.
 */
export function computeRecordingKey(path: string, body: unknown): string {
    const normalized = normalizePath(path);
    const stable = stableJson(body);
    return createHash('sha256')
        .update(normalized + '|' + stable)
        .digest('hex');
}
