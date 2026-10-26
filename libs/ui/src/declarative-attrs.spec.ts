import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type {
    SchemeEngineAdapter,
    Assertion,
    ValidationError,
} from '@ezclassify/types';
import type { SchemePublicView } from '@ezclassify/types';
import { mockAssertion, mockProcessResult } from './engine-result-mock';
import { mockRenderFormats } from './render-format-layout-mock';

// We need to mock CSS imports before importing EzClassifyUI
vi.mock('./components/tag-input.css?inline', () => ({
    default: '',
}));
vi.mock('./components/single-select.css?inline', () => ({ default: '' }));
vi.mock('./components/category-checklist.css?inline', () => ({ default: '' }));
vi.mock('./components/category-selector.css?inline', () => ({ default: '' }));
vi.mock('./components/assertion-card.css?inline', () => ({ default: '' }));
vi.mock('./components/status-banner.css?inline', () => ({ default: '' }));
vi.mock('./components/component-utils.css?inline', () => ({ default: '' }));
vi.mock('./styles.css?inline', () => ({ default: '' }));

const testProfile: SchemePublicView = {
    id: 'test',
    version: '1.0.0',
    name: 'Test Scheme',
    defaultRenderFormat: 'default',
    categories: [
        {
            id: 'level',
            label: 'Level',
            required: true,
            single: true,
            rollupOperator: 'highest',
            order: 0,
        },
    ],
    concepts: [
        {
            id: 'A',
            name: 'Option A',
            views: { default: 'A' },
            aliases: ['a'],
            categories: ['level'],
            parents: [],
            position: 0,
        },
        {
            id: 'B',
            name: 'Option B',
            views: { default: 'B' },
            aliases: ['b'],
            categories: ['level'],
            parents: [],
            position: 1,
        },
        {
            id: 'C',
            name: 'Option C',
            views: { default: 'C' },
            aliases: ['c'],
            categories: ['level'],
            parents: [],
            position: 2,
        },
    ],
    formats: [
        {
            id: 'default',
            surface: 'default',
            mode: 'inline',
            separator: '',
            view: 'default',
            fields: [{ category: 'level', separator: '' }],
        },
    ],
    scopes: [],
    conceptGroups: [],
    parseRules: [],
    wizardQuestions: [],
} as unknown as SchemePublicView;

function createMockEngine(): SchemeEngineAdapter {
    return {
        getScheme: () => testProfile,
        getSchemeMeta: () => ({
            id: testProfile.id ?? 'test',
            version: testProfile.version ?? '1.0',
            name: testProfile.name ?? 'Test',
            defaultRenderFormat: testProfile.defaultRenderFormat ?? 'default',
            formats: mockRenderFormats(testProfile.formats ?? []),
            scopes: testProfile.scopes ?? [],
        }),
        listCategories: () => testProfile.categories ?? [],
        getConceptsInCategory: (catId: string) =>
            (testProfile.concepts ?? []).filter((c: any) =>
                c.categories?.includes(catId),
            ),
        render: vi.fn((assertions: Assertion[]) => {
            const rendered = assertions
                .map((a) => {
                    const c = testProfile.concepts.find(
                        (cc) => cc.id === a.conceptId,
                    );
                    return c?.views['default'] ?? a.conceptId;
                })
                .join('');
            return {
                rendered,
                assessment: {
                    notices: [],
                    errors: [],
                    valid: true,
                    complete: true,
                    appliedFixes: [],
                },
            };
        }),
        process: vi.fn(
            (
                input: string | Assertion[],
                options?: { assertions?: Assertion[] },
            ) => {
                const assertionInput =
                    options?.assertions ??
                    (Array.isArray(input) ? input : undefined);
                if (assertionInput) {
                    const rendered = assertionInput
                        .map((a) => {
                            const c = testProfile.concepts.find(
                                (cc) => cc.id === a.conceptId,
                            );
                            return c?.views['default'] ?? a.conceptId;
                        })
                        .join('');
                    return {
                        assertions: assertionInput.map((a) => ({ ...a })),
                        rendered,
                        valid: true,
                    };
                }
                const renderedInput = String(input);
                const assertions = testProfile.concepts
                    .filter((c) =>
                        renderedInput.includes(c.views['default'] ?? c.id),
                    )
                    .map((c) => ({
                        conceptId: c.id,
                        categoryId: 'level',
                        confidence: 'certain' as const,
                        source: 'parse' as const,
                    }));
                return {
                    assertions,
                    rendered: renderedInput,
                    valid: true,
                    recognition: {
                        status: 'complete',
                        inputFormat: 'default',
                        surface: 'default',
                        unmatched: [],
                        corrections: [],
                    },
                };
            },
        ),
        suggest: vi.fn(() => ({
            suggestions: testProfile.concepts.map((c) => ({
                conceptId: c.id,
                categoryId: 'level',
                label: c.name,
                group: 'Level',
                selected: false,
            })),
        })),
        aggregate: vi.fn((values: string[]) => ({
            assertions: [],
            rendered: values.join(''),
            valid: true,
        })),
        aggregateAssertions: vi.fn((sets: Assertion[][]) => {
            const merged = sets.flat();
            return {
                assertions: merged,
                rendered: merged.map((a) => a.conceptId).join(''),
                valid: true,
            };
        }),
        describeConcept: (conceptId: string) => ({ lines: [conceptId] }),
    } as unknown as SchemeEngineAdapter;
}

describe('Declarative attribute system (EzClassifyUI)', () => {
    let engine: SchemeEngineAdapter;

    beforeEach(async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        engine = createMockEngine();
        // Clean the body before each test
        document.body.innerHTML = '';
    });

    afterEach(() => {
        vi.restoreAllMocks();
        document.body.innerHTML = '';
    });

    /**
     * Helper: dynamically import EzClassifyUI. We use dynamic import because
     * the module performs side-effect registration on import and we need the
     * mocks to be in place first.
     */
    async function createForms(options?: Record<string, unknown>) {
        const { EzClassifyUI } = await import('./ezclassify-ui');
        return new EzClassifyUI(engine, options as any);
    }

    it('ezclassify-tags on an <input> creates a TagInput', async () => {
        const input = document.createElement('input');
        input.setAttribute('data-ezclassify-controller', 'tags');
        document.body.appendChild(input);

        const forms = await createForms();

        // The field should be tracked
        expect(forms.fields).toContain(input);
        // TagInput hides the original input and creates a wrapper
        expect(input.style.display).toBe('none');

        forms.destroy();
    });

    describe('data-ezclassify-format on a component controller', () => {
        /**
         * Mount one `select` controller carrying the given attributes and
         * report the render format the component actually resolved.
         */
        async function mountedFormatId(
            attrs: Record<string, string>,
        ): Promise<string | undefined> {
            const el = document.createElement('select');
            el.setAttribute('data-ezclassify-controller', 'select');
            for (const [name, value] of Object.entries(attrs))
                el.setAttribute(name, value);
            document.body.appendChild(el);

            const forms = await createForms();
            await new Promise((resolve) => setTimeout(resolve, 0));
            const component = (
                forms as unknown as {
                    components: Map<HTMLElement, { formatId?: string }>;
                }
            ).components.get(el);
            expect(component).toBeDefined();
            const formatId = component!.formatId;
            forms.destroy();
            return formatId;
        }

        it('drives the controller render format from the bare host attribute', async () => {
            // The bare attribute was inert on controller hosts: the field
            // silently rendered the scheme default while the markup said
            // otherwise. It is a host-level attribute in the documented
            // grammar, so it has to mean the same thing here as it does on a
            // plain enhanced input.
            expect(
                await mountedFormatId({ 'data-ezclassify-format': 'short' }),
            ).toBe('short');
        });

        it('lets the controller-prefixed option win over the bare attribute', async () => {
            expect(
                await mountedFormatId({
                    'data-ezclassify-format': 'short',
                    'data-ezclassify-select-format': 'banner',
                }),
            ).toBe('banner');
        });

        it('leaves the scheme default in place when neither spelling is present', async () => {
            expect(await mountedFormatId({})).toBe('default');
        });
    });

    it('ezclassify-select on a <select> creates a SingleSelect (select gets hidden, mount div created)', async () => {
        const select = document.createElement('select');
        select.setAttribute('data-ezclassify-controller', 'select');
        document.body.appendChild(select);

        const forms = await createForms();

        // Select should be hidden
        expect(select.style.display).toBe('none');
        // A mount div should be created as a sibling
        const mount = select.nextElementSibling;
        expect(mount).not.toBeNull();
        expect(mount?.getAttribute('data-ezclassify-mount')).toBe('select');
        // Component should be tracked
        expect(forms.components.has(select)).toBe(true);

        forms.destroy();
    });

    it('ezclassify-checklist="category_id" on a <fieldset> creates a CategoryChecklist with correct categoryId', async () => {
        const fieldset = document.createElement('fieldset');
        fieldset.setAttribute('data-ezclassify-controller', 'checklist');
        fieldset.setAttribute('data-ezclassify-checklist-category', 'level');
        document.body.appendChild(fieldset);

        const forms = await createForms();

        // Fieldset should be hidden (interactive component)
        expect(fieldset.style.display).toBe('none');
        // Component should be tracked
        expect(forms.components.has(fieldset)).toBe(true);
        // Mount div should exist
        const mount = fieldset.nextElementSibling;
        expect(mount?.getAttribute('data-ezclassify-mount')).toBe('checklist');
        // The checklist should have rendered items for the 'level' category
        const items = mount?.querySelectorAll('.category-checklist-item');
        expect(items?.length).toBe(3); // A, B, C

        forms.destroy();
    });

    it('ezclassify-selector on a <fieldset> creates a CategorySelector', async () => {
        const fieldset = document.createElement('fieldset');
        fieldset.setAttribute('data-ezclassify-controller', 'selector');
        document.body.appendChild(fieldset);

        const forms = await createForms();

        expect(fieldset.style.display).toBe('none');
        expect(forms.components.has(fieldset)).toBe(true);
        const mount = fieldset.nextElementSibling;
        expect(mount?.getAttribute('data-ezclassify-mount')).toBe('selector');

        forms.destroy();
    });

    it('ezclassify-card on a <div> creates an AssertionCard', async () => {
        const div = document.createElement('div');
        div.setAttribute('data-ezclassify-controller', 'card');
        document.body.appendChild(div);

        const forms = await createForms();

        // Read-only components mount directly on the div (no hiding)
        expect(div.style.display).not.toBe('none');
        expect(forms.components.has(div)).toBe(true);
        // The div itself is the container (no mount div created)
        expect(div.getAttribute('data-ezclassify')).toBe('');

        forms.destroy();
    });

    it('ezclassify-banner on a <div> creates a StatusBanner', async () => {
        const div = document.createElement('div');
        div.setAttribute('data-ezclassify-controller', 'banner');
        document.body.appendChild(div);

        const forms = await createForms();

        expect(div.style.display).not.toBe('none');
        expect(forms.components.has(div)).toBe(true);

        forms.destroy();
    });

    it('data-color-map JSON is parsed and passed as colorMap option', async () => {
        const select = document.createElement('select');
        select.setAttribute('data-ezclassify-controller', 'select');
        const colorMap = { A: { background: '#ff0000', text: '#fff' } };
        select.setAttribute(
            'data-ezclassify-select-color-map',
            JSON.stringify(colorMap),
        );
        document.body.appendChild(select);

        const forms = await createForms();

        // Component should be created (we verify no parse error)
        expect(forms.components.has(select)).toBe(true);
        // The mount div should render cards with the color map applied
        const mount = select.nextElementSibling as HTMLElement;
        expect(mount).not.toBeNull();

        forms.destroy();
    });

    it('data-category-groups JSON is parsed and passed as categoryGroups option', async () => {
        const fieldset = document.createElement('fieldset');
        fieldset.setAttribute('data-ezclassify-controller', 'selector');
        const categoryGroups = { Primary: ['level'] };
        fieldset.setAttribute(
            'data-ezclassify-selector-category-groups',
            JSON.stringify(categoryGroups),
        );
        document.body.appendChild(fieldset);

        const forms = await createForms();

        expect(forms.components.has(fieldset)).toBe(true);

        forms.destroy();
    });

    it('data-show-preview flag is passed as showPreview: true', async () => {
        const fieldset = document.createElement('fieldset');
        fieldset.setAttribute('data-ezclassify-controller', 'checklist');
        fieldset.setAttribute('data-ezclassify-checklist-category', 'level');
        fieldset.setAttribute('data-ezclassify-checklist-show-preview', '');
        document.body.appendChild(fieldset);

        const forms = await createForms();

        const mount = fieldset.nextElementSibling as HTMLElement;
        // showPreview causes a preview bar to be rendered
        const preview = mount?.querySelector('.proto-preview');
        expect(preview).not.toBeNull();

        forms.destroy();
    });

    it('data-show-codes flag is passed as showCodes: true', async () => {
        const fieldset = document.createElement('fieldset');
        fieldset.setAttribute('data-ezclassify-controller', 'selector');
        fieldset.setAttribute('data-ezclassify-selector-show-codes', '');
        document.body.appendChild(fieldset);

        const forms = await createForms();

        // showCodes is passed as an option; component should be created without error
        expect(forms.components.has(fieldset)).toBe(true);

        forms.destroy();
    });

    it('data-ezclassify-banner-show-current-data triggers showCurrentData mode', async () => {
        // A banner with the show-current-data attribute renders a
        // .status-banner-current span (the current-data line) instead of a
        // single-concept label.
        const div = document.createElement('div');
        div.setAttribute('data-ezclassify-controller', 'banner');
        div.setAttribute('data-ezclassify-banner-show-current-data', '');
        document.body.appendChild(div);

        const forms = await createForms();
        expect(forms.components.has(div)).toBe(true);
        // New mode renders a .status-banner-current span even before assertions are set.
        expect(div.querySelector('.status-banner-current')).not.toBeNull();

        forms.destroy();
    });

    it('data-ezclassify-banner-current-label is passed as currentLabel', async () => {
        const div = document.createElement('div');
        div.setAttribute('data-ezclassify-controller', 'banner');
        div.setAttribute('data-ezclassify-banner-show-current-data', '');
        div.setAttribute('data-ezclassify-banner-current-label', 'Marking');
        document.body.appendChild(div);

        const forms = await createForms();
        const currentEl = div.querySelector('.status-banner-current');
        expect(currentEl?.textContent).toContain('Marking');

        forms.destroy();
    });

    it('attribute value on ezclassify-checklist is passed as categoryId', async () => {
        const fieldset = document.createElement('fieldset');
        fieldset.setAttribute('data-ezclassify-controller', 'checklist');
        fieldset.setAttribute('data-ezclassify-checklist-category', 'level');
        document.body.appendChild(fieldset);

        const forms = await createForms();

        // Verify the checklist rendered concepts from the 'level' category
        const mount = fieldset.nextElementSibling as HTMLElement;
        const heading = mount?.querySelector('.category-checklist-header h3');
        expect(heading?.textContent).toBe('Level');

        forms.destroy();
    });

    it('component onChange triggers rollup update', async () => {
        const fieldset = document.createElement('fieldset');
        fieldset.setAttribute('data-ezclassify-controller', 'checklist');
        fieldset.setAttribute('data-ezclassify-checklist-category', 'level');
        document.body.appendChild(fieldset);

        const forms = await createForms();

        const mount = fieldset.nextElementSibling as HTMLElement;
        const checkbox = mount?.querySelector(
            '[data-concept-id="A"]',
        ) as HTMLInputElement;
        expect(checkbox).not.toBeNull();

        // Check the checkbox
        checkbox.checked = true;
        checkbox.dispatchEvent(new Event('change', { bubbles: true }));

        // Wait for debounced rollup to complete
        await new Promise((r) => setTimeout(r, 50));

        // The rollup field should have been updated
        expect(forms.rollupField).not.toBeNull();
        // aggregate was called
        expect(engine.aggregate).toHaveBeenCalled();

        forms.destroy();
    });

    it('component onChange dispatches ezclassify:change custom event', async () => {
        const fieldset = document.createElement('fieldset');
        fieldset.setAttribute('data-ezclassify-controller', 'checklist');
        fieldset.setAttribute('data-ezclassify-checklist-category', 'level');
        document.body.appendChild(fieldset);

        const forms = await createForms();

        const changePromise = new Promise<CustomEvent>((resolve) => {
            fieldset.addEventListener('ezclassify:change', (e) =>
                resolve(e as CustomEvent),
            );
        });

        const mount = fieldset.nextElementSibling as HTMLElement;
        const checkbox = mount?.querySelector(
            '[data-concept-id="A"]',
        ) as HTMLInputElement;
        checkbox.checked = true;
        checkbox.dispatchEvent(new Event('change', { bubbles: true }));

        const event = await changePromise;
        expect(event.detail).toBeDefined();
        expect(event.detail.assertions).toBeDefined();
        expect(event.detail.rendered).toBeDefined();

        forms.destroy();
    });

    it('interactive components sync form element value on change', async () => {
        const select = document.createElement('select') as HTMLSelectElement;
        select.setAttribute('data-ezclassify-controller', 'select');
        // A select only accepts a value assignment when a matching <option>
        // exists, so mirror the scheme's concepts as options.
        for (const value of ['', 'A', 'B', 'C']) {
            const option = document.createElement('option');
            option.value = value;
            option.textContent = value || '(none)';
            select.appendChild(option);
        }
        document.body.appendChild(select);

        const forms = await createForms();

        const changePromise = new Promise<CustomEvent>((resolve) => {
            select.addEventListener('ezclassify:change', (e) =>
                resolve(e as CustomEvent),
            );
        });

        // The single-select component mounts next to the hidden select. Changing
        // its conventional select must write the rendered marking back.
        const mount = select.nextElementSibling as HTMLElement;
        const picker = mount?.querySelector(
            '.select-dropdown',
        ) as HTMLSelectElement;
        expect(picker).not.toBeNull();
        picker.value = 'A';
        picker.dispatchEvent(new Event('change', { bubbles: true }));

        const event = await changePromise;
        expect(event.detail.rendered).not.toBe('');
        expect(select.value).toBe(event.detail.rendered);

        forms.destroy();
    });

    it('destroy() cleans up all components', async () => {
        const select = document.createElement('select');
        select.setAttribute('data-ezclassify-controller', 'select');
        document.body.appendChild(select);

        const fieldset = document.createElement('fieldset');
        fieldset.setAttribute('data-ezclassify-controller', 'checklist');
        fieldset.setAttribute('data-ezclassify-checklist-category', 'level');
        document.body.appendChild(fieldset);

        const div = document.createElement('div');
        div.setAttribute('data-ezclassify-controller', 'banner');
        document.body.appendChild(div);

        const forms = await createForms();

        expect(forms.components.size).toBe(3);

        forms.destroy();

        expect(forms.components.size).toBe(0);
        expect(forms.fields.length).toBe(0);
        expect(forms.rollupField).toBeNull();
    });

    it('does not double-register a component when the same element has already been tracked', async () => {
        const fieldset = document.createElement('fieldset');
        fieldset.setAttribute('data-ezclassify-controller', 'checklist');
        fieldset.setAttribute('data-ezclassify-checklist-category', 'level');
        document.body.appendChild(fieldset);

        const forms = await createForms();
        const firstComponent = forms.components.get(fieldset);

        // Manually re-trigger enhance logic by adding/removing the element.
        // The MutationObserver would fire, but the component should be skipped.
        // We simulate by checking that the same component is still in the map.
        expect(forms.components.get(fieldset)).toBe(firstComponent);
        expect(forms.components.size).toBe(1);

        forms.destroy();
    });

    it('invalid data-color-map JSON is silently ignored', async () => {
        const select = document.createElement('select');
        select.setAttribute('data-ezclassify-controller', 'select');
        select.setAttribute(
            'data-ezclassify-select-color-map',
            '{invalid json}',
        );
        document.body.appendChild(select);

        // Should not throw
        const forms = await createForms();
        expect(forms.components.has(select)).toBe(true);

        forms.destroy();
    });

    it('invalid data-category-groups JSON is silently ignored', async () => {
        const fieldset = document.createElement('fieldset');
        fieldset.setAttribute('data-ezclassify-controller', 'selector');
        fieldset.setAttribute(
            'data-ezclassify-selector-category-groups',
            'not-json',
        );
        document.body.appendChild(fieldset);

        const forms = await createForms();
        expect(forms.components.has(fieldset)).toBe(true);

        forms.destroy();
    });

    it('reads ezclassify-for attribute on components and tracks in targetMap', async () => {
        const select = document.createElement('select');
        select.setAttribute('data-ezclassify-controller', 'select');
        select.setAttribute('data-ezclassify-select-category', 'level');
        select.setAttribute('data-ezclassify-target', 'section-1');
        document.body.appendChild(select);

        const forms = await createForms();
        expect(forms.targetMap.get(select)).toBe('section-1');

        forms.destroy();
    });

    it('reads ezclassify-for attribute on autocomplete fields and tracks in targetMap', async () => {
        const input = document.createElement('input');
        input.type = 'text';
        input.setAttribute('data-ezclassify-controller', 'tags');
        input.setAttribute('data-ezclassify-target', 'para-2');
        document.body.appendChild(input);

        const forms = await createForms();
        expect(forms.targetMap.get(input)).toBe('para-2');

        forms.destroy();
    });

    it('getAssertionsByTarget returns grouped assertions', async () => {
        const input1 = document.createElement('input');
        input1.type = 'text';
        input1.setAttribute('data-ezclassify-controller', 'tags');
        input1.setAttribute('data-ezclassify-target', 'para-1');
        document.body.appendChild(input1);

        const input2 = document.createElement('input');
        input2.type = 'text';
        input2.setAttribute('data-ezclassify-controller', 'tags');
        input2.setAttribute('data-ezclassify-target', 'para-2');
        document.body.appendChild(input2);

        const forms = await createForms();
        const byTarget = forms.getAssertionsByTarget();
        // Should return a Map (may be empty if no values entered)
        expect(byTarget instanceof Map).toBe(true);

        forms.destroy();
    });

    it('ezclassify:change event includes target in detail', async () => {
        const select = document.createElement('select');
        select.setAttribute('data-ezclassify-controller', 'select');
        select.setAttribute('data-ezclassify-select-category', 'level');
        select.setAttribute('data-ezclassify-target', 'section-3');
        document.body.appendChild(select);

        const forms = await createForms();

        const changePromise = new Promise<CustomEvent>((resolve) => {
            select.addEventListener('ezclassify:change', (e) =>
                resolve(e as CustomEvent),
            );
        });

        // Selecting a concept fires onChange, which re-emits ezclassify:change
        // carrying the configured target from the data-ezclassify-target attribute.
        const mount = select.nextElementSibling as HTMLElement;
        const picker = mount.querySelector(
            '.select-dropdown',
        ) as HTMLSelectElement;
        picker.value = 'A';
        picker.dispatchEvent(new Event('change', { bubbles: true }));

        const event = await changePromise;
        expect(event.detail.target).toBe('section-3');

        forms.destroy();
    });

    describe('behavior-only elements (no controller)', () => {
        /**
         * Wrap the host element in a dedicated <section> so we can assert that
         * the behavior pass leaves the section's child list untouched (no mount
         * container injection). The framework still appends a rollup hidden
         * input to the scanner's root (document.body), that's the engine
         * wiring, not view treatment for our test element.
         */
        function wrap(el: HTMLElement): HTMLDivElement {
            const wrapper = document.createElement('div');
            wrapper.id = 'behavior-test-host';
            wrapper.appendChild(el);
            document.body.appendChild(wrapper);
            return wrapper;
        }

        it('an input with only data-ezclassify-bind is tracked without view injection', async () => {
            const input = document.createElement('input');
            input.type = 'text';
            input.id = 'plain';
            input.setAttribute('data-ezclassify-bind', '');
            const wrapper = wrap(input);

            const forms = await createForms();

            // Behavior: the input is registered for rollup contribution.
            expect(forms.fields).toContain(input);
            // View: no component was instantiated. The only injected DOM is the
            // contract-required enhancement status wrapper and its one mark.
            expect(forms.components.has(input)).toBe(false);
            expect(forms.autocompleters.has(input)).toBe(false);
            expect(input.style.display).not.toBe('none');
            expect(wrapper.children.length).toBe(1);
            expect(wrapper.firstElementChild?.classList).toContain(
                'ez-plain-field-wrap',
            );
            expect(
                wrapper.querySelectorAll(
                    '.ez-plain-field-wrap > .ez-status-mark',
                ),
            ).toHaveLength(1);

            forms.destroy();
            expect(wrapper.firstElementChild).toBe(input);
        });

        it('binds a native select facet in place with attributes only', async () => {
            const marking = document.createElement('input');
            marking.type = 'hidden';
            marking.id = 'document-marking';
            marking.value = 'A';
            marking.setAttribute('data-ezclassify-rendered', '');

            const select = document.createElement('select');
            select.setAttribute('data-ezclassify-bind', '');
            select.setAttribute('data-ezclassify-facet-of', 'document-marking');
            select.setAttribute('data-ezclassify-category', 'level');
            select.append(new Option('Pick a level', ''));
            document.body.append(marking, select);

            const forms = await createForms();
            await new Promise((resolve) => setTimeout(resolve, 0));

            expect(forms.components.has(select)).toBe(false);
            expect(select.style.display).not.toBe('none');
            expect(Array.from(select.options, (option) => option.text)).toEqual(
                ['Pick a level', 'Option A', 'Option B', 'Option C'],
            );
            expect(select.value).toBe('A');

            select.value = 'B';
            const synced = new Promise<void>((resolve) => {
                select.addEventListener('ezclassify:sync', () => resolve(), {
                    once: true,
                });
            });
            select.dispatchEvent(new Event('change', { bubbles: true }));
            await synced;

            expect(
                forms.store.get('document-marking').assertions,
            ).toMatchObject([{ conceptId: 'B', categoryId: 'level' }]);
            expect(select.value).toBe('B');

            forms.destroy();
        });

        it('a behavior-only input with data-ezclassify-target tracks the target but injects no view', async () => {
            const input = document.createElement('input');
            input.id = 'targeted';
            input.setAttribute('data-ezclassify-bind', '');
            input.setAttribute('data-ezclassify-target', 'banner-target');
            const wrapper = wrap(input);

            const forms = await createForms();

            // Behavior: target relationship is tracked, field is registered.
            expect(forms.targetMap.get(input)).toBe('banner-target');
            expect(forms.fields).toContain(input);
            // View: zero injected DOM in the host element's container.
            expect(forms.components.has(input)).toBe(false);
            expect(wrapper.children.length).toBe(1);

            forms.destroy();
        });

        it('a behavior-only element with data-ezclassify-part-of tracks the relationship without view', async () => {
            const input = document.createElement('input');
            input.id = 'portion';
            input.setAttribute('data-ezclassify-bind', '');
            input.setAttribute('data-ezclassify-part-of', 'whole-banner');
            const wrapper = wrap(input);

            const forms = await createForms();

            expect(forms.partOfMap.get(input)).toBe('whole-banner');
            expect(forms.fields).toContain(input);
            expect(forms.components.has(input)).toBe(false);
            expect(wrapper.children.length).toBe(1);

            forms.destroy();
        });

        it('a behavior-only input contributes its blurred rendered value to the rollup', async () => {
            const wrapper = document.createElement('div');
            const input = document.createElement('input');
            input.type = 'text';
            input.id = 'plain-rollup';
            input.setAttribute('data-ezclassify-bind', '');
            input.setAttribute('data-ezclassify-category', 'level');
            wrapper.appendChild(input);
            document.body.appendChild(wrapper);

            const processSpy = vi
                .spyOn(engine, 'process')
                .mockImplementation((value: unknown) => {
                    const raw = String(value).trim().toLowerCase();
                    if (raw === 'option a') {
                        return mockProcessResult({
                            assertions: [
                                mockAssertion({
                                    conceptId: 'A',
                                    categoryId: 'level',
                                }),
                            ],
                            rendered: 'A',
                            recognition: {
                                status: 'complete',
                                inputFormat: 'default',
                                surface: 'default',
                                unmatched: [],
                                corrections: [],
                            },
                        });
                    }
                    return mockProcessResult({
                        rendered: String(value),
                        valid: false,
                        errors: [
                            {
                                message: 'Unknown marking',
                            } as ValidationError,
                        ],
                    });
                });

            const forms = await createForms({
                root: document.body,
                rollupId: 'main-rollup',
            });
            await new Promise((resolve) => setTimeout(resolve, 0));

            expect(forms.fields).toContain(input);

            input.value = 'option a';
            input.dispatchEvent(new FocusEvent('blur', { bubbles: true }));
            await new Promise((resolve) => setTimeout(resolve, 50));

            const rollup =
                document.body.querySelector<HTMLInputElement>('#main-rollup');
            expect(processSpy).toHaveBeenCalledWith('option a', {
                outputFormat: 'default',
            });
            expect(input.value).toBe('A');
            expect(rollup?.value).toBe('A');
            expect(wrapper.hasAttribute('data-ezclassify-invalid')).toBe(false);

            forms.destroy();
        });

        it('data-ezclassify-format overrides the render format on a behavior-only input', async () => {
            // The 'short' format renders the level concept lowercased; 'default'
            // renders it uppercased. The override must drive BOTH the engine call
            // and the committed input value.
            const wrapper = document.createElement('div');
            const input = document.createElement('input');
            input.type = 'text';
            input.id = 'fmt-input';
            input.setAttribute('data-ezclassify-bind', '');
            input.setAttribute('data-ezclassify-category', 'level');
            input.setAttribute('data-ezclassify-format', 'short');
            wrapper.appendChild(input);
            document.body.appendChild(wrapper);

            const processSpy = vi
                .spyOn(engine, 'process')
                .mockImplementation(
                    (value: unknown, options?: { outputFormat?: string }) => {
                        const fmt = options?.outputFormat;
                        return mockProcessResult({
                            assertions: [
                                mockAssertion({
                                    conceptId: 'A',
                                    categoryId: 'level',
                                }),
                            ],
                            // 'short' lowercases, anything else uppercases, so the asserted
                            // value proves which format was actually used.
                            rendered: fmt === 'short' ? 'a' : 'A',
                            recognition: {
                                status: 'complete',
                                inputFormat: 'default',
                                surface: 'default',
                                unmatched: [],
                                corrections: [],
                            },
                        });
                    },
                );

            const forms = await createForms({
                root: document.body,
                rollupId: 'fmt-rollup',
            });
            await new Promise((resolve) => setTimeout(resolve, 0));

            input.value = 'A';
            input.dispatchEvent(new FocusEvent('blur', { bubbles: true }));
            await new Promise((resolve) => setTimeout(resolve, 50));

            // Engine was called with the per-input override format, not the scheme default.
            expect(processSpy).toHaveBeenCalledWith('A', {
                outputFormat: 'short',
            });
            // Committed value reflects the override format.
            expect(input.value).toBe('a');

            forms.destroy();
        });

        it('a behavior-only input WITHOUT data-ezclassify-format uses the scheme default format', async () => {
            // Guard: the override is a no-op when absent, the default 'default'
            // format must be used exactly as before.
            const wrapper = document.createElement('div');
            const input = document.createElement('input');
            input.type = 'text';
            input.id = 'no-fmt-input';
            input.setAttribute('data-ezclassify-bind', '');
            input.setAttribute('data-ezclassify-category', 'level');
            wrapper.appendChild(input);
            document.body.appendChild(wrapper);

            const processSpy = vi
                .spyOn(engine, 'process')
                .mockImplementation(
                    (value: unknown, options?: { outputFormat?: string }) => {
                        const fmt = options?.outputFormat;
                        return mockProcessResult({
                            assertions: [
                                mockAssertion({
                                    conceptId: 'A',
                                    categoryId: 'level',
                                }),
                            ],
                            rendered: fmt === 'short' ? 'a' : 'A',
                            recognition: {
                                status: 'complete',
                                inputFormat: 'default',
                                surface: 'default',
                                unmatched: [],
                                corrections: [],
                            },
                        });
                    },
                );

            const forms = await createForms({
                root: document.body,
                rollupId: 'no-fmt-rollup',
            });
            await new Promise((resolve) => setTimeout(resolve, 0));

            input.value = 'A';
            input.dispatchEvent(new FocusEvent('blur', { bubbles: true }));
            await new Promise((resolve) => setTimeout(resolve, 50));

            expect(processSpy).toHaveBeenCalledWith('A', {
                outputFormat: 'default',
            });
            expect(input.value).toBe('A');

            forms.destroy();
        });

        it('a behavior-only element with a non-input tag receives no field registration', async () => {
            const div = document.createElement('div');
            div.setAttribute('data-ezclassify-bind', '');
            div.setAttribute('data-ezclassify-category', 'level');
            const wrapper = wrap(div);

            const forms = await createForms();

            // Non-input behavior-only elements are not pushed into `fields`.
            expect(forms.fields).not.toContain(
                div as unknown as HTMLInputElement,
            );
            // But binding tracking is still readable via the scanner, nothing
            // visual is injected.
            expect(forms.components.has(div)).toBe(false);
            expect(wrapper.children.length).toBe(1);
            expect(div.style.display).not.toBe('none');

            forms.destroy();
        });
    });
});
