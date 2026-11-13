#!/usr/bin/env node
/**
 * The maintainer lane: record every spec's demo-runtime traffic, and check that
 * the committed recordings are fresh.
 *
 * Npm run record delete every recordings file and record afresh npm run
 * check:recordings the same, then fail if anything differs from Git
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
 * The check is the freshness check. Recording from nothing against the current
 * engine and content must reproduce the committed files byte for byte, so a
 * changed answer, a new request or a request no spec sends any more all fail.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, unlinkSync } from 'node:fs';
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

function recordPass(pass) {
    console.log(`\n=== record pass ${pass} ===`);
    const run = spawnSync(process.execPath, ['scripts/run-test-projects.mjs'], {
        cwd: ROOT,
        stdio: 'inherit',
        env: { ...process.env, EZCLASSIFY_RECORD: '1' },
    });
    if (run.status !== 0) {
        console.error(
            `record pass ${pass} failed; nothing is recorded until every spec passes`,
        );
        process.exit(1);
    }
}

const check = process.argv.includes('--check');

for (const file of recordingFiles()) unlinkSync(path.join(ROOT, file));

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
    console.error(
        `the recordings still changed after ${MAX_PASSES} passes, so a replay of them would not be repeatable`,
    );
    process.exit(1);
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
