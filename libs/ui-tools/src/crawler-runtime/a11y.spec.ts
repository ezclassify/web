/**
 * Tests for a11y.ts pure violation-shaping logic.
 *
 * ScanA11y() drives a real browser via Playwright, but its entire output
 * derives from mapping AxeBuilder results into A11yViolation objects.
 * @axe-core/playwright is mocked here so no browser is launched and the
 * mapping/transformation logic is exercisable in isolation.
 *
 * Browser.ts, run-loop.ts, and index.ts are skipped, they orchestrate
 * Playwright page navigation and require a live browser context.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Page } from '@playwright/test';

// vi.hoisted ensures these are initialized before the vi.mock factory runs.
const { mockAnalyze, mockExclude, MockAxeBuilder } = vi.hoisted(() => {
    const mockAnalyze = vi.fn().mockResolvedValue({ violations: [] });
    const mockExclude = vi.fn();

    // Must be a real class (not a vi.fn arrow) so `new AxeBuilder(...)` works.
    class MockAxeBuilderImpl {
        withTags(_tags: string[]) {
            return this;
        }
        exclude(sel: string) {
            mockExclude(sel);
            return this;
        }
        analyze() {
            return mockAnalyze();
        }
    }

    return { mockAnalyze, mockExclude, MockAxeBuilder: MockAxeBuilderImpl };
});

vi.mock('@axe-core/playwright', () => ({ default: MockAxeBuilder }));

import { scanA11y } from './a11y.js';

// AxeBuilder is fully mocked, the page object is never touched by tests.
const fakePage = {} as unknown as Page;

beforeEach(() => {
    vi.clearAllMocks();
    mockAnalyze.mockResolvedValue({ violations: [] });
});

describe('scanA11y: no violations', () => {
    it('returns pass=true when axe reports zero violations', async () => {
        const result = await scanA11y(fakePage);
        expect(result.pass).toBe(true);
        expect(result.violations).toHaveLength(0);
    });
});

describe('scanA11y: violation shaping', () => {
    it('returns pass=false when violations are present', async () => {
        mockAnalyze.mockResolvedValue({
            violations: [
                {
                    id: 'color-contrast',
                    impact: 'serious',
                    help: 'Color contrast',
                    nodes: [{ target: ['div'] }],
                },
            ],
        });
        const result = await scanA11y(fakePage);
        expect(result.pass).toBe(false);
        expect(result.violations).toHaveLength(1);
    });

    it('maps id, impact, help, and node count correctly', async () => {
        mockAnalyze.mockResolvedValue({
            violations: [
                {
                    id: 'color-contrast',
                    impact: 'serious',
                    help: 'Elements must have sufficient color contrast',
                    nodes: [{ target: ['button.cta'] }, { target: ['a.link'] }],
                },
            ],
        });
        const result = await scanA11y(fakePage);
        expect(result.violations[0]).toMatchObject({
            id: 'color-contrast',
            impact: 'serious',
            help: 'Elements must have sufficient color contrast',
            nodes: 2,
        });
    });

    it('defaults a null impact to "unknown"', async () => {
        mockAnalyze.mockResolvedValue({
            violations: [
                {
                    id: 'rule',
                    impact: null,
                    help: 'Help',
                    nodes: [{ target: ['div'] }],
                },
            ],
        });
        const result = await scanA11y(fakePage);
        expect(result.violations[0].impact).toBe('unknown');
    });

    it('defaults an undefined impact to "unknown"', async () => {
        mockAnalyze.mockResolvedValue({
            violations: [
                { id: 'rule', help: 'Help', nodes: [{ target: ['div'] }] },
            ],
        });
        const result = await scanA11y(fakePage);
        expect(result.violations[0].impact).toBe('unknown');
    });

    it('caps sampleTargets at 3 even when more nodes exist', async () => {
        mockAnalyze.mockResolvedValue({
            violations: [
                {
                    id: 'rule',
                    impact: 'moderate',
                    help: 'Help',
                    nodes: [
                        { target: ['a'] },
                        { target: ['b'] },
                        { target: ['c'] },
                        { target: ['d'] },
                    ],
                },
            ],
        });
        const result = await scanA11y(fakePage);
        expect(result.violations[0].nodes).toBe(4);
        expect(result.violations[0].sampleTargets).toHaveLength(3);
    });

    it('joins array targets into a space-separated string', async () => {
        mockAnalyze.mockResolvedValue({
            violations: [
                {
                    id: 'rule',
                    impact: 'minor',
                    help: 'Help',
                    nodes: [{ target: ['#main', 'button.cta'] }],
                },
            ],
        });
        const result = await scanA11y(fakePage);
        expect(result.violations[0].sampleTargets?.[0]).toBe(
            '#main button.cta',
        );
    });

    it('converts a non-array target to string', async () => {
        mockAnalyze.mockResolvedValue({
            violations: [
                {
                    id: 'rule',
                    impact: 'minor',
                    help: 'Help',
                    nodes: [{ target: 'button' }],
                },
            ],
        });
        const result = await scanA11y(fakePage);
        expect(result.violations[0].sampleTargets?.[0]).toBe('button');
    });
});

describe('scanA11y: skip selectors', () => {
    it('calls builder.exclude for each selector in the skip list', async () => {
        await scanA11y(fakePage, ['#nav', '.banner']);
        expect(mockExclude).toHaveBeenCalledWith('#nav');
        expect(mockExclude).toHaveBeenCalledWith('.banner');
    });

    it('does not call builder.exclude when skip list is empty', async () => {
        await scanA11y(fakePage, []);
        expect(mockExclude).not.toHaveBeenCalled();
    });
});
