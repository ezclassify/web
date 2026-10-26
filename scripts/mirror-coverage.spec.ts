// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import * as path from 'node:path';

/**
 * Every package this repository owns has to be reachable by the sibling repos
 * that consume it.
 *
 * First-party CI resolves development builds through the development mirror. A
 * package missing from the mirror workflow cannot be installed by those
 * consumers, no matter how correct its own manifest is.
 *
 * A package being outside the public workspace closure does not excuse it. That
 * decision governs what a clean clone installs, not what a first-party consumer
 * can get. So the scan is the directory tree rather than the workspaces list,
 * and a new package under libs/ or integrations/ fails here until somebody
 * decides, in the workflow, where it publishes.
 */
const ROOT = path.resolve(__dirname, '..');
const WORKFLOW = path.join(ROOT, '.github/workflows/publish-mirror.yml');

/** Package directories this repository owns, as repo-relative paths. */
function ownedPackageDirectories(): string[] {
    const found: string[] = [];
    for (const parent of ['libs', 'integrations']) {
        for (const entry of readdirSync(path.join(ROOT, parent), {
            withFileTypes: true,
        })) {
            if (!entry.isDirectory()) continue;
            const dir = `${parent}/${entry.name}`;
            if (!existsSync(path.join(ROOT, dir, 'package.json'))) continue;
            found.push(dir);
        }
    }
    return found.sort();
}

describe('development mirror coverage', () => {
    const workflow = readFileSync(WORKFLOW, 'utf8');
    const directories = ownedPackageDirectories();

    it('finds the packages to check', () => {
        // A scan that silently found nothing would pass every case below.
        expect(directories.length).toBeGreaterThanOrEqual(5);
        expect(directories).toContain('libs/ui-tools');
    });

    it.each(ownedPackageDirectories())(
        '%s is named in the mirror workflow',
        (dir) => {
            const name = JSON.parse(
                readFileSync(path.join(ROOT, dir, 'package.json'), 'utf8'),
            ).name;
            expect(
                workflow.includes(name) || workflow.includes(dir),
                `${dir} (${name}) is not published by the mirror workflow, so a sibling repo that declares it cannot install it`,
            ).toBe(true);
        },
    );
});
