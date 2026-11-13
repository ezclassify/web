/**
 * The fetch transports: what a recording captures from a live server is what a
 * replay answers, and a replay never answers what nothing recorded.
 */
import * as http from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createRecordingFetch, createReplayFetch } from './fetch-transport';
import { Recorder } from './recorder';
import { RecordingsFileError, validateRecordingsFile } from './contract';
import type { MissEnvelope } from './contract';

/** A server that echoes what it was sent, and counts what reached it. */
let server: http.Server;
let origin: string;
let reached = 0;
/** Holds a request open until the test releases it. */
let release: (() => void) | undefined;

beforeAll(async () => {
    server = http.createServer((request, response) => {
        reached += 1;
        let sent = '';
        request.on('data', (chunk: Buffer) => (sent += chunk.toString()));
        request.on('end', () => {
            const answer = () => {
                if (request.url === '/text') {
                    response.writeHead(200, { 'content-type': 'text/plain' });
                    response.end('not json');
                    return;
                }
                response.writeHead(request.url === '/missing' ? 404 : 200, {
                    'content-type': 'application/json',
                    'x-ezclassify-resolved-version': '1.2.3',
                    'x-unrelated': 'dropped',
                });
                response.end(
                    JSON.stringify({
                        method: request.method,
                        url: request.url,
                        sent: sent ? (JSON.parse(sent) as unknown) : null,
                    }),
                );
            };
            if (request.url === '/slow') release = answer;
            else answer();
        });
    });
    await new Promise<void>((ready) => server.listen(0, '127.0.0.1', ready));
    origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});

afterAll(async () => {
    await new Promise<void>((done) => server.close(() => done()));
});

/** Anywhere but the live server: a replay must not need it. */
const ELSEWHERE = 'http://replay.invalid';

const post = (body: unknown): RequestInit => ({
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
});

describe('record, then replay', () => {
    it('replays the recorded status, body and the headers a client reads', async () => {
        const recorder = new Recorder();
        const live = createRecordingFetch(origin, recorder);
        const recorded = await live(
            `${ELSEWHERE}/v1/thing?at=2`,
            post({ b: 1, a: 2 }),
        );
        const recordedBody = await recorded.json();

        const replay = createReplayFetch(recorder.toFile('test').responses);
        // Key order differs and the origin differs: the same request still.
        const replayed = await replay(
            `${origin}/v1/thing?at=2`,
            post({ a: 2, b: 1 }),
        );
        expect(replayed.status).toBe(200);
        expect(await replayed.json()).toEqual(recordedBody);
        expect(recordedBody).toEqual({
            method: 'POST',
            url: '/v1/thing?at=2',
            sent: { a: 2, b: 1 },
        });
        expect(replayed.headers.get('x-ezclassify-resolved-version')).toBe(
            '1.2.3',
        );
        expect(replayed.headers.get('x-unrelated')).toBeNull();
    });

    it('records an error answer like any other', async () => {
        const recorder = new Recorder();
        await createRecordingFetch(origin, recorder)(`${ELSEWHERE}/missing`);
        const replayed = await createReplayFetch(
            recorder.toFile('test').responses,
        )(`${ELSEWHERE}/missing`);
        expect(replayed.status).toBe(404);
    });

    it('answers a request it already holds without sending it', async () => {
        const recorder = new Recorder();
        const live = createRecordingFetch(origin, recorder);
        await live(`${ELSEWHERE}/held`);
        const before = reached;
        const again = await live(`${ELSEWHERE}/held`);
        expect(reached).toBe(before);
        expect((await again.json()) as { url: string }).toMatchObject({
            url: '/held',
        });
    });

    it('always sends a request that changes what the server holds', async () => {
        const recorder = new Recorder();
        const live = createRecordingFetch(origin, recorder);
        await live(`${ELSEWHERE}/draft`, { method: 'PUT', body: '{}' });
        const before = reached;
        await live(`${ELSEWHERE}/draft`, { method: 'PUT', body: '{}' });
        expect(reached).toBe(before + 1);
    });

    it('starts from an earlier pass and adds to it', async () => {
        const first = new Recorder();
        await createRecordingFetch(origin, first)(`${ELSEWHERE}/one`);
        const second = new Recorder(first.toFile('test').responses);
        await createRecordingFetch(origin, second)(`${ELSEWHERE}/two`);
        expect(Object.keys(second.toFile('test').responses)).toHaveLength(2);
    });

    it('refuses an answer that is not JSON instead of recording it', async () => {
        const recorder = new Recorder();
        await expect(
            createRecordingFetch(origin, recorder)(`${ELSEWHERE}/text`),
        ).rejects.toThrow(/not JSON/);
        expect(recorder.empty).toBe(true);
    });

    it('records a request its caller cancels in flight, then reports the cancel', async () => {
        const recorder = new Recorder();
        const controller = new AbortController();
        const pending = createRecordingFetch(origin, recorder)(
            `${ELSEWHERE}/slow`,
            {
                signal: controller.signal,
            },
        );
        while (!release) await new Promise((r) => setTimeout(r, 5));
        controller.abort();
        release();
        release = undefined;
        await expect(pending).rejects.toThrow();
        expect(recorder.find('/slow', null)).toBeDefined();
    });
});

describe('replay', () => {
    it('rejects a request with no recording and reports it', async () => {
        const misses: Array<MissEnvelope & { method: string }> = [];
        const replay = createReplayFetch({}, (miss) => misses.push(miss));
        await expect(
            replay(`${ELSEWHERE}/v1/none`, post({ x: 1 })),
        ).rejects.toThrow(/no recording found for path=\/v1\/none/);
        expect(misses).toEqual([
            expect.objectContaining({
                method: 'POST',
                path: '/v1/none',
                error: 'no_recording',
            }),
        ]);
    });

    it('rejects a request cancelled before it is sent, without a miss', async () => {
        const misses: unknown[] = [];
        const replay = createReplayFetch({}, (miss) => misses.push(miss));
        const controller = new AbortController();
        controller.abort();
        await expect(
            replay(`${ELSEWHERE}/v1/none`, { signal: controller.signal }),
        ).rejects.toThrow();
        expect(misses).toEqual([]);
    });
});

describe('the recordings contract', () => {
    it('refuses two methods that would share one recording', () => {
        const recorder = new Recorder();
        const once = {
            path: '/v1/x',
            body: null,
            response: {},
            statusCode: 200,
        };
        recorder.record({ ...once, method: 'GET' });
        expect(() => recorder.record({ ...once, method: 'DELETE' })).toThrow(
            /one recording key would answer both/,
        );
    });

    it('accepts what the recorder writes and refuses a malformed file', () => {
        const recorder = new Recorder();
        recorder.record({
            path: '/v1/x',
            body: null,
            response: { ok: true },
            statusCode: 200,
            method: 'GET',
            headers: { 'retry-after': '1' },
        });
        const file = recorder.toFile('1.0.0', '1.0.0');
        expect(
            validateRecordingsFile(JSON.parse(JSON.stringify(file))),
        ).toEqual(file);
        expect(() =>
            validateRecordingsFile({ engineVersion: 1, responses: {} }),
        ).toThrow(RecordingsFileError);
        expect(() =>
            validateRecordingsFile({
                engineVersion: '1',
                responses: {
                    k: { statusCode: 200, body: {}, headers: { a: 1 } },
                },
            }),
        ).toThrow(/headers/);
    });
});
