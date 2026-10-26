/**
 * Append-only crawler status logging utilities.
 *
 * A downstream monitoring process reads these lines later, so the format is
 * intentionally compact and stable.
 */
import { appendFile } from 'node:fs/promises';

/** Structured fields captured for one crawler observation. */
export interface CrawlerStatusFields {
    iter: number;
    phase: string;
    /** Which application the crawler is driving. */
    origin?: string;
    persona?: string;
    route_id?: string;
    route?: string;
    viewport?: string;
    theme?: string;
    status: 'green' | 'yellow' | 'red';
    clicks?: number;
    inputs?: number;
    a11y?: number;
    console?: number;
    screenshots?: number;
    note?: string;
}

/** Append a single status line to the supplied log path. */
export async function appendCrawlerStatus(
    logPath: string,
    fields: CrawlerStatusFields,
): Promise<void> {
    const ts = new Date().toISOString();
    const parts: string[] = [ts];
    for (const [key, value] of Object.entries(fields)) {
        if (value === undefined || value === null) continue;
        parts.push(`${key}=${String(value).replace(/\s+/g, '_')}`);
    }
    try {
        await appendFile(logPath, `${parts.join(' ')}\n`, 'utf8');
    } catch {
        // The crawler should keep running even if the log path is missing or read-only.
    }
}
