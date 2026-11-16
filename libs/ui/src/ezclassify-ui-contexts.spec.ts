/**
 * An `EzClassifyUI` marks every element with the Context its markup resolves:
 * the nearest `data-ezclassify-context` among several, or the only Context.
 * These specs mount real fields and read which Context each one was handed.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { ContextAdapter } from '@ezclassify/types';
import { EzClassifyUI } from './ezclassify-ui';
import { connectDemoContext } from '../../../test-support/demo-runtime';

function waitForReady(root: HTMLElement): Promise<void> {
    return new Promise((resolve) => {
        root.addEventListener('ezclassify:ready', () => resolve(), {
            once: true,
        });
    });
}

/** The Context a mounted component on `el` was initialized with. */
function contextOf(
    forms: EzClassifyUI,
    el: HTMLElement,
): ContextAdapter | null {
    const component = forms.components.get(el) as unknown as
        { context: ContextAdapter | null } | undefined;
    return component?.context ?? null;
}

function field(parent: HTMLElement, id: string): HTMLInputElement {
    const input = document.createElement('input');
    input.id = id;
    input.setAttribute('data-ezclassify-controller', 'marking');
    parent.appendChild(input);
    return input;
}

describe('EzClassifyUI Contexts', () => {
    let root: HTMLDivElement;
    let forms: EzClassifyUI | null;

    beforeEach(() => {
        document.body.innerHTML = '';
        root = document.createElement('div');
        document.body.appendChild(root);
        forms = null;
    });

    afterEach(() => {
        forms?.destroy();
    });

    it('mounts each field with the Context its nearest data-ezclassify-context names', async () => {
        const first = await connectDemoContext({ contextId: 'cedar-valley' });
        const second = await connectDemoContext({ contextId: 'cedar-valley' });
        root.setAttribute('data-ezclassify-context', 'first');
        const outer = field(root, 'outer');
        const section = document.createElement('section');
        section.setAttribute('data-ezclassify-context', 'second');
        root.appendChild(section);
        const inner = field(section, 'inner');

        const ready = waitForReady(root);
        forms = new EzClassifyUI({ contexts: { first, second } }, { root });
        await ready;

        expect(contextOf(forms, outer)).toBe(first);
        expect(contextOf(forms, inner)).toBe(second);
    });

    it('leaves a field no ancestor assigns a Context unenhanced, as a host error', async () => {
        const errors: Array<{ code: string; message: string }> = [];
        root.addEventListener('ezclassify:host-error', (e) =>
            errors.push((e as CustomEvent).detail),
        );
        const orphan = field(root, 'orphan');

        const ready = waitForReady(root);
        forms = new EzClassifyUI(
            {
                contexts: {
                    first: await connectDemoContext({
                        contextId: 'cedar-valley',
                    }),
                    second: await connectDemoContext({
                        contextId: 'cedar-valley',
                    }),
                },
            },
            { root },
        );
        await ready;

        expect(forms.components.has(orphan)).toBe(false);
        expect(errors).toHaveLength(1);
        expect(errors[0].code).toBe('context-unresolved');
        expect(errors[0].message).toContain("'first', 'second'");
    });

    describe('a level view on a page with two Contexts and no wrapper', () => {
        const MARKING = 'CONFIDENTIAL';
        const contexts = async () => ({
            contexts: {
                first: await connectDemoContext({ contextId: 'cedar-valley' }),
                second: await connectDemoContext({ contextId: 'cedar-valley' }),
            },
        });

        /** Mount `first` and `second` sections with a view beside them. */
        async function mountBeside(view: string) {
            const errors: Array<{ code: string; message: string }> = [];
            root.addEventListener('ezclassify:host-error', (e) =>
                errors.push((e as CustomEvent).detail),
            );
            root.innerHTML = `
                ${view}
                <section data-ezclassify-context="first">
                    <input id="a" data-ezclassify-marking value="${MARKING}">
                </section>
                <section data-ezclassify-context="second">
                    <input id="b" data-ezclassify-marking value="${MARKING}">
                </section>`;
            const ready = waitForReady(root);
            forms = new EzClassifyUI(await contexts(), { root });
            await ready;
            return errors;
        }

        it('shows every bucket on a bare banner, each labeled', async () => {
            const errors = await mountBeside(
                '<div id="banner" data-ezclassify-controller="banner" data-ezclassify-aggregate></div>',
            );
            const banner = root.querySelector<HTMLElement>('#banner')!;

            await expect
                .poll(() => banner.textContent?.split(MARKING).length)
                .toBe(3);
            expect(errors).toEqual([]);
            expect(forms!.components.has(banner)).toBe(true);
            expect(banner.textContent).toContain('first');
            expect(banner.textContent).toContain('second');
        });

        it('still needs a Context for a view that holds one value', async () => {
            const errors = await mountBeside(
                '<code id="one" data-ezclassify-controller="text" data-ezclassify-aggregate></code>',
            );

            expect(errors.map((e) => e.code)).toEqual(['context-unresolved']);
            expect(
                forms!.components.has(root.querySelector<HTMLElement>('#one')!),
            ).toBe(false);
        });
    });

    it('mounts every field with the only Context when given one', async () => {
        const context = await connectDemoContext({ contextId: 'cedar-valley' });
        const only = field(root, 'only');

        const ready = waitForReady(root);
        forms = new EzClassifyUI(context, { root });
        await ready;

        expect(contextOf(forms, only)).toBe(context);
    });

    it('refuses a scheme view in place of a Context', async () => {
        const context = await connectDemoContext({ contextId: 'cedar-valley' });
        expect(
            () =>
                new EzClassifyUI(context.scheme as never, {
                    root,
                }),
        ).toThrow(TypeError);
    });
});
