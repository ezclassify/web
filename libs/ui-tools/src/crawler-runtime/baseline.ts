/** Screenshot baseline management with intent-aware drift gating. */
import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

/** Per-screenshot keying for baseline lookup. */
export interface BaselineKey {
    persona: string;
    route: string;
    viewport: string;
    theme: string;
    slot: string;
}

/** Outcome of a baseline comparison round. */
export interface BaselineResult {
    action: 'bootstrapped' | 'matched' | 'updated' | 'failed';
    diffRatio?: number;
    reason: string;
}

/** Verdict from the vision check of a capture against its described intent. */
export interface IntentVerdict {
    matches: boolean;
    reason: string;
}

/** An unavailable check has no verdict and cannot approve baseline replacement. */
type IntentAnalysis = IntentVerdict | { matches: null; reason: string };

interface AnthropicMessageResponse {
    content?: Array<{ type: string; text?: string }>;
}

function tryParseJson(text: string): { matches?: unknown; reason?: unknown } {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start < 0 || end < start) return {};
    try {
        return JSON.parse(text.slice(start, end + 1)) as {
            matches?: unknown;
            reason?: unknown;
        };
    } catch {
        return {};
    }
}

function slugify(value: string): string {
    return (
        value.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-|-$/g, '') || 'root'
    );
}

async function fileExists(p: string): Promise<boolean> {
    try {
        await stat(p);
        return true;
    } catch {
        return false;
    }
}

function hashBuffer(buf: Buffer): string {
    return createHash('sha256').update(buf).digest('hex');
}

function byteDeltaRatio(a: Buffer, b: Buffer): number {
    if (a.equals(b)) return 0;
    const longer = a.length >= b.length ? a : b;
    const shorter = a.length >= b.length ? b : a;
    const sampleCount = Math.min(shorter.length, 200_000);
    const stride = Math.max(1, Math.floor(shorter.length / sampleCount));
    let diffs = 0;
    let taken = 0;
    for (
        let i = 0;
        i < shorter.length && taken < sampleCount;
        i += stride, taken += 1
    ) {
        if (longer[i] !== shorter[i]) diffs += 1;
    }
    const sizeDrift = Math.abs(longer.length - shorter.length) / longer.length;
    return Math.min(1, diffs / Math.max(1, taken) + sizeDrift);
}

async function analyzeScreenshotIntent(
    buffer: Buffer,
    intent: string,
    visionModel: string,
): Promise<IntentAnalysis> {
    const apiKey = process.env['ANTHROPIC_API_KEY'];
    if (!apiKey) return { matches: null, reason: 'vision-disabled-no-api-key' };
    if (!intent) return { matches: null, reason: 'vision-skipped-no-intent' };

    const body = {
        model: visionModel,
        max_tokens: 200,
        messages: [
            {
                role: 'user',
                content: [
                    {
                        type: 'image',
                        source: {
                            type: 'base64',
                            media_type: 'image/png',
                            data: buffer.toString('base64'),
                        },
                    },
                    {
                        type: 'text',
                        text: `You are a visual regression gatekeeper for a web app. Given the screenshot and the described intent, decide whether the captured UI state matches. Respond with ONLY a compact JSON object, no prose or code fence: {"matches": true|false, "reason": "short reason under 80 chars"}. matches=true when the screenshot clearly shows the intended UI state; false when it shows an error page, a redirect, an unrendered viewport, a dialog blocking the described content, or otherwise unrelated UI.\n\nIntent: ${intent}`,
                    },
                ],
            },
        ],
    };

    let resp: Response;
    try {
        resp = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': apiKey,
                'anthropic-version': '2023-06-01',
            },
            body: JSON.stringify(body),
        });
    } catch (err) {
        return {
            matches: null,
            reason: `vision-network-error: ${String(err).slice(0, 40)}`,
        };
    }
    if (!resp.ok) {
        return { matches: null, reason: `vision-http-${resp.status}` };
    }
    let data: AnthropicMessageResponse;
    try {
        data = (await resp.json()) as AnthropicMessageResponse;
    } catch {
        return { matches: null, reason: 'vision-parse-body-failed' };
    }
    const text = Array.isArray(data?.content)
        ? (data.content.find(
              (c) => c?.type === 'text' && typeof c.text === 'string',
          )?.text ?? '')
        : '';
    const parsed = tryParseJson(text);
    if (
        typeof parsed.matches === 'boolean' &&
        typeof parsed.reason === 'string'
    ) {
        return { matches: parsed.matches, reason: parsed.reason.slice(0, 120) };
    }
    return { matches: null, reason: 'vision-unparseable-response' };
}

/** Compare a fresh capture against the stored baseline. */
export async function compareAgainstBaseline(opts: {
    baselineRoot: string;
    key: BaselineKey;
    capture: Buffer;
    intent: string;
    maxDiffRatio?: number;
    visionModel?: string;
}): Promise<BaselineResult> {
    const {
        baselineRoot,
        key,
        capture,
        intent,
        maxDiffRatio = 0.015,
        visionModel = 'claude-haiku-4-5-20251001',
    } = opts;

    const dest = path.join(
        baselineRoot,
        slugify(key.persona),
        slugify(key.route),
        `${slugify(key.viewport)}__${slugify(key.theme)}__${slugify(key.slot)}.png`,
    );
    await mkdir(path.dirname(dest), { recursive: true });

    if (!(await fileExists(dest))) {
        const verdict = await analyzeScreenshotIntent(
            capture,
            intent,
            visionModel,
        );
        if (verdict.matches !== false) {
            await writeFile(dest, capture);
            return { action: 'bootstrapped', reason: verdict.reason };
        }
        return {
            action: 'failed',
            reason: `intent-rejected-on-bootstrap: ${verdict.reason}`,
        };
    }

    const existing = await readFile(dest);
    if (hashBuffer(existing) === hashBuffer(capture)) {
        return { action: 'matched', diffRatio: 0, reason: 'byte-identical' };
    }

    const ratio = byteDeltaRatio(existing, capture);
    if (ratio <= maxDiffRatio) {
        return {
            action: 'matched',
            diffRatio: ratio,
            reason: 'within-threshold',
        };
    }

    const verdict = await analyzeScreenshotIntent(capture, intent, visionModel);
    if (verdict.matches === true) {
        await writeFile(dest, capture);
        return { action: 'updated', diffRatio: ratio, reason: verdict.reason };
    }
    return {
        action: 'failed',
        diffRatio: ratio,
        reason: `${verdict.matches === null ? 'intent-unverified-after-drift' : 'intent-rejected-after-drift'}: ${verdict.reason}`,
    };
}
