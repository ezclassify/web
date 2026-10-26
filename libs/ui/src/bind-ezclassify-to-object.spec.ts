import { describe, it, expect, vi } from 'vitest';
import {
    bindEzClassifyToObject,
    createDocBinding,
    parseDocPath,
    readDocPath,
    writeDocPath,
} from './bind-ezclassify-to-object';
import {
    VanillaEzClassifyStore,
    type EzClassifyStoreEngine,
    type EzClassifyStoreProcessResult,
} from './store/ezclassify-store';
import type { Assertion } from '@ezclassify/types';
import { EMPTY_RENDER_ASSESSMENT } from './engine-result-mock';

function passThroughEngine(): EzClassifyStoreEngine {
    return {
        process(input): EzClassifyStoreProcessResult {
            const rendered =
                typeof input === 'string'
                    ? input
                    : input
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

describe('parseDocPath', () => {
    it('splits dot-notation paths', () => {
        expect(parseDocPath('title.classification')).toEqual([
            'title',
            'classification',
        ]);
    });

    it('recognizes JSON Pointer paths by the leading slash', () => {
        expect(parseDocPath('/para-1/classification')).toEqual([
            'para-1',
            'classification',
        ]);
    });

    it('decodes RFC 6901 escapes', () => {
        expect(parseDocPath('/foo~1bar/baz~0qux')).toEqual([
            'foo/bar',
            'baz~qux',
        ]);
        // ~01 must round-trip to ~1 (decode ~1 first, then ~0)
        expect(parseDocPath('/~01')).toEqual(['~1']);
    });

    it('handles single-segment dot paths', () => {
        expect(parseDocPath('classification')).toEqual(['classification']);
    });
});

describe('readDocPath / writeDocPath', () => {
    it('reads nested values', () => {
        const doc = { title: { classification: 'S' } };
        expect(readDocPath(doc, 'title.classification')).toBe('S');
    });

    it('returns undefined for missing intermediates', () => {
        const doc: Record<string, unknown> = {};
        expect(readDocPath(doc, 'title.classification')).toBeUndefined();
    });

    it('writes through missing intermediates', () => {
        const doc: Record<string, unknown> = {};
        writeDocPath(doc, 'title.classification', 'TS');
        expect(
            (doc as { title: { classification: string } }).title.classification,
        ).toBe('TS');
    });

    it('writes via JSON Pointer keys with dashes', () => {
        const doc: Record<string, unknown> = {};
        writeDocPath(doc, '/para-1/classification', 'U');
        expect(
            (doc as { 'para-1': { classification: string } })['para-1']
                .classification,
        ).toBe('U');
    });
});

describe('bindEzClassifyToObject', () => {
    it('updates the doc field on rendered-mode commits (dot-notation)', async () => {
        const store = new VanillaEzClassifyStore(passThroughEngine());
        const doc: { classification: string } = { classification: '' };
        const handle = bindEzClassifyToObject(store, doc, {
            'doc-marking': 'classification',
        });
        await store.publishRendered('doc-marking', 'tier:secret');
        expect(doc.classification).toBe('tier:secret');
        handle.dispose();
    });

    it('updates the doc field on JSON Pointer paths', async () => {
        const store = new VanillaEzClassifyStore(passThroughEngine());
        const doc: { 'para-1': { classification: string } } = {
            'para-1': { classification: '' },
        };
        const handle = bindEzClassifyToObject(store, doc, {
            'para-marking': '/para-1/classification',
        });
        await store.publishRendered('para-marking', 'tier:u');
        expect(doc['para-1'].classification).toBe('tier:u');
        handle.dispose();
    });

    it('routes assertion-mode bindings to state.assertions', async () => {
        const store = new VanillaEzClassifyStore(passThroughEngine());
        const doc: { tags?: Assertion[] } = {};
        const handle = bindEzClassifyToObject(store, doc, {
            'allergen-marking': { path: 'tags', mode: 'assertions' },
        });
        await store.publishAssertions('allergen-marking', [
            { categoryId: 'allergen', conceptId: 'dairy' } as Assertion,
        ]);
        expect(doc.tags).toEqual([
            { categoryId: 'allergen', conceptId: 'dairy' },
        ]);
        handle.dispose();
    });

    it('setPath publishes through the store and the doc reflects the result', async () => {
        const store = new VanillaEzClassifyStore(passThroughEngine());
        const doc: { title: { classification: string } } = {
            title: { classification: '' },
        };
        const handle = bindEzClassifyToObject(store, doc, {
            'title-marking': 'title.classification',
        });
        handle.setPath('title.classification', 'tier:ts');
        // publishRendered is async; let microtasks drain.
        await Promise.resolve();
        await Promise.resolve();
        expect(doc.title.classification).toBe('tier:ts');
        expect(store.get('title-marking').rendered).toBe('tier:ts');
        handle.dispose();
    });

    it('setPath on an assertions-mode binding accepts an Assertion[]', async () => {
        const store = new VanillaEzClassifyStore(passThroughEngine());
        const doc: { tags?: Assertion[] } = {};
        const handle = bindEzClassifyToObject(store, doc, {
            'allergen-marking': { path: 'tags', mode: 'assertions' },
        });
        handle.setPath('tags', [
            { categoryId: 'allergen', conceptId: 'gluten' } as Assertion,
        ]);
        await Promise.resolve();
        await Promise.resolve();
        expect(doc.tags?.[0]).toMatchObject({
            categoryId: 'allergen',
            conceptId: 'gluten',
        });
        handle.dispose();
    });

    it('setPath throws on unknown paths', () => {
        const store = new VanillaEzClassifyStore(passThroughEngine());
        const handle = bindEzClassifyToObject(
            store,
            {},
            { 'doc-marking': 'classification' },
        );
        expect(() => handle.setPath('nope', 'X')).toThrow(/no marking bound/);
        handle.dispose();
    });

    it('setPath rejects wrong value types for the configured mode', () => {
        const store = new VanillaEzClassifyStore(passThroughEngine());
        const handle = bindEzClassifyToObject(
            store,
            {},
            {
                'doc-marking': 'classification',
                'tag-marking': { path: 'tags', mode: 'assertions' },
            },
        );
        expect(() =>
            handle.setPath('classification', [
                'not-a-string',
            ] as unknown as string),
        ).toThrow(/expects a string/);
        expect(() =>
            handle.setPath('tags', 'not-an-array' as unknown as Assertion[]),
        ).toThrow(/expects an Assertion\[\]/);
        handle.dispose();
    });

    it('onChange receives diff entries with the path, before, and after strings', async () => {
        const store = new VanillaEzClassifyStore(passThroughEngine());
        const doc: { classification: string } = { classification: '' };
        const handle = bindEzClassifyToObject(store, doc, {
            'doc-marking': 'classification',
        });
        const cb = vi.fn();
        handle.onChange(cb);
        await store.publishRendered('doc-marking', 'tier:secret');
        expect(cb).toHaveBeenCalledTimes(1);
        const [updated, diff] = cb.mock.calls[0];
        expect(updated).toBe(doc);
        expect(diff).toHaveLength(1);
        expect(diff[0]).toEqual({
            path: 'classification',
            before: '',
            after: 'tier:secret',
        });
        handle.dispose();
    });

    it('onChange does not fire when the value is unchanged', async () => {
        const store = new VanillaEzClassifyStore(passThroughEngine());
        const doc: { classification: string } = {
            classification: 'tier:secret',
        };
        const handle = bindEzClassifyToObject(store, doc, {
            'doc-marking': 'classification',
        });
        const cb = vi.fn();
        handle.onChange(cb);
        // The doc already holds the same value the next publish will produce.
        await store.publishRendered('doc-marking', 'tier:secret');
        expect(cb).not.toHaveBeenCalled();
        handle.dispose();
    });

    it('dispose unsubscribes from the store and detaches listeners', async () => {
        const store = new VanillaEzClassifyStore(passThroughEngine());
        const doc: { classification: string } = { classification: '' };
        const handle = bindEzClassifyToObject(store, doc, {
            'doc-marking': 'classification',
        });
        const cb = vi.fn();
        handle.onChange(cb);
        handle.dispose();
        await store.publishRendered('doc-marking', 'tier:secret');
        expect(cb).not.toHaveBeenCalled();
        expect(doc.classification).toBe('');
    });

    it('setPath after dispose throws', () => {
        const store = new VanillaEzClassifyStore(passThroughEngine());
        const handle = bindEzClassifyToObject(
            store,
            {},
            { 'doc-marking': 'classification' },
        );
        handle.dispose();
        expect(() => handle.setPath('classification', 'X')).toThrow(/disposed/);
    });

    it('rejects duplicate paths in the config', () => {
        const store = new VanillaEzClassifyStore(passThroughEngine());
        expect(() =>
            bindEzClassifyToObject(
                store,
                {},
                {
                    'a-marking': 'classification',
                    'b-marking': 'classification',
                },
            ),
        ).toThrow(/duplicate path/);
    });
});

/**
 * The algorithm itself, driven through a container that implements the whole
 * `ReactiveDoc` seam including `observe`. `bindEzClassifyToObject` deliberately
 * leaves `observe` off (a plain object cannot report its own mutation), so the
 * document-to-store direction requires this observable container. These tests
 * exercise that shared binding algorithm directly.
 */
describe('createDocBinding: the document-to-store direction', () => {
    /** A plain object plus the write notification a framework would provide. */
    function observableDoc<T extends object>(doc: T) {
        let notify: () => void = () => {};
        return {
            container: {
                read: () => doc,
                write: (path: string, value: unknown) =>
                    writeDocPath(doc, path, value),
                observe: (
                    _paths: readonly string[],
                    onHostWrite: () => void,
                ) => {
                    notify = onHostWrite;
                    return () => {
                        notify = () => {};
                    };
                },
            },
            /** Stand in for the host writing the document. */
            hostWrite(mutate: (doc: T) => void): void {
                mutate(doc);
                notify();
            },
        };
    }

    /**
     * A host write that moves two bound paths is one edit. React batched the
     * whole set into a single onChange call, Angular and Vue fired once per
     * path; a listener that renders a summary would have rendered twice for one
     * keystroke.
     */
    it('reports every path one host write moved in a single onChange call', () => {
        const store = new VanillaEzClassifyStore(passThroughEngine());
        const doc = { title: '', body: '' };
        const { container, hostWrite } = observableDoc(doc);
        const handle = createDocBinding(
            store,
            container,
            { 'title-marking': 'title', 'body-marking': 'body' },
            { label: '[test] createDocBinding' },
        );
        const cb = vi.fn();
        handle.onChange(cb);

        hostWrite((d) => {
            d.title = 'tier:secret';
            d.body = 'tier:u';
        });

        expect(cb).toHaveBeenCalledTimes(1);
        const [, diff] = cb.mock.calls[0];
        expect(diff).toEqual([
            { path: 'title', before: '', after: 'tier:secret' },
            { path: 'body', before: '', after: 'tier:u' },
        ]);
        handle.dispose();
    });

    /**
     * A rendered-mode path holding a non-string is skipped outright. React used
     * to report it through onChange anyway, telling the listener the store had
     * taken a value it never saw.
     */
    it('does not report a value the store was never given', () => {
        const store = new VanillaEzClassifyStore(passThroughEngine());
        const doc: { classification: unknown } = { classification: '' };
        const { container, hostWrite } = observableDoc(doc);
        const publish = vi.spyOn(store, 'publishRendered');
        const handle = createDocBinding(
            store,
            container,
            { 'doc-marking': 'classification' },
            { label: '[test] createDocBinding' },
        );
        const cb = vi.fn();
        handle.onChange(cb);

        hostWrite((d) => {
            d.classification = 42;
        });

        expect(publish).not.toHaveBeenCalled();
        expect(cb).not.toHaveBeenCalled();
        handle.dispose();
    });

    /**
     * Nor may the skipped value be recorded as seen. All three framework copies
     * wrote lastSeen before checking the type, so restoring the path to the
     * value the store already held looked like a change and republished it,
     * while the value the store actually wanted next could look unchanged.
     */
    it('still publishes the next good value after skipping a bad one', () => {
        const store = new VanillaEzClassifyStore(passThroughEngine());
        const doc: { classification: unknown } = { classification: '' };
        const { container, hostWrite } = observableDoc(doc);
        const handle = createDocBinding(
            store,
            container,
            { 'doc-marking': 'classification' },
            { label: '[test] createDocBinding' },
        );
        const publish = vi.spyOn(store, 'publishRendered');

        hostWrite((d) => {
            d.classification = 42;
        });
        hostWrite((d) => {
            d.classification = '';
        });
        // Back to the value lastSeen already held: nothing moved, nothing sent.
        expect(publish).not.toHaveBeenCalled();

        hostWrite((d) => {
            d.classification = 'tier:secret';
        });
        expect(publish).toHaveBeenCalledTimes(1);
        expect(publish).toHaveBeenCalledWith('doc-marking', 'tier:secret');
        handle.dispose();
    });

    /**
     * A publish that rejects never reached the store, so the path has to stay
     * eligible for re-publication. Recording it as seen before the promise
     * settled made the divergence permanent: every later write of that same
     * value looked like a no-op for the life of the binding.
     */
    it('re-publishes a value whose first publish was rejected', async () => {
        const store = new VanillaEzClassifyStore(passThroughEngine());
        const doc = { classification: '' };
        const { container, hostWrite } = observableDoc(doc);
        const handle = createDocBinding(
            store,
            container,
            { 'doc-marking': 'classification' },
            { label: '[test] createDocBinding' },
        );
        const publish = vi
            .spyOn(store, 'publishRendered')
            .mockRejectedValueOnce(new Error('engine unreachable'));
        const reported = vi
            .spyOn(console, 'error')
            .mockImplementation(() => {});

        hostWrite((d) => {
            d.classification = 'tier:secret';
        });
        await Promise.resolve();
        await Promise.resolve();
        expect(publish).toHaveBeenCalledTimes(1);
        expect(reported).toHaveBeenCalled();

        // The host writes the same value again; the store still does not have
        // it, so the binding has to send it.
        hostWrite((d) => {
            d.classification = 'tier:secret';
        });
        expect(publish).toHaveBeenCalledTimes(2);

        reported.mockRestore();
        handle.dispose();
    });

    /** An edit that lands on the value the store already holds sends nothing. */
    it('skips a host write that does not change the value', () => {
        const store = new VanillaEzClassifyStore(passThroughEngine());
        const doc = { classification: 'tier:secret' };
        const { container, hostWrite } = observableDoc(doc);
        const handle = createDocBinding(
            store,
            container,
            { 'doc-marking': 'classification' },
            { label: '[test] createDocBinding' },
        );
        const publish = vi.spyOn(store, 'publishRendered');

        hostWrite((d) => {
            d.classification = 'tier:secret';
        });

        expect(publish).not.toHaveBeenCalled();
        handle.dispose();
    });

    /**
     * The round trip has to stop. A host write publishes, the store commits,
     * the commit writes the document, and the observer runs again; without the
     * dedupe on both sides that second pass republishes forever.
     */
    it('terminates the host write to commit round trip', async () => {
        const store = new VanillaEzClassifyStore(passThroughEngine());
        const doc = { classification: '' };
        const { container, hostWrite } = observableDoc(doc);
        const handle = createDocBinding(
            store,
            container,
            { 'doc-marking': 'classification' },
            { label: '[test] createDocBinding' },
        );
        const publish = vi.spyOn(store, 'publishRendered');

        hostWrite((d) => {
            d.classification = 'tier:secret';
        });
        for (let i = 0; i < 8; i++) await Promise.resolve();

        expect(publish).toHaveBeenCalledTimes(1);
        expect(doc.classification).toBe('tier:secret');
        expect(store.get('doc-marking').rendered).toBe('tier:secret');
        handle.dispose();
    });

    /** A container with no `observe` is one-way, which is the vanilla contract. */
    it('leaves a container without observe one-way', () => {
        const store = new VanillaEzClassifyStore(passThroughEngine());
        const doc = { classification: '' };
        const handle = createDocBinding(
            store,
            {
                read: () => doc,
                write: (path, value) => writeDocPath(doc, path, value),
            },
            { 'doc-marking': 'classification' },
            { label: '[test] createDocBinding' },
        );
        const publish = vi.spyOn(store, 'publishRendered');

        doc.classification = 'tier:secret';
        expect(publish).not.toHaveBeenCalled();
        handle.dispose();
    });
});
