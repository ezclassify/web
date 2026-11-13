/**
 * Which lane a run is in, readable from a global setup and from a spec alike.
 *
 * `EZCLASSIFY_RECORD=1` is the maintainer lane: requests go to a live local
 * demo runtime and every spec file's recordings are rewritten. Anything else is
 * the public lane, which replays the committed recordings.
 *
 * `EZCLASSIFY_PRUNE_RECORDINGS=1` is the last step of a recording run: the
 * public lane replays, and each spec file's recordings are rewritten to hold
 * only the answers the replay used.
 */

/** Set to `1` to record against a live demo runtime instead of replaying. */
export const RECORD_VARIABLE = 'EZCLASSIFY_RECORD';

/** Whether this run records against a live demo runtime. */
export const recording = process.env[RECORD_VARIABLE] === '1';

/** Set to `1` to keep only the recordings a replay uses. */
export const PRUNE_VARIABLE = 'EZCLASSIFY_PRUNE_RECORDINGS';

/** Whether this replay rewrites each recordings file to what it used. */
export const pruning = !recording && process.env[PRUNE_VARIABLE] === '1';
