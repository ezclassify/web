#!/usr/bin/env node
/**
 * Run every test project and report all of them.
 *
 * The suite is split into projects because they need different vitest
 * configurations and pools, not because one is a prerequisite of another. An
 * `&&` chain between them therefore reports a false picture: the first red
 * project stops the run, and every project after it is neither passed nor
 * failed, it is unknown.
 *
 * So every project runs, and the exit code is the union: zero when all of them
 * passed, one when any of them failed. Each project's own output streams
 * through unchanged, and a summary at the end names every project and its
 * result, so the failing ones can be found without scrolling.
 *
 * Usage: npm test [-- <extra vitest args>]
 *
 * Extra arguments are forwarded to every project, which is how `npm run
 * test:verbose` asks all of them for a verbose reporter.
 */

import { spawnSync } from 'node:child_process';

import { TEST_PROJECTS, summarize } from './run-test-projects-lib.mjs';

const forwarded = process.argv.slice(2);

/** Per-project outcome, in run order. */
const results = [];

for (const project of TEST_PROJECTS) {
    console.log(`\n=== ${project} ===`);
    const args = ['run', project];
    if (forwarded.length > 0) args.push('--', ...forwarded);
    const run = spawnSync('npm', args, { stdio: 'inherit' });
    // A process killed by a signal reports a null status. That is a failure,
    // and reading it as a zero exit code would pass the whole run on a crash.
    const code = run.status === null ? 1 : run.status;
    results.push({ project, code });
}

const { lines, failed } = summarize(results);
console.log('\n=== test projects ===');
for (const line of lines) console.log(line);

if (failed.length > 0) {
    console.error(
        `\n${failed.length} of ${results.length} test project(s) failed: ` +
            failed.join(', '),
    );
    process.exit(1);
}
console.log(`\nall ${results.length} test projects passed`);
