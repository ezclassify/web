/**
 * Coverage for the initial store seed against a BODY EDITOR host.
 *
 * `seedStoreFromHosts` pushes each marking host's current value into the store
 * so subscribers see the right initial state. A `marked-input` or
 * `marked-textarea` is its own marking host, but its `.value` is prose with a
 * mark embedded in it, not a marking. Publishing that whole string as a
 * rendered marking makes the engine read nothing, the store commits an empty
 * assertion set, and the component's own store subscription writes that empty
 * set straight back over the mark the author typed.
 *
 * Skipping body editors outright is the wrong repair: the same seed is what
 * puts a standalone marked input's assertions into the page aggregate, so a
 * skipped host would leave the aggregate blind to a mark that is right there on
 * the page. The seed reads the mark instead of the body.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { LocalSchemeEngineAdapter } from '@ezclassify/types';
import { Context } from '@ezclassify/engine';
import { EzClassifyUI } from './ezclassify-ui';
import { MarkedInput } from './components/marked-input';

function wait(ms = 30): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
}

/** Engine with an embedded-marking pattern so marked fields can scan segments. */
function createMarkedEngine(): LocalSchemeEngineAdapter {
    return Context.fromComponents({
        scheme: {
            scheme: {
                id: 'marked-seed-test',
                version: '1.0.0',
                name: 'Marked Seed Test',
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

describe('the initial seed reads a body editor mark, never its body', () => {
    it('leaves an authored mark on the field after mount', async () => {
        const engine = createMarkedEngine();
        root.innerHTML = `<div class="field"><input type="text" id="mi-seed" data-ezclassify-controller="marked-input" value="(S) quarterly report"></div>`;
        const forms = new EzClassifyUI(engine as never, { root });
        activeForms.push(forms);
        await wait(200);

        const el = document.getElementById('mi-seed') as HTMLTextAreaElement;
        expect(el.value).toBe('(S) quarterly report');
    });

    it('seeds the store with the mark the field carries, not an empty set', async () => {
        const engine = createMarkedEngine();
        root.innerHTML = `<div class="field"><input type="text" id="mi-seed" data-ezclassify-controller="marked-input" value="(S) quarterly report"></div>`;
        const forms = new EzClassifyUI(engine as never, { root });
        activeForms.push(forms);
        await wait(200);

        const state = forms.store.get('mi-seed');
        expect(state.assertions.map((a) => a.conceptId)).toEqual(['S']);
        // The store holds the MARKING, so its rendered form is the mark alone.
        // The prose stays on the field and never becomes store state.
        expect(state.rendered).toBe('S');
    });

    it('keeps the component assertions the field parsed for itself', async () => {
        const engine = createMarkedEngine();
        root.innerHTML = `<div class="field"><input type="text" id="mi-seed" data-ezclassify-controller="marked-input" value="(S) quarterly report"></div>`;
        const forms = new EzClassifyUI(engine as never, { root });
        activeForms.push(forms);
        await wait(200);

        const el = document.getElementById('mi-seed') as HTMLTextAreaElement;
        const comp = forms.components.get(el) as MarkedInput;
        expect(comp).toBeInstanceOf(MarkedInput);
        expect(comp.getAssertions().map((a) => a.conceptId)).toEqual(['S']);
    });

    it('still contributes a standalone marked input to the page aggregate', async () => {
        // The reason a body editor cannot simply be skipped: this seed is the
        // only thing that puts an already-authored mark into the aggregate
        // before the user touches anything.
        const engine = createMarkedEngine();
        root.innerHTML = `<div class="field"><input type="text" id="mi-seed" data-ezclassify-controller="marked-input" value="(S) quarterly report"></div>`;
        const forms = new EzClassifyUI(engine as never, { root });
        activeForms.push(forms);
        await wait(200);

        const aggregate = forms.store.getAggregate();
        expect(aggregate.assertions.some((a) => a.conceptId === 'S')).toBe(
            true,
        );
    });

    it('commits an empty body editor once so facet subscribers get their signal', async () => {
        const engine = createMarkedEngine();
        root.innerHTML = `<div class="field"><input type="text" id="mi-empty" data-ezclassify-controller="marked-input"></div>`;
        const forms = new EzClassifyUI(engine as never, { root });
        activeForms.push(forms);

        const seen: number[] = [];
        forms.store.subscribe('mi-empty', (s) =>
            seen.push(s.assertions.length),
        );
        await wait(200);

        expect(seen).toContain(0);
        expect(forms.store.get('mi-empty').assertions).toHaveLength(0);
    });

    it('seeds a plain rendered host from its raw value, unchanged', async () => {
        // The control: a host that is NOT a body editor holds a marking string
        // and nothing else, so the raw value is exactly what the store wants.
        const engine = createMarkedEngine();
        root.innerHTML = `<input id="plain-host" data-ezclassify-rendered value="S" />`;
        const forms = new EzClassifyUI(engine as never, { root });
        activeForms.push(forms);
        await wait(200);

        const state = forms.store.get('plain-host');
        expect(state.assertions.map((a) => a.conceptId)).toEqual(['S']);
    });
});
