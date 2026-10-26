/**
 * Tests for the AccessHandbook component.
 *
 * Verifies: rule rendering, search filtering, collapse/expand, empty-state when
 * no access engine is bound, and aria-expanded a11y.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import yaml from 'js-yaml';
import { Context } from '@ezclassify/engine';
import { AccessHandbook } from './access-handbook';
import {
    cedarValleySchemeYaml,
    cedarValleyGuideYaml,
    cedarValleyAccessYaml,
} from '@ezclassify/example-schemes/cedar-valley';

// Keep the fixture self-contained; the canonical Context brand also recognizes
// instances supplied by a separate engine package copy.
function buildCtx(): Context {
    return Context.fromComponents({
        scheme: yaml.load(cedarValleySchemeYaml),
        guides: [yaml.load(cedarValleyGuideYaml)],
        access: yaml.load(cedarValleyAccessYaml),
    });
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

    it('renders rule entries from the access engine', async () => {
        const ctx = buildCtx();
        await component.init(container, ctx);

        // The cedarValley access policy has rules, at least one entry name should
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
        const ctx = buildCtx();
        await component.init(container, ctx);

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
        const ctx = buildCtx();
        await component.init(container, ctx);

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
        const ctx = buildCtx();
        await component.init(container, ctx);

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
        const ctx = buildCtx();
        await component.init(container, ctx);

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
        const ctx = buildCtx();
        await component.init(container, ctx, { expandAll: true } as any);

        const headers = container.querySelectorAll<HTMLButtonElement>(
            '.ez-access-handbook__group-header',
        );
        for (const header of headers) {
            expect(header.getAttribute('aria-expanded')).toBe('true');
        }
    });

    it('filters rules by search term and hides non-matching entries', async () => {
        const ctx = buildCtx();
        await component.init(container, ctx, { expandAll: true } as any);

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
        const ctx = Context.fromComponents({
            scheme: yaml.load(cedarValleySchemeYaml),
        });
        await component.init(container, ctx);

        const empty = container.querySelector('.ez-access-handbook__empty');
        expect(empty).toBeTruthy();
        expect(empty?.textContent).toMatch(/no access policy/i);
    });

    it('shows requirement text and attribute chips for each rule entry', async () => {
        const ctx = buildCtx();
        await component.init(container, ctx, { expandAll: true } as any);

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
        const ctx = buildCtx();
        // Start collapsed.
        await component.init(container, ctx);

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
