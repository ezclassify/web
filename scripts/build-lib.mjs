/**
 * Shared library-build driver for the publishable workspaces.
 *
 * The ui, ui-tools, react and vue packages share one pipeline: clean dist/lib,
 * esbuild ESM + CJS bundles, one-shot tsc declaration emit, top-level .d.ts
 * stub, dist package.json, and the watch-mode scaffold (kept esbuild contexts +
 * a long-lived `tsc --watch`). Only the esbuild config differs per package.
 * Each package keeps a thin `build-lib.mjs` that passes its config to
 * {@link buildLib}; everything mechanical lives here.
 *
 * Contract: {@link buildLib} runs with the package directory as the working
 * directory (how `npm run build` invokes the per-package scripts). Entry point,
 * tsconfig, package.json, and dist/lib all resolve against cwd.
 *
 * This module has no import-time side effects so the pure helpers are
 * unit-testable (see build-lib.spec.ts, same split as pack-consume-lib.mjs).
 */
import * as fs from 'fs';
import * as path from 'path';
import { execSync, spawn } from 'child_process';

/**
 * Resolve extensionless relative imports in TypeScript sources for esbuild
 * (`./foo` -> `./foo.ts` | `./foo.tsx` | `./foo/index.ts(x)`).
 */
export function tsResolvePlugin() {
    return {
        name: 'ts-resolve',
        setup(build) {
            build.onResolve({ filter: /^\./ }, (args) => {
                if (!path.extname(args.path)) {
                    const dir = path.dirname(args.importer);
                    for (const ext of [
                        '.ts',
                        '.tsx',
                        '/index.ts',
                        '/index.tsx',
                    ]) {
                        const candidate = path.join(dir, args.path + ext);
                        if (fs.existsSync(candidate))
                            return { path: candidate };
                    }
                }
                return undefined;
            });
        },
    };
}

/**
 * Load `import styles from './x.css?inline'` as a JS string export, the way
 * Vite's `?inline` works. Used by packages that inject component CSS at runtime
 * instead of shipping a stylesheet.
 */
export function cssInlinePlugin() {
    return {
        name: 'css-inline',
        setup(build) {
            build.onResolve({ filter: /\.css\?inline$/ }, (args) => {
                const abs = path.resolve(
                    path.dirname(args.importer),
                    args.path.replace('?inline', ''),
                );
                // Use a repo-relative identity so esbuild's module-path comments in the
                // emitted bundle never embed the maintainer's absolute home directory.
                const rel =
                    path.relative(process.cwd(), abs) || path.basename(abs);
                return {
                    path: rel,
                    namespace: 'css-inline',
                    pluginData: { abs },
                };
            });
            build.onLoad({ filter: /.*/, namespace: 'css-inline' }, (args) => ({
                contents: `export default ${JSON.stringify(fs.readFileSync(args.pluginData.abs, 'utf8'))};`,
                loader: 'js',
            }));
        },
    };
}

/** Load `*.module.css` files through esbuild's scoped `local-css` loader. */
export function cssModulePlugin() {
    return {
        name: 'css-module-loader',
        setup(build) {
            build.onLoad({ filter: /\.module\.css$/ }, async (args) => ({
                contents: await fs.promises.readFile(args.path, 'utf8'),
                loader: 'local-css',
            }));
        },
    };
}

/**
 * Find the first `index.d.ts` under `dir`, checking each directory's files
 * before descending depth-first through its subdirectories, capped at 8 levels.
 * Returns the absolute path or null.
 */
export function findIndexDts(dir, depth = 0) {
    if (depth > 8) return null;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.isFile() && entry.name === 'index.d.ts')
            return path.join(dir, entry.name);
    }
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) {
            const found = findIndexDts(path.join(dir, entry.name), depth + 1);
            if (found) return found;
        }
    }
    return null;
}

/**
 * Manifest written to dist/lib/package.json so the bundle directory is
 * consumable as the published package root. `extraExports` merges additional
 * subpath exports after the root entry (e.g. `'./styles': './index.css'`).
 */
export function distManifest({ name, version, extraExports }) {
    return {
        name,
        version,
        type: 'module',
        main: './index.cjs',
        module: './index.mjs',
        types: './index.d.ts',
        exports: {
            '.': {
                types: './index.d.ts',
                import: './index.mjs',
                require: './index.cjs',
            },
            ...(extraExports ?? {}),
        },
    };
}

/**
 * Ensure `outDir/index.d.ts` exists. When tsc emitted the declarations into a
 * source-mirroring subtree (rootDir quirks), write a top-level stub that
 * re-exports the real index. Throws when no index.d.ts was emitted at all.
 */
export function ensureTopLevelDtsStub(outDir) {
    const topStub = path.join(outDir, 'index.d.ts');
    if (fs.existsSync(topStub)) return;
    const anySrcIndex = findIndexDts(outDir);
    if (!anySrcIndex) throw new Error('No index.d.ts emitted');
    const rel = path
        .relative(outDir, anySrcIndex)
        .replace(/\\/g, '/')
        .replace(/\.d\.ts$/, '');
    fs.writeFileSync(topStub, `export * from './${rel}'\n`);
}

/**
 * Build the package in the current working directory as a Node-consumable
 * library: ESM + CJS bundles plus TypeScript declarations in dist/lib/. Passing
 * `--watch` on the command line keeps esbuild contexts and a declaration `tsc
 * --watch` alive until SIGINT/SIGTERM.
 *
 * `label` names the watch-mode log; `external` lists peer and external package
 * imports. `plugins` defaults to `[tsResolvePlugin()]`, and `target` to
 * `['es2020']`. `jsx` and `loader` are passed through to esbuild. `tsconfig`
 * selects the bundling/declaration project (default `tsconfig.lib.json`).
 * `extraExports` adds subpaths to the dist package manifest.
 *
 * @param {{
 *     label?: string;
 *     external?: string[];
 *     plugins?: import('esbuild').Plugin[];
 *     target?: string | string[];
 *     jsx?: import('esbuild').JSX;
 *     loader?: Record<string, import('esbuild').Loader>;
 *     tsconfig?: string;
 *     extraExports?: Record<string, unknown>;
 * }} [options]
 *   Package-specific build choices.
 */
export async function buildLib({
    label,
    external,
    plugins = [tsResolvePlugin()],
    target = ['es2020'],
    jsx,
    loader,
    tsconfig = 'tsconfig.lib.json',
    extraExports,
} = {}) {
    // Imported lazily so loading this module for its pure helpers (unit tests
    // run under jsdom) never evaluates esbuild, which requires a Node realm.
    const esbuild = await import('esbuild');
    const { name, version } = JSON.parse(
        fs.readFileSync('package.json', 'utf8'),
    );
    const outDir = path.resolve('dist/lib');
    const isWatch = process.argv.includes('--watch');

    // Skip the clean-and-recreate in watch mode: parallel watchers wiping each
    // other's dist/ creates a startup race where TS declaration emission can't
    // find sibling packages' .d.ts files. Watch mode writes incrementally over
    // existing files, so a clean is unnecessary; orphaned files from removed
    // src entries are an acceptable dev-mode tradeoff.
    if (!isWatch) {
        fs.rmSync(outDir, { recursive: true, force: true });
    }
    fs.mkdirSync(outDir, { recursive: true });

    const sharedOptions = {
        entryPoints: ['src/index.ts'],
        bundle: true,
        platform: 'neutral',
        target,
        ...(jsx ? { jsx } : {}),
        ...(loader ? { loader } : {}),
        external,
        tsconfig,
        plugins,
    };

    // Published packages deliberately omit source maps. Do not emit map
    // references whose targets the package `files` allowlist then excludes.
    const esmOpts = {
        ...sharedOptions,
        format: 'esm',
        outfile: path.join(outDir, 'index.mjs'),
        sourcemap: false,
    };
    const cjsOpts = {
        ...sharedOptions,
        format: 'cjs',
        outfile: path.join(outDir, 'index.cjs'),
        sourcemap: false,
    };

    let esmCtx = null;
    let cjsCtx = null;

    if (isWatch) {
        // Watch mode: keep esbuild contexts alive across rebuilds. Initial rebuild
        // is awaited so the post-build helpers (d.ts stub, package.json) write
        // against a populated dist/. tsc --watch is started at the bottom after
        // the one-shot helpers run.
        esmCtx = await esbuild.context(esmOpts);
        cjsCtx = await esbuild.context(cjsOpts);
        await esmCtx.rebuild();
        await cjsCtx.rebuild();
    } else {
        await esbuild.build(esmOpts);
        await esbuild.build(cjsOpts);
    }

    // One-shot tsc pass; in watch mode, the long-lived tsc --watch takes over below.
    execSync(
        `npx tsc -p ${tsconfig} --emitDeclarationOnly --declaration --declarationMap false --outDir dist/lib`,
        { stdio: 'inherit' },
    );

    ensureTopLevelDtsStub(outDir);

    fs.writeFileSync(
        path.join(outDir, 'package.json'),
        JSON.stringify(distManifest({ name, version, extraExports }), null, 2),
    );

    const esmStats = fs.statSync(path.join(outDir, 'index.mjs'));
    const cjsStats = fs.statSync(path.join(outDir, 'index.cjs'));
    console.log(
        `✓ Library: dist/lib/index.mjs (${(esmStats.size / 1024).toFixed(1)} KB)`,
    );
    console.log(
        `✓ Library: dist/lib/index.cjs (${(cjsStats.size / 1024).toFixed(1)} KB)`,
    );
    console.log(`✓ Types:   dist/lib/index.d.ts`);

    if (isWatch) {
        await esmCtx.watch();
        await cjsCtx.watch();
        // Long-lived tsc watcher for declarations.
        const tscChild = spawn(
            'npx',
            [
                'tsc',
                '-p',
                tsconfig,
                '--emitDeclarationOnly',
                '--declaration',
                '--declarationMap',
                'false',
                '--outDir',
                'dist/lib',
                '--watch',
                '--preserveWatchOutput',
            ],
            { stdio: 'inherit' },
        );
        const shutdown = (sig) => {
            tscChild.kill(sig);
            esmCtx.dispose();
            cjsCtx.dispose();
            process.exit(0);
        };
        process.on('SIGINT', () => shutdown('SIGINT'));
        process.on('SIGTERM', () => shutdown('SIGTERM'));
        console.log(`[${label}] watching for changes...`);
        // Keep alive forever (watchers handle the work).
        await new Promise(() => {});
    }
}
