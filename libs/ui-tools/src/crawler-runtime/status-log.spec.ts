import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { appendCrawlerStatus } from './status-log.js';
import type { CrawlerStatusFields } from './status-log.js';

let tempDir: string;

beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'status-log-spec-'));
});

afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
});

function logPath(): string {
    return join(tempDir, 'crawler.log');
}

async function readLog(): Promise<string[]> {
    const content = await readFile(logPath(), 'utf8');
    return content.trim().split('\n').filter(Boolean);
}

describe('appendCrawlerStatus', () => {
    it('writes a line with an ISO timestamp prefix', async () => {
        await appendCrawlerStatus(logPath(), {
            iter: 1,
            phase: 'crawl',
            status: 'green',
        });
        const [line] = await readLog();
        expect(line).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });

    it('includes all defined fields in key=value format', async () => {
        const fields: CrawlerStatusFields = {
            iter: 7,
            phase: 'crawl',
            origin: 'example-app',
            persona: 'admin',
            status: 'green',
            clicks: 3,
            a11y: 0,
        };
        await appendCrawlerStatus(logPath(), fields);
        const [line] = await readLog();
        expect(line).toContain('iter=7');
        expect(line).toContain('phase=crawl');
        expect(line).toContain('origin=example-app');
        expect(line).toContain('persona=admin');
        expect(line).toContain('status=green');
        expect(line).toContain('clicks=3');
        expect(line).toContain('a11y=0');
    });

    it('omits fields with undefined values', async () => {
        await appendCrawlerStatus(logPath(), {
            iter: 2,
            phase: 'boot',
            status: 'yellow',
            note: undefined,
            viewport: undefined,
        });
        const [line] = await readLog();
        expect(line).not.toContain('note=');
        expect(line).not.toContain('viewport=');
    });

    it('replaces spaces in string values with underscores', async () => {
        await appendCrawlerStatus(logPath(), {
            iter: 3,
            phase: 'crawl',
            status: 'red',
            note: 'found 2 errors',
        });
        const [line] = await readLog();
        expect(line).toContain('note=found_2_errors');
        expect(line).not.toContain('found 2 errors');
    });

    it('appends multiple calls as separate lines in order', async () => {
        await appendCrawlerStatus(logPath(), {
            iter: 1,
            phase: 'boot',
            status: 'green',
        });
        await appendCrawlerStatus(logPath(), {
            iter: 2,
            phase: 'crawl',
            status: 'yellow',
        });
        await appendCrawlerStatus(logPath(), {
            iter: 3,
            phase: 'done',
            status: 'red',
        });
        const lines = await readLog();
        expect(lines).toHaveLength(3);
        expect(lines[0]).toContain('iter=1');
        expect(lines[1]).toContain('iter=2');
        expect(lines[2]).toContain('iter=3');
    });

    it('does not throw when the log directory does not exist', async () => {
        const badPath = join(tempDir, 'nonexistent-dir', 'crawler.log');
        await expect(
            appendCrawlerStatus(badPath, {
                iter: 1,
                phase: 'crawl',
                status: 'green',
            }),
        ).resolves.toBeUndefined();
    });

    it('does not throw when the log path is read-only (silent catch)', async () => {
        // An absolute path that cannot be written to in this environment
        await expect(
            appendCrawlerStatus('/proc/nonexistent/log', {
                iter: 1,
                phase: 'x',
                status: 'red',
            }),
        ).resolves.toBeUndefined();
    });
});
