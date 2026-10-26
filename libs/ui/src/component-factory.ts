/**
 * Component instantiation and option parsing for the view layer.
 *
 * The view layer accepts a controller name and a pre-harvested options bag from
 * the scanner (`data-ezclassify-<controller>-*` attributes), and is responsible
 * for picking the right component class, parsing strongly-typed options, and
 * arranging the mount container.
 */

import type { ControllerName } from './element-scanner';
import { resolveFormatAttr } from './format-resolver';
import { setMountHost } from './mount-host-registry';
import type {
    ComponentInstance,
    ComponentOptions,
} from './components/component-base';
import { TagInput } from './components/tag-input';
import { SingleSelect } from './components/single-select';
import { CategoryChecklist } from './components/category-checklist';
import { CategorySelector } from './components/category-selector';
import { AssertionCard } from './components/assertion-card';
import { StatusBanner } from './components/status-banner';
import { DualPane } from './components/dual-pane';
import { Handbook } from './components/handbook';
import { Guidebook } from './components/guidebook';
import { AccessHandbook } from './components/access-handbook';
import { ContextReference } from './components/context-reference';
import { GuideChecklist } from './components/guide-helper';
import { DecisionFlow } from './components/decision-flow';
import { HiddenAssertionField } from './components/hidden-assertion-field';
import { MarkedTextArea } from './components/marked-text-area';
import { MarkedInput } from './components/marked-input';
import { MarkingField } from './components/marking-field';
import { EzClassifyText } from './components/ezclassify-text';
import { EquivalencyMap } from './components/equivalency-map';

/**
 * Translate a harvested options bag (`data-ezclassify-<controller>-*`) into the
 * strongly-typed options the components expect. Unknown suffixes are passed
 * through verbatim so per-controller extensions don't need to update this
 * function.
 *
 * The element is also consulted for shared host-level attributes
 * (`data-ezclassify-scope`, `data-ezclassify-scheme`,
 * `data-ezclassify-category`, `data-ezclassify-format`) so they can be set once
 * at the host element rather than repeated under the controller prefix. A
 * controller-prefixed option always wins over the host attribute.
 */
export function parseComponentOptions(
    el: HTMLElement,
    raw: Record<string, string>,
): Record<string, unknown> {
    const opts: Record<string, unknown> = { ...raw };
    if (typeof opts['format'] === 'string') {
        opts.formatId = opts['format'];
        delete opts['format'];
    }
    if (typeof opts['category'] === 'string') {
        opts.categoryId = opts['category'];
        delete opts['category'];
    }
    if (typeof opts['primary-category'] === 'string') {
        opts.primaryCategoryId = opts['primary-category'];
        delete opts['primary-category'];
    }
    if (typeof opts['parent-concept'] === 'string') {
        opts.parentConcept = opts['parent-concept'];
        delete opts['parent-concept'];
    }
    if ('show-preview' in opts) {
        opts.showPreview = true;
        delete opts['show-preview'];
    }
    if ('show-codes' in opts) {
        opts.showCodes = true;
        delete opts['show-codes'];
    }
    if ('show-current-data' in opts) {
        opts.showCurrentData = true;
        delete opts['show-current-data'];
    }
    if (typeof opts['current-label'] === 'string') {
        opts.currentLabel = opts['current-label'];
        delete opts['current-label'];
    }
    if (typeof opts['boundary-label'] === 'string') {
        opts.boundaryLabel = opts['boundary-label'];
        delete opts['boundary-label'];
    }
    if (typeof opts['color-map'] === 'string') {
        try {
            opts.colorMap = JSON.parse(opts['color-map'] as string);
        } catch {
            /* ignore invalid JSON */
        }
        delete opts['color-map'];
    }
    if (typeof opts['category-groups'] === 'string') {
        try {
            opts.categoryGroups = JSON.parse(opts['category-groups'] as string);
        } catch {
            /* ignore invalid JSON */
        }
        delete opts['category-groups'];
    }

    // Opt-outs for optional guidance surfaces (Progressive Enhancement
    // Contract). Closest-ancestor semantics like data-ezclassify-scheme: the
    // attribute on the host or any ancestor disables the surface for the
    // subtree. Only helper surfaces are configurable; validation display and
    // core interaction behavior are not.
    if (el.closest('[data-ezclassify-no-tooltips]')) opts.tooltips = false;
    if (el.closest('[data-ezclassify-no-hints]')) opts.hints = false;

    // Shared binding attributes (live on the host element, not under the controller prefix).
    const scope = el.getAttribute('data-ezclassify-scope');
    if (scope) opts.scope = scope;
    const scheme =
        el.getAttribute('data-ezclassify-scheme') ??
        el
            .closest('[data-ezclassify-scheme]')
            ?.getAttribute('data-ezclassify-scheme');
    if (scheme) opts.schemeId = scheme;
    // Allow category to live as a top-level binding too, when not specified on the controller prefix.
    if (!opts.categoryId) {
        const category = el.getAttribute('data-ezclassify-category');
        if (category) opts.categoryId = category;
    }
    // Same rule for the render format. `data-ezclassify-format` is a host-level
    // attribute in the documented grammar and the forms layer has always read
    // it off a plain enhanced input; a controller host is still a field, so the
    // attribute has to mean the same thing there. Read from the host element
    // only, not the closest ancestor: format is a per-field choice, and
    // inheriting it would retag every controller under a wrapper that set one.
    if (!opts.formatId) {
        const format = resolveFormatAttr(el);
        if (format) opts.formatId = format;
    }
    return opts;
}

/**
 * Resolve the native input element for a component host. For fieldsets, finds
 * or creates a child hidden input. For other elements, returns the element
 * itself cast as an input.
 */
export function resolveNativeInput(
    el: HTMLElement,
    controller: ControllerName,
): HTMLInputElement {
    if (el.tagName === 'FIELDSET') {
        let hidden = el.querySelector<HTMLInputElement>('input[type="hidden"]');
        if (!hidden) {
            hidden = document.createElement('input');
            hidden.type = 'hidden';
            hidden.name = el.getAttribute('name') ?? el.id ?? controller;
            el.appendChild(hidden);
        }
        return hidden;
    }
    return el as HTMLInputElement;
}

/**
 * Create a mount container for the component. Interactive controllers get a
 * sibling div; read-only controllers mount in place.
 */
export function createMountContainer(
    el: HTMLElement,
    controller: ControllerName,
): HTMLDivElement {
    // 'text' renders no UI of its own; the host element IS the marking surface.
    // 'equivalency' mounts its table in-place inside the host div.
    // 'context-reference' mounts in place because its host-authored custom-tab
    // children live inside the host element; a sibling mount would hide them
    // behind a display:none host and the drawer would never see them.
    // Same in-place treatment as 'card' / 'banner'.
    const isInteractive =
        controller !== 'card' &&
        controller !== 'banner' &&
        controller !== 'text' &&
        controller !== 'equivalency' &&
        controller !== 'context-reference';
    // Text editors manage their own native visibility. MarkingField keeps a
    // textarea editable in place or supplies an owned wrapping editor for an
    // input, while the original control remains the form/binding target.
    const keepElementVisible =
        controller === 'marked-textarea' ||
        controller === 'marked-input' ||
        controller === 'marking';

    if (isInteractive) {
        const container = document.createElement('div');
        container.setAttribute('data-ezclassify-mount', controller);
        el.parentNode?.insertBefore(container, el.nextSibling);
        // Remember which host this sibling container belongs to, so the controller
        // binds ITS host and not a stray sibling input under the shared parent.
        setMountHost(container, el);
        // Hides the [data-ezclassify-controller] host element; the visible mount point is [data-ezclassify-mount]; target that selector in tests and DOM queries.
        if (!keepElementVisible) el.style.display = 'none';
        return container;
    }
    // An in-place controller's host is its own container. Recording that keeps
    // it from adopting an unrelated sibling input under the shared parent.
    setMountHost(el, el);
    return el as HTMLDivElement;
}

/**
 * Instantiate the appropriate component class for a given controller name.
 * Returns null if the name is unrecognized.
 */
interface ComponentRegistration {
    name: string;
    create: () => ComponentInstance;
}

/**
 * The canonical controller-to-component registry. Tooling such as the component
 * locator reads the same registry as the factory, so a component's public class
 * name never has to be repeated in host markup or demo CSS.
 */
const COMPONENT_REGISTRY: ReadonlyMap<string, ComponentRegistration> = new Map([
    ['tags', { name: 'TagInput', create: () => new TagInput() }],
    ['select', { name: 'SingleSelect', create: () => new SingleSelect() }],
    [
        'checklist',
        {
            name: 'CategoryChecklist',
            create: () => new CategoryChecklist(),
        },
    ],
    [
        'selector',
        { name: 'CategorySelector', create: () => new CategorySelector() },
    ],
    ['card', { name: 'AssertionCard', create: () => new AssertionCard() }],
    ['banner', { name: 'StatusBanner', create: () => new StatusBanner() }],
    ['dualpane', { name: 'DualPane', create: () => new DualPane() }],
    ['handbook', { name: 'Handbook', create: () => new Handbook() }],
    ['guidebook', { name: 'Guidebook', create: () => new Guidebook() }],
    [
        'access-handbook',
        { name: 'AccessHandbook', create: () => new AccessHandbook() },
    ],
    [
        'context-reference',
        { name: 'ContextReference', create: () => new ContextReference() },
    ],
    [
        'guide-helper',
        { name: 'GuideChecklist', create: () => new GuideChecklist() },
    ],
    [
        'guide-checklist',
        { name: 'GuideChecklist', create: () => new GuideChecklist() },
    ],
    [
        'decisionflow',
        { name: 'DecisionFlow', create: () => new DecisionFlow() },
    ],
    [
        'hidden',
        {
            name: 'HiddenAssertionField',
            create: () => new HiddenAssertionField(),
        },
    ],
    [
        'marked-textarea',
        { name: 'MarkedTextArea', create: () => new MarkedTextArea() },
    ],
    ['marked-input', { name: 'MarkedInput', create: () => new MarkedInput() }],
    ['marking', { name: 'MarkingField', create: () => new MarkingField() }],
    ['text', { name: 'EzClassifyText', create: () => new EzClassifyText() }],
    [
        'equivalency',
        { name: 'EquivalencyMap', create: () => new EquivalencyMap() },
    ],
]);

/** Return the public component class name for a declarative controller. */
export function componentNameForController(controller: string): string | null {
    return COMPONENT_REGISTRY.get(controller)?.name ?? null;
}

export function createComponent(
    controller: ControllerName,
): ComponentInstance | null {
    return COMPONENT_REGISTRY.get(controller)?.create() ?? null;
}

/**
 * Build the final component options by merging parsed controller options with
 * framework plumbing overrides.
 */
export function buildComponentOptions(
    parsedOpts: Record<string, unknown>,
    overrides: Partial<ComponentOptions> & Record<string, unknown>,
): ComponentOptions & Record<string, unknown> {
    return {
        ...parsedOpts,
        ...overrides,
    };
}
