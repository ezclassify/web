/**
 * Boot one real EzClassify REST API for the integration run and hand its origin
 * to the specs.
 *
 * The adapter-parity suite exists to prove that `EzClassifyClient` and the
 * local engine answer the same calls the same way. A mock server cannot prove
 * that: a mock written in this repo would encode the same assumption about the
 * wire as the client it is testing. So the suite drives the actual
 * `@ezclassify/rest-api` in-process, over real HTTP on a loopback port.
 *
 * It runs as vitest `globalSetup` rather than a per-file `beforeAll` so the
 * engine the server carries is loaded once for the whole run, and so the
 * server's environment configuration never lands in a worker running specs that
 * did not ask for a server.
 *
 * Reach it from a spec with `inject('restApiBaseUrl')`.
 */
import * as http from 'node:http';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { installTestContextTokens } from '@ezclassify/testing-utils/context-token';
import { installLicensedRuntime } from '@ezclassify/testing-utils/licensed-runtime';
import type { TestProject } from 'vitest/node';

const require_ = createRequire(import.meta.url);

/**
 * The example scheme the annotated parity scheme is derived from, and what the
 * derivation adds. No example scheme declares a definition, guidance or
 * role-aware processing, so without this one the suite could not tell a wire
 * that carries those optional summary fields from one that drops them.
 */
const ANNOTATED_SCHEME = {
    id: 'cedar-valley-annotated',
    from: 'cedar-valley',
    adds: {
        definition: 'A district file marking, written once per file.',
        guidance: 'Mark the whole file first, then each part that differs.',
        role_aware: true,
    },
} as const;

/**
 * Ids of the schemes the parity suite loads. Each is its own Context on the
 * server, and the spec loads each into its own local engine.
 */
export const PARITY_SCHEME_IDS = [
    // Single category, ranked concepts, three render formats.
    'cedar-valley-protection',
    // Two categories, so category ordering and multi-category rollup are live.
    'cedar-valley-handling',
    // Scoped and context-aware, with thirteen categories and rules: the shape
    // that exercises scope resolution and whole/part render formats.
    'cedar-valley',
    // The same scheme, role-aware and with its optional descriptive fields
    // populated.
    ANNOTATED_SCHEME.id,
] as const;

/**
 * The compiled scheme document behind one of {@link PARITY_SCHEME_IDS}, as the
 * JSON text the server reads. Exported so the spec loads into the local engine
 * exactly the document the server loaded into its own.
 *
 * @param id - A parity scheme id
 * @returns The scheme document's JSON text
 */
export function paritySchemeJson(
    id: (typeof PARITY_SCHEME_IDS)[number],
): string {
    const pkg = require_.resolve('@ezclassify/example-schemes/package.json');
    const dist = join(
        pkg.slice(0, pkg.length - '/package.json'.length),
        'dist',
        'schemes',
    );
    const read = (source: string) =>
        readFileSync(join(dist, `${source}@1.0.0.json`), 'utf8');
    if (id !== ANNOTATED_SCHEME.id) return read(id);
    const document = JSON.parse(read(ANNOTATED_SCHEME.from)) as {
        scheme: Record<string, unknown>;
    };
    return JSON.stringify({
        ...document,
        scheme: { ...document.scheme, ...ANNOTATED_SCHEME.adds, id },
    });
}

/**
 * Fail loudly, and with the fix, when the private packages are not installed.
 * The tier is opt-in, so a silent skip would let it look like it ran.
 */
function requireServerPackage(): void {
    try {
        require_.resolve('@ezclassify/rest-api/package.json');
        require_.resolve('@ezclassify/example-schemes/package.json');
    } catch {
        throw new Error(
            'The integration tier needs @ezclassify/rest-api and ' +
                '@ezclassify/example-schemes from the private package registry. ' +
                'Run `npm run lane:private` before `npm run test:integration`.',
        );
    }
}

export default async function setup(project: TestProject) {
    requireServerPackage();
    // The app reads its configuration from the environment at import time, so
    // every variable must be set before the dynamic import below.
    const developmentDir = mkdtempSync(
        join(tmpdir(), 'ezclassify-parity-contexts-'),
    );
    for (const id of PARITY_SCHEME_IDS) {
        writeFileSync(
            join(developmentDir, `${id}@1.0.0.json`),
            paritySchemeJson(id),
        );
    }
    writeFileSync(
        join(developmentDir, 'contexts.json'),
        JSON.stringify({
            contexts: PARITY_SCHEME_IDS.map((id) => ({
                id,
                version: '1.0.0',
                scheme: { id, version: '1.0.0' },
            })),
        }),
    );
    // The REST API refuses to start without signed Runtime rights, so it runs
    // under an ephemeral development license and trust root.
    const runtime = await installLicensedRuntime();
    Object.assign(process.env, runtime.environment);
    process.env['EZCLASSIFY_ARTIFACT_PATH'] = developmentDir;
    process.env['EZCLASSIFY_ARTIFACT_PATH_WATCH'] = '0';
    process.env['EZCLASSIFY_AUTH'] = 'none';
    process.env['LOG_SILENT'] = '1';
    process.env['REST_API_LOG_SOURCE'] = '0';
    // Every spec is one unauthenticated principal, so the whole run shares one
    // rate-limit bucket. The default per-minute ceiling is sized for a
    // deployment, not for a suite that replays the full operation table per
    // scheme within a second.
    process.env['RATE_LIMIT_MAX'] = '100000';
    process.env['RATE_LIMIT_MAX_SUGGEST'] = '100000';

    const app = await import('@ezclassify/rest-api');
    await app.initializeServer();
    const contextTokens = installTestContextTokens(
        app,
        PARITY_SCHEME_IDS.map((contextId) => ({
            contextId,
            versions: ['1.0.0'],
        })),
    );
    const server = http.createServer(app.handleRequest);
    await new Promise<void>((ready) => server.listen(0, '127.0.0.1', ready));
    const { port } = server.address() as { port: number };

    project.provide('restApiBaseUrl', `http://127.0.0.1:${port}`);
    project.provide(
        'restApiContextTokens',
        Object.fromEntries(
            PARITY_SCHEME_IDS.map((id) => [id, contextTokens.tokenFor(id)]),
        ),
    );

    return async () => {
        await new Promise<void>((done) => server.close(() => done()));
        contextTokens.uninstall();
        runtime.dispose();
        rmSync(developmentDir, { recursive: true, force: true });
    };
}
