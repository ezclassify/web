/**
 * Verifies that facet pickers (SingleSelect, CategorySelector,
 * CategoryChecklist, DecisionFlow) hide currently-unallowable concepts based on
 * the store's facet subscription, which runs engine.suggest() once per marking
 * change and pushes per-category results to subscribed components.
 *
 * The first three pickers (SingleSelect, CategorySelector, CategoryChecklist)
 * do not call suggest themselves; they receive allowable options via
 * applyAllowableOptions() called by the store's facet subscription.
 * DecisionFlow requests its own options when the author enters a step.
 *
 * Uses the multi-scope fixture engine, which keeps school choices out of
 * suggestions until an audience level has been selected.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadMultiScopeRegression } from '../../test-fixtures/load-multi-scope-regression';
import { SingleSelect } from './single-select';
import { CategorySelector } from './category-selector';
import { CategoryChecklist } from './category-checklist';
import { DecisionFlow } from './decision-flow';
import { Context } from '@ezclassify/engine';

const toCtx = (eng: unknown) => Context.fromSchemeEngine(eng as never);
import {
    VanillaEzClassifyStore,
    type EzClassifyStoreEngine,
    type FacetState,
} from '../store/ezclassify-store';
import type { SchemeEngineAdapter } from '@ezclassify/types';

/**
 * Flush enough microtasks for the store's refreshFacets chain to settle.
 * publishAssertions awaits render + process (~2 ticks), then commit fires
 * refreshFacets (await suggest, ~1 tick). Four rounds covers all paths.
 */
async function flushFacets(): Promise<void> {
    for (let i = 0; i < 6; i++) await Promise.resolve();
}

describe('store-driven suggest filtering (facet subscription)', () => {
    let engine: SchemeEngineAdapter;
    let store: VanillaEzClassifyStore;
    let container: HTMLDivElement;

    beforeEach(() => {
        engine = loadMultiScopeRegression();
        store = new VanillaEzClassifyStore(
            engine as unknown as EzClassifyStoreEngine,
        );
        container = document.createElement('div');
        document.body.appendChild(container);
    });

    afterEach(() => {
        store.destroy();
        container.remove();
    });

    function noLevelAssertions() {
        return [];
    }

    function stateAssessmentStaffAssertions() {
        return [
            {
                conceptId: 'STATE_ASSESSMENT_STAFF',
                categoryId: 'level',
                confidence: 'certain' as const,
                source: 'user' as const,
            },
        ];
    }

    describe('SingleSelect (from_school)', () => {
        it('hides school choices when no level is selected', async () => {
            const component = new SingleSelect();
            await component.init(container, toCtx(engine), {
                categoryId: 'from_school',
                mode: 'cards',
            });

            const unsub = store.subscribeFacet(
                'doc',
                'from_school',
                (state) => {
                    component.applyAllowableOptions(state.allowableOptions);
                },
            );

            await store.publishAssertions('doc', noLevelAssertions());
            await flushFacets();

            const cardLabels = Array.from(
                container.querySelectorAll('.select-card .select-card-label'),
            ).map((el) => el.textContent);
            expect(
                cardLabels.some(
                    (l) =>
                        l?.includes('OAKWOOD') ||
                        l?.includes('RIVERSIDE') ||
                        l?.includes('LINCOLN'),
                ),
            ).toBe(false);

            unsub();
        });

        it('shows school choices after level becomes STATE_ASSESSMENT_STAFF', async () => {
            const component = new SingleSelect();
            await component.init(container, toCtx(engine), {
                categoryId: 'from_school',
                mode: 'cards',
            });

            const unsub = store.subscribeFacet(
                'doc',
                'from_school',
                (state) => {
                    component.applyAllowableOptions(state.allowableOptions);
                },
            );

            await store.publishAssertions('doc', noLevelAssertions());
            await flushFacets();

            await store.publishAssertions(
                'doc',
                stateAssessmentStaffAssertions(),
            );
            await flushFacets();

            const cardLabels = Array.from(
                container.querySelectorAll('.select-card .select-card-label'),
            ).map((el) => el.textContent);
            expect(
                cardLabels.some(
                    (l) =>
                        l?.includes('OAKWOOD') ||
                        l?.includes('RIVERSIDE') ||
                        l?.includes('LINCOLN'),
                ),
            ).toBe(true);

            unsub();
        });
    });

    describe('CategorySelector (from_school)', () => {
        it('hides school choices when no level is selected', async () => {
            const component = new CategorySelector();
            await component.init(container, toCtx(engine), {
                categoryId: 'from_school',
            });

            const unsub = store.subscribeFacet(
                'doc',
                'from_school',
                (state) => {
                    component.applyAllowableOptions(state.allowableOptions);
                },
            );

            await store.publishAssertions('doc', noLevelAssertions());
            await flushFacets();

            const btnLabels = Array.from(
                container.querySelectorAll('.category-selector-btn span'),
            ).map((el) => el.textContent);
            expect(
                btnLabels.some(
                    (l) =>
                        l?.includes('OAKWOOD') ||
                        l?.includes('RIVERSIDE') ||
                        l?.includes('LINCOLN'),
                ),
            ).toBe(false);

            unsub();
        });

        it('shows school choices after level becomes STATE_ASSESSMENT_STAFF', async () => {
            const component = new CategorySelector();
            await component.init(container, toCtx(engine), {
                categoryId: 'from_school',
            });

            const unsub = store.subscribeFacet(
                'doc',
                'from_school',
                (state) => {
                    component.applyAllowableOptions(state.allowableOptions);
                },
            );

            await store.publishAssertions(
                'doc',
                stateAssessmentStaffAssertions(),
            );
            await flushFacets();

            const btnLabels = Array.from(
                container.querySelectorAll('.category-selector-btn span'),
            ).map((el) => el.textContent);
            expect(
                btnLabels.some(
                    (l) =>
                        l?.includes('OAKWOOD') ||
                        l?.includes('RIVERSIDE') ||
                        l?.includes('LINCOLN'),
                ),
            ).toBe(true);

            unsub();
        });
    });

    describe('CategoryChecklist (from_school)', () => {
        it('hides school choices when no level is selected', async () => {
            const component = new CategoryChecklist();
            await component.init(container, toCtx(engine), {
                categoryId: 'from_school',
            } as any);

            const unsub = store.subscribeFacet(
                'doc',
                'from_school',
                (state) => {
                    component.applyAllowableOptions(state.allowableOptions);
                },
            );

            await store.publishAssertions('doc', noLevelAssertions());
            await flushFacets();

            const labels = Array.from(
                container.querySelectorAll('.category-checklist-label'),
            ).map((el) => el.textContent);
            expect(
                labels.some(
                    (l) =>
                        l?.includes('OAKWOOD') ||
                        l?.includes('RIVERSIDE') ||
                        l?.includes('LINCOLN'),
                ),
            ).toBe(false);

            unsub();
        });

        it('shows school choices after level becomes STATE_ASSESSMENT_STAFF', async () => {
            const component = new CategoryChecklist();
            await component.init(container, toCtx(engine), {
                categoryId: 'from_school',
            } as any);

            const unsub = store.subscribeFacet(
                'doc',
                'from_school',
                (state) => {
                    component.applyAllowableOptions(state.allowableOptions);
                },
            );

            await store.publishAssertions(
                'doc',
                stateAssessmentStaffAssertions(),
            );
            await flushFacets();

            const labels = Array.from(
                container.querySelectorAll('.category-checklist-label'),
            ).map((el) => el.textContent);
            expect(
                labels.some(
                    (l) =>
                        l?.includes('OAKWOOD') ||
                        l?.includes('RIVERSIDE') ||
                        l?.includes('LINCOLN'),
                ),
            ).toBe(true);

            unsub();
        });
    });

    describe('single-select facet switchability: own-category exclusion', () => {
        it('from_school with RIVERSIDE selected still offers all other branches', async () => {
            // Regression: the old refreshFacets ran ONE suggest call with the full assertions.
            // For from_school (single-select), passing RIVERSIDE as context would tell the
            // engine the category was "done", so suggest would return only RIVERSIDE and make
            // it impossible to switch. The per-category suggest call excludes that category's
            // own assertions.
            let lastState: FacetState | null = null;
            const unsub = store.subscribeFacet(
                'doc',
                'from_school',
                (state) => {
                    lastState = state;
                },
            );

            await store.publishAssertions('doc', [
                {
                    conceptId: 'STUDENTS',
                    categoryId: 'level',
                    confidence: 'certain' as const,
                    source: 'user' as const,
                },
                {
                    conceptId: 'RIVERSIDE',
                    categoryId: 'from_school',
                    confidence: 'certain' as const,
                    source: 'user' as const,
                },
            ]);
            await flushFacets();

            expect(lastState).not.toBeNull();
            const optionIds =
                lastState!.allowableOptions?.map((s) => s.conceptId) ?? [];
            // Must include the selected branch AND the others (user can switch)
            expect(optionIds).toContain('RIVERSIDE');
            expect(optionIds).toContain('OAKWOOD');
            expect(optionIds).toContain('OUR_SCHOOL');
            expect(optionIds.length).toBeGreaterThan(1);

            unsub();
        });

        it('level with STATE_ASSESSMENT_STAFF selected still offers the other tiers', async () => {
            let lastState: FacetState | null = null;
            const unsub = store.subscribeFacet('doc', 'level', (state) => {
                lastState = state;
            });

            await store.publishAssertions('doc', [
                {
                    conceptId: 'STATE_ASSESSMENT_STAFF',
                    categoryId: 'level',
                    confidence: 'certain' as const,
                    source: 'user' as const,
                },
            ]);
            await flushFacets();

            expect(lastState).not.toBeNull();
            const optionIds =
                lastState!.allowableOptions?.map((s) => s.conceptId) ?? [];
            expect(optionIds).toContain('STATE_ASSESSMENT_STAFF');
            expect(optionIds).toContain('STUDENTS');
            expect(optionIds).toContain('SCHOOL_STAFF');
            expect(optionIds.length).toBeGreaterThan(1);

            unsub();
        });

        it('cross-category gating preserved: from_school hidden without a level', async () => {
            // Verifies the per-category exclusion does NOT break cross-category gating.
            // from_school suggest excludes from_school assertions from context,
            // and still respects the missing level prerequisite.
            let sectionState: FacetState | null = null;
            const unsub = store.subscribeFacet(
                'doc',
                'from_school',
                (state) => {
                    sectionState = state;
                },
            );

            await store.publishAssertions('doc', noLevelAssertions());
            await flushFacets();

            expect(sectionState).not.toBeNull();
            const optionIds =
                sectionState!.allowableOptions?.map((s) => s.conceptId) ?? [];
            expect(
                optionIds.some((id) =>
                    ['OAKWOOD', 'HILLTOP', 'LINCOLN', 'OUR_SCHOOL'].includes(
                        id,
                    ),
                ),
            ).toBe(false);

            unsub();
        });
    });

    // DecisionFlow requests its own options when the author enters a step.
    describe('DecisionFlow (from_school step): self-suggest path', () => {
        it('hides school choices on the school step without a level', async () => {
            const component = new DecisionFlow();
            await component.init(container, toCtx(engine), {
                categoryOrder: ['from_school'],
            } as any);
            component.setAssertions(noLevelAssertions());
            container
                .querySelector<HTMLButtonElement>('.ez-decision-flow__option')
                ?.focus();
            await new Promise((resolve) => setTimeout(resolve, 0));

            const optionNames = Array.from(
                container.querySelectorAll('.ez-decision-flow__option'),
            ).map((el) => el.textContent);
            expect(
                optionNames.some(
                    (n) =>
                        n?.includes('OAKWOOD') ||
                        n?.includes('RIVERSIDE') ||
                        n?.includes('LINCOLN'),
                ),
            ).toBe(false);
        });

        it('shows school choices on the school step after level becomes STATE_ASSESSMENT_STAFF', async () => {
            const component = new DecisionFlow();
            await component.init(container, toCtx(engine), {
                categoryOrder: ['from_school'],
            } as any);
            component.setAssertions(stateAssessmentStaffAssertions());
            container
                .querySelector<HTMLButtonElement>('.ez-decision-flow__option')
                ?.focus();
            await new Promise((resolve) => setTimeout(resolve, 0));

            const optionNames = Array.from(
                container.querySelectorAll('.ez-decision-flow__option'),
            ).map((el) => el.textContent);
            expect(
                optionNames.some(
                    (n) =>
                        n?.includes('OAKWOOD') ||
                        n?.includes('RIVERSIDE') ||
                        n?.includes('LINCOLN'),
                ),
            ).toBe(true);
        });
    });
});
