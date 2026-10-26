/**
 * Which placements of the composer's popover may scroll the page.
 *
 * A change to what the box shows may scroll the page once to make room below
 * the field. A placement that answers a scroll must not: it would scroll again
 * in answer to its own scroll, undo every scroll the user makes while the list
 * is open, and, where the page cannot move by a fraction of a pixel, never
 * stop.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ComposerController } from './composer-controller';
import { ComposerView, accessibleLabel } from './composer-view';
import { FakePort } from './composer-port-mock';
import { typeText, wait } from './composer-harness';
import { positionPopover } from './composer-placement';

vi.mock('./composer-placement', async (importOriginal) => {
    const actual =
        await importOriginal<typeof import('./composer-placement')>();
    return { ...actual, positionPopover: vi.fn(actual.positionPopover) };
});

const placed = vi.mocked(positionPopover);

let root: HTMLDivElement;
let input: HTMLInputElement;
let controller: ComposerController;
let view: ComposerView;

beforeEach(() => {
    root = document.createElement('div');
    root.innerHTML = '<label for="m">Document marking</label><input id="m" />';
    document.body.appendChild(root);
    input = root.querySelector('input')!;
    Element.prototype.scrollIntoView = vi.fn();
    controller = new ComposerController({
        port: new FakePort(),
        shape: 'whole',
        announce: (t) => view?.announce(t),
    });
    view = new ComposerView({
        controller,
        input,
        anchor: root,
        label: () => accessibleLabel(input, 'Marking'),
        singleLine: true,
    });
    root.appendChild(view.announcer);
    root.appendChild(view.note);
});

afterEach(() => {
    view.destroy();
    controller.dispose();
    root.remove();
    placed.mockClear();
});

/** The `mayScroll` argument of every placement since the last clear. */
function mayScroll(): boolean[] {
    return placed.mock.calls.map((call) => call[2] ?? false);
}

describe('placing the popover', () => {
    it('may scroll the page for what the list shows, never in answer to a scroll', async () => {
        input.focus();
        typeText(input, 'SEC');
        await wait();
        await controller.settle();
        await wait(10);
        expect(mayScroll()).toContain(true);

        placed.mockClear();
        window.dispatchEvent(new Event('scroll'));
        document.dispatchEvent(new Event('scroll'));
        window.dispatchEvent(new Event('scrollend'));
        window.dispatchEvent(new Event('resize'));
        expect(placed).toHaveBeenCalled();
        expect(mayScroll().every((may) => may === false)).toBe(true);
    });

    it('never scrolls the page once focus has left the field', async () => {
        input.focus();
        typeText(input, 'SEC');
        await wait();
        await controller.settle();
        await wait(10);

        // A press on another control takes focus; the list repaints while
        // the draft is still open (its commit is in flight).
        const other = document.createElement('button');
        root.appendChild(other);
        other.focus();
        placed.mockClear();
        await controller.input('SECRET', 6);
        await controller.settle();
        await wait(10);
        expect(placed).toHaveBeenCalled();
        expect(mayScroll().every((may) => may === false)).toBe(true);
    });
});
