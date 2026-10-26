#!/usr/bin/env node
/**
 * Turn on the private test lane in a maintainer's checkout.
 *
 * This repository is public and installs only from a public registry. The
 * engine is proprietary and is embedded solely in EzClassify's own
 * applications, so no manifest here may declare it and a clean clone cannot
 * install it. A large part of this repository's behavioral coverage still
 * drives the UI with a real engine over real scheme content, which is the
 * cheapest way to get true answers, so that coverage runs in a second lane
 * instead of being deleted or faked.
 *
 * This script is how a maintainer enters that lane. It installs the private
 * packages without writing them into any manifest or the lockfile, so the
 * committed tree keeps saying what an outside contributor can actually
 * reproduce. `vitest.private-runtime.ts` detects the result and stops excluding
 * the specs that need it.
 *
 * The install pulls from whatever registry the running environment already
 * configures for the `@ezclassify` scope. Nothing here names a registry, and
 * nothing here is required to build, test, lint, or publish this repository.
 *
 * Usage: npm run lane:private npm run lane:private -- --check (report the lane,
 * install nothing)
 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');

/**
 * Packages the private lane needs from a registry.
 *
 * `@ezclassify/testing-utils` is deliberately absent: it resolves from the
 * sibling `../runtime` checkout through a source alias, because its specs
 * import an engine subpath that is not a published export.
 */
const PRIVATE_PACKAGES = [
    '@ezclassify/engine',
    '@ezclassify/example-schemes',
    '@ezclassify/rest-api',
];

/** The sibling checkout that carries the store conformance suite. */
const SIBLING_RUNTIME = path.resolve(REPO_ROOT, '../runtime');

/**
 * Whether a package directory exists under the repository's node_modules.
 *
 * A directory check rather than a resolve: the engine's export map has no entry
 * the default resolver will accept from here, so resolution says "missing" for
 * a package that is plainly installed.
 *
 * @param {string} name - Bare package specifier
 * @returns {boolean} True when npm has placed the package
 */
function isInstalled(name) {
    return existsSync(
        path.join(REPO_ROOT, 'node_modules', name, 'package.json'),
    );
}

/** Print what the current checkout can and cannot run. */
function report() {
    for (const name of PRIVATE_PACKAGES) {
        console.log(`  ${isInstalled(name) ? 'present' : 'MISSING'}  ${name}`);
    }
    console.log(
        `  ${existsSync(SIBLING_RUNTIME) ? 'present' : 'MISSING'}  ../runtime (store conformance suite)`,
    );
}

if (process.argv.includes('--check')) {
    console.log('[private-lane] current checkout:');
    report();
    process.exit(0);
}

console.log(`[private-lane] installing ${PRIVATE_PACKAGES.join(', ')}`);
// --no-save writes neither the manifests nor the lockfile, so the committed
// tree still says only what an outside contributor can install. The lockfile
// is still read: without it npm resolves every third-party range afresh, past
// the dependency quarantine, and the installed tree stops matching the one the
// public lane was checked against.
const result = spawnSync(
    'npm',
    ['install', '--no-save', '--ignore-scripts', ...PRIVATE_PACKAGES],
    { cwd: REPO_ROOT, stdio: 'inherit' },
);

if (result.status !== 0) {
    console.error(
        '\n[private-lane] install failed. These packages are not on a public\n' +
            '[private-lane] registry; you need an environment configured for the\n' +
            '[private-lane] @ezclassify scope. The public lane needs none of this.',
    );
    process.exit(result.status ?? 1);
}

console.log('\n[private-lane] lane state:');
report();
if (!existsSync(SIBLING_RUNTIME)) {
    console.log(
        '\n[private-lane] The store conformance specs still will not run.\n' +
            '[private-lane] Clone the runtime repository next to this one.',
    );
}
