/**
 * HTTP record and replay for tests, with no dependency beyond Node built-ins.
 *
 * One canonicalization core serves every transport: a recording is keyed by the
 * request's normalized path and its key-stable JSON body
 * ({@link computeRecordingKey}), so a file written by the recorder always
 * resolves in the replayer. The transports differ only in what they intercept:
 *
 * - {@link createRecordingFetch} and {@link createReplayFetch}, for a client that
 *   takes its own `fetch`, such as the REST client in a Vitest spec.
 * - `installReplayer` (exported from the package root), for a Playwright page.
 */
export {
    REPLAYER_CONTRACT_VERSION,
    RecordingsFileError,
    validateRecordingsFile,
} from './contract';
export type { MissEnvelope, RecordingsEntry, RecordingsFile } from './contract';
export { normalizePath, stableJson } from './normalize';
export { computeRecordingKey } from './hash';
export { readRecordingsFile, writeRecordingsFile } from './recordings-file';
export { Recorder } from './recorder';
export type { RecordParams } from './recorder';
export { lookup } from './replayer';
export type { ReplayerRecording, LookupResult } from './replayer';
export {
    RecordingRefusedError,
    createRecordingFetch,
    createReplayFetch,
} from './fetch-transport';
