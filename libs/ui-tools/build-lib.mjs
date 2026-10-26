#!/usr/bin/env node
/**
 * Build @ezclassify/ui-tools as a Node-consumable library (ESM + CJS + .d.ts).
 * Package-specific esbuild config only; the pipeline lives in
 * scripts/build-lib.mjs at the repo root.
 */
import { buildLib, tsResolvePlugin } from '../../scripts/build-lib.mjs';

await buildLib({
    label: 'ui-tools',
    target: ['es2022', 'node22'],
    external: [
        '@playwright/test',
        '@axe-core/playwright',
        '@ezclassify/testing-utils',
        'node:*',
        'fs',
        'path',
        'crypto',
    ],
    plugins: [tsResolvePlugin()],
});
