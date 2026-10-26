/**
 * The README code blocks that are files of a runnable example.
 *
 * Each framework README leads with the document form, and `examples/` holds the
 * same app ready to run. A code block whose first line is a comment naming a
 * file, such as `<!-- index.html -->`, is that file of the example: the lines
 * after the name are its contents, byte for byte. `readme-examples.spec.ts`
 * holds every such block to the file it names, and every source file to a
 * block, so the README and the app cannot drift apart.
 */

/** A file-naming first line: a comment holding only a relative path. */
const FILE_NAME = /^(?:\/\/ (\S+\.\w+)|<!-- (\S+\.\w+) -->)$/;

/**
 * The files a README's code blocks name, with their contents.
 *
 * A fence closes on a line holding only backticks, at least as many as opened
 * it, the way CommonMark reads one. Line endings and trailing blanks on fence
 * lines are ignored.
 *
 * @param {string} markdown README text.
 * @returns {Map<string, string>} Example-relative path to file contents.
 * @throws {Error} If two blocks name the same file, or a fence never closes.
 */
export function readmeFiles(markdown) {
    const files = new Map();
    const lines = markdown.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
        const open = /^(`{3,})/.exec(lines[i]);
        if (!open) continue;
        const fence = open[1];
        let end = i + 1;
        while (
            end < lines.length &&
            !(
                /^`{3,}\s*$/.test(lines[end]) &&
                lines[end].trim().length >= fence.length
            )
        )
            end++;
        if (end === lines.length)
            throw new Error(`the code fence on line ${i + 1} never closes`);
        const named = FILE_NAME.exec((lines[i + 1] ?? '').trimEnd());
        if (named && i + 1 < end) {
            const file = named[1] ?? named[2];
            if (files.has(file))
                throw new Error(`two code blocks name ${file}`);
            files.set(file, `${lines.slice(i + 2, end).join('\n')}\n`);
        }
        i = end;
    }
    return files;
}

/**
 * Where a README and its example disagree.
 *
 * @param {object} input
 * @param {Map<string, string>} input.blocks What {@link readmeFiles} found.
 * @param {Map<string, string>} input.sources Example files, by example-relative
 *   path: every file under `src/` plus any other file a block names.
 * @param {(path: string) => boolean} input.exempt Source files the README does
 *   not have to show, such as toolchain declarations and page styles.
 * @param {string[]} [input.required] Files outside `src/` the README has to
 *   show, such as a page whose markup is the example.
 * @returns {string[]} One line per disagreement; empty when they match.
 */
export function exampleDrift({ blocks, sources, exempt, required = [] }) {
    const problems = [];
    for (const [file, shown] of blocks) {
        const actual = sources.get(file);
        if (actual === undefined) {
            problems.push(`${file}: the README shows it, the example has none`);
            continue;
        }
        if (actual === shown) continue;
        const a = shown.split('\n');
        const b = actual.split('\n');
        const line = a.findIndex((text, index) => text !== b[index]);
        const at = line === -1 ? a.length : line;
        problems.push(
            `${file}:${at + 1}: README has ${JSON.stringify(a[at] ?? '')}, ` +
                `the example has ${JSON.stringify(b[at] ?? '')}`,
        );
    }
    for (const file of sources.keys()) {
        if (!blocks.has(file) && file.startsWith('src/') && !exempt(file))
            problems.push(`${file}: in the example, missing from the README`);
    }
    for (const file of required) {
        if (!blocks.has(file))
            problems.push(`${file}: in the example, missing from the README`);
    }
    return problems;
}

/**
 * The link targets in a README's prose, in order, skipping code blocks.
 *
 * A package README is also the package's page on the registry, where a relative
 * link resolves against the registry and leads nowhere, so the spec holds every
 * target here to an absolute location.
 *
 * @param {string} markdown README text.
 * @returns {string[]} Each inline link's target, as written.
 */
export function readmeLinks(markdown) {
    const targets = [];
    let fence = null;
    for (const line of markdown.split(/\r?\n/)) {
        const open = /^(`{3,})/.exec(line);
        if (fence === null && open) {
            fence = open[1];
            continue;
        }
        if (fence !== null) {
            if (/^`{3,}\s*$/.test(line) && line.trim().length >= fence.length)
                fence = null;
            continue;
        }
        for (const link of line.matchAll(/\]\(([^)\s]+)\)/g))
            targets.push(link[1]);
    }
    return targets;
}
