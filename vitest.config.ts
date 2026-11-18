import { defineConfig } from 'vitest/config';
import * as path from 'path';

export default defineConfig({
    resolve: {
        conditions: ['browser', 'module', 'import', 'default'],
        alias: {
            // @ezclassify/types and @ezclassify/rest-client resolve through
            // node_modules.
            // Test-only subpath: the cross-framework adapter parity suite. Aliased
            // (not exported from the package root) so vitest's `describe/it/expect`
            // import never reaches a production bundle. Must precede the bare
            // '@ezclassify/ui' alias so the more specific path wins.
            '@ezclassify/ui/adapter-parity-suite': path.resolve(
                import.meta.dirname,
                'libs/ui/src/store/adapter-parity-suite.ts',
            ),
            '@ezclassify/ui': path.resolve(
                import.meta.dirname,
                'libs/ui/src/index.ts',
            ),
            '@ezclassify/react': path.resolve(
                import.meta.dirname,
                'integrations/react/src/index.ts',
            ),
            '@ezclassify/vue': path.resolve(
                import.meta.dirname,
                'integrations/vue/src/index.ts',
            ),
            '@ezclassify/angular': path.resolve(
                import.meta.dirname,
                'integrations/angular/src/index.ts',
            ),
        },
    },
    test: {
        globals: true,
        environment: 'jsdom',
        // The demo runtime's recordings: replayed in the public lane, recorded
        // against a local runtime with EZCLASSIFY_RECORD=1. See
        // test-support/demo-runtime.ts.
        globalSetup: ['./test-support/demo-runtime-global-setup.ts'],
        setupFiles: [
            './test-support/fail-on-console-error.ts',
            './tests/setup/constructable-stylesheets.ts',
            './test-support/demo-runtime-setup-file.ts',
        ],
        include: [
            'libs/**/*.spec.ts',
            'libs/**/*.spec.tsx',
            'integrations/**/*.spec.ts',
            'integrations/**/*.spec.tsx',
            'scripts/**/*.spec.ts',
        ],
        exclude: [
            'node_modules/**',
            'dist/**',
            // Angular requires separate runner (zone.js conflicts with jsdom)
            'integrations/angular/**',
            // @ezclassify/ui-tools is not a workspace of this repository. Its
            // record and replay specs need nothing it installs and run in the
            // integration tier; its Playwright specs run from its own install.
            // See AGENTS.md.
            'libs/ui-tools/**',
        ],
    },
});
