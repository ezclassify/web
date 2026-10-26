import { afterEach, describe, expect, it, vi } from 'vitest';
import { Context } from '@ezclassify/engine';
import type { ComponentInstance, ComponentOptions } from './component-base';
import { MarkingField } from './marking-field';
import { TagInput } from './tag-input';
import { SingleSelect } from './single-select';
import { CategoryChecklist } from './category-checklist';
import { CategorySelector } from './category-selector';
import { DualPane } from './dual-pane';
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

function engine() {
    return Context.fromComponents({
        scheme: {
            scheme: {
                id: 'clear-fields',
                name: 'Field Clear Test',
                version: '1.0.0',
                data: {
                    concepts: {
                        inline: ['LOW', 'HIGH'].map((id, index) => ({
                            id,
                            name: id,
                            views: { default: id },
                            categories: ['level'],
                            parents: [],
                            aliases: [],
                            position: index,
                            rank: index,
                        })),
                    },
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
                    { pattern: '\\(([^)]+)\\)', template: '({marking}) ' },
                ],
                parse: { case_sensitive: false, strip_whitespace: true },
                render: {
                    default: 'portion',
                    formats: [
                        {
                            id: 'portion',
                            surface: 'marking',
                            mode: 'inline',
                            separator: '//',
                            fields: [{ category: 'level', separator: '/' }],
                        },
                    ],
                },
            },
        },
    }).scheme;
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
    { name: 'DualPane', create: () => new DualPane() },
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
    it('does not create a clear control for a decision flow with no categories', async () => {
        const root = document.createElement('div');
        root.setAttribute('data-ezclassify-decisionflow-categories', '[]');
        document.body.appendChild(root);
        mounted = new DecisionFlow();
        await expect(mounted.init(root, engine())).resolves.toBeUndefined();
        expect(root.querySelector('.ez-clear-button')).toBeNull();
    });

    it('keeps the checklist Clear all action without adding a second clear button', async () => {
        const root = document.createElement('div');
        document.body.appendChild(root);
        root.innerHTML = '<input value="LOW">';
        mounted = new CategoryChecklist();
        await mounted.init(root, engine(), {
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
            await mounted.init(root, engine(), { initialValue: 'LOW' });
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
        it(`${field.name} clears its native value and notifies the host`, async () => {
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
            await mounted.init(root, engine(), {
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
            expect(button.getAttribute('aria-disabled')).toBe('true');
            expect(root.querySelector('.ez-composer:not([hidden])')).toBeNull();
        });
    }
});

it('does not restore a previous async read after Clear', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    root.innerHTML = '<input value="LOW">';
    const source = engine();
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
    await mounted.init(root, engine(), { initialValue: 'LOW' });
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
    expect(document.activeElement).toBe(clear);
});

it('clears both bound views through the normal store path', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    root.innerHTML =
        '<input id="doc" value="LOW" data-ezclassify-rendered><input data-ezclassify-controller="marking" data-ezclassify-bound-to="doc"><input data-ezclassify-controller="tags" data-ezclassify-bound-to="doc">';
    const forms = new EzClassifyUI(engine() as never, { root });
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

for (const attribute of ['disabled', 'readonly']) {
    it(`does not clear a ${attribute} host`, async () => {
        const root = document.createElement('div');
        document.body.appendChild(root);
        root.innerHTML = `<input ${attribute} value="LOW">`;
        mounted = new MarkingField();
        await mounted.init(root, engine());
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
    const source = engine();
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
    await mounted.init(root, engine());
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
    await field.init(root, engine());
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
    const source = engine();
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
    await field.init(root, engine());
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
