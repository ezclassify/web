import { describe, expect, it } from 'vitest';
import {
    factsInScopes,
    inDeclarationOrder,
    parseScopeList,
    scopeLabel,
    scopesOfCategory,
} from './scopes';

const meta = {
    scopes: [
        { id: 'marking', label: 'Marking' },
        { id: 'record', label: 'Record Block' },
    ],
    defaultScope: 'marking',
};

describe('scope lists', () => {
    it('reads a space-separated list of scope ids, each once', () => {
        expect(parseScopeList('  record\tmarking record ')).toEqual([
            'record',
            'marking',
        ]);
        expect(parseScopeList('')).toEqual([]);
        expect(parseScopeList(null)).toEqual([]);
    });

    it('orders scope ids the way the scheme declares them', () => {
        expect(
            inDeclarationOrder(['record', 'other', 'marking'], meta),
        ).toEqual(['marking', 'record', 'other']);
    });

    it("names a scope by the scheme's label", () => {
        expect(scopeLabel('record', meta)).toBe('Record Block');
        expect(scopeLabel('other', meta)).toBe('other');
    });
});

describe('scope membership', () => {
    const categories = [{ id: 'level' }, { id: 'signer', scopes: ['record'] }];

    it('places a category that declares no scope in the default scope', () => {
        expect(scopesOfCategory(categories[0], meta)).toEqual(['marking']);
        expect(scopesOfCategory(categories[1], meta)).toEqual(['record']);
        expect(scopesOfCategory(categories[0], {})).toEqual([]);
    });

    it('keeps the facts of the named scopes only', () => {
        const facts = [
            { categoryId: 'level', conceptId: 'HIGH' },
            { categoryId: 'signer', conceptId: 'SIGNED' },
            { categoryId: 'unknown', conceptId: 'X' },
        ];
        expect(factsInScopes(facts, categories, ['record'], meta)).toEqual([
            facts[1],
        ]);
        expect(
            factsInScopes(facts, categories, ['marking', 'record'], meta),
        ).toEqual([facts[0], facts[1]]);
    });
});
