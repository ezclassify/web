/**
 * The authoring claims that only a licensed deployment can settle.
 *
 * `golden-corpus.spec.ts` runs against the recorded wire corpus, which is what
 * makes the hosts runnable from a fresh clone. A replay server answers what
 * somebody recorded, so it cannot answer suggestions for characters nobody
 * typed into a recorder, and it carries no display colors for markings that
 * were never processed. The two cases below need both, so they need a real
 * deployment with a real scheme behind it.
 *
 * This file is inert unless `EZ_LICENSED_RUNTIME_STATUS_FILE` names a status
 * file. Nothing in this repository writes one. Whatever does owns booting the
 * deployment and pointing the variable at it; each host's dev server picks the
 * relay up from the same variable, so no other setup is needed here.
 *
 * The deployment's scheme content is supplied, never assumed. This repository
 * is public and its hosts carry no marking vocabulary from any scheme, so the
 * caller names what to type and what to expect back:
 *
 * - `EZ_CONSUMER_SUGGEST_PREFIX`: characters to type into the marking field.
 * - `EZ_CONSUMER_SUGGEST_OPTION`: text on a suggestion that prefix must offer.
 * - `EZ_CONSUMER_MARKING`: a complete marking the scheme accepts.
 * - `EZ_CONSUMER_MARKING_COLOR`: the CSS color the deployment sends for it on
 *   `ProcessResult.displayColor`, which is what makes the banner assertion
 *   wire-backed rather than locally themed.
 *
 * Run this lane by naming a status file and all four content variables. Missing
 * prerequisites fail discovery; successful runs require real answers.
 */

import { test, expect, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

/**
 * Scheme content the caller has to supply for this lane to mean anything.
 *
 * @param name - Environment variable to read.
 * @returns Its value.
 * @throws {Error} When the lane is on and the variable is not set.
 */
function required(name: string): string {
    const value = process.env[name];
    if (value) return value;
    throw new Error(
        `${name} is not set. The licensed-deployment lane is on ` +
            '(EZ_LICENSED_RUNTIME_STATUS_FILE names a status file), and these ' +
            "cases assert against the deployment scheme's own content, which " +
            'this repository does not carry. Set it to a value that scheme ' +
            'accepts.',
    );
}

/** Characters typed into the marking field to provoke suggestions. */
const SUGGEST_PREFIX = required('EZ_CONSUMER_SUGGEST_PREFIX');

/** Text on a suggestion those characters must offer. */
const SUGGEST_OPTION = required('EZ_CONSUMER_SUGGEST_OPTION');

/** A complete marking the deployment's scheme accepts. */
const MARKING = required('EZ_CONSUMER_MARKING');

/** The color the deployment sends for that marking, as CSS. */
const MARKING_COLOR = required('EZ_CONSUMER_MARKING_COLOR');

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

/**
 * Load the authoring page and wait for the deployment to answer.
 *
 * The composition line is the readiness signal: it is written from the Context
 * description the deployment resolved, so a page showing anything at all there
 * has completed a real round trip. What it says is the deployment's business,
 * not this file's.
 *
 * @param page - The page under test.
 * @returns Resolves once the answer is on screen.
 */
async function gotoAuthoring(page: Page): Promise<void> {
    await page.goto('/');
    await expect(page.getByTestId('composition')).not.toBeEmpty({
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

test.describe('integration host against a licensed deployment', () => {
    test('suggests concepts from the deployment as the author types', async ({
        page,
    }) => {
        /** Every scheme operation the browser sent. */
        const schemeCalls: string[] = [];
        page.on('request', (request) => {
            const url = request.url();
            if (url.includes('/scheme/suggest')) schemeCalls.push(url);
        });

        await gotoAuthoring(page);

        await expect(page.locator('.marking-field-host')).toBeVisible({
            timeout: 15_000,
        });

        // The resting display owns pointer input and focuses the native editor.
        await page.locator('.marking-field-display').click();
        await page
            .locator('.marking-field-host')
            .pressSequentially(SUGGEST_PREFIX, { delay: 80 });

        await expect(
            page
                .locator('[role="option"]', { hasText: SUGGEST_OPTION })
                .first(),
        ).toBeVisible({ timeout: 15_000 });
        // Rendered from an answer the deployment computed, not from a
        // scheme in the bundle: there is no scheme in the bundle.
        expect(schemeCalls.length).toBeGreaterThan(0);

        await captureEvidence(page, 'suggestions.png');
    });

    test('renders the processed marking in the banner, in the deployment colors', async ({
        page,
    }) => {
        await gotoAuthoring(page);

        await expect(page.locator('.marking-field-host')).toBeVisible({
            timeout: 15_000,
        });

        const editor = page.locator('.marking-field-host');
        await page.locator('.marking-field-display').click();
        await editor.fill(MARKING);
        await editor.blur();

        const banner = page.getByTestId('marking-banner');
        await expect(banner).toContainText(`Marking: ${MARKING}`, {
            timeout: 15_000,
        });
        await expect(banner.locator('.status-banner')).toHaveCSS(
            'background-color',
            MARKING_COLOR,
        );

        await captureEvidence(page, 'processed-marking.png');
    });
});
