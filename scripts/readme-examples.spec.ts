// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import * as path from 'node:path';
// @ts-expect-error - plain .mjs helper module, no type declarations
import {
    exampleDrift,
    readmeFiles,
    readmeLinks,
} from './readme-examples-lib.mjs';

/**
 * Each README's document form is its example app, file for file. A change to
 * either one fails here until the other follows.
 */
const ROOT = path.resolve(__dirname, '..');
const PAIRS = [
    // The vanilla example's markup is its page, so the README shows the page.
    {
        readme: 'libs/ui/README.md',
        example: 'examples/vanilla-example',
        required: ['index.html'],
    },
    {
        readme: 'integrations/react/README.md',
        example: 'examples/react-example',
    },
    { readme: 'integrations/vue/README.md', example: 'examples/vue-example' },
    {
        readme: 'integrations/angular/README.md',
        example: 'examples/angular-example',
    },
];

/**
 * What the READMEs leave to the example: Vite's type declarations, the Angular
 * page shell (its README names the one element it holds) and page layout.
 */
const exempt = (file: string) =>
    file === 'src/vite-env.d.ts' ||
    file === 'src/index.html' ||
    file.endsWith('.css');

/** Every file under `dir`, as paths relative to `root`. */
function walk(root: string, dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(path.join(root, dir), {
        withFileTypes: true,
    })) {
        const relative = path.posix.join(dir, entry.name);
        if (entry.isDirectory()) walk(root, relative, out);
        else out.push(relative);
    }
    return out;
}

/** The example's source files, plus any other file the README names. */
function exampleSources(
    example: string,
    blocks: Map<string, string>,
): Map<string, string> {
    const root = path.join(ROOT, example);
    const files = new Set([...walk(root, 'src'), ...blocks.keys()]);
    const sources = new Map<string, string>();
    for (const file of files) {
        const absolute = path.join(root, file);
        if (existsSync(absolute))
            sources.set(file, readFileSync(absolute, 'utf8'));
    }
    return sources;
}

describe.each(PAIRS)('$readme', ({ readme, example, required }) => {
    const blocks: Map<string, string> = readmeFiles(
        readFileSync(path.join(ROOT, readme), 'utf8'),
    );

    it(`shows the files of ${example}`, () => {
        // A README whose blocks stopped naming files would compare nothing.
        expect(blocks.size).toBeGreaterThanOrEqual(2);
        expect(blocks.has('src/main.ts') || blocks.has('src/main.tsx')).toBe(
            true,
        );
    });

    it('links to absolute locations, since the registry shows it too', () => {
        const links: string[] = readmeLinks(
            readFileSync(path.join(ROOT, readme), 'utf8'),
        );
        expect(links.length).toBeGreaterThan(0);
        expect(
            links.filter((link) => !/^(?:https?:|mailto:|#)/.test(link)),
        ).toEqual([]);
        // A link into this repository names a path that exists here.
        const missing = links.flatMap((link) => {
            const own =
                /^https:\/\/github\.com\/ezclassify\/web\/(blob|tree)\/main\/([^#]+)/.exec(
                    link,
                );
            if (!own) return [];
            const target = path.join(ROOT, own[2]!);
            const kind = own[1] === 'tree' ? 'directory' : 'file';
            const found =
                existsSync(target) &&
                statSync(target).isDirectory() === (kind === 'directory');
            return found ? [] : [`${link} (no such ${kind})`];
        });
        expect(missing).toEqual([]);
    });

    it(`matches ${example} exactly`, () => {
        expect(
            exampleDrift({
                blocks,
                sources: exampleSources(example, blocks),
                exempt,
                required,
            }),
        ).toEqual([]);
    });
});

describe('readme example drift', () => {
    const readme = [
        'Intro.',
        '',
        '```ts',
        '// src/main.ts',
        "const url = 'http://127.0.0.1:4010';",
        '```',
        '',
        '```bash',
        'npm install',
        '```',
    ].join('\n');
    const sources = new Map([
        ['src/main.ts', "const url = 'http://127.0.0.1:4010';\n"],
    ]);
    const none = () => false;

    it('reads named blocks only', () => {
        expect([...readmeFiles(readme).keys()]).toEqual(['src/main.ts']);
    });

    it('passes a README that shows the file as it is', () => {
        expect(
            exampleDrift({
                blocks: readmeFiles(readme),
                sources,
                exempt: none,
            }),
        ).toEqual([]);
    });

    it('names the line where a README block drifts from its file', () => {
        const drifted = readme.replace('4010', '4011');
        expect(
            exampleDrift({
                blocks: readmeFiles(drifted),
                sources,
                exempt: none,
            }),
        ).toEqual([
            `src/main.ts:1: README has "const url = 'http://127.0.0.1:4011';", the example has "const url = 'http://127.0.0.1:4010';"`,
        ]);
    });

    it('fails a source file the README does not show', () => {
        const extra = new Map(sources).set('src/extra.ts', 'export {};\n');
        expect(
            exampleDrift({
                blocks: readmeFiles(readme),
                sources: extra,
                exempt: none,
            }),
        ).toEqual(['src/extra.ts: in the example, missing from the README']);
    });

    it('fails a block naming a file the example does not have', () => {
        expect(
            exampleDrift({
                blocks: readmeFiles(readme),
                sources: new Map(),
                exempt: none,
            }),
        ).toEqual(['src/main.ts: the README shows it, the example has none']);
    });

    it('fails a required page the README stopped showing', () => {
        expect(
            exampleDrift({
                blocks: readmeFiles(readme),
                sources,
                exempt: none,
                required: ['index.html'],
            }),
        ).toEqual(['index.html: in the example, missing from the README']);
    });

    it('reads a fence the CommonMark way', () => {
        const longer = readme
            .replace('```ts', '````ts')
            .replace("4010';\n```", "4010';\n```` ")
            .replaceAll('\n', '\r\n');
        expect(readmeFiles(longer).get('src/main.ts')).toBe(
            "const url = 'http://127.0.0.1:4010';\n",
        );
    });

    it('refuses a fence that never closes', () => {
        expect(() =>
            readmeFiles('```ts\n// src/main.ts\nconst a = 1;\n'),
        ).toThrow('the code fence on line 1 never closes');
    });

    it('refuses two blocks naming one file', () => {
        expect(() => readmeFiles(`${readme}\n${readme}`)).toThrow(
            'two code blocks name src/main.ts',
        );
    });
});
