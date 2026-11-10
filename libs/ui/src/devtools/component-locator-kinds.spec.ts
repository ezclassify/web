/**
 * What the "Highlight components" overlay finds, and how it shows each kind.
 *
 * The overlay derives what it finds from the library's attribute registry. The
 * walk below reads the attribute reference (`docs/attributes.md`) instead, so
 * an attribute documented for authors but missing from the registry fails here
 * and the reference and the overlay cannot drift apart.
 */
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createComponentLocator } from './component-locator';
import { adoptedStyleTexts } from '../styles/adopt';
import { setMountHost } from '../mount-host-registry';

const ATTRIBUTES_MD = path.resolve(
    import.meta.dirname,
    '../../docs/attributes.md',
);

/**
 * Host options: they configure a host the overlay already finds by its own
 * attributes and mark no region by themselves. A new author attribute in the
 * reference must be found by the overlay or be added here on purpose.
 */
const HOST_OPTIONS = new Set([
    'data-ezclassify-category',
    'data-ezclassify-format',
    'data-ezclassify-role',
    'data-ezclassify-scope',
    'data-ezclassify-show-when-parent-has',
    'data-ezclassify-hide-when-parent-has',
    'data-ezclassify-error-target',
    'data-ezclassify-no-tooltips',
    'data-ezclassify-no-hints',
]);

/** Every author attribute in the reference's host-level table. */
function documentedAuthorAttributes(): string[] {
    const markdown = readFileSync(ATTRIBUTES_MD, 'utf8');
    const start = markdown.indexOf('## Host-level attributes');
    const end = markdown.indexOf('\n## ', start + 1);
    const section = markdown.slice(start, end);
    const attributes: string[] = [];
    for (const line of section.split('\n')) {
        const row =
            /^\|\s*`(data-ezclassify-[a-z-]+)`\s*\|[^|]*\|\s*(\w+)\s*\|/.exec(
                line,
            );
        if (row && row[2] === 'author') attributes.push(row[1]);
    }
    return attributes;
}

/** Give an element a nonzero box; jsdom lays nothing out. */
function rendered(element: HTMLElement, width = 240, height = 48): void {
    element.getBoundingClientRect = () =>
        ({
            x: 0,
            y: 0,
            top: 0,
            left: 0,
            right: width,
            bottom: height,
            width,
            height,
            toJSON: () => ({}),
        }) as DOMRect;
}

/** A rendered target holding `html`, every element given a box. */
function page(html: string): HTMLElement {
    const target = document.createElement('div');
    target.innerHTML = html;
    rendered(target, 600, 400);
    for (const element of target.querySelectorAll<HTMLElement>('*'))
        rendered(element);
    document.body.append(target);
    return target;
}

/** The attributes in `attributes` that the given locator module misses. */
async function missedBy(
    create: typeof createComponentLocator,
    attributes: string[],
): Promise<string[]> {
    const missed: string[] = [];
    for (const attribute of attributes) {
        const target = page('<div id="probe"></div>');
        const probe = target.querySelector<HTMLElement>('#probe')!;
        probe.setAttribute(attribute, 'probe');
        const locator = create({ target, active: true });
        if (!probe.hasAttribute('data-ezclassify-xray-kind'))
            missed.push(attribute);
        locator.destroy();
        target.remove();
    }
    return missed;
}

describe('the overlay finds every attribute the reference documents', () => {
    afterEach(() => {
        document.body.replaceChildren();
        vi.doUnmock('../binding-model');
        vi.resetModules();
    });

    it('reads a non-trivial attribute list from the reference', () => {
        const documented = documentedAuthorAttributes();
        expect(documented).toEqual(
            expect.arrayContaining([
                'data-ezclassify-controller',
                'data-ezclassify-marking',
                'data-ezclassify-whole',
                'data-ezclassify-aggregate',
                'data-ezclassify-ignore',
                'data-ezclassify-powered',
            ]),
        );
    });

    it('outlines an element that carries any one of them alone', async () => {
        const regions = documentedAuthorAttributes().filter(
            (attribute) => !HOST_OPTIONS.has(attribute),
        );
        expect(await missedBy(createComponentLocator, regions)).toEqual([]);
    });

    it('fails when the registry loses an attribute the reference documents', async () => {
        // Negative control: the same walk against an overlay built from a
        // registry without member-of reports exactly that attribute.
        vi.resetModules();
        vi.doMock('../binding-model', async (importOriginal) => {
            const actual =
                await importOriginal<typeof import('../binding-model')>();
            return {
                ...actual,
                STRUCTURAL_ATTRS: actual.STRUCTURAL_ATTRS.filter(
                    (attribute) => attribute !== 'data-ezclassify-member-of',
                ),
            };
        });
        const reduced = await import('./component-locator');
        const regions = documentedAuthorAttributes().filter(
            (attribute) => !HOST_OPTIONS.has(attribute),
        );
        expect(await missedBy(reduced.createComponentLocator, regions)).toEqual(
            ['data-ezclassify-member-of'],
        );
    });
});

describe('each kind has its own outline and legend row', () => {
    afterEach(() => {
        document.body.replaceChildren();
    });

    it.each([
        {
            kind: 'component',
            html: '<div id="it" data-ezclassify-controller="select"></div>',
            label: '@ezclassify/ui: SingleSelect',
            legend: 'Components',
        },
        {
            kind: 'marking',
            html: '<output id="it" data-ezclassify-marking></output>',
            label: 'marking #it',
            legend: 'Bound markings',
        },
        {
            kind: 'structure',
            html: '<section id="it" data-ezclassify-whole="doc"></section>',
            label: 'whole: doc',
            legend: 'Structure (wholes, collections)',
        },
        {
            kind: 'structure',
            html: '<ul id="it" data-ezclassify-collection="products"></ul>',
            label: 'collection: products',
            legend: 'Structure (wholes, collections)',
        },
        {
            kind: 'view',
            html: '<span id="it" data-ezclassify-aggregate></span>',
            label: 'aggregate',
            legend: 'Views and handbooks',
        },
        {
            kind: 'view',
            html: '<span id="it" data-ezclassify-source="doc"></span>',
            label: 'source: doc',
            legend: 'Views and handbooks',
        },
        {
            kind: 'view',
            html: '<div id="it" data-ezclassify-controller="context-reference"></div>',
            label: '@ezclassify/ui: ContextReference',
            legend: 'Views and handbooks',
        },
        {
            kind: 'ignored',
            html: '<aside id="it" data-ezclassify-ignore></aside>',
            label: 'ignored: excluded',
            legend: 'Ignored (excluded)',
        },
        {
            kind: 'powered',
            html: '<div id="it" data-ezclassify-powered></div>',
            label: 'powered by EzClassify',
            legend: 'Powered by EzClassify (manual)',
        },
    ])(
        'outlines $html as $kind with its own legend row',
        ({ kind, html, label, legend }) => {
            const target = page(html);
            const element = target.querySelector<HTMLElement>('#it')!;
            const locator = createComponentLocator({ target, active: true });
            document.body.append(locator.element);

            expect(element.dataset.ezclassifyXrayKind).toBe(kind);
            expect(element.dataset.ezclassifyXrayLabel).toBe(label);
            const row = locator.element.querySelector(
                `.ezclassify-locator__legend > .ezclassify-locator__item--${kind}`,
            );
            expect(row?.textContent).toBe(legend);
            const css = adoptedStyleTexts().find((text) =>
                text.includes('.ezclassify-locator'),
            )!;
            expect(css).toContain(
                `.ezclassify-xray [data-ezclassify-xray-kind='${kind}']`,
            );
            expect(css).toContain(
                `.ezclassify-locator__item--${kind} .ezclassify-locator__swatch`,
            );
            locator.destroy();
        },
    );

    it('lists one legend row per kind, in reading order', () => {
        const locator = createComponentLocator();
        const rows = [
            ...locator.element.querySelectorAll(
                '.ezclassify-locator__legend > .ezclassify-locator__item',
            ),
        ].map((row) => row.textContent);
        expect(rows).toEqual([
            'Components',
            'Bound markings',
            'Structure (wholes, collections)',
            'Views and handbooks',
            'Ignored (excluded)',
            'Powered by EzClassify (manual)',
        ]);
        locator.destroy();
    });

    it('shows ignored regions with a dotted outline, the others dashed', () => {
        const locator = createComponentLocator();
        const css = adoptedStyleTexts().find((text) =>
            text.includes('.ezclassify-locator'),
        )!;
        expect(css).toMatch(
            /data-ezclassify-xray-kind='ignored'\] \{[^}]*--ezx-outline-style: dotted/,
        );
        expect(css).toMatch(
            /data-ezclassify-xray-kind='component'\] \{[^}]*--ezx-outline-style: dashed/,
        );
        locator.destroy();
    });

    it('names a part with the whole it belongs to', () => {
        const target = page(
            '<output id="p1" data-ezclassify-marking data-ezclassify-part-of="doc"></output>',
        );
        const locator = createComponentLocator({ target, active: true });
        expect(
            target.querySelector<HTMLElement>('#p1')!.dataset
                .ezclassifyXrayLabel,
        ).toBe('marking #p1 · part-of: doc');
        locator.destroy();
    });

    it('reads a mount as its host: a category view stays a view', () => {
        const target = page(
            '<select id="host" hidden data-ezclassify-controller="checklist" data-ezclassify-facet-of="doc"></select><div id="mount" data-ezclassify-mount="checklist"><div class="category-checklist"></div></div>',
        );
        const host = target.querySelector<HTMLElement>('#host')!;
        const mount = target.querySelector<HTMLElement>('#mount')!;
        setMountHost(mount, host);
        const locator = createComponentLocator({ target, active: true });
        expect(mount.dataset.ezclassifyXrayKind).toBe('view');
        expect(mount.dataset.ezclassifyXrayLabel).toBe(
            'facet-of: doc · CategoryChecklist',
        );
        locator.destroy();
    });
});

describe('powered regions', () => {
    afterEach(() => {
        document.body.replaceChildren();
    });

    it('outlines a powered container once and not the powered nodes inside it', () => {
        const target = page(
            '<section id="region" data-ezclassify-powered><p id="a" data-ezclassify-powered>One</p><p id="b" data-ezclassify-powered>Two</p></section>',
        );
        const locator = createComponentLocator({ target, active: true });
        expect(
            target.querySelector<HTMLElement>('#region')!.dataset
                .ezclassifyXrayKind,
        ).toBe('powered');
        expect(
            target.querySelectorAll('[data-ezclassify-xray-kind]'),
        ).toHaveLength(1);
        expect(
            document.querySelectorAll('.ezclassify-locator__chip'),
        ).toHaveLength(1);
        locator.destroy();
    });

    it('still outlines what the library drives inside a powered region', () => {
        const target = page(
            '<section id="region" data-ezclassify-powered><span id="banner" data-ezclassify-aggregate></span></section>',
        );
        const locator = createComponentLocator({ target, active: true });
        expect(
            target.querySelector<HTMLElement>('#region')!.dataset
                .ezclassifyXrayKind,
        ).toBe('powered');
        expect(
            target.querySelector<HTMLElement>('#banner')!.dataset
                .ezclassifyXrayKind,
        ).toBe('view');
        locator.destroy();
    });
});

describe('hidden sinks', () => {
    afterEach(() => {
        document.body.replaceChildren();
    });

    it('lists hidden inputs and headless controllers instead of outlining them', () => {
        const target = page(
            '<input type="hidden" id="overall" name="overall" data-ezclassify-aggregate><input type="hidden" id="m1" data-ezclassify-marking><div id="feed" hidden data-ezclassify-controller="hidden"></div>',
        );
        const locator = createComponentLocator({ target, active: true });
        document.body.append(locator.element);

        expect(
            target.querySelectorAll('[data-ezclassify-xray-kind]'),
        ).toHaveLength(0);
        const hidden = locator.element.querySelector<HTMLElement>(
            '.ezclassify-locator__hidden',
        )!;
        expect(hidden.hidden).toBe(false);
        expect(hidden.firstElementChild?.textContent).toBe(
            'Hidden, not outlined (3)',
        );
        const entries = [
            ...hidden.querySelectorAll('.ezclassify-locator__hidden-list li'),
        ];
        expect(entries.map((entry) => entry.textContent)).toEqual([
            'aggregate · #overall',
            'marking #m1',
            '@ezclassify/ui: HiddenAssertionField · #feed',
        ]);
        expect(entries[0].className).toContain(
            'ezclassify-locator__item--view',
        );

        const toggle = locator.element.querySelector<HTMLInputElement>(
            'input[role="switch"]',
        )!;
        toggle.checked = false;
        toggle.dispatchEvent(new Event('change'));
        expect(hidden.hidden).toBe(true);
        locator.destroy();
    });

    it('keeps the list hidden when the page has no hidden sink', () => {
        const target = page('<div data-ezclassify-controller="select"></div>');
        const locator = createComponentLocator({ target, active: true });
        expect(
            locator.element.querySelector<HTMLElement>(
                '.ezclassify-locator__hidden',
            )!.hidden,
        ).toBe(true);
        locator.destroy();
    });
});
