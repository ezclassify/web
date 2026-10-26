/**
 * Integration tier.
 *
 * Separate from `vitest.config.ts` because these specs boot a real
 * `@ezclassify/rest-api` on a loopback port. STANDARDS.md keeps the tiers
 * apart: unit specs import source files and stay in-process, integration specs
 * import public package entrypoints and use real collaborators, and a server
 * boot belongs to a tier a developer opts into (`npm run test:integration`).
 *
 * The tier lives at the repo root rather than inside a package because its
 * subject spans packages: it drives `@ezclassify/ui` through the published
 * `@ezclassify/rest-client` against a running server, which no single package
 * owns. The client is aliased to no source here on purpose: this tier exercises
 * the installed package, which is what an integrator gets.
 *
 * Needs the private lane (`npm run lane:private`) so the installed REST server
 * and example schemes are present; the global setup fails with a clear message
 * when the server package is not resolvable.
 */
import { defineConfig } from 'vitest/config';
import * as path from 'node:path';
import { siblingRuntimeAliases } from './vitest.private-runtime';

export default defineConfig({
    resolve: {
        // `Context` uses class identity, so every import path must land on one
        // engine instance, exactly as the unit config arranges.
        dedupe: ['@ezclassify/engine'],
        alias: {
            ...siblingRuntimeAliases,
            '@ezclassify/ui': path.resolve(
                import.meta.dirname,
                'libs/ui/src/index.ts',
            ),
        },
    },
    test: {
        include: ['tests/integration/**/*.spec.ts'],
        globalSetup: ['tests/integration/rest-api-server.ts'],
        environment: 'node',
        globals: false,
        // One server, one shared engine: the specs compare adapters against the
        // same loaded profile, so they must not race for it.
        fileParallelism: false,
    },
});
