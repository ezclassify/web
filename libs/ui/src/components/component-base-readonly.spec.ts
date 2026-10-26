import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ReadOnlyComponentBase } from './component-base-readonly';
import type {
    SchemeEngineAdapter,
    Assertion,
    ValidationError,
} from '@ezclassify/types';
import type {
    SchemePublicView,
    ConceptView,
    CategoryView,
} from '@ezclassify/types';
import { Context } from '@ezclassify/engine';
import { registerContext, clearContextRegistry } from '../context-binding';
import { hasAdoptedStyles } from '../styles/adopt';
import { COMPONENT_CSS } from './dom-helpers';
import { mockRenderFormats } from '../render-format-layout-mock';

/** Concrete subclass for testing the abstract ReadOnlyComponentBase. */
class TestReadOnlyComponent extends ReadOnlyComponentBase {
    setupCalled = false;
    renderCalled = false;
    destroyCalled = false;

    protected setup(): void {
        this.setupCalled = true;
    }
    protected render(): void {
        this.renderCalled = true;
    }
    destroy(): void {
        this.destroyCalled = true;
        this.container.innerHTML = '';
    }

    /** Expose protected members for testing */
    exposeCategoryColor(id: string): string {
        return this.getCategoryColor(id);
    }
    exposeCategoryTextColor(id: string): string {
        return this.getCategoryTextColor(id);
    }
    exposeGetConceptDescription(id: string): string {
        return this.getConceptDescription(id);
    }
    exposeResolveCategory(
        explicitId?: string,
        scope?: string,
    ): CategoryView | undefined {
        return this.resolveCategory(explicitId, scope);
    }
    exposeCreatePreviewBar(): HTMLDivElement {
        return this.createPreviewBar();
    }
    exposeInjectComponentStyles(css: string): void {
        this.injectComponentStyles(css);
    }
    exposeGetProcessingContext() {
        return this.getProcessingContext();
    }
}

function createMockProfile(): SchemePublicView {
    const concepts: ConceptView[] = [
        {
            id: 'c1',
            name: 'Concept One',
            views: { default: 'C1' },
            categories: ['cat1'],
            parents: [],
            aliases: [],
            position: 0,
            definition: 'Def for c1',
        },
        {
            id: 'c2',
            name: 'Concept Two',
            views: { default: 'C2', description: 'Short desc' },
            categories: ['cat2'],
            parents: [],
            aliases: [],
            position: 1,
        },
    ] as ConceptView[];

    const categories: CategoryView[] = [
        {
            id: 'cat1',
            label: 'Category 1',
            single: true,
            required: false,
        } as CategoryView,
        {
            id: 'cat2',
            label: 'Category 2',
            single: false,
            required: false,
        } as CategoryView,
    ];

    return {
        id: 'test',
        version: '1.0',
        name: 'Test Scheme',
        categories,
        concepts,
        formats: [
            {
                id: 'default',
                categoryOrder: ['cat1', 'cat2'],
                separator: ' ',
                categorySeparator: '//',
                view: 'default',
            },
        ],
        scopes: [],
        defaultRenderFormat: 'default',
    } as unknown as SchemePublicView;
}

function createMockEngine(scheme?: SchemePublicView): SchemeEngineAdapter {
    const p = scheme ?? createMockProfile();
    return {
        getScheme: () => p,
        getSchemeMeta: () => ({
            id: (p as any).id ?? 'test',
            version: (p as any).version ?? '1.0',
            name: p.name ?? 'Test',
            defaultRenderFormat: (p as any).defaultRenderFormat ?? 'default',
            formats: mockRenderFormats(p.formats ?? []),
            scopes: (p as any).scopes ?? [],
        }),
        listCategories: () => p.categories ?? [],
        getConceptsInCategory: (catId: string) =>
            (p.concepts ?? []).filter((c: any) =>
                c.categories?.includes(catId),
            ),
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
        // A read-only component reads its value through validate.
        validate: vi.fn((input: string) => {
            const ids = input
                .split(',')
                .map((s) => s.trim())
                .filter(Boolean);
            const assertions = ids.map((id) => {
                const concept = p.concepts.find((c) => c.id === id);
                return {
                    conceptId: id,
                    categoryId: concept?.categories[0] ?? 'cat1',
                    confidence: 'certain' as const,
                    source: 'parse' as const,
                };
            });
            return { assertions, rendered: input, valid: true };
        }),
        suggest: vi.fn().mockReturnValue({ suggestions: [] }),
    } as unknown as SchemeEngineAdapter;
}

const toCtx = (eng: unknown) => Context.fromSchemeEngine(eng as never);
describe('ReadOnlyComponentBase', () => {
    let container: HTMLDivElement;
    let engine: SchemeEngineAdapter;
    let component: TestReadOnlyComponent;

    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
        engine = createMockEngine();
        component = new TestReadOnlyComponent();
    });

    afterEach(() => {
        container.remove();
    });

    it('sets data-ezclassify attribute on container during init', async () => {
        await component.init(container, toCtx(engine));
        expect(container.getAttribute('data-ezclassify')).toBe('');
    });

    it('mounts on a bare scheme adapter, with no composed context', async () => {
        // Injection, not import: the host hands over whatever adapter it has.
        // A bare scheme adapter drives the marking surface and leaves the
        // composed context null, rather than being refused or wrapped in a
        // synthetic context that claims guide and access surfaces the host
        // never supplied.
        await component.init(container, engine, { initialValue: 'c1' });

        expect(component.getAssertions()[0].conceptId).toBe('c1');
        expect(
            (component as unknown as { context: unknown }).context,
        ).toBeNull();
    });

    it('uses unaddressed operations when a Context wraps a full local adapter', async () => {
        const validate = vi.fn(engine.validate.bind(engine));
        engine.validate = validate as SchemeEngineAdapter['validate'];

        await component.init(container, toCtx(engine), {
            initialValue: 'c1',
            schemeId: 'test',
        });

        expect(validate).toHaveBeenCalledWith('c1', {
            outputFormat: 'default',
            context: undefined,
        });
        expect(validate).not.toHaveBeenCalledWith(
            'c1',
            'test',
            expect.anything(),
        );
    });

    it('refuses to pair an injected bare adapter with an unrelated ancestor context', async () => {
        // The engine the component renders from and the context it reads
        // guide and access from have to be the same composition. An ancestor
        // provider registered for a different one is not a match, and pairing
        // them would show wrong content instead of raising anything.
        const provider = document.createElement('div');
        provider.setAttribute('data-ezclassify-context', 'other-composition');
        provider.appendChild(container);
        document.body.appendChild(provider);
        registerContext('other-composition', toCtx(createMockEngine()));

        await component.init(container, engine, { initialValue: 'c1' });

        expect(
            (component as unknown as { context: unknown }).context,
        ).toBeNull();

        clearContextRegistry();
        provider.remove();
    });

    it('pairs an injected bare adapter with the ancestor context composed around it', async () => {
        const ctx = toCtx(engine);
        const provider = document.createElement('div');
        provider.setAttribute('data-ezclassify-context', 'same-composition');
        provider.appendChild(container);
        document.body.appendChild(provider);
        registerContext('same-composition', ctx);

        await component.init(container, ctx.scheme, { initialValue: 'c1' });

        expect((component as unknown as { context: unknown }).context).toBe(
            ctx,
        );

        clearContextRegistry();
        provider.remove();
    });

    it('calls setup() after init', async () => {
        await component.init(container, toCtx(engine));
        expect(component.setupCalled).toBe(true);
    });

    it('returns empty assertions when initialized without a value', async () => {
        await component.init(container, toCtx(engine));
        expect(component.getAssertions()).toEqual([]);
        expect(component.getRendered()).toBe('');
    });

    it('validates an initial value from options', async () => {
        await component.init(container, toCtx(engine), { initialValue: 'c1' });
        expect(engine.validate).toHaveBeenCalledWith(
            'c1',
            expect.objectContaining({ outputFormat: 'default' }),
        );
        expect(component.getAssertions()).toHaveLength(1);
        expect(component.getAssertions()[0].conceptId).toBe('c1');
    });

    it('uses the bound surface for the initial read', async () => {
        await component.init(container, toCtx(engine), {
            initialValue: 'c1',
            scope: 'alternate',
        });
        expect(engine.validate).toHaveBeenCalledWith(
            'c1',
            expect.objectContaining({ surface: 'alternate' }),
        );
    });

    it('reads initial value from an enhanced input element', async () => {
        const input = document.createElement('input');
        input.type = 'text';
        input.value = 'c2';
        container.appendChild(input);
        await component.init(container, toCtx(engine));
        expect(engine.validate).toHaveBeenCalledWith(
            'c2',
            expect.objectContaining({ outputFormat: 'default' }),
        );
    });

    it('uses formatId from options when provided', async () => {
        await component.init(container, toCtx(engine), {
            formatId: 'custom-format',
        });
        // The formatId should be stored, we can verify by calling setValue
        await component.setValue('c1');
        expect(engine.validate).toHaveBeenCalledWith(
            'c1',
            expect.objectContaining({ outputFormat: 'custom-format' }),
        );
    });

    it('applies color scheme attribute for non-auto schemes', async () => {
        await component.init(container, toCtx(engine), { colorScheme: 'dark' });
        expect(container.getAttribute('data-color-scheme')).toBe('dark');
    });

    it('does not set data-color-scheme for auto mode', async () => {
        await component.init(container, toCtx(engine), { colorScheme: 'auto' });
        expect(container.hasAttribute('data-color-scheme')).toBe(false);
    });

    it('applies styleInputs class when option is true', async () => {
        await component.init(container, toCtx(engine), { styleInputs: true });
        expect(container.classList.contains('ez-styled-inputs')).toBe(true);
    });

    it('applies theme CSS variables on the container', async () => {
        await component.init(container, toCtx(engine), {
            theme: { '--ez-color-primary': '#ff0000' },
        });
        expect(container.style.getPropertyValue('--ez-color-primary')).toBe(
            '#ff0000',
        );
    });

    it('applies z-index overrides', async () => {
        await component.init(container, toCtx(engine), { zIndex: 5000 });
        expect(container.style.getPropertyValue('--ez-z-dropdown')).toBe(
            '5000',
        );
    });

    it('builds category color map from defaults', async () => {
        await component.init(container, toCtx(engine));
        const color = component.exposeCategoryColor('cat1');
        expect(color).toBeTruthy();
        expect(color).not.toBe('#666');
    });

    it('uses custom categoryColors when provided', async () => {
        await component.init(container, toCtx(engine), {
            categoryColors: { cat1: '#abcdef' },
        });
        expect(component.exposeCategoryColor('cat1')).toBe('#abcdef');
    });

    it('returns fallback color for unknown category', async () => {
        await component.init(container, toCtx(engine));
        expect(component.exposeCategoryColor('unknown')).toBe('#666');
    });

    it('setAssertions replaces assertions and triggers render', async () => {
        await component.init(container, toCtx(engine));
        component.setAssertions([
            {
                conceptId: 'c1',
                categoryId: 'cat1',
                confidence: 'certain',
                source: 'user',
            },
        ]);
        expect(engine.render).toHaveBeenCalled();
        expect(component.renderCalled).toBe(true);
    });

    it('setValue with empty string clears assertions', async () => {
        await component.init(container, toCtx(engine), { initialValue: 'c1' });
        await component.setValue('');
        expect(component.getAssertions()).toEqual([]);
        expect(component.getRendered()).toBe('');
    });

    it('setValue reads the new value through the engine', async () => {
        await component.init(container, toCtx(engine));
        await component.setValue('c2');
        expect(component.getAssertions()).toHaveLength(1);
        expect(component.getAssertions()[0].conceptId).toBe('c2');
    });

    it('updateValidationErrors shows error element for constraint violations', async () => {
        await component.init(container, toCtx(engine));
        const errors: ValidationError[] = [
            {
                constraintId: 'req1',
                message: 'Required field missing',
            } as ValidationError,
        ];
        component.updateValidationErrors(errors);
        const errorEl = container.parentNode?.querySelector(
            '.ez-validation-errors',
        );
        expect(errorEl).toBeTruthy();
        expect(errorEl!.textContent).toContain('Required field missing');
        expect(container.hasAttribute('data-ezclassify-invalid')).toBe(true);
    });

    it('updateValidationErrors hides error element when errors are empty', async () => {
        await component.init(container, toCtx(engine));
        component.updateValidationErrors([
            { constraintId: 'req1', message: 'Error' } as ValidationError,
        ]);
        component.updateValidationErrors([]);
        expect(container.hasAttribute('data-ezclassify-invalid')).toBe(false);
    });

    it('updateValidationErrors reports unmatched token errors with their engine message', async () => {
        await component.init(container, toCtx(engine));
        const errors: ValidationError[] = [
            {
                constraintId: '_unmatched',
                message: 'Parse issue',
            },
        ];
        component.updateValidationErrors(errors);
        expect(container.hasAttribute('data-ezclassify-invalid')).toBe(true);
        expect(
            container.nextElementSibling?.querySelector(
                '.ez-validation-errors__message',
            )?.textContent,
        ).toBe('Parse issue');
    });

    it('setColorScheme updates data-color-scheme attribute', async () => {
        await component.init(container, toCtx(engine));
        component.setColorScheme('dark');
        expect(container.getAttribute('data-color-scheme')).toBe('dark');
        component.setColorScheme('auto');
        expect(container.hasAttribute('data-color-scheme')).toBe(false);
    });

    it('resolveCategory finds by explicit ID', async () => {
        await component.init(container, toCtx(engine));
        const cat = component.exposeResolveCategory('cat2');
        expect(cat?.id).toBe('cat2');
    });

    it('resolveCategory returns first single-select category by default', async () => {
        await component.init(container, toCtx(engine));
        const cat = component.exposeResolveCategory();
        expect(cat?.id).toBe('cat1');
    });

    it('getConceptDescription returns documentation definition', async () => {
        await component.init(container, toCtx(engine));
        expect(component.exposeGetConceptDescription('c1')).toBe('Def for c1');
    });

    it('getConceptDescription falls back to description view', async () => {
        await component.init(container, toCtx(engine));
        expect(component.exposeGetConceptDescription('c2')).toBe('Short desc');
    });

    it('getConceptDescription returns empty string for unknown concept', async () => {
        await component.init(container, toCtx(engine));
        expect(component.exposeGetConceptDescription('nonexistent')).toBe('');
    });

    it('injectComponentStyles adopts nothing when injectStyles is false', async () => {
        await component.init(container, toCtx(engine), { injectStyles: false });
        const adopted = document.adoptedStyleSheets.length;
        component.exposeInjectComponentStyles(
            '.ez-opt-out-probe { color: rgb(9, 9, 9); }',
        );
        expect(document.adoptedStyleSheets.length).toBe(adopted);
        expect(container.querySelectorAll('style')).toHaveLength(0);
    });

    it('injectComponentStyles adopts the sheet when injectStyles is left on', async () => {
        await component.init(container, toCtx(engine));
        const probe = '.ez-opt-in-probe { color: rgb(8, 8, 8); }';
        component.exposeInjectComponentStyles(probe);
        expect(hasAdoptedStyles(COMPONENT_CSS + probe)).toBe(true);
        expect(container.querySelectorAll('style')).toHaveLength(0);
    });

    it('createPreviewBar returns a div with proper ARIA attributes', async () => {
        await component.init(container, toCtx(engine), { showPreview: true });
        const preview = component.exposeCreatePreviewBar();
        expect(preview.getAttribute('role')).toBe('status');
        expect(preview.getAttribute('aria-label')).toBe(
            'Current marking preview',
        );
    });

    it('onAssertionsChanged fires onChange callback', async () => {
        const onChange = vi.fn();
        await component.init(container, toCtx(engine), { onChange });
        await component.setValue('c1');
        expect(onChange).toHaveBeenCalledWith(
            expect.arrayContaining([
                expect.objectContaining({ conceptId: 'c1' }),
            ]),
            expect.any(String),
        );
    });

    it('onAssertionsChanged syncs enhanced input when no onChange', async () => {
        const input = document.createElement('input');
        input.type = 'text';
        container.appendChild(input);
        await component.init(container, toCtx(engine));
        await component.setValue('c1');
        expect(input.value).toBe('c1');
    });

    it('resolveContext returns undefined when not set', async () => {
        await component.init(container, toCtx(engine));
        expect(component.exposeGetProcessingContext()).toBeUndefined();
    });

    it('resolveContext returns value from resolveContext option', async () => {
        const ctx = { whole: 'test' };
        await component.init(container, toCtx(engine), {
            resolveContext: () => ctx as any,
        });
        expect(component.exposeGetProcessingContext()).toBe(ctx);
    });
});
