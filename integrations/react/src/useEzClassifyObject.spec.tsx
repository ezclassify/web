import { describe, it, expect, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import {
    VanillaEzClassifyStore,
    type EzClassifyStoreEngine,
    type EzClassifyStoreProcessResult,
} from '@ezclassify/ui';
import type { Assertion, RenderAssessment } from '@ezclassify/types';
import { useEzClassifyObject } from './useEzClassifyObject';

/** What a write that wrote everything it was given reports. */
const EMPTY_RENDER_ASSESSMENT: RenderAssessment = {
    emitted: [],
    omitted: [],
    collapsed: [],
    conflicts: [],
    unrepresentable: [],
};

function passThroughEngine(): EzClassifyStoreEngine {
    return {
        process(input): EzClassifyStoreProcessResult {
            const rendered =
                typeof input === 'string'
                    ? input
                    : (input as Assertion[])
                          .map((a) => `${a.categoryId}:${a.conceptId}`)
                          .join(' ');
            const assertions: Assertion[] = [];
            if (typeof input === 'string' && input.includes(':')) {
                for (const part of input.split(/\s+/)) {
                    const [categoryId, conceptId] = part.split(':');
                    if (categoryId && conceptId)
                        assertions.push({ categoryId, conceptId } as Assertion);
                }
            } else if (Array.isArray(input)) {
                for (const a of input) assertions.push(a);
            }
            return {
                rendered,
                assessment: EMPTY_RENDER_ASSESSMENT,
                renders: {},
                assertions,
                valid: true,
                errors: [],
            };
        },
        render(assertions) {
            return (assertions as Assertion[])
                .map((a) => `${a.categoryId}:${a.conceptId}`)
                .join(' ');
        },
        aggregateAssertions: (sets: Assertion[][]) => {
            const merged = sets.flat();
            return {
                rendered: merged
                    .map((a) => `${a.categoryId}:${a.conceptId}`)
                    .join(' '),
                assertions: merged,
                valid: true,
                errors: [],
            };
        },
        aggregate: () => ({
            rendered: '',
            assertions: [],
            valid: true,
            errors: [],
        }),
        getSchemeMeta: () => ({ scopes: [] }),
        listCategories: () => [],
    };
}

async function flush(): Promise<void> {
    await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
    });
}

describe('useEzClassifyObject', () => {
    it('reflects store commits into the doc state', async () => {
        const store = new VanillaEzClassifyStore(passThroughEngine());
        const { result } = renderHook(() =>
            useEzClassifyObject(
                store,
                { classification: '' },
                { 'doc-marking': 'classification' },
            ),
        );
        await act(async () => {
            await store.publishRendered('doc-marking', 'tier:secret');
        });
        expect(result.current.doc.classification).toBe('tier:secret');
    });

    it('setDoc publishes changes to the store', async () => {
        const store = new VanillaEzClassifyStore(passThroughEngine());
        const { result } = renderHook(() =>
            useEzClassifyObject(
                store,
                { classification: '' },
                { 'doc-marking': 'classification' },
            ),
        );
        act(() => {
            result.current.setDoc({ classification: 'tier:top-secret' });
        });
        await flush();
        expect(store.get('doc-marking').rendered).toBe('tier:top-secret');
    });

    it('setPath writes to the doc and the store', async () => {
        const store = new VanillaEzClassifyStore(passThroughEngine());
        const { result } = renderHook(() =>
            useEzClassifyObject(
                store,
                { title: { classification: '' } },
                { 'title-marking': 'title.classification' },
            ),
        );
        act(() => {
            result.current.setPath('title.classification', 'tier:ts');
        });
        await flush();
        expect(result.current.doc.title.classification).toBe('tier:ts');
        expect(store.get('title-marking').rendered).toBe('tier:ts');
    });

    it('onChange fires with the diff shape', async () => {
        const store = new VanillaEzClassifyStore(passThroughEngine());
        const cb = vi.fn();
        const { result } = renderHook(() =>
            useEzClassifyObject(
                store,
                { classification: '' },
                { 'doc-marking': 'classification' },
            ),
        );
        act(() => {
            result.current.onChange(cb);
        });
        await act(async () => {
            await store.publishRendered('doc-marking', 'tier:secret');
        });
        expect(cb).toHaveBeenCalled();
        const [, diff] = cb.mock.calls[0];
        expect(diff[0]).toMatchObject({
            path: 'classification',
            after: 'tier:secret',
        });
    });

    it('routes assertions-mode bindings to the assertions side', async () => {
        const store = new VanillaEzClassifyStore(passThroughEngine());
        const { result } = renderHook(() =>
            useEzClassifyObject(
                store,
                { tags: [] as Assertion[] },
                { 'allergen-marking': { path: 'tags', mode: 'assertions' } },
            ),
        );
        await act(async () => {
            await store.publishAssertions('allergen-marking', [
                { categoryId: 'allergen', conceptId: 'dairy' } as Assertion,
            ]);
        });
        expect(result.current.doc.tags).toEqual([
            { categoryId: 'allergen', conceptId: 'dairy' },
        ]);
    });

    it('setDoc updates the doc and the store rendered value in lockstep', async () => {
        // Per architecture_rendered_is_primary: the rendered value is the consumer
        // surface; a commit must update both sides together.
        const store = new VanillaEzClassifyStore(passThroughEngine());
        const { result } = renderHook(() =>
            useEzClassifyObject(
                store,
                { classification: '' },
                { 'doc-marking': 'classification' },
            ),
        );
        act(() => {
            result.current.setDoc({ classification: 'tier:secret' });
        });
        await flush();
        expect(result.current.doc.classification).toBe('tier:secret');
        expect(store.get('doc-marking').rendered).toBe('tier:secret');
    });

    it('duplicate path in config throws', () => {
        const store = new VanillaEzClassifyStore(passThroughEngine());
        expect(() =>
            renderHook(() =>
                useEzClassifyObject(
                    store,
                    { a: '', b: '' },
                    { doc1: 'a', doc2: 'a' },
                ),
            ),
        ).toThrow(/duplicate path/i);
    });

    it('null initial value is diffed as empty string', async () => {
        const store = new VanillaEzClassifyStore(passThroughEngine());
        const { result } = renderHook(() =>
            useEzClassifyObject(
                store,
                { classification: null as string | null },
                { 'doc-marking': 'classification' },
            ),
        );
        await act(async () => {
            await store.publishRendered('doc-marking', 'tier:secret');
        });
        expect(result.current.doc.classification).toBe('tier:secret');
    });

    it('JSON Pointer path (/classification) is supported', async () => {
        const store = new VanillaEzClassifyStore(passThroughEngine());
        const { result } = renderHook(() =>
            useEzClassifyObject(
                store,
                { classification: '' },
                { 'doc-marking': '/classification' },
            ),
        );
        await act(async () => {
            await store.publishRendered('doc-marking', 'tier:secret');
        });
        expect(result.current.doc.classification).toBe('tier:secret');
    });

    it('setPath throws when path is not in config', () => {
        const store = new VanillaEzClassifyStore(passThroughEngine());
        const { result } = renderHook(() =>
            useEzClassifyObject(
                store,
                { classification: '' },
                { 'doc-marking': 'classification' },
            ),
        );
        expect(() => result.current.setPath('unknown', 'value')).toThrow(
            /no marking bound/i,
        );
    });

    it('setPath throws when rendered-mode receives a non-string', () => {
        const store = new VanillaEzClassifyStore(passThroughEngine());
        const { result } = renderHook(() =>
            useEzClassifyObject(
                store,
                { classification: '' },
                { 'doc-marking': 'classification' },
            ),
        );
        expect(() =>
            result.current.setPath('classification', [
                { categoryId: 'l', conceptId: 'h' },
            ] as unknown as string),
        ).toThrow(/expects a string/);
    });

    it('setPath in assertions mode writes Assertion[] to the store', async () => {
        const store = new VanillaEzClassifyStore(passThroughEngine());
        const { result } = renderHook(() =>
            useEzClassifyObject(
                store,
                { tags: [] as Assertion[] },
                { 'allergen-marking': { path: 'tags', mode: 'assertions' } },
            ),
        );
        act(() => {
            result.current.setPath('tags', [
                { categoryId: 'allergen', conceptId: 'dairy' } as Assertion,
            ]);
        });
        await flush();
        expect(store.get('allergen-marking').assertions).toEqual([
            { categoryId: 'allergen', conceptId: 'dairy' },
        ]);
    });

    it('setPath in assertions mode throws when non-array is passed', () => {
        const store = new VanillaEzClassifyStore(passThroughEngine());
        const { result } = renderHook(() =>
            useEzClassifyObject(
                store,
                { tags: [] as Assertion[] },
                { 'allergen-marking': { path: 'tags', mode: 'assertions' } },
            ),
        );
        expect(() =>
            result.current.setPath(
                'tags',
                'not-an-array' as unknown as Assertion[],
            ),
        ).toThrow(/expects an Assertion/);
    });

    it('setDoc with assertions-mode binding publishes assertion array', async () => {
        const store = new VanillaEzClassifyStore(passThroughEngine());
        const { result } = renderHook(() =>
            useEzClassifyObject(
                store,
                { tags: [] as Assertion[] },
                { 'allergen-marking': { path: 'tags', mode: 'assertions' } },
            ),
        );
        act(() => {
            result.current.setDoc({
                tags: [
                    { categoryId: 'allergen', conceptId: 'dairy' } as Assertion,
                ],
            });
        });
        await flush();
        expect(store.get('allergen-marking').assertions).toEqual([
            { categoryId: 'allergen', conceptId: 'dairy' },
        ]);
    });

    it('setDoc with same value as last seen does not re-publish', async () => {
        const store = new VanillaEzClassifyStore(passThroughEngine());
        const publishSpy = vi.spyOn(store, 'publishRendered');
        const { result } = renderHook(() =>
            useEzClassifyObject(
                store,
                { classification: 'tier:secret' },
                { 'doc-marking': 'classification' },
            ),
        );
        act(() => {
            result.current.setDoc({ classification: 'tier:secret' }); // same as initialDoc
        });
        await flush();
        expect(publishSpy).not.toHaveBeenCalled();
    });

    it('onChange off-listener stops receiving updates', async () => {
        const store = new VanillaEzClassifyStore(passThroughEngine());
        const cb = vi.fn();
        const { result } = renderHook(() =>
            useEzClassifyObject(
                store,
                { classification: '' },
                { 'doc-marking': 'classification' },
            ),
        );
        let off: () => void;
        act(() => {
            off = result.current.onChange(cb);
        });
        off!();
        await act(async () => {
            await store.publishRendered('doc-marking', 'tier:secret');
        });
        expect(cb).not.toHaveBeenCalled();
    });

    it('unmounts without throwing', () => {
        const store = new VanillaEzClassifyStore(passThroughEngine());
        const { unmount } = renderHook(() =>
            useEzClassifyObject(
                store,
                { classification: '' },
                { 'doc-marking': 'classification' },
            ),
        );
        expect(() => unmount()).not.toThrow();
    });
});
