# @ezclassify/ui-tools

Shared Playwright tooling for first-party EzClassify browser tests. It provides
page interaction helpers, accessibility scans, screenshot baseline management,
crawler status logging and a run loop, plus a network replay transport.
It does not mount UI components, start an application or supply an engine.

This package is outside the public workspace install closure. It depends on
private `@ezclassify/testing-utils` and is distributed through the development
mirror, not npmjs.org. A public UI consumer does not need it.

## Setup and verification

Use Node.js 22 or 24 and the private registry configuration described in
[DEVELOPMENT.md](../../DEVELOPMENT.md). From the Web repository root:

```bash
npm install --prefix libs/ui-tools --ignore-scripts --tag=dev
npm run build --prefix libs/ui-tools
npm test --prefix libs/ui-tools
```

The root install and test command exclude this package. Its build produces
ESM, CommonJS and TypeScript declarations under `dist/lib`. To check the package
contents as well as the build and tests:

```bash
cd libs/ui-tools
npm run verify:publish-ready
```

Consumers install `@ezclassify/ui-tools` from the development mirror as a
development dependency and import from its package root. Browser tests also
need a Playwright browser installed and their own application or fixture server.
The library does not download a browser or launch a server for them.

## Check a browser page

This example runs inside a consumer's Playwright suite. Configure `baseURL` and
serve an application with a visible `main` element before running it.

```ts
import { test, expect } from '@playwright/test';
import {
    attachPageListeners,
    scanA11y,
    setViewport,
    waitForShell,
} from '@ezclassify/ui-tools';

test('page is usable at a phone viewport', async ({ page }) => {
    const signals = attachPageListeners(page);
    await setViewport(page, 390, 844);
    await page.goto('/');
    await waitForShell(page, 'main');

    const accessibility = await scanA11y(page);
    expect(accessibility.violations).toEqual([]);
    expect(signals.pageErrors).toEqual([]);
    expect(signals.serverErrors).toEqual([]);
    expect(signals.rejections).toEqual([]);
});
```

`scanA11y` selects WCAG 2 A/AA and WCAG 2.1 A/AA axe rules. Its optional second
argument excludes CSS selectors; keep any exclusion specific and justified.
`attachPageListeners` records console errors, page errors, HTTP 5xx responses
and unhandled rejections, and dismisses dialogs. Its console filter ignores
common network/CSP messages, so an empty `consoleErrors` list alone does not
prove successful network access.

`setTheme(page, storageKey, theme, dataTheme?)` sets local storage for subsequent
navigation and the current document's `data-theme` attribute. The caller
supplies the application's actual storage key. `enumerateInteractiveElements`
and `exerciseInteractiveElements` can drive a bounded interaction pass; run
these against test data because they fill fields and activate controls.

## Replay recorded HTTP responses

`installReplayer` serves matching browser requests from a recordings map and
returns hit/miss tracking. The map uses the canonical recording keys from
`@ezclassify/testing-utils/record-replay`, not URL strings as keys.

```ts
import { test, expect } from '@playwright/test';
import { computeRecordingKey } from '@ezclassify/testing-utils/record-replay';
import { installReplayer } from '@ezclassify/ui-tools';

test('replays the application response', async ({ page }) => {
    const recordings = {
        [computeRecordingKey('/api/example', null)]: {
            statusCode: 200,
            body: { ready: true },
        },
    };
    const coverage = installReplayer(page, recordings, {
        allowlist: [/\/api\/example$/],
    });
    await page.goto('/');
    const response = await page.evaluate(async () => {
        const result = await fetch('/api/example');
        return result.json();
    });
    expect(response).toEqual({ ready: true });
    expect(coverage.hits.has('/api/example')).toBe(true);
    expect(coverage.misses).toEqual([]);
});
```

Install routes before navigation. The default allowlist matches `/api/` and
`/studio/api/`; explicitly select other paths when needed. Matching uses the
normalized path and parsed JSON request body. Non-JSON bodies are treated as
`null`. An unrecorded matching request receives HTTP 404 with a `no_recording`
envelope and appears in `misses`; requests outside the allowlist use the normal
network. Hits identify paths, not individual recording keys. This package
replays recordings; their generation and canonicalization belong to
`@ezclassify/testing-utils`.

## Baselines and crawler runs

`compareAgainstBaseline` takes a PNG `Buffer`, a baseline directory and a key
containing `persona`, `route`, `viewport`, `theme` and `slot`. It returns
`bootstrapped`, `matched`, `updated` or `failed`. It writes the initial baseline
and replaces one after drift only when the configured intent check explicitly
accepts the capture. A missing or failed check returns `failed` and preserves
the existing baseline.

The comparison uses byte hashes and a sampled byte-difference ratio, not a
pixel-diff algorithm. When `ANTHROPIC_API_KEY` is configured, the helper sends
the screenshot and supplied intent to Anthropic for its optional intent check.
Without a key or intent, or when that service fails, an initial capture can
still establish a baseline and reports why it was not checked. An existing
baseline with drift beyond the threshold stays unchanged and returns `failed`
until a check explicitly accepts the capture. Byte-identical and within-threshold
comparisons remain matches. Review the returned `reason`; baseline acceptance
is not independent proof of visual correctness. Use appropriate test data and
authorization before enabling external screenshot analysis.

`appendCrawlerStatus` appends structured observations to a caller-selected log.
`runCrawlerLoop` repeatedly spawns the supplied crawler command, tracks an
iteration file, writes heartbeats and applies a timeout. It runs until
interrupted; it is not a one-shot test runner. Configure its working directories,
command, environment and output paths explicitly. Optional `killPatterns` run
process-name cleanup, so use only narrowly owned test-process patterns.

Licensed under Apache-2.0; see [LICENSE](./LICENSE) and [NOTICE](./NOTICE).
