import { describe, expect, it } from 'vitest';
import type { ContextAdapter, SchemeEngineAdapter } from '@ezclassify/types';
import { contextSignature, sameSignature } from './engine-signature';

describe('contextSignature', () => {
    it('unwraps any composed context, whoever built it', () => {
        // The discrimination is structural: an object exposing the composed
        // surface qualifies whether it came from an in-process engine, an HTTP
        // client, or a host's own implementation. No brand to set, nothing to
        // register, and no dependency on the package that minted it.
        const scheme = {
            process: () => undefined,
        } as unknown as SchemeEngineAdapter;
        const context = {
            scheme,
            guide: undefined,
            access: undefined,
            audit: () => undefined,
            metadata: {
                id: 'composed',
                requestedVersion: '1',
                resolvedVersion: '1',
            },
        } as unknown as ContextAdapter;

        expect(contextSignature(context)).toEqual([
            scheme,
            undefined,
            undefined,
            'composed',
            '1',
        ]);
    });

    it('does not unwrap a scheme adapter that merely has a scheme property', () => {
        const adapter = {
            scheme: {},
            getResolution: () => undefined,
        } as unknown as SchemeEngineAdapter;

        expect(contextSignature(adapter)).toEqual([adapter]);
    });

    it('reports a null engine as its own signature', () => {
        expect(contextSignature(null)).toEqual([null]);
    });
});

describe('Context resolution identity in UI signatures', () => {
    it('refreshes for a new concrete version while preserving alias-only identity', () => {
        const scheme = {
            process: () => undefined,
        } as unknown as SchemeEngineAdapter;
        const context = {
            scheme,
            audit: () => undefined,
            metadata: {
                id: 'bound',
                requestedVersion: 'latest',
                resolvedVersion: '1.0.0',
            },
        } as unknown as ContextAdapter;
        const pinned = {
            ...context,
            metadata: {
                id: 'bound',
                requestedVersion: '1.0.0',
                resolvedVersion: '1.0.0',
            },
        };
        const next = {
            ...context,
            metadata: {
                id: 'bound',
                requestedVersion: 'latest',
                resolvedVersion: '2.0.0',
            },
        };
        expect(
            sameSignature(contextSignature(context), contextSignature(pinned)),
        ).toBe(true);
        expect(
            sameSignature(contextSignature(context), contextSignature(next)),
        ).toBe(false);
    });
});
