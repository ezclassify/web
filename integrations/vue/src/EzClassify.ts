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
 *
 * Code inside the root reaches its runtime with {@link useEzClassifyUI}, for
 * example to mark up page elements it cannot write markup for with
 * `ui.add(element, 'marking')`.
 */

import {
    defineComponent,
    h,
    inject,
    onBeforeUnmount,
    onMounted,
    provide,
    shallowRef,
    type InjectionKey,
    type PropType,
    type ShallowRef,
    type SlotsType,
    type VNodeChild,
} from 'vue';
import { EzClassifyUI } from '@ezclassify/ui';
import type { SlottedComponent } from './component-type';
import { VueRefStoreKey, type VueRefStore } from './composables/vue-ref-store';
import { injectEzClassifyConfig } from './config';

/** The runtime of the nearest `<EzClassify>` root, `null` until it mounts. */
const EzClassifyUIKey: InjectionKey<Readonly<ShallowRef<EzClassifyUI | null>>> =
    Symbol('EzClassifyUI');

/**
 * The runtime of the enclosing `<EzClassify>` root, for code that has to reach
 * it directly: `add` and `remove` for page elements it cannot write markup for,
 * its `root` element, readiness. Marking state is better read through
 * `useEzClassify(id)` and `useEzClassifyState(id)`.
 *
 * @returns A ref holding the runtime, `null` until the root has mounted.
 * @throws When no `<EzClassify>` root encloses the caller.
 */
export function useEzClassifyUI(): Readonly<ShallowRef<EzClassifyUI | null>> {
    const ui = inject(EzClassifyUIKey, null);
    if (!ui) {
        throw new Error(
            '[ezclassify/vue] useEzClassifyUI() must be called inside an <EzClassify> root',
        );
    }
    return ui;
}

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
            const ui = shallowRef<EzClassifyUI | null>(null);
            provide(EzClassifyUIKey, ui);

            onMounted(() => {
                // Children are mounted first, so the slot's markup is in place.
                ui.value = new EzClassifyUI(config.contexts, {
                    ...config.presentation,
                    root: host.value!,
                    store,
                });
            });

            onBeforeUnmount(() => {
                // The runtime goes first so nothing it still initializes
                // reaches a destroyed store.
                ui.value?.destroy();
                ui.value = null;
                if (!supplied) store.destroy();
            });

            return () => h('div', { ref: host }, [slots.default?.()]);
        },
    });
