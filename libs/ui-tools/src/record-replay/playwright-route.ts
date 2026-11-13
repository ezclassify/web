/**
 * Playwright transport for the replayer. Intercepts matching network routes in
 * a browser test and fulfills them from recordings, so a UI spec can run with
 * no live backend. Tracks which recordings were hit and which requests missed
 * so a spec can assert coverage.
 */
import type { Page, Route } from '@playwright/test';
import { lookup, type ReplayerRecording } from './replayer';
import { routeRequest } from './route-request';

/** Options for {@link installReplayer}. */
export interface PlaywrightReplayerOptions {
    /** URL patterns to intercept. Defaults to the API and studio-API paths. */
    allowlist?: RegExp[];
}

/** Records which recordings served a request and which requests had none. */
export interface CoverageTracker {
    hits: Set<string>;
    misses: Array<{ path: string; body: unknown }>;
}

const DEFAULT_PATTERNS = [/\/api\//, /\/studio\/api\//];

/**
 * Route matching requests on the page through the recordings. Returns a tracker
 * the caller can inspect after the test to verify every expected request was
 * served and to surface any unrecorded calls.
 */
export function installReplayer(
    page: Page,
    recordings: Record<string, ReplayerRecording>,
    options: PlaywrightReplayerOptions = {},
): CoverageTracker {
    const patterns = options.allowlist ?? DEFAULT_PATTERNS;
    const tracker: CoverageTracker = { hits: new Set(), misses: [] };

    for (const pattern of patterns) {
        page.route(pattern, async (route: Route) => {
            const request = route.request();
            const { path, body } = routeRequest(
                request.url(),
                request.postData(),
            );
            const result = lookup(recordings, { path, body });
            if (result.kind === 'hit') {
                tracker.hits.add(path);
                await route.fulfill({
                    status: result.statusCode,
                    headers: result.headers,
                    contentType: 'application/json',
                    body: JSON.stringify(result.body),
                });
            } else {
                tracker.misses.push({ path, body });
                await route.fulfill({
                    status: 404,
                    contentType: 'application/json',
                    body: JSON.stringify(result.envelope),
                });
            }
        });
    }

    return tracker;
}
