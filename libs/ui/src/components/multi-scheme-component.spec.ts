/**
 * @vitest-environment jsdom
 *
 * Integration: a forms component mounted against a multi-scheme
 * engine routes its engine calls to the resolved scheme (per-element attribute
 * or component option), not the default-scheme slot.
 */

import { describe, it, expect } from 'vitest';
// `createLocalEngine()` is typed as the adapter interface, which loads a
// scheme by id. These cases load scheme documents and move the default-scheme
// slot, so they name the concrete engine `createLocalEngine` constructs.
import { SchemeEngine } from '@ezclassify/engine';
import { HiddenAssertionField } from './hidden-assertion-field';
import type { SchemePublicView } from '@ezclassify/types';

function makeProfile(id: string, token: string): SchemePublicView {
    return {
        scheme: {
            id,
            name: id,
            version: '1.0.0',
            description: '',
            data: {
                categories: [
                    {
                        id: 'lvl',
                        label: 'Level',
                        required: false,
                        single: false,
                        rollup: 'union',
                        position: 0,
                    },
                ],
                concepts: {
                    inline: [
                        {
                            id: token,
                            name: token,
                            views: { default: token },
                            categories: ['lvl'],
                            parents: [],
                            aliases: [],
                            position: 0,
                        },
                    ],
                },
            },
            rules: [],
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
                        view: 'default',
                        separator: '//',
                        fields: [{ category: 'lvl', separator: '//' }],
                    },
                ],
            },
        },
    } as unknown as SchemePublicView;
}

describe('Forms components on multi-scheme engine', () => {
    it('a HiddenAssertionField with ezclassify-scheme attribute routes to the named scheme', async () => {
        const engine = new SchemeEngine();
        engine.loadScheme(makeProfile('alpha', 'A')); // default slot
        engine.loadScheme(makeProfile('beta', 'B')); // not default

        const container = document.createElement('div') as HTMLDivElement;
        container.setAttribute('data-ezclassify-scheme', 'beta');
        document.body.appendChild(container);

        const field = new HiddenAssertionField();
        await field.init(container, engine, { initialValue: 'B' });

        // The field parsed 'B' against beta, alpha doesn't know that token.
        const assertions = field.getAssertions();
        expect(assertions.map((a) => a.conceptId)).toEqual(['B']);

        container.remove();
    });

    it('a component with options.schemeId routes to the named scheme', async () => {
        const engine = new SchemeEngine();
        engine.loadScheme(makeProfile('alpha', 'A'));
        engine.loadScheme(makeProfile('beta', 'B'));

        const container = document.createElement('div') as HTMLDivElement;
        document.body.appendChild(container);

        const field = new HiddenAssertionField();
        await field.init(container, engine, {
            initialValue: 'B',
            schemeId: 'beta',
        });

        expect(field.getAssertions().map((a) => a.conceptId)).toEqual(['B']);
        container.remove();
    });

    it('a component without attribute or option resolves to the engine default-scheme slot', async () => {
        const engine = new SchemeEngine();
        engine.loadScheme(makeProfile('alpha', 'A'));
        engine.loadScheme(makeProfile('beta', 'B'));

        const container = document.createElement('div') as HTMLDivElement;
        document.body.appendChild(container);

        const field = new HiddenAssertionField();
        // Default = alpha → A is parseable, B is not.
        await field.init(container, engine, { initialValue: 'A' });
        expect(field.getAssertions().map((a) => a.conceptId)).toEqual(['A']);

        container.remove();
    });

    it('throws when the engine has multiple schemes, no default, and no attribute/option', async () => {
        const engine = new SchemeEngine();
        engine.loadScheme(makeProfile('alpha', 'A'));
        engine.loadScheme(makeProfile('beta', 'B'));
        engine.setDefaultScheme(null);

        const container = document.createElement('div') as HTMLDivElement;
        document.body.appendChild(container);

        const field = new HiddenAssertionField();
        await expect(
            field.init(container, engine, { initialValue: 'A' }),
        ).rejects.toThrow(/multiple schemes loaded/);
        container.remove();
    });
});
