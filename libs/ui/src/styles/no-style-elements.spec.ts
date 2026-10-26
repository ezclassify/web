/**
 * Guard: no production source in this repository creates a `<style>` element.
 *
 * Every runtime stylesheet goes through `src/styles/adopt.ts`, which uses
 * constructable stylesheets. One `document.createElement('style')` or one
 * `<style>` in an HTML template literal is enough to put `style-src
 * 'unsafe-inline'` back into every consumer's Content Security Policy, and it
 * would do so silently: the page still looks right. This test is the thing that
 * makes that regression loud.
 *
 * Spec files are exempt. Several of them build a style element on purpose to
 * work around jsdom's cascade, which never reaches a consumer's page. Comments
 * are stripped before scanning, so prose about `<style>` elements (this file
 * included) is not a finding.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const REPO_ROOT = join(import.meta.dirname, '..', '..', '..', '..');

/** Production source trees this guard walks. */
const SOURCE_ROOTS = [
    join(REPO_ROOT, 'libs', 'ui', 'src'),
    ...readdirSync(join(REPO_ROOT, 'integrations'))
        .map((name) => join(REPO_ROOT, 'integrations', name, 'src'))
        .filter((dir) => {
            try {
                return statSync(dir).isDirectory();
            } catch {
                return false;
            }
        }),
];

const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.mts', '.js', '.mjs', '.vue'];

function isSpec(path: string): boolean {
    return /\.(spec|test)\.[cm]?[jt]sx?$/.test(path);
}

function collectSources(dir: string): string[] {
    const found: string[] = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
            if (entry.name === 'node_modules' || entry.name === 'dist') {
                continue;
            }
            found.push(...collectSources(full));
            continue;
        }
        if (!SOURCE_EXTENSIONS.some((ext) => entry.name.endsWith(ext))) {
            continue;
        }
        if (isSpec(entry.name)) continue;
        found.push(full);
    }
    return found;
}

/**
 * Drop comments so documentation about the old mechanism does not read as a
 * finding. Conservative on purpose: it can only hide text that follows a
 * comment marker on the same line, never introduce a false pass for markup a
 * component actually builds.
 */
function stripComments(source: string): string {
    return source
        .replace(/\/\*[\s\S]*?\*\//g, ' ')
        .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

/** `document.createElement('style')` and friends, any quote style, any owner. */
const CREATE_STYLE_ELEMENT =
    /createElement\s*(?:<[^>]*>\s*)?\(\s*(['"`])style\1/i;

/** A literal `<style` opening tag in markup a component builds. */
const STYLE_TAG_LITERAL = /<style[\s>]/i;

const sources = SOURCE_ROOTS.flatMap(collectSources);

describe('no runtime <style> elements in production source', () => {
    it('finds the source trees it is meant to guard', () => {
        expect(SOURCE_ROOTS.length).toBeGreaterThanOrEqual(4);
        expect(sources.length).toBeGreaterThan(50);
    });

    it('creates no style element anywhere in production source', () => {
        const offenders = sources.filter((file) =>
            CREATE_STYLE_ELEMENT.test(
                stripComments(readFileSync(file, 'utf8')),
            ),
        );
        expect(
            offenders.map((file) => relative(REPO_ROOT, file)),
        ).toStrictEqual([]);
    });

    it('emits no <style> tag in production source', () => {
        const offenders = sources.filter((file) =>
            // `.vue` single-file components declare a build-time `<style>`
            // block that the bundler extracts into a CSS file. That is not a
            // runtime injection and no consumer's CSP sees it.
            file.endsWith('.vue')
                ? false
                : STYLE_TAG_LITERAL.test(
                      stripComments(readFileSync(file, 'utf8')),
                  ),
        );
        expect(
            offenders.map((file) => relative(REPO_ROOT, file)),
        ).toStrictEqual([]);
    });
});
