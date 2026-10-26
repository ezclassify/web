/**
 * Shared binding contract for the ContextReference drawer.
 *
 * The React, Vue, and Angular packages expose a `ContextReference` component
 * and a `ContextReference.Tab` (or equivalent) helper. Those bindings are thin
 * glue: they map presentation props onto the exact `data-ezclassify-*`
 * attributes and `--ez-context-ref-*` CSS variables the vanilla controller
 * already reads, then pass host content straight through. The vanilla
 * controller does the work.
 *
 * The mapping itself is framework-agnostic, so it lives here (per the
 * architecture rule that behavior shared by more than one framework package
 * belongs in `libs/ui`) and every binding calls it. That is what makes the
 * three bindings provably identical and keeps the custom-tab seam a single
 * primitive: a child element carrying the marker attributes, discovered by the
 * controller.
 */

/** Where the drawer docks. */
export type ContextReferencePlacement = 'left' | 'right' | 'top' | 'bottom';

/** Per-side viewport offsets, each a CSS length. */
export interface ContextReferenceOffsets {
    top?: string;
    right?: string;
    bottom?: string;
    left?: string;
}

/**
 * Presentation props a framework `ContextReference` accepts. Every field maps
 * to a declarative attribute or CSS variable on the controller host; none
 * re-expose per-tab component options, matching how every other binding leaves
 * per-controller options on the DOM.
 */
export interface ContextReferenceProps {
    /** Docking edge. Default: `right`. */
    placement?: ContextReferencePlacement;
    /**
     * Panel size (width when left/right, height when top/bottom); any CSS
     * length.
     */
    size?: string;
    /**
     * Per-side viewport offsets, mapped to `--ez-context-ref-offset-*` CSS
     * vars.
     */
    offset?: ContextReferenceOffsets;
    /** Start opened. Default: closed. */
    open?: boolean;
    /**
     * Ordered id allowlist for tab order and suppression (presentation only,
     * never an access decision). Built-in ids: `handbook`, `guidebook`,
     * `access`.
     */
    tabs?: string[] | string;
    /** Named preset theme slug (see `THEMES`). */
    theme?: string;
    /** Force a color scheme on the drawer regardless of host theme. */
    colorScheme?: 'auto' | 'light' | 'dark';
    /** Per-tab label overrides keyed by tab id. */
    tabLabels?: Record<string, string>;
    /** Per-tab icon (short text/emoji) overrides keyed by tab id. */
    tabIcons?: Record<string, string>;
}

/** Identity a framework `ContextReference.Tab` declares for a custom tab. */
export interface ContextReferenceTabProps {
    /** Stable tab id, referenced by the `tabs` allowlist. */
    id?: string;
    /** Tab strip label. */
    label: string;
    /** Optional short icon/emoji shown before the label. */
    icon?: string;
    /** Sort key among custom tabs. */
    order?: number;
}

/** The controller attribute value that mounts this component. */
export const CONTEXT_REFERENCE_CONTROLLER = 'context-reference';

const OPTION_PREFIX = `data-ezclassify-${CONTEXT_REFERENCE_CONTROLLER}-`;

/** A flat attribute map plus inline CSS-variable style, ready for any framework. */
export interface ContextReferenceHostBinding {
    attributes: Record<string, string>;
    style: Record<string, string>;
}

/**
 * Map presentation props to the host element's attributes and inline CSS
 * variables. The returned `attributes` include the controller attribute itself,
 * so a binding renders one element spreading both maps and the controller is
 * enhanced by the ambient scanner.
 *
 * @param props - Framework presentation props.
 * @returns The attribute map and inline style for the controller host element.
 */
export function contextReferenceHostAttributes(
    props: ContextReferenceProps,
): ContextReferenceHostBinding {
    const attributes: Record<string, string> = {
        'data-ezclassify-controller': CONTEXT_REFERENCE_CONTROLLER,
    };
    if (props.placement) {
        attributes[`${OPTION_PREFIX}placement`] = props.placement;
    }
    if (props.size) attributes[`${OPTION_PREFIX}size`] = props.size;
    // Presence-only flag: the controller opens when the attribute is present.
    if (props.open) attributes[`${OPTION_PREFIX}open`] = '';
    if (props.tabs) {
        attributes[`${OPTION_PREFIX}tabs`] = Array.isArray(props.tabs)
            ? props.tabs.join(',')
            : props.tabs;
    }
    if (props.theme) attributes[`${OPTION_PREFIX}theme`] = props.theme;
    if (props.colorScheme && props.colorScheme !== 'auto') {
        attributes['data-color-scheme'] = props.colorScheme;
    }
    for (const [id, label] of Object.entries(props.tabLabels ?? {})) {
        attributes[`${OPTION_PREFIX}tab-label-${id}`] = label;
    }
    for (const [id, icon] of Object.entries(props.tabIcons ?? {})) {
        attributes[`${OPTION_PREFIX}tab-icon-${id}`] = icon;
    }

    const style: Record<string, string> = {};
    const offset = props.offset;
    if (offset) {
        const sides: Array<keyof ContextReferenceOffsets> = [
            'top',
            'right',
            'bottom',
            'left',
        ];
        for (const side of sides) {
            const value = offset[side];
            if (value) style[`--ez-context-ref-offset-${side}`] = value;
        }
    }

    return { attributes, style };
}

/**
 * Map a custom tab's identity to the marker attributes the controller scans for
 * on a direct child element.
 *
 * @param tab - The custom tab's declared identity.
 * @returns The attribute map for the tab's host element.
 */
export function contextReferenceTabAttributes(
    tab: ContextReferenceTabProps,
): Record<string, string> {
    const attributes: Record<string, string> = {
        'data-ezclassify-tab': '',
        'data-ezclassify-tab-label': tab.label,
    };
    if (tab.id) attributes['data-ezclassify-tab-id'] = tab.id;
    if (tab.icon) attributes['data-ezclassify-tab-icon'] = tab.icon;
    if (tab.order != null) {
        attributes['data-ezclassify-tab-order'] = String(tab.order);
    }
    return attributes;
}
