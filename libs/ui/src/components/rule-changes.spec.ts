import { openFieldTools } from '../../test-fixtures/marking-tools';
/**
 * What a marking rule changed, as the author sees it: a value a rule added is
 * drawn in the family's inferred style after the author reviews it, an option
 * another choice includes never looks chosen, and the status mark's list ends
 * with the undo of the author's last edit.
 *
 * The engine here is a stand-in with two rules: LOW brings STD (a value the
 * marking writes, named in `appliedFixes`), and GROUP brings its member MEMBER
 * (a value the marking does not write, known only as a derived fact).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Assertion, Change, Fix } from '@ezclassify/types';
import { schemeOnlyContext } from '../../test-fixtures/context-doubles';
import { mockRenderFormats } from '../render-format-layout-mock';
import { derivedAssertion } from '../assertion-identity';
import { DecisionFlow } from './decision-flow';
import { MarkingField } from './marking-field';
import { MarkedInput } from './marked-input';
import { MarkedTextArea } from './marked-text-area';
import { TagInput } from './tag-input';
import type { ComponentInstance } from './component-base';
import { cleanupTooltipForRoot } from './tooltip-manager';

const CONCEPTS = [
    { id: 'LOW', name: 'Low', category: 'level' },
    { id: 'HIGH', name: 'High', category: 'level' },
    { id: 'GROUP', name: 'Group', category: 'group', members: ['MEMBER'] },
    { id: 'MEMBER', name: 'Member', category: 'group' },
    { id: 'STD', name: 'Standard', category: 'handling' },
];
const ORDER = ['level', 'group', 'handling'];

function categoryOf(conceptId: string): string {
    return CONCEPTS.find((c) => c.id === conceptId)!.category;
}

function stated(conceptId: string): Assertion {
    return {
        conceptId,
        categoryId: categoryOf(conceptId),
        confidence: 'certain',
        source: 'parse',
    };
}

/** Read `input`, or settle the stated facts given, and apply both rules. */
function settleMarking(input: string, given?: readonly Assertion[]) {
    const facts =
        given && given.length > 0
            ? given.filter((a) => !derivedAssertion(a))
            : input
                  .split(/\/\/?/)
                  .filter((id) => CONCEPTS.some((c) => c.id === id))
                  .map(stated);
    const holds: Assertion[] = [...facts];
    const appliedFixes: Change[] = [];
    const has = (id: string) => holds.some((a) => a.conceptId === id);
    if (has('LOW') && !has('STD')) {
        holds.push({
            conceptId: 'STD',
            categoryId: 'handling',
            confidence: 'inferred',
            source: 'infer',
            sourceRule: 'adds-std',
        });
        appliedFixes.push({
            ruleId: 'adds-std',
            action: 'add',
            add: [{ conceptId: 'STD', categoryId: 'handling' }],
            message: 'Rule "adds-std": added "STD"',
        });
    }
    if (has('GROUP') && !has('MEMBER'))
        holds.push({
            conceptId: 'MEMBER',
            categoryId: 'group',
            confidence: 'inferred',
            source: 'infer',
            sourceRule: 'expands-group',
        });
    const rendered = ORDER.map((category) =>
        holds
            .filter(
                (a) => a.categoryId === category && a.conceptId !== 'MEMBER',
            )
            .map((a) => a.conceptId)
            .join('/'),
    )
        .filter(Boolean)
        .join('//');
    return {
        assertions: holds,
        rendered,
        valid: true,
        inputWasValid: true,
        errors: [],
        warnings: [],
        appliedFixes,
        proposedFixes: [],
        notices: [],
        recognition: { status: 'complete', unmatched: [] },
        assessment: {
            emitted: [],
            omitted: holds
                .filter((a) => a.conceptId === 'MEMBER')
                .map(({ conceptId, categoryId }) => ({
                    conceptId,
                    categoryId,
                })),
            collapsed: [],
            conflicts: [],
            unrepresentable: [],
        },
    };
}

function engine() {
    const concepts = CONCEPTS.map((c, index) => ({
        id: c.id,
        name: c.name,
        views: { default: c.id },
        categories: [c.category],
        parents: [],
        aliases: [],
        position: index,
        ...(c.members ? { members: c.members } : {}),
    }));
    const categories = [
        { id: 'level', label: 'Level', single: true },
        { id: 'group', label: 'Groups', single: false },
        { id: 'handling', label: 'Handling', single: false },
    ].map((category, index) => ({
        required: false,
        rollup: 'union',
        position: index,
        ...category,
    }));
    const formats = [
        {
            id: 'default',
            categoryOrder: ORDER,
            separator: '/',
            categorySeparator: '//',
            view: 'default',
        },
    ];
    const scheme = {
        id: 'rule-changes',
        version: '1.0.0',
        name: 'Rule changes',
        concepts,
        categories,
        formats,
        defaultRenderFormat: 'default',
        scopes: [],
    };
    const suggestions = concepts.map((c) => ({
        conceptId: c.id,
        categoryId: c.categories[0],
        label: c.id,
        name: c.name,
        group: c.categories[0],
    }));
    return {
        getScheme: () => scheme,
        getSchemeMeta: () => ({
            id: scheme.id,
            version: scheme.version,
            name: scheme.name,
            defaultRenderFormat: 'default',
            formats: mockRenderFormats(formats),
            scopes: [],
        }),
        listCategories: () => categories,
        getConceptsInCategory: (categoryId: string) =>
            concepts.filter((c) => c.categories.includes(categoryId)),
        process: (
            input: string,
            opts?: { assertions?: Assertion[]; suggestFor?: string[] },
        ) => ({
            ...settleMarking(input, opts?.assertions),
            ...(opts?.suggestFor
                ? {
                      suggestionsFor: Object.fromEntries(
                          opts.suggestFor.map((id) => [
                              id,
                              {
                                  suggestions: suggestions.filter(
                                      (s) => s.categoryId === id,
                                  ),
                                  warnings: [],
                              },
                          ]),
                      ),
                  }
                : {}),
        }),
        validate: (input: string) => settleMarking(input),
        render: (assertions: Assertion[]) => {
            const { rendered, assessment } = settleMarking('', assertions);
            return { rendered, assessment };
        },
        suggest: () => ({ suggestions }),
        aggregate: () => ({ rendered: '', assertions: [] }),
        describeConcept: (conceptId: string) => ({ lines: [conceptId] }),
    };
}

const context = () => schemeOnlyContext(engine() as never);
const wait = (ms = 0) => new Promise((r) => setTimeout(r, ms));
/** Let the engine's answers and what they trigger land. */
async function settle(): Promise<void> {
    for (let i = 0; i < 6; i++) await wait();
}

/** Open the field's tools so its corrections are reviewed, then close. */
async function review(root: Element): Promise<void> {
    const mark = root.querySelector<HTMLElement>('.ez-status-mark')!;
    mark.click();
    await wait(400);
    const tipId = mark.getAttribute('aria-describedby');
    const tip = tipId ? document.getElementById(tipId) : null;
    tip?.querySelector<HTMLButtonElement>('.ez-marking-tools__close')?.click();
    await wait();
}

let container: HTMLDivElement;
let mounted: ComponentInstance | undefined;

beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
});

afterEach(() => {
    mounted?.destroy();
    mounted = undefined;
    cleanupTooltipForRoot(document.body);
    document.body.innerHTML = '';
});

describe('reviewing a correction keeps its inferred values italic', () => {
    it('in the text of a MarkingField', async () => {
        container.innerHTML = '<input value="LOW">';
        const field = new MarkingField();
        mounted = field;
        await field.init(container, context());
        await settle();
        const inferred = () =>
            [
                ...document.querySelectorAll('.marking-field-token--inferred'),
            ].map((token) => token.textContent);

        expect(inferred()).toEqual(['STD']);
        await review(document.body);
        expect(inferred()).toEqual(['STD']);
        await field.setValue('LOW//STD');
        await settle();
        expect(inferred()).toEqual([]);
    });

    it('in the value line of a DecisionFlow', async () => {
        const flow = new DecisionFlow();
        mounted = flow;
        await flow.init(container, context(), { initialValue: 'LOW' });
        await settle();
        const inferred = () =>
            [
                ...container.querySelectorAll(
                    '.ez-decision-flow__value-inferred',
                ),
            ].map((value) => value.textContent);

        expect(
            container.querySelector('.ez-decision-flow__value-text')
                ?.textContent,
        ).toBe('LOW//STD');
        expect(inferred()).toEqual(['STD']);
        await review(container);
        expect(inferred()).toEqual(['STD']);
        await flow.setValue('LOW//STD');
        await settle();
        expect(inferred()).toEqual([]);
    });

    it('in TagInput chips', async () => {
        container.innerHTML = '<input value="LOW">';
        const field = new TagInput();
        mounted = field;
        await field.init(container, context());
        await settle();
        const inferred = () =>
            [...container.querySelectorAll('.proto-tag--inferred')].map(
                (tag) => tag.textContent,
            );

        expect(inferred().join()).toContain('STD');
        await review(document.body);
        expect(inferred().join()).toContain('STD');
        await field.setValue('LOW//STD');
        await settle();
        expect(inferred()).toEqual([]);
    });
});

it('keeps a rule-added value inferred when MarkedInput applies a proposed fix', async () => {
    const adapter = engine();
    const scheme = {
        ...adapter.getScheme(),
        embeddedMarking: [
            { pattern: '\\(([^)]+)\\)', template: '({marking}) ' },
        ],
    };
    const keep = { conceptId: 'LOW', categoryId: 'level' };
    const drop = { conceptId: 'HIGH', categoryId: 'level' };
    const fix: Fix = {
        message: 'Remove HIGH',
        rendered: 'LOW//STD',
        keeps: [keep],
        adds: [],
        removes: [drop],
    };
    const process = vi.fn((...args: Parameters<typeof adapter.process>) => {
        const result = adapter.process(...args);
        if (args[0] !== 'LOW/HIGH') return result;
        return {
            ...result,
            valid: false,
            errors: [
                { constraintId: 'one-level', message: 'Choose one level.' },
            ],
            proposedFixes: [fix],
        };
    });
    container.innerHTML = '<input value="(LOW/HIGH) Quarterly memo">';
    const field = new MarkedInput();
    mounted = field;
    await field.init(
        container,
        schemeOnlyContext({ ...adapter, getScheme: () => scheme, process }),
    );

    const fixButton = [
        ...openFieldTools(container)!.querySelectorAll('button'),
    ].find((button) => button.textContent === fix.message);
    expect(fixButton).toBeDefined();
    fixButton?.click();

    await vi.waitFor(() => {
        expect(process).toHaveBeenLastCalledWith(
            '',
            expect.objectContaining({
                assertions: [
                    expect.objectContaining({ ...keep, source: 'user' }),
                ],
            }),
        );
        expect(field.getAssertions()).toContainEqual(
            expect.objectContaining({ conceptId: 'STD', source: 'infer' }),
        );
        expect(container.querySelector('.marked-input-native')).toHaveProperty(
            'value',
            '(LOW//STD) Quarterly memo',
        );
        expect(
            container.querySelector('.ez-status-mark__count')?.textContent,
        ).toBe('1');
    });
});

describe('clearing a marking starts a fresh correction history', () => {
    it.each([MarkingField, TagInput, DecisionFlow])(
        'shows a fresh correction after re-entering the same marking in %s',
        async (Control) => {
            if (Control !== DecisionFlow) container.innerHTML = '<input>';
            const field = new Control();
            mounted = field;
            await field.init(container, context());
            const badge = () => document.querySelector('.ez-status-mark');
            const label = () => badge()?.getAttribute('aria-label');
            await field.setValue('LOW');
            await vi.waitFor(() =>
                expect(label()).toContain('not yet reviewed'),
            );
            await review(document.body);
            expect(label()).not.toContain('not yet reviewed');

            document
                .querySelector<HTMLButtonElement>('.ez-clear-button')!
                .click();
            await vi.waitFor(() => {
                expect(field.getAssertions()).toEqual([]);
                expect(label()).not.toContain('change made');
            });
            await field.setValue('LOW');
            await vi.waitFor(() =>
                expect(label()).toContain('not yet reviewed'),
            );
        },
    );
});

describe('autofixes in a phone picker', () => {
    beforeEach(() => {
        vi.stubGlobal('innerWidth', 390);
        vi.stubGlobal('matchMedia', (query: string) => ({
            matches: query.includes('coarse'),
            media: query,
            addEventListener() {},
            removeEventListener() {},
        }));
    });

    afterEach(() => vi.unstubAllGlobals());

    it.each([
        {
            control: MarkingField,
            opener: '.marking-field-host',
            markup: '<input value="HIGH">',
        },
        {
            control: TagInput,
            opener: '.tag-input-filter',
            markup: '<input value="HIGH">',
        },
        {
            control: MarkedInput,
            opener: '.marked-input-touch-add',
            markup: '<input>',
        },
        {
            control: MarkedTextArea,
            opener: '.marked-textarea-touch-add',
            markup: '<textarea></textarea>',
        },
    ])(
        'previews the rule in $control.name without saving when tools open',
        async ({ control, opener, markup }) => {
            container.innerHTML = markup;
            const field = new control();
            mounted = field;
            await field.init(container, context());
            await settle();

            const badge =
                container.querySelector<HTMLButtonElement>('.ez-status-mark')!;
            const input = container.querySelector<HTMLElement>(opener)!;
            const count = () =>
                badge.querySelector('.ez-status-mark__count')?.textContent;
            const tools = () =>
                document.getElementById(
                    badge.getAttribute('aria-describedby') ?? '',
                );
            const before = field.getAssertions();
            const openDraft = async () => {
                input.dispatchEvent(
                    new Event('pointerdown', { bubbles: true }),
                );
                input.focus();
                input.click();
                const sheet = await vi.waitFor(() => {
                    const open = document.querySelector<HTMLElement>(
                        '.ez-composer[data-surface="sheet"]:not([hidden])',
                    );
                    expect(
                        open
                            ?.querySelector('.ez-composer__sheet-tools')
                            ?.contains(badge),
                    ).toBe(true);
                    return open!;
                });
                const draft = sheet.querySelector<HTMLInputElement>(
                    '.ez-composer__sheet-input',
                )!;
                draft.value = 'LOW';
                draft.dispatchEvent(new Event('input', { bubbles: true }));
                return sheet;
            };

            const sheet = await openDraft();
            badge.click();
            await vi.waitFor(() => {
                expect(count()).toBe('1');
                expect(
                    tools()?.querySelector('.ez-status-list__rule')
                        ?.textContent,
                ).toBe('Rule: adds-std');
                expect(
                    tools()?.querySelector('.ez-status-list__text')
                        ?.textContent,
                ).toContain('STD');
                expect(document.activeElement?.getAttribute('role')).toBe(
                    'tab',
                );
            });
            window.dispatchEvent(new Event('resize'));
            await wait(150);
            expect(sheet.hidden).toBe(false);
            expect(tools()?.contains(document.activeElement)).toBe(true);
            expect(field.getAssertions()).toEqual(before);
            tools()
                ?.querySelector<HTMLButtonElement>('.ez-marking-tools__close')
                ?.click();
            expect(tools()).toBeNull();
            sheet
                .querySelector<HTMLButtonElement>('.ez-composer__sheet-cancel')!
                .click();
            await vi.waitFor(() => expect(sheet.hidden).toBe(true));
            expect(field.getAssertions()).toEqual(before);
            expect(count()).toBe('');

            // The embedded fields' commit goes through their scan adapters.
            // This fixture covers the standalone fields' post-commit badge.
            if (control === MarkedInput || control === MarkedTextArea) return;

            const reopened = await openDraft();
            reopened
                .querySelector<HTMLButtonElement>('.ez-composer__sheet-done')!
                .click();
            await vi.waitFor(() => {
                expect(reopened.hidden).toBe(true);
                expect(field.getAssertions().map((a) => a.conceptId)).toContain(
                    'STD',
                );
                expect(container.querySelector('.ez-status-mark')).toBe(badge);
                expect(count()).toBe('1');
            });
            if (control === MarkingField) {
                expect(
                    container.querySelector('.marking-field-token--inferred')
                        ?.textContent,
                ).toBe('STD');
            }
        },
    );
});

describe('a DecisionFlow option the author did not choose', () => {
    it('shows a value another choice includes as inferred, not chosen, and says what included it', async () => {
        const flow = new DecisionFlow();
        mounted = flow;
        await flow.init(container, context(), { initialValue: 'GROUP' });
        await settle();
        container
            .querySelector<HTMLElement>(
                '.ez-decision-flow__step-dot[data-category-id="group"]',
            )!
            .click();
        await settle();
        const option = (conceptId: string) =>
            container.querySelector<HTMLButtonElement>(
                `.ez-decision-flow__option[data-concept-id="${conceptId}"]`,
            )!;

        expect(option('GROUP').getAttribute('aria-checked')).toBe('true');
        expect(
            option('GROUP').classList.contains(
                'ez-decision-flow__option--inferred',
            ),
        ).toBe(false);

        const member = option('MEMBER');
        expect(member.getAttribute('aria-checked')).toBe('false');
        expect(
            member.classList.contains('ez-decision-flow__option--inferred'),
        ).toBe(true);
        // Each named as the marking writes it, the name in the tooltip.
        expect(member.getAttribute('aria-label')).toBe('MEMBER (inferred)');
        expect(member.title.split('\n')).toEqual([
            'Groups: Member',
            'Included by GROUP',
        ]);
        const description = document.getElementById(
            member.getAttribute('aria-describedby')!,
        );
        expect(description?.textContent).toContain(
            'Groups: Member. Included by GROUP.',
        );
    });
});

describe('the undo of the author last edit', () => {
    /** A TagInput holding LOW and GROUP, with GROUP removed by its ×. */
    async function editedTags(): Promise<TagInput> {
        container.innerHTML = '<input value="LOW//GROUP">';
        const tags = new TagInput();
        mounted = tags;
        await tags.init(container, context());
        await settle();
        container
            .querySelector<HTMLElement>(
                '.proto-tag[data-concept-id="GROUP"] .proto-tag__remove, .proto-tag[data-concept-id="GROUP"] button',
            )!
            .click();
        await settle();
        expect(tags.getRendered()).toBe('LOW//STD');
        return tags;
    }

    /** Press the field's status mark open and read its list. */
    function openList(): HTMLElement {
        const mark = container.querySelector<HTMLElement>('.ez-status-mark')!;
        mark.click();
        return document.getElementById(mark.getAttribute('aria-describedby')!)!;
    }

    it('is not offered for a value the field loaded', async () => {
        container.innerHTML = '<input value="LOW">';
        const tags = new TagInput();
        mounted = tags;
        await tags.init(container, context());
        await settle();
        const list = openList();
        expect(list.hidden).toBe(false);
        expect(list.querySelector('.ez-status-list__undo')).toBeNull();
    });

    it('ends the status list after an edit, and puts the marking back', async () => {
        const tags = await editedTags();
        const list = openList();
        const undo = list.querySelector<HTMLButtonElement>(
            '.ez-status-list__undo',
        )!;
        expect(undo.textContent).toBe('Undo last edit');
        expect(
            document.getElementById(undo.getAttribute('aria-describedby')!)
                ?.textContent,
        ).toBe('Puts the marking back to what it was before your last edit.');

        undo.click();
        await settle();
        expect(tags.getRendered()).toBe('LOW//GROUP//STD');
        expect(list.hidden).toBe(true);
        await vi.waitFor(() =>
            expect(
                [...container.querySelectorAll('[role="status"]')].map(
                    (status) => status.textContent,
                ),
            ).toContain('Last edit undone.'),
        );
        // One level only: nothing more to undo.
        expect(openList().querySelector('.ez-status-list__undo')).toBeNull();
    });

    it('is what Ctrl+Z does in the field while it is offered', async () => {
        const tags = await editedTags();
        const filter =
            container.querySelector<HTMLInputElement>('.tag-input-filter')!;

        // Text typed and not committed is the last action: the platform's
        // own undo takes it.
        filter.value = 'HI';
        const typed = new KeyboardEvent('keydown', {
            key: 'z',
            ctrlKey: true,
            bubbles: true,
            cancelable: true,
        });
        filter.dispatchEvent(typed);
        expect(typed.defaultPrevented).toBe(false);
        filter.value = '';

        const chord = new KeyboardEvent('keydown', {
            key: 'z',
            metaKey: true,
            bubbles: true,
            cancelable: true,
        });
        filter.dispatchEvent(chord);
        expect(chord.defaultPrevented).toBe(true);
        await settle();
        expect(tags.getRendered()).toBe('LOW//GROUP//STD');

        // Nothing left to undo: the chord goes back to the platform.
        const again = new KeyboardEvent('keydown', {
            key: 'z',
            ctrlKey: true,
            bubbles: true,
            cancelable: true,
        });
        filter.dispatchEvent(again);
        expect(again.defaultPrevented).toBe(false);
    });
});
