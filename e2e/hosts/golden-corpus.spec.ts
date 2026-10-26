/**
 * Strict conformance lane: each integration host's client and components use
 * the golden wire corpus's recorded HTTP responses. Select it with
 * `EZ_INTEGRATION_SCENARIO=golden-corpus`. The README examples and licensed
 * deployments run their own specs because those backends serve different
 * Contexts.
 */

import { test, expect, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

/**
 * Where the screenshots land: the test's output directory, unless a run names
 * another with `EZ_E2E_EVIDENCE_DIR`.
 *
 * @returns Absolute directory for this run's screenshots.
 */
function evidenceDir(): string {
    const configured = process.env['EZ_E2E_EVIDENCE_DIR'];
    return configured ? path.resolve(configured) : test.info().outputDir;
}

/** The Context the wire corpus records, and the host is bound to. */
const CONTEXT = 'ez-full@1.0.0';

/** The scheme that Context resolves to, at the version it resolves to. */
const SCHEME = 'ez-test@1.0.0';

/**
 * Load the authoring page and wait for the wire to answer.
 *
 * The composition line is the readiness signal on purpose: it is written from
 * the Context description the server resolved, so a page showing it has
 * completed a real round trip rather than merely finished rendering.
 *
 * @param page - The page under test.
 * @returns Resolves once the answer is on screen.
 */
async function gotoAuthoring(page: Page): Promise<void> {
    await page.goto('/');
    await expect(page.getByTestId('composition')).toContainText(CONTEXT, {
        timeout: 30_000,
    });
}

/**
 * Save a screenshot into the evidence directory.
 *
 * @param page - The page under test.
 * @param name - File name, without a directory.
 * @returns Resolves once the file is on disk.
 */
async function captureEvidence(page: Page, name: string): Promise<void> {
    const directory = evidenceDir();
    await mkdir(directory, { recursive: true });
    await page.screenshot({
        path: path.join(directory, `${test.info().project.name}-${name}`),
        fullPage: true,
    });
}

test.describe('integration host against the golden wire corpus', () => {
    test('carries both credentials to the server and shows what it resolved', async ({
        page,
    }) => {
        /** Headers of every Context request the browser sent. */
        const contextRequests: Array<Record<string, string>> = [];
        page.on('request', (request) => {
            if (request.url().includes('/v1/ctx/')) {
                contextRequests.push(request.headers());
            }
        });

        await gotoAuthoring(page);

        // Two credentials reach the server: the person's bearer, and the
        // application's Context token that its backend holds. A browser sending
        // only one of them is the failure this asserts against. The replay
        // server runs its simulated authentication, so a missing bearer is not
        // merely unasserted here: the page would not have loaded.
        expect(contextRequests.length).toBeGreaterThan(0);
        for (const headers of contextRequests) {
            expect(headers['authorization']).toMatch(/^Bearer \S+/);
            expect(headers['x-ezclassify-context-token']).toBeTruthy();
        }

        // The version is the server's answer, not a constant in the bundle:
        // the host was told which scheme version it is authoring under.
        await expect(page.getByTestId('composition')).toContainText(
            `scheme ${SCHEME}`,
        );
        await expect(page.getByTestId('connection-error')).toHaveCount(0);

        await captureEvidence(page, 'connected.png');
    });

    test('enhances the visible native marking field and shows the banner', async ({
        page,
    }) => {
        await gotoAuthoring(page);
        await expect(
            page.locator('[data-ezclassify-mount="marking"]'),
        ).toHaveCount(1);
        await expect(page.getByTestId('marking-editor')).toHaveJSProperty(
            'tagName',
            'INPUT',
        );
        await expect(page.locator('.marking-field-host')).toBeVisible();
        await expect(page.getByTestId('marking-banner')).toContainText(
            'Marking: (empty)',
        );
    });
});
