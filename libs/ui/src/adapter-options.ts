/**
 * Named aliases for the option bags the Context scheme contract declares
 * inline.
 *
 * `process`, `validate` and `suggest` on a Context's scheme view spell their
 * options out at the method rather than naming a type, so a component that
 * wants to pass an options object around has nothing to annotate it with.
 * Deriving the aliases from the contract instead of hand-copying the fields
 * means a field added to the wire shows up here on the next dependency bump,
 * and a field removed breaks the build at the call site that still passes it.
 *
 * The remote view is the one the contract defines the argument shapes on; the
 * local view answers the same operations synchronously.
 */

import type { RemoteContextSchemeEngineAdapter } from '@ezclassify/types';

/** Options accepted by a Context scheme view's `process`. */
export type ProcessOptions = NonNullable<
    Parameters<RemoteContextSchemeEngineAdapter['process']>[1]
>;

/** Options accepted by a Context scheme view's `validate`. */
export type ValidateOptions = NonNullable<
    Parameters<RemoteContextSchemeEngineAdapter['validate']>[1]
>;

/** Options accepted by a Context scheme view's `suggest`. */
export type SuggestOptions = NonNullable<
    Parameters<RemoteContextSchemeEngineAdapter['suggest']>[1]
>;
