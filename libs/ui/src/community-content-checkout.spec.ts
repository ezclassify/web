/**
 * The community-content checkout the Cedar Valley specs read.
 *
 * Every spec that needs the district's content goes through
 * `test-support/community-content.ts`. These specs hold the two promises that
 * make that safe: the checkout the variable names is the one that is read, and
 * a missing checkout fails with the fix rather than letting specs skip.
 */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
    COMMUNITY_CONTENT_DIR_VARIABLE,
    communityContentDir,
    loadCedarValleyContext,
    schemeDocumentJson,
} from '../../../test-support/community-content';

const original = process.env[COMMUNITY_CONTENT_DIR_VARIABLE];
const scratch: string[] = [];

afterEach(() => {
    if (original === undefined)
        delete process.env[COMMUNITY_CONTENT_DIR_VARIABLE];
    else process.env[COMMUNITY_CONTENT_DIR_VARIABLE] = original;
    while (scratch.length > 0) {
        rmSync(scratch.pop()!, { recursive: true, force: true });
    }
});

function scratchDir(): string {
    const dir = mkdtempSync(path.join(tmpdir(), 'ez-community-content-'));
    scratch.push(dir);
    return dir;
}

describe('community-content checkout', () => {
    it('fails with the variable to set when the checkout is missing', () => {
        process.env[COMMUNITY_CONTENT_DIR_VARIABLE] = scratchDir();

        expect(() => communityContentDir()).toThrow(
            COMMUNITY_CONTENT_DIR_VARIABLE,
        );
        expect(() => schemeDocumentJson('cedar-valley')).toThrow(
            /No community-content checkout/,
        );
    });

    it('reads the checkout the variable names', () => {
        const dir = scratchDir();
        const folder = path.join(dir, 'scheme-folder');
        mkdirSync(path.join(folder, 'schemes'), { recursive: true });
        writeFileSync(
            path.join(folder, 'scheme-folder.yaml'),
            'kind: folder\n',
        );
        writeFileSync(
            path.join(folder, 'schemes', 'stand-in@1.0.0.yaml'),
            'scheme:\n  id: stand-in\n',
        );
        process.env[COMMUNITY_CONTENT_DIR_VARIABLE] = dir;

        expect(communityContentDir()).toBe(dir);
        expect(JSON.parse(schemeDocumentJson('stand-in'))).toEqual({
            scheme: { id: 'stand-in' },
        });
    });

    it('builds a working Cedar Valley Context from the real checkout', () => {
        const context = loadCedarValleyContext();

        expect(context.scheme).toBeDefined();
    });
});
