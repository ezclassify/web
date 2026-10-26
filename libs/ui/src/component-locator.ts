/**
 * "Locate EzClassify components" x-ray overlay, a framework-agnostic, vanilla
 * DOM control that badges every region of a page driven by EzClassify, keyed
 * purely off attributes. Drop it on any page (demo or production) that uses the
 * runtime; it discovers the regions itself.
 *
 * Three categories, each keyed off a marker attribute:
 *
 * - `[data-ezclassify-mount]` / `[data-ezclassify-controller]`: @ezclassify/ui
 *   components (the runtime's rendered widgets and in-place enhanced hosts).
 * - `[data-ezclassify-bind]`: plain native elements two-way-bound by attribute.
 * - `[data-ezclassify-rendered]`: native elements the runtime's text controller
 *   renders engine output into.
 * - `[data-ezclassify-powered]`: native elements a developer populates in JS from
 *   EzClassify return data (a manual "powered by" marker).
 *
 * The locator marks only rendered regions. Enhancement runtimes commonly leave
 * hidden controllers and zero-height plumbing mounts beside the visible widget;
 * outlining marker attributes directly would therefore label implementation
 * details instead of the UI a user can see.
 */

import { componentNameForController } from './component-factory';
import { adoptStylesOnce } from './styles/adopt';
import { getMountHost } from './mount-host-registry';

/** Options for {@link createComponentLocator}. */
export interface ComponentLocatorOptions {
    /**
     * Element that receives the `ezclassify-xray` class when the switch is on.
     * Defaults to `document.body`, so `[data-ezclassify-powered]` elements that
     * live outside any ui mount are still badged.
     */
    target?: HTMLElement;
    /** Override the switch label. Defaults to "Locate EzClassify components". */
    label?: string;
    /** Initial switch state. Defaults to off. */
    active?: boolean;
    /** Called whenever the switch state changes. */
    onChange?: (active: boolean) => void;
}

/** Handle returned by {@link createComponentLocator}. */
export interface ComponentLocator {
    /**
     * The self-contained control (toggle slider + legend) to append to the
     * page.
     */
    element: HTMLElement;
    /**
     * Remove the control and its listeners. Leaves the shared stylesheet in
     * place.
     */
    destroy: () => void;
}

/**
 * The x-ray stylesheet. Gated entirely on a `.ezclassify-xray` ancestor, so it
 * is inert until the switch turns the class on. Injected once into the document
 * head; never into a ui root, because `[data-ezclassify-powered]` elements may
 * live anywhere on the page.
 */
const XRAY_CSS = `
/* Palette lives at :root so it resolves everywhere (some chips render on host
   wrappers outside the demo root). These are inert custom properties, harmless
   when x-ray is off. Dark mode only brightens the dashed OUTLINE colors; the
   chip backgrounds stay saturated so white chip text keeps contrast in both.
   Theme state comes from the HOST's theme attributes, never from the
   operating system: the library never queries the OS color-scheme media
   feature (standing rule in styles.css). The selector set and the
   :not([data-color-scheme='light']) shadowing mirror the main stylesheet's
   dark palette block. */
:root {
  --ezx-comp-color: #7c3aed;  --ezx-comp-badge: #6d28d9;
  --ezx-bound-color: #b45309; --ezx-bound-badge: #b45309;
  --ezx-powered-color: #0e7490; --ezx-powered-badge: #0e7490;
}
[data-color-scheme='dark'],
[data-theme='dark']:not([data-color-scheme='light']),
[data-bs-theme='dark']:not([data-color-scheme='light']),
.dark:not([data-color-scheme='light']) {
  --ezx-comp-color: #a78bfa;
  --ezx-bound-color: #fbbf24;
  --ezx-powered-color: #22d3ee;
}

/* JavaScript applies one private kind to each rendered region. Raw marker
   attributes are intentionally not styled: hidden controllers and height-zero
   mounts are runtime plumbing, not user-visible components. */
.ezclassify-xray[data-ezclassify-xray-kind='component'],
.ezclassify-xray [data-ezclassify-xray-kind='component'] {
  --ezx-chip-bg: var(--ezx-comp-badge);
  --ezx-outline: var(--ezx-comp-color);
}
.ezclassify-xray[data-ezclassify-xray-kind='binding'],
.ezclassify-xray [data-ezclassify-xray-kind='binding'] {
  --ezx-chip: "@ezclassify/ui data-binding";
  --ezx-chip-bg: var(--ezx-bound-badge);
  --ezx-outline: var(--ezx-bound-color);
}
.ezclassify-xray[data-ezclassify-xray-kind='powered'],
.ezclassify-xray [data-ezclassify-xray-kind='powered'] {
  --ezx-chip: "powered by EzClassify";
  --ezx-chip-bg: var(--ezx-powered-badge);
  --ezx-outline: var(--ezx-powered-color);
}

/* Outlines remain on the rendered region; labels are portaled separately. */
.ezclassify-xray[data-ezclassify-xray-kind],
.ezclassify-xray [data-ezclassify-xray-kind] {
  outline: 2px dashed var(--ezx-outline);
  outline-offset: 3px;
  border-radius: 0.4rem;
}

/* The overlay escapes overflow and transformed ancestors. Supporting browsers
   also place it in the top layer, above host stacking contexts and dialogs. */
.ezclassify-locator__overlay {
  position: fixed;
  inset: 0;
  margin: 0;
  border: 0;
  padding: 0;
  width: auto;
  height: auto;
  background: transparent;
  overflow: visible;
  pointer-events: none;
  z-index: 2147483647;
}
.ezclassify-locator__overlay::backdrop { display: none; }
.ezclassify-locator__chip {
  position: fixed;
  left: var(--ezx-label-left, 0px);
  top: var(--ezx-label-top, 0px);
  max-width: var(--ezx-label-width, calc(100vw - 0.5rem));
  box-sizing: border-box;
  background: var(--ezx-chip-bg, var(--ezx-comp-badge));
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: 0.65rem;
  font-weight: 700;
  line-height: 1.2;
  padding: 0.2rem 0.45rem;
  border-radius: 0.25rem;
  color: #fff;
  overflow-wrap: anywhere;
  box-shadow: 0 0.0625rem 0.125rem rgba(0, 0, 0, 0.3);
  pointer-events: none;
}
.ezclassify-locator__chip[hidden] { display: none; }

/* The locator control itself: a compact card with an iOS-style slider and a
   3-row legend. Prefixed ezclassify-locator… to avoid host collisions. */
.ezclassify-locator {
  display: inline-flex;
  flex-direction: column;
  gap: 0.6rem;
  padding: 0.65rem 0.8rem;
  border-radius: 0.6rem;
  background: var(--color-surface, rgba(255, 255, 255, 0.92));
  border: 1px solid var(--color-border, rgba(0, 0, 0, 0.12));
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
  font-size: 0.8rem;
  color: var(--color-text, #1f2937);
  max-width: 22rem;
}
.ezclassify-locator__switch {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  cursor: pointer;
  user-select: none;
}
.ezclassify-locator__slider {
  appearance: none;
  -webkit-appearance: none;
  position: relative;
  flex: none;
  width: 2.4rem;
  height: 1.35rem;
  border-radius: 999px;
  background: var(--color-border, #cbd5e1);
  cursor: pointer;
  transition: background 0.18s ease;
  margin: 0;
}
.ezclassify-locator__slider::before {
  content: "";
  position: absolute;
  top: 0.15rem;
  left: 0.15rem;
  width: 1.05rem;
  height: 1.05rem;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.25);
  transition: transform 0.18s ease;
}
.ezclassify-locator__slider:checked {
  background: var(--ezx-comp-badge, #6d28d9);
}
.ezclassify-locator__slider:checked::before {
  transform: translateX(1.05rem);
}
.ezclassify-locator__slider:focus-visible {
  outline: 2px solid var(--color-accent, #6d28d9);
  outline-offset: 2px;
}
.ezclassify-locator__label {
  font-weight: 600;
  line-height: 1.2;
}
.ezclassify-locator__legend {
  list-style: none;
  margin: 0;
  padding: 0;
  display: none;
  flex-direction: column;
  gap: 0.4rem;
  color: var(--color-text-muted, #6b7280);
}
.ezclassify-locator__slider:checked ~ .ezclassify-locator__legend,
.ezclassify-locator--on .ezclassify-locator__legend {
  display: flex;
}
.ezclassify-locator__item {
  display: flex;
  align-items: flex-start;
  gap: 0.45rem;
  line-height: 1.4;
}
.ezclassify-locator__swatch {
  width: 0.85rem;
  height: 0.85rem;
  margin-top: 0.15rem;
  border-radius: 0.2rem;
  border: 2px solid;
  flex: none;
}
.ezclassify-locator__item--comp .ezclassify-locator__swatch {
  border-color: var(--ezx-comp-color, #7c3aed);
  background: var(--ezx-comp-badge, #6d28d9);
}
.ezclassify-locator__item--bound .ezclassify-locator__swatch {
  border-color: var(--ezx-bound-color, #b45309);
  background: var(--ezx-bound-badge, #b45309);
}
.ezclassify-locator__item--powered .ezclassify-locator__swatch {
  border-color: var(--ezx-powered-color, #0e7490);
  background: var(--ezx-powered-badge, #0e7490);
}
`;

/**
 * Adopt the shared x-ray + locator stylesheet onto the document exactly once.
 * Idempotent; repeat calls do nothing.
 */
function injectLocatorStyles(): void {
    if (typeof document === 'undefined') return;
    adoptStylesOnce(XRAY_CSS, document);
}

const LEGEND_ROWS: Array<{ modifier: string; label: string }> = [
    { modifier: 'comp', label: '@ezclassify/ui' },
    { modifier: 'bound', label: '@ezclassify/ui data-binding' },
    { modifier: 'powered', label: 'Powered by EzClassify (manual)' },
];

const MARKER_SELECTOR = [
    '[data-ezclassify-mount]',
    '[data-ezclassify-controller]',
    '[data-ezclassify-bind]',
    '[data-ezclassify-rendered]',
    '[data-ezclassify-powered]',
].join(',');
const XRAY_KIND_ATTRIBUTE = 'data-ezclassify-xray-kind';
const XRAY_LABEL_ATTRIBUTE = 'data-ezclassify-xray-label';

type XrayKind = 'component' | 'binding' | 'powered';

function markerKind(element: HTMLElement): XrayKind {
    if (
        element.hasAttribute('data-ezclassify-mount') ||
        element.hasAttribute('data-ezclassify-controller')
    ) {
        return 'component';
    }
    if (
        element.hasAttribute('data-ezclassify-bind') ||
        element.hasAttribute('data-ezclassify-rendered')
    ) {
        return 'binding';
    }
    return 'powered';
}

function markerLabel(element: HTMLElement, kind: XrayKind): string {
    if (kind === 'binding') return '@ezclassify/ui data-binding';
    if (kind === 'powered') return 'powered by EzClassify';
    const controller =
        element.getAttribute('data-ezclassify-mount') ??
        element.getAttribute('data-ezclassify-controller');
    const componentName = controller
        ? componentNameForController(controller)
        : null;
    return componentName
        ? `@ezclassify/ui: ${componentName}`
        : '@ezclassify/ui';
}

function isRendered(element: HTMLElement): boolean {
    // Closed details retain descendant geometry in browsers, even though only
    // their first summary is painted. Geometry alone produces phantom badges.
    for (
        let ancestor = element.parentElement;
        ancestor;
        ancestor = ancestor.parentElement
    ) {
        if (ancestor instanceof HTMLDetailsElement && !ancestor.open) {
            const summary = ancestor.querySelector(':scope > summary');
            if (!summary?.contains(element)) return false;
        }
    }
    const style = getComputedStyle(element);
    if (
        style.display === 'none' ||
        style.visibility === 'hidden' ||
        style.visibility === 'collapse' ||
        style.clip === 'rect(0px, 0px, 0px, 0px)' ||
        style.clipPath === 'inset(50%)'
    ) {
        return false;
    }
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
}

function chipHost(element: HTMLElement, target: HTMLElement): HTMLElement {
    // The original input and its plumbing mount can both be hidden while the
    // owned field wrapper contains the visible editor, errors and fixes.
    const native = getMountHost(element) ?? element;
    const enhancement = native.closest<HTMLElement>(
        '.marking-field-wrap, .marked-input-wrap',
    );
    if (
        enhancement &&
        target.contains(enhancement) &&
        element.matches('[data-ezclassify-controller], [data-ezclassify-mount]')
    )
        return enhancement;
    if (!isRendered(element) || !element.matches('input, textarea, select'))
        return element;
    const parent = element.parentElement;
    return parent && target.contains(parent) && isRendered(parent)
        ? parent
        : element;
}

function isPairedPlumbingMount(element: HTMLElement): boolean {
    const mountName = element.getAttribute('data-ezclassify-mount');
    if (!mountName) return false;
    const hasRenderedComponent = [...element.children].some(
        (child) =>
            child instanceof HTMLElement &&
            child.tagName !== 'STYLE' &&
            isRendered(child),
    );
    if (hasRenderedComponent) return false;
    const enhancedRegion = element.previousElementSibling;
    if (!(enhancedRegion instanceof HTMLElement)) return false;

    // Enhancement moves the native controller into a rendered wrapper and
    // leaves its mount immediately after that wrapper. Host layout can give
    // the otherwise empty mount height, but it is still plumbing for the same
    // component rather than a second visible region.
    const controllers = [
        ...(enhancedRegion.matches('[data-ezclassify-controller]')
            ? [enhancedRegion]
            : []),
        ...enhancedRegion.querySelectorAll<HTMLElement>(
            '[data-ezclassify-controller]',
        ),
    ];
    return controllers.some(
        (controller) =>
            controller.getAttribute('data-ezclassify-controller') === mountName,
    );
}

function clearTargets(target: HTMLElement): void {
    if (target.hasAttribute(XRAY_KIND_ATTRIBUTE)) {
        target.removeAttribute(XRAY_KIND_ATTRIBUTE);
        target.removeAttribute(XRAY_LABEL_ATTRIBUTE);
    }
    for (const element of target.querySelectorAll<HTMLElement>(
        `[${XRAY_KIND_ATTRIBUTE}]`,
    )) {
        element.removeAttribute(XRAY_KIND_ATTRIBUTE);
        element.removeAttribute(XRAY_LABEL_ATTRIBUTE);
    }
}

function syncTargets(target: HTMLElement): HTMLElement[] {
    const markers: HTMLElement[] = [];
    if (target.matches(MARKER_SELECTOR)) markers.push(target);
    markers.push(...target.querySelectorAll<HTMLElement>(MARKER_SELECTOR));

    const priorities: Record<XrayKind, number> = {
        component: 3,
        binding: 2,
        powered: 1,
    };
    const chosen = new Map<HTMLElement, { kind: XrayKind; label: string }>();
    for (const marker of markers) {
        const host = chipHost(marker, target);
        if (!isRendered(host)) continue;
        if (host === marker && isPairedPlumbingMount(marker)) continue;
        const kind = markerKind(marker);
        const current = chosen.get(host)?.kind;
        if (!current || priorities[kind] > priorities[current]) {
            chosen.set(host, { kind, label: markerLabel(marker, kind) });
        }
    }
    // Finish visibility/layout reads before changing styles. Rewriting every
    // region between measurements forces repeated page layouts on large demos.
    const previous = [
        target,
        ...target.querySelectorAll<HTMLElement>(`[${XRAY_KIND_ATTRIBUTE}]`),
    ];
    for (const element of previous) {
        if (!chosen.has(element)) {
            element.removeAttribute(XRAY_KIND_ATTRIBUTE);
            element.removeAttribute(XRAY_LABEL_ATTRIBUTE);
        }
    }
    for (const [host, { kind, label }] of chosen) {
        if (host.getAttribute(XRAY_KIND_ATTRIBUTE) !== kind)
            host.setAttribute(XRAY_KIND_ATTRIBUTE, kind);
        if (host.getAttribute(XRAY_LABEL_ATTRIBUTE) !== label)
            host.setAttribute(XRAY_LABEL_ATTRIBUTE, label);
    }
    return [...chosen.keys()];
}

/**
 * Build a self-contained "Locate EzClassify components" control: a real on/off
 * toggle slider plus a legend (shown only when on). Toggling identifies the
 * currently rendered EzClassify regions and keeps that set synchronized as the
 * page changes. Labels live in a viewport overlay, outside clipping ancestors,
 * and follow visible regions on scroll and resize without intercepting input.
 *
 * @example Const locator = createComponentLocator({ target: demoRoot })
 * slot.appendChild(locator.element) // …later locator.destroy()
 */
export function createComponentLocator(
    options: ComponentLocatorOptions = {},
): ComponentLocator {
    injectLocatorStyles();

    const label = options.label ?? 'Locate EzClassify components';

    const root = document.createElement('div');
    root.className = 'ezclassify-locator';

    const switchLabel = document.createElement('label');
    switchLabel.className = 'ezclassify-locator__switch';

    const input = document.createElement('input');
    input.type = 'checkbox';
    input.className = 'ezclassify-locator__slider';
    input.setAttribute('role', 'switch');
    input.setAttribute('aria-checked', 'false');

    const labelText = document.createElement('span');
    labelText.className = 'ezclassify-locator__label';
    labelText.textContent = label;

    switchLabel.appendChild(input);
    switchLabel.appendChild(labelText);

    const legend = document.createElement('ul');
    legend.className = 'ezclassify-locator__legend';
    legend.setAttribute('aria-label', 'EzClassify component legend');
    for (const row of LEGEND_ROWS) {
        const item = document.createElement('li');
        item.className = `ezclassify-locator__item ezclassify-locator__item--${row.modifier}`;
        const swatch = document.createElement('span');
        swatch.className = 'ezclassify-locator__swatch';
        swatch.setAttribute('aria-hidden', 'true');
        const text = document.createElement('span');
        text.textContent = row.label;
        item.appendChild(swatch);
        item.appendChild(text);
        legend.appendChild(item);
    }

    root.appendChild(switchLabel);
    root.appendChild(legend);

    const target = options.target ?? document.body;
    const overlay = document.createElement('div');
    overlay.className = 'ezclassify-locator__overlay';
    overlay.setAttribute('aria-hidden', 'true');
    const chips = new Map<HTMLElement, HTMLElement>();
    let observer: MutationObserver | null = null;
    let resizeObserver: ResizeObserver | null = null;
    const observedSizes = new Set<HTMLElement>();
    let scheduledFrame: number | null = null;

    const sync = () => {
        const regions = syncTargets(target);
        const current = new Set(regions);
        for (const [region, chip] of chips) {
            if (!current.has(region)) {
                chip.remove();
                chips.delete(region);
            }
        }
        const viewport = window.visualViewport;
        const left = viewport?.offsetLeft ?? 0;
        const top = viewport?.offsetTop ?? 0;
        const width = viewport?.width ?? window.innerWidth;
        const height = viewport?.height ?? window.innerHeight;
        const rem =
            parseFloat(getComputedStyle(document.documentElement).fontSize) ||
            16;
        const gap = rem / 4;
        const sizes = new Set<HTMLElement>();
        for (const region of regions) {
            let chip = chips.get(region);
            if (!chip) {
                chip = document.createElement('span');
                chip.className = 'ezclassify-locator__chip';
                overlay.append(chip);
                chips.set(region, chip);
            }
            const label = region.getAttribute(XRAY_LABEL_ATTRIBUTE) ?? '';
            if (chip.textContent !== label) chip.textContent = label;
            const style = getComputedStyle(region);
            chip.style.setProperty(
                '--ezx-chip-bg',
                style.getPropertyValue('--ezx-chip-bg'),
            );
            chip.style.setProperty(
                '--font-mono',
                style.getPropertyValue('--font-mono'),
            );
            chip.style.setProperty(
                '--ezx-label-width',
                `${Math.max(0, width - 2 * gap)}px`,
            );
            const rect = region.getBoundingClientRect();
            let visibleLeft = Math.max(left, rect.left);
            let visibleTop = Math.max(top, rect.top);
            let visibleRight = Math.min(left + width, rect.right);
            let visibleBottom = Math.min(top + height, rect.bottom);
            // Ignore offscreen parts of nested scrollers, without clipping
            // the label itself to the container that clips its anchor.
            for (
                let parent = region.parentElement;
                parent;
                parent = parent.parentElement
            ) {
                sizes.add(parent);
                const parentStyle = getComputedStyle(parent);
                const bounds = parent.getBoundingClientRect();
                if (
                    /(auto|scroll|hidden|clip)/.test(
                        parentStyle.overflowX || parentStyle.overflow,
                    )
                ) {
                    visibleLeft = Math.max(visibleLeft, bounds.left);
                    visibleRight = Math.min(visibleRight, bounds.right);
                }
                if (
                    /(auto|scroll|hidden|clip)/.test(
                        parentStyle.overflowY || parentStyle.overflow,
                    )
                ) {
                    visibleTop = Math.max(visibleTop, bounds.top);
                    visibleBottom = Math.min(visibleBottom, bounds.bottom);
                }
            }
            sizes.add(region);
            chip.hidden =
                visibleRight <= visibleLeft || visibleBottom <= visibleTop;
            if (chip.hidden) continue;
            const labelRect = chip.getBoundingClientRect();
            const x = Math.max(
                left + gap,
                Math.min(
                    visibleLeft + rem * 0.6,
                    left + width - labelRect.width - gap,
                ),
            );
            const y = Math.max(
                top + gap,
                Math.min(
                    visibleTop - labelRect.height - gap,
                    top + height - labelRect.height - gap,
                ),
            );
            chip.style.setProperty('--ezx-label-left', `${x}px`);
            chip.style.setProperty('--ezx-label-top', `${y}px`);
        }
        sizes.add(target);
        for (const element of observedSizes) {
            if (!sizes.has(element)) {
                resizeObserver?.unobserve(element);
                observedSizes.delete(element);
            }
        }
        for (const element of sizes) {
            if (!observedSizes.has(element)) {
                resizeObserver?.observe(element);
                observedSizes.add(element);
            }
        }
    };
    const scheduleSync = () => {
        if (scheduledFrame !== null) return;
        scheduledFrame = requestAnimationFrame(() => {
            scheduledFrame = null;
            if (input.checked) sync();
        });
    };
    const stop = () => {
        observer?.disconnect();
        observer = null;
        resizeObserver?.disconnect();
        resizeObserver = null;
        observedSizes.clear();
        window.removeEventListener('scroll', scheduleSync, true);
        window.removeEventListener('resize', scheduleSync);
        window.removeEventListener('load', scheduleSync, true);
        window.visualViewport?.removeEventListener('scroll', scheduleSync);
        window.visualViewport?.removeEventListener('resize', scheduleSync);
        if (scheduledFrame !== null) cancelAnimationFrame(scheduledFrame);
        scheduledFrame = null;
        overlay.remove();
        overlay.replaceChildren();
        chips.clear();
    };

    const onToggle = () => {
        const on = input.checked;
        target.classList.toggle('ezclassify-xray', on);
        input.setAttribute('aria-checked', on ? 'true' : 'false');
        // Mirror onto the control so the legend shows even if the slider is not a
        // sibling of the legend in some host's DOM rearrangement.
        root.classList.toggle('ezclassify-locator--on', on);
        stop();
        if (on) {
            document.body.append(overlay);
            if (typeof overlay.showPopover === 'function') {
                overlay.setAttribute('popover', 'manual');
                overlay.showPopover();
            }
            resizeObserver =
                typeof ResizeObserver === 'undefined'
                    ? null
                    : new ResizeObserver(scheduleSync);
            sync();
            observer = new MutationObserver((records) => {
                // Labels are owned output, not changes to the host UI. In the
                // default body scope their text/styles must not self-schedule.
                if (records.some((record) => !overlay.contains(record.target)))
                    scheduleSync();
            });
            observer.observe(target, {
                childList: true,
                characterData: true,
                subtree: true,
                attributes: true,
                attributeFilter: [
                    'class',
                    'style',
                    'hidden',
                    'open',
                    'aria-hidden',
                    'data-ezclassify-mount',
                    'data-ezclassify-controller',
                    'data-ezclassify-bind',
                    'data-ezclassify-rendered',
                    'data-ezclassify-powered',
                ],
            });
            window.addEventListener('scroll', scheduleSync, {
                capture: true,
                passive: true,
            });
            window.addEventListener('resize', scheduleSync);
            window.addEventListener('load', scheduleSync, true);
            window.visualViewport?.addEventListener('scroll', scheduleSync);
            window.visualViewport?.addEventListener('resize', scheduleSync);
        } else {
            clearTargets(target);
        }
        options.onChange?.(on);
    };
    input.addEventListener('change', onToggle);
    if (options.active) {
        input.checked = true;
        onToggle();
    }

    return {
        element: root,
        destroy: () => {
            input.removeEventListener('change', onToggle);
            stop();
            clearTargets(target);
            target.classList.remove('ezclassify-xray');
            root.remove();
        },
    };
}
