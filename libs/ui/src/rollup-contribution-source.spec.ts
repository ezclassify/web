/**
 * Contribution attribution on a form whose text editor fields have wrapped
 * their hosts. A contribution names the field the person typed into (`sourceId`
 * and `sourceLabel`), found through the mount-host registry rather than by DOM
 * position, so it stays right when a host page places its own elements between
 * a field's wrapper and its mount.
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Context } from '@ezclassify/engine';
import { EzClassifyUI } from './ezclassify-ui';
import type { ContributionDescriptor } from './forms/rollup';
import { __resetMountRollupRegistry } from './mount-rollup-registry';

const fixturesDir = resolve(
    dirname(fileURLToPath(import.meta.url)),
    '../../../vendor/spec/fixtures/v1',
);

/** Ref-scheme-1 with an embedded-marking pattern, so a text area finds `(LOW)`. */
function newEngine() {
    const document = JSON.parse(
        readFileSync(resolve(fixturesDir, 'ref-scheme-1.json'), 'utf8'),
    ) as { scheme: Record<string, unknown> };
    return Context.fromComponents({
        scheme: {
            ...document,
            scheme: {
                ...document.scheme,
                embedded_marking: [
                    { pattern: '\\(([^)]+)\\)', template: '({marking}) ' },
                ],
            },
        },
    });
}

async function settle(): Promise<void> {
    for (let i = 0; i < 6; i++)
        await new Promise<void>((r) => setTimeout(r, 25));
}

describe('contribution attribution with wrapped text editor hosts', () => {
    let root: HTMLDivElement;
    let ui: EzClassifyUI | null;

    beforeEach(() => {
        __resetMountRollupRegistry();
        root = document.createElement('div');
        // Two marked text areas share a parent with a marked input and a
        // marking field, so a lookup by DOM position has a wrong field to find.
        root.innerHTML = `
            <textarea id="notes" aria-label="Meeting notes"
                data-ezclassify-controller="marked-textarea">(LOW) first</textarea>
            <textarea id="summary" aria-label="Case summary"
                data-ezclassify-controller="marked-textarea">(HIGH) second</textarea>
            <input id="subject" aria-label="Subject line" value="(LOW) subject"
                data-ezclassify-controller="marked-input">
            <input id="document" aria-label="Document marking" value="HIGH"
                data-ezclassify-controller="marking">`;
        document.body.appendChild(root);
        ui = null;
    });
    afterEach(() => {
        ui?.destroy();
        root.remove();
        __resetMountRollupRegistry();
    });

    it('names the registered host of each field, whatever sits next to its mount', async () => {
        ui = new EzClassifyUI(newEngine(), { root, rollupId: 'attr-rollup' });
        await settle();

        // A host page puts its own help text between each wrapper and mount.
        for (const mount of Array.from(
            root.querySelectorAll<HTMLElement>(
                ':scope > [data-ezclassify-mount]',
            ),
        )) {
            const note = document.createElement('p');
            note.className = 'host-help';
            mount.before(note);
        }

        const rollup = root.querySelector<HTMLInputElement>('#attr-rollup')!;
        let contributions: ContributionDescriptor[] = [];
        rollup.addEventListener('ezclassify:rollup', (e) => {
            contributions =
                (e as CustomEvent).detail.contributions ?? contributions;
        });
        await ui.flushRollupNow();
        await settle();

        const byId = new Map(
            contributions.map((c) => [c.sourceId, c] as const),
        );
        expect([...byId.keys()].sort()).toEqual([
            'document',
            'notes',
            'subject',
            'summary',
        ]);
        expect(byId.get('notes')).toMatchObject({
            sourceLabel: 'Meeting notes',
            controller: 'marked-textarea',
        });
        expect(byId.get('summary')).toMatchObject({
            sourceLabel: 'Case summary',
            controller: 'marked-textarea',
        });
        expect(byId.get('subject')).toMatchObject({
            sourceLabel: 'Subject line',
            controller: 'marked-input',
        });
        expect(byId.get('document')).toMatchObject({
            sourceLabel: 'Document marking',
            controller: 'marking',
        });
    });
});
