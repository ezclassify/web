/**
 * Tests for the React ContextReference binding.
 *
 * Two levels: the emitted markup (proving the binding is a thin map onto the
 * controller's declarative attributes, not a re-implementation), and a full
 * end-to-end pass under a real provider where the ambient scanner enhances the
 * host and the vanilla controller derives its tabs.
 */

import { describe, it, expect } from 'vitest';
import { render, waitFor, act } from '@testing-library/react';
import { createElement, useState, type ReactNode } from 'react';
import yaml from 'js-yaml';
import { Context } from '@ezclassify/engine';
import {
    cedarValleySchemeYaml,
    cedarValleyGuideYaml,
    cedarValleyAccessYaml,
} from '@ezclassify/example-schemes/cedar-valley';
import { EzClassifyProvider, useSchemeEngine } from './index';
import { ContextReference } from './ContextReference';

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

function fullContext(): Context {
    return Context.fromComponents({
        scheme: yaml.load(cedarValleySchemeYaml),
        guides: [yaml.load(cedarValleyGuideYaml)],
        access: yaml.load(cedarValleyAccessYaml),
    });
}

describe('React <ContextReference> markup', () => {
    it('maps presentation props onto the controller attributes and CSS vars', () => {
        const { container } = render(
            createElement(ContextReference, {
                placement: 'left',
                size: '24rem',
                open: true,
                tabs: ['handbook', 'access'],
                offset: { top: '60px' },
            }),
        );
        const host = container.firstElementChild as HTMLElement;
        expect(host.getAttribute('data-ezclassify-controller')).toBe(
            'context-reference',
        );
        expect(
            host.getAttribute('data-ezclassify-context-reference-placement'),
        ).toBe('left');
        expect(
            host.getAttribute('data-ezclassify-context-reference-size'),
        ).toBe('24rem');
        expect(
            host.hasAttribute('data-ezclassify-context-reference-open'),
        ).toBe(true);
        expect(
            host.getAttribute('data-ezclassify-context-reference-tabs'),
        ).toBe('handbook,access');
        expect(host.style.getPropertyValue('--ez-context-ref-offset-top')).toBe(
            '60px',
        );
    });

    it('renders a custom tab as the data-ezclassify-tab marker element', () => {
        const { container } = render(
            createElement(
                ContextReference,
                null,
                createElement(
                    ContextReference.Tab,
                    { id: 'developers', label: 'Developers' },
                    createElement('p', null, 'dev panel'),
                ),
            ),
        );
        const tab = container.querySelector('[data-ezclassify-tab]');
        expect(tab).toBeTruthy();
        expect(tab?.getAttribute('data-ezclassify-tab-id')).toBe('developers');
        expect(tab?.getAttribute('data-ezclassify-tab-label')).toBe(
            'Developers',
        );
        expect(tab?.textContent).toContain('dev panel');
    });
});

describe('React <ContextReference> under a provider', () => {
    it('is enhanced by the ambient scanner into a tabbed drawer', async () => {
        function Host(): ReactNode {
            const bound = useSchemeEngine();
            return createElement(
                bound.Container,
                {},
                createElement(
                    ContextReference,
                    { open: true, placement: 'left' },
                    createElement(
                        ContextReference.Tab,
                        { id: 'developers', label: 'Developers' },
                        createElement('p', null, 'dev content'),
                    ),
                ),
            );
        }

        const { container } = render(
            createElement(
                EzClassifyProvider,
                { engine: fullContext() },
                createElement(Host),
            ),
        );

        // Built-ins derived from the context + the custom tab = 4 tabs.
        await waitFor(() => {
            const tabs = container.querySelectorAll('.ez-context-ref__tab');
            expect(tabs).toHaveLength(4);
        });
        const ids = Array.from(
            container.querySelectorAll<HTMLButtonElement>(
                '.ez-context-ref__tab',
            ),
        ).map((t) => t.dataset.tabId);
        expect(ids).toEqual(['handbook', 'guidebook', 'access', 'developers']);
        // The host's custom content is projected in place as its panel.
        const devPanel = container.querySelector(
            '#ez-context-ref-panel-developers',
        );
        expect(devPanel?.textContent).toContain('dev content');
    });
});

/**
 * The controller must never move a framework-owned custom-tab node out of its
 * React parent. If it did, a reactive removal/reorder would call
 * `parent.removeChild(node)` / `insertBefore` against a node React no longer
 * owns and throw `NotFoundError`. These drive the real reconciler over the
 * committed binding: enhancement happens, then React mutates its children.
 */
describe('React <ContextReference> reactive lifecycle', () => {
    const ctx = fullContext();

    interface HarnessApi {
        setShowDev: (v: boolean) => void;
        setShowOps: (v: boolean) => void;
        setSwap: (v: boolean) => void;
        setLabel: (v: string) => void;
    }

    function Harness({
        controls,
    }: {
        controls: (api: HarnessApi) => void;
    }): ReactNode {
        const bound = useSchemeEngine();
        const [showDev, setShowDev] = useState(true);
        const [showOps, setShowOps] = useState(false);
        const [swap, setSwap] = useState(false);
        const [label, setLabel] = useState('dev content');
        controls({ setShowDev, setShowOps, setSwap, setLabel });

        // Custom tabs are keyed so a reorder MOVES the existing DOM node
        // (React insertBefore) rather than re-creating it: the realistic
        // framework reorder the controller must survive.
        const dev = showDev
            ? createElement(
                  ContextReference.Tab,
                  { key: 'dev', id: 'developers', label: 'Developers' },
                  createElement('p', null, label),
              )
            : null;
        const ops = showOps
            ? createElement(
                  ContextReference.Tab,
                  { key: 'ops', id: 'ops', label: 'Ops' },
                  createElement('p', null, 'ops content'),
              )
            : null;
        const children = swap ? [ops, dev] : [dev, ops];

        return createElement(
            bound.Container,
            {},
            createElement(ContextReference, { open: true }, children),
        );
    }

    function mount(): { container: HTMLElement; api: HarnessApi } {
        let api!: HarnessApi;
        const { container } = render(
            createElement(
                EzClassifyProvider,
                { engine: ctx },
                createElement(Harness, {
                    controls: (a) => {
                        api = a;
                    },
                }),
            ),
        );
        return { container, api };
    }

    const ids = (c: HTMLElement) =>
        Array.from(
            c.querySelectorAll<HTMLButtonElement>('.ez-context-ref__tab'),
        ).map((t) => t.dataset.tabId);

    it('removes a custom tab on a reactive removal without throwing', async () => {
        const { container, api } = mount();
        await waitFor(() => expect(ids(container)).toContain('developers'));
        expect(() => act(() => api.setShowDev(false))).not.toThrow();
        await waitFor(() => expect(ids(container)).not.toContain('developers'));
    });

    it('adds a custom tab on a reactive addition', async () => {
        const { container, api } = mount();
        await waitFor(() => expect(ids(container)).toContain('developers'));
        act(() => api.setShowOps(true));
        await waitFor(() => expect(ids(container)).toContain('ops'));
    });

    it('reorders custom tabs on a reactive reorder', async () => {
        const { container, api } = mount();
        act(() => api.setShowOps(true));
        await waitFor(() =>
            expect(ids(container)).toEqual([
                'handbook',
                'guidebook',
                'access',
                'developers',
                'ops',
            ]),
        );
        act(() => api.setSwap(true));
        await waitFor(() =>
            expect(ids(container)).toEqual([
                'handbook',
                'guidebook',
                'access',
                'ops',
                'developers',
            ]),
        );
    });

    it('updates custom panel content in place', async () => {
        const { container, api } = mount();
        await waitFor(() => expect(ids(container)).toContain('developers'));
        act(() => api.setLabel('updated content'));
        await waitFor(() =>
            expect(
                container.querySelector('#ez-context-ref-panel-developers')
                    ?.textContent,
            ).toContain('updated content'),
        );
    });

    it('unmounts the whole drawer without throwing', async () => {
        function DrawerHost(): ReactNode {
            const bound = useSchemeEngine();
            return createElement(
                bound.Container,
                {},
                createElement(
                    ContextReference,
                    { open: true },
                    createElement(
                        ContextReference.Tab,
                        { id: 'developers', label: 'Developers' },
                        createElement('p', null, 'dev content'),
                    ),
                ),
            );
        }
        let toggle: () => void = () => {};
        function Parent(): ReactNode {
            const [show, setShow] = useState(true);
            toggle = () => setShow(false);
            return show ? createElement(DrawerHost) : null;
        }
        const { container } = render(
            createElement(
                EzClassifyProvider,
                { engine: fullContext() },
                createElement(Parent),
            ),
        );
        await waitFor(() =>
            expect(
                container.querySelector('.ez-context-ref__tab'),
            ).toBeTruthy(),
        );
        expect(() => act(() => toggle())).not.toThrow();
        expect(container.querySelector('.ez-context-ref')).toBeNull();
    });
});
