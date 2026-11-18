/**
 * Integration tier.
 *
 * Separate from `vitest.config.ts` because its subject spans packages: it
 * drives `@ezclassify/ui` through the published `@ezclassify/rest-client`
 * against the demo runtime's wire, which no single package owns. The client is
 * aliased to no source here on purpose: this tier exercises the installed
 * package, which is what an integrator gets. The record and replay harness's
 * own specs run here too, because every other tier's runtime answers pass
 * through it.
 *
 * In the public lane every request is answered from committed recordings; in
 * record mode (`EZCLASSIFY_RECORD=1`) the global setup starts a local demo
 * runtime. See `test-support/demo-runtime.ts`.
 */
import { defineConfig } from 'vitest/config';
import * as path from 'node:path';

export default defineConfig({
    resolve: {
        alias: {
            '@ezclassify/ui': path.resolve(
                import.meta.dirname,
                'libs/ui/src/index.ts',
            ),
        },
    },
    test: {
        include: [
            'tests/integration/**/*.spec.ts',
            'test-support/**/*.spec.ts',
            'libs/ui-tools/src/record-replay/**/*.spec.ts',
        ],
        globalSetup: ['test-support/demo-runtime-global-setup.ts'],
        setupFiles: [
            'test-support/fail-on-console-error.ts',
            'test-support/demo-runtime-setup-file.ts',
        ],
        environment: 'node',
        globals: false,
    },
});
