/**
 * The test-project list and the summary the runner prints.
 *
 * Kept apart from `run-test-projects.mjs` for the reason every `-lib.mjs` here
 * is: the runner spawns processes the moment it is imported, so a test that
 * wants to read the project list would start a full test run by importing it.
 */

/**
 * The npm scripts the runner drives, in the order they are reported.
 *
 * `scripts/test-projects-wiring.spec.ts` pins this list against the manifest,
 * so a new `test:` project script is either named here or the wiring test says
 * it is missing.
 */
export const TEST_PROJECTS = [
    'test:ui-core',
    'test:ui-components',
    'test:frameworks',
    'test:angular',
    'test:scripts',
];

/**
 * Format the end-of-run summary.
 *
 * @param {{ project: string; code: number }[]} results - One entry per project,
 *   in run order.
 * @returns {{ lines: string[]; failed: string[] }} The summary lines to print
 *   and the failing projects.
 */
export function summarize(results) {
    const lines = results.map(
        ({ project, code }) => `${code === 0 ? 'pass' : 'FAIL'}  ${project}`,
    );
    const failed = results.filter((r) => r.code !== 0).map((r) => r.project);
    return { lines, failed };
}
