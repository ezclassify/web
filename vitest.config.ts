import { defineConfig } from 'vitest/config';
import * as path from 'path';
import {
    describePrivateRuntime,
    siblingRuntimeAliases,
    specsNeedingPrivateRuntime,
} from './vitest.private-runtime.ts';

// Specs that need the proprietary engine, the example schemes, or the store
// conformance suite. Derived from what the sources actually import, so a
// checkout without those packages runs the public lane and says which specs it
// left out. See vitest.private-runtime.ts.
const PRIVATE_LANE_SPECS = specsNeedingPrivateRuntime([
    'libs',
    'integrations',
    'scripts',
]);

describePrivateRuntime(PRIVATE_LANE_SPECS);

export default defineConfig({
    resolve: {
        conditions: ['browser', 'module', 'import', 'default'],
        // In the private lane the engine is installed beside the workspaces.
        // Context uses class identity, so tests must resolve one engine
        // instance across UI and every adapter.
        dedupe: ['@ezclassify/engine'],
        alias: {
            // @ezclassify/types (and, in the private lane, the engine) resolve
            // through node_modules.
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
            ...siblingRuntimeAliases,
        },
    },
    test: {
        globals: true,
        environment: 'jsdom',
        setupFiles: ['./tests/setup/constructable-stylesheets.ts'],
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
            // @ezclassify/ui-tools is not a workspace of this repository and is
            // not installed here, so its specs cannot resolve their imports.
            // It is parked in this tree, not part of it. See AGENTS.md.
            'libs/ui-tools/**',
            ...PRIVATE_LANE_SPECS,
        ],
    },
});
