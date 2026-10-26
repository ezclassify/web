/**
 * A field bound to a part reads that part as a part.
 *
 * The part is declared on the marking host the field is bound to, not on the
 * field itself, and its whole holds nothing yet: a sandbox row whose whole is
 * only the rollup of its rows. A rule that asks about the whole is unresolved
 * then, so the part is valid and carries the engine's `_whole_unverified`
 * warning. The whole's own rules never judge it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Context } from '@ezclassify/engine';
import { EzClassifyUI } from '../ezclassify-ui';

function wait(ms = 60): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
}

const WHOLE_RULE = 'HOLD needs a partner on the whole.';
const PART_RULE = 'HOLD needs a partner in this part or on the whole.';

function concept(id: string, category: string, position: number) {
    return {
        id,
        name: id,
        views: { default: id },
        categories: [category],
        parents: [],
        aliases: [],
        position,
        rank: position,
    };
}

/**
 * HOLD needs a partner. On a whole that is its own rule. On a part the partner
 * may come from the whole instead, so the part rule asks about the whole.
 */
function createEngine() {
    return Context.fromComponents({
        scheme: {
            scheme: {
                id: 'bound-part-role',
                version: '1.0.0',
                name: 'Bound part role',
                role_aware: true,
                data: {
                    concepts: {
                        inline: [
                            concept('LOW', 'level', 1),
                            concept('HOLD', 'handling', 1),
                            concept('ALPHA', 'partners', 1),
                        ],
                    },
                    categories: [
                        {
                            id: 'level',
                            label: 'Level',
                            single: true,
                            rollup: 'max',
                            position: 1,
                        },
                        {
                            id: 'handling',
                            label: 'Handling',
                            single: false,
                            rollup: 'union',
                            position: 2,
                        },
                        {
                            id: 'partners',
                            label: 'Partners',
                            single: false,
                            rollup: 'intersection',
                            position: 3,
                        },
                    ],
                },
                rules: [
                    {
                        id: 'whole-hold-needs-partner',
                        action: 'cardinality',
                        category: 'partners',
                        min: 1,
                        when: {
                            all: [
                                { role: 'whole' },
                                { category: 'handling', has: 'HOLD' },
                            ],
                        },
                        message: WHOLE_RULE,
                    },
                    {
                        id: 'part-hold-needs-partner',
                        action: 'cardinality',
                        category: 'partners',
                        min: 1,
                        when: {
                            all: [
                                { role: 'part' },
                                {
                                    target: 'context',
                                    category: 'partners',
                                    is: 'count_eq 0',
                                },
                                { category: 'handling', has: 'HOLD' },
                            ],
                        },
                        message: PART_RULE,
                    },
                ],
                parse: { case_sensitive: false, strip_whitespace: true },
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
                                { category: 'handling', separator: '/' },
                                { category: 'partners', separator: ', ' },
                            ],
                        },
                    ],
                },
            },
        },
    }).scheme;
}

let root: HTMLDivElement;
let forms: EzClassifyUI | null = null;

beforeEach(() => {
    root = document.createElement('div');
    document.body.appendChild(root);
    Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
    forms?.destroy();
    forms = null;
    root.remove();
    vi.restoreAllMocks();
});

describe('a TagInput bound to a part whose whole holds nothing', () => {
    it('reads the part as valid with the unverified-whole warning, never by the whole rules', async () => {
        root.innerHTML = [
            '<input type="hidden" id="whole" data-ezclassify-rendered />',
            '<input type="hidden" id="part" data-ezclassify-rendered data-ezclassify-part-of="whole" />',
            '<input id="f" data-ezclassify-controller="tags" data-ezclassify-bound-to="part" />',
        ].join('');
        forms = new EzClassifyUI(createEngine() as never, { root });
        await wait(150);

        const field = document.getElementById('f') as HTMLInputElement;
        field.value = 'LOW//HOLD';
        field.dispatchEvent(new Event('input', { bubbles: true }));
        await wait(300);

        const list = root.querySelector<HTMLElement>('.ez-validation-errors');
        expect(list?.hidden).toBe(false);
        expect(list?.textContent).not.toContain(WHOLE_RULE);
        expect(list?.textContent).not.toContain(PART_RULE);
        expect([...list!.children].map((c) => c.className)).toEqual([
            'ez-validation-errors__item ez-validation-errors__item--warning',
        ]);
        expect(list?.textContent).toContain('Unable to compare with whole');
        expect(list?.querySelector('button')).toBeNull();

        const committed = forms.store.get('part');
        expect(committed.rendered).toBe('LOW//HOLD');
        expect(committed.valid).toBe(true);
        expect(committed.errors).toEqual([]);
    });
});
