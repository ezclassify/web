import { beforeAll, describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const iifeDir = resolve(__dirname, '../dist/browser');

describe('UI IIFE bundle smoke test', () => {
    beforeAll(() => {
        // A clean checkout has no dist/browser tree. Build the
        // artifact under test so this suite cannot pass or fail on stale files.
        // Keep esbuild in a plain Node process; jsdom replaces typed-array
        // globals with another realm and violates esbuild's startup invariant.
        execFileSync(
            process.execPath,
            [resolve(__dirname, '../build-browser.mjs')],
            {
                stdio: 'inherit',
            },
        );
    });

    it('dist/browser/ezclassify-ui.iife.js exists', () => {
        expect(existsSync(resolve(iifeDir, 'ezclassify-ui.iife.js'))).toBe(
            true,
        );
    });

    it('dist/browser/ezclassify-ui.iife.min.js exists', () => {
        expect(existsSync(resolve(iifeDir, 'ezclassify-ui.iife.min.js'))).toBe(
            true,
        );
    });

    it('IIFE source assigns to EzClassifyUI global', () => {
        const src = readFileSync(
            resolve(iifeDir, 'ezclassify-ui.iife.js'),
            'utf-8',
        );
        expect(src).toMatch(/var EzClassifyUI\s*=/);
    });

    it('IIFE exports EzClassifyUI class', () => {
        const src = readFileSync(
            resolve(iifeDir, 'ezclassify-ui.iife.js'),
            'utf-8',
        );
        expect(src).toContain('EzClassifyUI');
    });

    it('minified IIFE is smaller than unminified', () => {
        const full = readFileSync(resolve(iifeDir, 'ezclassify-ui.iife.js'));
        const min = readFileSync(resolve(iifeDir, 'ezclassify-ui.iife.min.js'));
        expect(min.length).toBeLessThan(full.length);
    });
});
