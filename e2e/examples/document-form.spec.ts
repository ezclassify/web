/**
 * The README document form, driven the way its README describes, against the
 * Cedar Valley replay server.
 *
 * Each project is one example app: vanilla, React, Vue or Angular, each the
 * README's code and nothing else. The path is the one the Cedar Valley scenario
 * records: load, focus every control, open and browse each picker, open the
 * marking popup in the title and body, set the document to CONFIDENTIAL, edit
 * the title and body, then leave the form. The replay server answers recorded
 * requests and refuses the rest with a 501, so a run with no failed response is
 * proof the example sends exactly what the README promises.
 *
 * A second test loads the same form with the page's fields set in a monospace
 * face, as a host that styles its textareas that way does, and checks that the
 * library's chrome keeps the page font while the field text keeps the field's.
 */

import {
    expect,
    test,
    type Locator,
    type Page,
    type Request,
} from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

/** Where the screenshots land: the test's output, unless a run names a place. */
async function evidencePath(name: string): Promise<string> {
    const configured = process.env['EZ_E2E_EVIDENCE_DIR'];
    if (!configured) return test.info().outputPath(name);
    const directory = path.resolve(configured);
    await mkdir(directory, { recursive: true });
    return path.join(directory, name);
}

/** What the page sent and saw, for the assertions at the end. */
interface Observed {
    /** Wire requests still waiting for an answer. */
    readonly pending: Set<Request>;
    /** Every wire response that was not a success. */
    readonly failures: string[];
    /** Console errors and uncaught exceptions. */
    readonly errors: string[];
    /** When the wire last did anything. */
    last: number;
    /** The README step in progress, named in each failure. */
    step: string;
}

/**
 * Watch the wire and the console for the life of the page.
 *
 * @param page - The page under test.
 * @returns The live observation record.
 */
function observe(page: Page): Observed {
    const observed: Observed = {
        pending: new Set(),
        failures: [],
        errors: [],
        last: Date.now(),
        step: 'load',
    };
    const wire = (url: string) => url.includes('/v1/');
    page.on('request', (request) => {
        if (!wire(request.url())) return;
        observed.pending.add(request);
        observed.last = Date.now();
    });
    const settled = (request: Request) => {
        observed.pending.delete(request);
        observed.last = Date.now();
    };
    page.on('requestfinished', (request) => {
        if (wire(request.url())) settled(request);
    });
    page.on('requestfailed', (request) => {
        if (!wire(request.url())) return;
        settled(request);
        // The form cancels work a later edit supersedes; that is not a fault.
        if (request.failure()?.errorText === 'net::ERR_ABORTED') return;
        observed.failures.push(
            `[${observed.step}] transport failure: ${request.url()}`,
        );
    });
    page.on('response', (response) => {
        if (!wire(response.url()) || response.status() < 400) return;
        // The request body names exactly what was not recorded.
        const body = response.request().postData();
        observed.failures.push(
            `[${observed.step}] ${response.status()} ${response.url()}${body ? ` ${body}` : ''}`,
        );
    });
    page.on('console', (message) => {
        if (message.type() === 'error')
            observed.errors.push(`[${observed.step}] ${message.text()}`);
    });
    page.on('pageerror', (error) =>
        observed.errors.push(`[${observed.step}] ${String(error)}`),
    );
    return observed;
}

/**
 * Wait until the wire has been quiet long enough for every debounce to fire.
 *
 * The marked text area scans 300 ms after an edit and rollups debounce for 30
 * ms, so 800 ms with nothing in flight means nothing more is coming.
 *
 * @param observed - The page's observation record.
 */
async function settle(observed: Observed): Promise<void> {
    await expect
        .poll(
            () =>
                observed.pending.size === 0 &&
                Date.now() - observed.last >= 800,
            { timeout: 30_000 },
        )
        .toBe(true);
}

/**
 * Field controls whose text runs into their own chrome: the layer on screen has
 * its content box, or a line of its text, reaching past the chrome's leading
 * edge. The chrome is the status mark, favorites and clear at the trailing
 * edge, and the text layers reserve its room at rest and while focused.
 *
 * @param page - The page under test.
 * @returns One entry per overlapping control; empty when every one reads clear.
 */
async function chromeOverlaps(page: Page): Promise<string[]> {
    return page.locator(FIELD_CONTROLS).evaluateAll((wraps) =>
        wraps.flatMap((wrap) => {
            const chrome = wrap.querySelector(':scope > .ez-field-chrome');
            if (!chrome) return [`${wrap.className}: no chrome`];
            const layer = wrap.matches('.tag-input-wrap')
                ? wrap
                : [
                      ...wrap.querySelectorAll<HTMLElement>(
                          ':scope > .marking-field-host, :scope > .marking-field-display, :scope > .marked-input-display, :scope > .marked-textarea-display',
                      ),
                  ].find((shown) =>
                      shown.checkVisibility({ opacityProperty: true }),
                  );
            if (!layer) return [`${wrap.className}: no text layer`];
            const edge = chrome.getBoundingClientRect().left;
            const box = layer.getBoundingClientRect();
            const style = getComputedStyle(layer);
            const content =
                box.right -
                parseFloat(style.borderRightWidth) -
                parseFloat(style.paddingRight);
            let text = 0;
            const walker = document.createTreeWalker(
                layer,
                NodeFilter.SHOW_TEXT,
            );
            for (let node = walker.nextNode(); node; node = walker.nextNode()) {
                if (chrome.contains(node)) continue;
                const range = document.createRange();
                range.selectNodeContents(node);
                for (const rect of range.getClientRects())
                    text = Math.max(text, rect.right);
            }
            return content > edge || text > edge
                ? [
                      `${wrap.className}: text to ${Math.max(content, text)}, chrome at ${edge}`,
                  ]
                : [];
        }),
    );
}

/**
 * Status marks whose color does not say what the field has: muted while it has
 * nothing to say, the field's own text color once it has a message.
 *
 * @param page - The page under test.
 * @returns One entry per mismatched mark.
 */
async function markToneMismatches(page: Page): Promise<string[]> {
    return page
        .locator('.ez-field-chrome .ez-status-mark')
        .evaluateAll((marks) =>
            marks.flatMap((mark) => {
                const quiet = mark.classList.contains('ez-status-mark--quiet');
                const color = getComputedStyle(mark).color;
                const expected = quiet
                    ? 'rgb(156, 163, 175)'
                    : getComputedStyle(mark.parentElement!).color;
                return color === expected
                    ? []
                    : [`${quiet ? 'quiet' : 'message'} mark is ${color}`];
            }),
        );
}

/** The outer element of each of the five field controls. */
const FIELD_CONTROLS =
    '.marking-field-wrap, .tag-input-wrap, .marked-input-wrap, .marked-textarea-wrap';

/**
 * The edge each field control shows: its border width, style and color on every
 * side, read from whichever layer is on screen (a MarkingField swaps its
 * painted display for its editor while focused).
 *
 * @param page - The page under test.
 * @returns One edge description per control, in document order.
 */
async function fieldEdges(page: Page): Promise<string[]> {
    return page.locator(FIELD_CONTROLS).evaluateAll((wraps) =>
        wraps.map((wrap) => {
            const shown =
                [
                    ...wrap.querySelectorAll<HTMLElement>(
                        ':scope > .marking-field-host, :scope > .marking-field-display, :scope > .marked-input-display, :scope > .marked-textarea-display',
                    ),
                ].find((layer) =>
                    layer.checkVisibility({ opacityProperty: true }),
                ) ?? wrap;
            const style = getComputedStyle(shown);
            return (['Top', 'Right', 'Bottom', 'Left'] as const)
                .map(
                    (side) =>
                        `${style[`border${side}Width`]} ${style[`border${side}Style`]} ${style[`border${side}Color`]}`,
                )
                .join(', ');
        }),
    );
}

/**
 * The outlines drawn inside the field control a field belongs to: every element
 * in it with a visible outline. Read before and after focusing the field, the
 * difference is the focus rings, so a stray ring on a hidden editor layer shows
 * up next to the one the control means to draw.
 *
 * @param field - A field inside the control.
 * @returns The class name of each outlined element.
 */
async function outlines(field: Locator): Promise<string[]> {
    return field.evaluate((element, controls) => {
        const control = element.closest(controls);
        if (!control) return [];
        return [control, ...control.querySelectorAll('*')].flatMap((inner) => {
            const style = getComputedStyle(inner);
            const drawn =
                style.outlineStyle !== 'none' &&
                parseFloat(style.outlineWidth) > 0;
            return drawn ? [inner.className] : [];
        });
    }, FIELD_CONTROLS);
}

test('resizes the focused MarkingField when its text has less room', async ({
    page,
}) => {
    const observed = observe(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    const field = page.locator('textarea.marking-field-host').first();
    const wrap = page.locator('.marking-field-wrap').first();
    await expect(field).toHaveValue('INTERNAL');
    await field.focus();
    await settle(observed);

    const heights = () =>
        field.evaluate((element) => ({
            width: element.clientWidth,
            visible: element.clientHeight,
            content: element.scrollHeight,
        }));
    const initial = await heights();
    expect(initial.content).toBe(initial.visible);

    await wrap.evaluate((element) => (element.style.maxWidth = '125px'));
    await expect
        .poll(async () => (await heights()).visible)
        .toBeGreaterThan(initial.visible);
    expect((await heights()).content).toBe((await heights()).visible);

    await wrap.evaluate((element) => (element.style.maxWidth = '220px'));
    await expect
        .poll(async () => (await heights()).visible)
        .toBe(initial.visible);
    const wider = await heights();

    // The trailing control padding can change without changing the outer width.
    await wrap
        .locator('.ez-field-chrome')
        .evaluate((element) => element.style.setProperty('min-width', '175px'));
    await expect
        .poll(async () => (await heights()).visible)
        .toBeGreaterThan(initial.visible);
    const padded = await heights();
    expect(padded.width).toBe(wider.width);
    expect(padded.content).toBe(padded.visible);
    await expect(field).toHaveValue('INTERNAL');
    await settle(observed);
    expect(observed.failures).toEqual([]);
    expect(observed.errors).toEqual([]);
});

for (const viewport of [
    { name: 'desktop', width: 1280, height: 900 },
    { name: 'phone', width: 390, height: 844 },
]) {
    test.describe(`README document form on ${viewport.name}`, () => {
        test.use({ viewport });

        test('takes category colors and geometry from a host stylesheet', async ({
            page,
        }) => {
            const observed = observe(page);
            await page.goto('/');
            const underline = page
                .locator(
                    '.marking-field-token[data-category-name="Protection"] .marking-field-token-run',
                )
                .first();
            const chip = page
                .locator('.proto-tag[data-category-id="level"]')
                .first();
            await expect(underline).toBeVisible();
            await expect(chip).toBeVisible();
            const mount = page
                .locator('[data-ezclassify-mount="tags"]')
                .first();
            await expect(mount).toBeAttached();

            const summary = page.locator('input[name="summaryMarking"]');
            const summaryBefore = await summary.inputValue();

            await page.addStyleTag({
                content: `
                form {
                    --ez-border-radius: 1rem;
                }
                form .marking-field-token[data-category-name="Protection"] {
                    --ez-category-accent: rgb(81, 68, 161);
                }
                form .proto-tag[data-category-id="level"] {
                    --ez-category-background: rgb(238, 234, 255);
                    --ez-category-text: rgb(52, 39, 117);
                }
            `,
            });
            await expect(underline).toHaveCSS(
                'text-decoration-color',
                'rgb(81, 68, 161)',
            );
            await expect(chip).toHaveCSS(
                'background-color',
                'rgb(238, 234, 255)',
            );
            await expect(chip).toHaveCSS('color', 'rgb(52, 39, 117)');
            await expect
                .poll(() =>
                    mount.evaluate((element) =>
                        getComputedStyle(element)
                            .getPropertyValue('--ez-border-radius')
                            .trim(),
                    ),
                )
                .toBe('1rem');
            await expect(
                page.locator('input[name="documentMarking"]'),
            ).toHaveValue('INTERNAL');
            await expect(summary).toHaveValue(summaryBefore);
            await settle(observed);
            expect(observed.failures).toEqual([]);
            expect(observed.errors).toEqual([]);
        });

        test('runs the README path against the replay with no refused request', async ({
            page,
        }, info) => {
            const observed = observe(page);
            const shot = async (step: string) =>
                page.screenshot({
                    path: await evidencePath(
                        `${info.project.name}-${viewport.name}-${step}.png`,
                    ),
                    fullPage: true,
                    animations: 'disabled',
                });

            const fields = {
                document: page.locator('textarea[role=combobox]').nth(0),
                attachment: page.locator('textarea[role=combobox]').nth(1),
                summary: page.locator('input.tag-input-filter'),
                title: page.locator('textarea.marked-input-native'),
                body: page.locator('textarea#body'),
            };

            await page.goto('/');
            await expect(fields.document).toBeVisible({ timeout: 60_000 });
            await expect(fields.body).toBeVisible();
            await settle(observed);
            await shot('load');

            // The single-line controls share one height, and all five field
            // controls share one edge, whatever each one mirrors from the
            // native input or textarea it enhances.
            const heights = await page
                .locator(
                    '.marking-field-display, .tag-input-wrap, .marked-input-display',
                )
                .evaluateAll((elements) =>
                    elements.map((element) =>
                        Math.round(element.getBoundingClientRect().height),
                    ),
                );
            expect(heights).toHaveLength(4);
            expect(new Set(heights).size).toBe(1);
            const edges = await fieldEdges(page);
            expect(edges).toHaveLength(5);
            expect(edges).toEqual(edges.map(() => edges[0]));
            // The search hint beside the chips is whole, never cut by the
            // field's chrome lane.
            const hint = await fields.summary.evaluate(
                (filter: HTMLInputElement) => {
                    const probe = document.createElement('span');
                    probe.textContent = filter.placeholder;
                    probe.style.cssText = 'position:absolute;white-space:pre';
                    const style = getComputedStyle(filter);
                    probe.style.font = style.font;
                    document.body.append(probe);
                    const width =
                        probe.getBoundingClientRect().width +
                        parseFloat(style.paddingLeft);
                    probe.remove();
                    return { width, room: filter.clientWidth };
                },
            );
            expect(hint.width).toBeLessThanOrEqual(hint.room);
            expect(await chromeOverlaps(page)).toEqual([]);
            expect(await markToneMismatches(page)).toEqual([]);

            for (const [id, field] of Object.entries(fields)) {
                observed.step = `focus-${id}`;
                const atRest = await outlines(field);
                await field.focus();
                await settle(observed);
                // Focus adds one ring inside the edge; the edge itself holds.
                expect(await fieldEdges(page)).toEqual(edges);
                expect(await chromeOverlaps(page)).toEqual([]);
                const focused = await outlines(field);
                expect(focused.length, focused.join(' / ')).toBe(
                    atRest.length + 1,
                );
            }

            const composer = page.locator('.ez-composer:not([hidden])');
            for (const id of ['document', 'attachment', 'summary'] as const) {
                observed.step = `browse-${id}`;
                await fields[id].focus();
                await page.keyboard.press('Alt+ArrowDown');
                await expect(composer).toBeVisible();
                await settle(observed);
                // The field's chrome stays inline, clear of the field's text.
                expect(await chromeOverlaps(page)).toEqual([]);
                const field = fields[id];
                const value = await field.inputValue();
                const headings = composer.locator(
                    '.ez-composer__group-label[data-category-id]',
                );
                const categories = await headings.evaluateAll((elements) =>
                    elements.map(
                        (element) =>
                            (element as HTMLElement).dataset['categoryId'],
                    ),
                );
                expect(categories.length).toBeGreaterThan(2);
                const active = composer.locator('.ez-composer__row--active');
                await expect(field).toHaveAttribute(
                    'aria-keyshortcuts',
                    'Alt+ArrowUp Alt+ArrowDown',
                );
                // Move onto the first row, so a definition loads, then jump
                // through the next two categories. A field with fixes lists
                // them first, so the first category reached depends on it.
                await page.keyboard.press('ArrowDown');
                await page.keyboard.press('Alt+ArrowDown');
                const first = categories.indexOf(
                    (await active.getAttribute('data-category-id')) ?? '',
                );
                expect(first).toBeGreaterThanOrEqual(0);
                expect(first + 1).toBeLessThan(categories.length);
                await page.keyboard.press('Alt+ArrowDown');
                await expect(active).toHaveAttribute(
                    'data-category-id',
                    categories[first + 1]!,
                );
                await settle(observed);
                // The heading arrows are the pointer's way to do the same.
                // They stay out of the accessibility tree, so click them.
                await headings
                    .nth(first + 1)
                    .locator(
                        '.ez-composer__category-arrow[data-direction="up"]',
                    )
                    .click();
                await expect(active).toHaveAttribute(
                    'data-category-id',
                    categories[first]!,
                );
                await headings
                    .nth(first)
                    .locator(
                        '.ez-composer__category-arrow[data-direction="down"]',
                    )
                    .click();
                await expect(active).toHaveAttribute(
                    'data-category-id',
                    categories[first + 1]!,
                );
                await settle(observed);
                // Browsing never changes the marking or moves focus.
                await expect(field).toHaveValue(value);
                await expect(field).toBeFocused();
                await expect(
                    composer.locator('.ez-composer__definition').first(),
                ).not.toBeEmpty();
                await shot(`browse-${id}`);
                await page.keyboard.press('Escape');
                await expect(composer).toHaveCount(0);
                await settle(observed);
            }

            for (const id of ['title', 'body'] as const) {
                observed.step = `marking-${id}`;
                await fields[id].focus();
                await page.keyboard.press('ControlOrMeta+Enter');
                await expect(composer).toBeVisible();
                await settle(observed);
                await shot(`marking-${id}`);
                await page.keyboard.press('Escape');
                await expect(composer).toHaveCount(0);
                await settle(observed);
            }

            observed.step = 'set-document';
            await page
                .getByRole('button', { name: 'Set document to CONFIDENTIAL' })
                .click();
            await settle(observed);
            await shot('set-document');

            observed.step = 'edit-title';
            await fields.title.fill('(PUBLIC) District report card');
            await settle(observed);
            observed.step = 'edit-body';
            await fields.body.fill(
                '(CONFIDENTIAL) Planning notes.\n(PUBLIC) Published background.',
            );
            await settle(observed);
            observed.step = 'blur';
            await page.locator('body').click({ position: { x: 4, y: 4 } });
            await settle(observed);
            await shot('final');

            // The authored whole and its computed parts agree, and nothing on
            // the form reports a broken rule.
            const banners = page.locator(
                '[data-ezclassify-controller="banner"]',
            );
            await expect(banners).toHaveCount(2);
            await expect(banners.nth(0)).toHaveText('CONFIDENTIAL');
            await expect(banners.nth(1)).toHaveText('CONFIDENTIAL');
            await expect(
                page.locator('input[name="documentMarking"]'),
            ).toHaveValue('CONFIDENTIAL');
            await expect(page.locator('input[name="title"]')).toHaveValue(
                '(PUBLIC) District report card',
            );
            await expect(page.locator('textarea[name="body"]')).toHaveValue(
                '(C) Planning notes.\n(PUBLIC) Published background.',
            );
            await expect(page.locator('[data-ezclassify-invalid]')).toHaveCount(
                0,
            );
            await expect(
                page.locator('.rule-errors, .ez-parent-validation-notice'),
            ).toHaveCount(0);

            expect(observed.failures).toEqual([]);
            expect(observed.errors).toEqual([]);
            expect(
                await page.evaluate(() => document.documentElement.scrollWidth),
            ).toBeLessThanOrEqual(viewport.width);
        });
    });
}

test.describe('README document form beside monospace fields', () => {
    test.use({ viewport: { width: 1280, height: 900 } });

    test("keeps the page font in the library's chrome and the field's font in its text", async ({
        page,
    }, info) => {
        const observed = observe(page);
        // A host stylesheet that sets its fields in a monospace face. Adopted
        // before the page loads, so the fields mirror it when they enhance.
        await page.addInitScript(() => {
            const sheet = new CSSStyleSheet();
            sheet.replaceSync(
                'input, textarea { font-family: "Courier New", monospace; }',
            );
            document.adoptedStyleSheets = [
                ...document.adoptedStyleSheets,
                sheet,
            ];
        });
        const family = (locator: Locator) =>
            locator.evaluate((element) => getComputedStyle(element).fontFamily);

        await page.goto('/');
        const body = page.locator('textarea#body');
        const summary = page.locator('input.tag-input-filter');
        await expect(body).toBeVisible({ timeout: 60_000 });
        await settle(observed);

        const pageFont = await family(page.locator('body'));
        const fieldFont = await family(body);
        expect(fieldFont).toContain('monospace');
        expect(pageFont).not.toContain('monospace');

        // The field's own text keeps the control's face.
        expect(await family(page.locator('.marked-textarea-display'))).toBe(
            fieldFont,
        );
        // The marking action beside the field reads the page font.
        const markingAction = page.getByRole('button', {
            name: /^Add marking$/i,
        });
        await expect(markingAction).toBeVisible();
        expect(await family(markingAction)).toBe(pageFont);

        // The composer, portaled to the body, reads the page font whether it
        // opens from the tag field or the text area's inline editor, in the
        // README path's order.
        const composer = page.locator('.ez-composer:not([hidden])');
        observed.step = 'browse-summary';
        await summary.focus();
        await page.keyboard.press('Alt+ArrowDown');
        await expect(composer).toBeVisible();
        await settle(observed);
        expect(await family(composer)).toBe(pageFont);
        await page.keyboard.press('Escape');
        await expect(composer).toHaveCount(0);
        await settle(observed);

        observed.step = 'marking-body';
        await body.focus();
        await page.keyboard.press('ControlOrMeta+Enter');
        await expect(composer).toBeVisible();
        await settle(observed);
        expect(await family(composer)).toBe(pageFont);
        expect(
            await family(composer.locator('.ez-composer__group-label').first()),
        ).toBe(pageFont);
        await page.screenshot({
            path: await evidencePath(
                `${info.project.name}-monospace-marking-body.png`,
            ),
            animations: 'disabled',
        });
        await page.keyboard.press('Escape');
        await expect(composer).toHaveCount(0);
        await settle(observed);

        expect(observed.failures).toEqual([]);
        expect(observed.errors).toEqual([]);
    });
});
