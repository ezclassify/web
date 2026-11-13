/**
 * Which lane a run is in, readable from a global setup and from a spec alike.
 *
 * `EZCLASSIFY_RECORD=1` is the maintainer lane: requests go to a live local
 * demo runtime and every spec file's recordings are rewritten. Anything else is
 * the public lane, which replays the committed recordings.
 */

/** Set to `1` to record against a live demo runtime instead of replaying. */
export const RECORD_VARIABLE = 'EZCLASSIFY_RECORD';

/** Whether this run records against a live demo runtime. */
export const recording = process.env[RECORD_VARIABLE] === '1';
