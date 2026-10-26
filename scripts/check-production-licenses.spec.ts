import { describe, expect, it } from 'vitest';
import {
    assertLicenseCoverage,
    productionLicensePackages,
} from './check-production-licenses.mjs';

const workspaces = [
    {
        name: '@ezclassify/ui',
        version: '1.0.0',
        dependencies: { '@ezclassify/types': '^1' },
    },
    {
        name: '@ezclassify/react',
        version: '1.0.0',
        peerDependencies: { react: '>=18' },
    },
];
const graph = () => ({
    dependencies: {
        '@ezclassify/ui': {
            version: '1.0.0',
            dependencies: { '@ezclassify/types': { version: '1.0.0' } },
        },
        '@ezclassify/react': { version: '1.0.0' },
    },
});

describe('production license graph coverage', () => {
    it('accepts a verified empty third-party closure without pulling in consumer peers', () => {
        expect(productionLicensePackages(graph(), workspaces)).toEqual([]);
    });

    it('checks direct and transitive third parties, including beneath first-party packages', () => {
        const tree = graph();
        Object.assign(
            tree.dependencies['@ezclassify/ui'].dependencies[
                '@ezclassify/types'
            ],
            {
                dependencies: {
                    external: {
                        version: '2.0.0',
                        dependencies: { nested: { version: '3.0.0' } },
                    },
                },
            },
        );
        expect(productionLicensePackages(tree, workspaces)).toEqual([
            'external@2.0.0',
            'nested@3.0.0',
        ]);
    });

    it('does not count unrelated extraneous roots but follows deduplicated production edges', () => {
        const tree = graph();
        Object.assign(tree, { problems: ['extraneous: unrelated@1.0.0'] });
        Object.assign(tree.dependencies, {
            unrelated: {
                version: '1.0.0',
                extraneous: true,
                dependencies: {
                    '@ezclassify/types': {
                        version: '1.0.0',
                        dependencies: { external: { version: '2.0.0' } },
                    },
                },
            },
        });
        expect(productionLicensePackages(tree, workspaces, 1)).toEqual([
            'external@2.0.0',
        ]);
    });

    it('refuses a missing workspace rather than declaring the remaining graph empty', () => {
        const tree = graph();
        Reflect.deleteProperty(tree.dependencies, '@ezclassify/react');
        expect(() => productionLicensePackages(tree, workspaces)).toThrow(
            'workspace was not inspected',
        );
    });

    it('refuses a missing declared production edge', () => {
        const tree = graph();
        Reflect.deleteProperty(
            tree.dependencies['@ezclassify/ui'].dependencies,
            '@ezclassify/types',
        );
        expect(() => productionLicensePackages(tree, workspaces)).toThrow(
            'Missing production edge',
        );
    });

    it.each([{}, null, { dependencies: [] }, { dependencies: {} }])(
        'refuses malformed or empty graph output: %j',
        (tree) => {
            expect(() => productionLicensePackages(tree, workspaces)).toThrow();
        },
    );

    it('does not treat missing/invalid packages or unexplained npm errors as advisory', () => {
        for (const flag of ['missing', 'invalid']) {
            const tree = graph();
            Object.assign(
                tree.dependencies['@ezclassify/ui'].dependencies[
                    '@ezclassify/types'
                ],
                { [flag]: true },
            );
            expect(() => productionLicensePackages(tree, workspaces)).toThrow(
                'Missing or invalid',
            );
        }
        expect(() =>
            productionLicensePackages(
                { ...graph(), problems: ['missing: external@1'] },
                workspaces,
                1,
            ),
        ).toThrow('incomplete');
        expect(() => productionLicensePackages(graph(), workspaces, 1)).toThrow(
            'without an explained',
        );
        expect(() => productionLicensePackages(graph(), workspaces, 2)).toThrow(
            'could not inspect',
        );
    });
});

describe('license checker result coverage', () => {
    it('requires every nonempty requested identity, even when the checker reports success', () => {
        expect(() => assertLicenseCoverage(['external@1'], {})).toThrow(
            'no entry',
        );
        expect(() =>
            assertLicenseCoverage(['external@1'], { 'external@1': {} }),
        ).toThrow('no entry');
        expect(() => assertLicenseCoverage(['external@1'], null)).toThrow(
            'Malformed',
        );
        expect(() =>
            assertLicenseCoverage(['external@1'], {
                'external@1': { licenses: 'MIT' },
            }),
        ).not.toThrow();
    });
});
