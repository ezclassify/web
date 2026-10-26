#!/usr/bin/env node
/**
 * Build @ezclassify/vue as a library (ESM + CJS + .d.ts). Package-specific
 * esbuild config only; the pipeline lives in scripts/build-lib.mjs at the repo
 * root.
 */
import { buildLib } from '../../scripts/build-lib.mjs';

await buildLib({
    label: 'vue',
    external: ['vue', '@ezclassify/ui'],
});
