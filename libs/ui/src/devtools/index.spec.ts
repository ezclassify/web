/**
 * The devtools entry: the overlay ships from `@ezclassify/ui/devtools`, never
 * from the main entry, and loading the entry installs the console switch.
 */
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import * as main from '../index';
import * as devtoolsEntry from './index';

describe('@ezclassify/ui/devtools', () => {
    afterEach(() => {
        devtoolsEntry.devtools(false);
        document.body.replaceChildren();
    });

    it('is the only entry that exports the overlay', () => {
        expect(
            (main as Record<string, unknown>).createComponentLocator,
        ).toBeUndefined();
        expect(typeof devtoolsEntry.createComponentLocator).toBe('function');
    });

    it('is declared as an ESM subpath export of the package', () => {
        const manifest = JSON.parse(
            readFileSync(
                path.resolve(import.meta.dirname, '../../package.json'),
                'utf8',
            ),
        );
        expect(manifest.exports['./devtools']).toEqual({
            types: './dist/lib/devtools/index.d.ts',
            import: './dist/lib/devtools/index.mjs',
        });
    });

    it('installs ezclassify.devtools() on the global object when loaded', () => {
        const global = globalThis as {
            ezclassify?: { devtools?: (on?: boolean) => void };
        };
        expect(global.ezclassify?.devtools).toBe(devtoolsEntry.devtools);
    });

    it('turns the highlights on for the whole page and off again', () => {
        const field = document.createElement('div');
        field.setAttribute('data-ezclassify-controller', 'select');
        field.getBoundingClientRect = () =>
            ({ width: 200, height: 40, top: 0, left: 0 }) as DOMRect;
        document.body.append(field);

        devtoolsEntry.devtools();
        devtoolsEntry.devtools();
        const controls = document.querySelectorAll('.ezclassify-locator');
        expect(controls).toHaveLength(1);
        expect(controls[0].classList).toContain('ezclassify-locator--floating');
        expect(document.body.classList).toContain('ezclassify-xray');
        expect(field.dataset.ezclassifyXrayKind).toBe('component');

        devtoolsEntry.devtools(false);
        expect(document.querySelector('.ezclassify-locator')).toBeNull();
        expect(document.body.classList).not.toContain('ezclassify-xray');
        expect(field.dataset.ezclassifyXrayKind).toBeUndefined();
    });
});
