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
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

/** Read the field's Corrections tab through its branding button. */
async function markList(root: Element): Promise<string[]> {
    const mark = root.querySelector<HTMLElement>('.ez-status-mark')!;
    mark.click();
    await wait();
    const tipId = mark.getAttribute('aria-describedby');
    const tip = tipId ? document.getElementById(tipId) : null;
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
    tip?.querySelector<HTMLButtonElement>('.ez-marking-tools__close')?.click();
    return lines;
}

let container: HTMLDivElement;
let field: MarkedTextArea | undefined;
let textarea: HTMLTextAreaElement;
let runtime: ReturnType<typeof engine>;

beforeEach(async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    textarea = document.createElement('textarea');
    container.appendChild(textarea);
    field = new MarkedTextArea();
    runtime = engine();
    await field.init(container, schemeOnlyContext(runtime as never));
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

    it('keeps independent corrections for identical markings', async () => {
        await write('(LOW) First paragraph.\n(LOW) Second paragraph.');
        expect(
            container.querySelector('.ez-status-mark__count')?.textContent,
        ).toBe('2');
        const marking = textarea.value.match(/\([^)]+\)/)?.[0];
        expect(await markList(container)).toEqual([
            '2 changes made by marking rules',
            `# ${marking}`,
            'Added STD to handling.',
            `# ${marking}`,
            'Added STD to handling.',
        ]);
    });

    it('keeps a surviving paragraph’s corrections when a peer is removed', async () => {
        await write('(LOW) First paragraph.\n(HIGH) Second paragraph.');
        await write(textarea.value.split('\n')[1]);
        expect(await markList(container)).toEqual([
            '2 changes made by marking rules',
            'Added STD to handling.',
            'Added ANCHOR to handling.',
        ]);
    });

    it('keeps both surviving histories when a middle paragraph has the same marking', async () => {
        await write(
            '(LOW) First paragraph.\n(LOW) Middle paragraph.\n(LOW) Last paragraph.',
        );
        const [first, , last] = textarea.value.split('\n');
        const [firstEntry, , lastEntry] = field!
            .getSegments()
            .map((mark) => mark.entryId);
        await write(`${first}\n${last}`);
        expect(field!.getSegments().map((mark) => mark.entryId)).toEqual([
            firstEntry,
            lastEntry,
        ]);
        const marking = textarea.value.match(/\([^)]+\)/)?.[0];
        expect(await markList(container)).toEqual([
            '2 changes made by marking rules',
            `# ${marking}`,
            'Added STD to handling.',
            `# ${marking}`,
            'Added STD to handling.',
        ]);
    });

    async function draftAtEnd(value: string): Promise<HTMLInputElement> {
        textarea.focus();
        const end = textarea.value.length;
        textarea.setSelectionRange(end, end);
        textarea.dispatchEvent(
            new KeyboardEvent('keydown', {
                key: 'Enter',
                ctrlKey: true,
                bubbles: true,
            }),
        );
        const input = await vi.waitFor(() => {
            const editor = container.querySelector<HTMLInputElement>(
                '.inline-editor-input',
            );
            expect(editor).not.toBeNull();
            return editor!;
        });
        input.value = value;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        return input;
    }

    function submit(input: HTMLInputElement): void {
        input.dispatchEvent(
            new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
        );
    }

    function deferScan(truncated = false) {
        const scan = runtime.scan.bind(runtime);
        let finish!: () => void;
        let didScan!: () => void;
        const began = new Promise<void>((resolve) => {
            didScan = resolve;
        });
        vi.spyOn(runtime, 'scan').mockImplementationOnce((text) => {
            const full = scan(text);
            const outcome = truncated
                ? {
                      results: [],
                      unread: [],
                      limits: {
                          status: 'truncated' as const,
                          regionsFound: full.results.length,
                          regionsCapped: true,
                      },
                  }
                : full;
            return new Promise<typeof outcome>((resolve) => {
                finish = () => resolve(outcome);
                didScan();
            }) as unknown as typeof outcome;
        });
        return { began, release: () => finish() };
    }

    it.each(['superseded', 'truncated'] as const)(
        'keeps a committed mark through prose changes after its scan is %s',
        async (scanState) => {
            const editor = await draftAtEnd('LOW');
            const deferred = deferScan(scanState === 'truncated');
            submit(editor);
            await deferred.began;
            const process = vi.spyOn(runtime, 'process');

            if (scanState === 'truncated') {
                deferred.release();
                await vi.waitFor(() =>
                    expect(textarea.getAttribute('aria-invalid')).toBe('true'),
                );
            }
            textarea.value = `New preface.\n${textarea.value}`;
            textarea.dispatchEvent(new Event('input', { bubbles: true }));
            textarea.value = `${textarea.value.trimEnd()} Updated prose.`;
            textarea.dispatchEvent(new Event('input', { bubbles: true }));

            await vi.waitFor(() =>
                expect(process).toHaveBeenCalledWith(
                    '',
                    expect.objectContaining({
                        assertions: expect.arrayContaining([
                            expect.objectContaining({ conceptId: 'LOW' }),
                        ]),
                    }),
                ),
            );
            if (scanState === 'superseded') deferred.release();
            expect(await markList(container)).toEqual([
                '1 change made by a marking rule',
                'Added STD to handling.',
            ]);
        },
    );

    it('keeps two committed mark readings while the first scan is still pending', async () => {
        const first = await draftAtEnd('LOW');
        const deferred = deferScan();
        submit(first);
        await deferred.began;

        textarea.value += 'First body.\n';
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
        const second = await draftAtEnd('HIGH');
        const process = vi.spyOn(runtime, 'process');
        submit(second);

        await vi.waitFor(() => {
            for (const conceptId of ['LOW', 'HIGH']) {
                expect(process).toHaveBeenCalledWith(
                    '',
                    expect.objectContaining({
                        assertions: expect.arrayContaining([
                            expect.objectContaining({ conceptId }),
                        ]),
                    }),
                );
            }
            expect(
                container.querySelector('.ez-status-mark__count')?.textContent,
            ).toBe('3');
        });
        deferred.release();
    });

    it('names no marking when only one has changes', async () => {
        await write('(LOW) Only paragraph.');

        expect(await markList(container)).toEqual([
            '1 change made by a marking rule',
            'Added STD to handling.',
        ]);
    });
});
