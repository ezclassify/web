import { afterEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import {
    copyFileSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    rmSync,
    writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const scripts = dirname(fileURLToPath(import.meta.url));
const temporary: string[] = [];
afterEach(() => {
    for (const directory of temporary.splice(0))
        rmSync(directory, { recursive: true, force: true });
});

function runGate(missingHost = '') {
    const root = mkdtempSync(join(tmpdir(), 'consumer-builds-'));
    temporary.push(root);
    mkdirSync(join(root, 'scripts'));
    mkdirSync(join(root, 'bin'));
    for (const file of [
        'check-consumer-engine-free.mjs',
        'check-consumer-engine-free-lib.mjs',
        'check-publish-content-lib.mjs',
    ]) {
        copyFileSync(join(scripts, file), join(root, 'scripts', file));
    }
    const workspaces = [
        'examples/vanilla-example',
        'examples/react-example',
        'examples/vue-example',
        'examples/angular-example',
        'e2e',
    ];
    for (const workspace of workspaces) {
        mkdirSync(join(root, workspace), { recursive: true });
        writeFileSync(
            join(root, workspace, 'package.json'),
            JSON.stringify({
                name: workspace.replaceAll('/', '-'),
                private: true,
            }),
        );
    }
    // Exercise the native gate's process boundary without invoking compilers:
    // one workspace build writes both e2e outputs, just like its real script.
    writeFileSync(
        join(root, 'bin', 'npm'),
        `#!/usr/bin/env node
const fs = require('node:fs'); const path = require('node:path');
const workspace = process.argv.find(a => a.startsWith('--workspace=')).slice('--workspace='.length);
fs.appendFileSync('calls.txt', workspace + '\\n');
const outputs = workspace === 'e2e' ? ['dist/react-host', 'dist/angular-host/browser']
  : [workspace === 'examples/angular-example' ? 'dist/angular-example/browser' : 'dist'];
for (const output of outputs) {
  if (output === process.env.MISSING_HOST) continue;
  const directory = path.join(workspace, output);
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, 'index.js'), 'export {};');
}
`,
        { mode: 0o755 },
    );
    const result = spawnSync(
        process.execPath,
        [join(root, 'scripts/check-consumer-engine-free.mjs'), '--verbose'],
        {
            cwd: root,
            encoding: 'utf8',
            env: {
                ...process.env,
                PATH: `${join(root, 'bin')}:${process.env.PATH}`,
                MISSING_HOST: missingHost,
            },
        },
    );
    return {
        result,
        calls: readFileSync(join(root, 'calls.txt'), 'utf8').trim().split('\n'),
    };
}

describe('consumer engine-freedom build evidence', () => {
    it('builds five distinct workspaces once while auditing all six outputs', () => {
        const { result, calls } = runGate();
        expect(result.status, result.stderr).toBe(0);
        expect(calls).toHaveLength(5);
        expect(new Set(calls).size).toBe(5);
        expect(result.stdout).toContain('6 application(s) carry no engine');
        expect(result.stdout).toContain('built under dist/react-host');
        expect(result.stdout).toContain(
            'built under dist/angular-host/browser',
        );
    });

    it.each(['dist/react-host', 'dist/angular-host/browser'])(
        'rejects missing %s even though the shared build succeeded',
        (host) => {
            const { result, calls } = runGate(host);
            expect(result.status).toBe(1);
            expect(result.stderr).toContain(host);
            expect(
                calls.filter((workspace) => workspace === 'e2e'),
            ).toHaveLength(1);
        },
    );
});
