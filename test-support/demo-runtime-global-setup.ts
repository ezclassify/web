/**
 * Vitest global setup: in record mode, build and start the local demo runtime
 * the recordings are made against. In the public lane it does nothing.
 *
 * Record mode (`EZCLASSIFY_RECORD=1`) is the maintainer lane. It needs the
 * workspace checkouts beside this repository:
 *
 * - `engine`, whose `ezclassify-demo-runtime` is built the way the hosted demo
 *   runtime image builds it: the `release` profile, `--locked`, with the
 *   `provide` feature that opens the draft door.
 * - `orchestration`, whose `assemble-demo-contexts.mjs` writes the website demo
 *   set from `manifests/demo-contexts.yaml`. That set is what the hosted demo
 *   runtime embeds, so the built-in Context ids a spec connects to (Cedar
 *   Valley among them) are the ones the Playground serves. Assembly reads the
 *   content checkouts the manifest names.
 *
 * The build runs `cargo build --release --locked -p ezclassify-demo-runtime
 * --features provide` with `CARGO_BUILD_JOBS=4` into the engine checkout's
 * `target`, on the engine source of the commit in `engine.pin`, which it
 * extracts from that checkout with `git archive`; the checkout's own branch and
 * edits do not matter. The binary path comes from cargo's own build messages,
 * and a build is reused while the pin, the build settings and the assembled
 * demo set are unchanged. The runtime listens on a loopback port the kernel
 * picks; the setup reads the address from the runtime's startup log, waits a
 * bounded time for it to answer `/v1/ready`, and checks that it lists every
 * Context of the set.
 *
 * Recordings have to be reproducible from this repository, so the checkouts
 * they are made from are pinned in `test-support/<checkout>.pin`: the engine
 * source as above; the `scheme-folder` of community-content and of
 * enterprise-content, which the demo set is assembled from; and in
 * orchestration the assembly script with every module it imports, its manifest,
 * and the `package.json` and `package-lock.json` that fix the packages it
 * imports. The setup refuses a checkout whose pinned paths differ from the pin
 * in any way, committed, edited or untracked. The REST client the specs record
 * through is pinned to an exact version in the root `package.json`. Moving a
 * pin and re-recording is one change.
 *
 * Specs reach it through `test-support/demo-runtime.ts`, which reads the origin
 * and health this setup provides.
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
    copyFileSync,
    existsSync,
    mkdirSync,
    readFileSync,
    readdirSync,
    renameSync,
    rmSync,
} from 'node:fs';
import * as path from 'node:path';
import type { TestProject } from 'vitest/node';
import { RECORD_VARIABLE, recording } from './record-mode';

/** The directory holding this repository and its sibling checkouts. */
const WORKSPACE = path.resolve(import.meta.dirname, '..', '..');

/** Orchestration's script that writes a demo set. */
const ASSEMBLY_SCRIPT = 'scripts/assemble-demo-contexts.mjs';

/** The demo set the hosted (Playground) demo runtime embeds. */
const DEMO_SET = 'website';

/** How long a cold build of the runtime may take before the setup gives up. */
const BUILD_TIMEOUT_MS = 45 * 60_000;

/**
 * How the runtime is built: the hosted demo runtime image's own build
 * (`deploy/Dockerfile` in the engine, its `build-hosted` stage). Part of the
 * build key, so a binary built any other way is never reused.
 */
const CARGO_BUILD_ARGS = [
    'build',
    '--release',
    '--locked',
    '-p',
    'ezclassify-demo-runtime',
    '--features',
    'provide',
];

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

/** Where the pins of the checkouts the recordings are made from live. */
const PINS = import.meta.dirname;

/** A pinned commit, read from `test-support/<name>.pin`. */
function pin(name: string): string {
    return readFileSync(path.join(PINS, `${name}.pin`), 'utf8').trim();
}

/**
 * Refuse a sibling checkout whose `paths` are not its pinned commit's, with a
 * change committed after the pin, an edit, or a file Git does not track.
 */
function requirePinned(name: string, dir: string, paths: string[]): void {
    const commit = pin(name);
    const refuse = (why: string): never => {
        throw new Error(
            `${dir} is not ${name} ${commit} (test-support/${name}.pin) in ` +
                `${paths.join(', ')}: ${why}. Check out the pinned commit, or ` +
                'move the pin and re-record.',
        );
    };
    const diff = spawnSync('git', ['diff', '--quiet', commit, '--', ...paths], {
        cwd: dir,
        encoding: 'utf8',
    });
    if (diff.status === 1) refuse('it differs from the pin');
    if (diff.status !== 0)
        refuse(diff.stderr.trim() || `git exited ${diff.status}`);
    const untracked = run(
        'git',
        ['ls-files', '--others', '--exclude-standard', '--', ...paths],
        { cwd: dir },
    ).trim();
    if (untracked)
        refuse(`untracked files: ${untracked.split('\n').join(', ')}`);
}

/**
 * The engine source at its pin, extracted from the sibling checkout with `git
 * archive`. The checkout itself is left alone: it may be at any commit, with
 * any edits, while the recordings are made from the pinned source only.
 *
 * @returns The directory holding the pinned source tree
 */
function pinnedEngineSource(engine: string): string {
    const commit = pin('engine');
    const dir = path.join(
        engine,
        'target',
        'web-recordings',
        `engine-${commit}`,
    );
    if (existsSync(path.join(dir, 'Cargo.toml'))) return dir;
    const staging = `${dir}.partial`;
    rmSync(staging, { recursive: true, force: true });
    mkdirSync(staging, { recursive: true });
    const archive = `${staging}.tar`;
    run('git', ['archive', '--format=tar', '-o', archive, commit], {
        cwd: engine,
    });
    run('tar', ['-xf', archive, '-C', staging], { cwd: engine });
    rmSync(archive, { force: true });
    renameSync(staging, dir);
    return dir;
}

/** A relative module specifier in an import or re-export of a module. */
const RELATIVE_IMPORT =
    /(?:\bfrom\s*|\bimport\s*\(?\s*)(['"])(\.{1,2}\/[^'"]+)\1/g;

/**
 * A module and every module it reaches through relative imports, as paths
 * relative to `dir`, sorted. Package imports are left out: the package files
 * that fix them are pinned beside this list.
 *
 * @param dir - The checkout the modules live in
 * @param entry - The first module, relative to `dir`
 */
function moduleClosure(dir: string, entry: string): string[] {
    const found = new Set<string>();
    const visit = (module: string) => {
        if (found.has(module)) return;
        found.add(module);
        const text = readFileSync(path.join(dir, module), 'utf8');
        for (const [, , specifier] of text.matchAll(RELATIVE_IMPORT)) {
            visit(
                path.relative(
                    dir,
                    path.resolve(
                        path.dirname(path.join(dir, module)),
                        specifier!,
                    ),
                ),
            );
        }
    };
    visit(entry);
    return [...found].sort();
}

/** One digest over every file under `dir`, by relative path and bytes. */
function treeDigest(dir: string): string {
    const hash = createHash('sha256');
    const walk = (at: string) => {
        for (const entry of readdirSync(at, { withFileTypes: true }).sort(
            (a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0),
        )) {
            const full = path.join(at, entry.name);
            if (entry.isDirectory()) walk(full);
            else {
                hash.update(path.relative(dir, full))
                    .update('\0')
                    .update(readFileSync(full))
                    .update('\0');
            }
        }
    };
    walk(dir);
    return hash.digest('hex');
}

/**
 * Assemble the demo set and build the runtime from the pinned engine source.
 *
 * Every test project of a recording run calls this, and `npm run record` runs
 * each several times. A build whose engine pin, build settings and demo set are
 * unchanged is reused as it stands, so only the first call compiles.
 *
 * @returns The binary's path and the Context ids of the set it embeds
 */
function buildRuntime(): { binary: string; contextIds: string[] } {
    for (const content of ['community-content', 'enterprise-content']) {
        requirePinned(content, sibling(content, 'scheme-folder'), [
            'scheme-folder',
        ]);
    }
    const orchestration = sibling('orchestration', ASSEMBLY_SCRIPT);
    requirePinned('orchestration', orchestration, [
        ...moduleClosure(orchestration, ASSEMBLY_SCRIPT),
        'manifests/demo-contexts.yaml',
        'package.json',
        'package-lock.json',
    ]);
    const engine = sibling('engine', 'apps/demo-runtime/Cargo.toml');
    const source = pinnedEngineSource(engine);
    const builds = path.join(engine, 'target', 'web-recordings');
    const assembled = path.join(builds, `demo-contexts-${process.pid}`);
    rmSync(assembled, { recursive: true, force: true });
    run(
        process.execPath,
        [ASSEMBLY_SCRIPT, '--set', DEMO_SET, '--out', assembled],
        // The checkouts beside this repository are the ones to read, even when
        // orchestration is a link to a checkout that sits somewhere else.
        {
            cwd: orchestration,
            env: { ...process.env, EZ_REPOS_DIR: WORKSPACE },
        },
    );
    const key = createHash('sha256')
        .update(pin('engine'))
        .update('\0')
        .update(CARGO_BUILD_ARGS.join(' '))
        .update('\0')
        .update(treeDigest(assembled))
        .digest('hex')
        .slice(0, 32);
    const build = path.join(builds, `runtime-${key}`);
    const contexts = path.join(build, 'demo-contexts');
    const binary = path.join(build, 'ezclassify-demo-runtime');
    if (existsSync(binary)) {
        rmSync(assembled, { recursive: true, force: true });
    } else {
        rmSync(build, { recursive: true, force: true });
        mkdirSync(build, { recursive: true });
        renameSync(assembled, contexts);
        const messages = run(
            'cargo',
            [...CARGO_BUILD_ARGS, '--message-format=json-render-diagnostics'],
            {
                cwd: source,
                env: {
                    ...process.env,
                    CARGO_BUILD_JOBS: '4',
                    // The engine checkout's own target, so dependencies built
                    // there are reused.
                    CARGO_TARGET_DIR: path.join(engine, 'target'),
                    EZCLASSIFY_DEMO_CONTEXTS_DIR: contexts,
                },
            },
        );
        let built: string | undefined;
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
                built = message.executable;
            }
        }
        if (!built) {
            throw new Error(
                'cargo built no ezclassify-demo-runtime executable',
            );
        }
        // Cargo's own copy is overwritten by the next build of the same
        // target from any checkout, so the runtime runs from a copy of its own.
        copyFileSync(built, binary);
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
        // Test workers send far more requests at once than one Playground page.
        EZCLASSIFY_DEMO_MAX_REQUESTS_IN_FLIGHT: '1024',
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
