import { afterEach, describe, expect, it, vi } from 'vitest';
import { asContext } from '../../test-fixtures/as-context';
import { openContext } from '../../test-fixtures/context-doubles';
import type { ComponentInstance, ComponentOptions } from './component-base';
import { MarkingField } from './marking-field';
import { TagInput } from './tag-input';
import { SingleSelect } from './single-select';
import { CategoryChecklist } from './category-checklist';
import { CategorySelector } from './category-selector';
import { DecisionFlow } from './decision-flow';
import { MarkedInput } from './marked-input';
import { MarkedTextArea } from './marked-text-area';
import { EzClassifyUI } from '../ezclassify-ui';
import { EMPTY_EZCLASSIFY_STATE } from '../store/ezclassify-store';
import {
    typeText,
    wait,
    openSurface,
    press,
} from './composer/composer-harness';
import { connectDemoContext } from '../../../../test-support/demo-runtime';

async function engine() {
    return openContext(
        await connectDemoContext({
            draft: {
                scheme: {
                    scheme: {
                        id: 'clear-fields',
                        name: 'Field Clear Test',
                        description: 'Field Clear Test test fixture.',
                        version: '1.0.0',
                        data: {
                            concepts: ['LOW', 'HIGH'].map((id, index) => ({
                                id,
                                name: id,
                                views: { default: id },
                                categories: ['level'],
                                parents: [],
                                aliases: [],
                                position: index,
                                rank: index,
                            })),
                            categories: [
                                {
                                    id: 'level',
                                    label: 'Level',
                                    single: true,
                                    required: false,
                                    rollup: 'max',
                                    position: 0,
                                },
                            ],
                        },
                        rules: [],
                        embedded_marking: [
                            {
                                pattern: '\\(([^)]+)\\)',
                                template: '({marking}) ',
                            },
                        ],
                        render: {
                            default: 'portion',
                            formats: [
                                {
                                    id: 'portion',
                                    surface: 'marking',
                                    mode: 'inline',
                                    separator: '//',
                                    fields: [
                                        { category: 'level', separator: '/' },
                                    ],
                                },
                            ],
                        },
                    },
                },
            },
        }),
    ).scheme;
}

const fields: {
    name: string;
    create: () => ComponentInstance;
    body?: boolean;
    options?: ComponentOptions;
}[] = [
    { name: 'MarkingField', create: () => new MarkingField() },
    { name: 'TagInput', create: () => new TagInput() },
    { name: 'SingleSelect', create: () => new SingleSelect() },
    { name: 'CategorySelector', create: () => new CategorySelector() },
    { name: 'DecisionFlow', create: () => new DecisionFlow() },
    { name: 'MarkedInput', create: () => new MarkedInput(), body: true },
    { name: 'MarkedTextArea', create: () => new MarkedTextArea(), body: true },
];

let mounted: ComponentInstance | undefined;
afterEach(() => {
    const component = mounted;
    mounted = undefined;
    component?.destroy();
    document.body.innerHTML = '';
});

describe('editable component clear controls', () => {
    it('returns keyboard Clear and Undo to a native select without an explicit tabindex', async () => {
        const root = document.createElement('div');
        root.innerHTML = '<input value="LOW">';
        document.body.appendChild(root);
        mounted = new SingleSelect();
        await mounted.init(root, await engine(), { initialValue: 'LOW' });
        const select = root.querySelector<HTMLSelectElement>('select')!;
        expect(select.hasAttribute('tabindex')).toBe(false);
        // Jsdom has no layout; model the visible native select the browser renders.
        Object.defineProperty(select, 'offsetParent', { get: () => root });
        const clear =
            root.querySelector<HTMLButtonElement>('.ez-clear-button')!;
        clear.focus();
        clear.click();
        await vi.waitFor(() => expect(mounted!.getAssertions()).toEqual([]));
        expect(document.activeElement).toBe(select);
        expect(clear.getAttribute('aria-label')).toBe('Undo clear');
        clear.focus();
        clear.click();
        await vi.waitFor(() => expect(mounted!.getRendered()).toBe('LOW'));
        await vi.waitFor(() => expect(document.activeElement).toBe(select));
    });

    it('does not create a clear control for a decision flow with no categories', async () => {
        const root = document.createElement('div');
        root.setAttribute('data-ezclassify-decisionflow-categories', '[]');
        document.body.appendChild(root);
        mounted = new DecisionFlow();
        await expect(
            mounted.init(root, await engine()),
        ).resolves.toBeUndefined();
        expect(root.querySelector('.ez-clear-button')).toBeNull();
    });

    it('keeps the checklist Clear all action without adding a second clear button', async () => {
        const root = document.createElement('div');
        document.body.appendChild(root);
        root.innerHTML = '<input value="LOW">';
        mounted = new CategoryChecklist();
        await mounted.init(root, await engine(), {
            categoryId: 'level',
            initialValue: 'LOW',
        });
        expect(mounted.getAssertions()).not.toEqual([]);
        expect(root.querySelector('.ez-clear-button')).toBeNull();
        const clear = Array.from(root.querySelectorAll('button')).find(
            (button) => button.textContent === 'Clear all',
        )!;
        clear.click();
        await vi.waitFor(() => expect(mounted!.getAssertions()).toEqual([]));
    });
    for (const field of fields.filter((field) =>
        ['MarkingField', 'TagInput', 'SingleSelect'].includes(field.name),
    )) {
        it(`${field.name} returns a pointer clear to rest without focusing the editor`, async () => {
            const root = document.createElement('div');
            root.innerHTML = '<input value="LOW">';
            document.body.appendChild(root);
            mounted = field.create();
            await mounted.init(root, await engine(), { initialValue: 'LOW' });
            const editor = root.querySelector<HTMLElement>(
                '.marking-field-host, .tag-input-filter, select',
            )!;
            editor.focus();
            const clear =
                root.querySelector<HTMLButtonElement>('.ez-clear-button')!;
            clear.dispatchEvent(
                new MouseEvent('click', { bubbles: true, detail: 1 }),
            );
            await vi.waitFor(() =>
                expect(mounted!.getAssertions()).toEqual([]),
            );
            expect(document.activeElement).not.toBe(editor);
            expect(document.activeElement).not.toBe(clear);
            expect(openSurface()).toBeNull();
        });
    }

    for (const field of fields) {
        it(`${field.name} clears its native value, notifies the host, and puts it back on undo`, async () => {
            const root = document.createElement('div');
            document.body.appendChild(root);
            root.innerHTML =
                field.name === 'MarkedInput'
                    ? '<input type="text" id="clear-test" value="(LOW) A note.">'
                    : field.body
                      ? '<textarea id="clear-test">(LOW) A note.</textarea>'
                      : '<input id="clear-test" type="text" value="LOW">';
            const native = root.querySelector<
                HTMLInputElement | HTMLTextAreaElement
            >('#clear-test')!;
            const changed = vi.fn((_assertions, rendered: string) => {
                if (!field.body) native.value = rendered;
            });
            mounted = field.create();
            await mounted.init(root, await engine(), {
                ...field.options,
                initialValue: field.body ? undefined : 'LOW',
                onChange: changed,
            });
            await vi.waitFor(() =>
                expect(root.querySelector('.ez-clear-button')).not.toBeNull(),
            );
            const button =
                root.querySelector<HTMLButtonElement>('.ez-clear-button')!;
            expect(button.type).toBe('button');
            expect(button.getAttribute('aria-label')).toMatch(/^Clear /);
            expect(button.disabled).toBe(false);
            if (field.name === 'MarkedTextArea') {
                expect((mounted as MarkedTextArea).getSegments()).toHaveLength(
                    1,
                );
            } else {
                expect(mounted.getAssertions()).not.toHaveLength(0);
            }
            const input = vi.fn();
            native.addEventListener('input', input);
            changed.mockClear();
            button.click();
            await vi.waitFor(() =>
                expect(mounted!.getAssertions()).toEqual([]),
            );
            await vi.waitFor(() => expect(native.value).toBe(''));
            if (field.name === 'MarkedTextArea') {
                await vi.waitFor(() =>
                    expect((mounted as MarkedTextArea).getSegments()).toEqual(
                        [],
                    ),
                );
            }
            expect(
                changed.mock.calls.length + input.mock.calls.length,
            ).toBeGreaterThan(0);
            expect(root.querySelector('.ez-composer:not([hidden])')).toBeNull();
            // The × is now the undo of that clear, in the same place.
            expect(root.querySelectorAll('.ez-clear-button')).toHaveLength(1);
            expect(button.getAttribute('aria-label')).toBe('Undo clear');
            expect(button.title).toBe('Undo clear');
            expect(button.getAttribute('aria-disabled')).toBe('false');

            button.click();
            const restored = field.body ? '(LOW) A note.' : 'LOW';
            await vi.waitFor(() => expect(native.value).toBe(restored));
            if (field.name === 'MarkedTextArea') {
                await vi.waitFor(() =>
                    expect(
                        (mounted as MarkedTextArea).getSegments(),
                    ).toHaveLength(1),
                );
            } else {
                await vi.waitFor(() =>
                    expect(mounted!.getAssertions()).not.toHaveLength(0),
                );
            }
            // Undone, the offer is over: the slot is the × again.
            await vi.waitFor(() =>
                expect(button.getAttribute('aria-label')).toMatch(/^Clear /),
            );
            expect(button.getAttribute('aria-disabled')).toBe('false');
        });
    }
});

it('does not restore a previous async read after Clear', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    root.innerHTML = '<input value="LOW">';
    const source = await engine();
    mounted = new MarkingField();
    await mounted.init(root, source, { initialValue: 'LOW' });
    const result = await source.process('HIGH');
    let resolve!: (value: typeof result) => void;
    vi.spyOn(source, 'process').mockImplementationOnce(
        () =>
            new Promise((done) => {
                resolve = done;
            }) as never,
    );
    const pending = mounted.setValue('HIGH');
    root.querySelector<HTMLButtonElement>('.ez-clear-button')!.click();
    resolve(result);
    await pending;
    expect(mounted.getAssertions()).toEqual([]);
    expect(mounted.getRendered()).toBe('');
});

it('clears an unfinished composer draft without committing or reopening it', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    root.innerHTML = '<input value="LOW">';
    mounted = new MarkingField();
    await mounted.init(root, await engine(), { initialValue: 'LOW' });
    const field = root.querySelector<HTMLTextAreaElement>(
        '.marking-field-host',
    )!;
    field.focus();
    typeText(field, 'unrecognized');
    await wait();
    const clear = root.querySelector<HTMLButtonElement>('.ez-clear-button')!;
    clear.click();
    await wait();
    expect(field.value).toBe('');
    expect(mounted.getAssertions()).toEqual([]);
    expect(openSurface()).toBeNull();
    // A keyboard clear leaves focus in the field, not on the undo that took
    // the ×'s place.
    expect(document.activeElement).toBe(field);
    expect(clear.getAttribute('aria-label')).toBe('Undo clear');

    // The undo puts back the marking and the text as it was typed.
    clear.click();
    await vi.waitFor(() => expect(field.value).toBe('unrecognized'));
    expect(mounted.getRendered()).toBe('LOW');
    expect(document.activeElement).toBe(field);
});

it('says what a clear and its undo did, and a double click does not take the clear straight back', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    root.innerHTML = '<input value="LOW">';
    mounted = new MarkingField();
    await mounted.init(root, await engine(), { initialValue: 'LOW' });
    const clear = root.querySelector<HTMLButtonElement>('.ez-clear-button')!;
    const said = () => clear.querySelector('[role="status"]')!.textContent;

    clear.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
    // The second click of a double click lands on the undo in its place.
    clear.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 2 }));
    await vi.waitFor(() =>
        expect(said()).toBe('Marking cleared. Undo is available.'),
    );
    expect(mounted.getRendered()).toBe('');
    expect(clear.getAttribute('aria-label')).toBe('Undo clear');

    clear.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
    await vi.waitFor(() => expect(said()).toBe('Marking restored.'));
    expect(mounted.getRendered()).toBe('LOW');
});

it('clears both bound views through the normal store path', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    root.innerHTML =
        '<input id="doc" value="LOW" data-ezclassify-marking><input data-ezclassify-controller="marking" data-ezclassify-bound-to="doc"><input data-ezclassify-controller="tags" data-ezclassify-bound-to="doc">';
    const forms = new EzClassifyUI(asContext((await engine()) as never), {
        root,
    });
    try {
        await vi.waitFor(() =>
            expect(root.querySelectorAll('.ez-clear-button').length).toBe(2),
        );
        root.querySelector<HTMLButtonElement>('.ez-clear-button')!.click();
        await vi.waitFor(() =>
            expect(forms.store.get('doc').rendered).toBe(''),
        );
        expect(forms.store.get('doc').assertions).toEqual([]);
        expect(root.querySelector('.proto-tag')).toBeNull();
        expect(
            root.querySelector<HTMLTextAreaElement>('.marking-field-host')!
                .value,
        ).toBe('');
    } finally {
        forms.destroy();
    }
});

it('offers the undo of a clear in every view bound to the marking, until the marking next changes', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    root.innerHTML =
        '<input id="doc" value="LOW" data-ezclassify-marking><input data-ezclassify-controller="marking" data-ezclassify-bound-to="doc"><input data-ezclassify-controller="tags" data-ezclassify-bound-to="doc">';
    const forms = new EzClassifyUI(asContext((await engine()) as never), {
        root,
    });
    const labels = () =>
        [...root.querySelectorAll('.ez-clear-button')].map((button) =>
            button.getAttribute('aria-label'),
        );
    try {
        await vi.waitFor(() => expect(labels()).toHaveLength(2));
        await vi.waitFor(() =>
            expect(forms.store.get('doc').rendered).toBe('LOW'),
        );
        const [fieldClear, tagsClear] = [
            ...root.querySelectorAll<HTMLButtonElement>('.ez-clear-button'),
        ];
        fieldClear.click();
        await vi.waitFor(() =>
            expect(forms.store.get('doc').rendered).toBe(''),
        );
        // The offer belongs to the marking, so the other view shows it too.
        expect(labels()).toEqual(['Undo clear', 'Undo clear']);

        tagsClear.click();
        await vi.waitFor(() =>
            expect(forms.store.get('doc').rendered).toBe('LOW'),
        );
        expect(labels()).toEqual(['Clear marking', 'Clear marking']);

        // Cleared again, then the marking changes from somewhere else once
        // the author has moved on: the offer ends in every view.
        fieldClear.click();
        await vi.waitFor(() =>
            expect(forms.store.get('doc').rendered).toBe(''),
        );
        expect(labels()).toEqual(['Undo clear', 'Undo clear']);
        document.body.dispatchEvent(
            new Event('pointerdown', { bubbles: true }),
        );
        await forms.store.publishRendered('doc', 'HIGH');
        await vi.waitFor(() =>
            expect(labels()).toEqual(['Clear marking', 'Clear marking']),
        );
    } finally {
        forms.destroy();
    }
});

for (const attribute of ['disabled', 'readonly']) {
    it(`does not clear a ${attribute} host`, async () => {
        const root = document.createElement('div');
        document.body.appendChild(root);
        root.innerHTML = `<input ${attribute} value="LOW">`;
        mounted = new MarkingField();
        await mounted.init(root, await engine());
        const clear =
            root.querySelector<HTMLButtonElement>('.ez-clear-button')!;
        expect(clear.disabled).toBe(true);
        clear.click();
        expect(mounted.getRendered()).toBe('LOW');
    });
}

it('clears textarea portions and unregisters their store children without a runtime request', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    root.innerHTML = '<textarea>(LOW) A note.</textarea>';
    const source = await engine();
    const unregister = vi.fn();
    const field = new MarkedTextArea();
    mounted = field;
    await field.init(root, source, { unregisterHiddenField: unregister });
    expect(field.getSegments()).toHaveLength(1);
    const scan = vi
        .spyOn(source, 'scan')
        .mockRejectedValue(new Error('offline'));
    const process = vi.spyOn(source, 'process');
    root.querySelector<HTMLButtonElement>('.ez-clear-button')!.click();
    expect(field.getSegments()).toEqual([]);
    expect(
        root.querySelector('.marked-textarea-hidden-fields')?.children,
    ).toHaveLength(0);
    expect(unregister).toHaveBeenCalled();
    expect(scan).not.toHaveBeenCalled();
    expect(process).not.toHaveBeenCalled();
});

it('clears an unfinished TagInput query when no marking has been committed', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    root.innerHTML = '<input value="">';
    mounted = new TagInput();
    await mounted.init(root, await engine());
    const field = root.querySelector<HTMLInputElement>('.tag-input-filter')!;
    field.focus();
    typeText(field, 'unrecognized');
    await wait();
    const clear = root.querySelector<HTMLButtonElement>('.ez-clear-button')!;
    expect(clear.getAttribute('aria-disabled')).toBe('false');
    clear.click();
    await wait();
    expect(field.value).toBe('');
    expect(openSurface()).toBeNull();
    expect(mounted.getAssertions()).toEqual([]);
});

it('can edit a new first portion after clearing an open textarea editor', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    root.innerHTML = '<textarea>(LOW) A note.</textarea>';
    const field = new MarkedTextArea();
    mounted = field;
    await field.init(root, await engine());
    const input = root.querySelector<HTMLTextAreaElement>('textarea')!;
    await wait(250);
    input.focus();
    input.setSelectionRange(2, 2);
    document.dispatchEvent(new Event('selectionchange'));
    await vi.waitFor(() =>
        expect(
            root.querySelector(
                '.marked-textarea-picker-mount .inline-editor-input',
            ),
        ).not.toBeNull(),
    );
    root.querySelector<HTMLButtonElement>('.ez-clear-button')!.click();
    await vi.waitFor(() => expect(input.value).toBe(''));
    input.focus();
    typeText(input, '(LOW) New note.');
    await vi.waitFor(() => expect(field.getSegments()).toHaveLength(1));
    await wait(250);
    input.setSelectionRange(2, 2);
    document.dispatchEvent(new Event('selectionchange'));
    await vi.waitFor(() =>
        expect(
            root.querySelector(
                '.marked-textarea-picker-mount .inline-editor-input',
            ),
        ).not.toBeNull(),
    );
});

it('does not restore a previous read after another bound view clears the marking', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    root.innerHTML = '<input value="LOW">';
    const source = await engine();
    const field = new MarkingField();
    mounted = field;
    await field.init(root, source, { initialValue: 'LOW' });
    const result = await source.process('HIGH');
    let resolve!: (value: typeof result) => void;
    vi.spyOn(source, 'process').mockImplementationOnce(
        () =>
            new Promise((done) => {
                resolve = done;
            }) as never,
    );
    const pending = field.setValue('HIGH');
    field.applyStoreState(EMPTY_EZCLASSIFY_STATE);
    resolve(result);
    await pending;
    expect(field.getAssertions()).toEqual([]);
    expect(field.getRendered()).toBe('');
});

it('clears a new uncommitted textarea marking without leaving its wrapper on screen', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    root.innerHTML = '<textarea></textarea>';
    const field = new MarkedTextArea();
    mounted = field;
    await field.init(root, await engine());
    const input = root.querySelector<HTMLTextAreaElement>('textarea')!;
    input.focus();
    press(input, 'Enter', { ctrlKey: true });
    await vi.waitFor(() =>
        expect(root.querySelector('.inline-editor-input')).not.toBeNull(),
    );
    root.querySelector<HTMLButtonElement>('.ez-clear-button')!.click();
    await wait();
    expect(input.value).toBe('');
    expect(
        root
            .querySelector('.marked-textarea-display')
            ?.textContent?.replace(/\u200b/g, '')
            .trim(),
    ).toBe('');
    expect(root.querySelector('.inline-editor-input')).toBeNull();
});
