/**
 * The spec-import gate fails on any engine import under the test roots, and
 * only on an import. It is what keeps a clean clone able to run every spec.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { forbiddenImports } from './check-spec-imports.mjs';

const script = path.resolve(import.meta.dirname, 'check-spec-imports.mjs');
const repoRoot = path.resolve(import.meta.dirname, '..');
const temps: string[] = [];

afterEach(() => {
    for (const dir of temps.splice(0)) rmSync(dir, { recursive: true });
});

/** A throwaway repo root holding `files`, keyed by relative path. */
function plant(files: Record<string, string>): string {
    const root = mkdtempSync(path.join(tmpdir(), 'spec-imports-'));
    temps.push(root);
    for (const [name, text] of Object.entries(files)) {
        const full = path.join(root, name);
        mkdirSync(path.dirname(full), { recursive: true });
        writeFileSync(full, text);
    }
    return root;
}

function run(root: string) {
    return spawnSync(process.execPath, [script, '--root', root], {
        encoding: 'utf8',
    });
}

describe('forbiddenImports', () => {
    it('recognizes every way a source can import a forbidden package', () => {
        const source = [
            "import { Context } from '@ezclassify/engine';",
            "import type { X } from '@ezclassify/engine/browser';",
            "import '@ezclassify/engine-wasm';",
            'import {',
            '    runEzClassifyStoreConformance,',
            "} from '@ezclassify/testing-utils';",
            "export * from '@ezclassify/engine-wasm';",
            "const wasm = await import('@ezclassify/engine-wasm');",
            "const engine = require('@ezclassify/engine');",
        ].join('\n');
        expect(forbiddenImports(source).sort()).toEqual([
            '@ezclassify/engine',
            '@ezclassify/engine',
            '@ezclassify/engine-wasm',
            '@ezclassify/engine-wasm',
            '@ezclassify/engine-wasm',
            '@ezclassify/engine/browser',
            '@ezclassify/testing-utils',
        ]);
    });

    it('leaves a forbidden name that is only data or a public package', () => {
        const source = [
            'const fixture = "import { Context } from \'@ezclassify/engine\';";',
            'const tpl = `require("@ezclassify/engine")`;',
            "// import x from '@ezclassify/engine';",
            "/* import('@ezclassify/engine-wasm') */",
            "import { connectDemoContext } from '../test-support/demo-runtime';",
            "import { RestClient } from '@ezclassify/rest-client';",
            "import { x } from '@ezclassify/engine-extras';",
        ].join('\n');
        expect(forbiddenImports(source)).toEqual([]);
    });
});

describe('check-spec-imports command', () => {
    it('fails and names the file when a spec imports the engine', () => {
        const root = plant({
            'libs/ui/src/clean.spec.ts': "import { a } from './a';\n",
            'libs/ui/src/planted.spec.ts':
                "import { Context } from '@ezclassify/engine';\n",
        });
        const result = run(root);
        expect(result.status).toBe(1);
        expect(result.stderr).toContain(
            `${path.join('libs/ui/src', 'planted.spec.ts')}: @ezclassify/engine`,
        );
        expect(result.stderr).not.toContain('clean.spec.ts');
    });

    it('fails on a planted import in a fixture and a test-support helper', () => {
        const root = plant({
            'tests/fixtures/f.ts':
                "export * from '@ezclassify/testing-utils';\n",
            'test-support/h.mjs': "await import('@ezclassify/engine-wasm');\n",
        });
        const result = run(root);
        expect(result.status).toBe(1);
        expect(result.stderr).toContain('f.ts: @ezclassify/testing-utils');
        expect(result.stderr).toContain('h.mjs: @ezclassify/engine-wasm');
    });

    it('passes on a tree with no such import', () => {
        const root = plant({ 'libs/ui/src/ok.spec.ts': "import 'vitest';\n" });
        expect(run(root).status).toBe(0);
    });

    it('passes on this repository', () => {
        expect(run(repoRoot).status).toBe(0);
    });
});
