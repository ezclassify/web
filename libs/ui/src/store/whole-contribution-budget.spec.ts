import { describe, expect, it, vi } from 'vitest';
import { SchemeEngine } from '@ezclassify/engine';
import { VanillaEzClassifyStore } from './ezclassify-store';

function engine(roleAware: boolean, hideValues = false) {
    return SchemeEngine.fromJSON({
        scheme: {
            id: 'whole-dependency-test',
            version: '1.0.0',
            name: 'Whole dependency test',
            role_aware: roleAware,
            data: {
                categories: [
                    {
                        id: 'head',
                        label: 'Head',
                        single: true,
                        required: false,
                        rollup: 'union',
                    },
                    {
                        id: 'values',
                        label: 'Values',
                        single: false,
                        required: false,
                        rollup: 'union',
                    },
                ],
                concepts: {
                    inline: [
                        {
                            id: 'SAME',
                            name: 'Same',
                            categories: ['head'],
                            stands_for_whole: 'values',
                            views: { default: 'SAME' },
                        },
                        {
                            id: 'A',
                            name: 'A',
                            categories: ['values'],
                            views: { default: 'A' },
                        },
                        {
                            id: 'B',
                            name: 'B',
                            categories: ['values'],
                            views: { default: 'B' },
                        },
                    ],
                },
            },
            parse: { case_sensitive: true },
            render: {
                default: 'default',
                formats: [
                    {
                        id: 'default',
                        surface: 'default',
                        mode: 'inline',
                        separator: '/',
                        fields: [
                            { category: 'head' },
                            ...(hideValues
                                ? []
                                : [{ category: 'values', separator: ',' }]),
                        ],
                    },
                ],
            },
        },
    });
}
async function settle() {
    for (let i = 0; i < 50; i++) await Promise.resolve();
}

describe('whole edit contribution work', () => {
    it.each([4, 40])(
        'does not reread %i independent parts or recompute their whole rollup',
        async (count) => {
            const source = engine(false);
            const process = vi.spyOn(source, 'process');
            const aggregate = vi.spyOn(source, 'aggregateAssertions');
            const store = new VanillaEzClassifyStore(source);
            await store.publishRendered('whole', 'A');
            for (let i = 0; i < count; i++) {
                store.setPartOf(`part-${i}`, 'whole');
                await store.publishRendered(`part-${i}`, 'A');
            }
            await settle();
            process.mockClear();
            aggregate.mockClear();
            let rollups = 0;
            store.subscribeWholeRollup('whole', () => rollups++);
            await store.publishRendered('whole', 'B');
            await settle();
            expect(process).toHaveBeenCalledTimes(1);
            expect(aggregate).toHaveBeenCalledTimes(1); // page aggregate only
            expect(rollups).toBe(0);
            store.destroy();
        },
    );
    it('takes a changed whole list again, including a stand-in first read without a whole', async () => {
        const source = engine(true);
        const store = new VanillaEzClassifyStore(source);
        store.setPartOf('part', 'whole');
        await store.publishRendered('part', 'SAME');
        await settle();
        expect(
            store.get('part').assertions.some((a) => a.source === 'context'),
        ).toBe(false);
        await store.publishRendered('whole', 'A');
        await settle();
        expect(store.get('part').assertions).toContainEqual(
            expect.objectContaining({ conceptId: 'A', source: 'context' }),
        );
        await store.publishRendered('whole', 'B');
        await settle();
        expect(store.get('part').assertions).toContainEqual(
            expect.objectContaining({ conceptId: 'B', source: 'context' }),
        );
        expect(
            store.get('part').assertions.some((a) => a.conceptId === 'A'),
        ).toBe(false);
        store.destroy();
    });
    it('recomputes conservatively when an adapter omits dependency metadata', async () => {
        const source = engine(false);
        const getMeta = source.getSchemeMeta.bind(source);
        vi.spyOn(source, 'getSchemeMeta').mockImplementation(() => ({
            ...getMeta(),
            roleAware: undefined,
        }));
        const process = vi.spyOn(source, 'process');
        const store = new VanillaEzClassifyStore(source);
        store.setPartOf('part', 'whole');
        await store.publishRendered('part', 'A');
        await settle();
        process.mockClear();
        await store.publishRendered('whole', 'B');
        await settle();
        expect(process.mock.calls.length).toBeGreaterThan(1);
        store.destroy();
    });
    it('rereads inherited facts when the whole changes without a rendering change', async () => {
        const source = engine(true, true);
        const store = new VanillaEzClassifyStore(source);
        const fact = (conceptId: string, categoryId: string) =>
            ({
                conceptId,
                categoryId,
                source: 'user',
                confidence: 'certain',
            }) as const;
        await store.publishAssertions('whole', [
            fact('SAME', 'head'),
            fact('A', 'values'),
        ]);
        store.setPartOf('part', 'whole');
        await store.publishRendered('part', 'SAME');
        await settle();
        const before = store.get('whole').rendered;
        expect(store.get('part').assertions).toContainEqual(
            expect.objectContaining({ conceptId: 'A', source: 'context' }),
        );
        await store.publishAssertions('whole', [
            fact('SAME', 'head'),
            fact('B', 'values'),
        ]);
        await settle();
        expect(store.get('whole').rendered).toBe(before);
        expect(store.get('part').assertions).toContainEqual(
            expect.objectContaining({ conceptId: 'B', source: 'context' }),
        );
        expect(
            store.get('part').assertions.some((a) => a.conceptId === 'A'),
        ).toBe(false);
        store.destroy();
    });
});
