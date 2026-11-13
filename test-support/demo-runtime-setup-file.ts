/**
 * Per spec file: close the file's demo-runtime recordings once it has run.
 *
 * A vitest `setupFiles` entry, so the hook belongs to every spec file without
 * each one registering it. In record mode it writes the file's recordings,
 * formatted the way the repository formats JSON so `format:check` stays clean;
 * in the public lane it fails the file when any request had no recording. See
 * `demo-runtime.ts`.
 */
import { afterAll } from 'vitest';
import { closeSpecRecordings } from './demo-runtime';

afterAll(async () => {
    await closeSpecRecordings(async (json, file) => {
        const prettier = await import('prettier');
        const config = (await prettier.resolveConfig(file)) ?? {};
        return prettier.format(json, { ...config, filepath: file });
    });
});
