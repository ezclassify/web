import { ref, toValue, watch, type MaybeRefOrGetter, type Ref } from 'vue';
import { watchUnverified } from '@ezclassify/ui';

/**
 * Whether the marking field with this id is unverified: the result it shows has
 * not been verified for its current text because the last check could not be
 * completed (the runtime was unreachable, timed out, or answered badly). The
 * field keeps showing its last result and says so itself; use this to react
 * beside it, for example to hold a submit button.
 *
 * It follows the field's own `ezclassify:unverified-change` event, so each
 * field reports for itself and two fields never share a state. The id may be a
 * ref or getter; following moves with it and stops when the component unmounts.
 * A field that is not enhanced yet reads false until it is.
 *
 * @param id - The field's DOM id, the marking id.
 * @returns A ref that is true while the field's result is unverified.
 */
export function useEzClassifyUnverified(
    id: MaybeRefOrGetter<string>,
): Readonly<Ref<boolean>> {
    const unverified = ref(false);
    if (typeof document === 'undefined') return unverified;
    watch(
        () => toValue(id),
        (next, _previous, onCleanup) => {
            onCleanup(
                watchUnverified(next, (state) => {
                    unverified.value = state;
                }),
            );
        },
        { immediate: true },
    );
    return unverified;
}
