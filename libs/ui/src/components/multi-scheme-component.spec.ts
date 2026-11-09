/**
 * @vitest-environment jsdom
 *
 * Integration: a forms component mounted against a multi-scheme
 * engine routes its engine calls to the resolved scheme (per-element attribute
 * or component option), not the default-scheme slot.
 */

import { describe, it, expect } from 'vitest';
import { Context } from '@ezclassify/engine';
import { HiddenAssertionField } from './hidden-assertion-field';
import type { SchemeEngineAdapter, SchemePublicView } from '@ezclassify/types';

/**
 * Where each addressed operation takes its scheme selector, by the
 * `SchemeEngineAdapter` signatures. A registry adapter (a client that serves
 * several schemes) addresses every operation this way.
 */
const SELECTOR_AT: Record<string, number> = {
    getScheme: 0,
    getSchemeMeta: 0,
    buildSchemeView: 0,
    listCategories: 0,
    listCategoriesFlat: 0,
    filterConcepts: 1,
    getConceptsInCategory: 1,
    collectNotices: 1,
    process: 1,
    validate: 1,
    explain: 1,
    normalize: 1,
    suggest: 1,
    aggregate: 1,
    aggregateAssertions: 1,
    applyPreset: 1,
    scan: 1,
    getFormatCoverage: 1,
    render: 2,
    diff: 2,
    describeConcept: 2,
    uncoveredAssertions: 2,
    checkCoverage: 2,
};

/**
 * A registry adapter over one Context per scheme, with a default-scheme slot.
 * Each addressed call is answered by the Context its selector names, so these
 * cases see real engine answers routed the way the field addressed them.
 */
function registry(...documents: SchemePublicView[]) {
    const schemes = new Map(
        documents.map((doc) => [
            (doc as unknown as { scheme: { id: string } }).scheme.id,
            Context.fromComponents({ scheme: doc }).scheme,
        ]),
    );
    let defaultId: string | null = schemes.keys().next().value ?? null;
    const operations: Record<string, unknown> = {
        listSchemes: () =>
            [...schemes.values()].map((scheme) => scheme.getSchemeMeta()),
        getDefaultScheme: () => (defaultId === null ? null : { id: defaultId }),
        setDefaultScheme: (id: string | null) => {
            defaultId = id;
        },
        loadScheme: () => {
            throw new Error(
                'This registry holds the schemes it was built with.',
            );
        },
        destroy: () => {},
    };
    for (const [name, at] of Object.entries(SELECTOR_AT)) {
        operations[name] = (...args: unknown[]) => {
            const selector = args[at];
            const id = typeof selector === 'string' ? selector : defaultId;
            const scheme = id === null ? undefined : schemes.get(id);
            if (!scheme) throw new Error(`No scheme ${String(id)} is loaded.`);
            const rest = args.slice();
            if (typeof selector === 'string') rest.splice(at, 1);
            return (
                scheme as unknown as Record<
                    string,
                    (...a: unknown[]) => unknown
                >
            )[name](...rest);
        };
    }
    return operations as unknown as SchemeEngineAdapter & {
        setDefaultScheme(id: string | null): void;
    };
}

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
        // alpha takes the default slot; beta is not the default.
        const engine = registry(
            makeProfile('alpha', 'A'),
            makeProfile('beta', 'B'),
        );

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
        const engine = registry(
            makeProfile('alpha', 'A'),
            makeProfile('beta', 'B'),
        );

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
        const engine = registry(
            makeProfile('alpha', 'A'),
            makeProfile('beta', 'B'),
        );

        const container = document.createElement('div') as HTMLDivElement;
        document.body.appendChild(container);

        const field = new HiddenAssertionField();
        // Default = alpha → A is parseable, B is not.
        await field.init(container, engine, { initialValue: 'A' });
        expect(field.getAssertions().map((a) => a.conceptId)).toEqual(['A']);

        container.remove();
    });

    it('throws when the engine has multiple schemes, no default, and no attribute/option', async () => {
        const engine = registry(
            makeProfile('alpha', 'A'),
            makeProfile('beta', 'B'),
        );
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
