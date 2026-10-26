import { afterEach, expect, it, vi } from 'vitest';
import { Context } from '@ezclassify/engine';
import type { LocalSchemeEngineAdapter } from '@ezclassify/types';
import { MarkedInput } from './marked-input';
import { MarkedTextArea } from './marked-text-area';

/** An adapter that supplies multiple engine errors to both marked fields. */
function adapter() {
    const context = Context.fromComponents({
        scheme: {
            scheme: {
                id: 'error-visibility',
                version: '1.0.0',
                name: 'Error visibility',
                data: {
                    categories: [
                        {
                            id: 'kind',
                            label: 'Kind',
                            single: true,
                            rollup: 'max',
                        },
                    ],
                    concepts: {
                        inline: [
                            {
                                id: 'A',
                                rank: 1,
                                name: 'Alpha',
                                categories: ['kind'],
                                views: { default: 'A' },
                            },
                        ],
                    },
                },
                rules: [],
                embedded_marking: [
                    { pattern: '\\(([^)]+)\\)', template: '({marking}) ' },
                ],
                render: {
                    default: 'part',
                    formats: [
                        {
                            id: 'part',
                            surface: 'marking',
                            mode: 'inline',
                            fields: [{ category: 'kind' }],
                        },
                    ],
                },
            },
        },
    });
    const engine = context.scheme as LocalSchemeEngineAdapter;
    const process = engine.process.bind(engine);
    vi.spyOn(engine, 'process').mockImplementation((input, options) => ({
        ...process(input, options),
        valid: false,
        errors: [
            { constraintId: 'check-overall', message: 'First engine error.' },
            {
                constraintId: 'requires-fdr-check',
                message: 'Second engine error.',
            },
        ],
    }));
    const validate = engine.validate.bind(engine);
    vi.spyOn(engine, 'validate').mockImplementation((input, options) => ({
        ...validate(input, options),
        valid: false,
        errors: [
            { constraintId: 'check-overall', message: 'First engine error.' },
            {
                constraintId: 'requires-fdr-check',
                message: 'Second engine error.',
            },
        ],
    }));
    return context;
}

const mounted: Array<{ destroy(): void }> = [];
afterEach(() => {
    for (const component of mounted.splice(0)) component.destroy();
    document.body.replaceChildren();
});

it.each([
    { name: 'MarkedInput', Component: MarkedInput },
    { name: 'MarkedTextArea', Component: MarkedTextArea },
])('shows every engine error in $name', async ({ Component }) => {
    const field = document.createElement(
        Component === MarkedInput ? 'input' : 'textarea',
    );
    field.value = '(A) Body';
    const host = document.createElement('div');
    host.append(field);
    document.body.append(host);
    const component = new Component();
    mounted.push(component);
    await component.init(host, adapter());
    await vi.waitFor(() => {
        const report = [
            host.textContent,
            ...Array.from(host.querySelectorAll('[aria-label]'), (element) =>
                element.getAttribute('aria-label'),
            ),
        ].join(' ');
        expect(report).toContain('First engine error.');
        expect(report).toContain('Second engine error.');
    });
});
