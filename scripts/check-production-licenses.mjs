#!/usr/bin/env node
/** Check the installed production closure of every publishable workspace. */
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { expandWorkspaces } from './check-public-dependencies-lib.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ALLOWED =
    'MIT;ISC;Apache-2.0;BSD-2-Clause;BSD-3-Clause;0BSD;CC0-1.0;Unlicense;BlueOak-1.0.0;CC-BY-4.0;Python-2.0;MPL-2.0';
const object = (value) =>
    value !== null && typeof value === 'object' && !Array.isArray(value);

/**
 * Validate npm's graph before permitting either an empty or populated license
 * check. Peer dependencies belong to the consumer; npm's omitted dev/peer
 * installs are not packages redistributed by these libraries.
 *
 * @param {object} tree Parsed `npm ls --omit=dev --all --json` output.
 * @param {object[]} workspaces All discovered publishable manifests.
 * @param {number} exitCode Npm's exit status; only advisory extraneous entries
 *   may fail.
 * @returns {string[]} Third-party name@version identities in the selected
 *   closure.
 */
export function productionLicensePackages(tree, workspaces, exitCode = 0) {
    if (!object(tree) || !object(tree.dependencies) || !workspaces.length)
        throw new Error('No publishable workspace graph was inspected');
    if (
        ![0, 1].includes(exitCode) ||
        (tree.error && tree.error.code !== 'ELSPROBLEMS')
    )
        throw new Error(
            'npm could not inspect the production dependency graph',
        );
    const nodes = new Map();
    const inspect = (name, node) => {
        if (
            !object(node) ||
            typeof node.version !== 'string' ||
            !node.version ||
            node.missing ||
            node.invalid
        )
            throw new Error(
                `Missing or invalid production dependency: ${name}`,
            );
        if (
            node.problems &&
            (!Array.isArray(node.problems) ||
                node.problems.some(
                    (p) =>
                        typeof p !== 'string' || !p.startsWith('extraneous: '),
                ))
        )
            throw new Error(`Incomplete production dependency graph: ${name}`);
        if (node.dependencies !== undefined && !object(node.dependencies))
            throw new Error(`Malformed dependencies for ${name}`);
        const key = `${name}@${node.version}`;
        // npm may expand a deduplicated package under another workspace or an
        // extraneous root. Keep those edges without selecting that other root.
        const edges = nodes.get(key) ?? new Map();
        for (const [child, value] of Object.entries(node.dependencies ?? {})) {
            inspect(child, value);
            edges.set(child, `${child}@${value.version}`);
        }
        nodes.set(key, edges);
    };
    if (
        tree.problems &&
        (!Array.isArray(tree.problems) ||
            tree.problems.some(
                (p) => typeof p !== 'string' || !p.startsWith('extraneous: '),
            ))
    )
        throw new Error(
            'npm reported an incomplete production dependency graph',
        );
    if (exitCode === 1 && !tree.problems?.length)
        throw new Error(
            'npm failed without an explained advisory graph problem',
        );
    for (const [name, node] of Object.entries(tree.dependencies))
        inspect(name, node);
    const pending = [];
    for (const workspace of workspaces) {
        const node = tree.dependencies[workspace.name];
        if (!node || node.extraneous || node.version !== workspace.version)
            throw new Error(
                `Publishable workspace was not inspected: ${workspace.name}`,
            );
        for (const name of Object.keys(workspace.dependencies ?? {})) {
            if (!node.dependencies?.[name])
                throw new Error(
                    `Missing production edge: ${workspace.name} -> ${name}`,
                );
        }
        pending.push(`${workspace.name}@${node.version}`);
    }
    const visited = new Set();
    const thirdParty = new Set();
    while (pending.length) {
        const key = pending.pop();
        if (visited.has(key)) continue;
        visited.add(key);
        if (!key.startsWith('@ezclassify/')) thirdParty.add(key);
        pending.push(...nodes.get(key).values());
    }
    return [...thirdParty].sort();
}

/**
 * Require an actual license result for every selected package, even if the
 * checker exits zero.
 */
export function assertLicenseCoverage(packages, report) {
    if (!object(report)) throw new Error('Malformed license checker report');
    const missing = packages.filter(
        (name) => !object(report[name]) || !report[name].licenses,
    );
    if (missing.length)
        throw new Error(
            `License gate inspected no entry for: ${missing.join(', ')}`,
        );
}

function main() {
    const read = (dir) =>
        JSON.parse(readFileSync(path.join(ROOT, dir, 'package.json'), 'utf8'));
    const workspaces = expandWorkspaces(read('.').workspaces, (parent) =>
        readdirSync(path.join(ROOT, parent), { withFileTypes: true })
            .filter((entry) => entry.isDirectory())
            .map((entry) => entry.name),
    )
        .map(read)
        .filter((manifest) => manifest.private !== true);
    const result = spawnSync(
        'npm',
        [
            'ls',
            '--omit=dev',
            '--all',
            '--json',
            ...workspaces.flatMap((manifest) => ['-w', manifest.name]),
        ],
        { cwd: ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 },
    );
    if (result.error || result.status === null)
        throw new Error('npm production graph command failed');
    const packages = productionLicensePackages(
        JSON.parse(result.stdout),
        workspaces,
        result.status,
    );
    console.log(
        `Inspected ${workspaces.length} publishable workspaces; ${packages.length} third-party production dependencies`,
    );
    if (!packages.length) return;
    const checked = spawnSync(
        'npx',
        [
            '--yes',
            'license-checker-rseidelsohn@4.4.2',
            '--includePackages',
            packages.join(';'),
            '--json',
            '--onlyAllow',
            ALLOWED,
        ],
        { cwd: ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 },
    );
    if (checked.error || checked.status !== 0)
        throw new Error(
            `License allowlist check failed: ${checked.stderr ?? checked.error}`,
        );
    assertLicenseCoverage(packages, JSON.parse(checked.stdout));
    console.log(
        `License allowlist and result coverage passed for ${packages.length} packages`,
    );
}

if (
    process.argv[1] &&
    import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
    try {
        main();
    } catch (error) {
        console.error(error.message);
        process.exitCode = 1;
    }
}
