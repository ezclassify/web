import { defineConfig } from 'vitest/config';

/**
 * This package is outside the repository's public workspace install closure, so
 * the root config excludes its specs and they cannot run from the root. It
 * installs and runs on its own, which is what this config is for: `npm test`
 * here resolves against `libs/ui-tools/node_modules` and nothing else.
 */
export default defineConfig({
    test: {
        environment: 'node',
        include: ['src/**/*.spec.ts'],
        exclude: ['node_modules/**', 'dist/**'],
    },
});
