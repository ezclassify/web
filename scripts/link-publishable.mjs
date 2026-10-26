#!/usr/bin/env node
/**
 * Register this repository's publishable packages as global npm links.
 *
 * Build (when a build script is present) and `npm link` each publishable
 * package, so a colocated checkout that consumes one of them can pick up local
 * changes with `npm link @ezclassify/ui` instead of waiting for a registry
 * publish. Nothing here reaches outside this repository: the packages this repo
 * consumes are installed from the registry like any other integrator's, and a
 * repository that owns packages of its own registers them itself.
 *
 * Never exits non-zero. It is a convenience, not a gate, and a failed link must
 * not fail an install.
 *
 * Flags: --verbose for per-package output; the default is a one-line summary.
 * Set EZ_LINK_BUILD=0 to register the packages without building them first.
 */

import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const verbose = process.argv.includes('--verbose');

const PUBLISHABLES = [
    { name: '@ezclassify/ui', dir: 'libs/ui' },
    { name: '@ezclassify/ui-tools', dir: 'libs/ui-tools' },
    { name: '@ezclassify/react', dir: 'integrations/react' },
    { name: '@ezclassify/vue', dir: 'integrations/vue' },
    { name: '@ezclassify/angular', dir: 'integrations/angular' },
];

const pubResults = [];

for (const pkg of PUBLISHABLES) {
    const pkgDir = path.join(REPO_ROOT, pkg.dir);
    const pkgJsonPath = path.join(pkgDir, 'package.json');

    if (!existsSync(pkgJsonPath)) {
        pubResults.push({
            name: pkg.name,
            status: 'skipped',
            detail: 'directory not found',
        });
        continue;
    }

    try {
        const manifest = JSON.parse(readFileSync(pkgJsonPath, 'utf-8'));

        if (manifest.scripts?.build && process.env.EZ_LINK_BUILD !== '0') {
            if (verbose) console.log(`[link] building ${pkg.name}...`);
            execSync('npm run build', {
                cwd: pkgDir,
                stdio: verbose ? 'inherit' : 'pipe',
            });
        }

        if (verbose) console.log(`[link] registering ${pkg.name} globally...`);
        execSync('npm link', {
            cwd: pkgDir,
            stdio: verbose ? 'inherit' : 'pipe',
        });

        pubResults.push({ name: pkg.name, status: 'linked', detail: pkgDir });
    } catch (err) {
        const msg = err.stderr?.toString().trim() || err.message;
        pubResults.push({ name: pkg.name, status: 'failed', detail: msg });
    }
}

// ─── Summary ────────────────────────────────────────────────────────────────

function summarize(label, results) {
    const linked = results.filter((r) => r.status === 'linked').length;
    const skipped = results.filter((r) => r.status === 'skipped').length;
    const failed = results.filter((r) => r.status === 'failed').length;
    console.log(
        `[link] ${label}: ${linked} linked, ${skipped} skipped, ${failed} failed`,
    );
    if (verbose || failed > 0) {
        for (const r of results) {
            const flag = r.status === 'failed' ? ' ⚠' : '';
            console.log(`  ${r.status.padEnd(8)}  ${r.name}${flag}`);
            if (r.status === 'failed') console.log(`           ${r.detail}`);
        }
    }
}

summarize('publishable packages', pubResults);

// Never exit non-zero. See the header: a failed link must not fail an install.
