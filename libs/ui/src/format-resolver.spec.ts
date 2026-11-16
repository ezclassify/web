import { afterEach, describe, it, expect, vi } from 'vitest';
import {
    assertWritesScopes,
    coveredCategoriesOf,
    defaultOutputOf,
    defaultSurfaceOf,
    getFormat,
    holdsPart,
    resolveFormatAttr,
    resolveOutput,
    viewOutputOf,
    writesSeveralLines,
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
            const field = createField({
                'data-ezclassify-marking': '',
                'data-ezclassify-part-of': 'doc',
            });
            expect(getFormat(ctx, field)).toBe('part');
            field.setAttribute('data-ezclassify-format', 'inline');
            expect(getFormat(ctx, field)).toBe('inline');
        });
    });

    describe('holdsPart', () => {
        afterEach(() => {
            document.body.innerHTML = '';
        });

        it('is true for a marking that names the whole it is part of', () => {
            expect(
                holdsPart(
                    createField({
                        'data-ezclassify-marking': '',
                        'data-ezclassify-part-of': 'doc',
                    }),
                ),
            ).toBe(true);
            expect(
                holdsPart(createField({ 'data-ezclassify-marking': '' })),
            ).toBe(false);
        });

        it('is true for a marking inside a whole container other than the whole', () => {
            document.body.innerHTML = `
                <form data-ezclassify-whole="doc">
                    <input id="doc" data-ezclassify-controller="marking" />
                    <input id="p" data-ezclassify-controller="marking" />
                </form>`;
            expect(holdsPart(document.getElementById('p')!)).toBe(true);
            expect(holdsPart(document.getElementById('doc')!)).toBe(false);
        });

        it('asks the host of the marking a field is bound to or is a facet of', () => {
            document.body.innerHTML = `
                <input type="hidden" id="doc" data-ezclassify-marking />
                <input type="hidden" id="para" data-ezclassify-marking
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
                '<input type="hidden" id="doc" data-ezclassify-marking />';
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

describe('coveredCategoriesOf', () => {
    const outputs = [
        { id: 'sensitivity/full', surface: 'sensitivity', outputView: 'full' },
        { id: 'retention/block', surface: 'retention', outputView: 'block' },
    ];
    const written: Record<string, string[]> = {
        'sensitivity/full': ['level', 'sharing'],
        'retention/block': ['keep'],
    };
    /** A scheme view that, like the REST client, refuses an unlisted output. */
    function view() {
        return {
            getSchemeMeta: () =>
                ({
                    formats: outputs,
                    defaultRenderFormat: 'sensitivity/full',
                }) as never,
            getFormatCoverage: vi.fn((id?: string) => {
                const categories = id === undefined ? undefined : written[id];
                if (!categories) throw new Error(`no output ${id}`);
                return {
                    formatId: id!,
                    coveredCategories: categories,
                    valueLossyCategories: [],
                    reconstruction: { status: 'unknown' as const, reasons: [] },
                };
            }),
        };
    }

    it('asks for the output a bare view id names on the default surface', () => {
        const engine = view();
        expect(coveredCategoriesOf(engine, 'full', undefined)).toEqual(
            new Set(['level', 'sharing']),
        );
        expect(engine.getFormatCoverage).toHaveBeenCalledWith(
            'sensitivity/full',
        );
    });

    it("asks for a bare view id's view on the field's own surface", () => {
        expect(coveredCategoriesOf(view(), 'block', 'retention')).toEqual(
            new Set(['keep']),
        );
    });

    it('answers nothing, and asks nothing, for a spelling no output has', () => {
        const engine = view();
        expect(
            coveredCategoriesOf(engine, 'full_line', 'sensitivity'),
        ).toBeUndefined();
        expect(engine.getFormatCoverage).not.toHaveBeenCalled();
    });

    it('answers nothing for a view that reports no coverage', () => {
        const { getSchemeMeta } = view();
        expect(
            coveredCategoriesOf({ getSchemeMeta }, 'full', undefined),
        ).toBeUndefined();
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

describe("a scope's default output", () => {
    const outputs = [
        { id: 'label/short', surface: 'label', defaultFor: ['part'] },
        { id: 'label/full', surface: 'label', defaultFor: ['whole'] },
        { id: 'label/xml', surface: 'label', defaultFor: [] },
        {
            id: 'record/block',
            surface: 'record',
            defaultFor: ['whole', 'part'],
        },
    ];

    it("is the view its surface writes for the marking's role", () => {
        expect(defaultOutputOf(outputs, 'label', 'whole', 'label/full')).toBe(
            'label/full',
        );
        expect(defaultOutputOf(outputs, 'label', 'part', 'label/full')).toBe(
            'label/short',
        );
        expect(defaultOutputOf(outputs, 'record', 'part', 'label/full')).toBe(
            'record/block',
        );
        expect(
            defaultOutputOf(outputs, 'other', 'whole', 'label/full'),
        ).toBeUndefined();
    });

    it('is the first format of the surface when formats are the outputs', () => {
        const formats = [
            { id: 'line', surface: 'label' },
            { id: 'block', surface: 'record' },
            { id: 'block_wide', surface: 'record' },
        ];
        expect(defaultOutputOf(formats, 'label', 'whole', 'line')).toBe('line');
        expect(defaultOutputOf(formats, 'record', 'whole', 'line')).toBe(
            'block',
        );
    });

    it("writes a view of several scopes in the first one's output", () => {
        const meta = {
            formats: outputs.map((o) => ({
                ...o,
                mode: 'inline' as const,
                categoryOrder: [],
            })),
            scopes: [
                { id: 'label', label: 'Label' },
                { id: 'record', label: 'Record' },
            ],
            defaultScope: 'label',
            defaultRenderFormat: 'label/full',
            defaultPartRenderFormat: 'label/short',
            defaultWholeRenderFormat: 'label/full',
        } as never;
        expect(viewOutputOf(meta, ['record'], false)).toBe('record/block');
        expect(viewOutputOf(meta, ['record', 'label'], true)).toBe(
            'label/short',
        );
        expect(viewOutputOf(meta, [], false)).toBe('label/full');
    });
});

describe('a text field that lists several scopes', () => {
    /**
     * A scheme of two scopes. `vector` writes both together; `line` writes the
     * base scope only. `extra` has a category of its own.
     */
    const meta = {
        scopes: [
            { id: 'base', label: 'Base' },
            { id: 'extra', label: 'Extra' },
        ],
        defaultScope: 'base',
        formats: [
            { id: 'base/vector', surface: 'base', outputView: 'vector' },
            { id: 'base/line', surface: 'base', outputView: 'line' },
        ],
    };
    const categories = [
        { id: 'impact' },
        { id: 'reach', scopes: ['base'] },
        { id: 'adjust', scopes: ['extra'] },
    ];
    const coverage: Record<string, string[]> = {
        'base/vector': ['impact', 'reach', 'adjust'],
        'base/line': ['impact', 'reach'],
    };
    const engine = {
        getSchemeMeta: () => meta,
        getFormatCoverage: (id: string) => {
            const covered = coverage[id];
            if (!covered) throw new Error(`no format ${id}`);
            return { coveredCategories: covered };
        },
    } as never;
    const check =
        (spelling: string, scopes: string[], view = engine) =>
        () =>
            assertWritesScopes(
                view,
                categories,
                spelling,
                scopes,
                'MarkingField',
            );

    it('writes them as one string when its format writes every listed scope', () => {
        expect(check('base/vector', ['extra', 'base'])).not.toThrow();
        // A bare view id names that view on the first listed scope.
        expect(check('vector', ['base', 'extra'])).not.toThrow();
    });

    it('is refused, naming the scopes and the format, when its format leaves one out', () => {
        expect(check('base/line', ['extra', 'base'])).toThrow(
            /MarkingField: data-ezclassify-scope lists "base", "extra", but its format "base\/line" does not write the categories of "extra"/,
        );
    });

    it('is refused when the scheme reports no coverage for its format, or names no such scope', () => {
        expect(check('base/xml', ['base', 'extra'])).toThrow(
            /reports no coverage for its format "base\/xml"/,
        );
        expect(
            check('base/vector', ['base', 'extra'], {
                getSchemeMeta: () => meta,
            } as never),
        ).toThrow(/reports no coverage/);
        expect(check('base/vector', ['base', 'other'])).toThrow(
            /declares no scope "other"/,
        );
    });

    it('lets one scope write its own output, and has nothing to check for none', () => {
        expect(check('base/line', ['base'])).not.toThrow();
        expect(check('line', ['base'])).not.toThrow();
        expect(check('base/line', [])).not.toThrow();
    });

    it("refuses one scope a format on another scope's surface", () => {
        expect(check('base/line', ['extra'])).toThrow(
            /MarkingField: data-ezclassify-scope lists "extra", but its format "base\/line" writes the surface of "base"/,
        );
    });

    it('refuses a format that also writes a category of no scope it lists', () => {
        expect(check('base/vector', ['base'])).toThrow(
            /lists "base", but its format "base\/vector" also writes "adjust", of no scope it lists/,
        );
    });
});

describe('a format that writes several lines', () => {
    const layout = (extra: Record<string, unknown>) =>
        [
            {
                id: 'record/block',
                surface: 'record',
                outputView: 'block',
                mode: 'inline',
                categoryOrder: ['a', 'b'],
                ...extra,
            },
        ] as never;

    it('is a block of more than one category, or a layout whose text breaks a line', () => {
        expect(
            writesSeveralLines(layout({ mode: 'block' }), 'block', 'record'),
        ).toBe(true);
        expect(
            writesSeveralLines(
                layout({ separatorBefore: { b: '\n' } }),
                'record/block',
                undefined,
            ),
        ).toBe(true);
        expect(
            writesSeveralLines(
                layout({ categoryEach: { a: { suffix: '\r\n' } } }),
                'record/block',
                undefined,
            ),
        ).toBe(true);
    });

    it('is not an inline layout, a block of one category, or an output it cannot find', () => {
        expect(writesSeveralLines(layout({}), 'record/block', undefined)).toBe(
            false,
        );
        expect(
            writesSeveralLines(
                layout({ mode: 'block', categoryOrder: ['a'] }),
                'record/block',
                undefined,
            ),
        ).toBe(false);
        expect(
            writesSeveralLines(layout({ mode: 'block' }), 'other', 'record'),
        ).toBe(false);
    });
});
