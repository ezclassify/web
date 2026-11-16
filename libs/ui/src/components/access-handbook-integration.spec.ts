/**
 * Tests for the AccessHandbook component.
 *
 * Verifies: rule rendering, search filtering, collapse/expand, empty-state when
 * no access engine is bound, and aria-expanded a11y.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AccessHandbook } from './access-handbook';
import type { EzClassifyClient } from '@ezclassify/rest-client';
import {
    connectDemoContext,
    demoRuntimeSettled,
} from '../../../../test-support/demo-runtime';
import {
    referenceAccess,
    referenceScheme,
} from '../../test-fixtures/reference-documents';

// Keep the fixture self-contained; the canonical Context brand also recognizes
// instances supplied by a separate engine package copy.
async function buildCtx(): Promise<EzClassifyClient> {
    return await connectDemoContext({ contextId: 'cedar-valley' });
}

// JSDOM doesn't define matchMedia, stub it once.
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

function createContainer(): HTMLDivElement {
    const el = document.createElement('div');
    document.body.appendChild(el);
    return el;
}

describe('AccessHandbook', () => {
    let container: HTMLDivElement;
    let component: AccessHandbook;

    beforeEach(() => {
        container = createContainer();
        component = new AccessHandbook();
    });

    afterEach(() => {
        component.destroy();
        container.remove();
    });

    it('leads with the overall marking the engine loaded from the policy', async () => {
        const policy = referenceAccess();
        await component.init(
            container,
            await connectDemoContext({
                draft: {
                    scheme: referenceScheme(),
                    access: {
                        access: {
                            ...policy.access,
                            marking: 'NOTIONAL',
                            marking_scheme: { id: 'ref-scheme-1' },
                        },
                    },
                },
            }),
        );
        await demoRuntimeSettled();

        await vi.waitFor(() =>
            expect(
                container.querySelector('.ez-access-handbook__overview-marking')
                    ?.textContent,
            ).toBe('Overall marking: NOTIONAL'),
        );
    });

    it('renders rule entries from the access engine', async () => {
        const ctx = await buildCtx();
        await component.init(container, ctx);
        await demoRuntimeSettled();

        // The Cedar Valley access policy has rules, at least one entry name should
        // appear in the rendered output.
        const entries = container.querySelectorAll(
            '.ez-access-handbook__entry',
        );
        expect(entries.length).toBeGreaterThan(0);

        // The "Protection clearance" rule is always-evaluated, verify it shows up.
        const names = Array.from(entries).map(
            (e) =>
                e.querySelector('.ez-access-handbook__entry-name')?.textContent,
        );
        expect(
            names.some((n) =>
                n?.toLowerCase().includes('protection clearance'),
            ),
        ).toBe(true);
    });

    it('groups rules into always-evaluated and conditional sections', async () => {
        const ctx = await buildCtx();
        await component.init(container, ctx);
        await demoRuntimeSettled();

        const groups = container.querySelectorAll('.ez-access-handbook__group');
        // The state test has unconditional (level) and conditional (handling, test section, etc.) rules.
        expect(groups.length).toBeGreaterThanOrEqual(2);

        const headers = Array.from(groups).map((g) =>
            g
                .querySelector('.ez-access-handbook__group-header')
                ?.textContent?.trim(),
        );
        expect(headers.some((h) => h?.toLowerCase().includes('always'))).toBe(
            true,
        );
        expect(
            headers.some((h) => h?.toLowerCase().includes('conditional')),
        ).toBe(true);
    });

    it('starts with all groups collapsed by default', async () => {
        const ctx = await buildCtx();
        await component.init(container, ctx);
        await demoRuntimeSettled();

        const headers = container.querySelectorAll<HTMLButtonElement>(
            '.ez-access-handbook__group-header',
        );
        for (const header of headers) {
            expect(header.getAttribute('aria-expanded')).toBe('false');
        }
        const bodies = container.querySelectorAll(
            '.ez-access-handbook__group-body',
        );
        for (const body of bodies) {
            expect(
                body.classList.contains(
                    'ez-access-handbook__group-body--collapsed',
                ),
            ).toBe(true);
        }
    });

    it('expands a group on click and updates aria-expanded', async () => {
        const ctx = await buildCtx();
        await component.init(container, ctx);
        await demoRuntimeSettled();

        const firstHeader = container.querySelector<HTMLButtonElement>(
            '.ez-access-handbook__group-header',
        );
        expect(firstHeader).toBeTruthy();

        // Initially collapsed.
        expect(firstHeader!.getAttribute('aria-expanded')).toBe('false');

        firstHeader!.click();

        // After click, the group should be expanded.
        const updatedHeader = container.querySelector<HTMLButtonElement>(
            '.ez-access-handbook__group-header',
        );
        expect(updatedHeader!.getAttribute('aria-expanded')).toBe('true');
        const body = container.querySelector('.ez-access-handbook__group-body');
        expect(
            body?.classList.contains(
                'ez-access-handbook__group-body--collapsed',
            ),
        ).toBe(false);
    });

    it('collapses an expanded group on second click', async () => {
        const ctx = await buildCtx();
        await component.init(container, ctx);
        await demoRuntimeSettled();

        const header = container.querySelector<HTMLButtonElement>(
            '.ez-access-handbook__group-header',
        )!;
        header.click(); // expand
        header.click(); // collapse

        const updatedHeader = container.querySelector<HTMLButtonElement>(
            '.ez-access-handbook__group-header',
        )!;
        expect(updatedHeader.getAttribute('aria-expanded')).toBe('false');
    });

    it('expands all groups when expandAll option is set', async () => {
        const ctx = await buildCtx();
        await component.init(container, ctx, { expandAll: true } as any);
        await demoRuntimeSettled();

        const headers = container.querySelectorAll<HTMLButtonElement>(
            '.ez-access-handbook__group-header',
        );
        for (const header of headers) {
            expect(header.getAttribute('aria-expanded')).toBe('true');
        }
    });

    it('filters rules by search term and hides non-matching entries', async () => {
        const ctx = await buildCtx();
        await component.init(container, ctx, { expandAll: true } as any);
        await demoRuntimeSettled();

        const searchInput = container.querySelector<HTMLInputElement>(
            '.ez-access-handbook__search-input',
        );
        expect(searchInput).toBeTruthy();

        // Type a search term specific to the level rule.
        searchInput!.value = 'level';
        searchInput!.dispatchEvent(new Event('input', { bubbles: true }));

        // At least one entry should remain visible.
        const visible = Array.from(
            container.querySelectorAll('.ez-access-handbook__entry'),
        ).filter(
            (e) => !e.classList.contains('ez-access-handbook__entry--hidden'),
        );
        expect(visible.length).toBeGreaterThan(0);

        // Entries that don't match should be hidden.
        const hidden = Array.from(
            container.querySelectorAll('.ez-access-handbook__entry'),
        ).filter((e) =>
            e.classList.contains('ez-access-handbook__entry--hidden'),
        );
        expect(hidden.length).toBeGreaterThan(0);
    });

    it('shows empty-state message when no access engine is bound', async () => {
        // Scheme-only Context: no access policy bound.
        const ctx = await connectDemoContext({
            draft: { scheme: referenceScheme() },
        });
        await component.init(container, ctx);
        await demoRuntimeSettled();

        const empty = container.querySelector('.ez-access-handbook__empty');
        expect(empty).toBeTruthy();
        expect(empty?.textContent).toMatch(/no access policy/i);
    });

    it('shows requirement text and attribute chips for each rule entry', async () => {
        const ctx = await buildCtx();
        await component.init(container, ctx, { expandAll: true } as any);
        await demoRuntimeSettled();

        const entries = container.querySelectorAll(
            '.ez-access-handbook__entry',
        );
        expect(entries.length).toBeGreaterThan(0);

        // At least one entry should have attribute chips.
        const chips = container.querySelectorAll(
            '.ez-access-handbook__attribute',
        );
        expect(chips.length).toBeGreaterThan(0);
    });

    it('auto-expands groups with search hits', async () => {
        const ctx = await buildCtx();
        // Start collapsed.
        await component.init(container, ctx);
        await demoRuntimeSettled();

        const headers = container.querySelectorAll<HTMLButtonElement>(
            '.ez-access-handbook__group-header',
        );
        for (const header of headers) {
            expect(header.getAttribute('aria-expanded')).toBe('false');
        }

        const searchInput = container.querySelector<HTMLInputElement>(
            '.ez-access-handbook__search-input',
        )!;
        searchInput.value = 'clearance';
        searchInput.dispatchEvent(new Event('input', { bubbles: true }));

        // Groups that have matches should now be expanded.
        const expandedHeaders = Array.from(
            container.querySelectorAll<HTMLButtonElement>(
                '.ez-access-handbook__group-header',
            ),
        ).filter((h) => h.getAttribute('aria-expanded') === 'true');
        expect(expandedHeaders.length).toBeGreaterThan(0);
    });
});
