/** Shared resilient crawler loop runner. */
import { spawn, execSync } from 'node:child_process';
import {
    appendFileSync,
    existsSync,
    readFileSync,
    writeFileSync,
} from 'node:fs';

/** Options for the long-running crawler loop. */
export interface CrawlerRunLoopOptions {
    name: string;
    statusLogPath: string;
    pidFilePath: string;
    iterFilePath: string;
    workDir: string;
    crawlerCwd: string;
    crawlerCmd: string;
    crawlerArgs: string[];
    env: NodeJS.ProcessEnv;
    runTimeoutMs?: number;
    heartbeatMs?: number;
    cooldownMs?: number;
    killPatterns?: string[];
    iterSeed?: number;
}

function status(logPath: string, line: string): void {
    const ts = new Date().toISOString();
    try {
        appendFileSync(logPath, `${ts} ${line}\n`);
    } catch {
        // Logging must not crash the loop.
    }
}

function killOrphanStack(patterns: string[]): void {
    for (const pattern of patterns) {
        try {
            execSync(`pkill -f "${pattern}" 2>/dev/null`, { stdio: 'ignore' });
        } catch {
            // no matches is fine
        }
    }
}

function loadIter(iterFilePath: string, seed: number): number {
    if (!existsSync(iterFilePath)) return seed;
    const raw = readFileSync(iterFilePath, 'utf8').trim();
    const n = parseInt(raw, 10);
    return Number.isFinite(n) ? n : seed;
}

function saveIter(iterFilePath: string, iter: number): void {
    writeFileSync(iterFilePath, String(iter));
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runOnce(
    opts: CrawlerRunLoopOptions,
    iter: number,
): Promise<{ code: number }> {
    const {
        name,
        statusLogPath,
        crawlerCwd,
        crawlerCmd,
        crawlerArgs,
        env,
        runTimeoutMs = 45 * 60_000,
    } = opts;

    status(
        statusLogPath,
        `loop-driver name=${name} iter=${iter} phase=run-start`,
    );

    return await new Promise((resolve) => {
        const child = spawn(crawlerCmd, crawlerArgs, {
            cwd: crawlerCwd,
            env: { ...env, CRAWL_ITER: String(iter) },
            stdio: ['ignore', 'pipe', 'pipe'],
        });

        let buf = '';
        let passed = 0;
        let failed = 0;
        child.stdout.on('data', (chunk) => {
            buf += chunk.toString();
            const lines = buf.split('\n');
            buf = lines.pop() ?? '';
            for (const line of lines) {
                const stripped = line.replace(/\u001b\[[0-9;]*m/g, '').trim();
                if (/^\s*✓/.test(line) || /^\s*✓/.test(stripped)) passed += 1;
                else if (
                    /^\s*✘/.test(line) ||
                    /^\s*✘/.test(stripped) ||
                    /^\s*✗/.test(stripped)
                )
                    failed += 1;
            }
        });
        child.stderr.on('data', () => {
            // crawler stack chatter is expected
        });

        const timer = setTimeout(() => {
            status(
                statusLogPath,
                `loop-driver name=${name} iter=${iter} phase=timeout note=run-exceeded-hard-cap-killing`,
            );
            try {
                child.kill('SIGKILL');
            } catch {
                // already gone
            }
        }, runTimeoutMs);

        child.on('exit', (code) => {
            clearTimeout(timer);
            const outcome = code === 0 ? 'green' : failed > 0 ? 'red' : 'amber';
            status(
                statusLogPath,
                `loop-driver name=${name} iter=${iter} phase=run-end exit=${code} passed=${passed} failed=${failed} outcome=${outcome}`,
            );
            resolve({ code: code ?? 1 });
        });

        child.on('error', (err) => {
            clearTimeout(timer);
            status(
                statusLogPath,
                `loop-driver name=${name} iter=${iter} phase=spawn-error err=${String(err).slice(0, 160)}`,
            );
            resolve({ code: 1 });
        });
    });
}

/** Run the crawler loop forever until interrupted. */
export async function runCrawlerLoop(
    opts: CrawlerRunLoopOptions,
): Promise<void> {
    const {
        name,
        statusLogPath,
        pidFilePath,
        iterFilePath,
        heartbeatMs = 5 * 60_000,
        cooldownMs = 30_000,
        iterSeed = 100,
    } = opts;

    writeFileSync(pidFilePath, String(process.pid));
    status(statusLogPath, `loop-driver name=${name} start pid=${process.pid}`);

    const heartbeat = setInterval(
        () => status(statusLogPath, `loop-driver name=${name} heartbeat-tick`),
        heartbeatMs,
    );

    let iter = loadIter(iterFilePath, iterSeed);
    process.on('SIGINT', () => {
        status(statusLogPath, `loop-driver name=${name} sigint`);
        clearInterval(heartbeat);
        process.exit(0);
    });
    process.on('SIGTERM', () => {
        status(statusLogPath, `loop-driver name=${name} sigterm`);
        clearInterval(heartbeat);
        process.exit(0);
    });

    while (true) {
        try {
            killOrphanStack(opts.killPatterns ?? []);
            await sleep(3000);
            await runOnce(opts, iter);
        } catch (err) {
            status(
                statusLogPath,
                `loop-driver name=${name} iter=${iter} phase=iter-error err=${String(err).slice(0, 160)}`,
            );
        }
        iter += 1;
        saveIter(iterFilePath, iter);
        await sleep(cooldownMs);
    }
}
