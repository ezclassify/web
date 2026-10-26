/**
 * The em dash is out of the product's written voice, and a component library
 * writes prose: tooltips, accessible names, empty-state placeholders. The
 * unicode escape counts too, because it is the form a reviewer reading for the
 * character misses.
 *
 * Source only. A spec may quote one to prove it is gone, and the published
 * stylesheet's box-drawing section banners are not em dashes.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const REPO = dirname(dirname(fileURLToPath(import.meta.url)));
const ROOTS = ['libs/ui/src', 'integrations'];
const SOURCE = /\.(ts|tsx|css|html)$/;
const SKIP_DIRS = new Set(['node_modules', 'dist', 'test-results', '.angular']);

function sourceFiles(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
        if (SKIP_DIRS.has(entry)) continue;
        const path = join(dir, entry);
        if (statSync(path).isDirectory()) sourceFiles(path, out);
        else if (SOURCE.test(entry) && !entry.includes('.spec.'))
            out.push(path);
    }
    return out;
}

describe('written voice', () => {
    it('ships no em dash, literal or escaped, in library source', () => {
        const offenders: string[] = [];
        for (const root of ROOTS) {
            for (const path of sourceFiles(join(REPO, root))) {
                const text = readFileSync(path, 'utf8');
                text.split('\n').forEach((line, index) => {
                    if (line.includes('—') || line.includes('\\u2014')) {
                        offenders.push(
                            `${relative(REPO, path)}:${index + 1}: ${line.trim()}`,
                        );
                    }
                });
            }
        }
        expect(offenders).toEqual([]);
    });
});
