#!/usr/bin/env node
/**
 * Build @ezclassify/react as a library (ESM + CJS + .d.ts). Package-specific
 * esbuild config only; the pipeline lives in scripts/build-lib.mjs at the repo
 * root.
 */
import { buildLib } from '../../scripts/build-lib.mjs';

await buildLib({
    label: 'react',
    jsx: 'automatic',
    loader: { '.ts': 'ts', '.tsx': 'tsx' },
    external: ['react', 'react-dom', 'react/jsx-runtime', '@ezclassify/ui'],
});
