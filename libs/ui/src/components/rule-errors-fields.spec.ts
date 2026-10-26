/**
 * The rule-error surface on the real form fields: every field shows a broken
 * rule directly under itself, then offers the engine's proposed fixes as
 * buttons worded by each fix's own message, and a pressed fix lands the marking
 * it describes in the field.
 *
 * The rule and its error come from a real engine. The fixes are layered onto
 * the engine's result by a thin adapter wrapper, because the fields only pass
 * through what `ProcessResult.proposedFixes` carries and this scheme's rule
 * proposes none of its own.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type {
    Fix,
    LocalSchemeEngineAdapter,
    ProcessResult,
} from '@ezclassify/types';
import { Context } from '@ezclassify/engine';
import { EzClassifyUI } from '../ezclassify-ui';

function wait(ms = 60): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
}

const RULE = 'caveat-needs-high';

function createEngine(): LocalSchemeEngineAdapter {
    const concept = (
        id: string,
        label: string,
        category: string,
        position: number,
    ) => ({
        id,
        name: label,
        views: { default: label },
        categories: [category],
        parents: [],
        aliases: [],
        position,
        rank: position,
    });
    const engine = Context.fromComponents({
        scheme: {
            scheme: {
                id: 'rule-errors-test',
                version: '1.0.0',
                name: 'Rule Errors Test',
                data: {
                    concepts: {
                        inline: [
                            concept('LOW', 'LOW', 'level', 1),
                            concept('HIGH', 'HIGH', 'level', 2),
                            concept('HOLD', 'HOLD', 'caveat', 1),
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
                        when: 'HOLD',
                        action: 'require_any',
                        target: ['HIGH'],
                        phases: ['validate'],
                        message: 'HOLD requires HIGH.',
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

    // The two ways the scheme's rule can be met, each the whole marking it
    // leaves, the shape the engine proposes them in.
    const fixesFor = (result: ProcessResult): Fix[] =>
        result.errors.some((e) => e.constraintId === RULE)
            ? [
                  {
                      message: 'Replace LOW with HIGH.',
                      rendered: 'HIGH//HOLD',
                      keeps: [{ conceptId: 'HOLD', categoryId: 'caveat' }],
                      adds: [{ conceptId: 'HIGH', categoryId: 'level' }],
                      removes: [{ conceptId: 'LOW', categoryId: 'level' }],
                  },
                  {
                      message: 'Remove HOLD.',
                      rendered: 'LOW',
                      keeps: [{ conceptId: 'LOW', categoryId: 'level' }],
                      adds: [],
                      removes: [{ conceptId: 'HOLD', categoryId: 'caveat' }],
                  },
              ]
            : [];

    return new Proxy(engine as object, {
        get(target, prop, receiver) {
            const value = Reflect.get(target, prop, receiver);
            if (typeof value !== 'function') return value;
            if (prop !== 'process') return value.bind(target);
            return (...args: unknown[]) => {
                const result = value.apply(target, args) as ProcessResult;
                return { ...result, proposedFixes: fixesFor(result) };
            };
        },
    }) as LocalSchemeEngineAdapter;
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
    root.innerHTML = '<label for="f">Customer marking</label>' + markup;
    forms = new EzClassifyUI(createEngine() as never, { root });
    await wait(120);
}

function errorList(): HTMLElement {
    const list = root.querySelector<HTMLElement>('.ez-validation-errors');
    expect(list).not.toBeNull();
    return list!;
}

function fixButtons(): HTMLButtonElement[] {
    return Array.from(
        errorList().querySelectorAll<HTMLButtonElement>(
            'button.ez-validation-errors__fix',
        ),
    );
}

const FIELDS = [
    {
        name: 'MarkingField',
        markup: '<textarea id="f" data-ezclassify-controller="marking">LOW//HOLD</textarea>',
        visual: '.marking-field-wrap',
        inside: true,
        fixed: 'HIGH//HOLD',
        removed: 'LOW',
    },
    {
        name: 'MarkingField input',
        markup: '<input id="f" data-ezclassify-controller="marking" value="LOW//HOLD" />',
        visual: '.marking-field-wrap',
        inside: true,
        fixed: 'HIGH//HOLD',
        removed: 'LOW',
    },
    {
        name: 'TagInput',
        markup: '<input id="f" data-ezclassify-controller="tags" value="LOW//HOLD" />',
        visual: '[data-ezclassify-mount]',
        inside: true,
        fixed: 'HIGH//HOLD',
        removed: 'LOW',
    },
    {
        name: 'MarkedInput',
        markup: '<input type="text" id="f" data-ezclassify-controller="marked-input" value="(LOW//HOLD) report">',
        visual: '.marked-input-wrap',
        inside: true,
        fixed: '(HIGH//HOLD) report',
        removed: '(LOW) report',
    },
] as const;

describe.each(FIELDS)('$name rule errors', (field) => {
    it.each(['mouse', 'touch', 'pen'])(
        'a %s fix commits without focusing an editable field',
        async (pointerType) => {
            await mount(field.markup);
            const host = document.getElementById('f') as HTMLTextAreaElement;
            const edits: Element[] = [];
            const capture = (event: FocusEvent) => {
                const target = event.target as HTMLElement;
                if (target.matches('input, textarea, [contenteditable="true"]'))
                    edits.push(target);
            };
            root.addEventListener('focusin', capture);
            const button = fixButtons()[0];
            const press = new Event('pointerdown', { bubbles: true });
            Object.defineProperty(press, 'pointerType', { value: pointerType });
            button.dispatchEvent(press);
            button.dispatchEvent(
                new MouseEvent('click', {
                    bubbles: true,
                    cancelable: true,
                    detail: 1,
                }),
            );
            await wait(120);
            root.removeEventListener('focusin', capture);
            expect(host.value).toBe(field.fixed);
            expect(edits).toEqual([]);
            expect(root.contains(document.activeElement)).toBe(true);
        },
    );

    it('shows the broken rule directly under the field, then the engine fixes by their messages', async () => {
        await mount(field.markup);

        const list = errorList();
        expect(list.hidden).toBe(false);
        expect(list.textContent).toContain('HOLD requires HIGH.');
        expect(fixButtons().map((b) => b.textContent)).toEqual([
            'Replace LOW with HIGH',
            'Remove HOLD',
        ]);
        // The owned field region includes its findings and fix actions, in
        // the same field/fixes/chrome Tab order.
        const visual = root.querySelector(field.visual)!;
        expect(visual.contains(list)).toBe(field.inside);
        expect(visual.contains(root.querySelector('label'))).toBe(false);
        if (field.inside) {
            const chrome = visual.querySelector(
                ':scope > .ez-field-drawer, :scope > .marked-input-footer',
            );
            expect(list.nextElementSibling).toBe(chrome);
        } else {
            expect(visual.nextElementSibling).toBe(list);
        }
    });

    it('a pressed replace fix lands the corrected marking and clears the error', async () => {
        await mount(field.markup);
        const host = document.getElementById('f') as HTMLTextAreaElement;

        fixButtons()[0].click();
        await wait(120);

        expect(host.value).toBe(field.fixed);
        expect(errorList().hidden).toBe(true);
        expect(root.querySelectorAll('.ez-validation-errors')).toHaveLength(1);
        expect(root.querySelector(field.visual)!.contains(errorList())).toBe(
            true,
        );
    });

    it('leaves nothing behind when the field is destroyed', async () => {
        await mount(field.markup);
        expect(errorList().hidden).toBe(false);

        forms!.destroy();
        forms = null;

        expect(root.querySelector('.ez-validation-errors')).toBeNull();
    });

    it('a pressed remove fix drops the concept', async () => {
        await mount(field.markup);
        const host = document.getElementById('f') as HTMLTextAreaElement;

        fixButtons()[1].click();
        await wait(120);

        expect(host.value).toBe(field.removed);
        expect(errorList().hidden).toBe(true);
    });
});

describe('MarkingField rule errors while editing', () => {
    it('a pointer press on a fix keeps the field focused and the fix stands after the blur delay', async () => {
        await mount(FIELDS[0].markup);
        const host = document.getElementById('f') as HTMLTextAreaElement;
        host.focus();
        host.dispatchEvent(new FocusEvent('focus'));
        await wait();
        const button = fixButtons()[0];

        const press = new MouseEvent('mousedown', {
            bubbles: true,
            cancelable: true,
        });
        button.dispatchEvent(press);
        button.click();
        await wait(250); // past the field's blur reconcile delay

        expect(press.defaultPrevented).toBe(true);
        expect(document.activeElement).toBe(host);
        expect(host.value).toBe('HIGH//HOLD');
    });
});
