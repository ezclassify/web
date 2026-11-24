import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const moduleRoot = fileURLToPath(
    new URL('./release-esbuild/', import.meta.url),
);
const source = 'github.com/evanw/esbuild';
const goMod = readFileSync(join(moduleRoot, 'go.mod'), 'utf8');
const toolchain = goMod.match(/^go (\d+\.\d+\.\d+)$/m)?.[1];
const expected = goMod.match(
    /^\s*github\.com\/evanw\/esbuild v(\d+\.\d+\.\d+)(?: \/\/ indirect)?$/m,
)?.[1];
const require = createRequire(import.meta.url);
const esbuildManifest = require.resolve('esbuild/package.json');
const platformName = `@esbuild/${process.platform}-${process.arch}`;
const platformManifest = createRequire(esbuildManifest).resolve(
    `${platformName}/package.json`,
);
const packageVersion = (path) => JSON.parse(readFileSync(path, 'utf8')).version;

if (process.env.ESBUILD_BINARY_PATH) {
    throw new Error(
        'Release preparation requires esbuild to use its installed platform binary.',
    );
}

if (
    !toolchain ||
    !expected ||
    packageVersion(esbuildManifest) !== expected ||
    packageVersion(platformManifest) !== expected
) {
    throw new Error(
        'Installed esbuild must match the pinned Go source version.',
    );
}

// Replace the installed build tool before generating the SBOM. The upstream
// binary does not expose the Go toolchain and module inventory to scanners.
const installed =
    process.platform === 'win32'
        ? join(dirname(platformManifest), 'esbuild.exe')
        : join(dirname(platformManifest), 'bin', 'esbuild');
const scratch = mkdtempSync(join(dirname(installed), '.esbuild-release-'));
const binary = join(
    scratch,
    process.platform === 'win32' ? 'esbuild.exe' : 'esbuild',
);
try {
    execFileSync(
        'go',
        [
            'build',
            '-mod=readonly',
            '-trimpath',
            '-buildvcs=false',
            '-o',
            binary,
            `${source}/cmd/esbuild`,
        ],
        {
            cwd: moduleRoot,
            stdio: 'inherit',
            timeout: 180_000,
            env: {
                ...process.env,
                CGO_ENABLED: '0',
                GOFLAGS: '',
                GOWORK: 'off',
                GOOS:
                    process.platform === 'win32' ? 'windows' : process.platform,
                GOARCH: process.arch === 'x64' ? 'amd64' : process.arch,
                GOTOOLCHAIN: `go${toolchain}`,
            },
        },
    );
    if (
        execFileSync(binary, ['--version'], {
            encoding: 'utf8',
            timeout: 10_000,
        }).trim() !== expected
    ) {
        throw new Error('Rebuilt esbuild reported a different version.');
    }
    renameSync(binary, installed);
    console.log(`Prepared esbuild ${expected} with Go ${toolchain}.`);
} finally {
    rmSync(scratch, { recursive: true, force: true });
}
