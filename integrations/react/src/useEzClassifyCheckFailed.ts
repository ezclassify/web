import { useEffect, useState } from 'react';
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
 * @returns True while the field's last check of its text failed.
 */
export function useEzClassifyCheckFailed(id: string): boolean {
    const [failed, setFailed] = useState(false);
    useEffect(() => watchCheckFailed(id, setFailed), [id]);
    return failed;
}
