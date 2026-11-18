import { describe, it, expect } from 'vitest';
import { focusGridRows, focusGridNeighbor } from './focus-grid';

function item(left: number, top: number, width = 40, height = 30) {
    const element = document.createElement('button');
    element.getBoundingClientRect = () =>
        ({
            left,
            top,
            right: left + width,
            bottom: top + height,
            width,
            height,
            x: left,
            y: top,
            toJSON: () => ({}),
        }) as DOMRect;
    return element;
}

describe('physical option grid', () => {
    it('orders visual rows and physical neighbors independently of DOM/RTL order', () => {
        const a = item(0, 0),
            b = item(70, 0),
            c = item(0, 60),
            d = item(90, 60);
        const items = [d, b, c, a];
        expect(focusGridRows(items)).toEqual([
            [a, b],
            [c, d],
        ]);
        expect(focusGridNeighbor(items, a, 'ArrowRight')).toBe(b);
        expect(focusGridNeighbor(items, b, 'ArrowLeft')).toBe(a);
        expect(focusGridNeighbor(items, a, 'ArrowDown')).toBe(c);
        expect(focusGridNeighbor(items, d, 'ArrowUp')).toBe(b);
        expect(focusGridNeighbor(items, a, 'ArrowLeft')).toBeNull();
        expect(focusGridNeighbor(items, b, 'ArrowRight')).toBeNull();
        expect(focusGridNeighbor(items, a, 'ArrowUp')).toBeNull();
        expect(focusGridNeighbor(items, d, 'ArrowDown')).toBeNull();
    });
    it('groups unequal overlapping heights and picks the nearest horizontal center', () => {
        const a = item(0, 0, 100, 50),
            b = item(120, 10, 40, 30),
            c = item(35, 70, 40),
            d = item(100, 70, 40);
        expect(focusGridRows([a, b, c, d])).toEqual([
            [a, b],
            [c, d],
        ]);
        expect(focusGridNeighbor([a, b, c, d], a, 'ArrowDown')).toBe(c);
        expect(focusGridNeighbor([a, b, c, d], b, 'ArrowDown')).toBe(d);
    });
    it('uses current layout after reflow and returns null for absent or empty targets', () => {
        const a = item(0, 0),
            b = item(60, 0),
            items = [a, b];
        expect(focusGridNeighbor(items, a, 'ArrowRight')).toBe(b);
        b.getBoundingClientRect = item(0, 60).getBoundingClientRect;
        expect(focusGridNeighbor(items, a, 'ArrowRight')).toBeNull();
        expect(focusGridNeighbor(items, a, 'ArrowDown')).toBe(b);
        expect(focusGridNeighbor([], a, 'ArrowDown')).toBeNull();
        expect(focusGridNeighbor(items, item(0, 0), 'ArrowDown')).toBeNull();
    });
});
