/**
 * Tests for the ContextReference component.
 *
 * Verifies: built-in tabs derived from the RESOLVED COMPOSITION (guides from
 * the generic composition-presence contract) for local AND remote adapters,
 * including the case the remote client's always-present guide/access ops
 * objects would otherwise get wrong; the single guidebook tab for multiple
 * guides; renderer-safe custom tabs projected in place without ever being
 * reparented; tab id validation and duplicate rejection; the ordered `tabs`
 * allowlist for order and suppression; placement/offset/size/theme
 * presentation; tablist a11y (roles, roving tabindex, arrow navigation);
 * open/close behavior; and clean teardown.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import yaml from 'js-yaml';
import { Context } from '@ezclassify/engine';
import type {
    ContextAdapter,
    GuideStructuralView,
    GuideMetaView,
    AccessRuleDescription,
} from '@ezclassify/types';
import { ContextReference } from './context-reference';
import { createAsyncMockEngine } from './async-engine-mock';
import {
    cedarValleySchemeYaml,
    cedarValleyGuideYaml,
    cedarValleyAccessYaml,
} from '@ezclassify/example-schemes/cedar-valley';

// JSDOM doesn't define matchMedia; stub it once.
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

function fullCtx(): Context {
    return Context.fromComponents({
        scheme: yaml.load(cedarValleySchemeYaml),
        guides: [yaml.load(cedarValleyGuideYaml)],
        access: yaml.load(cedarValleyAccessYaml),
    });
}

function schemeOnlyCtx(): Context {
    return Context.fromComponents({ scheme: yaml.load(cedarValleySchemeYaml) });
}

function schemeGuideCtx(): Context {
    return Context.fromComponents({
        scheme: yaml.load(cedarValleySchemeYaml),
        guides: [yaml.load(cedarValleyGuideYaml)],
    });
}

/** Two guides in one context; both feed a SINGLE guidebook tab by design. */
function twoGuideCtx(): Context {
    const g1 = yaml.load(cedarValleyGuideYaml) as { guide: { id: string } };
    const g2 = yaml.load(cedarValleyGuideYaml) as { guide: { id: string } };
    g2.guide.id = `${g2.guide.id}-2`;
    return Context.fromComponents({
        scheme: yaml.load(cedarValleySchemeYaml),
        guides: [g1, g2],
    });
}

/**
 * A remote-shaped ContextAdapter that mirrors the REAL `EzClassifyClient`: the
 * scheme surface and both sibling surfaces answer asynchronously, and (this is
 * the point) the `guide` and `access` ops objects are ALWAYS present regardless
 * of composition, exactly as the client constructs them. What differs by
 * composition is the resolved presence contract cached at connect. The drawer
 * must read that, not the presence of the ops object or a rule inventory that
 * cannot distinguish absent from present-but-empty access.
 */
function remoteCtx(opts: {
    guides: number;
    access: 'rules' | 'empty' | 'absent';
}): ContextAdapter {
    const scheme = createAsyncMockEngine();

    const guideMetas: GuideMetaView[] = Array.from(
        { length: opts.guides },
        (_, i) => ({
            id: `g-remote-${i}`,
            version: '1.0.0',
            name: `Remote Guide ${i}`,
            ruleCount: 1,
            referenceSurfaceLabel: {
                singular: 'Guidebook',
                plural: 'Guidebooks',
            },
        }),
    );

    const guideView: GuideStructuralView = {
        id: 'g-remote-0',
        name: 'Remote Guide',
        description: 'Loaded over the wire',
        categories: [
            {
                id: 'c1',
                label: 'Category 1',
                items: [
                    {
                        id: 'r1',
                        name: 'Remote Rule',
                        outcomeText: 'apply X',
                        isComputed: false,
                        keywords: ['alpha'],
                        matcherLabels: [],
                        dependsOn: [],
                        dependsOnNames: [],
                        overrides: [],
                        overrideNames: [],
                    },
                ],
            },
        ],
        uncategorized: [],
    };

    const accessRule: AccessRuleDescription = {
        rule: {
            artifact: { kind: 'access', id: 'a-remote', version: '1.0.0' },
            ruleId: 'need-clearance',
            ruleDigest: 'deadbeef',
        },
        access: { kind: 'access', id: 'a-remote', version: '1.0.0' },
        scheme: { kind: 'scheme', id: 'test-async', version: '1.0' },
        name: 'Remote Access Rule',
        requirementText: 'Requires clearance',
        attributesNeeded: ['clearance'],
        dependsOn: [],
        overrides: [],
        lines: [],
    };

    // The access surface is ALWAYS constructed (client fidelity). Its inventory
    // reports the real composition: rules, empty, or an absent-artifact route
    // that rejects.
    const listAccessRuleIds = (): Promise<string[]> => {
        if (opts.access === 'rules') return Promise.resolve(['need-clearance']);
        if (opts.access === 'empty') return Promise.resolve([]);
        return Promise.reject(
            new Error('404: no access policy in this context'),
        );
    };

    return {
        connected: true,
        compositionPresence: {
            guides: opts.guides > 0,
            access: opts.access !== 'absent',
        },
        scheme: scheme as never,
        // guide ops ALWAYS present, like the real client; inventory drives presence.
        guide: {
            listGuideMeta: () => guideMetas,
            getGuideMeta: () => guideMetas[0],
            buildGuideViews: () =>
                Promise.resolve(opts.guides > 0 ? [guideView] : []),
        } as never,
        access: {
            schemeId: 'test-async',
            listAccessRuleIds,
            describeAllAccessRules: () =>
                opts.access === 'rules'
                    ? Promise.resolve([accessRule])
                    : opts.access === 'empty'
                      ? Promise.resolve([])
                      : Promise.reject(new Error('404: no access policy')),
        } as never,
        describeSchemes: () => Promise.resolve([]),
        audit: () => Promise.resolve({} as never),
        assessDocumentAccess: () => Promise.resolve({} as never),
        checkContextAccess: () => Promise.resolve({} as never),
        accessRequirements: () => Promise.resolve({} as never),
        translate: () => Promise.resolve({} as never),
        destroy: () => {},
    } as unknown as ContextAdapter;
}

function makeContainer(): HTMLDivElement {
    const el = document.createElement('div');
    document.body.appendChild(el);
    return el;
}

function tabIds(container: HTMLElement): string[] {
    return Array.from(
        container.querySelectorAll<HTMLButtonElement>('.ez-context-ref__tab'),
    ).map((t) => t.dataset.tabId!);
}

function tabLabels(container: HTMLElement): string[] {
    return Array.from(
        container.querySelectorAll<HTMLButtonElement>(
            '.ez-context-ref__tab-label',
        ),
    ).map((t) => t.textContent ?? '');
}

/** Add a declarative custom-tab child to the host, as a framework binding would. */
function addCustomChild(
    container: HTMLElement,
    id: string | null,
    label: string,
    inner = 'panel content',
): HTMLElement {
    const custom = document.createElement('div');
    custom.setAttribute('data-ezclassify-tab', '');
    if (id != null) custom.setAttribute('data-ezclassify-tab-id', id);
    custom.setAttribute('data-ezclassify-tab-label', label);
    const marker = document.createElement('p');
    marker.textContent = inner;
    custom.appendChild(marker);
    container.appendChild(custom);
    return custom;
}

const flush = () => new Promise((r) => setTimeout(r, 30));

describe('ContextReference', () => {
    let container: HTMLDivElement;
    let component: ContextReference;

    beforeEach(() => {
        container = makeContainer();
        component = new ContextReference();
    });

    afterEach(() => {
        try {
            component.destroy();
        } catch {
            /* a test that forced an init rejection never built anything */
        }
        container.remove();
    });

    describe('built-in tab derivation (local composition)', () => {
        it('renders handbook + guidebook + access for a full context', () => {
            component.init(container, fullCtx());
            expect(tabIds(container)).toEqual([
                'handbook',
                'guidebook',
                'access',
            ]);
        });

        it('renders only the handbook tab for a scheme-only context', () => {
            component.init(container, schemeOnlyCtx());
            expect(tabIds(container)).toEqual(['handbook']);
        });

        it('renders handbook + guidebook when there is a guide but no access', () => {
            component.init(container, schemeGuideCtx());
            expect(tabIds(container)).toEqual(['handbook', 'guidebook']);
        });

        it('feeds every loaded guide into ONE guidebook tab', () => {
            component.init(container, twoGuideCtx());
            const ids = tabIds(container);
            expect(ids.filter((id) => id === 'guidebook')).toHaveLength(1);
        });

        it('mounts the composed reference components into the panels', async () => {
            component.init(container, fullCtx());
            expect(container.querySelector('.ez-handbook')).toBeTruthy();
            expect(container.querySelector('.ez-guidebook')).toBeTruthy();
            await flush();
            expect(container.querySelector('.ez-access-handbook')).toBeTruthy();
        });

        it('makes the host element itself the drawer root', () => {
            component.init(container, schemeOnlyCtx());
            expect(container.classList.contains('ez-context-ref')).toBe(true);
            expect(container.getAttribute('role')).toBe('region');
        });
    });

    // Presence must come from the resolved composition, not from the
    // remote client's always-present ops objects.
    describe('remote built-in presence from resolved composition', () => {
        it('shows ONLY handbook for a remote scheme-only context without probing access', async () => {
            const remote = remoteCtx({ guides: 0, access: 'absent' });
            const accessProbe = vi.spyOn(remote.access!, 'listAccessRuleIds');
            component.init(container, remote);
            expect(tabIds(container)).toEqual(['handbook']);
            await flush();
            expect(tabIds(container)).toEqual(['handbook']);
            expect(accessProbe).not.toHaveBeenCalled();
        });

        it('shows access for a present policy with zero rules', async () => {
            component.init(
                container,
                remoteCtx({ guides: 0, access: 'empty' }),
            );
            await flush();
            expect(tabIds(container)).toEqual(['handbook', 'access']);
        });

        it('shows handbook + guidebook for a remote scheme+guide context (no access)', async () => {
            component.init(
                container,
                remoteCtx({ guides: 1, access: 'absent' }),
            );
            expect(tabIds(container)).toEqual(['handbook', 'guidebook']);
            await flush();
            expect(tabIds(container)).toEqual(['handbook', 'guidebook']);
        });

        it('shows access synchronously for a full remote context', async () => {
            component.init(
                container,
                remoteCtx({ guides: 1, access: 'rules' }),
            );
            expect(tabIds(container)).toEqual([
                'handbook',
                'guidebook',
                'access',
            ]);
            await flush();
            expect(tabIds(container)).toEqual([
                'handbook',
                'guidebook',
                'access',
            ]);
        });

        it('resolves the async guide surface into its panel', async () => {
            component.init(
                container,
                remoteCtx({ guides: 1, access: 'rules' }),
            );
            await flush();
            const guidePanel = container.querySelector(
                '#ez-context-ref-panel-guidebook',
            );
            expect(guidePanel?.textContent).toContain('Remote Rule');
        });
    });

    // A custom tab's host node is projected in place and NEVER reparented,
    // so a framework can add/remove/reorder/update/unmount it without the drawer
    // moving DOM out from under its renderer.
    describe('custom tabs projected in place', () => {
        it('projects a marked child as a tab WITHOUT moving it out of the host', () => {
            const custom = addCustomChild(
                container,
                'developers',
                'Developers',
                'host-owned panel content',
            );

            component.init(container, schemeOnlyCtx());

            expect(tabIds(container)).toEqual(['handbook', 'developers']);
            // The node was NOT relocated: it is still a DIRECT child of the host,
            // exactly where the framework rendered it.
            expect(custom.parentElement).toBe(container);
            // It is projected as the tabpanel in place (attribute, not class, so a
            // framework re-render of `class` cannot wipe it).
            expect(custom.getAttribute('role')).toBe('tabpanel');
            expect(custom.id).toBe('ez-context-ref-panel-developers');
            expect(custom.hasAttribute('data-ez-context-ref-panel')).toBe(true);
            expect(custom.textContent).toContain('host-owned panel content');
        });

        it('reflects a custom tab REMOVED from the host after mount', async () => {
            const custom = addCustomChild(
                container,
                'developers',
                'Developers',
            );
            component.init(container, schemeOnlyCtx());
            expect(tabIds(container)).toEqual(['handbook', 'developers']);

            // A framework re-render removes the node; the host is its true parent,
            // so this is a plain removeChild and must not throw.
            expect(() => custom.remove()).not.toThrow();
            await flush();
            expect(tabIds(container)).toEqual(['handbook']);
        });

        it('reflects a custom tab ADDED to the host after mount', async () => {
            component.init(container, schemeOnlyCtx());
            expect(tabIds(container)).toEqual(['handbook']);

            addCustomChild(container, 'developers', 'Developers');
            await flush();
            expect(tabIds(container)).toEqual(['handbook', 'developers']);
        });

        it('reflects reordering of custom tabs after mount', async () => {
            addCustomChild(container, 'a', 'Alpha');
            addCustomChild(container, 'b', 'Bravo');
            component.init(container, schemeOnlyCtx());
            expect(tabIds(container)).toEqual(['handbook', 'a', 'b']);

            // Move Alpha after Bravo (a framework reorder). Both stay direct
            // children of the host; the strip follows the new order.
            const a = container.querySelector('[data-ezclassify-tab-id="a"]')!;
            container.appendChild(a);
            await flush();
            expect(tabIds(container)).toEqual(['handbook', 'b', 'a']);
        });

        it('keeps the same DOM node across content updates (no reparent)', () => {
            const custom = addCustomChild(
                container,
                'developers',
                'Developers',
            );
            component.init(container, schemeOnlyCtx());
            const before = custom.parentElement;
            // A framework content update mutates the node's children in place.
            custom.appendChild(document.createTextNode(' more'));
            expect(custom.parentElement).toBe(before);
            expect(custom.parentElement).toBe(container);
        });

        it('reads the custom label and interleaves via the tabs allowlist', () => {
            addCustomChild(container, 'developers', 'Developers');
            component.init(container, fullCtx(), {
                tabs: ['developers', 'access', 'handbook'],
            } as never);
            expect(tabIds(container)).toEqual([
                'developers',
                'access',
                'handbook',
            ]);
        });

        it('hides a custom node suppressed by the allowlist (never stray content)', () => {
            const custom = addCustomChild(
                container,
                'developers',
                'Developers',
            );
            component.init(container, schemeOnlyCtx(), {
                tabs: ['handbook'],
            } as never);
            expect(tabIds(container)).toEqual(['handbook']);
            // The node stays in place but is hidden, not shown as loose content.
            expect(custom.parentElement).toBe(container);
            expect(custom.hidden).toBe(true);
        });
    });

    // Custom tab ids cross a public boundary; a collision would corrupt
    // the ARIA tab model, so the contract is validated and duplicates rejected.
    describe('tab id grammar and uniqueness', () => {
        it('rejects a custom id that claims a reserved built-in id', async () => {
            addCustomChild(container, 'handbook', 'Fake Handbook');
            await expect(
                component.init(container, schemeOnlyCtx()),
            ).rejects.toThrow(/reserved/);
        });

        it('rejects a malformed custom id', async () => {
            addCustomChild(container, 'has spaces', 'Bad');
            await expect(
                component.init(container, schemeOnlyCtx()),
            ).rejects.toThrow(/valid tab id/);
        });

        it('rejects two custom tabs sharing an id', async () => {
            addCustomChild(container, 'dev', 'One');
            addCustomChild(container, 'dev', 'Two');
            await expect(
                component.init(container, schemeOnlyCtx()),
            ).rejects.toThrow(/duplicate custom tab id/);
        });

        it('rejects a duplicated id in the tabs allowlist', async () => {
            await expect(
                component.init(container, schemeOnlyCtx(), {
                    tabs: ['handbook', 'handbook'],
                } as never),
            ).rejects.toThrow(/allowlist/);
        });

        it('accepts distinct valid custom ids', () => {
            addCustomChild(container, 'dev-tools', 'Dev');
            addCustomChild(container, 'ops2', 'Ops');
            component.init(container, schemeOnlyCtx());
            expect(tabIds(container)).toEqual([
                'handbook',
                'dev-tools',
                'ops2',
            ]);
            // No duplicate DOM ids emitted.
            const ids = Array.from(
                container.querySelectorAll('[id^="ez-context-ref-"]'),
            ).map((e) => e.id);
            expect(new Set(ids).size).toBe(ids.length);
        });

        it('defensively drops a duplicate custom tab introduced after mount', async () => {
            const errSpy = vi
                .spyOn(console, 'error')
                .mockImplementation(() => {});
            addCustomChild(container, 'dev', 'One');
            component.init(container, schemeOnlyCtx());
            expect(tabIds(container)).toEqual(['handbook', 'dev']);

            // A later render adds a second node claiming the same id. The drawer
            // keeps the first and drops the collision rather than corrupting the
            // ARIA model.
            addCustomChild(container, 'dev', 'Two');
            await flush();
            expect(tabIds(container)).toEqual(['handbook', 'dev']);
            const ids = Array.from(
                container.querySelectorAll('[id^="ez-context-ref-"]'),
            ).map((e) => e.id);
            expect(new Set(ids).size).toBe(ids.length);
            errSpy.mockRestore();
        });
    });

    describe('tabs allowlist (presentation-only order + suppression)', () => {
        it('reorders and suppresses built-in tabs without touching the context', () => {
            component.init(container, fullCtx(), {
                tabs: ['access', 'handbook'],
            } as never);
            expect(tabIds(container)).toEqual(['access', 'handbook']);
        });

        it('accepts a comma-separated string allowlist (declarative path)', () => {
            component.init(container, fullCtx(), {
                tabs: 'handbook,access',
            } as never);
            expect(tabIds(container)).toEqual(['handbook', 'access']);
        });
    });

    describe('per-tab labels', () => {
        it('applies a per-tab label override', () => {
            component.init(container, schemeOnlyCtx(), {
                tabLabels: { handbook: 'Manual' },
            } as never);
            expect(tabLabels(container)).toContain('Manual');
        });
    });

    describe('presentation', () => {
        it('applies placement, size, and per-side offsets on the host', () => {
            component.init(container, schemeOnlyCtx(), {
                placement: 'left',
                size: '24rem',
                offset: { top: '60px' },
            } as never);
            expect(
                container.getAttribute('data-ez-context-ref-placement'),
            ).toBe('left');
            expect(
                container.style.getPropertyValue('--ez-context-ref-size'),
            ).toBe('24rem');
            expect(
                container.style.getPropertyValue('--ez-context-ref-offset-top'),
            ).toBe('60px');
        });

        it('defaults placement to right', () => {
            component.init(container, schemeOnlyCtx());
            expect(
                container.getAttribute('data-ez-context-ref-placement'),
            ).toBe('right');
        });

        it('applies a named preset theme inline on the host', () => {
            component.init(container, schemeOnlyCtx(), {
                theme: 'government',
            } as never);
            expect(container.style.getPropertyValue('--ez-font-family')).toBe(
                '"Segoe UI", system-ui, sans-serif',
            );
        });
    });

    describe('open / closed', () => {
        it('offers an internal native close button and returns focus to the retained launcher', () => {
            component.init(container, schemeOnlyCtx());
            const close = container.querySelector<HTMLButtonElement>(
                '.ez-context-ref__close',
            )!;
            const handle = container.querySelector<HTMLButtonElement>(
                '.ez-context-ref__handle',
            )!;
            expect(close).not.toBeNull();
            expect(close.type).toBe('button');
            expect(close.textContent).toBe('Close reference');
            expect(close.hidden).toBe(true);

            handle.click();
            expect(close.hidden).toBe(false);
            expect(close.parentElement).toBe(container);
            expect(close.closest('[role="tabpanel"]')).toBeNull();
            close.focus();
            close.click();
            expect(container.getAttribute('data-ez-context-ref-open')).toBe(
                'false',
            );
            expect(close.hidden).toBe(true);
            expect(document.activeElement).toBe(handle);
            expect(handle.getAttribute('aria-expanded')).toBe('false');

            handle.click();
            expect(close.hidden).toBe(false);
            expect(container.getAttribute('data-ez-context-ref-open')).toBe(
                'true',
            );
            component.destroy();
            expect(
                container.querySelector('.ez-context-ref__close'),
            ).toBeNull();
        });

        it('closes with Escape from the internal close button and restores launcher focus', () => {
            component.init(container, schemeOnlyCtx(), { open: true } as never);
            const close = container.querySelector<HTMLButtonElement>(
                '.ez-context-ref__close',
            )!;
            const handle = container.querySelector<HTMLButtonElement>(
                '.ez-context-ref__handle',
            )!;
            close.focus();
            close.dispatchEvent(
                new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
            );
            expect(close.hidden).toBe(true);
            expect(container.getAttribute('data-ez-context-ref-open')).toBe(
                'false',
            );
            expect(document.activeElement).toBe(handle);
        });

        it('starts closed by default', () => {
            component.init(container, schemeOnlyCtx());
            expect(container.getAttribute('data-ez-context-ref-open')).toBe(
                'false',
            );
        });

        it('opens for the declarative presence-only attribute (empty string)', () => {
            component.init(container, schemeOnlyCtx(), { open: '' } as never);
            expect(container.getAttribute('data-ez-context-ref-open')).toBe(
                'true',
            );
        });

        it('starts open when requested and toggles via the handle', () => {
            component.init(container, schemeOnlyCtx(), { open: true } as never);
            expect(container.getAttribute('data-ez-context-ref-open')).toBe(
                'true',
            );

            const handle = container.querySelector<HTMLButtonElement>(
                '.ez-context-ref__handle',
            )!;
            handle.click();
            expect(container.getAttribute('data-ez-context-ref-open')).toBe(
                'false',
            );
        });
    });

    describe('accessibility', () => {
        it('exposes tablist / tab / tabpanel roles with roving tabindex', () => {
            component.init(container, fullCtx());
            const tablist = container.querySelector(
                '.ez-context-ref__tablist[role="tablist"]',
            );
            expect(tablist).toBeTruthy();

            const tabs = Array.from(
                container.querySelectorAll<HTMLButtonElement>(
                    '.ez-context-ref__tab',
                ),
            );
            expect(tabs).toHaveLength(3);
            for (const tab of tabs) {
                expect(tab.getAttribute('role')).toBe('tab');
            }
            const inOrder = tabs.filter((t) => t.tabIndex === 0);
            expect(inOrder).toHaveLength(1);
            expect(inOrder[0].getAttribute('aria-selected')).toBe('true');

            // The drawer's own three built-in panels (a composed Handbook renders
            // its OWN internal tabs, so scope to the drawer panels).
            const panels = container.querySelectorAll(
                '.ez-context-ref__tabpanel[role="tabpanel"]',
            );
            expect(panels).toHaveLength(3);
        });

        it('shows only the active tabpanel', () => {
            component.init(container, fullCtx());
            const panels = Array.from(
                container.querySelectorAll<HTMLElement>(
                    '.ez-context-ref__tabpanel',
                ),
            );
            const visible = panels.filter((p) => !p.hidden);
            expect(visible).toHaveLength(1);
            expect(visible[0].id).toBe('ez-context-ref-panel-handbook');
        });

        it('navigates tabs with ArrowRight and moves selection', () => {
            component.init(container, fullCtx());
            const tablist =
                container.querySelector<HTMLElement>('[role="tablist"]')!;
            tablist.dispatchEvent(
                new KeyboardEvent('keydown', {
                    key: 'ArrowRight',
                    bubbles: true,
                }),
            );
            const selected = container.querySelector(
                '.ez-context-ref__tab[aria-selected="true"]',
            ) as HTMLButtonElement;
            expect(selected.dataset.tabId).toBe('guidebook');
        });
    });

    describe('teardown', () => {
        it('strips its chrome and un-projects custom nodes, leaving them in place', () => {
            const custom = addCustomChild(
                container,
                'developers',
                'Developers',
            );

            component.init(container, schemeOnlyCtx());
            component.destroy();

            // The host survives (the framework owns it); only our enhancement is
            // stripped.
            expect(container.classList.contains('ez-context-ref')).toBe(false);
            expect(
                container.querySelector('.ez-context-ref__handle'),
            ).toBeNull();
            // The host's own node survives, back in its authored state.
            expect(container.contains(custom)).toBe(true);
            expect(custom.hasAttribute('role')).toBe(false);
            expect(custom.hasAttribute('data-ez-context-ref-panel')).toBe(
                false,
            );
            // Its authoring marker is untouched.
            expect(custom.hasAttribute('data-ezclassify-tab')).toBe(true);
        });
    });
});
