#!/usr/bin/env node
/**
 * Typecheck a workspace's test sources.
 *
 * Package declaration builds exclude specs, harnesses, mocks and suites, so
 * this checks them on their own, against the workspace's `tsconfig.spec.json`,
 * including the adapter-parity suite shared by the framework integrations.
 * Every spec runs on public inputs (the demo runtime's recordings, see
 * `test-support/demo-runtime.ts`), so every spec is checked.
 *
 * Usage:
 *
 *     node scripts/typecheck-specs.mjs <workspace-dir>
 */

import { spawnSync } from 'node:child_process';
import path from 'node:path';

const REPO_ROOT = path.resolve(import.meta.dirname, '..');

const workspace = process.argv[2];
if (!workspace || process.argv.length > 3) {
    console.error('usage: node scripts/typecheck-specs.mjs <workspace-dir>');
    process.exit(2);
}

const workspaceDir = path.resolve(REPO_ROOT, workspace);
console.log(`typecheck ${path.relative(REPO_ROOT, workspaceDir)}: specs`);
const result = spawnSync('npx', ['tsc', '-p', 'tsconfig.spec.json'], {
    cwd: workspaceDir,
    stdio: 'inherit',
});
process.exit(result.status ?? 1);
