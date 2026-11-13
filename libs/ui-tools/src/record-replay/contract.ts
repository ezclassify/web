/**
 * Wire and on-disk contract for the HTTP record and replay harness.
 *
 * These types are the single source of truth for what a recordings file holds
 * and what the replayer answers on a miss. The recorder writes the file and the
 * replayer reads it back through {@link validateRecordingsFile}, so a drift on
 * either side fails at this boundary instead of surfacing as a confusing
 * replay.
 */

/**
 * Bumped when the recordings-file shape changes incompatibly. A consumer can
 * pin against it to refuse fixtures written for another shape.
 */
export const REPLAYER_CONTRACT_VERSION = '1';

/** Body the replayer returns when no recording matches a request. */
export interface MissEnvelope {
    error: 'no_recording';
    message: string;
    path: string;
    bodyHash: string;
}

/** One recorded response, keyed by the request's normalized path and body. */
export interface RecordingsEntry {
    statusCode: number;
    body: unknown;
    /**
     * Response headers a client reads, lower-cased. The REST client reads the
     * resolved Context version and `retry-after`, so a replay that dropped them
     * would answer differently from the server it recorded.
     */
    headers?: Record<string, string>;
    argsSummary?: string;
    /** The method the request was sent with; a replay of another misses. */
    method: string;
}

/**
 * Top-level shape of a recordings file: the engine and OpenAPI versions the
 * recordings were captured against, plus the recordings keyed by request hash.
 */
export interface RecordingsFile {
    engineVersion: string;
    openapiVersion?: string;
    responses: Record<string, RecordingsEntry>;
}

/** A failed recordings-file validation, naming the first field that is wrong. */
export class RecordingsFileError extends Error {
    override readonly name = 'RecordingsFileError';
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
    value !== null && typeof value === 'object' && !Array.isArray(value);

function optionalString(
    owner: Record<string, unknown>,
    key: string,
    where: string,
): void {
    if (owner[key] !== undefined && typeof owner[key] !== 'string') {
        throw new RecordingsFileError(`${where}.${key} must be a string`);
    }
}

function validateEntry(value: unknown, where: string): RecordingsEntry {
    if (!isRecord(value)) {
        throw new RecordingsFileError(`${where} must be an object`);
    }
    if (!Number.isInteger(value['statusCode'])) {
        throw new RecordingsFileError(`${where}.statusCode must be an integer`);
    }
    if (!('body' in value)) {
        throw new RecordingsFileError(`${where}.body is missing`);
    }
    optionalString(value, 'argsSummary', where);
    if (typeof value['method'] !== 'string') {
        throw new RecordingsFileError(`${where}.method must be a string`);
    }
    const headers = value['headers'];
    if (headers !== undefined) {
        if (
            !isRecord(headers) ||
            Object.values(headers).some((h) => typeof h !== 'string')
        ) {
            throw new RecordingsFileError(
                `${where}.headers must map header names to strings`,
            );
        }
    }
    return value as unknown as RecordingsEntry;
}

/**
 * Validate an arbitrary value as a recordings file.
 *
 * @param data - A parsed recordings file
 * @returns The same value, typed
 * @throws {RecordingsFileError} Naming the first field that does not match
 */
export function validateRecordingsFile(data: unknown): RecordingsFile {
    if (!isRecord(data)) {
        throw new RecordingsFileError('a recordings file must be an object');
    }
    if (typeof data['engineVersion'] !== 'string') {
        throw new RecordingsFileError('engineVersion must be a string');
    }
    optionalString(data, 'openapiVersion', 'the recordings file');
    const responses = data['responses'];
    if (!isRecord(responses)) {
        throw new RecordingsFileError('responses must be an object');
    }
    for (const [key, entry] of Object.entries(responses)) {
        validateEntry(entry, `responses[${key}]`);
    }
    return data as unknown as RecordingsFile;
}
