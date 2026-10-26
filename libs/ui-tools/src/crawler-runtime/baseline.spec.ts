/** Baseline lifecycle checks using temporary files and mocked vision responses. */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { compareAgainstBaseline } from './baseline.js';
import type { BaselineKey } from './baseline.js';

const KEY: BaselineKey = {
    persona: 'admin',
    route: '/dashboard',
    viewport: '1280x720',
    theme: 'light',
    slot: 'main',
};

let tempDir: string;
let savedApiKey: string | undefined;

beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'baseline-spec-'));
    savedApiKey = process.env['ANTHROPIC_API_KEY'];
    delete process.env['ANTHROPIC_API_KEY'];
});

afterEach(async () => {
    vi.unstubAllGlobals();
    await rm(tempDir, { recursive: true, force: true });
    if (savedApiKey !== undefined) {
        process.env['ANTHROPIC_API_KEY'] = savedApiKey;
    } else {
        delete process.env['ANTHROPIC_API_KEY'];
    }
});

describe('compareAgainstBaseline: bootstrap (no existing file)', () => {
    it('returns action=bootstrapped on first call', async () => {
        const result = await compareAgainstBaseline({
            baselineRoot: tempDir,
            key: KEY,
            capture: Buffer.alloc(100, 42),
            intent: 'should show dashboard header',
        });
        expect(result.action).toBe('bootstrapped');
    });

    it('reason is vision-disabled-no-api-key when ANTHROPIC_API_KEY is absent', async () => {
        const result = await compareAgainstBaseline({
            baselineRoot: tempDir,
            key: KEY,
            capture: Buffer.alloc(100, 42),
            intent: 'some intent',
        });
        expect(result.reason).toBe('vision-disabled-no-api-key');
    });

    it('reason is vision-skipped-no-intent when API key is set but intent is empty', async () => {
        process.env['ANTHROPIC_API_KEY'] = 'test-key-for-no-intent-check';
        const result = await compareAgainstBaseline({
            baselineRoot: tempDir,
            key: KEY,
            capture: Buffer.alloc(100, 42),
            intent: '',
        });
        expect(result.action).toBe('bootstrapped');
        expect(result.reason).toBe('vision-skipped-no-intent');
    });

    it('writes the baseline so a second identical call returns matched', async () => {
        const capture = Buffer.alloc(200, 99);
        await compareAgainstBaseline({
            baselineRoot: tempDir,
            key: KEY,
            capture,
            intent: '',
        });
        process.env['ANTHROPIC_API_KEY'] = 'test-key';
        const second = await compareAgainstBaseline({
            baselineRoot: tempDir,
            key: KEY,
            capture,
            intent: '',
        });
        expect(second.action).toBe('matched');
    });

    it('accepts keys with special characters (slugify does not throw)', async () => {
        const specialKey: BaselineKey = {
            persona: 'admin user',
            route: '/section/sub page',
            viewport: '1280×720',
            theme: 'dark mode',
            slot: 'top/nav',
        };
        const result = await compareAgainstBaseline({
            baselineRoot: tempDir,
            key: specialKey,
            capture: Buffer.alloc(50, 7),
            intent: '',
        });
        expect(result.action).toBe('bootstrapped');
    });
});

describe('compareAgainstBaseline: match', () => {
    it('returns action=matched diffRatio=0 reason=byte-identical for the same bytes', async () => {
        const capture = Buffer.alloc(500, 33);
        process.env['ANTHROPIC_API_KEY'] = 'test-key';
        await compareAgainstBaseline({
            baselineRoot: tempDir,
            key: KEY,
            capture,
            intent: '',
        });
        const result = await compareAgainstBaseline({
            baselineRoot: tempDir,
            key: KEY,
            capture,
            intent: '',
        });
        expect(result.action).toBe('matched');
        expect(result.diffRatio).toBe(0);
        expect(result.reason).toBe('byte-identical');
    });

    it('returns matched within-threshold for a tiny byte difference', async () => {
        const base = Buffer.alloc(1000, 0);
        process.env['ANTHROPIC_API_KEY'] = 'test-key';
        await compareAgainstBaseline({
            baselineRoot: tempDir,
            key: KEY,
            capture: base,
            intent: '',
        });

        const slightlyDiff = Buffer.from(base);
        slightlyDiff[0] = 1; // 1 byte different out of 1000 → ratio ≈ 0.001
        const result = await compareAgainstBaseline({
            baselineRoot: tempDir,
            key: KEY,
            capture: slightlyDiff,
            intent: '',
        });
        expect(result.action).toBe('matched');
        expect(result.reason).toBe('within-threshold');
        expect(result.diffRatio).toBeGreaterThan(0);
        expect(result.diffRatio).toBeLessThan(0.015);
    });
});

describe('compareAgainstBaseline: unverified large drift', () => {
    it('retains the baseline when vision is disabled', async () => {
        const base = Buffer.alloc(1000, 0);
        await compareAgainstBaseline({
            baselineRoot: tempDir,
            key: KEY,
            capture: base,
            intent: '',
        });

        const veryDiff = Buffer.alloc(1000, 255); // completely different bytes
        const result = await compareAgainstBaseline({
            baselineRoot: tempDir,
            key: KEY,
            capture: veryDiff,
            intent: 'should show dashboard',
        });
        expect(result.action).toBe('failed');
        expect(await readFile(baselinePath())).toEqual(base);
        expect(result.diffRatio).toBeGreaterThan(0.015);
        expect(result.reason).toBe(
            'intent-unverified-after-drift: vision-disabled-no-api-key',
        );
    });

    it('retains the baseline when no intent is supplied', async () => {
        const base = Buffer.alloc(1000, 0);
        process.env['ANTHROPIC_API_KEY'] = 'test-key';
        await compareAgainstBaseline({
            baselineRoot: tempDir,
            key: KEY,
            capture: base,
            intent: '',
        });

        const veryDiff = Buffer.alloc(1000, 200);
        const result = await compareAgainstBaseline({
            baselineRoot: tempDir,
            key: KEY,
            capture: veryDiff,
            intent: '',
        });
        expect(result.action).toBe('failed');
        expect(await readFile(baselinePath())).toEqual(base);
        expect(result.reason).toBe(
            'intent-unverified-after-drift: vision-skipped-no-intent',
        );
    });
});

function baselinePath(): string {
    return join(tempDir, 'admin', 'dashboard', '1280x720__light__main.png');
}

describe('compareAgainstBaseline: vision verdicts after drift', () => {
    const failures = [
        ['network failure', () => Promise.reject(new Error('offline'))],
        [
            'HTTP failure',
            () => Promise.resolve(new Response('', { status: 503 })),
        ],
        ['invalid JSON', () => Promise.resolve(new Response('invalid-json'))],
        [
            'missing verdict',
            () => Promise.resolve(Response.json({ content: [] })),
        ],
        [
            'invalid content shape',
            () => Promise.resolve(Response.json({ content: {} })),
        ],
    ] as const;

    it.each(failures)(
        'preserves existing bytes on %s',
        async (_name, fetcher) => {
            const base = Buffer.alloc(1000, 0);
            await compareAgainstBaseline({
                baselineRoot: tempDir,
                key: KEY,
                capture: base,
                intent: '',
            });
            process.env['ANTHROPIC_API_KEY'] = 'test-key';
            vi.stubGlobal('fetch', vi.fn(fetcher));
            const result = await compareAgainstBaseline({
                baselineRoot: tempDir,
                key: KEY,
                capture: Buffer.alloc(1000, 255),
                intent: 'dashboard',
            });
            expect(result.action).toBe('failed');
            expect(result.reason).toContain('intent-unverified-after-drift:');
            expect(await readFile(baselinePath())).toEqual(base);
        },
    );

    it.each([true, false])(
        'replaces existing bytes only for an affirmative verdict (%s)',
        async (matches) => {
            const base = Buffer.alloc(1000, 0);
            const capture = Buffer.alloc(1000, 255);
            await compareAgainstBaseline({
                baselineRoot: tempDir,
                key: KEY,
                capture: base,
                intent: '',
            });
            process.env['ANTHROPIC_API_KEY'] = 'test-key';
            vi.stubGlobal(
                'fetch',
                vi.fn(async () =>
                    Response.json({
                        content: [
                            {
                                type: 'text',
                                text: JSON.stringify({
                                    matches,
                                    reason: 'checked',
                                }),
                            },
                        ],
                    }),
                ),
            );
            const result = await compareAgainstBaseline({
                baselineRoot: tempDir,
                key: KEY,
                capture,
                intent: 'dashboard',
            });
            expect(result.action).toBe(matches ? 'updated' : 'failed');
            expect(await readFile(baselinePath())).toEqual(
                matches ? capture : base,
            );
        },
    );
});
