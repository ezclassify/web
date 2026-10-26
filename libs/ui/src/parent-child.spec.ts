import { describe, it, expect, vi } from 'vitest';
import { updateRollup } from './forms/rollup';
import type { FormsContext } from './forms/types';
import type { Assertion } from '@ezclassify/types';
import { mockRenderFormats } from './render-format-layout-mock';

// Mock forms/dom
vi.mock('./forms/dom', () => ({
    showCopiedIndicator: vi.fn(),
}));

/**
 * Build a mock engine with a simplified profile that has:
 *
 * - A single-select "level" category with concepts L1, L2, L3 (low to high)
 * - A "rel_to_countries" category with country concepts (COUNTRY-A, COUNTRY-B,
 *   COUNTRY-C)
 * - A header concept HDR-REL that has headerForCategory: 'rel_to_countries'
 * - A "display_only_countries" category with the same country concepts
 * - A header concept HDR-DISP that has headerForCategory:
 *   'display_only_countries'
 */
function createMockEngine(overrides: Record<string, unknown> = {}) {
    const concepts = [
        {
            id: 'L1',
            name: 'Level 1',
            views: { default: 'L1' },
            aliases: [],
            categories: ['level'],
            parents: [],
        },
        {
            id: 'L2',
            name: 'Level 2',
            views: { default: 'L2' },
            aliases: [],
            categories: ['level'],
            parents: [],
        },
        {
            id: 'L3',
            name: 'Level 3',
            views: { default: 'L3' },
            aliases: [],
            categories: ['level'],
            parents: [],
        },
        {
            id: 'HDR-REL',
            name: 'Rel To',
            views: { default: 'REL TO' },
            aliases: [],
            categories: ['dissemination'],
            parents: [],
            headerForCategory: 'rel_to_countries',
        },
        {
            id: 'COUNTRY-A',
            name: 'Country A',
            views: { default: 'AAA' },
            aliases: [],
            categories: ['rel_to_countries'],
            parents: [],
        },
        {
            id: 'COUNTRY-B',
            name: 'Country B',
            views: { default: 'BBB' },
            aliases: [],
            categories: ['rel_to_countries'],
            parents: [],
        },
        {
            id: 'COUNTRY-C',
            name: 'Country C',
            views: { default: 'CCC' },
            aliases: [],
            categories: ['rel_to_countries'],
            parents: [],
        },
        {
            id: 'HDR-DISP',
            name: 'Display Only',
            views: { default: 'DISPLAY ONLY' },
            aliases: [],
            categories: ['dissemination'],
            parents: [],
            headerForCategory: 'display_only_countries',
        },
        {
            id: 'COUNTRY-D',
            name: 'Country D',
            views: { default: 'DDD' },
            aliases: [],
            categories: ['display_only_countries'],
            parents: [],
        },
    ];

    const categories = [
        {
            id: 'level',
            label: 'Level',
            required: true,
            single: true,
            rollupOperator: 'max',
        },
        {
            id: 'dissemination',
            label: 'Dissemination',
            required: false,
            single: false,
            rollupOperator: 'union',
        },
        {
            id: 'rel_to_countries',
            label: 'Rel To Countries',
            required: false,
            single: false,
            rollupOperator: 'intersect',
        },
        {
            id: 'display_only_countries',
            label: 'Display Only Countries',
            required: false,
            single: false,
            rollupOperator: 'intersect',
        },
    ];

    const _profile: Record<string, unknown> = {
        concepts,
        categories,
        formats: [
            {
                id: 'default',
                categoryOrder: [
                    'level',
                    'dissemination',
                    'rel_to_countries',
                    'display_only_countries',
                ],
                separator: ' ',
                categorySeparator: '//',
                view: 'default',
            },
        ],
        scopes: [],
        defaultRenderFormat: 'default',
        ...overrides,
    };
    const engine: Record<string, unknown> = {};
    engine.getScheme = () => _profile;
    engine.getSchemeMeta = () => ({
        id: (_profile.id as string) ?? 'test',
        version: (_profile.version as string) ?? '1.0',
        name: (_profile.name as string) ?? 'Test',
        defaultRenderFormat:
            (_profile.defaultRenderFormat as string) ?? 'default',
        formats: mockRenderFormats(_profile.formats as any[]),
        scopes: (_profile.scopes as any[]) ?? [],
        vocabulary: _profile.vocabulary,
    });
    engine.listCategories = () => (_profile.categories as any[]) ?? [];
    engine.getConceptsInCategory = (catId: string) =>
        (concepts as any[]).filter((c: any) => c.categories?.includes(catId));
    Object.assign(engine, {
        render: vi.fn((assertions: Assertion[]) => {
            // Simple render: join concept views by category separator
            const byCategory = new Map<string, string[]>();
            for (const a of assertions) {
                const c = concepts.find((cc) => cc.id === a.conceptId);
                const view = c?.views?.default ?? a.conceptId;
                const list = byCategory.get(a.categoryId) ?? [];
                list.push(view);
                byCategory.set(a.categoryId, list);
            }
            const parts: string[] = [];
            for (const fid of [
                'level',
                'dissemination',
                'rel_to_countries',
                'display_only_countries',
            ]) {
                const vals = byCategory.get(fid);
                if (vals && vals.length > 0) parts.push(vals.join(', '));
            }
            return parts.join('//');
        }),
        // A part read in a whole is compared with it, as the engine does: a
        // level above the whole's is the part's `_exceeds_whole` error.
        process: vi.fn(
            (
                input: string,
                options?: { context?: { partOf?: { rendered: string } } },
            ) => {
                const whole = options?.context?.partOf?.rendered;
                const errors =
                    whole && levelOf(input) > levelOf(whole)
                        ? [
                              {
                                  constraintId: '_exceeds_whole',
                                  message: `This part exceeds its whole: the whole does not cover ${input}.`,
                              },
                          ]
                        : [];
                return {
                    assertions: input
                        ? input.split(',').map((id) => ({
                              conceptId: id.trim(),
                              categoryId: 'level',
                              confidence: 'certain' as const,
                              source: 'parse' as const,
                          }))
                        : [],
                    rendered: input,
                    valid: errors.length === 0,
                    errors,
                };
            },
        ),
        suggest: vi.fn(() => ({ suggestions: [] })),
        aggregate: vi.fn((values: string[]) => {
            // Simple mock aggregate: for level category, take the highest
            // For country categories, take the intersection
            // In practice just concatenate for simplicity, but we customize per test
            return {
                assertions: [],
                rendered: values.sort().reverse()[0] ?? '',
                valid: true,
            };
        }),
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
            const covered = rendered === parent;
            // Populate `missing` so callers can identify which children contribute
            // concepts the parent lacks (matches the real engine's behavior).
            const missing: Assertion[] = [];
            if (!covered) {
                const process = engine['process'] as (input: string) => {
                    assertions: Assertion[];
                };
                const parentAssertions = process(parent).assertions;
                const parentKeys = new Set(
                    parentAssertions.map(
                        (a) => `${a.conceptId}::${a.categoryId}`,
                    ),
                );
                const seen = new Set<string>();
                for (const child of nonEmpty) {
                    for (const a of process(child).assertions) {
                        const key = `${a.conceptId}::${a.categoryId}`;
                        if (!parentKeys.has(key) && !seen.has(key)) {
                            seen.add(key);
                            missing.push(a);
                        }
                    }
                }
            }
            return {
                covered,
                missing,
                missingLabels: missing.map((a) => a.conceptId),
                excess: [],
                excessLabels: [],
                rendered,
            };
        }),
    });
    return engine as unknown as FormsContext['engine'];
}

/** The highest of the levels L1 to L3 a mock marking names, 0 for none. */
function levelOf(marking: string): number {
    return Math.max(
        0,
        ...marking
            .split(',')
            .map((id) => ['L1', 'L2', 'L3'].indexOf(id.trim()) + 1),
    );
}

/** The validation notice placed right after `el`, if there is one. */
function noticeAfter(el: HTMLElement): HTMLElement | null {
    const next = el.nextElementSibling as HTMLElement | null;
    return next?.classList.contains('ez-parent-validation-notice')
        ? next
        : null;
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

// The coverage reports below have the shape the engine returns for these ISM
// markings (runtime 01668834, us-gov-capco@20161231.0.0), so each direction's
// wording is checked against what a real check produces.
const bannerScheme = {
    vocabulary: {
        whole: { singular: 'banner' },
        part: { singular: 'portion' },
    },
};

function assertion(conceptId: string, categoryId: string): Assertion {
    return { conceptId, categoryId, confidence: 'certain', source: 'parse' };
}

/**
 * A `SECRET//REL TO USA, CAN, GBR` banner over a `(S//REL TO USA, GBR)`
 * portion.
 */
const OVER_RELEASE = {
    covered: false,
    missing: [],
    missingLabels: [],
    excess: [assertion('CAN', 'rel_to')],
    excessLabels: ['CAN'],
    rendered: 'SECRET//REL TO USA, GBR',
};

/** A forms context whose engine answers every coverage check with `report`. */
function ctxReporting(
    report: Record<string, unknown>,
    overrides: Partial<FormsContext> = {},
): FormsContext {
    const engine = createMockEngine(bannerScheme);
    (engine.checkCoverage as ReturnType<typeof vi.fn>).mockResolvedValue(
        report,
    );
    return createMockCtx({ engine, ...overrides });
}

describe('parent-child integration via updateRollup', () => {
    it('dispatches validation event on child with parent', async () => {
        const rollupField = document.createElement('input');
        const ctx = createMockCtx({ rollupField });

        const parentField = document.createElement('input');
        parentField.id = 'parent-banner';
        parentField.value = 'L2';
        ctx.fields.push(parentField);

        const childField = document.createElement('input');
        childField.id = 'child-section';
        childField.value = 'L1';
        childField.setAttribute('data-ezclassify-part-of', 'parent-banner');
        ctx.fields.push(childField);
        ctx.partOfMap.set(childField, 'parent-banner');

        // Mock: render returns concept IDs, aggregate returns parent value (child within parent)
        (ctx.engine.render as ReturnType<typeof vi.fn>).mockImplementation(
            (assertions: Assertion[]) => {
                return assertions.map((a) => a.conceptId).join(',');
            },
        );
        (ctx.engine.aggregate as ReturnType<typeof vi.fn>).mockReturnValue({
            assertions: [],
            rendered: 'L2',
            valid: true,
        });

        const events: CustomEvent[] = [];
        childField.addEventListener('ezclassify:validation', (e) => {
            events.push(e as CustomEvent);
        });

        // Need to put child in DOM so parentNode queries work
        document.body.appendChild(parentField);
        document.body.appendChild(childField);

        await updateRollup(ctx);

        expect(events).toHaveLength(1);
        expect(events[0].detail.valid).toBe(true);

        // Cleanup
        document.body.removeChild(parentField);
        document.body.removeChild(childField);
    });

    it('inserts the validation notice AFTER the sibling ezclassify mount (not before it)', async () => {
        // The notice must render below the visible tag input.
        // declarative-attrs hides the native input and inserts a visible
        // component container as the next sibling. The parent-child notice
        // must land AFTER that sibling mount so it renders BELOW the
        // visible tag input, not between the hidden input and the mount.
        const rollupField = document.createElement('input');
        const ctx = createMockCtx({ rollupField });

        // Parent: a normal input (no mount wrapper).
        const parentField = document.createElement('input');
        parentField.id = 'doc-banner';
        parentField.value = 'L1';
        ctx.fields.push(parentField);

        // Child: a hidden native input followed by a sibling mount div,
        // exactly the shape declarative-attrs produces for an interactive
        // tag input.
        const fieldGroup = document.createElement('div');
        fieldGroup.className = 'field-group';

        const childField = document.createElement('input');
        childField.id = 'section-1';
        childField.value = 'L3';
        childField.style.display = 'none';
        fieldGroup.appendChild(childField);

        const mount = document.createElement('div');
        mount.setAttribute('data-ezclassify-mount', 'tags');
        mount.setAttribute('data-ezclassify', '');
        fieldGroup.appendChild(mount);

        ctx.fields.push(childField);
        ctx.partOfMap.set(childField, 'doc-banner');

        (ctx.engine.aggregate as ReturnType<typeof vi.fn>).mockReturnValue({
            assertions: [],
            rendered: 'L3',
            valid: true,
        });
        (ctx.engine.render as ReturnType<typeof vi.fn>).mockImplementation(
            (assertions: Assertion[]) => {
                const ids = assertions.map((a) => a.conceptId);
                return ids.includes('L3') ? 'L3' : 'L1';
            },
        );

        document.body.appendChild(parentField);
        document.body.appendChild(fieldGroup);

        await updateRollup(ctx);

        const notice = fieldGroup.querySelector('.ez-parent-validation-notice');
        expect(notice).not.toBeNull();
        // The notice must be a child of the same field-group…
        expect(notice?.parentElement).toBe(fieldGroup);
        // …and it must come AFTER the mount div, not before it.
        const children = Array.from(fieldGroup.children);
        const mountIdx = children.indexOf(mount);
        const noticeIdx = children.indexOf(notice as Element);
        expect(noticeIdx).toBeGreaterThan(mountIdx);

        document.body.removeChild(parentField);
        document.body.removeChild(fieldGroup);
    });

    it('dispatches validation error when child exceeds parent', async () => {
        const rollupField = document.createElement('input');
        const ctx = createMockCtx({ rollupField });

        const parentField = document.createElement('input');
        parentField.id = 'doc-banner';
        parentField.value = 'L1';
        ctx.fields.push(parentField);

        const childField = document.createElement('input');
        childField.id = 'section-1';
        childField.value = 'L3';
        ctx.fields.push(childField);
        ctx.partOfMap.set(childField, 'doc-banner');

        // First call: rollup aggregate, second call: validation aggregate
        let callCount = 0;
        (ctx.engine.aggregate as ReturnType<typeof vi.fn>).mockImplementation(
            (_values: string[]) => {
                callCount++;
                // Rollup call
                if (callCount === 1)
                    return { assertions: [], rendered: 'L3', valid: true };
                // Validation call: aggregate differs from parent
                return { assertions: [], rendered: 'L3', valid: true };
            },
        );

        // render returns different values for parent vs child
        (ctx.engine.render as ReturnType<typeof vi.fn>).mockImplementation(
            (assertions: Assertion[]) => {
                const ids = assertions.map((a) => a.conceptId);
                if (ids.includes('L3')) return 'L3';
                return 'L1';
            },
        );

        const events: CustomEvent[] = [];
        childField.addEventListener('ezclassify:validation', (e) => {
            events.push(e as CustomEvent);
        });

        document.body.appendChild(parentField);
        document.body.appendChild(childField);

        await updateRollup(ctx);

        expect(events).toHaveLength(1);
        expect(events[0].detail.valid).toBe(false);
        expect(events[0].detail.error).toBe(
            'This part exceeds its whole: the whole does not cover L3.',
        );
        expect(events[0].detail.childRendered).toBe('L3');
        expect(events[0].detail.parentRendered).toBe('L1');

        // Check visual feedback
        expect(childField.hasAttribute('data-ezclassify-error')).toBe(true);

        document.body.removeChild(parentField);
        document.body.removeChild(childField);
    });

    it('no parent attribute means no inheritance or validation', async () => {
        const rollupField = document.createElement('input');
        const ctx = createMockCtx({ rollupField });

        const field1 = document.createElement('input');
        field1.id = 'field-1';
        ctx.fields.push(field1);
        ctx.fieldAssertions.set(field1, [
            { conceptId: 'L3', categoryId: 'level' },
        ]);

        const field2 = document.createElement('input');
        field2.id = 'field-2';
        ctx.fields.push(field2);
        ctx.fieldAssertions.set(field2, [
            { conceptId: 'L1', categoryId: 'level' },
        ]);

        // No partOfMap entries

        const events: CustomEvent[] = [];
        field1.addEventListener('ezclassify:validation', (e) =>
            events.push(e as CustomEvent),
        );
        field2.addEventListener('ezclassify:validation', (e) =>
            events.push(e as CustomEvent),
        );

        await updateRollup(ctx);

        // No validation events should fire
        expect(events).toHaveLength(0);
    });

    it('parent change triggers child re-validation on next rollup', async () => {
        const rollupField = document.createElement('input');
        const ctx = createMockCtx({ rollupField });

        const parentField = document.createElement('input');
        parentField.id = 'parent-doc';
        parentField.value = 'L3';
        ctx.fields.push(parentField);

        const childField = document.createElement('input');
        childField.id = 'child-sec';
        childField.value = 'L2';
        ctx.fields.push(childField);
        ctx.partOfMap.set(childField, 'parent-doc');

        document.body.appendChild(parentField);
        document.body.appendChild(childField);

        // First rollup: child within parent
        (ctx.engine.aggregate as ReturnType<typeof vi.fn>).mockReturnValue({
            assertions: [],
            rendered: 'L3',
            valid: true,
        });

        const events: CustomEvent[] = [];
        childField.addEventListener('ezclassify:validation', (e) =>
            events.push(e as CustomEvent),
        );

        await updateRollup(ctx);
        expect(events).toHaveLength(1);
        expect(events[0].detail.valid).toBe(true);

        // Now downgrade parent to L1, child L2 exceeds
        parentField.value = 'L1';

        // aggregate now returns L2 (differs from parent L1)
        (ctx.engine.render as ReturnType<typeof vi.fn>).mockImplementation(
            (assertions: Assertion[]) => {
                const ids = assertions.map((a) => a.conceptId);
                if (ids.includes('L2')) return 'L2';
                return 'L1';
            },
        );
        (ctx.engine.aggregate as ReturnType<typeof vi.fn>).mockReturnValue({
            assertions: [],
            rendered: 'L2',
            valid: true,
        });

        await updateRollup(ctx);

        expect(events).toHaveLength(2);
        expect(events[1].detail.valid).toBe(false);

        document.body.removeChild(parentField);
        document.body.removeChild(childField);
    });

    it('passes context with whole marking during validation when child is a part', async () => {
        const rollupField = document.createElement('input');
        const ctx = createMockCtx({ rollupField });

        const parentField = document.createElement('input');
        parentField.id = 'banner-parent';
        parentField.value = 'L2,HDR-REL,COUNTRY-A,COUNTRY-B';
        ctx.fields.push(parentField);

        const childField = document.createElement('input');
        childField.id = 'section-child';
        childField.value = 'L1,HDR-REL';
        ctx.fields.push(childField);
        ctx.partOfMap.set(childField, 'banner-parent');

        // Track process calls with context
        const processContextCalls: Array<{ input: string; context?: unknown }> =
            [];
        (ctx.engine.process as ReturnType<typeof vi.fn>).mockImplementation(
            (input: string, options?: Record<string, unknown>) => {
                if (options?.context) {
                    processContextCalls.push({
                        input,
                        context: options.context,
                    });
                }
                return { assertions: [], rendered: input, valid: true };
            },
        );

        // Return a rollup value that differs from the parent's rendered value
        // to force the slow path, which triggers context-aware validation.
        (ctx.engine.aggregate as ReturnType<typeof vi.fn>).mockReturnValue({
            assertions: [],
            rendered: 'L2,HDR-REL,COUNTRY-A,COUNTRY-B,COUNTRY-C',
            valid: true,
        });

        // Register mock components
        ctx.mounted.set(parentField, {
            init: vi.fn(),
            getAssertions: vi.fn(() => []),
            setAssertions: vi.fn(),
            setValue: vi.fn(),
            destroy: vi.fn(),
            getRendered: vi.fn(() => 'L2,HDR-REL,COUNTRY-A,COUNTRY-B'),
        });
        ctx.mounted.set(childField, {
            init: vi.fn(),
            getAssertions: vi.fn(() => []),
            setAssertions: vi.fn(),
            setValue: vi.fn(),
            destroy: vi.fn(),
            getRendered: vi.fn(() => 'L1,HDR-REL'),
        });

        document.body.appendChild(parentField);
        document.body.appendChild(childField);

        await updateRollup(ctx);

        // The process call for the child should include context with the whole marking
        const childCall = processContextCalls.find(
            (c) => c.input === 'L1,HDR-REL',
        );
        expect(childCall).toBeDefined();
        expect(childCall!.context).toEqual({
            role: 'part',
            partOf: { rendered: 'L2,HDR-REL,COUNTRY-A,COUNTRY-B' },
        });

        document.body.removeChild(parentField);
        document.body.removeChild(childField);
    });

    it('offers and applies the engine-required whole for any writable controller', async () => {
        const rollupField = document.createElement('input');
        const ctx = createMockCtx({ rollupField });

        const group = document.createElement('input');
        group.id = 'document-parts';
        group.value = 'L1';
        ctx.fields.push(group);

        const whole = document.createElement('textarea');
        whole.id = 'authored-whole';
        whole.setAttribute('data-ezclassify-bound-to', 'document-parts');
        const setValue = vi.fn();
        ctx.mounted.set(whole, {
            init: vi.fn(),
            getAssertions: vi.fn(() => []),
            setAssertions: vi.fn(),
            setValue,
            destroy: vi.fn(),
            getRendered: vi.fn(() => 'L1'),
        });

        const child = document.createElement('input');
        child.id = 'portion';
        child.value = 'L2';
        ctx.fields.push(child);
        ctx.partOfMap.set(child, 'document-parts');

        document.body.append(group, whole, child, rollupField);
        await updateRollup(ctx);

        const correction = whole.nextElementSibling;
        expect(correction).not.toBeNull();
        expect(
            correction!.classList.contains('ez-coverage-action--unseen'),
        ).toBe(true);

        correction!
            .querySelector<HTMLButtonElement>('.ez-coverage-action__trigger')!
            .click();
        expect(correction!.textContent).toContain('Apply the required marking');
        correction!
            .querySelector<HTMLButtonElement>('.ez-coverage-action__apply')!
            .click();

        expect(setValue).toHaveBeenCalledWith('L2');
        document.body.replaceChildren();
    });

    it('offers the computed whole when the authored whole is empty', async () => {
        const rollupField = document.createElement('input');
        const ctx = createMockCtx({ rollupField });
        const wholeHost = document.createElement('input');
        wholeHost.id = 'empty-whole';
        ctx.fields.push(wholeHost);

        const whole = document.createElement('textarea');
        whole.setAttribute('data-ezclassify-bound-to', 'empty-whole');
        ctx.mounted.set(whole, {
            init: vi.fn(),
            getAssertions: vi.fn(() => []),
            setAssertions: vi.fn(),
            setValue: vi.fn(),
            destroy: vi.fn(),
            getRendered: vi.fn(() => ''),
        });

        const child = document.createElement('input');
        child.value = 'L2';
        ctx.fields.push(child);
        ctx.partOfMap.set(child, 'empty-whole');

        document.body.append(wholeHost, whole, child, rollupField);
        await updateRollup(ctx);

        const correction = whole.nextElementSibling;
        expect(
            correction!.classList.contains('ez-coverage-action--unseen'),
        ).toBe(true);
        correction!
            .querySelector<HTMLButtonElement>('.ez-coverage-action__trigger')!
            .click();
        expect(correction!.textContent).toContain('The required marking is L2');
        document.body.replaceChildren();
    });

    it('adds no notice and no correction to a whole whose field judges its parts itself', async () => {
        const rollupField = document.createElement('input');
        const ctx = createMockCtx({ rollupField });

        const group = document.createElement('input');
        group.id = 'owned-whole';
        group.value = 'L1';
        ctx.fields.push(group);

        // The field reports the part-coverage error and its fix itself.
        const whole = document.createElement('textarea');
        whole.setAttribute('data-ezclassify-bound-to', 'owned-whole');
        const setValue = vi.fn();
        ctx.mounted.set(whole, {
            init: vi.fn(),
            getAssertions: vi.fn(() => []),
            setAssertions: vi.fn(),
            setValue,
            destroy: vi.fn(),
            getRendered: vi.fn(() => 'L1'),
            coversParts: true,
        });

        const child = document.createElement('input');
        child.value = 'L2';
        ctx.fields.push(child);
        ctx.partOfMap.set(child, 'owned-whole');

        const events: Array<{ valid: boolean }> = [];
        group.addEventListener('ezclassify:validation', (e) =>
            events.push((e as CustomEvent<{ valid: boolean }>).detail),
        );

        document.body.append(group, whole, child, rollupField);
        await updateRollup(ctx);

        expect(document.querySelector('.ez-coverage-action')).toBeNull();
        const notice = noticeAfter(group);
        expect(notice === null || notice.style.display === 'none').toBe(true);
        // A part over its whole is still flagged on the part.
        expect(noticeAfter(child)?.style.display).not.toBe('none');
        expect(group.hasAttribute('data-ezclassify-error')).toBe(false);
        // Hosts listening for the event still hear the finding.
        expect(events.at(-1)?.valid).toBe(false);
        // The rollup still records the whole's coverage state.
        expect(ctx.aggregates?.get('owned-whole')?.state.valid).toBe(false);
        expect(setValue).not.toHaveBeenCalled();
        document.body.replaceChildren();
    });

    it('still adds the notice and the correction when the whole field does not judge its parts', async () => {
        const rollupField = document.createElement('input');
        const ctx = createMockCtx({ rollupField });

        // A plain whole field: nothing else reports coverage for it.
        const group = document.createElement('input');
        group.id = 'plain-whole';
        group.value = 'L1';
        ctx.fields.push(group);

        const child = document.createElement('input');
        child.value = 'L2';
        ctx.fields.push(child);
        ctx.partOfMap.set(child, 'plain-whole');

        document.body.append(group, child, rollupField);
        await updateRollup(ctx);

        const notice = noticeAfter(group);
        expect(notice?.textContent).toContain('does not cover');
        expect(notice?.style.display).not.toBe('none');
        expect(
            document.querySelector(
                '.ez-coverage-action[data-ezclassify-for="plain-whole"]',
            ),
        ).not.toBeNull();
        document.body.replaceChildren();
    });

    it('puts a banner over-release on the banner and leaves the correct portion alone', async () => {
        const rollupField = document.createElement('input');
        const ctx = ctxReporting(OVER_RELEASE, { rollupField });

        const banner = document.createElement('input');
        banner.id = 'banner';
        banner.value = 'SECRET//REL TO USA, CAN, GBR';
        ctx.fields.push(banner);

        const portion = document.createElement('input');
        portion.id = 'portion';
        portion.value = 'S//REL TO USA, GBR';
        ctx.fields.push(portion);
        ctx.partOfMap.set(portion, 'banner');

        const portionValidation: CustomEvent[] = [];
        const coverageErrors: CustomEvent[] = [];
        portion.addEventListener('ezclassify:validation', (e) =>
            portionValidation.push(e as CustomEvent),
        );
        portion.addEventListener('ezclassify:coverage-error', (e) =>
            coverageErrors.push(e as CustomEvent),
        );

        document.body.append(banner, portion, rollupField);
        await updateRollup(ctx);

        expect(noticeAfter(banner)?.textContent).toBe(
            'Banner marking carries CAN beyond what the portions allow',
        );
        expect(banner.hasAttribute('data-ezclassify-error')).toBe(true);

        expect(coverageErrors).toHaveLength(0);
        expect(portionValidation.map((e) => e.detail.valid)).toEqual([true]);
        expect(portion.hasAttribute('data-ezclassify-error')).toBe(false);
        expect(noticeAfter(portion)).toBeNull();

        const correction = document.querySelector<HTMLElement>(
            '.ez-coverage-action[data-ezclassify-for="banner"]',
        );
        correction!
            .querySelector<HTMLButtonElement>('.ez-coverage-action__trigger')!
            .click();
        expect(correction!.textContent).toContain(
            'The declared overall does not cover the parts. It carries CAN beyond what the parts allow.',
        );
        document.body.replaceChildren();
    });

    it('names both what the banner is missing and what it carries in excess', async () => {
        // `SECRET//REL TO USA, CAN, GBR` over `(S//NF)`: the portion needs
        // NOFORN the banner lacks, and the banner releases to countries the
        // portion does not allow.
        const rollupField = document.createElement('input');
        const ctx = ctxReporting(
            {
                covered: false,
                missing: [assertion('NF', 'dissem')],
                missingLabels: ['NOFORN'],
                excess: [
                    assertion('REL-TO', 'dissem'),
                    assertion('USA', 'rel_to'),
                    assertion('CAN', 'rel_to'),
                    assertion('GBR', 'rel_to'),
                ],
                excessLabels: ['REL TO', 'USA', 'CAN', 'GBR'],
                rendered: 'SECRET//NOFORN',
            },
            { rollupField },
        );

        const banner = document.createElement('input');
        banner.id = 'banner';
        banner.value = 'SECRET//REL TO USA, CAN, GBR';
        ctx.fields.push(banner);

        const portion = document.createElement('input');
        portion.id = 'portion';
        portion.value = 'S//NF';
        ctx.fields.push(portion);
        ctx.partOfMap.set(portion, 'banner');

        document.body.append(banner, portion, rollupField);
        await updateRollup(ctx);

        expect(noticeAfter(banner)?.textContent).toBe(
            'Banner marking does not cover portion content: missing NOFORN, ' +
                'and carries REL TO, USA, CAN, GBR beyond what the portions allow',
        );

        const correction = document.querySelector<HTMLElement>(
            '.ez-coverage-action[data-ezclassify-for="banner"]',
        );
        correction!
            .querySelector<HTMLButtonElement>('.ez-coverage-action__trigger')!
            .click();
        expect(correction!.textContent).toContain(
            'It is missing NOFORN and carries REL TO, USA, CAN, GBR beyond what the parts allow.',
        );
        document.body.replaceChildren();
    });

    it('keeps a whole and its part in one container on their own notices', async () => {
        const rollupField = document.createElement('input');
        const ctx = createMockCtx({ rollupField });

        const whole = document.createElement('input');
        whole.id = 'shared-whole';
        whole.value = 'L1';
        ctx.fields.push(whole);

        const part = document.createElement('input');
        part.id = 'shared-part';
        part.value = 'L2';
        ctx.fields.push(part);
        ctx.partOfMap.set(part, 'shared-whole');

        const container = document.createElement('div');
        container.append(whole, part);
        document.body.append(container, rollupField);
        await updateRollup(ctx);
        // A second pass reuses each element's notice rather than the first
        // one it finds in the container.
        await updateRollup(ctx);

        const notices = container.querySelectorAll<HTMLElement>(
            '.ez-parent-validation-notice',
        );
        expect(notices).toHaveLength(2);
        expect(noticeAfter(whole)?.textContent).toContain('does not cover');
        expect(noticeAfter(part)?.textContent).toBe(
            'This part exceeds its whole: the whole does not cover L2.',
        );
        document.body.replaceChildren();
    });

    it('never offers a whole correction to a container that does not author a whole', async () => {
        const rollupField = document.createElement('input');
        const ctx = createMockCtx({ rollupField });

        // A marked-textarea shape: the container's own parts name it as
        // their parent, its rendered value is always empty, and it declares
        // that it authors no whole. Writing the aggregate into it would
        // replace its body text.
        const container = document.createElement('textarea');
        container.id = 'body';
        const setValue = vi.fn();
        ctx.mounted.set(container, {
            init: vi.fn(),
            getAssertions: vi.fn(() => []),
            setAssertions: vi.fn(),
            setValue,
            destroy: vi.fn(),
            getRendered: vi.fn(() => ''),
            authorsWhole: false,
        });

        const part = document.createElement('input');
        part.id = 'body-part-1-1';
        part.value = 'L2';
        ctx.fields.push(part);
        ctx.partOfMap.set(part, 'body');

        document.body.append(container, part, rollupField);
        await updateRollup(ctx);

        expect(document.querySelector('.ez-coverage-action')).toBeNull();
        expect(setValue).not.toHaveBeenCalled();
        // The container still takes part in the partition as its parts' parent.
        expect(ctx.aggregates?.get('body')?.el).toBe(container);
        document.body.replaceChildren();
    });
});
