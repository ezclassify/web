import { afterEach, describe, expect, it, vi } from 'vitest';
import { Context } from '@ezclassify/engine';
import type { ProcessResult } from '@ezclassify/types';
import { EzClassifyUI } from './ezclassify-ui';
import { VanillaEzClassifyStore } from './store/ezclassify-store';
import { ComponentBase } from './components/component-base';
import { acceptedValue, judgedAsHeld } from './loaded-value';
import { mockProcessResult } from './engine-result-mock';

/** A recognition that read every character. */
function complete(): ProcessResult['recognition'] {
    return { status: 'complete', unmatched: [], corrections: [] } as never;
}

/** A recognition that could not read each of `words` in `source`. */
function unread(
    source: string,
    ...words: string[]
): ProcessResult['recognition'] {
    let from = 0;
    const unmatched = words.map((text) => {
        const start = source.indexOf(text, from);
        from = start + text.length;
        return { start, end: from, text };
    });
    return { status: 'partial', unmatched, corrections: [] } as never;
}

/** Neutral real-engine fixture: no policy vocabulary or external deployment. */
function engine(
    policy:
        | 'preserve_unmatched'
        | 'refuse'
        | 'drop_unmatched' = 'preserve_unmatched',
    repair = false,
) {
    return Context.fromComponents({
        scheme: {
            scheme: {
                id: 'loaded-values',
                version: '1.0.0',
                name: 'Loaded values',
                data: {
                    categories: [
                        {
                            id: 'level',
                            label: 'Level',
                            single: true,
                            required: false,
                            rollup: 'max',
                        },
                        {
                            id: 'tag',
                            label: 'Tag',
                            single: false,
                            required: false,
                            rollup: 'union',
                        },
                        {
                            id: 'hidden',
                            label: 'Hidden',
                            single: false,
                            required: false,
                            rollup: 'union',
                        },
                    ],
                    concepts: {
                        inline: [
                            {
                                id: 'A',
                                name: 'Level A',
                                categories: ['level'],
                                views: { default: 'LEVEL A' },
                                rank: 1,
                            },
                            {
                                id: 'B',
                                name: 'Level B',
                                categories: ['level'],
                                views: { default: 'LEVEL B' },
                                rank: 2,
                            },
                            {
                                id: 'X',
                                name: 'Tag X',
                                categories: ['tag'],
                                views: { default: 'TAG-X' },
                            },
                            {
                                id: 'H',
                                name: 'Hidden fact',
                                categories: ['hidden'],
                                views: { default: 'HIDDEN' },
                            },
                        ],
                    },
                },
                rules: [],
                parse: {
                    case_sensitive: false,
                    strip_whitespace: true,
                    ...(repair
                        ? {
                              normalize: [
                                  {
                                      id: 'dedup',
                                      type: 'dedup',
                                      description: 'Remove duplicate facts',
                                      confidence: 'safe',
                                      explanation: 'Repeated fact',
                                  },
                              ],
                          }
                        : {}),
                },
                render: {
                    default: 'default',
                    of_invalid: policy,
                    formats: [
                        {
                            id: 'default',
                            surface: 'marking',
                            mode: 'inline',
                            separator: '//',
                            fields: [
                                { category: 'level', separator: '/' },
                                { category: 'tag', separator: '/' },
                            ],
                        },
                    ],
                },
            },
        },
    }).scheme;
}
const mounted: EzClassifyUI[] = [];
afterEach(() => {
    mounted.splice(0).forEach((ui) => ui.destroy());
    document.body.innerHTML = '';
});
async function mount(
    controller: string,
    value: string,
    policy?: Parameters<typeof engine>[0],
    storeHost = false,
    repair = false,
    withReceiver = false,
) {
    const form = document.createElement('form');
    const input = document.createElement('input');
    input.type = 'text';
    input.name = 'marking';
    input.id = 'loaded';
    input.value = value;
    if (controller) input.dataset.ezclassifyController = controller;
    if (storeHost) input.dataset.ezclassifyRendered = '';
    form.append(input);
    if (withReceiver) {
        const receiver = document.createElement('input');
        receiver.id = 'receiver';
        receiver.dataset.ezclassifyBind = '';
        receiver.dataset.ezclassifyBoundTo = 'loaded';
        receiver.value = value;
        form.append(receiver);
    }
    document.body.append(form);
    const ui = new EzClassifyUI(engine(policy, repair) as never, {
        root: form,
    });
    mounted.push(ui);
    await new Promise((r) => setTimeout(r, 100));
    return { input, form, ui };
}

it('keeps an unproven string read in bound MF/TI receivers but accepts structured state without recognition', async () => {
    const real = engine();
    const missingRecognition = new Proxy(real, {
        get(target, key) {
            const member = Reflect.get(target, key);
            if (key === 'process')
                return async (...args: unknown[]) => {
                    const result = (await Reflect.apply(
                        member,
                        target,
                        args,
                    )) as ProcessResult;
                    if (typeof args[0] !== 'string') return result;
                    const withoutRecognition: Partial<ProcessResult> = {
                        ...result,
                    };
                    delete withoutRecognition.recognition;
                    return withoutRecognition;
                };
            return typeof member === 'function' ? member.bind(target) : member;
        },
    });
    const form = document.createElement('form');
    form.innerHTML = `<input type="hidden" id="loaded" data-ezclassify-rendered><input id="mf" data-ezclassify-controller="marking" data-ezclassify-bound-to="loaded"><input id="ti" data-ezclassify-controller="tags" data-ezclassify-bound-to="loaded">`;
    document.body.append(form);
    const ready = new Promise((resolve) =>
        form.addEventListener('ezclassify:ready', resolve, { once: true }),
    );
    const ui = new EzClassifyUI(missingRecognition as never, { root: form });
    mounted.push(ui);
    await ready;
    const source = '  level a  ';
    await ui.store.publishRendered('loaded', source);
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(ui.store.get('loaded').rendered).toBe(source);
    expect(ui.store.get('loaded').assessment).toBeUndefined();
    for (const id of ['mf', 'ti']) {
        const host = form.querySelector<HTMLInputElement>('#' + id)!;
        expect(host.value).toBe(source);
        const field =
            ui.components.get(host) ??
            (
                ui as unknown as { autocompleters: Map<Element, ComponentBase> }
            ).autocompleters.get(host);
        expect(field!.getRendered()).toBe(source);
        expect(field!.getAssertions().some((a) => a.conceptId === 'A')).toBe(
            true,
        );
    }
    const assertions = (await real.process('LEVEL A')).assertions;
    await ui.store.publishAssertions('structured', assertions);
    expect(ui.store.get('structured').valid).toBe(true);
    expect('recognition' in ui.store.get('structured')).toBe(false);
    const structured = document.createElement('section');
    structured.innerHTML = `<input type="hidden" id="structured" data-ezclassify-rendered><input id="mf-structured" data-ezclassify-controller="marking" data-ezclassify-bound-to="structured"><input id="ti-structured" data-ezclassify-controller="tags" data-ezclassify-bound-to="structured">`;
    form.append(structured);
    await new Promise((resolve) => setTimeout(resolve, 100));
    for (const id of ['mf-structured', 'ti-structured'])
        expect(form.querySelector<HTMLInputElement>('#' + id)!.value).toBe(
            'LEVEL A',
        );
});

describe('supplied marking acceptance', () => {
    it('takes the rendering verbatim, fixes included, valid or not', () => {
        for (const valid of [true, false]) {
            expect(
                acceptedValue(
                    ' original ',
                    mockProcessResult({
                        rendered: 'FIXED',
                        valid,
                        recognition: complete(),
                    }),
                ),
            ).toBe('FIXED');
        }
        // Unread text stays where the engine wrote it.
        expect(
            acceptedValue(
                'ALPHA//ZZ//BETA',
                mockProcessResult({
                    rendered: 'ALPHA//BETA//ZZ',
                    recognition: unread('ALPHA//ZZ//BETA', 'ZZ'),
                }),
            ),
        ).toBe('ALPHA//BETA//ZZ');
    });
    it('keeps the source only where the result says the rendering is not a reading of it', () => {
        // No recognition, which every text read carries.
        expect(
            acceptedValue(' original ', mockProcessResult({ rendered: 'X' })),
        ).toBe(' original ');
        // A refused write: the rendering is not the marking.
        expect(
            acceptedValue(
                ' original ',
                mockProcessResult({
                    rendered: 'X',
                    recognition: complete(),
                    assessment: {
                        emitted: [],
                        omitted: [],
                        collapsed: [],
                        conflicts: [{ field: 'f', assertions: [] }],
                        unrepresentable: [],
                    },
                }),
            ),
        ).toBe(' original ');
    });
    it('uses the engine judgment after repair without another read', () => {
        const first = mockProcessResult({
            rendered: 'ALPHA//BETA',
            valid: false,
            errors: [{ message: 'about the resulting value' } as never],
            assertionsBeforeRepair: [],
            recognition: complete(),
        });
        const readAgain = vi.fn();
        expect(judgedAsHeld('ALPHA', first, readAgain)).toBe(first);
        expect(readAgain).not.toHaveBeenCalled();
    });
    it('reads again only when the judgment is not about the value', async () => {
        let reads = 0;
        const readAgain = () => {
            reads++;
            return mockProcessResult({ recognition: complete() });
        };
        const same = mockProcessResult({
            rendered: 'ALPHA',
            recognition: complete(),
        });
        expect(judgedAsHeld('ALPHA', same, readAgain)).toBe(same);
        // Written in another form, the same facts: the judgment stands.
        const respelled = mockProcessResult({
            rendered: 'A',
            recognition: complete(),
        });
        expect(judgedAsHeld('ALPHA', respelled, readAgain)).toBe(respelled);
        // Facts the engine did not repair are judged as given.
        const facts = mockProcessResult({ rendered: 'ALPHA' });
        expect(judgedAsHeld([], facts, readAgain)).toBe(facts);
        expect(reads).toBe(0);
        // The engine already judges repaired assertions as held.
        const repaired = mockProcessResult({
            rendered: 'ALPHA',
            valid: false,
            assertionsBeforeRepair: [],
        });
        expect(judgedAsHeld([], repaired, readAgain)).toBe(repaired);
        expect(reads).toBe(0);
        // Unread text the engine moved is found again in the value.
        const moved = mockProcessResult({
            rendered: 'ALPHA//ZZ',
            recognition: unread('ZZ//ALPHA', 'ZZ'),
        });
        const flagged = await judgedAsHeld('ZZ//ALPHA', moved, () =>
            mockProcessResult({
                rendered: 'ALPHA//ZZ',
                recognition: unread('ALPHA//ZZ', 'ZZ'),
            }),
        );
        expect(flagged.recognition?.unmatched).toEqual([
            { start: 7, end: 9, text: 'ZZ' },
        ]);
    });
    for (const controller of ['marking', 'tags']) {
        it(`${controller}: canonicalizes a fully recognized valid loaded value`, async () => {
            const { input } = await mount(controller, '  tag-x // level a  ');
            expect(input.value).toBe('LEVEL A//TAG-X');
        });
        {
            it(`${controller}: holds unread text where the engine writes it, flagged`, async () => {
                const source = '  LEVEL A//BOGUS-TOKEN//TAG-X  ';
                const held = 'LEVEL A//TAG-X//BOGUS-TOKEN';
                const { input, form, ui } = await mount(
                    controller,
                    source,
                    'preserve_unmatched',
                    true,
                );
                expect(input.value).toBe(held);
                expect(new FormData(form).get('marking')).toBe(held);
                expect(form.checkValidity()).toBe(false);
                expect(ui.store.get('loaded').rendered).toBe(held);
                expect(ui.store.get('loaded').valid).toBe(false);
                expect(
                    ui.store.get('loaded').assertions.map((a) => a.conceptId),
                ).toEqual(expect.arrayContaining(['A', 'X']));
                const flag =
                    controller === 'marking'
                        ? '.marking-field-unread'
                        : '.proto-tag--unread';
                expect(
                    [...form.querySelectorAll(flag)].map(
                        (el) => el.textContent,
                    ),
                ).toEqual(['BOGUS-TOKEN']);
                if (controller === 'tags') {
                    // After the chips, ahead of the filter.
                    const row = [
                        ...form.querySelector('.tag-input-wrap')!.children,
                    ].filter((el) =>
                        el.matches('.proto-tag, .tag-input-filter'),
                    );
                    expect(row.at(-2)!.textContent).toBe('BOGUS-TOKEN');
                    expect(row.at(-1)!.matches('.tag-input-filter')).toBe(true);
                    expect(row[0].matches('.proto-tag--unread')).toBe(false);
                }
            });
        }
        it(`${controller}: keeps a marking the engine refused to write`, async () => {
            const source = '  LEVEL A//LEVEL B  ';
            const { input } = await mount(controller, source);
            expect(input.value).toBe(source);
        });
    }
    it('accepts a fully recognized safe repair and records the correction', async () => {
        const { input, ui } = await mount(
            'marking',
            'LEVEL A//LEVEL A',
            undefined,
            false,
            true,
        );
        expect(input.value).toBe('LEVEL A');
        const component = ui.components.get(
            input,
        ) as import('./components/marking-field').MarkingField;
        expect(component.getAppliedFixes().length).toBeGreaterThan(0);
    });
    it('does not overwrite a native replacement while initialization is reading', async () => {
        class Field extends ComponentBase {
            protected setup(): void {}
            protected render(): void {}
            destroy(): void {}
        }
        const real = engine();
        let release: (() => void) | undefined;
        let first = true;
        const delayed = new Proxy(real, {
            get(target, key) {
                const member = Reflect.get(target, key);
                if (key === 'process')
                    return (...args: unknown[]) => {
                        if (!first) return Reflect.apply(member, target, args);
                        first = false;
                        return new Promise((resolve) => {
                            release = () =>
                                resolve(Reflect.apply(member, target, args));
                        });
                    };
                return typeof member === 'function'
                    ? member.bind(target)
                    : member;
            },
        });
        const container = document.createElement('div');
        const native = document.createElement('input');
        native.value = 'LEVEL A';
        container.append(native);
        document.body.append(container);
        const field = new Field();
        const initialized = field.init(container, delayed);
        await Promise.resolve();
        native.value = '  LEVEL A//BOGUS  ';
        expect(release).toBeDefined();
        release!();
        await initialized;
        // The replacement is what was read, not the value it replaced.
        expect(native.value).toBe('LEVEL A//BOGUS');
        expect(field.getRendered()).toBe(native.value);
        expect(field.getAssertions().map((a) => a.conceptId)).toContain('A');
        field.destroy();
    });
    it('edits unresolved tag text whole and carries unread text through chip removal', async () => {
        const source = '  LEVEL A//BOGUS-TOKEN//TAG-X  ';
        const held = 'LEVEL A//TAG-X//BOGUS-TOKEN';
        const { input, form } = await mount(
            'tags',
            source,
            'preserve_unmatched',
            true,
        );
        const filter =
            form.querySelector<HTMLInputElement>('.tag-input-filter')!;
        filter.focus();
        await new Promise((r) => setTimeout(r, 30));
        expect(filter.value).toBe(held);
        expect(form.checkValidity()).toBe(false);
        form.querySelector<HTMLButtonElement>('.proto-tag-remove')!.click();
        await new Promise((r) => setTimeout(r, 30));
        expect(input.value).toBe(held);
        expect(filter.value).toContain('BOGUS-TOKEN');
        expect(form.checkValidity()).toBe(false);
        filter.value = 'LEVEL B';
        filter.dispatchEvent(new Event('input', { bubbles: true }));
        await new Promise((r) => setTimeout(r, 30));
        // A complete preview still has not replaced the invalid held value.
        expect(form.checkValidity()).toBe(false);
        filter.dispatchEvent(
            new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
        );
        await new Promise((r) => setTimeout(r, 60));
        expect(input.value).toBe('LEVEL B//TAG-X');
        expect(form.checkValidity()).toBe(true);
    });
    it('does not drop unresolved source when a tag input event arrives without focus', async () => {
        const source = '  LEVEL A//BOGUS-TOKEN//TAG-X  ';
        const held = 'LEVEL A//TAG-X//BOGUS-TOKEN';
        const { input, form } = await mount(
            'tags',
            source,
            'preserve_unmatched',
            true,
        );
        const filter =
            form.querySelector<HTMLInputElement>('.tag-input-filter')!;
        filter.value = 'LEVEL B';
        filter.dispatchEvent(new Event('input', { bubbles: true }));
        await new Promise((r) => setTimeout(r, 30));
        filter.dispatchEvent(
            new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
        );
        await new Promise((r) => setTimeout(r, 30));
        expect(input.value).toBe(held);
        expect(filter.value).toContain('BOGUS-TOKEN');
        expect(form.checkValidity()).toBe(false);
    });
    it('holds the engine writing of unread input in a store-only native host', async () => {
        const source = '  LEVEL A//BOGUS-TOKEN//TAG-X  ';
        const { input, ui } = await mount(
            '',
            source,
            'preserve_unmatched',
            true,
        );
        expect(input.value).toBe('LEVEL A//TAG-X//BOGUS-TOKEN');
        expect(ui.store.get('loaded').rendered).toBe(input.value);
    });
    it('refuses a category edit that would discard unread seeded text, then allows it after correction', async () => {
        const store = new VanillaEzClassifyStore(
            engine('preserve_unmatched') as never,
        );
        const source = '  LEVEL A//BOGUS-TOKEN//TAG-X  ';
        await store.seedRendered('doc', source);
        await store.publishAssertions(
            'doc',
            [
                {
                    conceptId: 'B',
                    categoryId: 'level',
                    confidence: 'certain',
                    source: 'user',
                },
            ],
            undefined,
            { categories: ['level'] },
        );
        expect(store.get('doc').rendered).toBe('LEVEL A//TAG-X//BOGUS-TOKEN');
        expect(store.get('doc').valid).toBe(false);
        expect(store.get('doc').assertions.map((a) => a.conceptId)).toEqual(
            expect.arrayContaining(['A', 'X']),
        );
        expect(
            store.get('doc').assertions.map((a) => a.conceptId),
        ).not.toContain('B');
        // A refused edit must not survive invisibly and reappear on correction.
        await store.publishRendered('doc', 'LEVEL A//TAG-X');
        expect(store.get('doc').rendered).toBe('LEVEL A//TAG-X');
        await store.publishAssertions(
            'doc',
            [
                {
                    conceptId: 'B',
                    categoryId: 'level',
                    confidence: 'certain',
                    source: 'user',
                },
            ],
            undefined,
            { categories: ['level'] },
        );
        expect(store.get('doc').rendered).toBe('LEVEL B//TAG-X');
        expect(store.get('doc').valid).toBe(true);
        store.destroy();
    });
    it('reflects retained conflicting source into a plain bound receiver instead of its prior marking', async () => {
        const { form, ui } = await mount(
            '',
            'LEVEL A',
            'refuse',
            true,
            false,
            true,
        );
        const receiver = form.querySelector<HTMLInputElement>('#receiver')!;
        const source = '  LEVEL A//LEVEL B  ';
        await ui.store.publishRendered('loaded', source);
        await new Promise((r) => setTimeout(r, 30));
        expect(ui.store.get('loaded').rendered).toBe(source);
        expect(receiver.value).toBe(source);
        expect(ui.store.get('loaded').assessment).toBeUndefined();
        expect(ui.store.get('loaded').valid).toBe(false);
    });
    it('keeps render-suppressed assertions when accepting structured state', async () => {
        const store = new VanillaEzClassifyStore(engine() as never);
        await store.publishAssertions('doc', [
            {
                conceptId: 'A',
                categoryId: 'level',
                confidence: 'certain',
                source: 'user',
            },
            {
                conceptId: 'H',
                categoryId: 'hidden',
                confidence: 'certain',
                source: 'user',
            },
        ]);
        expect(store.get('doc').rendered).toBe('LEVEL A');
        expect(store.get('doc').assertions.map((a) => a.conceptId)).toEqual(
            expect.arrayContaining(['A', 'H']),
        );
        store.destroy();
    });
});

/**
 * A neutral fixture whose rules fix markings: TAG-G adds TAG-O and needs LEVEL
 * B; TAG-O excludes TAG-R. Two defaults fill in once a level is set: STD is
 * written, HOME is left out of the written marking by a render filter, the way
 * a scheme suppresses a fact from print.
 */
function ruledEngine() {
    let position = 0;
    const concept = (id: string, category: string, view: string) => ({
        id,
        name: `Name ${id}`,
        categories: [category],
        views: { default: view },
        parents: [],
        aliases: [],
        position: ++position,
        rank: position,
    });
    const category = (id: string, extra: object = {}) => ({
        id,
        label: id,
        single: id === 'level',
        required: false,
        rollup: id === 'level' ? 'max' : 'union',
        ...extra,
    });
    const whenLevel = { when: { category: 'level', is: 'has_content' } };
    return Context.fromComponents({
        scheme: {
            scheme: {
                id: 'settled-values',
                version: '1.0.0',
                name: 'Settled values',
                default_scope: 'marking',
                scopes: [{ id: 'marking', label: 'Marking' }],
                data: {
                    categories: [
                        category('level'),
                        category('tag'),
                        category('handling', {
                            default_concept: { concept: 'STD', ...whenLevel },
                        }),
                        category('origin', {
                            default_concept: { concept: 'HOME', ...whenLevel },
                        }),
                    ],
                    concepts: {
                        inline: [
                            concept('A', 'level', 'LEVEL A'),
                            concept('B', 'level', 'LEVEL B'),
                            concept('X', 'tag', 'TAG-X'),
                            concept('G', 'tag', 'TAG-G'),
                            concept('O', 'tag', 'TAG-O'),
                            concept('R', 'tag', 'TAG-R'),
                            concept('STD', 'handling', 'STD'),
                            concept('HOME', 'origin', 'HOME'),
                        ],
                    },
                },
                rules: [
                    {
                        id: 'g-needs-b',
                        action: 'require_any',
                        when: 'G',
                        target: ['B'],
                        phases: ['validate'],
                        message: 'TAG-G requires LEVEL B.',
                    },
                    {
                        id: 'g-adds-o',
                        action: 'require',
                        when: 'G',
                        target: 'O',
                        category: 'tag',
                        message: 'TAG-G requires TAG-O.',
                    },
                    {
                        id: 'o-forbids-r',
                        action: 'forbid',
                        when: 'O',
                        target: 'R',
                        message: 'TAG-O and TAG-R cannot appear together.',
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
                            fields: ['level', 'tag', 'handling', 'origin'].map(
                                (id) => ({ category: id, separator: '/' }),
                            ),
                        },
                    ],
                },
                filters: [
                    {
                        id: 'home-origin-unprinted',
                        in: ['render'],
                        remove: ['origin'],
                        when: {
                            all: [
                                { category: 'origin', is: 'count_eq 1' },
                                { category: 'origin', has: 'HOME' },
                            ],
                        },
                        explanation: 'Home origin alone goes without saying.',
                    },
                ],
            },
        },
    }).scheme;
}

/** Mount `markup` over the ruled fixture and wait for it to settle. */
async function mountRuled(markup: string, publish?: [string, string]) {
    const form = document.createElement('form');
    form.innerHTML = markup;
    document.body.append(form);
    const ready = new Promise((resolve) =>
        form.addEventListener('ezclassify:ready', resolve, { once: true }),
    );
    const ui = new EzClassifyUI(ruledEngine() as never, { root: form });
    mounted.push(ui);
    await ready;
    if (publish) await ui.store.publishRendered(...publish);
    await new Promise((r) => setTimeout(r, 120));
    return { form, ui };
}

/**
 * What a field's status mark says EzClassify fixed: hover it past the tooltip's
 * hover-intent delay and read the lines.
 */
async function markLines(field: Element): Promise<string[]> {
    const mark = field.querySelector<HTMLElement>('.ez-status-mark')!;
    mark.dispatchEvent(new Event('mouseenter'));
    await new Promise((r) => setTimeout(r, 400));
    const tip = document.querySelector<HTMLElement>('.ez-tooltip');
    const lines =
        tip && !tip.hidden
            ? [...tip.querySelectorAll(':scope > div')].map(
                  (line) => line.textContent ?? '',
              )
            : [];
    mark.dispatchEvent(new Event('mouseleave'));
    return lines;
}

/** The text of the field's rule errors, in order. */
function errorsOf(form: Element): string[] {
    return [...form.querySelectorAll('.ez-validation-errors__message')].map(
        (el) => el.textContent ?? '',
    );
}

describe('a loaded marking takes what the engine fixed and says so', () => {
    it('adds what a rule requires and keeps the error the value still breaks', async () => {
        const { form } = await mountRuled(
            '<input id="f" data-ezclassify-controller="marking" value="LEVEL A//TAG-G">',
        );
        const host = form.querySelector<HTMLInputElement>('#f')!;
        expect(host.value).toBe('LEVEL A//TAG-G/TAG-O//STD');
        expect(errorsOf(form)).toEqual(['TAG-G requires LEVEL B.']);
        expect(form.checkValidity()).toBe(false);
        const mark = form.querySelector('.ez-status-mark')!;
        expect(mark.classList.contains('ez-status-mark--unseen')).toBe(true);
        expect(await markLines(form)).toEqual([
            'EzClassify fixed this marking:',
            '• Rule "g-adds-o": added "O" to category "tag"',
        ]);
    });

    it('keeps a conflicting requirement unmet for the author to choose', async () => {
        const { form } = await mountRuled(
            '<input id="f" data-ezclassify-controller="marking" value="LEVEL B//TAG-G/TAG-R">',
        );
        expect(form.querySelector<HTMLInputElement>('#f')!.value).toBe(
            'LEVEL B//TAG-G/TAG-R//STD',
        );
        expect(errorsOf(form)).toEqual(['TAG-G requires TAG-O.']);
        expect(form.checkValidity()).toBe(false);
        expect(await markLines(form)).toEqual([]);
    });

    it('reports every requirement the held value still breaks', async () => {
        const { form } = await mountRuled(
            '<input id="f" data-ezclassify-controller="marking" value="LEVEL A//TAG-G/TAG-R">',
        );
        expect(form.querySelector<HTMLInputElement>('#f')!.value).toBe(
            'LEVEL A//TAG-G/TAG-R//STD',
        );
        expect(errorsOf(form)).toEqual([
            'TAG-G requires LEVEL B.',
            'TAG-G requires TAG-O.',
        ]);
    });

    it('keeps explaining the fixes until the value changes', async () => {
        const { form } = await mountRuled(
            '<input id="f" data-ezclassify-controller="marking" value="LEVEL B//TAG-G">',
        );
        const host = form.querySelector<HTMLInputElement>('#f')!;
        // Reading the fixed value again makes no fix of its own.
        host.dispatchEvent(new Event('change', { bubbles: true }));
        await new Promise((r) => setTimeout(r, 120));
        expect((await markLines(form)).length).toBe(2);
        const ui = mounted.at(-1)!;
        await ui.store.publishRendered('f', 'LEVEL B//TAG-X');
        await new Promise((r) => setTimeout(r, 120));
        expect(host.value).toBe('LEVEL B//TAG-X//STD');
        expect(await markLines(form)).toEqual([]);
    });

    it('flags an unrecognized token where the engine writes it', async () => {
        const { form } = await mountRuled(
            '<input id="f" data-ezclassify-controller="marking" value="LEVEL B//TAG-ZZ//TAG-X">',
        );
        const host = form.querySelector<HTMLInputElement>('#f')!;
        expect(host.value).toBe('LEVEL B//TAG-X//STD//TAG-ZZ');
        expect(
            [...form.querySelectorAll('.marking-field-unread')].map(
                (el) => el.textContent,
            ),
        ).toEqual(['TAG-ZZ']);
        expect(errorsOf(form).join(' ')).toContain('TAG-ZZ');
        expect(form.checkValidity()).toBe(false);
    });

    it('leaves a valid marking exactly as written, with a quiet mark', async () => {
        const { form } = await mountRuled(
            '<input id="f" data-ezclassify-controller="marking" value="LEVEL B//TAG-X//STD">',
        );
        expect(form.querySelector<HTMLInputElement>('#f')!.value).toBe(
            'LEVEL B//TAG-X//STD',
        );
        expect(errorsOf(form)).toEqual([]);
        expect(
            form
                .querySelector('.ez-status-mark')!
                .classList.contains('ez-status-mark--quiet'),
        ).toBe(true);
    });

    it('shows the same fixed marking, errors and explanation in every bound field', async () => {
        const { form, ui } = await mountRuled(
            `<input type="hidden" id="doc" data-ezclassify-rendered>
             <div class="mf"><input id="mf" data-ezclassify-controller="marking" data-ezclassify-bound-to="doc"></div>
             <div class="ti"><input id="ti" data-ezclassify-controller="tags" data-ezclassify-bound-to="doc"></div>`,
            ['doc', 'LEVEL A//TAG-G'],
        );
        expect(ui.store.get('doc').rendered).toBe('LEVEL A//TAG-G/TAG-O//STD');
        for (const id of ['mf', 'ti'])
            expect(form.querySelector<HTMLInputElement>('#' + id)!.value).toBe(
                'LEVEL A//TAG-G/TAG-O//STD',
            );
        expect(errorsOf(form.querySelector('.mf')!)).toEqual([
            'TAG-G requires LEVEL B.',
        ]);
        expect(errorsOf(form.querySelector('.ti')!)).toEqual([
            'TAG-G requires LEVEL B.',
        ]);
        for (const field of ['.mf', '.ti'])
            expect((await markLines(form.querySelector(field)!))[1]).toBe(
                '• Rule "g-adds-o": added "O" to category "tag"',
            );
        // The one difference: the chips hold HOME, which the marking leaves
        // out of print.
        expect(
            [...form.querySelectorAll('.ti .proto-tag')].map(
                (chip) => (chip as HTMLElement).dataset.conceptId,
            ),
        ).toEqual(['A', 'G', 'O', 'STD', 'HOME']);
    });
});

it('holds the conflicting marking in the store with author choices and no applied repair', async () => {
    const store = new VanillaEzClassifyStore(ruledEngine() as never);
    await store.publishRendered('doc', 'LEVEL B//TAG-G/TAG-R');
    const state = store.get('doc');
    expect(state.rendered).toBe('LEVEL B//TAG-G/TAG-R//STD');
    expect(state.valid).toBe(false);
    expect(state.errors.map((error) => error.message)).toEqual([
        'TAG-G requires TAG-O.',
    ]);
    expect(
        (state.proposedFixes ?? []).map((fix) => fix.rendered).sort(),
    ).toEqual(['LEVEL B//TAG-G/TAG-O//STD', 'LEVEL B//TAG-R//STD']);
    expect(state.assertions.map((a) => a.conceptId)).toContain('R');
    expect(state.appliedFixes).toEqual([]);
    store.destroy();
});

it('takes a category edit over a fully read marking that breaks a rule', async () => {
    const store = new VanillaEzClassifyStore(ruledEngine() as never);
    await store.seedRendered('doc', 'LEVEL A//TAG-G');
    expect(store.get('doc').valid).toBe(false);
    await store.publishAssertions(
        'doc',
        [
            {
                conceptId: 'B',
                categoryId: 'level',
                confidence: 'certain',
                source: 'user',
            },
        ],
        undefined,
        { categories: ['level'] },
    );
    expect(store.get('doc').rendered).toBe('LEVEL B//TAG-G/TAG-O//STD');
    expect(store.get('doc').valid).toBe(true);
    store.destroy();
});

describe('TagInput chip style follows who stated the fact', () => {
    /** Each chip's concept with its style and whether it can be removed. */
    async function chips() {
        const { form } = await mountRuled(
            '<input id="ti" data-ezclassify-controller="tags" value="LEVEL A//TAG-G">',
        );
        return new Map(
            [...form.querySelectorAll<HTMLElement>('.proto-tag')].map(
                (chip) => [
                    chip.dataset.conceptId,
                    {
                        dashed: chip.classList.contains('proto-tag--inferred'),
                        faded: chip.classList.contains('proto-tag--unprinted'),
                        removable: !!chip.querySelector('.proto-tag-remove'),
                        label: chip.getAttribute('aria-label'),
                    },
                ],
            ),
        );
    }

    it('draws a fact the author stated solid, with a remove button', async () => {
        expect((await chips()).get('G')).toEqual({
            dashed: false,
            faded: false,
            removable: true,
            label: 'Name G',
        });
    });

    it('draws a category default dashed, with no remove button', async () => {
        expect((await chips()).get('STD')).toEqual({
            dashed: true,
            faded: false,
            removable: false,
            label: 'Name STD (inferred)',
        });
    });

    it('draws an inferred fact dashed, with no remove button', async () => {
        expect((await chips()).get('O')).toEqual({
            dashed: true,
            faded: false,
            removable: false,
            label: 'Name O (inferred)',
        });
    });

    it('fades a fact the marking leaves out of print, and says so', async () => {
        expect((await chips()).get('HOME')).toEqual({
            dashed: true,
            faded: true,
            removable: false,
            label: 'Name HOME (inferred) (not shown in the marking)',
        });
    });
});
