import { describe, it, expect, vi } from 'vitest';
import { reactive, ref, nextTick } from 'vue';
import {
    VanillaEzClassifyStore,
    type EzClassifyStoreEngine,
    type EzClassifyStoreProcessResult,
} from '@ezclassify/ui';
import type { Assertion, RenderAssessment } from '@ezclassify/types';
import { bindEzClassifyToReactiveDoc } from './bindEzClassifyToReactiveDoc';

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
        aggregate(inputs: string[]): EzClassifyStoreProcessResult {
            const assertions: Assertion[] = [];
            const seen = new Set<string>();
            for (const rendered of inputs) {
                for (const part of rendered.split(/\s+/)) {
                    const [categoryId, conceptId] = part.split(':');
                    if (categoryId && conceptId) {
                        const key = `${categoryId}:${conceptId}`;
                        if (!seen.has(key)) {
                            seen.add(key);
                            assertions.push({
                                categoryId,
                                conceptId,
                            } as Assertion);
                        }
                    }
                }
            }
            return {
                rendered: assertions
                    .map((a) => `${a.categoryId}:${a.conceptId}`)
                    .join(' '),
                assessment: EMPTY_RENDER_ASSESSMENT,
                renders: {},
                assertions,
                valid: true,
                errors: [],
            };
        },
        aggregateAssertions(
            assertionSets: Assertion[][],
        ): EzClassifyStoreProcessResult {
            const merged: Assertion[] = [];
            const seen = new Set<string>();
            for (const set of assertionSets) {
                for (const a of set) {
                    const key = `${a.categoryId}:${a.conceptId}`;
                    if (!seen.has(key)) {
                        seen.add(key);
                        merged.push(a);
                    }
                }
            }
            return {
                rendered: merged
                    .map((a) => `${a.categoryId}:${a.conceptId}`)
                    .join(' '),
                assessment: EMPTY_RENDER_ASSESSMENT,
                renders: {},
                assertions: merged,
                valid: true,
                errors: [],
            };
        },
        getSchemeMeta: () => ({ scopes: [] }),
        listCategories: () => [],
    };
}

describe('bindEzClassifyToReactiveDoc', () => {
    it('updates a reactive() doc when the store commits', async () => {
        const store = new VanillaEzClassifyStore(passThroughEngine());
        const doc = reactive({ classification: '' });
        const handle = bindEzClassifyToReactiveDoc(store, doc, {
            'doc-marking': 'classification',
        });
        await store.publishRendered('doc-marking', 'tier:secret');
        expect(doc.classification).toBe('tier:secret');
        handle.dispose();
    });

    it('publishes to the store when a reactive property is mutated', async () => {
        const store = new VanillaEzClassifyStore(passThroughEngine());
        const doc = reactive({ classification: '' });
        const handle = bindEzClassifyToReactiveDoc(store, doc, {
            'doc-marking': 'classification',
        });
        doc.classification = 'tier:top-secret';
        await nextTick();
        await Promise.resolve();
        await Promise.resolve();
        expect(store.get('doc-marking').rendered).toBe('tier:top-secret');
        handle.dispose();
    });

    it('handles JSON Pointer paths with dashes in keys', async () => {
        const store = new VanillaEzClassifyStore(passThroughEngine());
        const doc = reactive<{ 'para-1': { classification: string } }>({
            'para-1': { classification: '' },
        });
        const handle = bindEzClassifyToReactiveDoc(store, doc, {
            'para-marking': '/para-1/classification',
        });
        await store.publishRendered('para-marking', 'tier:u');
        expect(doc['para-1'].classification).toBe('tier:u');
        handle.dispose();
    });

    it('setPath mutates the doc and the store', async () => {
        const store = new VanillaEzClassifyStore(passThroughEngine());
        const doc = reactive<{ title: { classification: string } }>({
            title: { classification: '' },
        });
        const handle = bindEzClassifyToReactiveDoc(store, doc, {
            'title-marking': 'title.classification',
        });
        handle.setPath('title.classification', 'tier:ts');
        await nextTick();
        await Promise.resolve();
        expect(doc.title.classification).toBe('tier:ts');
        expect(store.get('title-marking').rendered).toBe('tier:ts');
        handle.dispose();
    });

    it('supports a Ref<T> doc container', async () => {
        const store = new VanillaEzClassifyStore(passThroughEngine());
        const doc = ref({ classification: '' });
        const handle = bindEzClassifyToReactiveDoc(store, doc, {
            'doc-marking': 'classification',
        });
        await store.publishRendered('doc-marking', 'tier:secret');
        expect(doc.value.classification).toBe('tier:secret');
        handle.dispose();
    });

    it('onChange receives diff entries', async () => {
        const store = new VanillaEzClassifyStore(passThroughEngine());
        const doc = reactive({ classification: '' });
        const handle = bindEzClassifyToReactiveDoc(store, doc, {
            'doc-marking': 'classification',
        });
        const cb = vi.fn();
        handle.onChange(cb);
        await store.publishRendered('doc-marking', 'tier:secret');
        expect(cb).toHaveBeenCalled();
        const [, diff] = cb.mock.calls[0];
        expect(diff[0]).toMatchObject({
            path: 'classification',
            before: '',
            after: 'tier:secret',
        });
        handle.dispose();
    });

    it('dispose stops further updates', async () => {
        const store = new VanillaEzClassifyStore(passThroughEngine());
        const doc = reactive({ classification: '' });
        const handle = bindEzClassifyToReactiveDoc(store, doc, {
            'doc-marking': 'classification',
        });
        handle.dispose();
        await store.publishRendered('doc-marking', 'tier:secret');
        expect(doc.classification).toBe('');
    });

    it('throws on duplicate paths in config', () => {
        const store = new VanillaEzClassifyStore(passThroughEngine());
        const doc = reactive({ classification: '' });
        expect(() =>
            bindEzClassifyToReactiveDoc(store, doc, {
                'marking-a': 'classification',
                'marking-b': 'classification',
            }),
        ).toThrow(/duplicate path/);
    });

    it('setPath throws when called after dispose', async () => {
        const store = new VanillaEzClassifyStore(passThroughEngine());
        const doc = reactive({ classification: '' });
        const handle = bindEzClassifyToReactiveDoc(store, doc, {
            'doc-marking': 'classification',
        });
        handle.dispose();
        expect(() => handle.setPath('classification', 'tier:ts')).toThrow(
            /disposed/,
        );
    });

    it('setPath throws when the path is not bound', async () => {
        const store = new VanillaEzClassifyStore(passThroughEngine());
        const doc = reactive({ classification: '' });
        const handle = bindEzClassifyToReactiveDoc(store, doc, {
            'doc-marking': 'classification',
        });
        expect(() => handle.setPath('no-such-path', 'tier:ts')).toThrow(
            /no marking bound/,
        );
        handle.dispose();
    });

    it('setPath throws TypeError when rendered-mode binding receives non-string', async () => {
        const store = new VanillaEzClassifyStore(passThroughEngine());
        const doc = reactive({ classification: '' });
        const handle = bindEzClassifyToReactiveDoc(store, doc, {
            'doc-marking': 'classification',
        });
        expect(() =>
            handle.setPath('classification', [
                { categoryId: 'tier', conceptId: 'a' },
            ] as any),
        ).toThrow(/expects a string/);
        handle.dispose();
    });

    it('setPath throws TypeError when assertions-mode binding receives non-array', async () => {
        const store = new VanillaEzClassifyStore(passThroughEngine());
        const doc = reactive<{ assertions: Assertion[] }>({ assertions: [] });
        const handle = bindEzClassifyToReactiveDoc(store, doc, {
            'doc-marking': { path: 'assertions', mode: 'assertions' },
        });
        expect(() =>
            handle.setPath('assertions', 'not-an-array' as any),
        ).toThrow(/expects an Assertion\[\]/);
        handle.dispose();
    });

    it('onChange listener can be removed via its unsubscribe', async () => {
        const store = new VanillaEzClassifyStore(passThroughEngine());
        const doc = reactive({ classification: '' });
        const handle = bindEzClassifyToReactiveDoc(store, doc, {
            'doc-marking': 'classification',
        });
        const cb = vi.fn();
        const off = handle.onChange(cb);
        off();
        await store.publishRendered('doc-marking', 'tier:secret');
        expect(cb).not.toHaveBeenCalled();
        handle.dispose();
    });

    it('double-dispose is safe', () => {
        const store = new VanillaEzClassifyStore(passThroughEngine());
        const doc = reactive({ classification: '' });
        const handle = bindEzClassifyToReactiveDoc(store, doc, {
            'doc-marking': 'classification',
        });
        handle.dispose();
        expect(() => handle.dispose()).not.toThrow();
    });

    it('assertions mode: publishes assertion array to store', async () => {
        const store = new VanillaEzClassifyStore(passThroughEngine());
        const doc = reactive<{ assertions: Assertion[] }>({ assertions: [] });
        const handle = bindEzClassifyToReactiveDoc(store, doc, {
            'doc-marking': { path: 'assertions', mode: 'assertions' },
        });
        handle.setPath('assertions', [
            { categoryId: 'tier', conceptId: 'a' } as Assertion,
        ]);
        await nextTick();
        await Promise.resolve();
        await Promise.resolve();
        expect(store.get('doc-marking').rendered).toBeTruthy();
        handle.dispose();
    });

    it('creates intermediate objects for deep paths that do not exist yet', async () => {
        const store = new VanillaEzClassifyStore(passThroughEngine());
        const doc = reactive<Record<string, unknown>>({ meta: null });
        const handle = bindEzClassifyToReactiveDoc(store, doc, {
            'doc-marking': 'meta.classification',
        });
        await store.publishRendered('doc-marking', 'tier:secret');
        expect((doc.meta as Record<string, unknown>)?.classification).toBe(
            'tier:secret',
        );
        handle.dispose();
    });

    it('initial null path value is treated as empty string (no publish)', async () => {
        const store = new VanillaEzClassifyStore(passThroughEngine());
        const doc = reactive<{ classification: string | null }>({
            classification: null,
        });
        const handle = bindEzClassifyToReactiveDoc(store, doc, {
            'doc-marking': 'classification',
        });
        await Promise.resolve();
        expect(store.get('doc-marking').rendered).toBe('');
        handle.dispose();
    });
});
