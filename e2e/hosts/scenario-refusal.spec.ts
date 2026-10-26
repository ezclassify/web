/**
 * Refusal scenarios: the replay server refuses the Context lookup, and each
 * integration host shows that refusal instead of an authoring surface. Select
 * one with `EZ_INTEGRATION_SCENARIO=context-not-found` or `version-not-found`.
 */

import { test, expect } from '@playwright/test';

const scenario = process.env['EZ_INTEGRATION_SCENARIO'];

for (const viewport of [
    { name: 'desktop', width: 1280, height: 800 },
    { name: 'phone', width: 390, height: 844 },
]) {
    test.describe(`${scenario} on ${viewport.name}`, () => {
        test.use({ viewport });

        test('shows the bootstrap refusal without an authoring surface', async ({
            page,
        }) => {
            const refusal = page.waitForResponse((response) =>
                response.url().includes('/v1/ctx/cedar-valley/1.0.0'),
            );
            await page.goto('/');
            expect((await refusal).status()).toBe(404);
            await expect(page.getByTestId('connection-error')).toContainText(
                scenario === 'context-not-found' ? 'no-such-context' : '9.9.9',
            );
            await expect(page.locator('.marking-field-host')).toHaveCount(0);
            await page.screenshot({
                path: test
                    .info()
                    .outputPath(`${viewport.name}-${scenario}.png`),
                fullPage: true,
                animations: 'disabled',
            });
        });
    });
}
