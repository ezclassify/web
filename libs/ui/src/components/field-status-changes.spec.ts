/**
 * What a field's status mark explains: changes to what its marking writes, in
 * the scopes it writes, or what it changed. A fact a rule filled in that the
 * marking does not write (a group's member, collapsed into the group's written
 * name) is not on the list, and neither is a change the engine names for a fact
 * the marking leaves out, nor a change to a scope the field does not write.
 *
 * The engine here is a stand-in: the cases are about what a field does with an
 * answer, so each answer is written out.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Assertion, Change, ScanResult } from '@ezclassify/types';
import { schemeOnlyContext } from '../../test-fixtures/context-doubles';
import { mockRenderFormats } from '../render-format-layout-mock';
import { mockScanOutcome } from '../engine-result-mock';
import { MarkedInput } from './marked-input';
import { MarkedTextArea } from './marked-text-area';
import { MarkingField } from './marking-field';
import { TagInput } from './tag-input';
import type { ComponentInstance } from './component-base';
import { cleanupTooltipForRoot } from './tooltip-manager';

const NO_LOSS = {
    emitted: [],
    omitted: [],
    collapsed: [],
    conflicts: [],
    unrepresentable: [],
};

/** A fact the marking holds: read from the text, or added by `rule`. */
function fact(conceptId: string, categoryId: string, rule?: string): Assertion {
    return rule
        ? {
              conceptId,
              categoryId,
              confidence: 'inferred',
              source: 'infer',
              sourceRule: rule,
          }
        : { conceptId, categoryId, confidence: 'certain', source: 'parse' };
}

/** A change a rule made, adding one concept. */
function added(rule: string, conceptId: string, categoryId: string): Change {
    return {
        ruleId: rule,
        action: 'add',
        add: [{ conceptId, categoryId }],
        message: `Rule "${rule}": added "${conceptId}"`,
    };
}

/**
 * Reading `LOW` leaves the marking holding: LOW, as written; STD, which a rule
 * added and the text writes; MEMBER, which a rule filled in under the written
 * group and the text writes as the group's name; SHARED, which a rule added and
 * the text leaves out; and SIGNED, which a rule added in the record scope, a
 * scope the fields here do not write.
 */
const HOLDS = [
    fact('LOW', 'level'),
    fact('GROUP', 'group'),
    fact('STD', 'handling', 'adds-std'),
    fact('MEMBER', 'group', 'expands-group'),
    fact('SHARED', 'share', 'shares'),
    fact('SIGNED', 'signer', 'signs'),
];
const APPLIED = [
    added('adds-std', 'STD', 'handling'),
    added('shares', 'SHARED', 'share'),
    added('signs', 'SIGNED', 'signer'),
];
const ref = (conceptId: string, categoryId: string) => ({
    conceptId,
    categoryId,
});
/** What writing `LOW//GROUP//STD` did with the facts it holds. */
const WRITTEN = {
    ...NO_LOSS,
    emitted: [
        ref('LOW', 'level'),
        ref('GROUP', 'group'),
        ref('STD', 'handling'),
    ],
    omitted: [ref('SHARED', 'share'), ref('SIGNED', 'signer')],
    collapsed: [[ref('MEMBER', 'group'), ref('GROUP', 'group')]],
};

function engine() {
    const ids: Array<[string, string]> = [
        ['LOW', 'level'],
        ['GROUP', 'group'],
        ['MEMBER', 'group'],
        ['STD', 'handling'],
        ['SHARED', 'share'],
        ['SIGNED', 'signer'],
    ];
    const concepts = ids.map(([id, category], index) => ({
        id,
        name: id,
        views: { default: id },
        categories: [category],
        parents: [],
        aliases: [],
        position: index,
    }));
    const categories = [
        { id: 'level', single: true },
        { id: 'group', single: false },
        { id: 'handling', single: false },
        { id: 'share', single: false },
        { id: 'signer', single: true, scopes: ['record'] },
    ].map((category, index) => ({
        label: category.id,
        required: false,
        rollup: 'union',
        position: index,
        ...category,
    }));
    const formats = [
        {
            id: 'default',
            categoryOrder: ['level', 'group', 'handling'],
            separator: '/',
            categorySeparator: '//',
            view: 'default',
        },
    ];
    const scheme = {
        id: 'field-changes',
        version: '1.0.0',
        name: 'Field changes',
        concepts,
        categories,
        formats,
        defaultRenderFormat: 'default',
        embeddedMarking: [
            { pattern: '\\(([^)]+)\\)', template: '({marking}) ' },
        ],
        contextFormats: { part: ['default'] },
    };
    const result = {
        assertions: HOLDS,
        rendered: 'LOW//GROUP//STD',
        valid: true,
        inputWasValid: false,
        errors: [],
        warnings: [],
        appliedFixes: APPLIED,
        proposedFixes: [],
        notices: [],
        assessment: WRITTEN,
    };
    return {
        getScheme: () => scheme,
        getSchemeMeta: () => ({
            id: scheme.id,
            version: scheme.version,
            name: scheme.name,
            defaultRenderFormat: scheme.defaultRenderFormat,
            formats: mockRenderFormats(formats),
            scopes: [
                { id: 'marking', label: 'Marking' },
                { id: 'record', label: 'Record' },
            ],
            defaultScope: 'marking',
        }),
        listCategories: () => categories,
        getConceptsInCategory: (categoryId: string) =>
            concepts.filter((c) => c.categories.includes(categoryId)),
        process: () => result,
        validate: () => result,
        render: () => ({ ...result }),
        scan: (text: string) => {
            const results: object[] = [];
            const re = /\(([^)]+)\)/g;
            let m;
            while ((m = re.exec(text)) !== null)
                results.push({
                    start: m.index,
                    end: m.index + m[0].length,
                    marking: m[0],
                    wrapped: true,
                    inner: m[1],
                    result,
                });
            return mockScanOutcome(results as ScanResult[]);
        },
        suggest: () => ({ suggestions: [] }),
        aggregate: () => ({ rendered: '', assertions: [] }),
        describeConcept: (conceptId: string) => ({ lines: [conceptId] }),
    };
}

const wait = (ms = 400) => new Promise((r) => setTimeout(r, ms));

/** Read the field's Corrections tab through its branding button. */
async function markLines(root: Element): Promise<string[]> {
    const mark = root.querySelector<HTMLElement>('.ez-status-mark')!;
    mark.click();
    await wait();
    const tipId = mark.getAttribute('aria-describedby');
    const tip = tipId ? document.getElementById(tipId) : null;
    const lines =
        tip && !tip.hidden
            ? [
                  ...tip.querySelectorAll(
                      '.ez-tooltip__header, .ez-status-list__text',
                  ),
              ].map((row) => row.textContent ?? '')
            : [];
    tip?.querySelector<HTMLButtonElement>('.ez-marking-tools__close')?.click();
    return lines;
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
    // The marks mount with no tooltip root, so the shared tooltip is keyed to
    // the body: drop it before the DOM goes, or the next case reuses a
    // detached one.
    cleanupTooltipForRoot(document.body);
    document.body.innerHTML = '';
});

const context = () => schemeOnlyContext(engine() as never);

describe('a field explains only what its scopes write or it changed', () => {
    it('MarkedTextArea lists the change its text writes, not a filled-in fact, an unwritten one or another scope', async () => {
        const textarea = document.createElement('textarea');
        textarea.value = '(LOW) Paragraph.';
        container.appendChild(textarea);
        const field = new MarkedTextArea();
        mounted = field;
        await field.init(container, context());
        await wait();
        // A loaded marking's fixes are flagged, not made; editing the marking
        // makes them.
        textarea.value = '(LOW/) Paragraph.';
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
        await wait(800);

        expect(await markLines(container)).toEqual([
            '1 change made by a marking rule',
            'Added STD to handling.',
        ]);
    });

    it('MarkedInput lists the same for its leading mark', async () => {
        container.innerHTML = '<input type="text" value="(LOW) A note.">';
        const field = new MarkedInput();
        mounted = field;
        await field.init(container, context());
        await wait();

        expect(await markLines(container)).toEqual([
            '1 change made by a marking rule',
            'Added STD to handling.',
        ]);
    });

    it('MarkingField writes its marking as text and lists the same', async () => {
        container.innerHTML = '<input value="LOW">';
        const field = new MarkingField();
        mounted = field;
        await field.init(container, context(), { initialValue: 'LOW' });
        await wait();

        expect(await markLines(container)).toEqual([
            '1 change made by a marking rule',
            'Added STD to handling.',
        ]);
    });

    it('TagInput draws each fact as a chip and lists the same', async () => {
        container.innerHTML = '<input value="LOW">';
        const field = new TagInput();
        mounted = field;
        await field.init(container, context(), { initialValue: 'LOW' });
        await wait();

        expect(await markLines(container)).toEqual([
            '1 change made by a marking rule',
            'Added STD to handling.',
        ]);
    });
});
