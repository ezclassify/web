/**
 * Unit tests for EzClassifyUI controller, constructor, enhance, destroy,
 * recalculate, getAllAssertions, getAssertionsByTarget, getRollup.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type {
    SchemePublicView,
    ConceptView,
    CategoryView,
} from '@ezclassify/types';
import { EzClassifyUI } from '../ezclassify-ui';
import { mockRenderFormats } from '../render-format-layout-mock';

function createProfile(): SchemePublicView {
    const concepts: ConceptView[] = [
        {
            id: 'a',
            name: 'A',
            views: { default: 'A' },
            aliases: [],
            categories: ['f1'],
            parents: [],
            position: 0,
        } as ConceptView,
        {
            id: 'b',
            name: 'B',
            views: { default: 'B' },
            aliases: [],
            categories: ['f1'],
            parents: [],
            position: 1,
        } as ConceptView,
    ];
    const categories: CategoryView[] = [
        {
            id: 'f1',
            label: 'F1',
            single: false,
            required: false,
        } as CategoryView,
    ];
    return {
        id: 'test',
        version: '1.0',
        name: 'Test',
        description: '',
        concepts,
        categories,
        parseRules: [],
        formats: [
            {
                id: 'default',
                categoryOrder: ['f1'],
                separator: ',',
                categorySeparator: '//',
                view: 'default',
            },
        ],
        defaultRenderFormat: 'default',
    } as unknown as SchemePublicView;
}

function createEngine() {
    const p = createProfile();
    return {
        getScheme: vi.fn(() => p),
        getSchemeMeta: vi.fn(() => ({
            id: p.id ?? 'test',
            version: p.version ?? '1.0',
            name: p.name ?? 'Test',
            defaultRenderFormat: p.defaultRenderFormat ?? 'default',
            formats: mockRenderFormats(p.formats ?? []),
            scopes: p.scopes ?? [],
        })),
        listCategories: vi.fn(() => p.categories ?? []),
        getConceptsInCategory: vi.fn((catId: string) =>
            (p.concepts ?? []).filter((c: any) =>
                c.categories?.includes(catId),
            ),
        ),
        process: vi.fn(() => ({
            assertions: [],
            rendered: '',
            valid: true,
            errors: [],
            appliedFixes: [],
            notices: [],
        })),
        suggest: vi.fn(() => ({ suggestions: [] })),
        aggregate: vi.fn(() => ({
            assertions: [],
            rendered: '',
            valid: true,
            errors: [],
            appliedFixes: [],
            notices: [],
        })),
        aggregateAssertions: vi.fn(() => ({
            assertions: [],
            rendered: '',
            valid: true,
            errors: [],
            appliedFixes: [],
            notices: [],
        })),
        render: vi.fn(() => ''),
    } as any;
}

describe('EzClassifyUI', () => {
    let root: HTMLDivElement;
    let forms: EzClassifyUI | null;

    beforeEach(() => {
        document.body.innerHTML = '';
        root = document.createElement('div');
        document.body.appendChild(root);
        forms = null;
    });

    afterEach(() => {
        forms?.destroy();
        document.body.innerHTML = '';
    });

    it('creates a hidden rollup field in the root', () => {
        forms = new EzClassifyUI(createEngine(), { root });
        const rollup = root.querySelector(
            '#ezclassify-rollup',
        ) as HTMLInputElement;
        expect(rollup).toBeTruthy();
        expect(rollup.type).toBe('hidden');
    });

    it('uses a custom rollupId when provided', () => {
        forms = new EzClassifyUI(createEngine(), {
            root,
            rollupId: 'my-rollup',
        });
        const rollup = root.querySelector('#my-rollup') as HTMLInputElement;
        expect(rollup).toBeTruthy();
    });

    it('reuses an existing rollup element if found', () => {
        const existing = document.createElement('input');
        existing.type = 'hidden';
        existing.id = 'ezclassify-rollup';
        existing.value = 'pre-existing';
        root.appendChild(existing);

        forms = new EzClassifyUI(createEngine(), { root });
        const rollupEls = root.querySelectorAll('#ezclassify-rollup');
        expect(rollupEls.length).toBe(1);
    });

    it('destroy removes rollup field and clears fields array', () => {
        forms = new EzClassifyUI(createEngine(), { root });
        expect(root.querySelector('#ezclassify-rollup')).toBeTruthy();

        forms.destroy();
        expect(root.querySelector('#ezclassify-rollup')).toBeNull();
        expect(forms.fields).toEqual([]);
        expect(forms.rollupField).toBeNull();
        forms = null;
    });

    it('recalculate returns current rollup value', () => {
        const engine = createEngine();
        (engine.aggregate as any).mockReturnValue({
            assertions: [
                {
                    conceptId: 'a',
                    categoryId: 'f1',
                    confidence: 'certain',
                    source: 'user',
                },
            ],
            rendered: 'A',
            valid: true,
            errors: [],
            appliedFixes: [],
            notices: [],
        });
        forms = new EzClassifyUI(engine, { root });

        const result = forms.recalculate();
        expect(typeof result).toBe('string');
    });

    it('getRollup returns rollup value without recalculating', () => {
        forms = new EzClassifyUI(createEngine(), { root });
        const rollup = root.querySelector(
            '#ezclassify-rollup',
        ) as HTMLInputElement;
        rollup.value = 'cached-value';

        expect(forms.getRollup()).toBe('cached-value');
    });

    it('getAllAssertions returns deduplicated assertions from all fields', () => {
        forms = new EzClassifyUI(createEngine(), { root });

        const field1 = document.createElement('input');
        const field2 = document.createElement('input');
        forms.fields.push(field1, field2);
        forms.fieldAssertions.set(field1, [
            { conceptId: 'a', categoryId: 'f1' },
        ]);
        forms.fieldAssertions.set(field2, [
            { conceptId: 'a', categoryId: 'f1' },
            { conceptId: 'b', categoryId: 'f1' },
        ]);

        const all = forms.getAllAssertions();
        expect(all).toHaveLength(2);
        expect(all.map((a) => a.conceptId).sort()).toEqual(['a', 'b']);
    });

    it('getAllAssertions includes assertions from components', () => {
        forms = new EzClassifyUI(createEngine(), { root });

        const el = document.createElement('div');
        const mockComp = {
            getAssertions: () => [
                {
                    conceptId: 'c',
                    categoryId: 'f1',
                    confidence: 'certain',
                    source: 'user',
                },
            ],
            getRendered: () => 'C',
            destroy: vi.fn(),
            setAssertions: vi.fn(),
            init: vi.fn(),
        };
        forms.mounted.set(el, mockComp as any);

        const all = forms.getAllAssertions();
        expect(all.some((a) => a.conceptId === 'c')).toBe(true);
    });

    it('getAssertionsByTarget groups assertions by ezclassify-for target', () => {
        forms = new EzClassifyUI(createEngine(), { root });

        const field1 = document.createElement('input');
        const field2 = document.createElement('input');
        forms.fields.push(field1, field2);
        forms.fieldAssertions.set(field1, [
            { conceptId: 'a', categoryId: 'f1' },
        ]);
        forms.fieldAssertions.set(field2, [
            { conceptId: 'b', categoryId: 'f1' },
        ]);
        forms.targetMap.set(field1, 'target-1');

        const byTarget = forms.getAssertionsByTarget();
        expect(byTarget.get('target-1')).toHaveLength(1);
        expect(byTarget.get('target-1')![0].conceptId).toBe('a');
        expect(byTarget.get('')).toHaveLength(1);
        expect(byTarget.get('')![0].conceptId).toBe('b');
    });

    it('constructor sets defaultFormat from profile when not provided', () => {
        forms = new EzClassifyUI(createEngine(), { root });
        expect(forms.defaultFormat).toBe('default');
    });

    it('constructor uses provided format over profile default', () => {
        forms = new EzClassifyUI(createEngine(), { root, format: 'custom' });
        expect(forms.defaultFormat).toBe('custom');
    });

    it('constructor sets colorMap when provided', () => {
        const colorMap = { f1: { background: '#ff0000', text: '#ffffff' } };
        forms = new EzClassifyUI(createEngine(), { root, colorMap });
        expect(forms.colorMap).toEqual(colorMap);
    });
});
