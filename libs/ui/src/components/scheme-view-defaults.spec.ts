/**
 * Tests that components resolve their default format from the scheme's
 * part/whole role metadata rather than always using defaultRenderFormat.
 *
 * Design: the scheme declares a defaultPartRenderFormat (for inline/part
 * contexts) and a defaultWholeRenderFormat (for banner/whole-document
 * contexts). Components pick the right one based on their rendering role.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import type { SchemeEngineAdapter, SchemePublicView } from '@ezclassify/types';
import { Context } from '@ezclassify/engine';
import { mockRenderFormat } from '../render-format-layout-mock';
import { mockScanOutcome } from '../engine-result-mock';

const toCtx = (eng: unknown) => Context.fromSchemeEngine(eng as never);
import { TagInput } from './tag-input';
import { StatusBanner } from './status-banner';
import { EzClassifyText } from './ezclassify-text';
import { MarkedTextArea } from './marked-text-area';
import { MarkedInput } from './marked-input';

/** A profile with distinct short (part) and long (whole) formats. */
function makeProfile() {
    return {
        id: 'test',
        version: '1.0',
        name: 'Test',
        defaultRenderFormat: 'long',
        formats: [
            {
                id: 'long',
                categoryOrder: ['cat1'],
                separator: ' ',
                categorySeparator: '//',
                view: 'long',
            },
            {
                id: 'short',
                categoryOrder: ['cat1'],
                separator: ' ',
                categorySeparator: '//',
                view: 'short',
                prefix: '(',
                suffix: ')',
            },
        ],
        categories: [
            { id: 'cat1', label: 'Cat', single: true, required: false },
        ],
        concepts: [
            {
                id: 'A',
                name: 'Alpha',
                views: { long: 'ALPHA LONG', short: 'ALPHA', default: 'A' },
                categories: ['cat1'],
            },
        ],
        scopes: [],
        embeddedMarking: [
            { pattern: '\\(([^)]+)\\)', template: '({marking}) ' },
        ],
        contextFormats: { whole: ['long'], part: ['short'] },
    };
}

/**
 * Build a mock engine. The process, validate and render mocks return
 * format-specific values so callers can tell which format was actually used.
 *
 * - Short format → process and validate return '(ALPHA)', render returns
 *   '(ALPHA)'
 * - Long format → process and validate return 'ALPHA LONG', render returns 'ALPHA
 *   LONG'
 *
 * Operations name the format the result is written in with `outputFormat`;
 * `render` still takes the format as its second positional argument.
 */
function makeEngine(
    opts: {
        defaultPartRenderFormat?: string;
        defaultWholeRenderFormat?: string;
        defaultRenderFormat?: string;
    } = {},
) {
    const scheme = makeProfile() as unknown as SchemePublicView;

    const meta = {
        id: 'test',
        version: '1.0',
        name: 'Test',
        defaultRenderFormat: opts.defaultRenderFormat ?? 'long',
        defaultPartRenderFormat: opts.defaultPartRenderFormat,
        defaultWholeRenderFormat: opts.defaultWholeRenderFormat,
        formats: [
            mockRenderFormat({
                id: 'long',
                view: 'long',
                categoryOrder: ['cat1'],
                separator: ' ',
                categorySeparator: '//',
            }),
            mockRenderFormat({
                id: 'short',
                view: 'short',
                categoryOrder: ['cat1'],
                separator: ' ',
                categorySeparator: '//',
            }),
        ],
        scopes: [],
    };

    function formatSensitiveResult(optsArg?: any) {
        const fmt =
            typeof optsArg === 'object'
                ? optsArg?.outputFormat
                : (optsArg ?? 'long');
        const rendered = fmt === 'short' ? '(ALPHA)' : 'ALPHA LONG';
        return {
            assertions: [
                {
                    conceptId: 'A',
                    categoryId: 'cat1',
                    confidence: 'certain',
                    source: 'parse',
                },
            ],
            rendered,
            valid: true,
            recognition: {
                status: 'complete',
                inputFormat: 'long',
                surface: 'marking',
                unmatched: [],
                corrections: [],
            },
        };
    }

    return {
        getScheme: () => scheme,
        getSchemeMeta: (_schemeId?: string) => meta,
        listCategories: () => scheme.categories ?? [],
        getConceptsInCategory: (catId: string) =>
            (scheme.concepts ?? []).filter((c: any) =>
                c.categories?.includes(catId),
            ),
        render: vi.fn((_assertions: any, format?: string) => ({
            rendered: format === 'short' ? '(ALPHA)' : 'ALPHA LONG',
            assessment: {
                emitted: [],
                omitted: [],
                collapsed: [],
                conflicts: [],
                unrepresentable: [],
            },
        })),
        process: vi.fn((_input: any, optsArg?: any) =>
            formatSensitiveResult(optsArg),
        ),
        // Read-only controllers read through validate; it writes the same way.
        validate: vi.fn((_input: any, optsArg?: any) =>
            formatSensitiveResult(optsArg),
        ),
        scan: vi.fn(() => mockScanOutcome()),
        suggest: vi.fn(() => ({ suggestions: [] })),
        checkCoverage: vi.fn(() => ({ covered: true })),
        describeConcept: (conceptId: string) => ({ lines: [conceptId] }),
    } as unknown as SchemeEngineAdapter;
}

function makeContainer(role?: string): HTMLDivElement {
    const div = document.createElement('div');
    if (role) div.setAttribute('data-ezclassify-role', role);
    document.body.appendChild(div);
    return div;
}

function makeNativeContainer(tag: 'input' | 'textarea'): HTMLDivElement {
    const div = document.createElement('div');
    const ta = document.createElement(tag);
    div.appendChild(ta);
    document.body.appendChild(div);
    return div;
}

describe('scheme view defaults: components inherit part/whole role from scheme meta', () => {
    afterEach(() => {
        document.body.innerHTML = '';
    });

    describe('TagInput', () => {
        it('uses the whole-format view for both the value and selected tags', async () => {
            const engine = makeEngine({
                defaultPartRenderFormat: 'short',
                defaultWholeRenderFormat: 'long',
                defaultRenderFormat: 'long',
            });
            const container = makeContainer();
            const tags = new TagInput();
            await tags.init(container, toCtx(engine));
            await tags.setValue('A');
            // Wait for the render pass to complete
            await new Promise((r) => setTimeout(r, 30));

            // Native input value stays in the whole format (safe for forms rollup)
            expect(tags.getRendered()).toBe('ALPHA LONG');

            const chip = container.querySelector('.proto-tag');
            expect(chip).toBeTruthy();
            expect(chip!.textContent).toContain('ALPHA LONG');
        });

        it('falls back to defaultRenderFormat value when defaultPartRenderFormat absent', async () => {
            const engine = makeEngine({ defaultRenderFormat: 'long' });
            const container = makeContainer();
            const tags = new TagInput();
            await tags.init(container, toCtx(engine));
            await tags.setValue('A');

            expect(tags.getRendered()).toBe('ALPHA LONG');
        });

        it('host override via formatId option beats scheme whole-format default', async () => {
            const engine = makeEngine({
                defaultPartRenderFormat: 'short',
                defaultWholeRenderFormat: 'long',
                defaultRenderFormat: 'long',
            });
            const container = makeContainer();
            const tags = new TagInput();
            // Explicit 'short' overrides the scheme's whole-format default 'long'
            await tags.init(container, toCtx(engine), { formatId: 'short' });
            await tags.setValue('A');

            // When explicitly overridden to 'short', getRendered() returns short format
            expect(tags.getRendered()).toBe('(ALPHA)');
            expect(
                container.querySelector('.proto-tag')!.textContent,
            ).toContain('ALPHA');
            expect(
                container.querySelector('.proto-tag')!.textContent,
            ).not.toContain('ALPHA LONG');
        });
    });

    describe('StatusBanner', () => {
        it('uses defaultWholeRenderFormat, not the part format', async () => {
            const engine = makeEngine({
                defaultPartRenderFormat: 'short',
                defaultWholeRenderFormat: 'long',
                defaultRenderFormat: 'long',
            });
            const container = makeContainer();
            const banner = new StatusBanner();
            await banner.init(container, toCtx(engine), {
                showCurrentData: true,
            });
            await banner.setValue('A');

            // Whole format → 'ALPHA LONG'; process returns format-specific rendered
            expect(banner.getRendered()).toBe('ALPHA LONG');
        });

        it('falls back to defaultRenderFormat when defaultWholeRenderFormat absent', async () => {
            const engine = makeEngine({
                defaultPartRenderFormat: 'short',
                defaultRenderFormat: 'long',
            });
            const container = makeContainer();
            const banner = new StatusBanner();
            await banner.init(container, toCtx(engine));
            await banner.setValue('A');

            expect(banner.getRendered()).toBe('ALPHA LONG');
        });

        it('host override via formatId option beats scheme default', async () => {
            const engine = makeEngine({
                defaultPartRenderFormat: 'short',
                defaultWholeRenderFormat: 'long',
                defaultRenderFormat: 'long',
            });
            const container = makeContainer();
            const banner = new StatusBanner();
            await banner.init(container, toCtx(engine), { formatId: 'short' });
            await banner.setValue('A');

            expect(banner.getRendered()).toBe('(ALPHA)');
        });
    });

    describe('EzClassifyText', () => {
        it('uses defaultPartRenderFormat when role=part', async () => {
            const container = makeContainer('part');
            const engine = makeEngine({
                defaultPartRenderFormat: 'short',
                defaultWholeRenderFormat: 'long',
                defaultRenderFormat: 'long',
            });
            const text = new EzClassifyText();
            await text.init(container as HTMLDivElement, toCtx(engine));
            await text.setValue('A');

            expect(text.getRendered()).toBe('(ALPHA)');
        });

        it('uses defaultWholeRenderFormat when role=whole', async () => {
            const container = makeContainer('whole');
            const engine = makeEngine({
                defaultPartRenderFormat: 'short',
                defaultWholeRenderFormat: 'long',
                defaultRenderFormat: 'long',
            });
            const text = new EzClassifyText();
            await text.init(container as HTMLDivElement, toCtx(engine));
            await text.setValue('A');

            expect(text.getRendered()).toBe('ALPHA LONG');
        });

        it('uses defaultRenderFormat when no role declared', async () => {
            const container = makeContainer(); // no role attr
            const engine = makeEngine({
                defaultPartRenderFormat: 'short',
                defaultRenderFormat: 'long',
            });
            const text = new EzClassifyText();
            await text.init(container as HTMLDivElement, toCtx(engine));
            await text.setValue('A');

            expect(text.getRendered()).toBe('ALPHA LONG');
        });

        it('host override via formatId option beats role default', async () => {
            const container = makeContainer('part'); // role=part → would use 'short'
            const engine = makeEngine({
                defaultPartRenderFormat: 'short',
                defaultRenderFormat: 'long',
            });
            const text = new EzClassifyText();
            // Explicit 'long' overrides role='part' default 'short'
            await text.init(container as HTMLDivElement, toCtx(engine), {
                formatId: 'long',
            });
            await text.setValue('A');

            expect(text.getRendered()).toBe('ALPHA LONG');
        });
    });

    describe('MarkedTextArea', () => {
        it('passes defaultPartRenderFormat to engine.scan', async () => {
            const engine = makeEngine({
                defaultPartRenderFormat: 'short',
                defaultRenderFormat: 'long',
            });
            const container = makeNativeContainer('textarea');
            const mta = new MarkedTextArea();
            await mta.init(container, toCtx(engine));

            const ta = container.querySelector('textarea')!;
            ta.value = '(A) Some text';
            ta.dispatchEvent(new Event('input', { bubbles: true }));

            // Wait past the 300ms sync debounce
            await new Promise((r) => setTimeout(r, 400));

            const scanCalls = (engine.scan as ReturnType<typeof vi.fn>).mock
                .calls;
            expect(scanCalls.length).toBeGreaterThan(0);
            const scanOpts = scanCalls[0][1] as any;
            expect(
                typeof scanOpts === 'object'
                    ? scanOpts?.outputFormat
                    : undefined,
            ).toBe('short');
        });
    });

    describe('MarkedInput', () => {
        it('passes defaultPartRenderFormat to engine.process', async () => {
            const engine = makeEngine({
                defaultPartRenderFormat: 'short',
                defaultRenderFormat: 'long',
            });
            const container = makeNativeContainer('input');
            const mi = new MarkedInput();
            await mi.init(container, toCtx(engine));

            const input = container.querySelector('textarea')!;
            input.value = '(A)';
            input.dispatchEvent(new Event('input', { bubbles: true }));

            await new Promise((r) => setTimeout(r, 100));

            const processCalls = (engine.process as ReturnType<typeof vi.fn>)
                .mock.calls;
            expect(processCalls.length).toBeGreaterThan(0);
            // Find a process call with outputFormat='short'
            const formats = processCalls
                .map((c: any[]) =>
                    typeof c[1] === 'object' ? c[1]?.outputFormat : undefined,
                )
                .filter(Boolean);
            expect(formats.some((f: string) => f === 'short')).toBe(true);
        });
    });
});
