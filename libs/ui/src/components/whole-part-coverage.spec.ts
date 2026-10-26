/**
 * A field bound to a whole judges it against the parts that name it.
 *
 * The runtime hands a whole field its parts' current markings, and the field
 * sends them as `parts` on every engine process call, so the errors and fix
 * paths shown under it already account for the parts. A part changing makes the
 * field read its value again. A whole with no marked parts sends no `parts` key
 * at all.
 */
import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi,
    type Mock,
} from 'vitest';
import { Context } from '@ezclassify/engine';
import {
    cedarValleyAccessYaml,
    cedarValleyGuideYaml,
    cedarValleySchemeYaml,
} from '@ezclassify/example-schemes/cedar-valley';
import * as jsYaml from 'js-yaml';
import { EzClassifyUI } from '../ezclassify-ui';

const wait = (ms = 80) => new Promise((r) => setTimeout(r, ms));

let root: HTMLDivElement;
let forms: EzClassifyUI | null = null;
let process: Mock<(...args: unknown[]) => unknown>;

beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn();
    root = document.createElement('div');
    document.body.appendChild(root);
});

afterEach(() => {
    forms?.destroy();
    forms = null;
    root.remove();
});

/**
 * Mount `field` bound to the whole `doc`, beside the given part hosts, with
 * every engine process call recorded.
 */
async function mount(field: string, partIds: string[]): Promise<HTMLElement> {
    const ctx = Context.fromComponents({
        scheme: jsYaml.load(cedarValleySchemeYaml),
        guides: [jsYaml.load(cedarValleyGuideYaml)],
        access: jsYaml.load(cedarValleyAccessYaml),
    });
    const scheme = ctx.scheme as unknown as {
        process: (...args: unknown[]) => unknown;
    };
    const real = scheme.process.bind(scheme);
    process = vi.fn<(...args: unknown[]) => unknown>((...args) =>
        real(...args),
    );
    scheme.process = process;
    root.innerHTML = [
        '<input type="hidden" id="doc" data-ezclassify-rendered />',
        ...partIds.map(
            (id) =>
                `<input type="hidden" id="${id}" data-ezclassify-rendered data-ezclassify-part-of="doc" />`,
        ),
        field,
    ].join('');
    forms = new EzClassifyUI(ctx, { root });
    await wait();
    return root.querySelector<HTMLElement>('#host')!;
}

/** The `parts` each recorded process call sent (undefined when it sent none). */
function partsSent(): Array<string[] | undefined> {
    return process.mock.calls.map((args) => {
        const options = args.find(
            (a) => typeof a === 'object' && a !== null && !Array.isArray(a),
        ) as { parts?: string[] } | undefined;
        return options && 'parts' in options ? options.parts : undefined;
    });
}

/** The runtime's component for `host` (TagInput is kept with the inputs). */
function component(host: HTMLElement) {
    const runtime = forms as unknown as {
        components: Map<HTMLElement, Field>;
        autocompleters: Map<HTMLElement, Field>;
    };
    return runtime.components.get(host) ?? runtime.autocompleters.get(host)!;
}

interface Field {
    setValue(value: string): void | Promise<void>;
}

async function publishParts(values: Record<string, string>): Promise<void> {
    for (const [id, value] of Object.entries(values)) {
        await forms!.store.publishRendered(id, value);
    }
    await wait(40);
}

const WHOLE_FIELDS: Array<[string, string, string]> = [
    [
        'MarkingField',
        '<textarea id="host" data-ezclassify-controller="marking" data-ezclassify-bound-to="doc"></textarea>',
        'INTERNAL',
    ],
    [
        'TagInput',
        '<input id="host" data-ezclassify-controller="tags" data-ezclassify-bound-to="doc" />',
        'INTERNAL',
    ],
    [
        'MarkedInput',
        '<input type="text" id="host" data-ezclassify-controller="marked-input" data-ezclassify-bound-to="doc">',
        '(INTERNAL) Quarterly report',
    ],
];

describe.each(WHOLE_FIELDS)('%s bound to a whole', (_name, field, value) => {
    it('sends the parts it covers on its process calls, and reads again when a part changes', async () => {
        const host = await mount(field, ['p1', 'p2']);
        await publishParts({
            p1: 'CONFIDENTIAL//FINANCIAL INFORMATION',
            p2: 'INTERNAL//OAKWOOD',
        });
        const expected = [
            forms!.store.get('p1').rendered,
            forms!.store.get('p2').rendered,
        ];
        expect(expected.every(Boolean)).toBe(true);

        process.mockClear();
        await component(host).setValue(value);
        await wait();
        expect(partsSent()).toContainEqual(expected);

        process.mockClear();
        await publishParts({ p2: 'RESTRICTED//SECURE ASSESSMENTS' });
        const changed = [
            forms!.store.get('p1').rendered,
            forms!.store.get('p2').rendered,
        ];
        expect(partsSent()).toContainEqual(changed);
    });

    it('sends no parts key when no part is marked yet', async () => {
        const host = await mount(field, ['p1', 'p2']);
        process.mockClear();
        await component(host).setValue(value);
        await wait();
        expect(process).toHaveBeenCalled();
        expect(partsSent().every((p) => p === undefined)).toBe(true);
    });

    it('sends no parts key when nothing names it as a whole', async () => {
        const host = await mount(field, []);
        process.mockClear();
        await component(host).setValue(value);
        await wait();
        expect(process).toHaveBeenCalled();
        expect(partsSent().every((p) => p === undefined)).toBe(true);
    });
});

describe('MarkedTextArea bound to a whole', () => {
    it('never sends the whole’s parts: its marks are portions, not the whole', async () => {
        const host = await mount(
            '<textarea id="host" data-ezclassify-controller="marked-textarea" data-ezclassify-bound-to="doc"></textarea>',
            ['p1', 'p2'],
        );
        await publishParts({
            p1: 'CONFIDENTIAL//FINANCIAL INFORMATION',
            p2: 'INTERNAL//OAKWOOD',
        });
        process.mockClear();
        await component(host).setValue('(INTERNAL) A paragraph.');
        await wait(400);
        expect(partsSent().every((p) => p === undefined)).toBe(true);
    });
});

describe('a whole field owns its coverage finding', () => {
    const FIELD =
        '<div id="whole-wrap"><textarea id="host" data-ezclassify-controller="marking" data-ezclassify-bound-to="doc"></textarea></div>';

    const wholeWrap = () => document.getElementById('whole-wrap')!;
    const fixButton = (name: string) =>
        [
            ...wholeWrap().parentElement!.querySelectorAll<HTMLButtonElement>(
                '.ez-validation-errors:not([hidden]) button',
            ),
        ].find((b) => b.textContent === name);

    it('offers the level the parts need, with no rollup notice or action beside it, and the fix applies', async () => {
        const host = await mount(FIELD, ['p1', 'p2']);
        await publishParts({ p1: 'PUBLIC', p2: 'RESTRICTED' });
        await component(host).setValue('INTERNAL//FINANCIAL INFORMATION');
        await wait(150);

        expect(fixButton('Replace INTERNAL with RESTRICTED')).toBeDefined();
        expect(fixButton('Replace INTERNAL with CONFIDENTIAL')).toBeUndefined();
        expect(document.querySelector('.ez-coverage-action')).toBeNull();
        const notice = wholeWrap().parentElement!.querySelector<HTMLElement>(
            ':scope > .ez-parent-validation-notice',
        );
        expect(notice === null || notice.style.display === 'none').toBe(true);

        fixButton('Replace INTERNAL with RESTRICTED')!.click();
        await wait(150);
        expect(forms!.store.get('doc').rendered).toBe(
            'RESTRICTED//FINANCIAL INFORMATION',
        );
        expect(forms!.store.get('doc').valid).toBe(true);
    });

    it('judges the parts the rollup compares, a plain field with no marking id included', async () => {
        // A plain input that names the whole is a part the rollup compares
        // with it, though it holds no marking of its own in the store.
        const host = await mount(
            FIELD +
                '<input type="text" data-ezclassify-part-of="doc" value="RESTRICTED" />',
            [],
        );
        await component(host).setValue('INTERNAL//FINANCIAL INFORMATION');
        await wait(150);
        expect(partsSent()).toContainEqual(['RESTRICTED']);
        expect(fixButton('Replace INTERNAL with RESTRICTED')).toBeDefined();
    });

    it('an empty whole is judged once its parts are marked', async () => {
        await mount(FIELD, ['p1', 'p2']);
        await publishParts({ p1: 'CONFIDENTIAL', p2: 'RESTRICTED' });
        await wait(150);
        expect(fixButton('Add RESTRICTED')).toBeDefined();
        expect(document.querySelector('.ez-coverage-action')).toBeNull();
    });
});

describe('an open composer on a whole field', () => {
    it('reads the draft with the parts, and again when a part changes', async () => {
        const host = await mount(
            '<textarea id="host" data-ezclassify-controller="marking" data-ezclassify-bound-to="doc"></textarea>',
            ['p1', 'p2'],
        );
        await publishParts({
            p1: 'CONFIDENTIAL//FINANCIAL INFORMATION',
            p2: 'INTERNAL//OAKWOOD',
        });
        const input = host as HTMLTextAreaElement;
        input.focus();
        process.mockClear();
        input.value = 'internal';
        input.setSelectionRange(8, 8);
        input.dispatchEvent(new Event('input', { bubbles: true }));
        await wait();
        const parts = [
            forms!.store.get('p1').rendered,
            forms!.store.get('p2').rendered,
        ];
        expect(partsSent()).toContainEqual(parts);
        expect(
            document.querySelector('.ez-composer:not([hidden])'),
        ).not.toBeNull();

        process.mockClear();
        await publishParts({ p2: 'RESTRICTED//SECURE ASSESSMENTS' });
        const changed = [
            forms!.store.get('p1').rendered,
            forms!.store.get('p2').rendered,
        ];
        // The draft itself is read again (text "internal"), not only the
        // committed value.
        const draftCalls = process.mock.calls.filter(
            (args) => args[0] === 'internal',
        );
        expect(draftCalls.length).toBeGreaterThan(0);
        expect(partsSent()).toContainEqual(changed);
    });
});

describe('a MarkedInput part of a whole field', () => {
    it('makes the whole read again when the mark changes', async () => {
        await mount(
            [
                '<textarea id="host" data-ezclassify-controller="marking" data-ezclassify-bound-to="doc"></textarea>',
                '<input type="text" id="title" data-ezclassify-controller="marked-input" data-ezclassify-part-of="doc" value="(C) Title">',
            ].join(''),
            [],
        );
        const title = document.getElementById('title') as HTMLTextAreaElement;
        const edit = async (value: string) => {
            title.value = value;
            title.dispatchEvent(new Event('input', { bubbles: true }));
            await wait(300);
        };
        await edit('(R) Title');
        process.mockClear();
        await edit('(I) Title');
        expect(forms!.store.get('title').rendered).toMatch(/^I/);
        // The whole's own read, with the title's new mark as its part.
        expect(partsSent()).toContainEqual([
            forms!.store.get('title').rendered,
        ]);
    });
});

describe('a whole that carries more than its parts allow', () => {
    // Cedar Valley's permitted schools narrow as parts combine, the way a
    // release list does, so a whole naming a school a part does not permit is
    // wrong. The rollup says so about the whole, and the engine says so about
    // the part that does not permit it.
    const docNotice = () => {
        const next = document.getElementById('doc')!.nextElementSibling;
        return next?.classList.contains('ez-parent-validation-notice')
            ? (next as HTMLElement)
            : null;
    };

    async function judge(whole: string, part: string) {
        await mount('', ['p1']);
        const p1 = document.getElementById('p1')!;
        const coverageErrors: Event[] = [];
        p1.addEventListener('ezclassify:coverage-error', (e) =>
            coverageErrors.push(e),
        );
        await publishParts({ p1: part, doc: whole });
        await wait(150);
        return { p1, coverageErrors };
    }

    it('reports the school the whole adds on the whole, and on the part that does not permit it', async () => {
        const { p1, coverageErrors } = await judge(
            'INTERNAL//OAKWOOD, PINECREST, RIVERSIDE',
            'INTERNAL//OAKWOOD, PINECREST',
        );
        expect(docNotice()?.textContent).toBe(
            'Whole marking carries RIVERSIDE beyond what the parts allow',
        );
        expect(coverageErrors).toHaveLength(1);
        expect(p1.hasAttribute('data-ezclassify-error')).toBe(true);
        expect(p1.nextElementSibling?.textContent).toBe(
            'This part exceeds its whole: rolled up with this part, the whole would drop RIVERSIDE.',
        );
    });

    it('still reports a part that needs more than the whole carries against that part', async () => {
        const { p1, coverageErrors } = await judge(
            'INTERNAL//OAKWOOD, PINECREST',
            'RESTRICTED//OAKWOOD, PINECREST',
        );
        expect(docNotice()?.textContent).toBe(
            'Whole marking does not cover part content: missing RESTRICTED',
        );
        expect(coverageErrors).toHaveLength(1);
        expect(p1.hasAttribute('data-ezclassify-error')).toBe(true);
    });

    it('says nothing when the whole names exactly the schools its parts permit', async () => {
        const { p1, coverageErrors } = await judge(
            'INTERNAL//OAKWOOD, PINECREST',
            'INTERNAL//OAKWOOD, PINECREST',
        );
        const notice = docNotice();
        expect(notice === null || notice.style.display === 'none').toBe(true);
        expect(coverageErrors).toHaveLength(0);
        expect(p1.hasAttribute('data-ezclassify-error')).toBe(false);
    });
});

describe('a TagInput part that exceeds its whole', () => {
    // The README form: the whole stays INTERNAL while a TagInput part holds
    // CONFIDENTIAL. The part reads completely, so its chips stand for it. The
    // finding is about its relation to the whole, which settles on its own
    // schedule, so it must not change what focusing or browsing the part does.
    it('focuses and browses with an empty filter, keeping its chips', async () => {
        await mount(
            [
                '<input id="whole" data-ezclassify-controller="marking" value="INTERNAL" />',
                '<input id="summary" data-ezclassify-controller="tags" data-ezclassify-part-of="whole" value="CONFIDENTIAL" />',
            ].join(''),
            [],
        );
        await wait(200);
        const host = document.getElementById('summary') as HTMLInputElement;
        const filter =
            root.querySelector<HTMLInputElement>('.tag-input-filter')!;
        const chips = () =>
            [...root.querySelectorAll('.tag-input-wrap .proto-tag')].map(
                (chip) => (chip as HTMLElement).dataset.conceptId,
            );
        expect(filter.closest('[data-ezclassify-invalid]')).not.toBeNull();
        const before = chips();
        expect(before).toContain('CONFIDENTIAL');

        filter.focus();
        await wait(150);
        expect(filter.value).toBe('');
        expect(chips()).toEqual(before);
        expect(host.value).toBe(forms!.store.get('summary').rendered);

        filter.dispatchEvent(
            new KeyboardEvent('keydown', {
                key: 'ArrowDown',
                altKey: true,
                bubbles: true,
            }),
        );
        await wait(150);
        expect(
            document.querySelector('.ez-composer:not([hidden])'),
        ).not.toBeNull();
        expect(filter.value).toBe('');
        expect(chips()).toEqual(before);
    });
});
