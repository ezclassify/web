import { describe, it, expect } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { Injector, signal } from '@angular/core';
import { getActiveConsumer } from '@angular/core/primitives/signals';
import {
    VanillaEzClassifyStore,
    type EzClassifyStoreEngine,
    type EzClassifyStoreProcessResult,
} from '@ezclassify/ui';
import type { Assertion, RenderAssessment } from '@ezclassify/types';
import { bindEzClassifyToSignal } from './bind-ezclassify-to-signal';

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
                    : input
                          .map(
                              (a: Assertion) =>
                                  `${a.categoryId}:${a.conceptId}`,
                          )
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

async function flush(): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
    TestBed.tick();
}

describe('bindEzClassifyToSignal', () => {
    beforeEach(() => {
        TestBed.configureTestingModule({});
    });

    it('updates the signal value when the store commits', async () => {
        const store = new VanillaEzClassifyStore(passThroughEngine());
        const injector = TestBed.inject(Injector);
        const doc = signal<{ classification: string }>({ classification: '' });
        const handle = bindEzClassifyToSignal(
            store,
            doc,
            { 'doc-marking': 'classification' },
            { injector },
        );
        await store.publishRendered('doc-marking', 'tier:secret');
        TestBed.tick();
        expect(doc().classification).toBe('tier:secret');
        handle.dispose();
    });

    it('publishes back to the store when the signal is updated', async () => {
        const store = new VanillaEzClassifyStore(passThroughEngine());
        const injector = TestBed.inject(Injector);
        const doc = signal<{ classification: string }>({ classification: '' });
        const handle = bindEzClassifyToSignal(
            store,
            doc,
            { 'doc-marking': 'classification' },
            { injector },
        );
        // Force an initial effect run so lastSeen is calibrated before the write.
        TestBed.tick();
        doc.update((d) => ({ ...d, classification: 'tier:top-secret' }));
        TestBed.tick();
        await flush();
        expect(store.get('doc-marking').rendered).toBe('tier:top-secret');
        handle.dispose();
    });

    it('setPath writes the signal and publishes to the store', async () => {
        const store = new VanillaEzClassifyStore(passThroughEngine());
        const injector = TestBed.inject(Injector);
        const doc = signal<{ title: { classification: string } }>({
            title: { classification: '' },
        });
        const handle = bindEzClassifyToSignal(
            store,
            doc,
            { 'title-marking': 'title.classification' },
            { injector },
        );
        TestBed.tick();
        handle.setPath('title.classification', 'tier:ts');
        TestBed.tick();
        await flush();
        expect(doc().title.classification).toBe('tier:ts');
        expect(store.get('title-marking').rendered).toBe('tier:ts');
        handle.dispose();
    });

    it('dispose stops further updates', async () => {
        const store = new VanillaEzClassifyStore(passThroughEngine());
        const injector = TestBed.inject(Injector);
        const doc = signal<{ classification: string }>({ classification: '' });
        const handle = bindEzClassifyToSignal(
            store,
            doc,
            { 'doc-marking': 'classification' },
            { injector },
        );
        TestBed.tick();
        handle.dispose();
        await store.publishRendered('doc-marking', 'tier:secret');
        TestBed.tick();
        expect(doc().classification).toBe('');
    });

    it('duplicate path in config throws', () => {
        const store = new VanillaEzClassifyStore(passThroughEngine());
        const injector = TestBed.inject(Injector);
        const doc = signal<{ a: string; b: string }>({ a: '', b: '' });
        expect(() =>
            bindEzClassifyToSignal(
                store,
                doc,
                { doc1: 'a', doc2: 'a' },
                { injector },
            ),
        ).toThrow(/duplicate path/i);
    });

    it('assertions-mode binding: store commit updates signal with assertion array', async () => {
        const store = new VanillaEzClassifyStore(passThroughEngine());
        const injector = TestBed.inject(Injector);
        const doc = signal<{ assertions: Assertion[] }>({ assertions: [] });
        const handle = bindEzClassifyToSignal(
            store,
            doc,
            { 'doc-marking': { path: 'assertions', mode: 'assertions' } },
            { injector },
        );
        await store.publishRendered('doc-marking', 'level:high');
        TestBed.tick();
        expect(doc().assertions.length).toBeGreaterThan(0);
        expect(doc().assertions[0].conceptId).toBe('high');
        handle.dispose();
    });

    it('assertions-mode binding: signal update publishes assertions to store', async () => {
        const store = new VanillaEzClassifyStore(passThroughEngine());
        const injector = TestBed.inject(Injector);
        const doc = signal<{ assertions: Assertion[] }>({ assertions: [] });
        const handle = bindEzClassifyToSignal(
            store,
            doc,
            { 'doc-marking': { path: 'assertions', mode: 'assertions' } },
            { injector },
        );
        TestBed.tick();
        doc.update((d) => ({
            ...d,
            assertions: [
                { categoryId: 'level', conceptId: 'high' } as Assertion,
            ],
        }));
        TestBed.tick();
        await flush();
        expect(store.get('doc-marking').assertions.length).toBeGreaterThan(0);
        handle.dispose();
    });

    it('setPath throws when handle is disposed', () => {
        const store = new VanillaEzClassifyStore(passThroughEngine());
        const injector = TestBed.inject(Injector);
        const doc = signal<{ c: string }>({ c: '' });
        const handle = bindEzClassifyToSignal(
            store,
            doc,
            { 'doc-marking': 'c' },
            { injector },
        );
        handle.dispose();
        expect(() => handle.setPath('c', 'some-value')).toThrow(/disposed/);
    });

    it('setPath throws when path is not in config', () => {
        const store = new VanillaEzClassifyStore(passThroughEngine());
        const injector = TestBed.inject(Injector);
        const doc = signal<{ c: string }>({ c: '' });
        const handle = bindEzClassifyToSignal(
            store,
            doc,
            { 'doc-marking': 'c' },
            { injector },
        );
        expect(() => handle.setPath('not-a-path', 'some-value')).toThrow(
            /no marking bound/i,
        );
        handle.dispose();
    });

    it('setPath throws when rendered-mode path receives a non-string', () => {
        const store = new VanillaEzClassifyStore(passThroughEngine());
        const injector = TestBed.inject(Injector);
        const doc = signal<{ c: string }>({ c: '' });
        const handle = bindEzClassifyToSignal(
            store,
            doc,
            { 'doc-marking': 'c' },
            { injector },
        );
        expect(() =>
            handle.setPath('c', [
                { categoryId: 'level', conceptId: 'high' },
            ] as unknown as string),
        ).toThrow(/expects a string/);
        handle.dispose();
    });

    it('setPath throws when assertions-mode path receives a non-array', () => {
        const store = new VanillaEzClassifyStore(passThroughEngine());
        const injector = TestBed.inject(Injector);
        const doc = signal<{ assertions: Assertion[] }>({ assertions: [] });
        const handle = bindEzClassifyToSignal(
            store,
            doc,
            { 'doc-marking': { path: 'assertions', mode: 'assertions' } },
            { injector },
        );
        expect(() =>
            handle.setPath(
                'assertions',
                'not-an-array' as unknown as Assertion[],
            ),
        ).toThrow(/expects an Assertion/);
        handle.dispose();
    });

    it('JSON Pointer path (/foo/bar) is supported', async () => {
        const store = new VanillaEzClassifyStore(passThroughEngine());
        const injector = TestBed.inject(Injector);
        const doc = signal<{ meta: { classification: string } }>({
            meta: { classification: '' },
        });
        const handle = bindEzClassifyToSignal(
            store,
            doc,
            { 'doc-marking': '/meta/classification' },
            { injector },
        );
        await store.publishRendered('doc-marking', 'tier:secret');
        TestBed.tick();
        expect(doc().meta.classification).toBe('tier:secret');
        handle.dispose();
    });

    it('onChange listener fires when store commits', async () => {
        const store = new VanillaEzClassifyStore(passThroughEngine());
        const injector = TestBed.inject(Injector);
        const doc = signal<{ c: string }>({ c: '' });
        const handle = bindEzClassifyToSignal(
            store,
            doc,
            { 'doc-marking': 'c' },
            { injector },
        );
        const diffs: unknown[] = [];
        const offChange = handle.onChange((_doc, diff) => diffs.push(diff));
        await store.publishRendered('doc-marking', 'tier:secret');
        TestBed.tick();
        expect(diffs.length).toBeGreaterThan(0);
        offChange();
        handle.dispose();
    });

    it('null doc path value initializes lastSeen to empty string without throwing', () => {
        const store = new VanillaEzClassifyStore(passThroughEngine());
        const injector = TestBed.inject(Injector);
        // A null path value is treated as an empty string, so binding does not throw.
        const doc = signal<{ classification: string | null }>({
            classification: null,
        });
        const handle = bindEzClassifyToSignal(
            store,
            doc,
            { 'doc-marking': 'classification' },
            { injector },
        );
        TestBed.tick();
        expect(doc().classification).toBeNull();
        handle.dispose();
    });

    it('setPath with assertions mode and valid Assertion array does not throw', () => {
        const store = new VanillaEzClassifyStore(passThroughEngine());
        const injector = TestBed.inject(Injector);
        const doc = signal<{ assertions: Assertion[] }>({ assertions: [] });
        const handle = bindEzClassifyToSignal(
            store,
            doc,
            { 'doc-marking': { path: 'assertions', mode: 'assertions' } },
            { injector },
        );
        const assertions: Assertion[] = [
            { categoryId: 'level', conceptId: 'high' } as Assertion,
        ];
        expect(() => handle.setPath('assertions', assertions)).not.toThrow();
        handle.dispose();
    });

    it('dispose is idempotent, double dispose does not throw', () => {
        const store = new VanillaEzClassifyStore(passThroughEngine());
        const injector = TestBed.inject(Injector);
        const doc = signal<{ c: string }>({ c: '' });
        const handle = bindEzClassifyToSignal(
            store,
            doc,
            { 'doc-marking': 'c' },
            { injector },
        );
        handle.dispose();
        expect(() => handle.dispose()).not.toThrow();
    });

    it('publishes with no active consumer, so the commit may write the doc signal', async () => {
        // Clearing a marking commits inside `publishRendered`, synchronously,
        // and the binding's own store subscription writes `doc` from there.
        // Angular refuses a signal write attributed to an effect consumer
        // before v19, and this package declares `@angular/core >= 17`.
        const store = new VanillaEzClassifyStore(passThroughEngine());
        const injector = TestBed.inject(Injector);
        const doc = signal<{ classification: string }>({
            classification: 'tier:secret',
        });
        const handle = bindEzClassifyToSignal(
            store,
            doc,
            { 'doc-marking': 'classification' },
            { injector },
        );
        TestBed.tick();
        await flush();

        const consumers: unknown[] = [];
        const stop = store.subscribe('doc-marking', () => {
            consumers.push(getActiveConsumer());
        });
        doc.update((d) => ({ ...d, classification: '' }));
        TestBed.tick();
        await flush();

        expect(consumers.length).toBeGreaterThan(0);
        expect(consumers.every((c) => c === null)).toBe(true);
        expect(doc().classification).toBe('');
        stop();
        handle.dispose();
    });
});
