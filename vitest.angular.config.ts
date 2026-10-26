import { defineConfig } from 'vitest/config';
import * as path from 'path';
import {
    describePrivateRuntime,
    siblingRuntimeAliases,
    specsNeedingPrivateRuntime,
} from './vitest.private-runtime.ts';

// The Angular half of the private lane. Same derivation as the main config,
// scoped to the specs this runner owns. See vitest.private-runtime.ts.
const PRIVATE_LANE_SPECS = specsNeedingPrivateRuntime(['integrations/angular']);

describePrivateRuntime(PRIVATE_LANE_SPECS);

export default defineConfig({
    resolve: {
        conditions: ['browser', 'module', 'import', 'default'],
        // Prefer TypeScript source over a compiled sibling. The ng-add
        // schematic ships a compiled index.js (gitignored, built by
        // tsconfig.schematics.json) next to index.ts; without this its spec
        // would bind to a potentially stale index.js on a source edit without
        // a rebuild. In tests the .ts source is always the source of truth.
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
            ...siblingRuntimeAliases,
        },
    },
    test: {
        globals: true,
        environment: 'jsdom',
        setupFiles: [
            './tests/setup/constructable-stylesheets.ts',
            './integrations/angular/vitest.setup.ts',
        ],
        include: [
            'integrations/angular/**/*.spec.ts',
            'integrations/angular/**/*.spec.tsx',
        ],
        exclude: ['node_modules/**', 'dist/**', ...PRIVATE_LANE_SPECS],
    },
});
