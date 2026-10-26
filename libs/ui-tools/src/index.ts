/**
 * @ezclassify/ui-tools: Playwright/browser test tooling for the JavaScript
 * packages.
 *
 * Bundles the shared crawler runtime (browser helpers, a11y scan, screenshot
 * baselines, status logging, and the resilient run loop) with the Playwright
 * record/replay transport. The record/replay canonicalization core stays in
 * `@ezclassify/testing-utils/record-replay`; this package layers the browser-
 * facing route handler on top of it.
 */
export * from './crawler-runtime';
export { installReplayer } from './record-replay/playwright-route';
export type {
    PlaywrightReplayerOptions,
    CoverageTracker,
} from './record-replay/playwright-route';
