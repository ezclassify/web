/**
 * ContextReference Component
 *
 * A reference drawer that docks the loaded context's reference material to a
 * viewport edge as a tabbed panel. The built-in tabs are derived from the
 * context's RESOLVED COMPOSITION (a scheme yields a handbook tab, one or more
 * loaded guides yield a single guidebook tab, a loaded access policy yields an
 * access tab) and each built-in tab COMPOSES the existing reference component
 * ({@link Handbook}, {@link Guidebook}, {@link AccessHandbook}). Those three
 * already resolve the local synchronous adapter and the remote `MaybePromise`
 * adapter themselves, so both-modes support is inherited, not rebuilt here.
 *
 * Presence is read from what the composition actually loaded, not from whether
 * an ops object happens to exist: the remote `EzClassifyClient` always exposes
 * a `guide` and `access` surface even for a scheme-only context, so this
 * component asks the adapter's cached composition-presence contract for the
 * resolved artifact families. A scheme-only remote context therefore shows only
 * the handbook without calling an absent-artifact route, while a present access
 * policy with zero rules still gets its AccessHandbook tab.
 *
 * A host adds its own tab declaratively: any child element marked
 * `data-ezclassify-tab` (with `data-ezclassify-tab-label`) becomes a tab beside
 * the built-ins. The host's element is NEVER relocated: it stays exactly where
 * the framework rendered it and is projected as a tabpanel in place (role,
 * labeling, and visibility are toggled on it; its position and ownership are
 * left alone). Moving a framework-owned node into a generated panel would leave
 * React/Vue/Angular believing the node is still their direct child, and the
 * next reactive removal or reorder would throw `NotFoundError`. Keeping it in
 * place is what lets a custom tab be one primitive across all four packages
 * while the framework keeps full control of its lifecycle. The
 * React/Vue/Angular bindings resolve their children/slots/`ng-content` to this
 * exact child DOM.
 *
 * The drawer is a presentation surface, never an access boundary. Which tabs to
 * show and in what order is a presentation choice expressed by the ordered
 * `tabs` allowlist; genuine entitlement is enforced upstream by not loading an
 * artifact into the context (or not mounting the drawer at all).
 */

import type { ContextAdapter } from '@ezclassify/types';
import {
    ReadOnlyComponentBase,
    resolveSchemeEngine,
    resolveContextSource,
    resolveProfile,
    type ComponentEngineSource,
    type ComponentOptions,
    type ComponentInstance,
} from './component-base-readonly';
import { Handbook } from './handbook';
import { Guidebook } from './guidebook';
import { AccessHandbook } from './access-handbook';
import { resolveReferenceSurfaceOverride } from './browser-component-base';
import { injectDefaultStyles } from '../styles';
import { adoptStyles, type AdoptedStyles } from '../styles/adopt';
import { THEMES } from '../themes';
import type {
    ContextReferencePlacement,
    ContextReferenceOffsets,
} from './context-reference-binding';
import contextReferenceCss from './context-reference.css?inline';

const CONTEXT_REFERENCE_CSS: string = contextReferenceCss;
const ROOT_CLASS = 'ez-context-ref';
const TABPANEL_CLASS = `${ROOT_CLASS}__tabpanel`;
/**
 * Marker attribute the controller sets on a host-owned custom-tab node to
 * project it as a tabpanel in place. An attribute, not a class: the framework
 * owns the node's `class` (the binding passes `className` straight through), so
 * a class we added would be wiped on the next reactive re-render. `role`, `id`,
 * `hidden`, `tabindex`, and `aria-labelledby` are equally safe to manage
 * because no binding passes them as props.
 */
const PANEL_ATTR = 'data-ez-context-ref-panel';
/** Records the tab id a projected custom node answers to, for active toggling. */
const CUSTOM_TAB_ID_ATTR = 'data-ez-context-ref-tab-id';

/** Options specific to the ContextReference component. */
export interface ContextReferenceOptions extends ComponentOptions {
    /** Which edge the drawer docks to. Default: `right`. */
    placement?: ContextReferencePlacement;
    /**
     * Panel size: width when docked left/right, height when docked top/bottom.
     * Any CSS length (e.g. `24rem`). Default: the CSS token default.
     */
    size?: string;
    /** Per-side viewport offsets. Each maps to a `--ez-context-ref-offset-*`. */
    offset?: ContextReferenceOffsets;
    /** Start opened. Default: closed (the handle is shown, the panel folded). */
    open?: boolean;
    /**
     * Ordered id allowlist. When set, only these tab ids render, in this order;
     * an omitted id is hidden. This is presentation only: hiding a tab is not
     * an access decision. Built-in ids are `handbook`, `guidebook`, `access`;
     * custom-tab ids come from each tab's `data-ezclassify-tab-id`.
     */
    tabs?: string[];
    /** Per-tab label overrides keyed by tab id. */
    tabLabels?: Record<string, string>;
    /** Per-tab icon (short text/emoji) overrides keyed by tab id. */
    tabIcons?: Record<string, string>;
}

/** Canonical built-in tab ids, in their default (pre-allowlist) order. */
const BUILTIN_HANDBOOK = 'handbook';
const BUILTIN_GUIDEBOOK = 'guidebook';
const BUILTIN_ACCESS = 'access';

/**
 * Built-in ids are reserved: a custom tab may not claim one, because the tab id
 * is also the DOM id stem and the key of the button/panel maps, and a collision
 * would corrupt the ARIA tab model.
 */
const RESERVED_TAB_IDS: ReadonlySet<string> = new Set([
    BUILTIN_HANDBOOK,
    BUILTIN_GUIDEBOOK,
    BUILTIN_ACCESS,
]);

/**
 * Stable tab-id grammar. An id becomes a DOM id (`ez-context-ref-tab-<id>` /
 * `-panel-<id>`) referenced by `aria-controls`/`aria-labelledby` and the key of
 * the button/panel maps, so it must be a single DOM-id-safe token: start with a
 * letter, then letters, digits, or hyphens. No whitespace, dots, or colons.
 */
const TAB_ID_GRAMMAR = /^[A-Za-z][A-Za-z0-9-]*$/;
const TAB_ID_GRAMMAR_TEXT =
    'start with a letter, then letters, digits, or hyphens';

/**
 * Generic tab labels, used when the artifact declares no reference-surface
 * noun.
 */
const DEFAULT_TAB_LABELS: Record<string, string> = {
    [BUILTIN_HANDBOOK]: 'Handbook',
    [BUILTIN_GUIDEBOOK]: 'Guidebook',
    [BUILTIN_ACCESS]: 'Access',
};

/** One resolved tab: its identity plus how to fill its panel. */
interface TabEntry {
    id: string;
    label: string;
    icon?: string;
    kind: 'builtin' | 'custom';
    /** Sort key for custom tabs (built-ins keep their canonical order). */
    order: number;
    /** The built-in component to mount, when `kind` is `builtin`. */
    make?: () => ComponentInstance;
    /** The host-owned node to project in place, when `kind` is `custom`. */
    node?: HTMLElement;
}

/** A custom tab discovered on the host's direct children. */
interface CustomTabDescriptor {
    id: string;
    label: string;
    icon?: string;
    order: number;
    node: HTMLElement;
}

/** A built-in panel already created and mounted; reused across rebuilds. */
interface MountedBuiltin {
    panel: HTMLDivElement;
    child: ComponentInstance;
}

/**
 * Read a per-instance option from either the typed field or the kebab-cased
 * passthrough key the declarative scanner produces
 * (`data-ezclassify-context-reference-<suffix>`). The declarative grammar and
 * the framework props resolve to the same option, so both spellings are read.
 */
function rawOpt(
    options: Record<string, unknown>,
    key: string,
): string | undefined {
    const v = options[key];
    return typeof v === 'string' ? v : undefined;
}

/** True when `node` is a host-authored custom-tab marker element. */
function isCustomTabNode(node: Node): node is HTMLElement {
    return (
        node instanceof HTMLElement && node.hasAttribute('data-ezclassify-tab')
    );
}

/**
 * Docked, tabbed reference drawer composing a context's Handbook, Guidebook,
 * and AccessHandbook surfaces plus host-authored custom tabs.
 */
export class ContextReference
    extends ReadOnlyComponentBase
    implements ComponentInstance
{
    private tablist!: HTMLDivElement;
    private handle!: HTMLButtonElement;
    private closeButton!: HTMLButtonElement;
    private adoptedStyle?: AdoptedStyles;
    private tabButtons = new Map<string, HTMLButtonElement>();
    /** Built-in panels, created lazily and kept mounted across rebuilds. */
    private builtins = new Map<string, MountedBuiltin>();
    /**
     * Host-owned custom-tab nodes we have projected in place. We only ever
     * toggle their tabpanel role and visibility; we never move or clone them,
     * so the framework that authored them keeps full ownership of their
     * lifecycle. On teardown we strip the projection so they return to their
     * authored state.
     */
    private projectedCustomNodes = new Set<HTMLElement>();
    private open = false;
    private tabOrder: string[] = [];
    private activeTabId: string | null = null;
    private _destroyed = false;
    private guidePresent = false;
    private accessPresent = false;
    private customObserver?: MutationObserver;

    /**
     * Resolve the engine/context, apply presentation, and build the drawer.
     *
     * Overrides `ReadOnlyComponentBase.init` deliberately: this is a container,
     * not a field, so it must NOT progressively enhance a stray native input.
     * The base scans the container AND its parent for an `<input>` to bind,
     * which, for an edge-docked drawer whose parent is the page body, would
     * capture and overwrite an unrelated field elsewhere on the page. Only the
     * engine/context/scheme/theme plumbing is reused.
     *
     * @param container - The host element the drawer builds into. The host IS
     *   the drawer root; its host-authored custom-tab children stay in place.
     * @param engineOrContext - The composed context, or a bare scheme adapter.
     * @param options - Presentation and per-tab options.
     */
    // The body is synchronous by design through the first paint: the frame, the
    // handle, and every synchronously-known tab are built before the returned
    // promise settles. `async` aligns the return type with the base's contract
    // while preserving the base component's Promise<void> contract.
    override async init(
        container: HTMLDivElement,
        engineOrContext?: ComponentEngineSource | null,
        options?: ComponentOptions,
    ): Promise<void> {
        this.engine = resolveSchemeEngine(
            container,
            engineOrContext,
            'ContextReference',
        );
        this.context = resolveContextSource(container, engineOrContext);
        this.container = container;
        this.options = options ?? {};
        this.schemeId = resolveProfile(
            container,
            this.engine,
            options,
            this.schemeAddressing,
        );
        this.scheme = this.schemeAddressing
            ? this.engine.getScheme(this.schemeId)
            : this.engine.getScheme();

        injectDefaultStyles(this.options.root);

        const colorScheme = this.options.colorScheme ?? 'auto';
        if (colorScheme !== 'auto') {
            container.setAttribute('data-color-scheme', colorScheme);
        }

        this.applyTheme(container);
        this.setup();
    }

    /**
     * Apply a theme option. An object is a bag of CSS variable overrides set
     * inline; a string names a preset in {@link THEMES}, whose merged variables
     * are set inline. Either way the override lands on the container, not on a
     * global stylesheet, so a page can dock two differently themed drawers.
     */
    private applyTheme(container: HTMLElement): void {
        const theme = this.options.theme;
        if (!theme) return;
        if (typeof theme === 'object') {
            for (const [prop, value] of Object.entries(theme)) {
                container.style.setProperty(prop, value);
            }
            return;
        }
        const preset = THEMES[theme];
        if (!preset) return;
        const vars = {
            ...preset.input,
            ...preset.dropdown,
            ...preset.badge,
            ...preset.notice,
        };
        for (const [prop, value] of Object.entries(vars)) {
            container.style.setProperty(prop, value);
        }
    }

    protected setup(): void {
        const opts = this.options as ContextReferenceOptions &
            Record<string, unknown>;

        // Reject a bad tab contract before building anything: a custom id that
        // collides with a built-in or another custom, an id that is not a valid
        // token, or a duplicated allowlist entry would all corrupt the ARIA tab
        // model downstream (duplicate DOM ids, overwritten button/panel maps).
        // This is a hard, dev-visible failure at mount: init() rejects, and the
        // scanner logs it without corrupting the page. Runtime-introduced
        // collisions (a later reactive render) are additionally skipped
        // defensively in syncTabs(), where a throw could not be caught.
        const initialCustomTabs = this.collectCustomTabs();
        const allowlist = this.resolveTabsAllowlist(opts);
        const errors = this.validateTabIdentities(initialCustomTabs, allowlist);
        if (errors.length > 0) {
            throw new Error(`[ContextReference] ${errors.join('; ')}`);
        }

        // Open when the typed flag is true, or (declarative path) when the
        // presence-only `-open` attribute is present. The scanner harvests that
        // attribute as an empty string, so any non-"false" string means "open";
        // the typed API passes a real boolean.
        const openValue = opts.open as boolean | string | undefined;
        this.open =
            openValue === true ||
            (typeof openValue === 'string' && openValue !== 'false');

        const placement = this.resolvePlacement(opts);

        // The host element IS the drawer root: its custom-tab children must stay
        // where the framework put them (see the file header), so the chrome is
        // built into the host rather than into a separate frame the children
        // would be moved out of.
        this.container.classList.add(ROOT_CLASS);
        this.container.setAttribute('data-ezclassify', '');
        this.container.setAttribute('role', 'region');
        this.container.setAttribute('aria-label', 'Context reference');
        this.container.setAttribute('data-ez-context-ref-placement', placement);
        this.applyStructuralVars(opts);

        // Scope the drawer's own CSS to the host so destroy() can remove exactly
        // it; a re-init never stacks a second copy. The composed reference
        // children inject their own styles into their own panels.
        if (this.options.injectStyles !== false) {
            this.adoptedStyle = adoptStyles(
                CONTEXT_REFERENCE_CSS,
                this.container,
            );
        }

        // Chrome is inserted BEFORE the host's custom-tab children so the
        // handle and tablist precede every panel in DOM order (a sensible focus
        // order), and so React/Vue/Angular keep inserting and removing their own
        // children among themselves without our chrome ever being their
        // insert-before reference node.
        this.handle = document.createElement('button');
        this.handle.type = 'button';
        this.handle.className = `${ROOT_CLASS}__handle`;
        this.handle.textContent = 'Reference';
        this.handle.addEventListener('click', () => this.toggle());
        this.insertChrome(this.handle);

        // The external pull-tab can fall outside a narrow viewport while open.
        // Keep a native close control inside the surface for touch and keyboard.
        this.closeButton = document.createElement('button');
        this.closeButton.type = 'button';
        this.closeButton.className = `${ROOT_CLASS}__close`;
        this.closeButton.textContent = 'Close reference';
        this.closeButton.addEventListener('click', () => this.setOpen(false));
        this.insertChrome(this.closeButton);

        this.tablist = document.createElement('div');
        this.tablist.className = `${ROOT_CLASS}__tablist`;
        this.tablist.setAttribute('role', 'tablist');
        this.tablist.setAttribute('aria-label', 'Reference tabs');
        this.tablist.setAttribute('aria-orientation', 'horizontal');
        this.tablist.addEventListener('keydown', (e) =>
            this.onTablistKeydown(e),
        );
        this.insertChrome(this.tablist);

        // Presence comes from the resolved composition when the adapter reports
        // it, never from whether an ops object exists or whether a policy
        // happens to contain rules. `compositionPresence` is optional in the
        // contract; without it, the guide and access surfaces decide.
        const presence = this.context?.compositionPresence;
        this.guidePresent = presence?.guides ?? this.resolveGuidePresence();
        this.accessPresent = presence?.access ?? Boolean(this.context?.access);

        this.syncTabs();
        this.applyOpenState();

        // Track host-authored custom-tab add/remove/reorder so the tab strip
        // reflects reactive changes. We only react to nodes carrying the custom
        // marker; the chrome and built-in panels we add ourselves never do, so
        // our own DOM writes do not re-trigger this.
        this.customObserver = new MutationObserver((mutations) => {
            if (this._destroyed) return;
            for (const m of mutations) {
                if (
                    Array.from(m.addedNodes).some(isCustomTabNode) ||
                    Array.from(m.removedNodes).some(isCustomTabNode)
                ) {
                    this.syncTabs();
                    return;
                }
            }
        });
        this.customObserver.observe(this.container, { childList: true });

        // Close on Escape from anywhere inside the drawer.
        this.container.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.open) {
                e.stopPropagation();
                this.setOpen(false);
            }
        });
    }

    /**
     * Insert a chrome node ahead of the first host-authored custom-tab child so
     * the handle and tablist precede every panel, and after the scoped style
     * element when present.
     */
    private insertChrome(node: HTMLElement): void {
        const firstCustom = Array.from(this.container.children).find(
            isCustomTabNode,
        );
        this.container.insertBefore(node, firstCustom ?? null);
    }

    /** ContextReference is a container: nothing re-renders on assertion change. */
    protected render(): void {
        /* no-op: the tab structure is reconciled by syncTabs() */
    }

    destroy(): void {
        this.removeRuleErrors();
        this._destroyed = true;
        this.customObserver?.disconnect();
        this.customObserver = undefined;

        for (const { child, panel } of this.builtins.values()) {
            try {
                child.destroy();
            } catch {
                /* one child's teardown must not abort the rest */
            }
            panel.remove();
        }
        this.builtins.clear();

        // Return every projected host node to its authored state. The node
        // itself is left in place for the framework that owns it to dispose; we
        // only strip the tabpanel projection we layered on.
        for (const node of this.projectedCustomNodes) {
            this.unprojectCustomNode(node);
        }
        this.projectedCustomNodes.clear();

        this.tablist?.remove();
        this.handle?.remove();
        this.closeButton?.remove();
        this.adoptedStyle?.release();
        this.adoptedStyle = undefined;
        this.tabButtons.clear();

        // Strip the root enhancement from the host we did not create.
        this.container.classList.remove(ROOT_CLASS);
        this.container.removeAttribute('data-ezclassify');
        this.container.removeAttribute('role');
        this.container.removeAttribute('aria-label');
        this.container.removeAttribute('data-ez-context-ref-placement');
        this.container.removeAttribute('data-ez-context-ref-open');
    }

    // ── Built-in presence (resolved composition) ────────────────────────────

    /**
     * True when the composition actually loaded at least one guide. Reads the
     * generic, synchronous `listGuideMeta()` inventory, which is populated in
     * both modes (locally from the loaded guides, remotely from the context
     * description at connect). This is why a scheme-only remote context (whose
     * client still exposes a `guide` ops object) shows no guidebook tab: the
     * inventory is empty. Falls back to bare presence only for a hand-rolled
     * adapter that does not implement the inventory accessor.
     */
    private resolveGuidePresence(): boolean {
        const guide = this.context?.guide;
        if (!guide) return false;
        if (typeof guide.listGuideMeta === 'function') {
            try {
                return guide.listGuideMeta().length > 0;
            } catch {
                return false;
            }
        }
        return true;
    }

    // ── Custom tabs ─────────────────────────────────────────────────────────

    /**
     * Read every direct-child `[data-ezclassify-tab]` node, returning its
     * declared identity and the node itself. Direct children only: a
     * `data-ezclassify-tab` deeper inside a panel belongs to nested content,
     * not to this drawer. The node is NOT detached; it stays where the
     * framework rendered it.
     */
    private collectCustomTabs(): CustomTabDescriptor[] {
        const nodes = Array.from(this.container.children).filter(
            isCustomTabNode,
        );
        return nodes.map((node, i) => {
            const id =
                node.getAttribute('data-ezclassify-tab-id')?.trim() ||
                `custom-${i}`;
            const label =
                node.getAttribute('data-ezclassify-tab-label')?.trim() || id;
            const icon =
                node.getAttribute('data-ezclassify-tab-icon')?.trim() ||
                undefined;
            const orderAttr = node.getAttribute('data-ezclassify-tab-order');
            const order = orderAttr != null ? Number(orderAttr) : i;
            return {
                id,
                label,
                icon,
                order: Number.isFinite(order) ? order : i,
                node,
            };
        });
    }

    /**
     * Validate the tab id contract and return one message per violation. A
     * custom id must be a valid token, must not claim a reserved built-in id,
     * and must be unique among the custom tabs; an allowlist must not repeat an
     * id. Auto-generated ids (`custom-<i>`) are always valid, so an unnamed tab
     * never trips this.
     */
    private validateTabIdentities(
        customs: CustomTabDescriptor[],
        allowlist: string[] | null,
    ): string[] {
        const errors: string[] = [];
        const seen = new Set<string>();
        for (const tab of customs) {
            const explicit = tab.node
                .getAttribute('data-ezclassify-tab-id')
                ?.trim();
            if (explicit) {
                if (RESERVED_TAB_IDS.has(explicit)) {
                    errors.push(
                        `custom tab id "${explicit}" is reserved for a built-in tab; choose a different data-ezclassify-tab-id`,
                    );
                } else if (!TAB_ID_GRAMMAR.test(explicit)) {
                    errors.push(
                        `custom tab id "${explicit}" is not a valid tab id; ids must ${TAB_ID_GRAMMAR_TEXT}`,
                    );
                }
            }
            if (seen.has(tab.id)) {
                errors.push(
                    `duplicate custom tab id "${tab.id}"; each custom tab needs a unique data-ezclassify-tab-id`,
                );
            }
            seen.add(tab.id);
        }
        if (allowlist) {
            const listSeen = new Set<string>();
            for (const id of allowlist) {
                if (listSeen.has(id)) {
                    errors.push(
                        `duplicate id "${id}" in the tabs allowlist; list each id at most once`,
                    );
                }
                listSeen.add(id);
            }
        }
        return errors;
    }

    // ── Tab resolution + reconciliation ─────────────────────────────────────

    /**
     * Rebuild the tab strip from the current built-in presence flags and the
     * host's current custom-tab children. Idempotent and safe to call on any
     * reactive change: built-in panels and their mounted children are created
     * once and preserved across calls (so switching or adding a custom tab
     * never re-mounts a remote Handbook), while the cheap tab buttons are
     * rebuilt and custom nodes are projected in place.
     */
    private syncTabs(): void {
        if (this._destroyed) return;

        // Baseline: quarantine every custom node in place: hidden, stripped of
        // any stale projection id, so a suppressed or malformed custom tab can
        // never show as stray content in the surface nor collide on a DOM id.
        // Visible entries are re-projected below. Nodes the framework removed
        // are forgotten.
        const domCustomNodes = Array.from(this.container.children).filter(
            isCustomTabNode,
        );
        const domCustomSet = new Set<HTMLElement>(domCustomNodes);
        for (const node of this.projectedCustomNodes) {
            if (!domCustomSet.has(node)) {
                this.projectedCustomNodes.delete(node);
            }
        }
        for (const node of domCustomNodes) {
            this.quarantineCustomNode(node);
            this.projectedCustomNodes.add(node);
        }

        const entries = this.resolveTabEntries();
        const wantedBuiltinIds = new Set(
            entries.filter((e) => e.kind === 'builtin').map((e) => e.id),
        );

        // Retire built-in panels no longer wanted (for example, an allowlist
        // that dropped the tab during a reconciliation).
        for (const [id, mounted] of this.builtins) {
            if (!wantedBuiltinIds.has(id)) {
                try {
                    mounted.child.destroy();
                } catch {
                    /* keep tearing the rest down */
                }
                mounted.panel.remove();
                this.builtins.delete(id);
            }
        }

        // Rebuild the tablist buttons and each panel's identity/visibility.
        this.tablist.replaceChildren();
        this.tabButtons.clear();
        this.tabOrder = entries.map((e) => e.id);
        const wantedIds = new Set(entries.map((e) => e.id));

        entries.forEach((entry) => {
            const tabDomId = `${ROOT_CLASS}-tab-${entry.id}`;
            const panelDomId = `${ROOT_CLASS}-panel-${entry.id}`;

            const tab = document.createElement('button');
            tab.type = 'button';
            tab.className = `${ROOT_CLASS}__tab`;
            tab.id = tabDomId;
            tab.setAttribute('role', 'tab');
            tab.setAttribute('aria-controls', panelDomId);
            tab.setAttribute('aria-selected', 'false');
            tab.tabIndex = -1;
            tab.dataset.tabId = entry.id;
            if (entry.icon) {
                const iconEl = document.createElement('span');
                iconEl.className = `${ROOT_CLASS}__tab-icon`;
                iconEl.setAttribute('aria-hidden', 'true');
                iconEl.textContent = entry.icon;
                tab.appendChild(iconEl);
            }
            const labelEl = document.createElement('span');
            labelEl.className = `${ROOT_CLASS}__tab-label`;
            labelEl.textContent = entry.label;
            tab.appendChild(labelEl);
            tab.addEventListener('click', () => this.activate(entry.id, true));
            this.tablist.appendChild(tab);
            this.tabButtons.set(entry.id, tab);

            this.ensurePanel(entry, panelDomId, tabDomId);
        });

        // Keep the current selection if it survives; otherwise select the first.
        const nextActive =
            this.activeTabId && wantedIds.has(this.activeTabId)
                ? this.activeTabId
                : (entries[0]?.id ?? null);
        this.activeTabId = nextActive;
        this.applyActiveState();
    }

    /**
     * Ensure the panel for one tab exists and carries the right identity.
     * Built-in panels are created and mounted once, then reused. A custom tab's
     * panel IS the host-owned node, projected in place: role and labeling are
     * set on it, its position and ownership are left to the framework.
     */
    private ensurePanel(
        entry: TabEntry,
        panelDomId: string,
        tabDomId: string,
    ): void {
        if (entry.kind === 'builtin') {
            if (!this.builtins.has(entry.id)) {
                const panel = document.createElement('div');
                panel.className = TABPANEL_CLASS;
                panel.id = panelDomId;
                panel.setAttribute('role', 'tabpanel');
                panel.setAttribute('aria-labelledby', tabDomId);
                panel.tabIndex = 0;
                this.container.appendChild(panel);
                const child = entry.make!();
                this.builtins.set(entry.id, { panel, child });
                this.mountChild(child, panel);
            }
            return;
        }
        // Custom: project the host's own node as the tabpanel, in place. The
        // node was quarantined (hidden, PANEL_ATTR set) at the top of syncTabs;
        // give it the tab identity so its button's aria-controls resolves.
        const node = entry.node!;
        node.id = panelDomId;
        node.setAttribute('role', 'tabpanel');
        node.setAttribute('aria-labelledby', tabDomId);
        node.setAttribute(CUSTOM_TAB_ID_ATTR, entry.id);
        node.tabIndex = 0;
    }

    /**
     * Reset a host-owned custom node to a hidden, projected-but-anonymous
     * panel: the layout marker is on, it is hidden, and any prior tab identity
     * is cleared. This is the safe baseline every syncTabs applies before
     * re-projecting the visible entries, so a suppressed or malformed custom
     * tab never leaks its content or a stale DOM id.
     */
    private quarantineCustomNode(node: HTMLElement): void {
        node.setAttribute(PANEL_ATTR, '');
        node.removeAttribute('id');
        node.removeAttribute('role');
        node.removeAttribute('aria-labelledby');
        node.removeAttribute(CUSTOM_TAB_ID_ATTR);
        node.removeAttribute('tabindex');
        node.hidden = true;
    }

    /** Strip the tabpanel projection from a host-owned custom node. */
    private unprojectCustomNode(node: HTMLElement): void {
        node.removeAttribute(PANEL_ATTR);
        node.removeAttribute('role');
        node.removeAttribute('aria-labelledby');
        node.removeAttribute(CUSTOM_TAB_ID_ATTR);
        node.removeAttribute('tabindex');
        node.removeAttribute('hidden');
        node.removeAttribute('id');
    }

    /**
     * Build the full ordered tab set: context-derived built-ins (by resolved
     * presence) plus the host's custom tabs, then apply the ordered `tabs`
     * allowlist for order and suppression. Built-ins keep their canonical order
     * (handbook, guidebook, access) and custom tabs follow, sorted by declared
     * `order`. Runtime-introduced id collisions are skipped defensively here
     * (they cannot throw safely from a reactive resync) so the ARIA model is
     * never corrupted.
     */
    private resolveTabEntries(): TabEntry[] {
        const opts = this.options as ContextReferenceOptions;
        const builtins: TabEntry[] = [];

        // Scheme is always present (the engine IS the scheme surface).
        builtins.push({
            id: BUILTIN_HANDBOOK,
            label: this.resolveBuiltinLabel(BUILTIN_HANDBOOK),
            icon: this.resolveTabIcon(BUILTIN_HANDBOOK),
            kind: 'builtin',
            order: 0,
            make: () => new Handbook(),
        });
        if (this.guidePresent) {
            builtins.push({
                id: BUILTIN_GUIDEBOOK,
                label: this.resolveBuiltinLabel(BUILTIN_GUIDEBOOK),
                icon: this.resolveTabIcon(BUILTIN_GUIDEBOOK),
                kind: 'builtin',
                order: 1,
                make: () => new Guidebook(),
            });
        }
        if (this.accessPresent) {
            builtins.push({
                id: BUILTIN_ACCESS,
                label: this.resolveBuiltinLabel(BUILTIN_ACCESS),
                icon: this.resolveTabIcon(BUILTIN_ACCESS),
                kind: 'builtin',
                order: 2,
                make: () => new AccessHandbook(),
            });
        }

        const custom: TabEntry[] = [];
        const seen = new Set<string>(builtins.map((b) => b.id));
        for (const t of this.collectCustomTabs().sort(
            (a, b) => a.order - b.order,
        )) {
            const explicit = t.node
                .getAttribute('data-ezclassify-tab-id')
                ?.trim();
            if (
                (explicit && RESERVED_TAB_IDS.has(explicit)) ||
                (explicit && !TAB_ID_GRAMMAR.test(explicit)) ||
                seen.has(t.id)
            ) {
                // A collision or malformed id introduced after mount: keep the
                // ARIA model consistent by dropping the offender, and say so.
                console.error(
                    `[ContextReference] ignoring custom tab "${t.id}": its id is reserved, malformed, or already in use`,
                );
                continue;
            }
            seen.add(t.id);
            custom.push({
                id: t.id,
                label:
                    opts.tabLabels?.[t.id] ?? this.rawTabLabel(t.id) ?? t.label,
                icon: this.resolveTabIcon(t.id) ?? t.icon,
                kind: 'custom',
                order: t.order,
                node: t.node,
            });
        }

        const all = [...builtins, ...custom];
        const allowlist = this.resolveTabsAllowlist(opts);
        if (!allowlist) return all;

        const byId = new Map(all.map((e) => [e.id, e]));
        const ordered: TabEntry[] = [];
        const used = new Set<string>();
        for (const id of allowlist) {
            const entry = byId.get(id);
            if (entry && !used.has(id)) {
                ordered.push(entry);
                used.add(id);
            }
        }
        return ordered;
    }

    /**
     * Parse the `tabs` allowlist from the typed array or a comma-separated
     * string.
     */
    private resolveTabsAllowlist(
        opts: ContextReferenceOptions,
    ): string[] | null {
        if (Array.isArray(opts.tabs)) return opts.tabs.map((s) => s.trim());
        const raw = rawOpt(opts as Record<string, unknown>, 'tabs');
        if (raw == null) return null;
        return raw
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean);
    }

    /**
     * Label for a built-in tab: a per-tab override wins, then the artifact's
     * own reference-surface noun through the shared chokepoint, then the
     * generic default. This is why a scheme that names its handbook the "IC
     * Markings System Register and Manual" labels its tab that, with no domain
     * word here.
     */
    private resolveBuiltinLabel(id: string): string {
        const override =
            (this.options as ContextReferenceOptions).tabLabels?.[id] ??
            this.rawTabLabel(id);
        if (override) return override;

        if (id === BUILTIN_HANDBOOK) {
            const surface = resolveReferenceSurfaceOverride(
                this.scheme.referenceSurfaceLabel,
                'handbook',
            );
            return surface?.singular ?? DEFAULT_TAB_LABELS[id];
        }
        if (id === BUILTIN_GUIDEBOOK) {
            const label = readGuideSurfaceLabel(this.context);
            const surface = resolveReferenceSurfaceOverride(label, 'guidebook');
            return surface?.singular ?? DEFAULT_TAB_LABELS[id];
        }
        if (id === BUILTIN_ACCESS) {
            const label = readAccessSurfaceLabel(this.context);
            const surface = resolveReferenceSurfaceOverride(
                label,
                'accessHandbook',
            );
            return surface?.singular ?? DEFAULT_TAB_LABELS[id];
        }
        return DEFAULT_TAB_LABELS[id] ?? id;
    }

    /** Read a declarative per-tab label override: `-tab-label-<id>`. */
    private rawTabLabel(id: string): string | undefined {
        return rawOpt(
            this.options as Record<string, unknown>,
            `tab-label-${id}`,
        );
    }

    /**
     * Resolve a per-tab icon override: typed `tabIcons` map or
     * `-tab-icon-<id>`.
     */
    private resolveTabIcon(id: string): string | undefined {
        return (
            (this.options as ContextReferenceOptions).tabIcons?.[id] ??
            rawOpt(this.options as Record<string, unknown>, `tab-icon-${id}`)
        );
    }

    /**
     * Mount one composed reference component into a tabpanel, handing it the
     * same engine/context source this drawer was mounted with, plus the
     * inheritable presentation options. The child owns its own local/remote
     * resolution.
     */
    private mountChild(child: ComponentInstance, panel: HTMLDivElement): void {
        const childOptions: ComponentOptions = {
            root: this.options.root,
            colorScheme: this.options.colorScheme,
            tooltips: this.options.tooltips,
            hints: this.options.hints,
            categoryColors: this.options.categoryColors,
            colorMap: this.options.colorMap,
            tooltipConceptProperty: this.options.tooltipConceptProperty,
            schemeId: this.options.schemeId,
        };
        const result = child.init(
            panel,
            this.context ?? this.engine,
            childOptions,
        );
        if (result instanceof Promise) {
            result.catch((err) => {
                if (this._destroyed) return;
                console.error(
                    '[ContextReference] a reference tab failed to mount:',
                    err,
                );
            });
        }
    }

    // ── Interaction ─────────────────────────────────────────────────────────

    /** Activate a tab by id; optionally move focus to it (pointer/keyboard). */
    private activate(id: string, focus: boolean): void {
        this.activeTabId = id;
        this.applyActiveState();
        if (focus) this.tabButtons.get(id)?.focus();
    }

    /** Reflect the active tab onto the buttons (roving tabindex) and panels. */
    private applyActiveState(): void {
        for (const [tabId, button] of this.tabButtons) {
            const selected = tabId === this.activeTabId;
            button.setAttribute('aria-selected', selected ? 'true' : 'false');
            button.tabIndex = selected ? 0 : -1;
        }
        for (const { panel } of this.builtins.values()) {
            const id = panel.id.replace(`${ROOT_CLASS}-panel-`, '');
            panel.hidden = id !== this.activeTabId;
        }
        for (const node of this.projectedCustomNodes) {
            const id = node.getAttribute(CUSTOM_TAB_ID_ATTR);
            // A quarantined (suppressed or malformed) custom node has no tab id
            // and stays hidden; only the active projected node is shown.
            node.hidden = id == null || id !== this.activeTabId;
        }
    }

    /** Roving-tabindex arrow navigation with activation following focus. */
    private onTablistKeydown(e: KeyboardEvent): void {
        const keys = ['ArrowRight', 'ArrowLeft', 'Home', 'End'];
        if (!keys.includes(e.key)) return;
        const order = this.tabOrder;
        if (order.length === 0) return;
        const current = this.activeTabId ? order.indexOf(this.activeTabId) : 0;
        e.preventDefault();
        let next = current;
        if (e.key === 'ArrowRight') next = (current + 1) % order.length;
        else if (e.key === 'ArrowLeft')
            next = (current - 1 + order.length) % order.length;
        else if (e.key === 'Home') next = 0;
        else if (e.key === 'End') next = order.length - 1;
        this.activate(order[next], true);
    }

    private toggle(): void {
        this.setOpen(!this.open);
    }

    private setOpen(open: boolean): void {
        this.open = open;
        this.applyOpenState();
        if (open) {
            // Move focus to the active tab so a keyboard user lands inside.
            const active = this.activeTabId
                ? this.tabButtons.get(this.activeTabId)
                : undefined;
            active?.focus();
        } else {
            this.handle.focus();
        }
    }

    /**
     * Reflect the open flag onto the host: the placement attribute drives
     * layout, `data-ez-context-ref-open` folds the surface, and `inert` keeps a
     * closed surface out of the tab order and off the accessibility tree while
     * leaving the handle reachable.
     */
    private applyOpenState(): void {
        this.container.setAttribute(
            'data-ez-context-ref-open',
            this.open ? 'true' : 'false',
        );
        this.handle.setAttribute('aria-expanded', this.open ? 'true' : 'false');
        this.handle.setAttribute(
            'aria-label',
            this.open ? 'Collapse reference' : 'Open reference',
        );
        this.closeButton.hidden = !this.open;
        if (this.open) this.tablist.removeAttribute('inert');
        else this.tablist.setAttribute('inert', '');
    }

    // ── Presentation vars ───────────────────────────────────────────────────

    private resolvePlacement(
        opts: ContextReferenceOptions & Record<string, unknown>,
    ): ContextReferencePlacement {
        const value = opts.placement ?? rawOpt(opts, 'placement');
        return value === 'left' ||
            value === 'right' ||
            value === 'top' ||
            value === 'bottom'
            ? value
            : 'right';
    }

    /**
     * Set the theme-invariant structural CSS variables inline on the host: the
     * panel size and the four per-side offsets. Offsets accept the typed
     * `offset` object or the declarative `-offset-<side>` keys.
     */
    private applyStructuralVars(
        opts: ContextReferenceOptions & Record<string, unknown>,
    ): void {
        const size = opts.size ?? rawOpt(opts, 'size');
        if (size) {
            this.container.style.setProperty('--ez-context-ref-size', size);
        }

        const sides: Array<keyof ContextReferenceOffsets> = [
            'top',
            'right',
            'bottom',
            'left',
        ];
        for (const side of sides) {
            const value = opts.offset?.[side] ?? rawOpt(opts, `offset-${side}`);
            if (value) {
                this.container.style.setProperty(
                    `--ez-context-ref-offset-${side}`,
                    value,
                );
            }
        }
    }
}

// ── Sibling-surface label readers ──────────────────────────────────────────

/**
 * Read the guide's resolved reference-surface noun from the generic
 * `listGuideMeta()` inventory (the same field {@link Guidebook} reads for its
 * heading), which is synchronous and populated in both modes. The drawer's tab
 * strip is built synchronously, so this never waits on a fetch.
 */
function readGuideSurfaceLabel(
    context: ContextAdapter | null,
): import('@ezclassify/types').ReferenceSurfaceLabel | undefined {
    const guide = context?.guide;
    if (!guide || typeof guide.listGuideMeta !== 'function') return undefined;
    try {
        return guide.listGuideMeta()[0]?.referenceSurfaceLabel;
    } catch {
        return undefined;
    }
}

/**
 * Local `AccessEngine` instances expose a resolved `referenceSurfaceLabel`
 * getter beyond the public adapter contract (remote adapters do not); read it
 * defensively, mirroring {@link AccessHandbook}.
 */
function readAccessSurfaceLabel(
    context: ContextAdapter | null,
): import('@ezclassify/types').ReferenceSurfaceLabel | undefined {
    const access = context?.access as
        | {
              referenceSurfaceLabel?: import('@ezclassify/types').ReferenceSurfaceLabel;
          }
        | undefined;
    return access?.referenceSurfaceLabel;
}
