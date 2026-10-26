import { existsSync, readdirSync, rmSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)));
const schematics = join(root, 'schematics');

function removeCompiledFiles(directory) {
    if (!existsSync(directory)) return;
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const target = join(directory, entry.name);
        if (entry.isDirectory()) {
            removeCompiledFiles(target);
        } else if (['.js', '.map'].includes(extname(entry.name))) {
            rmSync(target, { force: true });
            console.log(`removed ${target.slice(root.length + 1)}`);
        }
    }
}

removeCompiledFiles(schematics);
