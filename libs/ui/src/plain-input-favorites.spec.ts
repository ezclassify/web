import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { schemeOnlyContext } from '../test-fixtures/context-doubles';
import { labelRecordStandIn } from '../test-fixtures/label-record-stand-in';
import { EzClassifyUI } from './ezclassify-ui';
import { VanillaEzClassifyStore } from './store/ezclassify-store';
import { GuideChecklist } from './components/guide-helper';
import type {
    Assertion,
    EvaluationResult,
    GuideStructuralView,
} from '@ezclassify/types';
import { cleanupTooltipForRoot } from './components/tooltip-manager';

const settle = () => new Promise((resolve) => setTimeout(resolve, 100));
let root: HTMLFormElement;
let forms: EzClassifyUI | null;

beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn();
    root = document.createElement('form');
    root.innerHTML =
        '<input id="whole" type="hidden" data-ezclassify-marking value="HIGH"><label for="plain">Classification</label><input id="plain" name="classification" required maxlength="80" data-ezclassify-bound-to="whole"><input id="tags" data-ezclassify-controller="tags" data-ezclassify-bound-to="whole"><button type="button" id="outside">Next</button>';
    document.body.append(root);
    forms = null;
});
afterEach(() => {
    forms?.destroy();
    cleanupTooltipForRoot(root);
    root.remove();
});

async function mount(
    load = () => [{ marking: 'HIGH//GROUP' }],
    save = vi.fn(),
) {
    const input = root.querySelector<HTMLInputElement>('#plain')!;
    forms = new EzClassifyUI(schemeOnlyContext(labelRecordStandIn() as never), {
        root,
        favorites: { load, save },
    });
    await settle();
    const mark =
        input.parentElement!.querySelector<HTMLButtonElement>(
            '.ez-status-mark',
        )!;
    return { input, mark, save };
}

function ownPopup(mark: HTMLElement): HTMLElement {
    return document.getElementById(mark.getAttribute('aria-describedby')!)!;
}

describe('plain marking input tools', () => {
    it('hands a collapsed text end to branding and back without committing its draft', async () => {
        const { input, mark } = await mount();
        input.focus();
        input.value = 'LOW';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.setSelectionRange(input.value.length, input.value.length);
        const right = new KeyboardEvent('keydown', {
            key: 'ArrowRight',
            bubbles: true,
            cancelable: true,
        });
        input.dispatchEvent(right);
        expect(right.defaultPrevented).toBe(true);
        expect(document.activeElement).toBe(mark);
        await settle();
        expect(mark.getAttribute('aria-expanded')).toBe('false');
        expect(input.value).toBe('LOW');
        expect(forms!.store.get('whole').rendered).toBe('HIGH');
        const left = new KeyboardEvent('keydown', {
            key: 'ArrowLeft',
            bubbles: true,
            cancelable: true,
        });
        mark.dispatchEvent(left);
        expect(left.defaultPrevented).toBe(true);
        expect(document.activeElement).toBe(input);
        expect(input.selectionStart).toBe(input.value.length);
        expect(input.selectionEnd).toBe(input.value.length);
        expect(forms!.store.get('whole').rendered).toBe('HIGH');
    });

    it('leaves native text selection, start boundaries and modified keys alone', async () => {
        const { input } = await mount();
        input.focus();
        for (const state of [
            { start: 0, end: 0, key: 'ArrowLeft' },
            { start: 1, end: 1, key: 'ArrowRight' },
            { start: 0, end: input.value.length, key: 'ArrowRight' },
            {
                start: input.value.length,
                end: input.value.length,
                key: 'ArrowRight',
                shiftKey: true,
            },
            {
                start: input.value.length,
                end: input.value.length,
                key: 'ArrowRight',
                ctrlKey: true,
            },
            {
                start: input.value.length,
                end: input.value.length,
                key: 'ArrowRight',
                metaKey: true,
            },
        ]) {
            input.setSelectionRange(state.start, state.end);
            const event = new KeyboardEvent('keydown', {
                ...state,
                bubbles: true,
                cancelable: true,
            });
            input.dispatchEvent(event);
            expect(event.defaultPrevented).toBe(false);
            expect(document.activeElement).toBe(input);
        }
    });

    it.each(['ctrlKey', 'metaKey'] as const)(
        'holds raw text while tools have focus through %s, saves the store marking, and commits on actual exit',
        async (modifier) => {
            const original = root.querySelector<HTMLInputElement>('#plain')!;
            const { input, mark, save } = await mount();
            expect(input).toBe(original);
            input.focus();
            input.value = 'LOW';
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(
                new KeyboardEvent('keydown', {
                    key: 'Enter',
                    shiftKey: true,
                    [modifier]: true,
                    bubbles: true,
                    cancelable: true,
                }),
            );
            await settle();
            expect(document.activeElement?.getAttribute('role')).toBe('tab');
            expect(input.value).toBe('LOW');
            expect(forms!.store.get('whole').rendered).toBe('HIGH');
            const popup = ownPopup(mark);
            popup
                .querySelector<HTMLButtonElement>(
                    '.ez-favorites-panel__pinned',
                )!
                .click();
            await settle();
            expect(save).toHaveBeenCalledWith('HIGH', expect.any(Object));
            expect(forms!.store.get('whole').rendered).toBe('HIGH');
            expect(input.value).toBe('LOW');
            popup
                .querySelector<HTMLButtonElement>('.ez-marking-tools__close')!
                .click();
            await settle();
            expect(document.activeElement).toBe(mark);
            expect(input.value).toBe('LOW');
            root.querySelector<HTMLButtonElement>('#outside')!.focus();
            await settle();
            expect(forms!.store.get('whole').rendered).toBe('LOW//STD');
            expect(input.value).toBe('LOW//STD');
            expect(root.querySelector<HTMLInputElement>('#tags')!.value).toBe(
                'LOW//STD',
            );
            expect(input.labels?.[0].textContent).toBe('Classification');
            expect(input.name).toBe('classification');
            expect(input.required).toBe(true);
            expect(input.maxLength).toBe(80);
            expect(root.elements.namedItem('classification')).toBe(input);
        },
    );

    it('keeps a draft when keyboard focus reaches branding before the tools open', async () => {
        const { input, mark } = await mount();
        input.focus();
        input.value = 'LOW';
        mark.focus();
        await settle();
        expect(forms!.store.get('whole').rendered).toBe('HIGH');
        expect(input.value).toBe('LOW');
        expect(mark.getAttribute('aria-expanded')).toBe('false');
        mark.click();
        await settle();
        expect(document.activeElement?.getAttribute('role')).toBe('tab');
        expect(forms!.store.get('whole').rendered).toBe('HIGH');
        expect(input.value).toBe('LOW');
    });

    it('applies the full Favorite through the store and preserves normal input events and teardown', async () => {
        const { input, mark } = await mount();
        const changed = vi.fn();
        input.addEventListener('input', changed);
        input.focus();
        input.value = 'LOW';
        mark.click();
        await settle();
        expect(forms!.store.get('whole').rendered).toBe('HIGH');
        ownPopup(mark)
            .querySelector<HTMLButtonElement>(
                '[data-favorite-marking="HIGH//GROUP"]',
            )!
            .click();
        await settle();
        expect(forms!.store.get('whole').rendered).toBe('HIGH//GROUP/ANCHOR');
        expect(input.value).toBe('HIGH//GROUP/ANCHOR');
        expect(root.querySelector<HTMLInputElement>('#tags')!.value).toBe(
            'HIGH//GROUP/ANCHOR',
        );
        expect(changed).toHaveBeenCalledOnce();
        expect(document.activeElement).toBe(input);
        forms!.destroy();
        forms = null;
        expect(root.querySelector('#plain')).toBe(input);
        expect(root.querySelector('.ez-plain-field-wrap')).toBeNull();
        expect(input.name).toBe('classification');
        expect(input.required).toBe(true);
    });

    it.each([
        { label: 'the selected Favorite', external: undefined },
        { label: 'a newer LOW commit', external: 'LOW' },
        { label: 'a return to the initial HIGH marking', external: 'HIGH' },
    ])(
        'keeps $label authoritative during delayed custom-format rendering',
        async ({ external }) => {
            const input = root.querySelector<HTMLInputElement>('#plain')!;
            input.setAttribute('data-ezclassify-format', 'custom');
            const base = labelRecordStandIn();
            let release: (() => void) | undefined;
            const engine = {
                ...base,
                render: (
                    assertions: Assertion[],
                    format?: string | { format?: string },
                ) => {
                    const result = base.render(
                        assertions,
                        format === 'custom' ? 'label/line' : format,
                    );
                    if (format !== 'custom') return result;
                    const written = {
                        ...result,
                        rendered: 'custom:' + result.rendered,
                    };
                    return assertions.some(
                        (assertion) => assertion.conceptId === 'GROUP',
                    )
                        ? new Promise<typeof written>((resolve) => {
                              release = () => resolve(written);
                          })
                        : written;
                },
            };
            const store = new VanillaEzClassifyStore(engine as never);
            try {
                forms = new EzClassifyUI(schemeOnlyContext(engine), {
                    root,
                    store,
                    favorites: { load: () => [{ marking: 'HIGH//GROUP' }] },
                });
                await settle();
                const publish = vi.spyOn(store, 'publishRendered');
                input.focus();
                input.value = 'LOW';
                const mark =
                    input.parentElement!.querySelector<HTMLButtonElement>(
                        '.ez-status-mark',
                    )!;
                mark.click();
                await settle();
                ownPopup(mark)
                    .querySelector<HTMLButtonElement>(
                        '[data-favorite-marking="HIGH//GROUP"]',
                    )!
                    .click();
                await settle();
                expect(release).toBeDefined();
                expect(store.get('whole').rendered).toBe('HIGH//GROUP/ANCHOR');
                expect(publish.mock.calls.map((call) => call[1])).toEqual([
                    'HIGH//GROUP',
                ]);
                if (external) {
                    await store.publishRendered('whole', external);
                    await settle();
                }
                release!();
                await settle();
                const canonical =
                    external === 'LOW'
                        ? 'LOW//STD'
                        : external === 'HIGH'
                          ? 'HIGH'
                          : 'HIGH//GROUP/ANCHOR';
                expect(input.value).toBe('custom:' + canonical);
                expect(store.get('whole').rendered).toBe(canonical);
                expect(publish.mock.calls.map((call) => call[1])).toEqual(
                    external ? ['HIGH//GROUP', external] : ['HIGH//GROUP'],
                );
            } finally {
                forms?.destroy();
                forms = null;
                store.destroy();
            }
        },
    );

    it.each([
        ['LOW', 'LOW//STD'],
        ['HIGH//GROUP/ANCHOR', 'HIGH//GROUP/ANCHOR'],
    ])(
        'updates a bound guide’s Current marking after Copy commits %s as %s',
        async (computed, canonical) => {
            // No sibling may echo the canonical result on the guide's behalf.
            root.querySelector('#plain')!.remove();
            root.querySelector('#tags')!.remove();
            const host = document.createElement('div');
            host.id = 'guide';
            host.setAttribute('data-ezclassify-controller', 'guide-checklist');
            host.setAttribute('data-ezclassify-bound-to', 'whole');
            root.append(host);
            const view: GuideStructuralView = {
                id: 'guide',
                name: 'Guide',
                description: 'Rules',
                categories: [],
                uncategorized: [
                    {
                        id: 'rule',
                        name: 'Rule',
                        outcomeText: computed,
                        isComputed: false,
                        keywords: [],
                        matcherLabels: [],
                        dependsOn: [],
                        dependsOnNames: [],
                        overrides: [],
                        overrideNames: [],
                    },
                ],
            };
            const evaluation: EvaluationResult = {
                aggregatedMarking: computed,
                selectedRules: [],
                activeComputedRules: [],
                effectiveMarkings: [],
                breakdown: [],
                contributingBreakdown: [],
            };
            const context = {
                ...schemeOnlyContext(labelRecordStandIn()),
                guide: {
                    buildGuideViews: () => [view],
                    evaluateMany: () => evaluation,
                } as never,
            };
            forms = new EzClassifyUI(context, {
                root,
                favorites: { load: () => [] },
            });
            await settle();
            const checklist = forms.components.get(host) as GuideChecklist;
            checklist.setSelections([{ guideId: 'guide', ruleId: 'rule' }]);
            await settle();
            expect(
                root.querySelector('.ezc-guide-marking-value')?.textContent,
            ).toBe('HIGH');
            root.querySelector<HTMLButtonElement>(
                '.ezc-guide-copy-btn',
            )!.click();
            await settle();
            expect(forms.store.get('whole').rendered).toBe(canonical);
            expect(
                root.querySelector('.ezc-guide-marking-value')?.textContent,
            ).toBe(canonical);
            expect(
                root.querySelector('.ezc-guide-result-value')?.textContent,
            ).toBe(computed);
            expect(checklist.getSelections()).toEqual([
                { guideId: 'guide', ruleId: 'rule' },
            ]);
        },
    );

    it('respects the native readonly constraint while it changes', async () => {
        const { input, mark } = await mount();
        input.readOnly = true;
        await settle();
        expect(mark.disabled).toBe(true);
        mark.click();
        expect(mark.getAttribute('aria-expanded')).toBe('false');
        expect(forms!.store.get('whole').rendered).toBe('HIGH');
        input.readOnly = false;
        await settle();
        expect(mark.disabled).toBe(false);
    });

    it('keeps a native facet select unenhanced', async () => {
        root.insertAdjacentHTML(
            'beforeend',
            '<select id="native" data-ezclassify-facet-of="whole" data-ezclassify-category="level"><option value="">Choose</option></select>',
        );
        await mount();
        const select = root.querySelector<HTMLSelectElement>('#native')!;
        expect(select.parentElement).toBe(root);
        expect(select.querySelector('.ez-status-mark')).toBeNull();
        expect(select.options.length).toBeGreaterThan(1);
    });
});
