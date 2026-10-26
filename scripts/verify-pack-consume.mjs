#!/usr/bin/env node
// Pack every publishable workspace and consume the tarballs from a scratch
// project outside the repo. It catches exports-map paths that point at files
// missing from the tarball, `files` entries that never ship, and sibling
// @ezclassify/* deps that only resolve through workspace symlinks.
//
// What it does:
//   1. Discovers publishable workspaces (package.json without `private: true`).
//   2. `npm pack`s each into a temp dir outside the repo.
//   3. Installs ALL tarballs jointly into a fresh scratch project, so sibling
//      @ezclassify/* dependencies resolve from the local tarballs. A lockfile
//      audit then proves no repo-local package was fetched from a registry.
//   4. require()s and import()s every declared entry point (exports map,
//      including subpaths; falls back to `main`), checks data/file exports
//      exist, and checks every declared bin file ships.
//
// Build the workspaces first (`npm run build`); packing does not build.
//
// Usage: node scripts/verify-pack-consume.mjs [--keep] [--verbose]
//   --keep     leave the scratch dir behind for inspection (path is printed)
//   --verbose  print every individual check

import { spawnSync } from 'node:child_process';
import {
    existsSync,
    mkdirSync,
    mkdtempSync,
    readdirSync,
    readFileSync,
    realpathSync,
    rmSync,
    writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    collectExternalScopedPeers,
    consumerEnv,
    verifyAngularConsumers,
    verifyReactVueConsumers,
} from './pack-consume-lib.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const keep = process.argv.includes('--keep');
const verbose = process.argv.includes('--verbose');

function readJson(filePath) {
    return JSON.parse(readFileSync(filePath, 'utf8'));
}

function listPublishable() {
    const rootManifest = readJson(path.join(REPO_ROOT, 'package.json'));
    const patterns = rootManifest.workspaces;
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
            const sourceDirectory = path.join(REPO_ROOT, dir);
            const publishedDirectory = manifest.publishConfig?.directory;
            const directory = publishedDirectory
                ? path.resolve(sourceDirectory, publishedDirectory)
                : sourceDirectory;
            if (
                directory !== sourceDirectory &&
                !directory.startsWith(sourceDirectory + path.sep)
            ) {
                throw new Error(
                    `${manifest.name}: publication directory escapes its workspace`,
                );
            }
            found.push({
                dir: directory,
                manifest: publishedDirectory
                    ? readJson(path.join(directory, 'package.json'))
                    : manifest,
            });
        }
    }
    return found;
}

function run(cmd, args, opts = {}) {
    const res = spawnSync(cmd, args, { encoding: 'utf8', ...opts });
    if (res.error) {
        // Surface spawn failures (missing file, no shebang, ...) as a failed
        // check rather than crashing the whole verification.
        return { status: -1, stdout: '', stderr: String(res.error) };
    }
    return res;
}

const failures = [];
let checks = 0;

function check(label, ok, detail) {
    checks++;
    if (ok) {
        if (verbose) console.log(`  ok  ${label}`);
    } else {
        failures.push({ label, detail });
        console.error(`FAIL  ${label}`);
        if (detail) console.error(indent(detail));
    }
}

function indent(text) {
    return String(text)
        .trim()
        .split('\n')
        .map((l) => `      ${l}`)
        .join('\n');
}

// --- 1. discover -----------------------------------------------------------

const packages = listPublishable();
if (packages.length === 0) {
    console.error('No publishable workspaces found; nothing to verify.');
    process.exit(1);
}
const localNames = new Set(packages.map((p) => p.manifest.name));
console.log(
    `[pack-consume] ${packages.length} publishable package(s): ${[...localNames].join(', ')}`,
);

// --- 2. pack ---------------------------------------------------------------

const scratch = mkdtempSync(path.join(os.tmpdir(), 'pack-consume-'));
const tarballDir = path.join(scratch, 'tarballs');
const consumeDir = path.join(scratch, 'consume');
mkdirSync(tarballDir);
mkdirSync(consumeDir);

function packTarball(dir, name) {
    const res = run(
        'npm',
        [
            'pack',
            '--json',
            '--ignore-scripts',
            '--pack-destination',
            tarballDir,
        ],
        { cwd: dir },
    );
    let filename = null;
    if (res.status === 0) {
        try {
            filename = JSON.parse(res.stdout)[0]?.filename ?? null;
        } catch {
            filename = null;
        }
    }
    // npm's --json filename can differ from the on-disk name for scoped
    // packages across npm versions; resolve against the directory listing.
    const onDisk =
        filename && existsSync(path.join(tarballDir, filename))
            ? filename
            : readdirSync(tarballDir).find((f) =>
                  f.startsWith(`${name.replace('@', '').replace('/', '-')}-`),
              );
    return { res, onDisk };
}

const tarballs = [];
const tarballByName = {};
for (const pkg of packages) {
    const { res, onDisk } = packTarball(pkg.dir, pkg.manifest.name);
    check(
        `npm pack ${pkg.manifest.name}`,
        res.status === 0 && Boolean(onDisk),
        res.status === 0 ? 'tarball not found after pack' : res.stderr,
    );
    if (res.status === 0 && onDisk) {
        tarballs.push(path.join(tarballDir, onDisk));
        tarballByName[pkg.manifest.name] = path.join(tarballDir, onDisk);
    }
}
if (failures.length > 0) finish();

// --- 2b. pack out-of-repo @ezclassify peers -----------------------------------
// The publishable workspaces declare cross-repo peers (and what they pull in)
// that a real consumer installs from the registry. Pack the repo's installed
// copies from node_modules instead so the joint install resolves every
// @ezclassify range locally, on any machine, registry or not.
//
const externalPeers = collectExternalScopedPeers({
    packages,
    localNames,
    scope: '@ezclassify/',
    extraSeeds: ['@ezclassify/rest-client', '@ezclassify/conformance-server'],
    getManifest: (name) => {
        const manifestPath = path.join(externalPeerDir(name), 'package.json');
        return existsSync(manifestPath) ? readJson(manifestPath) : null;
    },
});
check(
    'out-of-repo @ezclassify peers are installed in the repo',
    externalPeers.missing.length === 0,
    `missing from node_modules: ${externalPeers.missing.join(', ')}, run npm install first`,
);
for (const name of externalPeers.found) {
    const { res, onDisk } = packTarball(externalPeerDir(name), name);
    check(
        `npm pack peer ${name} (from node_modules)`,
        res.status === 0 && Boolean(onDisk),
        res.status === 0 ? 'tarball not found after pack' : res.stderr,
    );
    if (res.status === 0 && onDisk) {
        tarballs.push(path.join(tarballDir, onDisk));
        tarballByName[name] = path.join(tarballDir, onDisk);
    }
}
if (failures.length > 0) finish();

function externalPeerDir(name) {
    const installed = path.join(REPO_ROOT, 'node_modules', name);
    const linkedSource = path.join(installed, 'src');
    if (existsSync(linkedSource)) {
        return path.dirname(realpathSync(linkedSource));
    }
    return realpathSync(installed);
}

// --- 3. joint install ------------------------------------------------------

writeFileSync(
    path.join(consumeDir, 'package.json'),
    JSON.stringify({ name: 'pack-consume-smoke', private: true }, null, 2),
);
// One joint install: npm resolves the inter-tarball @ezclassify/* dependency
// ranges against the tarball versions already in the tree instead of a
// registry. --ignore-scripts matches the repo's install hardening posture;
// nothing published here relies on lifecycle scripts to be consumable.
// consumerEnv strips the npm_config_* vars `npm run` exports from this repo's
// .npmrc, a real consumer doesn't inherit our install policy, and
// legacy-peer-deps in particular would skip the peer auto-install (react,
// vue, ...) the entry-point smoke depends on.
const install = run(
    'npm',
    [
        'install',
        '--ignore-scripts',
        '--no-audit',
        '--no-fund',
        `--before=${new Date(Date.now() - 7 * 864e5).toISOString()}`,
        ...tarballs,
    ],
    { cwd: consumeDir, env: consumerEnv(process.env) },
);
check(
    `npm install of ${tarballs.length} tarball(s) into scratch project`,
    install.status === 0,
    install.stderr,
);
if (failures.length > 0) finish();

// Lockfile audit: every repo-local package, and every packed out-of-repo
// @ezclassify peer, must have come from its tarball, never a registry (a
// registry hit means the tarball dep graph is broken and the check silently
// stopped testing this PR's code).
const tarballNames = new Set([...localNames, ...externalPeers.found]);
const lock = readJson(path.join(consumeDir, 'package-lock.json'));
for (const [loc, entry] of Object.entries(lock.packages ?? {})) {
    const name = loc.split('node_modules/').pop();
    if (!tarballNames.has(name)) continue;
    check(
        `${name} resolved from local tarball (not a registry)`,
        !/^https?:\/\//.test(entry.resolved ?? ''),
        `resolved: ${entry.resolved}`,
    );
}

// --- 4. entry-point smoke ---------------------------------------------------

function conditionTarget(target, condition) {
    if (typeof target === 'string') return target;
    if (Array.isArray(target)) {
        for (const t of target) {
            const hit = conditionTarget(t, condition);
            if (hit) return hit;
        }
        return null;
    }
    if (target && typeof target === 'object') {
        for (const [key, value] of Object.entries(target)) {
            if (key === condition || key === 'default')
                return conditionTarget(value, condition);
        }
    }
    return null;
}

function hasCondition(target, condition) {
    if (Array.isArray(target))
        return target.some((t) => hasCondition(t, condition));
    if (target && typeof target === 'object')
        return Object.keys(target).some(
            (key) =>
                key === condition ||
                (key !== 'types' && hasCondition(target[key], condition)),
        );
    return false;
}

function missingOptionalPeer(manifest, stderr) {
    const meta = manifest.peerDependenciesMeta ?? {};
    const optional = Object.keys(meta).filter((k) => meta[k]?.optional);
    if (optional.length === 0) return null;
    const m = /Cannot find (?:package|module) '([^']+)'/.exec(stderr ?? '');
    if (!m) return null;
    return optional.find((p) => m[1] === p || m[1].startsWith(`${p}/`)) ?? null;
}

function nodeImport(spec) {
    return run(
        process.execPath,
        ['--input-type=module', '-e', `await import(${JSON.stringify(spec)})`],
        { cwd: consumeDir },
    );
}

function nodeRequire(spec) {
    return run(process.execPath, ['-e', `require(${JSON.stringify(spec)})`], {
        cwd: consumeDir,
    });
}

function walkFiles(dir, out = [], base = dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walkFiles(full, out, base);
        else out.push(path.relative(base, full));
    }
    return out;
}

for (const pkg of packages) {
    const { name } = pkg.manifest;
    const installedDir = path.join(consumeDir, 'node_modules', name);
    check(`${name} installed`, existsSync(installedDir));
    if (!existsSync(installedDir)) continue;

    const manifest = pkg.manifest;
    const pkgType = manifest.type === 'module' ? 'module' : 'commonjs';
    // Angular libraries ship partially compiled (ng-packagr) output that
    // only loads through the Angular linker in a consumer build, so their
    // JS entries are verified to ship rather than executed in bare Node.
    const needsAngularLinker = Boolean(
        manifest.peerDependencies?.['@angular/core'],
    );
    const bins =
        typeof manifest.bin === 'string'
            ? { [name.split('/').pop()]: manifest.bin }
            : (manifest.bin ?? {});
    const binTargets = new Set(
        Object.values(bins).map((b) => path.normalize(b)),
    );

    // Literal `files` entries must have shipped (a typo there is silent).
    for (const entry of manifest.files ?? []) {
        if (/[*!]/.test(entry)) continue;
        check(
            `${name} ships files entry "${entry}"`,
            existsSync(path.join(installedDir, entry)),
        );
    }

    // Collect entry points: exports map if present, else main.
    const entries = [];
    if (manifest.exports !== undefined) {
        const map =
            typeof manifest.exports === 'string' ||
            !Object.keys(manifest.exports).some((k) => k.startsWith('.'))
                ? { '.': manifest.exports }
                : manifest.exports;
        for (const [subpath, target] of Object.entries(map))
            entries.push({ subpath, target });
    } else if (manifest.main) {
        entries.push({ subpath: '.', target: manifest.main });
    }

    for (const { subpath, target } of entries) {
        const spec = subpath === '.' ? name : `${name}/${subpath.slice(2)}`;

        if (subpath.includes('*')) {
            // Expand the wildcard against the shipped files and verify each
            // mapped target actually exists in the tarball.
            const targetStr = conditionTarget(target, 'import') ?? '';
            const [prefix, suffix] = targetStr.split('*');
            const baseDir = path.join(installedDir, prefix);
            if (!existsSync(baseDir)) {
                check(
                    `${name} exports "${subpath}" base dir ships`,
                    false,
                    `${prefix} missing from tarball`,
                );
                continue;
            }
            const matches = walkFiles(baseDir).filter((f) =>
                suffix ? f.endsWith(suffix) : true,
            );
            check(
                `${name} exports "${subpath}" matches shipped files`,
                matches.length > 0,
                `no files under ${prefix}`,
            );
            continue;
        }

        const importTarget = conditionTarget(target, 'import');
        const requireTarget = conditionTarget(target, 'require');
        const isJs = (p) => p && /\.(mjs|cjs|js)$/.test(p);
        const isJson = (p) => p && p.endsWith('.json');

        if (isJs(importTarget)) {
            if (needsAngularLinker) {
                check(
                    `${spec} linker-consumed entry ships (${importTarget})`,
                    existsSync(path.join(installedDir, importTarget)),
                );
            } else if (binTargets.has(path.normalize(importTarget))) {
                if (verbose)
                    console.log(
                        `  --  ${spec} import skipped (entry is the bin; exercised by bin run)`,
                    );
            } else {
                const res = nodeImport(spec);
                // Opt-in subpaths may require their declared optional peers
                // at load time; the root entry must always import cleanly.
                const peer =
                    res.status !== 0 && subpath !== '.'
                        ? missingOptionalPeer(manifest, res.stderr)
                        : null;
                if (peer) {
                    if (verbose)
                        console.log(
                            `  --  ${spec} needs optional peer ${peer}; skipped`,
                        );
                } else {
                    check(`import "${spec}"`, res.status === 0, res.stderr);
                }
            }
        } else if (importTarget && !isJson(importTarget)) {
            // Data export (yaml, css, ...): the file must ship.
            check(
                `${spec} data export ships (${importTarget})`,
                existsSync(path.join(installedDir, importTarget)),
            );
        }

        const explicitRequire = hasCondition(target, 'require');
        const requireable =
            isJson(requireTarget) ||
            (isJs(requireTarget) &&
                (explicitRequire ||
                    requireTarget.endsWith('.cjs') ||
                    (requireTarget.endsWith('.js') && pkgType === 'commonjs')));
        if (requireable && !binTargets.has(path.normalize(requireTarget))) {
            const res = nodeRequire(spec);
            const peer =
                res.status !== 0 && subpath !== '.'
                    ? missingOptionalPeer(manifest, res.stderr)
                    : null;
            if (peer) {
                if (verbose)
                    console.log(
                        `  --  ${spec} needs optional peer ${peer}; skipped`,
                    );
            } else {
                check(`require "${spec}"`, res.status === 0, res.stderr);
            }
        }
    }

    // Every declared bin must ship the file it links to.
    for (const [binName, binTarget] of Object.entries(bins)) {
        check(
            `${name} bin "${binName}" file ships`,
            existsSync(path.join(installedDir, binTarget)),
        );
    }
}

verifyAngularConsumers({
    repository: REPO_ROOT,
    scratch,
    tarballs: tarballByName,
    run,
    check,
});
verifyReactVueConsumers({
    repository: REPO_ROOT,
    scratch,
    tarballs: tarballByName,
    run,
    check,
});
finish();

function finish() {
    if (keep) console.log(`[pack-consume] scratch kept at ${scratch}`);
    else rmSync(scratch, { recursive: true, force: true });

    if (failures.length > 0) {
        console.error(
            `\n[pack-consume] ${failures.length} of ${checks} checks failed.`,
        );
        process.exit(1);
    }
    console.log(
        `[pack-consume] all ${checks} checks passed for ${packages.length} package(s).`,
    );
    process.exit(0);
}
