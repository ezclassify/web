import { afterEach, describe, it, expect, vi } from 'vitest';
import {
    defaultSurfaceOf,
    getFormat,
    holdsPart,
    resolveFormatAttr,
    resolveOutput,
} from './format-resolver';
import type { FormsContext } from './forms/types';
import { mockRenderFormats } from './render-format-layout-mock';

function createMockEngine(overrides: Record<string, any> = {}) {
    const scheme: Record<string, any> = {
        concepts: [],
        categories: [],
        formats: [
            {
                id: 'default',
                categoryOrder: [],
                separator: ' ',
                categorySeparator: '//',
                view: 'default',
            },
        ],
        scopes: [],
        ...overrides,
    };
    // Auto-derive categories from concepts if none explicitly provided
    const effectiveCats: any[] =
        scheme.categories.length > 0
            ? scheme.categories
            : (() => {
                  const catIds = new Set<string>();
                  for (const c of scheme.concepts) {
                      for (const catId of c.categories ?? []) catIds.add(catId);
                  }
                  // If concepts have no categories, expose a synthetic '_all' catch-all
                  if (catIds.size === 0 && scheme.concepts.length > 0)
                      catIds.add('_all');
                  return Array.from(catIds).map((id) => ({
                      id,
                      label: id,
                      single: false,
                      required: false,
                  }));
              })();
    return {
        getScheme: () => scheme,
        getSchemeMeta: () => ({
            id: scheme.id ?? 'test',
            version: scheme.version ?? '1.0',
            name: scheme.name ?? 'Test',
            defaultRenderFormat: scheme.defaultRenderFormat ?? 'default',
            formats: mockRenderFormats(scheme.formats),
            scopes: scheme.scopes ?? [],
            vocabulary: scheme.vocabulary,
            labelPresets: scheme.label_presets,
        }),
        listCategories: () => effectiveCats,
        getConceptsInCategory: (catId: string) => {
            if (catId === '_all') return scheme.concepts ?? [];
            return (scheme.concepts ?? []).filter((c: any) =>
                c.categories?.includes(catId),
            );
        },
        render: vi.fn().mockReturnValue(''),
        process: vi
            .fn()
            .mockReturnValue({ assertions: [], rendered: '', valid: true }),
        suggest: vi.fn().mockReturnValue({ suggestions: [] }),
        ...overrides._engineOverrides,
    } as unknown as FormsContext['engine'];
}

function createMockCtx(overrides: Partial<FormsContext> = {}): FormsContext {
    return {
        engine: createMockEngine(),
        root: document.body,
        fields: [],
        rollupField: null,
        defaultFormat: 'default',
        defaultPartFormat: 'part',
        domObserver: null,
        autocompleters: new Map(),
        lastValidated: new Map(),
        fieldAssertions: new Map(),
        tooltipEl: null,
        settingValue: false,
        colorMap: {},
        selectorAttr: 'ezclassify',
        ...overrides,
    } as FormsContext;
}

function createField(attrs: Record<string, string> = {}): HTMLInputElement {
    const field = document.createElement('input');
    for (const [k, v] of Object.entries(attrs)) {
        field.setAttribute(k, v);
    }
    return field;
}

describe('format-resolver', () => {
    describe('getFormat', () => {
        it('returns the canonical data-ezclassify-format attribute when present', () => {
            const ctx = createMockCtx();
            const field = createField({ 'data-ezclassify-format': 'inline' });
            expect(getFormat(ctx, field)).toBe('inline');
        });

        it('returns defaultFormat when no attribute is set', () => {
            const ctx = createMockCtx({ defaultFormat: 'fallback' });
            const field = createField();
            expect(getFormat(ctx, field)).toBe('fallback');
        });

        it('returns defaultFormat when the attribute is empty', () => {
            const ctx = createMockCtx({ defaultFormat: 'fallback' });
            const field = createField({ 'data-ezclassify-format': '' });
            expect(getFormat(ctx, field)).toBe('fallback');
        });

        it('returns defaultPartFormat for a field that shows a part', () => {
            const ctx = createMockCtx();
            const field = createField({ 'data-ezclassify-part-of': 'doc' });
            expect(getFormat(ctx, field)).toBe('part');
            field.setAttribute('data-ezclassify-format', 'inline');
            expect(getFormat(ctx, field)).toBe('inline');
        });
    });

    describe('holdsPart', () => {
        afterEach(() => {
            document.body.innerHTML = '';
        });

        it('is true for a field that names the whole it is part of', () => {
            expect(
                holdsPart(createField({ 'data-ezclassify-part-of': 'doc' })),
            ).toBe(true);
            expect(holdsPart(createField())).toBe(false);
        });

        it('asks the host of the marking a field is bound to or is a facet of', () => {
            document.body.innerHTML = `
                <input type="hidden" id="doc" data-ezclassify-rendered />
                <input type="hidden" id="para" data-ezclassify-rendered
                       data-ezclassify-part-of="doc" />`;
            const bound = (id: string) =>
                createField({ 'data-ezclassify-bound-to': id });
            document.body.append(bound('para'), bound('doc'), bound('gone'));
            const [toPart, toWhole, toNothing] = [
                ...document.querySelectorAll<HTMLInputElement>(
                    'input[data-ezclassify-bound-to]',
                ),
            ];
            expect(holdsPart(toPart)).toBe(true);
            expect(holdsPart(toWhole)).toBe(false);
            expect(holdsPart(toNothing)).toBe(false);

            const facet = createField({ 'data-ezclassify-facet-of': 'para' });
            document.body.append(facet);
            expect(holdsPart(facet)).toBe(true);
        });

        it('follows the bound marking, not a part-of the field itself declares', () => {
            document.body.innerHTML =
                '<input type="hidden" id="doc" data-ezclassify-rendered />';
            const field = createField({
                'data-ezclassify-bound-to': 'doc',
                'data-ezclassify-part-of': 'page',
            });
            document.body.append(field);
            expect(holdsPart(field)).toBe(false);
        });
    });

    describe('resolveFormatAttr', () => {
        it('returns the attribute value', () => {
            const field = createField({ 'data-ezclassify-format': 'banner' });
            expect(resolveFormatAttr(field)).toBe('banner');
        });

        it('returns null when the attribute is absent', () => {
            expect(resolveFormatAttr(createField())).toBeNull();
        });
    });
});

describe('resolveOutput', () => {
    /** Outputs by surface: two surfaces that each have a view `plain`. */
    const outputs = [
        {
            id: 'sensitivity/short',
            surface: 'sensitivity',
            outputView: 'short',
        },
        {
            id: 'sensitivity/plain',
            surface: 'sensitivity',
            outputView: 'plain',
        },
        { id: 'retention/plain', surface: 'retention', outputView: 'plain' },
    ];

    it('takes an output id as it is', () => {
        expect(resolveOutput(outputs, 'retention/plain', 'sensitivity')).toBe(
            'retention/plain',
        );
    });

    it("names a bare view id's view on the field's surface", () => {
        expect(resolveOutput(outputs, 'plain', 'sensitivity')).toBe(
            'sensitivity/plain',
        );
        expect(resolveOutput(outputs, 'plain', 'retention')).toBe(
            'retention/plain',
        );
    });

    it("names nothing for a view the field's surface does not have, or a spelling no output has", () => {
        expect(resolveOutput(outputs, 'short', 'retention')).toBeUndefined();
        expect(
            resolveOutput(outputs, 'short_line', 'sensitivity'),
        ).toBeUndefined();
    });

    it('takes a format id of a scheme whose formats are its outputs', () => {
        const formats = [
            { id: 'long', surface: 'marking' },
            { id: 'short', surface: 'marking' },
        ];
        expect(resolveOutput(formats, 'short', 'marking')).toBe('short');
        expect(resolveOutput(formats, 'banner', 'marking')).toBeUndefined();
    });
});

describe('defaultSurfaceOf', () => {
    const outputs = [
        { id: 'sensitivity/short', surface: 'sensitivity' },
        { id: 'sensitivity/full', surface: 'sensitivity' },
        { id: 'retention/block', surface: 'retention' },
    ];

    it('is the surface of the default output', () => {
        expect(defaultSurfaceOf(outputs, 'sensitivity/full')).toBe(
            'sensitivity',
        );
        expect(defaultSurfaceOf(outputs, 'retention/block')).toBe('retention');
    });

    it('is undefined when the scheme lists no default output', () => {
        expect(defaultSurfaceOf(outputs, undefined)).toBeUndefined();
        expect(defaultSurfaceOf(outputs, 'sensitivity/xml')).toBeUndefined();
    });
});
