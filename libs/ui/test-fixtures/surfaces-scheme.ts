/**
 * A scheme that declares its outputs by surface and writes each role in a view
 * of its own, so the UI is pinned against a scheme where the unnamed output
 * depends on what a marking is.
 *
 * `sensitivity` has a part view `short`, written `CONF`, or `CONF // PARTNERS`
 * while the marking is shared with partners; a whole view `full`, written
 * `CONFIDENTIAL // PARTNERS` and also read in the retired `CONF/PARTNERS`; and
 * an `xml` view with no role. A whole is written `full` and a part `short` when
 * a request names neither. `retention` has one view, `block`.
 *
 * It is the shape of the conformance suite's surfaces design fixture, so these
 * specs read the views the contract defines rather than one shipped scheme's.
 */

const level = (id: string, name: string, short: string, rank: number) => ({
    id,
    name,
    categories: ['level'],
    views: { default: id, abbreviated: short },
    rank,
    position: rank,
    parents: [],
    aliases: [],
});

export const SURFACES_SCHEME = {
    scheme: {
        id: 'surfaces',
        version: '1.0.0',
        name: 'Surfaces',
        default_scope: 'sensitivity',
        scopes: [
            { id: 'sensitivity', label: 'Sensitivity' },
            { id: 'retention', label: 'Retention' },
        ],
        data: {
            categories: [
                {
                    id: 'level',
                    label: 'Level',
                    required: true,
                    single: true,
                    rollup: 'max',
                },
                {
                    id: 'sharing',
                    label: 'Sharing',
                    single: true,
                    rollup: 'first',
                },
                {
                    id: 'keep',
                    label: 'Keep for',
                    single: true,
                    rollup: 'max',
                    scopes: ['retention'],
                },
            ],
            concepts: {
                inline: [
                    level('INTERNAL', 'Internal', 'INT', 1),
                    level('CONFIDENTIAL', 'Confidential', 'CONF', 2),
                    {
                        id: 'PARTNERS',
                        name: 'Shared with partners',
                        categories: ['sharing'],
                        views: { default: 'PARTNERS' },
                        rank: 3,
                        position: 3,
                        parents: [],
                        aliases: [],
                    },
                    {
                        id: 'KEEP_7Y',
                        name: 'Seven years',
                        categories: ['keep'],
                        views: { default: 'KEEP 7 YEARS' },
                        rank: 4,
                        position: 4,
                        parents: [],
                        aliases: [],
                    },
                ],
            },
        },
        named_conditions: {
            'shared-with-partners': {
                category_id: 'sharing',
                operator: 'has_concept',
                value: 'PARTNERS',
            },
        },
        embedded_marking: [{ pattern: '\\((.+)\\)', template: '({marking}) ' }],
        render: {
            surface_separator: '\n',
            formats: [
                {
                    id: 'short_line',
                    surface: 'sensitivity',
                    mode: 'inline',
                    view: 'abbreviated',
                    fields: [{ category: 'level' }],
                },
                {
                    id: 'short_shared_line',
                    surface: 'sensitivity',
                    mode: 'inline',
                    view: 'abbreviated',
                    separator: ' // ',
                    fields: [{ category: 'level' }, { category: 'sharing' }],
                },
                {
                    id: 'full_line',
                    surface: 'sensitivity',
                    mode: 'inline',
                    separator: ' // ',
                    fields: [{ category: 'level' }, { category: 'sharing' }],
                },
                {
                    id: 'full_line_2019',
                    surface: 'sensitivity',
                    mode: 'inline',
                    view: 'abbreviated',
                    separator: '/',
                    fields: [{ category: 'level' }, { category: 'sharing' }],
                },
                {
                    id: 'xml_attributes',
                    surface: 'sensitivity',
                    mode: 'block',
                    syntax: { type: 'xml-attributes' },
                    fields: [
                        { category: 'level', attribute: 'level' },
                        { category: 'sharing', attribute: 'sharing' },
                    ],
                },
                {
                    id: 'retention_block',
                    surface: 'retention',
                    mode: 'block',
                    fields: [{ category: 'keep' }],
                },
            ],
            surfaces: [
                {
                    surface: 'sensitivity',
                    default: { whole: 'full', part: 'short' },
                    views: [
                        {
                            id: 'short',
                            role: 'part',
                            format: 'short_line',
                            cases: [
                                {
                                    when: {
                                        named_condition: 'shared-with-partners',
                                    },
                                    format: 'short_shared_line',
                                },
                            ],
                        },
                        {
                            id: 'full',
                            role: 'whole',
                            format: 'full_line',
                            also_read_in: ['full_line_2019'],
                        },
                        { id: 'xml', format: 'xml_attributes' },
                    ],
                },
                {
                    surface: 'retention',
                    default: 'block',
                    views: [{ id: 'block', format: 'retention_block' }],
                },
            ],
        },
    },
};
