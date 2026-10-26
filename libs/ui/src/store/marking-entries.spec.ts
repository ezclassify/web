import { describe, expect, it } from 'vitest';
import { VanillaEzClassifyStore } from './ezclassify-store';
import { createLatencyEngineHarness } from './latency-engine-harness';

function setup() {
    return new VanillaEzClassifyStore(createLatencyEngineHarness().engine);
}
describe('ordered marking entry membership', () => {
    it('holds immutable snapshots and keeps marking state in ordinary entries', () => {
        const store = setup();
        const ids = ['first', 'second'];
        store.setEntryIds('body', ids);
        ids.reverse();
        expect(store.getEntryIds('body')).toEqual(['first', 'second']);
        expect(Object.isFrozen(store.getEntryIds('body'))).toBe(true);
        expect(store.get('first').assertions).toEqual([]);
        store.destroy();
    });
    it('commits additions, removals, reorder and empty with origin cycle protection', () => {
        const store = setup();
        const source = { token: {} };
        const seen: (readonly string[])[] = [];
        let echoed = 0;
        store.subscribeEntries('body', (ids) => seen.push(ids));
        store.subscribeEntries('body', () => echoed++, source);
        store.setEntryIds('body', ['a', 'b'], source);
        store.setEntryIds('body', ['b', 'a'], source);
        store.setEntryIds('body', ['a'], source);
        store.setEntryIds('body', [], source);
        expect(seen).toEqual([['a', 'b'], ['b', 'a'], ['a'], []]);
        expect(echoed).toBe(0);
        store.destroy();
    });
    it.each([{ ids: ['same', 'same'] }, { ids: [''] }, { ids: ['body'] }])(
        'rejects ambiguous membership %j without changing committed IDs',
        ({ ids }) => {
            const store = setup();
            store.setEntryIds('body', ['kept']);
            expect(() => store.setEntryIds('body', ids)).toThrow();
            expect(store.getEntryIds('body')).toEqual(['kept']);
            store.destroy();
        },
    );
});
