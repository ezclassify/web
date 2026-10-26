/**
 * The cross-component contract: TagInput, MarkingField, MarkedInput and
 * MarkedTextArea driven through the same keystrokes and presses, over the same
 * real engine and scheme, must store identical results.
 *
 * This is the test the commit table in `composer-controller.ts` is written
 * against. Every case runs once per field; a field that grows its own answer to
 * Enter, Tab, blur, a row press or Escape fails here, next to the other three
 * that did not.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Context } from '@ezclassify/engine';
import type { Assertion } from '@ezclassify/types';
import { EzClassifyUI } from '../../ezclassify-ui';
import type { MarkedTextArea } from '../marked-text-area';
import {
    activeRow,
    leave,
    openSurface,
    press,
    resultValue,
    rowFor,
    rows,
    typeText,
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
                id: 'composer-contract',
                version: '1.0.0',
                name: 'Composer Contract',
                data: {
                    concepts: {
                        inline: [
                            concept('U', 'UNCLASSIFIED', 'level', 1),
                            concept('S', 'SECRET', 'level', 2),
                            concept('NF', 'NOFORN', 'caveat', 1),
                            concept('OC', 'ORCON', 'caveat', 2),
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
                                { category: 'caveat', separator: '/' },
                            ],
                        },
                    ],
                },
            },
        },
    });
}

type Kind = 'tags' | 'marking' | 'marked-input' | 'marked-textarea';
const KINDS: Kind[] = ['tags', 'marking', 'marked-input', 'marked-textarea'];

interface Field {
    /** The composer's input, once the field is open for editing. */
    input(): HTMLInputElement | HTMLTextAreaElement;
    /** What the field stores, as sorted concept ids. */
    stored(): string[];
    /** The host's own native value. */
    host: HTMLInputElement | HTMLTextAreaElement;
}

let root: HTMLDivElement;
let forms: EzClassifyUI | null = null;

function ids(assertions: readonly Assertion[]): string[] {
    return assertions
        .filter((a) => a.confidence !== 'inferred')
        .map((a) => a.conceptId)
        .sort();
}

/**
 * Mount one field, focus it and open it for editing the way a keyboard user
 * does: TagInput and MarkingField take focus and ArrowDown; the two marked
 * fields take Ctrl+Enter, their documented shortcut.
 */
async function mountField(kind: Kind): Promise<Field> {
    const tag = kind === 'marked-textarea' ? 'textarea' : 'input';
    root.innerHTML = `<label for="f">Marking</label><${tag} id="f" data-ezclassify-controller="${kind}"></${tag}>`;
    forms = new EzClassifyUI(createContext() as never, { root });
    await wait();
    const host = document.getElementById('f') as
        HTMLInputElement | HTMLTextAreaElement;
    // TagInput registers as an autocompleter, the others as components.
    const component =
        forms.components.get(host) ??
        (
            forms as unknown as {
                autocompleters: Map<Element, { getAssertions(): Assertion[] }>;
            }
        ).autocompleters.get(host)!;
    const input = () => {
        if (kind === 'tags') {
            return root.querySelector('.tag-input-filter') as HTMLInputElement;
        }
        if (kind === 'marking')
            return root.querySelector<HTMLTextAreaElement>(
                '.marking-field-host',
            )!;
        return root.querySelector('.inline-editor-input') as HTMLInputElement;
    };
    const stored = () => {
        if (kind === 'marked-textarea') {
            const segments = (component as MarkedTextArea).getSegments();
            return ids(segments.flatMap((s) => s.assertions));
        }
        return ids(component.getAssertions());
    };
    if (kind === 'marked-input' || kind === 'marked-textarea') {
        host.focus();
        press(document.activeElement as HTMLElement, 'Enter', {
            ctrlKey: true,
        });
        await wait(120);
    } else {
        input().focus();
        press(input(), 'ArrowDown');
        await wait();
    }
    expect(openSurface()).not.toBeNull();
    return { input, stored, host };
}

async function type(field: Field, text: string): Promise<void> {
    typeText(field.input(), text);
    await wait();
}

async function key(field: Field, name: string): Promise<KeyboardEvent> {
    const event = press(field.input(), name);
    await wait();
    return event;
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

/**
 * A row picked with the mouse, the way a browser delivers it: pointerdown and
 * mousedown on the row (the surface keeps focus in the input), then the click.
 * jsdom has no PointerEvent, so the pointer events go out as plain mouse events
 * carrying the pointer event names.
 */
function mousePick(row: HTMLElement): void {
    row.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    row.dispatchEvent(
        new MouseEvent('mousedown', { bubbles: true, cancelable: true }),
    );
    row.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }));
    row.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    row.dispatchEvent(new MouseEvent('click', { bubbles: true }));
}

describe.each(['tags', 'marking'] as const)(
    'a mouse pick in %s, then leaving the field',
    (kind) => {
        for (const [how, next] of [
            ['clicking elsewhere', null],
            ['tabbing to the next field', 'button'],
        ] as const) {
            it(`stores the pick when leaving by ${how}`, async () => {
                const field = await mountField(kind);
                const other = document.createElement(next ?? 'div');
                other.tabIndex = 0;
                root.appendChild(other);
                await type(field, 'sec');
                mousePick(rowFor('SECRET')!);
                await wait();
                expect(field.stored()).toEqual([]);
                // Focus leaves a while after the pick, on its own event.
                await wait(50);
                const input = field.input();
                input.blur();
                input.dispatchEvent(
                    new FocusEvent('blur', {
                        relatedTarget: next ? other : null,
                    }),
                );
                if (next) other.focus();
                await wait(250);
                expect(field.stored()).toEqual(['S']);
                expect(document.activeElement).not.toBe(input);
            });
        }
    },
);

describe('leaving a field whose text reads as what it already stores', () => {
    it('MarkingField: a picked, already-stored value leaves the text as the stored rendering, without the separator the pick added', async () => {
        const field = await mountField('marking');
        await type(field, 'sec');
        mousePick(rowFor('SECRET')!);
        await wait();
        await leave(field.input());
        expect(field.stored()).toEqual(['S']);
        const stored = field.host.value;
        expect(stored).toBe(stored.trim());

        // Pick the same value again: nothing to store, and no trailing space.
        field.input().focus();
        press(field.input(), 'ArrowDown');
        await wait();
        await type(field, 'sec');
        mousePick(rowFor('SECRET')!);
        await wait();
        // A pick leaves exactly the marking.
        expect(field.input().value).toBe('SECRET');
        await leave(field.input());
        expect(field.stored()).toEqual(['S']);
        expect(field.host.value).toBe(stored);
    });

    it('TagInput: text that is only spacing is cleared when the field is left', async () => {
        const field = await mountField('tags');
        await type(field, '   ');
        await leave(field.input());
        expect(field.stored()).toEqual([]);
        expect(field.input().value).toBe('');
    });
});

describe.each(KINDS)('the commit table in %s', (kind) => {
    it('Enter on the armed completion replaces the token and stores nothing; the next Enter stores the result', async () => {
        const field = await mountField(kind);
        await type(field, 'secret nof');
        expect(activeRow(field.input())?.textContent).toContain('NOFORN');
        await key(field, 'Enter');
        // The pick joins the draft as the format writes it: in the text of a
        // whole-marking field, in the set a tag field adds to.
        if (kind === 'tags') {
            expect(resultValue()).toBe('SECRET//NOFORN');
        } else {
            expect(field.input().value.trim()).toMatch(/SECRET\/\/NOFORN$/);
        }
        expect(field.stored()).toEqual([]);
        expect(activeRow(field.input())).toBeNull();
        await key(field, 'Enter');
        await wait(120);
        expect(field.stored()).toEqual(['NF', 'S']);
    });

    it('reads a whole marking in any order and Enter stores it', async () => {
        const field = await mountField(kind);
        await type(field, 'noforn secret');
        await key(field, 'Enter');
        await wait(120);
        expect(field.stored()).toEqual(['NF', 'S']);
    });

    it('Tab accepts the armed row, then the next Tab leaves and blur stores', async () => {
        const field = await mountField(kind);
        await type(field, 'orc');
        const first = await key(field, 'Tab');
        expect(first.defaultPrevented).toBe(true);
        expect(field.stored()).toEqual([]);
        const second = await key(field, 'Tab');
        expect(second.defaultPrevented).toBe(false);
        await leave(field.input());
        expect(field.stored()).toEqual(['OC']);
    });

    it('a pressed row replaces the token exactly like Enter', async () => {
        const field = await mountField(kind);
        await type(field, 'secret orc');
        rowFor('ORCON')!.click();
        await wait();
        expect(field.stored()).toEqual([]);
        await key(field, 'Enter');
        await wait(120);
        expect(field.stored()).toEqual(['OC', 'S']);
    });

    it('blur with text that does not read stores nothing and keeps the draft, marked invalid', async () => {
        const field = await mountField(kind);
        await type(field, 'secret zzz');
        const input = field.input();
        await leave(input);
        expect(field.stored()).toEqual([]);
        expect(input.value).toBe('secret zzz');
        expect(input.getAttribute('aria-invalid')).toBe('true');
    });

    it('a typed whole marking that breaks a rule reads the same as in a whole-marking field, and Enter says why in the list', async () => {
        const field = await mountField(kind);
        await type(field, 'unclassified//secret');
        const rule = 'Level allows one value';
        const result = () =>
            openSurface()?.querySelector('.ez-composer__result')?.textContent ??
            '';
        expect(result()).toContain(rule);
        await key(field, 'Enter');
        await wait(120);
        expect(field.stored()).toEqual([]);
        expect(openSurface()).not.toBeNull();
        expect(result()).toContain(rule);
    });

    it('Enter on a draft that does not read says why in the list, the last word included', async () => {
        const field = await mountField(kind);
        await type(field, 'secret zzqq');
        await key(field, 'Enter');
        await wait(120);
        expect(field.stored()).toEqual([]);
        expect(
            openSurface()?.querySelector('.ez-composer__result')?.textContent,
        ).toContain('\u201czzqq\u201d is not recognized.');
    });

    it('first Escape closes the list and keeps the draft; the second reverts it', async () => {
        const field = await mountField(kind);
        await type(field, 'secret');
        const input = field.input();
        await key(field, 'Escape');
        expect(openSurface()).toBeNull();
        expect(input.value).toBe('secret');
        await key(field, 'Escape');
        expect(field.input().value).toBe('');
        expect(field.stored()).toEqual([]);
    });
});

/**
 * What the field's status mark says EzClassify fixed: hover it past the
 * tooltip's hover-intent delay and read the lines, then move away again.
 */
async function markedFixes(): Promise<string[]> {
    const mark = root.querySelector<HTMLElement>('.ez-status-mark');
    if (!mark) throw new Error('the field has no status mark');
    mark.dispatchEvent(new Event('mouseenter'));
    await wait(400);
    const tip = document.querySelector<HTMLElement>('.ez-tooltip');
    const shown =
        !!tip && !tip.hidden && !!mark.getAttribute('aria-describedby');
    const lines = shown
        ? [...tip.querySelectorAll(':scope > div')].map(
              (line) => line.textContent ?? '',
          )
        : [];
    mark.dispatchEvent(new Event('mouseleave'));
    await wait();
    return lines;
}

/**
 * The status mark's lines for `noforn/secret`: every change the engine made,
 * once each, so the author sees where NOFORN went as well as where it left.
 */
const NOFORN_SECRET_FIXES = [
    'EzClassify fixed this marking:',
    '• Moved `noforn/` out of this position (order).',
    '• Read `secret` as `SECRET` (case).',
    '• Moved `//NOFORN` into this position (order).',
];

describe.each(KINDS)('the fixes behind a typed marking in %s', (kind) => {
    it('reach the status mark when the commit stores what was typed', async () => {
        const field = await mountField(kind);
        // The caveat ahead of the level, in lower case: the parser reads
        // through both, and the stored value is the canonical rendering.
        await type(field, 'noforn/secret');
        await key(field, 'Enter');
        await wait(120);
        expect(field.stored()).toEqual(['NF', 'S']);

        const mark = root.querySelector<HTMLElement>('.ez-status-mark')!;
        expect(mark.classList.contains('ez-status-mark--unseen')).toBe(true);
        expect(await markedFixes()).toEqual(NOFORN_SECRET_FIXES);
    });

    it('a marking typed exactly as the format writes it leaves the mark quiet', async () => {
        const field = await mountField(kind);
        await type(field, 'SECRET//NOFORN');
        await key(field, 'Enter');
        await wait(120);
        expect(field.stored()).toEqual(['NF', 'S']);

        const mark = root.querySelector<HTMLElement>('.ez-status-mark')!;
        expect(mark.classList.contains('ez-status-mark--quiet')).toBe(true);
        expect(await markedFixes()).toEqual([]);
    });
});

describe('replacing a whole marking in MarkingField', () => {
    /**
     * Reopen the stored field with all of its text selected, as Cmd/Ctrl+A
     * does.
     */
    async function selectAll(field: Field): Promise<void> {
        const input = field.input();
        input.focus();
        press(input, 'ArrowDown');
        await wait();
        input.setSelectionRange(0, input.value.length);
    }

    /** Replace the selection by typing, or by pasting over it. */
    function replaceSelection(
        field: Field,
        text: string,
        how: 'typed' | 'pasted',
    ): void {
        const input = field.input();
        if (how === 'typed') {
            typeText(input, text);
            return;
        }
        input.value = text;
        input.setSelectionRange(text.length, text.length);
        input.dispatchEvent(
            new InputEvent('input', {
                bubbles: true,
                inputType: 'insertFromPaste',
                data: text,
            }),
        );
    }

    /** Commit the draft and let the stored value settle. */
    async function store(field: Field): Promise<void> {
        await key(field, 'Enter');
        await wait(120);
    }

    for (const how of ['typed', 'pasted'] as const) {
        it(`shows only the new marking's fixes when it is ${how} over the old one`, async () => {
            const field = await mountField('marking');
            await type(field, 'SECRET/NOFORN');
            await store(field);
            expect(await markedFixes()).toEqual([
                'EzClassify fixed this marking:',
                '• Read `/` as `//` (separator).',
            ]);

            await selectAll(field);
            replaceSelection(field, 'noforn/secret', how);
            await wait();
            await store(field);

            expect(field.stored()).toEqual(['NF', 'S']);
            expect(field.host.value).toBe('SECRET//NOFORN');
            const mark = root.querySelector<HTMLElement>('.ez-status-mark')!;
            expect(mark.classList.contains('ez-status-mark--unseen')).toBe(
                true,
            );
            expect(await markedFixes()).toEqual(NOFORN_SECRET_FIXES);
        });
    }

    it('marks the new fixes unseen even when the same rule fixed the old value and was already shown', async () => {
        const field = await mountField('marking');
        await type(field, 'Secret');
        await store(field);
        const mark = root.querySelector<HTMLElement>('.ez-status-mark')!;
        // Hovering past the delay shows the fix, which marks it seen.
        expect(await markedFixes()).toEqual([
            'EzClassify fixed this marking:',
            '• Read `Secret` as `SECRET` (case).',
        ]);
        expect(mark.classList.contains('ez-status-mark--seen')).toBe(true);

        await selectAll(field);
        replaceSelection(field, 'unclassified', 'typed');
        await wait();
        await store(field);

        expect(field.stored()).toEqual(['U']);
        expect(mark.classList.contains('ez-status-mark--unseen')).toBe(true);
        expect(await markedFixes()).toEqual([
            'EzClassify fixed this marking:',
            '• Read `unclassified` as `UNCLASSIFIED` (case).',
        ]);
    });
});

describe('which fixes a commit keeps', () => {
    /** Commit the draft and let the stored value settle. */
    async function store(field: Field): Promise<void> {
        await key(field, 'Enter');
        await wait(120);
    }

    it('TagInput: what is typed and added keeps the fixes behind the tags already there', async () => {
        const field = await mountField('tags');
        await type(field, 'secret');
        await store(field);
        await type(field, 'orcon/noforn');
        await store(field);

        expect(field.stored()).toEqual(['NF', 'OC', 'S']);
        expect(await markedFixes()).toEqual([
            'EzClassify fixed this marking:',
            '• Read `secret` as `SECRET` (case).',
            '• Moved `orcon/` out of this position (order).',
            '• Read `noforn` as `NOFORN` (case).',
            '• Moved `/ORCON` into this position (order).',
        ]);
    });

    it('TagInput: a pasted marking replaces the tags, and the fixes behind them go with them', async () => {
        const field = await mountField('tags');
        await type(field, 'noforn/secret');
        await store(field);
        expect(await markedFixes()).toEqual(NOFORN_SECRET_FIXES);

        // Paste into the empty filter: the marking stands for the whole value.
        const input = field.input();
        input.focus();
        const paste = new Event('paste', { bubbles: true, cancelable: true });
        Object.defineProperty(paste, 'clipboardData', {
            value: { getData: () => 'UNCLASSIFIED/ORCON' },
        });
        input.dispatchEvent(paste);
        await wait();
        await store(field);

        expect(field.stored()).toEqual(['OC', 'U']);
        expect(await markedFixes()).toEqual([
            'EzClassify fixed this marking:',
            '• Read `/` as `//` (separator).',
        ]);
    });

    it('TagInput: a tag removed with its × takes the fixes behind the typed text with it', async () => {
        const field = await mountField('tags');
        await type(field, 'noforn/secret');
        await store(field);
        expect(await markedFixes()).toEqual(NOFORN_SECRET_FIXES);

        const chip = [...root.querySelectorAll<HTMLElement>('.proto-tag')].find(
            (c) => c.textContent?.includes('NOFORN'),
        );
        chip!.querySelector<HTMLButtonElement>('.proto-tag-remove')!.click();
        await wait(120);

        expect(field.stored()).toEqual(['S']);
        const mark = root.querySelector<HTMLElement>('.ez-status-mark')!;
        expect(mark.classList.contains('ez-status-mark--quiet')).toBe(true);
        expect(await markedFixes()).toEqual([]);
    });

    it('MarkingField: a pick from the list rewrites the value, and the fixes behind the typed text go with it', async () => {
        const field = await mountField('marking');
        await type(field, 'noforn/secret');
        await store(field);
        expect(await markedFixes()).toEqual(NOFORN_SECRET_FIXES);

        field.input().focus();
        press(field.input(), 'ArrowDown');
        await wait();
        rowFor('NOFORN')!.click();
        await wait(100);
        await store(field);

        expect(field.stored()).toEqual(['S']);
        const mark = root.querySelector<HTMLElement>('.ez-status-mark')!;
        expect(mark.classList.contains('ez-status-mark--quiet')).toBe(true);
        expect(await markedFixes()).toEqual([]);
    });
});

describe.each(['marked-input', 'marked-textarea'] as const)(
    'which fixes %s keeps when its marking changes',
    (kind) => {
        /** Commit the editor's draft; the field closes the editor. */
        async function store(field: Field): Promise<void> {
            await key(field, 'Enter');
            await wait(120);
        }

        /**
         * Write the host's text the way a paste over the whole field does, then
         * let the field read it (MarkedTextArea debounces its scan).
         */
        async function rewrite(field: Field, text: string): Promise<void> {
            field.host.value = text;
            field.host.setSelectionRange(text.length, text.length);
            field.host.dispatchEvent(new Event('input', { bubbles: true }));
            await wait(450);
        }

        /** Open the editor on the leading mark again, the way mountField does. */
        async function reopen(field: Field): Promise<void> {
            field.host.focus();
            field.host.setSelectionRange(0, 0);
            press(document.activeElement as HTMLElement, 'Enter', {
                ctrlKey: true,
            });
            await wait(120);
            expect(openSurface()).not.toBeNull();
        }

        async function typedNofornSecret(): Promise<Field> {
            const field = await mountField(kind);
            await type(field, 'noforn/secret');
            await store(field);
            expect(field.stored()).toEqual(['NF', 'S']);
            expect(await markedFixes()).toEqual(NOFORN_SECRET_FIXES);
            return field;
        }

        it('a marking typed over the mark takes the fixes behind the old one with it', async () => {
            const field = await typedNofornSecret();

            await rewrite(field, '(UNCLASSIFIED) quarterly report');

            expect(field.stored()).toEqual(['U']);
            const mark = root.querySelector<HTMLElement>('.ez-status-mark')!;
            expect(mark.classList.contains('ez-status-mark--quiet')).toBe(true);
            expect(await markedFixes()).toEqual([]);
        });

        it('a marking typed over the mark lists its own fixes, not the old ones', async () => {
            const field = await typedNofornSecret();

            await rewrite(field, '(unclassified) quarterly report');

            expect(field.stored()).toEqual(['U']);
            expect(await markedFixes()).toEqual([
                'EzClassify fixed this marking:',
                '• Read `unclassified` as `UNCLASSIFIED` (case).',
            ]);
        });

        it('a later editing session that replaces the marking takes the old fixes with it', async () => {
            const field = await typedNofornSecret();

            await reopen(field);
            await type(field, 'UNCLASSIFIED');
            await store(field);

            expect(field.stored()).toEqual(['U']);
            expect(await markedFixes()).toEqual([]);
        });

        it('adding to the marking keeps the fixes behind what stays', async () => {
            const field = await typedNofornSecret();

            await rewrite(field, '(SECRET//NOFORN/ORCON) quarterly report');

            expect(field.stored()).toEqual(['NF', 'OC', 'S']);
            expect(await markedFixes()).toEqual(NOFORN_SECRET_FIXES);
        });

        it('another marking added after it keeps the fixes behind it', async () => {
            const field = await typedNofornSecret();
            const lead = field.host.value.trimEnd();
            const more =
                kind === 'marked-textarea'
                    ? `${lead} report\n(ORCON) second paragraph`
                    : `${lead} report (ORCON) in prose`;

            await rewrite(field, more);

            expect(await markedFixes()).toEqual(NOFORN_SECRET_FIXES);
        });

        it('reading the same marking again keeps its fixes', async () => {
            const field = await typedNofornSecret();

            await rewrite(field, `${field.host.value.trimEnd()} and more`);

            expect(field.stored()).toEqual(['NF', 'S']);
            expect(await markedFixes()).toEqual(NOFORN_SECRET_FIXES);
        });
    },
);

it.each(['tags', 'marking', 'marked-input', 'marked-textarea'] as const)(
    '%s jumps categories without filtering or changing native or stored values',
    async (kind) => {
        const field = await mountField(kind);
        const native = field.host.value;
        const draft = field.input().value;
        const categories = [
            ...openSurface()!.querySelectorAll<HTMLElement>(
                '.ez-composer__group-label[data-category-id]',
            ),
        ].map((h) => h.dataset.categoryId);
        const count = rows().length;
        press(field.input(), 'ArrowDown', { altKey: true });
        expect(activeRow(field.input())?.dataset.categoryId).toBe(
            categories[1],
        );
        press(field.input(), 'ArrowUp', { altKey: true });
        expect(activeRow(field.input())?.dataset.categoryId).toBe(
            categories[0],
        );
        expect(rows()).toHaveLength(count);
        expect(field.input().value).toBe(draft);
        expect(field.host.value).toBe(native);
        expect(field.stored()).toEqual([]);
    },
);
