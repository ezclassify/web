/**
 * Unit tests for the cross-instance mount-rollup registry, the leaf module that
 * carries a nested child scope's whole, per bucket, up to its parent scope.
 * Pure data-structure tests (no engine), covering bucket independence: two
 * buckets are carried separately and never co-mingled, including one scheme
 * read under two Contexts.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
    addChild,
    removeChild,
    childrenOf,
    registerFlusher,
    notifyParent,
    __resetMountRollupRegistry,
    type RegistryChild,
    type ChildWhole,
} from './mount-rollup-registry';
import { bucketKey, type BucketKey } from './store/store-shared';

function makeChild(
    id: string,
    wholes: Array<[BucketKey, string]>,
    collectionId: string | null = null,
): RegistryChild {
    return {
        instanceId: id,
        root: document.createElement('div'),
        collectionId,
        childWholes: () => {
            const m = new Map<BucketKey, ChildWhole>();
            for (const [bucket, rendered] of wholes) {
                m.set(bucket, { bucket, rendered, assertions: [] });
            }
            return m;
        },
    };
}

const S1 = bucketKey('', 's1');

describe('mount-rollup-registry', () => {
    beforeEach(() => __resetMountRollupRegistry());

    it('childrenOf returns only the children of the named parent', () => {
        addChild('parent-A', 'child-1', makeChild('child-1', [[S1, 'HIGH']]));
        addChild('parent-A', 'child-2', makeChild('child-2', [[S1, 'LOW']]));
        addChild('parent-B', 'child-3', makeChild('child-3', [[S1, 'MED']]));

        expect(childrenOf('parent-A').map((c) => c.instanceId)).toEqual([
            'child-1',
            'child-2',
        ]);
        expect(childrenOf('parent-B').map((c) => c.instanceId)).toEqual([
            'child-3',
        ]);
        expect(childrenOf('nobody')).toEqual([]);
    });

    it('carries one scheme under two Contexts as two buckets', () => {
        const capco = bucketKey('capco', 'tier');
        const cui = bucketKey('cui', 'tier');
        addChild(
            'parent',
            'child',
            makeChild('child', [
                [capco, 'HIGH'],
                [cui, 'LOW'],
            ]),
        );

        const [child] = childrenOf('parent');
        const wholes = child.childWholes();
        expect(wholes.size).toBe(2);
        expect(wholes.get(capco)?.rendered).toBe('HIGH');
        expect(wholes.get(cui)?.rendered).toBe('LOW');
    });

    it('keeps the collection a child is a member of in its parent', () => {
        addChild('parent', 'a', makeChild('a', [[S1, 'X']], 'folderA'));
        addChild('parent', 'b', makeChild('b', [[S1, 'Y']]));
        expect(childrenOf('parent').map((c) => c.collectionId)).toEqual([
            'folderA',
            null,
        ]);
    });

    it('removeChild drops the edge', () => {
        addChild('parent', 'child', makeChild('child', [[S1, 'X']]));
        expect(childrenOf('parent')).toHaveLength(1);
        removeChild('child');
        expect(childrenOf('parent')).toHaveLength(0);
    });

    it('notifyParent invokes the parent flusher synchronously', () => {
        let flushed = 0;
        registerFlusher('parent', () => {
            flushed++;
        });
        addChild('parent', 'child', makeChild('child', [[S1, 'X']]));
        notifyParent('child');
        expect(flushed).toBe(1);
    });

    it('notifyParent is a no-op when the child has no registered parent edge', () => {
        let flushed = 0;
        registerFlusher('orphan', () => {
            flushed++;
        });
        // No addChild → orphan has no parent edge.
        notifyParent('orphan');
        expect(flushed).toBe(0);
    });
});
