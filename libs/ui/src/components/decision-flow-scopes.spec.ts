/**
 * DecisionFlow over a marking that spans two scopes, against the engine.
 *
 * The scheme (see `two-scope-flow-scheme.ts`) writes a level line and an origin
 * block. Its origin choices branch, some take a typed value, and two rules
 * judge the block, so these specs pin what a flow across scopes does with the
 * engine's own answers: which steps it walks and in what order, the surface
 * every step's engine call names, which steps show, how a value is taken, how
 * the marking is judged, and what the flow and the views show at the end.
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
const scopeHeading = (host: HTMLElement) =>
    host.querySelector('.ez-decision-flow__scope')?.textContent ?? null;
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
    Array.from(host.querySelectorAll<HTMLButtonElement>('button'))
        .find((b) => /Next|Done/.test(b.textContent ?? ''))!
        .click();
    await demoRuntimeSettled();
}

async function back(host: HTMLElement): Promise<void> {
    Array.from(host.querySelectorAll<HTMLButtonElement>('button'))
        .find((b) => /Back/.test(b.textContent ?? ''))!
        .click();
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

        const chips = Array.from(
            mount.querySelectorAll('.ez-decision-flow__summary-chip'),
        ).map((chip) => chip.textContent?.split(':')[0]);
        expect(chips).toEqual(['Level', 'Decision Type']);
    });

    it('walks the listed scopes in declaration order, then category order', async () => {
        // Listed out of order on purpose: the scheme declares label first.
        const { host } = await mountFlow({ scopes: ['origin', 'label'] });
        await enter(host);

        expect(question(host)).toBe('Step 1 of 3: Level');
        expect(scopeHeading(host)).toBe('Label Line');
        const walked = Array.from(
            host.querySelectorAll('.ez-decision-flow__summary-group'),
        ).map((group) => [
            group.getAttribute('aria-label'),
            Array.from(
                group.querySelectorAll('.ez-decision-flow__summary-chip'),
            ).map((chip) => chip.textContent?.split(':')[0]),
        ]);
        expect(walked).toEqual([
            ['Label Line', ['Level']],
            ['Origin Block', ['Decision Type', 'Release']],
        ]);
        await choose(host, 'HIGH');
        await next(host);
        expect(question(host)).toBe('Step 2 of 3: Decision Type');
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
        await next(host);
        // The origin step has its options, so the required choice can be made.
        expect(optionNames(host)).toEqual(['Original', 'Copied']);
        await choose(host, 'Copied');
        expect(
            host
                .querySelector<HTMLButtonElement>(
                    '.ez-decision-flow__nav-btn:last-child',
                )!
                .hasAttribute('disabled'),
        ).toBe(false);
    });

    it('labels steps and groups the summary by scope only when it spans scopes', async () => {
        const { host } = await mountFlow({ scope: 'origin' });
        await enter(host);

        expect(question(host)).toBe('Step 1 of 2: Decision Type');
        expect(scopeHeading(host)).toBeNull();
        expect(
            host.querySelector('.ez-decision-flow__summary-group'),
        ).toBeNull();
        expect(host.querySelector('.ez-decision-flow__result')).toBeNull();
        flow!.destroy();

        const spanning = await mountFlow({ scope: 'label origin' });
        await enter(spanning.host);
        const groups = Array.from(
            spanning.host.querySelectorAll('.ez-decision-flow__summary-group'),
        ).map((group) => group.getAttribute('aria-label'));
        expect(groups).toEqual(['Label Line', 'Origin Block']);
    });

    it('takes a value for a value-taking choice beside plain ones, stating it only with a value', async () => {
        const ctx = await context();
        const process = vi.spyOn(ctx.scheme, 'process');
        const { host } = await mountFlow({ scope: 'origin' }, ctx);
        await enter(host);
        await choose(host, 'Original');
        await stepTo(host, 'Release');

        await choose(host, 'On a Date');
        expect(option(host, 'On a Date').getAttribute('aria-checked')).toBe(
            'true',
        );
        const field = host.querySelector<HTMLInputElement>(
            '.ez-decision-flow__companion input',
        )!;
        expect(
            host.querySelector('.ez-decision-flow__companion label')
                ?.textContent,
        ).toBe('Release date (YYYYMMDD)');
        expect(held(flow!.getAssertions())).not.toContain(
            expect.stringContaining('release_type'),
        );

        await type(field, '2045');
        expect(
            flow!.getAssertions().some((a) => a.conceptId === 'ON_DATE'),
        ).toBe(false);

        await type(
            host.querySelector<HTMLInputElement>(
                '.ez-decision-flow__companion input',
            )!,
            '20451231',
        );
        expect(
            flow!.getAssertions().find((a) => a.conceptId === 'ON_DATE')?.value,
        ).toBeTruthy();
        // No request ever stated the value-taking choice without its value.
        const stated = process.mock.calls.flatMap(
            ([, options]) =>
                (options as { assertions?: Assertion[] }).assertions ?? [],
        );
        expect(
            stated.filter((a) => a.conceptId === 'ON_DATE' && !a.value),
        ).toEqual([]);
        // The typed text stays as typed.
        expect(
            host.querySelector<HTMLInputElement>(
                '.ez-decision-flow__companion input',
            )!.value,
        ).toBe('20451231');
    });

    it('shows a step only while the engine offers it, and clears a path not taken', async () => {
        const { host } = await mountFlow({ scope: 'origin' });
        await enter(host);
        expect(question(host)).toBe('Step 1 of 2: Decision Type');

        await choose(host, 'Copied');
        expect(question(host)).toBe('Step 1 of 4: Decision Type');
        await next(host);
        await next(host);
        expect(question(host)).toBe('Step 3 of 4: Source');
        await choose(host, 'Many Sources');
        expect(held(flow!.getAssertions())).toContain(
            'source_type:MANY_SOURCES',
        );

        await back(host);
        await back(host);
        await choose(host, 'Original');
        // The engine offers no source to an original decision, so the source
        // choice is cleared and its step goes; the reasons step comes.
        expect(
            flow!.getAssertions().some((a) => a.categoryId === 'source_type'),
        ).toBe(false);
        expect(question(host)).toBe('Step 1 of 4: Decision Type');
        await next(host);
        await next(host);
        expect(question(host)).toBe('Step 3 of 4: Reason');
    });

    it('judges the marking on each scope it walks, the same way every time', async () => {
        const ctx = await context();
        const process = vi.spyOn(ctx.scheme, 'process');
        const { host } = await mountFlow({ scope: 'label origin' }, ctx);
        await enter(host);
        await choose(host, 'HIGH');
        await next(host);
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
        await next(host);
        expect(question(host)).toContain('Exemption Code');
        expect(errors(host)).toEqual(shown);
        await choose(host, 'X1');
        expect(errors(host)).not.toContain(
            'An exemption names its exemption code.',
        );
    });

    it('ends by showing each scope written in its own output', async () => {
        const { host } = await mountFlow({ scope: 'label origin' });
        await enter(host);
        await choose(host, 'HIGH');
        await next(host);
        await choose(host, 'Copied');
        await next(host);
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
                '.ez-decision-flow__companion input',
            )!,
            'Memo 1',
        );
        await stepTo(host, 'Release');
        await choose(host, 'Never');
        expect(question(host)).toBe('Step 5 of 5: Release');
        await demoRuntimeSettled();

        const result = Array.from(
            host.querySelectorAll('.ez-decision-flow__result-scope'),
        ).map((block) => [
            block.querySelector('.ez-decision-flow__result-label')?.textContent,
            block.querySelector('.ez-decision-flow__result-text')?.textContent,
        ]);
        expect(result).toEqual([
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
                 data-ezclassify-source="doc" data-ezclassify-scope="origin"></div>`;
        document.body.appendChild(root);
        forms = new EzClassifyUI(await context(), { root });
        await demoRuntimeSettled();
        const host = root.querySelector<HTMLElement>(
            '[data-ezclassify-mount="decisionflow"]',
        )!;
        await enter(host);
        await choose(host, 'HIGH');
        await next(host);
        await choose(host, 'Copied');
        await stepTo(host, 'Release');
        await choose(host, 'Never');
        await demoRuntimeSettled();

        const label = (id: string) =>
            root.querySelector(`#${id} .status-banner-label`)?.textContent;
        expect(label('line')).toBe('HIGH');
        expect(label('block')).toBe('Release: Never');
        expect(
            forms.store.get('doc').assertions.map((a) => a.conceptId),
        ).toEqual(expect.arrayContaining(['HIGH', 'COPIED', 'NEVER']));
    });
});
