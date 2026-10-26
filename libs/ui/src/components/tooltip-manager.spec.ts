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
