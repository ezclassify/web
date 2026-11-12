import { afterEach, describe, expect, it, vi } from 'vitest';
import { asContext } from '../../test-fixtures/as-context';
import { Context } from '@ezclassify/engine';
import {
    openContext,
    type OpenContext,
} from '../../test-fixtures/context-doubles';
import type {
    Assertion,
    ProcessResult,
    ContextSchemeEngineAdapter,
} from '@ezclassify/types';
import { SingleSelect } from './single-select';
import { EzClassifyUI } from '../ezclassify-ui';

/** A short warehouse identifier, unrelated to calendar or authority policy. */
function warehouseContext(): OpenContext {
    return openContext(
        Context.fromComponents({
            scheme: {
                scheme: {
                    id: 'warehouse-entry',
                    version: '1.0.0',
                    name: 'Warehouse Entry',
                    data: {
                        categories: [
                            {
                                id: 'item',
                                label: 'Item',
                                single: true,
                                required: false,
                                rollup: 'union',
                            },
                        ],
                        concepts: [
                            {
                                id: 'identifier',
                                name: 'Identifier',
                                categories: ['item'],
                                views: {
                                    default: 'ID:{value}',
                                    compact: 'ID:{value}',
                                },
                                text_input: {
                                    label: 'Warehouse identifier',
                                    encoding: {
                                        type: 'text',
                                        max_length: 3,
                                    },
                                    required: true,
                                },
                            },
                            {
                                id: 'unlabeled',
                                name: 'Unlabeled',
                                categories: ['item'],
                                views: { default: 'NONE', compact: 'NONE' },
                            },
                        ],
                    },
                    rules: [],
                    render: {
                        default: 'compact',
                        formats: [
                            {
                                id: 'compact',
                                surface: 'marking',
                                mode: 'inline',
                                fields: [{ category: 'item' }],
                            },
                        ],
                    },
                },
            },
        }),
    );
}

const chosen = (value: string): Assertion => ({
    conceptId: 'identifier',
    categoryId: 'item',
    value,
    source: 'user',
    confidence: 'certain',
});

async function mount(facet = true) {
    const context = warehouseContext();
    const target = document.createElement('div');
    document.body.append(target);
    const component = new SingleSelect();
    await component.init(target, context, {
        categoryId: 'item',
        ...(facet ? { facetOf: 'warehouse' } : {}),
    });
    component.setAssertions([chosen('ABC')]);
    const process = vi.spyOn(context.scheme!, 'process');
    const input = () =>
        target.querySelector<HTMLInputElement>('.select-card-text-field')!;
    const edit = (value: string) => {
        input().value = value;
        input().dispatchEvent(new Event('input', { bubbles: true }));
    };
    return { context, target, component, process, input, edit };
}

async function delayedMount(initial: Assertion = chosen('AA')) {
    const context = warehouseContext();
    const local = context.scheme;
    const replies: Array<() => void> = [];
    const requests: unknown[][] = [];
    const remote = new Proxy(local as ContextSchemeEngineAdapter, {
        get(target, property) {
            if (property === 'process')
                return (...args: unknown[]) => {
                    requests.push(args);
                    const result: ProcessResult | Promise<ProcessResult> =
                        Reflect.apply(target.process, target, args);
                    return new Promise<ProcessResult>((resolve) =>
                        replies.push(() => resolve(result)),
                    );
                };
            const value = Reflect.get(target, property);
            return typeof value === 'function' ? value.bind(target) : value;
        },
    });
    const target = document.createElement('div');
    document.body.append(target);
    const component = new SingleSelect();
    await component.init(target, remote, {
        categoryId: 'item',
        facetOf: 'warehouse',
    });
    component.setAssertions([initial]);
    replies[0]();
    await vi.waitFor(() =>
        expect(component.getAssertions()).toEqual([initial]),
    );
    const input = () =>
        target.querySelector<HTMLInputElement>('.select-card-text-field')!;
    const edit = (value: string) => {
        input().value = value;
        input().dispatchEvent(new Event('input', { bubbles: true }));
    };
    return { component, replies, requests, input, edit };
}

afterEach(() => {
    vi.restoreAllMocks();
    document.body.replaceChildren();
});

describe('supplemental draft canonical errors', () => {
    it('shows a rejected warehouse value through an unchanged accepted-state echo without another read', async () => {
        const { context, target, component, process, input, edit } =
            await mount();
        const refused = await context.scheme!.process([chosen('TOOLONG')]);
        expect(refused.valid).toBe(false);
        expect(refused.assertions).toEqual([]);
        process.mockClear();
        edit('TOOLONG');
        await vi.waitFor(() =>
            expect(component.getAssertions()).toEqual(refused.assertions),
        );
        component.setAssertions([...component.getAssertions()]);
        expect(input().value).toBe('TOOLONG');
        expect(input().getAttribute('aria-invalid')).toBe('true');
        expect(
            target.querySelector('.select-card-text-error')?.textContent,
        ).toBe(refused.errors.map((e) => e.message).join('\n'));
        expect(process).toHaveBeenCalledTimes(1);
        input().dispatchEvent(new Event('blur'));
        expect(
            target.querySelector('.select-card-text-error')?.textContent,
        ).toBe(refused.errors.map((e) => e.message).join('\n'));
        expect(process).toHaveBeenCalledTimes(1);
        component.destroy();
    });

    it('clears the rejected draft when corrected, deselected, or replaced externally', async () => {
        const { component, target, input, edit, process } = await mount();
        edit('TOOLONG');
        component.setAssertions([...component.getAssertions()]);
        edit('XYZ');
        await vi.waitFor(() =>
            expect(component.getAssertions()).toEqual([chosen('XYZ')]),
        );
        expect(input().hasAttribute('aria-invalid')).toBe(false);
        expect(
            target.querySelector('.select-card-text-error')?.textContent,
        ).toBe('');
        edit('TOOLONG');
        component.setAssertions([
            {
                conceptId: 'unlabeled',
                categoryId: 'item',
                source: 'user',
                confidence: 'certain',
            },
        ]);
        expect(target.querySelector('.select-card-text-field')).toBeNull();
        expect(component.getRendered()).toBe('NONE');
        component.setAssertions([chosen('ABC')]);
        edit('TOOLONG');
        const select =
            target.querySelector<HTMLSelectElement>('.select-dropdown')!;
        select.value = '';
        select.dispatchEvent(new Event('change', { bubbles: true }));
        expect(target.querySelector('.select-card-text-field')).toBeNull();
        expect(component.getAssertions()).toEqual([]);
        expect(process).toHaveBeenCalledTimes(6);
        component.destroy();
    });

    it('does not attach a canonical error to an empty required draft or publish its missing value', async () => {
        const { component, target, input, edit, process } = await mount();
        edit('');
        expect(component.getAssertions()).toEqual([]);
        expect(input().value).toBe('');
        expect(
            target.querySelector('.select-card-text-error')?.textContent,
        ).toBe('Required');
        expect(process).not.toHaveBeenCalled();
        component.destroy();
    });
    it('keeps the canonical rejection visible through the real facet store while its accepted marking stays empty', async () => {
        const context = warehouseContext();
        const refused = await context.scheme!.process([chosen('TOOLONG')]);
        const root = document.createElement('div');
        root.innerHTML =
            '<input type="hidden" id="warehouse" data-ezclassify-marking><input id="item" data-ezclassify-controller="select" data-ezclassify-facet-of="warehouse" data-ezclassify-category="item">';
        document.body.append(root);
        const forms = new EzClassifyUI(asContext(context), { root });
        try {
            await vi.waitFor(() => expect(forms.isReady).toBe(true));
            await forms.store.publishAssertions('warehouse', [chosen('ABC')]);
            await vi.waitFor(() =>
                expect(
                    root.querySelector<HTMLInputElement>(
                        '.select-card-text-field',
                    )?.value,
                ).toBe('ABC'),
            );
            const input = root.querySelector<HTMLInputElement>(
                '.select-card-text-field',
            )!;
            input.value = 'TOOLONG';
            input.dispatchEvent(new Event('input', { bubbles: true }));
            await vi.waitFor(() =>
                expect(forms.store.get('warehouse').assertions).toEqual(
                    refused.assertions,
                ),
            );
            expect(
                root.querySelector<HTMLInputElement>('.select-card-text-field')
                    ?.value,
            ).toBe('TOOLONG');
            expect(
                root.querySelector('.select-card-text-error')?.textContent,
            ).toBe(refused.errors.map((e) => e.message).join('\n'));
            expect(
                root
                    .querySelector('.select-card-text-field')
                    ?.getAttribute('aria-invalid'),
            ).toBe('true');
            expect(forms.store.get('warehouse').rendered).toBe('');
            await forms.store.publishAssertions('warehouse', [chosen('NEW')]);
            await vi.waitFor(() =>
                expect(
                    root.querySelector<HTMLInputElement>(
                        '.select-card-text-field',
                    )?.value,
                ).toBe('NEW'),
            );
            expect(
                root.querySelector('.select-card-text-error')?.textContent,
            ).toBe('');
            expect(
                root
                    .querySelector('.select-card-text-field')
                    ?.hasAttribute('aria-invalid'),
            ).toBe(false);
        } finally {
            forms.destroy();
        }
    });

    it('ignores a late rejected reading after a newer correction with exactly one read per edit', async () => {
        const context = warehouseContext();
        const replies: Array<() => void> = [];
        const transport: ContextSchemeEngineAdapter = context.scheme;
        const remote = new Proxy(transport, {
            get(target, property) {
                if (property === 'process')
                    return (...args: unknown[]) => {
                        const result: ProcessResult | Promise<ProcessResult> =
                            Reflect.apply(target.process, target, args);
                        return new Promise<ProcessResult>((resolve) =>
                            replies.push(() => resolve(result)),
                        );
                    };
                const value = Reflect.get(target, property);
                return typeof value === 'function' ? value.bind(target) : value;
            },
        });
        const target = document.createElement('div');
        document.body.append(target);
        const component = new SingleSelect();
        await component.init(target, remote, {
            categoryId: 'item',
            facetOf: 'warehouse',
        });
        component.setAssertions([chosen('ABC')]);
        replies[0]();
        // The first reading has landed once its text field is drawn.
        const input = await vi.waitFor(() => {
            expect(component.getAssertions()).toEqual([chosen('ABC')]);
            const field = target.querySelector<HTMLInputElement>(
                '.select-card-text-field',
            );
            expect(field).not.toBeNull();
            return field!;
        });
        input.value = 'TOOLONG';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.value = 'NEW';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        expect(replies).toHaveLength(3);
        replies[2]();
        await vi.waitFor(() =>
            expect(component.getAssertions()).toEqual([chosen('NEW')]),
        );
        replies[1]();
        await Promise.resolve();
        expect(component.getAssertions()).toEqual([chosen('NEW')]);
        expect(
            target.querySelector<HTMLInputElement>('.select-card-text-field')
                ?.value,
        ).toBe('NEW');
        expect(
            target
                .querySelector('.select-card-text-field')
                ?.hasAttribute('aria-invalid'),
        ).toBe(false);
        expect(
            target.querySelector('.select-card-text-error')?.textContent,
        ).toBe('');
        expect(replies).toHaveLength(3);
        component.destroy();
    });
    it.each([{ source: 'parse', sourceRule: 'host-parse-proof' }])(
        'invalidates a pending edit for a same-fact host state update %j',
        async (update) => {
            const { component, replies, requests, input, edit } =
                await delayedMount();
            edit('XY');
            const supplied: Assertion = { ...chosen('XY'), ...update };
            const frozen = structuredClone(supplied);
            component.setAssertions([supplied]);
            expect(component.getAssertions()).toEqual([frozen]);
            replies[1]();
            await Promise.resolve();
            await Promise.resolve();
            expect(component.getAssertions()).toEqual([frozen]);
            expect(replies).toHaveLength(3);
            expect(requests[2][1]).toMatchObject({ assertions: [frozen] });
            replies[2]();
            await vi.waitFor(() =>
                expect(component.getAssertions()).toEqual([frozen]),
            );
            expect(input().value).toBe('XY');
            expect(input().hasAttribute('aria-invalid')).toBe(false);
            expect(supplied).toEqual(frozen);
            expect(replies).toHaveLength(3);
            component.destroy();
        },
    );
});
