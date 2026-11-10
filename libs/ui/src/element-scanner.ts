/**
 * DOM element discovery for ezclassify.
 *
 * The scanner is the single seam between two layers of the library:
 *
 * - Behavior layer, engine binding. An element is reported to `onBehavior` when
 *   it carries any `data-ezclassify-*` attribute. The callback receives a
 *   parsed `BehaviorBinding` describing the engine wiring (marking, bound-to,
 *   source, aggregate, translate, part-of, facet-of, category, scope, scheme).
 *   Where the element sits in the marking tree is the binding model's call
 *   (`binding-model.ts`), not the scanner's. Behavior callbacks must not mutate
 *   the DOM beyond reading values and listening for events.
 * - View layer, visual treatment. An element is reported to `onView` when it
 *   carries `data-ezclassify-controller="<name>"`. The callback receives the
 *   controller name and an options bag harvested from
 *   `data-ezclassify-<controller>-*` attributes on the element.
 *
 * An element with a controller is also behavior-bound (since the controller
 * attribute is itself a `data-ezclassify-*` attribute), and the scanner
 * guarantees `onBehavior` is called before `onView` so the view layer sees
 * engine binding already wired.
 */

import {
    CONTROLLER_ATTR,
    isPresent,
    MARKING_ATTR,
    STRUCTURAL_ATTRS,
    VIEW_ATTRS,
} from './binding-model';

/** Recognized controller names: the visual-treatment side of the seam. */
export const CONTROLLER_NAMES = [
    'tags',
    'select',
    'checklist',
    'selector',
    'card',
    'banner',
    'dualpane',
    'handbook',
    'guidebook',
    'access-handbook',
    'crosswalk-handbook',
    'context-reference',
    'guide-helper',
    'guide-checklist',
    'decisionflow',
    'hidden',
    'marked-textarea',
    'marked-input',
    'marking',
    'text',
    'equivalency',
] as const;

export type ControllerName = (typeof CONTROLLER_NAMES)[number];

/** Parsed binding read off the `data-ezclassify-*` attributes of an element. */
export interface BehaviorBinding {
    /**
     * `data-ezclassify-marking` (presence-only): this element IS a marking; its
     * DOM `id` is the marking id. A visible text input gets the validation
     * helper, a hidden input holds the value, any other element shows it.
     */
    marking: boolean;
    /**
     * `data-ezclassify-bound-to="<id>"`: two-way full-marking view of the named
     * marking.
     */
    boundTo?: string;
    /** `data-ezclassify-source="<id>"`: one-way read of the named marking. */
    source?: string;
    /**
     * `data-ezclassify-aggregate`: one-way read of a level. Empty for the
     * instance root (the page); otherwise the id of a whole (its parts'
     * roll-up) or a collection (its members'). React's `"true"` reads as
     * empty.
     */
    aggregate?: string;
    /**
     * `data-ezclassify-translate="<crosswalk id>"`: the view shows its value
     * translated through that crosswalk. Empty when the Context holds exactly
     * one crosswalk from its primary scheme.
     */
    translate?: string;
    /** `data-ezclassify-category="<id>"` */
    category?: string;
    /** `data-ezclassify-part-of="<id>"` */
    partOf?: string;
    /**
     * `data-ezclassify-facet-of="<id>"`: two-way category-scoped view of the
     * named marking. Used with `data-ezclassify-category`.
     */
    facetOf?: string;
    /** `data-ezclassify-scope` (presence-only flag or scope label). */
    scope?: string;
    /** `data-ezclassify-scheme="<selector>"`: the Context-local scheme. */
    scheme?: string;
}

export type BehaviorCallback = (
    el: HTMLElement,
    binding: BehaviorBinding,
) => void;
export type ViewCallback = (
    el: HTMLElement,
    controller: ControllerName,
    options: Record<string, string>,
) => void;

const CONTROLLER_NAME_SET: ReadonlySet<string> = new Set(CONTROLLER_NAMES);

/**
 * Binding axis: an element picks exactly ONE of these as its "what does this
 * element bind to" relationship. The order here is canonical (matches the §3
 * table in `docs/binding-model.md`) and is the order used when an element
 * declares more than one; we keep the first present, drop the rest, warn.
 */
const BINDING_AXIS_ATTRS = [
    'data-ezclassify-bound-to',
    'data-ezclassify-facet-of',
    'data-ezclassify-source',
    'data-ezclassify-aggregate',
] as const;

/**
 * Warn-once tracking. Keyed by the offending HTMLElement so the same warning
 * never fires twice for the same node; important on frameworks that re-render
 * the same element across state changes.
 */
const warnedAxisDup = new WeakSet<HTMLElement>();
const warnedFrameworkTwoWay = new WeakSet<HTMLElement>();
/**
 * True when the element has any `data-ezclassify-*` attribute (any one implies
 * binding).
 */
export function isBehaviorBound(el: HTMLElement): boolean {
    for (let i = 0; i < el.attributes.length; i++) {
        if (el.attributes[i].name.startsWith('data-ezclassify-')) return true;
    }
    return false;
}

/**
 * Detect a framework two-way binding attribute that fights ezclassify's store.
 * Returns the offending attribute name (for the warning message) or null.
 *
 * React's `value` + `onChange` pair lives on the component props and never
 * appears in the rendered DOM, so the React analog is a docs-only rule.
 */
function detectFrameworkTwoWay(el: HTMLElement): string | null {
    // HTMLElement attribute names are normalized to lowercase by the parser.
    if (el.hasAttribute('[(ngmodel)]')) return '[(ngModel)]';
    if (el.hasAttribute('[ngmodel]') && el.hasAttribute('(ngmodelchange)')) {
        return '[ngModel] paired with (ngModelChange)';
    }
    for (let i = 0; i < el.attributes.length; i++) {
        const name = el.attributes[i].name;
        if (
            name === 'v-model' ||
            name.startsWith('v-model:') ||
            name.startsWith('v-model.')
        ) {
            return name;
        }
    }
    return null;
}

/**
 * Read the engine wiring an element declares.
 *
 * @param el - Element to read
 * @returns The parsed binding; axis duplicates keep the first in table order
 */
export function readBinding(el: HTMLElement): BehaviorBinding {
    const binding: BehaviorBinding = {
        marking: isPresent(el, MARKING_ATTR),
    };

    const axisPresent = BINDING_AXIS_ATTRS.filter((a) => el.hasAttribute(a));
    if (axisPresent.length > 1 && !warnedAxisDup.has(el)) {
        warnedAxisDup.add(el);
        console.warn(
            `[ezclassify] element has ${axisPresent.length} binding axis attributes ` +
                `(${axisPresent.join(', ')}); using "${axisPresent[0]}" and ignoring the rest. ` +
                'Pick exactly one of bound-to / facet-of / source / aggregate per element.',
        );
    }
    const axis = axisPresent[0];
    if (axis === 'data-ezclassify-bound-to') {
        const v = el.getAttribute('data-ezclassify-bound-to');
        if (v) binding.boundTo = v;
    } else if (axis === 'data-ezclassify-facet-of') {
        const v = el.getAttribute('data-ezclassify-facet-of');
        if (v) binding.facetOf = v;
    } else if (axis === 'data-ezclassify-source') {
        const v = el.getAttribute('data-ezclassify-source');
        if (v) binding.source = v;
    } else if (axis === 'data-ezclassify-aggregate') {
        const v = el.getAttribute('data-ezclassify-aggregate')?.trim() ?? '';
        binding.aggregate = v === 'true' ? '' : v;
    }
    const translate = el.getAttribute('data-ezclassify-translate');
    if (translate !== null) binding.translate = translate.trim();

    const category = el.getAttribute('data-ezclassify-category');
    if (category) binding.category = category;
    const partOf = el.getAttribute('data-ezclassify-part-of');
    if (partOf) binding.partOf = partOf;
    const scope = el.getAttribute('data-ezclassify-scope');
    if (scope !== null) binding.scope = scope;
    const scheme = el.getAttribute('data-ezclassify-scheme');
    if (scheme) binding.scheme = scheme;

    const fw = detectFrameworkTwoWay(el);
    if (fw && !warnedFrameworkTwoWay.has(el)) {
        warnedFrameworkTwoWay.add(el);
        console.warn(
            `[ezclassify] element is ezclassify-managed AND carries a framework ` +
                `two-way binding attribute (${fw}). The framework and the store will ` +
                'both write .value and fight each other. Use the framework helper ' +
                '(bindEzClassifyToSignal / useEzClassify / EzClassifyProvider) instead.',
        );
    }

    return binding;
}

/**
 * The controller named by `data-ezclassify-controller`, or null.
 *
 * The attribute value is author-controlled DOM text, so it is checked against a
 * `Set` of the known names rather than looked up in a plain object: an object
 * lookup resolves any `Object.prototype` member (`constructor`, `toString`,
 * ...) to a truthy value, which would hide the host element while mounting
 * nothing.
 *
 * @param el - Element to read
 * @returns The controller name, or null when the attribute is absent or names
 *   nothing known
 */
function readController(el: HTMLElement): ControllerName | null {
    const v = el.getAttribute('data-ezclassify-controller');
    if (!v) return null;
    return CONTROLLER_NAME_SET.has(v) ? (v as ControllerName) : null;
}

/**
 * Collect every `data-ezclassify-<controller>-<option>` attribute on `el` into
 * a plain options bag. Keys are returned in kebab-case (the original suffix),
 * values are the attribute's string value. Consumers can JSON-parse, coerce, or
 * rename as needed.
 *
 * @param el - Element to read
 * @param controller - Resolved controller name, which names the attribute
 *   prefix
 * @returns Option keys in kebab-case, mapped to their attribute values
 */
export function harvestControllerOptions(
    el: HTMLElement,
    controller: ControllerName,
): Record<string, string> {
    const prefix = `data-ezclassify-${controller}-`;
    const opts: Record<string, string> = {};
    for (let i = 0; i < el.attributes.length; i++) {
        const a = el.attributes[i];
        if (a.name.length > prefix.length && a.name.startsWith(prefix)) {
            opts[a.name.slice(prefix.length)] = a.value;
        }
    }
    return opts;
}

/** Marker attribute each EzClassifyUI stamps on its root. The boundary. */
export const MOUNT_ROOT_ATTR = 'data-ezclassify-mount-root';

/** All `data-ezclassify-*` attribute selectors the scanner reports on. */
export const EZ_SELECTOR =
    '[data-ezclassify-controller], [data-ezclassify-marking], ' +
    '[data-ezclassify-bound-to], [data-ezclassify-source], [data-ezclassify-aggregate], ' +
    '[data-ezclassify-translate], [data-ezclassify-category], [data-ezclassify-part-of], ' +
    '[data-ezclassify-facet-of], [data-ezclassify-scope], ' +
    '[data-ezclassify-scheme], [data-ezclassify-whole], [data-ezclassify-collection], ' +
    '[data-ezclassify-member-of], [data-ezclassify-ignore]';

/**
 * Ownership boundary: an element is owned by the instance whose mount root is
 * its NEAREST `[data-ezclassify-mount-root]` ancestor (or self). When `ownerId`
 * is `null` no boundary is enforced (a consumer scanning a tree it does not
 * stamp). The boundary is what eliminates cross-instance double-enhancement: an
 * enclosing instance scanning the whole subtree skips any element that a nested
 * instance's root encloses more tightly.
 */
export function isOwnedBy(el: HTMLElement, ownerId: string | null): boolean {
    if (ownerId == null) return true;
    const nearest = el.closest(`[${MOUNT_ROOT_ATTR}]`);
    // No enclosing mount root at all → treat as owned (single-mount / unstamped
    // page where the instance scans a root it did not mark).
    if (!nearest) return true;
    return nearest.getAttribute(MOUNT_ROOT_ATTR) === ownerId;
}

function emitOne(
    el: HTMLElement,
    ownerId: string | null,
    onBehavior: BehaviorCallback,
    onView: ViewCallback,
): void {
    if (!isBehaviorBound(el)) return;
    if (!isOwnedBy(el, ownerId)) return;
    onBehavior(el, readBinding(el));
    const controller = readController(el);
    if (controller)
        onView(el, controller, harvestControllerOptions(el, controller));
}

/**
 * Scan a root element for descendants bearing `data-ezclassify-*` attributes,
 * invoking the appropriate callback(s) for each match owned by `ownerId`.
 *
 * `ownerId` is the calling instance's `data-ezclassify-mount-root` value.
 * Elements whose nearest mount-root ancestor is a DIFFERENT instance are
 * skipped; that is the cross-instance ownership boundary. Pass `null` to scan
 * with no boundary (un-owned scans).
 */
export function scanElements(
    root: HTMLElement,
    ownerId: string | null,
    onBehavior: BehaviorCallback,
    onView: ViewCallback,
): void {
    root.querySelectorAll<HTMLElement>(EZ_SELECTOR).forEach((el) =>
        emitOne(el, ownerId, onBehavior, onView),
    );
}

/**
 * The attributes whose change derives an element again: what it is (its
 * controller, a marking, the view it is and what that view reads) and where it
 * sits in the marking tree. A controller's options and the presentation
 * attributes are read when the element mounts.
 */
const DERIVING_ATTRS: readonly string[] = [
    CONTROLLER_ATTR,
    MARKING_ATTR,
    ...VIEW_ATTRS,
    'data-ezclassify-category',
    'data-ezclassify-scope',
    ...STRUCTURAL_ATTRS,
];

/** Each observer's record handler, for {@link flushObserver}. */
const observerHandlers = new WeakMap<
    MutationObserver,
    (mutations: MutationRecord[]) => void
>();

/**
 * Handle the records `observer` has queued now rather than on the next
 * microtask, so a caller that changed the DOM sees the result synchronously.
 *
 * @param observer - An observer {@link observeNewElements} returned
 */
export function flushObserver(observer: MutationObserver): void {
    const records = observer.takeRecords();
    if (records.length > 0) observerHandlers.get(observer)?.(records);
}

/**
 * Watch `root` for elements added or removed later that carry
 * `data-ezclassify-*` attributes, and for attribute changes that alter what an
 * element is or where it sits in the marking tree.
 *
 * - Added elements owned by `ownerId` run through the behavior/view callbacks.
 * - Removed elements (and their `data-ezclassify-*` descendants) are reported to
 *   `onRemove` so the caller can tear down the components it created for them.
 * - An element whose controller, binding or structural attribute was added,
 *   changed or removed is reported once per batch to `onStructureChange`, so
 *   the caller can derive its subtree again. An element added in the same
 *   batch, or inside another reported element, is not reported: that derivation
 *   already reads it.
 *
 * A node reported in `removedNodes` that is still connected within `root` was
 * merely RELOCATED (the enhance path moves a keep-visible host into its own
 * wrapper); it is NOT reported to `onRemove`. Only nodes that actually left the
 * observed subtree count as removals.
 *
 * @returns The observer, so the caller can disconnect on cleanup
 */
export function observeNewElements(
    root: HTMLElement,
    ownerId: string | null,
    onBehavior: BehaviorCallback,
    onView: ViewCallback,
    onRemove?: (el: HTMLElement) => void,
    onStructureChange?: (el: HTMLElement) => void,
): MutationObserver {
    const handle = (mutations: MutationRecord[]): void => {
        const added = new Set<Node>();
        const restructured = new Set<HTMLElement>();
        for (const m of mutations) {
            if (m.type === 'attributes') {
                if (m.target instanceof HTMLElement) restructured.add(m.target);
                continue;
            }
            for (let i = 0; i < m.addedNodes.length; i++) {
                const node = m.addedNodes[i];
                if (!(node instanceof HTMLElement)) continue;
                added.add(node);
                emitOne(node, ownerId, onBehavior, onView);
                scanElements(node, ownerId, onBehavior, onView);
            }
            if (onRemove) {
                for (let i = 0; i < m.removedNodes.length; i++) {
                    const node = m.removedNodes[i];
                    if (!(node instanceof HTMLElement)) continue;
                    // A node still connected within the observed root was RELOCATED,
                    // not removed. Enhancing a keep-visible host (marked-input /
                    // marked-textarea) moves its native node into a freshly created
                    // wrapper, which the observer reports as a removal from the old
                    // parent paired with an addition under the wrapper. Tearing the
                    // host down here would destroy the component we just built and
                    // clear its ownership, so the paired addedNodes record re-enhances
                    // it, which moves it again: an unbounded observer loop that pins
                    // the main thread. Only release hosts that actually left our
                    // subtree; a same-root move keeps its existing enhancement (the
                    // addedNodes dedup guards make the re-observation a no-op).
                    if (root.contains(node)) continue;
                    // The removed node itself, then every data-ezclassify host beneath
                    // it; a removed subtree must release all of its enhanced hosts, not
                    // just the top node.
                    if (isBehaviorBound(node)) onRemove(node);
                    node.querySelectorAll<HTMLElement>(EZ_SELECTOR).forEach(
                        (el) => onRemove(el),
                    );
                }
            }
        }
        if (!onStructureChange) return;
        for (const el of restructured) {
            if (!el.isConnected || !root.contains(el)) continue;
            let fresh = false;
            for (const node of added)
                if (node.contains(el)) {
                    fresh = true;
                    break;
                }
            if (fresh) continue;
            // An enclosing element derived again covers this one.
            let covered = false;
            for (const other of restructured)
                if (other !== el && other.contains(el)) {
                    covered = true;
                    break;
                }
            if (!covered) onStructureChange(el);
        }
    };
    const observer = new MutationObserver(handle);
    observerHandlers.set(observer, handle);
    observer.observe(root, {
        childList: true,
        subtree: true,
        attributes: !!onStructureChange,
        ...(onStructureChange ? { attributeFilter: [...DERIVING_ATTRS] } : {}),
    });
    return observer;
}
