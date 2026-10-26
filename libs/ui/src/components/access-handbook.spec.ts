import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AccessHandbook } from './access-handbook';
import type {
    AccessEngineAdapter,
    AccessRuleDescription,
} from '@ezclassify/types';
import { Context } from '@ezclassify/engine';
import type { LocalSchemeEngineAdapter } from '@ezclassify/types';
import {
    loadCedarValleyLevels,
    loadCedarValleyLevelsAccess,
} from '@ezclassify/example-schemes/cedar-valley-protection';

function makeRule(
    overrides: Partial<AccessRuleDescription> = {},
): AccessRuleDescription {
    return {
        access: {
            id: 'access-test',
            kind: 'access',
            version: '1.0.0',
        },
        scheme: { id: 'test', kind: 'scheme', version: '1.0.0' },
        rule: {
            artifact: {
                id: 'access-test',
                kind: 'access',
                version: '1.0.0',
            },
            ruleDigest: 'sha256:r1',
            ruleId: 'r1',
        },
        name: 'Rule One',
        requirementText: 'User must have clearance.',
        attributesNeeded: ['clearance'],
        dependsOn: [],
        overrides: [],
        lines: [],
        ...overrides,
    };
}

function makeEngine(): LocalSchemeEngineAdapter {
    return Context.fromComponents({
        scheme: {
            scheme: {
                id: 'test-access',
                version: '1.0.0',
                name: 'Test',
                description: '',
                data: {
                    categories: [
                        {
                            id: 'level',
                            label: 'Level',
                            required: false,
                            single: true,
                            rollup: 'max',
                            position: 0,
                            hierarchy_root: true,
                        },
                    ],
                    concepts: {
                        inline: [
                            {
                                id: 'l1',
                                name: 'L1',
                                views: { default: 'L1' },
                                aliases: [],
                                categories: ['level'],
                                parents: [],
                                position: 1,
                                rank: 0,
                            },
                        ],
                    },
                },
                rules: [],
                rollup_pipelines: [],
                parse: {
                    case_sensitive: false,
                    strip_whitespace: true,
                },
                render: {
                    default: 'default',
                    formats: [
                        {
                            id: 'default',
                            surface: 'marking',
                            mode: 'inline',
                            separator: '//',
                            fields: [{ category: 'level', separator: '//' }],
                        },
                    ],
                },
            },
        },
    }).scheme as LocalSchemeEngineAdapter;
}

function makeAccessEngine(rules: AccessRuleDescription[]): AccessEngineAdapter {
    return {
        schemeId: 'test',
        describeAllAccessRules: vi.fn(() => rules),
        describeApplicableRules: vi.fn(() => ({
            rules: [],
            combinedRequirementText: '',
            combinedAttributesNeeded: [],
            lines: [],
        })),
        check: vi.fn(() => ({ granted: true, rules: [] })),
    } as unknown as AccessEngineAdapter;
}

/**
 * Build a Context backed by a real scheme engine and a mock access engine.
 * Context's constructor is private; we force-assign `access` on the instance
 * (safe at runtime, TypeScript readonly is compile-time only).
 */
function makeContext(rules: AccessRuleDescription[]): Context {
    const engine = makeEngine();
    const ctx = Context.fromSchemeEngine(engine);
    (ctx as unknown as { access: AccessEngineAdapter }).access =
        makeAccessEngine(rules);
    return ctx;
}

describe('AccessHandbook', () => {
    let container: HTMLDivElement;
    let component: AccessHandbook;

    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
        component = new AccessHandbook();
    });

    it('renders an empty-state message when no access engine is bound', async () => {
        const ctx = Context.fromSchemeEngine(makeEngine());
        await component.init(container, ctx);
        const empty = container.querySelector('.ez-access-handbook__empty');
        expect(empty).not.toBeNull();
    });

    it('renders group headers for always and conditional rules', async () => {
        const rules = [
            makeRule({
                name: 'Always rule',
                whenText: undefined,
            }),
            makeRule({
                name: 'Conditional rule',
                rule: {
                    artifact: {
                        id: 'access-test',
                        kind: 'access',
                        version: '1.0.0',
                    },
                    ruleDigest: 'sha256:r2',
                    ruleId: 'r2',
                },
                whenText: 'When TOP SECRET',
            }),
        ];
        const ctx = makeContext(rules);
        await component.init(container, ctx);

        const headers = container.querySelectorAll<HTMLButtonElement>(
            '.ez-access-handbook__group-header',
        );
        expect(headers.length).toBe(2);
    });

    it('filters colliding rule IDs by qualified artifact identity', async () => {
        const baseRule = makeRule({ name: 'Base access rule' });
        const layerRule = makeRule({
            access: {
                id: 'layer-access',
                kind: 'access',
                version: '1.0.0',
            },
            name: 'Layer access rule',
            rule: {
                artifact: {
                    id: 'layer-access',
                    kind: 'access',
                    version: '1.0.0',
                },
                ruleDigest: 'sha256:layer-r1',
                ruleId: 'r1',
            },
        });
        await component.init(container, makeContext([baseRule, layerRule]), {
            expandAll: true,
        });

        const searchInput = container.querySelector<HTMLInputElement>(
            '.ez-access-handbook__search-input',
        )!;
        searchInput.value = 'layer access';
        searchInput.dispatchEvent(new Event('input', { bubbles: true }));

        const visibleEntries = Array.from(
            container.querySelectorAll<HTMLElement>(
                '.ez-access-handbook__entry:not(.ez-access-handbook__entry--hidden)',
            ),
        );
        expect(visibleEntries).toHaveLength(1);
        expect(visibleEntries[0]?.textContent).toContain('Layer access rule');
    });

    it('rule entries are not tab stops (no tabIndex=0)', async () => {
        const ctx = makeContext([makeRule()]);
        await component.init(container, ctx);

        const entries = container.querySelectorAll<HTMLElement>(
            '.ez-access-handbook__entry',
        );
        expect(entries.length).toBeGreaterThan(0);
        for (const entry of entries) {
            // entries are non-interactive displays, they must not be keyboard tab stops
            expect(entry.tabIndex).not.toBe(0);
        }
    });

    it('toggling a group updates aria-expanded in place (no DOM rebuild)', async () => {
        const ctx = makeContext([makeRule()]);
        await component.init(container, ctx);

        const header = container.querySelector<HTMLButtonElement>(
            '.ez-access-handbook__group-header',
        );
        expect(header).not.toBeNull();
        expect(header!.getAttribute('aria-expanded')).toBe('false');

        // Keep a reference to the element, after an in-place toggle it must be the same node
        const headerRef = header!;
        headerRef.click();

        // aria-expanded updated
        expect(headerRef.getAttribute('aria-expanded')).toBe('true');

        // collapsed class removed from body
        const body = container.querySelector('.ez-access-handbook__group-body');
        expect(
            body?.classList.contains(
                'ez-access-handbook__group-body--collapsed',
            ),
        ).toBe(false);

        // The SAME header element is still in the DOM (not replaced by a full rebuild)
        const headerAfter = container.querySelector<HTMLButtonElement>(
            '.ez-access-handbook__group-header',
        );
        expect(headerAfter).toBe(headerRef);
    });

    it('toggle back collapses the group again', async () => {
        const ctx = makeContext([makeRule()]);
        await component.init(container, ctx);

        const header = container.querySelector<HTMLButtonElement>(
            '.ez-access-handbook__group-header',
        )!;
        header.click(); // expand
        header.click(); // collapse again

        expect(header.getAttribute('aria-expanded')).toBe('false');
        const body = container.querySelector('.ez-access-handbook__group-body');
        expect(
            body?.classList.contains(
                'ez-access-handbook__group-body--collapsed',
            ),
        ).toBe(true);
    });

    describe('against an access policy that answers asynchronously', () => {
        /**
         * Bind a context whose access engine hands back a promise, the shape a
         * policy behind a runtime has. Every other mock in this file answers
         * synchronously, which never exercises a second turn of the loop.
         */
        function makeAsyncContext(
            describeAllAccessRules: () => Promise<AccessRuleDescription[]>,
        ): Context {
            const ctx = Context.fromSchemeEngine(makeEngine());
            (ctx as unknown as { access: AccessEngineAdapter }).access = {
                schemeId: 'test',
                describeAllAccessRules: vi.fn(describeAllAccessRules),
            } as unknown as AccessEngineAdapter;
            return ctx;
        }

        it('builds the panel once the rule list resolves', async () => {
            let release!: (rules: AccessRuleDescription[]) => void;
            const pending = new Promise<AccessRuleDescription[]>((resolve) => {
                release = resolve;
            });
            await component.init(
                container,
                makeAsyncContext(() => pending),
            );

            expect(
                container.querySelector('.ez-access-handbook__group-header'),
            ).toBeNull();

            release([makeRule()]);
            await vi.waitFor(() =>
                expect(
                    container.querySelector(
                        '.ez-access-handbook__group-header',
                    ),
                ).not.toBeNull(),
            );
        });

        it('paints an unavailable state when the rule list cannot be read', async () => {
            const consoleError = vi
                .spyOn(console, 'error')
                .mockImplementation(() => {});
            await component.init(
                container,
                makeAsyncContext(() =>
                    Promise.reject(new Error('policy fetch failed')),
                ),
            );

            const failed = await vi.waitFor(() => {
                const el = container.querySelector<HTMLElement>(
                    '.ez-access-handbook__error',
                );
                expect(el).not.toBeNull();
                return el!;
            });
            // Distinct from both empty states on purpose: an authorization
            // panel that renders blank on a failed fetch reads as "no rules
            // apply here", which is the opposite of what is known.
            expect(failed.getAttribute('role')).toBe('alert');
            expect(failed.textContent).toContain('Access policy unavailable');
            expect(
                container.querySelector('.ez-access-handbook__empty'),
            ).toBeNull();
            expect(consoleError).toHaveBeenCalled();
            consoleError.mockRestore();
        });

        it('does not resurrect a panel destroyed while the rule list was in flight', async () => {
            let release!: (rules: AccessRuleDescription[]) => void;
            const pending = new Promise<AccessRuleDescription[]>((resolve) => {
                release = resolve;
            });
            await component.init(
                container,
                makeAsyncContext(() => pending),
            );

            component.destroy();
            release([makeRule()]);
            await new Promise((resolve) => setTimeout(resolve, 0));

            expect(container.innerHTML).toBe('');
        });
    });

    describe('reference-surface vocabulary', () => {
        it('keeps the generic aria-label when the access policy declares no vocabulary (byte-identical default)', async () => {
            const ctx = makeContext([makeRule()]);
            await component.init(container, ctx);

            const region = container.querySelector('[role="region"]');
            expect(region!.getAttribute('aria-label')).toBe('Access handbook');
            const search = container.querySelector(
                '.ez-access-handbook__search-input',
            );
            expect(search!.getAttribute('aria-label')).toBe(
                'Search access rules',
            );
        });

        it('uses the generic Access Handbook noun when the policy declares no reference vocabulary', async () => {
            const schemeEngine = loadCedarValleyLevels();
            const accessEngine = loadCedarValleyLevelsAccess(schemeEngine);
            const ctx = Context.fromSchemeEngine(schemeEngine);
            (ctx as unknown as { access: AccessEngineAdapter }).access =
                accessEngine;
            await component.init(container, ctx);

            const region = container.querySelector('[role="region"]');
            expect(region!.getAttribute('aria-label')).toBe('Access handbook');
            // A screen-reader user who tabs from the region straight into the
            // search field must hear the same renamed noun, not the generic
            // "access rules" chrome the region itself does not use.
            const search = container.querySelector(
                '.ez-access-handbook__search-input',
            );
            expect(search!.getAttribute('aria-label')).toBe(
                'Search access rules',
            );
        });
    });
});
