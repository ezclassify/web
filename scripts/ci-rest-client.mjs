#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

if (process.env.GITHUB_ACTIONS !== 'true') {
    throw new Error(
        'Use this helper only in a disposable GitHub Actions checkout',
    );
}

const name = '@ezclassify/rest-client';
const version = process.env.REST_CLIENT_SNAPSHOT;
if (!version) throw new Error('Missing verified REST client version');

const fields = ['dependencies', 'devDependencies', 'optionalDependencies'];
const files = execFileSync(
    'git',
    ['ls-files', '-z', '--', 'package.json', '*/package.json'],
    {
        encoding: 'utf8',
    },
)
    .split('\0')
    .filter(Boolean);
const manifests = files
    .map((path) => ({ path, data: JSON.parse(readFileSync(path, 'utf8')) }))
    .filter(({ data }) =>
        fields.some((field) => Object.hasOwn(data[field] ?? {}, name)),
    );
if (manifests.length === 0) throw new Error('No REST client dependency found');

switch (process.argv[2]) {
    case 'pin':
        for (const { path, data } of manifests) {
            for (const field of fields) {
                if (Object.hasOwn(data[field] ?? {}, name))
                    data[field][name] = version;
            }
            writeFileSync(path, JSON.stringify(data, null, 4) + '\n');
        }
        break;
    case 'verify':
        try {
            const { packages } = JSON.parse(
                readFileSync('package-lock.json', 'utf8'),
            );
            const root = `node_modules/${name}`;
            const locations = Object.keys(packages).filter(
                (path) => path === root || path.endsWith(`/${root}`),
            );
            if (!locations.length)
                throw new Error(
                    'REST client snapshot is missing from the install',
                );
            for (const location of locations) {
                const installed = JSON.parse(
                    readFileSync(join(location, 'package.json'), 'utf8'),
                );
                if (installed.version !== version) {
                    throw new Error(
                        `Installed ${location}@${installed.version}. Expected ${version}.`,
                    );
                }
            }
            console.log(`Verified ${name}@${version} across the Web workspace`);
        } finally {
            execFileSync('git', [
                'restore',
                '--worktree',
                '--',
                ...manifests.map(({ path }) => path),
            ]);
        }
        break;
    default:
        throw new Error('Expected pin or verify');
}
