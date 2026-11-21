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
        expect(
            document.querySelector(
                '.proto-kbd-hints, .ez-field-hints, .ez-composer__footer',
            ),
        ).toBeNull();
        for (const id of [...TEXT, ...FRAMED]) {
            const keycaps = controlOf(id).querySelectorAll('kbd');
            expect(keycaps.length, id).toBe(
                id === 'mi' || id === 'mta' ? 1 : 0,
            );
            for (const keycap of keycaps)
                expect(
                    keycap.closest(
                        '.marked-input-touch-add, .marked-textarea-touch-add',
                    ),
                ).not.toBeNull();
        }
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
            /border:\s*var\(--ez-border-width, 1px\) solid var\(--ez-color-border, #d1d5db\)/,
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

    it('draws a shared, token-driven focus ring', () => {
        const ring =
            /outline:\s*var\(--ez-focus-ring-width, 2px\) solid\s+var\(--ez-color-border-focus, var\(--ez-color-primary, #fdb827\)\);\s*outline-offset:\s*var\(--ez-focus-ring-offset, -2px\)/;
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

    it('uses the field font size for primary choice labels and marking values', () => {
        const primaryText = [
            ['category-selector.css', '.category-selector-label'],
            ['category-selector.css', '.category-selector-btn'],
            ['category-checklist.css', '.category-checklist-name'],
            ['category-checklist.css', '.category-checklist-label'],
            ['decision-flow.css', '.ez-decision-flow__question-label'],
            ['decision-flow.css', '.ez-decision-flow__option'],
            ['decision-flow.css', '.ez-decision-flow__value'],
        ] as const;
        for (const [file, selector] of primaryText)
            expect(rule(css(file), selector), selector).toContain(
                'font-size: var(--ez-font-size, 1rem)',
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
