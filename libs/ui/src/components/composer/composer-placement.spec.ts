/**
 * Placement of the composer's surface: the popover cases (the placement
 * engine's standing suite, against the same geometry as any suggestion list)
 * and the side-lock, side-release and sheet cases.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
    isInternalScroll,
    listenForViewportChanges,
    popoverSide,
    positionPopover,
    positionSheet,
    revealRow,
    visibleViewportBand,
    type PopoverPlacement,
    revealClearOfPinned,
} from './composer-placement';

Element.prototype.scrollIntoView = vi.fn();

type TestPlacement = {
    -readonly [K in keyof PopoverPlacement]: HTMLElement;
} & { input: HTMLInputElement };

function createDropdownContext(): TestPlacement {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const bounds = document.createElement('div');
    container.appendChild(bounds);
    const anchor = document.createElement('div');
    bounds.appendChild(anchor);
    const input = document.createElement('input');
    anchor.appendChild(input);
    const surface = document.createElement('div');
    document.body.appendChild(surface);
    const list = document.createElement('div');
    surface.appendChild(list);
    return { surface, list, input, anchor, bounds };
}

describe('positionPopover', () => {
    afterEach(() => {
        document.body.innerHTML = '';
    });

    it('opens above an inline body editor without treating its own clear control as an obstacle', () => {
        const ctx = createDropdownContext();
        const rect = (top: number, height: number) =>
            ({
                left: 40,
                right: 400,
                top,
                bottom: top + height,
                width: 360,
                height,
                x: 40,
                y: top,
                toJSON: () => ({}),
            }) as DOMRect;
        ctx.anchor.getBoundingClientRect = () => rect(700, 24);
        ctx.input.getBoundingClientRect = () => rect(700, 24);
        ctx.bounds.getBoundingClientRect = () => rect(610, 140);
        const clear = document.createElement('button');
        ctx.bounds.appendChild(clear);
        clear.getBoundingClientRect = () => rect(620, 32);
        Object.defineProperty(ctx.surface, 'offsetWidth', { value: 360 });
        Object.defineProperty(ctx.surface, 'scrollHeight', { value: 260 });
        Object.defineProperty(ctx.list, 'scrollHeight', { value: 180 });

        const placed = positionPopover(
            Object.assign(ctx, { field: ctx.bounds }),
            false,
        );

        expect(placed.fits).toBe(true);
        expect(ctx.surface.dataset.side).toBe('above');
        expect(ctx.surface.style.maxHeight).toBe('');
        expect(Number.parseFloat(ctx.surface.style.top)).toBeLessThan(450);

        const outside = document.createElement('button');
        document.body.appendChild(outside);
        outside.getBoundingClientRect = () => rect(600, 40);
        expect(
            positionPopover(Object.assign(ctx, { field: ctx.bounds }), false)
                .fits,
        ).toBe(false);
    });

    it('uses viewport positioning so overflow ancestors cannot clip it', () => {
        const ctx = createDropdownContext();
        ctx.surface.style.display = 'block';
        Object.defineProperty(ctx.surface, 'offsetWidth', { value: 320 });
        Object.defineProperty(ctx.surface, 'scrollHeight', { value: 240 });
        ctx.input.getBoundingClientRect = () =>
            ({
                left: 60,
                right: 160,
                top: 160,
                bottom: 190,
                width: 100,
                height: 30,
                x: 60,
                y: 160,
                toJSON: () => ({}),
            }) as DOMRect;
        ctx.bounds.getBoundingClientRect = () =>
            ({
                left: 40,
                right: 680,
                top: 140,
                bottom: 200,
                width: 640,
                height: 60,
                x: 40,
                y: 140,
                toJSON: () => ({}),
            }) as DOMRect;
        ctx.anchor.getBoundingClientRect = () =>
            ({
                left: 40,
                right: 680,
                top: 150,
                bottom: 200,
                width: 640,
                height: 50,
                x: 40,
                y: 150,
                toJSON: () => ({}),
            }) as DOMRect;

        positionPopover(ctx, false);

        expect(ctx.surface.style.position).toBe('fixed');
        expect(ctx.surface.style.left).toBe('60px');
        expect(ctx.surface.style.top).toBe('204px');
        expect(ctx.surface.style.bottom).toBe('auto');
    });

    it('never squeezes the list under a row behind tall chrome when the room holds one', () => {
        const ctx = createDropdownContext();
        ctx.surface.style.display = 'block';
        const row = document.createElement('div');
        row.setAttribute('role', 'option');
        Object.defineProperty(row, 'offsetHeight', { value: 44 });
        ctx.list.appendChild(row);
        // A long list under 340px of chrome.
        Object.defineProperty(ctx.list, 'scrollHeight', { value: 600 });
        Object.defineProperty(ctx.surface, 'scrollHeight', { value: 940 });
        Object.defineProperty(ctx.surface, 'offsetWidth', { value: 320 });
        const field = {
            left: 60,
            right: 380,
            top: 100,
            bottom: 140,
            width: 320,
            height: 40,
            x: 60,
            y: 100,
            toJSON: () => ({}),
        } as DOMRect;
        ctx.input.getBoundingClientRect = () => field;
        ctx.anchor.getBoundingClientRect = () => field;
        ctx.bounds.getBoundingClientRect = () => field;

        positionPopover(ctx, false);

        // The box is tall enough for its chrome and a row: it does not scroll
        // inside itself with the row hidden under the chrome.
        expect(ctx.surface.style.maxHeight).toBe('');
        expect(
            Number.parseFloat(ctx.list.style.maxHeight),
        ).toBeGreaterThanOrEqual(44);
        expect(ctx.surface.dataset.side).toBe('below');
    });

    it('measures fixed chrome after lifting a previous whole-surface clamp', () => {
        const ctx = createDropdownContext();
        const row = document.createElement('div');
        row.setAttribute('role', 'option');
        Object.defineProperty(row, 'offsetHeight', { value: 58 });
        row.className = 'ez-composer__row--active';
        const group = document.createElement('div');
        group.setAttribute('role', 'group');
        const heading = document.createElement('div');
        heading.className = 'ez-composer__group-label';
        Object.defineProperty(heading, 'offsetHeight', { value: 32 });
        group.append(heading, row);
        ctx.list.appendChild(group);
        Object.defineProperty(ctx.list, 'scrollHeight', { value: 600 });
        Object.defineProperty(ctx.surface, 'offsetWidth', { value: 320 });
        Object.defineProperty(ctx.surface, 'scrollHeight', {
            get: () => (ctx.surface.style.maxHeight ? 250 : 1200),
        });
        const field = {
            left: 60,
            right: 380,
            top: 460,
            bottom: 500,
            width: 320,
            height: 40,
        } as DOMRect;
        ctx.input.getBoundingClientRect = () => field;
        ctx.anchor.getBoundingClientRect = () => field;
        ctx.bounds.getBoundingClientRect = () => field;
        let clamp = '250px';
        let scroll = 40;
        Object.defineProperty(ctx.surface.style, 'maxHeight', {
            get: () => clamp,
            set: (value: string) => {
                clamp = value;
                if (!value) scroll = 0;
            },
        });
        Object.defineProperty(ctx.surface, 'scrollTop', {
            get: () => scroll,
            set: (value: number) => {
                scroll = value;
            },
        });
        positionPopover(ctx, false);
        expect(ctx.list.style.maxHeight).toBe('90px');
        expect(ctx.surface.style.maxHeight).toBe('448px');
        expect(ctx.surface.style.overflowY).toBe('auto');
        expect(ctx.surface.scrollTop).toBe(40);
    });

    it('keeps the list in the viewport when an offscreen anchor is focused programmatically', () => {
        const ctx = createDropdownContext();
        ctx.surface.style.display = 'block';
        Object.defineProperty(ctx.surface, 'offsetWidth', { value: 320 });
        Object.defineProperty(ctx.surface, 'scrollHeight', { value: 240 });
        const belowViewport = {
            left: 60,
            right: 680,
            top: 900,
            bottom: 950,
            width: 620,
            height: 50,
            x: 60,
            y: 900,
            toJSON: () => ({}),
        } as DOMRect;
        ctx.input.getBoundingClientRect = () => belowViewport;
        ctx.bounds.getBoundingClientRect = () => belowViewport;
        ctx.anchor.getBoundingClientRect = () => belowViewport;

        positionPopover(ctx, false);

        const top = Number.parseFloat(ctx.surface.style.top);
        expect(top).toBeGreaterThanOrEqual(8);
        expect(top + 240).toBeLessThanOrEqual(window.innerHeight - 8);
    });

    it('places a flipped-above dropdown using the SAME height it actually paints, not a smaller pre-relax measurement', () => {
        // Every real consumer of positionDropdown appends exactly ONE child
        // (the items list; see tag-input.ts/marking-field.ts/
        // inline-marking-editor.ts), so chromeHeight is always 0 in
        // production. The failure this guards against: reading `dropHeight`
        // from `dropdown.scrollHeight` while a SMALLER clamp is still in
        // effect on `dropdownItems` (the CSS class's static
        // `max-height: 17.5rem` on a first open, or a leftover inline clamp
        // from an open at a different viewport size), then relaxing that same
        // element's inline `maxHeight` to a LARGER budget (up to 300px)
        // without re-measuring. Flipped above, `top` would be computed
        // against the smaller number while the box paints at the larger one,
        // so its real bottom edge would land inside the field instead of
        // flush above it.
        //
        // `dropdown.scrollHeight` is mocked as a GETTER that reacts to
        // `dropdownItems.style.maxHeight`, the same way a real browser's
        // outer box (no `overflow` rule of its own; see
        // component-utils.css's `.proto-dropdown`) reports however tall its
        // one child currently renders. `dropdownItems.scrollHeight` stays a
        // flat natural-content value, matching the real DOM contract that
        // scrollHeight ignores overflow/max-height clamps entirely. This is
        // what makes the test sensitive to the actual fix: removing the
        // `ctx.list.style.maxHeight = 'none'` reset before
        // measurement reintroduces the exact stale-clamp basis mismatch
        // this test exists to catch.
        const ctx = createDropdownContext();
        ctx.surface.style.display = 'block';
        Object.defineProperty(ctx.surface, 'offsetWidth', { value: 320 });

        const naturalItemsHeight = 1000; // a long list, past every cap below
        Object.defineProperty(ctx.list, 'scrollHeight', {
            value: naturalItemsHeight,
        });
        Object.defineProperty(ctx.surface, 'scrollHeight', {
            get: () => {
                const clamp = ctx.list.style.maxHeight;
                const clampPx = Number.parseFloat(clamp);
                return clamp && clamp !== 'none' && Number.isFinite(clampPx)
                    ? Math.min(naturalItemsHeight, clampPx)
                    : naturalItemsHeight;
            },
        });
        // Seed a stale, much-too-small clamp, as if a previous open at a
        // cramped viewport left the items region capped well under this
        // open's real budget.
        ctx.list.style.maxHeight = '150px';

        // Close enough to the bottom edge that spaceBelow (60) is smaller
        // than spaceAbove (392): the dropdown must flip above.
        const nearBottom = {
            left: 60,
            right: 380,
            top: 400,
            bottom: 700,
            width: 320,
            height: 300,
            x: 60,
            y: 400,
            toJSON: () => ({}),
        } as DOMRect;
        ctx.input.getBoundingClientRect = () => nearBottom;
        ctx.bounds.getBoundingClientRect = () => nearBottom;
        ctx.anchor.getBoundingClientRect = () => nearBottom;

        positionPopover(ctx, false);

        // Whatever height the code decided to paint the items region at.
        const paintedItemsHeight = Number.parseFloat(ctx.list.style.maxHeight);
        expect(paintedItemsHeight).toBeGreaterThan(0);
        // It must be the SAME height `top` was computed against: the real
        // bottom edge (top + painted height) sits flush above the field,
        // never inside it.
        const top = Number.parseFloat(ctx.surface.style.top);
        expect(top + paintedItemsHeight).toBeLessThanOrEqual(
            nearBottom.top - 3,
        );
    });

    it('still reserves room for fixed dropdown chrome beyond the items list, if a future consumer ever adds any', () => {
        // positionDropdown splits items from fixed chrome, so a consumer that
        // appends chrome beyond the items list still gets room reserved for
        // it. Keeps the math honest for that shape.
        const ctx = createDropdownContext();
        ctx.surface.style.display = 'block';
        Object.defineProperty(ctx.surface, 'offsetWidth', { value: 320 });
        // Items alone (1000) exceed the 300px budget; the outer box's
        // natural height (1040) is items (1000) plus a 40px hypothetical
        // footer.
        Object.defineProperty(ctx.list, 'scrollHeight', {
            value: 1000,
        });
        Object.defineProperty(ctx.surface, 'scrollHeight', { value: 1040 });

        // Close enough to the bottom edge that spaceBelow (60) is smaller than
        // spaceAbove (392): the dropdown must flip above.
        const nearBottom = {
            left: 60,
            right: 380,
            top: 400,
            bottom: 700,
            width: 320,
            height: 300,
            x: 60,
            y: 400,
            toJSON: () => ({}),
        } as DOMRect;
        ctx.input.getBoundingClientRect = () => nearBottom;
        ctx.bounds.getBoundingClientRect = () => nearBottom;
        ctx.anchor.getBoundingClientRect = () => nearBottom;

        positionPopover(ctx, false);

        // The list must be capped BELOW the full 360px budget, leaving the
        // 40px the surface's chrome (result row, footer) needs.
        expect(ctx.list.style.maxHeight).toBe('320px');

        // The box's real rendered height is items (as actually painted) plus
        // the 40px footer, matching the budget `top` was computed against.
        const paintedItemsHeight = Number.parseFloat(ctx.list.style.maxHeight);
        const top = Number.parseFloat(ctx.surface.style.top);
        expect(top + paintedItemsHeight + 40).toBeLessThanOrEqual(
            nearBottom.top - 3,
        );
    });

    it('never collapses the items region to zero height, even if hypothetical chrome exceeds the whole budget', () => {
        // Chrome (result row, needed strip, footer) taller than the box
        // budget must not zero the list out: a list rendered at 0px is worse
        // than a small scrollable one, so the list keeps a floor.
        const ctx = createDropdownContext();
        ctx.surface.style.display = 'block';
        Object.defineProperty(ctx.surface, 'offsetWidth', { value: 320 });
        // itemsNaturalHeight (50) + a hypothetical 400px of chrome comfortably
        // exceeds the largest possible availableTotal (300, or the 100px
        // floor in a cramped viewport below).
        Object.defineProperty(ctx.list, 'scrollHeight', {
            value: 50,
        });
        Object.defineProperty(ctx.surface, 'scrollHeight', { value: 450 });

        // A viewport with very little room either side pins availableTotal
        // at its 100px floor, well under the 400px of chrome.
        const cramped = {
            left: 60,
            right: 380,
            top: 150,
            bottom: 170,
            width: 320,
            height: 20,
            x: 60,
            y: 150,
            toJSON: () => ({}),
        } as DOMRect;
        ctx.input.getBoundingClientRect = () => cramped;
        ctx.bounds.getBoundingClientRect = () => cramped;
        ctx.anchor.getBoundingClientRect = () => cramped;

        positionPopover(ctx, false);

        const paintedItemsHeight = Number.parseFloat(ctx.list.style.maxHeight);
        expect(paintedItemsHeight).toBeGreaterThan(0);
    });

    it('preserves scroll position across a reposition instead of yanking the list back to row 0', () => {
        // `positionDropdown` clears `dropdownItems.style.maxHeight` to `'none'`
        // before measuring (see the comment on that line), which lifts the only
        // thing making the list scrollable: with no max-height, the box grows
        // to fit its full content, `clientHeight` becomes `scrollHeight`, and a
        // real browser clamps `scrollTop` to 0 because there is no overflow
        // left to scroll into. Restoring the max-height afterward does NOT
        // restore the old scrollTop; that clamp is one-way. Left alone, a user
        // scrolled to row 20 in an open list who then two-finger-scrolls the
        // page (a legitimate reposition, not a selection) gets yanked back to
        // row 0 mid-selection every time the dropdown re-anchors.  jsdom has no
        // layout engine, so neither `scrollTop` nor `style.maxHeight` carries
        // any real side effect on the other: both must be mocked here to
        // reproduce the real browser's one-way clamp, the same technique the
        // flipped-above test above uses for `scrollHeight`. The clamp is
        // destructive at the moment `maxHeight` is set to `'none'` (a real
        // browser drops the stored scroll offset right then, as a consequence
        // of the box losing its only scrollable overflow): a scrollTop setter
        // that merely IGNORES writes while `maxHeight` is `'none'` would not
        // reproduce the failure, since the destruction has to happen on the
        // `maxHeight` write.
        const ctx = createDropdownContext();
        ctx.surface.style.display = 'block';
        Object.defineProperty(ctx.surface, 'offsetWidth', { value: 320 });
        Object.defineProperty(ctx.list, 'scrollHeight', {
            value: 1000,
        });
        Object.defineProperty(ctx.surface, 'scrollHeight', { value: 1000 });

        let scrollTopValue = 0;
        Object.defineProperty(ctx.list, 'scrollTop', {
            get: () => scrollTopValue,
            set: (v: number) => {
                scrollTopValue = v;
            },
            configurable: true,
        });
        let maxHeightValue = '';
        Object.defineProperty(ctx.list.style, 'maxHeight', {
            get: () => maxHeightValue,
            set: (v: string) => {
                maxHeightValue = v;
                if (v === 'none') scrollTopValue = 0;
            },
            configurable: true,
        });
        ctx.list.style.maxHeight = '260px';
        ctx.list.scrollTop = 400; // user has scrolled to row ~20

        const anchor = {
            left: 60,
            right: 380,
            top: 100,
            bottom: 130,
            width: 320,
            height: 30,
            x: 60,
            y: 100,
            toJSON: () => ({}),
        } as DOMRect;
        ctx.input.getBoundingClientRect = () => anchor;
        ctx.bounds.getBoundingClientRect = () => anchor;
        ctx.anchor.getBoundingClientRect = () => anchor;

        // A page/ancestor scroll or viewport resize re-anchors an already-open
        // dropdown by calling positionDropdown again: the exact path that
        // must not disturb the user's place in the list.
        positionPopover(ctx, false);

        expect(ctx.list.scrollTop).toBe(400);
    });
});

/**
 * A stand-in for `window.visualViewport`. jsdom has none, and iOS is the case
 * under test: the keyboard shrinks (and may pan) the visual viewport while
 * `window.innerHeight` stays at the full layout height.
 */
class FakeVisualViewport extends EventTarget {
    constructor(
        public width: number,
        public height: number,
        public offsetTop = 0,
        public offsetLeft = 0,
    ) {
        super();
    }
}

function installVisualViewport(vv: FakeVisualViewport | undefined): void {
    Object.defineProperty(window, 'visualViewport', {
        configurable: true,
        value: vv,
    });
}

function rectAt(top: number, bottom: number, left = 16, right = 374): DOMRect {
    return {
        left,
        right,
        top,
        bottom,
        width: right - left,
        height: bottom - top,
        x: left,
        y: top,
        toJSON: () => ({}),
    } as DOMRect;
}

/**
 * A context whose list naturally wants `naturalHeight` px, anchored at
 * `anchor`.
 */
function anchoredContext(
    anchor: DOMRect,
    naturalHeight: number,
): TestPlacement {
    const ctx = createDropdownContext();
    ctx.surface.style.display = 'block';
    Object.defineProperty(ctx.surface, 'offsetWidth', { value: 320 });
    Object.defineProperty(ctx.list, 'scrollHeight', {
        value: naturalHeight,
    });
    Object.defineProperty(ctx.surface, 'scrollHeight', {
        value: naturalHeight,
    });
    ctx.input.getBoundingClientRect = () => anchor;
    ctx.bounds.getBoundingClientRect = () => anchor;
    ctx.anchor.getBoundingClientRect = () => anchor;
    return ctx;
}

/** The painted box: top from style, height = min(natural, applied clamp). */
function paintedBox(
    ctx: TestPlacement,
    naturalHeight: number,
): { top: number; bottom: number } {
    const top = Number.parseFloat(ctx.surface.style.top);
    const clamp = Number.parseFloat(ctx.list.style.maxHeight);
    // A box with too little room for even one row is capped as a whole.
    const cap = Number.parseFloat(ctx.surface.style.maxHeight) || Infinity;
    return { top, bottom: top + Math.min(naturalHeight, clamp, cap) };
}

describe('positionPopover against the visual viewport (on-screen keyboard)', () => {
    const originalVisualViewport = window.visualViewport;

    afterEach(() => {
        installVisualViewport(originalVisualViewport ?? undefined);
        document.body.innerHTML = '';
    });

    it('keeps the 4px gap when a flipped list fills all the room above the field', () => {
        // Regression: the room above counted the 8px edge margin but not the
        // 4px gap, so a list that filled it was pushed down onto the field.
        installVisualViewport(new FakeVisualViewport(390, 450));
        const ctx = anchoredContext(rectAt(300, 340), 1000);

        positionPopover(ctx, false);

        const box = paintedBox(ctx, 1000);
        expect(ctx.surface.dataset.side).toBe('above');
        expect(box.top).toBeGreaterThanOrEqual(8);
        expect(box.bottom).toBeLessThanOrEqual(300 - 4);
    });

    it('counts the box borders and a host top margin in where the box really paints', () => {
        // scrollHeight leaves out borders, and `top` leaves out a margin a
        // host stylesheet may add. Unaccounted, a flipped list that fills
        // the room above the field lands a few pixels onto it.
        installVisualViewport(new FakeVisualViewport(390, 450));
        const ctx = anchoredContext(rectAt(300, 340), 1000);
        ctx.surface.style.border = '1px solid black';
        ctx.surface.style.marginTop = '4px';

        positionPopover(ctx, false);

        const boxTop = Number.parseFloat(ctx.surface.style.top) + 4;
        const boxBottom =
            boxTop +
            1 +
            Math.min(1000, Number.parseFloat(ctx.list.style.maxHeight)) +
            1;
        expect(ctx.surface.dataset.side).toBe('above');
        expect(boxTop).toBeGreaterThanOrEqual(8);
        expect(boxBottom).toBeLessThanOrEqual(300 - 4);
    });

    it('keeps a list anchored mid-screen out from under the keyboard by opening above', () => {
        // 390x844 phone, keyboard up: 450px visible. jsdom's innerHeight stays
        // 768, so sizing from the layout viewport would open below and paint
        // down to about y=584, well under the keyboard's top edge at 450.
        installVisualViewport(new FakeVisualViewport(390, 450));
        const ctx = anchoredContext(rectAt(300, 340), 400);

        positionPopover(ctx, false);

        const box = paintedBox(ctx, 400);
        expect(ctx.surface.dataset.side).toBe('above');
        expect(box.top).toBeGreaterThanOrEqual(8);
        expect(box.bottom).toBeLessThanOrEqual(300);
        expect(box.bottom).toBeLessThanOrEqual(450 - 8);
    });

    it('opens below and stops at the keyboard when the field sits near the top', () => {
        // More room below (282px) than above (112px), but less than the 300px
        // cap: the layout-viewport budget would run the list 22px past the
        // keyboard's top edge.
        installVisualViewport(new FakeVisualViewport(390, 450));
        const ctx = anchoredContext(rectAt(120, 160), 1000);

        positionPopover(ctx, false);

        const box = paintedBox(ctx, 1000);
        expect(ctx.surface.dataset.side).toBe('below');
        expect(box.top).toBeGreaterThanOrEqual(160);
        expect(box.bottom).toBeLessThanOrEqual(450 - 8);
    });

    it('follows a panned visual viewport (offsetTop) instead of the layout origin', () => {
        // iOS pans the visual viewport to keep the caret in view: the visible
        // band is y=200..650 in client coordinates.
        installVisualViewport(new FakeVisualViewport(390, 450, 200));
        const low = anchoredContext(rectAt(600, 640), 400);

        positionPopover(low, false);

        const lowBox = paintedBox(low, 400);
        expect(low.surface.dataset.side).toBe('above');
        expect(lowBox.top).toBeGreaterThanOrEqual(200 + 8);
        expect(lowBox.bottom).toBeLessThanOrEqual(600);

        // 272px left below the field inside the band; measured from y=0 the
        // budget would be the full 300px and run past the band's bottom.
        const mid = anchoredContext(rectAt(330, 370), 400);
        positionPopover(mid, false);
        const midBox = paintedBox(mid, 400);
        expect(mid.surface.dataset.side).toBe('below');
        expect(midBox.top).toBeGreaterThanOrEqual(370);
        expect(midBox.bottom).toBeLessThanOrEqual(650 - 8);
    });

    it('never lets the 100px floor push rows past a very short visible band', () => {
        installVisualViewport(new FakeVisualViewport(390, 120));
        const ctx = anchoredContext(rectAt(50, 70), 1000);

        positionPopover(ctx, false);

        const box = paintedBox(ctx, 1000);
        expect(box.top).toBeGreaterThanOrEqual(8);
        expect(box.bottom).toBeLessThanOrEqual(120 - 8);
    });

    it('clamps the left edge to a horizontally panned (pinch-zoomed) band', () => {
        installVisualViewport(new FakeVisualViewport(390, 450, 0, 300));
        const ctx = anchoredContext(rectAt(40, 80, 0, 900), 200);

        positionPopover(ctx, false);

        const left = Number.parseFloat(ctx.surface.style.left);
        expect(left).toBeGreaterThanOrEqual(300 + 8);
        expect(left + 320).toBeLessThanOrEqual(300 + 390 - 8);
    });

    it('keeps rows out from under affixed status banners', () => {
        // The banners sit above every overlay on purpose, so the list has to
        // stay off them rather than slide its first or last rows beneath.
        const topBar = document.createElement('div');
        topBar.className = 'ez-banner-affix-top';
        topBar.getBoundingClientRect = () => rectAt(0, 60, 0, 390);
        const bottomBar = document.createElement('div');
        bottomBar.className = 'ez-banner-affix-bottom';
        bottomBar.getBoundingClientRect = () => rectAt(800, 844, 0, 390);
        document.body.append(topBar, bottomBar);

        // Keyboard up, field mid-band: flips above and stops below the top
        // banner instead of at the bare viewport edge.
        installVisualViewport(new FakeVisualViewport(390, 450));
        const under = anchoredContext(rectAt(330, 370), 1000);
        positionPopover(under, false);
        const underBox = paintedBox(under, 1000);
        expect(under.surface.dataset.side).toBe('above');
        expect(underBox.top).toBeGreaterThanOrEqual(60 + 8);
        expect(underBox.bottom).toBeLessThanOrEqual(330 - 4);

        // No keyboard: the bottom banner (under the keyboard on iOS, so off
        // the band there) is an edge too.
        installVisualViewport(new FakeVisualViewport(390, 844));
        const over = anchoredContext(rectAt(470, 510), 1000);
        positionPopover(over, false);
        const overBox = paintedBox(over, 1000);
        expect(overBox.top).toBeGreaterThanOrEqual(60 + 8);
        expect(overBox.bottom).toBeLessThanOrEqual(800 - 8);
        expect(overBox.bottom <= 470 || overBox.top >= 510).toBe(true);
    });

    it('clears the input as well as a shorter wrap the input overflows', () => {
        // The inline editor's input keeps a touch-sized height taller than its
        // wrap. Anchoring on the wrap alone put a flipped list over the input.
        installVisualViewport(new FakeVisualViewport(390, 450));
        const ctx = anchoredContext(rectAt(330, 348), 1000);
        ctx.input.getBoundingClientRect = () => rectAt(321, 357);

        positionPopover(ctx, false);

        const box = paintedBox(ctx, 1000);
        expect(ctx.surface.dataset.side).toBe('above');
        expect(box.bottom).toBeLessThanOrEqual(321 - 4);
    });

    it('falls back to the layout viewport where visualViewport is missing', () => {
        installVisualViewport(undefined);
        expect(visibleViewportBand()).toEqual({
            top: 0,
            bottom: window.innerHeight,
            left: 0,
            right: window.innerWidth,
        });
    });
});

describe('listenForViewportChanges', () => {
    const originalVisualViewport = window.visualViewport;

    afterEach(() => {
        installVisualViewport(originalVisualViewport ?? undefined);
    });

    it('fires on window resize and on visual viewport resize and scroll, and unsubscribes all three', () => {
        const vv = new FakeVisualViewport(390, 844);
        installVisualViewport(vv);
        const handler = vi.fn();

        const stop = listenForViewportChanges(handler);
        window.dispatchEvent(new Event('resize'));
        vv.dispatchEvent(new Event('resize'));
        vv.dispatchEvent(new Event('scroll'));
        expect(handler).toHaveBeenCalledTimes(3);

        stop();
        window.dispatchEvent(new Event('resize'));
        vv.dispatchEvent(new Event('resize'));
        vv.dispatchEvent(new Event('scroll'));
        expect(handler).toHaveBeenCalledTimes(3);
    });
});

describe('popoverSide', () => {
    afterEach(() => {
        document.body.innerHTML = '';
    });

    it('defaults to "below" before any positioning pass', () => {
        const ctx = createDropdownContext();
        expect(popoverSide(ctx.surface)).toBe('below');
    });

    it('reports "below" or "above" matching the branch positionDropdown took, for drawer/chrome callers to mirror', () => {
        const ctx = createDropdownContext();
        ctx.surface.style.display = 'block';
        Object.defineProperty(ctx.surface, 'offsetWidth', { value: 320 });
        Object.defineProperty(ctx.surface, 'scrollHeight', { value: 100 });

        // Plenty of room below: positions below.
        ctx.input.getBoundingClientRect = () =>
            ({
                left: 60,
                right: 160,
                top: 160,
                bottom: 190,
                width: 100,
                height: 30,
                x: 60,
                y: 160,
                toJSON: () => ({}),
            }) as DOMRect;
        ctx.bounds.getBoundingClientRect = ctx.input.getBoundingClientRect;
        ctx.anchor.getBoundingClientRect = ctx.input.getBoundingClientRect;
        positionPopover(ctx, false);
        expect(popoverSide(ctx.surface)).toBe('below');

        // Off the bottom of the viewport: flips above.
        const offBottom = {
            left: 60,
            right: 680,
            top: 900,
            bottom: 950,
            width: 620,
            height: 50,
            x: 60,
            y: 900,
            toJSON: () => ({}),
        } as DOMRect;
        ctx.input.getBoundingClientRect = () => offBottom;
        ctx.bounds.getBoundingClientRect = () => offBottom;
        ctx.anchor.getBoundingClientRect = () => offBottom;
        positionPopover(ctx, false);
        expect(popoverSide(ctx.surface)).toBe('above');
    });
});

describe('isInternalScroll', () => {
    // Every host listens for 'scroll' on window with capture:true (nested
    // scrollers don't bubble 'scroll'), so a wheel scroll over the dropdown's
    // own item list fires that same capture listener. The host must recognize
    // that scroll as internal and not reposition the dropdown, or it fights
    // the list's own scroll gesture mid-wheel.
    it('is true for a scroll event whose target is the dropdown items list', () => {
        const ctx = createDropdownContext();
        const event = new Event('scroll');
        Object.defineProperty(event, 'target', { value: ctx.list });
        expect(isInternalScroll(ctx.surface, event)).toBe(true);
    });

    it('is true for a scroll event targeting any element nested inside the dropdown', () => {
        const ctx = createDropdownContext();
        const child = document.createElement('div');
        ctx.list.appendChild(child);
        const event = new Event('scroll');
        Object.defineProperty(event, 'target', { value: child });
        expect(isInternalScroll(ctx.surface, event)).toBe(true);
    });

    it('is false for a scroll event from the page/an ancestor scroller outside the dropdown', () => {
        const ctx = createDropdownContext();
        const event = new Event('scroll');
        Object.defineProperty(event, 'target', { value: document });
        expect(isInternalScroll(ctx.surface, event)).toBe(false);
    });

    it('is false for a resize event, whose target is window (not a Node)', () => {
        // The same bound handler doubles as the window 'resize' listener in
        // every consumer; a resize event's target must never be mistaken for
        // an internal-scroll source.
        const ctx = createDropdownContext();
        const event = new Event('resize');
        expect(isInternalScroll(ctx.surface, event)).toBe(false);
    });
});

describe('choosing a side once per open', () => {
    const originalVisualViewport = window.visualViewport;
    afterEach(() => {
        installVisualViewport(originalVisualViewport ?? undefined);
        document.body.innerHTML = '';
    });

    it('keeps the side it took while typing changes what the list needs', () => {
        // Field in the lower half of the band: a short list fits below, a
        // long one would be placed above if the side were chosen afresh.
        installVisualViewport(new FakeVisualViewport(390, 844));
        const ctx = createDropdownContext();
        Object.defineProperty(ctx.surface, 'offsetWidth', { value: 320 });
        let natural = 100;
        Object.defineProperty(ctx.list, 'scrollHeight', {
            get: () => natural,
        });
        Object.defineProperty(ctx.surface, 'scrollHeight', {
            get: () => natural,
        });
        const anchor = rectAt(500, 540);
        ctx.input.getBoundingClientRect = () => anchor;
        ctx.anchor.getBoundingClientRect = () => anchor;
        ctx.bounds.getBoundingClientRect = () => anchor;
        positionPopover(ctx, false);
        expect(ctx.surface.dataset.side).toBe('below');
        natural = 2000;
        positionPopover(ctx, false);
        expect(ctx.surface.dataset.side).toBe('above');
        // Locked: the same growth mid-open keeps the side it took, because
        // the list still fits there (it scrolls).
        natural = 100;
        positionPopover(ctx, false);
        natural = 2000;
        positionPopover(ctx, true);
        expect(ctx.surface.dataset.side).toBe('below');
    });

    it('moves once rather than slide over the field when its side no longer fits', () => {
        // 248px below the field, 288px above it.
        installVisualViewport(new FakeVisualViewport(390, 600));
        const ctx = createDropdownContext();
        Object.defineProperty(ctx.surface, 'offsetWidth', { value: 320 });
        Object.defineProperty(ctx.list, 'scrollHeight', { value: 200 });
        let chrome = 0;
        Object.defineProperty(ctx.surface, 'scrollHeight', {
            get: () => 200 + chrome,
        });
        const anchor = rectAt(300, 340);
        ctx.input.getBoundingClientRect = () => anchor;
        ctx.anchor.getBoundingClientRect = () => anchor;
        ctx.bounds.getBoundingClientRect = () => anchor;
        positionPopover(ctx, false);
        expect(ctx.surface.dataset.side).toBe('below');
        // The result row grew: it and the smallest list no longer fit below.
        chrome = 200;
        positionPopover(ctx, true);
        expect(ctx.surface.dataset.side).toBe('above');
        const top = Number.parseFloat(ctx.surface.style.top);
        const height =
            Math.min(200, Number.parseFloat(ctx.list.style.maxHeight)) + chrome;
        expect(top + height).toBeLessThanOrEqual(300 - 4);
    });
});

describe('positionSheet', () => {
    const originalVisualViewport = window.visualViewport;
    afterEach(() => {
        installVisualViewport(originalVisualViewport ?? undefined);
        document.body.innerHTML = '';
    });

    it('docks to the bottom of the visible band, full visible width, above the keyboard', () => {
        installVisualViewport(new FakeVisualViewport(390, 450, 0, 0));
        const ctx = createDropdownContext();
        Object.defineProperty(ctx.list, 'scrollHeight', { value: 1000 });
        Object.defineProperty(ctx.surface, 'scrollHeight', { value: 1120 });
        positionSheet(ctx.surface, ctx.list);
        expect(ctx.surface.style.left).toBe('0px');
        expect(ctx.surface.style.width).toBe('390px');
        const top = Number.parseFloat(ctx.surface.style.top);
        const height =
            Math.min(1000, Number.parseFloat(ctx.list.style.maxHeight)) + 120;
        expect(top + height).toBe(450);
        expect(top).toBeGreaterThanOrEqual(0);
        expect(ctx.surface.dataset.side).toBe('sheet');
    });

    it('follows a panned visual viewport and stops under a top banner', () => {
        const topBar = document.createElement('div');
        topBar.className = 'ez-banner-affix-top';
        topBar.getBoundingClientRect = () => rectAt(200, 240, 0, 390);
        document.body.append(topBar);
        installVisualViewport(new FakeVisualViewport(390, 450, 200));
        const ctx = createDropdownContext();
        Object.defineProperty(ctx.list, 'scrollHeight', { value: 1000 });
        Object.defineProperty(ctx.surface, 'scrollHeight', { value: 1100 });
        positionSheet(ctx.surface, ctx.list);
        const top = Number.parseFloat(ctx.surface.style.top);
        const height =
            Math.min(1000, Number.parseFloat(ctx.list.style.maxHeight)) + 100;
        expect(top + height).toBe(650);
        expect(top).toBeGreaterThanOrEqual(240);
    });
});

describe('revealRow', () => {
    it('scrolls a row above the view back below its sticky group label', () => {
        const list = document.createElement('div');
        const group = document.createElement('div');
        group.setAttribute('role', 'group');
        const label = document.createElement('div');
        label.className = 'ez-composer__group-label';
        const row = document.createElement('div');
        group.append(label, row);
        list.append(group);
        document.body.append(list);
        Object.defineProperty(label, 'offsetHeight', { value: 24 });
        Object.defineProperty(row, 'offsetTop', { value: 100 });
        Object.defineProperty(row, 'offsetHeight', { value: 44 });
        Object.defineProperty(list, 'clientHeight', { value: 200 });
        list.scrollTop = 120;
        revealRow(list, row);
        expect(list.scrollTop).toBe(100 - 24);
    });
});

describe('revealClearOfPinned', () => {
    const box = (top: number, bottom: number) =>
        ({
            top,
            bottom,
            left: 0,
            right: 300,
            width: 300,
            height: bottom - top,
            x: 0,
            y: top,
            toJSON: () => ({}),
        }) as DOMRect;

    afterEach(() => {
        document.body.replaceChildren();
        vi.restoreAllMocks();
    });

    function setup(targetTop: number, targetBottom: number) {
        const banner = document.createElement('div');
        banner.className = 'ez-banner-affix-top';
        banner.getBoundingClientRect = () => box(0, 66);
        const target = document.createElement('div');
        target.getBoundingClientRect = () => box(targetTop, targetBottom);
        document.body.append(banner, target);
        const scrollBy = vi
            .spyOn(window, 'scrollBy')
            .mockImplementation(() => {});
        return { target, scrollBy };
    }

    it('brings a target out from under an affixed banner, with a gap', () => {
        const { target, scrollBy } = setup(58, 75);
        revealClearOfPinned(target);
        expect(scrollBy).toHaveBeenCalledWith({
            top: 58 - (66 + 8),
            behavior: 'instant',
        });
    });

    it('leaves a target that is already clear where it is', () => {
        const { target, scrollBy } = setup(120, 140);
        revealClearOfPinned(target);
        expect(scrollBy).not.toHaveBeenCalled();
    });
});

describe('listenForViewportChanges', () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    it('calls again when a scroll ends', () => {
        const handler = vi.fn();
        const stop = listenForViewportChanges(handler);
        window.dispatchEvent(new Event('scrollend'));
        expect(handler).toHaveBeenCalledTimes(1);
        expect(handler.mock.calls[0][0].type).toBe('scrollend');
        stop();
        window.dispatchEvent(new Event('scrollend'));
        expect(handler).toHaveBeenCalledTimes(1);
    });

    it('calls once more after scrolling stops, where the browser has no scrollend', () => {
        vi.useFakeTimers();
        const handler = vi.fn();
        const stop = listenForViewportChanges(handler);
        document.dispatchEvent(new Event('scroll'));
        vi.advanceTimersByTime(50);
        document.dispatchEvent(new Event('scroll'));
        expect(handler.mock.calls.map((c) => c[0].type)).toEqual([
            'scroll',
            'scroll',
        ]);
        vi.advanceTimersByTime(200);
        expect(handler.mock.calls.map((c) => c[0].type)).toEqual([
            'scroll',
            'scroll',
            'scrollend',
        ]);
        stop();
    });
});
