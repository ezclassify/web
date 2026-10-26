// @vitest-environment node
import { afterAll, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
    mkdtempSync,
    mkdirSync,
    rmSync,
    writeFileSync,
    readFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';

/**
 * Verify the vendored contract's source identity, package versions, and content
 * hashes. The protected mirror and its provenance table must agree with the
 * canonical Contracts source while permitting ordinary native re-vendoring.
 */
const ROOT = path.resolve(__dirname, '..');

/**
 * Read a repository file as text.
 *
 * @param relativePath - Path relative to the repository root.
 * @returns File contents.
 */
function read(relativePath: string): string {
    return readFileSync(path.join(ROOT, relativePath), 'utf8');
}

interface VendorManifest {
    openapiVersion?: string;
    openapiSha256?: string;
    specBundleSha256?: string;
    specDigest?: string;
    contractsSha?: string;
    sourcePackages?: Record<string, string>;
    [key: string]: unknown;
}

const manifest = JSON.parse(
    read('vendor/spec/MANIFEST.json'),
) as VendorManifest;
const specMarkdown = read('vendor/SPEC.md');

const SHA1_HEX = /^[0-9a-f]{40}$/;
const SHA256_HEX = /^[0-9a-f]{64}$/;

describe('vendored spec provenance', () => {
    it('names contracts as the source commit', () => {
        expect(manifest.contractsSha).toMatch(SHA1_HEX);
    });

    it('names the contracts packages the bundle was built from', () => {
        const packages = manifest.sourcePackages;
        expect(packages, 'sourcePackages block').toBeTypeOf('object');
        const names = Object.keys(packages ?? {});
        expect(names.length).toBeGreaterThan(0);
        for (const name of names) {
            expect(name, 'source package name').toMatch(/^@ezclassify\//);
            expect(packages?.[name], `${name} version`).toMatch(/^\d+\.\d+\./);
        }
    });

    it('records content hashes that are actually hashes', () => {
        expect(manifest.openapiSha256).toMatch(SHA256_HEX);
        expect(manifest.specBundleSha256).toMatch(SHA256_HEX);
        expect(manifest.specDigest).toMatch(SHA256_HEX);
    });

    it('records the hash of the openapi.yaml that is actually committed', () => {
        // CI does this with sha256sum in a step that has never run on a
        // billed-out runner. Doing it here makes it local evidence too.
        const actual = createHash('sha256')
            .update(readFileSync(path.join(ROOT, 'vendor/spec/openapi.yaml')))
            .digest('hex');
        expect(manifest.openapiSha256).toBe(actual);
    });

    it('records the openapi version the committed spec declares', () => {
        const raw = read('vendor/spec/openapi.yaml');
        const declared = raw.match(/^ {2}version:\s+(\S+)/m)?.[1];
        expect(declared, 'info.version in openapi.yaml').toBeDefined();
        expect(manifest.openapiVersion).toBe(declared);
    });
});

describe('vendored SPEC.md provenance table', () => {
    /**
     * Pull a value out of the two-column provenance table in SPEC.md.
     *
     * @param field - The row label, without the surrounding backticks.
     * @returns The row's value cell, trimmed of whitespace and backticks.
     */
    function provenanceRow(field: string): string | undefined {
        const escaped = field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const match = specMarkdown.match(
            new RegExp(`^\\|\\s*\`${escaped}\`\\s*\\|([^|]*)\\|`, 'm'),
        );
        return match?.[1].replace(/`/g, '').trim();
    }

    it('has a contracts@ row', () => {
        expect(provenanceRow('contracts@')).toMatch(SHA1_HEX);
    });

    it('agrees with MANIFEST.json about the source commit', () => {
        // Two files, one fact. They are written in the same pass, so a
        // disagreement means the writer half-applied a change.
        expect(provenanceRow('contracts@')).toBe(manifest.contractsSha);
    });

    it('points specSourceUrl at the contracts repo at that commit', () => {
        const url = provenanceRow('specSourceUrl');
        expect(url).toContain('github.com/ezclassify/contracts');
        expect(url).toContain(manifest.contractsSha);
    });
});

describe('vendor-readonly gate wiring', () => {
    const workflow = read('.github/workflows/vendor-readonly.yml');

    it('fires on push, not only on pull_request', () => {
        // Spec commits can land by direct push as well as through a pull
        // request, so both triggers are required.
        expect(workflow).toMatch(/^ {2}pull_request:$/m);
        expect(workflow).toMatch(/^ {2}push:$/m);
    });

    it('watches the same paths on both triggers', () => {
        const blocks = workflow.match(/^ {4}paths:\n(?: {6}(?:#.*|- .*)\n)+/gm);
        expect(blocks?.length, 'paths blocks').toBe(2);
        const globsOf = (block: string): string[] =>
            block
                .split('\n')
                .map((line) => line.trim())
                .filter((line) => line.startsWith('- '))
                .map((line) => line.slice(2).replace(/'/g, ''));
        expect(globsOf(blocks![0])).toEqual(globsOf(blocks![1]));
    });

    it('names the spec bot and contracts as the writer and source', () => {
        expect(workflow).toContain('ezclassify-spec-bot');
        expect(workflow).toContain('ezclassify/contracts');
        expect(workflow).toContain(
            'ALLOWED_BOT_CANONICAL_EMAIL: 348097708+ezclassify-spec-bot[bot]@users.noreply.github.com',
        );
    });

    it('falls back with --is-ancestor rather than a string comparison', () => {
        // `origin/<default> != HEAD` is true even when HEAD is an ancestor of
        // origin/<default>, and `origin/<default>..HEAD` is EMPTY in that
        // case. An inequality would hand the gate an empty commit set and it
        // would pass having read nothing.
        // Assert the specific guard, not the mere presence of the phrase.
        // `--is-ancestor` appears twice in this workflow; only this one stops
        // the fallback range resolving empty.
        expect(workflow).toContain(
            '! git merge-base --is-ancestor "$HEAD_SHA" "$FALLBACK"',
        );
    });

    it('reads the single-commit fallback with diff-tree, not a walking log', () => {
        // `git log -1 <sha> -- vendor/...` WALKS to the nearest ancestor that
        // touched those paths, so on a HEAD that touches nothing it reports a
        // commit that was never in the push.
        expect(workflow).toContain('git diff-tree --no-commit-id --name-only');
        expect(workflow).not.toMatch(
            /git log -1 "\$HEAD_SHA".*\n?.*-- 'vendor/,
        );
    });

    it('is not disarmed by continue-on-error or an always() condition', () => {
        expect(workflow).not.toContain('continue-on-error');
        expect(workflow).not.toContain('if: always()');
    });
});

/**
 * Execute the workflow gate's literal run body against synthetic Git history.
 * Text-presence assertions alone do not establish that a conditional guard
 * executes. Each scenario checks its actual exit status.
 *
 * Synthetic history keeps the cases independent of CI's shallow checkout and of
 * this repository's changing commit IDs.
 */
describe('vendor-readonly gate, executed', () => {
    const BOT_NAME = 'ezclassify-spec-bot[bot]';
    const BOT_EMAIL = 'ezclassify-spec-bot[bot]@users.noreply.github.com';
    const CANONICAL_BOT_EMAIL =
        '348097708+ezclassify-spec-bot[bot]@users.noreply.github.com';
    // A stand-in maintainer. The gate reads the author pair and the PR login
    // as opaque strings and only ever compares them against the bot identity,
    // so any name that is not the bot's exercises the human path.
    const HUMAN_NAME = 'Dana Maintainer';
    const HUMAN_EMAIL = 'dana@maintainer.example';
    const HUMAN_LOGIN = 'dana-maintainer';
    const workflowText = read('.github/workflows/vendor-readonly.yml');
    const tempRoots: string[] = [];

    afterAll(() => {
        for (const dir of tempRoots) {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    /**
     * Pull one step's literal `run:` block scalar out of the workflow.
     *
     * Deliberately dependency-free: js-yaml is only present here as a
     * transitive package, and importing one this repository does not declare
     * would trade a gate defect for a dependency defect. The parse is narrow
     * and every failure throws, so a workflow restructure that breaks it cannot
     * silently yield an empty body that "passes" the run.
     *
     * @param stepName - Leading text of the step's `name:` value.
     * @returns The dedented shell body of that step's `run:`.
     */
    function extractRunBody(stepName: string): string {
        const lines = workflowText.split('\n');
        const start = lines.findIndex((line) =>
            new RegExp(
                `^\\s*- name: ${stepName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`,
            ).test(line),
        );
        if (start === -1) {
            throw new Error(`step not found: ${stepName}`);
        }

        let runIndent = -1;
        let bodyStart = -1;
        for (let i = start + 1; i < lines.length; i += 1) {
            if (/^\s*- name: /.test(lines[i])) {
                break; // next step, this one had no run body
            }
            const match = lines[i].match(/^(\s*)run: \|\s*$/);
            if (match) {
                runIndent = match[1].length;
                bodyStart = i + 1;
                break;
            }
        }
        if (bodyStart === -1) {
            throw new Error(`no 'run: |' body for step: ${stepName}`);
        }

        const body: string[] = [];
        for (let i = bodyStart; i < lines.length; i += 1) {
            const line = lines[i];
            if (line.trim() === '') {
                body.push('');
                continue;
            }
            const indent = line.length - line.trimStart().length;
            if (indent <= runIndent) {
                break;
            }
            body.push(line);
        }
        while (body.length > 0 && body[body.length - 1] === '') {
            body.pop();
        }

        const dedent = Math.min(
            ...body
                .filter((line) => line !== '')
                .map((line) => line.length - line.trimStart().length),
        );
        const text = body.map((line) => line.slice(dedent)).join('\n');

        // The body must take its GitHub context through `env:` only. An
        // inlined `${{ }}` would evaluate to empty under this harness, and a
        // forged-identity case could then "refuse" for the wrong reason.
        const inlined = text.match(/\$\{\{[^}]*\}\}/g);
        if (inlined) {
            throw new Error(`run body inlines GH expressions: ${inlined}`);
        }
        return text;
    }

    const enforceBody = extractRunBody('Enforce bot identity');

    it('extracts a plausible enforcement body', () => {
        // Guards the extractor itself. An empty or truncated body would exit 0
        // and quietly turn every refusal case below into a false pass.
        expect(enforceBody.length).toBeGreaterThan(500);
        expect(enforceBody).toContain('Identity gate');
        expect(enforceBody).toContain('VENDOR_COMMITS');
    });

    /**
     * Run a git command in a repository.
     *
     * @param cwd - Repository directory.
     * @param args - Arguments passed to git.
     * @param env - Extra environment variables.
     * @returns Trimmed stdout.
     */
    function git(
        cwd: string,
        args: string[],
        env: Record<string, string> = {},
    ): string {
        return execFileSync('git', args, {
            cwd,
            encoding: 'utf8',
            env: { ...process.env, ...env },
        }).trim();
    }

    /**
     * Create a repository whose tip is one vendor/-touching commit.
     *
     * @param author - Author name recorded on the tip commit.
     * @param email - Author email recorded on the tip commit.
     * @param subject - Commit subject of the tip commit.
     * @returns The repository path plus the base and head SHAs.
     */
    function repoWithVendorCommit(
        author: string,
        email: string,
        subject: string,
    ): { dir: string; base: string; head: string } {
        const dir = mkdtempSync(path.join(tmpdir(), 'ezc-vendor-gate-'));
        tempRoots.push(dir);
        git(dir, ['init', '-q', '-b', 'main', '.']);
        git(dir, ['config', 'commit.gpgsign', 'false']);

        mkdirSync(path.join(dir, 'vendor', 'spec'), { recursive: true });
        writeFileSync(path.join(dir, 'README.md'), 'base\n');
        git(dir, ['add', '-A']);
        const ident = {
            GIT_AUTHOR_NAME: BOT_NAME,
            GIT_AUTHOR_EMAIL: BOT_EMAIL,
            GIT_COMMITTER_NAME: BOT_NAME,
            GIT_COMMITTER_EMAIL: BOT_EMAIL,
        };
        git(dir, ['commit', '-q', '-m', 'chore: base'], ident);
        const base = git(dir, ['rev-parse', 'HEAD']);

        writeFileSync(
            path.join(dir, 'vendor', 'spec', 'MANIFEST.json'),
            '{"contractsSha":"0000"}\n',
        );
        git(dir, ['add', '-A']);
        git(dir, ['commit', '-q', '-m', subject], {
            GIT_AUTHOR_NAME: author,
            GIT_AUTHOR_EMAIL: email,
            GIT_COMMITTER_NAME: author,
            GIT_COMMITTER_EMAIL: email,
        });
        return { dir, base, head: git(dir, ['rev-parse', 'HEAD']) };
    }

    /**
     * Execute the extracted enforcement body against a repository.
     *
     * @param dir - Repository to run in.
     * @param env - Step environment (the same keys the workflow declares).
     * @returns Exit status and combined output.
     */
    function runGate(
        dir: string,
        env: Record<string, string>,
    ): { status: number; output: string } {
        const script = path.join(dir, 'enforce.sh');
        writeFileSync(script, enforceBody);
        try {
            const output = execFileSync('bash', [script], {
                cwd: dir,
                encoding: 'utf8',
                stdio: ['ignore', 'pipe', 'pipe'],
                env: {
                    ...process.env,
                    ALLOWED_BOT_LOGIN: BOT_NAME,
                    ALLOWED_BOT_EMAIL: BOT_EMAIL,
                    ALLOWED_BOT_CANONICAL_EMAIL: CANONICAL_BOT_EMAIL,
                    OVERRIDE_LABEL: 'spec-mirror-override',
                    PR_AUTHOR: '',
                    PR_LABELS: '',
                    ...env,
                },
            });
            return { status: 0, output };
        } catch (error) {
            const err = error as {
                status?: number;
                stdout?: string;
                stderr?: string;
            };
            return {
                status: err.status ?? -1,
                output: `${err.stdout ?? ''}${err.stderr ?? ''}`,
            };
        }
    }

    /**
     * Build the range-mode env the enforcement step consumes.
     *
     * @param fixture - Repository and SHAs from repoWithVendorCommit.
     * @returns Env fragment describing the resolved commit range.
     */
    function range(fixture: { base: string; head: string }): {
        RANGE_MODE: string;
        BASE_SHA: string;
        HEAD_SHA: string;
    } {
        return {
            RANGE_MODE: 'range',
            BASE_SHA: fixture.base,
            HEAD_SHA: fixture.head,
        };
    }

    it.each([
        [BOT_NAME, CANONICAL_BOT_EMAIL, 0],
        [BOT_NAME, `348097709+${BOT_EMAIL}`, 1],
        [BOT_NAME, '348097708+other-bot[bot]@users.noreply.github.com', 1],
        ['Other Bot', CANONICAL_BOT_EMAIL, 1],
    ])('checks GitHub squash identity %s <%s>', (name, email, expected) => {
        const fixture = repoWithVendorCommit(
            String(name),
            String(email),
            'chore(spec): vendor contracts@deadbeef (#9)',
        );
        const result = runGate(fixture.dir, {
            EVENT_NAME: 'push',
            ...range(fixture),
        });
        expect(result.status, result.output).toBe(expected);
    });

    it('refuses a forged author email even though the name reads as the bot', () => {
        // The original blocker. `%an` is a claim, not an identity.
        const fixture = repoWithVendorCommit(
            BOT_NAME,
            'mallory@evil.example',
            'chore(spec): vendor spec bundle from contracts@deadbeef',
        );
        const result = runGate(fixture.dir, {
            EVENT_NAME: 'push',
            ...range(fixture),
        });
        expect(result.status).toBe(1);
        expect(result.output).toContain('not authored by the spec bot');
    });

    it('admits a genuine bot commit on the push path', () => {
        const fixture = repoWithVendorCommit(
            BOT_NAME,
            BOT_EMAIL,
            'chore(spec): vendor spec bundle from contracts@deadbeef',
        );
        const result = runGate(fixture.dir, {
            EVENT_NAME: 'push',
            ...range(fixture),
        });
        expect(result.status).toBe(0);
        expect(result.output).toContain('Identity gate: all vendor/ commits');
    });

    it('refuses a human-authored commit riding in on a bot-opened PR', () => {
        // The second blocker: the PR path trusted the PR opener and never
        // looked at the authors of the commits the PR carried. Note the
        // subject is a valid `chore(spec):`, so the subject gate passes and
        // only the per-commit identity layer can catch this.
        const fixture = repoWithVendorCommit(
            'Mallory',
            'mallory@evil.example',
            'chore(spec): vendor spec bundle from contracts@deadbeef',
        );
        const result = runGate(fixture.dir, {
            EVENT_NAME: 'pull_request',
            PR_AUTHOR: BOT_NAME,
            ...range(fixture),
        });
        expect(result.status).toBe(1);
        expect(result.output).toContain('not authored by the spec bot');
    });

    it('admits a genuine bot commit on a bot-opened PR', () => {
        const fixture = repoWithVendorCommit(
            BOT_NAME,
            BOT_EMAIL,
            'chore(spec): vendor spec bundle from contracts@deadbeef',
        );
        const result = runGate(fixture.dir, {
            EVENT_NAME: 'pull_request',
            PR_AUTHOR: BOT_NAME,
            ...range(fixture),
        });
        expect(result.status).toBe(0);
        expect(result.output).toContain('PR authored by');
    });

    it('still refuses a PR opened by anyone but the bot', () => {
        const fixture = repoWithVendorCommit(
            BOT_NAME,
            BOT_EMAIL,
            'chore(spec): vendor spec bundle from contracts@deadbeef',
        );
        const result = runGate(fixture.dir, {
            EVENT_NAME: 'pull_request',
            PR_AUTHOR: 'mallory',
            ...range(fixture),
        });
        expect(result.status).toBe(1);
        expect(result.output).toContain('is authored by');
    });

    it('lets the override label through on a PR, so the label is not inert', () => {
        const fixture = repoWithVendorCommit(
            HUMAN_NAME,
            HUMAN_EMAIL,
            'chore(spec): replace the vendored bundle by hand',
        );
        const result = runGate(fixture.dir, {
            EVENT_NAME: 'pull_request',
            PR_AUTHOR: HUMAN_LOGIN,
            PR_LABELS: 'spec-mirror-override',
            ...range(fixture),
        });
        expect(result.status).toBe(0);
        expect(result.output).toContain('pull request only');
    });

    it('does not honor the override label on the push path', () => {
        // A label is a pull_request concept. The step tests EVENT_NAME rather
        // than trusting that PR_LABELS happens to be empty on a push, so that
        // adding a trigger later cannot turn a label into a way to push
        // straight into vendor/.
        const fixture = repoWithVendorCommit(
            'Mallory',
            'mallory@evil.example',
            'chore(spec): vendor spec bundle from contracts@deadbeef',
        );
        const result = runGate(fixture.dir, {
            EVENT_NAME: 'push',
            PR_LABELS: 'spec-mirror-override',
            ...range(fixture),
        });
        expect(result.status).toBe(1);
        expect(result.output).toContain('not authored by the spec bot');
    });

    it('refuses a bot-authored commit whose subject is not chore(spec)', () => {
        const fixture = repoWithVendorCommit(
            BOT_NAME,
            BOT_EMAIL,
            'feat: smuggle code through the spec channel',
        );
        const result = runGate(fixture.dir, {
            EVENT_NAME: 'push',
            ...range(fixture),
        });
        expect(result.status).toBe(1);
        expect(result.output).toContain('disallowed subject');
    });

    it('refuses rather than passing when it could inspect no commits', () => {
        // `single` mode means the pushed range could not be resolved. If the
        // head commit does not itself touch vendor/, the gate has read
        // nothing, and exiting 0 there would be the inert control in its
        // purest form: a green check that inspected no commits at all.
        const fixture = repoWithVendorCommit(
            BOT_NAME,
            BOT_EMAIL,
            'chore(spec): vendor spec bundle from contracts@deadbeef',
        );
        const quietHead = (() => {
            writeFileSync(path.join(fixture.dir, 'README.md'), 'touched\n');
            git(fixture.dir, ['add', '-A']);
            git(fixture.dir, ['commit', '-q', '-m', 'chore: unrelated'], {
                GIT_AUTHOR_NAME: BOT_NAME,
                GIT_AUTHOR_EMAIL: BOT_EMAIL,
                GIT_COMMITTER_NAME: BOT_NAME,
                GIT_COMMITTER_EMAIL: BOT_EMAIL,
            });
            return git(fixture.dir, ['rev-parse', 'HEAD']);
        })();

        const result = runGate(fixture.dir, {
            EVENT_NAME: 'push',
            RANGE_MODE: 'single',
            BASE_SHA: '',
            HEAD_SHA: quietHead,
        });
        expect(result.status).toBe(1);
        expect(result.output).toContain('Refusing to pass');
    });
});
