/**
 * A MarkedTextArea has one status mark for the whole field, but its list says
 * which marking each change was made to: the changes of each marking sit under
 * a small heading naming that marking as the text now writes it, in the order
 * of the text. The count is the field's total. A field with changes to one
 * marking only lists them with no heading.
 *
 * The engine is a stand-in: a marking that names LOW gains STD, and one that
 * names HIGH gains STD and ANCHOR, each by a rule the text then writes.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Assertion, Change, ScanResult } from '@ezclassify/types';
import { schemeOnlyContext } from '../../test-fixtures/context-doubles';
import { mockRenderFormats } from '../render-format-layout-mock';
import { mockScanOutcome } from '../engine-result-mock';
import { MarkedTextArea } from './marked-text-area';
import { cleanupTooltipForRoot } from './tooltip-manager';

const CATEGORY = {
    LOW: 'level',
    HIGH: 'level',
    STD: 'handling',
    ANCHOR: 'handling',
};
type Id = keyof typeof CATEGORY;

const stated = (id: Id): Assertion => ({
    conceptId: id,
    categoryId: CATEGORY[id],
    confidence: 'certain',
    source: 'parse',
});
const ruled = (id: Id, rule: string): Assertion => ({
    conceptId: id,
    categoryId: CATEGORY[id],
    confidence: 'inferred',
    source: 'infer',
    sourceRule: rule,
});
const added = (id: Id, rule: string): Change => ({
    ruleId: rule,
    action: 'add',
    add: [{ conceptId: id, categoryId: CATEGORY[id] }],
    message: `Rule "${rule}": added "${id}"`,
});

/** What reading a marking's text settles on, with what its rules added. */
function read(text: string) {
    const high = /HIGH/.test(text);
    const level: Id = high ? 'HIGH' : 'LOW';
    const assertions = [
        stated(level),
        ruled('STD', 'adds-std'),
        ...(high ? [ruled('ANCHOR', 'high-adds-anchor')] : []),
    ];
    const rendered = high ? 'HIGH//STD/ANCHOR' : 'LOW//STD';
    return {
        assertions,
        rendered,
        valid: true,
        inputWasValid: false,
        errors: [],
        warnings: [],
        appliedFixes: [
            added('STD', 'adds-std'),
            ...(high ? [added('ANCHOR', 'high-adds-anchor')] : []),
        ],
        proposedFixes: [],
        notices: [],
        recognition: { status: 'complete' as const, unmatched: [] },
        assessment: {
            emitted: assertions.map(({ conceptId, categoryId }) => ({
                conceptId,
                categoryId,
            })),
            omitted: [],
            collapsed: [],
            conflicts: [],
            unrepresentable: [],
        },
    };
}

function engine() {
    const concepts = (Object.keys(CATEGORY) as Id[]).map((id, position) => ({
        id,
        name: id,
        views: { default: id },
        categories: [CATEGORY[id]],
        parents: [],
        aliases: [],
        position,
    }));
    const categories = [
        { id: 'level', label: 'level', single: true },
        { id: 'handling', label: 'handling', single: false },
    ].map((category, position) => ({
        required: false,
        rollup: 'union',
        position,
        ...category,
    }));
    const formats = [
        {
            id: 'default',
            categoryOrder: ['level', 'handling'],
            separator: '/',
            categorySeparator: '//',
            view: 'default',
        },
    ];
    const scheme = {
        id: 'mark-groups',
        version: '1.0.0',
        name: 'Mark groups',
        concepts,
        categories,
        formats,
        defaultRenderFormat: 'default',
        embeddedMarking: [
            { pattern: '\\(([^)]+)\\)', template: '({marking}) ' },
        ],
        contextFormats: { part: ['default'] },
    };
    const answer = (input: string | Assertion[]) =>
        read(
            typeof input === 'string'
                ? input
                : input.map((a) => a.conceptId).join(' '),
        );
    return {
        getScheme: () => scheme,
        getSchemeMeta: () => ({
            id: scheme.id,
            version: scheme.version,
            name: scheme.name,
            defaultRenderFormat: scheme.defaultRenderFormat,
            formats: mockRenderFormats(formats),
        }),
        listCategories: () => categories,
        getConceptsInCategory: (categoryId: string) =>
            concepts.filter((c) => c.categories.includes(categoryId)),
        process: (input: string, opts?: { assertions?: Assertion[] }) =>
            answer(opts?.assertions?.length ? opts.assertions : input),
        validate: (input: string) => answer(input),
        render: (assertions: Assertion[]) => answer(assertions),
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
                    result: read(m[1]),
                });
            return mockScanOutcome(results as ScanResult[]);
        },
        suggest: () => ({ suggestions: [] }),
        aggregate: () => ({ rendered: '', assertions: [] }),
        describeConcept: (conceptId: string) => ({ lines: [conceptId] }),
    };
}

const wait = (ms = 400) => new Promise((r) => setTimeout(r, ms));

/** Hover the field's status mark past its delay and read its list. */
async function markList(root: Element): Promise<string[]> {
    const mark = root.querySelector<HTMLElement>('.ez-status-mark')!;
    mark.dispatchEvent(new Event('mouseenter'));
    await wait();
    const tip = document.querySelector<HTMLElement>('.ez-tooltip');
    const lines =
        tip && !tip.hidden
            ? [
                  ...tip.querySelectorAll(
                      '.ez-tooltip__header, .ez-status-list__marking, .ez-status-list__text',
                  ),
              ].map(
                  (row) =>
                      (row.classList.contains('ez-status-list__marking')
                          ? '# '
                          : '') + (row.textContent ?? ''),
              )
            : [];
    mark.dispatchEvent(new Event('mouseleave'));
    return lines;
}

let container: HTMLDivElement;
let field: MarkedTextArea | undefined;
let textarea: HTMLTextAreaElement;

beforeEach(async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    textarea = document.createElement('textarea');
    container.appendChild(textarea);
    field = new MarkedTextArea();
    await field.init(container, schemeOnlyContext(engine() as never));
    await wait();
});

afterEach(() => {
    field?.destroy();
    field = undefined;
    cleanupTooltipForRoot(document.body);
    document.body.innerHTML = '';
});

/** Write the field's text the way typing does, and let it scan. */
async function write(text: string): Promise<void> {
    textarea.value = text;
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    await wait(800);
}

describe("a MarkedTextArea's status mark", () => {
    it('lists the changes of each marking under that marking, in the order of the text', async () => {
        await write('(HIGH) First paragraph.\n(LOW) Second paragraph.');

        const marks = [...textarea.value.matchAll(/\([^)]+\)/g)].map(
            (m) => m[0],
        );
        expect(marks).toHaveLength(2);
        // Before the list is shown, the mark counts every change in the field.
        expect(
            container.querySelector('.ez-status-mark__count')?.textContent,
        ).toBe('3');
        // The same rule made the same change to both markings: two changes,
        // one under each. The count is the field's total.
        expect(await markList(container)).toEqual([
            '3 changes made by marking rules',
            `# ${marks[0]}`,
            'Added STD to handling.',
            'Added ANCHOR to handling.',
            `# ${marks[1]}`,
            'Added STD to handling.',
        ]);
    });

    it('names no marking when only one has changes', async () => {
        await write('(LOW) Only paragraph.');

        expect(await markList(container)).toEqual([
            '1 change made by a marking rule',
            'Added STD to handling.',
        ]);
    });
});
