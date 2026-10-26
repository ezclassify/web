/**
 * A read started for a field's old value never paints over a new one. A judging
 * read (a whole or parts change) can still be in flight when the value is
 * replaced (a host write, a favorite); its errors and fixes describe the old
 * marking, and a fix pressed from them would overwrite the new value.
 */
import { it, expect, vi } from 'vitest';
import { Context } from '@ezclassify/engine';
import type { ValidationError } from '@ezclassify/types';
import { ComponentBase } from './component-base';
import { mockRenderFormats } from '../render-format-layout-mock';

class Field extends ComponentBase {
    protected setup(): void {}
    protected render(): void {}
    destroy(): void {
        this.container.innerHTML = '';
    }
    protected override getProcessingContext() {
        return { role: 'part' as const };
    }
    shown: ValidationError[][] = [];
    override updateValidationErrors(
        errors: ValidationError[],
        ...rest: Parameters<ComponentBase['updateValidationErrors']> extends [
            unknown,
            ...infer R,
        ]
            ? R
            : never
    ): void {
        this.shown.push(errors);
        super.updateValidationErrors(errors, ...rest);
    }
}

const scheme = {
    name: 'S',
    categories: [{ id: 'cat', label: 'C', single: false, required: false }],
    concepts: ['a', 'b', 'x'].map((id, i) => ({
        id,
        name: id,
        views: { default: id },
        categories: ['cat'],
        parents: [],
        aliases: [],
        position: i,
    })),
    formats: [
        {
            id: 'default',
            categoryOrder: ['cat'],
            separator: ' ',
            categorySeparator: '//',
            view: 'default',
        },
    ],
    scopes: [],
    defaultRenderFormat: 'default',
};

it('drops a judging read of the old value once a new value is set', async () => {
    // Reads of stated assertions (judging reads) wait until released; reads
    // of text answer at once.
    const held: Array<() => void> = [];
    const engine = {
        getScheme: () => scheme,
        getSchemeMeta: () => ({
            id: 't',
            version: '1',
            name: 'S',
            defaultRenderFormat: 'default',
            formats: mockRenderFormats(scheme.formats),
            scopes: [],
        }),
        listCategories: () => scheme.categories,
        getConceptsInCategory: (c: string) =>
            scheme.concepts.filter((x) => x.categories.includes(c)),
        render: vi.fn(),
        process: vi.fn(
            (
                input: string,
                opts?: { assertions?: { conceptId: string }[] },
            ) => {
                const stated =
                    opts?.assertions ??
                    input
                        .split(',')
                        .filter(Boolean)
                        .map((id) => ({
                            conceptId: id.trim(),
                            categoryId: 'cat',
                            confidence: 'certain',
                            source: 'user',
                        }));
                const ids = stated.map((a) => a.conceptId);
                const result = {
                    assertions: stated,
                    rendered: ids.join(','),
                    valid: !ids.includes('a'),
                    errors: ids.includes('a')
                        ? [{ constraintId: 'r1', message: 'a needs x' }]
                        : [],
                    warnings: [],
                    proposedFixes: [],
                };
                if (opts?.assertions)
                    return new Promise((r) => held.push(() => r(result)));
                return Promise.resolve(result);
            },
        ),
        suggest: vi.fn().mockReturnValue({ suggestions: [] }),
        describeConcept: vi.fn().mockReturnValue({ lines: [] }),
    };
    const field = new Field();
    const container = document.createElement('div');
    document.body.appendChild(container);
    await field.init(
        container as HTMLDivElement,
        Context.fromSchemeEngine(engine as never),
    );
    await field.setValue('a');

    field.refreshWhole();
    await new Promise((r) => setTimeout(r, 0));
    await field.setValue('b');
    expect(field.shown.at(-1)).toEqual([]);

    held.forEach((release) => release());
    await new Promise((r) => setTimeout(r, 0));
    expect(field.shown.at(-1)).toEqual([]);
    expect(field.getAssertions().map((a) => a.conceptId)).toEqual(['b']);
});
