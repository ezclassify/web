import { onBeforeUnmount, onMounted, ref, type Ref } from 'vue';
import { watchCheckFailed } from '@ezclassify/ui';

/**
 * Whether the marking field with this id could not check the text in it: the
 * runtime was unreachable, timed out, or answered badly. The field keeps
 * showing its last result and says so itself; use this to react beside it, for
 * example to hold a submit button.
 *
 * It follows the field's own `ezclassify:check-change` event, so each field
 * reports for itself and two fields never share a state.
 *
 * @param id - The field's DOM id, the marking id.
 * @returns A ref that is true while the field's last check of its text failed.
 */
export function useEzClassifyCheckFailed(id: string): Readonly<Ref<boolean>> {
    const failed = ref(false);
    let stop: (() => void) | null = null;
    onMounted(() => {
        stop = watchCheckFailed(id, (next) => {
            failed.value = next;
        });
    });
    onBeforeUnmount(() => stop?.());
    return failed;
}
