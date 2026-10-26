import { afterEach, describe, expect, it, vi } from 'vitest';
import { EzClassifyUI } from './ezclassify-ui';
import { loadMultiScopeRegression } from '../test-fixtures/load-multi-scope-regression';
import type { MarkedTextArea } from './components/marked-text-area';
import type { Assertion } from '@ezclassify/types';

let ui: EzClassifyUI | undefined;
afterEach(() => {
    ui?.destroy();
    document.body.innerHTML = '';
});
async function flush() {
    for (let i = 0; i < 20; i++) await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 30));
}
async function mount(
    text = '(SA) First body.\n(DC) Second body.  ',
    configure?: (engine: ReturnType<typeof loadMultiScopeRegression>) => void,
) {
    document.body.innerHTML =
        '<div id="root"><input id="document" type="hidden" data-ezclassify-rendered><textarea id="body" data-ezclassify-controller="marked-textarea" data-ezclassify-bound-to="document"></textarea></div>';
    const textarea = document.querySelector('textarea')!;
    textarea.value = text;
    const engine = loadMultiScopeRegression();
    configure?.(engine);
    ui = new EzClassifyUI(engine, {
        root: document.querySelector<HTMLElement>('#root')!,
    });
    await flush();
    return {
        textarea,
        component: ui.components.get(textarea) as MarkedTextArea,
        store: ui.store,
    };
}
const student: Assertion = {
    categoryId: 'level',
    conceptId: 'STUDENTS',
    confidence: 'certain',
    source: 'user',
};

describe('MarkedTextArea two-way entry bindings', () => {
    it('edits one stable store entry without replacing either body', async () => {
        const { textarea, component, store } = await mount();
        const ids = store.getEntryIds!('document')!;
        expect(ids).toHaveLength(2);
        await store.publishAssertions(ids[1]!, [student]);
        await flush();
        expect(textarea.value).toBe('(SA) First body.\n(ST) Second body.  ');
        expect(component.getEntryIds()).toEqual(ids);
        expect(component.getSegments()[1]?.assertions).toContainEqual(
            expect.objectContaining(student),
        );
    });
    it('keeps unmarked prose on removal, addition and an explicit empty collection', async () => {
        const { textarea, store } = await mount();
        const ids = store.getEntryIds!('document')!;
        store.setEntryIds!('document', [ids[1]!]);
        await flush();
        expect(textarea.value).toBe(' First body.\n(DC) Second body.  ');
        await store.publishAssertions('added-entry', [student]);
        store.setEntryIds!('document', [ids[1]!, 'added-entry']);
        await flush();
        expect(textarea.value).toBe(' First body.\n(DC) Second body.  \n(ST)');
        store.setEntryIds!('document', []);
        await flush();
        expect(textarea.value).toBe(' First body.\n Second body.  \n');
    });
    it('preserves an ambiguous multi-entry parent update and exposes the conflict', async () => {
        const { textarea, store } = await mount();
        const original = textarea.value;
        await store.publishAssertions('document', [student]);
        await flush();
        expect(textarea.value).toBe(original);
        expect(textarea.getAttribute('data-ezclassify-entry-conflict')).toBe(
            'ambiguous-parent',
        );
    });
    it('keeps body-only edits and entry identity across later store changes', async () => {
        const { textarea, store } = await mount();
        const ids = store.getEntryIds!('document')!;
        textarea.value = textarea.value.replace(
            'Second body.',
            'Changed body.',
        );
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
        await new Promise((resolve) => setTimeout(resolve, 350));
        await flush();
        expect(store.getEntryIds!('document')).toEqual(ids);
        await store.publishAssertions(ids[1]!, [student]);
        await flush();
        expect(textarea.value).toBe('(SA) First body.\n(ST) Changed body.  ');
    });
    it('retains captured alternate-scope facts and provenance through a body edit', async () => {
        const { textarea, component, store } = await mount();
        const id = store.getEntryIds!('document')![0]!;
        const capture: Assertion = {
            categoryId: 'marked_by',
            conceptId: 'MARKED_BY_TEXT',
            value: 'Office | A :: B',
            confidence: 'certain',
            source: 'user',
        };
        await store.publishAssertions(
            id,
            [...store.get(id).assertions, capture],
            undefined,
            { categories: ['marked_by'] },
        );
        await flush();
        expect(component.getSegments()[0]!.assertions).toContainEqual(capture);
        textarea.value = textarea.value.replace(
            'First body.',
            'First edited body.',
        );
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
        await new Promise((resolve) => setTimeout(resolve, 350));
        await flush();
        expect(store.get(id).assertions).toContainEqual(capture);
        expect(component.getSegments()[0]!.assertions).toContainEqual(capture);
        expect(textarea.value).toContain('First edited body.');
    });
    it('discards a late rendering after membership removes that entry', async () => {
        const { textarea, store } = await mount();
        const id = store.getEntryIds!('document')![1]!;
        const source = ui!.engine;
        const original = source.render.bind(source);
        let release!: () => void;
        let held = false;
        vi.spyOn(source, 'render').mockImplementation(((
            ...args: Parameters<typeof original>
        ) => {
            if (
                !held &&
                args[0].some((assertion) => assertion.conceptId === 'STUDENTS')
            ) {
                held = true;
                return new Promise((resolve) => {
                    release = () =>
                        resolve(Reflect.apply(original, source, args));
                });
            }
            return Reflect.apply(original, source, args);
        }) as typeof original);
        await store.publishAssertions(id, [student]);
        await flush();
        expect(held).toBe(true);
        store.setEntryIds!('document', []);
        await flush();
        release();
        await flush();
        await flush();
        expect(textarea.value).toBe(' First body.\n Second body.  ');
        expect(store.getEntryIds!('document')).toEqual([]);
    });
    it('keeps an empty entry anchored so a later edit restores only that token', async () => {
        const { textarea, store } = await mount();
        const ids = store.getEntryIds!('document')!;
        await store.publishRendered(ids[1]!, '');
        await flush();
        expect(textarea.value).toBe('(SA) First body.\n Second body.  ');
        expect(store.getEntryIds!('document')).toEqual(ids);
        await store.publishAssertions(ids[1]!, [student]);
        await flush();
        expect(textarea.value).toBe('(SA) First body.\n(ST) Second body.  ');
    });
    it('reorders each explicitly owned marking and body together', async () => {
        const { textarea, store } = await mount();
        const ids = store.getEntryIds!('document')!;
        store.setEntryIds!('document', [ids[1]!, ids[0]!]);
        await flush();
        expect(textarea.value).toBe('(DC) Second body.  \n(SA) First body.\n');
    });
    it('keeps an empty entry anchored through body-only typing', async () => {
        const { textarea, store } = await mount();
        const ids = store.getEntryIds!('document')!;
        await store.publishRendered(ids[1]!, '');
        await flush();
        textarea.value = textarea.value.replace(
            'Second body.',
            'Second edited body.',
        );
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
        await new Promise((resolve) => setTimeout(resolve, 350));
        await flush();
        expect(store.getEntryIds!('document')).toEqual(ids);
        await store.publishAssertions(ids[1]!, [student]);
        await flush();
        expect(textarea.value).toBe(
            '(SA) First body.\n(ST) Second edited body.  ',
        );
    });

    it('retains unrecognized source tokens when recognized entries are removed', async () => {
        const { textarea, store } = await mount(
            '(not a recognized marking) Raw body.\n(SA) Known body.',
        );
        store.setEntryIds!('document', []);
        await flush();
        expect(textarea.value).toBe(
            '(not a recognized marking) Raw body.\n Known body.',
        );
    });
    it('keeps unresolved source protected after an unrelated entry edit', async () => {
        const { textarea, component, store } = await mount(
            '(SA) Raw body.\n(DC) Known body.',
            (engine) => {
                const original = engine.process.bind(engine);
                vi.spyOn(engine, 'process').mockImplementation(((
                    ...args: Parameters<typeof original>
                ) => {
                    const result = original(...args);
                    if (typeof args[0] === 'string' && args[0].includes('SA'))
                        return {
                            ...result,
                            recognition: {
                                ...result.recognition,
                                status: 'partial',
                            },
                        };
                    return result;
                }) as typeof original);
            },
        );
        const ids = store.getEntryIds!('document')!;
        expect(ids).toHaveLength(2);
        expect(component.getSegments()[0]?.preserveSource).toBe(true);
        await store.publishAssertions(ids[1]!, [student]);
        await flush();
        expect(component.getSegments()[0]?.preserveSource).toBe(true);
        store.setEntryIds!('document', [ids[1]!]);
        await flush();
        expect(textarea.value).toBe('(SA) Raw body.\n(ST) Known body.');
        expect(textarea.getAttribute('data-ezclassify-entry-conflict')).toBe(
            'unresolved-source',
        );
    });

    it('accepts an external parent edit while its own aggregate publish is pending', async () => {
        const { textarea, store } = await mount('(SA) Only body.');
        const original = store.publishAssertions.bind(store);
        const aggregate = store.publishAggregate!.bind(store);
        let release!: () => void;
        let held = false;
        vi.spyOn(store, 'publishAggregate').mockImplementation((...args) => {
            const commit = aggregate(...args);
            if (args[0] === 'document' && args[2] && !held) {
                held = true;
                return commit.then(
                    () =>
                        new Promise<void>((resolve) => {
                            release = resolve;
                        }),
                );
            }
            return commit;
        });
        textarea.value = '(ST) Only body.';
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
        await new Promise((resolve) => setTimeout(resolve, 350));
        await flush();
        expect(held).toBe(true);
        await original('document', [
            { ...student, conceptId: 'DISTRICT_COORDINATORS' },
        ]);
        await flush();
        expect(textarea.value).toBe('(DC) Only body.');
        release();
        await flush();
    });
});

/**
 * An engine across a network answers every read asynchronously, so the
 * portions' first commits land one at a time.
 */
function overTheWire<T extends object>(
    engine: T,
    refuse: (method: string, args: unknown[]) => boolean = () => false,
): T {
    const remote = new Set([
        'process',
        'validate',
        'render',
        'scan',
        'aggregate',
        'aggregateAssertions',
        'checkCoverage',
        'suggest',
        'suggestForCategories',
    ]);
    return new Proxy(engine, {
        get(target, key, receiver) {
            const value = Reflect.get(target, key, receiver);
            if (typeof value !== 'function') return value;
            if (!remote.has(String(key))) return value.bind(target);
            return (...args: unknown[]) =>
                new Promise((resolve, reject) =>
                    setTimeout(() => {
                        if (refuse(String(key), args)) {
                            reject(new Error('connection dropped'));
                            return;
                        }
                        try {
                            resolve(Reflect.apply(value, target, args));
                        } catch (error) {
                            reject(error);
                        }
                    }, 5),
                );
        },
    });
}

describe('MarkedTextArea portions of a whole over an asynchronous engine', () => {
    const body = '(SA) First body.\n(DC) Second body.';
    async function settle() {
        for (let i = 0; i < 10; i++) await flush();
    }
    function render(
        root: HTMLElement,
        refuse?: (method: string, args: unknown[]) => boolean,
    ) {
        ui = new EzClassifyUI(overTheWire(loadMultiScopeRegression(), refuse), {
            root,
        });
    }
    function textareaPartOfDocument(): HTMLTextAreaElement {
        const textarea = document.createElement('textarea');
        textarea.id = 'body';
        textarea.setAttribute('data-ezclassify-controller', 'marked-textarea');
        textarea.setAttribute('data-ezclassify-part-of', 'document');
        textarea.value = body;
        return textarea;
    }

    it('keeps every loaded portion mark while the portions commit one at a time', async () => {
        document.body.innerHTML =
            '<div id="root"><input id="document" value="SA" data-ezclassify-controller="marking"></div>';
        const root = document.querySelector<HTMLElement>('#root')!;
        const textarea = textareaPartOfDocument();
        root.appendChild(textarea);
        render(root);
        await settle();
        expect(textarea.value).toBe(body);
        const ids = ui!.store.getEntryIds!('body')!;
        expect(ids).toHaveLength(2);
        expect(ids.map((id) => ui!.store.get(id).rendered)).toEqual([
            'SA',
            'DC',
        ]);
    });

    it('commits the portions of a textarea mounted after the initial sweep', async () => {
        document.body.innerHTML =
            '<div id="root"><input id="document" value="SA" data-ezclassify-controller="marking"></div>';
        const root = document.querySelector<HTMLElement>('#root')!;
        render(root);
        await settle();
        const textarea = textareaPartOfDocument();
        root.appendChild(textarea);
        await settle();
        expect(textarea.value).toBe(body);
        const ids = ui!.store.getEntryIds!('body')!;
        expect(ids.map((id) => ui!.store.get(id).rendered)).toEqual([
            'SA',
            'DC',
        ]);
        expect(ui!.store.getWholeRollup('document').rendered).not.toBe('');
    });

    it('reflects store edits into the body while another portion has never committed', async () => {
        document.body.innerHTML =
            '<div id="root"><input id="document" value="SA" data-ezclassify-controller="marking"></div>';
        const root = document.querySelector<HTMLElement>('#root')!;
        const textarea = textareaPartOfDocument();
        root.appendChild(textarea);
        // Every store read of the second portion fails.
        let refused = false;
        render(root, (method, args) => {
            const [input, options] = args as [
                unknown,
                { context?: unknown } | undefined,
            ];
            if (
                method !== 'process' ||
                !Array.isArray(input) ||
                !options?.context ||
                !input.some(
                    (assertion: { conceptId?: string }) =>
                        assertion.conceptId === 'DISTRICT_COORDINATORS',
                )
            )
                return false;
            refused = true;
            return true;
        });
        await settle();
        expect(refused).toBe(true);
        const ids = ui!.store.getEntryIds!('body')!;
        expect(ui!.store.get(ids[1]!).assertions).toEqual([]);
        await ui!.store.publishAssertions(ids[0]!, [student]);
        await settle();
        expect(textarea.value).toBe('(ST) First body.\n(DC) Second body.');
    });
});
