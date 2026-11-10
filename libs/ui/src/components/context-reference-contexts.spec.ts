/**
 * The reference drawer shows the reference material of every Context the page
 * loaded: per Context its handbook, guidebook, access handbook and crosswalk
 * handbook, as that Context's composition holds them, grouped and labeled by
 * Context when there are several. Mounted through EzClassifyUI it is handed
 * every Context the instance holds, without a `data-ezclassify-context`.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import yaml from 'js-yaml';
import { Context } from '@ezclassify/engine';
import type {
    ContextAdapter,
    ContextCrosswalkDescriptor,
} from '@ezclassify/types';
import {
    cedarValleyAccessYaml,
    cedarValleyGuideYaml,
    cedarValleySchemeYaml,
} from '@ezclassify/example-schemes/cedar-valley';
import { ContextReference } from './context-reference';
import { EzClassifyUI } from '../ezclassify-ui';
import { openContext } from '../../test-fixtures/context-doubles';

if (typeof window !== 'undefined' && !window.matchMedia) {
    Object.defineProperty(window, 'matchMedia', {
        writable: true,
        value: () => ({
            matches: false,
            addListener: () => {},
            removeListener: () => {},
        }),
    });
}

function schemeDoc(name?: string): unknown {
    const doc = yaml.load(cedarValleySchemeYaml) as {
        scheme: { name: string };
    };
    if (name) doc.scheme.name = name;
    return doc;
}

function crosswalk(id: string, name: string): ContextCrosswalkDescriptor {
    return {
        id,
        version: '1.0.0',
        name,
        source: 'cedar-valley',
        target: 'county',
        mappings: [
            {
                id: `${id}-m1`,
                source: { categoryId: 'level', conceptId: 'open' },
                targets: [{ categoryId: 'tier', conceptId: 'public' }],
                disposition: 'carry',
                reason: 'Same audience.',
            },
        ],
        selections: [],
    };
}

/**
 * A Context over the cedar-valley composition whose crosswalk list a spec sets:
 * the engine's own Context answers for everything else.
 */
function contextWith(options: {
    schemeName?: string;
    guide?: boolean;
    access?: boolean;
    crosswalks?:
        | ContextCrosswalkDescriptor[]
        | Promise<ContextCrosswalkDescriptor[]>
        | Error;
}): ContextAdapter {
    const context = openContext(
        Context.fromComponents({
            scheme: schemeDoc(options.schemeName),
            ...(options.guide
                ? { guides: [yaml.load(cedarValleyGuideYaml)] }
                : {}),
            ...(options.access
                ? { access: yaml.load(cedarValleyAccessYaml) }
                : {}),
        }) as unknown as ContextAdapter,
    );
    const crosswalks = options.crosswalks ?? [];
    context.describeCrosswalks = () => {
        if (crosswalks instanceof Error) throw crosswalks;
        return crosswalks as ContextCrosswalkDescriptor[];
    };
    return context;
}

function tabIds(host: HTMLElement): string[] {
    return [...host.querySelectorAll<HTMLElement>('[role="tab"]')].map(
        (t) => t.dataset.tabId ?? '',
    );
}

function tab(host: HTMLElement, id: string): HTMLElement {
    return host.querySelector<HTMLElement>(
        `[role="tab"][data-tab-id="${id}"]`,
    )!;
}

function panelOf(host: HTMLElement, id: string): HTMLElement {
    const controls = tab(host, id).getAttribute('aria-controls')!;
    return host.ownerDocument.getElementById(controls)!;
}

/** Let the composed reference components finish their async mounts. */
async function settle(): Promise<void> {
    for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
}

describe('ContextReference crosswalk handbook tab', () => {
    let host: HTMLDivElement;
    let drawer: ContextReference;

    beforeEach(() => {
        document.body.innerHTML = '';
        host = document.createElement('div');
        document.body.appendChild(host);
        drawer = new ContextReference();
    });

    afterEach(() => drawer.destroy());

    it('adds a crosswalk tab for a Context that holds a crosswalk', async () => {
        await drawer.init(
            host,
            contextWith({
                crosswalks: [crosswalk('cv-to-county', 'To county')],
            }),
        );
        await settle();
        expect(tabIds(host)).toEqual(['handbook', 'crosswalk']);
        expect(tab(host, 'crosswalk').textContent).toBe('Crosswalk');
        const panel = panelOf(host, 'crosswalk');
        expect(
            panel
                .querySelector('.ez-crosswalk-handbook')
                ?.getAttribute('data-crosswalk-id'),
        ).toBe('cv-to-county');
    });

    it('shows each of several crosswalks in one tab', async () => {
        await drawer.init(
            host,
            contextWith({
                crosswalks: [
                    crosswalk('cv-to-county', 'To county'),
                    crosswalk('county-to-cv', 'From county'),
                ],
            }),
        );
        await settle();
        expect(tab(host, 'crosswalk').textContent).toBe('Crosswalks');
        const shown = [
            ...panelOf(host, 'crosswalk').querySelectorAll<HTMLElement>(
                '.ez-crosswalk-handbook',
            ),
        ].map((h) => h.dataset.crosswalkId);
        expect(shown).toEqual(['cv-to-county', 'county-to-cv']);
    });

    it('adds the tab when a remote Context answers later', async () => {
        let answer!: (c: ContextCrosswalkDescriptor[]) => void;
        const context = contextWith({});
        context.describeCrosswalks = () =>
            new Promise<ContextCrosswalkDescriptor[]>((r) => (answer = r));
        await drawer.init(host, context);
        expect(tabIds(host)).toEqual(['handbook']);
        answer([crosswalk('cv-to-county', 'To county')]);
        await settle();
        expect(tabIds(host)).toEqual(['handbook', 'crosswalk']);
    });

    it('shows no crosswalk tab for a Context that holds none', async () => {
        await drawer.init(host, contextWith({ guide: true, access: true }));
        expect(tabIds(host)).toEqual(['handbook', 'guidebook', 'access']);
    });

    it('shows no crosswalk tab, and says why, when a Context cannot list them', async () => {
        const error = vi.spyOn(console, 'error').mockImplementation(() => {});
        await drawer.init(
            host,
            contextWith({ crosswalks: new Error('route unavailable') }),
        );
        expect(tabIds(host)).toEqual(['handbook']);
        expect(error).toHaveBeenCalledWith(
            '[ContextReference] the Context could not list its crosswalks:',
            expect.any(Error),
        );
        error.mockRestore();
    });
});

describe('ContextReference with several Contexts', () => {
    let host: HTMLDivElement;
    let drawer: ContextReference;

    beforeEach(() => {
        document.body.innerHTML = '';
        host = document.createElement('div');
        document.body.appendChild(host);
        drawer = new ContextReference();
    });

    afterEach(() => drawer.destroy());

    function twoContexts() {
        return {
            contexts: {
                records: contextWith({
                    schemeName: 'Records Scheme',
                    guide: true,
                    access: true,
                }),
                county: contextWith({
                    schemeName: 'County Scheme',
                    crosswalks: [crosswalk('cv-to-county', 'To county')],
                }),
            },
        };
    }

    it("groups each Context's tabs in host order, labeled and prefixed by its key", async () => {
        await drawer.init(host, twoContexts());
        await settle();
        expect(tabIds(host)).toEqual([
            'records-handbook',
            'records-guidebook',
            'records-access',
            'county-handbook',
            'county-crosswalk',
        ]);
        const tabs = [...host.querySelectorAll<HTMLElement>('[role="tab"]')];
        expect(tabs.map((t) => t.dataset.contextKey)).toEqual([
            'records',
            'records',
            'records',
            'county',
            'county',
        ]);
        expect(
            tab(host, 'county-handbook').querySelector(
                '.ez-context-ref__tab-context',
            )?.textContent,
        ).toBe('county');
        // The accessible name says which Context the tab belongs to.
        expect(tab(host, 'county-handbook').getAttribute('aria-label')).toBe(
            'county: Handbook',
        );
        // Only the first tab of a later Context opens a new group.
        expect(
            tabs.map((t) =>
                t.classList.contains('ez-context-ref__tab--context-start'),
            ),
        ).toEqual([false, false, false, true, false]);
    });

    it("mounts each tab's handbook with its own Context", async () => {
        await drawer.init(host, twoContexts());
        await settle();
        const name = (id: string) =>
            panelOf(host, id).querySelector('.ez-handbook__overview-name')
                ?.textContent;
        expect(name('records-handbook')).toBe('Records Scheme');
        expect(name('county-handbook')).toBe('County Scheme');
        expect(
            panelOf(host, 'county-crosswalk').querySelector(
                '.ez-crosswalk-handbook',
            ),
        ).not.toBeNull();
    });

    it('keeps the host custom tabs after the Context groups', async () => {
        const custom = document.createElement('div');
        custom.setAttribute('data-ezclassify-tab', '');
        custom.setAttribute('data-ezclassify-tab-id', 'developers');
        custom.setAttribute('data-ezclassify-tab-label', 'Developers');
        host.appendChild(custom);
        await drawer.init(host, twoContexts());
        expect(tabIds(host).at(-1)).toBe('developers');
        expect(tab(host, 'developers').dataset.contextKey).toBeUndefined();
        expect(tab(host, 'developers').hasAttribute('aria-label')).toBe(false);
    });

    it('orders and suppresses tabs by their prefixed ids', async () => {
        await drawer.init(host, twoContexts(), {
            tabs: ['county-crosswalk', 'records-handbook'],
        } as never);
        await settle();
        expect(tabIds(host)).toEqual(['county-crosswalk', 'records-handbook']);
    });

    it("refuses a custom tab that claims a Context's built-in id", async () => {
        const custom = document.createElement('div');
        custom.setAttribute('data-ezclassify-tab', '');
        custom.setAttribute('data-ezclassify-tab-id', 'county-crosswalk');
        host.appendChild(custom);
        await expect(drawer.init(host, twoContexts())).rejects.toThrow(
            /custom tab id "county-crosswalk" is reserved/,
        );
    });

    it('gives Context keys a DOM id cannot carry distinct tab and panel ids', async () => {
        await drawer.init(host, {
            contexts: {
                'field office': contextWith({}),
                'field_office': contextWith({}),
            },
        });
        const ids = [...host.querySelectorAll('[role="tab"]')].map((t) => t.id);
        expect(ids).toEqual([
            'ez-context-ref-tab-field_office-handbook',
            'ez-context-ref-tab-field_office-handbook-2',
        ]);
        for (const id of ['field office-handbook', 'field_office-handbook']) {
            expect(panelOf(host, id).getAttribute('aria-labelledby')).toBe(
                tab(host, id).id,
            );
        }
    });
});

describe('ContextReference through EzClassifyUI', () => {
    let root: HTMLDivElement;
    let forms: EzClassifyUI | null = null;

    beforeEach(() => {
        document.body.innerHTML = '';
        root = document.createElement('div');
        document.body.appendChild(root);
    });

    afterEach(() => {
        forms?.destroy();
        forms = null;
    });

    function ready(): Promise<void> {
        return new Promise((resolve) =>
            root.addEventListener('ezclassify:ready', () => resolve(), {
                once: true,
            }),
        );
    }

    it('shows every Context the instance holds, with no data-ezclassify-context', async () => {
        const errors: unknown[] = [];
        root.addEventListener('ezclassify:host-error', (e) =>
            errors.push((e as CustomEvent).detail),
        );
        const reference = document.createElement('div');
        reference.setAttribute(
            'data-ezclassify-controller',
            'context-reference',
        );
        root.appendChild(reference);

        const done = ready();
        forms = new EzClassifyUI(
            {
                contexts: {
                    records: contextWith({ guide: true }),
                    county: contextWith({
                        crosswalks: [crosswalk('cv-to-county', 'To county')],
                    }),
                },
            },
            { root },
        );
        await done;

        expect(errors).toEqual([]);
        expect(tabIds(reference)).toEqual([
            'records-handbook',
            'records-guidebook',
            'county-handbook',
            'county-crosswalk',
        ]);
    });

    it('mounts a crosswalk handbook declared in a Context section', async () => {
        const section = document.createElement('section');
        section.setAttribute('data-ezclassify-context', 'county');
        const handbook = document.createElement('div');
        handbook.setAttribute(
            'data-ezclassify-controller',
            'crosswalk-handbook',
        );
        handbook.setAttribute(
            'data-ezclassify-crosswalk-handbook-crosswalk-id',
            'county-to-cv',
        );
        section.appendChild(handbook);
        root.appendChild(section);

        const done = ready();
        forms = new EzClassifyUI(
            {
                contexts: {
                    records: contextWith({}),
                    county: contextWith({
                        crosswalks: [
                            crosswalk('cv-to-county', 'To county'),
                            crosswalk('county-to-cv', 'From county'),
                        ],
                    }),
                },
            },
            { root },
        );
        await done;
        await settle();

        const shown = section.querySelector<HTMLElement>(
            '.ez-crosswalk-handbook',
        );
        expect(shown?.dataset.crosswalkId).toBe('county-to-cv');
        expect(
            shown?.querySelector('.ez-crosswalk-handbook__name')?.textContent,
        ).toBe('From county');
    });
});

/** A one-category scheme for the engine-backed crosswalk Context below. */
function tinyScheme(id: string, category: string, concepts: string[]) {
    return {
        scheme: {
            id,
            version: '1.0.0',
            name: `${id} scheme`,
            data: {
                categories: [
                    {
                        id: category,
                        label: category,
                        required: true,
                        single: true,
                        rollup: 'max',
                    },
                ],
                concepts: {
                    inline: concepts.map((concept, rank) => ({
                        id: concept,
                        name: concept,
                        views: { default: concept },
                        categories: [category],
                        rank,
                    })),
                },
            },
            rules: [],
            parse: {
                case_sensitive: false,
                strip_whitespace: true,
                normalize: [],
            },
            render: {
                default: 'default',
                formats: [
                    {
                        id: 'default',
                        mode: 'inline',
                        surface: 'default',
                        view: 'default',
                        separator: ' ',
                        fields: [{ category, separator: ' ' }],
                    },
                ],
            },
        },
    };
}

/** The engine's own Context over two schemes and the crosswalk between them. */
function engineCrosswalkContext(): ContextAdapter {
    return Context.fromComponents({
        schemes: [
            {
                key: 'tier',
                scheme: tinyScheme('tier', 'level', ['LOW', 'HIGH']),
            },
            {
                key: 'label',
                scheme: tinyScheme('label', 'tag', ['PUBLIC', 'LIMITED']),
            },
        ],
        primaryScheme: 'tier',
        crosswalks: [
            {
                crosswalk: {
                    id: 'tier-to-label',
                    version: '1.0.0',
                    name: 'Tier to label',
                    guidance: 'Route review outcomes to the owner.',
                    sourceScheme: { id: 'tier', version: '1.0.0' },
                    targetScheme: { id: 'label', version: '1.0.0' },
                    mappings: [
                        {
                            id: 'low-public',
                            source: { categoryId: 'level', conceptId: 'LOW' },
                            targets: [
                                { categoryId: 'tag', conceptId: 'PUBLIC' },
                            ],
                            disposition: 'carry',
                            reason: 'Low tier is releasable.',
                        },
                        {
                            id: 'high-limited',
                            source: { categoryId: 'level', conceptId: 'HIGH' },
                            targets: [
                                { categoryId: 'tag', conceptId: 'LIMITED' },
                            ],
                            disposition: 'review',
                            reason: 'The owner decides the audience.',
                        },
                    ],
                },
            },
        ],
    }) as unknown as ContextAdapter;
}

describe('ContextReference over the engine Context of a crosswalk', () => {
    let host: HTMLDivElement;
    let drawer: ContextReference;

    beforeEach(() => {
        document.body.innerHTML = '';
        host = document.createElement('div');
        document.body.appendChild(host);
        drawer = new ContextReference();
    });

    afterEach(() => drawer.destroy());

    it('shows the crosswalk the engine describes, in declared order', async () => {
        await drawer.init(host, engineCrosswalkContext());
        await settle();
        expect(tabIds(host)).toEqual(['handbook', 'crosswalk']);
        const handbook = panelOf(host, 'crosswalk').querySelector<HTMLElement>(
            '.ez-crosswalk-handbook',
        )!;
        expect(handbook.dataset.crosswalkId).toBe('tier-to-label');
        expect(
            handbook.querySelector('.ez-crosswalk-handbook__direction')
                ?.textContent,
        ).toBe('Translates tier@1.0.0 to label@1.0.0');
        expect(
            [
                ...handbook.querySelectorAll<HTMLElement>('[data-mapping-id]'),
            ].map((m) => `${m.dataset.mappingId}:${m.dataset.disposition}`),
        ).toEqual(['low-public:carry', 'high-limited:review']);
        expect(
            panelOf(host, 'handbook').querySelector(
                '.ez-handbook__overview-name',
            )?.textContent,
        ).toBe('tier scheme');
    });
});
