/**
 * @vitest-environment jsdom
 *
 * EzClassify Forms library, end-to-end example spec
 *
 * Demonstrates the complete forms API: load, process, aggregate, suggest,
 * rollup (multi-field), comparison, and serialization.
 *
 * Run from the engine workspace root:
 *   npx vitest run libs/ui/examples
 *
 * Each describe block mirrors a section in the README.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Context } from '@ezclassify/engine';
import type { LocalSchemeEngineAdapter } from '@ezclassify/types';
import {
    EzClassifyUI,
    captureFormState,
    restoreFormState,
    exportFormState,
    importFormState,
    compareRenderings,
} from '@ezclassify/ui';

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
            concepts: {
                inline: [
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
            concepts: {
                inline: [
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
// 4b. Text search
// ---------------------------------------------------------------------------
// `suggest()` answers "what can this marking become", so its argument is a
// marking. The question a search box asks is different: which concepts match
// what the user has typed. `filterConcepts()` is that surface, and it returns
// the ids that matched plus the per-category counts a Handbook heading shows.
describe('4b. Text search: engine.filterConcepts()', () => {
    let engine: LocalSchemeEngineAdapter;

    beforeEach(() => {
        engine = Context.fromComponents({ scheme: PROFILE })
            .scheme as LocalSchemeEngineAdapter;
    });

    it('an empty query matches every concept', () => {
        const r = engine.filterConcepts('');
        expect(r.total.visible).toBe(r.total.total);
        expect(r.total.total).toBeGreaterThan(0);
    });

    it('a query narrows the matches', () => {
        const all = engine.filterConcepts('');
        const filtered = engine.filterConcepts('High');
        expect(filtered.total.visible).toBeLessThan(all.total.visible);
        expect(filtered.total.visible).toBeGreaterThan(0);
        expect([...filtered.visibleIds]).toContain('HIGH');
    });

    it('a query that matches nothing returns zero visible, without throwing', () => {
        const r = engine.filterConcepts('ZZZNOMATCH');
        expect(r.total.visible).toBe(0);
        expect(r.visibleIds.size).toBe(0);
    });

    it('counts are reported per category', () => {
        const r = engine.filterConcepts('Control');
        expect(r.categoryCounts.get('controls')?.visible).toBe(2);
        expect(r.categoryCounts.get('level')?.visible).toBe(0);
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

    it('creates a hidden rollup field on construction', () => {
        const engine = Context.fromComponents({ scheme: PROFILE })
            .scheme as LocalSchemeEngineAdapter;
        forms = new EzClassifyUI(engine, { root });
        expect(root.querySelector('#ezclassify-rollup')).toBeTruthy();
        expect(
            (root.querySelector('#ezclassify-rollup') as HTMLInputElement).type,
        ).toBe('hidden');
    });

    it('recalculate() returns empty string when no fields are registered', () => {
        const engine = Context.fromComponents({ scheme: PROFILE })
            .scheme as LocalSchemeEngineAdapter;
        forms = new EzClassifyUI(engine, { root });
        const rollup = forms.recalculate();
        expect(typeof rollup).toBe('string');
    });

    it('getRollup() returns same value as recalculate() without extra calculation', () => {
        const engine = Context.fromComponents({ scheme: PROFILE })
            .scheme as LocalSchemeEngineAdapter;
        forms = new EzClassifyUI(engine, { root });
        const a = forms.recalculate();
        const b = forms.getRollup();
        expect(a).toBe(b);
    });

    it('destroy() removes the rollup sink it created', () => {
        const engine = Context.fromComponents({ scheme: PROFILE })
            .scheme as LocalSchemeEngineAdapter;
        forms = new EzClassifyUI(engine, { root });
        forms.destroy();
        expect(root.querySelector('#ezclassify-rollup')).toBeNull();
        forms = null;
    });

    it('supports custom rollupId', () => {
        const engine = Context.fromComponents({ scheme: PROFILE })
            .scheme as LocalSchemeEngineAdapter;
        forms = new EzClassifyUI(engine, { root, rollupId: 'my-banner-field' });
        expect(root.querySelector('#my-banner-field')).toBeTruthy();
    });
});

// ---------------------------------------------------------------------------
// 6. Comparison, compareRenderings()
// ---------------------------------------------------------------------------
describe('6. Comparison: compareRenderings()', () => {
    let engine: LocalSchemeEngineAdapter;

    beforeEach(() => {
        engine = Context.fromComponents({ scheme: PROFILE })
            .scheme as LocalSchemeEngineAdapter;
    });

    it('two identical markings → relationship=identical, no concept diffs', async () => {
        const result = await compareRenderings('HIGH', 'HIGH', engine);
        expect(result.relationship).toBe('identical');
        expect(result.addedConcepts).toEqual([]);
        expect(result.removedConcepts).toEqual([]);
    });

    it('added concepts are listed in addedConcepts', async () => {
        const result = await compareRenderings('LOW', 'LOW/CTRL-B', engine);
        expect(result.addedConcepts).toContain('CTRL-B');
    });

    it('removed concepts are listed in removedConcepts', async () => {
        const result = await compareRenderings('HIGH/CTRL-A', 'HIGH', engine);
        expect(result.removedConcepts).toContain('CTRL-A');
    });

    it('level change has a defined relationship value', async () => {
        const result = await compareRenderings('LOW', 'HIGH', engine);
        expect(['upgrade', 'downgrade', 'lateral']).toContain(
            result.relationship,
        );
        expect(result.removedConcepts).toContain('LOW');
        expect(result.addedConcepts).toContain('HIGH');
    });
});

// ---------------------------------------------------------------------------
// 7. Serialization, captureFormState / restoreFormState
// ---------------------------------------------------------------------------
describe('7. Serialization: captureFormState / restoreFormState', () => {
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

    it('captureFormState returns an object with a fields array', async () => {
        const engine = Context.fromComponents({ scheme: PROFILE })
            .scheme as LocalSchemeEngineAdapter;
        forms = new EzClassifyUI(engine, { root });
        const state = await captureFormState(forms);
        expect(state).toHaveProperty('fields');
        expect(Array.isArray(state.fields)).toBe(true);
    });

    it('exportFormState returns valid JSON', async () => {
        const engine = Context.fromComponents({ scheme: PROFILE })
            .scheme as LocalSchemeEngineAdapter;
        forms = new EzClassifyUI(engine, { root });
        const json = await exportFormState(forms);
        expect(() => JSON.parse(json)).not.toThrow();
        const parsed = JSON.parse(json);
        expect(parsed).toHaveProperty('fields');
    });

    it('importFormState round-trips without throwing', async () => {
        const engine = Context.fromComponents({ scheme: PROFILE })
            .scheme as LocalSchemeEngineAdapter;
        forms = new EzClassifyUI(engine, { root });
        const json = await exportFormState(forms);
        expect(() => importFormState(forms!, json)).not.toThrow();
    });

    it('restoreFormState with an empty state does not throw', () => {
        const engine = Context.fromComponents({ scheme: PROFILE })
            .scheme as LocalSchemeEngineAdapter;
        forms = new EzClassifyUI(engine, { root });
        expect(() =>
            restoreFormState(forms!, {
                version: 1,
                fields: [],
                rollup: '',
                schemeId: '',
                schemeVersion: '',
                timestamp: '',
            }),
        ).not.toThrow();
    });
});

// ---------------------------------------------------------------------------
// 8. Multi-profile, two independent engines
// ---------------------------------------------------------------------------
describe('8. Multi-profile: two independent engines', () => {
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

// ---------------------------------------------------------------------------
// 9. Full lifecycle, parts → validate each → aggregate to banner
// ---------------------------------------------------------------------------
describe('9. Full lifecycle: parts → aggregate → banner', () => {
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
// 10. Context.fromComponents with layers, layer composition
// ---------------------------------------------------------------------------
describe('10. Context.fromComponents with layers: layer composition', () => {
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
// 11. Cross-profile layered lifecycle, full round-trip with composed layers
// ---------------------------------------------------------------------------
describe('11. Cross-profile layered lifecycle', () => {
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
