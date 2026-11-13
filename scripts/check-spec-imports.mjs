#!/usr/bin/env node
// Public-input gate for the spec, fixture and test-support roots.
//
// This repository is open source and its CI runs on a clean clone. Engine
// behavior enters it only as committed recordings of the demo runtime's wire
// traffic, so no spec, fixture or test helper may import @ezclassify/engine,
// @ezclassify/engine-wasm or @ezclassify/testing-utils: none of the three can
// be installed from a public registry, and a source that needs one fails for
// every outside contributor.
//
// The scan reads source text only and needs no installed dependency, so CI
// runs it first, before `npm ci`, and it holds whether or not such a package
// happens to exist on the machine running it. Strings, template literals and
// comments are skipped, so a source that feeds a forbidden name to a scanner
// (the consumer gates' own specs do) is not an import.
//
// Usage: node scripts/check-spec-imports.mjs [--root <dir>]

import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Where specs, fixtures and test helpers live, relative to the repo root. */
export const ROOTS = [
    'libs',
    'integrations',
    'tests',
    'test-support',
    'scripts',
    'e2e',
];

const SKIP = new Set([
    'node_modules',
    'dist',
    'coverage',
    '.angular',
    'test-results',
    '__recordings__',
]);

/** The packages no test source may import, with any subpath. */
const FORBIDDEN = /^@ezclassify\/(?:engine|engine-wasm|testing-utils)(?:\/|$)/;

const SOURCE_FILE = /\.(?:[cm]?[jt]sx?|vue)$/;

/**
 * Every module specifier `text` imports: static, type and side-effect imports,
 * re-exports, dynamic `import()` and `require()`. A string counts only when it
 * follows `from`, `import`, `import(` or `require(`.
 *
 * @param {string} text
 * @returns {string[]}
 */
export function importedSpecifiers(text) {
    const found = [];
    let previous = '';
    let i = 0;
    const n = text.length;
    while (i < n) {
        const c = text[i];
        if (c === '/' && text[i + 1] === '/') {
            while (i < n && text[i] !== '\n') i += 1;
        } else if (c === '/' && text[i + 1] === '*') {
            const end = text.indexOf('*/', i + 2);
            i = end === -1 ? n : end + 2;
        } else if (c === '"' || c === "'" || c === '`') {
            let j = i + 1;
            while (j < n && text[j] !== c) {
                if (text[j] === '\\') j += 1;
                else if (c !== '`' && text[j] === '\n') break;
                j += 1;
            }
            if (
                c !== '`' &&
                /^(?:from|import|import\(|require\()$/.test(previous)
            )
                found.push(text.slice(i + 1, j));
            previous = 'string';
            i = j + 1;
        } else if (/[A-Za-z_$]/.test(c)) {
            let j = i + 1;
            while (j < n && /[\w$]/.test(text[j])) j += 1;
            const word = text.slice(i, j);
            previous =
                text[j] === '(' && /^(?:import|require)$/.test(word)
                    ? `${word}(`
                    : word;
            i = text[j] === '(' && previous.endsWith('(') ? j + 1 : j;
        } else {
            if (!/\s/.test(c)) previous = c;
            i += 1;
        }
    }
    return found;
}

/**
 * The forbidden module specifiers `text` imports.
 *
 * @param {string} text
 * @returns {string[]}
 */
export function forbiddenImports(text) {
    return importedSpecifiers(text).filter((s) => FORBIDDEN.test(s));
}

/**
 * Every `file: specifier` offence under the roots of `repoRoot`.
 *
 * @param {string} repoRoot
 * @returns {string[]}
 */
export function findOffenders(repoRoot) {
    const offenders = [];
    const walk = (dir) => {
        let entries;
        try {
            entries = readdirSync(dir, { withFileTypes: true });
        } catch {
            return;
        }
        for (const entry of entries) {
            if (entry.name.startsWith('.') || SKIP.has(entry.name)) continue;
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) walk(full);
            else if (SOURCE_FILE.test(entry.name))
                for (const s of forbiddenImports(readFileSync(full, 'utf8')))
                    offenders.push(`${path.relative(repoRoot, full)}: ${s}`);
        }
    };
    for (const root of ROOTS) walk(path.join(repoRoot, root));
    return offenders;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    const flag = process.argv.indexOf('--root');
    const repoRoot =
        flag === -1
            ? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
            : path.resolve(process.argv[flag + 1]);
    const offenders = findOffenders(repoRoot);
    if (offenders.length > 0) {
        console.error(
            'Spec, fixture and test-support sources import a package the public cannot install:',
        );
        for (const offender of offenders) console.error(`  ${offender}`);
        console.error(
            'Engine behavior enters this repository as committed demo runtime recordings only.',
        );
        process.exit(1);
    }
    console.log(
        'Spec imports: no engine, engine-wasm or testing-utils import.',
    );
}
