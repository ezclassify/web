import { Context } from '@ezclassify/engine';

/**
 * `JOINT ` ahead of a marking with joint owners, and ahead of a part that
 * writes the word for its whole's owners: the format writes the word for the
 * stand-in whether or not the owners it stands for are in hand.
 */
const JOINT_PREFIX = {
    text: 'JOINT ',
    when: {
        any: [
            { named_condition: 'joint-ownership' },
            { named_condition: 'joint-as-whole' },
        ],
    },
};

/** The level, then the owners of a jointly owned marking. */
function ownedLevel(view: 'default' | 'portion') {
    return {
        name: 'Level and owners',
        separator: ' ',
        fields: [
            { category: 'level', view },
            { category: 'owners', separator: ' ' },
        ],
    };
}

/** How a marking is handled, and with which partners. */
const HANDLING = {
    category: 'handling',
    separator: '/',
    phrases: [
        {
            head: 'SHARE',
            separator: ' ',
            fields: [
                {
                    category: 'partners',
                    prefix: 'WITH ',
                    separator: ', ',
                },
            ],
        },
    ],
};

/**
 * A scheme whose parts may write one word for a list they share with their
 * whole: `SHARE` heads the partners a marking is shared with (`SHARE WITH
 * ALPHA, BRAVO`), and a part that writes `SHARE` alone means its whole's
 * partners. The concept says so with `stands_for_whole`, and the part format
 * writes such a part back with the word (`omit_whole_values`).
 *
 * A marking with two or more owners is written `JOINT` ahead of its level, with
 * the owners after it (`JOINT HIGH NORTH SOUTH`). A part whose owners are its
 * whole's may leave them out and write `JOINT` alone (`JOINT H//SHARE`). That
 * word is a value, the owners' stand-in, so the short form has a format of its
 * own (`portion_joint`): the long part format writes `JOINT` as a literal and
 * cannot read the same word both ways. Either part format writes the word for a
 * part that holds the stand-in, so a part written short is written back short.
 *
 * Part rules refuse a shared part with no partners and a joint part with no
 * joint owners, its own or taken from its whole. `CLOSED` is a whole that
 * shares with nobody. A rollup writes the owners, never the word that stood for
 * them.
 *
 * It extends the shape of the engine's own stand-in fixture, so these specs pin
 * the UI against the reading the engine defines, not a copy of one scheme's
 * data.
 */
export const WHOLE_STAND_IN_SCHEME = {
    scheme: {
        id: 'whole-stand-in',
        version: '1.0.0',
        name: 'Whole stand-in',
        role_aware: true,
        role_detection: {
            whole: { views: ['banner'] },
            part: { views: ['portion'] },
        },
        part_scope: 'until-next',
        embedded_marking: [{ pattern: '\\((.+)\\)', template: '({marking}) ' }],
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
                    id: 'handling',
                    label: 'Handling',
                    single: false,
                    rollup: 'union',
                },
                {
                    id: 'partners',
                    label: 'Partners',
                    single: false,
                    rollup: 'intersection',
                    sort: 'alphabetical',
                },
                {
                    id: 'owners',
                    label: 'Owners',
                    single: false,
                    rollup: 'pipeline',
                    sort: 'alphabetical',
                },
                {
                    id: 'owner_shorthand',
                    label: 'Owners as in the whole',
                    single: true,
                    rollup: 'pipeline',
                },
            ],
            concepts: {
                inline: [
                    {
                        id: 'LOW',
                        name: 'Low',
                        categories: ['level'],
                        rank: 1,
                        views: { default: 'LOW', portion: 'L' },
                    },
                    {
                        id: 'HIGH',
                        name: 'High',
                        categories: ['level'],
                        rank: 2,
                        views: { default: 'HIGH', portion: 'H' },
                    },
                    {
                        id: 'SHARE',
                        name: 'Share',
                        categories: ['handling'],
                        views: 'SHARE',
                        stands_for_whole: 'partners',
                    },
                    {
                        id: 'CLOSED',
                        name: 'Closed',
                        categories: ['handling'],
                        views: 'CLOSED',
                    },
                    ...['ALPHA', 'BRAVO', 'CHARLIE'].map((id) => ({
                        id,
                        name: `Partner ${id}`,
                        categories: ['partners'],
                        views: id,
                    })),
                    ...['NORTH', 'SOUTH'].map((id) => ({
                        id,
                        name: `Owner ${id}`,
                        categories: ['owners'],
                        views: id,
                    })),
                    {
                        id: 'JOINT-AS-WHOLE',
                        name: 'Joint, owners as in the whole',
                        categories: ['owner_shorthand'],
                        views: 'JOINT',
                        stands_for_whole: 'owners',
                    },
                ],
            },
        },
        rules: [
            {
                // A whole-only rule. A part, or a contributor to a rollup read
                // in a whole, is never judged by it.
                id: 'whole-says-how-it-is-handled',
                name: 'A whole says how it is handled',
                when: {
                    all: [
                        { role: 'whole' },
                        { category: 'handling', is: 'count_eq 0' },
                    ],
                },
                action: 'cardinality',
                category: 'handling',
                min: 1,
                message: 'Say how the whole is handled.',
            },
            {
                // A part rule: a part is judged on its own list, or on the
                // list it took from its whole for the word.
                id: 'share-names-partners',
                name: 'A shared part names its partners',
                when: {
                    all: [
                        { role: 'part' },
                        { category: 'handling', has: 'SHARE' },
                    ],
                },
                action: 'cardinality',
                category: 'partners',
                min: 1,
                message: 'Name the partners in this part or in its whole.',
            },
            {
                id: 'joint-names-owners',
                name: 'A joint part has joint owners',
                when: {
                    all: [
                        { role: 'part' },
                        { category: 'owner_shorthand', has: 'JOINT-AS-WHOLE' },
                    ],
                },
                action: 'cardinality',
                category: 'owners',
                min: 2,
                message: 'Name the joint owners in this part or in its whole.',
            },
        ],
        rollup_pipelines: [
            {
                // The word stands for a whole's owners in a part; a rollup
                // writes the owners.
                id: 'owners',
                categories: ['owners', 'owner_shorthand'],
                mode: 'all',
                explanation: 'Roll the owners up and drop the word.',
                steps: [
                    { then: { remove: ['JOINT-AS-WHOLE'] } },
                    { then: { union: true } },
                ],
            },
        ],
        named_conditions: {
            'joint-ownership': {
                category_id: 'owners',
                operator: 'count_gte',
                value: 2,
            },
            'joint-as-whole': {
                category_id: 'owner_shorthand',
                operator: 'has_concept',
                value: 'JOINT-AS-WHOLE',
            },
        },
        parse: { case_sensitive: false, strip_whitespace: true },
        render: {
            default: 'banner',
            formats: [
                {
                    id: 'banner',
                    surface: 'classification',
                    mode: 'inline',
                    separator: '//',
                    view: 'default',
                    prefix: [JOINT_PREFIX],
                    fields: [ownedLevel('default'), HANDLING],
                },
                {
                    id: 'portion',
                    surface: 'classification',
                    mode: 'inline',
                    separator: '//',
                    view: 'portion',
                    omit_whole_values: true,
                    prefix: [JOINT_PREFIX],
                    fields: [ownedLevel('portion'), HANDLING],
                },
                {
                    // `JOINT H//SHARE`: a part that writes `JOINT` for its
                    // whole's owners. Reads only that short form.
                    id: 'portion_joint',
                    surface: 'classification',
                    mode: 'inline',
                    separator: '//',
                    view: 'portion',
                    omit_whole_values: true,
                    fields: [
                        {
                            name: 'JOINT and level',
                            separator: ' ',
                            fields: [
                                { category: 'owner_shorthand', required: true },
                                {
                                    category: 'level',
                                    view: 'portion',
                                    required: true,
                                },
                            ],
                        },
                        HANDLING,
                    ],
                },
            ],
        },
    },
};

/** A whole that names two partners, as the banner format writes it. */
export const STAND_IN_WHOLE = 'HIGH//SHARE WITH ALPHA, BRAVO';

/** A whole that shares with nobody. */
export const CLOSED_WHOLE = 'HIGH//CLOSED';

/** A jointly owned whole that names two partners. */
export const JOINT_WHOLE = 'JOINT HIGH NORTH SOUTH//SHARE WITH ALPHA, BRAVO';

/** A Context over {@link WHOLE_STAND_IN_SCHEME}. */
export function wholeStandInContext() {
    return Context.fromComponents({ scheme: WHOLE_STAND_IN_SCHEME as never });
}
