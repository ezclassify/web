// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
// @ts-expect-error - plain .mjs module, no type declarations
import { EXAMPLES, HOSTS, browserLane } from '../e2e/lanes.mjs';
// @ts-expect-error - plain .mjs module, no type declarations
import { deploymentStatus, sessionPayload } from '../e2e/hosts/backend.mjs';

const ROOTS = { e2e: '/repo/e2e', repository: '/repo' };

describe('browser lanes', () => {
    it('defaults to the four README examples against Cedar Valley', () => {
        const lane = browserLane({}, ROOTS);
        expect(lane).toEqual(
            browserLane({ EZ_INTEGRATION_SCENARIO: 'cedar-valley' }, ROOTS),
        );
        expect(lane.testMatch).toBe('examples/document-form.spec.ts');
        expect(lane.projects.map((p: { name: string }) => p.name)).toEqual([
            'vanilla-example',
            'react-example',
            'vue-example',
            'angular-example',
        ]);
    });

    it('starts each example beside its own replay server, allowing only its origin', () => {
        const servers = browserLane({}, ROOTS).webServer;
        expect(servers).toHaveLength(EXAMPLES.length * 2);
        for (const example of EXAMPLES) {
            const replay = servers.find((s: { command: string }) =>
                s.command.includes(`--port ${example.serverPort} `),
            );
            expect(replay.command).toBe(
                `npx @ezclassify/conformance-server --scenario cedar-valley --port ${example.serverPort} --cors-origin http://localhost:${example.appPort}`,
            );
            const app = servers.find(
                (s: { cwd: string }) =>
                    s.cwd === `/repo/examples/${example.name}`,
            );
            expect(app.url).toBe(`http://localhost:${example.appPort}`);
            // The Vite examples read the setting; Angular uses the default.
            expect(app.env?.VITE_EZCLASSIFY_URL).toBe(
                example.urlVariable
                    ? `http://127.0.0.1:${example.serverPort}`
                    : undefined,
            );
        }
        expect(
            EXAMPLES.find((e: { name: string }) => e.name === 'angular-example')
                .serverPort,
        ).toBe(4010);
    });

    it('runs the hosts against the golden corpus when it is named', () => {
        const lane = browserLane(
            { EZ_INTEGRATION_SCENARIO: 'golden-corpus' },
            ROOTS,
        );
        expect(lane.testMatch).toBe('hosts/golden-corpus.spec.ts');
        expect(lane.projects.map((p: { name: string }) => p.name)).toEqual(
            HOSTS.map((h: { name: string }) => h.name),
        );
        expect(lane.webServer).toHaveLength(HOSTS.length);
    });

    it('runs the licensed suite against the hosts for a status file', () => {
        expect(
            browserLane(
                { EZ_LICENSED_RUNTIME_STATUS_FILE: 'status.json' },
                ROOTS,
            ).testMatch,
        ).toBe('hosts/licensed-deployment.spec.ts');
    });

    it.each(['context-not-found', 'version-not-found'])(
        'runs the refusal suite for %s',
        (scenario) => {
            expect(
                browserLane({ EZ_INTEGRATION_SCENARIO: scenario }, ROOTS)
                    .testMatch,
            ).toBe('hosts/scenario-refusal.spec.ts');
        },
    );

    it('fails conflicting and unknown selections', () => {
        expect(() =>
            browserLane({ EZ_INTEGRATION_SCENARIO: 'unknown' }, ROOTS),
        ).toThrow('Unknown integration scenario');
        expect(() =>
            browserLane(
                {
                    EZ_INTEGRATION_SCENARIO: 'golden-corpus',
                    EZ_LICENSED_RUNTIME_STATUS_FILE: 'status.json',
                },
                ROOTS,
            ),
        ).toThrow('Select either');
    });
});

describe('integration host backend', () => {
    /** Write a status file and return the environment naming it. */
    function statusEnv(session: Record<string, unknown>) {
        const dir = mkdtempSync(path.join(tmpdir(), 'ez-status-'));
        const file = path.join(dir, 'status.json');
        writeFileSync(
            file,
            JSON.stringify({ baseUrl: 'http://127.0.0.1:9', session }),
        );
        return { EZ_LICENSED_RUNTIME_STATUS_FILE: file };
    }
    const session = {
        contextId: 'deployment-context',
        contextToken: 'context-token',
        principals: { author: { subject: 'author-1', bearer: 'bearer' } },
    };

    it('binds the golden corpus to ez-full and a refusal scenario to Cedar Valley', () => {
        expect(sessionPayload(null, undefined).contextId).toBe('ez-full');
        expect(sessionPayload(null, 'golden-corpus').contextId).toBe('ez-full');
        expect(sessionPayload(null, 'context-not-found')).toMatchObject({
            contextId: 'cedar-valley',
            contextVersion: '1.0.0',
        });
    });

    it('lets a status file leave the Context version to the deployment', () => {
        const status = deploymentStatus(statusEnv(session));
        const payload = sessionPayload(status, undefined);
        expect(payload).toEqual({
            contextId: 'deployment-context',
            contextToken: 'context-token',
            accessToken: 'bearer',
        });
        expect('contextVersion' in payload).toBe(false);
    });

    it('passes a named Context version through', () => {
        const status = deploymentStatus(
            statusEnv({ ...session, contextVersion: '2.1.0' }),
        );
        expect(sessionPayload(status, undefined).contextVersion).toBe('2.1.0');
    });

    it('refuses a status file whose version is not a string', () => {
        expect(() =>
            deploymentStatus(statusEnv({ ...session, contextVersion: 2 })),
        ).toThrow('session.contextVersion');
    });

    it('refuses a status file without the Context token', () => {
        const partial: Record<string, unknown> = { ...session };
        delete partial['contextToken'];
        expect(() => deploymentStatus(statusEnv(partial))).toThrow(
            'session.contextToken',
        );
    });
});
