#!/usr/bin/env node
/**
 * Build @ezclassify/ui as a standalone browser IIFE bundle exposing
 * window.EzClassifyUI. Outputs to dist/browser/ezclassify-ui.iife.js
 * (unminified) and dist/browser/ezclassify-ui.iife.min.js (minified).
 *
 * The bundle holds the UI and `@ezclassify/types` only; a page supplies its own
 * engine adapter. It serves local demo and evaluation pages and is not
 * published: `files` lists dist/lib only and `prepublishOnly` runs build:lib.
 * scripts/check-publish-content.mjs fails the publish if any of it lands in a
 * tarball.
 */
import * as esbuild from 'esbuild';
import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(__dirname, 'dist/browser');

fs.mkdirSync(outDir, { recursive: true });

const cssInlinePlugin = {
    name: 'css-inline',
    setup(build) {
        build.onResolve({ filter: /\.css\?inline$/ }, (args) => {
            const abs = path.resolve(
                path.dirname(args.importer),
                args.path.replace('?inline', ''),
            );
            // Use a repo-relative identity so esbuild's module-path comments in the
            // emitted bundle never embed the maintainer's absolute home directory.
            const rel = path.relative(process.cwd(), abs) || path.basename(abs);
            return { path: rel, namespace: 'css-inline', pluginData: { abs } };
        });
        build.onLoad({ filter: /.*/, namespace: 'css-inline' }, (args) => ({
            contents: `export default ${JSON.stringify(fs.readFileSync(args.pluginData.abs, 'utf8'))};`,
            loader: 'js',
        }));
    },
};

const tsResolvePlugin = {
    name: 'ts-resolve',
    setup(build) {
        build.onResolve({ filter: /^\./ }, (args) => {
            if (!path.extname(args.path)) {
                const dir = path.dirname(args.importer);
                for (const ext of [
                    '.ts',
                    '.tsx',
                    '/index.ts',
                    '.js',
                    '/index.js',
                ]) {
                    const candidate = path.join(dir, args.path + ext);
                    if (fs.existsSync(candidate)) return { path: candidate };
                }
            }
            return undefined;
        });
    },
};

const sharedOptions = {
    entryPoints: [path.join(__dirname, 'src/index.ts')],
    bundle: true,
    platform: 'browser',
    target: ['es2020'],
    absWorkingDir: __dirname,
    tsconfig: path.join(__dirname, 'tsconfig.lib.json'),
    plugins: [cssInlinePlugin, tsResolvePlugin],
};

await esbuild.build({
    ...sharedOptions,
    format: 'iife',
    globalName: 'EzClassifyUI',
    outfile: path.join(outDir, 'ezclassify-ui.iife.js'),
    minify: false,
});

await esbuild.build({
    ...sharedOptions,
    format: 'iife',
    globalName: 'EzClassifyUI',
    outfile: path.join(outDir, 'ezclassify-ui.iife.min.js'),
    minify: true,
});

for (const name of ['ezclassify-ui.iife.js', 'ezclassify-ui.iife.min.js']) {
    const filePath = path.join(outDir, name);
    const raw = fs.readFileSync(filePath);
    const gz = zlib.gzipSync(raw);
    console.log(
        `  ${name}: ${(raw.length / 1024).toFixed(1)} KB raw, ${(gz.length / 1024).toFixed(1)} KB gz`,
    );
}
