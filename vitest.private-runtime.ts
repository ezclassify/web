/**
 * The private-runtime test lane, and the gate that keeps it out of the public
 * lane.
 *
 * This repository is public and its supported story is the REST boundary: a
 * browser or a framework adapter talks to a licensed deployment through
 * `@ezclassify/rest-client`. The engine itself is proprietary. It is embedded
 * only in EzClassify's own applications and is never published as an importable
 * library, so no package here may declare it and a public clone cannot install
 * it.
 *
 * A large part of this repository's behavioral coverage nonetheless drives the
 * UI with a real in-process engine, because that is the cheapest way to get
 * true answers out of real scheme content. That coverage is worth keeping. It
 * just cannot be a public gate, because the public cannot run it.
 *
 * So there are two lanes:
 *
 * - The **public lane** is what a clean clone gets. It installs from a public
 *   registry, builds every publishable package, and runs every spec that needs
 *   nothing proprietary. This is the lane CI gates on, and it is honest because
 *   an outside contributor can reproduce it exactly.
 * - The **private lane** adds the engine, the example schemes, and the store
 *   conformance suite. It runs in a full workspace checkout where those are
 *   available, and it is the authoritative run before a release.
 *
 * Which lane you are in is detected, not configured: a spec that imports a
 * private package is excluded when that package cannot be resolved. Nothing
 * here needs a flag, and a lane cannot be entered by accident.
 *
 * See `DEVELOPMENT.md` for how to turn the private lane on.
 */
import {
    appendFileSync,
    existsSync,
    readdirSync,
    readFileSync,
    statSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import * as path from 'node:path';

const require = createRequire(import.meta.url);

/**
 * Packages that are not on any public registry and never will be.
 *
 * A spec that imports one of these belongs to the private lane. The list is the
 * gate's whole definition of "proprietary", so adding a private dependency
 * without adding it here is how the gate goes quiet.
 */
export const PRIVATE_PACKAGES = [
    '@ezclassify/engine',
    '@ezclassify/example-schemes',
    '@ezclassify/rest-api',
    '@ezclassify/testing-utils',
] as const;

/**
 * The store conformance suite's source entrypoint in the sibling runtime
 * checkout.
 *
 * `@ezclassify/testing-utils` carries the EzClassifyStore conformance suite,
 * the one source file every adapter spec runs so the vanilla, React, Vue, and
 * Angular stores are held to the same contract. It ships from the runtime
 * repository, and the specs import it from source through an alias so an edit
 * to the suite is visible here without a publish.
 */
export const SIBLING_TESTING_UTILS = path.resolve(
    import.meta.dirname,
    '../runtime/packages/testing-utils/src/index.ts',
);

/**
 * The engine's internal surface in the sibling runtime checkout.
 *
 * Testing-utils imports `@ezclassify/engine/internal`. That subpath is
 * deliberately not a published package export, so first-party consumers inline
 * it with a build-time alias to the engine source, the same thing the runtime
 * repository's own vite configs do. Resolving testing-utils from source here
 * means this repository needs that alias too, or the conformance specs fail to
 * load with "./internal is not exported from @ezclassify/engine".
 */
export const SIBLING_ENGINE_INTERNAL = path.resolve(
    import.meta.dirname,
    '../runtime/libs/engine/src/internal.ts',
);

/** Whether the sibling runtime checkout is present next to this repository. */
export const hasSiblingRuntime = existsSync(SIBLING_TESTING_UTILS);

/**
 * Whether a private package is installed and importable from here.
 *
 * Resolution rather than a manifest read, because the private lane is turned on
 * by installing the packages (see `DEVELOPMENT.md`), and an install is the only
 * thing that makes a spec able to load.
 *
 * @param name - Bare package specifier, one of `PRIVATE_PACKAGES`
 * @returns True when the package resolves from this repository
 */
function canResolve(name: string): boolean {
    // testing-utils resolves through a source alias to the sibling checkout,
    // not through node_modules, so it has its own answer.
    if (name === '@ezclassify/testing-utils') return hasSiblingRuntime;
    try {
        require.resolve(name);
        return true;
    } catch {
        // A package whose `exports` map has no entry the resolver will accept
        // from here still counts as installed: the engine's browser condition
        // is one such case. Fall back to the directory npm would have created.
        for (let dir = import.meta.dirname; ; dir = path.dirname(dir)) {
            if (
                existsSync(path.join(dir, 'node_modules', name, 'package.json'))
            )
                return true;
            if (dir === path.dirname(dir)) return false;
        }
    }
}

/**
 * Force the public lane even in a checkout that has the private packages.
 *
 * A maintainer's workspace is always the private lane, which makes it the one
 * place where a public-lane break cannot be noticed. Setting `EZ_PUBLIC_LANE=1`
 * reproduces what an outside contributor runs without uninstalling anything.
 */
const forcedPublicLane = process.env.EZ_PUBLIC_LANE === '1';

/** Which private packages this checkout can actually load. */
export const availablePrivatePackages = new Set(
    forcedPublicLane ? [] : PRIVATE_PACKAGES.filter(canResolve),
);

/** Whether every private package is available, meaning the full lane can run. */
export const hasPrivateRuntime =
    availablePrivatePackages.size === PRIVATE_PACKAGES.length;

/**
 * Aliases the private lane needs, or nothing when the sibling is absent.
 *
 * Spread into a vitest `resolve.alias` map.
 */
export const siblingRuntimeAliases: Record<string, string> = hasSiblingRuntime
    ? {
          '@ezclassify/testing-utils/context-token': path.join(
              path.dirname(SIBLING_TESTING_UTILS),
              'context-token.ts',
          ),
          '@ezclassify/testing-utils/licensed-runtime': path.join(
              path.dirname(SIBLING_TESTING_UTILS),
              'licensed-runtime.ts',
          ),
          '@ezclassify/testing-utils': SIBLING_TESTING_UTILS,
          '@ezclassify/engine/internal': SIBLING_ENGINE_INTERNAL,
      }
    : {};

const SPEC_SUFFIXES = ['.spec.ts', '.spec.tsx', '.test.ts', '.test.tsx'];
const SKIP_DIRS = new Set([
    'node_modules',
    'dist',
    '.angular',
    'test-results',
    'coverage',
    '.git',
]);

/**
 * Every spec file under a directory, as a repo-relative POSIX path.
 *
 * @param dir - Absolute directory to walk
 * @param found - Accumulator, for recursion
 * @returns Repo-relative paths of the spec files found
 */
function collectSpecs(dir: string, found: string[] = []): string[] {
    if (!existsSync(dir)) return found;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.name.startsWith('.') && entry.name !== '.') continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (SKIP_DIRS.has(entry.name)) continue;
            collectSpecs(full, found);
        } else if (SPEC_SUFFIXES.some((s) => entry.name.endsWith(s))) {
            found.push(
                path
                    .relative(import.meta.dirname, full)
                    .split(path.sep)
                    .join('/'),
            );
        }
    }
    return found;
}

/**
 * Module specifier forms, each anchored to the start of a line.
 *
 * Anchoring is what keeps the scan from reading its own test data. Several
 * specs here assert on the gate scripts by passing source text as string
 * literals, so a file can contain `"import { Context } from
 * '@ezclassify/engine';"` while importing nothing of the kind. Those literals
 * are always indented inside a call, never at statement position, so requiring
 * the keyword to open the line tells a real import from a quoted example.
 *
 * The cost is a dynamic `import()` written mid-line, which this will miss. That
 * fails loudly at collection rather than quietly passing, and every import in
 * this repository is prettier-formatted to statement position anyway.
 */
const SPECIFIER_PATTERNS = [
    /^\s*import\s+[^'"]*['"]([^'"]+)['"]/,
    /^\s*import\s*['"]([^'"]+)['"]/,
    /^\s*export\s+[^'"]*from\s*['"]([^'"]+)['"]/,
    /^\s*\}?\s*from\s*['"]([^'"]+)['"]/,
    /^\s*(?:await\s+)?import\s*\(\s*['"]([^'"]+)['"]/,
    /^\s*(?:const|let|var)?[^'"]*\brequire\s*\(\s*['"]([^'"]+)['"]/,
    /^\s*vi\.mock\s*\(\s*['"]([^'"]+)['"]/,
];

/** Every module specifier a source file imports, in source order. */
function specifiersOf(source: string): string[] {
    const found: string[] = [];
    for (const line of source.split('\n')) {
        for (const pattern of SPECIFIER_PATTERNS) {
            const match = pattern.exec(line);
            if (match) {
                found.push(match[1]);
                break;
            }
        }
    }
    return found;
}

const CANDIDATE_SUFFIXES = ['.ts', '.tsx', '.mts', '.js', '.mjs', '.jsx'];

/**
 * Resolve a relative specifier to a file on disk, or null when it is not one.
 *
 * TypeScript sources here import without an extension and sometimes name a
 * directory, so a specifier has to be tried against the usual candidates the
 * way a bundler would.
 *
 * @param fromFile - Absolute path of the importing file
 * @param specifier - The specifier as written
 * @returns Absolute path of the imported file, or null
 */
function resolveRelative(fromFile: string, specifier: string): string | null {
    if (!specifier.startsWith('.')) return null;
    const base = path.resolve(path.dirname(fromFile), specifier);
    const candidates = [
        base,
        ...CANDIDATE_SUFFIXES.map((s) => base + s),
        ...CANDIDATE_SUFFIXES.map((s) => path.join(base, `index${s}`)),
    ];
    for (const candidate of candidates) {
        if (existsSync(candidate) && statSync(candidate).isFile())
            return candidate;
    }
    return null;
}

/**
 * Spec files that reach a private package, directly or through a local import.
 *
 * Derived by reading the sources rather than kept as a hand-maintained list. A
 * list would go stale silently, and it did once already: the store conformance
 * suite stopped running in both configs after a repository rename while the
 * suites stayed green. A spec that starts using the engine joins the private
 * lane on its own, and one that stops using it rejoins the public lane on its
 * own.
 *
 * The walk follows relative imports because the private dependency is often one
 * hop away: a spec imports a fixture module, and the fixture is what loads the
 * engine and the example schemes. Stopping at the spec's own import list would
 * leave those specs in the public lane, where they fail collection.
 *
 * @param roots - Repo-relative directories to scan
 * @returns Repo-relative spec paths to exclude, sorted
 */
export function specsNeedingPrivateRuntime(roots: readonly string[]): string[] {
    const unavailable = new Set<string>(
        PRIVATE_PACKAGES.filter((name) => !availablePrivatePackages.has(name)),
    );
    if (unavailable.size === 0) return [];

    const verdicts = new Map<string, boolean>();
    const reachesPrivate = (file: string, seen: Set<string>): boolean => {
        const cached = verdicts.get(file);
        if (cached !== undefined) return cached;
        // A cycle cannot introduce a dependency the cycle does not already
        // have, so treat a revisit as "no" and let the other branches answer.
        if (seen.has(file)) return false;
        seen.add(file);
        let verdict = false;
        for (const specifier of specifiersOf(readFileSync(file, 'utf8'))) {
            const bare = specifier.startsWith('@')
                ? specifier.split('/').slice(0, 2).join('/')
                : specifier.split('/')[0];
            if (unavailable.has(bare)) {
                verdict = true;
                break;
            }
            const next = resolveRelative(file, specifier);
            if (next && reachesPrivate(next, seen)) {
                verdict = true;
                break;
            }
        }
        verdicts.set(file, verdict);
        return verdict;
    };

    const hits: string[] = [];
    for (const root of roots) {
        for (const spec of collectSpecs(
            path.resolve(import.meta.dirname, root),
        )) {
            const abs = path.resolve(import.meta.dirname, spec);
            if (reachesPrivate(abs, new Set())) hits.push(spec);
        }
    }
    return [...new Set(hits)].sort();
}

/** Heading for the CI job summary block, also the marker that dedupes it. */
const CI_SUMMARY_HEADING = '### Private-runtime specs skipped';

/**
 * Repeat the skip where a CI reader will actually meet it.
 *
 * The public lane is the honest gate, but a reviewer still has to be told what
 * it does not cover, because nobody opens the log of a job that passed. A
 * workflow annotation puts it on the run's front page and the job summary puts
 * it under the checks, so the absence is something a reviewer is told rather
 * than something they would have to know to look for.
 *
 * `npm test` runs vitest several times over these configs, so the summary block
 * is written once and the marker heading is what makes that check possible.
 *
 * @param excluded - Spec paths that will not run
 */
function announceSkipToCi(excluded: readonly string[]): void {
    if (!process.env.GITHUB_ACTIONS) return;
    // Workflow command: a single line, newlines escaped per GitHub's encoding.
    console.log(
        '::notice title=Private-runtime specs skipped::' +
            `${excluded.length} spec(s) did not run. They drive a real engine ` +
            'over proprietary example content, which a public checkout cannot ' +
            'install, so a regression they alone would catch will not fail ' +
            'this check.',
    );
    const summaryPath = process.env.GITHUB_STEP_SUMMARY;
    if (!summaryPath) return;
    try {
        const written = existsSync(summaryPath)
            ? readFileSync(summaryPath, 'utf8')
            : '';
        if (written.includes(CI_SUMMARY_HEADING)) return;
        appendFileSync(
            summaryPath,
            `${CI_SUMMARY_HEADING}\n\n` +
                'These specs import a package that is not on a public registry, ' +
                'so this run did not execute them. They run in the private lane ' +
                'described in `DEVELOPMENT.md`, which is the authoritative ' +
                'runtime integration run.\n\n' +
                excluded.map((spec) => `- \`${spec}\`\n`).join('') +
                '\n',
        );
    } catch {
        // The summary is a courtesy. A read-only or missing file is not a
        // reason to fail a test run, and the annotation above already landed.
    }
}

/**
 * Announce which lane this process is running, once per vitest process.
 *
 * A skipped suite is invisible in a passing run. Say so out loud instead, so a
 * missing package reads as a notice rather than as a quietly smaller test
 * count.
 *
 * @param excluded - Spec paths that will be excluded in this process
 */
export function describePrivateRuntime(excluded: readonly string[]): void {
    if (excluded.length === 0) return;
    const missing = PRIVATE_PACKAGES.filter(
        (name) => !availablePrivatePackages.has(name),
    );
    console.warn(
        `[vitest] Public lane: ${missing.join(', ')} not resolvable here.\n` +
            `[vitest] Skipping ${excluded.length} spec(s) that need them.\n` +
            '[vitest] See DEVELOPMENT.md to run the private lane.',
    );
    announceSkipToCi(excluded);
}
