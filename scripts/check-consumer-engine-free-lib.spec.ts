import { describe, expect, it } from 'vitest';

// @ts-expect-error - plain .mjs helper module, no type declarations
import {
    auditBuildOutput,
    auditEngineFreedom,
    auditInstallClosure,
    installClosure,
} from './check-consumer-engine-free-lib.mjs';

/** The closure shape {@link installClosure} returns. */
type Closure = {
    reached: Map<string, string[]>;
    unresolved: Array<{ name: string; trail: string[] }>;
};

/**
 * Build an audit input with everything clean, so each case below changes one
 * thing and the failure it produces is unambiguous.
 */
function audit(
    overrides: {
        manifest?: Record<string, unknown>;
        files?: Array<{ path: string; text: string }>;
    } = {},
): string[] {
    return auditEngineFreedom({
        name: 'examples/react-example',
        manifest: overrides.manifest ?? {
            dependencies: {
                '@ezclassify/rest-client': '^1.0.0-0',
                '@ezclassify/ui': '^1.0.0-0',
            },
        },
        files: overrides.files ?? [
            {
                path: 'src/app.ts',
                text: "import x from '@ezclassify/rest-client';",
            },
        ],
    }) as string[];
}

/** Resolve manifests from a plain object, for the closure cases. */
function readerFor(
    registry: Record<string, Record<string, unknown>>,
): (name: string) => Record<string, unknown> | null {
    return (name) => registry[name] ?? null;
}

describe('auditEngineFreedom', () => {
    it('passes an example that consumes only the client and the UI', () => {
        expect(audit()).toEqual([]);
    });

    it('rejects the engine in any dependency field, devDependencies included', () => {
        for (const field of [
            'dependencies',
            'devDependencies',
            'peerDependencies',
            'optionalDependencies',
        ]) {
            const violations = audit({
                manifest: { [field]: { '@ezclassify/engine': '^1.0.0-0' } },
            });
            expect(violations).toHaveLength(1);
            expect(violations[0]).toContain(`${field}.@ezclassify/engine`);
        }
    });

    it('rejects an engine import through any specifier form', () => {
        const forms = [
            "import { Context } from '@ezclassify/engine';",
            "import '@ezclassify/engine';",
            "const e = require('@ezclassify/engine');",
            "await import('@ezclassify/engine/browser');",
        ];
        for (const text of forms) {
            const violations = audit({ files: [{ path: 'src/a.ts', text }] });
            expect(violations).toHaveLength(1);
            expect(violations[0]).toContain('imports @ezclassify/engine');
        }
    });

    it('rejects an engine import left in a built bundle', () => {
        const violations = audit({
            files: [
                {
                    path: 'dist/main.js',
                    text: 'import"@ezclassify/engine";console.log(1)',
                },
            ],
        });
        expect(violations).toHaveLength(1);
        expect(violations[0]).toContain('dist/main.js');
    });

    it('leaves other @ezclassify imports alone', () => {
        expect(
            audit({
                files: [
                    {
                        path: 'src/a.ts',
                        text: "import { useSchemeEngine } from '@ezclassify/react';\nimport '@ezclassify/ui';",
                    },
                ],
            }),
        ).toEqual([]);
    });
});

describe('auditBuildOutput', () => {
    it('passes when the build left files to scan', () => {
        expect(auditBuildOutput('example', 'dist', ['dist/main.js'])).toEqual(
            [],
        );
    });

    it('refuses to call a scan of nothing a pass', () => {
        const violations = auditBuildOutput('example', 'dist', []) as string[];
        expect(violations).toHaveLength(1);
        expect(violations[0]).toContain('nothing to scan under dist');
    });
});

describe('installClosure', () => {
    it('follows dependencies and peerDependencies transitively', () => {
        const closure = installClosure(
            'app',
            readerFor({
                app: { dependencies: { ui: '1' } },
                ui: { peerDependencies: { types: '1' } },
                types: {},
            }),
        ) as Closure;
        expect([...closure.reached.keys()].sort()).toEqual(['types', 'ui']);
        expect(closure.reached.get('types')).toEqual(['app', 'ui', 'types']);
        expect(closure.unresolved).toEqual([]);
    });

    it('follows optionalDependencies, which npm installs by default', () => {
        const closure = installClosure(
            'app',
            readerFor({
                'app': { optionalDependencies: { ui: '1' } },
                'ui': { dependencies: { '@ezclassify/engine': '1' } },
                '@ezclassify/engine': {},
            }),
        ) as Closure;
        expect(closure.reached.has('@ezclassify/engine')).toBe(true);
    });

    it('does not follow devDependencies, which no consumer installs', () => {
        const closure = installClosure(
            'app',
            readerFor({
                app: { dependencies: { ui: '1' } },
                ui: { devDependencies: { '@ezclassify/engine': '1' } },
            }),
        ) as Closure;
        expect(closure.reached.has('@ezclassify/engine')).toBe(false);
    });

    it('terminates on a dependency cycle', () => {
        const closure = installClosure(
            'app',
            readerFor({
                app: { dependencies: { a: '1' } },
                a: { dependencies: { b: '1' } },
                b: { dependencies: { a: '1' } },
            }),
        ) as Closure;
        expect([...closure.reached.keys()].sort()).toEqual(['a', 'b']);
    });

    it('reports a required package that is not installed, because the walk stopped there', () => {
        const closure = installClosure(
            'app',
            readerFor({ app: { dependencies: { missing: '1' } } }),
        ) as Closure;
        expect([...closure.reached.keys()]).toEqual(['missing']);
        expect(closure.unresolved).toEqual([
            { name: 'missing', trail: ['app', 'missing'] },
        ]);
    });

    it('accepts an absent optional dependency and an absent optional peer', () => {
        const closure = installClosure(
            'app',
            readerFor({
                app: {
                    dependencies: { ui: '1' },
                    optionalDependencies: { native: '1' },
                },
                ui: {
                    peerDependencies: { compiler: '1' },
                    peerDependenciesMeta: { compiler: { optional: true } },
                },
            }),
        ) as Closure;
        expect([...closure.reached.keys()].sort()).toEqual([
            'compiler',
            'native',
            'ui',
        ]);
        expect(closure.unresolved).toEqual([]);
    });

    it('still reports an absent package that some other edge requires', () => {
        const closure = installClosure(
            'app',
            readerFor({
                app: {
                    dependencies: { ui: '1' },
                    optionalDependencies: { shared: '1' },
                },
                ui: { dependencies: { shared: '1' } },
            }),
        ) as Closure;
        expect(closure.unresolved.map((entry) => entry.name)).toEqual([
            'shared',
        ]);
    });

    it('reports the root itself when its manifest cannot be read', () => {
        const closure = installClosure('app', readerFor({})) as Closure;
        expect(closure.unresolved).toEqual([{ name: 'app', trail: ['app'] }]);
    });
});

describe('auditInstallClosure', () => {
    /** Wrap a reached-map in the closure shape, with nothing unresolved. */
    function complete(reached: Map<string, string[]>): Closure {
        return { reached, unresolved: [] };
    }

    it('passes a complete closure with no engine in it', () => {
        expect(
            auditInstallClosure(
                'example',
                complete(new Map([['@ezclassify/ui', []]])),
            ),
        ).toEqual([]);
    });

    it('names the path that reached the engine', () => {
        const violations = auditInstallClosure(
            'example',
            complete(
                new Map([
                    [
                        '@ezclassify/engine',
                        ['app', '@ezclassify/ui', '@ezclassify/engine'],
                    ],
                ]),
            ),
        ) as string[];
        expect(violations).toHaveLength(1);
        expect(violations[0]).toContain(
            'app -> @ezclassify/ui -> @ezclassify/engine',
        );
    });

    it('fails a truncated closure, which proves nothing below where it stopped', () => {
        const violations = auditInstallClosure('example', {
            reached: new Map([['@ezclassify/ui', ['app', '@ezclassify/ui']]]),
            unresolved: [
                { name: '@ezclassify/ui', trail: ['app', '@ezclassify/ui'] },
            ],
        }) as string[];
        expect(violations).toHaveLength(1);
        expect(violations[0]).toContain('is not installed');
    });
});
