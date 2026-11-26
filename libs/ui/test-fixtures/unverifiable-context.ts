/**
 * A Context over a small scheme, through the demo runtime's recordings, whose
 * reads of text fail while `controls.down` is true: a runtime that goes away.
 * Shared by the specs that drive a real field through a failed check.
 */
import { connectDemoContext } from '../../../test-support/demo-runtime';

export async function createUnverifiableContext(controls: { down: boolean }) {
    const concept = (
        id: string,
        label: string,
        category: string,
        position: number,
    ) => ({
        id,
        name: label.charAt(0) + label.slice(1).toLowerCase(),
        views: { default: label },
        categories: [category],
        parents: [],
        aliases: [],
        position,
        rank: position,
    });
    const context = await connectDemoContext({
        draft: {
            scheme: {
                scheme: {
                    id: 'composer-contract',
                    version: '1.0.0',
                    name: 'Composer Contract',
                    description: 'Composer Contract test fixture.',
                    data: {
                        concepts: [
                            concept('U', 'UNCLASSIFIED', 'level', 1),
                            concept('S', 'SECRET', 'level', 2),
                            concept('NF', 'NOFORN', 'caveat', 1),
                            concept('OC', 'ORCON', 'caveat', 2),
                        ],
                        categories: [
                            {
                                id: 'level',
                                label: 'Level',
                                required: false,
                                single: true,
                                rollup: 'max',
                                position: 1,
                            },
                            {
                                id: 'caveat',
                                label: 'Caveat',
                                required: false,
                                single: false,
                                rollup: 'union',
                                position: 2,
                            },
                        ],
                    },
                    rules: [],
                    embedded_marking: [
                        { pattern: '\\(([^)]+)\\)', template: '({marking}) ' },
                    ],
                    render: {
                        default: 'default',
                        formats: [
                            {
                                id: 'default',
                                surface: 'marking',
                                mode: 'inline',
                                separator: '//',
                                fields: [
                                    { category: 'level', separator: '/' },
                                    { category: 'caveat', separator: '/' },
                                ],
                            },
                        ],
                    },
                },
            },
        },
    });
    // A runtime that goes away: every read of text fails until it is back.
    const read = context.scheme.process.bind(context.scheme);
    context.scheme.process = ((...args: Parameters<typeof read>) =>
        controls.down
            ? new Promise<never>((_, reject) =>
                  setTimeout(() => reject(new Error('runtime unreachable')), 0),
              )
            : read(...args)) as typeof read;
    return context;
}
