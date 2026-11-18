/**
 * Declarative opt-outs for optional guidance surfaces (Progressive Enhancement
 * Contract): `data-ezclassify-no-tooltips` lets a host disable optional
 * tooltips using closest-ancestor semantics and cover ONLY helper surfaces;
 * validation display and core interaction stay non-configurable.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { RemoteContextSchemeEngineAdapter } from '@ezclassify/types';
import { EzClassifyUI } from './ezclassify-ui';
import { parseComponentOptions } from './component-factory';
import { asContext } from '../test-fixtures/as-context';
import { connectDemoContext } from '../../../test-support/demo-runtime';

function wait(ms = 50): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
}

async function createEngine(): Promise<RemoteContextSchemeEngineAdapter> {
    return (
        await connectDemoContext({
            draft: {
                scheme: {
                    scheme: {
                        id: 'optout-test',
                        version: '1.0.0',
                        name: 'Opt-out Test',
                        description: 'Opt-out Test test fixture.',
                        data: {
                            concepts: [
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
                            {
                                pattern: '\\(([^)]+)\\)',
                                template: '({marking}) ',
                            },
                        ],
                        render: {
                            default: 'portion',
                            formats: [
                                {
                                    id: 'portion',
                                    surface: 'marking',
                                    mode: 'inline',
                                    separator: '//',
                                    fields: [
                                        { category: 'level', separator: '/' },
                                    ],
                                },
                            ],
                        },
                    },
                },
            },
        })
    ).scheme as RemoteContextSchemeEngineAdapter;
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
        document.body.appendChild(el);
        const opts = parseComponentOptions(el, {});
        expect(opts.tooltips).toBe(false);
    });

    it('cascades from an ancestor element', () => {
        const wrapper = document.createElement('div');
        wrapper.setAttribute('data-ezclassify-no-tooltips', '');
        const el = document.createElement('input');
        wrapper.appendChild(el);
        document.body.appendChild(wrapper);
        const opts = parseComponentOptions(el, {});
        expect(opts.tooltips).toBe(false);
    });

    it('leaves all surfaces enabled without the attributes', () => {
        const el = document.createElement('input');
        document.body.appendChild(el);
        const opts = parseComponentOptions(el, {});
        expect(opts.tooltips).toBeUndefined();
    });
});

describe('marking action shortcut hints', () => {
    it('keeps the direct marking action and its shortcut without generic navigation instructions', async () => {
        const engine = await createEngine();
        root.innerHTML = `<input type="text" id="mi" data-ezclassify-controller="marked-input">`;
        const forms = new EzClassifyUI(asContext(engine as never), { root });
        activeForms.push(forms);
        await wait(80);
        const action = root.querySelector<HTMLButtonElement>(
            '.marked-input-touch-add',
        )!;
        expect(action).not.toBeNull();
        expect(action.getAttribute('aria-label')).toBe('Set marking');
        expect(action.querySelector('kbd')?.textContent).toMatch(
            /^(⌘|Ctrl)\+Enter$/,
        );
        expect(action.querySelector('kbd')?.getAttribute('aria-hidden')).toBe(
            'true',
        );
        expect(action.getAttribute('aria-keyshortcuts')).toMatch(
            /(?:Meta|Control)\+Enter/,
        );
        expect(action.title).toContain('Enter');
        expect(
            root.querySelector(
                '.marked-input-kb-hint, .proto-kbd-hints, .ez-field-hints, .ez-composer__footer',
            ),
        ).toBeNull();
    });
});

describe('data-ezclassify-no-tooltips', () => {
    it('turns shouldShowTooltip off for the enhanced component', async () => {
        const engine = await createEngine();
        root.innerHTML = `<input id="ac" data-ezclassify-controller="tags" data-ezclassify-no-tooltips type="text" value="" />`;
        const forms = new EzClassifyUI(asContext(engine as never), { root });
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
