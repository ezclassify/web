// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
    mkdtempSync,
    mkdirSync,
    readFileSync,
    rmSync,
    writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';

// @ts-expect-error plain .mjs module without type declarations
import {
    distManifest,
    ensureTopLevelDtsStub,
    findIndexDts,
} from './build-lib.mjs';

describe('findIndexDts', () => {
    let dir: string;

    beforeEach(() => {
        dir = mkdtempSync(path.join(tmpdir(), 'build-lib-'));
    });

    afterEach(() => {
        rmSync(dir, { recursive: true, force: true });
    });

    it('finds a nested index.d.ts emitted under a source-mirroring subtree', () => {
        mkdirSync(path.join(dir, 'ui', 'src'), { recursive: true });
        writeFileSync(path.join(dir, 'ui', 'src', 'index.d.ts'), 'export {}\n');
        expect(findIndexDts(dir)).toBe(
            path.join(dir, 'ui', 'src', 'index.d.ts'),
        );
    });

    it('prefers a file in the directory itself over one in a subdirectory', () => {
        mkdirSync(path.join(dir, 'deep'));
        writeFileSync(path.join(dir, 'deep', 'index.d.ts'), 'export {}\n');
        writeFileSync(path.join(dir, 'index.d.ts'), 'export {}\n');
        expect(findIndexDts(dir)).toBe(path.join(dir, 'index.d.ts'));
    });

    it('returns null when no index.d.ts exists', () => {
        writeFileSync(path.join(dir, 'other.d.ts'), 'export {}\n');
        expect(findIndexDts(dir)).toBeNull();
    });

    it('stops descending past the depth cap instead of walking huge trees', () => {
        let deep = dir;
        for (let i = 0; i < 10; i++) {
            deep = path.join(deep, `level-${i}`);
        }
        mkdirSync(deep, { recursive: true });
        writeFileSync(path.join(deep, 'index.d.ts'), 'export {}\n');
        expect(findIndexDts(dir)).toBeNull();
    });
});

describe('distManifest', () => {
    it('shapes the dist package.json the way consumers resolve the bundle', () => {
        expect(
            distManifest({ name: '@ezclassify/react', version: '1.0.0' }),
        ).toEqual({
            name: '@ezclassify/react',
            version: '1.0.0',
            type: 'module',
            main: './index.cjs',
            module: './index.mjs',
            types: './index.d.ts',
            exports: {
                '.': {
                    types: './index.d.ts',
                    import: './index.mjs',
                    require: './index.cjs',
                },
            },
        });
    });

    it('merges extra subpath exports after the root entry', () => {
        const manifest = distManifest({
            name: '@ezclassify/ui',
            version: '1.0.0',
            extraExports: { './styles': './index.css' },
        });
        expect(manifest.exports['./styles']).toBe('./index.css');
        expect(manifest.exports['.'].import).toBe('./index.mjs');
    });
});

describe('ensureTopLevelDtsStub', () => {
    let outDir: string;

    beforeEach(() => {
        outDir = mkdtempSync(path.join(tmpdir(), 'build-lib-out-'));
    });

    afterEach(() => {
        rmSync(outDir, { recursive: true, force: true });
    });

    it('writes a re-export stub pointing at the nested emitted index', () => {
        mkdirSync(path.join(outDir, 'react', 'src'), { recursive: true });
        writeFileSync(
            path.join(outDir, 'react', 'src', 'index.d.ts'),
            'export {}\n',
        );
        ensureTopLevelDtsStub(outDir);
        const stub = readFileSync(path.join(outDir, 'index.d.ts'), 'utf8');
        expect(stub).toBe("export * from './react/src/index'\n");
    });

    it('leaves an existing top-level index.d.ts untouched', () => {
        writeFileSync(
            path.join(outDir, 'index.d.ts'),
            '// real emitted declarations\n',
        );
        ensureTopLevelDtsStub(outDir);
        expect(readFileSync(path.join(outDir, 'index.d.ts'), 'utf8')).toBe(
            '// real emitted declarations\n',
        );
    });

    it('throws when tsc emitted no index.d.ts at all', () => {
        expect(() => ensureTopLevelDtsStub(outDir)).toThrow(
            'No index.d.ts emitted',
        );
    });
});
