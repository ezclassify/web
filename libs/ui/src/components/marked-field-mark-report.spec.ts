/**
 * What the marked fields show about each mark.
 *
 * In a MarkedTextArea, a portion whose marking breaks a rule or carries a
 * warning is a button in the text: hover or focus gives the reason, and
 * activating it opens the portion's editor, whose list reads the same as the
 * error area under every other field: the broken rules, then the warnings, then
 * the ways to fix it. A fix rewrites that portion's mark and no other. A valid
 * portion with nothing to say stays plain text (the demo e2e opens one and
 * finds no report). A MarkedInput marks its leading mark the same way and lists
 * the report under the field.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Context } from '@ezclassify/engine';
import {
    cedarValleyAccessYaml,
    cedarValleyGuideYaml,
    cedarValleySchemeYaml,
} from '@ezclassify/example-schemes/cedar-valley';
import type { ProcessResult, Warning } from '@ezclassify/types';
import * as jsYaml from 'js-yaml';
import { EzClassifyUI } from '../ezclassify-ui';
import { openSurface, rows, wait } from './composer/composer-harness';

/** Cedar-valley spells FINANCIAL INFORMATION as FINANCIAL in a portion. */
const TEXT = [
    '(P//FINANCIAL) Budget notes.',
    '(C) A warned paragraph.',
    '(I) A plain paragraph.',
].join('\n');

/** Laid over the engine's answer for the second portion's marking. */
const WARNING: Warning = {
    ruleId: '_whole_unverified',
    kind: 'rule',
    message: 'Unable to compare with invalid marking.',
};

let root: HTMLDivElement;
let forms: EzClassifyUI | null = null;

beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn();
    root = document.createElement('div');
    document.body.appendChild(root);
});

afterEach(() => {
    forms?.destroy();
    forms = null;
    root.remove();
    document.body.replaceChildren();
});

/** The cedar-valley engine, with a warning on every read of `C` alone. */
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
        const warned = (result: ProcessResult): ProcessResult =>
            result.rendered === 'C' && result.valid
                ? { ...result, warnings: [...result.warnings, WARNING] }
                : result;
        const result = real(...args) as ProcessResult | Promise<ProcessResult>;
        return result instanceof Promise ? result.then(warned) : warned(result);
    };
    return ctx;
}

async function mount(): Promise<HTMLTextAreaElement> {
    root.innerHTML =
        '<textarea id="body" rows="4" data-ezclassify-controller="marked-textarea"></textarea>';
    const textarea = root.querySelector<HTMLTextAreaElement>('#body')!;
    textarea.value = TEXT;
    forms = new EzClassifyUI(engineContext(), { root });
    await wait(400);
    return textarea;
}

/** The chip of the portion whose mark starts with `mark`. */
function chip(mark: string): HTMLElement {
    const found = [
        ...root.querySelectorAll<HTMLElement>('.marked-textarea-chip'),
    ].find((c) => c.textContent?.startsWith(mark));
    if (!found) throw new Error(`no chip for ${mark}`);
    return found;
}

/** Open a portion's editor the way a keyboard user does. */
async function activate(mark: string): Promise<void> {
    chip(mark).dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
    );
    await wait(300);
}

/** The open list's report: its rule and warning lines, and its fix rows. */
function report() {
    const surface = openSurface();
    const lines = (kind: string) =>
        [
            ...(surface?.querySelectorAll(`.ez-composer__result-${kind}`) ??
                []),
        ].map((l) => l.textContent);
    return {
        rules: lines('rule'),
        warnings: lines('warning'),
        fixes: rows()
            .filter((r) => r.dataset.kind === 'fix')
            .map((r) => r.textContent),
    };
}

describe('MarkedTextArea portion report', () => {
    it('a portion that breaks rules is a button; its editor lists the errors and the ways to fix, and a fix rewrites that portion only', async () => {
        const textarea = await mount();
        const broken = chip('(P//FINANCIAL)');
        expect(broken.classList).toContain('marked-textarea-chip--invalid');
        expect(broken.getAttribute('role')).toBe('button');
        expect(broken.getAttribute('aria-label')).toMatch(/^Invalid marking: /);

        await activate('(P//FINANCIAL)');
        const shown = report();
        expect(shown.rules.length).toBeGreaterThan(1);
        expect(shown.warnings).toEqual([]);
        expect(shown.fixes).toContain('Replace P with C');

        rows()
            .find((r) => r.textContent === 'Replace P with C')!
            .click();
        await wait(500);
        expect(textarea.value.split('\n')).toEqual([
            '(C//FINANCIAL) Budget notes.',
            '(C) A warned paragraph.',
            '(I) A plain paragraph.',
        ]);
    });

    it('a portion with only a warning stays valid, says so on the mark, and its editor shows the warning with nothing to fix', async () => {
        await mount();
        const warned = chip('(C)');
        expect(warned.classList).toContain('marked-textarea-chip--warning');
        expect(warned.classList).not.toContain('marked-textarea-chip--invalid');
        expect(warned.getAttribute('aria-label')).toBe(
            `Marking has a warning: ${WARNING.message} Activate to edit.`,
        );

        await activate('(C)');
        expect(report()).toEqual({
            rules: [],
            warnings: [WARNING.message],
            fixes: [],
        });
    });

    it('a valid portion with nothing to say is plain text, not a button', async () => {
        await mount();
        const plain = chip('(I)');
        expect(plain.className).toBe('marked-textarea-chip');
        expect(plain.hasAttribute('role')).toBe(false);
        expect(plain.hasAttribute('tabindex')).toBe(false);
    });
});

describe('MarkedInput mark report', () => {
    async function mountInput(value: string): Promise<HTMLTextAreaElement> {
        root.innerHTML =
            '<input type="text" id="title" data-ezclassify-controller="marked-input">';
        const input = root.querySelector<HTMLTextAreaElement>('#title')!;
        input.value = value;
        forms = new EzClassifyUI(engineContext(), { root });
        await wait(300);
        return input;
    }

    function listed() {
        const list = root.querySelector<HTMLElement>('.ez-validation-errors');
        const text = (selector: string) =>
            [...(list?.querySelectorAll(selector) ?? [])].map(
                (e) => e.textContent,
            );
        return {
            hidden: !list || list.hidden,
            warnings: text('.ez-validation-errors__item--warning'),
            fixes: text('.ez-validation-errors__fix'),
        };
    }

    it('marks a warned mark, lists the warning under the field, and offers nothing to fix', async () => {
        await mountInput('(C) A title');
        expect(root.querySelector('.marked-input-chip')!.classList).toContain(
            'marked-input-chip--warning',
        );
        expect(listed()).toEqual({
            hidden: false,
            warnings: [WARNING.message],
            fixes: [],
        });
    });

    it('lists the ways to fix a broken mark, and a fix rewrites the mark only', async () => {
        const input = await mountInput('(P//FINANCIAL) A title');
        expect(root.querySelector('.marked-input-chip')!.classList).toContain(
            'marked-input-chip--invalid',
        );
        expect(listed().fixes).toContain('Replace P with C');
        [
            ...root.querySelectorAll<HTMLButtonElement>(
                '.ez-validation-errors__fix',
            ),
        ]
            .find((b) => b.textContent === 'Replace P with C')!
            .click();
        await wait(300);
        expect(input.value).toBe('(C//FINANCIAL) A title');
    });
});

describe('one list per field', () => {
    it('MarkedInput hides the list under the field while its editor shows the same report', async () => {
        root.innerHTML =
            '<input type="text" id="title" data-ezclassify-controller="marked-input">';
        const input = root.querySelector<HTMLTextAreaElement>('#title')!;
        input.value = '(P//FINANCIAL) A title';
        forms = new EzClassifyUI(engineContext(), { root });
        await wait(300);
        const list = root.querySelector<HTMLElement>('.ez-validation-errors')!;
        expect(list.hidden).toBe(false);

        root.querySelector<HTMLElement>('.marked-input-chip')!.dispatchEvent(
            new MouseEvent('mousedown', { bubbles: true }),
        );
        input.focus();
        document.activeElement!.dispatchEvent(
            new KeyboardEvent('keydown', {
                key: 'Enter',
                ctrlKey: true,
                metaKey: true,
                bubbles: true,
            }),
        );
        await wait(300);
        expect(openSurface()).not.toBeNull();
        expect(list.hidden).toBe(true);
        expect(
            openSurface()!.querySelectorAll('.ez-composer__result-rule').length,
        ).toBeGreaterThan(0);

        document.dispatchEvent(
            new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
        );
        await wait(300);
        expect(openSurface()).toBeNull();
        expect(list.hidden).toBe(false);
    });

    it('MarkingField hides the list under the field while its composer is open', async () => {
        root.innerHTML =
            '<textarea id="mf" data-ezclassify-controller="marking">PUBLIC//FINANCIAL INFORMATION</textarea>';
        forms = new EzClassifyUI(engineContext(), { root });
        await wait(300);
        const host = root.querySelector<HTMLTextAreaElement>('#mf')!;
        const list = root.querySelector<HTMLElement>('.ez-validation-errors')!;
        expect(list.hidden).toBe(false);

        host.focus();
        host.setSelectionRange(host.value.length, host.value.length);
        host.dispatchEvent(
            new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }),
        );
        await wait(300);
        expect(openSurface()).not.toBeNull();
        expect(list.hidden).toBe(true);

        host.blur();
        await wait(400);
        expect(openSurface()).toBeNull();
        expect(list.hidden).toBe(false);
    });
});

describe('folding the broken rules in the editor list', () => {
    async function openOn(value: string) {
        root.innerHTML =
            '<textarea id="mf" data-ezclassify-controller="marking"></textarea>';
        const host = root.querySelector<HTMLTextAreaElement>('#mf')!;
        host.value = value;
        forms = new EzClassifyUI(engineContext(), { root });
        await wait(300);
        host.focus();
        host.setSelectionRange(host.value.length, host.value.length);
        host.dispatchEvent(
            new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }),
        );
        await wait(300);
        return openSurface()!;
    }

    it('folds more than three broken rules under one line, fixes still listed', async () => {
        const surface = await openOn(
            'PUBLIC//FINANCIAL INFORMATION//OAKWOOD//DO NOT FORWARD',
        );
        const fold = surface.querySelector<HTMLDetailsElement>(
            '.ez-composer__problems',
        );
        expect(fold).not.toBeNull();
        expect(fold!.open).toBe(false);
        const count = fold!.querySelectorAll(
            '.ez-composer__result-rule',
        ).length;
        expect(count).toBeGreaterThan(3);
        expect(
            fold!.querySelector('.ez-composer__problems-summary')!.textContent,
        ).toBe(`${count} rules broken`);
        expect(
            rows().filter((r) => r.dataset.kind === 'fix').length,
        ).toBeGreaterThan(0);
    });

    it('opens the folded rules in place: the editor stays open and nothing is stored', async () => {
        const surface = await openOn('');
        const host = root.querySelector<HTMLTextAreaElement>('#mf')!;
        const field = (
            forms as unknown as {
                components: Map<Element, { getRendered(): string }>;
            }
        ).components.get(host)!;
        host.value = 'PUBLIC//FINANCIAL INFORMATION//OAKWOOD//DO NOT FORWARD';
        host.setSelectionRange(host.value.length, host.value.length);
        host.dispatchEvent(new Event('input', { bubbles: true }));
        await wait(300);
        const summary = surface.querySelector<HTMLElement>(
            '.ez-composer__problems-summary',
        );
        expect(summary).not.toBeNull();
        summary!.click();
        await wait(200);
        expect(openSurface()).not.toBeNull();
        expect(field.getRendered()).toBe('');
        expect(
            surface.querySelector<HTMLDetailsElement>('.ez-composer__problems')!
                .open,
        ).toBe(true);
    });

    it('lists three or fewer broken rules in full', async () => {
        const surface = await openOn('PUBLIC//FINANCIAL INFORMATION');
        expect(surface.querySelector('.ez-composer__problems')).toBeNull();
        expect(
            surface.querySelectorAll(':scope .ez-composer__result-rule').length,
        ).toBeGreaterThan(0);
    });
});

describe('the editor of a paragraph mark', () => {
    it('is named for the paragraph it edits, ahead of the field label', async () => {
        root.innerHTML =
            '<label for="body">Document paragraphs</label><textarea id="body" data-ezclassify-controller="marked-textarea"></textarea>';
        const textarea = root.querySelector<HTMLTextAreaElement>('#body')!;
        textarea.value = '(C) First paragraph.\n(I) Second paragraph.';
        forms = new EzClassifyUI(engineContext(), { root });
        await wait(400);
        const start = textarea.value.indexOf('(I)') + 1;
        textarea.focus();
        textarea.setSelectionRange(start, start);
        textarea.dispatchEvent(
            new KeyboardEvent('keydown', {
                key: 'Enter',
                ctrlKey: true,
                bubbles: true,
            }),
        );
        await wait(300);
        const list = document.querySelector('.ez-composer .ez-composer__list')!;
        expect(list.getAttribute('aria-label')).toBe(
            'Paragraph 2: Document paragraphs',
        );
        expect(
            document.querySelector('.ez-composer__sheet-label')!.textContent,
        ).toBe('Paragraph 2: Document paragraphs');
    });

    it('counts body paragraphs from 1 across blank lines, and takes the short name over a label that also holds instructions', async () => {
        root.innerHTML =
            '<label for="body">Document paragraphs. Edit the marks in parentheses.</label><textarea id="body" aria-label="Document body" data-ezclassify-controller="marked-textarea"></textarea>';
        const textarea = root.querySelector<HTMLTextAreaElement>('#body')!;
        textarea.value = '(C) First paragraph.\n\n(I) Second paragraph.';
        forms = new EzClassifyUI(engineContext(), { root });
        await wait(400);
        const start = textarea.value.indexOf('(I)') + 1;
        textarea.focus();
        textarea.setSelectionRange(start, start);
        textarea.dispatchEvent(
            new KeyboardEvent('keydown', {
                key: 'Enter',
                ctrlKey: true,
                bubbles: true,
            }),
        );
        await wait(300);
        expect(
            document.querySelector('.ez-composer__sheet-label')!.textContent,
        ).toBe('Paragraph 2: Document body');
    });
});
