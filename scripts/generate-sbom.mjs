#!/usr/bin/env node
// Generate a CycloneDX SBOM for the EzClassify Web monorepo. The declared
// dependencies live in the publishable workspace manifests, so the component
// list is the union of the root manifest's dependencies and every publishable
// workspace's dependencies, peerDependencies, and devDependencies.
//
// Output: dist/sbom.json (uploaded as a CI artifact, not committed).

import {
    existsSync,
    mkdirSync,
    readdirSync,
    readFileSync,
    writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');

function readJson(file) {
    return JSON.parse(readFileSync(file, 'utf8'));
}

const rootPkg = readJson(path.join(REPO_ROOT, 'package.json'));

// Same discovery rule as verify-pack-consume.mjs: a workspace is publishable
// when its manifest does not carry `private: true`.
const manifests = [rootPkg];
for (const pattern of rootPkg.workspaces ?? []) {
    const dirs = pattern.endsWith('/*')
        ? readdirSync(path.join(REPO_ROOT, pattern.slice(0, -2)), {
              withFileTypes: true,
          })
              .filter((e) => e.isDirectory())
              .map((e) => path.join(pattern.slice(0, -2), e.name))
        : [pattern];
    for (const dir of dirs) {
        const manifestPath = path.join(REPO_ROOT, dir, 'package.json');
        if (!existsSync(manifestPath)) continue;
        const manifest = readJson(manifestPath);
        if (manifest.private === true) continue;
        manifests.push(manifest);
    }
}

const components = new Map();
for (const manifest of manifests) {
    const declared = {
        ...manifest.dependencies,
        ...manifest.peerDependencies,
        ...manifest.devDependencies,
    };
    for (const [name, range] of Object.entries(declared)) {
        const version = range.replace(/^[\^~>=<]+/, '');
        components.set(`${name}@${version}`, {
            type: 'library',
            name,
            version,
            purl: `pkg:npm/${name}@${version}`,
        });
    }
}

const sbom = {
    bomFormat: 'CycloneDX',
    specVersion: '1.5',
    serialNumber: `urn:uuid:${crypto.randomUUID()}`,
    version: 1,
    metadata: {
        timestamp: new Date().toISOString(),
        component: {
            type: 'application',
            name: rootPkg.name,
            version: rootPkg.version,
            description: rootPkg.description,
        },
        tools: [{ name: 'ezclassify-sbom-generator', version: '1.0.0' }],
    },
    components: [...components.keys()].sort().map((key) => components.get(key)),
};

const outPath = path.join(REPO_ROOT, 'dist', 'sbom.json');
mkdirSync(path.dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify(sbom, null, 2));
console.log(
    `SBOM generated: ${path.relative(REPO_ROOT, outPath)} (${sbom.components.length} components)`,
);
