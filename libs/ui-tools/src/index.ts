/**
 * @ezclassify/ui-tools: Playwright/browser test tooling for the JavaScript
 * packages.
 *
 * Bundles the shared crawler runtime (browser helpers, a11y scan, screenshot
 * baselines, status logging, and the resilient run loop) with HTTP record and
 * replay: one canonicalization core, a fetch transport and a Playwright route
 * transport.
 */
export * from './crawler-runtime';
export * from './record-replay';
export { installReplayer } from './record-replay/playwright-route';
export type {
    PlaywrightReplayerOptions,
    CoverageTracker,
} from './record-replay/playwright-route';
