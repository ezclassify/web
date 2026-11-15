/**
 * What a marking rule changed, as the author sees it: a value a rule added is
 * drawn in the family's inferred style until the author reviews it, an option
 * another choice includes never looks chosen, and the status mark's list ends
 * with the undo of the author's last edit.
 *
 * The engine here is a stand-in with two rules: LOW brings STD (a value the
 * marking writes, named in `appliedFixes`), and GROUP brings its member MEMBER
 * (a value the marking does not write, known only as a derived fact).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Assertion, Change } from '@ezclassify/types';
import { schemeOnlyContext } from '../../test-fixtures/context-doubles';
import { mockRenderFormats } from '../render-format-layout-mock';
import { derivedAssertion } from '../assertion-identity';
import { DecisionFlow } from './decision-flow';
import { MarkingField } from './marking-field';
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

/** Hover the field's status mark past its delay, so its list is reviewed. */
async function review(root: Element): Promise<void> {
    const mark = root.querySelector<HTMLElement>('.ez-status-mark')!;
    mark.dispatchEvent(new Event('mouseenter'));
    await wait(400);
    mark.dispatchEvent(new Event('mouseleave'));
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

describe('a value a rule added is drawn inferred until it is reviewed', () => {
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
        expect(inferred()).toEqual([]);
    });
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
            'Included by GROUP',
            'Member',
        ]);
        const description = document.getElementById(
            member.getAttribute('aria-describedby')!,
        );
        expect(description?.textContent).toContain(
            'Included by GROUP. Member.',
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
        container.querySelector<HTMLElement>('.ez-status-mark')!.click();
        return document.querySelector<HTMLElement>('.ez-tooltip')!;
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
