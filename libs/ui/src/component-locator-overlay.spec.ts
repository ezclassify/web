import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    createComponentLocator,
    type ComponentLocator,
} from './component-locator';
import { adoptedStyleTexts } from './styles/adopt';

/**
 * The locator's stylesheet is adopted onto the document, not appended as a
 * `<style>` element, so read it back through the adoption module.
 */
function adoptedLocatorCss(): string {
    const css = adoptedStyleTexts().find((text) =>
        text.includes('.ezclassify-locator'),
    );
    expect(css).toBeDefined();
    return css!;
}

describe('component locator viewport labels', () => {
    let locator: ComponentLocator | undefined;
    let frames: Map<number, FrameRequestCallback>;
    let nextFrame: number;
    let resized: ResizeObserverCallback;
    let disconnected: ReturnType<typeof vi.fn>;
    const box = (
        element: Element,
        left: number,
        top: number,
        width: number,
        height: number,
    ) => {
        element.getBoundingClientRect = () =>
            ({
                left,
                top,
                width,
                height,
                right: left + width,
                bottom: top + height,
            }) as DOMRect;
    };
    const flush = () => {
        const pending = [...frames.values()];
        frames.clear();
        pending.forEach((callback) => callback(0));
    };
    const mount = (bodyScope = false) => {
        const target = document.createElement('div');
        target.style.overflow = 'hidden';
        const region = document.createElement('div');
        region.dataset.ezclassifyMount = 'guide';
        target.append(region);
        document.body.append(target);
        box(target, 20, 100, 300, 100);
        box(region, 30, 100, 200, 50);
        locator = createComponentLocator({
            target: bodyScope ? document.body : target,
            active: true,
        });
        document.body.append(locator.element);
        return {
            target,
            region,
            chip: document.querySelector<HTMLElement>(
                '.ezclassify-locator__chip',
            )!,
        };
    };
    beforeEach(() => {
        frames = new Map();
        nextFrame = 0;
        vi.stubGlobal(
            'requestAnimationFrame',
            (callback: FrameRequestCallback) => {
                frames.set(++nextFrame, callback);
                return nextFrame;
            },
        );
        vi.stubGlobal('cancelAnimationFrame', (id: number) =>
            frames.delete(id),
        );
        disconnected = vi.fn();
        vi.stubGlobal(
            'ResizeObserver',
            class {
                constructor(callback: ResizeObserverCallback) {
                    resized = callback;
                }
                observe = vi.fn();
                unobserve = vi.fn();
                disconnect = disconnected;
            },
        );
    });
    afterEach(() => {
        locator?.destroy();
        locator = undefined;
        document.body.replaceChildren();
        vi.unstubAllGlobals();
    });
    it('portals the label outside a clipping ancestor without replacing host pseudo-elements', () => {
        const { target, region, chip } = mount();
        expect(chip).not.toBeNull();
        expect(target.contains(chip)).toBe(false);
        expect(chip.parentElement?.parentElement).toBe(document.body);
        expect(chip.parentElement?.getAttribute('aria-hidden')).toBe('true');
        expect(chip.textContent).toBe(region.dataset.ezclassifyXrayLabel);
        expect(adoptedLocatorCss()).not.toContain(
            '[data-ezclassify-xray-kind]::before',
        );
    });
    it('clamps labels at viewport edges and follows nested scrolling and resize', () => {
        const { target, region, chip } = mount();
        box(target, 0, 0, window.innerWidth, window.innerHeight);
        box(region, window.innerWidth - 20, 0, 100, 50);
        box(chip, 0, 0, 220, 20);
        target.dispatchEvent(new Event('scroll'));
        flush();
        const x = Number.parseFloat(
            chip.style.getPropertyValue('--ezx-label-left'),
        );
        const y = Number.parseFloat(
            chip.style.getPropertyValue('--ezx-label-top'),
        );
        expect(x).toBeGreaterThanOrEqual(0);
        expect(x + 220).toBeLessThanOrEqual(window.innerWidth);
        expect(y).toBeGreaterThanOrEqual(0);
        box(region, 100, 240, 100, 50);
        resized([], {} as ResizeObserver);
        flush();
        expect(
            Number.parseFloat(chip.style.getPropertyValue('--ezx-label-top')),
        ).toBe(216);
        window.dispatchEvent(new Event('resize'));
        expect(frames.size).toBe(1);
    });
    it('does not float labels for regions fully clipped inside a scroller', () => {
        const { target, region, chip } = mount();
        box(region, 30, 10, 200, 50);
        target.dispatchEvent(new Event('scroll'));
        flush();
        expect(chip.hidden).toBe(true);
        box(region, 30, 90, 200, 50);
        target.dispatchEvent(new Event('scroll'));
        flush();
        expect(chip.hidden).toBe(false);
    });
    it('tracks added and removed markers without observing its own label writes', async () => {
        const { target, region, chip } = mount(true);
        await Promise.resolve();
        flush();
        await Promise.resolve();
        expect(frames.size).toBe(0);
        region.removeAttribute('data-ezclassify-mount');
        region.setAttribute('data-ezclassify-rendered', '');
        await Promise.resolve();
        flush();
        expect(chip.textContent).toBe('@ezclassify/ui data-binding');
        await Promise.resolve();
        expect(frames.size).toBe(0);
        const added = document.createElement('div');
        added.dataset.ezclassifyPowered = '';
        box(added, 40, 150, 100, 40);
        target.append(added);
        await Promise.resolve();
        flush();
        expect(
            document.querySelectorAll('.ezclassify-locator__chip'),
        ).toHaveLength(2);
        region.remove();
        await Promise.resolve();
        flush();
        expect(chip.isConnected).toBe(false);
    });
    it('removes labels, observers and pending work on disable and destroy', () => {
        const { target } = mount();
        target.dispatchEvent(new Event('scroll'));
        expect(frames.size).toBe(1);
        const toggle =
            locator!.element.querySelector<HTMLInputElement>('input')!;
        toggle.checked = false;
        toggle.dispatchEvent(new Event('change'));
        expect(
            document.querySelector('.ezclassify-locator__overlay'),
        ).toBeNull();
        expect(frames.size).toBe(0);
        expect(disconnected).toHaveBeenCalled();
        window.dispatchEvent(new Event('resize'));
        expect(frames.size).toBe(0);
        toggle.checked = true;
        toggle.dispatchEvent(new Event('change'));
        expect(
            document.querySelector('.ezclassify-locator__overlay'),
        ).not.toBeNull();
        locator!.destroy();
        expect(
            document.querySelector('.ezclassify-locator__overlay'),
        ).toBeNull();
        target.dispatchEvent(new Event('scroll'));
        expect(frames.size).toBe(0);
        locator = undefined;
    });
});
