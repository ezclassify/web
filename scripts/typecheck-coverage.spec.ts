import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(import.meta.dirname, '..');

/** Workspace directories named by the root manifest. */
function workspaces(): string[] {
    const manifest = JSON.parse(
        readFileSync(path.join(repoRoot, 'package.json'), 'utf8'),
    ) as { workspaces: string[] };
    return manifest.workspaces;
}

/** Whether a directory holds any spec or test source of its own. */
function hasSpecSources(dir: string): boolean {
    const stack = [dir];
    while (stack.length) {
        const current = stack.pop() as string;
        for (const entry of readdirSync(current, { withFileTypes: true })) {
            if (entry.name.startsWith('.')) continue;
            if (entry.isDirectory()) {
                if (['node_modules', 'dist', 'coverage'].includes(entry.name))
                    continue;
                stack.push(path.join(current, entry.name));
            } else if (/\.(spec|test)\.tsx?$/.test(entry.name)) {
                return true;
            }
        }
    }
    return false;
}

describe('typecheck coverage', () => {
    it('every workspace with test sources runs a typecheck', () => {
        const missing: string[] = [];
        for (const workspace of workspaces()) {
            const dir = path.join(repoRoot, workspace);
            if (!existsSync(dir) || !hasSpecSources(dir)) continue;
            const manifest = JSON.parse(
                readFileSync(path.join(dir, 'package.json'), 'utf8'),
            ) as { scripts?: Record<string, string> };
            if (!manifest.scripts?.typecheck) missing.push(workspace);
        }
        // `npm run typecheck` is `--if-present`, so a workspace without the
        // script is skipped silently rather than reported. This is what makes
        // that silence loud.
        expect(missing).toEqual([]);
    });

    it('the lane-aware typecheck keeps its generated config out of git', () => {
        const gitignore = readFileSync(
            path.join(repoRoot, '.gitignore'),
            'utf8',
        );
        const script = readFileSync(
            path.join(repoRoot, 'scripts', 'typecheck-specs.mjs'),
            'utf8',
        );
        const generated = 'tsconfig.spec.lane.json';
        expect(script).toContain(generated);
        expect(gitignore).toContain(generated);
    });
});
