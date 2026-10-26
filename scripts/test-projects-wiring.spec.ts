// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { TEST_PROJECTS, summarize } from './run-test-projects-lib.mjs';

/**
 * `npm test` has to report every test project.
 *
 * The suite is split by vitest configuration, not by dependency: no project is
 * a prerequisite of another. Chaining them with `&&` means the first red one
 * ends the run and the rest are simply unknown. These tests pin the two facts
 * that prevent that: the aggregate scripts go through the runner rather than a
 * chain, and the runner's project list is the whole set of project scripts the
 * manifest declares.
 */
const ROOT = path.resolve(__dirname, '..');

const manifest = JSON.parse(
    readFileSync(path.join(ROOT, 'package.json'), 'utf8'),
) as { scripts: Record<string, string> };

/** Every `test:<project>` script, excluding the ones that are not projects. */
const NON_PROJECT_TEST_SCRIPTS = ['test:integration', 'test:verbose'];

describe('npm test reports every project', () => {
    it('drives the aggregate run through the runner, not a chain', () => {
        expect(manifest.scripts.test).toBe(
            'node scripts/run-test-projects.mjs',
        );
        expect(manifest.scripts.test).not.toContain('&&');
    });

    it('drives the verbose run through the runner too', () => {
        expect(manifest.scripts['test:verbose']).not.toContain('&&');
        expect(manifest.scripts['test:verbose']).toContain(
            'scripts/run-test-projects.mjs',
        );
    });

    it('names every declared project script', () => {
        const declared = Object.keys(manifest.scripts)
            .filter(
                (name) =>
                    name.startsWith('test:') &&
                    !NON_PROJECT_TEST_SCRIPTS.includes(name),
            )
            .sort();
        expect([...TEST_PROJECTS].sort()).toEqual(declared);
    });

    it('names only scripts the manifest actually declares', () => {
        for (const project of TEST_PROJECTS) {
            expect(manifest.scripts[project]).toBeTruthy();
        }
    });
});

describe('summarize', () => {
    it('reports a failing project after a passing one, not instead of it', () => {
        const { lines, failed } = summarize([
            { project: 'test:ui-core', code: 0 },
            { project: 'test:ui-components', code: 1 },
            { project: 'test:scripts', code: 0 },
        ]);
        expect(lines).toEqual([
            'pass  test:ui-core',
            'FAIL  test:ui-components',
            'pass  test:scripts',
        ]);
        expect(failed).toEqual(['test:ui-components']);
    });

    it('reports every failure, not only the first', () => {
        const { failed } = summarize([
            { project: 'test:ui-core', code: 1 },
            { project: 'test:ui-components', code: 1 },
        ]);
        expect(failed).toEqual(['test:ui-core', 'test:ui-components']);
    });

    it('is clean when every project passed', () => {
        const { failed } = summarize([{ project: 'test:scripts', code: 0 }]);
        expect(failed).toEqual([]);
    });
});
