import { describe, it, expect } from 'vitest';
import type { Assertion } from '@ezclassify/types';
import { addUserAssertion } from './assertion-addition';

const scheme = {
    categories: [
        { id: 'level', single: true },
        { id: 'tags', single: false },
    ],
} as never;

function a(
    conceptId: string,
    categoryId: string,
    confidence: Assertion['confidence'] = 'certain',
): Assertion {
    return {
        conceptId,
        categoryId,
        confidence,
        source: confidence === 'inferred' ? 'engine' : 'user',
    };
}

describe('addUserAssertion', () => {
    it('replaces the concept a single-select category already holds', () => {
        expect(
            addUserAssertion(
                [a('LOW', 'level'), a('X', 'tags')],
                { conceptId: 'HIGH', categoryId: 'level' },
                scheme,
            ),
        ).toEqual([a('X', 'tags'), a('HIGH', 'level')]);
    });

    it('adds beside the concepts a multi-select category holds', () => {
        expect(
            addUserAssertion(
                [a('X', 'tags')],
                { conceptId: 'Y', categoryId: 'tags' },
                scheme,
            ),
        ).toEqual([a('X', 'tags'), a('Y', 'tags')]);
    });

    it("confirms an inferred concept as the user's own choice instead of duplicating it", () => {
        expect(
            addUserAssertion(
                [a('Y', 'tags', 'inferred')],
                { conceptId: 'Y', categoryId: 'tags' },
                scheme,
            ),
        ).toEqual([a('Y', 'tags')]);
    });
});
