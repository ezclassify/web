#!/usr/bin/env node
/**
 * Build @ezclassify/angular using ng-packagr (APF: FESM2022 + Ivy metadata) +
 * schematics (CommonJS).
 */
import * as fs from 'fs';
import { execSync, spawn } from 'child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { devDependencies } = JSON.parse(fs.readFileSync('package.json', 'utf8'));
for (const name of ['@angular/compiler-cli', 'ng-packagr', 'typescript']) {
    const installed = require(`${name}/package.json`).version;
    if (installed !== devDependencies[name]) {
        throw new Error(
            `Angular library requires ${name}@${devDependencies[name]}, found ${installed}. Run npm run deps:relock && npm ci from the repository root.`,
        );
    }
}

const { name: PKG_NAME } = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const isWatch = process.argv.includes('--watch');

const outPkgPath = 'dist/ngpkg/package.json';

// ng-packagr always emits a FESM source map and a trailing reference. This
// package intentionally excludes maps from its published allowlist, so remove
// the external reference as part of normal APF post-processing. Otherwise the
// tarball advertises a file it does not contain and every consumer bundler logs
// a failed source-map read.
const stripExcludedSourceMapReferences = () => {
    for (const file of fs.readdirSync('dist/ngpkg/fesm2022')) {
        if (!file.endsWith('.mjs')) continue;
        const filePath = `dist/ngpkg/fesm2022/${file}`;
        const source = fs.readFileSync(filePath, 'utf8');
        const stripped = source.replace(
            /\n?\/\/[#@]\s*sourceMappingURL=[^\r\n]+\s*$/,
            '\n',
        );
        if (stripped !== source) fs.writeFileSync(filePath, stripped);
    }
};

const stripDist = (p) =>
    typeof p === 'string' && p.startsWith('./dist/ngpkg/')
        ? './' + p.slice('./dist/ngpkg/'.length)
        : p;

// Patch the output package.json. The source package.json describes paths
// relative to the source root (`./dist/ngpkg/fesm2022/...`), so that
// workspace symlinks and host-side resolution land on the real on-disk
// artifacts. Inside the published tarball, the package root IS the
// `dist/ngpkg/` directory, so those same fields need the `dist/ngpkg/`
// prefix stripped. ng-packagr leaves `main`/`module`/`types`/`exports`
// untouched, so we rewrite them here.
const patchOutPkg = () => {
    stripExcludedSourceMapReferences();
    const outPkg = JSON.parse(fs.readFileSync(outPkgPath, 'utf8'));
    if (outPkg.main) outPkg.main = stripDist(outPkg.main);
    if (outPkg.module) outPkg.module = stripDist(outPkg.module);
    if (outPkg.typings) outPkg.types = stripDist(outPkg.typings);
    else if (outPkg.types) outPkg.types = stripDist(outPkg.types);
    if (outPkg.exports && typeof outPkg.exports === 'object') {
        for (const key of Object.keys(outPkg.exports)) {
            const entry = outPkg.exports[key];
            if (entry && typeof entry === 'object') {
                for (const cond of Object.keys(entry)) {
                    entry[cond] = stripDist(entry[cond]);
                }
            } else {
                outPkg.exports[key] = stripDist(entry);
            }
        }
    }
    outPkg.files = [
        'fesm2022/',
        outPkg.types,
        '!**/*.map',
        'NOTICE',
        'schematics/package.json',
        'schematics/collection.json',
        'schematics/ng-add/index.js',
        'schematics/ng-add/schema.json',
    ];
    outPkg.schematics = './schematics/collection.json';
    // The source package.json sets publishConfig.directory = "dist/ngpkg" so
    // that `npm publish` (run from the source root) targets the built output.
    // Inside the generated dist/ngpkg/package.json the package root already IS
    // that directory, so a retained `directory` would make `npm publish` re-nest
    // the output one level deeper and the published main/module/types paths would
    // resolve to nothing. Drop it here (and the whole publishConfig if empty).
    if (outPkg.publishConfig && typeof outPkg.publishConfig === 'object') {
        delete outPkg.publishConfig.directory;
        if (Object.keys(outPkg.publishConfig).length === 0)
            delete outPkg.publishConfig;
    }
    fs.writeFileSync(outPkgPath, JSON.stringify(outPkg, null, 2) + '\n');
};

if (isWatch) {
    // Watch mode: spawn ng-packagr --watch + tsc --watch (schematics) as
    // long-lived children. After each ng-packagr cycle completes, run the
    // same dist/ngpkg/package.json path patch as the one-shot build.
    console.log(
        '[angular] starting ng-packagr --watch + tsc --watch (schematics)...',
    );

    // Pipe ng-packagr stdout so we can detect the per-cycle completion signal
    // and relay output faithfully. tsc --watch goes straight to inherited stdio.
    const ngChild = spawn(
        'npx',
        [
            'ng-packagr',
            '-p',
            'ng-package.json',
            '-c',
            'tsconfig.lib.json',
            '--watch',
        ],
        {
            stdio: ['inherit', 'pipe', 'inherit'],
        },
    );

    let buf = '';
    ngChild.stdout.on('data', (chunk) => {
        process.stdout.write(chunk);
        buf += chunk.toString();
        // ng-packagr emits this string to stdout after every successful watch cycle
        // (watchTransformFactory in ng-packagr/src/lib/ng-package/package.transform.js)
        if (
            buf.includes('Compilation complete. Watching for file changes...')
        ) {
            buf = '';
            try {
                patchOutPkg();
                console.log('[angular] watch: patched dist/ngpkg/package.json');
            } catch (e) {
                console.error('[angular] watch: patch error:', e.message);
            }
        }
        // Guard against unbounded buffer growth if the signal never arrives
        if (buf.length > 8192) buf = buf.slice(-4096);
    });

    const tscChild = spawn(
        'npx',
        [
            'tsc',
            '-p',
            'tsconfig.schematics.json',
            '--watch',
            '--preserveWatchOutput',
        ],
        { stdio: 'inherit' },
    );

    const shutdown = (sig) => {
        ngChild.kill(sig);
        tscChild.kill(sig);
        process.exit(0);
    };
    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    // Keep alive forever.
    await new Promise(() => {});
}

// ng-packagr produces APF-compliant output with Ivy metadata in dist/ngpkg/
execSync('npx ng-packagr -p ng-package.json -c tsconfig.lib.json', {
    stdio: 'inherit',
});

// Compile schematics (CommonJS, for Angular CLI / ng add)
execSync('npx tsc -p tsconfig.schematics.json', { stdio: 'inherit' });

// Copy the third-party attribution notice into the published output. ng-packagr
// already carries LICENSE across from the package root; NOTICE is not in its
// asset set, so copy it explicitly and list it in the generated files array.
fs.copyFileSync('NOTICE', 'dist/ngpkg/NOTICE');

// Copy schematics into the ng-packagr output so they're included in the tarball
fs.cpSync('schematics', 'dist/ngpkg/schematics', { recursive: true });
// Remove TypeScript source from the published schematics directory, only compiled JS ships
fs.rmSync('dist/ngpkg/schematics/ng-add/index.ts', { force: true });

patchOutPkg();

console.log(`✓ Built ${PKG_NAME} -> dist/ngpkg/ + schematics/`);
