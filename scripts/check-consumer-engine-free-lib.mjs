/**
 * Pure helpers for the consumer-example engine-freedom gate. Split from
 * check-consumer-engine-free.mjs so the rules are unit-testable without walking
 * a tree, the same split as check-publish-content-lib.mjs. This module has no
 * import-time side effects.
 */

import { scopedImports } from './check-publish-content-lib.mjs';

/** The package whose absence these examples exist to demonstrate. */
export const ENGINE_PACKAGE = '@ezclassify/engine';

/**
 * Dependency fields that would put the engine in a consumer's install.
 *
 * `devDependencies` counts. An example that pulls the engine in "only for
 * types" still tells a reader the engine is part of consuming a REST
 * deployment, which is the exact claim these fixtures exist to refute.
 */
const DEPENDENCY_FIELDS = [
    'dependencies',
    'devDependencies',
    'peerDependencies',
    'optionalDependencies',
];

/**
 * Everything about one example tree that contradicts "this application does not
 * use the engine".
 *
 * Two assertions here, and a third that only the installed tree can answer (see
 * {@link auditInstallClosure}):
 *
 * 1. No dependency field names the engine.
 * 2. No file names it either: not the sources, and not the build output, which is
 *    what a browser actually downloads. Every specifier form counts, subpaths
 *    included.
 *
 * @param {object} input Everything the audit reads.
 * @param {string} input.name Example name, used in the messages.
 * @param {Record<string, unknown>} input.manifest The example's package.json.
 * @param {{ path: string; text: string }[]} input.files Files to scan, with
 *   repo-relative paths.
 * @returns {string[]} One message per violation; empty when the tree is clean.
 */
export function auditEngineFreedom({ name, manifest, files }) {
    const violations = [];

    for (const field of DEPENDENCY_FIELDS) {
        const declared = manifest[field];
        if (!declared || typeof declared !== 'object') continue;
        for (const dependency of Object.keys(declared)) {
            if (dependency === ENGINE_PACKAGE) {
                violations.push(
                    `${name}: ${field}.${dependency} puts the engine in an application's install`,
                );
            }
        }
    }

    for (const file of files) {
        if (scopedImports(file.text, '@ezclassify/').includes(ENGINE_PACKAGE)) {
            violations.push(`${name}: ${file.path} imports ${ENGINE_PACKAGE}`);
        }
    }

    return violations;
}

/**
 * Whether the build half of {@link auditEngineFreedom} had anything to read.
 *
 * The file scan takes whatever it is handed, so an example whose build output
 * is absent scans its sources, finds nothing wrong and reports success on half
 * the question. Build output is gitignored, which makes absence the state of
 * every fresh checkout. Asserting it separately is what keeps a silent
 * shortfall from reading as a pass.
 *
 * @param {string} name Example name, used in the message.
 * @param {string} output Where the build was expected to land, for the message.
 * @param {unknown[]} builtFiles Files found under that path.
 * @returns {string[]} One message when the build produced nothing scannable;
 *   empty otherwise.
 */
export function auditBuildOutput(name, output, builtFiles) {
    if (builtFiles.length > 0) return [];
    return [
        `${name}: nothing to scan under ${output} after building, so the half of this check that reads what a browser downloads did not run`,
    ];
}

/**
 * Dependency fields that put a package into an installer's tree.
 *
 * `optionalDependencies` is here because npm installs them by default, so an
 * optional edge to the engine still lands in a consumer's node_modules. The
 * only thing optionality changes is what an ABSENT package means: see
 * {@link installClosure}.
 *
 * `devDependencies` is deliberately absent: they are what a package needs to
 * BUILD ITSELF, never what an installer of it receives, and following them here
 * would measure this monorepo's development tree rather than a consumer's
 * install.
 */
const CLOSURE_FIELDS = [
    'dependencies',
    'peerDependencies',
    'optionalDependencies',
];

/**
 * Whether an installer is allowed to end up without this dependency.
 *
 * An optional dependency, or a peer the dependent marks optional, may be
 * missing from a healthy tree. Every other edge must resolve.
 *
 * @param {Record<string, unknown>} manifest Manifest declaring the edge.
 * @param {string} field Dependency field the edge came from.
 * @param {string} dependency Package the edge points at.
 * @returns {boolean} True when absence is legitimate.
 */
function isOptionalEdge(manifest, field, dependency) {
    if (field === 'optionalDependencies') return true;
    if (field !== 'peerDependencies') return false;
    const meta = /** @type {Record<string, { optional?: boolean }>} */ (
        manifest['peerDependenciesMeta'] ?? {}
    );
    return meta[dependency]?.optional === true;
}

/**
 * The packages an outside consumer of this example would actually install.
 *
 * Transitive over `CLOSURE_FIELDS`. A package whose manifest cannot be read
 * stops the walk there, and a walk that stopped early proves nothing about what
 * is below it, so those packages are reported rather than skipped. Without
 * that, an un-installed tree truncates the closure and the gate passes on
 * having looked at almost nothing. Absence is only reported for edges that a
 * healthy install must resolve; an optional dependency or an optional peer may
 * legitimately be missing.
 *
 * @param {string} root Package to start from.
 * @param {(name: string) => Record<string, unknown> | null} readManifest
 *   Resolve a package name to its manifest, or null when it is not installed.
 * @returns {{
 *     reached: Map<string, string[]>;
 *     unresolved: { name: string; trail: string[] }[];
 * }}
 *   Every reachable package mapped to the dependency path that reached it, plus
 *   the required packages the walk could not read.
 */
export function installClosure(root, readManifest) {
    /** @type {Map<string, string[]>} */
    const reached = new Map();
    /** Names reached by at least one edge a healthy install must resolve. */
    const required = new Set([root]);
    /** @type {Map<string, string[]>} */
    const missing = new Map();
    /** @type {{ name: string; trail: string[] }[]} */
    const queue = [{ name: root, trail: [root] }];
    while (queue.length > 0) {
        const current = /** @type {{ name: string; trail: string[] }} */ (
            queue.shift()
        );
        const manifest = readManifest(current.name);
        if (!manifest) {
            missing.set(current.name, current.trail);
            continue;
        }
        for (const field of CLOSURE_FIELDS) {
            const declared = manifest[field];
            if (!declared || typeof declared !== 'object') continue;
            for (const dependency of Object.keys(declared)) {
                if (!isOptionalEdge(manifest, field, dependency)) {
                    // Recorded for every edge, not only the first one that
                    // reaches the package: an optional edge seen first must not
                    // excuse a required edge seen later.
                    required.add(dependency);
                }
                if (reached.has(dependency)) continue;
                const trail = [...current.trail, dependency];
                reached.set(dependency, trail);
                queue.push({ name: dependency, trail });
            }
        }
    }
    const unresolved = [...missing]
        .filter(([name]) => required.has(name))
        .map(([name, trail]) => ({ name, trail }));
    return { reached, unresolved };
}

/**
 * Whether the engine is in what a consumer of this example would install.
 *
 * This is the assertion that settles the question, and the reason no
 * identifier-matching pass follows the two above. A bundler can only inline
 * what it can resolve, so an engine outside the install closure cannot be in
 * the bundle: a proof rather than the sampling a marker scan does. Marker
 * matching is also actively wrong here: `@ezclassify/rest-client` implements
 * the same adapter contract as the engine and carries names spelled the same
 * (`EzClassifyError`, `buildSchemeView`), so scanning an application bundle for
 * engine identifiers flags the client every time.
 *
 * A truncated closure is reported as a violation of its own. The walk proves
 * absence by exhaustion, so a package it could not read is not a small gap in
 * the answer, it is the answer being unavailable.
 *
 * @param {string} name Example name, used in the message.
 * @param {{
 *     reached: Map<string, string[]>;
 *     unresolved: { name: string; trail: string[] }[];
 * }} closure
 *   Result of {@link installClosure}.
 * @returns {string[]} One message per violation; empty when the closure is
 *   complete and carries no engine.
 */
export function auditInstallClosure(name, closure) {
    const violations = closure.unresolved.map(
        ({ name: missing, trail }) =>
            `${name}: ${missing} is in what a consumer would install but is not installed (${trail.join(' -> ')}), so the closure stops there and proves nothing below it. Install the tree, then run this gate again`,
    );
    const trail = closure.reached.get(ENGINE_PACKAGE);
    if (trail) {
        violations.push(
            `${name}: ${ENGINE_PACKAGE} is in what a consumer would install, so a bundler can reach it (${trail.join(' -> ')})`,
        );
    }
    return violations;
}
