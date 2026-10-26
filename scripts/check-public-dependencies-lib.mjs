/**
 * Pure helpers for the public-dependency gate.
 *
 * Kept separate from the runner so the rules can be tested without a
 * filesystem, the same split the other gate scripts in this directory use.
 */

/**
 * `@ezclassify` packages an outside contributor can install.
 *
 * These ship from the public repositories: the wire contract and its
 * conformance material from `ezclassify/contracts`, and the REST client from
 * `ezclassify/client-js`. Everything else under the scope is proprietary,
 * starting with the engine, which is embedded only in EzClassify's own
 * applications and is never published as an importable library.
 *
 * The list is an allowlist rather than a denylist on purpose. A new private
 * package appearing in a manifest should fail this gate on the day it lands,
 * not on the day somebody remembers to add it to a list of things to refuse.
 */
export const PUBLIC_SCOPED_PACKAGES = new Set([
    '@ezclassify/rest-client',
    '@ezclassify/conformance',
    '@ezclassify/conformance-server',
    '@ezclassify/openapi',
    '@ezclassify/schemas',
    '@ezclassify/tsconfig',
    '@ezclassify/types',
]);

/** Manifest fields that put a package into somebody's install. */
export const DEPENDENCY_FIELDS = [
    'dependencies',
    'devDependencies',
    'peerDependencies',
    'optionalDependencies',
];

/**
 * Non-public `@ezclassify` dependencies a manifest declares.
 *
 * A package this repository itself owns is public by construction, so the
 * repository's own package names are passed in rather than hardcoded.
 *
 * @param manifest - Parsed package.json contents
 * @param ownPackages - Package names this repository publishes
 * @returns One entry per offending declaration, in `field:name` form
 */
export function privateDependenciesOf(manifest, ownPackages = new Set()) {
    const found = [];
    for (const field of DEPENDENCY_FIELDS) {
        for (const name of Object.keys(manifest?.[field] ?? {})) {
            if (!name.startsWith('@ezclassify/')) continue;
            if (PUBLIC_SCOPED_PACKAGES.has(name)) continue;
            if (ownPackages.has(name)) continue;
            found.push(`${field}:${name}`);
        }
    }
    return found;
}

/**
 * Expand npm workspace patterns to the directories they name.
 *
 * Only the trailing-star form npm actually supports is handled, because that is
 * the only form a manifest here may use.
 *
 * @param patterns - Raw `workspaces` entries
 * @param listDir - Reads the entry names of a directory
 * @returns Repo-relative workspace directories
 */
export function expandWorkspaces(patterns, listDir) {
    const dirs = [];
    for (const pattern of patterns ?? []) {
        if (!pattern.endsWith('/*')) {
            dirs.push(pattern);
            continue;
        }
        const parent = pattern.slice(0, -2);
        for (const name of listDir(parent)) dirs.push(`${parent}/${name}`);
    }
    return dirs;
}
