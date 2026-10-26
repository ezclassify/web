/**
 * Declarative opt-outs for optional guidance surfaces (Progressive Enhancement
 * Contract): `data-ezclassify-no-tooltips` and `data-ezclassify-no-hints` let a
 * host disable tooltips and keyboard-hint chrome. They use closest-ancestor
 * semantics and cover ONLY helper surfaces; validation display and core
 * interaction stay non-configurable.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { LocalSchemeEngineAdapter } from '@ezclassify/types';
import { Context } from '@ezclassify/engine';
import { EzClassifyUI } from './ezclassify-ui';
import { parseComponentOptions } from './component-factory';

function wait(ms = 50): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
}

function createEngine(): LocalSchemeEngineAdapter {
    return Context.fromComponents({
        scheme: {
            scheme: {
                id: 'optout-test',
                version: '1.0.0',
                name: 'Opt-out Test',
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
    document.body.innerHTML = '';
    root = document.createElement('div');
    document.body.appendChild(root);
});

afterEach(() => {
    vi.restoreAllMocks();
    while (activeForms.length > 0) activeForms.pop()!.destroy();
    document.body.innerHTML = '';
});

describe('parseComponentOptions opt-out harvesting', () => {
    it('reads the opt-outs from the host element', () => {
        const el = document.createElement('input');
        el.setAttribute('data-ezclassify-no-tooltips', '');
        el.setAttribute('data-ezclassify-no-hints', '');
        document.body.appendChild(el);
        const opts = parseComponentOptions(el, {});
        expect(opts.tooltips).toBe(false);
        expect(opts.hints).toBe(false);
    });

    it('cascades from an ancestor element', () => {
        const wrapper = document.createElement('div');
        wrapper.setAttribute('data-ezclassify-no-tooltips', '');
        const el = document.createElement('input');
        wrapper.appendChild(el);
        document.body.appendChild(wrapper);
        const opts = parseComponentOptions(el, {});
        expect(opts.tooltips).toBe(false);
        // Hints stay enabled (undefined) without their attribute.
        expect(opts.hints).toBeUndefined();
    });

    it('leaves all surfaces enabled without the attributes', () => {
        const el = document.createElement('input');
        document.body.appendChild(el);
        const opts = parseComponentOptions(el, {});
        expect(opts.tooltips).toBeUndefined();
        expect(opts.hints).toBeUndefined();
    });
});

describe('data-ezclassify-no-hints', () => {
    it('suppresses the marked-input keyboard hint but keeps the touch affordance', async () => {
        const engine = createEngine();
        root.innerHTML = `<input type="text" id="mi" data-ezclassify-controller="marked-input" data-ezclassify-no-hints>`;
        const forms = new EzClassifyUI(engine as never, { root });
        activeForms.push(forms);
        await wait(80);

        expect(root.querySelector('.marked-input-kb-hint')).toBeNull();
        // Core interaction affordances are not configuration choices.
        expect(root.querySelector('.marked-input-touch-add')).not.toBeNull();
    });

    it('keeps the marked-input keyboard hint without the attribute', async () => {
        const engine = createEngine();
        root.innerHTML = `<input type="text" id="mi" data-ezclassify-controller="marked-input">`;
        const forms = new EzClassifyUI(engine as never, { root });
        activeForms.push(forms);
        await wait(80);

        expect(root.querySelector('.marked-input-kb-hint')).not.toBeNull();
    });

    it('hides the tag-input hint chrome via an ancestor attribute', async () => {
        const engine = createEngine();
        root.innerHTML = `
      <div data-ezclassify-no-hints>
        <input id="ac" data-ezclassify-controller="tags" type="text" value="" />
      </div>`;
        const forms = new EzClassifyUI(engine as never, { root });
        activeForms.push(forms);
        await wait(80);

        const hints = document.querySelector(
            '.proto-kbd-hints',
        ) as HTMLElement | null;
        expect(hints).not.toBeNull();
        expect(hints!.style.display).toBe('none');
    });
});

describe('data-ezclassify-no-tooltips', () => {
    it('turns shouldShowTooltip off for the enhanced component', async () => {
        const engine = createEngine();
        root.innerHTML = `<input id="ac" data-ezclassify-controller="tags" data-ezclassify-no-tooltips type="text" value="" />`;
        const forms = new EzClassifyUI(engine as never, { root });
        activeForms.push(forms);
        await wait(80);

        const acEl = document.getElementById('ac') as HTMLInputElement;
        const comp = (
            forms as unknown as {
                autocompleters: Map<
                    HTMLInputElement,
                    { shouldShowTooltip(): boolean }
                >;
            }
        ).autocompleters.get(acEl)!;
        expect(comp).toBeDefined();
        expect(
            (
                comp as unknown as { shouldShowTooltip(): boolean }
            ).shouldShowTooltip(),
        ).toBe(false);
    });
});
