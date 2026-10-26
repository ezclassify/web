import path from 'node:path';

/**
 * Pure helpers for the publication-content gate. Split from
 * check-publish-content.mjs so the parsing and narrowing rules are
 * unit-testable without packing anything, the same split as
 * pack-consume-lib.mjs and build-lib.mjs. This module has no import-time side
 * effects.
 */

/**
 * Read the `minified as PublicName` pairs out of an ESM bundle's closing export
 * statement. Returns the public names, or an empty set when the text carries no
 * export statement. The bundle's last such statement wins: a sourcemap comment
 * or appended banner may follow it, so the match cannot be anchored to the
 * end.
 */
export function parseExportedNames(bundleText) {
    const matches = [...bundleText.matchAll(/export\s*\{([^}]*)\}/g)];
    const names = new Set();
    if (matches.length === 0) return names;
    for (const clause of matches[matches.length - 1][1].split(',')) {
        const parts = clause.trim().split(/\s+as\s+/);
        const alias = parts[1] ?? parts[0];
        if (alias) names.add(alias.trim());
    }
    return names;
}

/**
 * Keep only the engine identifiers distinctive enough to stand as evidence on
 * their own: long enough not to collide by accident, and absent from every
 * source file this repo authors. An occurrence of a surviving name inside a
 * packed artifact is therefore inlined engine code, not one of our call sites.
 *
 * `floor` names are appended when the corpus does not already contain them, so
 * the check keeps teeth even if the engine's export list ever thins out.
 */
export function narrowEngineMarkers({
    exportedNames,
    sourceCorpus,
    floor = [],
    minLength = 12,
}) {
    const markers = [...exportedNames].filter(
        (name) => name.length >= minLength && !sourceCorpus.includes(name),
    );
    for (const name of floor) {
        if (!markers.includes(name) && !sourceCorpus.includes(name))
            markers.push(name);
    }
    return markers;
}

// Bare scoped specifiers in import/export-from, require(), and import().
//
// The first pattern deliberately does not require `from`: `import
// '@ezclassify/engine';` is a side-effect import with no binding clause.
const SPECIFIER_PATTERNS = [
    /(?:\bimport|\bexport)\s*(?:type\s+)?(?:[\w${},*\s]*?\bfrom\s*)?(['"])(@[^'"]+\/[^'"]*)\1/g,
    /\brequire\s*\(\s*(['"])(@[^'"]+\/[^'"]*)\1\s*\)/g,
    /\bimport\s*\(\s*(['"])(@[^'"]+\/[^'"]*)\1\s*\)/g,
];

/**
 * Reduce a specifier to its package name so a subpath import such as
 * `@ezclassify/engine/browser` is attributed to `@ezclassify/engine`.
 */
export function packageOf(specifier) {
    const parts = specifier.split('/');
    return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : specifier;
}

/**
 * Package names under `scope` that `text` imports, deduplicated, in the order
 * first seen. Subpaths collapse to their package.
 */
export function scopedImports(text, scope) {
    const found = [];
    const seen = new Set();
    for (const pattern of SPECIFIER_PATTERNS) {
        pattern.lastIndex = 0;
        for (const match of text.matchAll(pattern)) {
            if (!match[2].startsWith(scope)) continue;
            const name = packageOf(match[2]);
            if (seen.has(name)) continue;
            seen.add(name);
            found.push(name);
        }
    }
    return found;
}

/**
 * The dependency fields an install actually resolves for a consumer. A name
 * that appears only under devDependencies is absent from the installed tree, so
 * it does not count as declared.
 */
export const RESOLVED_DEPENDENCY_FIELDS = [
    'dependencies',
    'peerDependencies',
    'optionalDependencies',
];

/**
 * Every package name a manifest asks an install to resolve.
 *
 * @param manifest - Parsed package.json of the artifact that gets published.
 * @returns The declared names, deduplicated.
 */
export function declaredDependencies(manifest) {
    const declared = new Set();
    for (const field of RESOLVED_DEPENDENCY_FIELDS) {
        for (const name of Object.keys(manifest?.[field] ?? {}))
            declared.add(name);
    }
    return declared;
}

/**
 * Packages under `scope` that a packed file imports without the published
 * manifest declaring them.
 *
 * A published file may name a public package and still be broken for the
 * consumer who installs it: npm fetches exactly what the manifest declares, so
 * an undeclared specifier resolves only by accident, from whatever a sibling
 * dependency happened to hoist.
 *
 * @param text - Contents of one packed JavaScript or declaration file.
 * @param options - `scope` to inspect, `selfName` of the package (a package may
 *   always import itself), and the `declared` names from its manifest.
 * @returns Undeclared package names, in the order first seen.
 */
export function undeclaredImports(text, { scope, selfName, declared }) {
    return scopedImports(text, scope).filter(
        (name) => name !== selfName && !declared.has(name),
    );
}

/**
 * External source maps referenced by a packed file but absent from the packed
 * artifact. Inline data URLs are self-contained and therefore valid.
 *
 * @param text - Packed JavaScript, declaration, or CSS file contents.
 * @param file - POSIX path of that file within the package.
 * @param packed - POSIX paths included in the package.
 * @returns Missing normalized source-map paths, in reference order.
 */
export function missingSourceMaps(text, file, packed) {
    const missing = [];
    for (const match of text.matchAll(/[#@]\s*sourceMappingURL=([^\s'"*]+)/g)) {
        const reference = match[1];
        if (reference.startsWith('data:')) continue;
        const target = path.posix.normalize(
            path.posix.join(path.posix.dirname(file), reference),
        );
        if (!packed.has(target)) missing.push(target);
    }
    return missing;
}
