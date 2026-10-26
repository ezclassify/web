// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';

/**
 * Where the publication-boundary gate is allowed to be wired, and where it is
 * not.
 *
 * This repo's .npmrc sets `ignore-scripts=true`, and npm honors that for the
 * publishing package's own lifecycle: `npm publish` and `npm pack` here run
 * neither prepublishOnly nor prepack nor prepare. A security gate wired only
 * into prepublishOnly is therefore inert in this checkout. These tests pin the
 * two facts that keep the gate live: the setting is still there, and the gate
 * still runs as an explicit CI step rather than relying on a hook npm skips.
 */
const ROOT = path.resolve(__dirname, '..');

/**
 * Read a repository file as text.
 *
 * @param relativePath - Path relative to the repository root.
 * @returns File contents.
 */
function read(relativePath: string): string {
    return readFileSync(path.join(ROOT, relativePath), 'utf8');
}

describe('publication-boundary gate wiring', () => {
    it('still disables install and publish lifecycle scripts', () => {
        // If this ever stops being true the comments below, and the reason CI
        // carries the gate as its own step, need revisiting.
        expect(read('.npmrc')).toMatch(/^ignore-scripts=true$/m);
    });

    it('runs the content gate as an explicit CI step', () => {
        expect(read('.github/workflows/ci.yml')).toContain(
            'npm run check:publish-content',
        );
    });

    it('keeps the npm script the CI step and publish paths both call', () => {
        const manifest = JSON.parse(read('package.json'));
        expect(manifest.scripts['check:publish-content']).toBe(
            'node scripts/check-publish-content.mjs',
        );
    });

    it('narrows every publishable package with a files list, which npm honors regardless of scripts', () => {
        // The files list is the one control that does not depend on a script
        // running, so it is what keeps local build artifacts out of the
        // tarball.
        const publishable = [
            'libs/ui',
            'integrations/react',
            'integrations/vue',
            'integrations/angular',
            // Publishes to the development mirror only, never to npmjs.org,
            // but the files list is the control either way.
            'libs/ui-tools',
        ];
        for (const directory of publishable) {
            const manifest = JSON.parse(read(`${directory}/package.json`));
            expect(Array.isArray(manifest.files), directory).toBe(true);
            expect(manifest.files, directory).not.toContain('dist');
        }
    });
});
