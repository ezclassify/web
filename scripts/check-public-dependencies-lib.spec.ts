import { describe, expect, it } from 'vitest';

import {
    PUBLIC_SCOPED_PACKAGES,
    expandWorkspaces,
    privateDependenciesOf,
} from './check-public-dependencies-lib.mjs';

describe('privateDependenciesOf', () => {
    it('accepts a manifest with no scoped dependencies at all', () => {
        expect(
            privateDependenciesOf({ dependencies: { vitest: '^4.0.0' } }),
        ).toEqual([]);
    });

    it('accepts the scoped packages that ship from the public repositories', () => {
        const manifest = {
            dependencies: { '@ezclassify/rest-client': '^1.0.0-0' },
            devDependencies: { '@ezclassify/conformance-server': '^1.0.0-0' },
            peerDependencies: { '@ezclassify/types': '^1.0.0-0' },
        };
        expect(privateDependenciesOf(manifest)).toEqual([]);
    });

    it('rejects the engine wherever it is declared', () => {
        for (const field of [
            'dependencies',
            'devDependencies',
            'peerDependencies',
            'optionalDependencies',
        ]) {
            const manifest = { [field]: { '@ezclassify/engine': '^1.0.0-0' } };
            expect(privateDependenciesOf(manifest)).toEqual([
                `${field}:@ezclassify/engine`,
            ]);
        }
    });

    it('rejects an unknown scoped package rather than assuming it is public', () => {
        expect(
            privateDependenciesOf({
                dependencies: { '@ezclassify/not-invented-yet': '^1.0.0' },
            }),
        ).toEqual(['dependencies:@ezclassify/not-invented-yet']);
    });

    it('accepts a package this repository publishes itself', () => {
        const manifest = { dependencies: { '@ezclassify/ui': '^1.0.0-0' } };
        expect(
            privateDependenciesOf(manifest, new Set(['@ezclassify/ui'])),
        ).toEqual([]);
    });

    it('reports every offending declaration, not just the first', () => {
        const manifest = {
            devDependencies: {
                '@ezclassify/engine': '^1.0.0-0',
                '@ezclassify/example-schemes': '^1.0.0-0',
                '@ezclassify/types': '^1.0.0-0',
            },
        };
        expect(privateDependenciesOf(manifest).sort()).toEqual([
            'devDependencies:@ezclassify/engine',
            'devDependencies:@ezclassify/example-schemes',
        ]);
    });

    it('survives a manifest with no dependency fields', () => {
        expect(privateDependenciesOf({})).toEqual([]);
        expect(privateDependenciesOf(undefined)).toEqual([]);
    });

    it('does not list the engine as publicly installable', () => {
        expect(PUBLIC_SCOPED_PACKAGES.has('@ezclassify/engine')).toBe(false);
        expect(PUBLIC_SCOPED_PACKAGES.has('@ezclassify/example-schemes')).toBe(
            false,
        );
        expect(PUBLIC_SCOPED_PACKAGES.has('@ezclassify/testing-utils')).toBe(
            false,
        );
    });
});

describe('expandWorkspaces', () => {
    const listDir = (parent: string) =>
        ({ libs: ['ui', 'ui-tools'], integrations: ['react'] })[parent] ?? [];

    it('passes an explicit directory through untouched', () => {
        expect(expandWorkspaces(['libs/ui'], listDir)).toEqual(['libs/ui']);
    });

    it('expands a trailing star to the directories it names', () => {
        expect(expandWorkspaces(['libs/*'], listDir)).toEqual([
            'libs/ui',
            'libs/ui-tools',
        ]);
    });

    it('handles a mix of both forms', () => {
        expect(
            expandWorkspaces(['libs/ui', 'integrations/*'], listDir),
        ).toEqual(['libs/ui', 'integrations/react']);
    });

    it('treats a missing workspaces field as no workspaces', () => {
        expect(expandWorkspaces(undefined, listDir)).toEqual([]);
    });
});
