/**
 * `data-ezclassify-role="part"` is how a marking host says it holds a part
 * whose whole is not on the page: each kind of host reads in the part role,
 * through the real engine, and none of them feeds a level.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Context } from '@ezclassify/engine';
import { EzClassifyUI } from './ezclassify-ui';

const WHOLE_ONLY = 'WHOLE-ONLY belongs on a whole.';

function concept(id: string, category: string, position: number) {
    return {
        id,
        name: id,
        views: { default: id },
        categories: [category],
        parents: [],
        aliases: [],
        position,
        rank: position,
    };
}

/** A scheme with a form the part role refuses and the whole role takes. */
function context() {
    return Context.fromComponents({
        scheme: {
            scheme: {
                id: 'standalone-part',
                version: '1.0.0',
                name: 'Standalone part',
                role_aware: true,
                data: {
                    concepts: {
                        inline: [
                            concept('LOW', 'level', 1),
                            concept('WHOLE-ONLY', 'handling', 1),
                        ],
                    },
                    categories: [
                        {
                            id: 'level',
                            label: 'Level',
                            single: true,
                            rollup: 'max',
                            position: 1,
                        },
                        {
                            id: 'handling',
                            label: 'Handling',
                            single: false,
                            rollup: 'union',
                            position: 2,
                        },
                    ],
                },
                rules: [
                    {
                        id: 'whole-only-on-parts',
                        action: 'forbid',
                        target: 'WHOLE-ONLY',
                        when: { role: 'part' },
                        message: WHOLE_ONLY,
                    },
                ],
                parse: { case_sensitive: false, strip_whitespace: true },
                render: {
                    default: 'default',
                    formats: [
                        {
                            id: 'default',
                            surface: 'marking',
                            mode: 'inline',
                            separator: '//',
                            fields: [
                                { category: 'level', separator: '/' },
                                { category: 'handling', separator: '/' },
                            ],
                        },
                    ],
                },
            },
        },
    });
}

const FORM = 'LOW//WHOLE-ONLY';

let root: HTMLDivElement;
let ui: EzClassifyUI | null;
let errors: Array<{ code: string; message: string }>;

function mount(markup: string): EzClassifyUI {
    root.innerHTML = markup;
    ui = new EzClassifyUI(context(), { root });
    return ui;
}

function byId<T extends HTMLElement>(id: string): T {
    return root.querySelector<T>(`#${id}`)!;
}

beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    Element.prototype.scrollIntoView = vi.fn();
    errors = [];
    ui = null;
    root = document.createElement('div');
    document.body.appendChild(root);
    root.addEventListener('ezclassify:host-error', (e) =>
        errors.push((e as CustomEvent).detail),
    );
});

afterEach(() => {
    ui?.destroy();
    root.remove();
    vi.restoreAllMocks();
});

describe('a part whose whole is not on the page', () => {
    it('refuses a whole-only form in a plain input, and in a plain input with no role takes it', async () => {
        mount(`
            <input id="part" data-ezclassify-marking data-ezclassify-role="part" value="${FORM}">
            <input id="whole" data-ezclassify-marking value="${FORM}">`);

        await expect
            .poll(() => byId('part').getAttribute('aria-invalid'))
            .toBe('true');
        await expect.poll(() => ui!.store.get('whole').rendered).toBe(FORM);
        expect(ui!.store.get('whole').valid).toBe(true);
        expect(byId('whole').getAttribute('aria-invalid')).not.toBe('true');
        expect(errors).toEqual([]);
    });

    it('refuses a whole-only form typed into a plain input', async () => {
        mount(
            `<input id="part" data-ezclassify-marking data-ezclassify-role="part" value="LOW">`,
        );
        const input = byId<HTMLInputElement>('part');
        await expect.poll(() => input.value).toBe('LOW');
        expect(input.getAttribute('aria-invalid')).not.toBe('true');

        input.value = FORM;
        input.dispatchEvent(new FocusEvent('blur', { bubbles: true }));

        await expect
            .poll(() => input.getAttribute('aria-invalid'))
            .toBe('true');
    });

    it.each(['marking', 'tags'])(
        'refuses a whole-only form in a %s field',
        async (controller) => {
            mount(
                `<input id="part" data-ezclassify-controller="${controller}" data-ezclassify-role="part" value="${FORM}">`,
            );

            await expect
                .poll(
                    () =>
                        root.querySelector('.ez-validation-errors')
                            ?.textContent,
                )
                .toContain(WHOLE_ONLY);
            expect(errors).toEqual([]);
        },
    );

    it('refuses a whole-only form in a text host', async () => {
        mount(
            `<code id="part" data-ezclassify-controller="text" data-ezclassify-role="part">${FORM}</code>`,
        );

        await expect
            .poll(() => byId('part').getAttribute('aria-invalid'))
            .toBe('true');
    });

    it('mounts a marked input in the part role', async () => {
        mount(
            `<input id="part" data-ezclassify-controller="marked-input" data-ezclassify-role="part" value="">`,
        );
        await expect.poll(() => ui!.mounted.has(byId('part'))).toBe(true);

        const component = ui!.mounted.get(byId('part')) as unknown as {
            options: { resolveContext?: () => unknown };
        };
        expect(component.options.resolveContext?.()).toEqual({ role: 'part' });
    });

    it('feeds no rollup, and a whole beside it still does', async () => {
        mount(`
            <input type="hidden" id="page" data-ezclassify-aggregate>
            <input id="part" data-ezclassify-controller="marking" data-ezclassify-role="part" value="LOW">
            <input id="plain" data-ezclassify-marking data-ezclassify-role="part" value="LOW">
            <input id="whole" data-ezclassify-marking value="LOW//WHOLE-ONLY">`);
        const page = byId<HTMLInputElement>('page');

        await expect.poll(() => page.value).toBe(FORM);
        const store = ui!.store;
        expect(store.get('part').rendered).toBe('');
        expect(store.get('plain').rendered).toBe('');

        byId<HTMLInputElement>('whole').value = '';
        byId('whole').dispatchEvent(new FocusEvent('blur', { bubbles: true }));

        await expect.poll(() => page.value).toBe('');
    });

    it('leaves the store when the attribute arrives, and rejoins when it goes', async () => {
        mount(`
            <input type="hidden" id="page" data-ezclassify-aggregate>
            <input id="host" data-ezclassify-marking value="LOW">`);
        const page = byId<HTMLInputElement>('page');
        await expect.poll(() => page.value).toBe('LOW');

        byId('host').setAttribute('data-ezclassify-role', 'part');
        await expect.poll(() => page.value).toBe('');

        byId('host').removeAttribute('data-ezclassify-role');
        await expect.poll(() => page.value).toBe('LOW');
    });

    it('is a host error to point a view at one', async () => {
        mount(`
            <input id="part" data-ezclassify-marking data-ezclassify-role="part" value="LOW">
            <output id="shown" data-ezclassify-source="part"></output>`);

        await expect
            .poll(() => errors.map((e) => e.code))
            .toEqual(['view-of-standalone-part']);
    });
});
