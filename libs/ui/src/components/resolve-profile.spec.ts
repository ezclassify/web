/**
 * @vitest-environment jsdom
 *
 * resolveProfile helper.
 *
 * Verifies the attribute → option → engine-default → throw resolution order
 * for adapters with or without optional multi-scheme introspection.
 */

import { describe, it, expect } from 'vitest';
import { resolveProfile } from './component-base-readonly';

function makeMultiProfileEngine(loaded: string[], defaultId: string | null) {
    return {
        loadScheme: () => {},
        listSchemes: () =>
            loaded.map((id) => ({
                id,
                name: id,
                version: '1.0.0',
                isDefault: id === defaultId,
            })),
        getDefaultScheme: () =>
            defaultId
                ? {
                      id: defaultId,
                      name: defaultId,
                      version: '1.0.0',
                      isDefault: true,
                  }
                : null,
        getScheme: (id?: string) => ({ id: id ?? defaultId ?? loaded[0] }),
    } as any;
}

describe('resolveProfile', () => {
    it('reads ezclassify-scheme attribute on the container', () => {
        const container = document.createElement('div');
        container.setAttribute('data-ezclassify-scheme', 'attr-id');
        const engine = makeMultiProfileEngine(['alpha', 'beta'], 'alpha');
        expect(resolveProfile(container, engine)).toBe('attr-id');
    });

    it('reads ezclassify-scheme from the closest ancestor', () => {
        const wrap = document.createElement('div');
        wrap.setAttribute('data-ezclassify-scheme', 'ancestor-id');
        const container = document.createElement('div');
        wrap.appendChild(container);
        const engine = makeMultiProfileEngine(['alpha', 'beta'], 'alpha');
        expect(resolveProfile(container, engine)).toBe('ancestor-id');
    });

    it('falls through to options.schemeId when no attribute is present', () => {
        const container = document.createElement('div');
        const engine = makeMultiProfileEngine(['alpha', 'beta'], 'alpha');
        expect(resolveProfile(container, engine, { schemeId: 'opt-id' })).toBe(
            'opt-id',
        );
    });

    it('falls through to engine.getDefaultScheme() when neither attribute nor option is set', () => {
        const container = document.createElement('div');
        const engine = makeMultiProfileEngine(['alpha', 'beta'], 'beta');
        expect(resolveProfile(container, engine)).toBe('beta');
    });

    it('throws when the engine has schemes loaded but no default set and no attribute/option', () => {
        const container = document.createElement('div');
        const engine = makeMultiProfileEngine(['alpha', 'beta'], null);
        expect(() => resolveProfile(container, engine)).toThrow(
            /multiple schemes loaded/,
        );
    });

    it('returns the lone loaded scheme when the default slot is empty but only one is loaded', () => {
        const container = document.createElement('div');
        const engine = makeMultiProfileEngine(['only'], null);
        expect(resolveProfile(container, engine)).toBe('only');
    });

    it('throws when the engine has no schemes loaded at all', () => {
        const container = document.createElement('div');
        const engine = makeMultiProfileEngine([], null);
        expect(() => resolveProfile(container, engine)).toThrow(
            /no schemes loaded/,
        );
    });

    it('uses the required getScheme method when optional introspection is absent', () => {
        const container = document.createElement('div');
        const engine = {
            loadScheme: () => {},
            getScheme: () => ({ id: 'only' }),
        } as any;
        expect(resolveProfile(container, engine)).toBe('only');
    });

    it('rejects a pre-contract adapter without getScheme at mount time', () => {
        const container = document.createElement('div');
        const engine = {
            getSchemeMeta: () => ({ id: 'old', version: '1.0', name: 'old' }),
        } as any;
        expect(() => resolveProfile(container, engine)).toThrow(/getScheme/);
    });

    it('attribute takes precedence over option', () => {
        const container = document.createElement('div');
        container.setAttribute('data-ezclassify-scheme', 'attr');
        const engine = makeMultiProfileEngine(['attr', 'opt'], 'opt');
        expect(resolveProfile(container, engine, { schemeId: 'opt' })).toBe(
            'attr',
        );
    });

    it('option takes precedence over default slot', () => {
        const container = document.createElement('div');
        const engine = makeMultiProfileEngine(['alpha', 'beta'], 'alpha');
        expect(resolveProfile(container, engine, { schemeId: 'beta' })).toBe(
            'beta',
        );
    });

    it('uses the primary scheme without an addressed selector for a Context-bound adapter', () => {
        const container = document.createElement('div');
        const engine = makeMultiProfileEngine(['alpha', 'beta'], 'alpha');

        expect(resolveProfile(container, engine, undefined, false)).toBe(
            'alpha',
        );
    });

    it('rejects a secondary scheme selector for a Context-bound adapter', () => {
        const container = document.createElement('div');
        container.setAttribute('data-ezclassify-scheme', 'beta');
        const engine = makeMultiProfileEngine(['alpha', 'beta'], 'alpha');

        expect(() =>
            resolveProfile(container, engine, undefined, false),
        ).toThrow(/Context-bound scheme operations target 'alpha'/);
    });
});
