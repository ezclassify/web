import { afterEach, describe, expect, it } from 'vitest';
import {
    existsSync,
    mkdirSync,
    mkdtempSync,
    rmSync,
    symlinkSync,
    writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const temporary: string[] = [];
afterEach(() => {
    for (const directory of temporary.splice(0))
        rmSync(directory, { recursive: true, force: true });
});

function fixture() {
    const directory = mkdtempSync(join(tmpdir(), 'web-relock-'));
    temporary.push(directory);
    return directory;
}

function file(root: string, path: string, value = 'retained') {
    const target = join(root, path);
    mkdirSync(resolve(target, '..'), { recursive: true });
    writeFileSync(target, value);
    return target;
}

function clean(root: string) {
    return spawnSync(
        process.execPath,
        [resolve('scripts/relock.mjs'), '--clean', `--root=${root}`],
        { encoding: 'utf8' },
    );
}

describe('relock clean phase', () => {
    it('removes installed trees throughout the declared closure while retaining source and independent packages', () => {
        const root = fixture();
        file(
            root,
            'package.json',
            JSON.stringify({ workspaces: ['integrations/angular', 'libs/*'] }),
        );
        const retained = [
            'integrations/angular/package.json',
            'libs/ui/package.json',
            'libs/ui/src/index.ts',
            'private/tool/node_modules/keep',
            'private/tool/package.json',
        ];
        for (const path of retained)
            file(root, path, path.endsWith('package.json') ? '{}' : 'source');
        const removed = [
            'node_modules/cache',
            'integrations/angular/node_modules/ng-packagr/package.json',
            'libs/ui/node_modules/cache',
            'package-lock.json',
        ];
        for (const path of removed) file(root, path);
        expect(clean(root).status).toBe(0);
        for (const path of removed)
            expect(existsSync(join(root, path))).toBe(false);
        for (const path of retained)
            expect(existsSync(join(root, path))).toBe(true);
        expect(clean(root).status).toBe(0);
    });

    it('refuses an external workspace before deleting any installed state', () => {
        const root = fixture();
        const outside = fixture();
        file(
            root,
            'package.json',
            JSON.stringify({ workspaces: ['external'] }),
        );
        file(outside, 'package.json', '{}');
        const sentinel = file(outside, 'node_modules/keep');
        symlinkSync(outside, join(root, 'external'), 'dir');
        const installed = file(root, 'node_modules/keep');
        const result = clean(root);
        expect(result.status).not.toBe(0);
        expect(result.stderr).toContain('escapes repository');
        expect(existsSync(installed)).toBe(true);
        expect(existsSync(sentinel)).toBe(true);
    });

    it('unlinks an installed-tree symlink without touching its target', () => {
        const root = fixture();
        const outside = fixture();
        file(root, 'package.json', '{}');
        const sentinel = file(outside, 'keep');
        symlinkSync(outside, join(root, 'node_modules'), 'dir');
        expect(clean(root).status).toBe(0);
        expect(existsSync(join(root, 'node_modules'))).toBe(false);
        expect(existsSync(sentinel)).toBe(true);
    });
});
