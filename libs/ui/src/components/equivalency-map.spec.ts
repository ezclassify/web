import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EquivalencyMap } from './equivalency-map';
import type { SchemeEngineAdapter } from '@ezclassify/types';
import type {
    SchemePublicView,
    ConceptView,
    CategoryView,
} from '@ezclassify/types';
import { Context } from '@ezclassify/engine';
import { mockRenderFormats } from '../render-format-layout-mock';

function createMockProfile(): SchemePublicView {
    return {
        name: 'Test',
        categories: [
            {
                id: 'level',
                label: 'Level',
                single: true,
                required: false,
            } as CategoryView,
        ],
        concepts: [
            {
                id: 'HIGH',
                name: 'High',
                views: { default: 'High' },
                categories: ['level'],
                parents: [],
                aliases: [],
                position: 0,
            },
        ] as unknown as ConceptView[],
        formats: [
            {
                id: 'default',
                categoryOrder: ['level'],
                separator: '',
                categorySeparator: '',
                view: 'default',
            },
        ],
        scopes: [],
        defaultRenderFormat: 'default',
    } as unknown as SchemePublicView;
}

function createMockEngine(): SchemeEngineAdapter {
    const p = createMockProfile();
    return {
        getScheme: () => p,
        getSchemeMeta: () => ({
            id: (p as any).id ?? 'test',
            version: (p as any).version ?? '1.0',
            name: p.name ?? 'Test',
            defaultRenderFormat: (p as any).defaultRenderFormat ?? 'default',
            formats: mockRenderFormats(p.formats ?? []),
            scopes: (p as any).scopes ?? [],
        }),
        listCategories: () => p.categories ?? [],
        getConceptsInCategory: (catId: string) =>
            (p.concepts ?? []).filter((c: any) =>
                c.categories?.includes(catId),
            ),
        render: vi.fn(() => ''),
        process: vi.fn(() => ({ assertions: [], rendered: '', valid: true })),
        suggest: vi.fn(() => ({ suggestions: [] })),
    } as unknown as SchemeEngineAdapter;
}

const SAMPLE_EQUIVALENCIES = JSON.stringify([
    {
        source: 'STUDENTS',
        target: 'SCHOOL STAFF',
        confidence: 'approximate',
    },
    { source: 'SCHOOL STAFF', target: 'SCHOOL STAFF', confidence: 'exact' },
    {
        source: 'DISTRICT COORDINATORS',
        target: 'DISTRICT COORDINATORS',
        confidence: 'exact',
    },
    {
        source: 'STATE ASSESSMENT STAFF',
        target: 'STATE ASSESSMENT STAFF',
        confidence: 'exact',
    },
]);

const toCtx = (eng: unknown) => Context.fromSchemeEngine(eng as never);
describe('EquivalencyMap', () => {
    let container: HTMLDivElement;
    let engine: SchemeEngineAdapter;
    let component: EquivalencyMap;

    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
        engine = createMockEngine();
        component = new EquivalencyMap();
    });

    it('renders a header row plus data rows', async () => {
        container.setAttribute(
            'data-ezclassify-equivalency-equivalencies',
            SAMPLE_EQUIVALENCIES,
        );
        await component.init(container, toCtx(engine));
        const rows = container.querySelectorAll('.ez-equivalency-map__row');
        expect(rows.length).toBe(4);
    });

    it('renders source and target text', async () => {
        container.setAttribute(
            'data-ezclassify-equivalency-equivalencies',
            SAMPLE_EQUIVALENCIES,
        );
        await component.init(container, toCtx(engine));
        const sources = container.querySelectorAll(
            '.ez-equivalency-map__source',
        );
        expect(sources[0].textContent).toBe('STUDENTS');
        const targets = container.querySelectorAll(
            '.ez-equivalency-map__target',
        );
        expect(targets[0].textContent).toBe('SCHOOL STAFF');
    });

    it('renders confidence badges', async () => {
        container.setAttribute(
            'data-ezclassify-equivalency-equivalencies',
            SAMPLE_EQUIVALENCIES,
        );
        await component.init(container, toCtx(engine));
        const badges = container.querySelectorAll<HTMLElement>(
            '.ez-equivalency-map__badge',
        );
        expect(badges[0].dataset.confidence).toBe('approximate');
        expect(badges[3].dataset.confidence).toBe('exact');
    });

    it('uses custom column labels', async () => {
        container.setAttribute(
            'data-ezclassify-equivalency-equivalencies',
            SAMPLE_EQUIVALENCIES,
        );
        container.setAttribute(
            'data-ezclassify-equivalency-source-label',
            'Corporate Tier',
        );
        container.setAttribute(
            'data-ezclassify-equivalency-target-label',
            'Handling Tier',
        );
        await component.init(container, toCtx(engine));
        const header = container.querySelector('.ez-equivalency-map__header');
        expect(header?.textContent).toContain('Corporate Tier');
        expect(header?.textContent).toContain('Handling Tier');
    });

    it('handles empty equivalencies gracefully', async () => {
        await component.init(container, toCtx(engine));
        const rows = container.querySelectorAll('.ez-equivalency-map__row');
        expect(rows.length).toBe(0);
    });

    it('has ARIA table role', async () => {
        container.setAttribute(
            'data-ezclassify-equivalency-equivalencies',
            SAMPLE_EQUIVALENCIES,
        );
        await component.init(container, toCtx(engine));
        const table = container.querySelector('[role="table"]');
        expect(table).not.toBeNull();
    });

    it('active class on a row is visible via the expected selector', async () => {
        container.setAttribute(
            'data-ezclassify-equivalency-equivalencies',
            SAMPLE_EQUIVALENCIES,
        );
        await component.init(container, toCtx(engine));
        const rows = container.querySelectorAll<HTMLElement>(
            '.ez-equivalency-map__row',
        );
        expect(rows.length).toBe(4);
        // Simulate host toggling the active class (as DataClassificationDemo does)
        rows[0].classList.add('active');
        expect(
            container.querySelectorAll('.ez-equivalency-map__row.active')
                .length,
        ).toBe(1);
        expect(rows[0].classList.contains('active')).toBe(true);
        // Toggle off
        rows[0].classList.remove('active');
        expect(
            container.querySelectorAll('.ez-equivalency-map__row.active')
                .length,
        ).toBe(0);
    });
});
