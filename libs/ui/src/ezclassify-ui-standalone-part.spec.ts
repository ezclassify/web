/**
 * `data-ezclassify-role="part"` is how a marking host says it holds a part
 * whose whole is not on the page: each kind of host reads in the part role,
 * through the real engine, the store holds it for its views, and none of them
 * feeds a level.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EzClassifyUI } from './ezclassify-ui';
import { connectDemoContext } from '../../../test-support/demo-runtime';

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
async function context() {
    return await connectDemoContext({
        draft: {
            scheme: {
                scheme: {
                    id: 'standalone-part',
                    version: '1.0.0',
                    name: 'Standalone part',
                    description: 'Standalone part test fixture.',
                    role_aware: true,
                    data: {
                        concepts: [
                            concept('LOW', 'level', 1),
                            concept('WHOLE-ONLY', 'handling', 1),
                        ],
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
        },
    });
}

const FORM = 'LOW//WHOLE-ONLY';

let root: HTMLDivElement;
let ui: EzClassifyUI | null;
let errors: Array<{ code: string; message: string }>;

async function mount(markup: string): Promise<EzClassifyUI> {
    root.innerHTML = markup;
    ui = new EzClassifyUI(await context(), { root });
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

/** The same marking written differently in a whole and in a part. */
async function twoFormatContext() {
    const level = {
        ...concept('LOW', 'level', 1),
        views: { default: 'LOW', portion: 'L' },
    };
    return await connectDemoContext({
        draft: {
            scheme: {
                scheme: {
                    id: 'two-format-part',
                    version: '1.0.0',
                    name: 'Two formats',
                    description: 'Two formats test fixture.',
                    role_aware: true,
                    role_detection: {
                        whole: { views: ['whole'] },
                        part: { views: ['portion'] },
                    },
                    data: {
                        concepts: [level],
                        categories: [
                            {
                                id: 'level',
                                label: 'Level',
                                single: true,
                                rollup: 'max',
                                position: 1,
                            },
                        ],
                    },
                    rules: [
                        {
                            id: 'low-on-parts-only',
                            action: 'forbid',
                            target: 'LOW',
                            when: { role: 'whole' },
                            message: 'LOW belongs on a part.',
                        },
                    ],
                    render: {
                        default: 'whole',
                        formats: [
                            {
                                id: 'whole',
                                surface: 'marking',
                                mode: 'inline',
                                separator: '//',
                                view: 'default',
                                fields: [{ category: 'level', separator: '/' }],
                            },
                            {
                                id: 'portion',
                                surface: 'marking',
                                mode: 'inline',
                                separator: '//',
                                view: 'portion',
                                fields: [{ category: 'level', separator: '/' }],
                            },
                        ],
                    },
                },
            },
        },
    });
}

describe('a part in a scheme with a part format', () => {
    async function mountTwoFormats(markup: string): Promise<EzClassifyUI> {
        root.innerHTML = markup;
        ui = new EzClassifyUI(await twoFormatContext(), { root });
        return ui;
    }

    it('writes a plain input in the part format', async () => {
        await mountTwoFormats(
            `<input id="part" data-ezclassify-marking data-ezclassify-role="part" value="L">`,
        );
        const input = byId<HTMLInputElement>('part');
        await expect.poll(() => input.getAttribute('aria-invalid')).toBeNull();

        input.value = 'low';
        input.dispatchEvent(new FocusEvent('blur', { bubbles: true }));

        await expect.poll(() => input.value).toBe('L');
    });

    it('writes a controller field in the part format', async () => {
        await mountTwoFormats(
            `<input id="part" data-ezclassify-controller="marking" data-ezclassify-role="part" value="LOW">`,
        );
        const input = byId<HTMLInputElement>('part');

        await expect
            .poll(() => ui!.components.get(input)?.getRendered())
            .toBe('L');
    });

    it('copies in the part format, read in the part role', async () => {
        const writeText = vi.fn(async () => {});
        Object.defineProperty(navigator, 'clipboard', {
            configurable: true,
            value: { writeText },
        });
        await mountTwoFormats(
            `<input id="part" data-ezclassify-marking data-ezclassify-role="part" value="L">`,
        );
        const input = byId<HTMLInputElement>('part');
        await expect.poll(() => input.getAttribute('aria-invalid')).toBeNull();

        await ui!.copyMarkingToClipboard(input);

        expect(writeText).toHaveBeenCalledTimes(1);
        const text = (writeText.mock.calls[0] as unknown as [string])[0];
        expect(text.split('\n')[0]).toBe('L');
        expect(text).toContain('Format: portion');
        expect(text).toContain('Valid: true');
    });

    it('shows a view the part format the host holds', async () => {
        await mountTwoFormats(`
            <input type="hidden" id="part" data-ezclassify-marking data-ezclassify-role="part" value="low">
            <output id="shown" data-ezclassify-source="part"></output>`);

        await expect.poll(() => byId('shown').textContent).toBe('L');
        expect(ui!.store.get('part').valid).toBe(true);
    });

    it('writes a field bound to the part in the part format', async () => {
        await mountTwoFormats(`
            <input type="hidden" id="part" data-ezclassify-marking data-ezclassify-role="part" value="low">
            <input id="edit" data-ezclassify-controller="marking" data-ezclassify-bound-to="part">`);
        const edit = byId<HTMLInputElement>('edit');

        await expect
            .poll(() => ui!.components.get(edit)?.getRendered())
            .toBe('L');
    });
});

describe('a part whose whole is not on the page', () => {
    it('refuses a whole-only form in a plain input, and in a plain input with no role takes it', async () => {
        await mount(`
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
        await mount(
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

    it('reads a plain input with no id in the part role', async () => {
        root.innerHTML = `<input data-ezclassify-marking data-ezclassify-role="part" value="LOW">`;
        ui = new EzClassifyUI(await context(), { root });
        const input = root.querySelector<HTMLInputElement>('input')!;
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
            await mount(
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
        await mount(
            `<code id="part" data-ezclassify-controller="text" data-ezclassify-role="part">${FORM}</code>`,
        );

        await expect
            .poll(() => byId('part').getAttribute('aria-invalid'))
            .toBe('true');
    });

    it('mounts a marked input in the part role', async () => {
        await mount(
            `<input id="part" data-ezclassify-controller="marked-input" data-ezclassify-role="part" value="">`,
        );
        await expect.poll(() => ui!.mounted.has(byId('part'))).toBe(true);

        const component = ui!.mounted.get(byId('part')) as unknown as {
            options: { resolveContext?: () => unknown };
        };
        expect(component.options.resolveContext?.()).toEqual({ role: 'part' });
    });

    it('feeds no rollup, and a whole beside it still does', async () => {
        await mount(`
            <input type="hidden" id="page" data-ezclassify-aggregate>
            <input id="part" data-ezclassify-controller="marking" data-ezclassify-role="part" value="LOW">
            <input id="plain" data-ezclassify-marking data-ezclassify-role="part" value="LOW">
            <input id="whole" data-ezclassify-marking value="LOW//WHOLE-ONLY">`);
        const page = byId<HTMLInputElement>('page');

        await expect.poll(() => page.value).toBe(FORM);
        const store = ui!.store;
        expect(store.get('part').rendered).toBe('LOW');
        expect(store.get('plain').rendered).toBe('LOW');

        byId<HTMLInputElement>('whole').value = '';
        byId('whole').dispatchEvent(new FocusEvent('blur', { bubbles: true }));

        await expect.poll(() => page.value).toBe('');
    });

    it('leaves its level when the attribute arrives, and rejoins when it goes', async () => {
        await mount(`
            <input type="hidden" id="page" data-ezclassify-aggregate>
            <input id="host" data-ezclassify-marking value="LOW">`);
        const page = byId<HTMLInputElement>('page');
        await expect.poll(() => page.value).toBe('LOW');

        byId('host').setAttribute('data-ezclassify-role', 'part');
        await expect.poll(() => page.value).toBe('');

        byId('host').removeAttribute('data-ezclassify-role');
        await expect.poll(() => page.value).toBe('LOW');
    });

    it('shows its marking to a view, which feeds nothing either', async () => {
        await mount(`
            <input type="hidden" id="page" data-ezclassify-aggregate>
            <input id="part" data-ezclassify-marking data-ezclassify-role="part" value="LOW">
            <output id="shown" data-ezclassify-source="part"></output>`);

        await expect.poll(() => byId('shown').textContent).toBe('LOW');
        expect(byId<HTMLInputElement>('page').value).toBe('');
        expect(errors).toEqual([]);
    });

    it('reads a hidden host in the part role, for its views', async () => {
        await mount(`
            <input type="hidden" id="page" data-ezclassify-aggregate>
            <input type="hidden" id="part" data-ezclassify-marking data-ezclassify-role="part" value="${FORM}">
            <input type="hidden" id="good" data-ezclassify-marking data-ezclassify-role="part" value="LOW">
            <output id="shown" data-ezclassify-source="good"></output>`);
        const store = ui!.store;

        await expect
            .poll(() => store.get('part').errors.map((e) => e.message))
            .toContain(WHOLE_ONLY);
        expect(store.get('part').valid).toBe(false);
        await expect.poll(() => byId('shown').textContent).toBe('LOW');
        expect(store.get('good').valid).toBe(true);
        expect(byId<HTMLInputElement>('page').value).toBe('');
        expect(errors).toEqual([]);
    });

    it('judges a field bound to one in the part role', async () => {
        await mount(`
            <input type="hidden" id="part" data-ezclassify-marking data-ezclassify-role="part" value="LOW">
            <input id="edit" data-ezclassify-controller="marking" data-ezclassify-bound-to="part">`);
        await expect.poll(() => ui!.mounted.has(byId('edit'))).toBe(true);

        const component = ui!.mounted.get(byId('edit')) as unknown as {
            options: { resolveContext?: () => unknown };
        };
        expect(component.options.resolveContext?.()).toEqual({ role: 'part' });
    });

    it('takes its marking and its role out of the store with its host', async () => {
        await mount(`
            <input type="hidden" id="page" data-ezclassify-aggregate>
            <input type="hidden" id="part" data-ezclassify-marking data-ezclassify-role="part" value="LOW">`);
        const store = ui!.store;
        const page = byId<HTMLInputElement>('page');
        await expect.poll(() => store.get('part').rendered).toBe('LOW');

        byId('part').remove();
        await expect.poll(() => store.get('part').rendered).toBe('');

        // The id names nothing now, so a later marking under it is a whole.
        await store.publishRendered('part', 'LOW');
        await expect.poll(() => page.value).toBe('LOW');
    });
});
