/**
 * A part that writes one word for a list it shares with its whole.
 *
 * Read against its whole, such a part holds the whole's values in that list
 * with `source: 'context'`, so the engine's rules judge the real list. The part
 * did not write them. The fields that edit a part (MarkedInput, MarkedTextArea
 * and the InlineMarkingEditor both open) treat them as context:
 *
 * - The chip describes what the mark says, not the whole's list;
 * - The editor lists the whole's values as rows the author may add, never as
 *   values the part already holds;
 * - A commit writes the mark with the word, never with the whole's list;
 * - The part reaches the store with the word, and with the whole's values still
 *   marked as taken, so the rollup reads the real list.
 *
 * The engine never reads a taken value back: handed a part's read, it drops
 * them and takes again from the whole each call supplies, and `render` writes
 * the part as written. The UI still never hands them to a read. A rollup states
 * what its parts carried into it as its own (`source: 'aggregate'`); a part
 * never holds such a value.
 *
 * The scheme is the engine's own stand-in shape (see the fixture), so nothing
 * here depends on one scheme's vocabulary.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Assertion } from '@ezclassify/types';
import { EzClassifyUI } from '../ezclassify-ui';
import { InlineMarkingEditor } from './inline-marking-editor';
import { MarkedInput } from './marked-input';
import { MarkedTextArea } from './marked-text-area';
import { statedAssertions } from './composer/composer-controller';
import {
    activeRow,
    leave,
    openSurface,
    press,
    rowFor,
    wait,
} from './composer/composer-harness';
import { VanillaEzClassifyStore } from '../store/ezclassify-store';
import {
    CLOSED_WHOLE,
    JOINT_WHOLE,
    STAND_IN_WHOLE,
    wholeStandInContext,
} from '../../test-fixtures/whole-stand-in-scheme';

let root: HTMLDivElement;
let forms: EzClassifyUI | null = null;
let editor: InlineMarkingEditor | null = null;

beforeEach(() => {
    root = document.createElement('div');
    document.body.appendChild(root);
    Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
    editor?.destroy();
    editor = null;
    forms?.destroy();
    forms = null;
    document.body.innerHTML = '';
    vi.restoreAllMocks();
});

/** The partners a set holds, by where each came from. */
function partners(assertions: readonly Assertion[]): string[] {
    return assertions
        .filter((a) => a.categoryId === 'partners')
        .map((a) => `${a.conceptId}:${a.source}`)
        .sort();
}

/** The owners a set holds, by where each came from. */
function owners(assertions: readonly Assertion[]): string[] {
    return assertions
        .filter((a) => a.categoryId === 'owners')
        .map((a) => `${a.conceptId}:${a.source}`)
        .sort();
}

/** The ids of the values a set holds in `categoryId`. */
function ids(assertions: readonly Assertion[], categoryId: string): string[] {
    return assertions
        .filter((a) => a.categoryId === categoryId)
        .map((a) => a.conceptId)
        .sort();
}

const TAKEN = ['ALPHA:context', 'BRAVO:context'];

type FieldKind = 'marked-input' | 'marked-textarea';

function partMarkup(kind: FieldKind, value: string): string {
    return kind === 'marked-input'
        ? `<input type="text" id="f" data-ezclassify-controller="marked-input" data-ezclassify-part-of="doc" value="${value.replace(/"/g, '&quot;')}">`
        : `<textarea id="f" data-ezclassify-controller="marked-textarea" data-ezclassify-part-of="doc">${value}</textarea>`;
}

/** Mount a field of `kind` holding `value`, as a part of `whole`. */
async function mountPart(
    kind: FieldKind,
    value: string,
    context: ReturnType<typeof wholeStandInContext> = wholeStandInContext(),
    whole: string = STAND_IN_WHOLE,
): Promise<HTMLTextAreaElement> {
    root.innerHTML = [
        `<input type="hidden" id="doc" data-ezclassify-rendered value="${whole}" />`,
        `<label for="f">Title</label>`,
        partMarkup(kind, value),
    ].join('');
    forms = new EzClassifyUI(context as never, { root });
    await wait(450);
    return document.getElementById('f') as HTMLTextAreaElement;
}

/** The assertions the field holds for its first mark. */
function fieldAssertions(host: HTMLTextAreaElement): Assertion[] {
    const component = forms!.components.get(host);
    if (component instanceof MarkedTextArea) {
        return component.getSegments()[0]?.assertions ?? [];
    }
    return (component as MarkedInput).getAssertions();
}

/** Open the editor on the leading mark the way a keyboard user does. */
async function openEditor(
    host: HTMLTextAreaElement,
): Promise<HTMLInputElement> {
    host.focus();
    const editor = document.activeElement as HTMLTextAreaElement;
    editor.setSelectionRange(0, 0);
    press(editor, 'Enter', { ctrlKey: true });
    await wait(200);
    expect(openSurface()).not.toBeNull();
    return root.querySelector('.inline-editor-input') as HTMLInputElement;
}

/** Arrow to the row with this short form and take it with Enter. */
async function pickRow(input: HTMLElement, label: string): Promise<void> {
    const row = rowFor(label);
    expect(row).toBeDefined();
    for (let i = 0; i < 40 && activeRow(input) !== row; i++) {
        press(input, 'ArrowDown');
        await wait(10);
    }
    expect(activeRow(input)).toBe(row);
    press(input, 'Enter');
    await wait(200);
}

/**
 * What the row says about the draft: '✓' held, '○' held but inferred, '' not
 * held.
 */
function rowState(label: string): {
    check: string;
    inferred: boolean;
    selected: string | null;
} {
    const row = rowFor(label)!;
    return {
        check: row.querySelector('.ez-composer__check')?.textContent ?? '',
        inferred: row.classList.contains('ez-composer__row--inferred'),
        selected: row.getAttribute('aria-selected'),
    };
}

/** Hover the field's chip and return the tooltip text it shows. */
async function chipTooltip(host: HTMLTextAreaElement): Promise<string> {
    const chip = host
        .closest('.marked-input-wrap, .marked-textarea-wrap')!
        .querySelector<HTMLElement>(
            '.marked-input-chip, .marked-textarea-chip',
        );
    expect(chip).not.toBeNull();
    chip!.dispatchEvent(new Event('mouseenter'));
    await wait(400);
    const tip = document.body.querySelector<HTMLElement>('.ez-tooltip');
    expect(tip).not.toBeNull();
    expect(tip!.hidden).toBe(false);
    return tip!.textContent ?? '';
}

describe.each(['marked-input', 'marked-textarea'] as const)(
    '%s: a part that writes SHARE for its whole partners',
    (kind) => {
        it('reads the word against the whole: the partners are taken, not written', async () => {
            const host = await mountPart(kind, '(L//SHARE) Quarterly notes');
            expect(partners(fieldAssertions(host))).toEqual(TAKEN);
        });

        it('describes what the mark says on its chip, not the whole partners', async () => {
            const host = await mountPart(kind, '(L//SHARE) Quarterly notes');
            const tip = await chipTooltip(host);
            expect(tip).toContain('Low');
            expect(tip).toContain('Share');
            expect(tip).not.toContain('Partner ALPHA');
            expect(tip).not.toContain('Partner BRAVO');
        });

        it('lists the whole partners in its editor as rows to add, not as held', async () => {
            const host = await mountPart(kind, '(L//SHARE) Quarterly notes');
            await openEditor(host);
            for (const label of ['ALPHA', 'BRAVO']) {
                expect(rowState(label)).toEqual({
                    check: '',
                    inferred: false,
                    selected: 'false',
                });
            }
            // What the part does write stays held.
            expect(rowState('SHARE')).toEqual({
                check: '✓',
                inferred: false,
                selected: 'true',
            });
        });

        it('keeps the word when its editor commits the mark unchanged', async () => {
            const host = await mountPart(kind, '(L//SHARE) Quarterly notes');
            const input = await openEditor(host);
            expect(input.value).toBe('L//SHARE');
            press(input, 'Enter');
            await wait(450);
            expect(host.value).toBe('(L//SHARE) Quarterly notes');
            expect(partners(fieldAssertions(host))).toEqual(TAKEN);
        });

        it('keeps the word when a pick in its editor changes the rest of the mark', async () => {
            const host = await mountPart(kind, '(L//SHARE) Quarterly notes');
            const input = await openEditor(host);
            await pickRow(input, 'H');
            expect(input.value).toBe('H//SHARE');
            press(input, 'Enter');
            await wait(450);
            expect(host.value).toBe('(H//SHARE) Quarterly notes');
            expect(partners(fieldAssertions(host))).toEqual(TAKEN);
        });

        it('keeps the word when focus leaves the editor', async () => {
            const host = await mountPart(kind, '(L//SHARE) Quarterly notes');
            const input = await openEditor(host);
            await leave(input, 450);
            expect(host.value).toBe('(L//SHARE) Quarterly notes');
        });
    },
);

/**
 * The store state of every marking the field publishes for its marks: the
 * field's own for MarkedInput and MarkingField, one per mark for
 * MarkedTextArea.
 */
function partStates(host: HTMLTextAreaElement) {
    const parts = [
        ...root.querySelectorAll<HTMLElement>('[data-marked-textarea-field]'),
    ];
    const markings = parts.length > 0 ? parts.map((one) => one.id) : [host.id];
    return markings
        .map((id) => forms!.store.get(id))
        .filter((state) => state.assertions.length > 0);
}

describe('the store holds a part with the word', () => {
    it.each(['marked-input', 'marked-textarea'] as const)(
        '%s publishes the word, with the whole partners still marked as taken',
        async (kind) => {
            const host = await mountPart(kind, '(L//SHARE) Quarterly notes');
            const states = partStates(host);
            expect(states).toHaveLength(1);
            expect(states[0].rendered).toBe('L//SHARE');
            expect(partners(states[0].assertions)).toEqual(TAKEN);
        },
    );
});

describe('nothing taken from a whole is read back', () => {
    /**
     * Every assertion list handed to the engine, by the call it rode on, and
     * what each render call wrote.
     */
    function recordEngineInputs(
        context: ReturnType<typeof wholeStandInContext>,
    ): Array<{ call: string; assertions: Assertion[]; wrote?: string }> {
        const seen: Array<{
            call: string;
            assertions: Assertion[];
            wrote?: string;
        }> = [];
        const engine = context.scheme as unknown as Record<
            string,
            (...args: unknown[]) => unknown
        >;
        const lists = (value: unknown): Assertion[][] => {
            if (Array.isArray(value)) {
                return value.every(Array.isArray)
                    ? (value as Assertion[][])
                    : [value as Assertion[]];
            }
            const options = value as { assertions?: Assertion[] } | undefined;
            return options?.assertions ? [options.assertions] : [];
        };
        for (const call of [
            'process',
            'render',
            'suggest',
            'aggregateAssertions',
        ]) {
            const real = engine[call].bind(engine);
            engine[call] = (...args: unknown[]) => {
                const handed = args.flatMap(lists);
                const result = real(...args);
                const wrote =
                    call === 'render'
                        ? (result as { rendered?: string }).rendered
                        : undefined;
                for (const assertions of handed) {
                    seen.push({
                        call,
                        assertions,
                        ...(wrote !== undefined ? { wrote } : {}),
                    });
                }
                return result;
            };
        }
        return seen;
    }

    /** The calls that read what they are handed: every call but render. */
    const reads = (seen: ReturnType<typeof recordEngineInputs>) =>
        seen.filter(({ call }) => call !== 'render');

    it.each(['marked-input', 'marked-textarea'] as const)(
        '%s reads, edits, commits and rolls up without handing them to a read',
        async (kind) => {
            const context = wholeStandInContext();
            const seen = recordEngineInputs(context);
            const host = await mountPart(
                kind,
                '(L//SHARE) Quarterly notes',
                context,
            );
            const input = await openEditor(host);
            await pickRow(input, 'H');
            press(input, 'Enter');
            await wait(450);
            expect(host.value).toBe('(H//SHARE) Quarterly notes');
            expect(reads(seen).length).toBeGreaterThan(0);
            const sent = reads(seen).filter(({ assertions }) =>
                assertions.some((one) => one.source === 'context'),
            );
            expect(sent.map(({ call }) => call)).toEqual([]);
        },
    );

    it('render is handed a MarkedTextArea part as read, and writes it with the word (no render-side filter)', async () => {
        const context = wholeStandInContext();
        const seen = recordEngineInputs(context);
        const host = await mountPart(
            'marked-textarea',
            '(L//SHARE) Quarterly notes',
            context,
        );
        const input = await openEditor(host);
        await pickRow(input, 'H');
        press(input, 'Enter');
        await wait(450);
        expect(host.value).toBe('(H//SHARE) Quarterly notes');
        const written = seen
            .filter(({ call }) => call === 'render')
            .filter(({ assertions }) =>
                assertions.some((one) => one.source === 'context'),
            );
        expect(written.length).toBeGreaterThan(0);
        for (const { wrote } of written) {
            expect(wrote).toMatch(/^(L|H)\/\/SHARE$/);
        }
    });

    it.each(['marked-input', 'marked-textarea'] as const)(
        '%s: a part never holds a value a rollup carried',
        async (kind) => {
            const host = await mountPart(kind, '(L//SHARE) Quarterly notes');
            await wait(200);
            // The rollup over the part states the partners as its own.
            const rollup = forms!.store.getWholeRollup('doc');
            expect(partners(rollup.assertions)).toEqual([
                'ALPHA:aggregate',
                'BRAVO:aggregate',
            ]);
            // The part holds them as taken, never as carried or written.
            const [part] = partStates(host);
            expect(partners(part.assertions)).toEqual(TAKEN);
            expect(
                part.assertions.filter((one) => one.source === 'aggregate'),
            ).toEqual([]);
            expect(
                partners(fieldAssertions(host)).map((one) => one.split(':')[1]),
            ).toEqual(['context', 'context']);
        },
    );

    it.each(['marked-input', 'marked-textarea'] as const)(
        '%s: the rollup reads the part against the whole as it stands now',
        async (kind) => {
            await mountPart(kind, '(L//SHARE) Quarterly notes');
            const rollup = () =>
                partners(forms!.store.getWholeRollup('doc').assertions)
                    .map((one) => one.split(':')[0])
                    .sort();
            await wait(200);
            expect(rollup()).toEqual(['ALPHA', 'BRAVO']);

            // The whole changes its partners; the part still says SHARE.
            await forms!.store.publishRendered(
                'doc',
                'HIGH//SHARE WITH ALPHA, CHARLIE',
            );
            await wait(200);
            expect(rollup()).toEqual(['ALPHA', 'CHARLIE']);
        },
    );
});

describe('the store reads parts against their whole', () => {
    it('judges each part in the rollup by the part rules', async () => {
        await mountPart(
            'marked-input',
            '(L//SHARE) Quarterly notes',
            wholeStandInContext(),
            CLOSED_WHOLE,
        );
        await wait(200);
        const rollup = forms!.store.getWholeRollup('doc');
        expect(rollup.valid).toBe(false);
        expect(rollup.errors.map((one) => one.message)).toContain(
            'Contributor 1: Name the partners in this part or in its whole.',
        );
    });

    it('never judges a part in the rollup by the whole rules', async () => {
        await mountPart('marked-input', '(L) Quarterly notes');
        await wait(200);
        const rollup = forms!.store.getWholeRollup('doc');
        expect(rollup.errors.map((one) => one.message)).not.toContain(
            'Contributor 1: Say how the whole is handled.',
        );
    });

    it('rolls the page up in the whole when every marking is it or its part', async () => {
        await mountPart('marked-input', '(L//SHARE) Quarterly notes');
        await wait(200);
        const page = forms!.store.getAggregate();
        expect(page.valid).toBe(true);
        expect(page.rendered).toBe('HIGH//SHARE WITH ALPHA, BRAVO');
        expect(
            partners(page.assertions).map((one) => one.split(':')[0]),
        ).toEqual(['ALPHA', 'BRAVO']);
    });

    it.each(['marked-input', 'marked-textarea'] as const)(
        '%s: a part is read again when its whole arrives after it',
        async (kind) => {
            root.innerHTML = [
                `<input type="hidden" id="doc" data-ezclassify-rendered value="" />`,
                `<label for="f">Title</label>`,
                partMarkup(kind, '(L//SHARE) Quarterly notes'),
            ].join('');
            forms = new EzClassifyUI(wholeStandInContext() as never, { root });
            await wait(450);
            const host = document.getElementById('f') as HTMLTextAreaElement;
            const part = () => {
                const ids = [
                    ...root.querySelectorAll<HTMLElement>(
                        '[data-marked-textarea-field]',
                    ),
                ].map((one) => one.id);
                return forms!.store.get(ids[0] ?? host.id);
            };
            expect(partners(part().assertions)).toEqual([]);

            const doc = document.getElementById('doc') as HTMLInputElement;
            doc.value = STAND_IN_WHOLE;
            await forms.store.publishRendered('doc', STAND_IN_WHOLE);
            await wait(600);
            expect(part().rendered).toBe('L//SHARE');
            expect(partners(part().assertions)).toEqual(TAKEN);
            expect(
                partners(forms.store.getWholeRollup('doc').assertions)
                    .map((one) => one.split(':')[0])
                    .sort(),
            ).toEqual(['ALPHA', 'BRAVO']);
            expect(host.value).toBe('(L//SHARE) Quarterly notes');
        },
    );
});

describe('a mark the field cannot read whole', () => {
    it('is not published by the field when its whole changes', async () => {
        const host = await mountPart(
            'marked-input',
            '(L//SHARE/XYZ) Quarterly notes',
        );
        const changes: unknown[] = [];
        host.addEventListener('ezclassify:change', (event) =>
            changes.push((event as CustomEvent).detail),
        );
        const doc = document.getElementById('doc') as HTMLInputElement;
        doc.value = 'HIGH//SHARE WITH ALPHA, CHARLIE';
        await forms!.store.publishRendered('doc', doc.value);
        await wait(450);
        expect(changes).toEqual([]);
        expect(host.value).toBe('(L//SHARE/XYZ) Quarterly notes');
    });
});

describe('MarkingField: an editable field that holds a part', () => {
    it('keeps the whole partners as taken through an edit, and never offers them as held', async () => {
        root.innerHTML = [
            `<input type="hidden" id="doc" data-ezclassify-rendered value="${STAND_IN_WHOLE}" />`,
            `<label for="f">Part marking</label>`,
            `<textarea id="f" data-ezclassify-controller="marking" data-ezclassify-part-of="doc" data-ezclassify-format="portion">L//SHARE</textarea>`,
        ].join('');
        forms = new EzClassifyUI(wholeStandInContext() as never, { root });
        await wait(450);
        const host = document.getElementById('f') as HTMLTextAreaElement;
        const field = forms.components.get(host)!;
        expect(partners(field.getAssertions())).toEqual(TAKEN);

        // An edit runs the field's own pass over what the part states.
        host.focus();
        press(host, 'ArrowDown');
        await wait(200);
        await pickRow(host, 'H');
        await leave(host, 450);
        expect(host.value).toBe('H//SHARE');
        expect(partners(field.getAssertions())).toEqual(TAKEN);

        host.focus();
        press(host, 'ArrowDown');
        await wait(200);
        expect(openSurface()).not.toBeNull();
        for (const label of ['ALPHA', 'BRAVO']) {
            expect(rowState(label)).toEqual({
                check: '',
                inferred: false,
                selected: 'false',
            });
        }
    });
});

describe('InlineMarkingEditor: a part read against its whole', () => {
    const whole = () => ({
        role: 'part' as const,
        partOf: { rendered: STAND_IN_WHOLE },
    });

    async function openEditorOn(
        initial: string,
        seed?: Assertion[],
    ): Promise<{
        input: HTMLInputElement;
        changes: Array<{ rendered: string; assertions: Assertion[] }>;
    }> {
        const container = document.createElement('div');
        root.appendChild(container);
        const changes: Array<{ rendered: string; assertions: Assertion[] }> =
            [];
        editor = new InlineMarkingEditor();
        await editor.init(container, wholeStandInContext() as never, initial, {
            formatId: 'portion',
            resolveContext: whole,
            assertions: seed,
            root,
            onChange: (rendered, assertions) =>
                changes.push({ rendered, assertions }),
        });
        await wait(80);
        const input = container.querySelector(
            '.inline-editor-input',
        ) as HTMLInputElement;
        return { input, changes };
    }

    /** What a field hands the editor: the part as it read it, partners taken. */
    function fieldSeed(): Assertion[] {
        const read = wholeStandInContext().scheme.process('L//SHARE', {
            outputFormat: 'portion',
            context: whole(),
        }) as { assertions: Assertion[] };
        expect(partners(read.assertions)).toEqual(TAKEN);
        return read.assertions;
    }

    it('does not offer the whole partners as values the part holds', async () => {
        await openEditorOn('L//SHARE', fieldSeed());
        for (const label of ['ALPHA', 'BRAVO']) {
            expect(rowState(label).check).toBe('');
            expect(rowState(label).inferred).toBe(false);
        }
    });

    it('commits a pick with the word, never the whole partners', async () => {
        const { input, changes } = await openEditorOn('L//SHARE', fieldSeed());
        await pickRow(input, 'H');
        expect(input.value).toBe('H//SHARE');
        press(input, 'Enter');
        await wait(200);
        expect(changes.at(-1)?.rendered).toBe('H//SHARE');
        expect(partners(changes.at(-1)!.assertions)).toEqual(TAKEN);
    });

    it('states a partner only when the author adds one', async () => {
        const { input, changes } = await openEditorOn('L//SHARE', fieldSeed());
        await pickRow(input, 'CHARLIE');
        expect(input.value).toBe('L//SHARE WITH CHARLIE');
        press(input, 'Enter');
        await wait(200);
        expect(changes.at(-1)?.rendered).toBe('L//SHARE WITH CHARLIE');
        // The part names its own partner now, so it takes none from the whole.
        const held = changes.at(-1)!.assertions;
        expect(partners(held).map((one) => one.split(':')[0])).toEqual([
            'CHARLIE',
        ]);
        expect(held.some((one) => one.source === 'context')).toBe(false);
    });
});

describe('a whole that stops sharing: the store reads its part again (R-1)', () => {
    /** A store over the stand-in scheme with `p` a part of `doc`. */
    async function storeWithPart() {
        const store = new VanillaEzClassifyStore(
            wholeStandInContext().scheme as never,
        );
        await store.publishRendered('doc', STAND_IN_WHOLE);
        store.setPartOf('p', 'doc');
        return store;
    }

    async function expectRefusedUnderClosed(
        store: VanillaEzClassifyStore,
    ): Promise<void> {
        await store.publishRendered('doc', CLOSED_WHOLE);
        await wait(100);
        const part = store.get('p');
        expect(part.rendered).toBe('L//SHARE');
        expect(part.valid).toBe(false);
        expect(part.errors.map((one) => one.message)).toContain(
            'Name the partners in this part or in its whole.',
        );
        // Not one partner of the old whole survives.
        expect(partners(part.assertions)).toEqual([]);
        const rollup = store.getWholeRollup('doc');
        expect(rollup.valid).toBe(false);
        expect(partners(rollup.assertions)).toEqual([]);
    }

    it('a part published as text', async () => {
        const store = await storeWithPart();
        await store.publishRendered('p', 'L//SHARE');
        expect(partners(store.get('p').assertions)).toEqual(TAKEN);
        expect(store.get('p').valid).toBe(true);
        await expectRefusedUnderClosed(store);
        store.destroy();
    });

    it('a part published as the assertions a field read', async () => {
        const store = await storeWithPart();
        const read = wholeStandInContext().scheme.process('L//SHARE', {
            outputFormat: 'portion',
            context: { role: 'part', partOf: { rendered: STAND_IN_WHOLE } },
        }) as { assertions: Assertion[] };
        expect(partners(read.assertions)).toEqual(TAKEN);
        await store.publishAssertions('p', read.assertions);
        expect(partners(store.get('p').assertions)).toEqual(TAKEN);
        await expectRefusedUnderClosed(store);
        store.destroy();
    });

    it('a joint part whose whole loses its owners', async () => {
        const store = new VanillaEzClassifyStore(
            wholeStandInContext().scheme as never,
        );
        await store.publishRendered('doc', JOINT_WHOLE);
        store.setPartOf('p', 'doc');
        await store.publishRendered('p', 'JOINT H//SHARE');
        expect(owners(store.get('p').assertions)).toEqual([
            'NORTH:context',
            'SOUTH:context',
        ]);
        expect(store.get('p').valid).toBe(true);

        await store.publishRendered('doc', STAND_IN_WHOLE);
        await wait(100);
        const part = store.get('p');
        expect(part.rendered).toBe('JOINT H//SHARE');
        expect(part.valid).toBe(false);
        expect(part.errors.map((one) => one.message)).toContain(
            'Name the joint owners in this part or in its whole.',
        );
        expect(owners(part.assertions)).toEqual([]);
        // The partners it stands for are the new whole's, taken again.
        expect(partners(part.assertions)).toEqual(TAKEN);
        store.destroy();
    });

    it.each(['marked-input', 'marked-textarea'] as const)(
        '%s: the field keeps the word and the store refuses the part',
        async (kind) => {
            const host = await mountPart(kind, '(L//SHARE) Quarterly notes');
            expect(partners(partStates(host)[0].assertions)).toEqual(TAKEN);
            const doc = document.getElementById('doc') as HTMLInputElement;
            doc.value = CLOSED_WHOLE;
            await forms!.store.publishRendered('doc', CLOSED_WHOLE);
            await wait(600);
            const [part] = partStates(host);
            expect(part.rendered).toBe('L//SHARE');
            expect(part.valid).toBe(false);
            expect(partners(part.assertions)).toEqual([]);
            expect(partners(fieldAssertions(host))).toEqual([]);
            expect(host.value).toBe('(L//SHARE) Quarterly notes');
        },
    );
});

/**
 * The short joint form: a part that writes `JOINT` for its whole's owners, with
 * `SHARE` for its whole's partners or with partners of its own. Written short
 * under a whole with the same owners, it is read, edited, committed, published
 * and rolled up short, and the whole's owners are always taken, never written.
 */
describe.each([
    {
        mark: 'JOINT H//SHARE',
        picked: 'JOINT L//SHARE',
        partners: TAKEN,
    },
    {
        mark: 'JOINT H//SHARE WITH ALPHA, BRAVO',
        picked: 'JOINT L//SHARE WITH ALPHA, BRAVO',
        partners: ['ALPHA:parse', 'BRAVO:parse'],
    },
])('the short joint form $mark under a matching whole', (form) => {
    const TAKEN_OWNERS = ['NORTH:context', 'SOUTH:context'];

    /** The whole's rollup over its parts, as the store holds it. */
    function expectRollup(level: 'HIGH' | 'LOW'): void {
        const rollup = forms!.store.getWholeRollup('doc');
        expect(rollup.valid).toBe(true);
        expect(rollup.rendered).toBe(
            `JOINT ${level} NORTH SOUTH//SHARE WITH ALPHA, BRAVO`,
        );
        expect(owners(rollup.assertions)).toEqual([
            'NORTH:aggregate',
            'SOUTH:aggregate',
        ]);
        // A rollup writes the owners, never the word that stood for them.
        expect(ids(rollup.assertions, 'owner_shorthand')).toEqual([]);
    }

    /** The one part the field published, read short against the whole. */
    function expectPart(host: HTMLTextAreaElement, mark: string): void {
        const states = partStates(host);
        expect(states).toHaveLength(1);
        expect(states[0].rendered).toBe(mark);
        expect(states[0].valid).toBe(true);
        expect(owners(states[0].assertions)).toEqual(TAKEN_OWNERS);
        expect(partners(states[0].assertions)).toEqual(form.partners);
        expect(ids(states[0].assertions, 'owner_shorthand')).toEqual([
            'JOINT-AS-WHOLE',
        ]);
    }

    it.each(['marked-input', 'marked-textarea'] as const)(
        '%s: reads, commits unchanged and commits a pick as written',
        async (kind) => {
            const host = await mountPart(
                kind,
                `(${form.mark}) Quarterly notes`,
                wholeStandInContext(),
                JOINT_WHOLE,
            );
            expect(host.value).toBe(`(${form.mark}) Quarterly notes`);
            expect(owners(fieldAssertions(host))).toEqual(TAKEN_OWNERS);
            expectPart(host, form.mark);
            await wait(200);
            expectRollup('HIGH');

            let input = await openEditor(host);
            expect(input.value).toBe(form.mark);
            press(input, 'Enter');
            await wait(450);
            expect(host.value).toBe(`(${form.mark}) Quarterly notes`);
            expectPart(host, form.mark);

            input = await openEditor(host);
            await pickRow(input, 'L');
            // The draft is written short too: the word stays for the owners.
            expect(input.value).toBe(form.picked);
            press(input, 'Enter');
            await wait(450);
            expect(host.value).toBe(`(${form.picked}) Quarterly notes`);
            expectPart(host, form.picked);
            await wait(200);
            expectRollup('LOW');
        },
    );

    it('MarkingField: reads and commits a pick as written', async () => {
        root.innerHTML = [
            `<input type="hidden" id="doc" data-ezclassify-rendered value="${JOINT_WHOLE}" />`,
            `<label for="f">Part marking</label>`,
            `<textarea id="f" data-ezclassify-controller="marking" data-ezclassify-rendered data-ezclassify-part-of="doc" data-ezclassify-format="portion">${form.mark}</textarea>`,
        ].join('');
        forms = new EzClassifyUI(wholeStandInContext() as never, { root });
        await wait(450);
        const host = document.getElementById('f') as HTMLTextAreaElement;
        const field = forms.components.get(host)!;
        expect(host.value).toBe(form.mark);
        expect(owners(field.getAssertions())).toEqual(TAKEN_OWNERS);
        expect(partners(field.getAssertions())).toEqual(form.partners);

        host.focus();
        press(host, 'ArrowDown');
        await wait(200);
        await pickRow(host, 'L');
        await leave(host, 450);
        expect(host.value).toBe(form.picked);
        expect(owners(field.getAssertions())).toEqual(TAKEN_OWNERS);
        expectPart(host, form.picked);
        await wait(200);
        expectRollup('LOW');
    });
});

describe('statedAssertions', () => {
    it('leaves out a value taken from the whole, however sure the engine is of it', () => {
        const taken: Assertion = {
            conceptId: 'ALPHA',
            categoryId: 'partners',
            confidence: 'certain',
            source: 'context',
        };
        const written: Assertion = {
            conceptId: 'SHARE',
            categoryId: 'handling',
            confidence: 'certain',
            source: 'parse',
        };
        expect(statedAssertions([written, taken])).toEqual([written]);
    });
});

describe('contextual stand-in options', () => {
    it.each<FieldKind>(['marked-input', 'marked-textarea'])(
        '%s offers owner shorthand only under a joint whole and refreshes it live',
        async (kind) => {
            const host = await mountPart(
                kind,
                '(L) Title.',
                wholeStandInContext(),
                CLOSED_WHOLE,
            );
            await openEditor(host);
            expect(rowFor('JOINT')).toBeUndefined();
            const whole = document.getElementById('doc') as HTMLInputElement;
            whole.value = JOINT_WHOLE;
            await forms!.store.publishRendered('doc', whole.value);
            await wait(650);
            expect(rowFor('JOINT')).toBeDefined();
            whole.value = CLOSED_WHOLE;
            await forms!.store.publishRendered('doc', whole.value);
            await wait(650);
            expect(rowFor('JOINT')).toBeUndefined();
        },
    );
});
