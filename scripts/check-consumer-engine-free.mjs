#!/usr/bin/env node
// Engine-freedom gate for the README examples and the e2e integration hosts.
//
// The examples under `examples/` exist to demonstrate one claim: a browser
// application consuming an EzClassify REST deployment needs the client, the UI
// library and a framework integration, and needs the ENGINE nowhere. The e2e
// hosts make the same claim for the integrations they test. A claim a reader
// has to take on faith is worth little, so this checks it the way the
// publication gate checks a tarball, by reading what is actually there rather
// than trusting a name.
//
// Three assertions per example: no dependency field names the engine, no file
// imports it (sources AND build output, because the build output is what a
// browser downloads), and the engine is absent from the closure an outside
// consumer would install, which is what makes the first two exhaustive rather
// than merely encouraging.
//
// THIS GATE BUILDS THE EXAMPLES ITSELF, the way the publication gate packs the
// tarballs it inspects, and for the same reason: a check whose evidence someone
// else has to produce first is a check that goes quietly vacuous the moment
// they do not. `dist/` is gitignored everywhere it lands, so on a fresh
// checkout the build half of this scan would otherwise walk fewer files and say
// nothing about it. The builds together take a few seconds.
//
// Usage: node scripts/check-consumer-engine-free.mjs [--verbose]

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    auditBuildOutput,
    auditEngineFreedom,
    auditInstallClosure,
    installClosure,
} from './check-consumer-engine-free-lib.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const verbose = process.argv.includes('--verbose');

/**
 * The examples this gate covers, and where each one's build lands.
 *
 * The output path is named rather than discovered because it is what makes the
 * build half of the scan falsifiable: a build that stops producing it, or a
 * configuration that quietly moves it, fails here instead of shrinking the file
 * count with no complaint.
 */
const CONSUMER_EXAMPLES = [
    { dir: 'examples/vanilla-example', output: 'dist' },
    { dir: 'examples/react-example', output: 'dist' },
    { dir: 'examples/vue-example', output: 'dist' },
    {
        dir: 'examples/angular-example',
        output: 'dist/angular-example/browser',
    },
    // The e2e workspace builds both integration hosts, each into its own
    // output, so each is held to a non-empty build of its own.
    { dir: 'e2e', output: 'dist/react-host' },
    { dir: 'e2e', output: 'dist/angular-host/browser' },
];

const CODE_EXTENSIONS = new Set([
    '.js',
    '.mjs',
    '.cjs',
    '.ts',
    '.tsx',
    '.jsx',
    '.vue',
    '.html',
]);
// Build caches, not artifacts: nothing a browser is ever served comes out of
// them, and the Angular one holds a copy of every dependency it has optimized.
const SKIP_DIRS = new Set(['node_modules', '.angular', 'test-results']);

/**
 * Every code file under a directory, recursively.
 *
 * @param {string} dir Directory to walk.
 * @param {string[]} [out] Accumulator.
 * @returns {string[]} Absolute file paths.
 */
function walkFiles(dir, out = []) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) {
            if (!SKIP_DIRS.has(entry.name))
                walkFiles(path.join(dir, entry.name), out);
        } else if (CODE_EXTENSIONS.has(path.extname(entry.name))) {
            out.push(path.join(dir, entry.name));
        }
    }
    return out;
}

/**
 * Build one example, so the scan below reads output this run produced.
 *
 * @param {string} example Workspace directory, repo-relative.
 * @returns {void}
 * @throws {Error} If the build fails.
 */
function buildExample(example) {
    const result = spawnSync(
        'npm',
        ['run', 'build', `--workspace=${example}`],
        { cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
    );
    if (result.status !== 0) {
        throw new Error(
            `building ${example} failed, so this gate cannot read what a browser would download:\n${result.stderr || result.stdout}`,
        );
    }
}

/**
 * Read an installed package's manifest.
 *
 * The hoisted `node_modules` entry, which for a workspace is a symlink to the
 * workspace itself, so a first-party package is read from its real manifest
 * rather than a stale copy.
 *
 * @param {string} name Package name.
 * @returns {Record<string, unknown> | null} The manifest, or null when the
 *   package is not installed.
 */
function readInstalledManifest(name) {
    const manifestPath = path.join(
        REPO_ROOT,
        'node_modules',
        name,
        'package.json',
    );
    if (!existsSync(manifestPath)) return null;
    return JSON.parse(readFileSync(manifestPath, 'utf8'));
}

const violations = [];
const builtWorkspaces = new Set();
for (const { dir: example, output } of CONSUMER_EXAMPLES) {
    const dir = path.join(REPO_ROOT, example);
    const manifestPath = path.join(dir, 'package.json');
    if (!existsSync(manifestPath)) {
        violations.push(`${example}: no package.json at ${manifestPath}`);
        continue;
    }
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

    // The e2e workspace emits two hosts in one build. Reuse that fresh build,
    // while keeping the output-presence and engine checks for each host.
    if (!builtWorkspaces.has(example)) {
        buildExample(example);
        builtWorkspaces.add(example);
    }
    const outputDir = path.join(dir, output);
    const built =
        existsSync(outputDir) && statSync(outputDir).isDirectory()
            ? walkFiles(outputDir)
            : [];
    const shortfall = auditBuildOutput(example, output, built);
    if (shortfall.length > 0) {
        violations.push(...shortfall);
        continue;
    }

    const files = walkFiles(dir).map((abs) => ({
        path: path.relative(REPO_ROOT, abs),
        text: readFileSync(abs, 'utf8'),
    }));
    // The example is private and never installed by name, so its own manifest
    // seeds the walk directly instead of being looked up in node_modules.
    const closure = installClosure(String(manifest.name), (candidate) =>
        candidate === manifest.name
            ? manifest
            : readInstalledManifest(candidate),
    );
    if (verbose) {
        console.log(
            `[consumer-engine-free] ${example}: ${files.length} file(s) scanned ` +
                `(${built.length} of them built under ${output}), ` +
                `${closure.reached.size} package(s) in the install closure`,
        );
    }
    violations.push(
        ...auditEngineFreedom({ name: example, manifest, files }),
        ...auditInstallClosure(example, closure),
    );
}

if (violations.length > 0) {
    console.error('[consumer-engine-free] FAILED');
    for (const violation of violations) console.error(`  - ${violation}`);
    process.exit(1);
}

console.log(
    `[consumer-engine-free] OK: ${CONSUMER_EXAMPLES.length} application(s) carry no engine`,
);
