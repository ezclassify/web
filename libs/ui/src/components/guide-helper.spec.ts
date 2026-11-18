import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { GuideChecklist, type GuideRuleSelection } from './guide-helper';
import type { SchemeEngineAdapter } from '@ezclassify/types';
import type { GuideStructuralView, GuideRuleView } from '@ezclassify/types';
import type { EvaluationResult } from '@ezclassify/types';
import { schemeOnlyContext } from '../../test-fixtures/context-doubles';
import { mockRenderFormat } from '../render-format-layout-mock';
import { setMountHost } from '../mount-host-registry';
import { parseComponentOptions } from '../component-factory';
import { harvestControllerOptions } from '../element-scanner';
import { setMarkingTarget } from './marking-target';
import { cleanupTooltipForRoot } from './tooltip-manager';

const toCtx = (eng: unknown) => schemeOnlyContext(eng as never);

/** Minimal rule for testing, no compound logic. */
function makeRule(
    id: string,
    name: string,
    overrides: Partial<GuideRuleView> = {},
): GuideRuleView {
    return {
        id,
        name,
        outcomeText: `Apply ${name}`,
        isComputed: false,
        keywords: [name.toLowerCase()],
        matcherLabels: [],
        dependsOn: [],
        dependsOnNames: [],
        overrides: [],
        overrideNames: [],
        ...overrides,
    };
}

const TEST_RULES: GuideRuleView[] = [
    makeRule('rule-a', 'Rule Alpha'),
    makeRule('rule-b', 'Rule Bravo'),
    makeRule('rule-c', 'Rule Charlie'),
];

const TEST_GUIDE_VIEW: GuideStructuralView = {
    id: 'test-guide',
    name: 'Test Guide',
    description: 'A test guide',
    categories: [
        { id: 'cat-1', label: 'Category One', items: TEST_RULES.slice(0, 2) },
        { id: 'cat-2', label: 'Category Two', items: TEST_RULES.slice(2) },
    ],
    uncategorized: [],
};

/**
 * Minimal mock engine, only the fields GuideChecklist needs from its parent
 * class.
 */
function createMockEngine(): SchemeEngineAdapter {
    return {
        getScheme: vi.fn(() => ({
            id: 'test',
            name: 'Test',
            version: '1.0',
            defaultRenderFormat: 'default',
            categories: [],
            concepts: [],
            formats: [
                {
                    id: 'default',
                    categoryOrder: [],
                    separator: '',
                    categorySeparator: '',
                },
            ],
            scopes: [],
            conceptGroups: [],
            parseRules: [],
            wizardQuestions: [],
        })),
        getSchemeMeta: vi.fn(() => ({
            id: 'test',
            version: '1.0',
            name: 'Test',
            defaultRenderFormat: 'default',
            formats: [
                mockRenderFormat({
                    id: 'default',
                    view: 'default',
                    separator: '',
                    categorySeparator: '',
                    categoryOrder: [],
                }),
            ],
            scopes: [],
        })),
        listCategories: vi.fn(() => []),
        getConceptsInCategory: vi.fn(() => []),
        process: vi.fn(() => ({ assertions: [], rendered: '', valid: true })),
        suggest: vi.fn(() => ({ suggestions: [] })),
        render: vi.fn(() => ''),
    } as unknown as SchemeEngineAdapter;
}

/** A promise plus the handles to settle it, for driving an async adapter. */
function deferred<T>(): {
    promise: Promise<T>;
    resolve: (value: T) => void;
    reject: (reason: unknown) => void;
} {
    let resolve!: (value: T) => void;
    let reject!: (reason: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

/** Selections of rules in the default test guide. */
function inTestGuide(...ruleIds: string[]): GuideRuleSelection[] {
    return ruleIds.map((ruleId) => ({ guideId: 'test-guide', ruleId }));
}

function makeEvaluation(marking: string): EvaluationResult {
    return {
        aggregatedMarking: marking,
        selectedRules: [],
        activeComputedRules: [],
        effectiveMarkings: [],
        breakdown: [],
        contributingBreakdown: [],
    };
}

describe('GuideChecklist', () => {
    let container: HTMLDivElement;
    let checklist: GuideChecklist;
    let engine: SchemeEngineAdapter;

    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
        engine = createMockEngine();
        checklist = new GuideChecklist();
    });

    it('shows a rule id two guides share once per guide and selects each by its guide', async () => {
        const first = {
            ...TEST_GUIDE_VIEW,
            id: 'guide-a',
            name: 'Guide A',
            categories: [
                {
                    id: 'cat',
                    label: 'Rules',
                    items: [makeRule('shared', 'First rule')],
                },
            ],
        };
        const second = {
            ...TEST_GUIDE_VIEW,
            id: 'guide-b',
            name: 'Guide B',
            categories: [
                {
                    id: 'cat',
                    label: 'Rules',
                    items: [makeRule('shared', 'Second rule')],
                },
            ],
        };
        await checklist.init(container, toCtx(engine), {
            guides: [first, second],
        });
        const rows = [
            ...container.querySelectorAll<HTMLInputElement>(
                'input[type="checkbox"]',
            ),
        ];
        expect(rows).toHaveLength(2);
        expect(rows[0].closest('label')?.textContent).toContain('First rule');
        expect(rows[1].closest('label')?.textContent).toContain('Second rule');
        rows[0].click();
        expect(checklist.getSelections()).toEqual([
            { guideId: 'guide-a', ruleId: 'shared' },
        ]);
        rows[1].click();
        expect(checklist.getSelections()).toEqual([
            { guideId: 'guide-a', ruleId: 'shared' },
            { guideId: 'guide-b', ruleId: 'shared' },
        ]);
    });

    it('sends each selected rule to evaluateMany with its guide, so a shared rule id counts once per guide', async () => {
        const first = {
            ...TEST_GUIDE_VIEW,
            id: 'guide-a',
            categories: [
                { id: 'cat', label: 'Rules', items: [makeRule('shared', 'A')] },
            ],
        };
        const second = {
            ...TEST_GUIDE_VIEW,
            id: 'guide-b',
            categories: [
                { id: 'cat', label: 'Rules', items: [makeRule('shared', 'B')] },
            ],
        };
        await checklist.init(container, toCtx(engine), {
            guides: [first, second],
        });
        const evaluateMany = vi.fn(() => makeEvaluation('MARK'));
        (
            checklist as unknown as {
                guideAdapter: { evaluateMany: typeof evaluateMany };
            }
        ).guideAdapter = { evaluateMany };
        for (const cb of container.querySelectorAll<HTMLInputElement>(
            'input[type="checkbox"]',
        ))
            cb.click();
        expect(evaluateMany).toHaveBeenLastCalledWith([
            { guideId: 'guide-a', ruleId: 'shared' },
            { guideId: 'guide-b', ruleId: 'shared' },
        ]);
    });

    it("nominates a shared rule id only in the hit's own guide and updates its badge", async () => {
        const first = {
            ...TEST_GUIDE_VIEW,
            id: 'guide-a',
            categories: [
                {
                    id: 'cat',
                    label: 'Rules',
                    items: [makeRule('shared', 'First rule')],
                },
            ],
        };
        const second = {
            ...TEST_GUIDE_VIEW,
            id: 'guide-b',
            categories: [
                {
                    id: 'cat',
                    label: 'Rules',
                    items: [makeRule('shared', 'Second rule')],
                },
            ],
        };
        await checklist.init(container, toCtx(engine), {
            guides: [first, second],
            editor: '',
        });
        const scan = vi.fn((text: string) =>
            text === 'none' ? [] : [{ rule: { id: 'shared' }, guideId: text }],
        );
        (
            checklist as unknown as { guideAdapter: { scan: typeof scan } }
        ).guideAdapter = { scan };
        const rowA = container.querySelector<HTMLElement>(
            '[data-guide-id="guide-a"][data-rule-id="shared"]',
        )!;
        const row = container.querySelector<HTMLElement>(
            '[data-guide-id="guide-b"][data-rule-id="shared"]',
        )!;
        const badge = row.querySelector<HTMLElement>(
            '.ezc-guide-nominated-badge',
        )!;
        const status = container.querySelector<HTMLElement>(
            '.ezc-guide-nomination-status',
        )!;

        await checklist.analyzeText('guide-a');
        expect(rowA.dataset.nominated).toBe('true');
        expect(row.dataset.nominated).toBe('false');
        expect(badge.hidden).toBe(true);
        expect(status.textContent).toContain('1 rule nominated');

        await checklist.analyzeText('guide-b');
        expect(rowA.dataset.nominated).toBe('false');
        expect(row.dataset.nominated).toBe('true');
        expect(badge.hidden).toBe(false);
        expect(status.textContent).toContain('1 rule nominated');

        await checklist.analyzeText('none');
        expect(row.dataset.nominated).toBe('false');
        expect(badge.hidden).toBe(true);
        expect(status.textContent).toContain('No rules nominated');
    });

    it('does not nominate a hit whose guide is not loaded', async () => {
        await init();
        const scan = vi.fn(() => [
            { rule: { id: 'rule-a' }, guideId: 'another-guide' },
        ]);
        (
            checklist as unknown as { guideAdapter: { scan: typeof scan } }
        ).guideAdapter = { scan };
        await checklist.analyzeText('alpha');
        expect(
            container.querySelectorAll('[data-nominated="true"]'),
        ).toHaveLength(0);
    });

    async function init(extraOpts = {}): Promise<void> {
        await checklist.init(container, toCtx(engine), {
            guides: TEST_GUIDE_VIEW,
            ...extraOpts,
        });
    }

    it('mounts and renders rule checkboxes', async () => {
        await init();
        const checkboxes = container.querySelectorAll<HTMLInputElement>(
            'input[type="checkbox"]',
        );
        expect(checkboxes.length).toBe(TEST_RULES.length);
    });

    it('renders rule names in the list', async () => {
        await init();
        const names = container.querySelectorAll('.ezc-guide-rule-name');
        const texts = Array.from(names).map((n) => n.textContent);
        expect(texts).toContain('Rule Alpha');
        expect(texts).toContain('Rule Bravo');
        expect(texts).toContain('Rule Charlie');
    });

    it('keeps long outcome text intact while allowing separator breaks', async () => {
        await checklist.init(container, toCtx(engine), {
            guides: {
                ...TEST_GUIDE_VIEW,
                categories: [
                    {
                        id: 'cat',
                        label: 'Rules',
                        items: [
                            makeRule('long', 'Long outcome', {
                                outcomeText:
                                    'COMMONWEALTH_EDUCATION_DEPARTMENT',
                            }),
                        ],
                    },
                ],
            },
        });
        const outcome = container.querySelector<HTMLElement>(
            '.ezc-guide-rule-outcome',
        )!;
        expect(outcome.textContent).toBe('COMMONWEALTH_EDUCATION_DEPARTMENT');
        expect(outcome.querySelectorAll('wbr')).toHaveLength(2);
    });

    it('renders category headings', async () => {
        await init();
        const headings = container.querySelectorAll(
            '.ezc-guide-category-label',
        );
        const labels = Array.from(headings).map(
            (h) => h.querySelector('span')?.textContent,
        );
        expect(labels).toContain('Category One');
        expect(labels).toContain('Category Two');
    });

    it('starts with no rules selected', async () => {
        await init();
        expect(checklist.getSelections()).toHaveLength(0);
    });

    it('adds a rule to selection when checkbox is checked', async () => {
        await init();
        const checkbox = container.querySelector<HTMLInputElement>(
            'input[value="rule-a"]',
        );
        expect(checkbox).not.toBeNull();
        checkbox!.checked = true;
        checkbox!.dispatchEvent(new Event('change', { bubbles: true }));
        expect(checklist.getSelections()).toContainEqual(
            inTestGuide('rule-a')[0],
        );
    });

    it('removes a rule from selection when checkbox is unchecked', async () => {
        await init();
        const checkbox = container.querySelector<HTMLInputElement>(
            'input[value="rule-a"]',
        )!;
        checkbox.checked = true;
        checkbox.dispatchEvent(new Event('change', { bubbles: true }));
        expect(checklist.getSelections()).toContainEqual(
            inTestGuide('rule-a')[0],
        );

        const checkbox2 = container.querySelector<HTMLInputElement>(
            'input[value="rule-a"]',
        )!;
        checkbox2.checked = false;
        checkbox2.dispatchEvent(new Event('change', { bubbles: true }));
        expect(checklist.getSelections()).not.toContainEqual(
            inTestGuide('rule-a')[0],
        );
    });

    it('evaluate pass: invokes guideAdapter.evaluateMany and stores result', async () => {
        await init();

        const mockEval: EvaluationResult = {
            aggregatedMarking: 'MARK-1',
            selectedRules: [],
            activeComputedRules: [],
            effectiveMarkings: [],
            breakdown: [],
            contributingBreakdown: [],
        };
        const mockGuideAdapter = { evaluateMany: vi.fn(() => mockEval) };
        // GuideChecklist holds guideAdapter as a private field; inject it directly
        // to test the evaluate path without needing a full Context.
        (
            checklist as unknown as { guideAdapter: typeof mockGuideAdapter }
        ).guideAdapter = mockGuideAdapter;

        checklist.setSelections(inTestGuide('rule-a', 'rule-b'));

        expect(mockGuideAdapter.evaluateMany).toHaveBeenCalledWith(
            inTestGuide('rule-a', 'rule-b'),
        );
        expect(checklist.getEvaluation()).toEqual(mockEval);
    });

    it('evaluates selections from both guides through the remote aggregate', async () => {
        const secondGuide: GuideStructuralView = {
            id: 'second-guide',
            name: 'Second Guide',
            description: 'A second test guide',
            categories: [
                {
                    id: 'cat-3',
                    label: 'Other',
                    items: [makeRule('rule-z', 'Zulu')],
                },
            ],
            uncategorized: [],
        };
        await init({ guides: [TEST_GUIDE_VIEW, secondGuide] });

        const mockEval: EvaluationResult = {
            aggregatedMarking: 'MARK-REMOTE',
            selectedRules: [],
            activeComputedRules: [],
            effectiveMarkings: [],
            breakdown: [],
            contributingBreakdown: [],
        };
        const remoteGuideAdapter = {
            evaluate: vi.fn(() =>
                Promise.resolve(makeEvaluation('WRONG-GUIDE')),
            ),
            evaluateMany: vi.fn(() => Promise.resolve(mockEval)),
        };
        (
            checklist as unknown as { guideAdapter: typeof remoteGuideAdapter }
        ).guideAdapter = remoteGuideAdapter;

        checklist.setSelections([
            ...inTestGuide('rule-a'),
            { guideId: 'second-guide', ruleId: 'rule-z' },
        ]);
        await vi.waitFor(() =>
            expect(checklist.getEvaluation()).toEqual(mockEval),
        );

        expect(remoteGuideAdapter.evaluateMany).toHaveBeenCalledWith([
            { guideId: 'test-guide', ruleId: 'rule-a' },
            { guideId: 'second-guide', ruleId: 'rule-z' },
        ]);
        expect(remoteGuideAdapter.evaluate).not.toHaveBeenCalled();
    });

    it('keeps lexical scan hits as nominations until the reviewer selects them', async () => {
        await init();
        const mockGuideAdapter = {
            evaluateMany: vi.fn(),
            scan: vi.fn(() => [
                { rule: { id: 'rule-a' }, guideId: TEST_GUIDE_VIEW.id },
                { rule: { id: 'rule-b' }, guideId: TEST_GUIDE_VIEW.id },
            ]),
        };
        (
            checklist as unknown as { guideAdapter: typeof mockGuideAdapter }
        ).guideAdapter = mockGuideAdapter;

        checklist.setSelections(inTestGuide('rule-c'));
        // Scanning is an adapter operation and resolves asynchronously; the
        // component awaits the hits before it paints the nominations.
        await checklist.analyzeText('alpha bravo');

        expect(checklist.getSelections()).toEqual(inTestGuide('rule-c'));
        expect(mockGuideAdapter.evaluateMany).toHaveBeenCalledTimes(1);
        expect(
            container
                .querySelector('[data-rule-id="rule-a"]')
                ?.getAttribute('data-nominated'),
        ).toBe('true');
        expect(
            container.querySelector<HTMLInputElement>('input[value="rule-a"]')
                ?.checked,
        ).toBe(false);
    });

    it('keeps the latest text scan when remote scans finish out of order', async () => {
        await init();
        const oldScan = deferred<unknown[]>();
        const newScan = deferred<unknown[]>();
        const mockGuideAdapter = {
            scan: vi.fn((text: string) =>
                text === 'old' ? oldScan.promise : newScan.promise,
            ),
        };
        (
            checklist as unknown as { guideAdapter: typeof mockGuideAdapter }
        ).guideAdapter = mockGuideAdapter;

        const oldRequest = checklist.analyzeText('old');
        const newRequest = checklist.analyzeText('new');
        newScan.resolve([
            { rule: { id: 'rule-b' }, guideId: TEST_GUIDE_VIEW.id },
        ]);
        await newRequest;
        oldScan.resolve([
            { rule: { id: 'rule-a' }, guideId: TEST_GUIDE_VIEW.id },
        ]);
        await oldRequest;

        expect(
            container
                .querySelector('[data-rule-id="rule-b"]')
                ?.getAttribute('data-nominated'),
        ).toBe('true');
        expect(
            container
                .querySelector('[data-rule-id="rule-a"]')
                ?.getAttribute('data-nominated'),
        ).not.toBe('true');
    });

    it('reports a failed text scan without leaving stale nominations', async () => {
        await init({ editor: '' });
        const mockGuideAdapter = {
            scan: vi
                .fn()
                .mockResolvedValueOnce([{ rule: { id: 'rule-a' } }])
                .mockRejectedValueOnce(new Error('network down')),
        };
        (
            checklist as unknown as { guideAdapter: typeof mockGuideAdapter }
        ).guideAdapter = mockGuideAdapter;
        const log = vi.spyOn(console, 'error').mockImplementation(() => {});
        try {
            await checklist.analyzeText('first');
            expect(await checklist.analyzeText('second')).toEqual([]);
            expect(
                container
                    .querySelector('[data-rule-id="rule-a"]')
                    ?.getAttribute('data-nominated'),
            ).not.toBe('true');
            expect(
                container.querySelector('.ezc-guide-nomination-status')
                    ?.textContent,
            ).toMatch(/Unable to analyze text/);
        } finally {
            log.mockRestore();
        }
    });

    it('shows a synchronous aggregate evaluation failure', async () => {
        await init();
        const mockGuideAdapter = {
            evaluateMany: vi
                .fn()
                .mockReturnValueOnce(makeEvaluation('CURRENT'))
                .mockImplementationOnce(() => {
                    throw new Error('adapter unavailable');
                }),
        };
        (
            checklist as unknown as { guideAdapter: typeof mockGuideAdapter }
        ).guideAdapter = mockGuideAdapter;
        const log = vi.spyOn(console, 'error').mockImplementation(() => {});
        try {
            checklist.setSelections(inTestGuide('rule-a'));
            checklist.setSelections(inTestGuide('rule-a', 'rule-b'));
            expect(checklist.getEvaluation()?.aggregatedMarking).toBe(
                'CURRENT',
            );
            expect(
                container
                    .querySelector('.ezc-guide-error')
                    ?.hasAttribute('hidden'),
            ).toBe(false);
        } finally {
            log.mockRestore();
        }
    });

    it('renders qualified breakdown rule references through the guide view', async () => {
        await init();
        const longOutcome = 'COMMONWEALTH_EDUCATION_DEPARTMENT';
        const breakdown = {
            isComputed: false,
            outcome: { rendered: longOutcome },
            rule: {
                artifact: {
                    id: 'test-guide',
                    kind: 'guide' as const,
                    version: '1.0.0',
                },
                ruleDigest: 'sha256:rule-a',
                ruleId: 'rule-a',
            },
            wasOverridden: false,
        };
        const mockEval = {
            activeComputedRules: [],
            aggregatedMarking: longOutcome,
            breakdown: [breakdown],
            contributingBreakdown: [breakdown],
            effectiveMarkings: [longOutcome],
            selectedRules: [],
        } as EvaluationResult;
        const mockGuideAdapter = { evaluateMany: vi.fn(() => mockEval) };
        (
            checklist as unknown as { guideAdapter: typeof mockGuideAdapter }
        ).guideAdapter = mockGuideAdapter;

        checklist.setSelections(inTestGuide('rule-a'));

        expect(
            container.querySelector('.ezc-guide-breakdown-name')?.textContent,
        ).toBe('Rule Alpha');
        const outcome = container.querySelector('.ezc-guide-breakdown-outcome');
        expect(outcome?.textContent).toBe(longOutcome);
        expect(outcome?.querySelectorAll('wbr')).toHaveLength(2);
    });

    it('programmatic setSelections reflects in checked state', async () => {
        await init();
        checklist.setSelections(inTestGuide('rule-b', 'rule-c'));
        expect(checklist.getSelections()).toEqual(
            inTestGuide('rule-b', 'rule-c'),
        );
        expect(
            container.querySelector<HTMLInputElement>('input[value="rule-b"]')
                ?.checked,
        ).toBe(true);
        expect(checklist.getSelections()).not.toContainEqual(
            inTestGuide('rule-a')[0],
        );
    });

    it('clearSelection removes all selected rules', async () => {
        await init();
        checklist.setSelections(inTestGuide('rule-a', 'rule-b'));
        checklist.clearSelection();
        expect(checklist.getSelections()).toHaveLength(0);
    });

    it('search filter hides non-matching rules', async () => {
        await init();
        checklist.setSearchQuery('bravo');
        const hidden = container.querySelectorAll('.ezc-guide-rule--hidden');
        // 'Rule Alpha' and 'Rule Charlie' should be hidden; 'Rule Bravo' visible
        expect(hidden.length).toBe(2);
    });

    it("filters each guide's rule on its own when two guides share a rule id", async () => {
        const secondGuide: GuideStructuralView = {
            ...TEST_GUIDE_VIEW,
            id: 'other-guide',
            name: 'Other Guide',
            categories: [
                {
                    id: 'other-category',
                    label: 'Other Category',
                    items: [makeRule('rule-a', 'Unique Beta')],
                },
            ],
            uncategorized: [],
        };
        await init({ guides: [TEST_GUIDE_VIEW, secondGuide] });

        checklist.setSearchQuery('unique beta');

        const rows = Array.from(
            container.querySelectorAll<HTMLElement>('[data-rule-id="rule-a"]'),
        );
        expect(rows).toHaveLength(2);
        expect(rows[0].textContent).toContain('Rule Alpha');
        expect(rows[0].classList.contains('ezc-guide-rule--hidden')).toBe(true);
        expect(rows[1].textContent).toContain('Unique Beta');
        expect(rows[1].classList.contains('ezc-guide-rule--hidden')).toBe(
            false,
        );
    });

    it('every checkbox has an accessible name via implicit label association', async () => {
        await init();
        const checkboxes = Array.from(
            container.querySelectorAll<HTMLInputElement>(
                'input[type="checkbox"]',
            ),
        );
        expect(checkboxes.length).toBeGreaterThan(0);
        for (const cb of checkboxes) {
            // Each checkbox must be wrapped in a <label> whose text becomes the accessible name.
            const parentLabel = cb.closest('label');
            expect(parentLabel).not.toBeNull();
            // The label's text content includes the rule name span, must be non-empty.
            const labelText = parentLabel?.textContent?.trim();
            expect(labelText?.length).toBeGreaterThan(0);
        }
    });

    describe('against a guide engine that answers asynchronously', () => {
        /** Swap in the asynchronous remote guide adapter. */
        function useRemoteAdapter(evaluate: () => Promise<EvaluationResult>): {
            evaluateMany: ReturnType<typeof vi.fn>;
        } {
            const adapter = { evaluateMany: vi.fn(evaluate) };
            (
                checklist as unknown as { guideAdapter: typeof adapter }
            ).guideAdapter = adapter;
            return adapter;
        }

        function toggle(ruleId: string, checked = true): void {
            const checkbox = container.querySelector<HTMLInputElement>(
                `input[value="${ruleId}"]`,
            )!;
            checkbox.checked = checked;
            checkbox.dispatchEvent(new Event('change', { bubbles: true }));
        }

        function recordChangeEvents(): (EvaluationResult | null)[] {
            const seen: (EvaluationResult | null)[] = [];
            container.addEventListener('ezclassify:guide-change', (event) => {
                seen.push(
                    (event as CustomEvent<EvaluationResult | null>).detail,
                );
            });
            return seen;
        }

        it('emits the change event with the evaluation for the selection that caused it', async () => {
            await init();
            const pending = deferred<EvaluationResult>();
            useRemoteAdapter(() => pending.promise);
            const seen = recordChangeEvents();

            toggle('rule-a');
            // An event now could only carry the previous selection's result.
            // A host must not be able to tell an in-process guide engine from
            // one behind a runtime by reading this detail.
            expect(seen).toEqual([]);

            const result = makeEvaluation('MARK-A');
            pending.resolve(result);
            await vi.waitFor(() => expect(seen).toHaveLength(1));
            expect(seen[0]).toBe(result);
        });

        it('does not allow copying a prior marking while the new selection evaluates', async () => {
            await init();
            const pending = deferred<EvaluationResult>();
            let calls = 0;
            (
                checklist as unknown as {
                    guideAdapter: {
                        evaluateMany: () =>
                            EvaluationResult | Promise<EvaluationResult>;
                    };
                }
            ).guideAdapter = {
                evaluateMany: () =>
                    ++calls === 1 ? makeEvaluation('OLD') : pending.promise,
            };
            checklist.setSelections(inTestGuide('rule-a'));
            checklist.setSelections(inTestGuide('rule-b'));
            const copy = container.querySelector<HTMLButtonElement>(
                '.ezc-guide-copy-btn',
            )!;
            expect(copy.disabled).toBe(true);
            expect(
                container.querySelector('.ezc-guide-result-value')?.textContent,
            ).toContain('Evaluating');

            pending.resolve(makeEvaluation('NEW'));
            await vi.waitFor(() => expect(copy.disabled).toBe(false));
            expect(
                container.querySelector('.ezc-guide-result-value')?.textContent,
            ).toBe('NEW');
        });

        it('drops a superseded answer so the older evaluation cannot overwrite the newer', async () => {
            await init();
            const first = deferred<EvaluationResult>();
            const second = deferred<EvaluationResult>();
            const adapter = useRemoteAdapter(() => first.promise);
            adapter.evaluateMany
                .mockReturnValueOnce(first.promise)
                .mockReturnValueOnce(second.promise);
            const seen = recordChangeEvents();

            toggle('rule-a');
            toggle('rule-b');

            const newer = makeEvaluation('MARK-AB');
            second.resolve(newer);
            await vi.waitFor(() =>
                expect(checklist.getEvaluation()).toBe(newer),
            );

            // The first selection's answer arrives late, out of order.
            first.resolve(makeEvaluation('MARK-A'));
            await new Promise((resolve) => setTimeout(resolve, 0));

            expect(checklist.getEvaluation()).toBe(newer);
            expect(
                container.querySelector('.ezc-guide-result-value')?.textContent,
            ).toBe('MARK-AB');
            // The superseded selection stays quiet; latest wins, once.
            expect(seen).toEqual([newer]);
        });

        it('drops an evaluation that lands after teardown', async () => {
            await init();
            const pending = deferred<EvaluationResult>();
            useRemoteAdapter(() => pending.promise);
            const seen = recordChangeEvents();

            toggle('rule-a');
            checklist.destroy();

            // The host has unmounted this checklist; the runtime has not
            // heard about it and answers anyway.
            pending.resolve(makeEvaluation('MARK-A'));
            await new Promise((resolve) => setTimeout(resolve, 0));

            expect(seen).toEqual([]);
            expect(container.innerHTML).toBe('');
            expect(checklist.getEvaluation()).toBeNull();
        });

        it('says so and holds the last good marking when an evaluation fails', async () => {
            await init();
            const consoleError = vi
                .spyOn(console, 'error')
                .mockImplementation(() => {});
            const good = makeEvaluation('MARK-A');
            const first = deferred<EvaluationResult>();
            const second = deferred<EvaluationResult>();
            const adapter = useRemoteAdapter(() => first.promise);
            adapter.evaluateMany
                .mockReturnValueOnce(first.promise)
                .mockReturnValueOnce(second.promise);

            toggle('rule-a');
            first.resolve(good);
            await vi.waitFor(() =>
                expect(checklist.getEvaluation()).toBe(good),
            );
            expect(
                container.querySelector<HTMLElement>('.ezc-guide-error')
                    ?.hidden,
            ).toBe(true);

            toggle('rule-b');
            second.reject(new Error('runtime unreachable'));
            await vi.waitFor(() =>
                expect(
                    container.querySelector<HTMLElement>('.ezc-guide-error')
                        ?.hidden,
                ).toBe(false),
            );

            // The marking on screen is the one that was last computed, and the
            // alert next to it says it may be out of date. Blanking it would
            // read as "this selection produces no marking".
            expect(checklist.getEvaluation()).toBe(good);
            expect(
                container.querySelector('.ezc-guide-result-value')?.textContent,
            ).toBe('MARK-A');
            expect(consoleError).toHaveBeenCalled();
            consoleError.mockRestore();
        });
    });

    describe('against a guide engine that answers asynchronously', () => {
        /**
         * Mount with no `opts.guides`, so the checklist has to ask the guide
         * adapter for its views, and give it the remote narrowing of the
         * contract: `RemoteGuideEngineAdapter.buildGuideViews()` answers with a
         * promise. Every other mount in this file hands the views in pre-built,
         * which never exercises a second turn of the loop.
         */
        async function initRemote(
            views: Promise<GuideStructuralView[]>,
            evaluateMany?: () => Promise<EvaluationResult>,
        ): Promise<void> {
            const ctx = toCtx(engine);
            const remoteGuide = {
                buildGuideViews: () => views,
                ...(evaluateMany && { evaluateMany }),
            };
            (ctx as unknown as { guide: typeof remoteGuide }).guide =
                remoteGuide;
            await checklist.init(container, ctx);
        }

        it('renders the rule checkboxes once the views resolve', async () => {
            const pending = deferred<GuideStructuralView[]>();
            await initRemote(pending.promise);
            expect(
                container.querySelectorAll('input[type="checkbox"]').length,
            ).toBe(0);

            pending.resolve([TEST_GUIDE_VIEW]);
            await vi.waitFor(() =>
                expect(
                    container.querySelectorAll('input[type="checkbox"]').length,
                ).toBe(TEST_RULES.length),
            );
        });

        it('retains a selection set before the remote views arrive', async () => {
            const pending = deferred<GuideStructuralView[]>();
            const result = makeEvaluation('MARK-A');
            const evaluateMany = vi.fn(async () => result);
            await initRemote(pending.promise, evaluateMany);
            expect(() =>
                checklist.setSelections(inTestGuide('rule-a')),
            ).not.toThrow();
            pending.resolve([TEST_GUIDE_VIEW]);
            await vi.waitFor(() =>
                expect(
                    container.querySelector<HTMLInputElement>(
                        'input[value="rule-a"]',
                    )?.checked,
                ).toBe(true),
            );
            await vi.waitFor(() =>
                expect(checklist.getEvaluation()).toBe(result),
            );
            expect(evaluateMany).toHaveBeenCalledExactlyOnceWith(
                inTestGuide('rule-a'),
            );
        });

        it('retains a search query before the remote views arrive', async () => {
            const pending = deferred<GuideStructuralView[]>();
            await initRemote(pending.promise);
            expect(() => checklist.setSearchQuery('bravo')).not.toThrow();
            pending.resolve([TEST_GUIDE_VIEW]);
            await vi.waitFor(() =>
                expect(
                    container.querySelector<HTMLInputElement>(
                        '.ezc-guide-search-input',
                    )?.value,
                ).toBe('bravo'),
            );
        });

        it('accepts text analysis while remote views are still loading', async () => {
            const pending = deferred<GuideStructuralView[]>();
            await initRemote(pending.promise);
            const hit = { rule: { id: 'rule-a' }, guideId: TEST_GUIDE_VIEW.id };
            const scan = vi.fn(() => [hit]);
            (
                checklist as unknown as { guideAdapter: { scan: typeof scan } }
            ).guideAdapter = { scan };
            await expect(checklist.analyzeText('alpha')).resolves.toEqual([
                hit,
            ]);
            pending.resolve([TEST_GUIDE_VIEW]);
            await vi.waitFor(() =>
                expect(
                    container
                        .querySelector('[data-rule-id="rule-a"]')
                        ?.getAttribute('data-nominated'),
                ).toBe('true'),
            );
        });

        it('nominates a pre-load scan hit in its own guide once the views arrive', async () => {
            const pending = deferred<GuideStructuralView[]>();
            await initRemote(pending.promise);
            const scan = vi.fn(() => [
                { rule: { id: 'rule-a' }, guideId: 'guide-a' },
            ]);
            (
                checklist as unknown as { guideAdapter: { scan: typeof scan } }
            ).guideAdapter = { scan };
            await checklist.analyzeText('first-only');

            pending.resolve([
                { ...TEST_GUIDE_VIEW, id: 'guide-a' },
                { ...TEST_GUIDE_VIEW, id: 'guide-b' },
            ]);
            await vi.waitFor(() =>
                expect(
                    container
                        .querySelector(
                            '[data-guide-id="guide-a"][data-rule-id="rule-a"]',
                        )
                        ?.getAttribute('data-nominated'),
                ).toBe('true'),
            );
            expect(
                container
                    .querySelector(
                        '[data-guide-id="guide-b"][data-rule-id="rule-a"]',
                    )
                    ?.getAttribute('data-nominated'),
            ).toBe('false');
        });

        it('paints an unavailable state when the views cannot be read', async () => {
            const consoleError = vi
                .spyOn(console, 'error')
                .mockImplementation(() => {});
            const pending = deferred<GuideStructuralView[]>();
            await initRemote(pending.promise);
            pending.reject(new Error('guide fetch failed'));

            const failed = await vi.waitFor(() => {
                const el = container.querySelector<HTMLElement>(
                    '.ezc-guide-unavailable',
                );
                expect(el).not.toBeNull();
                return el!;
            });
            expect(failed.getAttribute('role')).toBe('alert');
            expect(failed.textContent).toContain('unavailable');
            expect(consoleError).toHaveBeenCalled();
            consoleError.mockRestore();
        });

        it('does not resurrect a checklist destroyed while the views were in flight', async () => {
            const pending = deferred<GuideStructuralView[]>();
            await initRemote(pending.promise);

            checklist.destroy();
            pending.resolve([TEST_GUIDE_VIEW]);
            await new Promise((resolve) => setTimeout(resolve, 0));

            expect(container.innerHTML).toBe('');
        });
    });

    describe('data-ezclassify-bound-to', () => {
        /** Mount with a host the runtime would have created the mount for. */
        async function mountWithHost(boundTo: string | null, options = {}) {
            const host = document.createElement('div');
            host.setAttribute('data-ezclassify-controller', 'guide-checklist');
            if (boundTo) host.setAttribute('data-ezclassify-bound-to', boundTo);
            container.before(host);
            setMountHost(container, host);
            const onChange = vi.fn();
            await init({ onChange, ...options });
            (
                checklist as unknown as {
                    guideAdapter: { evaluateMany: () => EvaluationResult };
                }
            ).guideAdapter = { evaluateMany: () => makeEvaluation('MARK-1') };
            checklist.setSelections(inTestGuide('rule-a'));
            return onChange;
        }

        it('uses the associated marking for tools while leaving guide selections and computed results independent', async () => {
            let current = 'ASSOCIATED';
            const save = vi.fn();
            const apply = vi.fn((marking: string) => {
                current = marking;
                checklist.setAssertions([]);
            });
            setMarkingTarget(checklist, {
                schemeId: 'test',
                scheme: engine.getScheme(),
                formatId: 'default',
                read: (marking) => ({ rendered: marking }),
                applyPreset: () => ({ rendered: '' }),
                getCurrent: () => ({ rendered: current, valid: true }),
                onApply: apply,
            });
            const onChange = await mountWithHost('doc', {
                favorites: { load: () => [{ marking: 'OTHER' }], save },
            });
            try {
                const checkbox = container.querySelector<HTMLInputElement>(
                    'input[type="checkbox"]',
                )!;
                checkbox.focus();
                checkbox.dispatchEvent(
                    new KeyboardEvent('keydown', {
                        key: 'Enter',
                        ctrlKey: true,
                        shiftKey: true,
                        bubbles: true,
                        cancelable: true,
                    }),
                );
                await new Promise((resolve) => setTimeout(resolve, 30));
                expect(document.activeElement?.getAttribute('role')).toBe(
                    'tab',
                );
                expect(
                    container.querySelector('.ezc-guide-marking-value')
                        ?.textContent,
                ).toBe('ASSOCIATED');
                const mark =
                    container.querySelector<HTMLElement>('.ez-status-mark')!;
                const popup = document.getElementById(
                    mark.getAttribute('aria-describedby')!,
                )!;
                popup
                    .querySelector<HTMLButtonElement>(
                        '.ez-favorites-panel__pinned',
                    )!
                    .click();
                await new Promise((resolve) => setTimeout(resolve, 30));
                expect(save).toHaveBeenCalledWith(
                    'ASSOCIATED',
                    expect.any(Object),
                );
                popup
                    .querySelector<HTMLButtonElement>(
                        '[data-favorite-marking="OTHER"]',
                    )!
                    .click();
                await new Promise((resolve) => setTimeout(resolve, 30));
                expect(apply).toHaveBeenCalledWith(
                    'OTHER',
                    expect.any(AbortSignal),
                );
                expect(
                    container.querySelector('.ezc-guide-marking-value')
                        ?.textContent,
                ).toBe('OTHER');
                expect(checklist.getSelections()).toEqual(
                    inTestGuide('rule-a'),
                );
                expect(
                    container.querySelector('.ezc-guide-result-value')
                        ?.textContent,
                ).toBe('MARK-1');
                expect(onChange).not.toHaveBeenCalled();
            } finally {
                checklist.destroy();
                cleanupTooltipForRoot(container);
            }
        });

        it('keeps an unbound guide a computed helper even when a Favorites provider exists', async () => {
            await mountWithHost(null, { favorites: { load: () => [] } });
            expect(container.querySelector('.ez-status-mark')).toBeNull();
            expect(
                container.querySelector('.ezc-guide-result-value')?.textContent,
            ).toBe('MARK-1');
        });

        it('writes the copied marking to the bound marking', async () => {
            const onChange = await mountWithHost('doc');
            container
                .querySelector<HTMLButtonElement>('.ezc-guide-copy-btn')!
                .click();
            expect(onChange).toHaveBeenCalledWith([], 'MARK-1');
        });

        it('writes nothing when the host names no marking', async () => {
            const onChange = await mountWithHost(null);
            container
                .querySelector<HTMLButtonElement>('.ezc-guide-copy-btn')!
                .click();
            expect(onChange).not.toHaveBeenCalled();
        });

        it('keeps its selection and echoes nothing when the bound marking commits', async () => {
            const onChange = await mountWithHost('doc');
            checklist.setAssertions([
                {
                    conceptId: 'x',
                    categoryId: 'y',
                    confidence: 'certain',
                    source: 'user',
                },
            ]);
            expect(onChange).not.toHaveBeenCalled();
            expect(checklist.getSelections()).toEqual(inTestGuide('rule-a'));
            expect(
                container.querySelector('.ezc-guide-result-value')?.textContent,
            ).toBe('MARK-1');
        });
    });

    describe('declared in markup', () => {
        const SEED = JSON.stringify(inTestGuide('rule-a', 'rule-c'));
        const COMPUTED_GUIDE: GuideStructuralView = {
            ...TEST_GUIDE_VIEW,
            categories: [
                {
                    id: '_compound',
                    label: 'Compound',
                    items: [makeRule('auto', 'Auto', { isComputed: true })],
                },
                ...TEST_GUIDE_VIEW.categories,
            ],
        };

        /**
         * Mount from a host's attributes, through the same harvest and parse
         * the runtime gives every controller.
         */
        async function mountFromMarkup(
            attributes: Record<string, string>,
            guides: GuideStructuralView = TEST_GUIDE_VIEW,
        ) {
            const host = document.createElement('div');
            host.setAttribute('data-ezclassify-controller', 'guide-checklist');
            for (const [option, value] of Object.entries(attributes))
                host.setAttribute(
                    `data-ezclassify-guide-checklist-${option}`,
                    value,
                );
            container.before(host);
            setMountHost(container, host);
            const guide = {
                buildGuideViews: () => [guides],
                evaluateMany: vi.fn(() => makeEvaluation('MARK-1')),
                scan: vi.fn(() => []),
            };
            const errors: { code: string; message: string }[] = [];
            host.addEventListener('ezclassify:host-error', (event) =>
                errors.push((event as CustomEvent).detail),
            );
            const changes: EvaluationResult[] = [];
            container.addEventListener('ezclassify:guide-change', (event) =>
                changes.push((event as CustomEvent).detail),
            );
            await checklist.init(
                container,
                { ...toCtx(engine), guide } as never,
                parseComponentOptions(
                    host,
                    harvestControllerOptions(host, 'guide-checklist'),
                ),
            );
            return { guide, errors, changes };
        }

        /** Add an element to the page for a checklist option to name. */
        function onPage<K extends keyof HTMLElementTagNameMap>(
            tag: K,
            id: string,
        ): HTMLElementTagNameMap[K] {
            const element = document.createElement(tag);
            element.id = id;
            document.body.appendChild(element);
            return element;
        }

        let logged: ReturnType<typeof vi.spyOn>;
        beforeEach(() => {
            logged = vi.spyOn(console, 'error').mockImplementation(() => {});
        });
        afterEach(() => {
            logged.mockRestore();
            document.body.innerHTML = '';
        });

        it('opens on the selections the markup declares', async () => {
            const { guide } = await mountFromMarkup({ selected: SEED });

            expect(guide.evaluateMany).toHaveBeenCalledWith(
                inTestGuide('rule-a', 'rule-c'),
            );
            expect(
                [
                    ...container.querySelectorAll<HTMLInputElement>(
                        'input[type="checkbox"]:checked',
                    ),
                ].map((box) => box.value),
            ).toEqual(['rule-a', 'rule-c']);
            expect(
                container.querySelector('.ezc-guide-result-value')?.textContent,
            ).toBe('MARK-1');
        });

        it('tells the host what the declared selections evaluate to', async () => {
            const { changes } = await mountFromMarkup({ selected: SEED });
            await Promise.resolve();
            expect(changes.map((c) => c.aggregatedMarking)).toEqual(['MARK-1']);
        });

        it('stays silent about the opening selection after teardown', async () => {
            // Not awaited: the teardown has to land in the tick the checklist
            // opened in, ahead of the deferred event.
            const mounted = mountFromMarkup({ selected: SEED });
            checklist.destroy();
            const { changes } = await mounted;
            await Promise.resolve();
            expect(changes).toEqual([]);
        });

        it('reaches a listener attached in the tick the checklist opened in', async () => {
            const mounted = mountFromMarkup({ selected: SEED });
            const heard = vi.fn();
            container.addEventListener('ezclassify:guide-change', heard);
            await mounted;
            await Promise.resolve();
            expect(heard).toHaveBeenCalledTimes(1);
        });

        it.each([
            ['malformed JSON', '[{'],
            ['a value that is not a list', '{"guideId":"test-guide"}'],
            ['an entry with no guide', '[{"ruleId":"rule-a"}]'],
            ['a null entry', '[null]'],
            [
                'a rule the guide does not hold',
                '[{"guideId":"test-guide","ruleId":"rule-a"},{"guideId":"test-guide","ruleId":"nope"}]',
            ],
            [
                'a guide the Context does not hold',
                '[{"guideId":"other","ruleId":"rule-a"}]',
            ],
            ['a computed rule', '[{"guideId":"test-guide","ruleId":"auto"}]'],
        ])('refuses %s and evaluates nothing', async (_name, selected) => {
            const { guide, errors } = await mountFromMarkup(
                { selected },
                COMPUTED_GUIDE,
            );

            expect(errors.map((e) => e.code)).toEqual([
                'guide-selection-refused',
            ]);
            expect(guide.evaluateMany).not.toHaveBeenCalled();
            expect(container.querySelector('.ezc-guide-result')).toBeNull();
            expect(
                container.querySelector('.ezc-guide-unavailable')?.textContent,
            ).toMatch(/no marking is shown/);
        });

        it('analyzes the text a page textarea was written with', async () => {
            const textarea = onPage('textarea', 'page-text');
            textarea.textContent = 'text from the markup';
            const { guide } = await mountFromMarkup({ editor: 'page-text' });

            expect(textarea.value).toBe('text from the markup');
            expect(container.querySelector('textarea')).toBeNull();
            expect(
                container.querySelector('.ezc-guide-nomination-status'),
            ).not.toBeNull();
            (textarea.nextElementSibling as HTMLButtonElement).click();
            expect(guide.scan).toHaveBeenCalledWith('text from the markup');
        });

        it('takes its analyze button back and leaves the page textarea', async () => {
            const textarea = onPage('textarea', 'page-text');
            textarea.textContent = 'kept';
            await mountFromMarkup({ editor: 'page-text' });

            checklist.destroy();

            expect(textarea.nextElementSibling).toBeNull();
            expect(textarea.isConnected).toBe(true);
            expect(textarea.value).toBe('kept');
        });

        it.each(['', 'true'])(
            'renders the built-in editor when editor is %j',
            async (editor) => {
                await mountFromMarkup({ editor });
                expect(
                    container.querySelector('textarea.ezc-guide-textarea'),
                ).not.toBeNull();
            },
        );

        it('has no editor without the attribute or with "false"', async () => {
            const { errors } = await mountFromMarkup({ editor: 'false' });
            expect(errors).toEqual([]);
            expect(container.querySelector('textarea')).toBeNull();
            expect(
                container.querySelector('.ezc-guide-analyze-btn'),
            ).toBeNull();
        });

        it('lets a selection set while the guides load stand over the markup', async () => {
            const host = document.createElement('div');
            host.setAttribute('data-ezclassify-controller', 'guide-checklist');
            host.setAttribute('data-ezclassify-guide-checklist-selected', SEED);
            container.before(host);
            setMountHost(container, host);
            let answer!: (views: GuideStructuralView[]) => void;
            const guide = {
                buildGuideViews: () =>
                    new Promise<GuideStructuralView[]>((resolve) => {
                        answer = resolve;
                    }),
                evaluateMany: vi.fn(() => makeEvaluation('MARK-1')),
                scan: vi.fn(() => []),
            };
            const mounted = checklist.init(
                container,
                { ...toCtx(engine), guide } as never,
                parseComponentOptions(
                    host,
                    harvestControllerOptions(host, 'guide-checklist'),
                ),
            );
            await Promise.resolve();
            const newer = [{ guideId: TEST_GUIDE_VIEW.id, ruleId: 'rule-b' }];
            checklist.setSelections(newer);

            answer([TEST_GUIDE_VIEW]);
            await mounted;
            await vi.waitFor(() =>
                expect(guide.evaluateMany).toHaveBeenCalled(),
            );

            expect(checklist.getSelections()).toEqual(newer);
        });

        it('shows the marking, its breakdown and its failure notice in the named element', async () => {
            const target = onPage('div', 'page-result');
            await mountFromMarkup({ result: 'page-result', selected: SEED });

            for (const selector of [
                '.ezc-guide-result',
                '.ezc-guide-breakdown',
                '.ezc-guide-error',
            ]) {
                expect(target.querySelector(selector)).not.toBeNull();
                expect(container.querySelector(selector)).toBeNull();
            }
            expect(
                target.querySelector('.ezc-guide-result-value')?.textContent,
            ).toBe('MARK-1');
            expect(
                target
                    .querySelector('.ezc-guide-result')
                    ?.closest('[data-ezclassify]'),
            ).not.toBeNull();
        });

        it('empties the named result element on teardown', async () => {
            const target = onPage('div', 'page-result');
            await mountFromMarkup({ result: 'page-result' });
            checklist.destroy();
            expect(target.childElementCount).toBe(0);
        });

        it.each([
            ['an editor naming no element', { editor: 'absent' }],
            ['an editor naming something else', { editor: 'not-a-textarea' }],
            ['a result naming no element', { result: 'absent' }],
            ['a result with no id', { result: '' }],
        ])('refuses %s', async (_name, attributes) => {
            onPage('div', 'not-a-textarea');
            const { guide, errors } = await mountFromMarkup({
                ...attributes,
                selected: SEED,
            });
            expect(errors.map((e) => e.code)).toEqual(['guide-target-missing']);
            expect(guide.evaluateMany).not.toHaveBeenCalled();
            expect(container.querySelector('.ezc-guide-result')).toBeNull();
        });
    });

    it('checkbox accessible name matches rule name', async () => {
        await init();
        // First checkbox (rule-a = 'Rule Alpha') should have 'Rule Alpha' in its label text.
        const firstCheckbox = container.querySelector<HTMLInputElement>(
            'input[type="checkbox"][value="rule-a"]',
        );
        expect(firstCheckbox).not.toBeNull();
        const label = firstCheckbox?.closest('label');
        expect(label?.textContent).toContain('Rule Alpha');
    });
});

describe('GuideChecklist marking typography', () => {
    it('writes the computed marking and each outcome in the chrome font, not a code font', () => {
        // A marking is not code. It reads in the font of the rest of the
        // helper, which the host sets through --ez-font-family.
        const css = readFileSync(
            join(dirname(fileURLToPath(import.meta.url)), 'guide-helper.css'),
            'utf8',
        ).replace(/\/\*[\s\S]*?\*\//g, '');
        const rule = (selector: string) =>
            css.match(new RegExp(`\\${selector}\\s*\\{([^}]*)\\}`))?.[1];
        for (const selector of [
            '.ezc-guide-result-value',
            '.ezc-guide-breakdown-outcome',
        ]) {
            const body = rule(selector);
            expect(body, selector).toBeDefined();
            expect(body, selector).not.toMatch(/font-family/);
        }
        expect(css).not.toMatch(/mono/);
        expect(rule('.ezc-guide-helper')).toMatch(
            /font-family:\s*var\(--ez-font-family, inherit\)/,
        );
    });
});
