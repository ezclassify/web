/**
 * Pure recording lookup. Given a loaded recordings map and an incoming request,
 * returns either the matching response or a miss envelope describing what was
 * not found. Doing the match in one place keeps every transport (the fetch
 * transport and the Playwright route handler) consistent.
 */
import { createHash } from 'node:crypto';
import { normalizePath, stableJson } from './normalize';
import { computeRecordingKey } from './hash';
import type { MissEnvelope } from './contract';

/** A recorded response as held in memory by the replayer. */
export interface ReplayerRecording {
    statusCode: number;
    body: unknown;
    headers?: Record<string, string>;
}

/** Outcome of a lookup: a recorded hit, or a miss carrying its envelope. */
export type LookupResult =
    | {
          kind: 'hit';
          statusCode: number;
          body: unknown;
          headers: Record<string, string>;
      }
    | { kind: 'miss'; envelope: MissEnvelope };

/**
 * Find the recording for a request by its normalized path and body. On a miss,
 * the returned envelope includes the body hash so a caller can diff it against
 * the keys present in the recordings.
 */
export function lookup(
    recordings: Record<string, ReplayerRecording>,
    request: { path: string; body: unknown },
): LookupResult {
    const normalized = normalizePath(request.path);
    const key = computeRecordingKey(normalized, request.body);
    const hit = recordings[key];
    if (hit !== undefined) {
        return {
            kind: 'hit',
            statusCode: hit.statusCode,
            body: hit.body,
            headers: hit.headers ?? {},
        };
    }
    const bodyHash = createHash('sha256')
        .update(stableJson(request.body))
        .digest('hex');
    const envelope: MissEnvelope = {
        error: 'no_recording',
        message: `no recording found for path=${normalized} body=${JSON.stringify(request.body)}`,
        path: normalized,
        bodyHash,
    };
    return { kind: 'miss', envelope };
}
