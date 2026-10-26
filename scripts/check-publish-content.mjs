#!/usr/bin/env node
// Publication-boundary gate that inspects package CONTENT, not package names.
//
// The name-based guards cannot see a bundler: a package can be cleared by name
// while its build inlines code that must not ship. This check packs each
// publishable workspace and reads what would actually leave the repo.
//
// Five assertions per package:
//
//   1. No packed file contains engine code. Detection is derived from the
//      engine's own export list when `@ezclassify/engine` resolves, narrowed
//      to identifiers that appear nowhere in
//      this repo's sources, so a match means inlined engine bytes rather than
//      one of our own call sites. A committed floor list keeps the check
//      meaningful when the engine is not checked out.
//   2. No packed JavaScript or declaration file imports a non-public
//      @ezclassify package. A published artifact that does is unresolvable for
//      every outside consumer, and the specifier itself advertises a package
//      that is never on the registry.
//   3. No dependency field in the packed manifest names a non-public
//      @ezclassify package, for the same two reasons.
//   4. Every @ezclassify package a packed file imports is declared in the
//      published manifest. Being public is not the same as being installed:
//      npm fetches what the manifest declares and nothing else, so an
//      undeclared specifier resolves for the consumer only by accident, out of
//      whatever a sibling dependency hoisted.
//   5. Every external source-map reference resolves to another packed file.
//      Excluding *.map while retaining sourceMappingURL comments creates noisy,
//      misleading consumer artifacts even when the runtime code still works.
//
// Pack reflects what is on disk. Run a full `npm run build` first so the check
// sees the browser bundle it exists to keep out of the tarball; packing a tree
// that was never built proves nothing.
//
// WHERE THIS ACTUALLY RUNS, and why it is not the publish hook. This repo's
// .npmrc sets `ignore-scripts=true` for supply-chain reasons, and npm honors
// that for the publishing package's OWN lifecycle too: `npm publish` and
// `npm pack` here run neither prepublishOnly nor prepack nor prepare. A gate
// wired only into prepublishOnly is inert in this checkout. So the enforcement
// points are, in order: the packages' narrowed `files` lists, which npm honors
// regardless of scripts; this check as an explicit step in ci.yml; and
// angular's `publish:lib`, which invokes it through `npm run` and therefore
// executes. The prepublishOnly hooks stay as defense in depth for an
// environment that does run them; they are not the control surface.
//
// Usage: node scripts/check-publish-content.mjs [<package-name>...] [--verbose]
//   With no package names, every non-private workspace is checked.

import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    declaredDependencies,
    missingSourceMaps,
    narrowEngineMarkers,
    parseExportedNames,
    scopedImports,
    undeclaredImports,
    RESOLVED_DEPENDENCY_FIELDS,
} from './check-publish-content-lib.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const verbose = args.includes('--verbose');
const requested = args.filter((a) => !a.startsWith('-'));

// @ezclassify packages produced outside this repo that ARE cleared for a public
// registry. `@ezclassify/types` is the hand-written wire contract from the
// contracts repo: Apache-2.0, published, and the declared runtime dependency of
// the public REST client, so a packed artifact naming it resolves fine for an
// outside consumer. Everything else under the scope is treated as non-public,
// starting with the engine, which ships under a restricted-use license and
// never appears on npmjs.org.
const PUBLIC_EXTERNAL = new Set(['@ezclassify/schemes', '@ezclassify/types']);

// Packages whose published artifact is a build output directory rather than the
// workspace itself. ng-packagr writes its own manifest into dist/ngpkg and
// `publish:lib` publishes that directory, so checking the workspace root would
// read a manifest and a file list that never reach the registry.
const PUBLISH_DIR_OVERRIDES = {
    '@ezclassify/angular': 'dist/ngpkg',
};

// Floor list of engine-only exported identifiers, used when @ezclassify/engine
// is not resolvable. Derived from the engine surface; kept short and specific
// so it cannot collide with ordinary UI vocabulary.
const ENGINE_MARKER_FLOOR = [
    'precompileScheme',
    'materialiseAccessRules',
    'verifyMappingHash',
    'isBlockedAddress',
    'parseSsrfPolicyOptionsFromEnv',
];

const DECLARATION_EXTENSIONS = ['.d.ts', '.d.mts', '.d.cts'];
const CODE_EXTENSIONS = new Set([
    '.js',
    '.mjs',
    '.cjs',
    '.ts',
    '.tsx',
    '.jsx',
    '.css',
]);
const SOURCE_SKIP_DIRS = new Set([
    '.git',
    'node_modules',
    'dist',
    'build',
    'coverage',
    '.cache',
]);

function readJson(filePath) {
    return JSON.parse(readFileSync(filePath, 'utf8'));
}

/** Non-private workspaces, i.e. everything this repo can publish. */
function listPublishable() {
    const patterns = readJson(path.join(REPO_ROOT, 'package.json')).workspaces;
    const found = [];
    for (const pattern of patterns ?? []) {
        const base = pattern.endsWith('/*') ? pattern.slice(0, -2) : null;
        const dirs = base
            ? readdirSync(path.join(REPO_ROOT, base), { withFileTypes: true })
                  .filter((e) => e.isDirectory())
                  .map((e) => path.join(base, e.name))
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

/**
 * Every @ezclassify name that may legitimately appear in a published artifact:
 * this repo's own publishable workspaces plus the cleared external packages.
 */
function publicPackageNames(packages) {
    const names = new Set(PUBLIC_EXTERNAL);
    for (const pkg of packages) names.add(pkg.manifest.name);
    return names;
}

/** Read the `X as PublicName` pairs from the engine's ESM export statement. */
function engineExportNames() {
    let entry;
    try {
        entry = fileURLToPath(import.meta.resolve('@ezclassify/engine'));
    } catch {
        return null;
    }
    if (!existsSync(entry)) return null;
    const names = parseExportedNames(readFileSync(entry, 'utf8'));
    return names.size > 0 ? names : null;
}

function walkFiles(dir, out = []) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) {
            if (!SOURCE_SKIP_DIRS.has(entry.name))
                walkFiles(path.join(dir, entry.name), out);
        } else if (CODE_EXTENSIONS.has(path.extname(entry.name))) {
            out.push(path.join(dir, entry.name));
        }
    }
    return out;
}

/** Concatenated source of every publishable workspace, for marker narrowing. */
function repoSourceCorpus(packages) {
    let corpus = '';
    for (const pkg of packages) {
        const src = path.join(pkg.dir, 'src');
        if (!existsSync(src)) continue;
        for (const file of walkFiles(src)) corpus += readFileSync(file, 'utf8');
    }
    return corpus;
}

/**
 * Engine identifiers distinctive enough to be evidence on their own: long
 * enough not to collide by accident, and absent from every source file we
 * author. An occurrence in a packed artifact is then inlined engine code rather
 * than one of our own call sites.
 */
function buildEngineMarkers(packages) {
    const exported = engineExportNames();
    if (!exported) {
        console.log(
            '[publish-content] @ezclassify/engine not resolvable; using the committed marker floor',
        );
        return ENGINE_MARKER_FLOOR;
    }
    const markers = narrowEngineMarkers({
        exportedNames: exported,
        sourceCorpus: repoSourceCorpus(packages),
        floor: ENGINE_MARKER_FLOOR,
    });
    console.log(
        `[publish-content] ${markers.length} engine marker(s) derived from the resolved engine surface`,
    );
    return markers;
}

/** File list `npm publish` would ship, as repo-relative paths. */
function packedFiles(pkgDir) {
    const result = spawnSync(
        'npm',
        ['pack', '--dry-run', '--json', '--ignore-scripts'],
        { cwd: pkgDir, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
    );
    if (result.status !== 0) {
        throw new Error(
            `npm pack failed in ${pkgDir}:\n${result.stderr || result.stdout}`,
        );
    }
    // npm can print warnings on stdout ahead of the JSON payload, and a warning
    // may itself contain a bracket. Try each bracket in turn rather than
    // assuming the first one opens the payload.
    const { stdout } = result;
    for (
        let at = stdout.indexOf('[');
        at !== -1;
        at = stdout.indexOf('[', at + 1)
    ) {
        let parsed;
        try {
            parsed = JSON.parse(stdout.slice(at));
        } catch {
            continue;
        }
        const files = parsed?.[0]?.files;
        if (Array.isArray(files)) return files.map((f) => f.path);
    }
    throw new Error(
        `could not read the pack file list for ${pkgDir}:\n${stdout}`,
    );
}

function isDeclaration(file) {
    return DECLARATION_EXTENSIONS.some((ext) => file.endsWith(ext));
}

function isScannable(file) {
    return isDeclaration(file) || CODE_EXTENSIONS.has(path.extname(file));
}

const packages = listPublishable();
const selected =
    requested.length > 0
        ? packages.filter((p) => requested.includes(p.manifest.name))
        : packages;

if (requested.length > 0 && selected.length !== requested.length) {
    const known = packages.map((p) => p.manifest.name).join(', ');
    console.error(
        `[publish-content] unknown package name(s). Publishable: ${known}`,
    );
    process.exit(2);
}

const publicNames = publicPackageNames(packages);
const engineMarkers = buildEngineMarkers(packages);
const violations = [];

console.log(
    `[publish-content] packing ${selected.length} publishable package(s)`,
);

for (const pkg of selected) {
    const { name } = pkg.manifest;

    // Read the manifest and the file list from whatever directory actually
    // gets published, which is not always the workspace root.
    const override = PUBLISH_DIR_OVERRIDES[name];
    const publishDir = override ? path.join(pkg.dir, override) : pkg.dir;
    if (!existsSync(path.join(publishDir, 'package.json'))) {
        violations.push(
            `${name}: published artifact directory ${override} is missing; build the package before checking it`,
        );
        continue;
    }
    const publishManifest = override
        ? readJson(path.join(publishDir, 'package.json'))
        : pkg.manifest;

    const declared = declaredDependencies(publishManifest);

    // 3. dependency metadata naming a non-public package
    for (const field of RESOLVED_DEPENDENCY_FIELDS) {
        for (const dep of Object.keys(publishManifest[field] ?? {})) {
            if (dep.startsWith('@ezclassify/') && !publicNames.has(dep)) {
                violations.push(
                    `${name}: ${field}.${dep} names a package that is not published to any public registry`,
                );
            }
        }
    }

    const packed = packedFiles(publishDir);
    const packedSet = new Set(packed);
    for (const rel of packed) {
        const abs = path.join(publishDir, rel);
        if (!existsSync(abs) || !statSync(abs).isFile()) continue;
        if (!isScannable(rel)) continue;
        const text = readFileSync(abs, 'utf8');

        for (const target of missingSourceMaps(text, rel, packedSet)) {
            violations.push(
                `${name}: ${rel} references missing packed source map ${target}`,
            );
        }

        // 1. engine code inlined into a packed artifact
        const hits = engineMarkers.filter((marker) => text.includes(marker));
        if (hits.length > 0) {
            violations.push(
                `${name}: ${rel} contains engine code (markers: ${hits.slice(0, 5).join(', ')}${hits.length > 5 ? `, +${hits.length - 5} more` : ''})`,
            );
        }

        // 2. specifiers pointing at a non-public package
        const nonPublic = scopedImports(text, '@ezclassify/').filter(
            (dep) => !publicNames.has(dep),
        );
        for (const dep of nonPublic) {
            violations.push(
                `${name}: ${rel} imports "${dep}", which resolves nowhere public`,
            );
        }

        // 4. specifiers the published manifest never asks npm to install
        const undeclared = undeclaredImports(text, {
            scope: '@ezclassify/',
            selfName: name,
            declared,
        }).filter((dep) => !nonPublic.includes(dep));
        for (const dep of undeclared) {
            violations.push(
                `${name}: ${rel} imports "${dep}", which the published manifest does not declare`,
            );
        }
        if (
            verbose &&
            hits.length === 0 &&
            nonPublic.length === 0 &&
            undeclared.length === 0
        ) {
            console.log(`  ok  ${name} ${rel}`);
        }
    }
}

if (violations.length > 0) {
    console.error(`[publish-content] ${violations.length} violation(s):`);
    for (const v of violations) console.error(`  ${v}`);
    process.exit(1);
}
console.log(
    '[publish-content] no engine code, non-public references, or dangling source maps in any packed artifact.',
);
