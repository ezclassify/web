/**
 * Fetch transports for the record and replay harness.
 *
 * A client that takes its own `fetch` (the REST client's `fetchImpl`, for one)
 * can be pointed at either side without knowing which it has:
 *
 * - {@link createRecordingFetch} forwards every request to a live server and
 *   records the answer.
 * - {@link createReplayFetch} answers every request from recordings and never
 *   touches the network.
 *
 * Both key a request the same way: its path with the query string, and its JSON
 * body (`null` when there is none). Only the origin is dropped, so a recording
 * made against a server on any port replays for a client configured with any
 * base URL.
 */
import { lookup, type ReplayerRecording } from './replayer';
import type { MissEnvelope } from './contract';
import type { Recorder } from './recorder';

/** The response headers worth keeping: the ones a client reads. */
const KEPT_HEADER = /^(x-ezclassify-|retry-after$)/;

/** Methods a recording always sends, because later answers depend on them. */
const STATE_CHANGING = new Set(['PUT', 'PATCH', 'DELETE']);

/** How long a recorded request may take at the live server. */
const LIVE_TIMEOUT_MS = 30_000;

/** What a request is keyed by: its path and query, and its parsed JSON body. */
interface KeyedRequest {
    method: string;
    path: string;
    body: unknown;
}

/**
 * Read a fetch call as the recording key's inputs.
 *
 * @throws When the body is present but is not a JSON string. Neither side can
 *   key such a body, so a silent `null` would let two requests share a key.
 */
function keyed(input: RequestInfo | URL, init?: RequestInit): KeyedRequest {
    const url =
        input instanceof Request ? new URL(input.url) : new URL(String(input));
    const method = (
        init?.method ?? (input instanceof Request ? input.method : 'GET')
    ).toUpperCase();
    const raw = init?.body;
    let body: unknown = null;
    if (raw !== undefined && raw !== null) {
        if (typeof raw !== 'string') {
            throw new TypeError(
                `${method} ${url.pathname}: the record and replay transport ` +
                    'keys JSON string bodies only',
            );
        }
        body = raw === '' ? null : (JSON.parse(raw) as unknown);
    }
    return { method, path: url.pathname + url.search, body };
}

function keptHeaders(headers: Headers): Record<string, string> {
    const kept: Record<string, string> = {};
    headers.forEach((value, name) => {
        const lower = name.toLowerCase();
        if (KEPT_HEADER.test(lower)) kept[lower] = value;
    });
    return kept;
}

/**
 * A fetch that forwards to `origin` and records every answer.
 *
 * A request the recorder already holds is answered from it at once and is not
 * sent. That is what lets a capture converge on code whose requests depend on
 * timing, such as a store's detached refreshes: a second pass over recordings
 * answers at replay speed, as the public lane will, and sends only the requests
 * that speed brings out. A `PUT`, `PATCH` or `DELETE` is always sent, held or
 * not: it changes what the server holds, and the server's later answers depend
 * on it having arrived.
 *
 * Every answer must be JSON, error answers included: a body the replayer could
 * not reproduce byte for byte is refused here instead of being recorded as
 * something else.
 *
 * @param origin - The live server, such as `http://127.0.0.1:50837`
 * @param recorder - Where answers are recorded
 * @param upstream - The fetch that reaches the server; the global one by
 *   default
 * @returns A fetch to hand the client under test
 */
export function createRecordingFetch(
    origin: string,
    recorder: Recorder,
    upstream: typeof fetch = globalThis.fetch,
): typeof fetch {
    return async (input, init) => {
        const request = keyed(input, init);
        // A request its caller cancelled before sending is never sent, live or
        // replayed, exactly as `fetch` itself behaves.
        init?.signal?.throwIfAborted();
        const held = STATE_CHANGING.has(request.method)
            ? undefined
            : recorder.find(request.path, request.body);
        if (held !== undefined) {
            return new Response(JSON.stringify(held.body), {
                status: held.statusCode,
                headers: {
                    ...held.headers,
                    'content-type': 'application/json',
                },
            });
        }
        // A request cancelled while in flight is still recorded: the replay
        // answers before the caller can cancel it, so it has to have an answer.
        // The caller hears the cancellation once the answer is in.
        const { signal, ...sent } = init ?? {};
        const response = await upstream(new URL(request.path, origin).href, {
            ...sent,
            signal: AbortSignal.timeout(LIVE_TIMEOUT_MS),
        });
        const text = await response.text();
        let body: unknown;
        try {
            body = JSON.parse(text) as unknown;
        } catch {
            throw new Error(
                `${request.method} ${request.path} answered ${response.status} ` +
                    'with a body that is not JSON, which cannot be recorded',
            );
        }
        const headers = keptHeaders(response.headers);
        recorder.record({
            path: request.path,
            body: request.body,
            response: body,
            statusCode: response.status,
            method: request.method,
            headers,
        });
        signal?.throwIfAborted();
        return new Response(text, {
            status: response.status,
            headers: { ...headers, 'content-type': 'application/json' },
        });
    };
}

/**
 * A fetch that answers from recordings and never reaches a network.
 *
 * A request whose signal is already aborted rejects with the abort reason and
 * is not looked up, as `fetch` behaves. A request with no recording rejects,
 * the way a refused connection would, so the client under test reports it as a
 * failure. `onMiss` hears about it too, because the code under test may catch
 * the rejection and carry on.
 *
 * @param recordings - Recorded responses keyed by recording key
 * @param onMiss - Told about every request that had no recording
 * @param onHit - Told the key of every recording that answered, so a caller can
 *   tell which recordings a run used
 * @returns A fetch to hand the client under test
 */
export function createReplayFetch(
    recordings: Record<string, ReplayerRecording>,
    onMiss: (miss: MissEnvelope & { method: string }) => void = () => {},
    onHit: (key: string) => void = () => {},
): typeof fetch {
    return async (input, init) => {
        const request = keyed(input, init);
        init?.signal?.throwIfAborted();
        const result = lookup(recordings, request);
        if (result.kind === 'miss') {
            onMiss({ ...result.envelope, method: request.method });
            throw new Error(`${request.method}: ${result.envelope.message}`);
        }
        onHit(result.key);
        return new Response(JSON.stringify(result.body), {
            status: result.statusCode,
            headers: { ...result.headers, 'content-type': 'application/json' },
        });
    };
}
