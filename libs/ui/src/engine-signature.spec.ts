import { describe, expect, it } from 'vitest';
import type {
    ContextAdapter,
    ContextSchemeEngineAdapter,
} from '@ezclassify/types';
import { contextSignature, sameSignature } from './engine-signature';

describe('contextSignature', () => {
    it('signs a Context by its views and identity, not its wrapper', () => {
        const scheme = {
            process: () => undefined,
        } as unknown as ContextSchemeEngineAdapter;
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

    it('reports a missing Context as its own signature', () => {
        expect(contextSignature(null)).toEqual([null]);
    });
});

describe('Context resolution identity in UI signatures', () => {
    it('refreshes for a new concrete version while preserving alias-only identity', () => {
        const scheme = {
            process: () => undefined,
        } as unknown as ContextSchemeEngineAdapter;
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
