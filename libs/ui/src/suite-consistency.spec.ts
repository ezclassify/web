/**
 * One EzClassify suite: every editing control carries the same field frame, the
 * same trailing chrome (the status mark, and clear where the control has no
 * clear action of its own) and the same focus ring, from one implementation.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { EzClassifyUI } from './ezclassify-ui';
import { loadMultiScopeRegression } from '../test-fixtures/load-multi-scope-regression';
import { asContext } from '../test-fixtures/as-context';
import { demoRuntimeSettled } from '../../../test-support/demo-runtime';

const here = dirname(fileURLToPath(import.meta.url));
const css = (file: string) =>
    readFileSync(join(here, 'components', file), 'utf8').replace(
        /\/\*[\s\S]*?\*\//g,
        '',
    );
/** The declarations of the first rule whose selector list is `selector`. */
const rule = (source: string, selector: string) =>
    source.match(
        new RegExp(
            `(?:^|\\})\\s*${selector.replace(/[.()*+?:[\]>-]/g, '\\$&')}\\s*\\{([^}]*)\\}`,
        ),
    )?.[1] ?? '';

let ui: EzClassifyUI | undefined;
afterEach(() => {
    ui?.destroy();
    ui = undefined;
    document.body.innerHTML = '';
});

/** A plain host form holding all eight controls beside ordinary inputs. */
async function mountSuite(): Promise<HTMLElement> {
    document.body.innerHTML = `
      <form id="root">
        <input type="hidden" id="doc" data-ezclassify-marking value="ST">
        <label for="name">Name</label><input id="name" type="text">
        <input id="mf" type="text" data-ezclassify-controller="marking" data-ezclassify-bound-to="doc">
        <input id="ti" type="text" data-ezclassify-controller="tags" data-ezclassify-bound-to="doc">
        <input id="mi" type="text" value="(ST) Title" data-ezclassify-controller="marked-input">
        <textarea id="mta" data-ezclassify-controller="marked-textarea">(ST) Body.</textarea>
        <div id="df" data-ezclassify-controller="decisionflow" data-ezclassify-bound-to="doc"></div>
        <input id="ss" type="text" data-ezclassify-controller="select" data-ezclassify-facet-of="doc" data-ezclassify-category="level">
        <fieldset id="cs" data-ezclassify-controller="selector" data-ezclassify-facet-of="doc" data-ezclassify-category="status"></fieldset>
        <fieldset id="cl" data-ezclassify-controller="checklist" data-ezclassify-facet-of="doc" data-ezclassify-category="artifact"></fieldset>
        <button type="submit">Save</button>
      </form>`;
    const engine = await loadMultiScopeRegression();
    const root = document.querySelector<HTMLElement>('#root')!;
    ui = new EzClassifyUI(asContext(engine), { root });
    await demoRuntimeSettled();
    await new Promise((resolve) => setTimeout(resolve, 30));
    await demoRuntimeSettled();
    return root;
}

/** The box a control draws: its mount beside the host, or the host's wrap. */
function controlOf(id: string): HTMLElement {
    const host = document.getElementById(id)!;
    const mount = host.nextElementSibling as HTMLElement | null;
    if (mount?.hasAttribute('data-ezclassify-mount')) return mount;
    return host.closest<HTMLElement>(
        '.marking-field-wrap, .tag-input-wrap, .marked-input-wrap, .marked-textarea-wrap',
    )!;
}

describe('the EzClassify suite', () => {
    const FRAMED = ['ti', 'df', 'ss', 'cs', 'cl'];
    const TEXT = ['mf', 'mi', 'mta'];

    it('gives every one of the eight controls the shared chrome with one status mark', async () => {
        await mountSuite();
        for (const id of [...TEXT, ...FRAMED]) {
            const control = controlOf(id);
            const chrome = control.querySelectorAll('.ez-field-chrome');
            expect(chrome.length, id).toBe(1);
            expect(
                chrome[0].querySelectorAll('.ez-status-mark').length,
                id,
            ).toBe(1);
            // Clear sits after the mark, except on the checklist, whose
            // Clear all is its clear.
            expect(
                chrome[0].querySelectorAll('.ez-clear-button').length,
                id,
            ).toBe(id === 'cl' ? 0 : 1);
        }
    });

    it('frames the controls without a text field of their own in the shared field frame', async () => {
        await mountSuite();
        for (const id of FRAMED) {
            expect(
                controlOf(id).querySelectorAll('.ez-field-frame').length +
                    (controlOf(id).classList.contains('ez-field-frame')
                        ? 1
                        : 0),
                id,
            ).toBe(1);
        }
    });

    it('draws the shared frame from the tokens, at the weight of a plain input', () => {
        const frame = rule(css('field-chrome.css'), '.ez-field-frame');
        expect(frame).toMatch(
            /border:\s*1px solid var\(--ez-color-border, #d1d5db\)/,
        );
        expect(frame).toMatch(
            /border-radius:\s*var\(--ez-border-radius, 0\.25rem\)/,
        );
        expect(frame).toMatch(/background:\s*var\(--ez-color-background/);
        expect(frame).toMatch(/padding:\s*0\.375rem 0\.5rem/);
        expect(frame).toMatch(/min-height:\s*2rem/);
        // No panel: nothing a plain input does not draw.
        expect(frame).not.toMatch(/box-shadow/);
        // The single-line text fields share the frame's height.
        expect(
            rule(css('marking-field.css'), '.marking-field-display'),
        ).toMatch(/min-height:\s*2rem/);
    });

    it('draws one focus ring for every control: 2px of the accent, inside the edge', () => {
        const ring =
            /outline:\s*2px solid var\(--ez-color-primary, #fdb827\);\s*outline-offset:\s*-2px/;
        expect(
            rule(
                css('field-chrome.css'),
                '.ez-field-frame:focus-within:not(:has(.ez-field-chrome :focus))',
            ),
        ).toMatch(ring);
        expect(
            rule(css('marking-field.css'), '.marking-field-host:focus'),
        ).toMatch(ring);
    });

    it('shows the key-hint row while a control has focus, and hides it on a touch screen', () => {
        const utils = css('component-utils.css');
        expect(
            rule(utils, ':focus-within > .proto-kbd-hints.ez-field-hints'),
        ).toMatch(/display:\s*flex/);
        const coarse = utils.slice(utils.indexOf('@media (pointer: coarse)'));
        // The hint rows are hidden there, and nothing lays them over the page.
        expect(coarse).toMatch(
            /\.proto-kbd-hints,\s*:focus-within > \.proto-kbd-hints\.ez-field-hints\s*\{\s*display:\s*none;\s*\}/,
        );
    });

    it("lets a framed control take a text host's own edge, as the text fields do", async () => {
        const style = document.createElement('style');
        style.textContent =
            '#ss, #ti { border: 3px solid rgb(1, 2, 3); padding: 9px 11px; }';
        document.head.appendChild(style);
        try {
            await mountSuite();
            for (const id of ['ss', 'ti']) {
                const frame = controlOf(id).classList.contains('ez-field-frame')
                    ? controlOf(id)
                    : controlOf(id).querySelector<HTMLElement>(
                          '.ez-field-frame',
                      )!;
                expect(
                    frame.style.borderTopWidth || frame.style.borderWidth,
                    id,
                ).toBe('3px');
                expect(frame.style.paddingLeft, id).toBe('11px');
            }
        } finally {
            style.remove();
        }
    });
});
