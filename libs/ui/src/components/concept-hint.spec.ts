import { describe, expect, it } from 'vitest';
import { conceptHint, conceptHintName } from './concept-hint';

describe('native concept hints', () => {
    it('names configured views without exposing value templates and falls back to name or id', () => {
        const concept = {
            id: 'one',
            name: 'Full name',
            views: { alt: 'Alternate' },
        };
        expect(conceptHintName(concept, 'alt')).toBe('Alternate');
        expect(conceptHintName(concept, 'missing')).toBe('Full name');
        expect(conceptHintName({ ...concept, name: '' }, 'missing')).toBe(
            'one',
        );
        expect(conceptHintName({ ...concept, textInput: {} }, 'alt')).toBe(
            'Full name',
        );
        expect(conceptHintName(concept)).toBe('Full name');
    });

    it('matches the flow name, definition and optional explanation contract', () => {
        expect(
            conceptHint(
                'Category',
                'Full name',
                'Definition',
                'Why it is present',
            ),
        ).toEqual({
            title: 'Category: Full name\nDefinition\nWhy it is present',
            description: 'Category: Full name. Definition. Why it is present.',
        });
        expect(conceptHint('Category', 'Same', 'Definition.')).toEqual({
            title: 'Category: Same\nDefinition.',
            description: 'Category: Same. Definition.',
        });
        expect(conceptHint('Category', 'Same', '')).toEqual({
            title: 'Category: Same',
            description: 'Category: Same.',
        });
    });
});
