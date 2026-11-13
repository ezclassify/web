/**
 * The public lane's guarantees: a spec with no recordings fails, a request with
 * no recording fails its spec file even when the code under test swallowed the
 * rejection, and a refused draft reaches the spec as a
 * {@link DraftRefusedError}.
 *
 * Each case runs as a spec file of its own: it points the harness at a spec
 * path in a temporary directory, writes that path's recordings, and closes them
 * itself, so the harness's own `afterAll` finds nothing left of it to close.
 * These are the replay lane's rules; a recording run exercises the other lane
 * on every spec instead.
 */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { computeRecordingKey } from '../libs/ui-tools/src/record-replay';
import {
    DraftRefusedError,
    RECORDINGS_DIR,
    closeSpecRecordings,
    connectDemoContext,
    demoRuntimeFetch,
    recording,
    recordingsFileFor,
    sendDraft,
} from './demo-runtime';

/** Closing writes nothing in these cases, so no formatting is needed. */
const asIs = async (json: string) => json;

describe.runIf(!recording)(
    'the demo runtime harness in the public lane',
    () => {
        let dir: string;
        let ownPath: string | undefined;

        /** Run the rest of the case as the spec file `name` in the temp dir. */
        function actAs(
            name: string,
            responses?: Record<string, unknown>,
        ): string {
            const spec = path.join(dir, name);
            if (responses) {
                const file = recordingsFileFor(spec);
                mkdirSync(path.dirname(file), { recursive: true });
                writeFileSync(
                    file,
                    JSON.stringify({ engineVersion: 'test', responses }),
                );
            }
            expect.setState({ testPath: spec });
            return spec;
        }

        beforeEach(() => {
            dir = mkdtempSync(path.join(tmpdir(), 'demo-runtime-spec-'));
            ownPath = expect.getState().testPath;
        });

        afterEach(() => {
            expect.setState({ testPath: ownPath });
            rmSync(dir, { recursive: true, force: true });
        });

        it('fails a spec file that has no recordings, naming where they belong', async () => {
            actAs('unrecorded.spec.ts');
            await expect(
                connectDemoContext({ contextId: 'cedar-valley' }),
            ).rejects.toThrow(
                new RegExp(
                    `unrecorded\\.spec\\.ts has no recordings at .*${RECORDINGS_DIR}`,
                ),
            );
            // Nothing was opened, so there is nothing to close.
            await expect(closeSpecRecordings(asIs)).resolves.toBeUndefined();
        });

        it('fails the spec file for a request the code under test caught', async () => {
            actAs('caught.spec.ts', {});
            const answer = await demoRuntimeFetch()(
                'http://demo-runtime.invalid/v1/health',
            ).catch((error: unknown) => error);
            // The code under test sees a failed request and may carry on.
            expect(answer).toBeInstanceOf(Error);
            // The file still fails when it closes, with the request named.
            await expect(closeSpecRecordings(asIs)).rejects.toThrow(
                /1 request\(s\) had no recording in .*caught\.spec\.ts\.json[\s\S]*GET .*\/v1\/health/,
            );
        });

        it('closes a spec file whose every request was recorded', async () => {
            actAs('recorded.spec.ts', {
                [computeRecordingKey('/v1/health', null)]: {
                    method: 'GET',
                    statusCode: 200,
                    body: { status: 'ok' },
                },
            });
            const response = await demoRuntimeFetch()(
                'http://demo-runtime.invalid/v1/health',
            );
            expect(await response.json()).toEqual({ status: 'ok' });
            await expect(closeSpecRecordings(asIs)).resolves.toBeUndefined();
        });

        it('hands a refused draft to the spec with the status and body the door answered', async () => {
            const draft = { scheme: { scheme: { id: 'broken' } } };
            const refusal = {
                code: 'INVALID_INPUT',
                error: 'the draft does not compose',
                diagnostics: [{ path: '/scheme/name', message: 'required' }],
            };
            actAs('refused.spec.ts', {
                [computeRecordingKey('/v1/sandbox/ctx', draft)]: {
                    method: 'PUT',
                    statusCode: 422,
                    body: refusal,
                },
            });
            const refused = await sendDraft(draft).catch(
                (error: unknown) => error,
            );
            expect(refused).toBeInstanceOf(DraftRefusedError);
            expect(refused).toMatchObject({ status: 422, body: refusal });
            await expect(closeSpecRecordings(asIs)).resolves.toBeUndefined();
        });
    },
);
