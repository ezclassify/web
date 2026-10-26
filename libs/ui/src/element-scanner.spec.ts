import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    CONTROLLER_NAMES,
    scanElements,
    observeNewElements,
    harvestControllerOptions,
    type BehaviorBinding,
    type ControllerName,
} from './element-scanner';

describe('CONTROLLER_NAMES', () => {
    it('contains all 20 recognized controllers', () => {
        // 2 framework/GRC controllers (scorecard, matrix) are deferred
        // from the 1.0 surface.
        expect(CONTROLLER_NAMES).toHaveLength(20);
    });

    it('starts with tags', () => {
        expect(CONTROLLER_NAMES[0]).toBe('tags');
    });

    it('includes text', () => {
        expect(CONTROLLER_NAMES).toContain('text');
    });

    it('includes equivalency', () => {
        expect(CONTROLLER_NAMES).toContain('equivalency');
    });

    it('includes marking', () => {
        expect(CONTROLLER_NAMES).toContain('marking');
    });

    it('includes access-handbook', () => {
        expect(CONTROLLER_NAMES).toContain('access-handbook');
    });

    it('includes context-reference', () => {
        expect(CONTROLLER_NAMES).toContain('context-reference');
    });

    it('includes interactive controllers', () => {
        for (const c of [
            'tags',
            'select',
            'checklist',
            'selector',
            'dualpane',
        ]) {
            expect(CONTROLLER_NAMES).toContain(c);
        }
    });

    it('includes read-only controllers', () => {
        expect(CONTROLLER_NAMES).toContain('card');
        expect(CONTROLLER_NAMES).toContain('banner');
    });
});

describe('scanElements', () => {
    let root: HTMLDivElement;

    beforeEach(() => {
        root = document.createElement('div');
    });

    it('reports a controller element to both behavior and view callbacks', () => {
        const input = document.createElement('input');
        input.setAttribute('data-ezclassify-controller', 'tags');
        root.appendChild(input);

        const onBehavior = vi.fn();
        const onView = vi.fn();
        scanElements(root, null, onBehavior, onView);

        expect(onBehavior).toHaveBeenCalledTimes(1);
        expect(onBehavior).toHaveBeenCalledWith(
            input,
            expect.objectContaining({ bind: false }),
        );
        expect(onView).toHaveBeenCalledTimes(1);
        expect(onView).toHaveBeenCalledWith(input, 'tags', {});
    });

    it('reports a behavior-bound element with no controller only to onBehavior', () => {
        const input = document.createElement('input');
        input.setAttribute('data-ezclassify-bind', '');
        input.setAttribute('data-ezclassify-target', 'para-1');
        root.appendChild(input);

        const onBehavior = vi.fn();
        const onView = vi.fn();
        scanElements(root, null, onBehavior, onView);

        expect(onBehavior).toHaveBeenCalledTimes(1);
        const binding = onBehavior.mock.calls[0][1] as BehaviorBinding;
        expect(binding.bind).toBe(true);
        expect(binding.target).toBe('para-1');
        expect(onView).not.toHaveBeenCalled();
    });

    it('treats any data-ezclassify-* attribute as implicit binding opt-in', () => {
        const div = document.createElement('div');
        div.setAttribute('data-ezclassify-category', 'level');
        root.appendChild(div);

        const onBehavior = vi.fn();
        const onView = vi.fn();
        scanElements(root, null, onBehavior, onView);

        expect(onBehavior).toHaveBeenCalledTimes(1);
        expect((onBehavior.mock.calls[0][1] as BehaviorBinding).category).toBe(
            'level',
        );
        expect(onView).not.toHaveBeenCalled();
    });

    it('parses non-axis binding fields from data-ezclassify-* attributes', () => {
        const el = document.createElement('div');
        el.setAttribute('data-ezclassify-bind', '');
        el.setAttribute('data-ezclassify-category', 'level');
        el.setAttribute('data-ezclassify-part-of', 'parent-id');
        el.setAttribute('data-ezclassify-rendered', '');
        el.setAttribute('data-ezclassify-bound-to', 'bind-id');
        el.setAttribute('data-ezclassify-target', 'tgt');
        el.setAttribute('data-ezclassify-scope', '');
        el.setAttribute('data-ezclassify-scheme', 'scheme-x');
        root.appendChild(el);

        const onBehavior = vi.fn();
        scanElements(root, null, onBehavior, vi.fn());
        const b = onBehavior.mock.calls[0][1] as BehaviorBinding;
        expect(b).toMatchObject({
            bind: true,
            category: 'level',
            partOf: 'parent-id',
            rendered: true,
            boundTo: 'bind-id',
            target: 'tgt',
            scope: '',
            scheme: 'scheme-x',
        });
    });

    it('parses the facet-of axis when present alone', () => {
        const el = document.createElement('div');
        el.setAttribute('data-ezclassify-facet-of', 'frag-id');
        el.setAttribute('data-ezclassify-category', 'level');
        root.appendChild(el);

        const onBehavior = vi.fn();
        scanElements(root, null, onBehavior, vi.fn());
        const b = onBehavior.mock.calls[0][1] as BehaviorBinding;
        expect(b.facetOf).toBe('frag-id');
        expect(b.boundTo).toBeUndefined();
        expect(b.source).toBeUndefined();
        expect(b.aggregate).toBeUndefined();
    });

    it('parses the source axis when present alone', () => {
        const el = document.createElement('div');
        el.setAttribute('data-ezclassify-source', 'src-id');
        root.appendChild(el);

        const onBehavior = vi.fn();
        scanElements(root, null, onBehavior, vi.fn());
        const b = onBehavior.mock.calls[0][1] as BehaviorBinding;
        expect(b.source).toBe('src-id');
        expect(b.boundTo).toBeUndefined();
        expect(b.facetOf).toBeUndefined();
        expect(b.aggregate).toBeUndefined();
    });

    it('exposes a marking-only element via the marking flag', () => {
        const el = document.createElement('input');
        el.id = 'doc-marking';
        el.setAttribute('data-ezclassify-rendered', '');
        root.appendChild(el);

        const onBehavior = vi.fn();
        scanElements(root, null, onBehavior, vi.fn());
        const b = onBehavior.mock.calls[0][1] as BehaviorBinding;
        expect(b.rendered).toBe(true);
        expect(b.boundTo).toBeUndefined();
    });

    it('exposes the bound-to attribute as the marking reference', () => {
        const el = document.createElement('input');
        el.setAttribute('data-ezclassify-controller', 'tags');
        el.setAttribute('data-ezclassify-bound-to', 'doc-marking');
        root.appendChild(el);

        const onBehavior = vi.fn();
        scanElements(root, null, onBehavior, vi.fn());
        const b = onBehavior.mock.calls[0][1] as BehaviorBinding;
        expect(b.boundTo).toBe('doc-marking');
    });

    it('exposes the aggregate attribute as a presence flag', () => {
        const el = document.createElement('div');
        el.setAttribute('data-ezclassify-controller', 'banner');
        el.setAttribute('data-ezclassify-aggregate', '');
        root.appendChild(el);

        const onBehavior = vi.fn();
        scanElements(root, null, onBehavior, vi.fn());
        const b = onBehavior.mock.calls[0][1] as BehaviorBinding;
        expect(b.aggregate).toBe(true);
    });

    it('invokes onBehavior before onView for elements with both', () => {
        const input = document.createElement('input');
        input.setAttribute('data-ezclassify-controller', 'tags');
        input.setAttribute('data-ezclassify-target', 'para-1');
        root.appendChild(input);

        const calls: string[] = [];
        scanElements(
            root,
            null,
            () => calls.push('behavior'),
            () => calls.push('view'),
        );
        expect(calls).toEqual(['behavior', 'view']);
    });

    it('ignores elements without any data-ezclassify-* attribute', () => {
        const input = document.createElement('input');
        input.setAttribute('type', 'text');
        root.appendChild(input);

        const onBehavior = vi.fn();
        const onView = vi.fn();
        scanElements(root, null, onBehavior, onView);
        expect(onBehavior).not.toHaveBeenCalled();
        expect(onView).not.toHaveBeenCalled();
    });

    it('ignores controllers with unrecognized names', () => {
        const el = document.createElement('div');
        el.setAttribute('data-ezclassify-controller', 'not-a-controller');
        root.appendChild(el);
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

        const onBehavior = vi.fn();
        const onView = vi.fn();
        scanElements(root, null, onBehavior, onView);
        expect(onBehavior).toHaveBeenCalledTimes(1);
        expect(onView).not.toHaveBeenCalled();
        expect(warn).not.toHaveBeenCalled();
        warn.mockRestore();
    });

    it('never resolves an Object.prototype member name as a controller (prototype-pollution guard)', () => {
        for (const poisoned of [
            'constructor',
            'toString',
            'valueOf',
            'hasOwnProperty',
            '__proto__',
        ]) {
            const input = document.createElement('input');
            input.setAttribute('data-ezclassify-controller', poisoned);
            root.appendChild(input);
            const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

            const onBehavior = vi.fn();
            const onView = vi.fn();
            scanElements(root, null, onBehavior, onView);

            // The element is still behavior-bound (the controller attribute alone
            // implies binding) but an unrecognized/poisoned name must never reach
            // onView as a resolved controller.
            expect(onBehavior).toHaveBeenCalledTimes(1);
            expect(onView).not.toHaveBeenCalled();
            expect(warn).not.toHaveBeenCalled();

            warn.mockRestore();
            root.removeChild(input);
        }
    });

    it('scans nested elements', () => {
        const wrapper = document.createElement('div');
        const input = document.createElement('input');
        input.setAttribute('data-ezclassify-controller', 'select');
        wrapper.appendChild(input);
        root.appendChild(wrapper);

        const onView = vi.fn();
        scanElements(root, null, vi.fn(), onView);
        expect(onView).toHaveBeenCalledWith(input, 'select', {});
    });

    it('finds multiple elements with different controllers', () => {
        const a = document.createElement('input');
        a.setAttribute('data-ezclassify-controller', 'tags');
        const b = document.createElement('div');
        b.setAttribute('data-ezclassify-controller', 'banner');
        root.appendChild(a);
        root.appendChild(b);

        const seen: Array<[HTMLElement, ControllerName]> = [];
        scanElements(root, null, vi.fn(), (el, controller) =>
            seen.push([el, controller]),
        );

        expect(seen).toHaveLength(2);
        expect(seen).toContainEqual([a, 'tags']);
        expect(seen).toContainEqual([b, 'banner']);
    });
});

describe('harvestControllerOptions', () => {
    it('collects data-ezclassify-<controller>-* attributes into a bag', () => {
        const el = document.createElement('div');
        el.setAttribute('data-ezclassify-controller', 'tags');
        el.setAttribute('data-ezclassify-tags-size', 'large');
        el.setAttribute('data-ezclassify-tags-collapse-at', '5');
        el.setAttribute('data-ezclassify-select-color-map', '{}'); // wrong controller, ignored
        el.setAttribute('data-foo', 'bar'); // unrelated, ignored

        const opts = harvestControllerOptions(el, 'tags');
        expect(opts).toEqual({ 'size': 'large', 'collapse-at': '5' });
    });

    it('returns an empty bag when no matching attributes', () => {
        const el = document.createElement('div');
        el.setAttribute('data-ezclassify-controller', 'card');
        const opts = harvestControllerOptions(el, 'card');
        expect(opts).toEqual({});
    });

    it('ignores options for a different controller', () => {
        const el = document.createElement('div');
        el.setAttribute('data-ezclassify-controller', 'tags');
        el.setAttribute('data-ezclassify-select-collapse-at', '5');
        el.setAttribute('data-ezclassify-tags-collapse-at', '9');

        const opts = harvestControllerOptions(el, 'tags');
        expect(opts).toEqual({ 'collapse-at': '9' });
    });
});

describe('observeNewElements', () => {
    let root: HTMLDivElement;
    let observer: MutationObserver;

    beforeEach(() => {
        root = document.createElement('div');
        document.body.appendChild(root);
    });

    afterEach(() => {
        observer?.disconnect();
        root.remove();
    });

    it('returns a MutationObserver instance', () => {
        observer = observeNewElements(root, null, vi.fn(), vi.fn());
        expect(observer).toBeInstanceOf(MutationObserver);
    });

    it('detects a dynamically added controller element', async () => {
        const onView = vi.fn();
        observer = observeNewElements(root, null, vi.fn(), onView);

        const input = document.createElement('input');
        input.setAttribute('data-ezclassify-controller', 'tags');
        root.appendChild(input);

        await new Promise((r) => setTimeout(r, 0));
        expect(onView).toHaveBeenCalledWith(input, 'tags', {});
    });

    it('detects controller elements inside a dynamically added subtree', async () => {
        const onView = vi.fn();
        observer = observeNewElements(root, null, vi.fn(), onView);

        const wrapper = document.createElement('div');
        const inner = document.createElement('div');
        inner.setAttribute('data-ezclassify-controller', 'banner');
        wrapper.appendChild(inner);
        root.appendChild(wrapper);

        await new Promise((r) => setTimeout(r, 0));
        expect(onView).toHaveBeenCalledWith(inner, 'banner', {});
    });

    it('detects behavior-only elements added dynamically', async () => {
        const onBehavior = vi.fn();
        const onView = vi.fn();
        observer = observeNewElements(root, null, onBehavior, onView);

        const input = document.createElement('input');
        input.setAttribute('data-ezclassify-bind', '');
        root.appendChild(input);

        await new Promise((r) => setTimeout(r, 0));
        expect(onBehavior).toHaveBeenCalledWith(
            input,
            expect.objectContaining({ bind: true }),
        );
        expect(onView).not.toHaveBeenCalled();
    });

    it('ignores text nodes', async () => {
        const cb = vi.fn();
        observer = observeNewElements(root, null, cb, cb);

        root.appendChild(document.createTextNode('hello'));
        await new Promise((r) => setTimeout(r, 0));
        expect(cb).not.toHaveBeenCalled();
    });

    it('can be disconnected', async () => {
        const cb = vi.fn();
        observer = observeNewElements(root, null, cb, cb);
        observer.disconnect();

        const input = document.createElement('input');
        input.setAttribute('data-ezclassify-controller', 'tags');
        root.appendChild(input);

        await new Promise((r) => setTimeout(r, 0));
        expect(cb).not.toHaveBeenCalled();
    });

    // Regression: a keep-visible controller's enhancement moves its native host
    // into a freshly created wrapper. That relocation surfaces the host in a
    // removedNodes record (old parent) paired with an addedNodes record (wrapper).
    // The observer must NOT treat the still-connected, merely-relocated host as a
    // removal, otherwise it destroys the enhancement and the paired addition
    // re-enhances it, moving it again: an unbounded loop that hangs the main
    // thread when a marked field is added after mount.
    it('does not report a relocated (still-connected) host as removed', async () => {
        const enhanced = new Set<HTMLElement>();
        const onRemove = vi.fn();
        // onView mimics the enhance path: move the host into a new wrapper once.
        const onView = vi.fn((el: HTMLElement) => {
            if (enhanced.has(el)) return; // idempotent, like attachView's dedup
            enhanced.add(el);
            const wrap = document.createElement('div');
            el.parentNode?.insertBefore(wrap, el);
            wrap.appendChild(el); // relocation: removal from old parent + add to wrap
        });
        observer = observeNewElements(root, null, vi.fn(), onView, onRemove);

        const input = document.createElement('input');
        input.setAttribute('data-ezclassify-controller', 'marked-input');
        root.appendChild(input);

        // Let the initial add + the enhancement's relocation both flush. An
        // observer loop would starve the timer here; reaching the assertions at
        // all proves the observer converged.
        await new Promise((r) => setTimeout(r, 20));

        // Moved into a wrapper exactly once (the dedup made re-observations no-ops),
        // host still in the tree, and never torn down.
        expect(enhanced.size).toBe(1);
        expect(input.parentElement?.tagName).toBe('DIV');
        expect(root.contains(input)).toBe(true);
        expect(onRemove).not.toHaveBeenCalled();
    });

    it('still reports a host that genuinely leaves the observed root', async () => {
        const onRemove = vi.fn();
        observer = observeNewElements(root, null, vi.fn(), vi.fn(), onRemove);

        const input = document.createElement('input');
        input.setAttribute('data-ezclassify-controller', 'marked-input');
        root.appendChild(input);
        await new Promise((r) => setTimeout(r, 0));

        input.remove();
        await new Promise((r) => setTimeout(r, 0));
        expect(onRemove).toHaveBeenCalledWith(input);
    });
});

describe('forbidden binding patterns', () => {
    let root: HTMLDivElement;
    let warnSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        root = document.createElement('div');
        warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
        warnSpy.mockRestore();
    });

    describe('multiple binding axis attributes on one element', () => {
        it('warns when bound-to and source are both present', () => {
            const el = document.createElement('input');
            el.setAttribute('data-ezclassify-bound-to', 'm1');
            el.setAttribute('data-ezclassify-source', 'm2');
            root.appendChild(el);

            scanElements(root, null, vi.fn(), vi.fn());

            expect(warnSpy).toHaveBeenCalledTimes(1);
            expect(warnSpy.mock.calls[0][0]).toMatch(/binding axis attributes/);
            expect(warnSpy.mock.calls[0][0]).toMatch(
                /data-ezclassify-bound-to/,
            );
            expect(warnSpy.mock.calls[0][0]).toMatch(/data-ezclassify-source/);
        });

        it('keeps the first axis in table order (bound-to wins over facet-of/source/aggregate)', () => {
            const el = document.createElement('div');
            el.setAttribute('data-ezclassify-bound-to', 'one');
            el.setAttribute('data-ezclassify-facet-of', 'two');
            el.setAttribute('data-ezclassify-source', 'three');
            el.setAttribute('data-ezclassify-aggregate', '');
            root.appendChild(el);

            const onBehavior = vi.fn();
            scanElements(root, null, onBehavior, vi.fn());
            const b = onBehavior.mock.calls[0][1] as BehaviorBinding;

            expect(b.boundTo).toBe('one');
            expect(b.facetOf).toBeUndefined();
            expect(b.source).toBeUndefined();
            expect(b.aggregate).toBeUndefined();
        });

        it('keeps facet-of when bound-to is absent but source/aggregate are present', () => {
            const el = document.createElement('div');
            el.setAttribute('data-ezclassify-facet-of', 'two');
            el.setAttribute('data-ezclassify-source', 'three');
            root.appendChild(el);

            const onBehavior = vi.fn();
            scanElements(root, null, onBehavior, vi.fn());
            const b = onBehavior.mock.calls[0][1] as BehaviorBinding;

            expect(b.facetOf).toBe('two');
            expect(b.source).toBeUndefined();
        });

        it('does not warn when only one axis attribute is present', () => {
            const el = document.createElement('div');
            el.setAttribute('data-ezclassify-bound-to', 'only');
            root.appendChild(el);

            scanElements(root, null, vi.fn(), vi.fn());
            expect(warnSpy).not.toHaveBeenCalled();
        });

        it('warns at most once per element across repeated scans', () => {
            const el = document.createElement('div');
            el.setAttribute('data-ezclassify-bound-to', 'a');
            el.setAttribute('data-ezclassify-source', 'b');
            root.appendChild(el);

            scanElements(root, null, vi.fn(), vi.fn());
            scanElements(root, null, vi.fn(), vi.fn());
            scanElements(root, null, vi.fn(), vi.fn());

            expect(warnSpy).toHaveBeenCalledTimes(1);
        });

        it('warns separately for each offending element', () => {
            const a = document.createElement('div');
            a.setAttribute('data-ezclassify-bound-to', 'a');
            a.setAttribute('data-ezclassify-source', 'b');
            const b = document.createElement('div');
            b.setAttribute('data-ezclassify-bound-to', 'c');
            b.setAttribute('data-ezclassify-aggregate', '');
            root.appendChild(a);
            root.appendChild(b);

            scanElements(root, null, vi.fn(), vi.fn());
            expect(warnSpy).toHaveBeenCalledTimes(2);
        });
    });

    describe('framework two-way binding on an ezclassify-managed element', () => {
        // setAttribute() applies XML Name validation and rejects `[`, `]`, `(`,
        // `)`. The HTML parser is permissive, so we use innerHTML to seed the
        // exact attribute shapes Angular templates emit.
        it('warns when [(ngModel)] is on a bound element', () => {
            root.innerHTML =
                '<input data-ezclassify-bound-to="m" [(ngModel)]="value">';

            scanElements(root, null, vi.fn(), vi.fn());
            expect(warnSpy).toHaveBeenCalledTimes(1);
            expect(warnSpy.mock.calls[0][0]).toMatch(/framework two-way/);
            expect(warnSpy.mock.calls[0][0]).toMatch(/ngModel/);
        });

        it('warns when [ngModel] is paired with (ngModelChange) on a bound element', () => {
            root.innerHTML =
                '<input data-ezclassify-bind [ngModel]="value" (ngModelChange)="onChange($event)">';

            scanElements(root, null, vi.fn(), vi.fn());
            expect(warnSpy).toHaveBeenCalledTimes(1);
            expect(warnSpy.mock.calls[0][0]).toMatch(/ngModel.*ngModelChange/);
        });

        it('does not warn when [ngModel] is present alone (one-way Angular)', () => {
            root.innerHTML = '<input data-ezclassify-bind [ngModel]="value">';

            scanElements(root, null, vi.fn(), vi.fn());
            expect(warnSpy).not.toHaveBeenCalled();
        });

        it('warns when v-model is on a bound element', () => {
            const el = document.createElement('input');
            el.setAttribute('data-ezclassify-bound-to', 'm');
            el.setAttribute('v-model', 'value');
            root.appendChild(el);

            scanElements(root, null, vi.fn(), vi.fn());
            expect(warnSpy).toHaveBeenCalledTimes(1);
            expect(warnSpy.mock.calls[0][0]).toMatch(/v-model/);
        });

        it('warns when a v-model variant with a modifier is present', () => {
            const el = document.createElement('input');
            el.setAttribute('data-ezclassify-bound-to', 'm');
            el.setAttribute('v-model.lazy', 'value');
            root.appendChild(el);

            scanElements(root, null, vi.fn(), vi.fn());
            expect(warnSpy).toHaveBeenCalledTimes(1);
            expect(warnSpy.mock.calls[0][0]).toMatch(/v-model/);
        });

        it('warns at most once per element across repeated scans', () => {
            const el = document.createElement('input');
            el.setAttribute('data-ezclassify-bound-to', 'm');
            el.setAttribute('v-model', 'value');
            root.appendChild(el);

            scanElements(root, null, vi.fn(), vi.fn());
            scanElements(root, null, vi.fn(), vi.fn());
            scanElements(root, null, vi.fn(), vi.fn());

            expect(warnSpy).toHaveBeenCalledTimes(1);
        });

        it('does not warn on a plain ezclassify-bound element without framework attrs', () => {
            const el = document.createElement('input');
            el.setAttribute('data-ezclassify-bound-to', 'm');
            root.appendChild(el);

            scanElements(root, null, vi.fn(), vi.fn());
            expect(warnSpy).not.toHaveBeenCalled();
        });
    });

    it('a single offending element fires BOTH warnings independently', () => {
        const el = document.createElement('input');
        el.setAttribute('data-ezclassify-bound-to', 'm1');
        el.setAttribute('data-ezclassify-source', 'm2');
        el.setAttribute('v-model', 'value');
        root.appendChild(el);

        scanElements(root, null, vi.fn(), vi.fn());
        expect(warnSpy).toHaveBeenCalledTimes(2);
        const messages = warnSpy.mock.calls.map(
            (c: unknown[]) => c[0] as string,
        );
        expect(
            messages.some((m: string) => /binding axis attributes/.test(m)),
        ).toBe(true);
        expect(messages.some((m: string) => /framework two-way/.test(m))).toBe(
            true,
        );
    });
});
