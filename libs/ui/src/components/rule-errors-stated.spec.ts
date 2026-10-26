/**
 * A field holds the marking the engine settled on, and the errors and ways to
 * fix it shows are the engine's judgment of that marking.
 *
 * Repair preserves author-stated rule conflicts. Every field displays the
 * resulting value and the engine's proposed choices, and applying a choice uses
 * that resulting value as its basis.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { LocalSchemeEngineAdapter } from '@ezclassify/types';
import { Context } from '@ezclassify/engine';
import { EzClassifyUI } from '../ezclassify-ui';
import { TagInput } from './tag-input';
import { VanillaEzClassifyStore } from '../store/ezclassify-store';

function wait(ms = 60): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
}

const RULE = 'a-over-b';

function createEngine(): LocalSchemeEngineAdapter {
    const concept = (id: string, category: string, position: number) => ({
        id,
        name: id,
        views: { default: id },
        categories: [category],
        parents: [],
        aliases: [],
        position,
        rank: position,
    });
    return Context.fromComponents({
        scheme: {
            scheme: {
                id: 'stated-fix-test',
                version: '1.0.0',
                name: 'Stated Fix Test',
                data: {
                    concepts: {
                        inline: [
                            concept('LOW', 'level', 1),
                            concept('HIGH', 'level', 2),
                            concept('A', 'caveat', 1),
                            concept('B', 'caveat', 2),
                            concept('C', 'caveat', 3),
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
                rules: [
                    {
                        id: RULE,
                        action: 'exclusive',
                        target: ['A', 'B'],
                        rank: ['A', 'B'],
                        message: 'A and B cannot appear together.',
                    },
                    {
                        id: 'c-requires-high',
                        action: 'require_any',
                        when: 'C',
                        target: ['HIGH'],
                        phases: ['validate'],
                        message: 'C requires HIGH.',
                    },
                ],
                parse: { case_sensitive: false, strip_whitespace: true },
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
    }).scheme as LocalSchemeEngineAdapter;
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

async function mount(markup: string): Promise<void> {
    root.innerHTML = markup;
    forms = new EzClassifyUI(createEngine() as never, { root });
    await wait(120);
}

function fixButton(label: string): HTMLButtonElement {
    const button = Array.from(
        root.querySelectorAll<HTMLButtonElement>(
            '.ez-validation-errors button.ez-validation-errors__fix',
        ),
    ).find((b) => b.textContent === label);
    expect(button, label).toBeDefined();
    return button!;
}

const FIELDS = [
    {
        name: 'MarkingField',
        markup: (marking: string) =>
            `<textarea id="f" data-ezclassify-controller="marking">${marking}</textarea>`,
    },
    {
        name: 'TagInput',
        markup: (marking: string) =>
            `<input id="f" data-ezclassify-controller="tags" value="${marking}" />`,
    },
] as const;

/** The marking text controller, which keeps the author's own text. */
const MARKED_INPUT = (marking: string) =>
    `<input type="text" id="f" data-ezclassify-controller="marked-input" value="(${marking}) report">`;

function host(): HTMLInputElement {
    return document.getElementById('f') as HTMLInputElement;
}

function errorsHidden(): boolean {
    return (
        root.querySelector<HTMLElement>('.ez-validation-errors')?.hidden ?? true
    );
}

function fixLabels(scope: ParentNode = root): string[] {
    return [
        ...scope.querySelectorAll<HTMLButtonElement>(
            '.ez-validation-errors button.ez-validation-errors__fix',
        ),
    ].map((button) => button.textContent ?? '');
}

describe.each(FIELDS)('$name holds author-stated conflicts', (field) => {
    it('keeps the conflict and both author choices with no applied fix', async () => {
        await mount(field.markup('LOW//A/B'));
        expect(host().value).toBe('LOW//A/B');
        expect(errorsHidden()).toBe(false);
        expect(fixLabels()).toEqual(['Remove A', 'Remove B']);
        expect(forms!.store.get('f').appliedFixes).toEqual([]);
    });

    it('offers the engine choice for all current errors and keeps the chosen result', async () => {
        await mount(field.markup('LOW//A/B/C'));
        expect(host().value).toBe('LOW//A/B/C');
        const list = root.querySelector<HTMLElement>('.ez-validation-errors');
        expect(list?.hidden).toBe(false);
        expect(list?.textContent).toContain('C requires HIGH.');
        expect(list?.textContent).toContain('A and B');
        expect(fixLabels()).toEqual(['Replace LOW with HIGH and remove A']);
        fixButton('Replace LOW with HIGH and remove A').click();
        await wait(120);
        expect(host().value).toBe('HIGH//B/C');
        expect(errorsHidden()).toBe(true);
    });

    it('an external canonical edit clears the errors it answers', async () => {
        await mount(field.markup('LOW//C'));
        fixButton('Remove C');
        await forms!.store.publishRendered('f', 'LOW//A');
        await wait(120);
        expect(errorsHidden()).toBe(true);
        expect(host().value).toBe('LOW//A');
    });

    it('an external edit wins while the initial seed is pending', async () => {
        root.innerHTML = field.markup('LOW//C');
        const engine = createEngine();
        const store = new VanillaEzClassifyStore(engine);
        const originalSeed = store.seedRendered.bind(store);
        let release!: () => void;
        const gate = new Promise<void>((resolve) => {
            release = resolve;
        });
        const seed = vi
            .spyOn(store, 'seedRendered')
            .mockImplementation(async (...args) => {
                await gate;
                await originalSeed(...args);
            });
        const ready = new Promise((resolve) =>
            root.addEventListener('ezclassify:ready', resolve, { once: true }),
        );
        forms = new EzClassifyUI(engine as never, { root, store });
        try {
            await vi.waitFor(() => expect(seed).toHaveBeenCalled());
            fixButton('Remove C');
            await store.publishRendered('f', 'LOW//A');
            await wait(120);
            expect(errorsHidden()).toBe(true);
            expect(host().value).toBe('LOW//A');
            release();
            await ready;
            expect(store.get('f').valid).toBe(true);
            expect(store.get('f').rendered).toBe('LOW//A');
            expect(errorsHidden()).toBe(true);
        } finally {
            release();
            forms.destroy();
            forms = null;
            store.destroy();
        }
    });
});

it('offers the same ways to fix in every field bound to an invalid marking', async () => {
    root.innerHTML = `<input type="hidden" id="doc" data-ezclassify-rendered>
        <div class="mf"><input id="mf" data-ezclassify-controller="marking" data-ezclassify-bound-to="doc"></div>
        <div class="ti"><input id="ti" data-ezclassify-controller="tags" data-ezclassify-bound-to="doc"></div>`;
    const ready = new Promise((resolve) =>
        root.addEventListener('ezclassify:ready', resolve, { once: true }),
    );
    forms = new EzClassifyUI(createEngine() as never, { root });
    await ready;
    // A publish from outside the fields: each one takes the store's reading,
    // which is of the marking the engine settled on.
    await forms.store.publishRendered('doc', 'LOW//A/B/C');
    await wait(120);
    expect(forms.store.get('doc').rendered).toBe('LOW//A/B/C');
    for (const field of ['.mf', '.ti']) {
        expect(fixLabels(root.querySelector(field)!), field).toEqual([
            'Replace LOW with HIGH and remove A',
        ]);
    }
});

describe('MarkedInput keeps the author text and judges it', () => {
    it('reports the conflict with both remedies', async () => {
        await mount(MARKED_INPUT('LOW//A/B'));
        const list = root.querySelector<HTMLElement>('.ez-validation-errors');
        expect(list?.hidden).toBe(false);
        expect(list?.textContent).toContain('A and B cannot appear together.');
        fixButton('Remove A');
        fixButton('Remove B');
    });

    it('removing A leaves B, the concept the text states', async () => {
        await mount(MARKED_INPUT('LOW//A/B'));
        fixButton('Remove A').click();
        await wait(120);
        expect(host().value).toBe('(LOW//B) report');
        expect(errorsHidden()).toBe(true);
    });

    it('removing B leaves A', async () => {
        await mount(MARKED_INPUT('LOW//A/B'));
        fixButton('Remove B').click();
        await wait(120);
        expect(host().value).toBe('(LOW//A) report');
        expect(errorsHidden()).toBe(true);
    });

    it('writes the marking the engine proved and reads it once', async () => {
        await mount(MARKED_INPUT('LOW//A/B'));
        const process = vi.spyOn(forms!.engine, 'process');

        fixButton('Remove A').click();
        await wait(120);

        expect(host().value).toBe('(LOW//B) report');
        // The field reads the written text once; the store's publish of what
        // it read and the page rollup's read of the aggregate, as a whole,
        // follow as they do for any edit. Nothing settles the fix's facts on
        // their own first.
        const fieldReads = process.mock.calls.filter(
            ([input, ...rest]) =>
                input === 'LOW//B' &&
                !(rest.at(-1) as { context?: unknown } | undefined)?.context,
        );
        expect(fieldReads).toHaveLength(1);
        expect(process.mock.calls[0][0]).toBe('LOW//B');
        expect(process.mock.calls.some(([input]) => input === '')).toBe(false);
    });
});

describe('a conflict the author builds in the field', () => {
    it('a host-supplied assertion set keeps its authored conflict', async () => {
        const container = document.createElement('div');
        container.appendChild(document.createElement('input'));
        root.appendChild(container);
        const field = new TagInput();
        await field.init(container, Context.fromSchemeEngine(createEngine()));

        const stated = (conceptId: string, categoryId: string) => ({
            conceptId,
            categoryId,
            confidence: 'certain' as const,
            source: 'user',
        });
        field.setAssertions([
            stated('LOW', 'level'),
            stated('A', 'caveat'),
            stated('B', 'caveat'),
            stated('C', 'caveat'),
        ]);
        await wait();
        // Both conflicts stay for the author to resolve.
        expect(field.getRendered()).toBe('LOW//A/B/C');
        expect(fixLabels()).toEqual(['Replace LOW with HIGH and remove A']);

        fixButton('Replace LOW with HIGH and remove A').click();
        await wait();

        expect(field.getRendered()).toBe('HIGH//B/C');
        field.destroy();
    });

    it('MarkingField: a typed conflict committed on blur stays authored', async () => {
        await mount(
            '<textarea id="f" data-ezclassify-controller="marking">LOW</textarea>',
        );
        const field = host();
        field.focus();
        field.dispatchEvent(new FocusEvent('focus'));
        field.value = 'LOW//A/B/C';
        field.dispatchEvent(new Event('input', { bubbles: true }));
        await wait(150);
        field.blur();
        field.dispatchEvent(new FocusEvent('blur'));
        await wait(300);

        expect(field.value).toBe('LOW//A/B/C');
        expect(fixLabels()).toEqual(['Replace LOW with HIGH and remove A']);
        fixButton('Replace LOW with HIGH and remove A').click();
        await wait(150);

        expect(field.value).toBe('HIGH//B/C');
    });

    it('MarkingField: a fix pressed over newer typed text keeps the typing and offers fixes for it', async () => {
        await mount(
            '<textarea id="f" data-ezclassify-controller="marking">LOW//C</textarea>',
        );
        const field = host();
        field.focus();
        field.dispatchEvent(new FocusEvent('focus'));
        field.value = 'LOW//A/C';
        field.dispatchEvent(new Event('input', { bubbles: true }));
        await wait(150);

        const button = fixButton('Remove C');
        button.dispatchEvent(
            new MouseEvent('mousedown', { bubbles: true, cancelable: true }),
        );
        button.click();
        await wait(150);

        // The fix answered LOW//C. The typed LOW//A/C is read instead, the
        // way leaving the field reads it, and the list offers its fixes.
        expect(field.value).toBe('LOW//A/C');
        fixButton('Remove C').click();
        await wait(150);
        expect(field.value).toBe('LOW//A');
    });
});

/**
 * A context-bound engine manages no composition of its own: the shape of a
 * remote client, which addresses no scheme and offers only what the wire does.
 */
function boundEngine(): object {
    const inner = createEngine();
    return new Proxy(inner as object, {
        has: (target, prop) =>
            prop === 'loadScheme' ? false : Reflect.has(target, prop),
        get(target, prop, receiver) {
            if (prop === 'loadScheme') return undefined;
            const value = Reflect.get(target, prop, receiver);
            return typeof value === 'function' ? value.bind(target) : value;
        },
    });
}

describe.each(FIELDS)('$name over a context-bound engine', (field) => {
    it('applies a fix to the marking it holds', async () => {
        root.innerHTML = field.markup('LOW//A/B/C');
        forms = new EzClassifyUI(boundEngine() as never, { root });
        await wait(120);

        expect(host().value).toBe('LOW//A/B/C');
        fixButton('Replace LOW with HIGH and remove A').click();
        await wait(120);

        expect(host().value).toBe('HIGH//B/C');
        expect(errorsHidden()).toBe(true);
    });
});

it('MarkedInput over a context-bound engine applies the fix to the text it holds', async () => {
    root.innerHTML = MARKED_INPUT('LOW//A/B');
    forms = new EzClassifyUI(boundEngine() as never, { root });
    await wait(120);

    fixButton('Remove A').click();
    await wait(120);

    expect(host().value).toBe('(LOW//B) report');
});
