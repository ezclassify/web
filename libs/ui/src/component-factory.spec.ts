import { describe, it, expect, beforeEach } from 'vitest';
import {
    parseComponentOptions,
    resolveNativeInput,
    createMountContainer,
    createComponent,
    createHostComponent,
    componentNameForHost,
    buildComponentOptions,
} from './component-factory';
import { TranslatedView } from './components/translated-view';
import type { ControllerName } from './element-scanner';

describe('parseComponentOptions', () => {
    let el: HTMLElement;

    beforeEach(() => {
        el = document.createElement('div');
    });

    it('passes through `size` unchanged', () => {
        expect(parseComponentOptions(el, { size: 'compact' })).toEqual(
            expect.objectContaining({ size: 'compact' }),
        );
    });

    it('maps `primary-category` to primaryCategoryId', () => {
        expect(
            parseComponentOptions(el, { 'primary-category': 'main-cat' }),
        ).toEqual(expect.objectContaining({ primaryCategoryId: 'main-cat' }));
    });

    it('reads scope from data-ezclassify-scope on the host element', () => {
        el.setAttribute('data-ezclassify-scope', 'my-scope');
        expect(parseComponentOptions(el, {})).toEqual(
            expect.objectContaining({ scope: 'my-scope' }),
        );
    });

    it('maps `parent-concept` to parentConcept', () => {
        expect(
            parseComponentOptions(el, { 'parent-concept': 'parent-1' }),
        ).toEqual(expect.objectContaining({ parentConcept: 'parent-1' }));
    });

    it('sets showPreview when `show-preview` is present', () => {
        expect(parseComponentOptions(el, { 'show-preview': '' })).toEqual(
            expect.objectContaining({ showPreview: true }),
        );
    });

    it('sets showCodes when `show-codes` is present', () => {
        expect(parseComponentOptions(el, { 'show-codes': '' })).toEqual(
            expect.objectContaining({ showCodes: true }),
        );
    });

    it('parses `color-map` as JSON', () => {
        expect(
            parseComponentOptions(el, { 'color-map': '{"a":"red"}' }),
        ).toEqual(expect.objectContaining({ colorMap: { a: 'red' } }));
    });

    it('ignores invalid JSON in `color-map`', () => {
        const opts = parseComponentOptions(el, { 'color-map': '{bad}' });
        expect(opts.colorMap).toBeUndefined();
    });

    it('does not accept host color rules', () => {
        // Host color rules left the public surface at 1.0: matching them meant
        // running the scheme condition evaluator in the browser. The attribute
        // is now an unrecognized one and stays raw rather than becoming an
        // option nothing reads.
        const raw =
            '[{"when":{"all":["TOP_SECRET","SI"]},"color":{"background":"#ffd400","text":"#000"}}]';
        const opts = parseComponentOptions(el, { 'color-rules': raw });
        expect(opts.colorRules).toBeUndefined();
        expect(opts['color-rules']).toBe(raw);
    });

    it('parses `category-groups` as JSON', () => {
        expect(
            parseComponentOptions(el, { 'category-groups': '[["a","b"]]' }),
        ).toEqual(expect.objectContaining({ categoryGroups: [['a', 'b']] }));
    });

    it('ignores invalid JSON in `category-groups`', () => {
        const opts = parseComponentOptions(el, {
            'category-groups': 'not-json',
        });
        expect(opts.categoryGroups).toBeUndefined();
    });

    it('returns an empty object for an empty options bag', () => {
        expect(parseComponentOptions(el, {})).toEqual({});
    });

    it('extracts multiple options at once', () => {
        el.setAttribute('data-ezclassify-format', 'short');
        el.setAttribute('data-ezclassify-category', 'level');
        const opts = parseComponentOptions(el, { 'show-preview': '' });
        expect(opts.formatId).toBe('short');
        expect(opts.categoryId).toBe('level');
        expect(opts.showPreview).toBe(true);
    });

    it('reads the category from data-ezclassify-category on the host', () => {
        el.setAttribute('data-ezclassify-category', 'level');
        expect(parseComponentOptions(el, {})).toEqual(
            expect.objectContaining({ categoryId: 'level' }),
        );
    });

    it('reads the format from data-ezclassify-format on the host', () => {
        // `data-ezclassify-format` is a host-level attribute in the documented
        // grammar, like scope and category: one attribute, one meaning,
        // wherever it is written. A controller host must honor it.
        el.setAttribute('data-ezclassify-format', 'banner');
        expect(parseComponentOptions(el, {})).toEqual(
            expect.objectContaining({ formatId: 'banner' }),
        );
    });

    it('ignores an empty data-ezclassify-format rather than forcing an empty format id', () => {
        el.setAttribute('data-ezclassify-format', '');
        expect(parseComponentOptions(el, {}).formatId).toBeUndefined();
    });

    it('does not inherit data-ezclassify-format from an ancestor', () => {
        // Format is per-field: a wrapper that sets one field's format must not
        // silently retag every controller beneath it.
        const parent = document.createElement('div');
        parent.setAttribute('data-ezclassify-format', 'banner');
        parent.appendChild(el);
        expect(parseComponentOptions(el, {}).formatId).toBeUndefined();
    });
});

describe('resolveNativeInput', () => {
    it('returns the element itself for non-fieldset elements', () => {
        const input = document.createElement('input');
        expect(resolveNativeInput(input, 'tags')).toBe(input);
    });

    it('finds existing hidden input inside a fieldset', () => {
        const fieldset = document.createElement('fieldset');
        const hidden = document.createElement('input');
        hidden.type = 'hidden';
        fieldset.appendChild(hidden);
        expect(resolveNativeInput(fieldset, 'checklist')).toBe(hidden);
    });

    it('creates a hidden input if fieldset has none', () => {
        const fieldset = document.createElement('fieldset');
        fieldset.id = 'my-fs';
        const result = resolveNativeInput(fieldset, 'checklist');
        expect(result.type).toBe('hidden');
        expect(result.parentElement).toBe(fieldset);
    });

    it('uses fieldset name attribute for created hidden input name', () => {
        const fieldset = document.createElement('fieldset');
        fieldset.setAttribute('name', 'fs-name');
        const result = resolveNativeInput(fieldset, 'checklist');
        expect(result.name).toBe('fs-name');
    });

    it('falls back to fieldset id for hidden input name', () => {
        const fieldset = document.createElement('fieldset');
        fieldset.id = 'fs-id';
        const result = resolveNativeInput(fieldset, 'checklist');
        expect(result.name).toBe('fs-id');
    });

    it('falls back to empty id when fieldset has no name attribute', () => {
        const fieldset = document.createElement('fieldset');
        const result = resolveNativeInput(fieldset, 'selector');
        expect(result.name).toBe('');
    });
});

describe('createMountContainer', () => {
    it('creates a sibling div for interactive controllers', () => {
        const parent = document.createElement('div');
        const input = document.createElement('input');
        parent.appendChild(input);
        const container = createMountContainer(input, 'tags');
        expect(container.getAttribute('data-ezclassify-mount')).toBe('tags');
        expect(container.parentElement).toBe(parent);
    });

    it('hides the original element for interactive controllers', () => {
        const parent = document.createElement('div');
        const input = document.createElement('input');
        parent.appendChild(input);
        createMountContainer(input, 'select');
        expect(input.style.display).toBe('none');
    });

    it('returns the element itself for the banner controller (read-only)', () => {
        const el = document.createElement('div');
        const container = createMountContainer(el, 'banner');
        expect(container).toBe(el);
    });

    it('keeps marked-textarea visible', () => {
        const parent = document.createElement('div');
        const textarea = document.createElement('textarea');
        parent.appendChild(textarea);
        createMountContainer(textarea as any, 'marked-textarea');
        expect(textarea.style.display).not.toBe('none');
    });
});

describe('createComponent', () => {
    const controllers: ControllerName[] = [
        'tags',
        'select',
        'checklist',
        'selector',
        'banner',
        'handbook',
        'decisionflow',
        'hidden',
        'marked-textarea',
    ];

    for (const controller of controllers) {
        it(`creates a component for ${controller}`, () => {
            const component = createComponent(controller);
            expect(component).not.toBeNull();
            expect(component).toHaveProperty('init');
            expect(component).toHaveProperty('getAssertions');
            expect(component).toHaveProperty('destroy');
        });
    }

    it('returns null for an unknown controller', () => {
        const component = createComponent('not-a-controller' as any);
        expect(component).toBeNull();
    });
});

describe('createHostComponent', () => {
    function translated(): HTMLElement {
        const el = document.createElement('span');
        el.setAttribute('data-ezclassify-source', 'memo1');
        el.setAttribute('data-ezclassify-translate', 'tier-to-label');
        return el;
    }

    it('mounts a translated view on a host with data-ezclassify-translate', () => {
        const el = translated();
        expect(createHostComponent(el, null)).toBeInstanceOf(TranslatedView);
        expect(componentNameForHost(el, null)).toBe('TranslatedView');
    });

    it('mounts a translated view in place', () => {
        const parent = document.createElement('div');
        const el = translated();
        parent.appendChild(el);
        expect(createMountContainer(el, null)).toBe(el);
        expect(parent.querySelector('[data-ezclassify-mount]')).toBeNull();
    });

    it('mounts the controller component on any other host', () => {
        const el = document.createElement('div');
        expect(componentNameForHost(el, 'banner')).toBe('StatusBanner');
        expect(createHostComponent(el, null)).toBeNull();
    });
});

describe('buildComponentOptions', () => {
    it('merges parsed options with overrides', () => {
        const opts = buildComponentOptions(
            { categoryId: 'cat' },
            { root: document.body },
        );
        expect(opts.categoryId).toBe('cat');
        expect(opts.root).toBe(document.body);
    });

    it('overrides take precedence over parsed options for the same key', () => {
        const opts = buildComponentOptions({ scope: 'a' }, { scope: 'b' });
        expect(opts.scope).toBe('b');
    });
});
