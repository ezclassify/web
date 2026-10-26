#!/usr/bin/env node
/**
 * Typecheck a workspace's test sources, in the lane the checkout can run.
 *
 * Package declaration builds exclude specs, harnesses, mocks, and suites. This
 * lane typechecks those test sources, including the adapter-parity suite shared
 * by the framework integrations.
 *
 * The lane split is the same one the test run uses (see
 * `vitest.private-runtime.ts`). A spec that reaches `@ezclassify/engine` or
 * another proprietary package cannot resolve its imports in a public checkout,
 * so a public-lane typecheck has to leave those specs out, and a maintainer's
 * checkout should still cover them. Rather than keep two hand-written file
 * lists that drift the moment a spec changes its imports, the exclusion is
 * computed from what the sources actually import and written into a throwaway
 * tsconfig next to the workspace's own.
 *
 * Usage:
 *
 *     node scripts/typecheck-specs.mjs <workspace-dir> [--lane=public|auto]
 *
 * `--lane=public` (the default) checks what CI and an outside contributor can
 * check. `--lane=auto` adds the private-lane specs when the private packages
 * are installed, and falls back to the public lane when they are not.
 */

import { spawnSync } from 'node:child_process';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '..',
);

/** Directories the private-lane import scan walks. */
const SCAN_ROOTS = ['libs', 'integrations', 'scripts', 'tests'];

/** The generated config's filename, in the workspace directory. */
const GENERATED_CONFIG = 'tsconfig.spec.lane.json';

const args = process.argv.slice(2);
const workspace = args.find((a) => !a.startsWith('--'));
const lane = (
    args.find((a) => a.startsWith('--lane=')) ?? '--lane=public'
).slice(7);

if (!workspace) {
    console.error(
        'usage: node scripts/typecheck-specs.mjs <workspace-dir> [--lane=public|auto]',
    );
    process.exit(2);
}
if (lane !== 'public' && lane !== 'auto') {
    console.error(`unknown lane "${lane}"; expected "public" or "auto"`);
    process.exit(2);
}

/**
 * Spec files that reach a proprietary package, directly or through a local
 * import.
 *
 * `EZ_PUBLIC_LANE` forces the scanner to treat every private package as
 * missing, which is what makes it report the full set rather than only the ones
 * this particular checkout cannot resolve. The private lane wants the opposite,
 * so it asks with the variable left alone.
 *
 * @param forcePublic - Whether to answer as a checkout with nothing private
 *   installed
 * @returns Repo-relative spec paths
 */
async function privateLaneSpecs(forcePublic) {
    const previous = process.env.EZ_PUBLIC_LANE;
    if (forcePublic) process.env.EZ_PUBLIC_LANE = '1';
    try {
        const module = await import(
            path.join(REPO_ROOT, 'vitest.private-runtime.ts')
        );
        return module.specsNeedingPrivateRuntime(SCAN_ROOTS);
    } finally {
        if (previous === undefined) delete process.env.EZ_PUBLIC_LANE;
        else process.env.EZ_PUBLIC_LANE = previous;
    }
}

/**
 * The module mappings the private lane resolves through a vitest alias.
 *
 * A private-lane spec imports the store conformance suite from the sibling
 * runtime checkout rather than from `node_modules`, so the compiler needs the
 * same mapping vitest gets or those specs report every import as missing. The
 * alias map is read from `vitest.private-runtime.ts` so there is one definition
 * of where the sibling sources live, and it is empty when the sibling checkout
 * is absent.
 *
 * @param workspaceDirectory - Absolute path the generated config sits in
 * @returns A tsconfig `paths` map, possibly empty
 */
async function siblingPaths(workspaceDirectory) {
    const module = await import(
        path.join(REPO_ROOT, 'vitest.private-runtime.ts')
    );
    const paths = {};
    for (const [specifier, target] of Object.entries(
        module.siblingRuntimeAliases,
    )) {
        // tsconfig resolves a paths target against the config's own directory.
        paths[specifier] = [
            `./${path
                .relative(workspaceDirectory, target)
                .split(path.sep)
                .join('/')}`,
        ];
    }
    return paths;
}

const workspaceDir = path.resolve(REPO_ROOT, workspace);
const workspaceRel = path
    .relative(REPO_ROOT, workspaceDir)
    .split(path.sep)
    .join('/');
const baseConfigPath = path.join(workspaceDir, 'tsconfig.spec.json');
const baseConfig = JSON.parse(readFileSync(baseConfigPath, 'utf8'));

const excluded = (await privateLaneSpecs(lane === 'public'))
    .filter((spec) => spec.startsWith(`${workspaceRel}/`))
    .map((spec) => spec.slice(workspaceRel.length + 1));

const aliasPaths = lane === 'public' ? {} : await siblingPaths(workspaceDir);

const generatedPath = path.join(workspaceDir, GENERATED_CONFIG);
writeFileSync(
    generatedPath,
    `${JSON.stringify(
        {
            '//': `Generated by scripts/typecheck-specs.mjs, ${lane} lane. Not committed.`,
            ...baseConfig,
            'compilerOptions': {
                ...(baseConfig.compilerOptions ?? {}),
                paths: {
                    ...(baseConfig.compilerOptions?.paths ?? {}),
                    ...aliasPaths,
                },
            },
            'exclude': [...(baseConfig.exclude ?? []), ...excluded],
        },
        null,
        4,
    )}\n`,
);

const skipped = excluded.length;
console.log(
    `typecheck ${workspaceRel}: ${lane} lane` +
        (skipped
            ? `, ${skipped} private-lane spec${skipped === 1 ? '' : 's'} not checked`
            : ''),
);

// The config is regenerated on every run and never committed, so it is removed
// before exiting rather than left behind for the next run to trip over.
// `process.exit` skips `finally`, hence the explicit order here.
const result = spawnSync('npx', ['tsc', '-p', GENERATED_CONFIG], {
    cwd: workspaceDir,
    stdio: 'inherit',
});
rmSync(generatedPath, { force: true });
process.exit(result.status ?? 1);
