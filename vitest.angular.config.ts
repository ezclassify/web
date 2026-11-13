import { defineConfig } from 'vitest/config';
import * as path from 'path';

export default defineConfig({
    resolve: {
        conditions: ['browser', 'module', 'import', 'default'],
        // Prefer TypeScript source over a compiled sibling: in tests the .ts
        // source is always the source of truth.
        extensions: ['.ts', '.tsx', '.mjs', '.js', '.mts', '.jsx', '.json'],
        alias: {
            // Test-only subpath: cross-framework adapter parity suite. Must
            // precede the bare '@ezclassify/ui' alias so the specific path wins.
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
        // The demo runtime's recordings, as in vitest.config.ts.
        globalSetup: ['./test-support/demo-runtime-global-setup.ts'],
        setupFiles: [
            './tests/setup/constructable-stylesheets.ts',
            './integrations/angular/vitest.setup.ts',
            './test-support/demo-runtime-setup-file.ts',
        ],
        include: [
            'integrations/angular/**/*.spec.ts',
            'integrations/angular/**/*.spec.tsx',
        ],
        exclude: ['node_modules/**', 'dist/**'],
    },
});
