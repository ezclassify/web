/**
 * DecisionFlow over a marking that spans two scopes, against the engine.
 *
 * The scheme (see `two-scope-flow-scheme.ts`) writes a level line and an origin
 * block. Its origin choices branch, some take a typed value, and two rules
 * judge the block, so these specs pin what a flow across scopes does with the
 * engine's own answers: which steps it walks and in what order (the origin
 * block never writes the decision type, but every other origin step depends on
 * it, so it comes first), the surface every step's engine call names, which
 * steps show, how a value is taken, how the marking is judged, and what the
 * flow and the views show at the end.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Assertion } from '@ezclassify/types';
import {
    connectDemoContext,
    demoRuntimeSettled,
} from '../../../../test-support/demo-runtime';
import {
    openContext,
    type OpenContext,
} from '../../test-fixtures/context-doubles';
import { TWO_SCOPE_FLOW_SCHEME } from '../../test-fixtures/two-scope-flow-scheme';
import { EzClassifyUI } from '../ezclassify-ui';
import { DecisionFlow, type DecisionFlowOptions } from './decision-flow';

let connection: ReturnType<typeof connectDemoContext> | undefined;

/** A fresh view of the draft Context, whose operations a spec may spy on. */
async function context(): Promise<OpenContext> {
    connection ??= connectDemoContext({
        draft: { scheme: TWO_SCOPE_FLOW_SCHEME },
    });
    return openContext(await connection);
}

let forms: EzClassifyUI | null = null;
let flow: DecisionFlow | null = null;

afterEach(() => {
    forms?.destroy();
    forms = null;
    flow?.destroy();
    flow = null;
    document.body.innerHTML = '';
    vi.restoreAllMocks();
});

/** Mount a flow directly, the way a host mounts a component. */
async function mountFlow(
    options: DecisionFlowOptions,
    ctx?: OpenContext,
): Promise<{ host: HTMLDivElement; ctx: OpenContext }> {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const opened = ctx ?? (await context());
    flow = new DecisionFlow();
    await flow.init(host, opened, options);
    return { host, ctx: opened };
}

/** Focus the flow so it asks the engine for its options, and let them land. */
async function enter(host: HTMLElement): Promise<void> {
    host.querySelector<HTMLElement>(
        '.ez-decision-flow__option, .ez-decision-flow__text-field',
    )?.focus();
    await demoRuntimeSettled();
}

const question = (host: HTMLElement) =>
    host.querySelector('.ez-decision-flow__question-label')?.textContent ?? '';
/** The scope the current step's dot is grouped under, for a flow of several. */
const scopeHeading = (host: HTMLElement) =>
    host
        .querySelector('.ez-decision-flow__step-dot[aria-current="step"]')
        ?.closest('.ez-decision-flow__dot-group')
        ?.getAttribute('aria-label') ?? null;
/** The category a dot stands for, as its accessible name says it. */
const dotCategory = (dot: Element) =>
    (dot.getAttribute('aria-label') ?? '')
        .replace(/^Step \d+ of \d+, /, '')
        .split(':')[0];
/** Each dot group's scope and the categories of its dots. */
const dotGroups = (host: HTMLElement) =>
    Array.from(host.querySelectorAll('.ez-decision-flow__dot-group')).map(
        (group) => [
            group.getAttribute('aria-label'),
            Array.from(
                group.querySelectorAll('.ez-decision-flow__step-dot'),
            ).map(dotCategory),
        ],
    );
/** The dot of the step for `label`, by its accessible name. */
const dotFor = (host: HTMLElement, label: string) =>
    Array.from(
        host.querySelectorAll<HTMLElement>('.ez-decision-flow__step-dot'),
    ).find((dot) => dotCategory(dot) === label)!;
/** A value's text as written, its line breaks kept. */
const written = (el: Element | null | undefined) => {
    if (!el || el.hasAttribute('data-empty')) return undefined;
    const copy = el.cloneNode(true) as Element;
    for (const br of copy.querySelectorAll('br')) br.replaceWith('\n');
    return copy.textContent ?? undefined;
};
/**
 * Each value: its scope's name, for a flow of several, and the full text it
 * writes.
 */
const lines = (host: HTMLElement) =>
    Array.from(host.querySelectorAll('.ez-decision-flow__value')).map(
        (value) => [
            value
                .closest('.ez-decision-flow__scope')
                ?.querySelector('.ez-decision-flow__scope-name')?.textContent ??
                null,
            written(value.querySelector('.ez-decision-flow__value-text')),
        ],
    );
const optionNames = (host: HTMLElement) =>
    Array.from(host.querySelectorAll('.ez-decision-flow__option')).map(
        (el) => el.textContent,
    );
const option = (host: HTMLElement, name: string) =>
    Array.from(
        host.querySelectorAll<HTMLButtonElement>('.ez-decision-flow__option'),
    ).find((el) => el.textContent === name)!;
/** The error list sits directly after the field, beside its mount. */
const errors = (host: HTMLElement) =>
    Array.from(
        host.parentElement!.querySelectorAll('.ez-validation-errors__message'),
    ).map((el) => el.textContent);

async function choose(host: HTMLElement, name: string): Promise<void> {
    option(host, name).click();
    await demoRuntimeSettled();
}

async function next(host: HTMLElement): Promise<void> {
    host.querySelector<HTMLButtonElement>('[aria-label="Next step"]')!.click();
    await demoRuntimeSettled();
}

/** Jump to the step for `label` from its dot. */
async function jump(host: HTMLElement, label: string): Promise<void> {
    dotFor(host, label).click();
    await demoRuntimeSettled();
}

async function type(input: HTMLInputElement, text: string): Promise<void> {
    input.focus();
    input.value = text;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await demoRuntimeSettled();
}

/** Walk Next until the step's question names `label`. */
async function stepTo(host: HTMLElement, label: string): Promise<void> {
    for (let i = 0; i < 10 && !question(host).includes(label); i++)
        await next(host);
    expect(question(host)).toContain(label);
}

const held = (flowAssertions: Assertion[]) =>
    flowAssertions.map(
        (a) => `${a.categoryId}:${a.conceptId}${a.value ? `=${a.value}` : ''}`,
    );

describe('DecisionFlow across scopes', () => {
    it('reads its categories and scopes from its own host element', async () => {
        const root = document.createElement('div');
        root.innerHTML = `
            <input type="hidden" id="doc" data-ezclassify-marking>
            <input id="flow" data-ezclassify-controller="decisionflow"
                   data-ezclassify-bound-to="doc"
                   data-ezclassify-scope="label origin"
                   data-ezclassify-decisionflow-categories='["level","origin_type"]'>`;
        document.body.appendChild(root);
        forms = new EzClassifyUI(await context(), { root });
        await demoRuntimeSettled();
        const mount = root.querySelector<HTMLElement>(
            '[data-ezclassify-mount="decisionflow"]',
        )!;
        await enter(mount);

        expect(dotGroups(mount)).toEqual([
            ['Label Line', ['Level']],
            ['Origin Block', ['Decision Type']],
        ]);
    });

    it('walks the listed scopes in declaration order, each with the step others depend on first', async () => {
        // Listed out of order on purpose: the scheme declares label first.
        const { host } = await mountFlow({ scopes: ['origin', 'label'] });
        await enter(host);

        expect(question(host)).toBe('1 of 3 \u00b7 Level');
        expect(scopeHeading(host)).toBe('Label Line');
        expect(dotGroups(host)).toEqual([
            ['Label Line', ['Level']],
            ['Origin Block', ['Decision Type', 'Release']],
        ]);
        // A single choice moves the flow on to the next step.
        await choose(host, 'HIGH');
        expect(question(host)).toBe('2 of 3 \u00b7 Decision Type');
        expect(scopeHeading(host)).toBe('Origin Block');
    });

    it("asks for each step's options on that step's own scope", async () => {
        const ctx = await context();
        const suggest = vi.spyOn(ctx.scheme, 'suggest');
        const { host } = await mountFlow({ scope: 'label origin' }, ctx);
        await enter(host);

        const surfaces = suggest.mock.calls.map(
            ([, options]) => (options as { surface?: string }).surface,
        );
        expect(new Set(surfaces)).toEqual(new Set(['label', 'origin']));
        await choose(host, 'HIGH');
        // The origin step has its options, so the required choice can be made.
        // Each reads as the origin block writes it, its name in its tooltip.
        expect(optionNames(host)).toEqual(['Original', 'Copied']);
        expect(option(host, 'Original').title).toBe(
            'Decision Type: Original Decision',
        );
        await choose(host, 'Copied');
        expect(dotFor(host, 'Decision Type').dataset.state).toBe('answered');
    });

    it('labels steps and groups the summary by scope only when it spans scopes', async () => {
        const { host } = await mountFlow({ scope: 'origin' });
        await enter(host);

        expect(question(host)).toBe('1 of 2 \u00b7 Decision Type');
        expect(scopeHeading(host)).toBeNull();
        expect(host.querySelector('.ez-decision-flow__dot-group')).toBeNull();
        // One scope: one value, with no scope name.
        expect(lines(host).map(([label]) => label)).toEqual([null]);
        flow!.destroy();

        const spanning = await mountFlow({ scope: 'label origin' });
        await enter(spanning.host);
        expect(dotGroups(spanning.host).map(([scope]) => scope)).toEqual([
            'Label Line',
            'Origin Block',
        ]);
        expect(lines(spanning.host).map(([label]) => label)).toEqual([
            'Label Line',
            'Origin Block',
        ]);
    });

    it("takes a value in the chosen option's own box, beside plain ones, stating it only with a value", async () => {
        const ctx = await context();
        const process = vi.spyOn(ctx.scheme, 'process');
        const { host } = await mountFlow({ scope: 'origin' }, ctx);
        await enter(host);
        await choose(host, 'Original');
        await stepTo(host, 'Release');

        // Until chosen, a value option looks like the others.
        expect(optionNames(host)).toEqual(['On a Date', 'Never', 'Exempt']);
        await choose(host, 'On a Date');
        // Chosen, it is a box in its own place among the options: the
        // option, still checked, is the small label on it, and the value goes
        // under it. Its form shows once, in the empty box.
        const box = () =>
            host.querySelector<HTMLElement>(
                '.ez-decision-flow__options > .ez-decision-flow__value-option',
            )!;
        const valueInput = () =>
            box().querySelector<HTMLInputElement>(
                '.ez-decision-flow__value-box > input',
            )!;
        // In its own place: first, where the option was.
        expect(
            [...host.querySelector('.ez-decision-flow__options')!.children]
                .filter((el) => !(el as HTMLElement).hidden)
                .map(
                    (el) =>
                        (el as HTMLElement).dataset.conceptId ??
                        el.querySelector<HTMLElement>('[data-concept-id]')
                            ?.dataset.conceptId,
                ),
        ).toEqual(['ON_DATE', 'NEVER', 'EXEMPT']);
        const name = box().querySelector<HTMLElement>(
            '.ez-decision-flow__value-name',
        )!;
        expect(name.textContent).toBe('On a Date');
        expect(name.getAttribute('aria-pressed')).toBe('true');
        const field = valueInput();
        expect(field.getAttribute('aria-label')).toBe(
            'Release date (YYYYMMDD)',
        );
        expect(field.placeholder).toBe('YYYYMMDD');
        expect(host.querySelector('.ez-decision-flow__companion')).toBeNull();
        expect(
            [...host.querySelectorAll('.ez-decision-flow__step *')].filter(
                (el) =>
                    !(el as HTMLElement).hidden &&
                    el.children.length === 0 &&
                    el.textContent?.includes('YYYYMMDD'),
            ),
        ).toEqual([]);
        expect(held(flow!.getAssertions())).not.toContain(
            expect.stringContaining('release_type'),
        );

        await type(field, '2045');
        expect(
            flow!.getAssertions().some((a) => a.conceptId === 'ON_DATE'),
        ).toBe(false);

        await type(valueInput(), '20451231');
        // Stored in the encoding's canonical spelling, and shown on its dot
        // under the choice's name, the way the origin block writes it.
        expect(
            flow!.getAssertions().find((a) => a.conceptId === 'ON_DATE')?.value,
        ).toBe('2045-12-31');
        expect(
            host
                .querySelector(
                    '.ez-decision-flow__step-dot[data-category-id="release_type"]',
                )
                ?.getAttribute('aria-label'),
        ).toMatch(/, On a Date: 20451231$/);
        // No request ever stated the value-taking choice without its value.
        const stated = process.mock.calls.flatMap(
            ([, options]) =>
                (options as { assertions?: Assertion[] }).assertions ?? [],
        );
        expect(
            stated.filter((a) => a.conceptId === 'ON_DATE' && !a.value),
        ).toEqual([]);
        // The typed text stays as typed, and the form is gone once it is in.
        expect(valueInput().value).toBe('20451231');
        expect(
            host.querySelector<HTMLElement>('.ez-decision-flow__text-hint')
                ?.hidden ?? true,
        ).toBe(true);
    });

    it('shows at rest the steps the engine offers, the same dots it shows open', async () => {
        const { host } = await mountFlow({ scope: 'label origin' });
        await demoRuntimeSettled();
        const atRest = dotGroups(host);
        // The copied and original paths' steps are not on offer yet.
        expect(atRest).toEqual([
            ['Label Line', ['Level']],
            ['Origin Block', ['Decision Type', 'Release']],
        ]);
        await enter(host);
        expect(dotGroups(host)).toEqual(atRest);
    });

    it('shows a step only while the engine offers it, and clears a path not taken', async () => {
        const { host } = await mountFlow({ scope: 'origin' });
        await enter(host);
        expect(question(host)).toBe('1 of 2 \u00b7 Decision Type');

        // The choice brings the copied path's steps, and moves on to them.
        await choose(host, 'Copied');
        expect(question(host)).toMatch(/^2 of 4 \u00b7 /);
        await next(host);
        expect(question(host)).toBe('3 of 4 \u00b7 Source');
        await choose(host, 'Many Sources');
        expect(held(flow!.getAssertions())).toContain(
            'source_type:MANY_SOURCES',
        );

        await jump(host, 'Decision Type');
        await choose(host, 'Original');
        // The engine offers no source to an original decision, so the source
        // choice is cleared and its step goes; the reasons step comes.
        expect(
            flow!.getAssertions().some((a) => a.categoryId === 'source_type'),
        ).toBe(false);
        expect(question(host)).toMatch(/^2 of 4 \u00b7 /);
        await next(host);
        expect(question(host)).toBe('3 of 4 \u00b7 Reason');
    });

    it('judges the marking on each scope it walks, the same way every time', async () => {
        const ctx = await context();
        const process = vi.spyOn(ctx.scheme, 'process');
        const { host } = await mountFlow({ scope: 'label origin' }, ctx);
        await enter(host);
        await choose(host, 'HIGH');
        await choose(host, 'Original');
        await stepTo(host, 'Release');
        await choose(host, 'Exempt');

        const judged = new Set(
            process.mock.calls.map(
                ([, options]) => (options as { surface?: string }).surface,
            ),
        );
        expect(judged).toEqual(new Set([undefined, 'label', 'origin']));
        const shown = errors(host);
        expect(shown).toContain('An exemption names its exemption code.');

        // Moving on paints the same report.
        expect(question(host)).toContain('Exemption Code');
        expect(errors(host)).toEqual(shown);
        await choose(host, 'X1');
        expect(errors(host)).not.toContain(
            'An exemption names its exemption code.',
        );
    });

    it('says why the lines are empty when writing the marking fails', async () => {
        const ctx = await context();
        vi.spyOn(console, 'error').mockImplementation(() => {});
        const { host } = await mountFlow({ scope: 'label origin' }, ctx);
        await enter(host);
        vi.spyOn(ctx.scheme, 'render').mockRejectedValue(
            new Error('GET https://runtime.example/v1 failed'),
        );
        await choose(host, 'HIGH');
        await demoRuntimeSettled();

        const note = host.querySelector(
            '.ez-decision-flow__value-wrap ~ [role=status], .ez-decision-flow__problem[role=status]',
        );
        expect(note?.textContent).toBe(
            'The marking could not be written just now. Change a choice to try again.',
        );
        expect(host.textContent).not.toContain('runtime.example');
    });

    it('shows each scope written in its own output on its line', async () => {
        const { host } = await mountFlow({ scope: 'label origin' });
        await enter(host);
        await choose(host, 'HIGH');
        await choose(host, 'Copied');
        await type(
            host.querySelector<HTMLInputElement>(
                '.ez-decision-flow__text-field',
            )!,
            'J. Doe, Editor',
        );
        await next(host);
        await choose(host, 'One Source');
        await type(
            host.querySelector<HTMLInputElement>(
                '.ez-decision-flow__value-option input',
            )!,
            'Memo 1',
        );
        await stepTo(host, 'Release');
        await choose(host, 'Never');
        expect(question(host)).toBe('5 of 5 \u00b7 Release');
        await demoRuntimeSettled();

        // Each scope's line holds that scope written in its own output.
        expect(lines(host)).toEqual([
            ['Label Line', 'HIGH'],
            [
                'Origin Block',
                'Decided By: J. Doe, Editor\nSource: Memo 1\nRelease: Never',
            ],
        ]);
        expect(errors(host)).toEqual([]);
    });
});

describe('declarative views of a scope', () => {
    it("show their scope's own output of the marking a flow across scopes edits", async () => {
        const root = document.createElement('div');
        root.innerHTML = `
            <input type="hidden" id="doc" data-ezclassify-marking>
            <input id="flow" data-ezclassify-controller="decisionflow"
                   data-ezclassify-bound-to="doc"
                   data-ezclassify-scope="label origin">
            <div id="line" data-ezclassify-controller="banner"
                 data-ezclassify-source="doc" data-ezclassify-scope="label"></div>
            <div id="block" data-ezclassify-controller="banner"
                 data-ezclassify-source="doc" data-ezclassify-scope="origin"></div>
            <span id="mirror" data-ezclassify-source="doc"
                  data-ezclassify-scope="origin"></span>`;
        document.body.appendChild(root);
        forms = new EzClassifyUI(await context(), { root });
        await demoRuntimeSettled();
        const host = root.querySelector<HTMLElement>(
            '[data-ezclassify-mount="decisionflow"]',
        )!;
        await enter(host);
        await choose(host, 'HIGH');
        await choose(host, 'Copied');
        await stepTo(host, 'Release');
        await choose(host, 'Never');
        await demoRuntimeSettled();

        const label = (id: string) =>
            root.querySelector(`#${id} .status-banner-label`)?.textContent;
        expect(label('line')).toBe('HIGH');
        expect(label('block')).toBe('Release: Never');
        // A plain mirror with no controller honors its scope the same way.
        expect(root.querySelector('#mirror')?.textContent).toBe(
            'Release: Never',
        );
        expect(
            forms.store.get('doc').assertions.map((a) => a.conceptId),
        ).toEqual(expect.arrayContaining(['HIGH', 'COPIED', 'NEVER']));
    });
});
