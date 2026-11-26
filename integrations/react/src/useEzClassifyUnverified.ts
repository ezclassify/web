import { useCallback, useSyncExternalStore } from 'react';
import { isUnverified, watchUnverified } from '@ezclassify/ui';

/**
 * Whether the marking field with this id is unverified: the result it shows has
 * not been verified for its current text because the last check could not be
 * completed (the runtime was unreachable, timed out, or answered badly). The
 * field keeps showing its last result and says so itself; use this to react
 * beside it, for example to hold a submit button.
 *
 * It follows the field's own `ezclassify:unverified-change` event, so each
 * field reports for itself and two fields never share a state. A field that is
 * already unverified when this mounts reads true on the first render, and a
 * field that is not enhanced yet reads false until it is.
 *
 * @param id - The field's DOM id, the marking id.
 * @returns True while the field's result is unverified.
 */
export function useEzClassifyUnverified(id: string): boolean {
    const subscribe = useCallback(
        (notify: () => void) => watchUnverified(id, notify),
        [id],
    );
    return useSyncExternalStore(
        subscribe,
        () => isUnverified(id),
        () => false,
    );
}
