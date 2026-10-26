import { defineComponent, h, type VNodeChild } from 'vue';
import {
    ContextReference,
    ContextReferenceTab,
    VueRefStore,
    type UseEzClassifyFacetReturn,
} from '@ezclassify/vue';

const props: InstanceType<typeof ContextReference>['$props'] = {
    placement: 'left',
    open: true,
    size: '24rem',
    offset: { top: '1rem' },
    tabs: ['custom'],
    theme: 'dark',
    colorScheme: 'auto',
    tabLabels: { custom: 'Custom' },
    tabIcons: { custom: 'tag' },
};
const tab: InstanceType<typeof ContextReferenceTab>['$props'] = {
    id: 'custom',
    label: 'Custom',
    icon: 'tag',
    order: 2,
};
const component = defineComponent({
    setup() {
        return () =>
            h(ContextReference, props, {
                default: (): VNodeChild =>
                    h(ContextReferenceTab, tab, {
                        default: () => h('span', 'Slot body'),
                    }),
            });
    },
});
// @ts-expect-error A tab's label is required by the public component contract.
const missingLabel: InstanceType<typeof ContextReferenceTab>['$props'] = {};
const wrongLabel: InstanceType<typeof ContextReferenceTab>['$props'] = {
    // @ts-expect-error Label remains a string.
    label: 1,
};
const wrongPlacement: InstanceType<typeof ContextReference>['$props'] = {
    // @ts-expect-error Placement is a closed public union.
    placement: 'diagonal',
};
const wrongOpen: InstanceType<typeof ContextReference>['$props'] = {
    // @ts-expect-error Open remains boolean.
    open: 'yes',
};
const typedSlots: InstanceType<typeof ContextReference>['$slots'] = {
    default: () => [h('span', 'Typed slot')],
};
void [
    component,
    missingLabel,
    wrongLabel,
    wrongPlacement,
    wrongOpen,
    typedSlots,
    VueRefStore,
];
function facetContract(value: UseEzClassifyFacetReturn): string[] {
    return value.value.value;
}
void facetContract;

const wrongSlot: InstanceType<typeof ContextReference>['$slots'] = {
    // @ts-expect-error A default slot must render a VNode child, not arbitrary data.
    default: () => ({ invalidNode: true }),
};
void wrongSlot;
