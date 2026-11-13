/**
 * Vitest global setup: in record mode, build and start the local demo runtime
 * the recordings are made against. In the public lane it does nothing.
 *
 * Record mode (`EZCLASSIFY_RECORD=1`) is the maintainer lane. It needs the
 * workspace checkouts beside this repository:
 *
 * - `engine`, whose `ezclassify-demo-runtime` is built with its `provide`
 *   feature, the build the website Playground runs, draft door included.
 * - `orchestration`, whose `assemble-demo-contexts.mjs` writes the website demo
 *   set from `manifests/demo-contexts.yaml`. That set is what the hosted demo
 *   runtime embeds, so the built-in Context ids a spec connects to (Cedar
 *   Valley among them) are the ones the Playground serves. Assembly reads the
 *   content checkouts the manifest names.
 *
 * The build runs `cargo build -p ezclassify-demo-runtime --features provide` in
 * the engine checkout with `CARGO_BUILD_JOBS=4`, into whatever target directory
 * cargo uses there, and takes the binary path from cargo's own build messages.
 * The runtime listens on a loopback port the kernel picks; the setup reads the
 * address from the runtime's startup log, waits a bounded time for it to answer
 * `/v1/ready`, and checks that it lists every Context of the set.
 *
 * Recordings have to be reproducible, so the Cedar Valley documents the set is
 * assembled from come from the community-content commit in
 * `community-content.pin`: the setup refuses a sibling checkout whose
 * `scheme-folder` differs from that commit, committed or not. Moving the pin
 * and re-recording is one change.
 *
 * Specs reach it through `test-support/demo-runtime.ts`, which reads the origin
 * and health this setup provides.
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import * as path from 'node:path';
import type { TestProject } from 'vitest/node';
import { RECORD_VARIABLE, recording } from './record-mode';

/** The directory holding this repository and its sibling checkouts. */
const WORKSPACE = path.resolve(import.meta.dirname, '..', '..');

/** The demo set the hosted (Playground) demo runtime embeds. */
const DEMO_SET = 'website';

/** How long a cold build of the runtime may take before the setup gives up. */
const BUILD_TIMEOUT_MS = 20 * 60_000;

/** How long the started runtime has to report its address and answer ready. */
const STARTUP_TIMEOUT_MS = 30_000;

/** How long a stop waits for the runtime to exit before killing it. */
const STOP_TIMEOUT_MS = 25_000;

/** The runtime's own environment namespaces; it refuses unknown names there. */
const RUNTIME_NAMESPACES = ['EZCLASSIFY_DEMO_', 'EZCLASSIFY_DRAFT_'];

/** A sibling checkout, or a failure that says which one is missing. */
function sibling(name: string, marker: string): string {
    const dir = path.join(WORKSPACE, name);
    if (!existsSync(path.join(dir, marker))) {
        throw new Error(
            `${RECORD_VARIABLE}=1 records against a local demo runtime and needs ` +
                `the ${name} checkout at ${dir} (no ${marker} there).`,
        );
    }
    return dir;
}

/** Run a command to completion, failing with its name and status. */
function run(
    command: string,
    args: string[],
    options: { cwd: string; env?: NodeJS.ProcessEnv },
): string {
    const result = spawnSync(command, args, {
        cwd: options.cwd,
        env: options.env ?? process.env,
        encoding: 'utf8',
        maxBuffer: 256 * 1024 * 1024,
        stdio: ['ignore', 'pipe', 'inherit'],
        timeout: BUILD_TIMEOUT_MS,
    });
    if (result.status !== 0) {
        throw new Error(
            `${command} ${args.join(' ')} failed in ${options.cwd} ` +
                `(${result.error?.message ?? `exit ${result.status}`})`,
        );
    }
    return result.stdout;
}

/** The community-content commit the recordings are made from. */
const CONTENT_PIN = path.join(import.meta.dirname, 'community-content.pin');

/** Refuse a community-content checkout whose scheme folder is not the pin's. */
function requirePinnedContent(): void {
    const content = sibling('community-content', 'scheme-folder');
    const pin = readFileSync(CONTENT_PIN, 'utf8').trim();
    const diff = spawnSync(
        'git',
        ['diff', '--quiet', pin, '--', 'scheme-folder'],
        {
            cwd: content,
            encoding: 'utf8',
        },
    );
    if (diff.status !== 0) {
        throw new Error(
            `${content}/scheme-folder is not community-content ${pin} ` +
                '(test-support/community-content.pin)' +
                (diff.status === 1 ? '' : `: ${diff.stderr.trim()}`) +
                '. Check out the pinned commit, or move the pin and re-record.',
        );
    }
}

/** Assemble the demo set and build the runtime; returns the binary's path. */
function buildRuntime(): { binary: string; contextIds: string[] } {
    requirePinnedContent();
    const engine = sibling('engine', 'apps/demo-runtime/Cargo.toml');
    const orchestration = sibling(
        'orchestration',
        'scripts/assemble-demo-contexts.mjs',
    );
    const contexts = path.join(engine, 'target', 'demo-contexts', DEMO_SET);
    run(
        process.execPath,
        [
            'scripts/assemble-demo-contexts.mjs',
            '--set',
            DEMO_SET,
            '--out',
            contexts,
        ],
        // The checkouts beside this repository are the ones to read, even when
        // orchestration is a link to a checkout that sits somewhere else.
        {
            cwd: orchestration,
            env: { ...process.env, EZ_REPOS_DIR: WORKSPACE },
        },
    );
    const messages = run(
        'cargo',
        [
            'build',
            '-p',
            'ezclassify-demo-runtime',
            '--features',
            'provide',
            '--message-format=json-render-diagnostics',
        ],
        {
            cwd: engine,
            env: {
                ...process.env,
                CARGO_BUILD_JOBS: '4',
                EZCLASSIFY_DEMO_CONTEXTS_DIR: contexts,
            },
        },
    );
    let binary: string | undefined;
    for (const line of messages.split('\n')) {
        if (!line.startsWith('{')) continue;
        const message = JSON.parse(line) as {
            reason?: string;
            target?: { name?: string };
            executable?: string | null;
        };
        if (
            message.reason === 'compiler-artifact' &&
            message.target?.name === 'ezclassify-demo-runtime' &&
            message.executable
        ) {
            binary = message.executable;
        }
    }
    if (!binary) {
        throw new Error('cargo built no ezclassify-demo-runtime executable');
    }
    const contextIds = readdirSync(contexts, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort();
    return { binary, contextIds };
}

/** The environment the runtime starts with: ours, minus its namespaces. */
function runtimeEnvironment(): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = {};
    for (const [name, value] of Object.entries(process.env)) {
        if (!RUNTIME_NAMESPACES.some((prefix) => name.startsWith(prefix))) {
            env[name] = value;
        }
    }
    return {
        ...env,
        EZCLASSIFY_DEMO_LISTEN: '127.0.0.1:0',
        EZCLASSIFY_DEMO_LOG_LEVEL: 'info',
        // A recording run holds every draft it sends for its whole length.
        EZCLASSIFY_DRAFT_IDLE_SECONDS: '3600',
    };
}

/** Start the runtime and resolve with its origin once it reports serving. */
function start(
    binary: string,
): Promise<{ child: ChildProcess; origin: string }> {
    const child = spawn(binary, [], {
        env: runtimeEnvironment(),
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    const log: string[] = [];
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            child.kill('SIGKILL');
            reject(
                new Error(
                    `the demo runtime did not report its address within ` +
                        `${STARTUP_TIMEOUT_MS} ms:\n${log.slice(-20).join('\n')}`,
                ),
            );
        }, STARTUP_TIMEOUT_MS);
        let pending = '';
        child.stdout!.setEncoding('utf8');
        child.stdout!.on('data', (chunk: string) => {
            pending += chunk;
            const lines = pending.split('\n');
            pending = lines.pop() ?? '';
            for (const line of lines) {
                log.push(line);
                let entry: { message?: string; address?: string };
                try {
                    entry = JSON.parse(line) as typeof entry;
                } catch {
                    continue;
                }
                if (entry.message === 'serving' && entry.address) {
                    clearTimeout(timer);
                    resolve({ child, origin: `http://${entry.address}` });
                }
            }
        });
        child.stderr!.setEncoding('utf8');
        child.stderr!.on('data', (chunk: string) => log.push(chunk.trimEnd()));
        child.once('exit', (code, signal) => {
            clearTimeout(timer);
            reject(
                new Error(
                    `the demo runtime exited (${signal ?? code}) before serving:\n` +
                        log.slice(-20).join('\n'),
                ),
            );
        });
    });
}

/** GET a JSON route of the started runtime, failing on any other answer. */
async function getJson(origin: string, route: string): Promise<unknown> {
    const response = await fetch(`${origin}${route}`, {
        signal: AbortSignal.timeout(STARTUP_TIMEOUT_MS),
    });
    if (!response.ok) {
        throw new Error(`GET ${route} answered ${response.status}`);
    }
    return response.json();
}

/** Stop the runtime, waiting a bounded time for it to drain. */
function stop(child: ChildProcess): Promise<void> {
    if (child.exitCode !== null || child.signalCode !== null) {
        return Promise.resolve();
    }
    return new Promise((resolve) => {
        const timer = setTimeout(() => child.kill('SIGKILL'), STOP_TIMEOUT_MS);
        child.once('exit', () => {
            clearTimeout(timer);
            resolve();
        });
        child.kill('SIGTERM');
    });
}

export default async function setup(project: TestProject) {
    if (!recording) return;
    const { binary, contextIds } = buildRuntime();
    const { child, origin } = await start(binary);
    try {
        await getJson(origin, '/v1/ready');
        const listing = (await getJson(origin, '/v1/ctx')) as {
            contexts?: string[];
        };
        const listed = new Set(listing.contexts ?? []);
        const absent = contextIds.filter((id) => !listed.has(id));
        if (absent.length > 0) {
            throw new Error(
                `the demo runtime does not list ${absent.join(', ')} from the ` +
                    `${DEMO_SET} demo set it was built with`,
            );
        }
        const health = (await getJson(origin, '/v1/health')) as {
            engineVersion: string;
            openapiVersion?: string;
        };
        project.provide('demoRuntimeOrigin', origin);
        project.provide('demoRuntimeHealth', {
            engineVersion: health.engineVersion,
            ...(health.openapiVersion === undefined
                ? {}
                : { openapiVersion: health.openapiVersion }),
        });
    } catch (error) {
        await stop(child);
        throw error;
    }
    return () => stop(child);
}
