/**
 * Unit tests for EzClassifyUI controller, constructor, enhance, destroy,
 * recalculate and getAllAssertions.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type {
    SchemePublicView,
    ConceptView,
    CategoryView,
} from '@ezclassify/types';
import { EzClassifyUI } from '../ezclassify-ui';
import { mockRenderFormats } from '../render-format-layout-mock';
import { schemeOnlyContext } from '../../test-fixtures/context-doubles';

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

    it('adds no rollup field of its own: a page submits a rollup only through an output it places', () => {
        forms = new EzClassifyUI(schemeOnlyContext(createEngine()), { root });
        expect(root.querySelector('input[type="hidden"]')).toBeNull();
    });

    it('destroy clears the fields array', () => {
        forms = new EzClassifyUI(schemeOnlyContext(createEngine()), { root });
        forms.destroy();
        expect(forms.fields).toEqual([]);
        forms = null;
    });

    it('getAllAssertions returns deduplicated assertions from all fields', () => {
        forms = new EzClassifyUI(schemeOnlyContext(createEngine()), { root });

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
        forms = new EzClassifyUI(schemeOnlyContext(createEngine()), { root });

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

    it('constructor sets defaultFormat from profile when not provided', () => {
        forms = new EzClassifyUI(schemeOnlyContext(createEngine()), { root });
        expect(forms.defaultFormat).toBe('default');
    });

    it('constructor uses provided format over profile default', () => {
        forms = new EzClassifyUI(schemeOnlyContext(createEngine()), {
            root,
            format: 'custom',
        });
        expect(forms.defaultFormat).toBe('custom');
    });

    it('constructor sets colorMap when provided', () => {
        const colorMap = { f1: { background: '#ff0000', text: '#ffffff' } };
        forms = new EzClassifyUI(schemeOnlyContext(createEngine()), {
            root,
            colorMap,
        });
        expect(forms.colorMap).toEqual(colorMap);
    });
});
