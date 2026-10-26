import { describe, it, expect, vi, beforeEach } from 'vitest';
import { flushRollupNow, updateRollup } from './rollup';
import type { FormsContext } from './types';
import type { ComponentInstance } from '../components/component-base';
import type { ContributionDescriptor } from './rollup';
import type { Assertion } from '@ezclassify/types';
import { setMountHost } from '../mount-host-registry';
import { mockRenderFormats } from '../render-format-layout-mock';

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

function createMockCtx(overrides: Partial<FormsContext> = {}): FormsContext {
    return {
        engine: createMockEngine(),
        root: document.body,
        fields: [],
        rollupField: null,
        defaultFormat: 'default',
        domObserver: null,
        autocompleters: new Map(),
        lastValidated: new Map(),
        fieldAssertions: new Map(),
        tooltipEl: null,
        settingValue: false,
        colorMap: {},
        selectorAttr: 'ezclassify',
        mounted: new Map(),
        partOfMap: new Map(),
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

describe('updateRollup', () => {
    it('flushes a queued debounce once and settles its callers', async () => {
        vi.useFakeTimers();
        try {
            const rollupField = document.createElement('input');
            const field = document.createElement('input');
            field.value = 'A';
            const ctx = createMockCtx({ rollupField, fields: [field] });

            const queued = updateRollup(ctx);
            await flushRollupNow(ctx);
            await vi.advanceTimersByTimeAsync(40);
            await queued;

            expect(ctx.engine.aggregate).toHaveBeenCalledTimes(1);
            expect(rollupField.value).toBe('A');
        } finally {
            vi.useRealTimers();
        }
    });

    it('does not publish an older asynchronous aggregate after a newer edit', async () => {
        const rollupField = document.createElement('input');
        const field = document.createElement('input');
        field.value = 'old';
        const ctx = createMockCtx({ rollupField, fields: [field] });
        const pending = new Map<
            string,
            (value: { rendered: string; assertions: Assertion[] }) => void
        >();
        ctx.engine.aggregate = vi.fn(
            (values: string[]) =>
                new Promise<{ rendered: string; assertions: Assertion[] }>(
                    (resolve) => {
                        pending.set(values[0], resolve);
                    },
                ),
        ) as unknown as FormsContext['engine']['aggregate'];
        const events: string[] = [];
        rollupField.addEventListener('ezclassify:rollup', (event) => {
            events.push(
                (event as CustomEvent<{ rendered: string }>).detail.rendered,
            );
        });

        const older = flushRollupNow(ctx);
        await Promise.resolve();
        expect(pending.has('old')).toBe(true);

        field.value = 'new';
        const newer = flushRollupNow(ctx);
        await Promise.resolve();
        expect(pending.has('new')).toBe(true);

        pending.get('new')?.({ rendered: 'new', assertions: [] });
        await newer;
        pending.get('old')?.({ rendered: 'old', assertions: [] });
        await older;

        expect(rollupField.value).toBe('new');
        expect(events).toEqual(['new']);
    });

    it('invalidates an in-flight aggregate when a new edit enters the debounce', async () => {
        vi.useFakeTimers();
        try {
            const rollupField = document.createElement('input');
            const field = document.createElement('input');
            field.value = 'old';
            const ctx = createMockCtx({ rollupField, fields: [field] });
            const pending = new Map<string, (rendered: string) => void>();
            ctx.engine.aggregate = vi.fn(
                (values: string[]) =>
                    new Promise<{ rendered: string; assertions: Assertion[] }>(
                        (resolve) => {
                            pending.set(values[0], (rendered) =>
                                resolve({ rendered, assertions: [] }),
                            );
                        },
                    ),
            ) as unknown as FormsContext['engine']['aggregate'];

            const older = flushRollupNow(ctx);
            await Promise.resolve();
            field.value = 'new';
            const queued = updateRollup(ctx);

            pending.get('old')?.('old');
            await older;
            expect(rollupField.value).toBe('');

            await vi.advanceTimersByTimeAsync(40);
            pending.get('new')?.('new');
            await queued;
            expect(rollupField.value).toBe('new');
        } finally {
            vi.useRealTimers();
        }
    });

    it('collects values from both fields and components', async () => {
        const rollupField = document.createElement('input');
        const ctx = createMockCtx({ rollupField });

        // Add an input field, value matches what engine.render would produce
        const field = document.createElement('input');
        field.value = 'A';
        ctx.fields.push(field);

        // Add a component with a rendered value
        const compEl = document.createElement('div');
        const comp = createMockComponent('comp-value');
        ctx.mounted.set(compEl, comp);

        await updateRollup(ctx);

        // aggregate should be called with values from both sources
        expect(ctx.engine.aggregate).toHaveBeenCalled();
        const callArgs = (ctx.engine.aggregate as ReturnType<typeof vi.fn>).mock
            .calls[0];
        const values = callArgs[0] as string[];
        expect(values).toHaveLength(2);
        // Field value comes from render(assertions)
        expect(values[0]).toBe('A');
        // Component value comes from getRendered()
        expect(values[1]).toBe('comp-value');
    });

    it('collects only from fields when no components exist', async () => {
        const rollupField = document.createElement('input');
        const ctx = createMockCtx({ rollupField });

        const field = document.createElement('input');
        field.value = 'X';
        ctx.fields.push(field);

        await updateRollup(ctx);

        expect(ctx.engine.aggregate).toHaveBeenCalled();
        const values = (ctx.engine.aggregate as ReturnType<typeof vi.fn>).mock
            .calls[0][0] as string[];
        expect(values).toHaveLength(1);
        expect(values[0]).toBe('X');
    });

    it('collects only from components when no fields exist', async () => {
        const rollupField = document.createElement('input');
        const ctx = createMockCtx({ rollupField });

        const compEl = document.createElement('div');
        const comp = createMockComponent('component-only');
        ctx.mounted.set(compEl, comp);

        await updateRollup(ctx);

        expect(ctx.engine.aggregate).toHaveBeenCalled();
        const values = (ctx.engine.aggregate as ReturnType<typeof vi.fn>).mock
            .calls[0][0] as string[];
        expect(values).toHaveLength(1);
        expect(values[0]).toBe('component-only');
    });

    it('skips components with empty rendered values', async () => {
        const rollupField = document.createElement('input');
        const ctx = createMockCtx({ rollupField });

        const comp1El = document.createElement('div');
        const comp1 = createMockComponent('has-value');
        ctx.mounted.set(comp1El, comp1);

        const comp2El = document.createElement('div');
        const comp2 = createMockComponent('');
        ctx.mounted.set(comp2El, comp2);

        await updateRollup(ctx);

        expect(ctx.engine.aggregate).toHaveBeenCalled();
        const values = (ctx.engine.aggregate as ReturnType<typeof vi.fn>).mock
            .calls[0][0] as string[];
        expect(values).toHaveLength(1);
        expect(values[0]).toBe('has-value');
    });

    it('sets rollup field to empty string when no values exist', async () => {
        const rollupField = document.createElement('input');
        rollupField.value = 'old-value';
        const ctx = createMockCtx({ rollupField });

        await updateRollup(ctx);

        expect(rollupField.value).toBe('');
    });

    it('dispatches ezclassify:rollup event on rollup field', async () => {
        const rollupField = document.createElement('input');
        const ctx = createMockCtx({ rollupField });

        const compEl = document.createElement('div');
        const comp = createMockComponent('val');
        ctx.mounted.set(compEl, comp);

        const eventPromise = new Promise<CustomEvent>((resolve) => {
            rollupField.addEventListener('ezclassify:rollup', (e) =>
                resolve(e as CustomEvent),
            );
        });

        await updateRollup(ctx);

        return eventPromise.then((e) => {
            expect(e.detail.rendered).toBeDefined();
        });
    });

    it('emits the full rollup detail shape for named groups', async () => {
        const rollupField = document.createElement('input');
        const groupRollup = document.createElement('input');
        groupRollup.id = 'evidence-rollup';
        groupRollup.setAttribute('data-ezclassify-scheme', 'test');
        const field = document.createElement('input');
        field.id = 'finding';
        field.value = 'A';
        field.setAttribute('data-ezclassify-group', 'evidence');
        document.body.append(field, groupRollup);
        const ctx = createMockCtx({
            rollupField,
            fields: [field],
        });
        let detail: Record<string, unknown> | undefined;
        groupRollup.addEventListener('ezclassify:rollup', (event) => {
            detail = (event as CustomEvent<Record<string, unknown>>).detail;
        });

        await updateRollup(ctx);

        expect(detail).toEqual({
            rendered: 'A',
            byScheme: { test: 'A' },
            contributions: [
                expect.objectContaining({
                    value: 'A',
                    sourceId: 'finding',
                }),
            ],
            assertions: [],
        });
    });

    it('does nothing when rollupField is null', async () => {
        const ctx = createMockCtx({ rollupField: null });
        // Should not throw
        await updateRollup(ctx);
        expect(ctx.engine.aggregate).not.toHaveBeenCalled();
    });
});

describe('updateConditionalVisibility (data-ezclassify-show-when-parent-has / data-ezclassify-hide-when-parent-has)', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
    });

    it('shows element when parent has a matching concept', async () => {
        const rollupField = document.createElement('input');
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

        const ctx = createMockCtx({ rollupField });
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
        const rollupField = document.createElement('input');
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

        const ctx = createMockCtx({ rollupField });
        ctx.fields.push(parentField);
        ctx.fieldAssertions.set(parentField, [
            { conceptId: 'LEVEL_C', categoryId: 'level' },
        ]);

        await updateRollup(ctx);

        expect(conditionalEl.style.display).toBe('none');
    });

    it('hides element when parent element is not found', async () => {
        const rollupField = document.createElement('input');

        const conditionalEl = document.createElement('div');
        conditionalEl.setAttribute(
            'data-ezclassify-show-when-parent-has',
            'missing-parent:LEVEL_A',
        );
        conditionalEl.style.display = '';
        document.body.appendChild(conditionalEl);

        const ctx = createMockCtx({ rollupField });
        await updateRollup(ctx);

        expect(conditionalEl.style.display).toBe('none');
    });

    it('data-ezclassify-hide-when-parent-has hides element when parent has a matching concept', async () => {
        const rollupField = document.createElement('input');
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

        const ctx = createMockCtx({ rollupField });
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
        const rollupField = document.createElement('input');
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

        const ctx = createMockCtx({ rollupField });
        ctx.fields.push(parentField);
        ctx.fieldAssertions.set(parentField, [
            { conceptId: 'LEVEL_X', categoryId: 'level' },
        ]);

        await updateRollup(ctx);

        expect(conditionalEl.style.display).toBe('');
    });

    it('ignores elements with malformed attribute (no colon)', async () => {
        const rollupField = document.createElement('input');

        const conditionalEl = document.createElement('div');
        conditionalEl.setAttribute(
            'data-ezclassify-show-when-parent-has',
            'no-colon-here',
        );
        conditionalEl.style.display = 'block';
        document.body.appendChild(conditionalEl);

        const ctx = createMockCtx({ rollupField });
        await updateRollup(ctx);

        // Should remain unchanged since the attribute is malformed
        expect(conditionalEl.style.display).toBe('block');
    });
});

function captureRollupDetail(rollupField: HTMLElement) {
    let detail: {
        contributions?: ContributionDescriptor[];
        assertions?: unknown[];
    } | null = null;
    rollupField.addEventListener('ezclassify:rollup', (e) => {
        detail = (e as CustomEvent).detail;
    });
    return () => detail;
}

describe('ezclassify:rollup enriched event: ContributionDescriptor + assertions', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
    });

    it('event detail includes contributions with value, sourceId, sourceLabel, controller', async () => {
        const rollupField = document.createElement('input');
        rollupField.id = 'rollup';
        document.body.appendChild(rollupField);
        const ctx = createMockCtx({ rollupField });

        const compEl = document.createElement('div');
        compEl.id = 'my-select';
        compEl.setAttribute('aria-label', 'Sensitivity level');
        compEl.setAttribute('data-ezclassify-controller', 'select');
        document.body.appendChild(compEl);
        ctx.mounted.set(compEl, createMockComponent('STATE_ASSESSMENT_STAFF'));

        const getDetail = captureRollupDetail(rollupField);
        await updateRollup(ctx);

        const detail = getDetail();
        expect(detail).not.toBeNull();
        expect(detail!.contributions).toHaveLength(1);
        const c = detail!.contributions![0];
        expect(c.value).toBe('STATE_ASSESSMENT_STAFF');
        expect(c.sourceId).toBe('my-select');
        expect(c.sourceLabel).toBe('Sensitivity level');
        expect(c.controller).toBe('select');
    });

    it('plain field contribution uses aria-label when present', async () => {
        const rollupField = document.createElement('input');
        document.body.appendChild(rollupField);
        const ctx = createMockCtx({ rollupField });

        const field = document.createElement('input') as HTMLInputElement;
        field.id = 'behavior-input';
        field.setAttribute('aria-label', 'Behavior-only level input');
        field.value = 'STUDENTS';
        document.body.appendChild(field);
        ctx.fields.push(field);

        const getDetail = captureRollupDetail(rollupField);
        await updateRollup(ctx);

        const c = getDetail()!.contributions![0];
        expect(c.value).toBe('STUDENTS');
        expect(c.sourceLabel).toBe('Behavior-only level input');
    });

    it('marked-textarea hidden children resolve to the parent textarea', async () => {
        const rollupField = document.createElement('input');
        document.body.appendChild(rollupField);
        const ctx = createMockCtx({ rollupField });

        // Build the marked-textarea DOM structure as createMountContainer +
        // MarkedTextArea.init() actually produce it in the live app:
        //   container (outer parent)
        //     .marked-textarea-wrap                   ← textarea moved here
        //       textarea#scanner-input[aria-label="…"]
        //     [data-ezclassify-mount="marked-textarea"] ← mount container
        //       .marked-textarea-hidden-fields
        //         input[type=hidden] (synthetic part field)
        const container = document.createElement('div');
        document.body.appendChild(container);

        const wrap = document.createElement('div');
        wrap.className = 'marked-textarea-wrap';
        container.appendChild(wrap);

        const textarea = document.createElement(
            'textarea',
        ) as HTMLTextAreaElement;
        textarea.id = 'scanner-input';
        textarea.setAttribute('aria-label', 'Text to scan for markings');
        wrap.appendChild(textarea);

        const mountContainer = document.createElement('div');
        mountContainer.setAttribute('data-ezclassify-mount', 'marked-textarea');
        container.appendChild(mountContainer);
        setMountHost(mountContainer, textarea);

        const hiddenRoot = document.createElement('div');
        hiddenRoot.className = 'marked-textarea-hidden-fields';
        mountContainer.appendChild(hiddenRoot);

        // Two hidden synthetic fields (two inline parts)
        const part1 = document.createElement('input') as HTMLInputElement;
        part1.type = 'hidden';
        part1.id = 'scanner-input-part-0';
        part1.value = '(SCHOOL STAFF)';
        hiddenRoot.appendChild(part1);

        const part2 = document.createElement('input') as HTMLInputElement;
        part2.type = 'hidden';
        part2.id = 'scanner-input-part-1';
        part2.value = '(STATE ASSESSMENT STAFF)';
        hiddenRoot.appendChild(part2);

        ctx.fields.push(part1 as unknown as HTMLInputElement);
        ctx.fields.push(part2 as unknown as HTMLInputElement);

        const getDetail = captureRollupDetail(rollupField);
        await updateRollup(ctx);

        const contributions = getDetail()!.contributions!;
        expect(contributions).toHaveLength(2);

        // Both hidden fields must resolve to the parent textarea, not themselves.
        for (const c of contributions) {
            expect(c.sourceId).toBe('scanner-input');
            expect(c.sourceLabel).toBe('Text to scan for markings');
            expect(c.controller).toBe('marked-textarea');
        }

        // Values still come from each hidden field individually.
        expect(contributions.map((c) => c.value).sort()).toEqual(
            ['(SCHOOL STAFF)', '(STATE ASSESSMENT STAFF)'].sort(),
        );
    });

    it('assertions in event detail match engine.process result for the aggregated rendered value', async () => {
        const rollupField = document.createElement('input');
        document.body.appendChild(rollupField);
        // The default mock engine.process maps each comma-separated token to
        // { conceptId: token, categoryId: 'level' }. Verify the event carries the
        // same shape back, this confirms cachedProcess results flow into the event.
        const ctx = createMockCtx({ rollupField });

        const field = document.createElement('input') as HTMLInputElement;
        field.value = 'STATE_ASSESSMENT_STAFF';
        document.body.appendChild(field);
        ctx.fields.push(field);

        const getDetail = captureRollupDetail(rollupField);
        await updateRollup(ctx);

        const detail = getDetail()!;
        expect(detail.assertions).toBeDefined();
        expect(detail.assertions!.length).toBeGreaterThan(0);
        const a = (
            detail.assertions as Array<{
                conceptId: string;
                categoryId: string;
            }>
        )[0];
        expect(a.conceptId).toBe('STATE_ASSESSMENT_STAFF');
        // categoryId comes from the mock engine, 'level' is the fixture value.
        expect(a.categoryId).toBe('level');
    });

    it('existing rendered and byScheme keys are preserved in enriched event', async () => {
        const rollupField = document.createElement('input');
        document.body.appendChild(rollupField);
        const ctx = createMockCtx({ rollupField });

        const compEl = document.createElement('div');
        ctx.mounted.set(compEl, createMockComponent('val'));

        let detail: Record<string, unknown> | null = null;
        rollupField.addEventListener('ezclassify:rollup', (e) => {
            detail = (e as CustomEvent).detail;
        });

        await updateRollup(ctx);

        expect(detail).toMatchObject({
            rendered: expect.any(String),
            byScheme: expect.any(Object),
            contributions: expect.any(Array),
            assertions: expect.any(Array),
        });
    });
});

describe('multi-whole partition (binding-model §16)', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
    });

    it('resolves coverage owners with linear DOM lookup work', async () => {
        const parentCount = 48;
        const rollupField = document.createElement('input');
        const ctx = createMockCtx({ rollupField });
        document.body.appendChild(rollupField);
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
        const rollupField = document.createElement('input');
        document.body.appendChild(rollupField);
        const ctx = createMockCtx({ rollupField });

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
        const rollupField = document.createElement('input');
        document.body.appendChild(rollupField);
        const ctx = createMockCtx({
            rollupField,
            aggregates: new Map(),
        } as Partial<FormsContext>);

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
        const rollupField = document.createElement('input');
        document.body.appendChild(rollupField);
        const ctx = createMockCtx({
            rollupField,
            aggregates: new Map(),
        } as Partial<FormsContext>);

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
        const rollupField = document.createElement('input');
        document.body.appendChild(rollupField);
        const ctx = createMockCtx({ rollupField });

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
        const rollupField = document.createElement('input');
        document.body.appendChild(rollupField);
        const ctx = createMockCtx({ rollupField });

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
        const rollupField = document.createElement('input');
        document.body.appendChild(rollupField);
        const ctx = createMockCtx({ rollupField });

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
        const rollupField = document.createElement('input');
        document.body.appendChild(rollupField);
        const ctx = createMockCtx({ rollupField });

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
        const rollupField = document.createElement('input');
        document.body.appendChild(rollupField);
        const ctx = createMockCtx({ rollupField });

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

describe('facet-of contributions', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
    });

    it('rolls up the current shared marking instead of stale whole-valued facet views', async () => {
        const rollupField = document.createElement('input');
        document.body.appendChild(rollupField);
        const ctx = createMockCtx({ rollupField });

        const parent = document.createElement('input');
        parent.id = 'corporate-marking';
        parent.value = 'CONFIDENTIAL//DO NOT FORWARD';
        ctx.fields.push(parent);

        const tier = document.createElement('select');
        tier.setAttribute('data-ezclassify-facet-of', parent.id);
        ctx.mounted.set(tier, createMockComponent('CONFIDENTIAL'));

        const caveat = document.createElement('input');
        caveat.setAttribute('data-ezclassify-facet-of', parent.id);
        const staleCaveat = createMockComponent('RESTRICTED//DO NOT FORWARD');
        ctx.mounted.set(caveat, staleCaveat);

        await updateRollup(ctx);

        expect(ctx.engine.aggregate).toHaveBeenCalledWith(
            [parent.value],
            expect.any(Object),
        );
        expect(rollupField.value).toBe(parent.value);
        expect(staleCaveat.getRendered).not.toHaveBeenCalled();
    });

    it.each(['data-ezclassify-no-rollup', 'data-ezclassify-scope'])(
        'excludes a facet group when its shared marking carries %s',
        async (attribute) => {
            const rollupField = document.createElement('input');
            const ctx = createMockCtx({ rollupField });
            const parent = document.createElement('input');
            parent.id = 'excluded-marking';
            parent.value = 'CONFIDENTIAL';
            parent.setAttribute(attribute, 'reference');
            ctx.fields.push(parent);

            const facet = document.createElement('select');
            facet.setAttribute('data-ezclassify-facet-of', parent.id);
            ctx.mounted.set(facet, createMockComponent('CONFIDENTIAL'));

            await updateRollup(ctx);

            expect(ctx.engine.aggregate).not.toHaveBeenCalled();
            expect(rollupField.value).toBe('');
        },
    );

    it('two facet-of children + one direct field → 2 contributions, not 3', async () => {
        const rollupField = document.createElement('input');
        document.body.appendChild(rollupField);
        const ctx = createMockCtx({ rollupField });

        // Parent element holds the combined rendering produced by the engine
        const parentEl = document.createElement('div');
        parentEl.id = 'doc-section';
        parentEl.setAttribute('aria-label', 'Section 1');
        document.body.appendChild(parentEl);
        ctx.mounted.set(
            parentEl,
            createMockComponent('//RIVERSIDE DISTRICT COORDINATORS'),
        );

        // Facet leaf 1
        const frag1 = document.createElement('div');
        frag1.id = 'section-level';
        frag1.setAttribute('aria-label', 'Sensitivity level');
        frag1.setAttribute('data-ezclassify-facet-of', 'doc-section');
        document.body.appendChild(frag1);
        ctx.mounted.set(frag1, createMockComponent('DISTRICT COORDINATORS'));

        // Facet leaf 2
        const frag2 = document.createElement('div');
        frag2.id = 'section-branch';
        frag2.setAttribute('aria-label', 'School of origin');
        frag2.setAttribute('data-ezclassify-facet-of', 'doc-section');
        document.body.appendChild(frag2);
        ctx.mounted.set(frag2, createMockComponent('//RIVERSIDE'));

        // A standalone (non-facet) field
        const directField = document.createElement('input') as HTMLInputElement;
        directField.id = 'main-field';
        directField.setAttribute('aria-label', 'Behavior-only level input');
        directField.value = '//OAKWOOD STATE ASSESSMENT STAFF';
        document.body.appendChild(directField);
        ctx.fields.push(directField);

        const getDetail = captureRollupDetail(rollupField);
        await updateRollup(ctx);

        const contributions = getDetail()!.contributions!;
        expect(contributions).toHaveLength(2);
    });

    it('facet-of parent row carries the combined rendered value, not a leaf value', async () => {
        const rollupField = document.createElement('input');
        document.body.appendChild(rollupField);
        const ctx = createMockCtx({ rollupField });

        const parentEl = document.createElement('div');
        parentEl.id = 'doc-section';
        parentEl.setAttribute('aria-label', 'Section 1');
        document.body.appendChild(parentEl);
        ctx.mounted.set(
            parentEl,
            createMockComponent('//RIVERSIDE DISTRICT COORDINATORS'),
        );

        const frag1 = document.createElement('div');
        frag1.setAttribute('data-ezclassify-facet-of', 'doc-section');
        document.body.appendChild(frag1);
        ctx.mounted.set(frag1, createMockComponent('DISTRICT COORDINATORS'));

        const frag2 = document.createElement('div');
        frag2.setAttribute('data-ezclassify-facet-of', 'doc-section');
        document.body.appendChild(frag2);
        ctx.mounted.set(frag2, createMockComponent('//RIVERSIDE'));

        const getDetail = captureRollupDetail(rollupField);
        await updateRollup(ctx);

        const contributions = getDetail()!.contributions!;
        expect(contributions).toHaveLength(1);
        expect(contributions[0].value).toBe(
            '//RIVERSIDE DISTRICT COORDINATORS',
        );
    });

    it('sourceId and sourceLabel resolve to the parent element, not the fragment leaves', async () => {
        const rollupField = document.createElement('input');
        document.body.appendChild(rollupField);
        const ctx = createMockCtx({ rollupField });

        const parentEl = document.createElement('div');
        parentEl.id = 'doc-section';
        parentEl.setAttribute('aria-label', 'Section 1');
        document.body.appendChild(parentEl);
        ctx.mounted.set(
            parentEl,
            createMockComponent('//RIVERSIDE DISTRICT COORDINATORS'),
        );

        const frag1 = document.createElement('div');
        frag1.id = 'section-level';
        frag1.setAttribute('aria-label', 'Sensitivity level');
        frag1.setAttribute('data-ezclassify-facet-of', 'doc-section');
        document.body.appendChild(frag1);
        ctx.mounted.set(frag1, createMockComponent('DISTRICT COORDINATORS'));

        const frag2 = document.createElement('div');
        frag2.id = 'section-branch';
        frag2.setAttribute('aria-label', 'School of origin');
        frag2.setAttribute('data-ezclassify-facet-of', 'doc-section');
        document.body.appendChild(frag2);
        ctx.mounted.set(frag2, createMockComponent('//RIVERSIDE'));

        const getDetail = captureRollupDetail(rollupField);
        await updateRollup(ctx);

        const contributions = getDetail()!.contributions!;
        expect(contributions).toHaveLength(1);
        expect(contributions[0].sourceId).toBe('doc-section');
        expect(contributions[0].sourceLabel).toBe('Section 1');
        expect(contributions[0].value).toBe(
            '//RIVERSIDE DISTRICT COORDINATORS',
        );
    });
});
