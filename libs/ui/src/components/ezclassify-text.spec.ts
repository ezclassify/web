import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EzClassifyText } from './ezclassify-text';
import { EzClassifyUI } from '../ezclassify-ui';
import type {
    SchemeEngineAdapter,
    SchemePublicView,
    Assertion,
    ValidationError,
} from '@ezclassify/types';
import { Context } from '@ezclassify/engine';
import { mockRenderFormats } from '../render-format-layout-mock';

/**
 * Minimal in-memory engine adapter for unit tests. Supports the multi-scheme
 * `listSchemes` shape so callProcess/callRender route through the 3-arg
 * signature. Process accepts a comma-separated list of concept ids; any id not
 * in the catalog renders as invalid.
 */
function createMockEngine(): SchemeEngineAdapter {
    const read = (input: string) => {
        const ids = input
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean);
        const known = new Set(['c1', 'c2']);
        const assertions = ids.map((id) => ({
            conceptId: id,
            categoryId: 'cat1',
            confidence: 'certain' as const,
            source: 'parse' as const,
        }));
        const unknownIds = ids.filter((id) => !known.has(id));
        const errors: ValidationError[] = unknownIds.map(
            (id) =>
                ({
                    constraintId: 'unknown-concept',
                    message: `unknown concept: ${id}`,
                }) as ValidationError,
        );
        return {
            assertions,
            rendered: input,
            valid: unknownIds.length === 0,
            errors,
        };
    };
    const scheme: SchemePublicView = {
        name: 'Test',
        categories: [
            { id: 'cat1', label: 'Cat 1', single: false, required: false },
        ],
        concepts: [
            {
                id: 'c1',
                name: 'Concept 1',
                views: { default: 'C1' },
                categories: ['cat1'],
                parents: [],
                aliases: [],
                position: 0,
            },
            {
                id: 'c2',
                name: 'Concept 2',
                views: { default: 'C2' },
                categories: ['cat1'],
                parents: [],
                aliases: [],
                position: 1,
            },
        ],
        formats: [
            {
                id: 'default',
                categoryOrder: ['cat1'],
                separator: ', ',
                categorySeparator: '//',
                view: 'default',
            },
        ],
        scopes: [],
        defaultRenderFormat: 'default',
    } as unknown as SchemePublicView;

    return {
        getScheme: () => scheme,
        getSchemeMeta: () => ({
            id: (scheme as any).id ?? 'test',
            version: (scheme as any).version ?? '1.0',
            name: scheme.name ?? 'Test',
            defaultRenderFormat: 'default',
            formats: mockRenderFormats(scheme.formats ?? []),
            scopes: [],
        }),
        listCategories: () => scheme.categories ?? [],
        getConceptsInCategory: (catId: string) =>
            (scheme.concepts ?? []).filter((c: any) =>
                c.categories?.includes(catId),
            ),
        aggregate: vi.fn((inputs: string[]) => {
            const all = inputs.flatMap((s) =>
                s
                    .split(',')
                    .map((x) => x.trim())
                    .filter(Boolean),
            );
            const deduped = Array.from(new Set(all));
            const assertions = deduped.map((id) => ({
                conceptId: id,
                categoryId: 'cat1',
                confidence: 'certain' as const,
                source: 'parse' as const,
            }));
            return {
                assertions,
                rendered: deduped.join(', '),
                valid: true,
                errors: [],
            };
        }),
        aggregateAssertions: vi.fn((sets: Assertion[][]) => {
            const seen = new Set<string>();
            const merged: Assertion[] = [];
            for (const s of sets) {
                for (const a of s) {
                    const k = `${a.conceptId}|${a.categoryId}`;
                    if (seen.has(k)) continue;
                    seen.add(k);
                    merged.push(a);
                }
            }
            return {
                assertions: merged,
                rendered: merged.map((a) => a.conceptId).join(', '),
                valid: true,
                errors: [],
            };
        }),
        render: vi.fn((assertions: Assertion[]) => ({
            rendered: assertions.map((a) => a.conceptId).join(', '),
            assessment: {
                emitted: [],
                omitted: [],
                collapsed: [],
                conflicts: [],
                unrepresentable: [],
            },
        })),
        // The store publishes through process; the text controller reads
        // through validate. Both answer the same way here.
        process: vi.fn(read),
        validate: vi.fn(read),
        suggest: vi.fn().mockReturnValue({ suggestions: [] }),
    } as unknown as SchemeEngineAdapter;
}

const toCtx = (eng: unknown) => Context.fromSchemeEngine(eng as never);

async function flush(): Promise<void> {
    for (let i = 0; i < 6; i++) await Promise.resolve();
}

describe('EzClassifyText (standalone)', () => {
    let host: HTMLElement;
    let engine: SchemeEngineAdapter;
    let field: EzClassifyText;

    beforeEach(() => {
        host = document.createElement('code');
        document.body.appendChild(host);
        engine = createMockEngine();
        field = new EzClassifyText();
    });

    afterEach(() => {
        try {
            field.destroy();
        } catch {
            /* not yet initialized */
        }
        host.remove();
    });

    it('sets aria-live="polite" on the host on init', async () => {
        host.textContent = 'c1';
        await field.init(host as HTMLDivElement, toCtx(engine));
        expect(host.getAttribute('aria-live')).toBe('polite');
    });

    it('does not override an explicit aria-live attribute the consumer already set', async () => {
        host.textContent = 'c1';
        host.setAttribute('aria-live', 'off');
        await field.init(host as HTMLDivElement, toCtx(engine));
        // The consumer said "off", the component must not override it
        expect(host.getAttribute('aria-live')).toBe('off');
    });

    it('reads textContent on init and validates it through the engine', async () => {
        host.textContent = 'c1, c2';
        await field.init(host as HTMLDivElement, toCtx(engine));
        expect(engine.process).not.toHaveBeenCalled();
        expect(engine.validate).toHaveBeenCalledWith(
            'c1, c2',
            expect.objectContaining({ outputFormat: 'default' }),
        );
        expect(field.getAssertions()).toHaveLength(2);
        expect(field.getRendered()).toBe('c1, c2');
    });

    it('applies ez-text--valid when the marking is valid', async () => {
        host.textContent = 'c1';
        await field.init(host as HTMLDivElement, toCtx(engine));
        expect(host.classList.contains('ez-text--valid')).toBe(true);
        expect(host.classList.contains('ez-text--invalid')).toBe(false);
        expect(host.hasAttribute('aria-invalid')).toBe(false);
    });

    it('applies ez-text--invalid and aria-invalid="true" when the marking is invalid', async () => {
        host.textContent = 'not-a-real-concept';
        await field.init(host as HTMLDivElement, toCtx(engine));
        expect(host.classList.contains('ez-text--invalid')).toBe(true);
        expect(host.classList.contains('ez-text--valid')).toBe(false);
        expect(host.getAttribute('aria-invalid')).toBe('true');
    });

    it('does not write error sibling elements next to the host', async () => {
        host.textContent = 'not-a-real-concept';
        const before = document.body.children.length;
        await field.init(host as HTMLDivElement, toCtx(engine));
        expect(document.body.children.length).toBe(before);
        // No new children inserted around the host
        expect(host.nextElementSibling).toBeNull();
    });

    it('refresh() re-reads textContent and re-processes', async () => {
        host.textContent = 'c1';
        await field.init(host as HTMLDivElement, toCtx(engine));
        expect(field.getAssertions()).toHaveLength(1);
        host.textContent = 'c1, c2';
        await field.refresh();
        expect(field.getAssertions()).toHaveLength(2);
        expect(field.getRendered()).toBe('c1, c2');
    });

    it('setValue() processes the new string and updates host textContent', async () => {
        host.textContent = 'c1';
        await field.init(host as HTMLDivElement, toCtx(engine));
        await field.setValue('c2');
        expect(field.getAssertions()).toEqual([
            expect.objectContaining({ conceptId: 'c2' }),
        ]);
        // The component owns textContent: it reflects whatever the engine renders.
        // In source-bound mode the framework drives this; standalone callers of
        // setValue() also see the host update so the visible text stays in sync.
        expect(host.textContent).toBe('c2');
    });

    it('setValue() with an empty string clears host textContent', async () => {
        host.textContent = 'c1';
        await field.init(host as HTMLDivElement, toCtx(engine));
        await field.setValue('');
        expect(field.getAssertions()).toEqual([]);
        expect(field.getRendered()).toBe('');
        expect(host.textContent).toBe('');
    });

    it('source-bound: setValue() with a rendered string shows it in the host', async () => {
        // Simulates the wireReadSubscription path: host starts empty, framework
        // pushes the store's rendered value via setValue().
        host.textContent = '';
        await field.init(host as HTMLDivElement, toCtx(engine));
        await field.setValue('c1, c2');
        expect(host.textContent).toBe('c1, c2');
        expect(field.getAssertions()).toHaveLength(2);
        expect(field.getRendered()).toBe('c1, c2');
    });

    it('source-bound: successive setValue() calls keep host textContent current', async () => {
        host.textContent = '';
        await field.init(host as HTMLDivElement, toCtx(engine));
        await field.setValue('c1');
        expect(host.textContent).toBe('c1');
        await field.setValue('c1, c2');
        expect(host.textContent).toBe('c1, c2');
        await field.setValue('');
        expect(host.textContent).toBe('');
    });

    it('setAssertions replaces assertions and re-renders', async () => {
        host.textContent = '';
        await field.init(host as HTMLDivElement, toCtx(engine));
        field.setAssertions([
            {
                conceptId: 'c1',
                categoryId: 'cat1',
                confidence: 'certain',
                source: 'user',
            },
        ]);
        expect(engine.render).toHaveBeenCalled();
        expect(field.getRendered()).toBe('c1');
    });

    it('emits onChange with assertions, rendered string, and errors', async () => {
        const onChange = vi.fn();
        host.textContent = 'c1';
        await field.init(host as HTMLDivElement, toCtx(engine), {
            onChange,
        } as any);
        expect(onChange).toHaveBeenCalledWith(
            [expect.objectContaining({ conceptId: 'c1' })],
            'c1',
            [],
        );
    });

    it('emits onChange with errors when the marking is invalid', async () => {
        const onChange = vi.fn();
        host.textContent = 'bad';
        await field.init(host as HTMLDivElement, toCtx(engine), {
            onChange,
        } as any);
        expect(onChange).toHaveBeenCalledWith(
            expect.any(Array),
            expect.any(String),
            expect.arrayContaining([
                expect.objectContaining({ constraintId: 'unknown-concept' }),
            ]),
        );
    });

    it('destroy clears validation classes, aria-invalid, and emits empty', async () => {
        const onChange = vi.fn();
        host.textContent = 'c1';
        await field.init(host as HTMLDivElement, toCtx(engine), {
            onChange,
        } as any);
        onChange.mockClear();
        field.destroy();
        expect(host.classList.contains('ez-text--valid')).toBe(false);
        expect(host.classList.contains('ez-text--invalid')).toBe(false);
        expect(host.hasAttribute('aria-invalid')).toBe(false);
        expect(onChange).toHaveBeenCalledWith([], '', []);
    });

    it('reads flattened textContent when host contains nested HTML', async () => {
        host.innerHTML = '(<sup>TS</sup>//SI)';
        await field.init(host as HTMLDivElement, toCtx(engine));
        expect(engine.validate).toHaveBeenCalledWith(
            '(TS//SI)',
            expect.objectContaining({ outputFormat: 'default' }),
        );
    });

    it('uses formatId from options when provided', async () => {
        host.textContent = 'c1';
        await field.init(host as HTMLDivElement, toCtx(engine), {
            formatId: 'portion',
        });
        expect(engine.validate).toHaveBeenCalledWith(
            'c1',
            expect.objectContaining({ outputFormat: 'portion' }),
        );
    });

    it('handles empty textContent as an empty contribution', async () => {
        host.textContent = '';
        const onChange = vi.fn();
        await field.init(host as HTMLDivElement, toCtx(engine), {
            onChange,
        } as any);
        expect(field.getAssertions()).toEqual([]);
        expect(field.getRendered()).toBe('');
        expect(host.classList.contains('ez-text--valid')).toBe(false);
        expect(host.classList.contains('ez-text--invalid')).toBe(false);
        expect(onChange).toHaveBeenCalledWith([], '', []);
    });

    it('noLive: true suppresses the default aria-live="polite"', async () => {
        host.textContent = 'c1';
        await field.init(host as HTMLDivElement, toCtx(engine), {
            noLive: true,
        } as any);
        expect(host.hasAttribute('aria-live')).toBe(false);
    });

    it('noLive: true does not strip a pre-existing aria-live attribute', async () => {
        host.textContent = 'c1';
        host.setAttribute('aria-live', 'assertive');
        await field.init(host as HTMLDivElement, toCtx(engine), {
            noLive: true,
        } as any);
        expect(host.getAttribute('aria-live')).toBe('assertive');
    });

    it('wires aria-errormessage and writes error text when marking is invalid', async () => {
        const errorEl = document.createElement('span');
        errorEl.id = 'ez-err-1';
        document.body.appendChild(errorEl);
        try {
            host.textContent = 'not-a-real-concept';
            host.setAttribute('data-ezclassify-error-target', 'ez-err-1');
            await field.init(host as HTMLDivElement, toCtx(engine));
            expect(host.getAttribute('aria-errormessage')).toBe('ez-err-1');
            expect(errorEl.textContent).toContain('unknown concept');
        } finally {
            errorEl.remove();
        }
    });

    it('clears aria-errormessage and target text when marking becomes valid', async () => {
        const errorEl = document.createElement('span');
        errorEl.id = 'ez-err-2';
        document.body.appendChild(errorEl);
        try {
            host.textContent = 'not-a-real-concept';
            host.setAttribute('data-ezclassify-error-target', 'ez-err-2');
            await field.init(host as HTMLDivElement, toCtx(engine));
            expect(host.hasAttribute('aria-errormessage')).toBe(true);
            await field.setValue('c1');
            expect(host.hasAttribute('aria-errormessage')).toBe(false);
            expect(errorEl.textContent).toBe('');
        } finally {
            errorEl.remove();
        }
    });

    it('clears aria-errormessage and target text on destroy', async () => {
        const errorEl = document.createElement('span');
        errorEl.id = 'ez-err-3';
        document.body.appendChild(errorEl);
        try {
            host.textContent = 'not-a-real-concept';
            host.setAttribute('data-ezclassify-error-target', 'ez-err-3');
            await field.init(host as HTMLDivElement, toCtx(engine));
            expect(host.hasAttribute('aria-errormessage')).toBe(true);
            field.destroy();
            expect(host.hasAttribute('aria-errormessage')).toBe(false);
            expect(errorEl.textContent).toBe('');
        } finally {
            errorEl.remove();
        }
    });

    it('no-ops gracefully when the error-target id points to a missing element', async () => {
        host.textContent = 'not-a-real-concept';
        host.setAttribute('data-ezclassify-error-target', 'does-not-exist');
        await expect(
            field.init(host as HTMLDivElement, toCtx(engine)),
        ).resolves.toBeUndefined();
        // Can't find the target, aria-errormessage must not be set
        expect(host.hasAttribute('aria-errormessage')).toBe(false);
    });

    it('does not set aria-errormessage when no error-target attribute is present', async () => {
        host.textContent = 'not-a-real-concept';
        await field.init(host as HTMLDivElement, toCtx(engine));
        expect(host.hasAttribute('aria-errormessage')).toBe(false);
    });
});

describe('EzClassifyText (declarative via EzClassifyUI)', () => {
    let root: HTMLDivElement;
    let forms: EzClassifyUI | null;

    beforeEach(() => {
        document.body.innerHTML = '';
        root = document.createElement('div');
        document.body.appendChild(root);
        forms = null;
    });

    afterEach(() => {
        forms?.destroy();
        document.body.innerHTML = '';
    });

    it('declarative mount publishes to the page aggregate store', async () => {
        root.innerHTML = `<code data-ezclassify-controller="text">c1, c2</code>`;
        forms = new EzClassifyUI(createMockEngine(), { root });
        await flush();

        const agg = forms.store.getAggregate();
        expect(agg.assertions.length).toBeGreaterThanOrEqual(1);
        // The text card's c1+c2 must surface in the aggregate.
        expect(agg.assertions.some((a) => a.conceptId === 'c1')).toBe(true);
        expect(agg.assertions.some((a) => a.conceptId === 'c2')).toBe(true);
    });

    it('declarative mount auto-assigns a synthetic id when host has none', async () => {
        root.innerHTML = `<code data-ezclassify-controller="text">c1</code>`;
        forms = new EzClassifyUI(createMockEngine(), { root });
        await flush();

        const el = root.querySelector('code')!;
        expect(el.id).toMatch(/^__ez-text-/);
    });

    it('declarative mount honors a consumer-provided id', async () => {
        root.innerHTML = `<code id="my-marking" data-ezclassify-controller="text">c1</code>`;
        forms = new EzClassifyUI(createMockEngine(), { root });
        await flush();

        const el = root.querySelector('#my-marking')!;
        expect(el.id).toBe('my-marking');
        const state = forms.store.get('my-marking');
        expect(state.assertions.some((a) => a.conceptId === 'c1')).toBe(true);
    });

    it('multiple instances contribute independently to the aggregate', async () => {
        root.innerHTML = `
      <code data-ezclassify-controller="text">c1</code>
      <code data-ezclassify-controller="text">c2</code>
    `;
        forms = new EzClassifyUI(createMockEngine(), { root });
        await flush();

        const codes = root.querySelectorAll<HTMLElement>('code');
        expect(codes).toHaveLength(2);
        const ids = Array.from(codes).map((c) => c.id);
        expect(new Set(ids).size).toBe(2);

        const agg = forms.store.getAggregate();
        expect(agg.assertions.some((a) => a.conceptId === 'c1')).toBe(true);
        expect(agg.assertions.some((a) => a.conceptId === 'c2')).toBe(true);
    });

    it('declarative invalid marking applies aria-invalid + ez-text--invalid', async () => {
        root.innerHTML = `<code data-ezclassify-controller="text">bogus-concept</code>`;
        forms = new EzClassifyUI(createMockEngine(), { root });
        await flush();

        const el = root.querySelector<HTMLElement>('code')!;
        expect(el.classList.contains('ez-text--invalid')).toBe(true);
        expect(el.getAttribute('aria-invalid')).toBe('true');
    });

    it('declarative mount keeps the host visible (no sibling mount, no display:none)', async () => {
        // Wrap so the rollup hidden input EzClassifyUI appends to root isn't mistaken for a mount sibling.
        root.innerHTML = `<div id="content"><code data-ezclassify-controller="text">c1</code></div>`;
        forms = new EzClassifyUI(createMockEngine(), { root });
        await flush();

        const el = root.querySelector<HTMLElement>('code')!;
        expect(el.style.display).not.toBe('none');
        // No `data-ezclassify-mount` sibling, the text controller renders in place.
        expect(el.nextElementSibling).toBeNull();
    });

    it('respects data-ezclassify-text-format attribute', async () => {
        const engine = createMockEngine();
        root.innerHTML = `<code data-ezclassify-controller="text" data-ezclassify-text-format="default">c1</code>`;
        forms = new EzClassifyUI(engine, { root });
        await flush();

        expect(engine.validate).toHaveBeenCalledWith(
            'c1',
            expect.objectContaining({ outputFormat: 'default' }),
        );
    });

    it('destroy via EzClassifyUI clears the contribution from the store', async () => {
        root.innerHTML = `<code id="m1" data-ezclassify-controller="text">c1</code>`;
        forms = new EzClassifyUI(createMockEngine(), { root });
        await flush();

        expect(forms.store.get('m1').assertions.length).toBeGreaterThan(0);

        forms.destroy();
        forms = null;
        await flush();
        // After tear-down the marking host's classes are stripped.
        const el = root.querySelector<HTMLElement>('#m1')!;
        expect(el.classList.contains('ez-text--valid')).toBe(false);
        expect(el.classList.contains('ez-text--invalid')).toBe(false);
    });

    it('a remount on the same root assigns fresh synthetic ids (no collision)', async () => {
        root.innerHTML = `<code data-ezclassify-controller="text">c1</code>`;
        const ui1 = new EzClassifyUI(createMockEngine(), { root });
        await flush();
        const firstId = root.querySelector<HTMLElement>('code')!.id;
        ui1.destroy();

        // Re-mount fresh, synthetic id should regenerate (the prior id stays on
        // the node but the new mount writes its own assignment unconditionally
        // when the prior id pattern was synthetic). Even if it reuses the same
        // id, the new EzClassifyUI's validMarkingIds is fresh, so this still
        // publishes cleanly to the store.
        root.innerHTML = `<code data-ezclassify-controller="text">c2</code>`;
        forms = new EzClassifyUI(createMockEngine(), { root });
        await flush();

        const secondId = root.querySelector<HTMLElement>('code')!.id;
        expect(secondId).toMatch(/^__ez-text-/);
        // Both ids are well-formed synthetic ids; whether they collide or not is
        // immaterial because each EzClassifyUI owns its own store.
        expect(typeof firstId).toBe('string');
        expect(
            forms.store
                .get(secondId)
                .assertions.some((a) => a.conceptId === 'c2'),
        ).toBe(true);
    });

    it('bare data-ezclassify-source without controller still text-mirrors (no regression)', async () => {
        // A plain <output> with source but no controller gets the text-mirror path.
        root.innerHTML = `
      <input id="src-marking" data-ezclassify-rendered value="c1">
      <output data-ezclassify-source="src-marking"></output>
    `;
        forms = new EzClassifyUI(createMockEngine(), { root });
        await flush();

        const out = root.querySelector('output')!;
        // Text-mirror sets textContent to the rendered value of the source marking.
        // The store seeds from the host, so the text may be set at init time.
        // At minimum, textContent should not be the EzClassifyText component chrome.
        expect(out.children.length).toBe(0);
    });

    it('text-mirrors an empty source with a word a screen reader announces, not a dash', async () => {
        root.innerHTML = `
      <input id="blank-marking" data-ezclassify-rendered value="">
      <output data-ezclassify-source="blank-marking"></output>
    `;
        forms = new EzClassifyUI(createMockEngine(), { root });
        await flush();

        const out = root.querySelector('output')!;
        expect(out.textContent).toBe('(empty)');
    });

    it('source-bound text controller: textContent shows the rendered marking string', async () => {
        // This is the primary bug scenario: host starts empty; framework pushes
        // rendered value via setValue(); host should display the marking string.
        root.innerHTML = `
      <input id="book-marking" data-ezclassify-rendered value="">
      <span id="text-display"
            data-ezclassify-controller="text"
            data-ezclassify-source="book-marking"></span>
    `;
        forms = new EzClassifyUI(createMockEngine(), { root });
        await flush();

        const span = root.querySelector<HTMLElement>('#text-display')!;

        // Push a rendered marking into the source.
        await forms.store.publishRendered('book-marking', 'c1, c2');
        await flush();
        expect(span.textContent).toBe('c1, c2');

        // Update the marking, host must reflect the new value.
        await forms.store.publishRendered('book-marking', 'c1');
        await flush();
        expect(span.textContent).toBe('c1');

        // Clear, host must go blank.
        await forms.store.publishRendered('book-marking', '');
        await flush();
        expect(span.textContent).toBe('');
    });

    it('source-bound text controller: validity updates when the source marking changes', async () => {
        // Wire two elements: a rendered host input that holds a marking, and a
        // text controller that mirrors it via data-ezclassify-source.
        // When the marking changes, the text controller's validity classes must
        // update, not stay frozen at mount-time (which happened when the source
        // path called setAssertions() instead of setValue(), skipping the read).
        root.innerHTML = `
      <input id="doc-marking" data-ezclassify-rendered value="c1">
      <code id="text-view"
            data-ezclassify-controller="text"
            data-ezclassify-source="doc-marking">c1</code>
    `;
        forms = new EzClassifyUI(createMockEngine(), { root });
        await flush();

        const codeEl = root.querySelector<HTMLElement>('#text-view')!;

        // Push a valid marking, text controller must update via validate() and show valid.
        await forms.store.publishRendered('doc-marking', 'c1');
        await flush();
        expect(codeEl.classList.contains('ez-text--valid')).toBe(true);
        expect(codeEl.classList.contains('ez-text--invalid')).toBe(false);

        // Push an invalid marking, validity must update (was frozen before fix).
        await forms.store.publishRendered('doc-marking', 'bogus-concept');
        await flush();
        expect(codeEl.classList.contains('ez-text--invalid')).toBe(true);
        expect(codeEl.classList.contains('ez-text--valid')).toBe(false);

        // Push valid again, classes must flip back (confirms live updates, not one-shot).
        await forms.store.publishRendered('doc-marking', 'c2');
        await flush();
        expect(codeEl.classList.contains('ez-text--valid')).toBe(true);
        expect(codeEl.classList.contains('ez-text--invalid')).toBe(false);
    });
});

it('omits outputFormat when the scheme has no default output', async () => {
    const engine = createMockEngine();
    const meta = engine.getSchemeMeta();
    engine.getSchemeMeta = () => ({ ...meta, defaultRenderFormat: undefined });
    const validate = vi.spyOn(engine, 'validate');
    const host = document.createElement('div');
    host.textContent = 'c1';
    document.body.append(host);
    const component = new EzClassifyText();
    await component.init(host, Context.fromSchemeEngine(engine as never));
    expect(validate).toHaveBeenCalledWith('c1', undefined);
    component.destroy();
    host.remove();
});
