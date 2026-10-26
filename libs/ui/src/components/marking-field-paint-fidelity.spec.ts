/**
 * Display-integrity tests for MarkingField's at-rest paint.
 *
 * One invariant, and it is not negotiable for a marking component: the text the
 * display paints, concatenated in order, is the marking the field holds: every
 * separator, every category prefix, every hyphen and space. Color spans may
 * wrap a token's characters; they may never stand in for, reorder, or drop the
 * characters between tokens.
 *
 * The two fixtures below are the shapes that actually broke it in the wild (the
 * government-marking demo): a category whose within-category separator comes
 * from the render format while its concepts nest by tier, and a category that
 * whose field writes an affix around every value and sorts alphabetically. Both
 * are driven through setAssertions so the ENGINE renders the string and the
 * paint is compared against that, which is exactly the relationship the
 * invariant is about.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { LocalSchemeEngineAdapter } from '@ezclassify/types';
import { EzClassifyUI } from '../ezclassify-ui';
import { MarkingField } from './marking-field';
import { Context } from '@ezclassify/engine';

function wait(ms = 60): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
}

/**
 * ISM-shaped slice: a `sci` category that declares tier separators (so the
 * token tree lays its concepts out as a tiered group) while the concepts in
 * play are plain siblings joined by the format's own "/" concept separator.
 */
function createTieredEngine(): LocalSchemeEngineAdapter {
    return Context.fromComponents({
        scheme: {
            scheme: {
                id: 'mf-tiered',
                version: '1.0.0',
                name: 'MarkingField tiered-category fixture',
                data: {
                    categories: [
                        {
                            id: 'level',
                            label: 'Level',
                            required: false,
                            single: true,
                            rollup: 'max',
                            position: 0,
                        },
                        {
                            id: 'sci',
                            label: 'SCI Control System',
                            required: false,
                            single: false,
                            rollup: 'union',
                            sort: 'position',
                            position: 1,
                        },
                        {
                            id: 'dissem',
                            label: 'Dissemination Control',
                            required: false,
                            single: false,
                            rollup: 'union',
                            sort: 'position',
                            position: 2,
                        },
                    ],
                    concepts: {
                        inline: [
                            {
                                id: 'SECRET',
                                name: 'Secret',
                                views: { default: 'SECRET' },
                                categories: ['level'],
                                parents: [],
                                aliases: [],
                                position: 0,
                                rank: 2,
                            },
                            {
                                id: 'SI',
                                name: 'Special Intelligence',
                                views: { default: 'SI' },
                                categories: ['sci'],
                                parents: [],
                                aliases: [],
                                position: 0,
                                rank: 1,
                            },
                            {
                                id: 'TK',
                                name: 'Talent Keyhole',
                                views: { default: 'TK' },
                                categories: ['sci'],
                                parents: [],
                                aliases: [],
                                position: 1,
                                rank: 1,
                            },
                            {
                                id: 'NOFORN',
                                name: 'No Foreign',
                                views: { default: 'NOFORN' },
                                categories: ['dissem'],
                                parents: [],
                                aliases: [],
                                position: 0,
                                rank: 1,
                            },
                        ],
                    },
                },
                rules: [],
                render: {
                    default: 'banner',
                    formats: [
                        {
                            id: 'banner',
                            surface: 'marking',
                            mode: 'inline',
                            view: 'default',
                            separator: '//',
                            fields: [
                                { category: 'level', separator: '/' },
                                {
                                    category: 'sci',
                                    separator: '/',
                                    tiers: [
                                        {
                                            tier: 'subcontrol',
                                            attached_by: '-',
                                        },
                                        {
                                            tier: 'subcompartment',
                                            attached_by: ' ',
                                        },
                                    ],
                                },
                                { category: 'dissem', separator: '/' },
                            ],
                        },
                    ],
                },
            },
        },
    }).scheme as LocalSchemeEngineAdapter;
}

/**
 * CUI-shaped slice: `specified_category` puts an "SP-" prefix back on render
 * (the prefix is a property of the CATEGORY, not of any concept's view) and
 * `dissem` sorts alphabetically, which puts the multi-word "FED ONLY" ahead of
 * "NOFORN" even though its concept position is higher.
 */
function createPrefixedEngine(): LocalSchemeEngineAdapter {
    return Context.fromComponents({
        scheme: {
            scheme: {
                id: 'mf-prefixed',
                version: '1.0.0',
                name: 'MarkingField prefixed-category fixture',
                data: {
                    categories: [
                        {
                            id: 'cui_designator',
                            label: 'CUI Designator',
                            required: false,
                            single: true,
                            rollup: 'union',
                            position: 0,
                        },
                        {
                            id: 'specified_category',
                            label: 'CUI Specified Category',
                            required: false,
                            single: false,
                            rollup: 'union',
                            sort: 'alphabetical',
                            position: 1,
                        },
                        {
                            id: 'basic_category',
                            label: 'CUI Basic Category',
                            required: false,
                            single: false,
                            rollup: 'union',
                            sort: 'alphabetical',
                            position: 2,
                        },
                        {
                            id: 'dissem',
                            label: 'Limited Dissemination Control',
                            required: false,
                            single: false,
                            rollup: 'union',
                            sort: 'alphabetical',
                            position: 3,
                        },
                    ],
                    concepts: {
                        inline: [
                            {
                                id: 'CUI',
                                name: 'Controlled Unclassified Information',
                                views: { default: 'CUI' },
                                categories: ['cui_designator'],
                                parents: [],
                                aliases: [],
                                position: 0,
                                rank: 1,
                            },
                            {
                                id: 'PROPIN',
                                name: 'Proprietary Business Information',
                                views: { default: 'PROPIN' },
                                categories: ['basic_category'],
                                parents: [],
                                aliases: [],
                                position: 2,
                                rank: 1,
                            },
                            {
                                id: 'EXPT',
                                name: 'Export Controlled',
                                views: { default: 'EXPT' },
                                categories: [
                                    'basic_category',
                                    'specified_category',
                                ],
                                parents: [],
                                aliases: [],
                                position: 4,
                                rank: 1,
                            },
                            {
                                id: 'NOFORN',
                                name: 'Not Releasable to Foreign Nationals',
                                views: { default: 'NOFORN' },
                                categories: ['dissem'],
                                parents: [],
                                aliases: [],
                                position: 0,
                                rank: 1,
                            },
                            {
                                id: 'FED-ONLY',
                                name: 'Federal Employees Only',
                                views: { default: 'FED ONLY' },
                                categories: ['dissem'],
                                parents: [],
                                aliases: [],
                                position: 1,
                                rank: 1,
                            },
                            // Deliberately a two-letter label that also occurs
                            // INSIDE two other labels rendered next to it
                            // ("NOFORN", "FED ONLY"): the paint must underline
                            // this concept's own occurrence and nothing else.
                            {
                                id: 'ONSITE',
                                name: 'On-Site Access Only',
                                views: { default: 'ON' },
                                categories: ['dissem'],
                                parents: [],
                                aliases: [],
                                position: 2,
                                rank: 1,
                            },
                        ],
                    },
                },
                rules: [],
                render: {
                    default: 'banner',
                    formats: [
                        {
                            id: 'banner',
                            surface: 'marking',
                            mode: 'inline',
                            view: 'default',
                            separator: '//',
                            joins: [
                                {
                                    between: [
                                        'specified_category',
                                        'basic_category',
                                    ],
                                    separator: '/',
                                },
                            ],
                            fields: [
                                {
                                    category: 'cui_designator',
                                    separator: '/',
                                },
                                {
                                    category: 'specified_category',
                                    separator: '/',
                                    each: { prefix: 'SP-' },
                                },
                                { category: 'basic_category', separator: '/' },
                                { category: 'dissem', separator: '/' },
                            ],
                        },
                    ],
                },
            },
        },
    }).scheme as LocalSchemeEngineAdapter;
}

let root: HTMLDivElement;
let forms: EzClassifyUI | null = null;

async function mount(
    engine: LocalSchemeEngineAdapter,
): Promise<{ input: HTMLTextAreaElement; field: MarkingField }> {
    root.innerHTML =
        '<textarea id="mf" data-ezclassify-controller="marking"></textarea>';
    forms = new EzClassifyUI(engine as never, { root });
    await wait();
    const input = document.getElementById('mf') as HTMLTextAreaElement;
    const field = forms.components.get(input) as MarkingField;
    expect(field).toBeInstanceOf(MarkingField);
    return { input, field };
}

/** Assert the assertions, then blur so the display paints its at-rest form. */
async function rest(
    input: HTMLTextAreaElement,
    field: MarkingField,
    assertions: { conceptId: string; categoryId: string }[],
): Promise<HTMLDivElement> {
    field.setAssertions(
        assertions.map((a) => ({
            ...a,
            confidence: 'certain' as const,
            source: 'test',
        })),
    );
    await wait();
    input.dispatchEvent(new FocusEvent('blur'));
    await wait(200);
    return root.querySelector('.marking-field-display') as HTMLDivElement;
}

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

describe('MarkingField at-rest paint fidelity', () => {
    it('paints unrecognized text even when the reading has no assertions', async () => {
        const { input, field } = await mount(createPrefixedEngine());
        await field.setValue('UNKNOWN-MARKING');
        input.dispatchEvent(new FocusEvent('blur'));
        await wait(200);
        expect(field.getAssertions()).toEqual([]);
        expect(input.value).toBe('UNKNOWN-MARKING');
        expect(root.querySelector('.marking-field-display')?.textContent).toBe(
            input.value,
        );
        expect(root.querySelector('[data-ezclassify-invalid]')).not.toBeNull();
    });
    it('paints the single "/" between two concepts of the same category, not a space', async () => {
        const { input, field } = await mount(createTieredEngine());
        const display = await rest(input, field, [
            { conceptId: 'SECRET', categoryId: 'level' },
            { conceptId: 'SI', categoryId: 'sci' },
            { conceptId: 'TK', categoryId: 'sci' },
            { conceptId: 'NOFORN', categoryId: 'dissem' },
        ]);

        expect(input.value).toBe('SECRET//SI/TK//NOFORN');
        expect(display.textContent).toBe('SECRET//SI/TK//NOFORN');
    });

    it("keeps a category's concept prefix and its alphabetical order in the paint", async () => {
        const { input, field } = await mount(createPrefixedEngine());
        const display = await rest(input, field, [
            { conceptId: 'CUI', categoryId: 'cui_designator' },
            { conceptId: 'EXPT', categoryId: 'specified_category' },
            { conceptId: 'PROPIN', categoryId: 'basic_category' },
            { conceptId: 'NOFORN', categoryId: 'dissem' },
            { conceptId: 'FED-ONLY', categoryId: 'dissem' },
        ]);

        expect(input.value).toBe('CUI//SP-EXPT/PROPIN//FED ONLY/NOFORN');
        expect(display.textContent).toBe(
            'CUI//SP-EXPT/PROPIN//FED ONLY/NOFORN',
        );
    });

    it("colors a value's own framing with it, and leaves separators plain text", async () => {
        const { input, field } = await mount(createPrefixedEngine());
        const display = await rest(input, field, [
            { conceptId: 'CUI', categoryId: 'cui_designator' },
            { conceptId: 'EXPT', categoryId: 'specified_category' },
            { conceptId: 'PROPIN', categoryId: 'basic_category' },
            { conceptId: 'NOFORN', categoryId: 'dissem' },
            { conceptId: 'FED-ONLY', categoryId: 'dissem' },
        ]);

        // Every painted run is a real token run in reading order. "SP-" is the
        // category's per-value prefix, carried by the token tree as the value's
        // `each` affix, so it is painted with the value it frames.
        const runs = Array.from(
            display.querySelectorAll('.marking-field-token-run'),
        ).map((r) => r.textContent);
        expect(runs).toEqual([
            'CUI',
            'SP-EXPT',
            'PROPIN',
            'FED',
            'ONLY',
            'NOFORN',
        ]);
        // Multi-word labels split into per-word runs and leave spaces undecorated.
        for (const run of runs) expect(run).not.toMatch(/^\s*$/);
        // Text outside token spans consists only of separators.
        const outside = Array.from(display.childNodes)
            .filter((n) => n.nodeType === Node.TEXT_NODE)
            .map((n) => n.textContent);
        expect(outside).toEqual(['//', '/', '//', '/']);
        expect(input.value).toBe('CUI//SP-EXPT/PROPIN//FED ONLY/NOFORN');
    });

    it('never paints a short token label where it only occurs inside a longer word', async () => {
        const { input, field } = await mount(createPrefixedEngine());
        const display = await rest(input, field, [
            { conceptId: 'CUI', categoryId: 'cui_designator' },
            { conceptId: 'NOFORN', categoryId: 'dissem' },
            { conceptId: 'FED-ONLY', categoryId: 'dissem' },
            { conceptId: 'ONSITE', categoryId: 'dissem' },
        ]);

        expect(input.value).toBe('CUI//FED ONLY/NOFORN/ON');
        expect(display.textContent).toBe('CUI//FED ONLY/NOFORN/ON');
        // "ON" underlines its own token at the end, never the "ON" inside
        // "ONLY" or the one inside "NOFORN".
        const runs = Array.from(
            display.querySelectorAll('.marking-field-token-run'),
        ).map((r) => r.textContent);
        expect(runs).toEqual(['CUI', 'FED', 'ONLY', 'NOFORN', 'ON']);
    });
});
