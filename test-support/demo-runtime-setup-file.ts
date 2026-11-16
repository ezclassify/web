/**
 * Per spec file: close the file's demo-runtime recordings once it has run.
 *
 * A vitest `setupFiles` entry, so the hook belongs to every spec file without
 * each one registering it. In record mode it writes the file's recordings,
 * formatted the way the repository formats JSON so `format:check` stays clean;
 * in the public lane it fails the file when any request had no recording. See
 * `demo-runtime.ts`.
 */
import { createRequire } from 'node:module';
import { afterAll } from 'vitest';
import { closeSpecRecordings } from './demo-runtime';

/**
 * Prettier's Node entry. A jsdom project resolves the `browser` condition,
 * which would hand an `import` the standalone build, and that build cannot read
 * the repository's configuration.
 */
const prettier = createRequire(import.meta.url)(
    'prettier',
) as typeof import('prettier');

afterAll(async () => {
    await closeSpecRecordings(async (json, file) => {
        const config = (await prettier.resolveConfig(file)) ?? {};
        return prettier.format(json, { ...config, filepath: file });
    });
});
