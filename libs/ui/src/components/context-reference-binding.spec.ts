/**
 * Tests for the shared ContextReference binding mapper. Pins the exact
 * attributes and CSS variables every framework binding emits, so the React,
 * Vue, and Angular wrappers stay provably identical and thin.
 */

import { describe, it, expect } from 'vitest';
import {
    contextReferenceHostAttributes,
    contextReferenceTabAttributes,
    CONTEXT_REFERENCE_CONTROLLER,
} from './context-reference-binding';

describe('contextReferenceHostAttributes', () => {
    it('always emits the controller attribute', () => {
        const { attributes } = contextReferenceHostAttributes({});
        expect(attributes['data-ezclassify-controller']).toBe(
            CONTEXT_REFERENCE_CONTROLLER,
        );
    });

    it('maps placement, size, and theme to controller-prefixed attributes', () => {
        const { attributes } = contextReferenceHostAttributes({
            placement: 'left',
            size: '24rem',
            theme: 'government',
        });
        expect(attributes['data-ezclassify-context-reference-placement']).toBe(
            'left',
        );
        expect(attributes['data-ezclassify-context-reference-size']).toBe(
            '24rem',
        );
        expect(attributes['data-ezclassify-context-reference-theme']).toBe(
            'government',
        );
    });

    it('emits open as a presence-only attribute', () => {
        const open = contextReferenceHostAttributes({ open: true });
        expect(
            'data-ezclassify-context-reference-open' in open.attributes,
        ).toBe(true);
        expect(open.attributes['data-ezclassify-context-reference-open']).toBe(
            '',
        );

        const closed = contextReferenceHostAttributes({ open: false });
        expect(
            'data-ezclassify-context-reference-open' in closed.attributes,
        ).toBe(false);
    });

    it('joins a tabs array into a comma-separated allowlist', () => {
        const { attributes } = contextReferenceHostAttributes({
            tabs: ['handbook', 'access'],
        });
        expect(attributes['data-ezclassify-context-reference-tabs']).toBe(
            'handbook,access',
        );
    });

    it('passes a tabs string through unchanged', () => {
        const { attributes } = contextReferenceHostAttributes({
            tabs: 'access,handbook',
        });
        expect(attributes['data-ezclassify-context-reference-tabs']).toBe(
            'access,handbook',
        );
    });

    it('maps a forced color scheme to data-color-scheme, ignoring auto', () => {
        expect(
            contextReferenceHostAttributes({ colorScheme: 'dark' }).attributes[
                'data-color-scheme'
            ],
        ).toBe('dark');
        expect(
            'data-color-scheme' in
                contextReferenceHostAttributes({ colorScheme: 'auto' })
                    .attributes,
        ).toBe(false);
    });

    it('expands per-tab label and icon overrides', () => {
        const { attributes } = contextReferenceHostAttributes({
            tabLabels: { handbook: 'Manual' },
            tabIcons: { access: '🔒' },
        });
        expect(
            attributes['data-ezclassify-context-reference-tab-label-handbook'],
        ).toBe('Manual');
        expect(
            attributes['data-ezclassify-context-reference-tab-icon-access'],
        ).toBe('🔒');
    });

    it('maps offsets to inline CSS variables', () => {
        const { style } = contextReferenceHostAttributes({
            offset: { top: '60px', left: '1rem' },
        });
        expect(style['--ez-context-ref-offset-top']).toBe('60px');
        expect(style['--ez-context-ref-offset-left']).toBe('1rem');
        expect('--ez-context-ref-offset-right' in style).toBe(false);
    });
});

describe('contextReferenceTabAttributes', () => {
    it('emits the marker attribute plus id, label, icon, and order', () => {
        const attributes = contextReferenceTabAttributes({
            id: 'developers',
            label: 'Developers',
            icon: '⚙',
            order: 5,
        });
        expect('data-ezclassify-tab' in attributes).toBe(true);
        expect(attributes['data-ezclassify-tab-id']).toBe('developers');
        expect(attributes['data-ezclassify-tab-label']).toBe('Developers');
        expect(attributes['data-ezclassify-tab-icon']).toBe('⚙');
        expect(attributes['data-ezclassify-tab-order']).toBe('5');
    });

    it('omits optional attributes that were not provided', () => {
        const attributes = contextReferenceTabAttributes({ label: 'Notes' });
        expect(attributes['data-ezclassify-tab-label']).toBe('Notes');
        expect('data-ezclassify-tab-id' in attributes).toBe(false);
        expect('data-ezclassify-tab-icon' in attributes).toBe(false);
        expect('data-ezclassify-tab-order' in attributes).toBe(false);
    });
});
