/**
 * A pick from the list is a structural edit, the same as a fix: the concept is
 * added to (or, on a checked row, removed from) what the draft reads as, and
 * the draft becomes that marking as the format writes it. The text is never
 * spliced, so a pick gets the format's own separators ("//" between categories,
 * "/" within one), reads as picked, and a second press removes it.
 *
 * Driven through MarkingField and TagInput over a real engine, with a scheme
 * shaped like a classification banner: one level, a multi-choice control system
 * category and a multi-choice dissemination category.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Context } from '@ezclassify/engine';
import type { Assertion } from '@ezclassify/types';
import { EzClassifyUI } from '../../ezclassify-ui';
import {
    openSurface,
    press,
    resultValue,
    rowFor,
    wait,
} from './composer-harness';

function createContext() {
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
    return Context.fromComponents({
        scheme: {
            scheme: {
                id: 'composer-pick',
                version: '1.0.0',
                name: 'Composer Pick',
                data: {
                    concepts: {
                        inline: [
                            concept('U', 'UNCLASSIFIED', 'level', 1),
                            concept('S', 'SECRET', 'level', 2),
                            concept('SI', 'SI', 'control', 1),
                            concept('TK', 'TK', 'control', 2),
                            concept('NF', 'NOFORN', 'dissem', 1),
                            concept('REL', 'REL TO', 'dissem', 2),
                            concept('DO', 'DISPLAY ONLY', 'dissem', 3),
                            concept('USA', 'USA', 'rel', 0),
                            // Two countries that belong to both lists.
                            {
                                ...concept('AUS', 'AUS', 'rel', 1),
                                categories: ['rel', 'disp'],
                            },
                            {
                                ...concept('CAN', 'CAN', 'rel', 2),
                                categories: ['rel', 'disp'],
                            },
                        ],
                    },
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
                            id: 'control',
                            label: 'Control system',
                            required: false,
                            single: false,
                            rollup: 'union',
                            position: 2,
                        },
                        {
                            id: 'dissem',
                            label: 'Dissemination',
                            required: false,
                            single: false,
                            rollup: 'union',
                            position: 3,
                        },
                        {
                            id: 'rel',
                            label: 'Releasable To',
                            required: false,
                            single: false,
                            rollup: 'intersection',
                            position: 4,
                        },
                        {
                            id: 'disp',
                            label: 'Display Only To',
                            required: false,
                            single: false,
                            rollup: 'intersection',
                            position: 5,
                        },
                    ],
                },
                // The two values of one category that cannot go together.
                rules: [
                    {
                        id: 'nf-excludes-do',
                        name: 'NOFORN excludes DISPLAY ONLY',
                        action: 'exclusive',
                        target: ['NF', 'DO'],
                        rank: ['NF', 'DO'],
                        message: 'NOFORN cannot be combined with DISPLAY ONLY.',
                    },
                    // A REL TO list starts with USA: the engine infers it.
                    {
                        id: 'rel-starts-with-usa',
                        name: 'REL TO starts with USA',
                        when: 'REL',
                        action: 'require',
                        target: 'USA',
                        category: 'rel',
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
                                { category: 'control', separator: '/' },
                                {
                                    category: 'dissem',
                                    separator: '/',
                                    // The country lists are written only
                                    // under their own dissemination value.
                                    phrases: [
                                        {
                                            head: 'REL',
                                            separator: ' ',
                                            fields: [
                                                {
                                                    category: 'rel',
                                                    separator: ', ',
                                                },
                                            ],
                                        },
                                        {
                                            head: 'DO',
                                            separator: ' ',
                                            fields: [
                                                {
                                                    category: 'disp',
                                                    separator: ', ',
                                                },
                                            ],
                                        },
                                    ],
                                },
                            ],
                        },
                    ],
                },
            },
        },
    });
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
});

const START = 'SECRET//SI/TK//NOFORN';

/** Mount a field holding START and open its list, browsing. */
async function open(kind: 'marking' | 'tags') {
    const tag = kind === 'tags' ? 'input' : 'textarea';
    root.innerHTML = `<input type="hidden" id="doc" data-ezclassify-rendered /><label for="f">Marking</label><${tag} id="f" data-ezclassify-controller="${kind}" data-ezclassify-bound-to="doc"></${tag}>`;
    forms = new EzClassifyUI(createContext() as never, { root });
    await wait();
    await forms.store.publishRendered('doc', START);
    await wait();
    const host = document.getElementById('f') as HTMLElement;
    const input =
        kind === 'tags'
            ? root.querySelector<HTMLInputElement>('.tag-input-filter')!
            : (host as HTMLTextAreaElement);
    input.focus();
    press(input, 'ArrowDown');
    await wait(100);
    expect(openSurface()).not.toBeNull();
    const stored = () =>
        forms!.store
            .get('doc')
            .assertions.map((a: Assertion) => a.conceptId)
            .sort();
    return { input, stored };
}

async function pick(label: string): Promise<void> {
    rowFor(label)!.click();
    await wait(100);
}

const checked = (label: string) =>
    rowFor(label)?.getAttribute('aria-selected') === 'true';

const ruleShown = () =>
    openSurface()?.querySelector('.ez-composer__result')?.textContent ?? '';
const fixRows = () =>
    [
        ...(openSurface()?.querySelectorAll<HTMLElement>(
            '[role="option"][data-kind="fix"]',
        ) ?? []),
    ].map((r) => r.textContent?.trim());

describe.each(['marking', 'tags'] as const)('a pick in %s', (kind) => {
    it('adds within a category with its separator, leaves exactly the marking, and a second press removes it', async () => {
        const { input } = await open(kind);
        await pick('REL TO');
        expect(resultValue()).toBe('SECRET//SI/TK//NOFORN/REL TO USA');
        // Exactly the rendering: no trailing separator or space.
        if (kind === 'marking') {
            expect(input.value).toBe('SECRET//SI/TK//NOFORN/REL TO');
        } else {
            expect(input.value).toBe('');
        }
        expect(checked('REL TO')).toBe(true);

        await pick('REL TO');
        expect(resultValue()).toBe(START);
        if (kind === 'marking') expect(input.value).toBe(START);
        // Removed, it stays listed, unchecked, to be added back.
        expect(rowFor('REL TO')).toBeDefined();
        expect(checked('REL TO')).toBe(false);
    });

    it('applies a pick that breaks a rule, shows the rule and its fixes, and reads as picked', async () => {
        const { input, stored } = await open(kind);
        await pick('DISPLAY ONLY');
        // Applied, not refused: the draft holds both, and says what is wrong.
        if (kind === 'marking') {
            expect(input.value).toBe('SECRET//SI/TK//NOFORN/DISPLAY ONLY');
        }
        expect(checked('DISPLAY ONLY')).toBe(true);
        expect(checked('NOFORN')).toBe(true);
        expect(ruleShown()).toContain(
            'NOFORN cannot be combined with DISPLAY ONLY.',
        );
        expect(fixRows()).toEqual(
            expect.arrayContaining(['Remove NOFORN', 'Remove DISPLAY ONLY']),
        );
        // A second press takes it back out.
        await pick('DISPLAY ONLY');
        expect(checked('DISPLAY ONLY')).toBe(false);
        expect(ruleShown()).not.toContain('cannot be combined');
        expect(stored()).toEqual(['NF', 'S', 'SI', 'TK']);
    });

    it('after a removal, adds a new category value with the separator between categories', async () => {
        const { input, stored } = await open(kind);
        await pick('NOFORN');
        expect(resultValue()).toBe('SECRET//SI/TK');
        await pick('REL TO');
        expect(resultValue()).toBe('SECRET//SI/TK//REL TO USA');
        if (kind === 'marking') {
            expect(input.value).toBe('SECRET//SI/TK//REL TO');
        }
        expect(checked('REL TO')).toBe(true);
        // Nothing is stored until the commit.
        expect(stored()).toEqual(['NF', 'S', 'SI', 'TK']);
    });
});

describe.each(['marking', 'tags'] as const)(
    'a list the draft calls for, in %s',
    (kind) => {
        it('lists every concept of a category offered once the draft calls for it, a concept in two categories under each', async () => {
            await open(kind);
            await pick('NOFORN');
            await pick('REL TO');
            await wait(100);
            // The Releasable To list is offered now, all of it: not only a
            // country the draft already holds.
            const inGroup = (group: string) =>
                [
                    ...(openSurface()?.querySelectorAll<HTMLElement>(
                        '[role="group"]',
                    ) ?? []),
                ]
                    .find((g) =>
                        g
                            .querySelector('.ez-composer__group-label')
                            ?.textContent?.includes(group),
                    )
                    ?.querySelectorAll('.ez-composer__short');
            const rel = [...(inGroup('Releasable To') ?? [])].map(
                (e) => e.textContent,
            );
            // Exactly one row per concept, though the draft and the list
            // offered for it both hold USA.
            expect([...rel].sort()).toEqual(['AUS', 'CAN', 'USA']);
            const ids = [
                ...(openSurface()?.querySelectorAll<HTMLElement>(
                    '[role="option"]',
                ) ?? []),
            ].map((r) => r.id);
            expect(new Set(ids).size).toBe(ids.length);
            // USA is there because the engine infers it. The draft states
            // what the user picked; "Saves as" shows the USA, and its row is
            // marked inferred.
            expect(resultValue()).toBe('SECRET//SI/TK//REL TO USA');
            if (kind === 'marking') {
                expect(
                    document.querySelector<HTMLTextAreaElement>('#f')!.value,
                ).toBe('SECRET//SI/TK//REL TO');
            }
            const usa = rowFor('USA')!;
            expect(usa.classList).toContain('ez-composer__row--inferred');
            expect(usa.textContent).toContain('inferred');

            await pick('AUS');
            expect(resultValue()).toBe('SECRET//SI/TK//REL TO USA, AUS');
            expect(checked('AUS')).toBe(true);
        });
    },
);

describe('the engine calls one keystroke makes', () => {
    /** Type `text` into the draft the way a keystroke does. */
    async function type(
        input: HTMLInputElement | HTMLTextAreaElement,
        text: string,
    ) {
        input.value = text;
        input.setSelectionRange(text.length, text.length);
        input.dispatchEvent(new Event('input', { bubbles: true }));
        await wait(100);
    }

    it('reads a whole draft with one process call, and asks once what its new facts offer', async () => {
        const { input } = await open('marking');
        const engine = forms!.engine;
        const process = vi.spyOn(engine, 'process');
        const validate = vi.spyOn(engine, 'validate');
        const suggest = vi.spyOn(engine, 'suggest');

        // A separator ends the word, so nothing is being searched for.
        await type(input, 'SECRET//SI/TK//REL TO/');

        expect(process).toHaveBeenCalledTimes(1);
        expect(process.mock.calls[0][0]).toBe('SECRET//SI/TK//REL TO/');
        expect(process.mock.calls[0][1]).not.toHaveProperty('suggestFor');
        expect(validate).not.toHaveBeenCalled();
        // REL TO is new, so the list asks what the draft offers now.
        expect(suggest).toHaveBeenCalledTimes(1);
        expect(suggest.mock.calls[0][0] as Assertion[]).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ conceptId: 'REL' }),
            ]),
        );
    });

    it('asks nothing beyond the read when a keystroke changes no fact, and the read carries no picker options', async () => {
        const { input } = await open('marking');
        const engine = forms!.engine;
        const process = vi.spyOn(engine, 'process');
        const suggest = vi.spyOn(engine, 'suggest');

        await type(input, `${START}/`);

        expect(process).toHaveBeenCalledTimes(1);
        expect(process.mock.calls[0][1]).not.toHaveProperty('suggestFor');
        expect(await process.mock.results[0].value).not.toHaveProperty(
            'suggestionsFor',
        );
        expect(suggest).not.toHaveBeenCalled();
    });

    it('reads an additive draft with one read of the text and one process call', async () => {
        const { input } = await open('tags');
        const engine = forms!.engine;
        const process = vi.spyOn(engine, 'process');
        const validate = vi.spyOn(engine, 'validate');

        await type(input, 'UNCLASSIFIED ');

        expect(validate).toHaveBeenCalledTimes(1);
        expect(process).toHaveBeenCalledTimes(1);
        // The typed level replaces the held one; the rest of the value goes
        // beside the text as facts already chosen.
        const [text, options] = process.mock.calls[0];
        expect(text).toBe('UNCLASSIFIED ');
        expect(
            (options as { assertions?: Assertion[] }).assertions
                ?.map((a) => a.conceptId)
                .sort(),
        ).toEqual(['NF', 'SI', 'TK']);
        expect(options).not.toHaveProperty('suggestFor');
        expect(resultValue()).toBe('UNCLASSIFIED//SI/TK//NOFORN');
    });
});
