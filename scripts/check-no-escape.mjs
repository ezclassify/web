#!/usr/bin/env node
// Static independence gate for publishable workspaces. Two assertions:
//
//   1. No dependency field in a publishable package.json uses a path-based
//      protocol (file:, link:, workspace:, portal:). Those resolve against
//      the local checkout and cannot ship; a published artifact carrying one
//      is broken for every consumer.
//   2. No source file in a publishable workspace has a relative import that
//      resolves above the REPO root. Cross-workspace relative imports inside
//      the repo are the repo's own business; only escapes into non-repo
//      territory are flagged (they only work in one specific checkout
//      layout).
//
// Usage: node scripts/check-no-escape.mjs [--verbose]

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const verbose = process.argv.includes('--verbose');

const DEP_FIELDS = [
    'dependencies',
    'devDependencies',
    'peerDependencies',
    'optionalDependencies',
];
const BANNED_PROTOCOL = /^(file|link|workspace|portal):/;
const SOURCE_EXTENSIONS = new Set([
    '.js',
    '.mjs',
    '.cjs',
    '.jsx',
    '.ts',
    '.mts',
    '.cts',
    '.tsx',
    '.vue',
    '.svelte',
]);
const SKIP_DIRS = new Set([
    '.git',
    'node_modules',
    'dist',
    'build',
    'coverage',
    'target',
    'vendor',
    '.cache',
]);

// Relative specifiers in import/export-from, require(), and dynamic import().
const IMPORT_PATTERNS = [
    /(?:\bimport|\bexport)\s*(?:[\w${},*\s]*?\bfrom\s*)?(['"])(\.\.?\/[^'"]*)\1/g,
    /\brequire\(\s*(['"])(\.\.?\/[^'"]*)\1\s*\)/g,
    /\bimport\(\s*(['"])(\.\.?\/[^'"]*)\1\s*\)/g,
];

function readJson(filePath) {
    return JSON.parse(readFileSync(filePath, 'utf8'));
}

function listPublishable() {
    const rootManifest = readJson(path.join(REPO_ROOT, 'package.json'));
    const patterns = rootManifest.workspaces;
    if (!patterns) return [{ dir: REPO_ROOT, manifest: rootManifest }];
    const found = [];
    for (const pattern of patterns) {
        const dirs = pattern.endsWith('/*')
            ? readdirSync(path.join(REPO_ROOT, pattern.slice(0, -2)), {
                  withFileTypes: true,
              })
                  .filter((e) => e.isDirectory())
                  .map((e) => path.join(pattern.slice(0, -2), e.name))
            : [pattern];
        for (const dir of dirs) {
            const manifestPath = path.join(REPO_ROOT, dir, 'package.json');
            if (!existsSync(manifestPath)) continue;
            const manifest = readJson(manifestPath);
            if (manifest.private === true) continue;
            found.push({ dir: path.join(REPO_ROOT, dir), manifest });
        }
    }
    return found;
}

const violations = [];

function walkSources(dir, out = []) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) {
            if (!SKIP_DIRS.has(entry.name)) {
                walkSources(path.join(dir, entry.name), out);
            }
        } else if (SOURCE_EXTENSIONS.has(path.extname(entry.name))) {
            out.push(path.join(dir, entry.name));
        }
    }
    return out;
}

function escapesRepo(fromDir, specifier) {
    // Strip any query/hash a specifier may carry before resolving.
    const clean = specifier.split(/[?#]/)[0];
    const resolved = path.resolve(fromDir, clean);
    return resolved !== REPO_ROOT && !resolved.startsWith(REPO_ROOT + path.sep);
}

const packages = listPublishable();
console.log(
    `[no-escape] checking ${packages.length} publishable package(s) under ${path.basename(REPO_ROOT)}`,
);

for (const pkg of packages) {
    const { name } = pkg.manifest;

    // 1. dependency protocols
    for (const field of DEP_FIELDS) {
        for (const [dep, spec] of Object.entries(pkg.manifest[field] ?? {})) {
            if (BANNED_PROTOCOL.test(spec)) {
                violations.push(
                    `${name} ${field}.${dep} uses a path-based protocol: "${spec}"`,
                );
            }
        }
    }

    // 2. relative imports resolving above the repo root
    for (const file of walkSources(pkg.dir)) {
        const text = readFileSync(file, 'utf8');
        const fromDir = path.dirname(file);
        for (const pattern of IMPORT_PATTERNS) {
            pattern.lastIndex = 0;
            for (const match of text.matchAll(pattern)) {
                const specifier = match[2];
                if (escapesRepo(fromDir, specifier)) {
                    const line = text.slice(0, match.index).split('\n').length;
                    violations.push(
                        `${path.relative(REPO_ROOT, file)}:${line} imports "${specifier}", which resolves outside the repo`,
                    );
                } else if (verbose) {
                    console.log(
                        `  ok  ${path.relative(REPO_ROOT, file)} -> ${specifier}`,
                    );
                }
            }
        }
    }
}

if (violations.length > 0) {
    console.error(`[no-escape] ${violations.length} violation(s):`);
    for (const v of violations) console.error(`  ${v}`);
    process.exit(1);
}
console.log('[no-escape] no path-protocol deps, no imports escape the repo.');
