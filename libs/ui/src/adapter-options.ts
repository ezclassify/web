/**
 * Named aliases for the option bags the scheme adapter contract declares
 * inline.
 *
 * `SchemeEngineAdapter.process`, `.validate` and `.suggest` spell their options
 * out at each overload rather than naming a type, so a component that wants to
 * pass an options object around has nothing to annotate it with. Deriving the
 * aliases from the contract instead of hand-copying the fields means a field
 * added to the wire shows up here on the next dependency bump, and a field
 * removed breaks the build at the call site that still passes it.
 *
 * Each member is overloaded with a scheme-id form and a bare form; TypeScript
 * resolves `Parameters<>` against the last declared overload, which is the bare
 * one, and both overloads carry the same bag.
 */

import type { SchemeEngineAdapter } from '@ezclassify/types';

/**
 * Resolve to `T` when it is one of those option bags, and to a message type
 * otherwise.
 *
 * Nothing in the contract pins which overload comes last, so a future one
 * appended after the bare form would retype both aliases below without a single
 * call site complaining. This turns that into a build failure that says what
 * happened: every `format`-bearing bag passes through untouched, and anything
 * else collapses to a string literal that no call site can satisfy.
 */
type OptionsBagOf<T> = T extends { outputFormat?: string }
    ? T
    : 'ERROR: the last process/validate/suggest overload no longer takes the options bag';

/** Options accepted by {@link SchemeEngineAdapter.process}. */
export type ProcessOptions = OptionsBagOf<
    NonNullable<Parameters<SchemeEngineAdapter['process']>[1]>
>;

/** Options accepted by {@link SchemeEngineAdapter.validate}. */
export type ValidateOptions = OptionsBagOf<
    NonNullable<Parameters<SchemeEngineAdapter['validate']>[1]>
>;

/** Options accepted by {@link SchemeEngineAdapter.suggest}. */
export type SuggestOptions = OptionsBagOf<
    NonNullable<Parameters<SchemeEngineAdapter['suggest']>[1]>
>;
