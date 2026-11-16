#!/usr/bin/env node
/**
 * The maintainer lane: record every spec's demo-runtime traffic, and check that
 * the committed recordings are fresh.
 *
 *     npm run record             delete every recordings file and record afresh
 *     npm run check:recordings   the same, then fail if anything differs from Git
 *
 * Specs reach the demo runtime through `test-support/demo-runtime.ts`. In the
 * public lane they replay `__recordings__/*.json`; with `EZCLASSIFY_RECORD=1`
 * each test project's global setup builds and starts a local demo runtime with
 * its draft door (it needs the engine and orchestration checkouts beside this
 * repository and the content checkouts orchestration assembles the demo set
 * from) and the specs record what they send.
 *
 * One live pass is not enough. UI code sends requests whose timing depends on
 * how fast answers arrive, and a replay answers at once. So the suite runs in
 * record mode again and again: every later pass answers what is already
 * recorded at replay speed and sends only what that speed brings out. A pass
 * that leaves every file unchanged sent nothing new; that is the recording. A
 * run that does not settle within the pass limit fails, because a replay of it
 * would not be repeatable.
 *
 * A live pass also sends requests a replay never does, because it answers at
 * live speed. So the run then replays the public lane keeping only the answers
 * it used (`EZCLASSIFY_PRUNE_RECORDINGS=1`): what is committed is exactly what
 * the public lane replays, and it comes out the same however the live passes
 * were timed. It prunes twice. The second replay must use every answer the
 * first kept, and so leave every file as it is; a replay whose requests depend
 * on its own timing would drop an answer there, and fail the public lane on
 * another machine.
 *
 * A run that fails puts back the recordings files it started with, untracked
 * ones included, so a red pass never leaves the tree without its recordings. A
 * check that only finds the recordings stale leaves what it recorded, for
 * review.
 *
 * The check is the freshness check. Recording from nothing against the current
 * engine and content must reproduce the committed files byte for byte, so a
 * changed answer, a new request or a request no spec sends any more all fail.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
    mkdirSync,
    readFileSync,
    readdirSync,
    unlinkSync,
    writeFileSync,
} from 'node:fs';
import * as path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');

/** Where specs, and so recordings, live. */
const SPEC_ROOTS = ['libs', 'integrations', 'tests', 'test-support'];

/** The directory beside a spec that holds its recordings. */
const RECORDINGS_DIR = '__recordings__';

/** Passes before a recording that keeps changing is declared unrepeatable. */
const MAX_PASSES = 4;

const SKIP = new Set(['node_modules', 'dist', '.angular', 'coverage', '.git']);

/** Every recordings file under the spec roots, repository-relative, sorted. */
function recordingFiles() {
    const found = [];
    const walk = (dir) => {
        let entries;
        try {
            entries = readdirSync(dir, { withFileTypes: true });
        } catch {
            return;
        }
        for (const entry of entries) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                if (!SKIP.has(entry.name)) walk(full);
            } else if (
                path.basename(dir) === RECORDINGS_DIR &&
                entry.name.endsWith('.json')
            ) {
                found.push(path.relative(ROOT, full));
            }
        }
    };
    for (const root of SPEC_ROOTS) walk(path.join(ROOT, root));
    return found.sort();
}

/** One digest over every recordings file's name and bytes. */
function digest() {
    const hash = createHash('sha256');
    for (const file of recordingFiles()) {
        hash.update(file)
            .update('\0')
            .update(readFileSync(path.join(ROOT, file)));
    }
    return hash.digest('hex');
}

/** Every recordings file's bytes, by repository-relative path. */
function snapshot() {
    return new Map(
        recordingFiles().map((file) => [
            file,
            readFileSync(path.join(ROOT, file)),
        ]),
    );
}

/** Delete every recordings file. */
function clear() {
    for (const file of recordingFiles()) unlinkSync(path.join(ROOT, file));
}

/** The recordings files the run started with, put back if it fails. */
const started = snapshot();

/** Put back the recordings files the run started with, and exit with `why`. */
function fail(why) {
    clear();
    for (const [file, bytes] of started) {
        mkdirSync(path.dirname(path.join(ROOT, file)), { recursive: true });
        writeFileSync(path.join(ROOT, file), bytes);
    }
    console.error(`${why}\nthe recordings files are as they were`);
    process.exit(1);
}

/** Run every test project once with `env` added; fail when any fails. */
function runSuite(label, env) {
    console.log(`\n=== ${label} ===`);
    const run = spawnSync(process.execPath, ['scripts/run-test-projects.mjs'], {
        cwd: ROOT,
        stdio: 'inherit',
        env: { ...process.env, ...env },
    });
    if (run.status !== 0) {
        fail(`${label} failed; nothing is recorded until every spec passes`);
    }
}

function recordPass(pass) {
    runSuite(`record pass ${pass}`, { EZCLASSIFY_RECORD: '1' });
}

const check = process.argv.includes('--check');

clear();

let previous = digest();
let settled = false;
for (let pass = 1; pass <= MAX_PASSES; pass += 1) {
    recordPass(pass);
    const current = digest();
    if (pass > 1 && current === previous) {
        settled = true;
        break;
    }
    previous = current;
}
if (!settled) {
    fail(
        `the recordings still changed after ${MAX_PASSES} passes, so a replay of them would not be repeatable`,
    );
}
const prune = { EZCLASSIFY_RECORD: '0', EZCLASSIFY_PRUNE_RECORDINGS: '1' };
runSuite('pruning replay', prune);
const pruned = digest();
runSuite('second pruning replay', prune);
if (digest() !== pruned) {
    fail(
        'a second replay did not use every answer the first one kept, so the public lane would not replay the same way twice',
    );
}
console.log(`\nrecorded ${recordingFiles().length} recordings file(s)`);

if (check) {
    const status = spawnSync(
        'git',
        [
            'status',
            '--porcelain',
            '--untracked-files=all',
            '--',
            `:(glob)**/${RECORDINGS_DIR}/**`,
        ],
        { cwd: ROOT, encoding: 'utf8' },
    );
    if (status.status !== 0) {
        console.error(status.stderr);
        process.exit(1);
    }
    if (status.stdout.trim() !== '') {
        console.error(
            'the committed recordings are stale; recording afresh changed:\n' +
                status.stdout +
                'Commit the result of `npm run record`.',
        );
        process.exit(1);
    }
    console.log('the committed recordings are fresh');
}
