#!/usr/bin/env node
/**
 * Build @ezclassify/ui as a Node-consumable library (ESM + CJS + .d.ts).
 * Separate from build-browser.mjs, which produces the browser IIFE bundle.
 * Package-specific esbuild config only; the pipeline lives in
 * scripts/build-lib.mjs at the repo root.
 */
import {
    buildLib,
    cssInlinePlugin,
    tsResolvePlugin,
} from '../../scripts/build-lib.mjs';

await buildLib({
    label: 'ui',
    target: ['es2022', 'node22'],
    // Preserve the one public runtime dependency as an import. Do not widen
    // this to the whole @ezclassify scope: listing the private engine would
    // quietly permit an import that must never reach the public package.
    external: ['@ezclassify/types', 'fs', 'path', 'crypto', 'node:*'],
    plugins: [cssInlinePlugin(), tsResolvePlugin()],
});
