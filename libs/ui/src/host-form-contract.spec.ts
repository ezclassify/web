/**
 * Host Form Contract (ARCHITECTURE.md): the enhanced native field stays in the
 * DOM, holds the rendered value, and emits its NORMAL bubbling form events when
 * that value changes. A host may keep an ordinary
 * `form.addEventListener('input', ...)` and never subscribe to any ezclassify:*
 * event. These specs pin the native-event side of that contract for the code
 * paths that write the field value programmatically: picker-driven edits,
 * template inserts, and the plain-bind blur commit.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { rowFor } from './components/composer/composer-harness';
import type { LocalSchemeEngineAdapter } from '@ezclassify/types';
import { Context } from '@ezclassify/engine';
import { EzClassifyUI } from './ezclassify-ui';
import { MarkedInput } from './components/marked-input';

function wait(ms = 50): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
}

function createMarkedEngine(): LocalSchemeEngineAdapter {
    return Context.fromComponents({
        scheme: {
            scheme: {
                id: 'contract-test',
                version: '1.0.0',
                name: 'Contract Test',
                data: {
                    concepts: {
                        inline: [
                            {
                                id: 'U',
                                name: 'Unclassified',
                                views: { default: 'U' },
                                categories: ['level'],
                                parents: [],
                                aliases: [],
                                position: 1,
                                rank: 1,
                            },
                            {
                                id: 'S',
                                name: 'Secret',
                                views: { default: 'S' },
                                categories: ['level'],
                                parents: [],
                                aliases: [],
                                position: 2,
                                rank: 2,
                            },
                        ],
                    },
                    categories: [
                        {
                            id: 'level',
                            label: 'Level',
                            required: false,
                            single: true,
                            rollup: 'max',
                            position: 1,
                        },
                    ],
                },
                rules: [],
                embedded_marking: [
                    { pattern: '\\(([^)]+)\\)', template: '({marking}) ' },
                ],
                parse: {
                    case_sensitive: false,
                    strip_whitespace: true,
                },
                render: {
                    default: 'portion',
                    formats: [
                        {
                            id: 'portion',
                            surface: 'marking',
                            mode: 'inline',
                            separator: '//',
                            fields: [{ category: 'level', separator: '/' }],
                        },
                    ],
                },
            },
        },
    }).scheme as LocalSchemeEngineAdapter;
}

let root: HTMLDivElement;
const activeForms: EzClassifyUI[] = [];

beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    Element.prototype.scrollIntoView = vi.fn();
    document.body.innerHTML = '';
    root = document.createElement('div');
    document.body.appendChild(root);
});

afterEach(() => {
    vi.restoreAllMocks();
    while (activeForms.length > 0) activeForms.pop()!.destroy();
    document.body.innerHTML = '';
});

/** Collect bubbling input events whose target is the given field. */
function collectFieldInputEvents(
    ancestor: HTMLElement,
    field: HTMLElement,
): Event[] {
    const events: Event[] = [];
    ancestor.addEventListener('input', (e) => {
        if (e.target === field) events.push(e);
    });
    return events;
}

describe('Host Form Contract: native input events', () => {
    it('marked-input: a picker-applied marking emits a native bubbling input event', async () => {
        const engine = createMarkedEngine();
        root.innerHTML = `<form id="f"><input type="text" id="mi" data-ezclassify-controller="marked-input"></form>`;
        const forms = new EzClassifyUI(engine as never, { root });
        activeForms.push(forms);
        await wait(80);

        const form = document.getElementById('f') as HTMLFormElement;
        const field = document.getElementById('mi') as HTMLTextAreaElement;
        const events = collectFieldInputEvents(form, field);

        // Open the picker and commit a concept through the inline editor.
        field.focus();
        document.activeElement!.dispatchEvent(
            new KeyboardEvent('keydown', {
                key: 'Enter',
                ctrlKey: true,
                bubbles: true,
                cancelable: true,
            }),
        );
        await wait(80);
        const editorInput = document.querySelector(
            '.inline-editor-input',
        ) as HTMLInputElement;
        expect(editorInput).toBeTruthy();
        editorInput.value = 'U';
        editorInput.setSelectionRange(1, 1);
        editorInput.dispatchEvent(new Event('input'));
        await wait(80);
        // A row press fills the draft; Enter commits it (the composer's
        // commit table), and only the commit changes the field's value.
        const option = rowFor('U') as HTMLElement;
        expect(option).toBeTruthy();
        option.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        option.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        await wait(80);
        expect(events.length).toBe(0);
        editorInput.dispatchEvent(
            new KeyboardEvent('keydown', {
                key: 'Enter',
                bubbles: true,
                cancelable: true,
            }),
        );
        await wait(80);

        // The field value changed to the marked form AND the form observed it
        // through an ordinary input listener.
        expect(field.value).toMatch(/\((?:U|S)\)/);
        expect(events.length).toBeGreaterThan(0);
    });

    it('marked-input: an external setAssertions reflection stays silent', async () => {
        // External state (a store push, a host setAssertions call) is not a
        // change this field originated; re-announcing it would echo.
        const engine = createMarkedEngine();
        root.innerHTML = `<form id="f"><input type="text" id="mi" data-ezclassify-controller="marked-input" value="(U) memo"></form>`;
        const forms = new EzClassifyUI(engine as never, { root });
        activeForms.push(forms);
        await wait(80);

        const form = document.getElementById('f') as HTMLFormElement;
        const field = document.getElementById('mi') as HTMLTextAreaElement;
        const comp = forms.components.get(field) as MarkedInput;
        const events = collectFieldInputEvents(form, field);

        comp.setAssertions([
            {
                conceptId: 'S',
                categoryId: 'level',
                confidence: 'certain',
                source: 'user',
            },
        ]);
        await wait(80);

        expect(field.value).toContain('S');
        expect(events).toHaveLength(0);
    });

    it('marked-textarea: the add-marking template insert emits a native input event', async () => {
        const engine = createMarkedEngine();
        root.innerHTML = `<form id="f"><textarea id="ta" data-ezclassify-controller="marked-textarea">Body text.</textarea></form>`;
        const forms = new EzClassifyUI(engine as never, { root });
        activeForms.push(forms);
        await wait(200);

        const form = document.getElementById('f') as HTMLFormElement;
        const field = document.getElementById('ta') as HTMLTextAreaElement;
        const events = collectFieldInputEvents(form, field);

        const touchAdd = root.querySelector(
            '.marked-textarea-touch-add',
        ) as HTMLButtonElement;
        touchAdd.click();
        await wait(120);

        expect(field.value).toContain('(');
        expect(events.length).toBeGreaterThan(0);
    });

    it('plain bind: the blur-commit reformat emits a native input event; unchanged value emits none', async () => {
        const engine = createMarkedEngine();
        root.innerHTML = `<form id="f"><input id="p" data-ezclassify-bind type="text" value="u" /></form>`;
        const forms = new EzClassifyUI(engine as never, { root });
        activeForms.push(forms);
        await wait(80);

        const form = document.getElementById('f') as HTMLFormElement;
        const field = document.getElementById('p') as HTMLInputElement;
        const events = collectFieldInputEvents(form, field);

        // Commit rewrites "u" to the rendered "U": one native event.
        field.dispatchEvent(new Event('blur'));
        await wait(80);
        expect(field.value).toBe('U');
        expect(events).toHaveLength(1);

        // Committing again with an unchanged value: no event.
        field.dispatchEvent(new Event('blur'));
        await wait(80);
        expect(events).toHaveLength(1);
    });
});
