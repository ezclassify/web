import { describe, expect, it } from 'vitest';

// @ts-expect-error plain .mjs module without type declarations
import {
    collectExternalScopedPeers,
    consumerEnv,
    angularConsumerManifest,
    angularExamplePlaywrightConfig,
    hasPackedFirstPartyClosure,
} from './pack-consume-lib.mjs';

describe('packed first-party dependency closure', () => {
    it('requires first-party tarballs while allowing their nested registry dependencies', () => {
        expect(
            hasPackedFirstPartyClosure({
                'node_modules/@ezclassify/conformance-server': {
                    resolved: 'file:./conformance-server.tgz',
                },
                'node_modules/@ezclassify/conformance-server/node_modules/ajv':
                    {
                        resolved:
                            'https://registry.npmjs.org/ajv/-/ajv-8.20.0.tgz',
                    },
            }),
        ).toBe(true);
    });

    it('checks nested first-party dependencies against the same tarball requirement', () => {
        expect(
            hasPackedFirstPartyClosure({
                'node_modules/@ezclassify/ui': { resolved: 'file:./ui.tgz' },
                'node_modules/host/node_modules/@ezclassify/types': {
                    resolved: 'https://registry.example/types.tgz',
                },
            }),
        ).toBe(false);
    });

    it('rejects first-party records without a tarball origin', () => {
        expect(
            hasPackedFirstPartyClosure({
                'node_modules/@ezclassify/ui': {},
            }),
        ).toBe(false);
    });

    it('requires an actual first-party package rather than an empty closure', () => {
        expect(
            hasPackedFirstPartyClosure({
                'node_modules/ajv': {
                    resolved: 'https://registry.npmjs.org/ajv/-/ajv-8.20.0.tgz',
                },
            }),
        ).toBe(false);
    });
});

describe('Angular packed consumer manifest', () => {
    it('keeps the current sample unchanged while consuming actual tarballs on the oldest line', () => {
        const source = {
            dependencies: {
                '@angular/core': '22.2.2',
                '@angular/common': '22.2.2',
                '@ezclassify/angular': '^1.0.0-0',
            },
            devDependencies: { '@angular/cli': '22.2.2' },
        };
        const result = angularConsumerManifest(
            source,
            { major: 20, version: '20.3.34' },
            {
                '@ezclassify/angular': '/tmp/angular.tgz',
                '@ezclassify/ui': '/tmp/ui.tgz',
                '@ezclassify/types': '/tmp/types.tgz',
            },
            '1.64.0',
        );
        expect(source.dependencies['@angular/core']).toBe('22.2.2');
        expect(result.dependencies['@angular/core']).toBe('20.3.34');
        expect(result.dependencies['@ezclassify/angular']).toBe(
            'file:/tmp/angular.tgz',
        );
        expect(result.devDependencies.typescript).toBe('5.9.3');
        expect(result.devDependencies['@angular/compiler-cli']).toBe('20.3.34');
        expect(result.devDependencies.playwright).toBe('1.64.0');
        // The README example is zoneless on every supported line.
        expect(result.dependencies['zone.js']).toBeUndefined();
    });
});

describe('Angular example browser configuration', () => {
    it('starts the replay and the dev server the way the example README does', () => {
        const config = angularExamplePlaywrightConfig();
        expect(config).toContain(
            'npx @ezclassify/conformance-server --scenario cedar-valley --port 4010 --cors-origin http://localhost:4200',
        );
        expect(config).toContain('"command": "npm start"');
        expect(config).toContain('"baseURL": "http://localhost:4200"');
    });
});

describe('consumerEnv', () => {
    it('strips the npm_config_* vars npm run exports from the repo .npmrc', () => {
        // With legacy-peer-deps leaked into the scratch install, npm skips peer
        // auto-install and every root entry fails with MODULE_NOT_FOUND.
        const env = consumerEnv({
            npm_config_legacy_peer_deps: 'true',
            npm_config_ignore_scripts: 'true',
            npm_config_min_release_age: '7',
            NPM_CONFIG_REGISTRY: 'http://localhost:4873/',
            PATH: '/usr/bin',
            HOME: '/home/user',
        });
        expect(Object.keys(env).sort()).toEqual(['HOME', 'PATH']);
        expect(env.PATH).toBe('/usr/bin');
    });

    it('keeps unrelated npm_* vars that are not config', () => {
        const env = consumerEnv({ npm_lifecycle_event: 'verify:pack-consume' });
        expect(env.npm_lifecycle_event).toBe('verify:pack-consume');
    });
});

describe('collectExternalScopedPeers', () => {
    const manifests: Record<
        string,
        {
            dependencies?: Record<string, string>;
            peerDependencies?: Record<string, string>;
        }
    > = {
        '@ezclassify/engine': {
            dependencies: {
                '@ezclassify/types': '^1.0.0-0',
                '@ezclassify/schemas': '^1.0.0-0',
            },
        },
        '@ezclassify/types': {},
        '@ezclassify/schemas': {
            dependencies: { '@ezclassify/types': '^1.0.0-0' },
        },
    };
    const getManifest = (name: string) => manifests[name] ?? null;

    const packages = [
        {
            manifest: {
                name: '@ezclassify/ui',
                peerDependencies: {
                    '@ezclassify/engine': '^1.0.0-0',
                    '@ezclassify/types': '^1.0.0-0',
                },
            },
        },
        {
            manifest: {
                name: '@ezclassify/react',
                peerDependencies: {
                    'react': '>=17.0.0',
                    '@ezclassify/engine': '^1.0.0-0',
                    '@ezclassify/ui': '^1.0.0-0',
                },
            },
        },
    ];
    const localNames = new Set(['@ezclassify/ui', '@ezclassify/react']);

    it('closes over scoped deps of resolved peers and excludes local + unscoped names', () => {
        const { found, missing } = collectExternalScopedPeers({
            packages,
            localNames,
            scope: '@ezclassify/',
            getManifest,
        });
        // schemas arrives only transitively through engine's dependencies.
        expect(found).toEqual([
            '@ezclassify/engine',
            '@ezclassify/schemas',
            '@ezclassify/types',
        ]);
        expect(missing).toEqual([]);
    });

    it('picks up extraSeeds no manifest declares and closes over them', () => {
        // The engine is imported by the shipped bundles but is deliberately not
        // a declared peer of anything, so only the seed can find it.
        const undeclared = [
            {
                manifest: {
                    name: '@ezclassify/ui',
                    peerDependencies: { '@ezclassify/types': '^1.0.0-0' },
                },
            },
        ];
        const { found, missing } = collectExternalScopedPeers({
            packages: undeclared,
            localNames: new Set(['@ezclassify/ui']),
            scope: '@ezclassify/',
            getManifest,
            extraSeeds: ['@ezclassify/engine', 'lodash'],
        });
        // schemas is reachable only through the seeded engine's dependencies.
        expect(found).toEqual([
            '@ezclassify/engine',
            '@ezclassify/schemas',
            '@ezclassify/types',
        ]);
        expect(missing).toEqual([]);
    });

    it('reports unresolvable peers instead of dropping them', () => {
        const { found, missing } = collectExternalScopedPeers({
            packages,
            localNames,
            scope: '@ezclassify/',
            getManifest: (name: string) =>
                name === '@ezclassify/engine' ? null : getManifest(name),
        });
        expect(missing).toEqual(['@ezclassify/engine']);
        expect(found).toEqual(['@ezclassify/types']);
    });

    it('terminates on dependency cycles', () => {
        const cyclic: typeof manifests = {
            '@ezclassify/a': { dependencies: { '@ezclassify/b': '1' } },
            '@ezclassify/b': { peerDependencies: { '@ezclassify/a': '1' } },
        };
        const { found } = collectExternalScopedPeers({
            packages: [
                {
                    manifest: {
                        name: 'x',
                        peerDependencies: { '@ezclassify/a': '1' },
                    },
                },
            ],
            localNames: new Set<string>(),
            scope: '@ezclassify/',
            getManifest: (name: string) => cyclic[name] ?? null,
        });
        expect(found).toEqual(['@ezclassify/a', '@ezclassify/b']);
    });
});
