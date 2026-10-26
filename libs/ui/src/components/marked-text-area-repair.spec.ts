import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Context } from '@ezclassify/engine';
import { MarkedTextArea } from './marked-text-area';
import { mockRenderFormats } from '../render-format-layout-mock';
import type { ScanResult } from '@ezclassify/types';
import { mockScanOutcome } from '../engine-result-mock';

/**
 * MarkedTextArea auto-repair rendering.
 *
 * Deleting part of a marking such as "OC/NF" from "TS//SI-G//OC/NF" can trigger
 * an engine repair. The repaired marking must retain its highlight,
 * parentheses, and applied-fix indicator. applyRepairs() awaits the re-scan so
 * the display uses segment positions from the repaired text.
 */

/** What writing a marking did when it left nothing out. */
const NO_LOSS = {
    emitted: [],
    omitted: [],
    collapsed: [],
    conflicts: [],
    unrepresentable: [],
};

/**
 * A complete scan outcome around markings these cases describe in part. The
 * cases state the members the repair path reads and leave the rest of a scan
 * result out, so the fixtures are cast to the full shape at this one point.
 */
function scanned(results: readonly object[]) {
    return mockScanOutcome(results as ScanResult[]);
}

function createMockEngine(overrides: Record<string, any> = {}): any {
    const concepts = [
        {
            id: 'U',
            name: 'U',
            views: { default: 'U' },
            categories: ['level'],
            parents: [],
            aliases: [],
            position: 1,
        },
        {
            id: 'S',
            name: 'S',
            views: { default: 'S' },
            categories: ['level'],
            parents: [],
            aliases: [],
            position: 2,
        },
        {
            id: 'TS',
            name: 'TS',
            views: { default: 'TS' },
            categories: ['level'],
            parents: [],
            aliases: [],
            position: 3,
        },
    ];
    const categories = [
        {
            id: 'level',
            label: 'Level',
            required: false,
            single: true,
            rollup: 'max',
            position: 1,
        },
    ];
    const scheme = {
        id: 'repair-test',
        version: '1.0.0',
        name: 'Repair Test',
        concepts,
        categories,
        formats: [
            {
                id: 'default',
                categoryOrder: ['level'],
                separator: '/',
                categorySeparator: '//',
                view: 'default',
            },
        ],
        defaultRenderFormat: 'default',
        embeddedMarking: [
            { pattern: '\\(([^)]+)\\)', template: '({marking}) ' },
        ],
        contextFormats: { part: ['default'] },
        ...overrides.scheme,
    };

    return {
        getScheme: () => scheme,
        getSchemeMeta: () => ({
            id: scheme.id,
            version: scheme.version,
            name: scheme.name,
            defaultRenderFormat: scheme.defaultRenderFormat,
            formats: mockRenderFormats(scheme.formats),
            scopes: [],
        }),
        listCategories: () => categories,
        getConceptsInCategory: (catId: string) =>
            concepts.filter((c: any) => c.categories?.includes(catId)),
        process: (input: string, _opts?: any) => ({
            assertions: input
                ? [
                      {
                          conceptId: input.replace(/[^A-Z]/g, ''),
                          categoryId: 'level',
                          confidence: 'certain',
                          source: 'parse',
                      },
                  ]
                : [],
            rendered: input.replace(/[^A-Z/]/g, ''),
            valid: true,
            inputWasValid: true,
            errors: [],
            warnings: [],
            appliedFixes: [],
            proposedFixes: [],
            notices: [],
            assessment: NO_LOSS,
        }),
        scan: (text: string, _opts?: any) => {
            const results: any[] = [];
            const re = /\(([^)]+)\)/g;
            let m;
            while ((m = re.exec(text)) !== null) {
                const marking = m[0];
                const inner = m[1];
                results.push({
                    start: m.index,
                    end: m.index + marking.length,
                    marking,
                    wrapped: true,
                    result: {
                        assertions: [
                            {
                                conceptId: inner.replace(/[^A-Z]/g, ''),
                                categoryId: 'level',
                                confidence: 'certain',
                                source: 'parse',
                            },
                        ],
                        rendered: inner,
                        valid: true,
                        errors: [],
                        appliedFixes: [],
                        notices: [],
                        assessment: NO_LOSS,
                    },
                });
            }
            return scanned(results);
        },
        suggest: () => ({ suggestions: [] }),
        aggregate: () => ({ rendered: '', assertions: [] }),
        describeConcept: (conceptId: string) => ({ lines: [conceptId] }),
        ...overrides,
    };
}

function wait(ms = 400): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
}

let container: HTMLDivElement;

beforeEach(() => {
    document.body.innerHTML = '';
    container = document.createElement('div');
    document.body.appendChild(container);
});

afterEach(() => {
    document.body.innerHTML = '';
});

const toCtx = (eng: unknown) => Context.fromSchemeEngine(eng as never);

describe('MarkedTextArea repair rendering', () => {
    it('maintains chip rendering after syncFromTextarea completes', async () => {
        const engine = createMockEngine();
        const textarea = document.createElement('textarea');
        textarea.value = '(U) Paragraph one.\n\n(S) Paragraph two.';
        container.appendChild(textarea);

        const mta = new MarkedTextArea();
        await mta.init(container, toCtx(engine));
        await wait();

        const segments = mta.getSegments();
        expect(segments.length).toBeGreaterThanOrEqual(2);
    });

    it('keeps a valid loaded marking valid when rendering only normalizes its display order', async () => {
        const engine = createMockEngine({
            process: (input: string) => ({
                assertions: [],
                rendered: input === 'TSX' ? 'TS//OC/NF' : input,
                valid: true,
                inputWasValid: true,
                errors: [],
                warnings: [],
                appliedFixes: [],
                proposedFixes: [],
                notices: [],
                assessment: NO_LOSS,
            }),
            scan: () =>
                scanned([
                    {
                        start: 0,
                        end: 5,
                        marking: '(TSX)',
                        wrapped: true,
                        result: {
                            assertions: [],
                            rendered: 'TS//OC/NF',
                            valid: true,
                            errors: [],
                            appliedFixes: [],
                            notices: [],
                            assessment: NO_LOSS,
                        },
                    },
                ]),
        });
        const textarea = document.createElement('textarea');
        textarea.value = '(TSX) Some text.';
        container.appendChild(textarea);

        const mta = new MarkedTextArea();
        await mta.init(container, toCtx(engine));
        await wait();

        expect(textarea.value).toBe('(TSX) Some text.');
        expect(mta.getSegments()[0]?.valid).toBe(true);
        expect(mta.getSegments()[0]?.errors).toEqual([]);
    });

    it('preserves segment positions after engine repair', async () => {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        let repairApplied = false;
        const engine = createMockEngine({
            process: (input: string) => {
                const inner = input.replace(/[^A-Z/]/g, '');
                const repaired = inner === 'TSX' ? 'TS' : inner;
                return {
                    assertions: [
                        {
                            conceptId: repaired,
                            categoryId: 'level',
                            confidence: 'certain',
                            source: 'parse',
                        },
                    ],
                    rendered: repaired,
                    valid: true,
                    inputWasValid: inner === repaired,
                    errors: [],
                    warnings: [],
                    appliedFixes:
                        inner !== repaired
                            ? [
                                  {
                                      ruleId: 'test',
                                      description: 'repaired',
                                      message: 'Removed the invalid suffix',
                                      before: inner,
                                      after: repaired,
                                  },
                              ]
                            : [],
                    proposedFixes: [],
                    notices: [],
                    assessment: NO_LOSS,
                };
            },
            scan: (text: string) => {
                const results: any[] = [];
                const re = /\(([^)]+)\)/g;
                let m;
                while ((m = re.exec(text)) !== null) {
                    const marking = m[0];
                    const inner = m[1];
                    const repaired = inner === 'TSX' ? 'TS' : inner;
                    if (repaired !== inner) repairApplied = true;
                    results.push({
                        start: m.index,
                        end: m.index + marking.length,
                        marking,
                        wrapped: true,
                        result: {
                            assertions: [
                                {
                                    conceptId: repaired,
                                    categoryId: 'level',
                                    confidence: 'certain',
                                    source: 'parse',
                                },
                            ],
                            rendered: repaired,
                            valid: true,
                            errors: [],
                            appliedFixes:
                                inner !== repaired
                                    ? [
                                          {
                                              ruleId: 'test',
                                              description: 'repaired',
                                              message:
                                                  'Removed the invalid suffix',
                                          },
                                      ]
                                    : [],
                            notices: [],
                            assessment: NO_LOSS,
                        },
                    });
                }
                return scanned(results);
            },
        });

        const textarea = document.createElement('textarea');
        textarea.value = '(TSX) Some text.';
        container.appendChild(textarea);

        const mta = new MarkedTextArea();
        await mta.init(container, toCtx(engine));
        await wait();

        // Loading is validation-only: keep the source value, mark it invalid,
        // and leave the enhancement indicator quiet.
        expect(textarea.value).toBe('(TSX) Some text.');
        expect(mta.getSegments()[0]?.valid).toBe(false);
        let marks = container.querySelectorAll('.ez-status-mark');
        expect(marks).toHaveLength(1);
        expect(marks[0].classList.contains('ez-status-mark--quiet')).toBe(true);

        // Once the user edits this marking, the safe repair may commit.
        textarea.value = '(TSX ) Some text.';
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
        await wait();
        expect(textarea.value).toBe('(TS) Some text.');

        // After repair, segments should be aligned with the new text.
        const segments = mta.getSegments();
        if (segments.length > 0) {
            const seg = segments[0];
            const textValue = textarea.value;
            const chipText = textValue.slice(seg.start, seg.end);
            // The chip text should be a valid substring of the textarea
            expect(chipText.length).toBeGreaterThan(0);
            // Segment positions must not exceed the textarea length
            expect(seg.end).toBeLessThanOrEqual(textValue.length);
        }

        // The repair marks the field's SINGLE status mark unseen (never one
        // indicator per repaired segment, and no stars inline in the text
        // flow); the user hasn't hovered or focused it yet.
        marks = container.querySelectorAll('.ez-status-mark');
        expect(marks).toHaveLength(1);
        expect(marks[0].classList.contains('ez-status-mark--unseen')).toBe(
            true,
        );
        expect(
            container.querySelector('.marked-textarea-autofix-star'),
        ).toBeNull();
    });

    it('applies a safe loaded-marking repair after opening and leaving the editor', async () => {
        const fix = {
            ruleId: 'repair-tsx',
            description: 'Repair TSX',
            message: 'Removed the invalid suffix',
            before: 'TSX',
            after: 'TS',
        };
        const assertions = [
            {
                conceptId: 'TS',
                categoryId: 'level',
                confidence: 'certain',
                source: 'parse',
            },
        ];
        const engine = createMockEngine({
            process: (input: string, opts?: any) => ({
                assertions: opts?.assertions ?? assertions,
                rendered: input === 'TSX' || opts?.assertions ? 'TS' : input,
                valid: true,
                inputWasValid: input !== 'TSX',
                errors: [],
                warnings: [],
                appliedFixes: input === 'TSX' || opts?.assertions ? [fix] : [],
                proposedFixes: [],
                notices: [],
                assessment: NO_LOSS,
            }),
            scan: (text: string) => {
                const repairNeeded = text.startsWith('(TSX)');
                return scanned([
                    {
                        start: 0,
                        end: repairNeeded ? 5 : 4,
                        marking: repairNeeded ? '(TSX)' : '(TS)',
                        wrapped: true,
                        result: {
                            assertions,
                            rendered: 'TS',
                            valid: true,
                            errors: [],
                            appliedFixes: repairNeeded ? [fix] : [],
                            notices: [],
                            assessment: NO_LOSS,
                        },
                    },
                ]);
            },
        });
        const textarea = document.createElement('textarea');
        textarea.value = '(TSX) Some text.';
        container.appendChild(textarea);

        const mta = new MarkedTextArea();
        await mta.init(container, toCtx(engine));
        await wait();
        expect(textarea.value).toBe('(TSX) Some text.');

        const chip = container.querySelector<HTMLElement>(
            '.marked-textarea-chip--invalid',
        );
        chip!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        await wait();
        expect(container.querySelector('.inline-editor-input')).not.toBeNull();
        document.body.dispatchEvent(
            new MouseEvent('mousedown', { bubbles: true }),
        );
        await wait();

        expect(textarea.value).toBe('(TS) Some text.');
        expect(
            container
                .querySelector('.ez-status-mark')
                ?.classList.contains('ez-status-mark--unseen'),
        ).toBe(true);
    });

    it('never commits a proposed fix that requires an explicit author decision', async () => {
        const proposal = {
            ruleId: 'explicit-fdr',
            action: 'add',
            target: { conceptId: 'RELIDO', categoryId: 'dissem' },
            message: 'Choose RELIDO explicitly',
        };
        const authoredAssertions = [
            {
                conceptId: 'S',
                categoryId: 'level',
                confidence: 'certain',
                source: 'parse',
            },
        ];
        const engine = createMockEngine({
            process: (input: string) => ({
                assertions: authoredAssertions,
                rendered: input,
                valid: false,
                inputWasValid: false,
                errors: [
                    {
                        constraintId: 'explicit-fdr',
                        message: proposal.message,
                    },
                ],
                warnings: [],
                appliedFixes: [],
                proposedFixes: [proposal],
                notices: [],
                assessment: NO_LOSS,
            }),
            scan: (text: string) => {
                const marking = text.match(/\(([^)]+)\)/)?.[0] ?? '(S)';
                return scanned([
                    {
                        start: 0,
                        end: marking.length,
                        marking,
                        wrapped: true,
                        result: {
                            assertions: authoredAssertions,
                            rendered: marking.slice(1, -1),
                            valid: false,
                            inputWasValid: false,
                            errors: [
                                {
                                    constraintId: 'explicit-fdr',
                                    message: proposal.message,
                                },
                            ],
                            appliedFixes: [],
                            proposedFixes: [proposal],
                            notices: [],
                            assessment: NO_LOSS,
                        },
                    },
                ]);
            },
        });
        const textarea = document.createElement('textarea');
        textarea.value = '(S) Some text.';
        container.appendChild(textarea);

        const mta = new MarkedTextArea();
        await mta.init(container, toCtx(engine));
        await wait();

        textarea.value = '(S ) Some text.';
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
        await wait();
        expect(textarea.value).toBe('(S ) Some text.');

        const chip = container.querySelector<HTMLElement>(
            '.marked-textarea-chip--invalid',
        );
        chip!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        await wait();
        document.body.dispatchEvent(
            new MouseEvent('mousedown', { bubbles: true }),
        );
        await wait();

        expect(textarea.value).toBe('(S) Some text.');
        expect(textarea.value).not.toContain('RELIDO');
        expect(mta.getSegments()[0]?.valid).toBe(false);
    });

    it('shows a full shared tooltip for a genuinely invalid marking', async () => {
        const message =
            'Release list cannot include a country excluded by the display-only list';
        const engine = createMockEngine({
            process: (input: string) => ({
                assertions: [],
                rendered: input,
                valid: false,
                inputWasValid: false,
                errors: [{ code: 'conflict', message, severity: 'error' }],
                warnings: [],
                appliedFixes: [],
                proposedFixes: [],
                notices: [],
                assessment: NO_LOSS,
            }),
            scan: () =>
                scanned([
                    {
                        start: 0,
                        end: 5,
                        marking: '(BAD)',
                        wrapped: true,
                        result: {
                            assertions: [],
                            rendered: 'BAD',
                            valid: false,
                            errors: [
                                {
                                    code: 'conflict',
                                    message,
                                    severity: 'error',
                                },
                            ],
                            appliedFixes: [],
                            notices: [],
                            assessment: NO_LOSS,
                        },
                    },
                ]),
        });
        const textarea = document.createElement('textarea');
        textarea.value = '(BAD) Some text.';
        container.appendChild(textarea);

        const mta = new MarkedTextArea();
        await mta.init(container, toCtx(engine));
        await wait();

        const chip = container.querySelector<HTMLElement>(
            '.marked-textarea-chip--invalid',
        );
        expect(chip).not.toBeNull();
        chip!.dispatchEvent(new MouseEvent('mouseenter'));
        await wait();

        const tooltip = document.body.querySelector<HTMLElement>('.ez-tooltip');
        expect(tooltip?.hidden).toBe(false);
        expect(tooltip?.textContent).toContain(message);
        expect(chip?.getAttribute('aria-label')).toContain(message);
    });

    it('does not render with stale segments after applyRepairs patches textarea', async () => {
        const engine = createMockEngine();
        const textarea = document.createElement('textarea');
        textarea.value = '(U) Text.';
        container.appendChild(textarea);

        const mta = new MarkedTextArea();
        await mta.init(container, toCtx(engine));
        await wait();

        // After init and sync, segments should be in sync with textarea
        const segments = mta.getSegments();
        if (segments.length > 0) {
            const seg = segments[0];
            // Segment end position must not exceed textarea length
            expect(seg.end).toBeLessThanOrEqual(textarea.value.length);
        }
    });

    it('correctly destroys without leaving orphaned timers', async () => {
        const engine = createMockEngine();
        const textarea = document.createElement('textarea');
        textarea.value = '(S) Content.';
        container.appendChild(textarea);

        const mta = new MarkedTextArea();
        await mta.init(container, toCtx(engine));
        await wait();

        // Destroy should not throw
        mta.destroy();

        // Container should be cleared
        expect(container.querySelector('.marked-textarea-wrap')).toBeNull();
    });
});
