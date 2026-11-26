import { DOCUMENT } from '@angular/common';
import { effect, inject, isSignal, signal, type Signal } from '@angular/core';
import { watchUnverified } from '@ezclassify/ui';

/**
 * Whether the marking field with this id is unverified: the result it shows has
 * not been verified for its current text because the last check could not be
 * completed (the runtime was unreachable, timed out, or answered badly). The
 * field keeps showing its last result and says so itself; use this to react
 * beside it, for example to hold a submit button.
 *
 * Call it from an injection context. It follows the field's own
 * `ezclassify:unverified-change` event, so each field reports for itself and
 * two fields never share a state. The id may be a signal; following moves with
 * it and stops when the injector is destroyed. A field that is not enhanced yet
 * reads false until it is.
 *
 * @param id - The field's DOM id, the marking id.
 * @returns A signal that is true while the field's result is unverified.
 */
export function injectEzClassifyUnverified(
    id: string | Signal<string>,
): Signal<boolean> {
    const document = inject(DOCUMENT);
    const unverified = signal(false);
    effect((onCleanup) => {
        const current = isSignal(id) ? id() : id;
        onCleanup(
            watchUnverified(
                current,
                (state) => unverified.set(state),
                document,
            ),
        );
    });
    return unverified.asReadonly();
}
