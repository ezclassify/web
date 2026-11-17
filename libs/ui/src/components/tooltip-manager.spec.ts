import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    showTooltip,
    hideTooltip,
    attachTooltip,
    cleanupTooltipForRoot,
} from './tooltip-manager';

describe('tooltip-manager', () => {
    let root: HTMLDivElement;

    beforeEach(() => {
        root = document.createElement('div');
        document.body.appendChild(root);
    });

    afterEach(() => {
        cleanupTooltipForRoot(root);
        root.remove();
    });

    describe('showTooltip', () => {
        it('uses the interactive palette for field tools and restores the prose palette for a tooltip', () => {
            const target = document.createElement('button');
            root.appendChild(target);
            const tools = document.createElement('div');
            tools.className = 'ez-marking-tools';
            showTooltip(target, tools, root);
            const tip = document.body.querySelector('.ez-tooltip')!;
            expect(tip.classList.contains('ez-tooltip--tools')).toBe(true);
            showTooltip(target, 'A concept description', root);
            expect(tip.classList.contains('ez-tooltip--tools')).toBe(false);
        });

        it('portals the tooltip beyond clipped consumer roots', () => {
            root.style.overflow = 'hidden';
            const target = document.createElement('span');
            root.appendChild(target);
            showTooltip(target, 'Hello', root);
            const tip = document.body.querySelector('.ez-tooltip');
            expect(tip).not.toBeNull();
            expect(tip!.parentElement).toBe(document.body);
            expect(root.contains(tip)).toBe(false);
            expect(tip!.getAttribute('role')).toBe('tooltip');
            expect((tip as HTMLElement).hidden).toBe(false);
        });

        it('describes one target at a time, and tells a target when it stops describing it', () => {
            const first = document.createElement('button');
            const second = document.createElement('span');
            root.append(first, second);
            const released = vi.fn();
            showTooltip(first, 'First', root, undefined, released);
            const tip = document.body.querySelector('.ez-tooltip')!;
            expect(first.getAttribute('aria-describedby')).toBe(tip.id);
            // Showing it again on the same target releases nothing.
            showTooltip(first, 'First again', root, undefined, released);
            expect(released).not.toHaveBeenCalled();

            showTooltip(second, 'Second', root);
            expect(first.hasAttribute('aria-describedby')).toBe(false);
            expect(released).toHaveBeenCalledTimes(1);

            // Hiding releases the target that shows it, once.
            const again = vi.fn();
            showTooltip(first, 'First', root, undefined, again);
            hideTooltip(root);
            hideTooltip(root);
            expect(again).toHaveBeenCalledTimes(1);
            expect(first.hasAttribute('aria-describedby')).toBe(false);
        });

        it('takes the page font around its root, not the face of the field text it describes', () => {
            // jsdom does not inherit fonts: the root carries the family a
            // browser would inherit from the page, and the target (a marking
            // in a field's text layer) the monospace face that layer mirrors.
            // The layer sits beside the root, as a text area's does.
            root.setAttribute('data-ezclassify', '');
            root.style.fontFamily = 'Georgia, serif';
            const layer = document.createElement('div');
            const target = document.createElement('span');
            target.style.font = '13px "SF Mono", monospace';
            layer.appendChild(target);
            root.before(layer);
            showTooltip(target, 'Tip', root);
            const tip =
                document.body.querySelector<HTMLElement>('.ez-tooltip')!;
            expect(getComputedStyle(tip).fontFamily).toBe('Georgia, serif');
            layer.remove();
        });

        it("leaves a target's own state alone: aria-expanded belongs to the target", () => {
            const disclosure = document.createElement('button');
            disclosure.setAttribute('aria-expanded', 'false');
            root.appendChild(disclosure);
            showTooltip(disclosure, 'Tip', root);
            expect(disclosure.getAttribute('aria-expanded')).toBe('false');
            disclosure.setAttribute('aria-expanded', 'true');
            hideTooltip(root);
            expect(disclosure.getAttribute('aria-expanded')).toBe('true');
        });

        it('releases a target that sits outside its root when it hides', () => {
            const outside = document.createElement('button');
            document.body.appendChild(outside);
            const released = vi.fn();
            try {
                showTooltip(outside, 'Tip', root, undefined, released);
                hideTooltip(root);
                expect(outside.hasAttribute('aria-describedby')).toBe(false);
                expect(released).toHaveBeenCalledTimes(1);
            } finally {
                outside.remove();
            }
        });

        it('releases a target that sits outside its root when another target takes the tooltip', () => {
            const outside = document.createElement('button');
            document.body.appendChild(outside);
            const inside = document.createElement('span');
            root.appendChild(inside);
            const released = vi.fn();
            try {
                showTooltip(outside, 'Tip', root, undefined, released);
                showTooltip(inside, 'Other', root);
                const tip = document.body.querySelector('.ez-tooltip')!;
                expect(outside.hasAttribute('aria-describedby')).toBe(false);
                expect(inside.getAttribute('aria-describedby')).toBe(tip.id);
                expect(released).toHaveBeenCalledTimes(1);
            } finally {
                outside.remove();
            }
        });

        it('sets aria-describedby on the target', () => {
            const target = document.createElement('span');
            root.appendChild(target);
            showTooltip(target, 'Tip text', root);
            const tip = document.body.querySelector('.ez-tooltip');
            expect(target.getAttribute('aria-describedby')).toBe(tip!.id);
        });

        it('parses Description: lines into structured content', () => {
            const target = document.createElement('span');
            root.appendChild(target);
            showTooltip(
                target,
                'Concept Name\nDescription: A detailed description',
                root,
            );
            const header = document.body.querySelector('.ez-tooltip__header');
            expect(header?.textContent).toBe('Concept Name');
            const heading = document.body.querySelector('.ez-tooltip__heading');
            expect(heading?.textContent).toBe('Description');
            const body = document.body.querySelector('.ez-tooltip__body');
            expect(body?.textContent).toBe('A detailed description');
        });

        it('parses Scheme rules: block into rule elements', () => {
            const target = document.createElement('span');
            root.appendChild(target);
            showTooltip(
                target,
                'Name\nScheme rules:\n  Rule one\n  Rule two',
                root,
            );
            const rules = document.body.querySelectorAll('.ez-tooltip__rule');
            expect(rules.length).toBe(2);
            expect(rules[0].textContent).toBe('Rule one');
            expect(rules[1].textContent).toBe('Rule two');
        });

        it('parses Usage: lines', () => {
            const target = document.createElement('span');
            root.appendChild(target);
            showTooltip(target, 'Name\nUsage: Use it wisely', root);
            const heading = document.body.querySelector('.ez-tooltip__heading');
            expect(heading?.textContent).toBe('Usage');
        });

        it('reuses the same tooltip element on repeated calls', () => {
            const target = document.createElement('span');
            root.appendChild(target);
            showTooltip(target, 'First', root);
            const tip1 = document.body.querySelector('.ez-tooltip');
            showTooltip(target, 'Second', root);
            const tip2 = document.body.querySelector('.ez-tooltip');
            expect(tip1).toBe(tip2);
        });

        it('skips blank lines (resets currentSection)', () => {
            const target = document.createElement('span');
            root.appendChild(target);
            showTooltip(
                target,
                'Header\nScheme rules:\n  R1\n\n  Not a rule',
                root,
            );
            // After the blank line, currentSection is reset, so "  Not a rule" is treated as a header
            const rules = document.body.querySelectorAll('.ez-tooltip__rule');
            expect(rules.length).toBe(1);
        });
    });

    describe('showTooltip placement clear of a box', () => {
        // jsdom lays nothing out, so each test states the boxes. The viewport
        // is jsdom's 1024 x 768; the tooltip measures 200 x 100.
        const realRect = HTMLElement.prototype.getBoundingClientRect;
        const box = (
            left: number,
            top: number,
            right: number,
            bottom: number,
        ) =>
            ({
                left,
                top,
                right,
                bottom,
                width: right - left,
                height: bottom - top,
                x: left,
                y: top,
                toJSON: () => ({}),
            }) as DOMRect;
        const at = (el: HTMLElement, rect: DOMRect) => {
            el.getBoundingClientRect = () => rect;
        };

        beforeEach(() => {
            HTMLElement.prototype.getBoundingClientRect = function () {
                return this.classList.contains('ez-tooltip')
                    ? box(0, 0, 200, 100)
                    : realRect.call(this);
            };
        });
        afterEach(() => {
            HTMLElement.prototype.getBoundingClientRect = realRect;
        });

        /**
         * A field holding a target by its trailing edge: near its top-right
         * corner, or `offset` px further down.
         */
        function field(
            rect: DOMRect,
            offset = 4,
        ): {
            field: HTMLElement;
            target: HTMLElement;
        } {
            const el = document.createElement('div');
            const target = document.createElement('button');
            el.appendChild(target);
            root.appendChild(el);
            at(el, rect);
            at(
                target,
                box(
                    rect.right - 30,
                    rect.top + offset,
                    rect.right - 6,
                    rect.top + offset + 24,
                ),
            );
            return { field: el, target };
        }
        const shown = () =>
            document.querySelector<HTMLElement>('.ez-tooltip')!.style;

        it('opens above the box next to a target in its top half, its trailing edge lined up with the target', () => {
            const { field: f, target } = field(box(300, 300, 700, 700));
            showTooltip(target, 'Hi', root, { clearOf: f });
            // 300 - 6 - 100 above; 694 - 200 to end with the target.
            expect(shown().top).toBe('194px');
            expect(shown().left).toBe('494px');
        });

        it("goes beside the box's trailing edge, lined up with the target's top, when there is no room above", () => {
            const { field: f, target } = field(box(100, 60, 700, 700));
            showTooltip(target, 'Hi', root, { clearOf: f });
            expect(shown().left).toBe('706px');
            expect(shown().top).toBe('64px');
        });

        it('never crosses the box to the side away from the target', () => {
            // Room below and to the left, but both are across the field from
            // a target in its top-right corner. No side next to it has room,
            // so the tooltip falls back to the target itself, over the field
            // (a caller that must not cover it closes the tooltip).
            const { field: f, target } = field(box(300, 60, 1000, 400));
            showTooltip(target, 'Hi', root, { clearOf: f });
            expect(shown().top).toBe('94px');
            expect(shown().top).not.toBe('406px');
            expect(shown().left).not.toBe('94px');
        });

        it('opens below the box next to a target in its bottom half', () => {
            const { field: f, target } = field(box(300, 100, 700, 400), 270);
            showTooltip(target, 'Hi', root, { clearOf: f });
            expect(shown().top).toBe('406px');
            expect(shown().left).toBe('494px');
        });

        it('opens below or above a target in the middle of a one-line box', () => {
            const { field: f, target } = field(box(300, 300, 700, 336), 6);
            showTooltip(target, 'Hi', root, { clearOf: f });
            expect(shown().top).toBe('342px');

            hideTooltip(root);
            const low = field(box(300, 690, 700, 726), 6);
            showTooltip(low.target, 'Hi', root, { clearOf: low.field });
            expect(shown().top).toBe('584px');
        });

        it('lines up with the trailing edge of a right-to-left target, on the left', () => {
            const el = document.createElement('div');
            el.dir = 'rtl';
            const target = document.createElement('button');
            // A browser computes the direction [dir] gives and the target
            // inherits it; jsdom does neither, so the target states its own.
            target.style.direction = 'rtl';
            el.appendChild(target);
            root.appendChild(el);
            at(el, box(300, 300, 700, 700));
            at(target, box(306, 304, 330, 328));
            showTooltip(target, 'Hi', root, { clearOf: el });
            expect(shown().top).toBe('194px');
            expect(shown().left).toBe('306px');

            hideTooltip(root);
            at(el, box(300, 60, 700, 700));
            at(target, box(306, 64, 330, 88));
            showTooltip(target, 'Hi', root, { clearOf: el });
            expect(shown().left).toBe('94px');
            expect(shown().top).toBe('64px');
        });

        it('keeps clear of every element named, as one box', () => {
            const { field: f, target } = field(box(300, 100, 700, 300), 170);
            const errors = document.createElement('div');
            root.appendChild(errors);
            at(errors, box(300, 300, 700, 420));
            showTooltip(target, 'Hi', root, { clearOf: [f, errors] });
            expect(shown().top).toBe('426px');
        });

        it('stays inside an ancestor that clips the box when that has room', () => {
            const scroller = document.createElement('div');
            scroller.style.overflow = 'auto';
            root.appendChild(scroller);
            at(scroller, box(0, 200, 1024, 768));
            const { field: f, target } = field(box(300, 250, 700, 420));
            scroller.appendChild(f);
            // The viewport has room above the field, the scroller does not.
            showTooltip(target, 'Hi', root, { clearOf: f });
            expect(shown().left).toBe('706px');
            expect(shown().top).toBe('254px');
        });

        it('uses the viewport when the clipping ancestor has no room anywhere', () => {
            const clip = document.createElement('div');
            clip.style.overflow = 'hidden';
            root.appendChild(clip);
            at(clip, box(300, 200, 700, 400));
            const { field: f, target } = field(box(300, 200, 700, 400));
            clip.appendChild(f);
            showTooltip(target, 'Hi', root, { clearOf: f });
            expect(shown().top).toBe('94px');
            expect(shown().left).toBe('494px');
        });
    });

    describe('hideTooltip', () => {
        it('hides the tooltip and removes aria-describedby', () => {
            const target = document.createElement('span');
            root.appendChild(target);
            showTooltip(target, 'Visible', root);
            const tip = document.body.querySelector(
                '.ez-tooltip',
            ) as HTMLElement;
            expect(tip.hidden).toBe(false);

            hideTooltip(root);
            expect(tip.hidden).toBe(true);
            expect(target.getAttribute('aria-describedby')).toBeNull();
        });

        it('does nothing when no tooltip exists', () => {
            expect(() => hideTooltip(root)).not.toThrow();
        });
    });

    describe('cleanupTooltipForRoot', () => {
        it('removes tooltip DOM and cleans up keydown handler', () => {
            const target = document.createElement('span');
            root.appendChild(target);
            showTooltip(target, 'Test', root);
            expect(document.body.querySelector('.ez-tooltip')).not.toBeNull();

            cleanupTooltipForRoot(root);
            expect(document.body.querySelector('.ez-tooltip')).toBeNull();
        });

        it('is idempotent, second call is a no-op', () => {
            const target = document.createElement('span');
            root.appendChild(target);
            showTooltip(target, 'Test', root);
            cleanupTooltipForRoot(root);
            expect(() => cleanupTooltipForRoot(root)).not.toThrow();
        });
    });

    describe('attachTooltip', () => {
        it('returns a cleanup function that removes event listeners', () => {
            const target = document.createElement('span');
            root.appendChild(target);
            const cleanup = attachTooltip(target, () => 'Content', root);
            expect(typeof cleanup).toBe('function');
            cleanup();
        });

        it('shows tooltip on mouseenter after delay', () => {
            vi.useFakeTimers();
            const target = document.createElement('span');
            root.appendChild(target);
            attachTooltip(target, () => 'Hover content', root);

            target.dispatchEvent(new Event('mouseenter'));
            vi.advanceTimersByTime(300);

            const tip = document.body.querySelector(
                '.ez-tooltip',
            ) as HTMLElement;
            expect(tip).not.toBeNull();
            expect(tip.hidden).toBe(false);
            vi.useRealTimers();
        });

        it('respects shouldShow returning false', () => {
            vi.useFakeTimers();
            const target = document.createElement('span');
            root.appendChild(target);
            attachTooltip(
                target,
                () => 'Content',
                root,
                () => false,
            );

            target.dispatchEvent(new Event('mouseenter'));
            vi.advanceTimersByTime(500);

            const tip = document.body.querySelector(
                '.ez-tooltip',
            ) as HTMLElement | null;
            // Tooltip should not be created or should be hidden
            if (tip) expect(tip.hidden).toBe(true);
            vi.useRealTimers();
        });

        it('mouseenter then focus with no intervening leave/blur does not double-fire onShown', () => {
            // A click can produce mouseenter and focus without an intervening leave
            // or blur. The second event replaces the dwell timer so onShown runs
            // only once.
            vi.useFakeTimers();
            const target = document.createElement('span');
            root.appendChild(target);
            let shownCount = 0;
            attachTooltip(
                target,
                () => 'Content',
                root,
                undefined,
                () => {
                    shownCount++;
                },
            );

            target.dispatchEvent(new Event('mouseenter'));
            vi.advanceTimersByTime(100);
            target.dispatchEvent(new Event('focus'));
            vi.advanceTimersByTime(300);

            expect(shownCount).toBe(1);
            vi.useRealTimers();
        });

        it('polls for content when getContent initially returns undefined', () => {
            vi.useFakeTimers();
            const target = document.createElement('span');
            root.appendChild(target);
            let callCount = 0;
            attachTooltip(
                target,
                () => {
                    callCount++;
                    return callCount >= 3 ? 'Loaded content' : undefined;
                },
                root,
            );

            target.dispatchEvent(new Event('mouseenter'));
            vi.advanceTimersByTime(300); // initial delay
            vi.advanceTimersByTime(200); // first poll
            vi.advanceTimersByTime(200); // second poll, content available

            const tip = document.body.querySelector(
                '.ez-tooltip',
            ) as HTMLElement;
            expect(tip).not.toBeNull();
            vi.useRealTimers();
        });

        describe('long-press touch (opt-in via enableLongPressTouch)', () => {
            // jsdom has no `TouchEvent` constructor; a plain Event with a
            // `touches` array grafted on is all attachTooltip's handlers
            // read (`touches.length`, `touches[0].clientX/Y`).
            function makeTouchEvent(
                type: 'touchstart' | 'touchmove' | 'touchend',
                touches: Array<{ clientX: number; clientY: number }>,
            ): Event {
                const e = new Event(type, {
                    bubbles: true,
                    cancelable: true,
                });
                Object.defineProperty(e, 'touches', {
                    value: touches,
                    configurable: true,
                });
                return e;
            }

            it('does nothing on touch when not opted in', () => {
                vi.useFakeTimers();
                const target = document.createElement('span');
                root.appendChild(target);
                attachTooltip(target, () => 'Content', root);

                target.dispatchEvent(
                    makeTouchEvent('touchstart', [{ clientX: 0, clientY: 0 }]),
                );
                vi.advanceTimersByTime(1000);

                expect(document.body.querySelector('.ez-tooltip')).toBeNull();
                vi.useRealTimers();
            });

            it('shows the tooltip on a touch held past the hover-intent delay', () => {
                vi.useFakeTimers();
                const target = document.createElement('span');
                root.appendChild(target);
                attachTooltip(
                    target,
                    () => 'Held content',
                    root,
                    undefined,
                    undefined,
                    true,
                );

                target.dispatchEvent(
                    makeTouchEvent('touchstart', [{ clientX: 0, clientY: 0 }]),
                );
                vi.advanceTimersByTime(300);

                const tip = document.body.querySelector(
                    '.ez-tooltip',
                ) as HTMLElement | null;
                expect(tip).not.toBeNull();
                expect(tip!.hidden).toBe(false);
                vi.useRealTimers();
            });

            it('swallows the synthetic click after a long-press by preventing the touchend default', () => {
                vi.useFakeTimers();
                const target = document.createElement('span');
                root.appendChild(target);
                attachTooltip(
                    target,
                    () => 'Content',
                    root,
                    undefined,
                    undefined,
                    true,
                );

                target.dispatchEvent(
                    makeTouchEvent('touchstart', [{ clientX: 0, clientY: 0 }]),
                );
                vi.advanceTimersByTime(300);
                const endEvent = makeTouchEvent('touchend', [
                    { clientX: 0, clientY: 0 },
                ]);
                target.dispatchEvent(endEvent);

                expect(endEvent.defaultPrevented).toBe(true);
                vi.useRealTimers();
            });

            it('does not swallow the click for an ordinary tap released before the delay', () => {
                vi.useFakeTimers();
                const target = document.createElement('span');
                root.appendChild(target);
                attachTooltip(
                    target,
                    () => 'Content',
                    root,
                    undefined,
                    undefined,
                    true,
                );

                target.dispatchEvent(
                    makeTouchEvent('touchstart', [{ clientX: 0, clientY: 0 }]),
                );
                vi.advanceTimersByTime(100); // well under the 300ms delay
                const endEvent = makeTouchEvent('touchend', [
                    { clientX: 0, clientY: 0 },
                ]);
                target.dispatchEvent(endEvent);

                expect(endEvent.defaultPrevented).toBe(false);
                expect(document.body.querySelector('.ez-tooltip')).toBeNull();
                vi.useRealTimers();
            });

            it('cancels the pending long-press when the touch moves before the delay elapses', () => {
                vi.useFakeTimers();
                const target = document.createElement('span');
                root.appendChild(target);
                attachTooltip(
                    target,
                    () => 'Content',
                    root,
                    undefined,
                    undefined,
                    true,
                );

                target.dispatchEvent(
                    makeTouchEvent('touchstart', [{ clientX: 0, clientY: 0 }]),
                );
                target.dispatchEvent(
                    makeTouchEvent('touchmove', [{ clientX: 30, clientY: 0 }]),
                );
                vi.advanceTimersByTime(300);

                expect(document.body.querySelector('.ez-tooltip')).toBeNull();
                vi.useRealTimers();
            });

            it('removes the touch listeners on cleanup', () => {
                vi.useFakeTimers();
                const target = document.createElement('span');
                root.appendChild(target);
                const cleanup = attachTooltip(
                    target,
                    () => 'Content',
                    root,
                    undefined,
                    undefined,
                    true,
                );
                cleanup();

                target.dispatchEvent(
                    makeTouchEvent('touchstart', [{ clientX: 0, clientY: 0 }]),
                );
                vi.advanceTimersByTime(300);

                expect(document.body.querySelector('.ez-tooltip')).toBeNull();
                vi.useRealTimers();
            });
        });
    });

    describe('attachTooltip pinning', () => {
        it('keeps a pinned tooltip when the pointer leaves, and hides an unpinned one', async () => {
            const target = document.createElement('button');
            root.appendChild(target);
            let pinned = false;
            attachTooltip(
                target,
                () => 'Tip',
                root,
                undefined,
                undefined,
                undefined,
                undefined,
                () => pinned,
            );
            const tip = () =>
                document.body.querySelector<HTMLElement>('.ez-tooltip');
            target.dispatchEvent(new Event('mouseenter'));
            await new Promise((r) => setTimeout(r, 350));
            expect(tip()?.hidden).toBe(false);
            pinned = true;
            target.dispatchEvent(new Event('mouseleave'));
            expect(tip()?.hidden).toBe(false);
            pinned = false;
            target.dispatchEvent(new Event('mouseenter'));
            await new Promise((r) => setTimeout(r, 350));
            target.dispatchEvent(new Event('mouseleave'));
            await new Promise((r) => setTimeout(r, 350));
            expect(tip()?.hidden).toBe(true);
        });

        it('a pinned leave cancels a pending hover show', async () => {
            const target = document.createElement('button');
            root.appendChild(target);
            const onShown = vi.fn();
            attachTooltip(
                target,
                () => 'Tip',
                root,
                undefined,
                onShown,
                undefined,
                undefined,
                () => true,
            );
            target.dispatchEvent(new Event('mouseenter'));
            target.dispatchEvent(new Event('mouseleave'));
            await new Promise((r) => setTimeout(r, 350));
            expect(onShown).not.toHaveBeenCalled();
        });
    });
    describe('attachTooltip reachable by the pointer', () => {
        beforeEach(() => {
            vi.useFakeTimers();
        });
        afterEach(() => {
            vi.useRealTimers();
        });

        /** A target with a tooltip holding a control, shown past its delay. */
        function hovered(pinned?: () => boolean): {
            target: HTMLElement;
            tip: () => HTMLElement;
            control: HTMLButtonElement;
        } {
            const target = document.createElement('button');
            root.appendChild(target);
            const control = document.createElement('button');
            control.textContent = 'Act';
            attachTooltip(
                target,
                () => control,
                root,
                undefined,
                undefined,
                undefined,
                undefined,
                pinned,
            );
            target.dispatchEvent(new Event('mouseenter'));
            vi.advanceTimersByTime(300);
            const tip = () =>
                document.body.querySelector<HTMLElement>('.ez-tooltip')!;
            expect(tip().hidden).toBe(false);
            return { target, tip, control };
        }

        it('stays while the pointer crosses from the target into it', () => {
            const { target, tip } = hovered();
            target.dispatchEvent(new Event('mouseleave'));
            vi.advanceTimersByTime(150);
            tip().dispatchEvent(new Event('mouseenter'));
            vi.advanceTimersByTime(1000);
            expect(tip().hidden).toBe(false);
        });

        it('closes once the pointer has left the target and the tooltip for the delay', () => {
            const { target, tip } = hovered();
            target.dispatchEvent(new Event('mouseleave'));
            vi.advanceTimersByTime(250);
            expect(tip().hidden).toBe(false);
            vi.advanceTimersByTime(100);
            expect(tip().hidden).toBe(true);
            expect(target.hasAttribute('aria-describedby')).toBe(false);

            // Leaving the tooltip itself starts the same delay.
            target.dispatchEvent(new Event('mouseenter'));
            vi.advanceTimersByTime(300);
            target.dispatchEvent(new Event('mouseleave'));
            tip().dispatchEvent(new Event('mouseenter'));
            tip().dispatchEvent(new Event('mouseleave'));
            vi.advanceTimersByTime(250);
            expect(tip().hidden).toBe(false);
            vi.advanceTimersByTime(100);
            expect(tip().hidden).toBe(true);
        });

        it('stays when the pointer comes back to the target, without being built again', () => {
            const { target, tip, control } = hovered();
            const builds = new MutationObserver(() => {});
            builds.observe(tip(), { childList: true });
            target.dispatchEvent(new Event('mouseleave'));
            vi.advanceTimersByTime(200);
            expect(tip().hidden).toBe(false);
            target.dispatchEvent(new Event('mouseenter'));
            vi.advanceTimersByTime(1000);
            expect(tip().hidden).toBe(false);
            expect(tip().contains(control)).toBe(true);
            expect(builds.takeRecords()).toHaveLength(0);
            builds.disconnect();
        });

        it('a pinned tooltip stays when the pointer leaves it', () => {
            const { target, tip } = hovered(() => true);
            target.dispatchEvent(new Event('mouseleave'));
            tip().dispatchEvent(new Event('mouseenter'));
            tip().dispatchEvent(new Event('mouseleave'));
            vi.advanceTimersByTime(1000);
            expect(tip().hidden).toBe(false);
        });

        it('a pending close leaves alone a tooltip another target has taken', () => {
            const { target, tip } = hovered();
            const other = document.createElement('span');
            root.appendChild(other);
            target.dispatchEvent(new Event('mouseleave'));
            showTooltip(other, 'Other', root);
            vi.advanceTimersByTime(1000);
            expect(tip().hidden).toBe(false);
            expect(other.getAttribute('aria-describedby')).toBe(tip().id);
        });

        it('keeps the tooltip when focus moves from the target into it', () => {
            const { target, tip, control } = hovered();
            target.focus();
            control.focus();
            vi.advanceTimersByTime(1000);
            expect(tip().hidden).toBe(false);
            expect(document.activeElement).toBe(control);

            // Focus leaving the tooltip for elsewhere closes it.
            const elsewhere = document.createElement('button');
            root.appendChild(elsewhere);
            elsewhere.focus();
            expect(tip().hidden).toBe(true);
        });

        it('Escape in the tooltip closes it and returns focus to the target', () => {
            const { target, tip, control } = hovered();
            control.focus();
            const escape = new KeyboardEvent('keydown', {
                key: 'Escape',
                bubbles: true,
                cancelable: true,
            });
            control.dispatchEvent(escape);
            expect(tip().hidden).toBe(true);
            expect(escape.defaultPrevented).toBe(true);
            expect(document.activeElement).toBe(target);
        });
    });
});
