/**
 * @vitest-environment jsdom
 *
 * A translated view shows the marking it reads through the Context's
 * crosswalk, exactly as the engine answers: the target marking, what the
 * crosswalk did not carry, and no target at all when the translation is
 * forbidden, the source does not read, or the call fails. The Context is a
 * contract-shaped fixture, not the in-process engine.
 */

import { describe, expect, it, vi } from 'vitest';
import type {
    ContextAdapter,
    ContextOperationResult,
    ContextCrosswalkDescriptor,
    ContextSchemeDescriptor,
    CrosswalkCompletedTranslationResult,
    CrosswalkTranslationInput,
    CrosswalkTranslationResult,
} from '@ezclassify/types';
import { mockAssertion, mockValidateResult } from '../engine-result-mock';
import {
    TranslateHostError,
    TranslatedView,
    resolveCrosswalkId,
} from './translated-view';

const SOURCE = { kind: 'scheme' as const, id: 'tier', version: '1.0.0' };
const TARGET = { kind: 'scheme' as const, id: 'label', version: '1.0.0' };
const CROSSWALK = {
    kind: 'crosswalk' as const,
    id: 'tier-to-label',
    version: '1.0.0',
};

const high = mockAssertion({ categoryId: 'level', conceptId: 'high' });
const team = mockAssertion({ categoryId: 'group', conceptId: 'team' });

type Translate = (
    input: CrosswalkTranslationInput,
) => Promise<ContextOperationResult<CrosswalkTranslationResult>>;

interface FixtureOptions {
    crosswalks?: ContextCrosswalkDescriptor[];
    schemes?: ContextSchemeDescriptor[];
    translate?: Translate;
}

const SCHEMES: ContextSchemeDescriptor[] = [
    { selector: 'tier', id: 'tier', version: '1.0.0', roles: ['primary'] },
    {
        selector: 'label',
        id: 'label',
        version: '1.0.0',
        roles: ['crosswalk-target'],
    },
];

function envelope(
    result: CrosswalkTranslationResult,
): ContextOperationResult<CrosswalkTranslationResult> {
    return {
        resolution: {
            contextId: 'crosswalk-context',
            resolvedVersion: '1.0.0',
            artifacts: [SOURCE, TARGET, CROSSWALK],
            sources: [],
        },
        result,
        operationLimitations: [],
    };
}

/** A translation that carried `high` and omitted `team`. */
function partial(): CrosswalkCompletedTranslationResult {
    return {
        crosswalk: CROSSWALK,
        sourceScheme: SOURCE,
        targetScheme: TARGET,
        source: mockValidateResult({ assertions: [high, team] }),
        outcomes: [
            {
                source: { categoryId: 'level', conceptId: 'high' },
                mappingId: 'm-high',
                disposition: 'carry',
                targets: [{ categoryId: 'label', conceptId: 'restricted' }],
                reason: 'Same handling.',
            },
            {
                source: { categoryId: 'group', conceptId: 'team' },
                mappingId: 'm-team',
                disposition: 'omit',
                targets: [],
                reason: 'The label scheme has no groups.',
            },
        ],
        selections: [],
        target: mockValidateResult({
            assertions: [
                mockAssertion({ categoryId: 'label', conceptId: 'restricted' }),
            ],
            rendered: 'RESTRICTED-LABEL',
        }),
        status: 'partial',
    };
}

/** A crosswalk the fixture Context lists, with no mappings of its own. */
function crosswalk(
    id: string,
    source: string,
    target: string,
): ContextCrosswalkDescriptor {
    return {
        id,
        version: '1.0.0',
        name: id,
        source,
        target,
        mappings: [],
        selections: [],
    };
}

function fixtureContext(options: FixtureOptions = {}): ContextAdapter & {
    translate: ReturnType<typeof vi.fn>;
} {
    const crosswalks = options.crosswalks ?? [
        crosswalk('tier-to-label', 'tier', 'label'),
    ];
    const context = {
        connected: true,
        scheme: {
            getScheme: () => ({
                id: 'tier',
                concepts: [
                    { id: 'high', name: 'High' },
                    { id: 'team', name: 'Team' },
                ],
            }),
        },
        describeSchemes: async () => options.schemes ?? SCHEMES,
        audit: vi.fn(),
        checkContextAccess: vi.fn(),
        accessRequirements: vi.fn(),
        translate: vi.fn(
            options.translate ?? (async () => envelope(partial())),
        ),
        describeCrosswalks: async () => crosswalks,
        destroy: vi.fn(),
    };
    return context as unknown as ContextAdapter & {
        translate: ReturnType<typeof vi.fn>;
    };
}

function host(translate = 'tier-to-label'): HTMLDivElement {
    const el = document.createElement('div');
    el.setAttribute('data-ezclassify-source', 'memo1');
    el.setAttribute('data-ezclassify-translate', translate);
    document.body.appendChild(el);
    return el;
}

async function mounted(
    context: ContextAdapter,
    el = host(),
): Promise<{ view: TranslatedView; el: HTMLDivElement }> {
    const view = new TranslatedView();
    await view.init(el, context, { injectStyles: false });
    return { view, el };
}

async function settle(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 0));
}

function shown(el: HTMLElement) {
    const wrap = el.querySelector<HTMLElement>('.ez-translated-view')!;
    return {
        status: wrap.dataset.status,
        marking:
            el.querySelector('.ez-translated-view__marking')?.textContent ?? '',
        note: el.querySelector(
            '.ez-translated-view__note:not(.ez-translated-view__incomplete)',
        )?.textContent,
        items: [...el.querySelectorAll('.ez-translated-view__list li')].map(
            (li) => ({
                disposition: (li as HTMLElement).dataset.disposition,
                text: li.textContent,
            }),
        ),
    };
}

describe('TranslatedView', () => {
    it('hands the assertions it reads to the named crosswalk', async () => {
        const context = fixtureContext();
        const { view } = await mounted(context);

        view.setAssertions([high, team]);
        await settle();

        expect(context.translate).toHaveBeenCalledWith({
            crosswalkId: 'tier-to-label',
            marking: [high, team],
        });
    });

    it('shows the target marking and what the crosswalk did not carry', async () => {
        const { view, el } = await mounted(fixtureContext());

        view.setAssertions([high, team]);
        await settle();

        expect(shown(el)).toEqual({
            status: 'partial',
            marking: 'RESTRICTED-LABEL',
            note: '',
            items: [
                {
                    disposition: 'omit',
                    text: 'Team omitted: The label scheme has no groups.',
                },
            ],
        });
        expect(view.getRendered()).toBe('RESTRICTED-LABEL');
    });

    describe('a candidate that lost a selection', () => {
        function withLoser(): CrosswalkCompletedTranslationResult {
            const result = partial();
            result.outcomes.push({
                source: { categoryId: 'level', conceptId: 'high' },
                mappingId: 'pick-one:other',
                disposition: 'not-selected',
                targets: [],
                reason: 'Not emitted because pick-one selected a different candidate.',
            });
            return result;
        }

        function list(el: HTMLElement, selector: string): string[] {
            return [...el.querySelectorAll(`${selector} li`)].map(
                (li) => li.textContent ?? '',
            );
        }

        it('is listed apart from the facts the crosswalk omits', async () => {
            const { view, el } = await mounted(
                fixtureContext({
                    translate: async () => envelope(withLoser()),
                }),
            );

            view.setAssertions([high, team]);
            await settle();

            expect(
                list(
                    el,
                    '.ez-translated-view__list:not(.ez-translated-view__not-selected)',
                ),
            ).toEqual(['Team omitted: The label scheme has no groups.']);
            expect(list(el, '.ez-translated-view__not-selected')).toEqual([
                'High not selected: Not emitted because pick-one selected a different candidate.',
            ]);
            expect(
                el
                    .querySelector('.ez-translated-view__not-selected li')!
                    .getAttribute('data-disposition'),
            ).toBe('not-selected');
            expect(
                el
                    .querySelector('.ez-translated-view__not-selected')!
                    .getAttribute('aria-label'),
            ).toBe('Not selected');
        });

        it('is gone once the view reads something else', async () => {
            const translate = vi
                .fn<Translate>()
                .mockResolvedValueOnce(envelope(withLoser()))
                .mockResolvedValueOnce(envelope(partial()));
            const { view, el } = await mounted(fixtureContext({ translate }));

            view.setAssertions([high, team]);
            await settle();
            view.setAssertions([team]);
            await settle();

            expect(list(el, '.ez-translated-view__not-selected')).toEqual([]);
        });

        it('is gone when the next read fails', async () => {
            const translate = vi
                .fn<Translate>()
                .mockResolvedValueOnce(envelope(withLoser()))
                .mockRejectedValueOnce(new Error('crosswalk unavailable'));
            const { view, el } = await mounted(fixtureContext({ translate }));

            view.setAssertions([high, team]);
            await settle();
            view.setAssertions([team]);
            await settle();

            expect(list(el, '.ez-translated-view__not-selected')).toEqual([]);
        });
    });

    it('names what was not carried through the scheme the view selects', async () => {
        // The view reads the Context's second scheme; the primary is the target.
        const context = fixtureContext();
        const tier = context.scheme.getScheme();
        Object.assign(context, {
            scheme: { getScheme: () => ({ id: 'label', concepts: [] }) },
            schemes: {
                get: (selector: string) => {
                    if (selector !== 'tier')
                        throw new Error(`no scheme ${selector}`);
                    return { getScheme: () => tier };
                },
            },
        });
        const view = new TranslatedView();
        const el = host();
        await view.init(el, context, {
            injectStyles: false,
            schemeSelector: 'tier',
        });

        view.setAssertions([high, team]);
        await settle();

        expect(shown(el).items).toEqual([
            {
                disposition: 'omit',
                text: 'Team omitted: The label scheme has no groups.',
            },
        ]);
    });

    it('shows no target marking when the crosswalk forbids the translation', async () => {
        const forbidden: CrosswalkTranslationResult = {
            crosswalk: CROSSWALK,
            sourceScheme: SOURCE,
            targetScheme: TARGET,
            source: mockValidateResult({ assertions: [high] }),
            outcomes: [],
            selections: [],
            forbiddenBy: [
                {
                    kind: 'mapping',
                    mappingId: 'm-high',
                    source: { categoryId: 'level', conceptId: 'high' },
                    reason: 'Never leaves the tier scheme.',
                },
            ],
            status: 'forbidden',
        };
        const { view, el } = await mounted(
            fixtureContext({ translate: async () => envelope(forbidden) }),
        );

        view.setAssertions([high]);
        await settle();

        const view$ = shown(el);
        expect(view$.status).toBe('forbidden');
        expect(view$.marking).toBe('');
        expect(view$.items).toEqual([
            {
                disposition: 'forbid',
                text: 'High forbidden: Never leaves the tier scheme.',
            },
        ]);
        expect(view.getRendered()).toBe('');
    });

    it('shows no target marking when the source does not read', async () => {
        const invalid: CrosswalkCompletedTranslationResult = {
            ...partial(),
            source: mockValidateResult({
                valid: false,
                errors: [
                    {
                        constraintId: 'needs-level',
                        message: 'A level is required.',
                    },
                ],
            }),
            status: 'invalid-source',
        };
        const { view, el } = await mounted(
            fixtureContext({ translate: async () => envelope(invalid) }),
        );

        view.setAssertions([team]);
        await settle();

        expect(shown(el).status).toBe('invalid-source');
        expect(shown(el).marking).toBe('');
        expect(shown(el).items.map((i) => i.text)).toEqual([
            'A level is required.',
        ]);
        expect(view.getRendered()).toBe('');
    });

    it('flags a target the engine says does not stand', async () => {
        const result = partial();
        result.target = mockValidateResult({
            valid: false,
            rendered: 'RESTRICTED-LABEL',
            errors: [
                {
                    constraintId: 'label-needs-owner',
                    message: 'An owner is required.',
                },
            ],
        });
        const { view, el } = await mounted(
            fixtureContext({ translate: async () => envelope(result) }),
        );

        view.setAssertions([high, team]);
        await settle();

        expect(
            el
                .querySelector('.ez-translated-view__marking')
                ?.getAttribute('aria-invalid'),
        ).toBe('true');
        expect(shown(el).items.map((i) => i.text)).toContain(
            'An owner is required.',
        );
    });

    it('shows no target marking when the call fails', async () => {
        const { view, el } = await mounted(
            fixtureContext({
                translate: async () => {
                    throw new Error('crosswalk unavailable');
                },
            }),
        );

        view.setAssertions([high]);
        await settle();

        expect(shown(el).status).toBe('error');
        expect(shown(el).marking).toBe('');
        expect(shown(el).note).toContain('crosswalk unavailable');
    });

    it('shows the empty value without calling the engine for no facts', async () => {
        const context = fixtureContext();
        const { view, el } = await mounted(context);

        view.setAssertions([]);
        await settle();

        expect(context.translate).not.toHaveBeenCalled();
        expect(shown(el).status).toBe('empty');
        expect(shown(el).marking).toBe('(empty)');
    });

    it('keeps the latest read when an earlier translation answers late', async () => {
        let releaseFirst!: () => void;
        const late = new Promise<void>((resolve) => (releaseFirst = resolve));
        const first = partial();
        const second = partial();
        second.target = mockValidateResult({ rendered: 'SECOND' });
        second.outcomes = [];
        second.status = 'complete';
        const translate = vi
            .fn()
            .mockImplementationOnce(async () => {
                await late;
                return envelope(first);
            })
            .mockImplementationOnce(async () => envelope(second));
        const { view, el } = await mounted(fixtureContext({ translate }));

        view.setAssertions([high, team]);
        view.setAssertions([high]);
        await settle();
        releaseFirst();
        await settle();

        expect(shown(el).marking).toBe('SECOND');
        expect(shown(el).status).toBe('complete');
    });

    it('says when the value it reads may be incomplete', async () => {
        const { view, el } = await mounted(fixtureContext());

        view.setIncomplete(true);

        expect(el.hasAttribute('data-ezclassify-incomplete')).toBe(true);
        expect(
            el.querySelector('.ez-translated-view__incomplete')?.textContent,
        ).not.toBe('');
    });

    it('refuses a host with a controller', async () => {
        const el = host();
        el.setAttribute('data-ezclassify-controller', 'banner');

        await expect(
            new TranslatedView().init(el, fixtureContext()),
        ).rejects.toBeInstanceOf(TranslateHostError);
    });

    it('refuses a form-control host', async () => {
        const el = document.createElement('input') as unknown as HTMLDivElement;
        el.setAttribute('data-ezclassify-translate', 'tier-to-label');

        await expect(
            new TranslatedView().init(el, fixtureContext()),
        ).rejects.toBeInstanceOf(TranslateHostError);
    });
});

describe('resolveCrosswalkId', () => {
    it('takes the named crosswalk as given', async () => {
        await expect(
            resolveCrosswalkId(fixtureContext({ crosswalks: [] }), 'named'),
        ).resolves.toBe('named');
    });

    it('takes the one crosswalk from the primary scheme when bare', async () => {
        const context = fixtureContext({
            crosswalks: [
                crosswalk('label-to-tier', 'label', 'tier'),
                crosswalk('tier-to-label', 'tier', 'label'),
            ],
        });
        await expect(resolveCrosswalkId(context, '')).resolves.toBe(
            'tier-to-label',
        );
    });

    it('reads from the view scheme selector when the view sets one', async () => {
        const context = fixtureContext({
            crosswalks: [
                crosswalk('label-to-tier', 'label', 'tier'),
                crosswalk('tier-to-label', 'tier', 'label'),
            ],
        });
        await expect(resolveCrosswalkId(context, '', 'label')).resolves.toBe(
            'label-to-tier',
        );
    });

    it('refuses a bare view when no crosswalk leaves the scheme', async () => {
        await expect(
            resolveCrosswalkId(fixtureContext({ crosswalks: [] }), ''),
        ).rejects.toThrow(/no crosswalk from scheme "tier"/);
    });

    it('refuses a bare view when several crosswalks leave the scheme', async () => {
        const context = fixtureContext({
            crosswalks: [
                crosswalk('a', 'tier', 'label'),
                crosswalk('b', 'tier', 'other'),
            ],
        });
        await expect(resolveCrosswalkId(context, '')).rejects.toThrow(
            /several crosswalks .*\(a, b\)/,
        );
    });

    it('mounts a bare view through the one crosswalk', async () => {
        const context = fixtureContext();
        const { view } = await mounted(context, host(''));

        view.setAssertions([high]);
        await settle();

        expect(context.translate).toHaveBeenCalledWith({
            crosswalkId: 'tier-to-label',
            marking: [high],
        });
    });
});
