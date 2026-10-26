import { describe, it, expect, vi } from 'vitest';
import { Context } from '@ezclassify/engine';
import type { Assertion } from '@ezclassify/types';
import { SingleSelect } from './single-select';

function makeEngine(withTextInput = false, calendarValue = false): Context {
    return Context.fromComponents({
        scheme: {
            scheme: {
                id: 'test-select',
                version: '1.0.0',
                name: 'Test Select',
                description: '',
                data: {
                    categories: [
                        {
                            id: 'level',
                            label: 'Level',
                            required: false,
                            single: true,
                            rollup: 'max',
                            position: 0,
                            hierarchy_root: true,
                        },
                    ],
                    concepts: {
                        inline: [
                            {
                                id: 'level-1',
                                name: 'Level 1',
                                views: { default: 'L1' },
                                definition:
                                    'Choose this level for the first tier.',
                                aliases: [],
                                categories: ['level'],
                                parents: [],
                                position: 1,
                                rank: 0,
                            },
                            {
                                id: 'level-2',
                                name: 'Level 2',
                                views: { default: 'L2' },
                                aliases: [],
                                categories: ['level'],
                                parents: [],
                                position: 2,
                                rank: 1,
                            },
                            {
                                id: 'level-3',
                                name: 'Level 3',
                                views: {
                                    default: calendarValue ? '{value}' : 'L3',
                                },
                                ...(withTextInput
                                    ? {
                                          text_input: {
                                              encoding: calendarValue
                                                  ? {
                                                        type: 'calendar-date',
                                                        canonical: 'YYYY-MM-DD',
                                                        accepts: [
                                                            'YYYYMMDD',
                                                            'YYYY-MM-DD',
                                                        ],
                                                        views: {
                                                            default: 'YYYYMMDD',
                                                        },
                                                    }
                                                  : {
                                                        type: 'text',
                                                        pattern: '\\d{8}',
                                                    },
                                              placeholder: 'YYYYMMDD',
                                              label: 'Review date',
                                              required: true,
                                          },
                                      }
                                    : {}),
                                aliases: [],
                                categories: ['level'],
                                parents: [],
                                position: 3,
                                rank: 2,
                            },
                        ],
                    },
                },
                rules: [],
                rollup_pipelines: [],
                parse: {
                    case_sensitive: false,
                    strip_whitespace: true,
                },
                render: {
                    default: 'default',
                    formats: [
                        {
                            id: 'default',
                            surface: 'marking',
                            mode: 'inline',
                            separator: '//',
                            fields: [{ category: 'level', separator: '//' }],
                        },
                    ],
                },
            },
        },
    });
}

describe('authoritative primary field errors', () => {
    it('shows a real invalid calendar value and clears the error after correction', async () => {
        const context = makeEngine(true, true);
        const raw: Assertion = {
            conceptId: 'level-3',
            categoryId: 'level',
            value: '20350930',
            source: 'user',
            confidence: 'certain',
        };
        const bad = await context.scheme!.process([
            { ...raw, value: '20350231' },
        ]);
        expect(bad.valid).toBe(false);
        expect(bad.errors).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    constraintId: '_invalid_assertion_value',
                }),
            ]),
        );
        const target = document.createElement('div');
        document.body.append(target);
        const component = new SingleSelect();
        await component.init(target, context);
        component.setAssertions([raw]);
        const input = target.querySelector<HTMLInputElement>(
            '.select-card-text-field',
        )!;
        input.value = '20350231';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        await vi.waitFor(() =>
            expect(component.getAssertions()).toEqual(bad.assertions),
        );
        expect(target.hasAttribute('data-ezclassify-invalid')).toBe(true);
        expect(target.nextElementSibling?.classList).toContain(
            'ez-validation-errors',
        );
        expect(target.hasAttribute('data-ezclassify-warning')).toBe(false);
        expect(
            [
                ...target.nextElementSibling!.querySelectorAll(
                    '.ez-validation-errors__message',
                ),
            ].map((el) => el.textContent),
        ).toEqual(bad.errors.map((error) => error.message));
        const draft = target.querySelector<HTMLInputElement>(
            '.select-card-text-field',
        )!;
        expect(draft.value).toBe('20350231');
        draft.value = '20351231';
        draft.dispatchEvent(new Event('input', { bubbles: true }));
        await vi.waitFor(() =>
            expect(component.getAssertions()[0]?.value).toBe('2035-12-31'),
        );
        expect(target.hasAttribute('data-ezclassify-invalid')).toBe(false);
        expect([
            ...target.nextElementSibling!.querySelectorAll(
                '.ez-validation-errors__message',
            ),
        ]).toEqual([]);
        component.destroy();
        target.remove();
    });

    it('shows the real canonical partial-recognition error without inventing a rule message', async () => {
        const context = makeEngine();
        const reading = await context.scheme!.process('L1 extra');
        expect(reading.inputWasValid).toBe(false);
        expect(reading.recognition?.status).toBe('partial');
        expect(reading.errors).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    constraintId: '_recognition_incomplete',
                }),
            ]),
        );
        const target = document.createElement('div');
        document.body.append(target);
        const component = new SingleSelect();
        await component.init(target, context);
        await component.setValue('L1 extra');
        expect(target.hasAttribute('data-ezclassify-invalid')).toBe(true);
        expect(target.nextElementSibling?.classList).toContain(
            'ez-validation-errors',
        );
        expect(
            [
                ...target.nextElementSibling!.querySelectorAll(
                    '.ez-validation-errors__message',
                ),
            ].map((el) => el.textContent),
        ).toEqual(reading.errors.map((error) => error.message));
        expect(component.getAssertions()).toEqual(reading.assertions);
        component.destroy();
        target.remove();
    });
});
