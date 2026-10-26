import { describe, it, expect } from 'vitest';
import { getControllerStyles } from './styles';

describe('forms/styles', () => {
    describe('getControllerStyles', () => {
        it('styles the classes the controller renders', () => {
            const css = getControllerStyles();
            expect(css).toContain('.ez-sr-only');
            expect(css).toContain('.ez-parent-validation-notice');
            expect(css).toContain('.ez-concept-tooltip');
            expect(css).toContain('.ez-copied-indicator');
        });

        it('marks an errored field from its data attribute', () => {
            expect(getControllerStyles()).toContain('[data-ezclassify-error]');
        });
    });
});
