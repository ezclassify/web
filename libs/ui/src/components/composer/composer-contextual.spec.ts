/**
 * What the list offers only because of what the draft holds. A scheme can offer
 * a concept only once something in the marking calls for it, such as a
 * sub-control under the control it belongs to. The catalog, asked with nothing
 * chosen, lists the category but not that concept, so the list asks again with
 * the draft's own facts whenever they change.
 *
 * Driven through MarkingField over a real engine.
 */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Context } from '@ezclassify/engine';
import { EzClassifyUI } from '../../ezclassify-ui';
import { openSurface, press, rowLabels, wait } from './composer-harness';

const concept = (
    id: string,
    label: string,
    category: string,
    position: number,
    parents: string[] = [],
) => ({
    id,
    name: label,
    views: { default: label },
    categories: [category],
    parents,
    aliases: [],
    position,
    rank: position,
});

/** A level, and controls of which SI-G belongs to SI. */
function createContext() {
    return Context.fromComponents({
        scheme: {
            scheme: {
                id: 'composer-contextual',
                version: '1.0.0',
                name: 'Composer Contextual',
                data: {
                    concepts: {
                        inline: [
                            concept('U', 'UNCLASSIFIED', 'level', 1),
                            concept('S', 'SECRET', 'level', 2),
                            concept('SI', 'SI', 'control', 1),
                            concept('SIG', 'SI-G', 'control', 2, ['SI']),
                            concept('TK', 'TK', 'control', 3),
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
                        {
                            id: 'control',
                            label: 'Control',
                            required: false,
                            single: false,
                            rollup: 'union',
                            position: 2,
                        },
                    ],
                },
                rules: [],
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
                                { category: 'control', separator: '/' },
                            ],
                        },
                    ],
                },
            },
        },
    });
}

let root: HTMLDivElement;
let forms: EzClassifyUI | null = null;

beforeEach(() => {
    root = document.createElement('div');
    document.body.appendChild(root);
    Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
    forms?.destroy();
    forms = null;
    root.remove();
});

it('lists a concept its parent calls for once the parent is in the draft, in a category the catalog already lists', async () => {
    root.innerHTML =
        '<input type="hidden" id="doc" data-ezclassify-rendered /><label for="f">Marking</label><textarea id="f" data-ezclassify-controller="marking" data-ezclassify-bound-to="doc"></textarea>';
    forms = new EzClassifyUI(createContext() as never, { root });
    await wait();
    await forms.store.publishRendered('doc', 'SECRET//SI');
    await wait();
    const input = document.getElementById('f') as HTMLTextAreaElement;
    input.focus();
    press(input, 'ArrowDown');
    await wait(200);

    expect(openSurface()).not.toBeNull();
    expect(rowLabels()).toContain('SI-G');
});
