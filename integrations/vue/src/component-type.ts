/**
 * The declared type of every component this package exports.
 *
 * Emitted component declarations stay on the Vue 3.3 public type surface. Newer
 * inferred `DefineComponent` signatures add generic parameters a consumer on
 * our minimum supported Vue version does not have.
 */

import type {
    AllowedComponentProps,
    ComponentCustomProps,
    ComponentObjectPropsOptions,
    ComponentOptionsMixin,
    DefineComponent,
    ExtractDefaultPropTypes,
    ExtractPropTypes,
    SlotsType,
    VNodeChild,
    VNodeProps,
} from 'vue';

/** A component with the given props and one optional default slot. */
export type SlottedComponent<Props extends ComponentObjectPropsOptions> =
    DefineComponent<
        Props,
        {},
        {},
        {},
        {},
        ComponentOptionsMixin,
        ComponentOptionsMixin,
        {},
        string,
        VNodeProps & AllowedComponentProps & ComponentCustomProps,
        Readonly<ExtractPropTypes<Props>>,
        ExtractDefaultPropTypes<Props>,
        SlotsType<{ default?: () => VNodeChild }>
    >;
