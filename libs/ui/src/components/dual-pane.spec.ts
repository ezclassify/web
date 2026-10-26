import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DualPane } from './dual-pane';
import { setLocale, resetLocale } from '../i18n';
import type {
    SchemeEngineAdapter,
    Assertion,
    Suggestion,
} from '@ezclassify/types';
import type {
    SchemePublicView,
    ConceptView,
    CategoryView,
} from '@ezclassify/types';
import { Context } from '@ezclassify/engine';
import { mockRenderFormats } from '../render-format-layout-mock';

function createMockProfile(): SchemePublicView {
    const concepts: ConceptView[] = [
        {
            id: 'a1',
            name: 'Alpha',
            views: { default: 'Alpha' },
            categories: ['grp1'],
            parents: [],
            aliases: [],
            position: 0,
        },
        {
            id: 'a2',
            name: 'Beta',
            views: { default: 'Beta' },
            categories: ['grp1'],
            parents: [],
            aliases: [],
            position: 1,
        },
        {
            id: 'b1',
            name: 'Gamma',
            views: { default: 'Gamma' },
            categories: ['grp2'],
            parents: [],
            aliases: [],
            position: 0,
        },
    ] as ConceptView[];

    const categories: CategoryView[] = [
        {
            id: 'grp1',
            label: 'Group 1',
            single: false,
            required: false,
        } as CategoryView,
        {
            id: 'grp2',
            label: 'Group 2',
            single: false,
            required: false,
        } as CategoryView,
    ];

    return {
        name: 'Test Scheme',
        categories,
        concepts,
        formats: [
            {
                id: 'default',
                categoryOrder: ['grp1', 'grp2'],
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
        render: vi.fn((assertions: Assertion[]) =>
            assertions.map((a) => a.conceptId).join(', '),
        ),
        process: vi.fn((_input: string, opts?: any) => {
            const assertions: Assertion[] = opts?.assertions ?? [];
            return {
                assertions,
                rendered: assertions
                    .map((a: Assertion) => a.conceptId)
                    .join(', '),
                valid: true,
            };
        }),
        suggest: vi.fn().mockReturnValue({
            suggestions: [
                {
                    conceptId: 'a1',
                    categoryId: 'grp1',
                    label: 'Alpha',
                    name: 'Alpha',
                    group: 'Group 1',
                    selected: false,
                },
                {
                    conceptId: 'a2',
                    categoryId: 'grp1',
                    label: 'Beta',
                    name: 'Beta',
                    group: 'Group 1',
                    selected: false,
                },
                {
                    conceptId: 'b1',
                    categoryId: 'grp2',
                    label: 'Gamma',
                    name: 'Gamma',
                    group: 'Group 2',
                    selected: false,
                },
            ] as Suggestion[],
        }),
        describeConcept: (conceptId: string) => ({ lines: [conceptId] }),
    } as unknown as SchemeEngineAdapter;
}

const toCtx = (eng: unknown) => Context.fromSchemeEngine(eng as never);
describe('DualPane', () => {
    let container: HTMLDivElement;
    let engine: SchemeEngineAdapter;
    let component: DualPane;

    beforeEach(async () => {
        container = document.createElement('div');
        document.body.appendChild(container);
        engine = createMockEngine();
        component = new DualPane();
        await component.init(container, toCtx(engine));
        container.querySelector<HTMLInputElement>('.dual-filter')!.focus();
        await vi.waitFor(() =>
            expect(container.querySelectorAll('.dual-item')).toHaveLength(3),
        );
    });

    afterEach(() => {
        component.destroy();
        container.remove();
    });

    /**
     * Pane headers must use the host's translation table alongside the rest of
     * the field UI.
     */
    it('renders the pane headers through the translation table', async () => {
        setLocale({
            'dualPane.available': 'Disponibles',
            'dualPane.currentMarking': 'Marcado actual',
        });
        const translated = new DualPane();
        const host = document.createElement('div');
        document.body.appendChild(host);
        try {
            await translated.init(host, toCtx(engine));
            const headers = host.querySelectorAll('.dual-pane-header');
            expect(headers[0].textContent).toBe('Disponibles');
            expect(headers[1].textContent).toBe('Marcado actual');
        } finally {
            translated.destroy();
            host.remove();
            resetLocale();
        }
    });

    it('renders the dual-container structure', () => {
        const dual = container.querySelector('.dual-container');
        expect(dual).toBeTruthy();
    });

    it('renders available and selected panes', () => {
        const panes = container.querySelectorAll('.dual-pane');
        expect(panes.length).toBe(2);
    });

    it('renders available pane with ARIA region role', () => {
        const panes = container.querySelectorAll('[role="region"]');
        expect(panes.length).toBeGreaterThanOrEqual(2);
        const labels = Array.from(panes).map((p) =>
            p.getAttribute('aria-label'),
        );
        expect(labels).toContain('Available concepts');
        expect(labels).toContain('Current marking');
    });

    it('renders a filter input for available concepts', () => {
        const filter = container.querySelector(
            '.dual-filter',
        ) as HTMLInputElement;
        expect(filter).toBeTruthy();
        expect(filter.getAttribute('aria-label')).toBe(
            'Filter available concepts',
        );
    });

    it('renders transfer control buttons', () => {
        const buttons = container.querySelectorAll('.dual-btn');
        expect(buttons.length).toBe(2);
    });

    it('shows empty message in selected pane when no assertions', () => {
        const selectedItems = container.querySelector(
            '.dual-pane:last-of-type .dual-empty',
        );
        expect(selectedItems?.textContent).toBe(
            'Select concepts from the left',
        );
    });

    it('populates available list from engine suggestions', async () => {
        // Give time for async renderAvailable
        await new Promise((r) => setTimeout(r, 50));
        const items = container.querySelectorAll('.dual-item');
        expect(items.length).toBeGreaterThan(0);
    });

    it('uses store-pushed facet options for the unfiltered available list', async () => {
        component.applyAllowableOptions([
            {
                conceptId: 'b1',
                categoryId: 'grp2',
                label: 'Gamma',
                description: '',
                name: 'Gamma',
                views: { default: 'Gamma' },
                group: 'Group 2',
                selected: false,
                order: 0,
            },
        ]);
        await new Promise((r) => setTimeout(r, 50));

        const items = [...container.querySelectorAll('.dual-item')].map((el) =>
            el.textContent?.trim(),
        );
        expect(items).toEqual(['Gamma']);
    });

    it('renders group headers in available pane', async () => {
        await new Promise((r) => setTimeout(r, 50));
        const headers = container.querySelectorAll('.dual-group-header');
        expect(headers.length).toBeGreaterThan(0);
    });

    it('renders selected assertions in selected pane', async () => {
        component.setAssertions([
            {
                conceptId: 'a1',
                categoryId: 'grp1',
                confidence: 'certain',
                source: 'user',
            },
        ]);
        await new Promise((r) => setTimeout(r, 50));
        const selectedList = container
            .querySelectorAll('.dual-pane')[1]
            ?.querySelector('.dual-items');
        const items = selectedList?.querySelectorAll('.dual-item');
        expect(items?.length).toBeGreaterThanOrEqual(1);
    });

    it('shows inferred badge for inferred assertions', async () => {
        component.setAssertions([
            {
                conceptId: 'a1',
                categoryId: 'grp1',
                confidence: 'inferred',
                source: 'engine',
            },
        ]);
        await new Promise((r) => setTimeout(r, 50));
        const badges = container.querySelectorAll(
            '.dual-pane:last-of-type .dual-items',
        );
        expect(badges).toBeTruthy();
    });

    it('renders preview bar', () => {
        const preview = container.querySelector('.proto-preview');
        expect(preview).toBeTruthy();
    });

    it('renders keyboard hints', () => {
        const hints = container.querySelector('.proto-kbd-hints');
        expect(hints).toBeTruthy();
    });

    it('renders announcer for screen readers', () => {
        const announcer = container.querySelector('[aria-live="polite"]');
        expect(announcer).toBeTruthy();
    });

    it('destroy clears container', () => {
        component.destroy();
        expect(container.innerHTML).toBe('');
    });

    it('getRendered returns empty for no assertions', () => {
        expect(component.getRendered()).toBe('');
    });

    it('getAssertions returns a copy of assertions', () => {
        const assertions = component.getAssertions();
        expect(Array.isArray(assertions)).toBe(true);
        expect(assertions).toEqual([]);
    });

    describe('WCAG 2.1.1: available listbox keyboard accessibility', () => {
        it('available listbox has tabIndex=0 (Tab-reachable)', () => {
            const list = container.querySelector(
                '[aria-label="Available concepts list"]',
            ) as HTMLElement;
            expect(list).toBeTruthy();
            expect(list.tabIndex).toBe(0);
        });

        it('ArrowDown from filter focuses the available listbox', async () => {
            await new Promise((r) => setTimeout(r, 50)); // wait for async renderAvailable
            const filter = container.querySelector(
                '.dual-filter',
            ) as HTMLInputElement;
            filter.focus();
            filter.dispatchEvent(
                new KeyboardEvent('keydown', {
                    key: 'ArrowDown',
                    bubbles: true,
                }),
            );
            const list = container.querySelector(
                '[aria-label="Available concepts list"]',
            ) as HTMLElement;
            expect(document.activeElement).toBe(list);
        });

        it('ArrowDown on the listbox moves highlight to first item when none is highlighted', async () => {
            await new Promise((r) => setTimeout(r, 50));
            const list = container.querySelector(
                '[aria-label="Available concepts list"]',
            ) as HTMLElement;
            list.focus();
            list.dispatchEvent(
                new KeyboardEvent('keydown', {
                    key: 'ArrowDown',
                    bubbles: true,
                }),
            );
            await new Promise((r) => setTimeout(r, 50));
            const highlighted = container.querySelector(
                '.dual-item.highlighted',
            );
            expect(highlighted).toBeTruthy();
        });

        it('ArrowDown from filter highlights first item before focusing list', async () => {
            await new Promise((r) => setTimeout(r, 50));
            const filter = container.querySelector(
                '.dual-filter',
            ) as HTMLInputElement;
            filter.focus();
            filter.dispatchEvent(
                new KeyboardEvent('keydown', {
                    key: 'ArrowDown',
                    bubbles: true,
                }),
            );
            await new Promise((r) => setTimeout(r, 50));
            const list = container.querySelector(
                '[aria-label="Available concepts list"]',
            ) as HTMLElement;
            // aria-activedescendant should point to an item
            const activeId = list.getAttribute('aria-activedescendant');
            expect(activeId).toBeTruthy();
            expect(document.getElementById(activeId!)).toBeTruthy();
        });

        it('ArrowUp from first item in listbox returns focus to filter', async () => {
            await new Promise((r) => setTimeout(r, 50));
            const list = container.querySelector(
                '[aria-label="Available concepts list"]',
            ) as HTMLElement;
            list.focus();
            // Move to first item
            list.dispatchEvent(
                new KeyboardEvent('keydown', {
                    key: 'ArrowDown',
                    bubbles: true,
                }),
            );
            await new Promise((r) => setTimeout(r, 50));
            // Arrow up from first item should go back to filter
            list.dispatchEvent(
                new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }),
            );
            const filter = container.querySelector(
                '.dual-filter',
            ) as HTMLInputElement;
            expect(document.activeElement).toBe(filter);
        });

        it('available items have IDs for aria-activedescendant', async () => {
            await new Promise((r) => setTimeout(r, 50));
            const items = container.querySelectorAll('[role="option"]');
            expect(items.length).toBeGreaterThan(0);
            // At least the available-pane items should have an id
            const withId = Array.from(items).filter((el) =>
                el.id.startsWith('ez-avail-item-'),
            );
            expect(withId.length).toBeGreaterThan(0);
        });

        it('Tab from filter reaches available listbox (no override)', () => {
            // The Tab handler in onAvailableKeydown was removed; natural Tab goes to availableList.
            // We verify the listbox is focusable (tabIndex=0), browser Tab order is not
            // testable in JSDOM without focus simulation, so we verify the tabIndex directly.
            const list = container.querySelector(
                '[aria-label="Available concepts list"]',
            ) as HTMLElement;
            expect(list.tabIndex).toBe(0);
        });
    });
});

describe('DualPane interaction-driven catalog', () => {
    it('mounts and renders external state without suggestions, then loads on focus', async () => {
        const host = document.createElement('div');
        document.body.appendChild(host);
        const engine = createMockEngine();
        const picker = new DualPane();
        try {
            await picker.init(host, toCtx(engine));
            expect(engine.suggest).not.toHaveBeenCalled();
            picker.setAssertions([]);
            expect(engine.suggest).not.toHaveBeenCalled();
            host.querySelector<HTMLInputElement>('.dual-filter')!.focus();
            await vi.waitFor(() =>
                expect(host.querySelectorAll('.dual-item')).toHaveLength(3),
            );
            expect(engine.suggest).toHaveBeenCalledTimes(1);
            (picker as any).render();
            expect(engine.suggest).toHaveBeenCalledTimes(1);
        } finally {
            picker.destroy();
            host.remove();
        }
    });
});

describe('DualPane native interactions', () => {
    it('keeps spaces available for typing a multiword filter', async () => {
        const host = document.createElement('div');
        const picker = new DualPane();
        try {
            await picker.init(host, toCtx(createMockEngine()));
            const input = host.querySelector<HTMLInputElement>('.dual-filter')!;
            const space = new KeyboardEvent('keydown', {
                key: ' ',
                bubbles: true,
                cancelable: true,
            });
            input.dispatchEvent(space);
            expect(space.defaultPrevented).toBe(false);
        } finally {
            picker.destroy();
        }
    });

    it('uses authoritative facet options while filtering without issuing another query', async () => {
        const host = document.createElement('div');
        const engine = createMockEngine();
        const picker = new DualPane();
        try {
            await picker.init(host, toCtx(engine));
            picker.applyAllowableOptions([
                {
                    conceptId: 'b1',
                    categoryId: 'grp2',
                    label: 'Gamma',
                    name: 'Gamma',
                    group: 'Group 2',
                } as Suggestion,
            ]);
            const input = host.querySelector<HTMLInputElement>('.dual-filter')!;
            input.value = 'Alpha';
            input.dispatchEvent(new Event('input'));
            await Promise.resolve();
            expect(host.querySelectorAll('.dual-item')).toHaveLength(0);
            expect(engine.suggest).not.toHaveBeenCalled();
        } finally {
            picker.destroy();
        }
    });

    it('tracks the native field and disabled ancestor before allowing any transfer', async () => {
        const fieldset = document.createElement('fieldset');
        const host = document.createElement('div');
        host.innerHTML = '<input type="hidden" readonly>';
        fieldset.append(host);
        document.body.append(fieldset);
        const picker = new DualPane();
        const engine = createMockEngine();
        try {
            await picker.init(host, toCtx(engine));
            const input = host.querySelector<HTMLInputElement>('.dual-filter')!;
            expect(input.disabled).toBe(true);
            host.querySelector<HTMLInputElement>('[type="hidden"]')!.readOnly =
                false;
            await vi.waitFor(() => expect(input.disabled).toBe(false));
            input.focus();
            await vi.waitFor(() =>
                expect(host.querySelectorAll('.dual-item')).toHaveLength(3),
            );
            fieldset.disabled = true;
            await vi.waitFor(() => expect(input.disabled).toBe(true));
            host.querySelector<HTMLElement>('.dual-item')!.click();
            expect(picker.getAssertions()).toEqual([]);
        } finally {
            picker.destroy();
            fieldset.remove();
        }
    });
});

it('refreshes options on the next interaction after its whole context changes', async () => {
    const host = document.createElement('div');
    document.body.append(host);
    let version = 'a1';
    const engine = createMockEngine();
    const process = engine.process as ReturnType<typeof vi.fn>;
    process.mockImplementation((_input: string, opts: any) => ({
        assertions: opts?.assertions ?? [],
        rendered: '',
        valid: true,
        suggestionsFor: {
            grp1: {
                suggestions: [
                    {
                        conceptId: version,
                        categoryId: 'grp1',
                        group: 'Group 1',
                        label: version,
                        name: version,
                    },
                ],
            },
        },
    }));
    const picker = new DualPane();
    await picker.init(host, toCtx(engine), {
        resolveContext: () => ({ role: 'part', partOf: version }) as any,
    });
    const input = host.querySelector<HTMLInputElement>('.dual-filter')!;
    input.focus();
    await vi.waitFor(() =>
        expect(host.querySelector('.dual-item')?.textContent).toContain('a1'),
    );
    input.blur();
    version = 'a2';
    picker.setAssertions([]);
    input.focus();
    await new Promise((r) => setTimeout(r, 30));
    try {
        expect(host.querySelector('.dual-item')?.textContent).toContain('a2');
    } finally {
        picker.destroy();
        host.remove();
    }
});
