/**
 * `<ContextReference>`: the Vue binding for the vanilla context-reference
 * drawer.
 *
 * Thin glue, not a re-implementation. The component renders one host element
 * carrying the `data-ezclassify-*` attributes and `--ez-context-ref-*` CSS
 * variables the vanilla controller reads (mapped by the shared
 * `contextReferenceHostAttributes`), and passes its default slot straight
 * through. The enclosing `<EzClassify>` root enhances the host; the vanilla
 * controller does all the work.
 *
 * A custom tab is `<ContextReferenceTab label="...">`, which renders the
 * `data-ezclassify-tab` marker element the controller scans for. The slot IS
 * the child DOM the controller hoists; there is no projection runtime.
 *
 * ```vue
 * <ContextReference placement="left" open>
 *     <ContextReferenceTab id="developers" label="Developers">
 *         <DeveloperPanel />
 *     </ContextReferenceTab>
 * </ContextReference>;
 * ```
 */

import {
    defineComponent,
    h,
    type PropType,
    type SlotsType,
    type VNodeChild,
} from 'vue';
import {
    contextReferenceHostAttributes,
    contextReferenceTabAttributes,
    type ContextReferenceOffsets,
    type ContextReferencePlacement,
} from '@ezclassify/ui';
import type { SlottedComponent } from './component-type';

const contextReferenceProps = {
    placement: {
        type: String as PropType<ContextReferencePlacement>,
        default: undefined,
    },
    size: { type: String, default: undefined },
    offset: {
        type: Object as PropType<ContextReferenceOffsets>,
        default: undefined,
    },
    open: { type: Boolean, default: false },
    tabs: {
        type: [Array, String] as PropType<string[] | string>,
        default: undefined,
    },
    theme: { type: String, default: undefined },
    colorScheme: {
        type: String as PropType<'auto' | 'light' | 'dark'>,
        default: undefined,
    },
    tabLabels: {
        type: Object as PropType<Record<string, string>>,
        default: undefined,
    },
    tabIcons: {
        type: Object as PropType<Record<string, string>>,
        default: undefined,
    },
} as const;

/**
 * The docked reference drawer. Use inside an `<EzClassify>` root; the
 * controller derives its built-in tabs from the loaded Context.
 */
export const ContextReference: SlottedComponent<typeof contextReferenceProps> =
    defineComponent({
        name: 'ContextReference',
        props: contextReferenceProps,
        slots: Object as SlotsType<{ default?: () => VNodeChild }>,
        setup(props, { slots }) {
            return () => {
                const { attributes, style } = contextReferenceHostAttributes({
                    placement: props.placement,
                    size: props.size,
                    offset: props.offset,
                    open: props.open,
                    tabs: props.tabs,
                    theme: props.theme,
                    colorScheme: props.colorScheme,
                    tabLabels: props.tabLabels,
                    tabIcons: props.tabIcons,
                });
                return h('div', { ...attributes, style }, [slots.default?.()]);
            };
        },
    });

const contextReferenceTabProps = {
    id: { type: String, default: undefined },
    label: { type: String, required: true },
    icon: { type: String, default: undefined },
    order: { type: Number, default: undefined },
} as const;

/**
 * A declarative custom tab. Renders the marker element the controller hoists
 * into the tab strip; its default slot becomes the tab's panel content.
 */
export const ContextReferenceTab: SlottedComponent<
    typeof contextReferenceTabProps
> = defineComponent({
    name: 'ContextReferenceTab',
    props: contextReferenceTabProps,
    slots: Object as SlotsType<{ default?: () => VNodeChild }>,
    setup(props, { slots }) {
        return () => {
            const attributes = contextReferenceTabAttributes({
                id: props.id,
                label: props.label,
                icon: props.icon,
                order: props.order,
            });
            return h('div', { ...attributes }, [slots.default?.()]);
        };
    },
});
