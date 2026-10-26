/** Shared a11y scan wrapper for crawler passes. */
import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';

/** Compact violation record suitable for structured logs. */
export interface A11yViolation {
    id: string;
    impact: string;
    help: string;
    nodes: number;
    sampleTargets?: string[];
}

/** Output of one a11y scan. */
export interface A11yScanResult {
    violations: A11yViolation[];
    pass: boolean;
}

interface AxeNodeResult {
    target: string[] | string;
}

interface AxeViolationResult {
    id: string;
    impact?: string | null;
    help: string;
    nodes: AxeNodeResult[];
}

interface AxeScanResult {
    violations: AxeViolationResult[];
}

/** Run axe-core's default WCAG 2.1 AA rule set against the current document. */
export async function scanA11y(
    page: Page,
    skip: string[] = [],
): Promise<A11yScanResult> {
    const builder = new AxeBuilder({ page }).withTags([
        'wcag2a',
        'wcag2aa',
        'wcag21a',
        'wcag21aa',
    ]);
    for (const selector of skip) {
        builder.exclude(selector);
    }
    const result = (await builder.analyze()) as AxeScanResult;
    const violations = result.violations.map((v: AxeViolationResult) => ({
        id: v.id,
        impact: v.impact ?? 'unknown',
        help: v.help,
        nodes: v.nodes.length,
        sampleTargets: v.nodes
            .slice(0, 3)
            .map((n: AxeNodeResult) =>
                Array.isArray(n.target) ? n.target.join(' ') : String(n.target),
            )
            .filter(Boolean),
    }));
    return { violations, pass: violations.length === 0 };
}
