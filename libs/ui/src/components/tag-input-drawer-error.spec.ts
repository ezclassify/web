import { beforeEach, describe, expect, it } from 'vitest';
import { TagInput } from './tag-input';
import { Context } from '@ezclassify/engine';

/**
 * The star drawer must not hang over the validation error below the field,
 * hiding the message exactly while the user is fixing it. A visible error
 * counts as bottom-edge-occupied, the same contract the open dropdown uses, so
 * the drawer flips to the top edge until the error clears.
 */
const scheme = {
    scheme: {
        id: 'drawer-error-test',
        version: '1.0.0',
        name: 'Drawer error test',
        data: {
            categories: [
                {
                    id: 'tier',
                    label: 'Sensitivity tier',
                    required: true,
                    single: true,
                    rollup: 'max',
                },
                {
                    id: 'caveat',
                    label: 'Caveats',
                    required: false,
                    single: false,
                    rollup: 'union',
                },
            ],
            concepts: {
                inline: [
                    {
                        id: 'INTERNAL',
                        name: 'Internal',
                        views: { default: 'INTERNAL' },
                        categories: ['tier'],
                        rank: 0,
                    },
                    {
                        id: 'NTK',
                        name: 'Need to know',
                        views: { default: 'NEED TO KNOW' },
                        categories: ['caveat'],
                    },
                ],
            },
        },
        rules: [],
        parse: {
            normalize: [],
        },
        render: {
            default: 'default',
            formats: [
                {
                    id: 'default',
                    surface: 'marking',
                    mode: 'inline',
                    separator: '//',
                    fields: [
                        { category: 'tier' },
                        { category: 'caveat', separator: '/' },
                    ],
                },
            ],
        },
    },
};

describe('TagInput drawer vs validation errors', () => {
    let host: HTMLInputElement;
    let component: TagInput;

    beforeEach(() => {
        document.body.innerHTML = '';
        host = document.createElement('input');
        document.body.appendChild(host);
        component = new TagInput();
    });

    it('flips the drawer to the top edge while an error is visible and back when it clears', async () => {
        await component.init(host, Context.fromComponents({ scheme }));

        // A caveat with no tier: the required-category constraint fires.
        component.updateValidationErrors([
            {
                constraintId: 'required-category',
                message: 'Sensitivity tier is required',
                affectedConcepts: [],
            },
        ]);
        const drawer = document.querySelector(
            '.ez-field-drawer',
        ) as HTMLElement;
        expect(drawer).not.toBeNull();
        expect(drawer.classList.contains('ez-field-drawer--top')).toBe(true);
        expect(drawer.classList.contains('ez-field-drawer--bottom')).toBe(
            false,
        );

        component.updateValidationErrors([]);
        expect(drawer.classList.contains('ez-field-drawer--bottom')).toBe(true);
        expect(drawer.classList.contains('ez-field-drawer--top')).toBe(false);
    });

    it('tolerates errors delivered before setup builds the drawer', async () => {
        await component.init(host, Context.fromComponents({ scheme }));
        // Simulate the pre-setup window: container exists, chrome not yet built.
        (component as unknown as { drawer?: unknown }).drawer = undefined;
        expect(() =>
            component.updateValidationErrors([
                {
                    constraintId: 'required-category',
                    message: 'early',
                    affectedConcepts: [],
                },
            ]),
        ).not.toThrow();
    });
});
