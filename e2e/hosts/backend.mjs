/**
 * Dev-server backend for the integration hosts.
 *
 * A browser driving an EzClassify deployment holds two separate credentials:
 * the person's bearer, minted by the identity provider, and the application's
 * Context token, which the application BACKEND holds and hands out to its
 * browser sessions. This module is that backend in the smallest form a test
 * host can have. It does two jobs: it serves the pair at `/session`, and it
 * relays `/v1` to something that answers the EzClassify wire.
 *
 * Which something depends on the lane.
 *
 * By default the dev server starts `@ezclassify/conformance-server` in its own
 * process over the whole golden wire corpus, with simulated authentication, so
 * a request missing either credential is refused. `golden-corpus.spec.ts` runs
 * against it. A named scenario (`EZ_INTEGRATION_SCENARIO`) replays that
 * scenario instead; the refusal scenarios are what `scenario-refusal.spec.ts`
 * runs.
 *
 * Point `EZ_LICENSED_RUNTIME_STATUS_FILE` at a status file and the relay goes
 * to the deployment that file describes, using the session the file carries.
 * Nothing in this repository writes that file. Whatever wrote it owns booting
 * the deployment, and `licensed-deployment.spec.ts` is the suite that lane
 * runs.
 *
 * The relay exists because a deployment sends no `Access-Control-Allow-Origin`
 * unless an operator configures one, so a browser on the dev server's origin
 * cannot reach it cross-origin. Here the dev server is the one origin.
 *
 * Issuing a Context token to a registered application is a route EzClassify
 * does not serve, so the replay session below is minted rather than issued.
 * Everything downstream of it is real. Nothing here ships in a build.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
    TEST_BEARER_TOKEN,
    startConformanceServer,
} from '@ezclassify/conformance-server';

/** Environment variable naming a deployment status file, when one exists. */
const STATUS_FILE_VARIABLE = 'EZ_LICENSED_RUNTIME_STATUS_FILE';

/** Environment variable selecting the replay scenario, or the strict corpus. */
const SCENARIO_VARIABLE = 'EZ_INTEGRATION_SCENARIO';

/** The selection that replays the whole golden wire corpus. */
const GOLDEN_CORPUS = 'golden-corpus';

/**
 * The compositions the recordings were made against.
 *
 * A replay server answers the requests in its corpus and nothing else, so the
 * Context a host binds to is the one the recordings carry.
 */
const CORPUS_CONTEXT = { id: 'ez-full', version: '1.0.0' };
const SCENARIO_CONTEXT = { id: 'cedar-valley', version: '1.0.0' };

/**
 * The Context token the replay lanes send.
 *
 * The replay server never reads it. The corpus records which KIND of credential
 * a request presented, never a value. The host sends one anyway, and the golden
 * corpus suite asserts both credentials are on every request.
 */
const REPLAY_CONTEXT_TOKEN = 'ezclassify-test-host-context-token';

/**
 * Read the deployment status file, if this environment names one.
 *
 * `session.contextVersion` is optional: a status file that omits it lets the
 * deployment decide, which is what the client does with an omitted version.
 *
 * @param {NodeJS.ProcessEnv} [env] Environment carrying the file location.
 * @returns {{
 *     baseUrl: string;
 *     session: {
 *         contextId: string;
 *         contextVersion?: string;
 *         contextToken: string;
 *         principals: Record<string, { subject: string; bearer: string }>;
 *     };
 * } | null}
 *   The status, validated far enough to fail with a useful message, or null when
 *   no status file is named and a replay lane applies.
 * @throws {Error} When the variable is set but the file is missing, unreadable,
 *   or is not a status file carrying a session.
 */
export function deploymentStatus(env = process.env) {
    const location = env[STATUS_FILE_VARIABLE];
    if (!location) return null;
    const path = resolve(location);
    let status;
    try {
        status = JSON.parse(readFileSync(path, 'utf8'));
    } catch (error) {
        throw new Error(
            `${STATUS_FILE_VARIABLE} names ${path}, which could not be read: ${
                error instanceof Error ? error.message : String(error)
            }`,
        );
    }
    // Validate every field sessionPayload consumes and report the status file
    // and the fields at fault before the dev server starts.
    const session = status?.session;
    const invalid = [];
    if (typeof status?.baseUrl !== 'string') invalid.push('baseUrl');
    if (typeof session?.contextId !== 'string')
        invalid.push('session.contextId');
    if (
        session?.contextVersion !== undefined &&
        typeof session.contextVersion !== 'string'
    )
        invalid.push('session.contextVersion');
    if (typeof session?.contextToken !== 'string')
        invalid.push('session.contextToken');
    if (typeof session?.principals?.author?.bearer !== 'string')
        invalid.push('session.principals.author.bearer');
    if (invalid.length > 0) {
        throw new Error(
            `${path} is not a deployment status file carrying a session block. ` +
                'It needs a deployment `baseUrl` and a `session` holding the ' +
                'Context id, the Context token and the principal bearers, and ' +
                'optionally a Context version. ' +
                `Missing or not a string: ${invalid.join(', ')}.`,
        );
    }
    return status;
}

/**
 * The session payload the browser asks its backend for.
 *
 * Only what a browser session legitimately needs: which Context it is bound to,
 * the application's Context token, and the caller bearer. `contextVersion` is
 * absent when the deployment status leaves it to the server.
 *
 * @param {ReturnType<typeof deploymentStatus>} status Deployment status, or
 *   null for a replay lane.
 * @param {string | undefined} scenario Replay scenario selected at startup.
 *   Absent or `golden-corpus` binds the host to the golden corpus's Context.
 * @returns {{
 *     contextId: string;
 *     contextVersion?: string;
 *     contextToken: string;
 *     accessToken: string;
 * }}
 *   The payload served at `/session`.
 */
export function sessionPayload(status, scenario) {
    if (!status) {
        const context =
            !scenario || scenario === GOLDEN_CORPUS
                ? CORPUS_CONTEXT
                : SCENARIO_CONTEXT;
        return {
            contextId: context.id,
            contextVersion: context.version,
            contextToken: REPLAY_CONTEXT_TOKEN,
            // The one bearer the replay server's simulated authentication
            // accepts. Imported rather than spelled out: it is a published test
            // value that moves with the package, not a credential.
            accessToken: TEST_BEARER_TOKEN,
        };
    }
    const { contextId, contextVersion, contextToken, principals } =
        status.session;
    return {
        contextId,
        ...(contextVersion === undefined ? {} : { contextVersion }),
        contextToken,
        accessToken: principals.author.bearer,
    };
}

/**
 * Dev-server proxy configuration: the session endpoint and the wire relay.
 *
 * Both entries are Vite proxy entries, which is what the Angular dev server
 * consumes too, so both hosts wire their backend the same way.
 *
 * @param {string} baseUrl Where `/v1` goes.
 * @param {ReturnType<typeof sessionPayload>} session What `/session` answers.
 * @returns {Record<string, object>} A Vite `server.proxy` map.
 */
export function backendProxy(baseUrl, session) {
    const payload = JSON.stringify(session);
    return {
        '/v1': {
            target: baseUrl,
            changeOrigin: true,
        },
        '/session': {
            // Never reached: the bypass below answers every request. A Vite
            // proxy entry still needs a target to be a valid entry.
            target: baseUrl,
            /**
             * Answer with the session instead of proxying.
             *
             * Returning the unchanged URL after ending the response is Vite's
             * "handled here" signal.
             *
             * @param {import('node:http').IncomingMessage} request Request.
             * @param {import('node:http').ServerResponse} response Response.
             * @returns {string} The unchanged request URL.
             */
            bypass(request, response) {
                response.setHeader('content-type', 'application/json');
                // A credential must not sit in a browser or proxy cache.
                response.setHeader('cache-control', 'no-store');
                response.end(payload);
                return request.url ?? '/session';
            },
        },
    };
}

/**
 * Bring up whichever backend this environment selected.
 *
 * The replay server listens on a free port in the dev server's own process and
 * goes away with it. Its unmatched-request reports stay on: when a client
 * change starts sending a request nobody recorded, that report is the most
 * useful thing on the console.
 *
 * @param {NodeJS.ProcessEnv} [env] Environment to read.
 * @returns {Promise<Record<string, object>>} A Vite `server.proxy` map.
 * @throws {Error} When both a status file and a replay scenario are selected.
 */
export async function hostBackend(env = process.env) {
    const status = deploymentStatus(env);
    const scenario = env[SCENARIO_VARIABLE];
    if (status && scenario) {
        throw new Error(
            `Select either ${SCENARIO_VARIABLE} or ${STATUS_FILE_VARIABLE}, not both.`,
        );
    }
    const session = sessionPayload(status, scenario);
    if (status) return backendProxy(status.baseUrl, session);

    const golden = !scenario || scenario === GOLDEN_CORPUS;
    const replay = await startConformanceServer({
        port: 0,
        ...(golden ? {} : { scenario }),
        // The corpus carries the wire's constant refusal, so the replay server
        // can enforce the caller bearer instead of ignoring it.
        auth: 'simulated',
    });
    console.log(
        `[conformance replay] serving ${golden ? GOLDEN_CORPUS : scenario} at ${replay.url} ` +
            `(contract ${replay.specVersion}, ${replay.corpus.servable} exchanges)`,
    );
    return backendProxy(replay.url, session);
}
