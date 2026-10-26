/**
 * Unit tests for the cross-instance mount-rollup registry, the leaf module that
 * carries a nested child scope's per-scheme whole up to its parent scope. Pure
 * data-structure tests (no engine / DOM), covering the cross-family
 * independence rule: distinct scheme ids are carried as SEPARATE buckets and
 * never co-mingled.
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

function makeChild(id: string, wholes: Array<[string, string]>): RegistryChild {
    return {
        instanceId: id,
        childWholesByScheme: () => {
            const m = new Map<string, ChildWhole>();
            for (const [schemeId, rendered] of wholes) {
                m.set(schemeId, { schemeId, rendered, assertions: [] });
            }
            return m;
        },
    };
}

describe('mount-rollup-registry', () => {
    beforeEach(() => __resetMountRollupRegistry());

    it('childrenOf returns only the children of the named parent', () => {
        addChild('parent-A', 'child-1', makeChild('child-1', [['s1', 'HIGH']]));
        addChild('parent-A', 'child-2', makeChild('child-2', [['s1', 'LOW']]));
        addChild('parent-B', 'child-3', makeChild('child-3', [['s1', 'MED']]));

        expect(childrenOf('parent-A').map((c) => c.instanceId)).toEqual([
            'child-1',
            'child-2',
        ]);
        expect(childrenOf('parent-B').map((c) => c.instanceId)).toEqual([
            'child-3',
        ]);
        expect(childrenOf('nobody')).toEqual([]);
    });

    it('carries distinct scheme ids as separate buckets (cross-family independence)', () => {
        addChild(
            'parent',
            'child',
            makeChild('child', [
                ['cedar-valley-protection', 'DISTRICT COORDINATORS'],
                ['tlp', 'TLP:AMBER'],
            ]),
        );

        const [child] = childrenOf('parent');
        const wholes = child.childWholesByScheme();
        // Two distinct scheme ids → two distinct entries, never merged into one.
        expect(wholes.size).toBe(2);
        expect(wholes.get('cedar-valley-protection')?.rendered).toBe(
            'DISTRICT COORDINATORS',
        );
        expect(wholes.get('tlp')?.rendered).toBe('TLP:AMBER');
    });

    it('removeChild drops the edge', () => {
        addChild('parent', 'child', makeChild('child', [['s1', 'X']]));
        expect(childrenOf('parent')).toHaveLength(1);
        removeChild('child');
        expect(childrenOf('parent')).toHaveLength(0);
    });

    it('notifyParent invokes the parent flusher synchronously', () => {
        let flushed = 0;
        registerFlusher('parent', () => {
            flushed++;
        });
        addChild('parent', 'child', makeChild('child', [['s1', 'X']]));
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
