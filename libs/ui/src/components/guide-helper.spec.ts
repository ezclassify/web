import { describe, it, expect, beforeEach, vi } from 'vitest';
import { GuideChecklist } from './guide-helper';
import type { SchemeEngineAdapter } from '@ezclassify/types';
import type { GuideStructuralView, GuideRuleView } from '@ezclassify/types';
import type { EvaluationResult } from '@ezclassify/types';
import { Context } from '@ezclassify/engine';
import { mockRenderFormat } from '../render-format-layout-mock';

const toCtx = (eng: unknown) => Context.fromSchemeEngine(eng as never);

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

    it('shows only the rule version the loaded guide stack evaluates', async () => {
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
        expect(rows).toHaveLength(1);
        expect(rows[0].closest('label')?.textContent).toContain('Second rule');
        rows[0].click();
        expect(checklist.getSelectedRuleIds()).toEqual(['shared']);
    });

    it('nominates a shared rule only from its active guide and updates its badge', async () => {
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
            textInput: true,
        });
        const scan = vi.fn((text: string) =>
            text === 'none' ? [] : [{ rule: { id: 'shared' }, guideId: text }],
        );
        (
            checklist as unknown as { guideAdapter: { scan: typeof scan } }
        ).guideAdapter = { scan };
        const row = container.querySelector<HTMLElement>(
            '[data-rule-id="shared"]',
        )!;
        const badge = row.querySelector<HTMLElement>(
            '.ezc-guide-nominated-badge',
        )!;
        const status = container.querySelector<HTMLElement>(
            '.ezc-guide-nomination-status',
        )!;

        await checklist.analyzeText('guide-a');
        expect(row.dataset.nominated).toBe('false');
        expect(badge.hidden).toBe(true);
        expect(status.textContent).toContain('No rules nominated');

        await checklist.analyzeText('guide-b');
        expect(row.dataset.nominated).toBe('true');
        expect(badge.hidden).toBe(false);
        expect(status.textContent).toContain('1 rule nominated');

        await checklist.analyzeText('none');
        expect(row.dataset.nominated).toBe('false');
        expect(badge.hidden).toBe(true);
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
        expect(checklist.getSelectedRuleIds()).toHaveLength(0);
    });

    it('adds a rule to selection when checkbox is checked', async () => {
        await init();
        const checkbox = container.querySelector<HTMLInputElement>(
            'input[value="rule-a"]',
        );
        expect(checkbox).not.toBeNull();
        checkbox!.checked = true;
        checkbox!.dispatchEvent(new Event('change', { bubbles: true }));
        expect(checklist.getSelectedRuleIds()).toContain('rule-a');
    });

    it('removes a rule from selection when checkbox is unchecked', async () => {
        await init();
        const checkbox = container.querySelector<HTMLInputElement>(
            'input[value="rule-a"]',
        )!;
        checkbox.checked = true;
        checkbox.dispatchEvent(new Event('change', { bubbles: true }));
        expect(checklist.getSelectedRuleIds()).toContain('rule-a');

        const checkbox2 = container.querySelector<HTMLInputElement>(
            'input[value="rule-a"]',
        )!;
        checkbox2.checked = false;
        checkbox2.dispatchEvent(new Event('change', { bubbles: true }));
        expect(checklist.getSelectedRuleIds()).not.toContain('rule-a');
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

        checklist.setSelectedRuleIds(['rule-a', 'rule-b']);

        expect(mockGuideAdapter.evaluateMany).toHaveBeenCalledWith([
            'rule-a',
            'rule-b',
        ]);
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

        checklist.setSelectedRuleIds(['rule-a', 'rule-z']);
        await vi.waitFor(() =>
            expect(checklist.getEvaluation()).toEqual(mockEval),
        );

        expect(remoteGuideAdapter.evaluateMany).toHaveBeenCalledWith([
            'rule-a',
            'rule-z',
        ]);
        expect(remoteGuideAdapter.evaluate).not.toHaveBeenCalled();
    });

    it('keeps lexical scan hits as nominations until the reviewer selects them', async () => {
        await init();
        const mockGuideAdapter = {
            evaluateMany: vi.fn(),
            scan: vi.fn(() => [
                { rule: { id: 'rule-a' } },
                { rule: { id: 'rule-b' } },
            ]),
        };
        (
            checklist as unknown as { guideAdapter: typeof mockGuideAdapter }
        ).guideAdapter = mockGuideAdapter;

        checklist.setSelectedRuleIds(['rule-c']);
        // Scanning is an adapter operation and resolves asynchronously; the
        // component awaits the hits before it paints the nominations.
        await checklist.analyzeText('alpha bravo');

        expect(checklist.getSelectedRuleIds()).toEqual(['rule-c']);
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
        newScan.resolve([{ rule: { id: 'rule-b' } }]);
        await newRequest;
        oldScan.resolve([{ rule: { id: 'rule-a' } }]);
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
        await init({ textInput: true });
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
            checklist.setSelectedRuleIds(['rule-a']);
            checklist.setSelectedRuleIds(['rule-a', 'rule-b']);
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

        checklist.setSelectedRuleIds(['rule-a']);

        expect(
            container.querySelector('.ezc-guide-breakdown-name')?.textContent,
        ).toBe('Rule Alpha');
        const outcome = container.querySelector('.ezc-guide-breakdown-outcome');
        expect(outcome?.textContent).toBe(longOutcome);
        expect(outcome?.querySelectorAll('wbr')).toHaveLength(2);
    });

    it('programmatic setSelectedRuleIds reflects in checked state', async () => {
        await init();
        checklist.setSelectedRuleIds(['rule-b', 'rule-c']);
        expect(checklist.getSelectedRuleIds()).toEqual(
            expect.arrayContaining(['rule-b', 'rule-c']),
        );
        expect(checklist.getSelectedRuleIds()).not.toContain('rule-a');
    });

    it('clearSelection removes all selected rules', async () => {
        await init();
        checklist.setSelectedRuleIds(['rule-a', 'rule-b']);
        checklist.clearSelection();
        expect(checklist.getSelectedRuleIds()).toHaveLength(0);
    });

    it('search filter hides non-matching rules', async () => {
        await init();
        checklist.setSearchQuery('bravo');
        const hidden = container.querySelectorAll('.ezc-guide-rule--hidden');
        // 'Rule Alpha' and 'Rule Charlie' should be hidden; 'Rule Bravo' visible
        expect(hidden.length).toBe(2);
    });

    it('searches the active rule when a later guide reuses its id', async () => {
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
        expect(rows).toHaveLength(1);
        expect(rows[0].textContent).toContain('Unique Beta');
        expect(rows[0].classList.contains('ezc-guide-rule--hidden')).toBe(
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
            checklist.setSelectedRuleIds(['rule-a']);
            checklist.setSelectedRuleIds(['rule-b']);
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
        ): Promise<void> {
            const ctx = toCtx(engine);
            (
                ctx as unknown as { guide: { buildGuideViews: () => unknown } }
            ).guide = { buildGuideViews: () => views };
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
            await initRemote(pending.promise);
            expect(() =>
                checklist.setSelectedRuleIds(['rule-a']),
            ).not.toThrow();
            pending.resolve([TEST_GUIDE_VIEW]);
            await vi.waitFor(() =>
                expect(
                    container.querySelector<HTMLInputElement>(
                        'input[value="rule-a"]',
                    )?.checked,
                ).toBe(true),
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
            const scan = vi.fn(() => [{ rule: { id: 'rule-a' } }]);
            (
                checklist as unknown as { guideAdapter: { scan: typeof scan } }
            ).guideAdapter = { scan };
            await expect(checklist.analyzeText('alpha')).resolves.toEqual([
                { rule: { id: 'rule-a' } },
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

        it('filters a pre-load scan after the active guide views arrive', async () => {
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
                        .querySelector('[data-rule-id="rule-a"]')
                        ?.getAttribute('data-nominated'),
                ).toBe('false'),
            );
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
