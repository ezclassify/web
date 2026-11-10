import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
    flushRollupNow,
    setOutputsIncomplete,
    updateRollup,
    type RollupEventDetail,
} from './rollup';
import type { BucketAggregate, BucketScheme, FormsContext } from './types';
import type { ComponentInstance } from '../components/component-base';
import type { Assertion } from '@ezclassify/types';
import { mockRenderFormats } from '../render-format-layout-mock';
import { SOLE_BUCKET, type BucketKey } from '../store/store-shared';
import { t } from '../i18n';

// Mock forms/dom
vi.mock('./dom', () => ({
    showCopiedIndicator: vi.fn(),
}));

function createMockEngine(overrides: Record<string, unknown> = {}) {
    const scheme: Record<string, unknown> = {
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
    const engine: Record<string, unknown> = {};
    engine.getScheme = () => scheme;
    engine.getSchemeMeta = () => ({
        id: (scheme.id as string) ?? 'test',
        version: (scheme.version as string) ?? '1.0',
        name: (scheme.name as string) ?? 'Test',
        defaultRenderFormat:
            (scheme.defaultRenderFormat as string) ?? 'default',
        formats: mockRenderFormats(scheme.formats as any[]),
        scopes: (scheme.scopes as any[]) ?? [],
        vocabulary: scheme.vocabulary,
        labelPresets: scheme.label_presets,
    });
    engine.listCategories = () => (scheme.categories as any[]) ?? [];
    engine.getConceptsInCategory = (catId: string) =>
        ((scheme.concepts as any[]) ?? []).filter((c: any) =>
            c.categories?.includes(catId),
        );
    Object.assign(engine, {
        render: vi.fn((assertions: Assertion[]) => {
            return assertions.map((a) => a.conceptId).join(',');
        }),
        process: vi.fn((input: string) => ({
            assertions: input
                ? input.split(',').map((id) => ({
                      conceptId: id.trim(),
                      categoryId: 'level',
                      confidence: 'certain' as const,
                      source: 'parse' as const,
                  }))
                : [],
            rendered: input,
            valid: true,
        })),
        suggest: vi.fn(() => ({ suggestions: [] })),
        aggregate: vi.fn((values: string[]) => ({
            assertions: [],
            rendered: values.join('|'),
            valid: true,
        })),
        uncoveredAssertions: vi.fn(
            (candidates: Assertion[], parent: Assertion[]) => {
                const parentKeys = new Set(
                    parent.map((a) => `${a.conceptId}::${a.categoryId}`),
                );
                return candidates.filter(
                    (a) => !parentKeys.has(`${a.conceptId}::${a.categoryId}`),
                );
            },
        ),
        checkCoverage: vi.fn(async (children: string[], parent: string) => {
            if (!parent || !Array.isArray(children) || children.length === 0) {
                return {
                    covered: true,
                    missing: [],
                    missingLabels: [],
                    excess: [],
                    excessLabels: [],
                    rendered: '',
                };
            }
            const nonEmpty = children.filter((c) => !!c);
            if (nonEmpty.length === 0) {
                return {
                    covered: true,
                    missing: [],
                    missingLabels: [],
                    excess: [],
                    excessLabels: [],
                    rendered: '',
                };
            }
            const aggregate = engine['aggregate'] as (...args: unknown[]) => {
                rendered: string;
            };
            const agg = await aggregate([...nonEmpty, parent], {
                format: 'default',
            });
            const rendered = agg?.rendered ?? '';
            return {
                covered: rendered === parent,
                missing: [],
                missingLabels: [],
                excess: [],
                excessLabels: [],
                rendered,
            };
        }),
    });
    return engine as unknown as FormsContext['engine'];
}

/** The scheme operations of `bucket`, answered by the mock engine. */
function bucketScheme(
    engine: FormsContext['engine'],
    bucket: BucketKey = SOLE_BUCKET,
): BucketScheme {
    const e = engine as unknown as Record<string, (...args: unknown[]) => any>;
    return {
        bucket,
        adapter: engine,
        process: (input, options) => e.process(input, options),
        validate: (input, options) => e.process(input, options),
        checkCoverage: (children, parent, options) =>
            e.checkCoverage(children, parent, options),
        getSchemeMeta: () => e.getSchemeMeta(),
    };
}

/** A store's level rollups, by level id (`null` for the page). */
type Levels = Map<string | null, Map<BucketKey, BucketAggregate>>;

function aggregate(rendered: string, stale?: boolean): BucketAggregate {
    return {
        rendered,
        assertions: rendered
            ? [
                  {
                      conceptId: rendered,
                      categoryId: 'level',
                      confidence: 'certain',
                      source: 'parse',
                  } as Assertion,
              ]
            : [],
        ...(stale ? { stale } : {}),
    };
}

function createMockCtx(
    overrides: Partial<FormsContext> = {},
    levels: Levels = new Map(),
): FormsContext {
    const engine = createMockEngine();
    return {
        engine,
        schemeOf: () => bucketScheme(engine),
        bucketsNamed: (contextKey: string | null, scheme: string | null) =>
            contextKey === null && scheme === null ? [SOLE_BUCKET] : [],
        aggregateOf: vi.fn((id: string | null) => levels.get(id) ?? new Map()),
        destroyed: false,
        root: document.body,
        fields: [],
        defaultFormat: 'default',
        defaultPartFormat: 'default',
        domObserver: null,
        autocompleters: new Map(),
        lastValidated: new Map(),
        fieldAssertions: new Map(),
        tooltipEl: null,
        settingValue: false,
        colorMap: {},
        initializing: false,
        mountInstanceId: 'instance',
        mounted: new Map(),
        partOfMap: new Map(),
        aggregates: new Map(),
        ...overrides,
    } as FormsContext;
}

function createMockComponent(rendered: string): ComponentInstance {
    return {
        init: vi.fn(),
        getAssertions: vi.fn(() => []),
        setAssertions: vi.fn(),
        setValue: vi.fn(),
        destroy: vi.fn(),
        getRendered: vi.fn(() => rendered),
    };
}

/** A host-placed output: a hidden input showing a level. */
function sink(
    level = '',
    attrs: Record<string, string> = {},
): HTMLInputElement {
    const el = document.createElement('input');
    el.type = 'hidden';
    el.setAttribute('data-ezclassify-aggregate', level);
    for (const [name, value] of Object.entries(attrs))
        el.setAttribute(`data-ezclassify-${name}`, value);
    document.body.appendChild(el);
    return el;
}

function rollupEvents(target: EventTarget): RollupEventDetail[] {
    const seen: RollupEventDetail[] = [];
    target.addEventListener('ezclassify:rollup', (e) =>
        seen.push((e as CustomEvent<RollupEventDetail>).detail),
    );
    return seen;
}

describe('rollup outputs', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
    });

    it("fills a bare hidden sink with the store's page rollup and announces the change", async () => {
        const out = sink();
        const changes: string[] = [];
        out.addEventListener('change', () => changes.push(out.value));
        const ctx = createMockCtx(
            {},
            new Map([[null, new Map([[SOLE_BUCKET, aggregate('SECRET')]])]]),
        );

        await updateRollup(ctx);
        await updateRollup(ctx);

        expect(out.value).toBe('SECRET');
        expect(changes).toEqual(['SECRET']);
    });

    it('lowers a sink when the rollup it shows goes down, never reading its own value back', async () => {
        const out = sink();
        const levels: Levels = new Map([
            [null, new Map([[SOLE_BUCKET, aggregate('SECRET')]])],
        ]);
        // Bound the way a controller-less input is bound: among the fields.
        const ctx = createMockCtx({ fields: [out] }, levels);
        await updateRollup(ctx);
        expect(out.value).toBe('SECRET');

        levels.set(null, new Map([[SOLE_BUCKET, aggregate('UNCLASSIFIED')]]));
        await updateRollup(ctx);

        expect(out.value).toBe('UNCLASSIFIED');
        expect(ctx.engine.aggregate).not.toHaveBeenCalled();
    });

    it('fills a sink named for a whole with its parts rollup, and one named for a collection with its members', async () => {
        const whole = document.createElement('input');
        whole.id = 'memo';
        document.body.appendChild(whole);
        const part = document.createElement('input');
        document.body.appendChild(part);
        const folder = document.createElement('section');
        folder.setAttribute('data-ezclassify-collection', 'folderA');
        document.body.appendChild(folder);
        const wholeSink = sink('memo');
        const folderSink = sink('folderA');
        const ctx = createMockCtx(
            { fields: [whole, part], partOfMap: new Map([[part, 'memo']]) },
            new Map([
                ['memo', new Map([[SOLE_BUCKET, aggregate('CONFIDENTIAL')]])],
                ['folderA', new Map([[SOLE_BUCKET, aggregate('SECRET')]])],
            ]),
        );

        await updateRollup(ctx);

        expect(wholeSink.value).toBe('CONFIDENTIAL');
        expect(folderSink.value).toBe('SECRET');
    });

    it('shows the rollup as text on a controller-less element that holds no value', async () => {
        const mirror = document.createElement('span');
        mirror.setAttribute('data-ezclassify-aggregate', '');
        document.body.appendChild(mirror);
        const ctx = createMockCtx(
            {},
            new Map([[null, new Map([[SOLE_BUCKET, aggregate('SECRET')]])]]),
        );

        await updateRollup(ctx);

        expect(mirror.textContent).toBe('SECRET');
    });

    it('reads a framework\'s "true" as a bare attribute: the page', async () => {
        const out = sink('true');
        const ctx = createMockCtx(
            {},
            new Map([[null, new Map([[SOLE_BUCKET, aggregate('SECRET')]])]]),
        );

        await updateRollup(ctx);

        expect(out.value).toBe('SECRET');
    });

    it('leaves a component view and an output another instance owns alone', async () => {
        const banner = sink();
        banner.setAttribute('data-ezclassify-controller', 'banner');
        const nested = document.createElement('div');
        nested.setAttribute('data-ezclassify-mount-root', 'other');
        document.body.appendChild(nested);
        const foreign = document.createElement('input');
        foreign.type = 'hidden';
        foreign.setAttribute('data-ezclassify-aggregate', '');
        nested.appendChild(foreign);
        const ctx = createMockCtx(
            {},
            new Map([[null, new Map([[SOLE_BUCKET, aggregate('SECRET')]])]]),
        );

        await updateRollup(ctx);

        expect(banner.value).toBe('');
        expect(foreign.value).toBe('');
    });

    it('refuses a sink naming no whole or collection, once, and leaves it empty and invalid', async () => {
        const out = sink('nowhere');
        out.value = 'SECRET';
        const reportHostError = vi.fn();
        const ctx = createMockCtx({ reportHostError });

        await updateRollup(ctx);
        await updateRollup(ctx);

        expect(out.value).toBe('');
        expect(out.getAttribute('aria-invalid')).toBe('true');
        expect(reportHostError).toHaveBeenCalledTimes(1);
        expect(reportHostError.mock.calls[0][0]).toMatchObject({
            code: 'aggregate-level-unknown',
            element: out,
        });
    });

    it('marks a sink incomplete while the store holds its bucket as stale, and clears it once fresh', async () => {
        const out = document.createElement('input');
        out.setAttribute('data-ezclassify-aggregate', '');
        out.required = true;
        document.body.appendChild(out);
        const levels: Levels = new Map([
            [null, new Map([[SOLE_BUCKET, aggregate('SECRET', true)]])],
        ]);
        const ctx = createMockCtx({}, levels);

        await updateRollup(ctx);
        expect(out.value).toBe('SECRET');
        expect(out.getAttribute('aria-invalid')).toBe('true');
        expect(out.validationMessage).toBe(t('rollup.incomplete'));

        levels.set(null, new Map([[SOLE_BUCKET, aggregate('SECRET')]]));
        await updateRollup(ctx);
        expect(out.hasAttribute('aria-invalid')).toBe(false);
        expect(out.validationMessage).toBe('');
    });

    it('carries what the instance could not read to every sink, and keeps a message the host set', async () => {
        const out = document.createElement('input');
        out.setAttribute('data-ezclassify-aggregate', '');
        document.body.appendChild(out);
        const ctx = createMockCtx(
            {},
            new Map([[null, new Map([[SOLE_BUCKET, aggregate('SECRET')]])]]),
        );
        await updateRollup(ctx);

        setOutputsIncomplete(ctx, true);
        expect(out.getAttribute('aria-invalid')).toBe('true');
        expect(out.validationMessage).toBe(t('rollup.incomplete'));

        setOutputsIncomplete(ctx, false);
        expect(out.hasAttribute('aria-invalid')).toBe(false);
        expect(out.validationMessage).toBe('');

        setOutputsIncomplete(ctx, true);
        out.setCustomValidity('Host says no');
        setOutputsIncomplete(ctx, false);
        expect(out.validationMessage).toBe('Host says no');
    });
});

describe('ezclassify:rollup', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
    });

    it("fires on each level's element with its buckets, once per change", async () => {
        const whole = document.createElement('input');
        whole.id = 'memo';
        document.body.appendChild(whole);
        const part = document.createElement('input');
        document.body.appendChild(part);
        const folder = document.createElement('section');
        folder.setAttribute('data-ezclassify-collection', 'folderA');
        document.body.appendChild(folder);
        const levels: Levels = new Map([
            [null, new Map([[SOLE_BUCKET, aggregate('SECRET')]])],
            ['folderA', new Map([[SOLE_BUCKET, aggregate('SECRET')]])],
            ['memo', new Map([[SOLE_BUCKET, aggregate('CONFIDENTIAL')]])],
        ]);
        const ctx = createMockCtx(
            { fields: [whole, part], partOfMap: new Map([[part, 'memo']]) },
            levels,
        );
        const pageEvents: RollupEventDetail[] = [];
        document.body.addEventListener('ezclassify:rollup', (e) => {
            if (e.target === document.body)
                pageEvents.push((e as CustomEvent<RollupEventDetail>).detail);
        });
        const folderEvents = rollupEvents(folder);
        const wholeEvents = rollupEvents(whole);

        await updateRollup(ctx);
        await updateRollup(ctx);

        expect(pageEvents).toEqual([
            {
                level: null,
                buckets: [
                    {
                        context: null,
                        scheme: null,
                        rendered: 'SECRET',
                        assertions: aggregate('SECRET').assertions,
                        stale: false,
                    },
                ],
            },
        ]);
        expect(folderEvents.map((d) => d.level)).toEqual(['folderA']);
        expect(wholeEvents.map((d) => d.buckets[0].rendered)).toEqual([
            'CONFIDENTIAL',
        ]);

        levels.set('memo', new Map([[SOLE_BUCKET, aggregate('SECRET')]]));
        await updateRollup(ctx);
        expect(wholeEvents.map((d) => d.buckets[0].rendered)).toEqual([
            'CONFIDENTIAL',
            'SECRET',
        ]);
        expect(pageEvents).toHaveLength(1);
    });

    it('keeps a bucket that misses a contributor, so a level never reads as empty', async () => {
        const ctx = createMockCtx(
            {},
            new Map([[null, new Map([[SOLE_BUCKET, aggregate('', true)]])]]),
        );
        const events = rollupEvents(document.body);

        await updateRollup(ctx);

        expect(events[0].buckets).toEqual([
            {
                context: null,
                scheme: null,
                rendered: '',
                assertions: [],
                stale: true,
            },
        ]);
    });

    it('hands the page rollup, facts included, to the enclosing instance', async () => {
        const page = new Map([[SOLE_BUCKET, aggregate('SECRET')]]);
        const onRollupComputed = vi.fn();
        const ctx = createMockCtx(
            { onRollupComputed },
            new Map([[null, page]]),
        );

        await updateRollup(ctx);

        expect(onRollupComputed).toHaveBeenCalledWith(page);
    });
});

describe('updateRollup', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
    });

    it('flushes a queued debounce once and settles its callers', async () => {
        vi.useFakeTimers();
        try {
            const out = sink();
            const ctx = createMockCtx(
                {},
                new Map([[null, new Map([[SOLE_BUCKET, aggregate('A')]])]]),
            );

            const queued = updateRollup(ctx);
            await flushRollupNow(ctx);
            await vi.advanceTimersByTimeAsync(40);
            await queued;

            const pageReads = (
                ctx.aggregateOf as ReturnType<typeof vi.fn>
            ).mock.calls.filter(([id]) => id === null);
            expect(pageReads).toHaveLength(1);
            expect(out.value).toBe('A');
        } finally {
            vi.useRealTimers();
        }
    });

    it('drops a pass that a newer one superseded before it read the store', async () => {
        const ctx = createMockCtx();

        const older = flushRollupNow(ctx);
        const newer = flushRollupNow(ctx);
        await Promise.all([older, newer]);

        const pageReads = (
            ctx.aggregateOf as ReturnType<typeof vi.fn>
        ).mock.calls.filter(([id]) => id === null);
        expect(pageReads).toHaveLength(1);
    });

    it('waits for the store to settle before it shows anything', async () => {
        const out = sink();
        let resume: (() => void) | null = null;
        const ctx = createMockCtx(
            {
                whenStoreIdle: (run) => {
                    resume = run;
                    return false;
                },
            },
            new Map([[null, new Map([[SOLE_BUCKET, aggregate('SECRET')]])]]),
        );

        await flushRollupNow(ctx);

        expect(out.value).toBe('');
        expect(resume).not.toBeNull();
    });

    it('does nothing while initializing or once torn down', async () => {
        const out = sink();
        const levels: Levels = new Map([
            [null, new Map([[SOLE_BUCKET, aggregate('SECRET')]])],
        ]);

        await updateRollup(createMockCtx({ initializing: true }, levels));
        await updateRollup(createMockCtx({ destroyed: true }, levels));

        expect(out.value).toBe('');
    });
});

describe('updateConditionalVisibility (data-ezclassify-show-when-parent-has / data-ezclassify-hide-when-parent-has)', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
    });

    it('shows element when parent has a matching concept', async () => {
        const parentField = document.createElement('input');
        parentField.id = 'parent1';
        document.body.appendChild(parentField);

        const conditionalEl = document.createElement('div');
        conditionalEl.setAttribute(
            'data-ezclassify-show-when-parent-has',
            'parent1:LEVEL_A,LEVEL_B',
        );
        conditionalEl.style.display = 'none';
        document.body.appendChild(conditionalEl);

        const ctx = createMockCtx();
        parentField.value = 'LEVEL_A';
        ctx.fields.push(parentField);
        ctx.mounted.set(parentField, {
            init: vi.fn(),
            getAssertions: vi.fn((): Assertion[] => [
                {
                    conceptId: 'LEVEL_A',
                    categoryId: 'level',
                    confidence: 'certain',
                    source: 'parse',
                },
            ]),
            setAssertions: vi.fn(),
            setValue: vi.fn(),
            destroy: vi.fn(),
            getRendered: vi.fn(() => 'LEVEL_A'),
        });

        await updateRollup(ctx);

        expect(conditionalEl.style.display).toBe('');
    });

    it('hides element when parent lacks all listed concepts', async () => {
        const parentField = document.createElement('input');
        parentField.id = 'parent1';
        document.body.appendChild(parentField);

        const conditionalEl = document.createElement('div');
        conditionalEl.setAttribute(
            'data-ezclassify-show-when-parent-has',
            'parent1:LEVEL_A,LEVEL_B',
        );
        conditionalEl.style.display = '';
        document.body.appendChild(conditionalEl);

        const ctx = createMockCtx();
        ctx.fields.push(parentField);
        ctx.fieldAssertions.set(parentField, [
            { conceptId: 'LEVEL_C', categoryId: 'level' },
        ]);

        await updateRollup(ctx);

        expect(conditionalEl.style.display).toBe('none');
    });

    it('hides element when parent element is not found', async () => {
        const conditionalEl = document.createElement('div');
        conditionalEl.setAttribute(
            'data-ezclassify-show-when-parent-has',
            'missing-parent:LEVEL_A',
        );
        conditionalEl.style.display = '';
        document.body.appendChild(conditionalEl);

        const ctx = createMockCtx();
        await updateRollup(ctx);

        expect(conditionalEl.style.display).toBe('none');
    });

    it('data-ezclassify-hide-when-parent-has hides element when parent has a matching concept', async () => {
        const parentField = document.createElement('input');
        parentField.id = 'parent1';
        document.body.appendChild(parentField);

        const conditionalEl = document.createElement('div');
        conditionalEl.setAttribute(
            'data-ezclassify-hide-when-parent-has',
            'parent1:LEVEL_A',
        );
        conditionalEl.style.display = '';
        document.body.appendChild(conditionalEl);

        const ctx = createMockCtx();
        parentField.value = 'LEVEL_A';
        ctx.fields.push(parentField);
        ctx.mounted.set(parentField, {
            init: vi.fn(),
            getAssertions: vi.fn((): Assertion[] => [
                {
                    conceptId: 'LEVEL_A',
                    categoryId: 'level',
                    confidence: 'certain',
                    source: 'parse',
                },
            ]),
            setAssertions: vi.fn(),
            setValue: vi.fn(),
            destroy: vi.fn(),
            getRendered: vi.fn(() => 'LEVEL_A'),
        });

        await updateRollup(ctx);

        expect(conditionalEl.style.display).toBe('none');
    });

    it('data-ezclassify-hide-when-parent-has shows element when parent lacks concept', async () => {
        const parentField = document.createElement('input');
        parentField.id = 'parent1';
        document.body.appendChild(parentField);

        const conditionalEl = document.createElement('div');
        conditionalEl.setAttribute(
            'data-ezclassify-hide-when-parent-has',
            'parent1:LEVEL_A',
        );
        conditionalEl.style.display = 'none';
        document.body.appendChild(conditionalEl);

        const ctx = createMockCtx();
        ctx.fields.push(parentField);
        ctx.fieldAssertions.set(parentField, [
            { conceptId: 'LEVEL_X', categoryId: 'level' },
        ]);

        await updateRollup(ctx);

        expect(conditionalEl.style.display).toBe('');
    });

    it('ignores elements with malformed attribute (no colon)', async () => {
        const conditionalEl = document.createElement('div');
        conditionalEl.setAttribute(
            'data-ezclassify-show-when-parent-has',
            'no-colon-here',
        );
        conditionalEl.style.display = 'block';
        document.body.appendChild(conditionalEl);

        const ctx = createMockCtx();
        await updateRollup(ctx);

        // Should remain unchanged since the attribute is malformed
        expect(conditionalEl.style.display).toBe('block');
    });
});

describe('multi-whole partition (binding-model §16)', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
    });

    it('resolves coverage owners with linear DOM lookup work', async () => {
        const parentCount = 48;
        const ctx = createMockCtx();
        for (let i = 0; i < parentCount; i++) {
            const parent = document.createElement('input');
            parent.id = `whole-${i}`;
            document.body.appendChild(parent);
            ctx.mounted.set(parent, {
                ...createMockComponent(`P${i}`),
                coversParts: true,
            });

            const child = document.createElement('input');
            child.value = `C${i}`;
            document.body.appendChild(child);
            ctx.fields.push(child);
            ctx.partOfMap.set(child, parent.id);
        }

        const getAttribute = Element.prototype.getAttribute;
        let boundToReads = 0;
        const spy = vi
            .spyOn(Element.prototype, 'getAttribute')
            .mockImplementation(function (this: Element, name: string) {
                if (name === 'data-ezclassify-bound-to') boundToReads++;
                return getAttribute.call(this, name);
            });
        try {
            await updateRollup(ctx);
        } finally {
            spy.mockRestore();
        }

        expect(ctx.aggregates?.size).toBe(parentCount);
        expect(boundToReads).toBe(parentCount * 2);
    });

    it('two part-of children pointing at different parents → engine.checkCoverage runs once per parent', async () => {
        const ctx = createMockCtx();

        const parentA = document.createElement('input') as HTMLInputElement;
        parentA.id = 'parent-a';
        parentA.value = 'A-PARENT';
        document.body.appendChild(parentA);
        ctx.fields.push(parentA);

        const parentB = document.createElement('input') as HTMLInputElement;
        parentB.id = 'parent-b';
        parentB.value = 'B-PARENT';
        document.body.appendChild(parentB);
        ctx.fields.push(parentB);

        const childA = document.createElement('input') as HTMLInputElement;
        childA.id = 'child-a';
        childA.value = 'A-CHILD';
        childA.setAttribute('data-ezclassify-part-of', 'parent-a');
        document.body.appendChild(childA);
        ctx.fields.push(childA);
        ctx.partOfMap.set(childA, 'parent-a');

        const childB = document.createElement('input') as HTMLInputElement;
        childB.id = 'child-b';
        childB.value = 'B-CHILD';
        childB.setAttribute('data-ezclassify-part-of', 'parent-b');
        document.body.appendChild(childB);
        ctx.fields.push(childB);
        ctx.partOfMap.set(childB, 'parent-b');

        const checkCoverageSpy = ctx.engine.checkCoverage as ReturnType<
            typeof vi.fn
        >;
        checkCoverageSpy.mockClear();

        await updateRollup(ctx);

        // Two distinct parent groups → two checkCoverage calls, one per parent.
        expect(checkCoverageSpy).toHaveBeenCalledTimes(2);
        const callArgs = checkCoverageSpy.mock.calls.map((c) => c[1]);
        expect(callArgs.sort()).toEqual(['A-PARENT', 'B-PARENT'].sort());
    });

    it('populates ctx.aggregates with one entry per declared parent', async () => {
        const ctx = createMockCtx({ aggregates: new Map() });

        const parentA = document.createElement('input') as HTMLInputElement;
        parentA.id = 'parent-a';
        parentA.value = 'A-PARENT';
        document.body.appendChild(parentA);
        ctx.fields.push(parentA);

        const parentB = document.createElement('input') as HTMLInputElement;
        parentB.id = 'parent-b';
        parentB.value = 'B-PARENT';
        document.body.appendChild(parentB);
        ctx.fields.push(parentB);

        const childA = document.createElement('input') as HTMLInputElement;
        childA.id = 'child-a';
        childA.value = 'A-CHILD';
        childA.setAttribute('data-ezclassify-part-of', 'parent-a');
        document.body.appendChild(childA);
        ctx.fields.push(childA);
        ctx.partOfMap.set(childA, 'parent-a');

        const childB = document.createElement('input') as HTMLInputElement;
        childB.id = 'child-b';
        childB.value = 'B-CHILD';
        childB.setAttribute('data-ezclassify-part-of', 'parent-b');
        document.body.appendChild(childB);
        ctx.fields.push(childB);
        ctx.partOfMap.set(childB, 'parent-b');

        await updateRollup(ctx);

        expect(ctx.aggregates.size).toBe(2);
        expect(ctx.aggregates.get('parent-a')?.el).toBe(parentA);
        expect(ctx.aggregates.get('parent-b')?.el).toBe(parentB);
    });

    it('resolves a declared parent to the FIELD when a component shares its id (fields-first precedence)', async () => {
        const ctx = createMockCtx({ aggregates: new Map() });

        // A field and a component both carry id "dup-parent". Parent resolution
        // must pick the field (its rendered value drives coverage), matching the
        // fields-then-components search order the id index preserves.
        const fieldParent = document.createElement('input') as HTMLInputElement;
        fieldParent.id = 'dup-parent';
        fieldParent.value = 'FIELD-PARENT';
        document.body.appendChild(fieldParent);
        ctx.fields.push(fieldParent);

        const compParent = document.createElement('div');
        compParent.id = 'dup-parent';
        document.body.appendChild(compParent);
        ctx.mounted.set(compParent, createMockComponent('COMP-PARENT'));

        const child = document.createElement('input') as HTMLInputElement;
        child.id = 'dup-child';
        child.value = 'A-CHILD';
        child.setAttribute('data-ezclassify-part-of', 'dup-parent');
        document.body.appendChild(child);
        ctx.fields.push(child);
        ctx.partOfMap.set(child, 'dup-parent');

        const checkCoverageSpy = ctx.engine.checkCoverage as ReturnType<
            typeof vi.fn
        >;
        checkCoverageSpy.mockClear();

        await updateRollup(ctx);

        expect(checkCoverageSpy).toHaveBeenCalledTimes(1);
        expect(checkCoverageSpy.mock.calls[0][1]).toBe('FIELD-PARENT');
        expect(ctx.aggregates.get('dup-parent')?.el).toBe(fieldParent);
    });

    /**
     * Make the mock engine read `part` under `whole` as the engine does when
     * the part exceeds it: invalid, with the part's own `_exceeds_whole`
     * error.
     */
    function exceedsUnder(ctx: FormsContext, part: string, whole: string) {
        const process = ctx.engine.process as ReturnType<typeof vi.fn>;
        const read = process.getMockImplementation() as (
            input: string,
            options?: unknown,
        ) => Record<string, unknown>;
        process.mockImplementation(
            (
                input: string,
                options?: { context?: { partOf?: { rendered: string } } },
            ) => {
                const result = read(input, options);
                if (
                    input !== part ||
                    options?.context?.partOf?.rendered !== whole
                )
                    return result;
                return {
                    ...result,
                    valid: false,
                    errors: [
                        {
                            constraintId: '_exceeds_whole',
                            message: `This part exceeds its whole: the whole does not cover ${part}.`,
                        },
                    ],
                };
            },
        );
    }

    it('dispatches ezclassify:coverage-error from the child element when a parent fails coverage', async () => {
        const ctx = createMockCtx();

        const parent = document.createElement('input') as HTMLInputElement;
        parent.id = 'doc-parent';
        parent.value = 'PARENT';
        document.body.appendChild(parent);
        ctx.fields.push(parent);

        const child = document.createElement('input') as HTMLInputElement;
        child.id = 'doc-child';
        child.value = 'CHILD';
        child.setAttribute('data-ezclassify-part-of', 'doc-parent');
        document.body.appendChild(child);
        ctx.fields.push(child);
        ctx.partOfMap.set(child, 'doc-parent');

        // The whole fails coverage, and the engine says the child, read in
        // that whole, exceeds it.
        (
            ctx.engine.checkCoverage as ReturnType<typeof vi.fn>
        ).mockResolvedValue({
            covered: false,
            missing: [{ conceptId: 'CHILD', categoryId: 'level' }],
            missingLabels: ['CHILD'],
            excess: [],
            excessLabels: [],
            rendered: 'CHILD',
        });
        exceedsUnder(ctx, 'CHILD', 'PARENT');

        const events: CustomEvent[] = [];
        child.addEventListener('ezclassify:coverage-error', (e) =>
            events.push(e as CustomEvent),
        );

        await updateRollup(ctx);

        expect(events).toHaveLength(1);
        const detail = events[0].detail as {
            childId: string;
            parentId: string;
            childRendered: string;
            parentRendered: string;
        };
        expect(detail.childId).toBe('doc-child');
        expect(detail.parentId).toBe('doc-parent');
        expect(detail.parentRendered).toBe('PARENT');
        expect(detail.childRendered).toBe('CHILD');
    });

    it('faults only the child the engine says exceeds its whole', async () => {
        const ctx = createMockCtx();

        const parent = document.createElement('input') as HTMLInputElement;
        parent.id = 'doc-parent';
        parent.value = 'PARENT';
        document.body.appendChild(parent);
        ctx.fields.push(parent);

        const children = ['OVER', 'WITHIN'].map((value) => {
            const child = document.createElement('input') as HTMLInputElement;
            child.id = `child-${value.toLowerCase()}`;
            child.value = value;
            document.body.appendChild(child);
            ctx.fields.push(child);
            ctx.partOfMap.set(child, 'doc-parent');
            return child;
        });
        // The whole fails coverage over both children's concepts, but only
        // one child, read in the whole, exceeds it.
        (
            ctx.engine.checkCoverage as ReturnType<typeof vi.fn>
        ).mockResolvedValue({
            covered: false,
            missing: [
                { conceptId: 'OVER', categoryId: 'level' },
                { conceptId: 'WITHIN', categoryId: 'level' },
            ],
            missingLabels: ['OVER', 'WITHIN'],
            excess: [],
            excessLabels: [],
            rendered: 'OVER,WITHIN',
        });
        exceedsUnder(ctx, 'OVER', 'PARENT');

        const coverageErrors: string[] = [];
        const validity = new Map<string, boolean>();
        for (const child of children) {
            child.addEventListener('ezclassify:coverage-error', () =>
                coverageErrors.push(child.id),
            );
            child.addEventListener('ezclassify:validation', (e) =>
                validity.set(
                    child.id,
                    (e as CustomEvent<{ valid: boolean }>).detail.valid,
                ),
            );
        }

        await updateRollup(ctx);

        expect(coverageErrors).toEqual(['child-over']);
        expect(validity.get('child-over')).toBe(false);
        expect(validity.get('child-within')).toBe(true);
        expect(children[1].hasAttribute('data-ezclassify-error')).toBe(false);
    });

    it('still reports a child that exceeds its whole when the whole cannot be checked, with no report', async () => {
        const ctx = createMockCtx();

        const parent = document.createElement('input') as HTMLInputElement;
        parent.id = 'doc-parent';
        parent.value = 'PARENT';
        document.body.appendChild(parent);
        ctx.fields.push(parent);

        const child = document.createElement('input') as HTMLInputElement;
        child.id = 'doc-child';
        child.value = 'CHILD';
        document.body.appendChild(child);
        ctx.fields.push(child);
        ctx.partOfMap.set(child, 'doc-parent');
        // Another part the engine cannot read leaves the whole's coverage
        // uncertified; this part still exceeds the whole on its own.
        (
            ctx.engine.checkCoverage as ReturnType<typeof vi.fn>
        ).mockRejectedValue(new Error('Cannot certify coverage'));
        exceedsUnder(ctx, 'CHILD', 'PARENT');

        const events: CustomEvent[] = [];
        child.addEventListener('ezclassify:coverage-error', (e) =>
            events.push(e as CustomEvent),
        );

        await updateRollup(ctx);

        expect(events).toHaveLength(1);
        expect(events[0].detail).toMatchObject({
            childId: 'doc-child',
            parentId: 'doc-parent',
            report: null,
        });
    });

    it('leaves a child component to show its own exceeds error, with no second notice', async () => {
        const ctx = createMockCtx();

        const parent = document.createElement('input') as HTMLInputElement;
        parent.id = 'doc-parent';
        parent.value = 'PARENT';
        document.body.appendChild(parent);
        ctx.fields.push(parent);

        const child = document.createElement('div');
        child.id = 'doc-child';
        document.body.appendChild(child);
        const updateValidationErrors = vi.fn();
        ctx.mounted.set(child, {
            init: vi.fn(),
            getAssertions: vi.fn(() => []),
            setAssertions: vi.fn(),
            destroy: vi.fn(),
            getRendered: vi.fn(() => 'CHILD'),
            updateValidationErrors,
        } as unknown as ComponentInstance);
        ctx.partOfMap.set(child, 'doc-parent');
        exceedsUnder(ctx, 'CHILD', 'PARENT');

        const events: CustomEvent[] = [];
        child.addEventListener('ezclassify:validation', (e) =>
            events.push(e as CustomEvent),
        );

        await updateRollup(ctx);

        expect(updateValidationErrors).toHaveBeenCalledWith(
            [
                {
                    constraintId: '_exceeds_whole',
                    message:
                        'This part exceeds its whole: the whole does not cover CHILD.',
                },
            ],
            [],
            [],
        );
        expect(events.at(-1)?.detail.valid).toBe(false);
        expect(child.hasAttribute('data-ezclassify-error')).toBe(false);
        expect(
            child.nextElementSibling?.classList.contains(
                'ez-parent-validation-notice',
            ) ?? false,
        ).toBe(false);
    });

    it('parent-side change re-fires coverage-error on the child without mutating the child marking', async () => {
        // Binding-model §7: when a parent shifts, the library re-checks coverage
        // and surfaces a fresh event on the child, but the child's own marking
        // must not be mutated. The author resolves the conflict.
        const ctx = createMockCtx();

        const parent = document.createElement('input') as HTMLInputElement;
        parent.id = 'doc-parent';
        parent.value = 'OPEN-PARENT';
        document.body.appendChild(parent);
        ctx.fields.push(parent);

        const child = document.createElement('input') as HTMLInputElement;
        child.id = 'doc-child';
        child.value = 'CHILD-VAL';
        child.setAttribute('data-ezclassify-part-of', 'doc-parent');
        document.body.appendChild(child);
        ctx.fields.push(child);
        ctx.partOfMap.set(child, 'doc-parent');

        // Round 1: parent covers child.
        const checkCoverage = ctx.engine.checkCoverage as ReturnType<
            typeof vi.fn
        >;
        checkCoverage.mockResolvedValue({
            covered: true,
            missing: [],
            missingLabels: [],
            excess: [],
            excessLabels: [],
            rendered: 'CHILD-VAL',
        });

        const events: CustomEvent[] = [];
        child.addEventListener('ezclassify:coverage-error', (e) =>
            events.push(e as CustomEvent),
        );

        await updateRollup(ctx);
        expect(events).toHaveLength(0);

        // Round 2: parent tightens, child stays as-is, coverage fails, the
        // event fires from the CHILD even though the parent is what changed.
        parent.value = 'TIGHT-PARENT';
        exceedsUnder(ctx, 'CHILD-VAL', 'TIGHT-PARENT');
        checkCoverage.mockResolvedValue({
            covered: false,
            missing: [{ conceptId: 'CHILD-VAL', categoryId: 'level' }],
            missingLabels: ['CHILD-VAL'],
            excess: [],
            excessLabels: [],
            rendered: 'CHILD-VAL',
        });

        const childValueBefore = child.value;
        await updateRollup(ctx);

        expect(child.value).toBe(childValueBefore); // never mutated
        expect(events).toHaveLength(1);
        expect(
            (events[0].detail as { parentRendered: string }).parentRendered,
        ).toBe('TIGHT-PARENT');
    });
});
