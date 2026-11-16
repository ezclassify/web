/**
 * @vitest-environment jsdom
 *
 * Rollup outputs on a page with several buckets: several Contexts, or one
 * Context holding several schemes. Buckets never merge, and an output holds
 * exactly one of them.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { CoverageReport, ProcessResult } from '@ezclassify/types';
import { updateRollup, type RollupEventDetail } from './rollup';
import type { BucketAggregate, BucketScheme, FormsContext } from './types';
import { bucketKey, bucketParts, type BucketKey } from '../store/store-shared';

vi.mock('./dom', () => ({ showCopiedIndicator: vi.fn() }));

const CAPCO = bucketKey('capco', '');
const CUI = bucketKey('cui', '');
const TIER_PRIMARY = bucketKey('corporate', '');
const TIER_SECOND = bucketKey('corporate', 'tier');

function state(rendered: string): BucketAggregate {
    return { rendered, assertions: [] };
}

/** One answering engine per bucket, so a test can see which one was asked. */
function engineFor(bucket: BucketKey) {
    return {
        bucket,
        process: vi.fn(
            (input: string, _options?: unknown) =>
                ({
                    valid: true,
                    rendered: input,
                    assertions: [],
                    errors: [],
                    warnings: [],
                }) as unknown as ProcessResult,
        ),
        checkCoverage: vi.fn(
            (_children: string[], _parent: string) =>
                ({
                    covered: true,
                    missing: [],
                    missingLabels: [],
                    excess: [],
                    excessLabels: [],
                    rendered: '',
                }) as unknown as CoverageReport,
        ),
    };
}

/** The selector a Context's primary scheme is named by in markup. */
const PRIMARY_NAMES: Record<string, string> = { corporate: 'policy' };

function createCtx(
    space: BucketKey[],
    page: Map<BucketKey, BucketAggregate>,
    overrides: Partial<FormsContext> = {},
): FormsContext & { engines: Map<BucketKey, ReturnType<typeof engineFor>> } {
    const engines = new Map(space.map((b) => [b, engineFor(b)]));
    // A field reads in the bucket its nearest context/scheme attributes name.
    const schemeOf = (el: HTMLElement): BucketScheme => {
        const contextKey =
            el
                .closest('[data-ezclassify-context]')
                ?.getAttribute('data-ezclassify-context') ?? '';
        const selector =
            el
                .closest('[data-ezclassify-scheme]')
                ?.getAttribute('data-ezclassify-scheme') ?? '';
        const bucket = bucketKey(contextKey, selector);
        const engine = engines.get(bucket);
        if (!engine) throw new Error(`no bucket ${contextKey}/${selector}`);
        return {
            bucket,
            adapter: engine,
            process: (input, options) => engine.process(input, options),
            validate: (input) => engine.process(input) as never,
            checkCoverage: (children, parent) =>
                engine.checkCoverage(children, parent),
            getSchemeMeta: () =>
                ({ id: 's', version: '1', name: 's' }) as never,
        };
    };
    return {
        engines,
        engine: {} as FormsContext['engine'],
        schemeOf,
        bucketsNamed: (contextKey: string | null, scheme: string | null) =>
            space.filter((key) => {
                const parts = bucketParts(key);
                const named =
                    scheme === PRIMARY_NAMES[parts.contextKey] ? '' : scheme;
                return (
                    (contextKey === null || parts.contextKey === contextKey) &&
                    (named === null || parts.schemeSelector === named)
                );
            }),
        aggregateOf: (id: string | null) => (id === null ? page : new Map()),
        destroyed: false,
        root: document.body,
        fields: [],
        defaultFormat: 'default',
        defaultPartFormat: 'default',
        domObserver: null,
        autocompleters: new Map(),
        lastValidated: new Map(),
        fieldAssertions: new Map(),
        tooltipEl: null,
        settingValue: false,
        colorMap: {},
        initializing: false,
        mountInstanceId: 'instance',
        mounted: new Map(),
        partOfMap: new Map(),
        aggregates: new Map(),
        ...overrides,
    } as FormsContext & {
        engines: Map<BucketKey, ReturnType<typeof engineFor>>;
    };
}

function sink(
    attrs: Record<string, string> = {},
    parent: HTMLElement = document.body,
): HTMLInputElement {
    const el = document.createElement('input');
    el.type = 'hidden';
    el.setAttribute('data-ezclassify-aggregate', '');
    for (const [name, value] of Object.entries(attrs))
        el.setAttribute(`data-ezclassify-${name}`, value);
    parent.appendChild(el);
    return el;
}

describe('forms/rollup: outputs on a page with several buckets', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
    });

    it("fills each sink that names its Context with that Context's rollup", async () => {
        const capco = sink({ context: 'capco' });
        const cui = sink({ context: 'cui' });
        const ctx = createCtx(
            [CAPCO, CUI],
            new Map([
                [CAPCO, state('SECRET')],
                [CUI, state('CUI')],
            ]),
        );

        await updateRollup(ctx);

        expect(capco.value).toBe('SECRET');
        expect(cui.value).toBe('CUI');
    });

    it('refuses a bare sink when several Contexts could fill it', async () => {
        const bare = sink();
        bare.value = 'SECRET';
        const reportHostError = vi.fn();
        const ctx = createCtx(
            [CAPCO, CUI],
            new Map([
                [CAPCO, state('SECRET')],
                [CUI, state('CUI')],
            ]),
            { reportHostError },
        );

        await updateRollup(ctx);

        expect(bare.value).toBe('');
        expect(bare.getAttribute('aria-invalid')).toBe('true');
        expect(reportHostError).toHaveBeenCalledWith(
            expect.objectContaining({
                code: 'aggregate-bucket-ambiguous',
                element: bare,
            }),
        );
    });

    it("reads only the sink's own Context attribute, never an inherited default", async () => {
        const section = document.createElement('section');
        section.setAttribute('data-ezclassify-context', 'capco');
        document.body.appendChild(section);
        const inside = sink({}, section);
        const reportHostError = vi.fn();
        const ctx = createCtx(
            [CAPCO, CUI],
            new Map([
                [CAPCO, state('SECRET')],
                [CUI, state('CUI')],
            ]),
            { reportHostError },
        );

        await updateRollup(ctx);

        expect(inside.value).toBe('');
        expect(reportHostError.mock.calls[0][0].code).toBe(
            'aggregate-bucket-ambiguous',
        );
    });

    it('needs the scheme selector too when the named Context holds several schemes', async () => {
        const contextOnly = sink({ context: 'corporate' });
        const primary = sink({ context: 'corporate', scheme: 'policy' });
        const second = sink({ context: 'corporate', scheme: 'tier' });
        const schemeOnly = sink({ scheme: 'tier' });
        const ctx = createCtx(
            [TIER_PRIMARY, TIER_SECOND],
            new Map([
                [TIER_PRIMARY, state('INTERNAL')],
                [TIER_SECOND, state('TIER 2')],
            ]),
        );

        await updateRollup(ctx);

        expect(contextOnly.value).toBe('');
        expect(contextOnly.getAttribute('aria-invalid')).toBe('true');
        expect(primary.value).toBe('INTERNAL');
        expect(second.value).toBe('TIER 2');
        expect(schemeOnly.value).toBe('TIER 2');
    });

    it('refuses a sink naming a Context the page does not hold', async () => {
        const unknown = sink({ context: 'nato' });
        const reportHostError = vi.fn();
        const ctx = createCtx(
            [CAPCO, CUI],
            new Map([[CAPCO, state('SECRET')]]),
            { reportHostError },
        );

        await updateRollup(ctx);

        expect(unknown.value).toBe('');
        expect(reportHostError.mock.calls[0][0].code).toBe(
            'aggregate-bucket-unknown',
        );
    });

    it('fills a sink once its markup names its bucket', async () => {
        const out = sink();
        const reportHostError = vi.fn();
        const ctx = createCtx(
            [CAPCO, CUI],
            new Map([
                [CAPCO, state('SECRET')],
                [CUI, state('CUI')],
            ]),
            { reportHostError },
        );
        await updateRollup(ctx);
        expect(out.getAttribute('aria-invalid')).toBe('true');

        out.setAttribute('data-ezclassify-context', 'cui');
        await updateRollup(ctx);

        expect(out.value).toBe('CUI');
        expect(out.hasAttribute('aria-invalid')).toBe(false);
        expect(reportHostError).toHaveBeenCalledTimes(1);
    });

    it('announces every bucket of a level, keeping one scheme under two Contexts apart', async () => {
        const capcoA = bucketKey('agency', '');
        const capcoB = bucketKey('program', '');
        const ctx = createCtx(
            [capcoA, capcoB],
            new Map([
                [capcoA, state('SECRET')],
                [capcoB, state('SECRET//NOFORN')],
            ]),
        );
        const events: RollupEventDetail[] = [];
        document.body.addEventListener('ezclassify:rollup', (e) =>
            events.push((e as CustomEvent<RollupEventDetail>).detail),
        );

        await updateRollup(ctx);

        expect(
            events[0].buckets.map(({ context, scheme, rendered }) => ({
                context,
                scheme,
                rendered,
            })),
        ).toEqual([
            { context: 'agency', scheme: null, rendered: 'SECRET' },
            { context: 'program', scheme: null, rendered: 'SECRET//NOFORN' },
        ]);
    });
});

describe('forms/rollup: a whole and its parts read in one bucket', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
    });

    it('checks a whole only against parts read in its bucket, by its own Context', async () => {
        const capcoSection = document.createElement('section');
        capcoSection.setAttribute('data-ezclassify-context', 'capco');
        const cuiSection = document.createElement('section');
        cuiSection.setAttribute('data-ezclassify-context', 'cui');
        document.body.append(capcoSection, cuiSection);

        const whole = document.createElement('input');
        whole.id = 'memo';
        whole.value = 'SECRET';
        capcoSection.appendChild(whole);
        const samePart = document.createElement('input');
        samePart.value = 'CONFIDENTIAL';
        capcoSection.appendChild(samePart);
        const otherPart = document.createElement('input');
        otherPart.value = 'CUI';
        cuiSection.appendChild(otherPart);

        const ctx = createCtx([CAPCO, CUI], new Map(), {
            fields: [whole, samePart, otherPart],
            partOfMap: new Map([
                [samePart, 'memo'],
                [otherPart, 'memo'],
            ]),
        });

        await updateRollup(ctx);

        const capco = ctx.engines.get(CAPCO)!;
        const cui = ctx.engines.get(CUI)!;
        expect(capco.checkCoverage).toHaveBeenCalledWith(
            ['CONFIDENTIAL'],
            'SECRET',
        );
        expect(capco.process).not.toHaveBeenCalledWith(
            'CUI',
            expect.anything(),
        );
        expect(cui.process).not.toHaveBeenCalled();
        expect(cui.checkCoverage).not.toHaveBeenCalled();
    });
});
