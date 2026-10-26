// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';

/**
 * The security policy is the place a member of the public is sent when they
 * have a vulnerability to report. Every EzClassify destination it names has to
 * be a repository an anonymous visitor can actually open; a link to one they
 * cannot read is a dead end that loses the report. Not every repository in the
 * EzClassify org is publicly readable, so the reachable ones are listed
 * explicitly rather than inferred.
 */
const PUBLICLY_READABLE_REPOS = ['ezclassify', 'web'];

const ROUTING_FILES = ['SECURITY.md'] as const;

const REPO_ROOT = path.resolve(__dirname, '..');

/** Matches a URL up to the first character that cannot appear inside one. */
const URL_PATTERN = /https?:\/\/[^\s)<>\]"'`]+/g;

const ORG_URL_PREFIX = 'https://github.com/ezclassify/';

/**
 * Returns every EzClassify repository named in `text` that is not on the
 * publicly readable list. An empty array means the text routes readers only to
 * places they can open.
 */
export function findUnreachableRepos(text: string): string[] {
    const found = new Set<string>();
    for (const url of text.match(URL_PATTERN) ?? []) {
        if (!url.startsWith(ORG_URL_PREFIX)) continue;
        const repo = url.slice(ORG_URL_PREFIX.length).split(/[/#?]/)[0];
        if (repo && !PUBLICLY_READABLE_REPOS.includes(repo)) found.add(repo);
    }
    return [...found].sort();
}

describe('findUnreachableRepos', () => {
    it('reports an EzClassify repository that is not publicly readable', () => {
        expect(
            findUnreachableRepos(
                'File engine bugs on the [engine repo](https://github.com/ezclassify/some-other-repo).',
            ),
        ).toEqual(['some-other-repo']);
    });

    it('accepts a publicly readable EzClassify repository', () => {
        expect(
            findUnreachableRepos(
                'Track it on the [central tracker](https://github.com/ezclassify/ezclassify/issues).',
            ),
        ).toEqual([]);
    });

    it('ignores links outside the EzClassify organization', () => {
        expect(
            findUnreachableRepos('See https://github.com/some-org/anything.'),
        ).toEqual([]);
    });
});

describe.each(ROUTING_FILES)('%s', (file) => {
    it('sends readers only to repositories they can open', () => {
        const text = readFileSync(path.join(REPO_ROOT, file), 'utf8');
        expect(findUnreachableRepos(text)).toEqual([]);
    });
});
