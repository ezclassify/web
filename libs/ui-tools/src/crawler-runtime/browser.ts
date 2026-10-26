/**
 * Browser-side helpers shared by every accessibility crawler built on this
 * runtime.
 */
import type { Locator, Page } from '@playwright/test';

/** Enumeration record for one interactive element. */
export interface EnumeratedElement {
    locator: Locator;
    tag: string;
    role: string;
    testId: string;
    text: string;
}

/** Signals captured from page listeners during crawl passes. */
export interface PageSignals {
    consoleErrors: string[];
    pageErrors: string[];
    serverErrors: string[];
    rejections: string[];
}

/** Optional filters for page listeners. */
export interface PageListenerOptions {
    extraBenignPatterns?: string[];
}

/** Standard theme mode used by the crawler helpers. */
export type CrawlerTheme = 'light' | 'dark';

const DEFAULT_BENIGN_ERROR_PATTERNS = [
    'favicon',
    'net::ERR',
    'Failed to fetch',
    'Failed to load resource',
    'Content Security Policy',
];

/**
 * Force the page into a specific theme by writing the localStorage key the site
 * already reads during initialization.
 */
export async function setTheme(
    page: Page,
    storageKey: string,
    theme: string,
    dataTheme = theme,
): Promise<void> {
    const settings = { key: storageKey, value: theme, attr: dataTheme };
    await page.addInitScript(({ key, value }) => {
        try {
            localStorage.setItem(key, value);
        } catch {
            // Private-mode storage failures are tolerated.
        }
    }, settings);
    await page.evaluate(({ key, value, attr }) => {
        document.documentElement?.setAttribute('data-theme', attr);
        try {
            localStorage.setItem(key, value);
        } catch {
            // Private-mode storage failures are tolerated; the attribute still applies.
        }
    }, settings);
}

/** Resize the viewport and let layout settle. */
export async function setViewport(
    page: Page,
    width: number,
    height: number,
): Promise<void> {
    await page.setViewportSize({ width, height });
    await page.waitForTimeout(150);
}

/** Return true when an href stays on the current origin and is worth following. */
export function isSameOriginHref(
    href: string | null,
    origin: string,
    blockedHosts: RegExp = /(github|npmjs|npm\.im|anthropic|google|microsoft|apple)\./i,
): boolean {
    if (!href) return false;
    const trimmed = href.trim();
    if (trimmed === '' || trimmed === '#') return false;
    if (/^(mailto:|tel:|javascript:)/i.test(trimmed)) return false;
    if (/^https?:\/\//i.test(trimmed)) {
        try {
            const url = new URL(trimmed);
            if (url.origin !== origin) return false;
            if (blockedHosts.test(url.hostname)) return false;
            return true;
        } catch {
            return false;
        }
    }
    return trimmed.startsWith('/') || !/^[a-z]+:/i.test(trimmed);
}

/** Return true when a console error is known noise for crawl runs. */
export function isBenignConsoleError(message: string): boolean {
    return DEFAULT_BENIGN_ERROR_PATTERNS.some((pattern) =>
        message.includes(pattern),
    );
}

function isBenignConsoleErrorWithExtras(
    message: string,
    extraBenignPatterns: string[] = [],
): boolean {
    if (isBenignConsoleError(message)) return true;
    return extraBenignPatterns.some((pattern) => message.includes(pattern));
}

/** Install listeners that capture console/page/server errors during a crawl. */
export function attachPageListeners(
    page: Page,
    options: PageListenerOptions = {},
): PageSignals {
    const signals: PageSignals = {
        consoleErrors: [],
        pageErrors: [],
        serverErrors: [],
        rejections: [],
    };
    page.on('console', (msg) => {
        if (msg.type() !== 'error') return;
        const text = msg.text();
        if (
            isBenignConsoleErrorWithExtras(
                text,
                options.extraBenignPatterns ?? [],
            )
        )
            return;
        signals.consoleErrors.push(text);
    });
    page.on('pageerror', (err) => {
        if (err.name === 'UnhandledPromiseRejection') {
            signals.rejections.push(err.message);
        } else {
            signals.pageErrors.push(err.message);
        }
    });
    page.on('response', (resp) => {
        const status = resp.status();
        if (status >= 500 && status < 600) {
            signals.serverErrors.push(`${status} ${resp.url()}`);
        }
    });
    page.on('crash', () => {
        signals.rejections.push('page crashed');
    });
    page.on('dialog', (dialog) => {
        void dialog.dismiss().catch(() => {});
    });
    return signals;
}

/** Collect every interactive element visible on the page. */
export async function enumerateInteractiveElements(
    page: Page,
): Promise<EnumeratedElement[]> {
    const selector =
        'button, a[href], input:not([type=hidden]), select, textarea, [role="button"], [role="tab"], [role="menuitem"], [role="combobox"], [tabindex]:not([tabindex="-1"])';
    const count = await page.locator(selector).count();
    const results: EnumeratedElement[] = [];
    for (let i = 0; i < count; i += 1) {
        const locator = page.locator(selector).nth(i);
        try {
            const meta = await locator.evaluate((el) => {
                const anyEl = el as HTMLElement & { type?: string };
                return {
                    tag: el.tagName.toLowerCase(),
                    role: el.getAttribute('role') ?? '',
                    testId: el.getAttribute('data-testid') ?? '',
                    text: (el.textContent ?? '')
                        .slice(0, 64)
                        .replace(/\s+/g, ' ')
                        .trim(),
                    type: anyEl.type ?? '',
                    visible:
                        (el as HTMLElement).offsetParent !== null ||
                        (el as HTMLElement).getClientRects().length > 0,
                };
            });
            if (!meta.visible) continue;
            results.push({
                locator,
                tag: meta.tag,
                role: meta.role,
                testId: meta.testId,
                text: meta.text,
            });
        } catch {
            // Element may detach between count and evaluate. Skip it.
        }
    }
    return results;
}

/** Stable signature string for de-duplicating element interactions. */
export function elementSignature(el: EnumeratedElement): string {
    return `${el.tag}|${el.role}|${el.testId}|${el.text}`;
}

/** Drive a page through its visible interactive elements once. */
export async function exerciseInteractiveElements(
    page: Page,
    origin: string,
    budget: number,
    sampleInput: string,
): Promise<{ clicks: number; inputs: number }> {
    const seen = new Set<string>();
    let clicks = 0;
    let inputs = 0;
    const baselineUrl = page.url();
    const elements = await enumerateInteractiveElements(page);

    for (const element of elements) {
        if (clicks + inputs >= budget) break;
        const sig = elementSignature(element);
        if (seen.has(sig)) continue;
        seen.add(sig);

        try {
            if (element.tag === 'a') {
                const href = await element.locator
                    .getAttribute('href')
                    .catch(() => null);
                if (!isSameOriginHref(href, origin)) continue;
                await element.locator
                    .click({ timeout: 2000, trial: false })
                    .catch(() => {});
                clicks += 1;
                await page
                    .waitForLoadState('domcontentloaded', { timeout: 3000 })
                    .catch(() => {});
                if (page.url() !== baselineUrl) {
                    await page
                        .goto(baselineUrl, { waitUntil: 'domcontentloaded' })
                        .catch(() => {});
                    await page.waitForTimeout(200);
                }
                continue;
            }

            if (element.tag === 'input' || element.tag === 'textarea') {
                const type = await element.locator
                    .evaluate((el) => {
                        const anyEl = el as HTMLInputElement;
                        return anyEl.type ?? '';
                    })
                    .catch(() => '');
                if (
                    type === 'file' ||
                    type === 'submit' ||
                    type === 'button' ||
                    type === 'reset'
                )
                    continue;
                if (type === 'checkbox' || type === 'radio') {
                    await element.locator
                        .click({ timeout: 2000 })
                        .catch(() => {});
                    clicks += 1;
                    continue;
                }
                await element.locator
                    .fill(sampleInput, { timeout: 2000 })
                    .catch(() => {});
                inputs += 1;
                continue;
            }

            if (element.tag === 'select') {
                const optionCount = await element.locator
                    .locator('option')
                    .count()
                    .catch(() => 0);
                if (optionCount <= 1) continue;
                const value = await element.locator
                    .locator('option')
                    .nth(1)
                    .getAttribute('value')
                    .catch(() => null);
                if (value !== null) {
                    await element.locator
                        .selectOption(value, { timeout: 2000 })
                        .catch(() => {});
                    inputs += 1;
                }
                continue;
            }

            await element.locator.click({ timeout: 2000 }).catch(() => {});
            clicks += 1;
            await page.waitForTimeout(120);
        } catch {
            // One bad element should not abort the crawl.
        }
    }

    return { clicks, inputs };
}

/** Wait for a visible shell element and then settle on network idle if possible. */
export async function waitForShell(
    page: Page,
    selector: string,
    timeout = 15_000,
): Promise<void> {
    await page.locator(selector).first().waitFor({ state: 'visible', timeout });
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {
        // networkidle is best-effort; the UI can still be usable without it.
    });
}
