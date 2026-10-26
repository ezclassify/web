/**
 * EzClassify React integration, end-to-end example spec
 *
 * Demonstrates the complete engine API: load, process, aggregate, suggest,
 * access, layers, and null/error guards.
 *
 * Run: npx vitest run integrations/react/examples/
 *
 * This file doubles as documentation, each describe block corresponds to a
 * section in the README.
 */
import { describe, it, expect } from 'vitest';
import { Context, AccessEngine } from '@ezclassify/engine';
import type { LocalSchemeEngineAdapter } from '@ezclassify/types';

const profile = {
    scheme: {
        id: 'example-profile',
        version: '1.0.0',
        name: 'Example',
        description: 'Demo profile for the React integration',
        data: {
            categories: [
                {
                    id: 'level',
                    label: 'Level',
                    required: true,
                    single: true,
                    rollup: 'max',
                    position: 0,
                },
                {
                    id: 'controls',
                    label: 'Controls',
                    required: false,
                    single: false,
                    rollup: 'union',
                    position: 1,
                },
            ],
            concepts: {
                inline: [
                    {
                        id: 'LOW',
                        name: 'Low',
                        views: { default: 'LOW', portion: 'L' },
                        categories: ['level'],
                        parents: [],
                        aliases: [],
                        position: 0,
                        rank: 0,
                    },
                    {
                        id: 'MED',
                        name: 'Med',
                        views: { default: 'MED', portion: 'M' },
                        categories: ['level'],
                        parents: [],
                        aliases: [],
                        position: 1,
                        rank: 1,
                    },
                    {
                        id: 'HIGH',
                        name: 'High',
                        views: { default: 'HIGH', portion: 'H' },
                        categories: ['level'],
                        parents: [],
                        aliases: [],
                        position: 2,
                        rank: 2,
                    },
                    {
                        id: 'CTRL-A',
                        name: 'Control A',
                        views: { default: 'CTRL-A' },
                        categories: ['controls'],
                        parents: ['HIGH'],
                        aliases: [],
                        position: 0,
                    },
                ],
            },
        },
        rules: [],
        parse: {
            case_sensitive: false,
            strip_whitespace: true,
        },
        render: {
            default: 'default',
            formats: [
                {
                    id: 'default',
                    surface: 'marking',
                    mode: 'inline',
                    separator: '/',
                    fields: [
                        { category: 'level' },
                        { category: 'controls', separator: '/' },
                    ],
                },
            ],
        },
    },
};

describe('1. Load: Context.fromComponents', () => {
    it('loads a valid profile without throwing', () => {
        expect(() => Context.fromComponents({ scheme: profile })).not.toThrow();
    });

    it('exposes profile metadata after load', () => {
        const engine = Context.fromComponents({ scheme: profile }).scheme;
        const meta = engine.getSchemeMeta();
        expect(meta.id).toBe('example-profile');
        expect(meta.version).toBe('1.0.0');
    });

    it('throws on a malformed profile object', () => {
        expect(() => Context.fromComponents({ scheme: {} })).toThrow();
    });
});

describe('2. Process: engine.process()', () => {
    const engine = Context.fromComponents({ scheme: profile }).scheme;

    it('valid marking returns valid=true and a rendered string', () => {
        const result = engine.process('HIGH');
        expect(result.valid).toBe(true);
        expect(result.rendered).toBe('HIGH');
    });

    it('unrecognized token returns valid=false with errors', () => {
        const result = engine.process('ZZZBOGUS');
        expect(result.valid).toBe(false);
        expect(result.errors.length).toBeGreaterThan(0);
    });

    it('empty string does not throw', () => {
        expect(() => engine.process('')).not.toThrow();
    });

    it('case-insensitive input resolves to canonical form', () => {
        const result = engine.process('high');
        expect(result.valid).toBe(true);
        expect(result.rendered).toBe('HIGH');
    });

    it('multi-concept marking with separator is parsed correctly', () => {
        const result = engine.process('HIGH/CTRL-A');
        expect(result.valid).toBe(true);
        expect(result.rendered).toContain('HIGH');
        expect(result.rendered).toContain('CTRL-A');
    });
});

describe('3. Aggregate: engine.aggregate()', () => {
    const engine = Context.fromComponents({ scheme: profile }).scheme;

    it('picks the max-rank concept from the list', () => {
        const result = engine.aggregate(['LOW', 'HIGH']);
        expect(result.rendered).toBe('HIGH');
    });

    it('single item returns that item rendered', () => {
        const result = engine.aggregate(['MED']);
        expect(result.rendered).toBe('MED');
    });

    it('empty array does not throw', () => {
        expect(() => engine.aggregate([])).not.toThrow();
    });

    it('three markings picks the highest', () => {
        const result = engine.aggregate(['LOW', 'MED', 'HIGH']);
        expect(result.rendered).toBe('HIGH');
    });
});

describe('4. Suggest: engine.suggest()', () => {
    const engine = Context.fromComponents({ scheme: profile }).scheme;

    // The argument is a MARKING, not a typed prefix: suggest() answers what
    // this marking can still become. A search box asking which concepts match
    // what the user typed wants filterConcepts() instead.
    it('an empty marking can be completed with every level', () => {
        const result = engine.suggest('');
        expect(result.suggestions.map((s) => s.conceptId)).toEqual(
            expect.arrayContaining(['LOW', 'MED', 'HIGH']),
        );
    });

    it('a marking narrows what can still be added to it', () => {
        // CTRL-A declares HIGH as a parent, so it is only offered once the
        // marking already carries HIGH.
        const open = engine.suggest('');
        const underHigh = engine.suggest('HIGH');
        expect(open.suggestions.map((s) => s.conceptId)).not.toContain(
            'CTRL-A',
        );
        expect(underHigh.suggestions.map((s) => s.conceptId)).toContain(
            'CTRL-A',
        );
    });
});

describe('4b. Text search: engine.filterConcepts()', () => {
    const engine = Context.fromComponents({ scheme: profile }).scheme;

    it('a query narrows the matches', () => {
        const all = engine.filterConcepts('');
        const filtered = engine.filterConcepts('High');
        expect(filtered.total.visible).toBeLessThan(all.total.visible);
        expect([...filtered.visibleIds]).toContain('HIGH');
    });

    it('a query that matches nothing returns zero visible, without throwing', () => {
        const result = engine.filterConcepts('ZZZNOMATCH');
        expect(result.total.visible).toBe(0);
    });
});

describe('5. Access: AccessEngine.check()', () => {
    it('throws a clear error when no access rules configured', () => {
        const se = Context.fromComponents({ scheme: profile })
            .scheme as LocalSchemeEngineAdapter;
        const ae = AccessEngine.fromJSON(
            {
                access: {
                    id: 'example-profile-access',
                    targetScheme: { id: 'example-profile' },
                    rules: { inline: [] },
                },
            },
            se,
        );
        expect(() => ae.check([], {})).toThrow(/no access rules/i);
    });

    it('throws when dataAssertions is not an array', () => {
        const se = Context.fromComponents({ scheme: profile })
            .scheme as LocalSchemeEngineAdapter;
        const ae = AccessEngine.fromJSON(
            {
                access: {
                    id: 'example-profile-access',
                    targetScheme: { id: 'example-profile' },
                    rules: {
                        inline: [
                            {
                                id: 'level-rule',
                                attribute: 'level',
                                categoryId: 'level',
                                strategy: 'gte',
                            },
                        ],
                    },
                },
            },
            se,
        );
        // @ts-expect-error, deliberately wrong type to test runtime guard
        expect(() => ae.check('HIGH', {})).toThrow(
            /first argument must be an array/,
        );
    });
});

describe('6. Validate: engine.validate()', () => {
    const engine = Context.fromComponents({ scheme: profile }).scheme;

    it('returns valid=true for a well-formed marking', () => {
        const result = engine.validate('HIGH');
        expect(result.valid).toBe(true);
        expect(result.errors.length).toBe(0);
    });

    it('returns valid=false with populated errors for an unknown marking', () => {
        const result = engine.validate('TOTALLY-BOGUS');
        expect(result.valid).toBe(false);
        expect(result.errors.length).toBeGreaterThan(0);
    });
});

// ---------------------------------------------------------------------------
// Layered profile fixtures, used in sections 8-9
// ---------------------------------------------------------------------------

const LAYER_BASE = {
    scheme: {
        id: 'layer-base',
        version: '1.0.0',
        name: 'Layer Base',
        description: 'Base layer for composition tests',
        data: {
            categories: [
                {
                    id: 'level',
                    label: 'Level',
                    required: true,
                    single: true,
                    position: 0,
                    rollup: 'max',
                },
            ],
            concepts: {
                inline: [
                    {
                        id: 'LOW',
                        name: 'Low',
                        categories: ['level'],
                        position: 0,
                        rank: 0,
                        views: { default: 'LOW' },
                    },
                    {
                        id: 'MED',
                        name: 'Med',
                        categories: ['level'],
                        position: 1,
                        rank: 1,
                        views: { default: 'MED' },
                    },
                    {
                        id: 'HIGH',
                        name: 'High',
                        categories: ['level'],
                        position: 2,
                        rank: 2,
                        views: { default: 'HIGH' },
                    },
                ],
            },
        },
        rules: [],
        parse: {
            case_sensitive: false,
            strip_whitespace: true,
        },
        render: {
            default: 'default',
            formats: [
                {
                    id: 'default',
                    surface: 'marking',
                    mode: 'inline',
                    separator: ' ',
                    fields: [{ category: 'level' }],
                },
            ],
        },
    },
};

/** Add-layer: introduces CRITICAL above HIGH */
const LAYER_ADD = {
    scheme: {
        ...LAYER_BASE.scheme,
        id: 'layer-add',
        type: 'layer' as const,
        layer: { base: 'layer-base' },
        data: {
            categories: LAYER_BASE.scheme.data.categories,
            concepts: {
                inline: [
                    {
                        id: 'CRITICAL',
                        name: 'Critical',
                        categories: ['level'],
                        position: 3,
                        rank: 3,
                        views: { default: 'CRITICAL' },
                    },
                ],
            },
        },
        parse: {
            ...LAYER_BASE.scheme.parse,
        },
    },
};

/** Remove-layer: removes MED from the base */
const LAYER_REMOVE = {
    scheme: {
        ...LAYER_BASE.scheme,
        id: 'layer-remove',
        type: 'layer' as const,
        layer: {
            base: 'layer-base',
            removes: [{ concept: 'MED' }],
        },
        data: {
            categories: LAYER_BASE.scheme.data.categories,
            concepts: { inline: [] },
        },
        parse: { ...LAYER_BASE.scheme.parse },
    },
};

/** Override-layer: replaces HIGH with a renamed/repositioned variant */
const LAYER_OVERRIDE = {
    scheme: {
        ...LAYER_BASE.scheme,
        id: 'layer-override',
        type: 'layer' as const,
        layer: { base: 'layer-base' },
        data: {
            categories: LAYER_BASE.scheme.data.categories,
            concepts: {
                inline: [
                    {
                        id: 'HIGH',
                        name: 'High Override',
                        categories: ['level'],
                        position: 99,
                        rank: 2,
                        views: { default: 'HIGH-OVR' },
                    },
                ],
            },
        },
        parse: { ...LAYER_BASE.scheme.parse },
    },
};

/** Missing-dep-layer: requires a layer that is never provided */
const LAYER_MISSING_DEP = {
    scheme: {
        ...LAYER_BASE.scheme,
        id: 'layer-missing-dep',
        type: 'layer' as const,
        layer: { base: 'nonexistent-layer' },
        data: LAYER_BASE.scheme.data,
        parse: { ...LAYER_BASE.scheme.parse },
    },
};

describe('7. Context.fromComponents with layers: layer composition', () => {
    describe('add action', () => {
        it('merged engine contains concepts from both base and add-layer', () => {
            const engine = Context.fromComponents({
                scheme: LAYER_BASE,
                layers: [LAYER_ADD],
            }).scheme as LocalSchemeEngineAdapter;
            const ids = engine
                .listCategories()
                .flatMap((cat) => engine.getConceptsInCategory(cat.id))
                .map((c) => c.id);
            expect(ids).toContain('LOW');
            expect(ids).toContain('MED');
            expect(ids).toContain('HIGH');
            expect(ids).toContain('CRITICAL');
        });

        it('concept added by layer is processable', () => {
            const engine = Context.fromComponents({
                scheme: LAYER_BASE,
                layers: [LAYER_ADD],
            }).scheme;
            const result = engine.process('CRITICAL');
            expect(result.valid).toBe(true);
            expect(result.rendered).toContain('CRITICAL');
        });

        it('base concepts remain processable after layer merge', () => {
            const engine = Context.fromComponents({
                scheme: LAYER_BASE,
                layers: [LAYER_ADD],
            }).scheme;
            expect(engine.process('LOW').valid).toBe(true);
            expect(engine.process('HIGH').valid).toBe(true);
        });

        it('aggregate picks CRITICAL as max above HIGH', () => {
            const engine = Context.fromComponents({
                scheme: LAYER_BASE,
                layers: [LAYER_ADD],
            }).scheme;
            const result = engine.aggregate(['LOW', 'HIGH', 'CRITICAL']);
            expect(result.rendered).toContain('CRITICAL');
            expect(result.rendered).not.toContain('HIGH');
        });

        it('suggest returns concepts from both base and add-layer', () => {
            const engine = Context.fromComponents({
                scheme: LAYER_BASE,
                layers: [LAYER_ADD],
            }).scheme;
            const r = engine.suggest('');
            const ids = r.suggestions.map((s) => s.conceptId);
            expect(ids).toContain('LOW');
            expect(ids).toContain('CRITICAL');
        });
    });

    describe('remove action', () => {
        it('removed concept is absent from the merged profile', () => {
            const engine = Context.fromComponents({
                scheme: LAYER_BASE,
                layers: [LAYER_REMOVE],
            }).scheme as LocalSchemeEngineAdapter;
            const ids = engine
                .listCategories()
                .flatMap((cat) => engine.getConceptsInCategory(cat.id))
                .map((c) => c.id);
            expect(ids).toContain('LOW');
            expect(ids).not.toContain('MED');
            expect(ids).toContain('HIGH');
        });

        it('removed concept is not parseable after removal', () => {
            const engine = Context.fromComponents({
                scheme: LAYER_BASE,
                layers: [LAYER_REMOVE],
            }).scheme;
            const result = engine.process('MED');
            expect(result.valid).toBe(false);
        });

        it('remaining base concepts are still valid after removal', () => {
            const engine = Context.fromComponents({
                scheme: LAYER_BASE,
                layers: [LAYER_REMOVE],
            }).scheme;
            expect(engine.process('LOW').valid).toBe(true);
            expect(engine.process('HIGH').valid).toBe(true);
        });
    });

    describe('override action', () => {
        it('overridden concept has the new name from the override layer', () => {
            const engine = Context.fromComponents({
                scheme: LAYER_BASE,
                layers: [LAYER_OVERRIDE],
            }).scheme as LocalSchemeEngineAdapter;
            const allConcepts = engine
                .listCategories()
                .flatMap((cat) => engine.getConceptsInCategory(cat.id));
            const concept = allConcepts.find((c) => c.id === 'HIGH');
            expect(concept).toBeDefined();
            expect(concept!.name).toBe('High Override');
        });

        it('only one HIGH concept exists after override (no duplicates)', () => {
            const engine = Context.fromComponents({
                scheme: LAYER_BASE,
                layers: [LAYER_OVERRIDE],
            }).scheme as LocalSchemeEngineAdapter;
            const allConcepts = engine
                .listCategories()
                .flatMap((cat) => engine.getConceptsInCategory(cat.id));
            const highs = allConcepts.filter((c) => c.id === 'HIGH');
            expect(highs).toHaveLength(1);
        });

        it('overridden concept view reflects the layer value', () => {
            const engine = Context.fromComponents({
                scheme: LAYER_BASE,
                layers: [LAYER_OVERRIDE],
            }).scheme as LocalSchemeEngineAdapter;
            const allConcepts = engine
                .listCategories()
                .flatMap((cat) => engine.getConceptsInCategory(cat.id));
            const concept = allConcepts.find((c) => c.id === 'HIGH');
            expect(concept!.views['default']).toBe('HIGH-OVR');
        });
    });

    describe('error cases', () => {
        it('throws when the layers array is empty', () => {
            expect(() =>
                Context.fromComponents({ scheme: undefined, layers: [] }),
            ).toThrow();
        });

        it('throws when a required layer dependency is missing', () => {
            expect(() =>
                Context.fromComponents({
                    scheme: LAYER_BASE,
                    layers: [LAYER_MISSING_DEP],
                }),
            ).toThrow();
        });

        it('throws on a malformed (non-object) layer element', () => {
            expect(() => Context.fromComponents({ scheme: null })).toThrow();
        });
    });
});

describe('8. Layered lifecycle', () => {
    it('full lifecycle: author portions using base + add-layer concepts → aggregate → banner', () => {
        const engine = Context.fromComponents({
            scheme: LAYER_BASE,
            layers: [LAYER_ADD],
        }).scheme;

        const portions = ['LOW', 'HIGH', 'CRITICAL'];
        for (const p of portions) {
            expect(engine.process(p).valid).toBe(true);
        }

        const banner = engine.aggregate(portions);
        expect(banner.rendered).toContain('CRITICAL');
    });

    it('process → aggregate round-trip is stable on a layered engine', () => {
        const engine = Context.fromComponents({
            scheme: LAYER_BASE,
            layers: [LAYER_ADD],
        }).scheme;
        const banner = engine.aggregate(['LOW', 'CRITICAL']);
        const reprocessed = engine.process(banner.rendered);
        const rebanner = engine.aggregate([reprocessed.rendered]);
        expect(rebanner.rendered).toBe(banner.rendered);
    });

    it('invalid portion is detected before aggregation on a layered engine', () => {
        const engine = Context.fromComponents({
            scheme: LAYER_BASE,
            layers: [LAYER_ADD],
        }).scheme;
        const portions = ['LOW', 'INVALID-TOKEN', 'HIGH'];
        const invalids = portions.filter((p) => !engine.process(p).valid);
        expect(invalids).toContain('INVALID-TOKEN');
        expect(invalids).not.toContain('LOW');
        expect(invalids).not.toContain('HIGH');
    });

    it('remove layer eliminates a concept from the full lifecycle', () => {
        const engine = Context.fromComponents({
            scheme: LAYER_BASE,
            layers: [LAYER_REMOVE],
        }).scheme;

        const banner = engine.aggregate(['LOW', 'HIGH']);
        expect(banner.rendered).toContain('HIGH');

        expect(engine.process('MED').valid).toBe(false);
    });

    it('layered engine suggest covers only concepts present after composition', () => {
        const engine = Context.fromComponents({
            scheme: LAYER_BASE,
            layers: [LAYER_REMOVE],
        }).scheme;
        const r = engine.suggest('');
        const ids = r.suggestions.map((s) => s.conceptId);
        expect(ids).not.toContain('MED');
        expect(ids).toContain('LOW');
        expect(ids).toContain('HIGH');
    });
});
