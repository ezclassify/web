/**
 * Capture side of the HTTP record and replay harness. Accumulates request and
 * response pairs in memory and produces a recordings file the replayer can
 * serve.
 */
import { writeRecordingsFile } from './recordings-file';
import { normalizePath } from './normalize';
import { computeRecordingKey } from './hash';
import type { RecordingsEntry, RecordingsFile } from './contract';

/** One observed request and response pair to record. */
export interface RecordParams {
    path: string;
    body: unknown;
    response: unknown;
    statusCode: number;
    method: string;
    headers?: Record<string, string>;
    argsSummary?: string;
}

/**
 * Collects recordings during a capture run. Entries are keyed by request path
 * and body, so recording the same request again replaces its entry instead of
 * duplicating it.
 *
 * The key does not include the method, which every recordings file already in
 * use relies on. Two methods sending the same path and body would therefore
 * share one entry and replay the wrong answer, so the recorder refuses that
 * case outright rather than let the second overwrite the first.
 */
export class Recorder {
    private readonly responses: Record<string, RecordingsEntry>;

    /**
     * @param recorded - Recordings to start from, such as an earlier pass's
     *   file. They are kept, and {@link find} answers from them.
     */
    constructor(recorded: Record<string, RecordingsEntry> = {}) {
        this.responses = { ...recorded };
    }

    /** The recording already held for a request, if there is one. */
    find(path: string, body: unknown): RecordingsEntry | undefined {
        return this.responses[computeRecordingKey(normalizePath(path), body)];
    }

    /** Whether nothing has been recorded yet. */
    get empty(): boolean {
        return Object.keys(this.responses).length === 0;
    }

    /**
     * Store the response for one request under its computed recording key.
     *
     * @throws When a request with another method already holds the same key
     */
    record({
        path,
        body,
        response,
        statusCode,
        method,
        headers,
        argsSummary,
    }: RecordParams): void {
        const normalized = normalizePath(path);
        const key = computeRecordingKey(normalized, body);
        const held = this.responses[key];
        if (held?.method !== undefined && held.method !== method) {
            throw new Error(
                `${method} ${normalized} and ${held.method} ${normalized} send the ` +
                    'same body, so one recording key would answer both',
            );
        }
        this.responses[key] = {
            statusCode,
            body: response,
            method,
            ...(headers !== undefined && Object.keys(headers).length > 0
                ? { headers }
                : {}),
            ...(argsSummary !== undefined ? { argsSummary } : {}),
        };
    }

    /**
     * The recordings collected so far as a recordings file, stamped with the
     * engine (and optional OpenAPI) version they were captured against.
     */
    toFile(engineVersion: string, openapiVersion?: string): RecordingsFile {
        return {
            engineVersion,
            ...(openapiVersion !== undefined ? { openapiVersion } : {}),
            responses: { ...this.responses },
        };
    }

    /** Write every accumulated recording to disk. */
    flush(
        filePath: string,
        engineVersion: string,
        openapiVersion?: string,
    ): void {
        writeRecordingsFile(
            filePath,
            this.toFile(engineVersion, openapiVersion),
        );
    }
}
