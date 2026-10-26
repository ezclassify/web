/**
 * `<ContextReference>`: the React binding for the vanilla context-reference
 * drawer.
 *
 * Thin glue, not a re-implementation. The component renders one host element
 * carrying the `data-ezclassify-*` attributes and `--ez-context-ref-*` CSS
 * variables the vanilla controller reads (mapped by the shared
 * `contextReferenceHostAttributes`), and passes its children straight through.
 * The ambient scanner from `<EzClassifyProvider>` /
 * `useSchemeEngine().Container` enhances the host; the vanilla
 * `ContextReference` controller does all the work: deriving built-in tabs from
 * the loaded context and hoisting custom tabs.
 *
 * A custom tab is `<ContextReference.Tab
 * label="...">...</ContextReference.Tab>`, which renders the
 * `data-ezclassify-tab` marker element the controller scans for. React children
 * ARE that child DOM; there is no projection runtime.
 *
 * ```tsx
 * <ContextReference placement="left" open>
 *     <ContextReference.Tab id="developers" label="Developers">
 *         <DeveloperPanel />
 *     </ContextReference.Tab>
 * </ContextReference>;
 * ```
 */

import { createElement, type CSSProperties, type ReactNode } from 'react';
import {
    contextReferenceHostAttributes,
    contextReferenceTabAttributes,
    type ContextReferenceProps as ContextReferenceMapping,
    type ContextReferenceTabProps as ContextReferenceTabMapping,
} from '@ezclassify/ui';

/** Props for {@link ContextReference}. */
export interface ContextReferenceProps extends ContextReferenceMapping {
    /** Custom tabs and any other host content. */
    children?: ReactNode;
    /** Extra class on the host element. */
    className?: string;
    /** Extra inline style, merged under the offset CSS variables. */
    style?: CSSProperties;
    /** Optional host element id. */
    id?: string;
}

/** Props for {@link ContextReferenceTab}. */
export interface ContextReferenceTabProps extends ContextReferenceTabMapping {
    /** The tab panel content. */
    children?: ReactNode;
    /** Extra class on the tab's host element. */
    className?: string;
    /** Extra inline style on the tab's host element. */
    style?: CSSProperties;
}

/**
 * A declarative custom tab. Renders the marker element the controller hoists
 * into the tab strip; its children become the tab's panel content.
 */
export function ContextReferenceTab(
    props: ContextReferenceTabProps,
): ReactNode {
    const { children, className, style, ...tab } = props;
    return createElement(
        'div',
        {
            ...contextReferenceTabAttributes(tab),
            className,
            style,
        },
        children,
    );
}

interface ContextReferenceComponent {
    (props: ContextReferenceProps): ReactNode;
    /** Declarative custom-tab helper: `<ContextReference.Tab label="..." />`. */
    Tab: typeof ContextReferenceTab;
}

/**
 * The docked reference drawer. Place it inside a `useSchemeEngine().Container`
 * (or under an `<EzClassifyProvider>` scan root); the controller derives its
 * built-in tabs from the loaded context.
 */
export const ContextReference = ((props: ContextReferenceProps): ReactNode => {
    const { children, className, style, id, ...presentation } = props;
    const { attributes, style: cssVars } =
        contextReferenceHostAttributes(presentation);
    return createElement(
        'div',
        {
            ...attributes,
            id,
            className,
            style: { ...(cssVars as CSSProperties), ...style },
        },
        children,
    );
}) as ContextReferenceComponent;

ContextReference.Tab = ContextReferenceTab;
