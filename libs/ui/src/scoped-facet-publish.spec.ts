/**
 * Scoped assertions survive a whole marking's commit.
 *
 * A whole marking's banner render format binds no field to an alternate-scope
 * category. If `publishAssertions` rendered the full incoming set through that
 * banner format and re-parsed the result, a scope-attributed assertion
 * (rendered to nothing) would be silently discarded from the whole's committed
 * state, making scope-mapped UI unusable.
 *
 * The multi-scope regression fixture provides the engine: its default `marking`
 * scope drives the banner, and an `office_record` scope carries scope-only
 * categories (`comes_from`, …) that the `long` banner format omits. This is the
 * same shape as a scope-only category block.
 *
 * The failing path this pins: an `office_record`-scoped `comes_from` facet edit
 * must land as a scoped assertion on the whole and survive a subsequent
 * default-scope part edit (`level`) + the rollup that follows. Before the store
 * fix this test fails (the scoped assertion is gone after the first commit);
 * after, it passes.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { loadMultiScopeRegression } from '../test-fixtures/load-multi-scope-regression';
import { EzClassifyUI } from './ezclassify-ui';
import type { SingleSelect } from './components/single-select';

const SCOPED_FACET_HTML = `
  <input type="hidden" id="doc-marking" data-ezclassify-rendered />
  <input id="level" data-ezclassify-controller="select"
         data-ezclassify-facet-of="doc-marking"
         data-ezclassify-category="level" />
  <input id="source-policy" data-ezclassify-controller="select"
         data-ezclassify-facet-of="doc-marking"
         data-ezclassify-scope="office_record"
         data-ezclassify-category="comes_from" />
`;

async function flush(): Promise<void> {
    for (let i = 0; i < 8; i++) await Promise.resolve();
}

/** Let a deferred engine's round trips land, several times over. */
async function settle(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 60));
}

/**
 * Wrap an engine so the operations the store and the components await resolve
 * after a delay instead of in process, the way a REST client does. The
 * synchronous introspection members stay synchronous, which is what the remote
 * adapter narrowing does as well.
 *
 * @param engine - The in-process engine to wrap.
 * @param delayMs - How long each operation takes to answer.
 * @returns An engine of the same shape whose operations answer late.
 */
function answersLate<T extends object>(engine: T, delayMs: number): T {
    const DEFERRED = new Set([
        'process',
        'render',
        'suggest',
        'suggestForCategories',
        'aggregate',
        'aggregateAssertions',
        'checkCoverage',
        'normalize',
        'validate',
        'notices',
    ]);
    return new Proxy(engine, {
        get(target, property, receiver) {
            const value = Reflect.get(target, property, receiver);
            if (typeof value !== 'function' || !DEFERRED.has(String(property)))
                return value;
            return (...args: unknown[]) =>
                new Promise((resolve, reject) => {
                    setTimeout(() => {
                        try {
                            resolve(
                                (value as (...a: unknown[]) => unknown).apply(
                                    target,
                                    args,
                                ),
                            );
                        } catch (error) {
                            reject(error);
                        }
                    }, delayMs);
                });
        },
    });
}

describe('EzClassifyUI: scoped facet edit survives on the whole', () => {
    let root: HTMLDivElement;
    let forms: EzClassifyUI | null;

    beforeEach(() => {
        document.body.innerHTML = '';
        root = document.createElement('div');
        root.innerHTML = SCOPED_FACET_HTML;
        document.body.appendChild(root);
        forms = null;
    });

    afterEach(() => {
        forms?.destroy();
        document.body.innerHTML = '';
    });

    /**
     * Resolve a facet-of SingleSelect from the runtime's internal component
     * map.
     */
    function selectFor(id: string): SingleSelect {
        const el = root.querySelector<HTMLElement>(`#${id}`)!;
        const components = (
            forms as unknown as { components: Map<HTMLElement, SingleSelect> }
        ).components;
        const select = components.get(el);
        expect(select).toBeDefined();
        return select!;
    }

    it('an office_record-scope comes_from pick lands on the whole and survives a later level edit + rollup', async () => {
        forms = new EzClassifyUI(loadMultiScopeRegression(), { root });
        await flush();

        // 1. Pick an office_record-scope comes_from on the whole. This publishes
        //    through the facet path (publishAssertions on doc-marking). The banner
        //    render format omits comes_from, so the old round-trip dropped it.
        selectFor('source-policy').setAssertions([
            {
                conceptId: 'NEW_ITEM',
                categoryId: 'comes_from',
                confidence: 'certain',
                source: 'user',
            },
        ]);
        await flush();

        const afterScoped = forms.store.get('doc-marking');
        expect(
            afterScoped.assertions.some(
                (a) =>
                    a.categoryId === 'comes_from' && a.conceptId === 'NEW_ITEM',
            ),
        ).toBe(true);

        // 2. Now edit a default-scope part (level). This re-publishes the whole,
        //    carrying the committed assertions back through the round-trip and
        //    then recomputing the whole rollup. The scoped assertion must not be
        //    shed by either step.
        selectFor('level').setAssertions([
            {
                conceptId: 'DISTRICT_COORDINATORS',
                categoryId: 'level',
                confidence: 'certain',
                source: 'user',
            },
        ]);
        await flush();

        const merged = forms.store.get('doc-marking');
        // Default-scope level landed and renders in the banner.
        expect(
            merged.assertions.some(
                (a) =>
                    a.categoryId === 'level' &&
                    a.conceptId === 'DISTRICT_COORDINATORS',
            ),
        ).toBe(true);
        expect(merged.rendered).toContain('DISTRICT COORDINATORS');
        // Scoped comes_from survived the level edit + rollup.
        expect(
            merged.assertions.some(
                (a) =>
                    a.categoryId === 'comes_from' && a.conceptId === 'NEW_ITEM',
            ),
        ).toBe(true);
        // And the banner render never carried the scoped category (its
        // repair/inference semantics are untouched by the scoped assertion).
        expect(merged.rendered).not.toContain('DONATION');
    });

    /**
     * The contract question a consumer asks: is a document-level
     * `store.subscribe(id)` the right place to watch a scoped control, or does
     * a scoped facet publish on some axis a whole-marking subscriber cannot
     * see?
     *
     * It is the right place, and these pin it. A scoped control publishes onto
     * the named marking's own committed state, so it reaches exactly the
     * subscribers of that marking, in the same notification as any
     * default-scope edit. There is no second subscription, no per-scope
     * channel, and `subscribeFacet` is the narrower view for one category, not
     * the way to see a scoped edit on the whole.
     */
    describe('a document-level subscriber sees scoped assertions', () => {
        it('delivers a scoped facet edit to store.subscribe(markingId)', async () => {
            forms = new EzClassifyUI(loadMultiScopeRegression(), { root });
            await flush();

            const seen: string[][] = [];
            const unsubscribe = forms.store.subscribe(
                'doc-marking',
                (state) => {
                    seen.push(state.assertions.map((a) => a.categoryId));
                },
            );

            selectFor('source-policy').setAssertions([
                {
                    conceptId: 'NEW_ITEM',
                    categoryId: 'comes_from',
                    confidence: 'certain',
                    source: 'user',
                },
            ]);
            await flush();
            unsubscribe();

            // The subscriber was notified, and the state it was handed carries
            // the scoped category. A consumer reading `state.assertions` off
            // this callback needs nothing else.
            expect(seen.length).toBeGreaterThan(0);
            expect(seen[seen.length - 1]).toContain('comes_from');
        });

        it('delivers it the same way when the engine answers late', async () => {
            // The whole point of the both-modes rule: a REST-backed page has to
            // see the identical notification, one round trip later. Deferring
            // only the operations the store awaits leaves the synchronous
            // introspection members alone, which is what the remote adapter
            // narrowing does too.
            forms = new EzClassifyUI(
                answersLate(loadMultiScopeRegression(), 5) as never,
                {
                    root,
                },
            );
            await settle();

            const seen: string[][] = [];
            const unsubscribe = forms.store.subscribe(
                'doc-marking',
                (state) => {
                    seen.push(state.assertions.map((a) => a.categoryId));
                },
            );

            selectFor('source-policy').setAssertions([
                {
                    conceptId: 'NEW_ITEM',
                    categoryId: 'comes_from',
                    confidence: 'certain',
                    source: 'user',
                },
            ]);
            await settle();
            unsubscribe();

            expect(seen.length).toBeGreaterThan(0);
            expect(seen[seen.length - 1]).toContain('comes_from');
        });
    });

    /**
     * The other half of the contract, and the half that cost a day: routing is
     * the scheme's answer, not the attribute's. `data-ezclassify-scope` says
     * what the author meant; `listCategories()[].scopes` and
     * `getSchemeMeta().defaultScope` are what the store actually routes on. If
     * those disagree the assertions go through the whole-marking render format,
     * which excludes the category, and they vanish before any subscriber runs.
     */
    describe('a control whose declared scope the scheme does not agree with', () => {
        /** Serve the multi-scope fixture with every category's scopes stripped. */
        function withoutCategoryScopes(
            engine: ReturnType<typeof loadMultiScopeRegression>,
        ) {
            return new Proxy(engine, {
                get(target, property, receiver) {
                    if (property === 'listCategories') {
                        return () =>
                            target
                                .listCategories()
                                .map(({ scopes: _scopes, ...rest }) => rest);
                    }
                    return Reflect.get(target, property, receiver);
                },
            });
        }

        it('says so, naming the category and what the scheme reports instead', async () => {
            const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

            forms = new EzClassifyUI(
                withoutCategoryScopes(loadMultiScopeRegression()) as never,
                { root },
            );
            await flush();

            const advisory = warn.mock.calls
                .map((call) => String(call[0]))
                .find((message) => message.includes('data-ezclassify-scope'));
            expect(advisory).toBeDefined();
            expect(advisory).toContain('office_record');
            expect(advisory).toContain('comes_from');
            warn.mockRestore();
        });

        it('stays quiet when the scheme agrees with the control', async () => {
            const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

            forms = new EzClassifyUI(loadMultiScopeRegression(), { root });
            await flush();

            expect(
                warn.mock.calls
                    .map((call) => String(call[0]))
                    .filter((message) =>
                        message.includes('data-ezclassify-scope'),
                    ),
            ).toEqual([]);
            warn.mockRestore();
        });
    });
});
