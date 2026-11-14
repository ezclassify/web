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

        /** A field holding a target near its top-right corner. */
        function field(rect: DOMRect): {
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
                    rect.top + 4,
                    rect.right - 6,
                    rect.top + 28,
                ),
            );
            return { field: el, target };
        }
        const shown = () =>
            document.querySelector<HTMLElement>('.ez-tooltip')!.style;

        it('goes below the whole box when there is room', () => {
            const { field: f, target } = field(box(300, 100, 700, 400));
            showTooltip(target, 'Hi', root, { clearOf: f });
            expect(shown().top).toBe('406px');
        });

        it('goes above the box when there is no room below', () => {
            const { field: f, target } = field(box(300, 300, 700, 700));
            showTooltip(target, 'Hi', root, { clearOf: f });
            expect(shown().top).toBe('194px');
        });

        it('goes beside the box, right or left, when neither above nor below has room', () => {
            const { field: f, target } = field(box(100, 60, 700, 700));
            showTooltip(target, 'Hi', root, { clearOf: f });
            expect(shown().left).toBe('706px');
            expect(shown().top).toBe('64px');

            hideTooltip(root);
            const other = field(box(400, 60, 1000, 700));
            showTooltip(other.target, 'Hi', root, { clearOf: other.field });
            expect(shown().left).toBe('194px');
        });

        it('keeps clear of every element named, as one box', () => {
            const { field: f, target } = field(box(300, 100, 700, 300));
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
            at(scroller, box(0, 0, 1024, 500));
            const { field: f, target } = field(box(300, 250, 700, 420));
            scroller.appendChild(f);
            // The viewport has room below the field, the scroller does not.
            showTooltip(target, 'Hi', root, { clearOf: f });
            expect(shown().top).toBe('144px');
        });

        it('uses the viewport when the clipping ancestor has no room anywhere', () => {
            const clip = document.createElement('div');
            clip.style.overflow = 'hidden';
            root.appendChild(clip);
            at(clip, box(300, 100, 700, 400));
            const { field: f, target } = field(box(300, 100, 700, 400));
            clip.appendChild(f);
            showTooltip(target, 'Hi', root, { clearOf: f });
            expect(shown().top).toBe('406px');
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
});
