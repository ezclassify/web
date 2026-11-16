/**
 * A scheme whose marking spans two scopes, the way a sensitivity line and the
 * block that records who decided it and until when are one marking written in
 * two places.
 *
 * `label`, the default scope, holds the level and is written on one line.
 * `origin` holds the decision record and is written as a block. Its choices
 * branch: an `ORIGINAL` decision takes reasons, a `COPIED` one takes a source,
 * and only the branch taken is offered, because those concepts name the
 * decision type as their parent. Some choices take a value the author types:
 * who decided, the cited source, the release date. Two rules judge the block:
 * an exemption needs its code, and an original decision has no source.
 *
 * The specs that drive DecisionFlow across both scopes read this through the
 * demo runtime's draft door, so every answer is the engine's.
 */

const concept = (
    id: string,
    name: string,
    category: string,
    view: string,
    position: number,
    extra: Record<string, unknown> = {},
) => ({
    id,
    name,
    categories: [category],
    views: { default: view },
    position,
    parents: [],
    aliases: [],
    ...extra,
});

export const TWO_SCOPE_FLOW_SCHEME = {
    scheme: {
        id: 'two-scope-flow',
        version: '1.0.0',
        name: 'Two-scope flow',
        description: 'A marking written as a label line and an origin block.',
        default_scope: 'label',
        scopes: [
            { id: 'label', label: 'Label Line' },
            { id: 'origin', label: 'Origin Block' },
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
                    id: 'origin_type',
                    label: 'Decision Type',
                    required: true,
                    single: true,
                    rollup: 'max',
                    scopes: ['origin'],
                },
                {
                    id: 'decided_by',
                    label: 'Decided By',
                    required: false,
                    single: true,
                    rollup: 'union',
                    scopes: ['origin'],
                },
                {
                    id: 'source_type',
                    label: 'Source',
                    required: false,
                    single: true,
                    rollup: 'max',
                    scopes: ['origin'],
                },
                {
                    id: 'reason',
                    label: 'Reason',
                    required: false,
                    single: false,
                    rollup: 'union',
                    sort: 'position',
                    scopes: ['origin'],
                },
                {
                    id: 'release_type',
                    label: 'Release',
                    required: true,
                    single: true,
                    rollup: 'max',
                    scopes: ['origin'],
                },
                {
                    id: 'exempt_code',
                    label: 'Exemption Code',
                    required: false,
                    single: false,
                    rollup: 'union',
                    sort: 'position',
                    scopes: ['origin'],
                },
            ],
            concepts: [
                concept('LOW', 'Low', 'level', 'LOW', 1, { rank: 1 }),
                concept('HIGH', 'High', 'level', 'HIGH', 2, { rank: 2 }),
                concept(
                    'ORIGINAL',
                    'Original Decision',
                    'origin_type',
                    'Original',
                    1,
                    {
                        rank: 1,
                    },
                ),
                concept(
                    'COPIED',
                    'Copied Decision',
                    'origin_type',
                    'Copied',
                    2,
                    {
                        rank: 2,
                    },
                ),
                concept(
                    'DECIDED_BY_TEXT',
                    'Decided By',
                    'decided_by',
                    '{value}',
                    1,
                    {
                        parents: ['ORIGINAL', 'COPIED'],
                        text_input: {
                            placeholder: 'Name and position',
                            label: 'Decided By',
                            required: true,
                        },
                    },
                ),
                concept(
                    'ONE_SOURCE',
                    'One Source',
                    'source_type',
                    '{value}',
                    1,
                    {
                        parents: ['COPIED'],
                        rank: 1,
                        text_input: {
                            placeholder: 'Source title and date',
                            label: 'Source Citation',
                            required: true,
                        },
                    },
                ),
                concept(
                    'MANY_SOURCES',
                    'Many Sources',
                    'source_type',
                    'Many Sources',
                    2,
                    {
                        parents: ['COPIED'],
                        rank: 2,
                    },
                ),
                concept('REASON_A', 'Reason A', 'reason', 'A', 1, {
                    parents: ['ORIGINAL'],
                }),
                concept('REASON_B', 'Reason B', 'reason', 'B', 2, {
                    parents: ['ORIGINAL'],
                }),
                concept('ON_DATE', 'On a Date', 'release_type', '{value}', 1, {
                    rank: 1,
                    text_input: {
                        placeholder: 'YYYYMMDD',
                        label: 'Release date (YYYYMMDD)',
                        encoding: {
                            type: 'calendar-date',
                            canonical: 'YYYY-MM-DD',
                            accepts: ['YYYYMMDD', 'YYYY-MM-DD'],
                            views: { default: 'YYYYMMDD' },
                        },
                    },
                }),
                concept('NEVER', 'Never', 'release_type', 'Never', 2, {
                    rank: 2,
                }),
                concept('EXEMPT', 'Exempt', 'release_type', 'Exempt', 3, {
                    rank: 3,
                }),
                concept('X1', 'Exemption 1', 'exempt_code', 'X1', 1, {
                    parents: ['EXEMPT'],
                }),
                concept('X2', 'Exemption 2', 'exempt_code', 'X2', 2, {
                    parents: ['EXEMPT'],
                }),
            ],
        },
        rules: [
            {
                id: 'exempt-needs-code',
                name: 'An Exemption Names Its Code',
                action: 'cardinality',
                when: ['EXEMPT'],
                category: 'exempt_code',
                min: 1,
                message: 'An exemption names its exemption code.',
            },
            {
                id: 'original-has-no-source',
                name: 'An Original Decision Has No Source',
                action: 'forbid',
                when: 'ORIGINAL',
                target: ['ONE_SOURCE', 'MANY_SOURCES'],
                message: 'An original decision cites no source.',
            },
        ],
        render: {
            surface_separator: '\n',
            formats: [
                {
                    id: 'label_line',
                    surface: 'label',
                    mode: 'inline',
                    fields: [{ category: 'level' }],
                },
                {
                    id: 'origin_block',
                    surface: 'origin',
                    mode: 'block',
                    separator: '\n',
                    fields: [
                        { category: 'decided_by', prefix: 'Decided By: ' },
                        { category: 'source_type', prefix: 'Source: ' },
                        {
                            category: 'reason',
                            prefix: 'Reason: ',
                            separator: ', ',
                        },
                        { category: 'release_type', prefix: 'Release: ' },
                        {
                            category: 'exempt_code',
                            prefix: 'Exemption: ',
                            separator: ', ',
                        },
                    ],
                },
            ],
            surfaces: [
                {
                    surface: 'label',
                    default: 'line',
                    views: [{ id: 'line', format: 'label_line' }],
                },
                {
                    surface: 'origin',
                    default: 'block',
                    views: [{ id: 'block', format: 'origin_block' }],
                },
            ],
        },
    },
};
