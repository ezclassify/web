import { describe, it, expect } from 'vitest';
import {
    reconcileChildren,
    readGeometry,
    COMPONENT_CSS,
    getComponentStyles,
    heightAtLeastFloor,
} from './dom-helpers';

describe('dom-helpers', () => {
    describe('heightAtLeastFloor', () => {
        it('raises a shorter or unset host min-height to the field floor', () => {
            expect(heightAtLeastFloor('0px', '32px')).toBe('32px');
            expect(heightAtLeastFloor('21.5px', '32px')).toBe('32px');
            expect(heightAtLeastFloor('auto', '32px')).toBe('32px');
        });

        it('keeps a host min-height at or above the floor', () => {
            expect(heightAtLeastFloor('44px', '32px')).toBe('44px');
            expect(heightAtLeastFloor('32px', '32px')).toBe('32px');
        });

        it('keeps the host value when either side is not a pixel length', () => {
            expect(heightAtLeastFloor('50%', '32px')).toBe('50%');
            expect(heightAtLeastFloor('0px', 'auto')).toBe('0px');
            expect(heightAtLeastFloor('0px', '0px')).toBe('0px');
        });
    });

    describe('COMPONENT_CSS', () => {
        it('is a non-empty string', () => {
            expect(typeof COMPONENT_CSS).toBe('string');
        });
    });

    describe('getComponentStyles', () => {
        it('returns the same value as COMPONENT_CSS', () => {
            expect(getComponentStyles()).toBe(COMPONENT_CSS);
        });
    });

    describe('reconcileChildren', () => {
        it('creates elements for a fresh list', () => {
            const parent = document.createElement('div');
            const items = ['a', 'b', 'c'];
            const result = reconcileChildren(
                parent,
                items,
                (s) => s,
                (s) => {
                    const el = document.createElement('span');
                    el.textContent = s;
                    return el;
                },
            );
            expect(result.length).toBe(3);
            expect(parent.children.length).toBe(3);
            expect(result[0].textContent).toBe('a');
            expect(result[2].textContent).toBe('c');
        });

        it('reuses existing elements by key', () => {
            const parent = document.createElement('div');
            const create = (s: string) => {
                const el = document.createElement('span');
                el.textContent = s;
                return el;
            };
            const first = reconcileChildren(
                parent,
                ['x', 'y'],
                (s) => s,
                create,
            );
            const xEl = first[0];

            const second = reconcileChildren(
                parent,
                ['x', 'y', 'z'],
                (s) => s,
                create,
            );
            expect(second[0]).toBe(xEl); // same DOM node reused
            expect(parent.children.length).toBe(3);
        });

        it('removes elements no longer in the list', () => {
            const parent = document.createElement('div');
            const create = (s: string) => {
                const el = document.createElement('span');
                el.textContent = s;
                return el;
            };
            reconcileChildren(parent, ['a', 'b', 'c'], (s) => s, create);
            expect(parent.children.length).toBe(3);

            reconcileChildren(parent, ['a'], (s) => s, create);
            expect(parent.children.length).toBe(1);
            expect(parent.children[0].textContent).toBe('a');
        });

        it('reorders elements to match new list order', () => {
            const parent = document.createElement('div');
            const create = (s: string) => {
                const el = document.createElement('span');
                el.textContent = s;
                return el;
            };
            reconcileChildren(parent, ['a', 'b', 'c'], (s) => s, create);
            reconcileChildren(parent, ['c', 'a', 'b'], (s) => s, create);
            expect(parent.children[0].textContent).toBe('c');
            expect(parent.children[1].textContent).toBe('a');
            expect(parent.children[2].textContent).toBe('b');
        });

        it('calls updateFn for reused elements', () => {
            const parent = document.createElement('div');
            const create = (s: string) => {
                const el = document.createElement('span');
                el.textContent = s;
                return el;
            };
            reconcileChildren(parent, ['a'], (s) => s, create);

            let updated = false;
            reconcileChildren(
                parent,
                ['a'],
                (s) => s,
                create,
                (_el, _item) => {
                    updated = true;
                },
            );
            expect(updated).toBe(true);
        });

        it('preserves trailing nodes at the end', () => {
            const parent = document.createElement('div');
            const trailing = document.createElement('input');
            trailing.className = 'filter';
            parent.appendChild(trailing);

            const create = (s: string) => {
                const el = document.createElement('span');
                el.textContent = s;
                return el;
            };
            reconcileChildren(parent, ['a', 'b'], (s) => s, create, undefined, [
                trailing,
            ]);

            // Trailing should be after reconciled items
            expect(parent.children.length).toBe(3);
            expect(parent.lastElementChild).toBe(trailing);
        });

        it('handles empty items list', () => {
            const parent = document.createElement('div');
            const create = (s: string) => {
                const el = document.createElement('span');
                el.textContent = s;
                return el;
            };
            reconcileChildren(parent, ['a', 'b'], (s) => s, create);
            const result = reconcileChildren(parent, [], (s) => s, create);
            expect(result.length).toBe(0);
            expect(parent.children.length).toBe(0);
        });

        it('sets data-reconcile-key on new elements', () => {
            const parent = document.createElement('div');
            const create = (_s: string) => {
                const el = document.createElement('span');
                return el;
            };
            reconcileChildren(parent, ['k1', 'k2'], (s) => s, create);
            const first = parent.children[0] as HTMLElement;
            expect(first.dataset.reconcileKey).toBe('k1');
        });
    });

    describe('readGeometry', () => {
        it('returns DOMRect array matching input length', () => {
            const a = document.createElement('div');
            const b = document.createElement('div');
            const rects = readGeometry(a, b);
            expect(rects.length).toBe(2);
        });

        it('returns empty DOMRect for null elements', () => {
            const rects = readGeometry(null, null);
            expect(rects.length).toBe(2);
            expect(rects[0].width).toBe(0);
            expect(rects[0].height).toBe(0);
        });

        it('returns empty array when called with no arguments', () => {
            const rects = readGeometry();
            expect(rects.length).toBe(0);
        });

        it('returns a rect object for non-null elements', () => {
            const el = document.createElement('div');
            document.body.appendChild(el);
            const rects = readGeometry(el);
            expect(rects[0]).toBeDefined();
            expect(typeof rects[0].width).toBe('number');
            expect(typeof rects[0].height).toBe('number');
            el.remove();
        });
    });
});
