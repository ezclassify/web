/**
 * Read and write helpers for the recordings file. Reads validate against the
 * contract; writes sort object keys so the on-disk JSON is deterministic and
 * diffs cleanly in version control.
 */
import { readFileSync } from 'node:fs';
import { validateRecordingsFile, type RecordingsFile } from './contract';
import { writeSortedJsonFile } from './json-file';

/** Read and validate a recordings file, throwing on a contract mismatch. */
export function readRecordingsFile(filePath: string): RecordingsFile {
    const raw: unknown = JSON.parse(readFileSync(filePath, 'utf8'));
    return validateRecordingsFile(raw);
}

/** Write a recordings file with sorted keys and a trailing newline. */
export function writeRecordingsFile(
    filePath: string,
    data: RecordingsFile,
): void {
    writeSortedJsonFile(filePath, data);
}
