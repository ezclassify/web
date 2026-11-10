/**
 * `<EzClassify>`: one marking root.
 *
 * ```vue
 * <EzClassify>
 *     <form>…</form>
 * </EzClassify>;
 * ```
 *
 * It renders a plain `div` (no role) around its slot, runs one `EzClassifyUI`
 * over that element, and provides the root's store to every component inside
 * it, which is what `useEzClassify(id)`, `useEzClassifyState(id)` and
 * `useEzClassifyFacet` read. It is a component rather than a directive because
 * a directive cannot `provide`.
 *
 * Each root owns a store and destroys it on unmount. To share marking state
 * with UI outside a form, put one root around both, or pass `store` (which then
 * stays the caller's to destroy). A root nested inside another is a member of
 * the enclosing root's nearest collection, as any nested mount root is.
 */

import {
    defineComponent,
    h,
    onBeforeUnmount,
    onMounted,
    provide,
    shallowRef,
    type PropType,
    type SlotsType,
    type VNodeChild,
} from 'vue';
import { EzClassifyUI } from '@ezclassify/ui';
import type { SlottedComponent } from './component-type';
import { VueRefStoreKey, type VueRefStore } from './composables/vue-ref-store';
import { injectEzClassifyConfig } from './config';

const ezClassifyProps = {
    /**
     * A store the caller owns, read once at setup. The root binds it and never
     * destroys it. To switch stores, give the root a new `key`.
     */
    store: { type: Object as PropType<VueRefStore>, default: undefined },
} as const;

/** One marking root. Needs `app.use(createEzClassify({ context }))`. */
export const EzClassify: SlottedComponent<typeof ezClassifyProps> =
    defineComponent({
        name: 'EzClassify',
        props: ezClassifyProps,
        slots: Object as SlotsType<{ default?: () => VNodeChild }>,
        setup(props, { slots }) {
            const config = injectEzClassifyConfig();
            const supplied = props.store;
            const store = supplied ?? config.createStore();
            // Provided during setup, before the scanner exists: descendants bind
            // to the store as they are created, and the scanner seeds the same
            // store when it mounts.
            provide(VueRefStoreKey, store);

            const host = shallowRef<HTMLElement | null>(null);
            let ui: EzClassifyUI | null = null;

            onMounted(() => {
                // Children are mounted first, so the slot's markup is in place.
                ui = new EzClassifyUI(config.contexts, {
                    ...config.presentation,
                    root: host.value!,
                    store,
                });
            });

            onBeforeUnmount(() => {
                // The runtime goes first so nothing it still initializes
                // reaches a destroyed store.
                ui?.destroy();
                ui = null;
                if (!supplied) store.destroy();
            });

            return () => h('div', { ref: host }, [slots.default?.()]);
        },
    });
