#!/usr/bin/env node
/**
 * Gate: nothing in the public install closure may declare a private package.
 *
 * The clean-clone promise this repository makes is that an outside contributor
 * clones it, installs from a public registry, and gets a green build and test
 * run. One private dependency anywhere in the workspace breaks that promise for
 * everybody, and it breaks it at install time, before any other gate here gets
 * a chance to run. So this check reads the committed manifests directly and
 * needs neither a network nor a node_modules tree.
 *
 * It deliberately checks the manifests rather than the lockfile. A lockfile is
 * derived; the manifest is the statement of intent, and the intent is what a
 * reviewer has to be able to see.
 *
 * Scope is the root manifest plus every workspace the root declares. Anything
 * outside that list is not in a clean clone's install, which is the whole point
 * of it being outside the list.
 *
 * Usage: npm run check:public-dependencies [-- --verbose]
 */

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    expandWorkspaces,
    privateDependenciesOf,
} from './check-public-dependencies-lib.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const verbose = process.argv.includes('--verbose');

/**
 * Read and parse a manifest.
 *
 * @param {string} dir - Repo-relative directory holding the package.json
 * @returns {object | null} Parsed manifest, or null when there is none
 */
function readManifest(dir) {
    const file = path.join(REPO_ROOT, dir, 'package.json');
    if (!existsSync(file)) return null;
    return JSON.parse(readFileSync(file, 'utf8'));
}

const root = readManifest('.');
const workspaceDirs = expandWorkspaces(root.workspaces, (parent) =>
    readdirSync(path.join(REPO_ROOT, parent), { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => e.name),
);

const manifests = [['.', root]];
for (const dir of workspaceDirs) {
    const manifest = readManifest(dir);
    if (manifest) manifests.push([dir, manifest]);
}

const ownPackages = new Set(
    manifests.map(([, manifest]) => manifest.name).filter(Boolean),
);

const violations = [];
for (const [dir, manifest] of manifests) {
    for (const declaration of privateDependenciesOf(manifest, ownPackages)) {
        violations.push(`${dir}/package.json declares ${declaration}`);
    }
}

console.log(
    `[public-dependencies] checked ${manifests.length} manifest(s) in the public install closure`,
);
if (verbose) {
    for (const [dir] of manifests) console.log(`  ${dir}/package.json`);
}

if (violations.length > 0) {
    console.error(`[public-dependencies] ${violations.length} violation(s):`);
    for (const violation of violations) console.error(`  ${violation}`);
    console.error(
        '\nThese packages are not on a public registry, so a clean clone cannot\n' +
            'install this workspace. If the dependency is test-only, move the specs\n' +
            'that need it into the private lane (see DEVELOPMENT.md) rather than\n' +
            'declaring it here.',
    );
    process.exit(1);
}

console.log('[public-dependencies] clean');
