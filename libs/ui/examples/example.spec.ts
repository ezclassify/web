/**
 * @vitest-environment jsdom
 *
 * EzClassify Forms library, end-to-end example spec: the page rollup a host
 * places, over a Context the demo runtime composes from the profile below.
 * The runtime's answers replay from this spec's recordings
 * (test-support/demo-runtime.ts).
 *
 * Run from the repository root:
 *   npx vitest run libs/ui/examples
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { EzClassifyUI } from '@ezclassify/ui';
import { connectDemoContext } from '../../../test-support/demo-runtime';

// ---------------------------------------------------------------------------
// Shared profile fixture, generic two-level composition profile
// ---------------------------------------------------------------------------
const PROFILE = {
    scheme: {
        id: 'forms-example',
        version: '1.0.0',
        name: 'Forms Example',
        description: 'Example profile for forms library e2e spec',
        data: {
            categories: [
                {
                    id: 'level',
                    label: 'Level',
                    required: true,
                    single: true,
                    rollup: 'max',
                    position: 0,
                },
                {
                    id: 'controls',
                    label: 'Controls',
                    required: false,
                    single: false,
                    rollup: 'union',
                    position: 1,
                },
            ],
            concepts: [
                {
                    id: 'LOW',
                    name: 'Low',
                    views: { default: 'LOW', short: 'L' },
                    categories: ['level'],
                    parents: [],
                    position: 0,
                    rank: 0,
                },
                {
                    id: 'MED',
                    name: 'Medium',
                    views: { default: 'MED', short: 'M' },
                    categories: ['level'],
                    parents: [],
                    position: 1,
                    rank: 1,
                },
                {
                    id: 'HIGH',
                    name: 'High',
                    views: { default: 'HIGH', short: 'H' },
                    categories: ['level'],
                    parents: [],
                    position: 2,
                    rank: 2,
                },
                {
                    id: 'CTRL-A',
                    name: 'Control A',
                    views: { default: 'CTRL-A' },
                    categories: ['controls'],
                    parents: ['HIGH'],
                    position: 0,
                },
                {
                    id: 'CTRL-B',
                    name: 'Control B',
                    views: { default: 'CTRL-B' },
                    categories: ['controls'],
                    parents: [],
                    position: 1,
                },
            ],
        },
        rules: [],
        render: {
            default: 'default',
            formats: [
                {
                    id: 'default',
                    surface: 'marking',
                    mode: 'inline',
                    separator: '/',
                    fields: [
                        { category: 'level' },
                        { category: 'controls', separator: '/' },
                    ],
                },
            ],
        },
    },
};

// ---------------------------------------------------------------------------
// Helper, create a root div and append it to body for jsdom tests
// ---------------------------------------------------------------------------
function makeRoot(): HTMLDivElement {
    const div = document.createElement('div');
    document.body.appendChild(div);
    return div;
}

// ---------------------------------------------------------------------------
// Rollup, EzClassifyUI multi-field aggregate
// ---------------------------------------------------------------------------
describe('Rollup: EzClassifyUI multi-field', () => {
    let root: HTMLDivElement;
    let forms: EzClassifyUI | null;

    beforeEach(() => {
        root = makeRoot();
        forms = null;
    });

    afterEach(() => {
        forms?.destroy();
        root.remove();
    });

    it('adds no input the host did not place', async () => {
        forms = new EzClassifyUI(
            await connectDemoContext({ draft: { scheme: PROFILE } }),
            {
                root,
            },
        );
        expect(root.querySelector('input')).toBeNull();
    });

    it('shows the page rollup in a hidden output the host places', async () => {
        root.innerHTML = `
            <input id="a" data-ezclassify-marking value="LOW">
            <input id="b" data-ezclassify-marking value="HIGH/CTRL-B">
            <input type="hidden" name="pageMarking" data-ezclassify-aggregate>`;
        const output = root.querySelector<HTMLInputElement>(
            'input[name="pageMarking"]',
        )!;
        forms = new EzClassifyUI(
            await connectDemoContext({ draft: { scheme: PROFILE } }),
            {
                root,
            },
        );
        await expect
            .poll(async () => {
                await forms!.recalculate();
                return output.value;
            })
            .toBe('HIGH/CTRL-B');
        expect(
            forms.store.getAggregate().byBucket.values().next().value?.rendered,
        ).toBe('HIGH/CTRL-B');
    });

    it('destroy() leaves the output the host placed in the page', async () => {
        root.innerHTML =
            '<input type="hidden" name="pageMarking" data-ezclassify-aggregate>';
        forms = new EzClassifyUI(
            await connectDemoContext({ draft: { scheme: PROFILE } }),
            {
                root,
            },
        );
        forms.destroy();
        expect(root.querySelector('input[name="pageMarking"]')).toBeTruthy();
        forms = null;
    });
});
