import { describe, expect, it } from 'vitest';

// @ts-expect-error - plain .mjs helper module, no type declarations
import {
    declaredDependencies,
    missingSourceMaps,
    narrowEngineMarkers,
    packageOf,
    parseExportedNames,
    scopedImports,
    undeclaredImports,
} from './check-publish-content-lib.mjs';

describe('missingSourceMaps', () => {
    it('reports normalized external maps excluded from the artifact', () => {
        expect(
            missingSourceMaps(
                '/*# sourceMappingURL=../maps/ui.css.map */',
                'dist/styles/ui.css',
                new Set(['dist/styles/ui.css']),
            ),
        ).toEqual(['dist/maps/ui.css.map']);
    });

    it('accepts packed and inline maps', () => {
        const packed = new Set(['dist/ui.js', 'dist/ui.js.map']);
        expect(
            missingSourceMaps(
                [
                    '//# sourceMappingURL=ui.js.map',
                    '//# sourceMappingURL=data:application/json;base64,e30=',
                ].join('\n'),
                'dist/ui.js',
                packed,
            ),
        ).toEqual([]);
    });
});

describe('parseExportedNames', () => {
    it('reads the public alias out of each minified export clause', () => {
        const names = parseExportedNames(
            'var a=1;\nexport { df as AccessEngine, Dg as Context, _ as ENGINE_VERSION };\n',
        );
        expect([...names]).toEqual([
            'AccessEngine',
            'Context',
            'ENGINE_VERSION',
        ]);
    });

    it('takes the last export statement, past a trailing sourcemap comment', () => {
        const names = parseExportedNames(
            'export { early as Decoy };\nexport { Hp as verifyMappingHash };\n\n//# sourceMappingURL=engine.mjs.map',
        );
        expect([...names]).toEqual(['verifyMappingHash']);
    });

    it('keeps unaliased names', () => {
        expect([...parseExportedNames('export { precompileScheme };')]).toEqual(
            ['precompileScheme'],
        );
    });

    it('returns nothing for text with no export statement', () => {
        expect(parseExportedNames('const x = 1;').size).toBe(0);
    });
});

describe('narrowEngineMarkers', () => {
    const exportedNames = new Set([
        'Context', // too short to stand alone
        'precompileScheme', // engine-only
        'materializeAccessRules', // engine-only
        'resolveVocabulary', // long, but we call it ourselves
    ]);

    it('drops short names and anything the repo authors itself', () => {
        const markers = narrowEngineMarkers({
            exportedNames,
            sourceCorpus:
                "import { resolveVocabulary } from '@ezclassify/engine';",
        });
        expect(markers).toEqual(['precompileScheme', 'materializeAccessRules']);
    });

    it('adds floor names the export list missed', () => {
        const markers = narrowEngineMarkers({
            exportedNames: new Set(),
            sourceCorpus: '',
            floor: ['verifyMappingHash'],
        });
        expect(markers).toEqual(['verifyMappingHash']);
    });

    it('does not add a floor name the repo authors itself', () => {
        const markers = narrowEngineMarkers({
            exportedNames: new Set(),
            sourceCorpus: 'export function verifyMappingHash() {}',
            floor: ['verifyMappingHash'],
        });
        expect(markers).toEqual([]);
    });

    it('does not duplicate a floor name already derived', () => {
        const markers = narrowEngineMarkers({
            exportedNames: new Set(['precompileScheme']),
            sourceCorpus: '',
            floor: ['precompileScheme'],
        });
        expect(markers).toEqual(['precompileScheme']);
    });
});

describe('declaredDependencies', () => {
    it('reads every field an install resolves', () => {
        const declared = declaredDependencies({
            dependencies: { tslib: '^2.3.0' },
            peerDependencies: { '@ezclassify/ui': '^1.0.0-0' },
            optionalDependencies: { fsevents: '^2.0.0' },
        });
        expect([...declared].sort()).toEqual([
            '@ezclassify/ui',
            'fsevents',
            'tslib',
        ]);
    });

    it('ignores devDependencies, which no consumer install fetches', () => {
        const declared = declaredDependencies({
            devDependencies: { '@ezclassify/types': '^1.0.0-0' },
        });
        expect([...declared]).toEqual([]);
    });

    it('treats a manifest with no dependency fields as declaring nothing', () => {
        expect([...declaredDependencies({})]).toEqual([]);
    });
});

describe('undeclaredImports', () => {
    const options = (declared: string[]) => ({
        scope: '@ezclassify/',
        selfName: '@ezclassify/angular',
        declared: new Set(declared),
    });

    it('reports a shipped type import the manifest never declares', () => {
        // The @ezclassify/angular defect: a public .d.ts naming a public
        // package that the install does not fetch.
        const text =
            "import { Suggestion, ValidationError } from '@ezclassify/types';";
        expect(undeclaredImports(text, options(['@ezclassify/ui']))).toEqual([
            '@ezclassify/types',
        ]);
    });

    it('accepts an import declared in any resolved field', () => {
        const text = "import type { Assertion } from '@ezclassify/types';";
        expect(undeclaredImports(text, options(['@ezclassify/types']))).toEqual(
            [],
        );
    });

    it('lets a package import itself', () => {
        const text = "export { Facet } from '@ezclassify/angular/facets';";
        expect(undeclaredImports(text, options([]))).toEqual([]);
    });

    it('ignores packages outside the scope', () => {
        const text = "import { Component } from '@angular/core';";
        expect(undeclaredImports(text, options([]))).toEqual([]);
    });
});

describe('packageOf', () => {
    it('collapses a subpath onto its package', () => {
        expect(packageOf('@ezclassify/engine/browser')).toBe(
            '@ezclassify/engine',
        );
        expect(packageOf('@ezclassify/engine')).toBe('@ezclassify/engine');
    });
});

describe('scopedImports', () => {
    it('finds static, type-only, require and dynamic specifiers', () => {
        const text = [
            "import { Context } from '@ezclassify/engine';",
            "import type { Assertion } from '@ezclassify/types';",
            "export { thing } from '@ezclassify/schemas';",
            "const c = require('@ezclassify/rest-client');",
            "const d = await import('@ezclassify/ui');",
        ].join('\n');
        expect(scopedImports(text, '@ezclassify/').sort()).toEqual([
            '@ezclassify/engine',
            '@ezclassify/rest-client',
            '@ezclassify/schemas',
            '@ezclassify/types',
            '@ezclassify/ui',
        ]);
    });

    it('finds a side-effect import and a spaced dynamic import', () => {
        // `import '@ezclassify/engine';` carries no binding clause, and the
        // engine's own docs describe importing it for its registration side
        // effect. A pattern anchored on `from` cannot see either of these.
        const text = [
            "import '@ezclassify/engine';",
            "const t = import ('@ezclassify/trust');",
            "require ( '@ezclassify/loaders' );",
        ].join('\n');
        expect(scopedImports(text, '@ezclassify/').sort()).toEqual([
            '@ezclassify/engine',
            '@ezclassify/loaders',
            '@ezclassify/trust',
        ]);
    });

    it('deduplicates a package imported through several subpaths', () => {
        const text = [
            "import a from '@ezclassify/engine';",
            "import b from '@ezclassify/engine/browser';",
            "import c from '@ezclassify/engine/scheme-ops';",
        ].join('\n');
        expect(scopedImports(text, '@ezclassify/')).toEqual([
            '@ezclassify/engine',
        ]);
    });

    it('ignores other scopes and relative paths', () => {
        const text = [
            "import { render } from '@testing-library/react';",
            "import { local } from './local';",
        ].join('\n');
        expect(scopedImports(text, '@ezclassify/')).toEqual([]);
    });
});
