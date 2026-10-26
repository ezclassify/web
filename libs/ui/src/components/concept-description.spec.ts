import { describe, it, expect, vi } from 'vitest';
import {
    resolveConceptDescription,
    type ConceptDescriptionEngine,
} from './concept-description';
import type { ConceptDescription } from '@ezclassify/types';

/**
 * Stand in for a host-supplied adapter with only the members a case exercises.
 *
 * `resolveConceptDescription` reads `describeConcept` and probes for
 * `loadScheme`; building a whole adapter for each case would say nothing about
 * the resolution it is testing.
 */
function fakeEngine(members: object): ConceptDescriptionEngine {
    return members as ConceptDescriptionEngine;
}

function desc(...lines: string[]): ConceptDescription {
    return { lines } as ConceptDescription;
}

describe('resolveConceptDescription', () => {
    it('returns the cached value without calling the engine', () => {
        const describeConcept = vi.fn();
        const cache = new Map([['S:level', 'SECRET\nDescription: cached']]);
        const result = resolveConceptDescription('S', 'level', {
            engine: fakeEngine({ describeConcept }),
            cache,
        });
        expect(result).toBe('SECRET\nDescription: cached');
        expect(describeConcept).not.toHaveBeenCalled();
    });

    it('uses the single-profile call shape when the engine has no listSchemes', () => {
        const describeConcept = vi.fn(() => desc('SECRET'));
        const result = resolveConceptDescription('S', 'level', {
            engine: fakeEngine({ describeConcept }),
            cache: new Map(),
        });
        expect(result).toBe('SECRET');
        expect(describeConcept).toHaveBeenCalledWith('S', 'level', undefined);
    });

    it('uses the addressed call shape only when the engine supports composition lifecycle', () => {
        const describeConcept = vi.fn(() => desc('SECRET'));
        const result = resolveConceptDescription('S', 'level', {
            engine: fakeEngine({
                describeConcept,
                listSchemes: () => [],
                loadScheme: vi.fn(),
            }),
            schemeId: 'us-gov-capco',
            schemeAddressing: true,
            cache: new Map(),
        });
        expect(result).toBe('SECRET');
        expect(describeConcept).toHaveBeenCalledWith(
            'S',
            'level',
            'us-gov-capco',
            undefined,
        );
    });

    it('passes tooltipConceptProperty through as the view option', () => {
        const describeConcept = vi.fn(() => desc('SECRET'));
        resolveConceptDescription('S', 'level', {
            engine: fakeEngine({ describeConcept }),
            tooltipConceptProperty: 'bannerAbbreviation',
            cache: new Map(),
        });
        expect(describeConcept).toHaveBeenCalledWith('S', 'level', {
            view: 'bannerAbbreviation',
        });
    });

    it('caches a synchronous result joined by newline', () => {
        const cache = new Map<string, string>();
        const result = resolveConceptDescription('S', 'level', {
            engine: fakeEngine({
                describeConcept: () =>
                    desc('SECRET', '', 'Description: very sensitive'),
            }),
            cache,
        });
        expect(result).toBe('SECRET\n\nDescription: very sensitive');
        expect(cache.get('S:level')).toBe(result);
    });

    it('returns undefined for an in-flight async result and caches it once resolved', async () => {
        const cache = new Map<string, string>();
        let resolvePromise!: (d: ConceptDescription) => void;
        const pending = new Promise<ConceptDescription>((resolve) => {
            resolvePromise = resolve;
        });
        const result = resolveConceptDescription('S', 'level', {
            engine: fakeEngine({ describeConcept: () => pending }),
            cache,
        });
        expect(result).toBeUndefined();
        expect(cache.has('S:level')).toBe(false);

        resolvePromise(desc('SECRET'));
        await pending;
        // Flush the .then() microtask queued inside resolveConceptDescription.
        await Promise.resolve();
        expect(cache.get('S:level')).toBe('SECRET');
    });

    it('swallows a rejected async describeConcept instead of throwing', async () => {
        const cache = new Map<string, string>();
        const result = resolveConceptDescription('S', 'level', {
            engine: fakeEngine({
                describeConcept: () => Promise.reject(new Error('boom')),
            }),
            cache,
        });
        expect(result).toBeUndefined();
        // Let the rejection's .catch() run; a missing catch would surface as
        // an unhandled rejection and fail the test run.
        await new Promise((r) => setTimeout(r, 0));
        expect(cache.has('S:level')).toBe(false);
    });

    it('does not re-issue describeConcept right after a failure', async () => {
        // Regression test: a rejection left no trace, so the next poll tick saw
        // neither a cached value nor a pending entry and asked again. One hover
        // against a failing remote spent its whole ten-attempt budget, and every
        // later hover did it again.
        const cache = new Map<string, string>();
        const describeConcept = vi.fn(() =>
            Promise.reject(new Error('gateway timeout')),
        );

        resolveConceptDescription('S', 'level', {
            engine: fakeEngine({ describeConcept }),
            cache,
        });
        await new Promise((r) => setTimeout(r, 0));
        for (let i = 0; i < 5; i++) {
            expect(
                resolveConceptDescription('S', 'level', {
                    engine: fakeEngine({ describeConcept }),
                    cache,
                }),
            ).toBeUndefined();
        }

        expect(describeConcept).toHaveBeenCalledTimes(1);
    });

    it('does not re-issue describeConcept for a concept already in flight', async () => {
        // Regression test: attachTooltip's hover/long-press poll and the
        // dropdown's active-row aria-describedby sync poll both call
        // resolveConceptDescription repeatedly (up to ~10x at 200ms) while
        // waiting on a remote engine, and a segment tooltip multiplies that
        // further per assertion. Without in-flight dedup, one hover issued a
        // fresh network call on every poll tick.
        const cache = new Map<string, string>();
        let resolvePromise!: (d: ConceptDescription) => void;
        const pending = new Promise<ConceptDescription>((resolve) => {
            resolvePromise = resolve;
        });
        const describeConcept = vi.fn(() => pending);

        for (let i = 0; i < 5; i++) {
            const result = resolveConceptDescription('S', 'level', {
                engine: fakeEngine({ describeConcept }),
                cache,
            });
            expect(result).toBeUndefined();
        }
        expect(describeConcept).toHaveBeenCalledTimes(1);

        resolvePromise(desc('SECRET'));
        await pending;
        await Promise.resolve();

        // Once resolved, further calls read the cache; still exactly one call.
        expect(
            resolveConceptDescription('S', 'level', {
                engine: fakeEngine({ describeConcept }),
                cache,
            }),
        ).toBe('SECRET');
        expect(describeConcept).toHaveBeenCalledTimes(1);
    });

    it('caches an empty-string result instead of treating it as a miss', () => {
        // Regression test: `if (cached) return cached` treated a concept whose
        // description resolves to '' (no documentation authored) as an
        // unresolved cache miss, so it was re-fetched on every single call and
        // its (correctly empty) tooltip content never stabilized.
        const cache = new Map<string, string>();
        const describeConcept = vi.fn(() => desc());

        expect(
            resolveConceptDescription('S', 'level', {
                engine: fakeEngine({ describeConcept }),
                cache,
            }),
        ).toBe('');
        expect(
            resolveConceptDescription('S', 'level', {
                engine: fakeEngine({ describeConcept }),
                cache,
            }),
        ).toBe('');
        expect(describeConcept).toHaveBeenCalledTimes(1);
        expect(cache.has('S:level')).toBe(true);
    });

    it('refuses an engine without describeConcept', () => {
        expect(() =>
            resolveConceptDescription('S', 'level', {
                engine: fakeEngine({}),
                cache: new Map(),
            }),
        ).toThrow(/requires engine\.describeConcept\(\)/);
    });
});

it('cools down a synchronous unknown-concept refusal just like a rejected promise', () => {
    const describeConcept = vi.fn(() => {
        throw new Error('unknown concept');
    });
    const source = {
        engine: fakeEngine({ describeConcept }),
        cache: new Map<string, string>(),
    };
    expect(
        resolveConceptDescription('missing', 'category', source),
    ).toBeUndefined();
    expect(
        resolveConceptDescription('missing', 'category', source),
    ).toBeUndefined();
    expect(describeConcept).toHaveBeenCalledTimes(1);
    expect(source.cache.size).toBe(0);
});
