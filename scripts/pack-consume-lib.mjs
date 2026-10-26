// Helpers for the native scratch consumers (the main script executes on import).
import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { EXAMPLES, webServer } from '../e2e/lanes.mjs';

/**
 * Environment for the scratch consumer's `npm install`.
 *
 * `npm run` exports every project .npmrc setting into the child environment as
 * `npm_config_*` (including registry, peer and install policy). A real consumer
 * installing our tarballs has none of this repo's install policy, so the
 * scratch install must not inherit it: with the leak in place the consume
 * project ends up with no react/vue/engine and every root entry fails to load.
 */
export function consumerEnv(baseEnv) {
    const env = {};
    for (const [key, value] of Object.entries(baseEnv)) {
        if (/^npm_config_/i.test(key)) continue;
        env[key] = value;
    }
    return env;
}

/**
 * Names of scoped packages the consume project needs that this repo does not
 * publish: peers of the publishable workspaces under `scope`, closed over the
 * scoped dependencies/peers of each resolved manifest (engine pulls in types
 * and schemas). The caller packs the repo's installed copies instead of
 * fetching them from a registry.
 *
 * `getManifest(name)` returns the installed package.json or null; unresolvable
 * names land in `missing` so the caller can fail loud instead of letting the
 * scratch install chase a registry that may not have them.
 *
 * `extraSeeds` adds names the shipped bundles import without declaring, which a
 * manifest walk alone cannot see. Closure applies to them as well.
 */
export function collectExternalScopedPeers({
    packages,
    localNames,
    scope,
    getManifest,
    extraSeeds = [],
}) {
    const queue = [];
    for (const pkg of packages) {
        for (const name of Object.keys(pkg.manifest.peerDependencies ?? {})) {
            if (name.startsWith(scope)) queue.push(name);
        }
    }
    for (const name of extraSeeds) {
        if (name.startsWith(scope)) queue.push(name);
    }
    const found = new Set();
    const missing = new Set();
    while (queue.length > 0) {
        const name = queue.shift();
        if (localNames.has(name) || found.has(name) || missing.has(name))
            continue;
        const manifest = getManifest(name);
        if (!manifest) {
            missing.add(name);
            continue;
        }
        found.add(name);
        for (const dep of Object.keys({
            ...(manifest.dependencies ?? {}),
            ...(manifest.peerDependencies ?? {}),
        })) {
            if (dep.startsWith(scope)) queue.push(dep);
        }
    }
    return { found: [...found].sort(), missing: [...missing].sort() };
}

/**
 * Build the Angular example's dependencies for one supported Angular line. All
 * first-party packages come from this build's tarballs, never a registry.
 *
 * @param {object} source - The Angular example's manifest.
 * @param {{ major: number; version: string }} target - Consumer framework line.
 * @param {Record<string, string>} tarballs - Package name to packed artifact.
 * @param {string} playwrightVersion - Installed native browser test tool.
 * @returns {object} Standalone consumer manifest.
 */
export function angularConsumerManifest(
    source,
    target,
    tarballs,
    playwrightVersion,
) {
    const manifest = structuredClone(source);
    for (const name of Object.keys(manifest.dependencies)) {
        if (name.startsWith('@angular/'))
            manifest.dependencies[name] = target.version;
    }
    for (const [name, file] of Object.entries(tarballs)) {
        if (name === '@ezclassify/react' || name === '@ezclassify/vue')
            continue;
        manifest.dependencies[name] = `file:${file}`;
    }
    manifest.devDependencies = {
        '@angular/cli': `^${target.major}.0.0`,
        '@angular/build': `^${target.major}.0.0`,
        '@angular/compiler-cli': target.version,
        '@angular-devkit/schematics': `^${target.major}.0.0`,
        'typescript': target.major === 22 ? '6.0.3' : '5.9.3',
        'playwright': playwrightVersion,
        '@playwright/test': playwrightVersion,
    };
    return manifest;
}

/**
 * Require every installed first-party package to come from the packed build.
 *
 * @param {Record<string, { resolved?: string }>} packages - Native lock package
 *   records.
 * @returns {boolean} Whether a nonempty first-party closure uses file tarballs.
 */
export function hasPackedFirstPartyClosure(packages) {
    const firstParty = Object.entries(packages).filter(([name]) =>
        /(?:^|\/)node_modules\/@ezclassify\/[^/]+$/.test(name),
    );
    return (
        firstParty.length > 0 &&
        firstParty.every(([, entry]) => entry.resolved?.startsWith('file:'))
    );
}

/**
 * Playwright configuration for the README path against one copied Angular
 * example: its replay server and its dev server, started the way its README
 * says, on the ports the repository's own lane uses.
 *
 * @returns {string} TypeScript source for `playwright.config.ts`.
 */
export function angularExamplePlaywrightConfig() {
    const example = EXAMPLES.find((entry) => entry.name === 'angular-example');
    const origin = `http://localhost:${example.appPort}`;
    const replay = `http://127.0.0.1:${example.serverPort}`;
    const config = {
        testDir: 'e2e',
        timeout: 180_000,
        expect: { timeout: 15_000 },
        retries: 0,
        workers: 1,
        reporter: 'list',
        use: { headless: true, baseURL: origin },
        webServer: [
            webServer(
                `npx @ezclassify/conformance-server --scenario cedar-valley --port ${example.serverPort} --cors-origin ${origin}`,
                undefined,
                `${replay}/v1/health`,
            ),
            webServer(example.dev, undefined, origin),
        ],
    };
    return [
        "import { defineConfig, devices } from '@playwright/test';",
        '',
        `const config = ${JSON.stringify(config, null, 4)};`,
        '',
        'export default defineConfig({',
        '    ...config,',
        "    projects: [{ name: 'angular-example', use: { ...devices['Desktop Chrome'] } }],",
        '});',
        '',
    ].join('\n');
}

/**
 * Link, build and exercise the same packed library in supported Angular apps.
 * The Angular README example and its README-path browser suite supply the
 * actual behavior.
 *
 * @param {object} options - Native pack-consume owner paths and callbacks.
 */
export function verifyAngularConsumers({
    repository,
    scratch,
    tarballs,
    run,
    check,
}) {
    const fixture = path.join(repository, 'examples/angular-example');
    const source = JSON.parse(
        readFileSync(path.join(fixture, 'package.json'), 'utf8'),
    );
    const library = JSON.parse(
        readFileSync(
            path.join(repository, 'integrations/angular/package.json'),
            'utf8',
        ),
    );
    const tool = JSON.parse(
        readFileSync(
            path.join(repository, 'node_modules/playwright/package.json'),
            'utf8',
        ),
    ).version;
    const targets = [
        { major: 20, version: library.devDependencies['@angular/core'] },
        { major: 21, version: '^21.0.0' },
        { major: 22, version: source.dependencies['@angular/core'] },
    ];
    const cutoff = new Date(Date.now() - 7 * 864e5).toISOString();
    for (const target of targets) {
        const directory = path.join(scratch, `angular-${target.major}`);
        cpSync(fixture, directory, {
            recursive: true,
            filter: (file) =>
                ![
                    'node_modules',
                    'dist',
                    '.angular',
                    'package-lock.json',
                    'test-results',
                ].includes(path.basename(file)),
        });
        writeFileSync(
            path.join(directory, 'package.json'),
            JSON.stringify(
                angularConsumerManifest(source, target, tarballs, tool),
                null,
                2,
            ),
        );
        mkdirSync(path.join(directory, 'e2e'));
        cpSync(
            path.join(repository, 'e2e/examples/document-form.spec.ts'),
            path.join(directory, 'e2e/document-form.spec.ts'),
        );
        writeFileSync(
            path.join(directory, 'playwright.config.ts'),
            angularExamplePlaywrightConfig(),
        );
        const env = consumerEnv(process.env);
        function command(label, executable, args, extra = {}) {
            const result = run(executable, args, {
                cwd: directory,
                env: { ...env, ...extra },
            });
            const passed = result.status === 0;
            check(
                `Angular ${target.major} ${label}`,
                passed,
                `${result.stdout}\n${result.stderr}`,
            );
            return passed;
        }
        if (
            !command('strict packed install', 'npm', [
                'install',
                '--ignore-scripts',
                '--no-audit',
                '--no-fund',
                '--legacy-peer-deps=false',
                `--before=${cutoff}`,
            ])
        )
            continue;
        const lock = JSON.parse(
            readFileSync(path.join(directory, 'package-lock.json'), 'utf8'),
        );
        check(
            `Angular ${target.major} first-party tarball closure`,
            hasPackedFirstPartyClosure(lock.packages),
            'A first-party dependency did not come from the current tarballs.',
        );
        if (!command('production linker/build', 'npm', ['run', 'build']))
            continue;
        const binary = (name) =>
            path.join(
                directory,
                'node_modules/.bin',
                name + (process.platform === 'win32' ? '.cmd' : ''),
            );
        command('packed ng-add', binary('ng'), [
            'generate',
            '@ezclassify/angular:ng-add',
            '--dry-run',
            '--skip-import',
        ]);
        command(
            'README path against the Cedar Valley replay',
            binary('playwright'),
            ['test', '--config', 'playwright.config.ts'],
            { EZ_E2E_EVIDENCE_DIR: path.join(directory, 'evidence') },
        );
    }
}

/**
 * Strict public types and DOM lifecycle from packed React/Vue adapters at the
 * supported API floor and current development line. These fixtures exercise
 * public components without an engine or a backend.
 *
 * @param {object} options - Native pack-consume owner paths and callbacks.
 */
export function verifyReactVueConsumers({
    repository,
    scratch,
    tarballs,
    run,
    check,
}) {
    const currentVersion = (framework) =>
        JSON.parse(
            readFileSync(
                path.join(repository, `integrations/${framework}/package.json`),
                'utf8',
            ),
        ).devDependencies[framework];
    const targets = [
        { framework: 'react', version: '18', types: '18' },
        {
            framework: 'react',
            version: currentVersion('react'),
            types: '^19.0.0',
        },
        { framework: 'vue', version: '3.3.0' },
        { framework: 'vue', version: currentVersion('vue') },
    ];
    const fixtures = path.join(
        repository,
        'scripts/fixtures/framework-consumers',
    );
    const cutoff = new Date(Date.now() - 7 * 864e5).toISOString();
    for (const target of targets) {
        const { framework, version } = target;
        const directory = path.join(
            scratch,
            `${framework}-${version.replaceAll(/[^\w]/g, '_')}`,
        );
        mkdirSync(directory);
        const dependencies = {};
        for (const [name, file] of Object.entries(tarballs)) {
            if (
                name === '@ezclassify/ui' ||
                name === '@ezclassify/types' ||
                name === `@ezclassify/${framework}`
            )
                dependencies[name] = `file:${file}`;
        }
        dependencies[framework] = version;
        if (framework === 'react') {
            dependencies['react-dom'] = version;
            dependencies['@types/react'] = target.types;
            dependencies['@types/react-dom'] = target.types;
        }
        writeFileSync(
            path.join(directory, 'package.json'),
            JSON.stringify(
                {
                    name: `packed-${framework}-consumer`,
                    private: true,
                    type: 'module',
                    dependencies,
                    devDependencies: { typescript: '5.9.3', jsdom: '^26.0.0' },
                },
                null,
                2,
            ),
        );
        const extension = framework === 'react' ? 'tsx' : 'ts';
        for (const [source, destination] of [
            [`${framework}-consumer.${extension}`, `consumer.${extension}`],
            [`${framework}-runtime.mjs`, 'runtime.mjs'],
            ['runtime-dom-common.mjs', 'runtime-dom-common.mjs'],
        ])
            cpSync(
                path.join(fixtures, source),
                path.join(directory, destination),
            );
        writeFileSync(
            path.join(directory, 'tsconfig.json'),
            JSON.stringify(
                {
                    compilerOptions: {
                        strict: true,
                        skipLibCheck: false,
                        noEmit: true,
                        module: 'ESNext',
                        moduleResolution: 'Bundler',
                        target: 'ES2022',
                        lib: ['ES2022', 'DOM', 'DOM.Iterable'],
                        types: [],
                        ...(framework === 'react' ? { jsx: 'react-jsx' } : {}),
                    },
                    include: [`consumer.${extension}`],
                },
                null,
                2,
            ),
        );
        function command(label, executable, args) {
            const result = run(executable, args, {
                cwd: directory,
                env: consumerEnv(process.env),
            });
            const passed = result.status === 0;
            check(
                `${framework} ${version} ${label}`,
                passed,
                `${result.stdout}\n${result.stderr}`,
            );
            return passed;
        }
        if (
            !command('strict packed install', 'npm', [
                'install',
                '--ignore-scripts',
                '--no-audit',
                '--no-fund',
                '--legacy-peer-deps=false',
                `--before=${cutoff}`,
            ])
        )
            continue;
        const lock = JSON.parse(
            readFileSync(path.join(directory, 'package-lock.json'), 'utf8'),
        );
        check(
            `${framework} ${version} first-party tarball closure`,
            hasPackedFirstPartyClosure(lock.packages),
            'A first-party dependency did not come from the current tarballs.',
        );
        command('strict public types', process.execPath, [
            'node_modules/typescript/bin/tsc',
            '-p',
            'tsconfig.json',
        ]);
        command('public DOM lifecycle', process.execPath, ['runtime.mjs']);
    }
}
