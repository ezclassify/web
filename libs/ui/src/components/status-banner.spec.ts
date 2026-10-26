import { describe, it, expect, vi, beforeEach } from 'vitest';
import { StatusBanner } from './status-banner';
import type { StatusBannerOptions } from './status-banner';
import type { SchemeEngineAdapter, Assertion } from '@ezclassify/types';
import type {
    SchemePublicView,
    ConceptView,
    CategoryView,
} from '@ezclassify/types';
import { Context } from '@ezclassify/engine';
import { loadCedarValley } from '@ezclassify/example-schemes/cedar-valley';
import { mockRenderFormats } from '../render-format-layout-mock';

function createMockProfile(): SchemePublicView {
    const concepts: ConceptView[] = [
        {
            id: 'level-high',
            name: 'High',
            views: { default: 'High' },
            categories: ['level'],
            parents: [],
            aliases: [],
            position: 0,
        },
        {
            id: 'level-low',
            name: 'Low',
            views: { default: 'Low' },
            categories: ['level'],
            parents: [],
            aliases: [],
            position: 1,
        },
        {
            id: 'cat-a',
            name: 'Category A',
            views: { default: 'Category A' },
            categories: ['category'],
            parents: [],
            aliases: [],
            position: 0,
        },
    ] as ConceptView[];

    const categories: CategoryView[] = [
        {
            id: 'level',
            label: 'Level',
            single: true,
            required: false,
        } as CategoryView,
        {
            id: 'category',
            label: 'Categories',
            single: false,
            required: false,
        } as CategoryView,
    ];

    return {
        name: 'Test Scheme',
        categories,
        concepts,
        formats: [
            {
                id: 'default',
                categoryOrder: ['level', 'category'],
                separator: ' ',
                categorySeparator: '//',
                view: 'default',
            },
        ],
        scopes: [],
        defaultRenderFormat: 'default',
    } as unknown as SchemePublicView;
}

function createMockEngine(
    scheme?: SchemePublicView,
    displayColor?: { background: string; text: string },
): SchemeEngineAdapter {
    const p = scheme ?? createMockProfile();
    return {
        getScheme: () => p,
        getSchemeMeta: () => ({
            id: (p as any).id ?? 'test',
            version: (p as any).version ?? '1.0',
            name: p.name ?? 'Test',
            colorFrom: (p as any).colorFrom,
            defaultRenderFormat: (p as any).defaultRenderFormat ?? 'default',
            formats: mockRenderFormats(p.formats ?? []),
            scopes: (p as any).scopes ?? [],
        }),
        listCategories: () => p.categories ?? [],
        getConceptsInCategory: (catId: string) =>
            (p.concepts ?? []).filter((c: any) =>
                c.categories?.includes(catId),
            ),
        render: vi.fn((assertions: Assertion[]) => ({
            rendered: assertions.map((a) => a.conceptId).join(', '),
            assessment: {
                emitted: [],
                omitted: [],
                collapsed: [],
                conflicts: [],
                unrepresentable: [],
            },
        })),
        // A banner displays the marking, so it reads it through validate.
        validate: vi.fn((input: string) => {
            const ids = input
                .split(',')
                .map((s) => s.trim())
                .filter(Boolean);
            const assertions = ids.map((id) => {
                const concept = p.concepts.find((c) => c.id === id);
                return {
                    conceptId: id,
                    categoryId: concept?.categories[0] ?? 'level',
                    confidence: 'certain' as const,
                    source: 'parse' as const,
                };
            });
            return { assertions, rendered: input, valid: true, displayColor };
        }),
        suggest: vi.fn().mockReturnValue({ suggestions: [] }),
    } as unknown as SchemeEngineAdapter;
}

const toCtx = (eng: unknown) => Context.fromSchemeEngine(eng as never);
describe('StatusBanner', () => {
    let container: HTMLDivElement;
    let engine: SchemeEngineAdapter;
    let component: StatusBanner;

    beforeEach(async () => {
        container = document.createElement('div');
        document.body.appendChild(container);
        engine = createMockEngine();
        component = new StatusBanner();
    });

    it('initializes with empty state', async () => {
        await component.init(container, toCtx(engine));
        const banner = container.querySelector('.status-banner');
        expect(banner).toBeTruthy();
        expect(banner!.classList.contains('status-banner--empty')).toBe(true);
        expect(banner!.textContent).toContain('No marking');
    });

    it('shows the finished marking and never judges it: rule errors stay on the form fields', async () => {
        const judged = createMockEngine();
        (judged.validate as ReturnType<typeof vi.fn>).mockImplementation(
            (input: string) => ({
                assertions: [
                    {
                        conceptId: 'level-high',
                        categoryId: 'level',
                        confidence: 'certain',
                        source: 'parse',
                    },
                ],
                rendered: input,
                valid: false,
                errors: [
                    {
                        constraintId: 'high-needs-a',
                        message: 'High requires Category A.',
                    },
                ],
            }),
        );
        await component.init(container, toCtx(judged));

        await component.setValue('level-high');
        component.updateValidationErrors([
            {
                constraintId: 'high-needs-a',
                message: 'High requires Category A.',
            },
        ]);

        expect(
            container.querySelector('.status-banner-label')?.textContent,
        ).toBe('level-high');
        expect(document.body.textContent).not.toContain('requires');
        expect(document.querySelector('.ez-validation-errors')).toBeNull();
        expect(container.hasAttribute('data-ezclassify-invalid')).toBe(false);
    });

    it('displays the full rendered marking by default when assertions are set', async () => {
        await component.init(container, toCtx(engine));
        component.setAssertions([
            {
                conceptId: 'level-high',
                categoryId: 'level',
                confidence: 'certain',
                source: 'user',
            },
        ]);

        const label = container.querySelector('.status-banner-label');
        expect(label).toBeTruthy();
        expect(label!.textContent).toBe('level-high');
    });

    it('displays the concept name when a category narrows the banner', async () => {
        await component.init(container, toCtx(engine), { categoryId: 'level' });
        component.setAssertions([
            {
                conceptId: 'level-high',
                categoryId: 'level',
                confidence: 'certain',
                source: 'user',
            },
        ]);

        const label = container.querySelector('.status-banner-label');
        expect(label).toBeTruthy();
        expect(label!.textContent).toBe('High');
    });

    it('applies colorMap colors', async () => {
        const options: StatusBannerOptions = {
            colorMap: {
                'level-high': { background: '#ff0000', text: '#ffffff' },
            },
        };
        await component.init(container, toCtx(engine), options);
        component.setAssertions([
            {
                conceptId: 'level-high',
                categoryId: 'level',
                confidence: 'certain',
                source: 'user',
            },
        ]);

        const banner = container.querySelector('.status-banner') as HTMLElement;
        expect(banner.style.getPropertyValue('--ez-banner-bg')).toBe('#ff0000');
        expect(banner.style.getPropertyValue('--ez-banner-text')).toBe(
            '#ffffff',
        );
    });

    it('lets a host colorMap override the scheme default color', async () => {
        // A scheme that names its single-select level category as the color
        // driver, with a mandated black-on-orange pair on the level concept.
        const scheme = createMockProfile();
        (scheme as any).colorFrom = 'level';
        scheme.concepts.find((c) => c.id === 'level-high')!.color = {
            background: '#ff8c00',
            text: '#000000',
        };
        const coloredEngine = createMockEngine(scheme);

        // A host application owns its presentation and may override the
        // portable scheme default.
        const options: StatusBannerOptions = {
            colorMap: {
                'level-high': { background: '#ff0000', text: '#ffffff' },
            },
        };
        component = new StatusBanner();
        await component.init(container, toCtx(coloredEngine), options);
        component.setAssertions([
            {
                conceptId: 'level-high',
                categoryId: 'level',
                confidence: 'certain',
                source: 'user',
            },
        ]);

        const banner = container.querySelector('.status-banner') as HTMLElement;
        expect(banner.style.getPropertyValue('--ez-banner-bg')).toBe('#ff0000');
        expect(banner.style.getPropertyValue('--ez-banner-text')).toBe(
            '#ffffff',
        );
    });

    it('paints the display color the adapter resolved, over the scheme category default', async () => {
        // A scheme can drive its display color from an ordered condition list
        // rather than a single category. Those conditions are scheme policy:
        // the runtime that owns the scheme evaluates them and reports the
        // answer on ProcessResult.displayColor, and no public scheme
        // projection carries them. The banner paints the reported answer, and
        // it must win over the category default it can derive locally;
        // otherwise a rule-driven scheme renders one color against an
        // in-process engine and another against a client.
        const scheme = createMockProfile();
        (scheme as any).colorFrom = 'level';
        scheme.concepts.find((c) => c.id === 'level-high')!.color = {
            background: '#ff8c00',
            text: '#000000',
        };
        const ruleDriven = createMockEngine(scheme, {
            background: '#ffd400',
            text: '#111111',
        });

        component = new StatusBanner();
        await component.init(container, toCtx(ruleDriven), {
            initialValue: 'level-high',
        });

        const banner = container.querySelector('.status-banner') as HTMLElement;
        expect(banner.style.getPropertyValue('--ez-banner-bg')).toBe('#ffd400');
        expect(banner.style.getPropertyValue('--ez-banner-text')).toBe(
            '#111111',
        );
    });

    it('falls back to the scheme category default when the adapter reports no display color', async () => {
        const scheme = createMockProfile();
        (scheme as any).colorFrom = 'level';
        scheme.concepts.find((c) => c.id === 'level-high')!.color = {
            background: '#ff8c00',
            text: '#000000',
        };

        component = new StatusBanner();
        await component.init(container, toCtx(createMockEngine(scheme)), {
            initialValue: 'level-high',
        });

        const banner = container.querySelector('.status-banner') as HTMLElement;
        expect(banner.style.getPropertyValue('--ez-banner-bg')).toBe('#ff8c00');
        expect(banner.style.getPropertyValue('--ez-banner-text')).toBe(
            '#000000',
        );
    });

    it('applies the authority color in single-concept mode when the color driver is a different category than the tier', async () => {
        // The banner tier is "level"; the color driver is a separate
        // single-select "dissem" category. renderSingleConcept must resolve the
        // color from the dissem assertion, not just the tier assertion it
        // displays, or single-concept mode silently drops the authority color.
        const scheme = createMockProfile();
        (scheme.categories as CategoryView[]).push({
            id: 'dissem',
            label: 'Dissemination',
            single: true,
            required: false,
        } as CategoryView);
        scheme.concepts.push({
            id: 'dissem-x',
            name: 'Restricted',
            views: { default: 'REL X' },
            categories: ['dissem'],
            parents: [],
            aliases: [],
            position: 0,
            color: { background: '#c8102e', text: '#ffffff' },
        } as unknown as ConceptView);
        (scheme as any).colorFrom = 'dissem';
        const coloredEngine = createMockEngine(scheme);

        component = new StatusBanner();
        // categoryId defaults to the first single-select category ("level").
        await component.init(container, toCtx(coloredEngine), {
            categoryId: 'level',
        });
        component.setAssertions([
            {
                conceptId: 'level-high',
                categoryId: 'level',
                confidence: 'certain',
                source: 'user',
            },
            {
                conceptId: 'dissem-x',
                categoryId: 'dissem',
                confidence: 'certain',
                source: 'user',
            },
        ]);

        const banner = container.querySelector('.status-banner') as HTMLElement;
        // The tier concept ("High") is displayed, colored by the dissem driver.
        expect(banner.querySelector('.status-banner-label')!.textContent).toBe(
            'High',
        );
        expect(banner.style.getPropertyValue('--ez-banner-bg')).toBe('#c8102e');
        expect(banner.style.getPropertyValue('--ez-banner-text')).toBe(
            '#ffffff',
        );
    });

    it('renders neutral when neither the scheme nor the host declares a color', async () => {
        // UK GSC and CA GoC deliberately declare no banner colors; the banner
        // must not invent one from the generic palette.
        await component.init(container, toCtx(engine));
        component.setAssertions([
            {
                conceptId: 'level-high',
                categoryId: 'level',
                confidence: 'certain',
                source: 'user',
            },
        ]);

        const banner = container.querySelector('.status-banner') as HTMLElement;
        expect(banner.classList.contains('status-banner--colored')).toBe(false);
        expect(banner.style.getPropertyValue('--ez-banner-bg')).toBe('');
        expect(banner.style.getPropertyValue('--ez-banner-text')).toBe('');
    });

    it('uses prominent size by default', async () => {
        await component.init(container, toCtx(engine));
        component.setAssertions([
            {
                conceptId: 'level-high',
                categoryId: 'level',
                confidence: 'certain',
                source: 'user',
            },
        ]);

        const banner = container.querySelector('.status-banner');
        expect(banner!.classList.contains('status-banner--prominent')).toBe(
            true,
        );
    });

    it('supports compact size variant', async () => {
        const options: StatusBannerOptions = { size: 'compact' };
        await component.init(container, toCtx(engine), options);
        component.setAssertions([
            {
                conceptId: 'level-high',
                categoryId: 'level',
                confidence: 'certain',
                source: 'user',
            },
        ]);

        const banner = container.querySelector('.status-banner');
        expect(banner!.classList.contains('status-banner--compact')).toBe(true);
    });

    it('renders subtitle text', async () => {
        const options: StatusBannerOptions = {
            subtitle: 'Additional info',
        };
        await component.init(container, toCtx(engine), options);
        component.setAssertions([
            {
                conceptId: 'level-high',
                categoryId: 'level',
                confidence: 'certain',
                source: 'user',
            },
        ]);

        const subtitle = container.querySelector('.status-banner-subtitle');
        expect(subtitle).toBeTruthy();
        expect(subtitle!.textContent).toBe('Additional info');
    });

    it('renders subtitle from callback', async () => {
        const options: StatusBannerOptions = {
            categoryId: 'level',
            subtitle: (conceptId, conceptName) =>
                `${conceptName} (${conceptId})`,
        };
        await component.init(container, toCtx(engine), options);
        component.setAssertions([
            {
                conceptId: 'level-high',
                categoryId: 'level',
                confidence: 'certain',
                source: 'user',
            },
        ]);

        const subtitle = container.querySelector('.status-banner-subtitle');
        expect(subtitle!.textContent).toBe('High (level-high)');
    });

    it('uses explicit categoryId option', async () => {
        const options: StatusBannerOptions = { categoryId: 'category' };
        await component.init(container, toCtx(engine), options);
        component.setAssertions([
            {
                conceptId: 'level-high',
                categoryId: 'level',
                confidence: 'certain',
                source: 'user',
            },
            {
                conceptId: 'cat-a',
                categoryId: 'category',
                confidence: 'certain',
                source: 'user',
            },
        ]);

        const label = container.querySelector('.status-banner-label');
        expect(label!.textContent).toBe('Category A');
    });

    it('returns to empty state when assertions cleared', async () => {
        await component.init(container, toCtx(engine));
        component.setAssertions([
            {
                conceptId: 'level-high',
                categoryId: 'level',
                confidence: 'certain',
                source: 'user',
            },
        ]);
        expect(container.querySelector('.status-banner--empty')).toBeNull();

        component.setAssertions([]);
        expect(container.querySelector('.status-banner--empty')).toBeTruthy();
    });

    it('getRendered returns rendered string', async () => {
        await component.init(container, toCtx(engine));
        component.setAssertions([
            {
                conceptId: 'level-high',
                categoryId: 'level',
                confidence: 'certain',
                source: 'user',
            },
        ]);
        const rendered = component.getRendered();
        expect(typeof rendered).toBe('string');
    });

    it('destroy clears the container', async () => {
        await component.init(container, toCtx(engine));
        expect(container.children.length).toBeGreaterThan(0);
        component.destroy();
        expect(container.innerHTML).toBe('');
    });

    it('has role=status and aria-live for accessibility', async () => {
        await component.init(container, toCtx(engine));
        const banner = container.querySelector('.status-banner');
        expect(banner!.getAttribute('role')).toBe('status');
        expect(banner!.getAttribute('aria-live')).toBe('polite');
    });

    it('is not a keyboard tab stop (no tabIndex=0)', async () => {
        await component.init(container, toCtx(engine));
        const banner = container.querySelector<HTMLElement>('.status-banner');
        // Non-interactive display, must not be reachable via Tab
        expect(banner!.tabIndex).not.toBe(0);
    });
});

/** Mock engine extended with checkCoverage for boundary-mode tests. */
function createEngineWithCoverage(
    scheme?: SchemePublicView,
): SchemeEngineAdapter {
    const base = createMockEngine(scheme);
    return {
        ...base,
        checkCoverage: vi.fn((children: string[], parent: string) => {
            // Simple containment check: over the boundary when the child holds a concept the parent does not.
            const childIds = new Set(
                children
                    .join(' ')
                    .split(/[\s,//]+/)
                    .filter(Boolean),
            );
            const parentIds = new Set(parent.split(/[\s,//]+/).filter(Boolean));
            const missing = [...childIds].filter((id) => !parentIds.has(id));
            return {
                covered: missing.length === 0,
                missing: [],
                missingLabels: missing,
                excess: [],
                excessLabels: [],
                rendered: children.join(', '),
            };
        }),
    } as unknown as SchemeEngineAdapter;
}

describe('StatusBanner: boundary mode', () => {
    let container: HTMLDivElement;
    let component: StatusBanner;

    beforeEach(async () => {
        container = document.createElement('div');
        document.body.appendChild(container);
        component = new StatusBanner();
    });

    it('shows the boundary line in product vocabulary when the scheme names no word of its own', async () => {
        const engine = createEngineWithCoverage();
        await component.init(container, toCtx(engine), {
            boundary: 'level-high',
        });
        const acc = container.querySelector('.status-banner-boundary');
        expect(acc).toBeTruthy();
        expect(acc!.textContent).toBe('Boundary: level-high');
    });

    it('uses a custom boundary label', async () => {
        const engine = createEngineWithCoverage();
        await component.init(container, toCtx(engine), {
            boundary: 'level-high',
            boundaryLabel: 'System accredited to',
        });
        const acc = container.querySelector('.status-banner-boundary');
        expect(acc!.textContent).toContain('System accredited to');
    });

    it('shows current-data line when assertions are set', async () => {
        const engine = createEngineWithCoverage();
        await component.init(container, toCtx(engine), {
            boundary: 'level-high',
        });
        component.setAssertions([
            {
                conceptId: 'level-low',
                categoryId: 'level',
                confidence: 'certain',
                source: 'user',
            },
        ]);
        const cur = container.querySelector('.status-banner-current');
        expect(cur).toBeTruthy();
        expect(cur!.textContent).toContain('Current:');
    });

    it('uses custom current-data label', async () => {
        const engine = createEngineWithCoverage();
        await component.init(container, toCtx(engine), {
            boundary: 'level-high',
            currentLabel: 'Marking',
        });
        component.setAssertions([
            {
                conceptId: 'level-low',
                categoryId: 'level',
                confidence: 'certain',
                source: 'user',
            },
        ]);
        const cur = container.querySelector('.status-banner-current');
        expect(cur!.textContent).toContain('Marking:');
    });

    it('separates the boundary and current-data lines with an element the CSS fills, carrying no character of its own', async () => {
        const engine = createEngineWithCoverage();
        await component.init(container, toCtx(engine), {
            boundary: 'level-high',
        });
        component.setAssertions([
            {
                conceptId: 'level-low',
                categoryId: 'level',
                confidence: 'certain',
                source: 'user',
            },
        ]);
        const sep = container.querySelector('.status-banner-sep');
        expect(sep).toBeTruthy();
        expect(sep!.textContent).toBe('');
        expect(container.textContent).not.toContain('—');
    });

    it('shows the boundary alone without current-data when showCurrentData is false', async () => {
        const engine = createEngineWithCoverage();
        await component.init(container, toCtx(engine), {
            boundary: 'level-high',
            showCurrentData: false,
        });
        expect(container.querySelector('.status-banner-boundary')).toBeTruthy();
        expect(container.querySelector('.status-banner-current')).toBeNull();
    });

    it('stays out of the alert state when the current marking is within the boundary', async () => {
        const engine = createEngineWithCoverage();
        await component.init(container, toCtx(engine), {
            boundary: 'level-high',
        });
        component.setAssertions([
            {
                conceptId: 'level-high',
                categoryId: 'level',
                confidence: 'certain',
                source: 'user',
            },
        ]);
        // checkCoverage with the same concept comes back covered
        await Promise.resolve();
        const banner = container.querySelector('.status-banner');
        expect(banner!.classList.contains('status-banner--over-boundary')).toBe(
            false,
        );
        expect(banner!.getAttribute('role')).toBe('status');
    });

    it('flags the over-boundary state when the current marking exceeds the boundary', async () => {
        const engine = createEngineWithCoverage();
        await component.init(container, toCtx(engine), {
            boundary: 'level-low',
        });
        component.setAssertions([
            {
                conceptId: 'level-high',
                categoryId: 'level',
                confidence: 'certain',
                source: 'user',
            },
        ]);
        // level-high is not within the boundary "level-low", so covered is false
        await Promise.resolve();
        const banner = container.querySelector('.status-banner');
        expect(banner!.classList.contains('status-banner--over-boundary')).toBe(
            true,
        );
        expect(banner!.getAttribute('role')).toBe('alert');
        expect(
            container.querySelector('.status-banner-over-boundary-alert'),
        ).toBeTruthy();
    });

    it('clears the over-boundary state when the current marking returns within the boundary', async () => {
        const engine = createEngineWithCoverage();
        await component.init(container, toCtx(engine), {
            boundary: 'level-low',
        });

        // Push it over the boundary
        component.setAssertions([
            {
                conceptId: 'level-high',
                categoryId: 'level',
                confidence: 'certain',
                source: 'user',
            },
        ]);
        await Promise.resolve();
        expect(
            container.querySelector('.status-banner--over-boundary'),
        ).toBeTruthy();

        // Clear to within-bounds
        component.setAssertions([
            {
                conceptId: 'level-low',
                categoryId: 'level',
                confidence: 'certain',
                source: 'user',
            },
        ]);
        await Promise.resolve();
        expect(
            container.querySelector('.status-banner--over-boundary'),
        ).toBeNull();
    });

    it('applies affix-top class to container when affix="top"', async () => {
        const engine = createEngineWithCoverage();
        await component.init(container, toCtx(engine), {
            affix: 'top',
            boundary: 'level-high',
        });
        expect(container.classList.contains('ez-banner-affix-top')).toBe(true);
        expect(container.classList.contains('ez-banner-affix-bottom')).toBe(
            false,
        );
    });

    it('applies affix-bottom class to container when affix="bottom"', async () => {
        const engine = createEngineWithCoverage();
        await component.init(container, toCtx(engine), {
            affix: 'bottom',
            boundary: 'level-high',
        });
        expect(container.classList.contains('ez-banner-affix-bottom')).toBe(
            true,
        );
        expect(container.classList.contains('ez-banner-affix-top')).toBe(false);
    });

    it('removes affix class on destroy', async () => {
        const engine = createEngineWithCoverage();
        await component.init(container, toCtx(engine), {
            affix: 'top',
            boundary: 'level-high',
        });
        expect(container.classList.contains('ez-banner-affix-top')).toBe(true);
        component.destroy();
        expect(container.classList.contains('ez-banner-affix-top')).toBe(false);
    });

    // A coverage check has inputs it cannot answer about: the engine refuses to
    // certify against a marking it could not read, and a page mid-edit reaches
    // that state on the way to a readable one. A synchronous engine raises it
    // where an async one rejects, and the rejection was already tolerated, so
    // this pins the same tolerance on the throwing path. The banner is a
    // read-only display of somebody else's marking; it has no standing to take
    // the page down over an answer it did not get.
    it('keeps rendering when a synchronous engine refuses to certify coverage', async () => {
        const engine = createEngineWithCoverage();
        await component.init(container, toCtx(engine), {
            boundary: 'level-low',
        });
        component.setAssertions([
            {
                conceptId: 'level-high',
                categoryId: 'level',
                confidence: 'certain',
                source: 'user',
            },
        ]);
        await Promise.resolve();
        expect(
            container.querySelector('.status-banner--over-boundary'),
        ).toBeTruthy();

        (
            engine as unknown as { checkCoverage: ReturnType<typeof vi.fn> }
        ).checkCoverage.mockImplementation(() => {
            throw new Error(
                'Cannot certify coverage: the child markings did not produce a complete valid outcome.',
            );
        });

        expect(() =>
            component.setAssertions([
                {
                    conceptId: 'level-low',
                    categoryId: 'level',
                    confidence: 'certain',
                    source: 'user',
                },
            ]),
        ).not.toThrow();
        await Promise.resolve();

        // The banner still shows the marking it was given, and the boundary
        // state it could not re-check is left where it was rather than being
        // guessed at in either direction.
        expect(container.querySelector('.status-banner')).toBeTruthy();
        expect(
            container.querySelector('.status-banner--over-boundary'),
        ).toBeTruthy();
    });

    it('keeps rendering when an asynchronous engine refuses to certify coverage', async () => {
        const engine = createEngineWithCoverage();
        await component.init(container, toCtx(engine), {
            boundary: 'level-low',
        });
        (
            engine as unknown as { checkCoverage: ReturnType<typeof vi.fn> }
        ).checkCoverage.mockImplementation(() =>
            Promise.reject(
                new Error(
                    'Cannot certify coverage: the child markings did not produce a complete valid outcome.',
                ),
            ),
        );
        expect(() =>
            component.setAssertions([
                {
                    conceptId: 'level-high',
                    categoryId: 'level',
                    confidence: 'certain',
                    source: 'user',
                },
            ]),
        ).not.toThrow();
        await Promise.resolve();
        await Promise.resolve();
        expect(container.querySelector('.status-banner')).toBeTruthy();
    });
});

describe('StatusBanner: display nouns come from the scheme', () => {
    let container: HTMLDivElement;
    let component: StatusBanner;

    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
        component = new StatusBanner();
    });

    /** A scheme that renames every noun the banner prints. */
    function schemeWithVocabulary(): SchemePublicView {
        const scheme = createMockProfile();
        return {
            ...scheme,
            vocabulary: {
                whole: { singular: 'banner' },
                boundary: { singular: 'Accredited for' },
                current: { singular: 'Current data' },
                overBoundary: { singular: 'Spillage' },
            },
        } as unknown as SchemePublicView;
    }

    it("prints the scheme's own words for the boundary and current-data lines", async () => {
        const engine = createEngineWithCoverage(schemeWithVocabulary());
        await component.init(container, toCtx(engine), {
            boundary: 'level-high',
        });
        expect(
            container.querySelector('.status-banner-boundary')!.textContent,
        ).toBe('Accredited for: level-high');
        expect(
            container.querySelector('.status-banner-current')!.textContent,
        ).toBe('Current data: (empty)');
    });

    it("prints the scheme's own word for the over-boundary alert", async () => {
        const engine = createEngineWithCoverage(schemeWithVocabulary());
        await component.init(container, toCtx(engine), {
            boundary: 'level-low',
        });
        component.setAssertions([
            {
                conceptId: 'level-high',
                categoryId: 'level',
                confidence: 'certain',
                source: 'user',
            },
        ]);
        await Promise.resolve();
        const alert = container.querySelector(
            '.status-banner-over-boundary-alert',
        );
        expect(alert!.textContent).toBe('⚠ Spillage');
        expect(
            container
                .querySelector('.status-banner')!
                .getAttribute('aria-label'),
        ).toContain('Spillage.');
    });

    it('names the region with the product noun for the whole role when the scheme declares none', async () => {
        const engine = createEngineWithCoverage();
        await component.init(container, toCtx(engine), {
            affix: 'top',
            showCurrentData: false,
        });
        expect(
            container
                .querySelector('.status-banner')!
                .getAttribute('aria-label'),
        ).toBe('Whole marking');
    });

    it("names the region with the scheme's own whole-role noun", async () => {
        const engine = createEngineWithCoverage(schemeWithVocabulary());
        await component.init(container, toCtx(engine), {
            affix: 'top',
            showCurrentData: false,
        });
        expect(
            container
                .querySelector('.status-banner')!
                .getAttribute('aria-label'),
        ).toBe('Banner marking');
    });

    it('gives the accessible name the same strings the visible elements carry', async () => {
        const engine = createEngineWithCoverage(schemeWithVocabulary());
        await component.init(container, toCtx(engine), {
            boundary: 'level-high',
        });
        component.setAssertions([
            {
                conceptId: 'level-low',
                categoryId: 'level',
                confidence: 'certain',
                source: 'user',
            },
        ]);
        const banner = container.querySelector('.status-banner')!;
        const ariaLabel = banner.getAttribute('aria-label')!;
        for (const selector of [
            '.status-banner-boundary',
            '.status-banner-current',
        ]) {
            expect(ariaLabel).toContain(
                container.querySelector(selector)!.textContent!,
            );
        }
        expect(ariaLabel).not.toContain('—');
    });
});

// A boundary says who the surface is open to, so data has to be fit for all of
// them. Data whose sharing list is narrower than the boundary's is over the
// boundary for the same reason a level above it is: someone the boundary
// admits may not see it. Cedar Valley's permitted schools narrow as markings
// combine, as a release list does, and these run against the real engine.
describe('StatusBanner: boundary judged by the engine', () => {
    const DATA = 'INTERNAL//OAKWOOD, PINECREST';

    async function bannerOver(boundary: string, data: string) {
        const engine = loadCedarValley();
        const container = document.createElement('div');
        document.body.appendChild(container);
        const component = new StatusBanner();
        await component.init(container, toCtx(engine), { boundary });
        const { assertions } = await Promise.resolve(engine.process(data));
        component.setAssertions(assertions);
        await new Promise((r) => setTimeout(r, 20));
        const banner = container.querySelector('.status-banner')!;
        const over = banner.classList.contains('status-banner--over-boundary');
        expect(banner.getAttribute('role')).toBe(over ? 'alert' : 'status');
        component.destroy();
        container.remove();
        return over;
    }

    it('is over a boundary that is open to a school the data does not permit', async () => {
        expect(
            await bannerOver('INTERNAL//OAKWOOD, PINECREST, RIVERSIDE', DATA),
        ).toBe(true);
    });

    it('is over a boundary below the data’s level', async () => {
        expect(
            await bannerOver(
                'INTERNAL//OAKWOOD, PINECREST',
                'RESTRICTED//OAKWOOD, PINECREST',
            ),
        ).toBe(true);
    });

    it('is within a boundary open to exactly the schools the data permits', async () => {
        expect(await bannerOver('INTERNAL//OAKWOOD, PINECREST', DATA)).toBe(
            false,
        );
    });

    it('is within a boundary above the data’s level with the same schools', async () => {
        expect(await bannerOver('RESTRICTED//OAKWOOD, PINECREST', DATA)).toBe(
            false,
        );
    });
});
