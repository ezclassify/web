/**
 * @vitest-environment jsdom
 *
 * A crosswalk handbook shows one crosswalk exactly as the Context describes it:
 * its direction, guidance and citation, and every reviewed decision with the
 * disposition and reason the crosswalk declares. A Context holding one
 * crosswalk needs no id; one holding several needs the id named. The Context
 * is a contract-shaped fixture, not the in-process engine.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
    ContextAdapter,
    ContextCrosswalkDescriptor,
    ContextSchemeDescriptor,
} from '@ezclassify/types';
import { adoptedStyleTexts } from '../styles/adopt';
import { CrosswalkHandbook, selectCrosswalk } from './crosswalk-handbook';

// `?inline` CSS imports are empty under vitest; give the shared sheet its text.
vi.mock('./component-utils.css?inline', () => ({
    default: '.ez-sr-only { position: absolute; }',
}));

const SCHEMES: ContextSchemeDescriptor[] = [
    { selector: 'tier', id: 'tier', version: '2.0.0', roles: ['primary'] },
    {
        selector: 'label',
        id: 'label',
        version: '1.1.0',
        roles: ['crosswalk-target'],
    },
];

function crosswalk(
    overrides: Partial<ContextCrosswalkDescriptor> = {},
): ContextCrosswalkDescriptor {
    return {
        id: 'tier-to-label',
        version: '1.0.0',
        name: 'Tier to label',
        source: 'tier',
        target: 'label',
        guidance: 'Review every proposed label before release.',
        citation: 'https://example.test/crosswalk-memo',
        mappings: [
            {
                id: 'm-high',
                source: { categoryId: 'level', conceptId: 'high' },
                targets: [{ categoryId: 'label', conceptId: 'restricted' }],
                disposition: 'carry',
                reason: 'Same handling.',
                authority: 'Handling memo 7',
            },
            {
                id: 'm-mid',
                source: { categoryId: 'level', conceptId: 'mid' },
                targets: [
                    { categoryId: 'label', conceptId: 'internal' },
                    { categoryId: 'label', conceptId: 'restricted' },
                ],
                disposition: 'review',
                reason: 'Depends on the audience.',
                guidance: 'Ask the data owner.',
            },
            {
                id: 'm-team',
                source: {
                    categoryId: 'group',
                    conceptId: 'team',
                    value: 'blue',
                },
                disposition: 'omit',
                reason: 'The label scheme has no groups.',
                citation: 'javascript:alert(1)',
            },
            {
                id: 'm-secret',
                source: { categoryId: 'level', conceptId: 'secret' },
                disposition: 'forbid',
                reason: 'Never leaves the tier scheme.',
            },
        ],
        selections: [
            {
                id: 's-owner',
                strategy: 'first-match',
                candidates: [
                    {
                        id: 'c-owned',
                        disposition: 'carry',
                        when: {
                            all: [{ categoryId: 'owner', conceptId: 'us' }],
                        },
                        targets: [{ categoryId: 'label', conceptId: 'owned' }],
                        reason: 'Owned by us.',
                    },
                    {
                        id: 'c-fallback',
                        disposition: 'review',
                        reason: 'Owner unknown.',
                    },
                ],
            },
        ],
        ...overrides,
    };
}

function fixtureContext(
    crosswalks: ContextCrosswalkDescriptor[],
    schemes: ContextSchemeDescriptor[] | Error = SCHEMES,
): ContextAdapter {
    return {
        connected: true,
        scheme: {},
        describeSchemes: async () => {
            if (schemes instanceof Error) throw schemes;
            return schemes;
        },
        describeCrosswalks: async () => crosswalks,
        audit: () => {
            throw new Error('not used');
        },
        checkContextAccess: () => {
            throw new Error('not used');
        },
        accessRequirements: () => {
            throw new Error('not used');
        },
        translate: () => {
            throw new Error('not used');
        },
        destroy: () => {},
    } as unknown as ContextAdapter;
}

async function mount(
    context: ContextAdapter,
    options: Record<string, unknown> = {},
): Promise<{ handbook: CrosswalkHandbook; host: HTMLDivElement }> {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const handbook = new CrosswalkHandbook();
    await handbook.init(host, context, { injectStyles: false, ...options });
    return { handbook, host };
}

function text(el: Element | null | undefined): string {
    return (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
}

afterEach(() => {
    document.body.replaceChildren();
});

describe('selectCrosswalk', () => {
    const a = crosswalk({ id: 'a' });
    const b = crosswalk({ id: 'b' });

    it('takes the only crosswalk when none is named', () => {
        expect(selectCrosswalk([a], undefined)).toBe(a);
    });

    it('takes the named crosswalk among several', () => {
        expect(selectCrosswalk([a, b], 'b')).toBe(b);
    });

    it('refuses to guess among several, naming them', () => {
        expect(() => selectCrosswalk([a, b], undefined)).toThrow(
            /several crosswalks \(a, b\); name one with data-ezclassify-crosswalk-handbook-crosswalk-id/,
        );
    });

    it('refuses a name the Context does not hold', () => {
        expect(() => selectCrosswalk([a], 'c')).toThrow(
            /crosswalk "c" is not one the Context holds \(it holds: a\)/,
        );
    });

    it('refuses a Context with no crosswalk', () => {
        expect(() => selectCrosswalk([], undefined)).toThrow(/no crosswalk/);
    });
});

describe('CrosswalkHandbook', () => {
    it('shows the crosswalk, its direction by scheme, guidance and citation', async () => {
        const { host } = await mount(fixtureContext([crosswalk()]));
        const root = host.querySelector('.ez-crosswalk-handbook')!;
        expect(root.getAttribute('role')).toBe('region');
        expect(root.getAttribute('aria-label')).toBe(
            'Crosswalk handbook: Tier to label',
        );
        expect(text(root.querySelector('.ez-crosswalk-handbook__name'))).toBe(
            'Tier to label',
        );
        expect(text(root.querySelector('.ez-crosswalk-handbook__meta'))).toBe(
            'tier-to-label · v1.0.0',
        );
        expect(
            text(root.querySelector('.ez-crosswalk-handbook__direction')),
        ).toBe('Translates tier@2.0.0 to label@1.1.0');
        expect(
            text(root.querySelector('.ez-crosswalk-handbook__summary')),
        ).toBe(
            '4 mappings · 1 carry · 1 review · 1 omit · 1 forbid · 1 cross-field selection',
        );
        const overview = root.querySelector(
            '.ez-crosswalk-handbook__overview',
        )!;
        expect(text(overview)).toContain(
            'Guidance: Review every proposed label before release.',
        );
        const link = overview.querySelector('a')!;
        expect(link.getAttribute('href')).toBe(
            'https://example.test/crosswalk-memo',
        );
        expect(link.rel).toBe('noopener noreferrer');
    });

    it('leads with the overall marking of a marked crosswalk', async () => {
        const { host } = await mount(
            fixtureContext([crosswalk({ marking: '(U) NOTIONAL//TEST' })]),
        );
        const overview = host.querySelector(
            '.ez-crosswalk-handbook__overview',
        )!;
        const marking = overview.querySelector(
            '.ez-crosswalk-handbook__overview-marking',
        )!;
        expect(overview.firstElementChild).toBe(marking);
        expect(marking.textContent).toBe('Overall marking: (U) NOTIONAL//TEST');
        expect(marking.querySelector('.ez-sr-only')!.textContent).toBe(
            'Overall marking: ',
        );
    });

    it('shows no overall marking for a crosswalk that carries none', async () => {
        const { host } = await mount(fixtureContext([crosswalk()]));
        expect(
            host.querySelector('.ez-crosswalk-handbook__overview-marking'),
        ).toBeNull();
        expect(host.textContent).not.toContain('Overall marking');
    });

    it('adopts the styles that keep the marking label off screen', async () => {
        const { handbook } = await mount(fixtureContext([crosswalk()]), {
            injectStyles: true,
        });
        expect(
            adoptedStyleTexts(document).some((css) =>
                css.includes('.ez-sr-only'),
            ),
        ).toBe(true);
        handbook.destroy();
    });

    it('names the direction by selector when the Context cannot list its schemes', async () => {
        const { host } = await mount(
            fixtureContext([crosswalk()], new Error('offline')),
        );
        expect(
            text(host.querySelector('.ez-crosswalk-handbook__direction')),
        ).toBe('Translates tier to label');
    });

    it('lists every mapping with its disposition, targets and reason', async () => {
        const { host } = await mount(fixtureContext([crosswalk()]));
        const mappings = [
            ...host.querySelectorAll<HTMLElement>(
                '.ez-crosswalk-handbook__section > .ez-crosswalk-handbook__list > .ez-crosswalk-handbook__mapping',
            ),
        ];
        expect(mappings.map((m) => m.dataset.mappingId)).toEqual([
            'm-high',
            'm-mid',
            'm-team',
            'm-secret',
        ]);
        expect(mappings.map((m) => m.dataset.disposition)).toEqual([
            'carry',
            'review',
            'omit',
            'forbid',
        ]);
        const [high, mid, team, secret] = mappings.map(text);
        expect(high).toContain('level/high');
        expect(high).toContain('Target: label/restricted');
        expect(high).toContain('Same handling.');
        expect(high).toContain('Authority: Handling memo 7');
        expect(mid).toContain(
            'Candidate targets: label/internal or label/restricted',
        );
        expect(mid).toContain('Guidance: Ask the data owner.');
        expect(team).toContain('group/team=blue');
        expect(team).not.toContain('Target');
        expect(secret).toContain('Never leaves the tier scheme.');
    });

    it('never turns a citation that is not a web address into a link', async () => {
        const { host } = await mount(fixtureContext([crosswalk()]));
        const team = host.querySelector('[data-mapping-id="m-team"]')!;
        expect(team.querySelector('a')).toBeNull();
        expect(text(team)).toContain('Citation: javascript:alert(1)');
    });

    it('lists the cross-field selections with when each candidate applies', async () => {
        const { host } = await mount(fixtureContext([crosswalk()]));
        const selection = host.querySelector<HTMLElement>(
            '[data-selection-id="s-owner"]',
        )!;
        expect(text(selection)).toContain('First match wins');
        const candidates = [
            ...selection.querySelectorAll<HTMLElement>(
                '.ez-crosswalk-handbook__candidate',
            ),
        ];
        expect(candidates.map((c) => c.dataset.disposition)).toEqual([
            'carry',
            'review',
        ]);
        expect(text(candidates[0])).toContain('When all of owner/us');
        expect(text(candidates[0])).toContain('Emits: label/owned');
        expect(text(candidates[1])).toContain('Fallback');
        expect(text(candidates[1])).toContain('Owner unknown.');
        // Selections come before the per-assertion mappings.
        const titles = [
            ...host.querySelectorAll('.ez-crosswalk-handbook__section-title'),
        ].map(text);
        expect(titles).toEqual(['Cross-field selections', 'Mapping decisions']);
    });

    it('shows the crosswalk the host names among several', async () => {
        const context = fixtureContext([
            crosswalk(),
            crosswalk({ id: 'label-to-tier', name: 'Label to tier' }),
        ]);
        const { handbook, host } = await mount(context, {
            'crosswalk-id': 'label-to-tier',
        });
        expect(handbook.crosswalkId).toBe('label-to-tier');
        expect(text(host.querySelector('.ez-crosswalk-handbook__name'))).toBe(
            'Label to tier',
        );
    });

    it('refuses to mount among several crosswalks without a name', async () => {
        const host = document.createElement('div');
        const context = fixtureContext([
            crosswalk(),
            crosswalk({ id: 'label-to-tier' }),
        ]);
        await expect(
            new CrosswalkHandbook().init(host, context),
        ).rejects.toThrow(/several crosswalks/);
        expect(host.childElementCount).toBe(0);
    });

    it('refuses to mount without a Context', async () => {
        await expect(
            new CrosswalkHandbook().init(document.createElement('div'), null),
        ).rejects.toThrow(/needs a Context/);
    });

    it('narrows the decisions to a search and says when none match', async () => {
        const { host } = await mount(fixtureContext([crosswalk()]));
        const search = host.querySelector<HTMLInputElement>(
            '.ez-crosswalk-handbook__search-input',
        )!;
        search.value = 'audience';
        search.dispatchEvent(new Event('input'));
        expect(
            [...host.querySelectorAll<HTMLElement>('[data-mapping-id]')].map(
                (m) => m.dataset.mappingId,
            ),
        ).toEqual(['m-mid']);
        expect(host.querySelector('[data-selection-id]')).toBeNull();

        search.value = 'nothing like this';
        search.dispatchEvent(new Event('input'));
        expect(text(host.querySelector('.ez-crosswalk-handbook__empty'))).toBe(
            'No decisions match “nothing like this”',
        );
    });

    it('removes everything it rendered when destroyed', async () => {
        const { handbook, host } = await mount(fixtureContext([crosswalk()]));
        handbook.destroy();
        expect(host.childElementCount).toBe(0);
    });
});
