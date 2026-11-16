import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(import.meta.dirname, '..');
const packageRoot = path.join(repoRoot, 'libs', 'ui-tools');

describe('ui-tools build wiring', () => {
    it('keeps ui-tools aligned with the supported Node runtime and TypeScript 6', () => {
        const manifest = JSON.parse(
            readFileSync(path.join(packageRoot, 'package.json'), 'utf8'),
        ) as { engines?: { node?: string } };
        const tsconfig = JSON.parse(
            readFileSync(path.join(packageRoot, 'tsconfig.lib.json'), 'utf8'),
        ) as { compilerOptions?: { rootDir?: string } };
        const build = readFileSync(
            path.join(packageRoot, 'build-lib.mjs'),
            'utf8',
        );

        expect(manifest.engines?.node).toBe('>=22.0.0');
        expect(tsconfig.compilerOptions?.rootDir).toBe('./src');
        expect(build).toContain("target: ['es2022', 'node22']");
        expect(build).not.toMatch(/node20|es2020/);
    });
});
