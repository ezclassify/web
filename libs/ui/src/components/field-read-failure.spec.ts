/**
 * A part field reads on its own whatever state its whole is in.
 *
 * A read that raises (a part whose whole could not be resolved, a dropped
 * connection) never leaves a field unenhanced: the field mounts, shows the
 * thrown message where its errors go, and reads again when its whole changes.
 * While the whole is not a valid marking the engine reports each part as not
 * compared with it; the part shows that as a warning, never as an error, and it
 * clears once the whole is valid and the part reads again. No part is reported
 * as exceeding a whole that is not valid, and the report returns once the whole
 * is fixed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Context } from '@ezclassify/engine';
import {
    cedarValleyAccessYaml,
    cedarValleyGuideYaml,
    cedarValleySchemeYaml,
} from '@ezclassify/example-schemes/cedar-valley';
import * as jsYaml from 'js-yaml';
import { EzClassifyUI } from '../ezclassify-ui';

const wait = (ms = 80) => new Promise((r) => setTimeout(r, ms));

/** A whole that reads but breaks a rule. */
const INVALID_WHOLE = 'INTERNAL//FINANCIAL INFORMATION';
const VALID_WHOLE = 'RESTRICTED';
const THROWN = 'Cannot resolve processing context: the test says so.';
/** What the engine says of a part it could not compare with its whole. */
const UNVERIFIED = 'Unable to compare with invalid whole.';

let root: HTMLDivElement;
let forms: EzClassifyUI | null = null;
/** While set, every part read (a process call that names a whole) raises. */
let failing = false;
/** While set, every read of exactly this text raises, part or not. */
let failingText: string | null = null;
/**
 * Controlled partial source recognition, independent of contextual read
 * failures.
 */
let partialScan = false;

beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn();
    root = document.createElement('div');
    document.body.appendChild(root);
    failing = false;
    failingText = null;
    partialScan = false;
});

afterEach(() => {
    forms?.destroy();
    forms = null;
    root.remove();
});

function partOfSent(args: unknown[]): string | undefined {
    const options = args.find(
        (a) => typeof a === 'object' && a !== null && !Array.isArray(a),
    ) as { context?: { partOf?: { rendered?: string } } } | undefined;
    return options?.context?.partOf?.rendered;
}

/**
 * The cedar-valley engine, with part reads that raise while `failing` is set
 * and reads of `failingText` that raise.
 */
function engineContext() {
    const ctx = Context.fromComponents({
        scheme: jsYaml.load(cedarValleySchemeYaml),
        guides: [jsYaml.load(cedarValleyGuideYaml)],
        access: jsYaml.load(cedarValleyAccessYaml),
    });
    const scheme = ctx.scheme as unknown as {
        process: (...args: unknown[]) => unknown;
    };
    const real = scheme.process.bind(scheme);
    scheme.process = (...args: unknown[]) => {
        if (failing && partOfSent(args) !== undefined) throw new Error(THROWN);
        if (failingText !== null && args[0] === failingText)
            throw new Error(THROWN);
        return real(...args);
    };
    const scan = ctx.scheme.scan.bind(ctx.scheme);
    ctx.scheme.scan = ((...args: Parameters<typeof scan>) => {
        const decorate = (outcome: Awaited<ReturnType<typeof scan>>) => ({
            ...outcome,
            results: outcome.results.map((match) => ({
                ...match,
                result: partialScan
                    ? {
                          ...match.result,
                          recognition: {
                              ...match.result.recognition!,
                              status: 'partial' as const,
                          },
                      }
                    : match.result,
            })),
        });
        const result: ReturnType<typeof scan> = Reflect.apply(
            scan,
            ctx.scheme,
            args,
        );
        return result instanceof Promise
            ? result.then(decorate)
            : decorate(result);
    }) as typeof scan;
    return ctx;
}

/** Mount `markup` beside the whole `doc`, which holds `whole`. */
async function mount(markup: string, whole = ''): Promise<void> {
    root.innerHTML = [
        `<input type="hidden" id="doc" data-ezclassify-rendered value="${whole}" />`,
        markup,
    ].join('');
    forms = new EzClassifyUI(engineContext(), { root });
    await wait();
}

async function publishWhole(value: string): Promise<void> {
    await forms!.store.publishRendered('doc', value);
    await wait(150);
}

function runtime() {
    return forms as unknown as {
        components: Map<HTMLElement, unknown>;
        autocompleters: Map<HTMLElement, unknown>;
    };
}

function enhanced(host: HTMLElement): boolean {
    return runtime().components.has(host) || runtime().autocompleters.has(host);
}

/** The error list the field shows, as its rows' text and kinds. */
function report(host: HTMLElement) {
    const scope = host.closest('.ez-test-field')!;
    const list = scope.querySelector<HTMLElement>('.ez-validation-errors');
    if (!list || list.hidden) return { errors: [], warnings: [] };
    const rows = (selector: string) =>
        [...list.querySelectorAll(selector)].map((row) => row.textContent);
    return {
        errors: rows(
            '.ez-validation-errors__item:not(.ez-validation-errors__item--warning)',
        ),
        warnings: rows('.ez-validation-errors__item--warning'),
    };
}

function invalidMarked(host: HTMLElement): boolean {
    return !!host
        .closest('.ez-test-field')!
        .querySelector('[data-ezclassify-invalid]');
}

const PART_FIELDS: Array<[string, string]> = [
    [
        'MarkingField',
        '<div class="ez-test-field"><textarea id="host" data-ezclassify-controller="marking" data-ezclassify-part-of="doc">RESTRICTED</textarea></div>',
    ],
    [
        'TagInput',
        '<div class="ez-test-field"><input id="host" data-ezclassify-controller="tags" data-ezclassify-part-of="doc" value="RESTRICTED" /></div>',
    ],
];

describe.each(PART_FIELDS)('a %s part', (_name, markup) => {
    it('mounts when its first read throws, shows the message, and reads again when the whole changes', async () => {
        failing = true;
        await mount(markup, 'CONFIDENTIAL');
        const host = document.getElementById('host')!;
        const field =
            runtime().components.get(host) ??
            runtime().autocompleters.get(host);

        expect(enhanced(host)).toBe(true);
        expect(report(host)).toEqual({ errors: [THROWN], warnings: [] });
        expect(invalidMarked(host)).toBe(true);
        expect((field as { getRendered(): string }).getRendered()).toBe(
            'RESTRICTED',
        );
        // The drawer moves off the bottom edge the message now occupies.
        expect(
            host
                .closest('.ez-test-field')!
                .querySelector('.ez-field-drawer')!
                .classList.contains('ez-field-drawer--top'),
        ).toBe(true);

        failing = false;
        await publishWhole(VALID_WHOLE);
        expect(report(host)).toEqual({ errors: [], warnings: [] });
        expect(invalidMarked(host)).toBe(false);
        expect(
            (field as { getAssertions(): Array<{ conceptId: string }> })
                .getAssertions()
                .map((a) => a.conceptId),
        ).toContain('RESTRICTED');
    });

    it('shows the not-compared warning under an invalid whole, never as an error, and drops it once the whole is valid', async () => {
        await mount(markup, INVALID_WHOLE);
        const host = document.getElementById('host')!;

        expect(enhanced(host)).toBe(true);
        expect(report(host)).toEqual({
            errors: [],
            warnings: [UNVERIFIED],
        });
        expect(invalidMarked(host)).toBe(false);
        expect(
            host
                .closest('.ez-test-field')!
                .querySelector('[data-ezclassify-warning]'),
        ).not.toBeNull();

        await publishWhole(VALID_WHOLE);
        expect(report(host)).toEqual({ errors: [], warnings: [] });

        await publishWhole(INVALID_WHOLE);
        expect(report(host)).toEqual({
            errors: [],
            warnings: [UNVERIFIED],
        });
    });
});

describe('a MarkedInput part', () => {
    const MARKUP =
        '<div class="ez-test-field"><input type="text" id="host" data-ezclassify-controller="marked-input" data-ezclassify-part-of="doc" value="(R) Title"></div>';

    it('reads its mark against its whole, shows the not-compared warning under an invalid whole, and drops it once the whole is valid', async () => {
        await mount(MARKUP, INVALID_WHOLE);
        const host = document.getElementById('host')!;
        const chip = () =>
            host
                .closest('.ez-test-field')!
                .querySelector('.marked-input-chip')!;

        expect(enhanced(host)).toBe(true);
        expect(report(host)).toEqual({
            errors: [],
            warnings: [UNVERIFIED],
        });
        expect(chip().classList).toContain('marked-input-chip--warning');

        await publishWhole(VALID_WHOLE);
        expect(report(host)).toEqual({ errors: [], warnings: [] });
        expect(chip().classList).not.toContain('marked-input-chip--warning');
    });

    it('sends the whole it belongs to on its reads', async () => {
        await mount(MARKUP, VALID_WHOLE);
        failing = true;
        const field = runtime().components.get(
            document.getElementById('host')!,
        ) as { setValue(v: string): void };
        field.setValue('(C) Title');
        await wait(150);
        // Only a read that names a whole raises under `failing`.
        expect(report(document.getElementById('host')!).errors).toEqual([
            THROWN,
        ]);
    });
});

describe('a MarkedInput', () => {
    it('mounts when its first read throws, shows the message, and reads again on the next edit', async () => {
        failingText = 'R';
        await mount(
            '<div class="ez-test-field"><input type="text" id="host" data-ezclassify-controller="marked-input" value="(R) Title"></div>',
        );
        const host = document.getElementById('host') as HTMLTextAreaElement;

        expect(enhanced(host)).toBe(true);
        expect(report(host)).toEqual({ errors: [THROWN], warnings: [] });

        failingText = null;
        (
            runtime().components.get(host) as { setValue(v: string): void }
        ).setValue('(C) Title');
        await wait(150);
        expect(report(host)).toEqual({ errors: [], warnings: [] });
    });
});

describe('a MarkedTextArea part', () => {
    const MARKUP =
        '<div class="ez-test-field"><textarea id="host" data-ezclassify-controller="marked-textarea" data-ezclassify-part-of="doc">(R) A paragraph.</textarea></div>';

    function segments(host: HTMLElement) {
        const field = runtime().components.get(host) as {
            getSegments(): Array<{
                valid: boolean;
                errors: string[];
                warnings?: string[];
            }>;
        };
        return field.getSegments();
    }

    it('mounts when a mark’s first read throws, flags that mark with the message, and reads it again when the whole changes', async () => {
        failing = true;
        await mount(MARKUP, 'CONFIDENTIAL');
        await wait(300);
        const host = document.getElementById('host')!;

        expect(enhanced(host)).toBe(true);
        expect(segments(host)).toMatchObject([
            { valid: false, errors: [THROWN] },
        ]);

        failing = false;
        await publishWhole(VALID_WHOLE);
        await wait(300);
        expect(segments(host)).toMatchObject([{ valid: true, errors: [] }]);
    });

    it('keeps a failed read through another entry reflection, then clears it only after a successful replacement read', async () => {
        failingText = 'R';
        await mount(
            MARKUP.replace(
                '(R) A paragraph.',
                '(R) A paragraph.\n(C) Another paragraph.',
            ),
            VALID_WHOLE,
        );
        await wait(300);
        const host = document.getElementById('host') as HTMLTextAreaElement;
        const component = runtime().components.get(host) as {
            getEntryIds(): readonly string[];
            setValue(value: string): void;
        };
        const ids = component.getEntryIds();
        expect(ids).toHaveLength(2);
        const confidential = (
            await engineContext().scheme.process('CONFIDENTIAL')
        ).assertions;
        await forms!.store.publishAssertions(ids[1]!, confidential);
        await wait(100);
        expect(segments(host)[0]).toMatchObject({
            valid: false,
            errors: [THROWN],
        });
        expect(host.value).toBe('(R) A paragraph.\n(C) Another paragraph.');

        component.setValue('(R) Edited paragraph.\n(C) Another paragraph.');
        await wait(100);
        expect(segments(host)[0]).toMatchObject({
            valid: false,
            errors: [THROWN],
        });

        failingText = null;
        await forms!.store.publishAssertions(ids[0]!, confidential);
        await wait(150);
        expect(segments(host)[0]).toMatchObject({ valid: true, errors: [] });
        expect(host.value).toBe(
            '(C) Edited paragraph.\n(C) Another paragraph.',
        );
    });

    it('does not clear an independent partial-source hold when a contextual failure is repaired', async () => {
        partialScan = true;
        failingText = 'R';
        await mount(MARKUP, VALID_WHOLE);
        await wait(300);
        const host = document.getElementById('host') as HTMLTextAreaElement;
        const component = runtime().components.get(host) as {
            getEntryIds(): readonly string[];
            setValue(value: string): void;
            refreshWhole(): void;
        };
        const id = component.getEntryIds()[0]!;
        const confidential = (
            await engineContext().scheme.process('CONFIDENTIAL')
        ).assertions;
        failingText = null;
        await forms!.store.publishAssertions(id, confidential);
        await wait(100);
        expect(host.value).toBe('(R) A paragraph.');
        expect(host.getAttribute('data-ezclassify-entry-conflict')).toBe(
            'unresolved-source',
        );

        component.setValue('(R) Edited paragraph.');
        await wait(100);
        expect(host.value).toBe('(R) Edited paragraph.');
        expect(segments(host)[0]).toMatchObject({
            valid: false,
            errors: [THROWN],
        });
        expect(host.getAttribute('data-ezclassify-entry-conflict')).toBe(
            'unresolved-source',
        );

        partialScan = false;
        component.refreshWhole();
        await wait(150);
        expect(host.value).toBe('(C) Edited paragraph.');
        expect(segments(host)[0]).toMatchObject({ valid: true, errors: [] });
        expect(host.hasAttribute('data-ezclassify-entry-conflict')).toBe(false);
    });

    it('marks a chip with the warning under an invalid whole, keeps it valid, and drops it once the whole is valid', async () => {
        await mount(MARKUP, INVALID_WHOLE);
        await wait(300);
        const host = document.getElementById('host')!;
        const chip = () =>
            host
                .closest('.ez-test-field')!
                .querySelector('.marked-textarea-chip');

        expect(segments(host)).toMatchObject([
            { valid: true, warnings: [UNVERIFIED] },
        ]);
        expect(chip()!.classList).toContain('marked-textarea-chip--warning');
        expect(chip()!.classList).not.toContain(
            'marked-textarea-chip--invalid',
        );

        await publishWhole(VALID_WHOLE);
        await wait(300);
        expect(segments(host)).toMatchObject([{ valid: true, warnings: [] }]);
        expect(chip()!.classList).not.toContain(
            'marked-textarea-chip--warning',
        );
    });
});

describe('a part exceeding its whole', () => {
    const MARKUP = [
        '<input type="hidden" id="p1" data-ezclassify-rendered data-ezclassify-part-of="doc" />',
        '<div class="ez-test-field"><textarea id="part" data-ezclassify-controller="marking" data-ezclassify-bound-to="p1"></textarea></div>',
    ].join('');

    /** The notice beside the part, when one shows. */
    function exceedsNotice(): string | null {
        const notice = [
            ...root.querySelectorAll<HTMLElement>(
                '.ez-parent-validation-notice',
            ),
        ].find(
            (n) =>
                n.style.display !== 'none' &&
                n.previousElementSibling?.id === 'p1',
        );
        return notice?.textContent ?? null;
    }

    it('is reported only while the whole is valid, and again once the whole is fixed', async () => {
        await mount(MARKUP);
        await forms!.store.publishRendered('p1', 'RESTRICTED');
        await publishWhole('INTERNAL');
        expect(exceedsNotice()).toMatch(/exceeds/);

        await publishWhole(INVALID_WHOLE);
        expect(exceedsNotice()).toBeNull();
        // The part still reads on its own.
        expect(forms!.store.get('p1')).toMatchObject({
            rendered: expect.stringMatching(/^R/),
            valid: true,
        });

        await publishWhole('INTERNAL');
        expect(exceedsNotice()).toMatch(/exceeds/);
    });
});
