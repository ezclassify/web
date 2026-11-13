/// <reference path="./demo-runtime-context.d.ts" />
/**
 * The demo runtime for specs: a REST client bound to recorded wire traffic in
 * the public lane, or to a live local demo runtime in the maintainer lane.
 *
 * Web specs exercise the runtime the website Playground uses, the Rust demo
 * runtime built with its draft door. Engine behavior reaches this repository
 * only as committed recordings of that runtime's wire traffic, so a spec never
 * imports an engine and a clean clone runs every spec.
 *
 * ## API
 *
 * ```ts
 * import {
 *     connectDemoContext,
 *     sendDraft,
 *     DraftRefusedError,
 * } from '../../test-support/demo-runtime';
 *
 * // A built-in demo Context, by id. Prefer these: anyone can re-record them.
 * const client = await connectDemoContext({ contextId: 'cedar-valley' });
 *
 * // A fixture of this repository, sent through the draft door.
 * const draft = await connectDemoContext({
 *     draft: { scheme: schemeYaml },
 * });
 *
 * // Hand either to the UI: an EzClassifyClient is a Context adapter.
 * EzClassifyUI.init({ context: client });
 * client.destroy();
 * ```
 *
 * - `connectDemoContext(target, options?)` returns a connected `EzClassifyClient`
 *   from `@ezclassify/rest-client`. `target` is either `{ contextId,
 *   contextVersion? }` for a built-in Context, or `{ draft }` for documents
 *   sent through `PUT /v1/sandbox/ctx`; a draft binds at its version `0.0.0`.
 *   `options` are the remaining `connectContext` options (`timeout`, `headers`
 *   and so on). The base URL and transport are the harness's.
 * - `sendDraft(draft)` sends documents through the draft door and returns the
 *   Context id the runtime assigned. It rejects with {@link DraftRefusedError},
 *   carrying the status and the runtime's error body, when the documents do not
 *   compose, which is how a spec asserts an engine refusal.
 * - `demoRuntimeFetch()` is the harness transport itself, for a spec that has to
 *   drive the wire directly. Request paths are taken from its URL; the origin
 *   is ignored.
 *
 * A draft is the body the draft door takes: `scheme` (with `layers`) or keyed
 * `schemes`, `guides`, `access`, `crosswalks`, each a parsed document or its
 * YAML or JSON text. The runtime names a draft by the hash of that body, so the
 * same documents always reach the same recordings.
 *
 * ## Lanes
 *
 * Public (the default): requests are answered from the spec file's recordings,
 * `__recordings__/<spec file name>.json` beside it. Nothing is started and no
 * network is used. A request with no recording rejects, and the spec file then
 * fails in its `afterAll` with every unrecorded request listed, even when the
 * code under test caught the rejection. A spec file with no recordings file
 * fails on its first connection. Nothing is skipped.
 *
 * Record (`EZCLASSIFY_RECORD=1`, the maintainer lane): the global setup
 * (`demo-runtime-global-setup.ts`) builds and starts a local demo runtime. A
 * request the spec file's recordings already hold is answered from them; any
 * other goes to the runtime and is added. UI code sends requests whose timing
 * depends on how fast answers arrive (a store's detached refreshes, rollups
 * that coalesce), so one live pass does not capture what a replay sends. `npm
 * run record` therefore deletes every recordings file and runs the suite in
 * record mode until a pass adds nothing, which is a pass at replay speed. `npm
 * run check:recordings` does the same and fails when the result differs from
 * what is committed: that is the freshness check. See DEVELOPMENT.md.
 *
 * In the public lane a draft's documents must come from this repository. A
 * draft read from a community-content checkout cannot be keyed where that
 * checkout is absent, so Cedar Valley is used through its built-in Contexts
 * (`cedar-valley`, `cedar-valley-protection`, `cedar-valley-handling`).
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';
import { expect, inject } from 'vitest';
import {
    connectContext,
    type ConnectContextArgs,
    type EzClassifyClient,
} from '@ezclassify/rest-client';
import {
    Recorder,
    createRecordingFetch,
    createReplayFetch,
    readRecordingsFile,
    type MissEnvelope,
    type RecordingsFile,
} from '../libs/ui-tools/src/record-replay';
import { RECORD_VARIABLE, recording } from './record-mode';

export { RECORD_VARIABLE, recording };

/**
 * The base URL the client is given while replaying. Nothing listens there: the
 * replay transport answers before a request could leave the process, and
 * `.invalid` guarantees that a request which escaped it would fail.
 */
const REPLAY_ORIGIN = 'http://demo-runtime.invalid';

/** The draft door's route. */
const DRAFT_PATH = '/v1/sandbox/ctx';

/** The version the runtime serves every draft at. */
const DRAFT_VERSION = '0.0.0';

/** The directory beside a spec file that holds its recordings. */
export const RECORDINGS_DIR = '__recordings__';

/**
 * Documents for the draft door, as `PUT /v1/sandbox/ctx` takes them. Each value
 * is a parsed document or its YAML or JSON text.
 */
export interface DraftComponents {
    scheme?: unknown;
    layers?: unknown[];
    schemes?: Record<string, unknown>;
    guides?: unknown[];
    access?: unknown;
    crosswalks?: unknown[];
    [component: string]: unknown;
}

/** Which Context a spec connects to. */
export type DemoContextTarget =
    { contextId: string; contextVersion?: string } | { draft: DraftComponents };

/** The `connectContext` options a spec still chooses. */
export type DemoConnectOptions = Omit<
    ConnectContextArgs,
    'baseUrl' | 'contextId' | 'contextVersion' | 'fetchImpl'
>;

/** A miss message names the request body, which for a draft is a document. */
const truncate = (message: string): string =>
    message.length > 300 ? `${message.slice(0, 300)}...` : message;

/** The draft door refused a draft. */
export class DraftRefusedError extends Error {
    override readonly name = 'DraftRefusedError';

    /**
     * @param status - The HTTP status the door answered
     * @param body - The runtime's error body: `code`, `detail` and, for a draft
     *   that does not compose, `diagnostics`
     */
    constructor(
        readonly status: number,
        readonly body: Record<string, unknown>,
    ) {
        super(
            `the draft door answered ${status}: ${String(body['error'] ?? body['detail'] ?? '')}`,
        );
    }
}

/** The recordings of one spec file, and the misses it has met. */
interface FileStore {
    file: string;
    fetch: typeof fetch;
    recorder?: Recorder;
    misses: Array<MissEnvelope & { method: string }>;
    /** Requests still in flight, which the file waits for before it closes. */
    inFlight: Set<Promise<unknown>>;
}

/**
 * Track a store's requests in flight. Code under test often leaves work running
 * when its last test ends (a store's detached refresh, a rollup), and at replay
 * speed that work finishes inside the spec file. Recording waits for it so the
 * replay finds its answer.
 */
function tracked(
    store: Omit<FileStore, 'fetch'>,
    send: typeof fetch,
): typeof fetch {
    return (input, init) => {
        const pending = send(input, init);
        store.inFlight.add(pending);
        const settle = () => store.inFlight.delete(pending);
        pending.then(settle, settle);
        return pending;
    };
}

const stores = new Map<string, FileStore>();

/**
 * The spec file running in this worker.
 *
 * @throws When called outside a running spec file
 */
function currentSpecFile(): string {
    const testPath = expect.getState().testPath;
    if (!testPath) {
        throw new Error(
            'test-support/demo-runtime is used from inside a spec file only: ' +
                'it names the recordings after the spec that is running',
        );
    }
    return testPath;
}

/** Where a spec file's recordings live. */
export function recordingsFileFor(specFile: string): string {
    return path.join(
        path.dirname(specFile),
        RECORDINGS_DIR,
        `${path.basename(specFile)}.json`,
    );
}

/** The live runtime's origin, provided by the global setup in record mode. */
function liveOrigin(): string {
    const origin = inject('demoRuntimeOrigin');
    if (!origin) {
        throw new Error(
            `${RECORD_VARIABLE}=1, but no demo runtime was started. Add ` +
                'test-support/demo-runtime-global-setup.ts to this vitest ' +
                "config's globalSetup.",
        );
    }
    return origin;
}

/** The store of the running spec file, opened on first use. */
function storeForCurrentFile(): FileStore {
    const spec = currentSpecFile();
    const held = stores.get(spec);
    if (held) return held;
    const file = recordingsFileFor(spec);
    let store: FileStore;
    if (recording) {
        // A later recording pass starts from the earlier pass's file, so the
        // requests replay speed brings out are added to it (see
        // `scripts/record-demo-runtime.mjs`).
        const recorder = new Recorder(
            existsSync(file) ? readRecordingsFile(file).responses : {},
        );
        const state = {
            file,
            recorder,
            misses: [],
            inFlight: new Set<Promise<unknown>>(),
        };
        store = {
            ...state,
            fetch: tracked(state, createRecordingFetch(liveOrigin(), recorder)),
        };
    } else {
        if (!existsSync(file)) {
            throw new Error(
                `${path.relative(process.cwd(), spec)} has no recordings at ` +
                    `${path.relative(process.cwd(), file)}. A maintainer ` +
                    'records them against a local demo runtime with ' +
                    '`npm run record` (DEVELOPMENT.md).',
            );
        }
        const recorded: RecordingsFile = readRecordingsFile(file);
        const misses: FileStore['misses'] = [];
        const state = { file, misses, inFlight: new Set<Promise<unknown>>() };
        store = {
            ...state,
            fetch: tracked(
                state,
                createReplayFetch(recorded.responses, (miss) =>
                    misses.push(miss),
                ),
            ),
        };
    }
    stores.set(spec, store);
    return store;
}

/** The base URL a client uses in this lane. */
function baseUrl(): string {
    return recording ? liveOrigin() : REPLAY_ORIGIN;
}

/**
 * The harness transport for the running spec file.
 *
 * @returns A fetch answered by the live runtime or by the recordings
 */
export function demoRuntimeFetch(): typeof fetch {
    return storeForCurrentFile().fetch;
}

/**
 * Send documents through the draft door.
 *
 * @param draft - The documents, as the draft door takes them
 * @returns The Context id the runtime assigned, `sbx-<sha256>`
 * @throws {DraftRefusedError} When the door refuses the draft
 */
export async function sendDraft(draft: DraftComponents): Promise<string> {
    const body = JSON.stringify(draft);
    // The door holds a few drafts per session, so each distinct draft takes a
    // session of its own and a spec file never evicts its own earlier draft.
    const session = `web-${createHash('sha256').update(body).digest('hex').slice(0, 32)}`;
    const response = await demoRuntimeFetch()(`${baseUrl()}${DRAFT_PATH}`, {
        method: 'PUT',
        headers: {
            'content-type': 'application/json',
            'x-ezclassify-session': session,
        },
        body,
    });
    const answer = (await response.json()) as Record<string, unknown>;
    if (!response.ok) throw new DraftRefusedError(response.status, answer);
    const contextId = answer['contextId'];
    if (typeof contextId !== 'string') {
        throw new Error(
            `the draft door answered ${response.status} without a contextId`,
        );
    }
    return contextId;
}

/**
 * Connect a REST client to a demo Context through the harness.
 *
 * @param target - A built-in Context id, or documents for the draft door
 * @param options - The remaining `connectContext` options
 * @returns A connected client; the spec destroys it
 */
export async function connectDemoContext(
    target: DemoContextTarget,
    options: DemoConnectOptions = {},
): Promise<EzClassifyClient> {
    const binding =
        'draft' in target
            ? {
                  contextId: await sendDraft(target.draft),
                  contextVersion: DRAFT_VERSION,
              }
            : target;
    return connectContext({
        ...options,
        ...binding,
        baseUrl: baseUrl(),
        fetchImpl: demoRuntimeFetch(),
    });
}

/**
 * Close the running spec file's recordings: write them in record mode, and fail
 * in the public lane when a request had no recording. Called from
 * `demo-runtime-setup-file.ts` after every spec file.
 *
 * @param format - Formats the recordings file's JSON text before it is written
 * @throws Listing every request that had no recording
 */
export async function closeSpecRecordings(
    format: (json: string, file: string) => Promise<string>,
): Promise<void> {
    const testPath = expect.getState().testPath;
    const store = testPath ? stores.get(testPath) : undefined;
    if (!store) return;
    if (testPath) stores.delete(testPath);
    // Each request is bounded by the transport's own deadline, so this ends.
    while (store.inFlight.size > 0) {
        await Promise.allSettled([...store.inFlight]);
    }
    if (store.recorder) {
        if (store.recorder.empty) {
            if (existsSync(store.file)) unlinkSync(store.file);
            return;
        }
        const health = inject('demoRuntimeHealth');
        const data = store.recorder.toFile(
            health?.engineVersion ?? 'unknown',
            health?.openapiVersion,
        );
        mkdirSync(path.dirname(store.file), { recursive: true });
        writeFileSync(
            store.file,
            await format(JSON.stringify(data), store.file),
            'utf8',
        );
        return;
    }
    if (store.misses.length > 0) {
        throw new Error(
            `${store.misses.length} request(s) had no recording in ` +
                `${path.relative(process.cwd(), store.file)}; re-record with ` +
                '`npm run record`:\n' +
                store.misses
                    .map((miss) => `  ${miss.method} ${truncate(miss.message)}`)
                    .join('\n'),
        );
    }
}
