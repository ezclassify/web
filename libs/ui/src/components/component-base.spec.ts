import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ComponentBase } from './component-base';
import type {
    SchemeEngineAdapter,
    Assertion,
    Suggestion,
} from '@ezclassify/types';
import type {
    SchemePublicView,
    ConceptView,
    CategoryView,
    Fix,
} from '@ezclassify/types';
import { Context } from '@ezclassify/engine';
import { mockProcessResult } from '../engine-result-mock';
import { mockRenderFormats } from '../render-format-layout-mock';

/** Concrete subclass for testing the abstract ComponentBase. */
class TestComponent extends ComponentBase {
    setupCalled = false;
    renderCount = 0;

    protected setup(): void {
        this.setupCalled = true;
    }
    protected render(): void {
        this.renderCount++;
    }
    destroy(): void {
        this.container.innerHTML = '';
    }

    /** Expose protected methods for testing */
    doAddAssertion(
        conceptId: string,
        categoryId: string,
        value?: string,
        insertIndex?: number,
    ): void {
        this.addAssertion(conceptId, categoryId, value, insertIndex);
    }
    doRemoveAssertion(conceptId: string, categoryId: string): void {
        this.removeAssertion(conceptId, categoryId);
    }
    doToggleSuggestion(s: {
        conceptId: string;
        categoryId: string;
        selected?: boolean;
    }): void {
        this.toggleSuggestion(s);
    }
    doReprocess(): void {
        this.reprocess();
    }
    doApplyRuleFix(fix: Fix): void {
        this.ruleFixHandler()(fix);
    }
    async doGetSuggestions(filter?: string): Promise<Suggestion[]> {
        return this.getSuggestions(filter);
    }
    doFuzzyMatch(q: string, t: string): number {
        return this.fuzzyMatch(q, t);
    }
    doDarken(hex: string, amount: number): string {
        return this.darken(hex, amount);
    }
    doDisambiguateSuggestions(s: Suggestion[]): Suggestion[] {
        return this.disambiguateSuggestions(s);
    }
    doAttachConceptTooltip(
        el: HTMLElement,
        conceptId: string,
        categoryId: string,
    ): void {
        this.attachConceptTooltip(el, conceptId, categoryId);
    }
}

function createMockProfile(): SchemePublicView {
    const concepts: ConceptView[] = [
        {
            id: 'c1',
            name: 'Concept One',
            views: { default: 'C1' },
            categories: ['cat1'],
            parents: [],
            aliases: [],
            position: 0,
            documentation: { definition: 'Def c1' },
        },
        {
            id: 'c2',
            name: 'Concept Two',
            views: { default: 'C2' },
            categories: ['cat2'],
            parents: ['c1'],
            aliases: [],
            position: 1,
        },
        {
            id: 'c3',
            name: 'Concept Three',
            views: { default: 'C3' },
            categories: ['cat2'],
            parents: [],
            aliases: [],
            position: 2,
        },
    ] as ConceptView[];

    const categories: CategoryView[] = [
        {
            id: 'cat1',
            label: 'Category 1',
            single: true,
            required: false,
        } as CategoryView,
        {
            id: 'cat2',
            label: 'Category 2',
            single: false,
            required: false,
        } as CategoryView,
    ];

    return {
        name: 'Test Scheme',
        categories,
        concepts,
        formats: [
            {
                id: 'default',
                categoryOrder: ['cat1', 'cat2'],
                separator: ' ',
                categorySeparator: '//',
                view: 'default',
            },
        ],
        scopes: [],
        defaultRenderFormat: 'default',
    } as unknown as SchemePublicView;
}

function createMockEngine(scheme?: SchemePublicView): SchemeEngineAdapter {
    const p = scheme ?? createMockProfile();
    return {
        getScheme: () => p,
        getSchemeMeta: () => ({
            id: (p as any).id ?? 'test',
            version: (p as any).version ?? '1.0',
            name: p.name ?? 'Test',
            defaultRenderFormat: (p as any).defaultRenderFormat ?? 'default',
            formats: mockRenderFormats(p.formats ?? []),
            scopes: (p as any).scopes ?? [],
        }),
        listCategories: () => p.categories ?? [],
        getConceptsInCategory: (catId: string) =>
            (p.concepts ?? []).filter((c: any) =>
                c.categories?.includes(catId),
            ),
        render: vi.fn((assertions: Assertion[]) =>
            assertions.map((a) => a.conceptId).join(', '),
        ),
        process: vi.fn((_input: string, opts?: any) => {
            const assertions: Assertion[] = opts?.assertions ?? [];
            return {
                assertions,
                rendered: assertions
                    .map((a: Assertion) => a.conceptId)
                    .join(', '),
                valid: true,
            };
        }),
        suggest: vi.fn().mockReturnValue({
            suggestions: [
                {
                    conceptId: 'c1',
                    categoryId: 'cat1',
                    label: 'C1',
                    name: 'Concept One',
                    group: 'Category 1',
                    selected: false,
                },
                {
                    conceptId: 'c2',
                    categoryId: 'cat2',
                    label: 'C2',
                    name: 'Concept Two',
                    group: 'Category 2',
                    selected: false,
                },
            ],
        }),
        describeConcept: vi.fn().mockReturnValue({
            lines: ['Cat1: Concept One', 'Description: Def c1'],
        }),
    } as unknown as SchemeEngineAdapter;
}

const toCtx = (eng: unknown) => Context.fromSchemeEngine(eng as never);
describe('ComponentBase', () => {
    let container: HTMLDivElement;
    let engine: SchemeEngineAdapter;
    let component: TestComponent;

    beforeEach(async () => {
        container = document.createElement('div');
        document.body.appendChild(container);
        engine = createMockEngine();
        component = new TestComponent();
        await component.init(container, toCtx(engine));
    });

    afterEach(() => {
        component.destroy();
        container.remove();
    });

    it('addAssertion creates a new assertion and reprocesses', () => {
        component.doAddAssertion('c1', 'cat1');
        expect(engine.process).toHaveBeenCalled();
        expect(
            component.getAssertions().some((a) => a.conceptId === 'c1'),
        ).toBe(true);
    });

    it('addAssertion does not add duplicates', () => {
        component.doAddAssertion('c2', 'cat2');
        const countBefore = component.getAssertions().length;
        component.doAddAssertion('c2', 'cat2');
        expect(component.getAssertions().length).toBe(countBefore);
    });

    it('addAssertion for single-select replaces existing concept in that category', () => {
        component.doAddAssertion('c1', 'cat1');
        // cat1 is single:true, adding another concept should replace
        const engineFn = engine.process as ReturnType<typeof vi.fn>;
        engineFn.mockImplementation((_input: string, opts?: any) => {
            const assertions: Assertion[] = opts?.assertions ?? [];
            return {
                assertions,
                rendered: assertions
                    .map((a: Assertion) => a.conceptId)
                    .join(', '),
                valid: true,
            };
        });
        component.doAddAssertion('c3', 'cat1');
        // The last process call should not include c1 in assertions
        const lastCall = engineFn.mock.calls[engineFn.mock.calls.length - 1];
        const passedAssertions = lastCall[1]?.assertions ?? [];
        const hasC1 = passedAssertions.some(
            (a: Assertion) => a.conceptId === 'c1',
        );
        expect(hasC1).toBe(false);
    });

    it('addAssertion upgrades inferred to explicit', () => {
        component.setAssertions([
            {
                conceptId: 'c2',
                categoryId: 'cat2',
                confidence: 'inferred',
                source: 'engine',
            },
        ]);
        component.doAddAssertion('c2', 'cat2');
        // Should reprocess (upgrade triggers reprocess)
        expect(engine.process).toHaveBeenCalled();
    });

    it('addAssertion supports insertIndex', () => {
        component.doAddAssertion('c2', 'cat2');
        component.doAddAssertion('c3', 'cat2');
        // Insert at index 0
        component.doAddAssertion('c1', 'cat1', undefined, 0);
        // We can't easily verify internal order, but the call should not throw
        expect(engine.process).toHaveBeenCalled();
    });

    it('removeAssertion removes by concept+category', () => {
        component.doAddAssertion('c2', 'cat2');
        component.doRemoveAssertion('c2', 'cat2');
        expect(engine.process).toHaveBeenCalled();
    });

    it('toggleSuggestion adds when not selected', () => {
        component.doToggleSuggestion({
            conceptId: 'c2',
            categoryId: 'cat2',
            selected: false,
        });
        expect(engine.process).toHaveBeenCalled();
    });

    it('toggleSuggestion removes explicit when selected', () => {
        component.doAddAssertion('c2', 'cat2');
        component.doToggleSuggestion({
            conceptId: 'c2',
            categoryId: 'cat2',
            selected: true,
        });
        expect(engine.process).toHaveBeenCalled();
    });

    it('reprocesses an alternate-scope field through the scoped engine pipeline', async () => {
        const scopedEngine = createMockEngine();
        (scopedEngine.process as ReturnType<typeof vi.fn>).mockImplementation(
            (_input: string, opts?: { assertions?: Assertion[] }) => ({
                assertions: opts?.assertions ?? [],
                rendered: 'ALTERNATE-DISPLAY',
                valid: false,
                errors: [
                    {
                        constraintId: 'scope-rule',
                        message: 'Selected concept is barred',
                    },
                ],
            }),
        );
        const scopedComponent = new TestComponent();
        const scopedContainer = document.createElement('div');
        document.body.appendChild(scopedContainer);
        await scopedComponent.init(scopedContainer, toCtx(scopedEngine), {
            scope: 'test-scope',
        });

        scopedComponent.doAddAssertion('c1', 'cat1');
        expect(scopedEngine.process).toHaveBeenCalledWith(
            '',
            expect.objectContaining({ surface: 'test-scope' }),
        );
        await vi.waitFor(() =>
            expect(scopedComponent.getRendered()).toBe('ALTERNATE-DISPLAY'),
        );
        expect(scopedContainer.parentNode?.textContent).toContain(
            'Selected concept is barred',
        );

        scopedComponent.destroy();
        scopedContainer.remove();
    });

    it('judges a facet with its parent marking and retains only its own category', async () => {
        const scopedEngine = createMockEngine();
        (scopedEngine.process as ReturnType<typeof vi.fn>).mockImplementation(
            (_input: string, opts?: { assertions?: Assertion[] }) => ({
                assertions: opts?.assertions ?? [],
                rendered: 'PARENT-RENDER',
                valid: true,
            }),
        );
        const sibling: Assertion = {
            conceptId: 'c2',
            categoryId: 'cat2',
            confidence: 'certain',
            source: 'user',
        };
        const facet = new TestComponent();
        const target = document.createElement('div');
        document.body.appendChild(target);
        await facet.init(target, toCtx(scopedEngine), {
            scope: 'alternate',
            categoryId: 'cat1',
            resolveFacetSiblings: () => [sibling],
        });
        facet.doAddAssertion('c1', 'cat1');
        await vi.waitFor(() => expect(facet.getAssertions()).toHaveLength(1));
        expect(scopedEngine.process).toHaveBeenCalledWith(
            '',
            expect.objectContaining({
                surface: 'alternate',
                assertions: expect.arrayContaining([
                    sibling,
                    expect.objectContaining({
                        conceptId: 'c1',
                        categoryId: 'cat1',
                    }),
                ]),
            }),
        );
        expect(facet.getAssertions()[0].categoryId).toBe('cat1');
        facet.destroy();
        target.remove();
    });

    it('preserves chosen parse provenance after settlement and on the next pass', async () => {
        const chosen: Assertion = {
            conceptId: 'c1',
            categoryId: 'cat1',
            source: 'parse',
            confidence: 'certain',
        };
        const chosenEngine = createMockEngine();
        vi.mocked(chosenEngine.process).mockImplementation(() => ({
            assertions: [
                {
                    ...chosen,
                    source: 'rule',
                    sourceRule: 'settlement',
                    metadata: { settled: true },
                },
            ],
            rendered: 'C1',
            valid: true,
            inputWasValid: true,
            errors: [],
            warnings: [],
            appliedFixes: [],
            proposedFixes: [],
            renders: {},
            notices: [],
            assessment: {
                emitted: [],
                omitted: [],
                collapsed: [],
                conflicts: [],
                unrepresentable: [],
            },
        }));
        const target = document.createElement('div');
        document.body.append(target);
        const chosenComponent = new TestComponent();
        await chosenComponent.init(target, toCtx(chosenEngine));
        chosenComponent.setAssertions([chosen]);
        const expected = { ...chosen, metadata: { settled: true } };
        expect(chosenComponent.getAssertions()[0]).toEqual(expected);
        chosenComponent.doReprocess();
        expect(chosenEngine.process).toHaveBeenLastCalledWith(
            '',
            expect.objectContaining({
                assertions: [expected],
            }),
        );
        chosenComponent.destroy();
        target.remove();
    });

    it.each(['user', 'parse'])(
        'keeps canonical %s values chosen on the next pass',
        async (source) => {
            const chosen: Assertion = {
                conceptId: 'c2',
                categoryId: 'cat2',
                value: 'compact',
                source,
                confidence: 'certain',
                metadata: { inputOnly: true },
            };
            const canonical: Assertion = {
                ...chosen,
                value: 'canonical',
                metadata: { canonicalOnly: true },
            };
            const chosenEngine = createMockEngine();
            vi.mocked(chosenEngine.process).mockReturnValue(
                mockProcessResult({
                    assertions: [canonical],
                    rendered: 'canonical',
                }),
            );
            const target = document.createElement('div');
            document.body.append(target);
            const valued = new TestComponent();
            await valued.init(target, toCtx(chosenEngine));
            valued.setAssertions([chosen]);
            expect(valued.getAssertions()).toEqual([canonical]);
            valued.doReprocess();
            expect(chosenEngine.process).toHaveBeenLastCalledWith(
                '',
                expect.objectContaining({ assertions: [canonical] }),
            );
            valued.destroy();
            target.remove();
        },
    );

    it.each(['infer', 'repair', 'default', 'context'])(
        'does not promote unmatched %s output to a user choice',
        async (source) => {
            const chosen: Assertion = {
                conceptId: 'c2',
                categoryId: 'cat2',
                value: 'alpha',
                source: 'user',
                confidence: 'certain',
            };
            const derived: Assertion = {
                ...chosen,
                value: 'beta',
                source,
                sourceRule: 'derived-value',
            };
            const derivedEngine = createMockEngine();
            vi.mocked(derivedEngine.process).mockReturnValue(
                mockProcessResult({
                    assertions: [chosen, derived],
                    rendered: 'alpha beta',
                }),
            );
            const target = document.createElement('div');
            document.body.append(target);
            const valued = new TestComponent();
            await valued.init(target, toCtx(derivedEngine));
            valued.setAssertions([chosen]);
            expect(valued.getAssertions()[1]).toEqual({
                ...derived,
                confidence:
                    source === 'default' || source === 'context'
                        ? 'certain'
                        : 'inferred',
            });
            valued.doReprocess();
            expect(derivedEngine.process).toHaveBeenLastCalledWith(
                '',
                expect.objectContaining({ assertions: [chosen] }),
            );
            valued.destroy();
            target.remove();
        },
    );

    it('does not claim an inferred value was authored because another value was', async () => {
        const valuedEngine = createMockEngine();
        (valuedEngine.process as ReturnType<typeof vi.fn>).mockImplementation(
            (_input: string, opts?: { assertions?: Assertion[] }) => {
                const author = opts?.assertions?.[0];
                return {
                    assertions: [
                        author,
                        {
                            ...author,
                            value: 'beta',
                            source: 'rule',
                            sourceRule: 'infer-beta',
                        },
                    ],
                    rendered: 'C2 alpha/C2 beta',
                    valid: true,
                };
            },
        );
        const valued = new TestComponent();
        const target = document.createElement('div');
        document.body.appendChild(target);
        await valued.init(target, toCtx(valuedEngine));
        valued.setAssertions([
            {
                conceptId: 'c2',
                categoryId: 'cat2',
                value: 'alpha',
                source: 'user',
                confidence: 'certain',
            },
        ]);
        expect(
            valued.getAssertions().map(({ value, source }) => [value, source]),
        ).toEqual([
            ['alpha', 'user'],
            ['beta', 'rule'],
        ]);
        valued.destroy();
        target.remove();
    });

    it('reprocess pinned to the scheme DEFAULT scope renders through the engine, not the conceptId join', async () => {
        // A component pinned to the scheme's default (whole-marking) scope IS the
        // whole marking, not an alternate-scope capture facet, so it must render
        // through the engine. Taking the alternate-scope shortcut here wrote the
        // conceptId join ("c1, c2") as both the committed value and the chip
        // position-search haystack, so the self-tag sidebar badge read that raw
        // join while chips whose whole-format label was absent from it were
        // suppressed (the post-Tab missing-chip repaint). Only genuine alternate
        // scopes (scope !== defaultScope) need that same engine call with their
        // own surface so the engine applies the scope's rules.
        const wholeEngine = createMockEngine();
        (wholeEngine as any).getSchemeMeta = () => ({
            id: 'test',
            version: '1.0',
            name: 'Test',
            defaultRenderFormat: 'default',
            defaultScope: 'whole',
            formats: [],
            scopes: [],
        });
        (wholeEngine as any).process = vi.fn((_input: string, opts?: any) => ({
            assertions: opts?.assertions ?? [],
            // A banner distinct from the conceptId join, so a shortcut and a real
            // engine render are unambiguously distinguishable.
            rendered: 'WHOLE//BANNER',
            valid: true,
        }));

        const wholeComponent = new TestComponent();
        const wholeContainer = document.createElement('div');
        document.body.appendChild(wholeContainer);
        await wholeComponent.init(wholeContainer, toCtx(wholeEngine), {
            scope: 'whole',
        });

        wholeComponent.doAddAssertion('c1', 'cat1');
        expect((wholeEngine as any).process).toHaveBeenCalled();
        expect(wholeComponent.getRendered()).toBe('WHOLE//BANNER');

        wholeComponent.destroy();
        wholeContainer.remove();
    });

    it('reprocess with empty assertions clears rendered', () => {
        component.setAssertions([]);
        expect(component.getRendered()).toBe('');
    });

    it('retains fixes for the corrected value but clears them when it is replaced', async () => {
        const fix = {
            ruleId: 'typed-rule',
            action: 'add',
            target: { conceptId: 'x', categoryId: 'cat2' },
            message: 'Added X',
        };
        const engineFn = engine.process as ReturnType<typeof vi.fn>;
        engineFn.mockReturnValue({
            assertions: [],
            rendered: 'corrected',
            valid: true,
            recognition: { status: 'complete' },
            appliedFixes: [fix],
            notices: [],
        });
        await component.setValue('typed');
        expect(component.getAppliedFixes()).toEqual([fix]);
        engineFn.mockReturnValue({
            assertions: [],
            rendered: 'corrected',
            valid: true,
            recognition: { status: 'complete' },
            appliedFixes: [],
            notices: [],
        });
        await component.setValue('corrected');
        expect(component.getAppliedFixes()).toEqual([fix]);
        engineFn.mockReturnValue({
            assertions: [],
            rendered: 'different marking',
            valid: true,
            recognition: { status: 'complete' },
            appliedFixes: [],
            notices: [],
        });
        await component.setValue('different marking');
        expect(component.getAppliedFixes()).toEqual([]);
        await component.setValue('');
        expect(component.getAppliedFixes()).toEqual([]);
    });

    describe('an edit that drops a stated concept', () => {
        const fixA = {
            ruleId: 'rule-a',
            action: 'add' as const,
            target: { conceptId: 'x', categoryId: 'cat2' },
            message: 'Added X',
        };
        const fixB = {
            ruleId: 'rule-b',
            action: 'add' as const,
            target: { conceptId: 'y', categoryId: 'cat2' },
            message: 'Added Y',
        };

        /** The engine applies these fixes to whatever it is asked to read. */
        function applying(...fixes: (typeof fixA)[]): void {
            (engine.process as ReturnType<typeof vi.fn>).mockImplementation(
                (_input: string, opts?: any) => ({
                    assertions: opts?.assertions ?? [],
                    rendered: 'test',
                    valid: true,
                    appliedFixes: fixes,
                    notices: [],
                }),
            );
        }

        beforeEach(() => {
            applying(fixA, fixB);
            component.doAddAssertion('c1', 'cat1');
            component.doAddAssertion('c2', 'cat2');
            expect(component.getAppliedFixes()).toEqual([fixA, fixB]);
        });

        it('a removal starts the fix record over, and the re-check records what still applies', () => {
            applying(fixB);
            component.doRemoveAssertion('c2', 'cat2');
            expect(component.getAppliedFixes()).toEqual([fixB]);
        });

        it('removing a concept the field does not state keeps the record', () => {
            applying();
            component.doRemoveAssertion('c3', 'cat2');
            expect(component.getAppliedFixes()).toEqual([fixA, fixB]);
        });

        it('a pressed fix that drops a stated concept starts the record over', () => {
            applying(fixB);
            component.doApplyRuleFix({
                message: 'Remove C2',
                rendered: 'C1',
                keeps: [{ conceptId: 'c1', categoryId: 'cat1' }],
                adds: [],
                removes: [{ conceptId: 'c2', categoryId: 'cat2' }],
            });
            expect(component.getAppliedFixes()).toEqual([fixB]);
        });

        it('a pressed fix that only adds keeps the record', () => {
            applying();
            component.doApplyRuleFix({
                message: 'Add C3',
                rendered: 'C1/C2/C3',
                keeps: [
                    { conceptId: 'c1', categoryId: 'cat1' },
                    { conceptId: 'c2', categoryId: 'cat2' },
                ],
                adds: [{ conceptId: 'c3', categoryId: 'cat2' }],
                removes: [],
            });
            expect(component.getAppliedFixes()).toEqual([fixA, fixB]);
        });
    });

    it('getAppliedFixes returns empty array when the engine applied nothing', () => {
        expect(component.getAppliedFixes()).toEqual([]);
    });

    it('getAppliedFixes records each change the engine applied, once', () => {
        const engineFn = engine.process as ReturnType<typeof vi.fn>;
        const added = (conceptId: string) => ({
            ruleId: 'rule-1',
            action: 'add',
            add: [{ conceptId, categoryId: 'cat2' }],
            message: `Added ${conceptId} because of rule 1`,
        });
        engineFn.mockImplementation((_input: string, opts?: any) => ({
            assertions: opts?.assertions ?? [],
            rendered: 'test',
            valid: true,
            appliedFixes: [added('x'), added('y'), added('x')],
            notices: [],
        }));
        component.doAddAssertion('c1', 'cat1');
        // One rule that added two concepts made two changes; the same change
        // reported again is still one.
        expect(component.getAppliedFixes().map((f) => f.message)).toEqual([
            'Added x because of rule 1',
            'Added y because of rule 1',
        ]);
    });

    it('applied fixes persist across a later no-fix reprocess and clear when emptied', () => {
        const engineFn = engine.process as ReturnType<typeof vi.fn>;
        engineFn.mockImplementation((_input: string, opts?: any) => ({
            assertions: opts?.assertions ?? [],
            rendered: 'test',
            valid: true,
            appliedFixes: [
                {
                    ruleId: 'rule-1',
                    action: 'add',
                    target: { conceptId: 'x', categoryId: 'cat2' },
                    message: 'Added X',
                },
            ],
            notices: [],
        }));
        component.doAddAssertion('c1', 'cat1');
        expect(component.getAppliedFixes()).toHaveLength(1);

        // Later reprocess with no fixes: the state persists (the mark
        // communicates state, not last-call activity).
        engineFn.mockImplementation((_input: string, opts?: any) => ({
            assertions: opts?.assertions ?? [],
            rendered: 'test2',
            valid: true,
            appliedFixes: [],
            notices: [],
        }));
        component.doAddAssertion('c2', 'cat1');
        expect(component.getAppliedFixes()).toHaveLength(1);

        // Emptying the field returns it to the starless enhanced state.
        component.setAssertions([]);
        expect(component.getAppliedFixes()).toEqual([]);
    });

    it('getSuggestions calls engine.suggest', async () => {
        const suggestions = await component.doGetSuggestions();
        expect(engine.suggest).toHaveBeenCalled();
        expect(suggestions).toHaveLength(2);
    });

    it('getSuggestions filters out inferred assertions', async () => {
        // Manually set assertions with inferred confidence by overriding engine.process
        const engineFn = engine.process as ReturnType<typeof vi.fn>;
        engineFn.mockImplementation((_input: string, opts?: any) => {
            const assertions: Assertion[] = opts?.assertions ?? [];
            return {
                assertions: [
                    ...assertions,
                    {
                        conceptId: 'c1',
                        categoryId: 'cat1',
                        confidence: 'inferred',
                        source: 'engine',
                    },
                ],
                rendered: 'test',
                valid: true,
            };
        });
        // Trigger reprocess to get an inferred assertion
        component.doAddAssertion('c2', 'cat2');
        const suggestions = await component.doGetSuggestions();
        expect(suggestions.find((s) => s.conceptId === 'c1')).toBeUndefined();
    });

    it('fuzzyMatch returns 100 for exact match', () => {
        expect(component.doFuzzyMatch('hello', 'hello')).toBe(100);
    });

    it('fuzzyMatch returns 90 for prefix match', () => {
        expect(component.doFuzzyMatch('hel', 'hello')).toBe(90);
    });

    it('fuzzyMatch returns 70 for substring match', () => {
        expect(component.doFuzzyMatch('llo', 'hello')).toBe(70);
    });

    it('fuzzyMatch returns 0 for no match', () => {
        expect(component.doFuzzyMatch('xyz', 'hello')).toBe(0);
    });

    it('fuzzyMatch returns 1 for empty query', () => {
        expect(component.doFuzzyMatch('', 'hello')).toBe(1);
    });

    it('fuzzyMatch accepts a tight subsequence below the substring level', () => {
        // "schl" -> "SCHOOL": dropped letters, but the matched run stays close to
        // the query length, so it is a real abbreviation match.
        const score = component.doFuzzyMatch('schl', 'SCHOOL');
        expect(score).toBeGreaterThan(0);
        expect(score).toBeLessThan(70);
    });

    it('fuzzyMatch rejects a scattered subsequence spread across a long label', () => {
        // The confirmed defect: "arch" matched "Makeup Day Reschedule" by scattering
        // its letters, flooding the list with noise. The span bound drops it.
        expect(component.doFuzzyMatch('arch', 'Makeup Day Reschedule')).toBe(0);
    });

    it('fuzzyMatch ranks a substring hit above a subsequence hit', () => {
        const substring = component.doFuzzyMatch('read', 'READING');
        const subsequence = component.doFuzzyMatch('schl', 'SCHOOL');
        expect(substring).toBeGreaterThan(subsequence);
    });

    it('darken reduces color brightness', () => {
        const result = component.doDarken('#ffffff', 0.5);
        expect(result).toBe('#808080');
    });

    it('disambiguateSuggestions appends parent label for duplicates', () => {
        const suggestions: Suggestion[] = [
            {
                conceptId: 'c2',
                categoryId: 'cat2',
                label: 'Same',
                name: 'C2',
                group: 'Group',
                selected: false,
            },
            {
                conceptId: 'c3',
                categoryId: 'cat2',
                label: 'Same',
                name: 'C3',
                group: 'Group',
                selected: false,
            },
        ] as Suggestion[];

        const result = component.doDisambiguateSuggestions(suggestions);
        // c2 has parent c1, so it should get disambiguated
        expect(result[0].label).toBe('Same (C1)');
        // c3 has no parents, so it keeps original label
        expect(result[1].label).toBe('Same');
    });

    it('looks up duplicate suggestion parents in one concept pass', () => {
        const concepts = engine.getScheme().concepts;
        const find = vi.spyOn(concepts, 'find');
        const suggestions = Array.from({ length: 128 }, (_, index) => ({
            conceptId: index % 2 === 0 ? 'c2' : 'c3',
            categoryId: 'cat2',
            label: 'Same',
            name: 'Same',
            group: 'Group',
            selected: false,
        })) as Suggestion[];

        const result = component.doDisambiguateSuggestions(suggestions);

        expect(result).toHaveLength(128);
        expect(result[0].label).toBe('Same (C1)');
        expect(result[1].label).toBe('Same');
        expect(find.mock.calls.length).toBeLessThan(4);
    });

    it('keeps distinct group and label pairs separate when they contain delimiters', () => {
        const suggestions = [
            {
                conceptId: 'c2',
                categoryId: 'cat2',
                group: 'A::B',
                label: 'C',
                name: 'C2',
                selected: false,
            },
            {
                conceptId: 'c3',
                categoryId: 'cat2',
                group: 'A',
                label: 'B::C',
                name: 'C3',
                selected: false,
            },
        ] as Suggestion[];

        expect(
            component
                .doDisambiguateSuggestions(suggestions)
                .map((s) => s.label),
        ).toEqual(['C', 'B::C']);
    });

    it('attachConceptTooltip does not throw', () => {
        const el = document.createElement('span');
        container.appendChild(el);
        expect(() =>
            component.doAttachConceptTooltip(el, 'c1', 'cat1'),
        ).not.toThrow();
    });

    it('setAssertions calls reprocess instead of render', () => {
        component.renderCount = 0;
        component.setAssertions([
            {
                conceptId: 'c1',
                categoryId: 'cat1',
                confidence: 'certain',
                source: 'user',
            },
        ]);
        expect(engine.process).toHaveBeenCalled();
    });
});
