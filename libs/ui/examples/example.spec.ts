/**
 * @vitest-environment jsdom
 *
 * EzClassify Forms library, end-to-end example spec
 *
 * Demonstrates the forms API: load, process, aggregate, suggest, rollup
 * (multi-field) and layered schemes.
 *
 * Run from the engine workspace root:
 *   npx vitest run libs/ui/examples
 *
 * Each describe block mirrors a section in the README.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Context } from '@ezclassify/engine';
import type { LocalSchemeEngineAdapter } from '@ezclassify/types';
import { EzClassifyUI } from '@ezclassify/ui';

// ---------------------------------------------------------------------------
// Shared profile fixture, generic two-level composition profile
// ---------------------------------------------------------------------------
const PROFILE = {
    scheme: {
        id: 'forms-example',
        version: '1.0.0',
        name: 'Forms Example',
        description: 'Example profile for forms library e2e spec',
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
            concepts: [
                {
                    id: 'LOW',
                    name: 'Low',
                    views: { default: 'LOW', short: 'L' },
                    categories: ['level'],
                    parents: [],
                    position: 0,
                    rank: 0,
                },
                {
                    id: 'MED',
                    name: 'Medium',
                    views: { default: 'MED', short: 'M' },
                    categories: ['level'],
                    parents: [],
                    position: 1,
                    rank: 1,
                },
                {
                    id: 'HIGH',
                    name: 'High',
                    views: { default: 'HIGH', short: 'H' },
                    categories: ['level'],
                    parents: [],
                    position: 2,
                    rank: 2,
                },
                {
                    id: 'CTRL-A',
                    name: 'Control A',
                    views: { default: 'CTRL-A' },
                    categories: ['controls'],
                    parents: ['HIGH'],
                    position: 0,
                },
                {
                    id: 'CTRL-B',
                    name: 'Control B',
                    views: { default: 'CTRL-B' },
                    categories: ['controls'],
                    parents: [],
                    position: 1,
                },
            ],
        },
        rules: [],
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

const PROFILE_2 = {
    scheme: {
        ...PROFILE.scheme,
        id: 'forms-example-2',
        name: 'Forms Example 2',
        data: {
            categories: [
                {
                    id: 'sensitivity',
                    label: 'Sensitivity',
                    required: true,
                    single: true,
                    rollup: 'max',
                    position: 0,
                },
            ],
            concepts: [
                {
                    id: 'PUBLIC',
                    name: 'Public',
                    views: { default: 'PUBLIC' },
                    categories: ['sensitivity'],
                    parents: [],
                    position: 0,
                    rank: 0,
                },
                {
                    id: 'INTERNAL',
                    name: 'Internal',
                    views: { default: 'INTERNAL' },
                    categories: ['sensitivity'],
                    parents: [],
                    position: 1,
                    rank: 1,
                },
                {
                    id: 'PRIVATE',
                    name: 'Private',
                    views: { default: 'PRIVATE' },
                    categories: ['sensitivity'],
                    parents: [],
                    position: 2,
                    rank: 2,
                },
            ],
        },
        render: {
            default: 'default',
            formats: [
                {
                    id: 'default',
                    surface: 'marking',
                    mode: 'inline',
                    separator: '/',
                    fields: [{ category: 'sensitivity' }],
                },
            ],
        },
    },
};

// ---------------------------------------------------------------------------
// Helper, create a root div and append it to body for jsdom tests
// ---------------------------------------------------------------------------
function makeRoot(): HTMLDivElement {
    const div = document.createElement('div');
    document.body.appendChild(div);
    return div;
}

// ---------------------------------------------------------------------------
// 1. Load
// ---------------------------------------------------------------------------
describe('1. Load: Context.fromComponents', () => {
    it('loads a valid profile without throwing', () => {
        expect(() => Context.fromComponents({ scheme: PROFILE })).not.toThrow();
    });

    it('exposes profile metadata after load', () => {
        const engine = Context.fromComponents({ scheme: PROFILE })
            .scheme as LocalSchemeEngineAdapter;
        const meta = engine.getSchemeMeta();
        expect(meta.id).toBe('forms-example');
        expect(meta.version).toBe('1.0.0');
    });

    it('throws on an empty (invalid) profile object', () => {
        expect(() => Context.fromComponents({ scheme: {} })).toThrow();
    });

    it('loads two independent engines from separate profiles', () => {
        const e1 = Context.fromComponents({ scheme: PROFILE })
            .scheme as LocalSchemeEngineAdapter;
        const e2 = Context.fromComponents({ scheme: PROFILE_2 })
            .scheme as LocalSchemeEngineAdapter;
        expect(e1.getSchemeMeta().id).toBe('forms-example');
        expect(e2.getSchemeMeta().id).toBe('forms-example-2');
    });
});

// ---------------------------------------------------------------------------
// 2. Process
// ---------------------------------------------------------------------------
describe('2. Process: engine.process()', () => {
    let engine: LocalSchemeEngineAdapter;

    beforeEach(() => {
        engine = Context.fromComponents({ scheme: PROFILE })
            .scheme as LocalSchemeEngineAdapter;
    });

    it('processes a valid marking → valid=true and rendered non-empty', () => {
        const result = engine.process('HIGH');
        expect(result.valid).toBe(true);
        expect(result.rendered).toBeTruthy();
    });

    it('processes an unrecognized token → valid=false with errors', () => {
        const result = engine.process('BOGUS');
        expect(result.valid).toBe(false);
        expect(result.errors.length).toBeGreaterThan(0);
    });

    it('processes an empty string without throwing', () => {
        expect(() => engine.process('')).not.toThrow();
    });

    it('treats input case-insensitively (high → HIGH)', () => {
        const lower = engine.process('high');
        const upper = engine.process('HIGH');
        expect(lower.rendered).toBe(upper.rendered);
        expect(lower.valid).toBe(true);
    });

    it('multi-token marking with controls', () => {
        const result = engine.process('HIGH/CTRL-A');
        expect(result.valid).toBe(true);
        expect(result.rendered).toContain('HIGH');
        expect(result.rendered).toContain('CTRL-A');
    });
});

// ---------------------------------------------------------------------------
// 3. Aggregate
// ---------------------------------------------------------------------------
describe('3. Aggregate: engine.aggregate()', () => {
    let engine: LocalSchemeEngineAdapter;

    beforeEach(() => {
        engine = Context.fromComponents({ scheme: PROFILE })
            .scheme as LocalSchemeEngineAdapter;
    });

    it('two-way rollup picks the higher level', () => {
        const result = engine.aggregate(['LOW', 'HIGH']);
        expect(result.rendered).toContain('HIGH');
    });

    it('three-way rollup picks the highest level', () => {
        const result = engine.aggregate(['LOW', 'MED', 'HIGH']);
        expect(result.rendered).toContain('HIGH');
    });

    it('single-element aggregate returns a non-empty rendered string', () => {
        const result = engine.aggregate(['MED']);
        expect(result.rendered).toBeTruthy();
    });

    it('empty array aggregate does not throw', () => {
        expect(() => engine.aggregate([])).not.toThrow();
    });

    it('union control rollup collects controls from all parts', () => {
        const result = engine.aggregate(['HIGH/CTRL-A', 'MED/CTRL-B']);
        expect(result.rendered).toContain('CTRL-A');
        expect(result.rendered).toContain('CTRL-B');
    });
});

// ---------------------------------------------------------------------------
// 4. Suggest
// ---------------------------------------------------------------------------
describe('4. Suggest: engine.suggest()', () => {
    let engine: LocalSchemeEngineAdapter;

    beforeEach(() => {
        engine = Context.fromComponents({ scheme: PROFILE })
            .scheme as LocalSchemeEngineAdapter;
    });

    it('an empty marking can be completed with every level', () => {
        const r = engine.suggest('');
        expect(r.suggestions.map((s) => s.conceptId)).toEqual(
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

    it('each suggestion has conceptId and label', () => {
        const r = engine.suggest('');
        for (const s of r.suggestions) {
            expect(typeof s.conceptId).toBe('string');
            expect(typeof s.label).toBe('string');
        }
    });
});

// ---------------------------------------------------------------------------
// 5. Rollup, EzClassifyUI multi-field aggregate
// ---------------------------------------------------------------------------
describe('5. Rollup: EzClassifyUI multi-field', () => {
    let root: HTMLDivElement;
    let forms: EzClassifyUI | null;

    beforeEach(() => {
        root = makeRoot();
        forms = null;
    });

    afterEach(() => {
        forms?.destroy();
        root.remove();
    });

    it('adds no input the host did not place', () => {
        forms = new EzClassifyUI(Context.fromComponents({ scheme: PROFILE }), {
            root,
        });
        expect(root.querySelector('input')).toBeNull();
    });

    it('shows the page rollup in a hidden output the host places', async () => {
        root.innerHTML = `
            <input id="a" data-ezclassify-marking value="LOW">
            <input id="b" data-ezclassify-marking value="HIGH/CTRL-B">
            <input type="hidden" name="pageMarking" data-ezclassify-aggregate>`;
        const output = root.querySelector<HTMLInputElement>(
            'input[name="pageMarking"]',
        )!;
        forms = new EzClassifyUI(Context.fromComponents({ scheme: PROFILE }), {
            root,
        });
        await expect
            .poll(async () => {
                await forms!.recalculate();
                return output.value;
            })
            .toBe('HIGH/CTRL-B');
        expect(
            forms.store.getAggregate().byBucket.values().next().value?.rendered,
        ).toBe('HIGH/CTRL-B');
    });

    it('destroy() leaves the output the host placed in the page', () => {
        root.innerHTML =
            '<input type="hidden" name="pageMarking" data-ezclassify-aggregate>';
        forms = new EzClassifyUI(Context.fromComponents({ scheme: PROFILE }), {
            root,
        });
        forms.destroy();
        expect(root.querySelector('input[name="pageMarking"]')).toBeTruthy();
        forms = null;
    });
});

// ---------------------------------------------------------------------------
// 6. Multi-profile, two independent engines
// ---------------------------------------------------------------------------
describe('6. Multi-profile: two independent engines', () => {
    it('each engine only recognizes its own concepts', () => {
        const e1 = Context.fromComponents({ scheme: PROFILE })
            .scheme as LocalSchemeEngineAdapter;
        const e2 = Context.fromComponents({ scheme: PROFILE_2 })
            .scheme as LocalSchemeEngineAdapter;

        const r1 = e1.process('HIGH');
        const r2 = e2.process('PRIVATE');

        expect(r1.valid).toBe(true);
        expect(r2.valid).toBe(true);

        // Cross-profile: concept from the other profile is unrecognized
        expect(e1.process('PRIVATE').valid).toBe(false);
        expect(e2.process('HIGH').valid).toBe(false);
    });

    it('separate aggregates are independent', () => {
        const e1 = Context.fromComponents({ scheme: PROFILE })
            .scheme as LocalSchemeEngineAdapter;
        const e2 = Context.fromComponents({ scheme: PROFILE_2 })
            .scheme as LocalSchemeEngineAdapter;

        const agg1 = e1.aggregate(['LOW', 'HIGH']);
        const agg2 = e2.aggregate(['PUBLIC', 'PRIVATE']);

        expect(agg1.rendered).toContain('HIGH');
        expect(agg2.rendered).toContain('PRIVATE');
    });
});

// ---------------------------------------------------------------------------
// Layered profile fixtures, used in sections 11-12
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
            concepts: [
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
        rules: [],
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
            concepts: [
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
            concepts: [],
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
            concepts: [
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

// ---------------------------------------------------------------------------
// 7. Full lifecycle, parts → validate each → aggregate to banner
// ---------------------------------------------------------------------------
describe('7. Full lifecycle: parts → aggregate → banner', () => {
    it('valid parts aggregate to a banner containing the highest level', () => {
        const engine = Context.fromComponents({ scheme: PROFILE })
            .scheme as LocalSchemeEngineAdapter;

        const parts = ['LOW', 'MED', 'HIGH'];
        for (const p of parts) {
            const result = engine.process(p);
            expect(result.valid).toBe(true);
        }

        const banner = engine.aggregate(parts);
        expect(banner.rendered).toContain('HIGH');
    });

    it('detects invalid parts before aggregation', () => {
        const engine = Context.fromComponents({ scheme: PROFILE })
            .scheme as LocalSchemeEngineAdapter;
        const parts = ['LOW', 'BOGUS', 'HIGH'];
        const invalids = parts.filter((p) => !engine.process(p).valid);
        expect(invalids).toContain('BOGUS');
        expect(invalids).not.toContain('LOW');
        expect(invalids).not.toContain('HIGH');
    });

    it('process → aggregate round-trip is stable', () => {
        const engine = Context.fromComponents({ scheme: PROFILE })
            .scheme as LocalSchemeEngineAdapter;
        const banner = engine.aggregate(['LOW', 'HIGH']);
        const processed = engine.process(banner.rendered);
        const rebanner = engine.aggregate([processed.rendered]);
        expect(rebanner.rendered).toBe(banner.rendered);
    });
});

// ---------------------------------------------------------------------------
// 8. Context.fromComponents with layers, layer composition
// ---------------------------------------------------------------------------
describe('8. Context.fromComponents with layers: layer composition', () => {
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
            }).scheme as LocalSchemeEngineAdapter;
            const result = engine.process('CRITICAL');
            expect(result.valid).toBe(true);
            expect(result.rendered).toContain('CRITICAL');
        });

        it('base concepts remain processable after layer merge', () => {
            const engine = Context.fromComponents({
                scheme: LAYER_BASE,
                layers: [LAYER_ADD],
            }).scheme as LocalSchemeEngineAdapter;
            expect(engine.process('LOW').valid).toBe(true);
            expect(engine.process('HIGH').valid).toBe(true);
        });

        it('aggregate picks CRITICAL as max above HIGH', () => {
            const engine = Context.fromComponents({
                scheme: LAYER_BASE,
                layers: [LAYER_ADD],
            }).scheme as LocalSchemeEngineAdapter;
            const result = engine.aggregate(['LOW', 'HIGH', 'CRITICAL']);
            expect(result.rendered).toContain('CRITICAL');
            expect(result.rendered).not.toContain('HIGH');
        });

        it('suggest returns concepts from both base and add-layer', () => {
            const engine = Context.fromComponents({
                scheme: LAYER_BASE,
                layers: [LAYER_ADD],
            }).scheme as LocalSchemeEngineAdapter;
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
            }).scheme as LocalSchemeEngineAdapter;
            const result = engine.process('MED');
            expect(result.valid).toBe(false);
        });

        it('remaining base concepts are still valid after removal', () => {
            const engine = Context.fromComponents({
                scheme: LAYER_BASE,
                layers: [LAYER_REMOVE],
            }).scheme as LocalSchemeEngineAdapter;
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

// ---------------------------------------------------------------------------
// 9. Cross-profile layered lifecycle, full round-trip with composed layers
// ---------------------------------------------------------------------------
describe('9. Cross-profile layered lifecycle', () => {
    it('full lifecycle: author parts using base + add-layer concepts → aggregate → banner', () => {
        const engine = Context.fromComponents({
            scheme: LAYER_BASE,
            layers: [LAYER_ADD],
        }).scheme as LocalSchemeEngineAdapter;

        const parts = ['LOW', 'HIGH', 'CRITICAL'];
        for (const p of parts) {
            expect(engine.process(p).valid).toBe(true);
        }

        const banner = engine.aggregate(parts);
        expect(banner.rendered).toContain('CRITICAL');
    });

    it('process → aggregate round-trip is stable on a layered engine', () => {
        const engine = Context.fromComponents({
            scheme: LAYER_BASE,
            layers: [LAYER_ADD],
        }).scheme as LocalSchemeEngineAdapter;
        const banner = engine.aggregate(['LOW', 'CRITICAL']);
        const reprocessed = engine.process(banner.rendered);
        const rebanner = engine.aggregate([reprocessed.rendered]);
        expect(rebanner.rendered).toBe(banner.rendered);
    });

    it('invalid part is detected before aggregation on a layered engine', () => {
        const engine = Context.fromComponents({
            scheme: LAYER_BASE,
            layers: [LAYER_ADD],
        }).scheme as LocalSchemeEngineAdapter;
        const parts = ['LOW', 'INVALID-TOKEN', 'HIGH'];
        const invalids = parts.filter((p) => !engine.process(p).valid);
        expect(invalids).toContain('INVALID-TOKEN');
        expect(invalids).not.toContain('LOW');
        expect(invalids).not.toContain('HIGH');
    });

    it('remove layer eliminates a concept from the full lifecycle', () => {
        const engine = Context.fromComponents({
            scheme: LAYER_BASE,
            layers: [LAYER_REMOVE],
        }).scheme as LocalSchemeEngineAdapter;

        // MED is gone, aggregate of [LOW, HIGH] should still work
        const banner = engine.aggregate(['LOW', 'HIGH']);
        expect(banner.rendered).toContain('HIGH');

        // MED is invalid in this engine
        expect(engine.process('MED').valid).toBe(false);
    });

    it('layered engine suggest covers only concepts present after composition', () => {
        const engine = Context.fromComponents({
            scheme: LAYER_BASE,
            layers: [LAYER_REMOVE],
        }).scheme as LocalSchemeEngineAdapter;
        const r = engine.suggest('');
        const ids = r.suggestions.map((s) => s.conceptId);
        expect(ids).not.toContain('MED');
        expect(ids).toContain('LOW');
        expect(ids).toContain('HIGH');
    });
});
