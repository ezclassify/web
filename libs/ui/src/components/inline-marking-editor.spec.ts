/**
 * InlineMarkingEditor: the inline editor MarkedInput and MarkedTextArea open
 * inside a marking. It is the shared composer's input, so these cases pin what
 * is specific to the editor (its inline input, its seeding, what it hands the
 * host on commit, where it mounts its live region) and re-run the field
 * family's commit table against it with the real engine. The table itself is
 * proven across all four fields in `composer/composer-contract.spec.ts`.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { InlineMarkingEditor } from './inline-marking-editor';
import { Context } from '@ezclassify/engine';
import type { Assertion, LocalSchemeEngineAdapter } from '@ezclassify/types';
import {
    activeRow,
    allSurfaces,
    leave,
    openSurface,
    press,
    resultValue,
    rowFor,
    rowLabels,
    rows,
    typeText,
    wait,
} from './composer/composer-harness';

const toCtx = (eng: unknown) => Context.fromSchemeEngine(eng as never);

function createRealEngine(): LocalSchemeEngineAdapter {
    const concepts = [
        {
            id: 'U',
            name: 'Unclassified',
            views: { default: 'U' },
            categories: ['level'],
            parents: [],
            aliases: [],
            position: 1,
            rank: 1,
        },
        {
            id: 'S',
            name: 'Secret',
            views: { default: 'S' },
            categories: ['level'],
            parents: [],
            aliases: [],
            position: 2,
            rank: 2,
        },
        {
            id: 'NF',
            name: 'No Foreign',
            views: { default: 'NF' },
            categories: ['caveat'],
            parents: [],
            aliases: [],
            position: 1,
            rank: 1,
        },
        {
            id: 'SI',
            name: 'Special Intelligence',
            views: { default: 'SI' },
            categories: ['caveat'],
            parents: [],
            aliases: [],
            position: 5,
            rank: 1,
        },
        {
            id: 'TK',
            name: 'Talent Keyhole',
            views: { default: 'TK' },
            categories: ['caveat'],
            parents: [],
            aliases: [],
            position: 6,
            rank: 1,
        },
        {
            id: 'REL',
            name: 'Releasable',
            views: { default: 'REL' },
            categories: ['caveat'],
            parents: [],
            aliases: [],
            position: 7,
            rank: 1,
        },
        {
            id: 'USA',
            name: 'United States',
            views: { default: 'USA' },
            categories: ['rel_countries'],
            parents: [],
            aliases: [],
            position: 1,
            rank: 1,
        },
        {
            id: 'GBR',
            name: 'United Kingdom',
            views: { default: 'GBR' },
            categories: ['rel_countries'],
            parents: [],
            aliases: [],
            position: 2,
            rank: 1,
        },
        {
            id: 'MAIN',
            name: 'Our School',
            views: { default: 'OUR SCHOOL' },
            categories: ['branch'],
            parents: [],
            aliases: [],
            position: 1,
            rank: 1,
        },
    ];
    const categories = [
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
        {
            id: 'branch',
            label: 'Branch',
            required: false,
            single: true,
            rollup: 'max',
            position: 3,
        },
        {
            id: 'rel_countries',
            label: 'REL Countries',
            required: false,
            single: false,
            rollup: 'union',
            position: 4,
        },
    ];
    return Context.fromComponents({
        scheme: {
            scheme: {
                id: 'ime-test',
                version: '1.0.0',
                name: 'InlineMarkingEditor Test',
                data: { concepts: { inline: concepts }, categories },
                rules: [
                    {
                        id: 'rel-countries-require-rel',
                        when: {
                            category: 'rel_countries',
                            is: 'has_content',
                        },
                        action: 'require',
                        target: 'REL',
                        category: 'caveat',
                    },
                ],
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
                            separator: '//',
                            // Deliberately binds no field to 'branch':
                            // that category's concept is
                            // certain/asserted but never rendered.
                            //
                            // REL heads rel_countries, so a header and
                            // the list it heads are paired in the
                            // format tree: one fixed-concept field
                            // beside one list field.
                            fields: [
                                {
                                    category: 'level',
                                    separator: '/',
                                },
                                {
                                    category: 'caveat',
                                    separator: '/',
                                    exclude_concepts: ['REL'],
                                },
                                {
                                    name: 'Releasability phrase',
                                    separator: '//',
                                    fields: [
                                        {
                                            concept: 'REL',
                                            category: 'caveat',
                                        },
                                        {
                                            category: 'rel_countries',
                                            separator: '/',
                                        },
                                    ],
                                },
                            ],
                        },
                    ],
                },
            },
        },
    }).scheme as LocalSchemeEngineAdapter;
}

function assertionsFor(ids: string[]): Assertion[] {
    const category: Record<string, string> = {
        U: 'level',
        S: 'level',
        NF: 'caveat',
        SI: 'caveat',
        TK: 'caveat',
        REL: 'caveat',
        USA: 'rel_countries',
        GBR: 'rel_countries',
        MAIN: 'branch',
    };
    return ids.map((id) => ({
        conceptId: id,
        categoryId: category[id],
        confidence: 'certain' as const,
        source: 'user' as const,
    }));
}

let container: HTMLDivElement;
let root: HTMLDivElement;
let editor: InlineMarkingEditor | null;

async function open(
    initial = '',
    ids: string[] = [],
    options: Partial<Parameters<InlineMarkingEditor['init']>[3]> = {},
): Promise<{ editor: InlineMarkingEditor; input: HTMLInputElement }> {
    editor = new InlineMarkingEditor();
    await editor.init(container, toCtx(createRealEngine()), initial, {
        formatId: 'default',
        schemeId: 'ime-test',
        assertions: ids.length ? assertionsFor(ids) : undefined,
        root,
        ...options,
    });
    // The editor focuses itself and opens the composer on the next frame.
    await wait(40);
    const input = container.querySelector(
        '.inline-editor-input',
    ) as HTMLInputElement;
    return { editor, input };
}

async function type(input: HTMLInputElement, text: string): Promise<void> {
    typeText(input, text);
    await wait(40);
}

beforeEach(() => {
    document.body.innerHTML = '';
    root = document.createElement('div');
    root.innerHTML = '<label for="host">Document marking</label>';
    container = document.createElement('div');
    root.appendChild(container);
    document.body.appendChild(root);
    Element.prototype.scrollIntoView = vi.fn();
    editor = null;
});

afterEach(() => {
    editor?.destroy();
    document.body.innerHTML = '';
});

describe('InlineMarkingEditor', () => {
    it('mounts an inline text input that looks like the surrounding text', async () => {
        const { input } = await open();
        expect(container.querySelector('.inline-editor-wrap')).not.toBeNull();
        expect(input.type).toBe('text');
        expect(input.className).toBe('inline-editor-input');
    });

    it('rounds the editor hit width up so punctuation cannot click through to the host field', async () => {
        const { editor } = await open();
        const internal = editor as unknown as {
            input: HTMLInputElement;
            sizer: HTMLSpanElement;
            autoSizeInput: () => void;
        };
        vi.spyOn(internal.sizer, 'getBoundingClientRect').mockReturnValue({
            width: 42.25,
        } as DOMRect);

        internal.autoSizeInput();

        expect(internal.input.style.width).toBe('43px');
    });

    it('treats a press within unfinished text as caret navigation, not an outside commit', async () => {
        const { input } = await open();
        input.value = 'S//SI/REL TO , AUS';
        const outsideClick = vi.fn();
        document.addEventListener('mousedown', outsideClick);

        input.dispatchEvent(
            new MouseEvent('mousedown', { bubbles: true, cancelable: true }),
        );

        expect(outsideClick).not.toHaveBeenCalled();
        expect(input.value).toBe('S//SI/REL TO , AUS');
        document.removeEventListener('mousedown', outsideClick);
    });

    it('opens the composer on the document body, outside any clipping ancestor', async () => {
        container.style.overflow = 'hidden';
        await open();
        const surface = openSurface()!;
        expect(surface).not.toBeNull();
        expect(surface.parentElement).toBe(document.body);
        expect(container.contains(surface)).toBe(false);
    });

    it('mounts its live region and invalid-draft note beside the field, outside the inline mount', async () => {
        const { editor } = await open();
        const announcer = root.querySelector('[aria-live="polite"]');
        expect(announcer).not.toBeNull();
        expect(container.contains(announcer)).toBe(false);
        expect(root.querySelector('.ez-composer-note')).not.toBeNull();
        expect(
            editor.owns(root.querySelector('.ez-composer-note') as Node),
        ).toBe(true);
    });

    it('is a combobox named from the host field, browsing the scheme when it opens', async () => {
        const label = root.querySelector('label')!;
        label.id = 'host-label';
        const { input } = await open('S', ['S'], {
            label: () => ({ id: label.id, text: label.textContent ?? '' }),
        });
        expect(input.getAttribute('role')).toBe('combobox');
        expect(input.getAttribute('aria-autocomplete')).toBe('list');
        expect(input.getAttribute('aria-labelledby')).toBe('host-label');
        // Opening lists by category rather than completing the word the
        // caret happens to follow.
        expect(
            openSurface()!.querySelectorAll('.ez-composer__group-label').length,
        ).toBeGreaterThan(1);
    });

    it('seeds from the given assertions and keeps the loaded text byte for byte', async () => {
        const { editor, input } = await open('S//NF', ['S', 'NF']);
        expect(editor.getRendered()).toBe('S//NF');
        expect(editor.getAssertions().map((a) => a.conceptId)).toEqual([
            'S',
            'NF',
        ]);
        expect(input.value).toBe('S//NF');
        expect(editor.isDirty()).toBe(false);
    });

    it('does not apply or record a repair merely by opening a loaded marking', async () => {
        const { editor, input } = await open('s//nf');
        expect(input.value).toBe('s//nf');
        expect(editor.getRendered()).toBe('s//nf');
        expect(editor.getAppliedFixes()).toEqual([]);
    });

    it('returns empty state for empty initial value', async () => {
        const { editor } = await open();
        expect(editor.getRendered()).toBe('');
        expect(editor.getAssertions()).toEqual([]);
    });

    it('focus() keeps focus in the phone sheet while it is open, so a host focusing the editor after mounting does not drop the keyboard', async () => {
        const realMatchMedia = window.matchMedia;
        const realWidth = window.innerWidth;
        window.matchMedia = ((q: string) => ({
            matches: q.includes('coarse'),
            media: q,
            addEventListener() {},
            removeEventListener() {},
        })) as unknown as typeof window.matchMedia;
        Object.defineProperty(window, 'innerWidth', {
            configurable: true,
            value: 390,
        });
        try {
            const { editor: first, input } = await open();
            const sheetInput = document.querySelector(
                '.ez-composer__sheet-input',
            ) as HTMLInputElement;
            expect(document.activeElement).toBe(sheetInput);
            first.focus();
            expect(document.activeElement).toBe(sheetInput);
            expect(document.activeElement).not.toBe(input);
            first.destroy();

            // A caret-driven open (no list) followed by the shortcut before
            // the editor's first frame: the sheet it opens keeps focus.
            const late = new InlineMarkingEditor();
            editor = late;
            await late.init(container, toCtx(createRealEngine()), '', {
                formatId: 'default',
                schemeId: 'ime-test',
                root,
                openList: false,
            });
            const lateInput = container.querySelector(
                '.inline-editor-input',
            ) as HTMLInputElement;
            press(lateInput, 'Enter', { ctrlKey: true });
            await wait(40);
            const lateSheet = document.querySelector(
                '.ez-composer:not([hidden]) .ez-composer__sheet-input',
            );
            expect(lateSheet).not.toBeNull();
            expect(document.activeElement).toBe(lateSheet);
        } finally {
            window.matchMedia = realMatchMedia;
            Object.defineProperty(window, 'innerWidth', {
                configurable: true,
                value: realWidth,
            });
        }
    });

    it('destroys cleanly, taking its surface with it', async () => {
        const { editor } = await open();
        editor.destroy();
        expect(container.querySelector('.inline-editor-wrap')).toBeNull();
        expect(allSurfaces()).toEqual([]);
    });

    it('opens a typed draft as uncommitted: the result row reads it and Enter stores it', async () => {
        const onChange = vi.fn();
        const { editor, input } = await open('', [], {
            draft: 's nf',
            onChange,
        });
        expect(input.value).toBe('s nf');
        expect(editor.isDirty()).toBe(true);
        await wait(40);
        expect(resultValue()).toBe('S//NF');
        press(input, 'Enter');
        await wait(80);
        expect(onChange).toHaveBeenCalledWith(
            'S//NF',
            expect.arrayContaining([
                expect.objectContaining({ conceptId: 'S' }),
                expect.objectContaining({ conceptId: 'NF' }),
            ]),
        );
    });

    it('offers a correction for a typo in a moved-in draft', async () => {
        const { input } = await open('', [], { draft: 'secrte' });
        await wait(40);
        press(input, 'Enter');
        await wait(80);
        // Not stored: the draft stays, marked invalid, with the reason.
        expect(input.getAttribute('aria-invalid')).toBe('true');
        expect(root.querySelector('.ez-composer-note')?.textContent).toContain(
            'Did you mean S?',
        );
    });
});

describe('InlineMarkingEditor under the commit table', () => {
    it('ranks prefix and word-start matches and keeps mid-word matches behind "more"', async () => {
        const { input } = await open();
        await type(input, 'T');
        // TK starts with T; nothing else does, so nothing waits behind more.
        expect(rowLabels()).toEqual(['TK']);
        expect(activeRow(input)?.textContent).toContain('TK');
        await type(input, 'L');
        // "L" starts no spelling of any concept here and appears only inside
        // words: mid-word matches are not offered as completions.
        expect(rowLabels()).toEqual([]);
        expect(rows().map((r) => r.dataset.kind)).toEqual(['more']);
    });

    it('Enter accepts the armed row exactly like Tab, and stores nothing until the commit', async () => {
        const onChange = vi.fn();
        const { input } = await open('', [], { onChange });
        await type(input, 'S//T');
        const enter = press(input, 'Enter');
        await wait(40);
        expect(enter.defaultPrevented).toBe(true);
        expect(input.value).toBe('S//TK');
        expect(onChange).not.toHaveBeenCalled();

        press(input, 'Enter');
        await wait(80);
        expect(onChange).toHaveBeenCalledWith('S//TK', expect.any(Array));
    });

    it('Enter mid-IME-composition does not accept or commit', async () => {
        const onChange = vi.fn();
        const { input } = await open('', [], { onChange });
        await type(input, 'T');
        const enter = press(input, 'Enter', { isComposing: true });
        await wait(40);
        expect(enter.defaultPrevented).toBe(false);
        expect(input.value).toBe('T');
        expect(onChange).not.toHaveBeenCalled();
    });

    it('Enter with nothing active commits and asks the host to close the editor', async () => {
        const onExit = vi.fn();
        const { input } = await open('S', ['S'], { onExit });
        await type(input, 'S//NF');
        const enter = press(input, 'Enter');
        await wait(80);
        expect(enter.defaultPrevented).toBe(true);
        expect(onExit).toHaveBeenCalledWith('commit', false);
    });

    it('shows selected concepts as checked rows and removes one when pressed', async () => {
        const onChange = vi.fn();
        const { editor, input } = await open('S//NF', ['S', 'NF'], {
            onChange,
        });
        const checked = rows().filter(
            (r) => r.getAttribute('aria-selected') === 'true',
        );
        expect(checked).toHaveLength(2);
        rowFor('NF')!.click();
        await wait(40);
        expect(input.value.trim()).toBe('S');
        press(input, 'Enter');
        await wait(80);

        expect(editor.getRendered()).toBe('S');
        expect(editor.getAssertions().map((a) => a.conceptId)).toEqual(['S']);
    });

    it('removing a selected header also removes its owned assertions so they cannot infer the header back', async () => {
        const { editor, input } = await open('S//REL//USA/GBR', [
            'S',
            'REL',
            'USA',
            'GBR',
        ]);
        rowFor('REL')!.click();
        await wait(40);
        press(input, 'Enter');
        await wait(80);

        expect(editor.getRendered()).toBe('S');
        expect(editor.getAssertions().map((a) => a.conceptId)).toEqual(['S']);
    });

    it('does not resurrect deleted concepts when a different concept is accepted after a partial delete', async () => {
        const { editor, input } = await open('S//NF/SI/TK', [
            'S',
            'NF',
            'SI',
            'TK',
        ]);
        await type(input, 'S//');
        rowFor('REL')!.click();
        await wait(40);
        press(input, 'Enter');
        await wait(80);

        expect(
            editor
                .getAssertions()
                .map((a) => a.conceptId)
                .sort(),
        ).toEqual(['REL', 'S']);
        expect(editor.getRendered()).toBe('S//REL');
    });

    it('stores nothing for trailing text it cannot read, and keeps the text on screen', async () => {
        const onChange = vi.fn();
        const { editor, input } = await open('S//SI//NF', ['S', 'SI', 'NF'], {
            onChange,
        });
        await type(input, 'S//SI//NOT-A-CONCEPT');
        await expect(editor.commit()).resolves.toBe('invalid');
        expect(onChange).not.toHaveBeenCalled();
        expect(
            editor
                .getAssertions()
                .map((a) => a.conceptId)
                .sort(),
        ).toEqual(['NF', 'S', 'SI']);
        expect(input.value).toBe('S//SI//NOT-A-CONCEPT');
        expect(editor.isInvalid()).toBe(true);
    });

    it('a trailing separator with nothing after it commits the canonical marking', async () => {
        const { editor, input } = await open('S//SI//NF', ['S', 'SI', 'NF']);
        await type(input, 'S//SI//');
        await expect(editor.commit()).resolves.toBe('stored');
        expect(editor.getAssertions().map((a) => a.conceptId)).toEqual([
            'S',
            'SI',
        ]);
        expect(input.value).toBe('S//SI');
    });

    it('a complete token under the caret commits with the rest, the same result leaving the editor commits', async () => {
        const { editor, input } = await open('S//NF/TK', ['S', 'NF', 'TK']);
        // Retype the whole marking as three tolerant tokens; the last one is
        // a complete concept, so nothing is armed and Enter commits.
        await type(input, 'u//si/tk');
        expect(activeRow(input)).toBeNull();
        press(input, 'Enter');
        await wait(80);
        expect(
            editor
                .getAssertions()
                .map((a) => a.conceptId)
                .sort(),
        ).toEqual(['SI', 'TK', 'U']);
        expect(input.value).toBe('U//SI/TK');
    });

    it('retyping the whole marking offers what the old marking held back', async () => {
        const { input } = await open('S', ['S']);
        await type(input, 'U');
        expect(rowFor('U')).toBeTruthy();
    });

    it('arms the best match afresh on every keystroke instead of holding the last one by position', async () => {
        const { input } = await open('S', ['S']);
        await type(input, 'u//t');
        expect(activeRow(input)?.textContent).toContain('TK');
        // A separator ends the token: the list browses again, and an active
        // row carried over by position would make Enter accept whatever row
        // now sits there.
        await type(input, 'u//');
        expect(activeRow(input)).toBeNull();
    });

    it('carries a render-suppressed certain concept through keystrokes and an accept that follows a partial delete', async () => {
        const { editor, input } = await open('S//SI', ['S', 'SI', 'MAIN']);
        expect(editor.getRendered()).toBe('S//SI');
        await type(input, 'S//');
        rowFor('NF')!.click();
        await wait(40);
        press(input, 'Enter');
        await wait(80);

        // SI is gone; MAIN survives (carried forward, still invisible to the
        // format); NF is the new addition.
        expect(
            editor
                .getAssertions()
                .map((a) => a.conceptId)
                .sort(),
        ).toEqual(['MAIN', 'NF', 'S']);
        expect(editor.getRendered()).toBe('S//NF');
    });

    it('leaving the marking with Left or Right is a commit boundary; an unreadable draft stays', async () => {
        const onExit = vi.fn();
        const { input } = await open('S', ['S'], { onExit });
        await type(input, 'S zzz');
        input.setSelectionRange(input.value.length, input.value.length);
        press(input, 'ArrowRight');
        await wait(80);
        expect(onExit).not.toHaveBeenCalled();
        await type(input, 'S');
        input.setSelectionRange(1, 1);
        press(input, 'ArrowRight');
        await wait(80);
        expect(onExit).toHaveBeenCalledWith('right');
    });

    it('blur commits and reports the outcome to the host', async () => {
        const onBlurCommit = vi.fn();
        const { input } = await open('S', ['S'], { onBlurCommit });
        await type(input, 'S//NF');
        await leave(input);
        expect(onBlurCommit).toHaveBeenCalledWith('stored');
    });

    it('a second commit in one session replaces the first, and its fixes go with it', async () => {
        const { editor, input } = await open();
        await type(input, 's');
        press(input, 'Enter');
        await wait(80);
        expect(editor.getRendered()).toBe('S');
        expect(editor.getAppliedFixes().map((f) => f.message)).toEqual([
            'Read `s` as `S` (case).',
        ]);

        await type(input, 'U');
        press(input, 'Enter');
        await wait(80);
        expect(editor.getRendered()).toBe('U');
        expect(editor.getAppliedFixes()).toEqual([]);
    });

    it('a second commit in one session lists its own fixes in place of the first', async () => {
        const { editor, input } = await open();
        await type(input, 's');
        press(input, 'Enter');
        await wait(80);

        await type(input, 'u');
        press(input, 'Enter');
        await wait(80);
        expect(editor.getRendered()).toBe('U');
        expect(editor.getAppliedFixes().map((f) => f.message)).toEqual([
            'Read `u` as `U` (case).',
        ]);
    });

    it('Escape closes the list first, reverts the draft second, and asks the host to cancel third', async () => {
        const onCancel = vi.fn();
        const { input } = await open('S', ['S'], { onCancel });
        await type(input, 'S//NF');
        press(input, 'Escape');
        await wait();
        expect(openSurface()).toBeNull();
        expect(input.value).toBe('S//NF');
        press(input, 'Escape');
        await wait();
        expect(input.value).toBe('S');
        expect(onCancel).not.toHaveBeenCalled();
        press(input, 'Escape');
        expect(onCancel).toHaveBeenCalled();
    });
});
