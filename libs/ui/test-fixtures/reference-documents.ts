/**
 * The reference documents of the vendored conformance bundle
 * (`vendor/spec/fixtures/v1`), parsed, for specs that compose their own Context
 * through the demo runtime's draft door.
 *
 * They are this repository's own copy of public documents, so a draft built
 * from them is keyed the same way in every checkout and its recordings replay
 * anywhere. Each call returns a fresh copy a spec may change.
 */
import { readFileSync } from 'node:fs';
import * as path from 'node:path';

const FIXTURES = path.resolve(
    import.meta.dirname,
    '../../../vendor/spec/fixtures/v1',
);

function load(name: string): Record<string, unknown> {
    return JSON.parse(
        readFileSync(path.join(FIXTURES, `${name}.json`), 'utf8'),
    ) as Record<string, unknown>;
}

/** `ref-scheme-1`: a level category and a controls category. */
export function referenceScheme(): Record<string, unknown> {
    return load('ref-scheme-1');
}

/** `ref-guide-1`: three keyword rules over `ref-scheme-1`. */
export function referenceGuide(): { guide: Record<string, unknown> } {
    return load('ref-guide-1') as { guide: Record<string, unknown> };
}

/** `ref-scheme-1-access-rules`: one level rule over `ref-scheme-1`. */
export function referenceAccess(): { access: Record<string, unknown> } {
    return load('ref-scheme-1.access') as { access: Record<string, unknown> };
}
