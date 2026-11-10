/**
 * The "Highlight components" overlay: a framework-agnostic DOM control that
 * outlines every region of a page EzClassify reads or drives, keyed purely off
 * attributes. It ships from the `@ezclassify/ui/devtools` entry so it never
 * lands in a production bundle unless a page imports it.
 *
 * What it finds comes from the library's own attribute registry in
 * `binding-model.ts` (the controller, marking, view and structural attributes)
 * plus `data-ezclassify-powered`, so a new attribute added there is found
 * without editing this module. Each element takes one kind:
 *
 * - Components: `@ezclassify/ui` controllers and their mounts;
 * - Bound markings: elements that hold a marking by `data-ezclassify-marking`;
 * - Structure: whole containers, collections and the other structural attributes
 *   (`part-of`, `member-of`, `context`, `scheme`, `no-rollup`);
 * - Views: the view attributes and the reference controllers (handbooks and the
 *   reference drawer);
 * - Ignored regions: `data-ezclassify-ignore` subtrees, shown as excluded;
 * - Powered: `data-ezclassify-powered`, the manual marker for content a
 *   developer's own code fills from EzClassify data. It is region-scoped: one
 *   outline covers the container's subtree, and powered elements nested in it
 *   are not outlined again. The library never stamps it.
 *
 * The locator outlines only rendered regions. Enhancement runtimes leave hidden
 * controllers and zero-height plumbing mounts beside the visible widget, and
 * outlining marker attributes directly would label implementation details
 * instead of the UI a user can see. Hidden sinks (hidden inputs and headless
 * controllers) have no box to outline, so the legend lists them instead.
 */

import {
    CONTROLLER_ATTR,
    IGNORE_ATTR,
    isPresent,
    MARKING_ATTR,
    STRUCTURAL_ATTRS,
    VIEW_ATTRS,
} from '../binding-model';
import { componentNameForHost } from '../component-factory';
import type { ControllerName } from '../element-scanner';
import { getMountHost } from '../mount-host-registry';
import { adoptStylesOnce } from '../styles/adopt';

/**
 * Presence: a developer's own code fills this element (and its subtree) from
 * EzClassify data. Read only by this overlay; the library never stamps it.
 */
const POWERED_ATTR = 'data-ezclassify-powered';

/** The sibling mount the factory inserts for an interactive controller. */
const MOUNT_ATTR = 'data-ezclassify-mount';

/** Options for {@link createComponentLocator}. */
export interface ComponentLocatorOptions {
    /**
     * Element that receives the `ezclassify-xray` class when the switch is on.
     * Defaults to `document.body`, so `[data-ezclassify-powered]` elements that
     * live outside any ui mount are still outlined.
     */
    target?: HTMLElement;
    /** Override the switch label. Defaults to "Highlight components". */
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

/** The kind of region an outline marks. */
type XrayKind =
    'component' | 'marking' | 'structure' | 'view' | 'ignored' | 'powered';

/** Structural attributes other than `ignore`, which is a kind of its own. */
const STRUCTURE_ATTRS: readonly string[] = STRUCTURAL_ATTRS.filter(
    (attr) => attr !== IGNORE_ATTR,
);

/**
 * The registry attributes that give an element each kind, in priority order: an
 * element that carries several takes the first kind that matches.
 */
const KIND_ATTRIBUTES: ReadonlyArray<readonly [XrayKind, readonly string[]]> = [
    ['ignored', [IGNORE_ATTR]],
    ['view', VIEW_ATTRS],
    ['component', [CONTROLLER_ATTR, MOUNT_ATTR]],
    ['marking', [MARKING_ATTR]],
    ['structure', STRUCTURE_ATTRS],
    ['powered', [POWERED_ATTR]],
];

/** Every attribute the overlay finds. */
const FOUND_ATTRIBUTES: readonly string[] = KIND_ATTRIBUTES.flatMap(
    ([, attrs]) => attrs,
);
const MARKER_SELECTOR = FOUND_ATTRIBUTES.map((attr) => `[${attr}]`).join(',');

/**
 * Controllers that show reference material rather than hold or edit a marking:
 * the handbooks and the reference drawer. They read as views.
 */
const REFERENCE_CONTROLLERS: ReadonlySet<string> = new Set([
    'handbook',
    'guidebook',
    'access-handbook',
    'crosswalk-handbook',
    'context-reference',
]);

/** Controllers that render nothing: their host is a hidden sink. */
const HEADLESS_CONTROLLERS: ReadonlySet<string> = new Set(['hidden']);

/** Legend rows, in reading order, with each kind's palette. */
const KINDS: ReadonlyArray<{
    kind: XrayKind;
    legend: string;
    color: string;
    badge: string;
    dark: string;
    outline: 'dashed' | 'dotted';
}> = [
    {
        kind: 'component',
        legend: 'Components',
        color: '#7c3aed',
        badge: '#6d28d9',
        dark: '#a78bfa',
        outline: 'dashed',
    },
    {
        kind: 'marking',
        legend: 'Bound markings',
        color: '#b45309',
        badge: '#b45309',
        dark: '#fbbf24',
        outline: 'dashed',
    },
    {
        kind: 'structure',
        legend: 'Structure (wholes, collections)',
        color: '#15803d',
        badge: '#15803d',
        dark: '#4ade80',
        outline: 'dashed',
    },
    {
        kind: 'view',
        legend: 'Views and handbooks',
        color: '#1d4ed8',
        badge: '#1d4ed8',
        dark: '#60a5fa',
        outline: 'dashed',
    },
    {
        kind: 'ignored',
        legend: 'Ignored (excluded)',
        color: '#475569',
        badge: '#475569',
        dark: '#94a3b8',
        outline: 'dotted',
    },
    {
        kind: 'powered',
        legend: 'Powered by EzClassify (manual)',
        color: '#0e7490',
        badge: '#0e7490',
        dark: '#22d3ee',
        outline: 'dashed',
    },
];

/**
 * The x-ray stylesheet. Gated entirely on a `.ezclassify-xray` ancestor, so it
 * is inert until the switch turns the class on. Adopted once onto the document;
 * never into a ui root, because `[data-ezclassify-powered]` elements may live
 * anywhere on the page.
 */
const XRAY_CSS = `
/* Palette lives at :root so it resolves everywhere (some chips render on host
   wrappers outside the demo root). These are inert custom properties, harmless
   when x-ray is off. Dark mode only brightens the OUTLINE colors; the chip
   backgrounds stay saturated so white chip text keeps contrast in both.
   Theme state comes from the HOST's theme attributes, never from the
   operating system: the library never queries the OS color-scheme media
   feature (standing rule in styles.css). The selector set and the
   :not([data-color-scheme='light']) shadowing mirror the main stylesheet's
   dark palette block. */
:root {
${KINDS.map((k) => `  --ezx-${k.kind}-color: ${k.color}; --ezx-${k.kind}-badge: ${k.badge};`).join('\n')}
}
[data-color-scheme='dark'],
[data-theme='dark']:not([data-color-scheme='light']),
[data-bs-theme='dark']:not([data-color-scheme='light']),
.dark:not([data-color-scheme='light']) {
${KINDS.map((k) => `  --ezx-${k.kind}-color: ${k.dark};`).join('\n')}
}

/* JavaScript applies one private kind to each rendered region. Raw marker
   attributes are intentionally not styled: hidden controllers and height-zero
   mounts are runtime plumbing, not user-visible components. */
${KINDS.map(
    (k) => `.ezclassify-xray[data-ezclassify-xray-kind='${k.kind}'],
.ezclassify-xray [data-ezclassify-xray-kind='${k.kind}'] {
  --ezx-chip-bg: var(--ezx-${k.kind}-badge);
  --ezx-outline: var(--ezx-${k.kind}-color);
  --ezx-outline-style: ${k.outline};
}`,
).join('\n')}

/* Outlines remain on the rendered region; labels are portaled separately. */
.ezclassify-xray[data-ezclassify-xray-kind],
.ezclassify-xray [data-ezclassify-xray-kind] {
  outline: 2px var(--ezx-outline-style, dashed) var(--ezx-outline);
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
  background: var(--ezx-chip-bg, var(--ezx-component-badge));
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
   legend of every kind. Prefixed ezclassify-locator… to avoid host
   collisions. */
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
  background: var(--ezx-component-badge, #6d28d9);
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
${KINDS.map(
    (k) => `.ezclassify-locator__item--${k.kind} .ezclassify-locator__swatch {
  border-color: var(--ezx-${k.kind}-color, ${k.color});
  border-style: ${k.outline === 'dotted' ? 'dotted' : 'solid'};
  background: var(--ezx-${k.kind}-badge, ${k.badge});
}`,
).join('\n')}
.ezclassify-locator__hidden {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  line-height: 1.4;
}
.ezclassify-locator__hidden[hidden] { display: none; }
.ezclassify-locator__hidden-list {
  list-style: none;
  margin: 0;
  padding: 0 0 0 1.3rem;
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: 0.7rem;
  overflow-wrap: anywhere;
}

/* The console switch's control floats in a corner of a page it was not
   designed into. */
.ezclassify-locator--floating {
  position: fixed;
  right: 1rem;
  bottom: 1rem;
  z-index: 2147483646;
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

const XRAY_KIND_ATTRIBUTE = 'data-ezclassify-xray-kind';
const XRAY_LABEL_ATTRIBUTE = 'data-ezclassify-xray-label';

/** The host a factory mount was created for, when the element is a mount. */
function mountedHost(element: HTMLElement): HTMLElement | null {
    if (!element.hasAttribute(MOUNT_ATTR)) return null;
    const host = getMountHost(element);
    return host && host !== element ? host : null;
}

/** The controller an element mounts, read off the host or its mount. */
function controllerOf(element: HTMLElement): string | null {
    return (
        element.getAttribute(CONTROLLER_ATTR) ??
        element.getAttribute(MOUNT_ATTR)
    );
}

/**
 * The kind an element's own attributes give it, or null when it carries none of
 * the registry attributes. A mount takes the kind of the host it was created
 * for.
 */
function markerKind(element: HTMLElement): XrayKind | null {
    const host = mountedHost(element);
    if (host) return markerKind(host) ?? 'component';
    for (const [kind, attrs] of KIND_ATTRIBUTES) {
        if (!attrs.some((attr) => isPresent(element, attr))) continue;
        if (
            kind === 'component' &&
            REFERENCE_CONTROLLERS.has(controllerOf(element) ?? '')
        )
            return 'view';
        return kind;
    }
    return null;
}

/** `whole: doc-1`, or the bare name for a presence attribute. */
function attributeText(element: HTMLElement, attr: string): string {
    const name = attr.slice('data-ezclassify-'.length);
    const value = element.getAttribute(attr)?.trim();
    return value && value !== 'true' ? `${name}: ${value}` : name;
}

/** The text of each attribute in `attrs` the element carries. */
function attributesText(
    element: HTMLElement,
    attrs: readonly string[],
): string[] {
    return attrs
        .filter((attr) => isPresent(element, attr))
        .map((attr) => attributeText(element, attr));
}

/**
 * The chip text for an element of a kind: what it is, then any structural
 * attribute it also carries, so a part shows the whole it belongs to.
 */
function markerLabel(marker: HTMLElement, kind: XrayKind): string {
    const element = mountedHost(marker) ?? marker;
    const controller = controllerOf(element);
    const component = componentNameForHost(
        element,
        controller as ControllerName | null,
    );
    const library = component
        ? `@ezclassify/ui: ${component}`
        : '@ezclassify/ui';
    let head: string;
    switch (kind) {
        case 'component':
            head = library;
            break;
        case 'marking':
            head = element.id ? `marking #${element.id}` : 'marking';
            break;
        case 'view': {
            const views = attributesText(element, VIEW_ATTRS);
            head = views.length
                ? [...views, ...(component ? [component] : [])].join(' · ')
                : library;
            break;
        }
        case 'structure':
            return attributesText(element, STRUCTURE_ATTRS).join(' · ');
        case 'ignored':
            return 'ignored: excluded';
        case 'powered':
            return 'powered by EzClassify';
    }
    return [head, ...attributesText(element, STRUCTURE_ATTRS)].join(' · ');
}

/** A hidden input or a headless controller: data with no box to outline. */
function isHiddenSink(element: HTMLElement): boolean {
    if (element instanceof HTMLInputElement && element.type === 'hidden')
        return true;
    return HEADLESS_CONTROLLERS.has(
        element.getAttribute(CONTROLLER_ATTR) ?? '',
    );
}

/** Whether a powered element sits inside another powered region. */
function insidePoweredRegion(element: HTMLElement): boolean {
    for (
        let ancestor = element.parentElement;
        ancestor;
        ancestor = ancestor.parentElement
    ) {
        if (isPresent(ancestor, POWERED_ATTR)) return true;
    }
    return false;
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

/** A hidden sink the legend lists. */
interface HiddenSink {
    kind: XrayKind;
    label: string;
}

/**
 * Mark every rendered region under `target` with its kind and label, and return
 * the regions plus the hidden sinks that have no box to outline.
 */
function syncTargets(target: HTMLElement): {
    regions: HTMLElement[];
    hidden: HiddenSink[];
} {
    const markers: HTMLElement[] = [];
    if (target.matches(MARKER_SELECTOR)) markers.push(target);
    markers.push(...target.querySelectorAll<HTMLElement>(MARKER_SELECTOR));

    const priority = (kind: XrayKind) =>
        KIND_ATTRIBUTES.length -
        KIND_ATTRIBUTES.findIndex(([candidate]) => candidate === kind);
    const chosen = new Map<HTMLElement, { kind: XrayKind; label: string }>();
    const hidden: HiddenSink[] = [];
    for (const marker of markers) {
        const kind = markerKind(marker);
        if (!kind) continue;
        if (isHiddenSink(marker)) {
            const label = markerLabel(marker, kind);
            hidden.push({
                kind,
                label:
                    marker.id && kind !== 'marking'
                        ? `${label} · #${marker.id}`
                        : label,
            });
            continue;
        }
        if (kind === 'powered' && insidePoweredRegion(marker)) continue;
        const host = chipHost(marker, target);
        if (!isRendered(host)) continue;
        if (host === marker && isPairedPlumbingMount(marker)) continue;
        const current = chosen.get(host)?.kind;
        if (!current || priority(kind) > priority(current)) {
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
    return { regions: [...chosen.keys()], hidden };
}

/**
 * Build a self-contained "Highlight components" control: a real on/off toggle
 * slider plus a legend (shown only when on). Toggling outlines the currently
 * rendered EzClassify regions and keeps that set synchronized as the page
 * changes. Labels live in a viewport overlay, outside clipping ancestors, and
 * follow visible regions on scroll and resize without intercepting input.
 * Append the returned `element` where the control should sit and call
 * `destroy()` to remove it.
 */
export function createComponentLocator(
    options: ComponentLocatorOptions = {},
): ComponentLocator {
    injectLocatorStyles();

    const label = options.label ?? 'Highlight components';

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
    for (const row of KINDS) {
        const item = document.createElement('li');
        item.className = `ezclassify-locator__item ezclassify-locator__item--${row.kind}`;
        const swatch = document.createElement('span');
        swatch.className = 'ezclassify-locator__swatch';
        swatch.setAttribute('aria-hidden', 'true');
        const text = document.createElement('span');
        text.textContent = row.legend;
        item.appendChild(swatch);
        item.appendChild(text);
        legend.appendChild(item);
    }
    const hiddenItem = document.createElement('li');
    hiddenItem.className = 'ezclassify-locator__hidden';
    hiddenItem.hidden = true;
    const hiddenHeading = document.createElement('span');
    const hiddenList = document.createElement('ul');
    hiddenList.className = 'ezclassify-locator__hidden-list';
    hiddenItem.append(hiddenHeading, hiddenList);
    legend.appendChild(hiddenItem);
    let hiddenKey = '';
    const listHidden = (sinks: HiddenSink[]) => {
        // Compare first: the control may sit inside the observed target, and
        // an unchanged list must not write and wake the observer again.
        const key = sinks.map((s) => `${s.kind}\u001f${s.label}`).join('\n');
        if (key === hiddenKey) return;
        hiddenKey = key;
        hiddenItem.hidden = sinks.length === 0;
        hiddenHeading.textContent = `Hidden, not outlined (${sinks.length})`;
        hiddenList.replaceChildren(
            ...sinks.map((sink) => {
                const entry = document.createElement('li');
                entry.className = `ezclassify-locator__item ezclassify-locator__item--${sink.kind}`;
                const swatch = document.createElement('span');
                swatch.className = 'ezclassify-locator__swatch';
                swatch.setAttribute('aria-hidden', 'true');
                const text = document.createElement('span');
                text.textContent = sink.label;
                entry.append(swatch, text);
                return entry;
            }),
        );
    };

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
        const { regions, hidden } = syncTargets(target);
        listHidden(hidden);
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
                // Labels and the legend are owned output, not changes to the
                // host UI. In the default body scope their writes must not
                // self-schedule.
                if (
                    records.some(
                        (record) =>
                            !overlay.contains(record.target) &&
                            !root.contains(record.target),
                    )
                )
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
                    'type',
                    'id',
                    ...FOUND_ATTRIBUTES,
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
            listHidden([]);
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
