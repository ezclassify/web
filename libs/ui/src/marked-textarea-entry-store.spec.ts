import { textareaEditor } from '../test-fixtures/textarea-editor';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EzClassifyUI } from './ezclassify-ui';
import { markingTarget, markingEntry } from './components/marking-target';
import { VanillaEzClassifyStore } from './store/ezclassify-store';
import { contextStoreBuckets } from './context-binding';
import type { FavoritesConfig } from './components/favorites-panel';
import { loadMultiScopeRegression } from '../test-fixtures/load-multi-scope-regression';
import type { MarkedTextArea } from './components/marked-text-area';
import type { Assertion } from '@ezclassify/types';
import { asContext } from '../test-fixtures/as-context';
import { demoRuntimeSettled } from '../../../test-support/demo-runtime';
import { press, typeText } from './components/composer/composer-harness';

let ui: EzClassifyUI | undefined;
afterEach(() => {
    ui?.destroy();
    document.body.innerHTML = '';
});
async function flush() {
    await demoRuntimeSettled();
    await new Promise((resolve) => setTimeout(resolve, 30));
}
async function mount(
    text = '(SA) First body.\n(DC) Second body.  ',
    configure?: (
        engine: Awaited<ReturnType<typeof loadMultiScopeRegression>>,
    ) => void,
    custom?: {
        store?: (
            context: ReturnType<typeof asContext>,
        ) => VanillaEzClassifyStore;
        favorites?: FavoritesConfig;
    },
) {
    document.body.innerHTML =
        '<div id="root"><input id="document" type="hidden" data-ezclassify-marking><textarea id="body" data-ezclassify-controller="marked-textarea" data-ezclassify-bound-to="document"></textarea></div>';
    const textarea = document.querySelector('textarea')!;
    textarea.value = text;
    const engine = await loadMultiScopeRegression();
    configure?.(engine);
    const context = asContext(engine);
    ui = new EzClassifyUI(context, {
        root: document.querySelector<HTMLElement>('#root')!,
        store: custom?.store?.(context),
        favorites: custom?.favorites,
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
    const openDraft = async (
        textarea: HTMLTextAreaElement,
        selection = false,
    ) => {
        textarea.focus();
        const start = selection
            ? textarea.value.indexOf('First body.')
            : textarea.value.length;
        textareaEditor(textarea).setSelectionRange(
            start,
            selection ? start + 'First'.length : start,
        );
        press(textareaEditor(textarea), 'Enter', { ctrlKey: true });
        await flush();
        const editor = document.querySelector<HTMLInputElement>(
            '.inline-editor-input',
        )!;
        expect(editor).not.toBeNull();
        return editor;
    };
    const cancelDraft = async (editor: HTMLInputElement) => {
        for (let attempt = 0; attempt < 3 && editor.isConnected; attempt++) {
            press(editor, 'Escape');
            await flush();
        }
        expect(editor.isConnected).toBe(false);
        await flush();
    };

    it.each(['add', 'selection'])(
        'restores committed entry identity, spans and captured facts after %s cancellation',
        async (action) => {
            const { textarea, component, store } = await mount();
            const ids = store.getEntryIds!('document')!;
            const captured: Assertion = {
                categoryId: 'marked_by',
                conceptId: 'MARKED_BY_TEXT',
                value: 'Office | A :: B',
                confidence: 'certain',
                source: 'user',
            };
            await store.publishAssertions(
                ids[0]!,
                [...store.get(ids[0]!).assertions, captured],
                undefined,
                { categories: ['marked_by'] },
            );
            await flush();
            const body = textarea.value;
            const portions = component.getCommittedPortions();
            const states = ids.map((id) => store.get(id).assertions);
            const declarations = ids.map((id) => document.getElementById(id));
            const editor = await openDraft(textarea, action === 'selection');
            await cancelDraft(editor);
            expect(textarea.value).toBe(body);
            expect(component.getCommittedPortions()).toEqual(portions);
            expect(component.getEntryIds()).toEqual(ids);
            expect(store.getEntryIds!('document')).toEqual(ids);
            expect(ids.map((id) => store.get(id).assertions)).toEqual(states);
            expect(ids.map((id) => document.getElementById(id))).toEqual(
                declarations,
            );
        },
    );

    it('reflects newer store facts after cancellation without publishing the canceled draft', async () => {
        const { textarea, component, store } = await mount();
        const ids = store.getEntryIds!('document')!;
        const editor = await openDraft(textarea);
        await store.publishAssertions(ids[1]!, [student]);
        await flush();
        await cancelDraft(editor);
        await flush();
        expect(store.getEntryIds!('document')).toEqual(ids);
        expect(component.getEntryIds()).toEqual(ids);
        expect(store.get(ids[1]!).assertions).toContainEqual(student);
        expect(component.getSegments()[1]!.assertions).toContainEqual(student);
        expect(textarea.value).toBe('(SA) First body.\n(ST) Second body.  ');
    });

    it('reflects newer entry membership after cancellation without restoring old membership', async () => {
        const { textarea, component, store } = await mount();
        const ids = store.getEntryIds!('document')!;
        const editor = await openDraft(textarea);
        const reversed = [ids[1]!, ids[0]!];
        store.setEntryIds!('document', reversed);
        await flush();
        await cancelDraft(editor);
        await flush();
        expect(store.getEntryIds!('document')).toEqual(reversed);
        expect(component.getEntryIds()).toEqual(reversed);
        expect(textarea.value).toBe('(DC) Second body.  \n(SA) First body.\n');
    });

    it('reflects a newer sibling entry after Done closes an unchanged phone editor', async () => {
        const matchMedia = window.matchMedia;
        const width = window.innerWidth;
        window.matchMedia = ((query: string) => ({
            matches: query.includes('coarse'),
            media: query,
            onchange: null,
            addEventListener() {},
            removeEventListener() {},
            addListener() {},
            removeListener() {},
            dispatchEvent: () => true,
        })) as typeof window.matchMedia;
        Object.defineProperty(window, 'innerWidth', {
            configurable: true,
            value: 390,
        });
        try {
            const { textarea, component, store } = await mount();
            const ids = store.getEntryIds!('document')!;
            textarea.focus();
            textareaEditor(textarea).setSelectionRange(1, 1);
            press(textareaEditor(textarea), 'Enter', { ctrlKey: true });
            await flush();
            const done = document.querySelector<HTMLButtonElement>(
                '.ez-composer__sheet-done',
            )!;
            expect(done).not.toBeNull();
            await store.publishAssertions(ids[1]!, [student]);
            await flush();
            done.click();
            await flush();
            await flush();
            expect(document.querySelector('.inline-editor-input')).toBeNull();
            expect(store.getEntryIds!('document')).toEqual(ids);
            expect(component.getEntryIds()).toEqual(ids);
            expect(store.get(ids[1]!).assertions).toContainEqual(student);
            expect(component.getSegments()[1]!.assertions).toContainEqual(
                student,
            );
            expect(textarea.value).toBe(
                '(SA) First body.\n(ST) Second body.  ',
            );
        } finally {
            window.matchMedia = matchMedia;
            Object.defineProperty(window, 'innerWidth', {
                configurable: true,
                value: width,
            });
        }
    });

    it('commits an added marking as a new entry while retaining the earlier entry identities', async () => {
        const { textarea, component, store } = await mount();
        const ids = store.getEntryIds!('document')!;
        const editor = await openDraft(textarea);
        typeText(editor, 'ST');
        await flush();
        const outside = document.createElement('button');
        document.body.append(outside);
        outside.focus();
        await flush();
        await flush();
        outside.remove();
        expect(document.querySelector('.inline-editor-input')).toBeNull();
        const committed = store.getEntryIds!('document')!;
        expect(committed).toHaveLength(3);
        expect(committed.slice(0, 2)).toEqual(ids);
        expect(component.getEntryIds()).toEqual(committed);
        expect(store.get(committed[2]!).assertions).toContainEqual(
            expect.objectContaining({
                categoryId: student.categoryId,
                conceptId: student.conceptId,
            }),
        );
    });

    it('keeps the marking an entry holds when the engine cannot write its new facts', async () => {
        const { textarea, store } = await mount(undefined, (engine) => {
            const render = engine.render.bind(engine);
            engine.render = ((assertions: Assertion[], ...rest: unknown[]) =>
                assertions.some((a) => a.conceptId === 'STUDENTS')
                    ? {
                          rendered:
                              '[unrepresentable:ambiguous-representation]',
                          assessment: {
                              emitted: [],
                              omitted: [],
                              collapsed: [],
                              conflicts: [],
                              unrepresentable: [
                                  {
                                      output: 'portion',
                                      reason: 'ambiguous-representation',
                                  },
                              ],
                          },
                      }
                    : Reflect.apply(render, engine, [
                          assertions,
                          ...rest,
                      ])) as typeof engine.render;
        });
        const held = textarea.value;
        const ids = store.getEntryIds!('document')!;

        await store.publishAssertions(ids[1]!, [student]);
        await flush();

        expect(textarea.value).toBe(held);
    });

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
    it('keeps implicit native reentry out of an external entry render until its source is current', async () => {
        const { textarea, component, store } = await mount();
        const ids = store.getEntryIds!('document')!;
        const sibling = structuredClone(store.get(ids[1]!));
        const source = ui!.engine;
        const render = source.render.bind(source);
        const releases: (() => void)[] = [];
        let holding = true;
        vi.spyOn(source, 'render').mockImplementation(((
            ...args: Parameters<typeof render>
        ) => {
            const result = Reflect.apply(render, source, args);
            if (
                holding &&
                args[1] === source.getSchemeMeta().defaultPartRenderFormat &&
                args[0].some((fact) => fact.conceptId === 'STUDENTS')
            )
                return new Promise((resolve) => {
                    releases.push(() => resolve(result));
                });
            return result;
        }) as typeof render);
        await store.publishAssertions(ids[0]!, [student]);
        await flush();
        expect(releases.length).toBeGreaterThan(0);
        try {
            textarea.focus();
            textareaEditor(textarea).setSelectionRange(2, 2);
            document.dispatchEvent(new Event('selectionchange'));
            await flush();
            const reopened = document.querySelector('.inline-editor-input');
            holding = false;
            for (const release of releases) release();
            await flush();
            await flush();
            expect(reopened).toBeNull();
            expect(textarea.value).toBe(
                '(ST) First body.\n(DC) Second body.  ',
            );
            expect(component.getEntryIds()).toEqual(ids);
            expect(store.get(ids[1]!)).toEqual(sibling);
            expect(document.activeElement).toBe(textareaEditor(textarea));
        } finally {
            holding = false;
            for (const release of releases) release();
        }
    });

    it('settles an unchanged Favorite even when the store emits no notification', async () => {
        const { textarea, component, store } = await mount();
        const ids = store.getEntryIds!('document')!;
        const before = textarea.value;
        textarea.focus();
        textareaEditor(textarea).setSelectionRange(2, 2);
        document.dispatchEvent(new Event('selectionchange'));
        await flush();
        vi.spyOn(store, 'publishRendered').mockResolvedValueOnce(undefined);
        await markingTarget(component)!.onApply(
            store.get(ids[0]!).rendered,
            new AbortController().signal,
        );
        expect(textarea.value).toBe(before);
        expect(component.getEntryIds()).toEqual(ids);
        const clock = vi
            .spyOn(performance, 'now')
            .mockReturnValue(performance.now() + 1000);
        try {
            textarea.focus();
            const pos = textarea.value.indexOf('(DC)') + 2;
            textareaEditor(textarea).setSelectionRange(pos, pos);
            document.dispatchEvent(new Event('selectionchange'));
            await flush();
            expect(
                document.querySelector<HTMLInputElement>('.inline-editor-input')
                    ?.value,
            ).toBe('DC');
        } finally {
            clock.mockRestore();
        }
    });

    it('releases a rejected publication without moving outside focus or retaining the old apply guard', async () => {
        const { textarea, component, store } = await mount();
        const before = textarea.value;
        textarea.focus();
        textareaEditor(textarea).setSelectionRange(2, 2);
        document.dispatchEvent(new Event('selectionchange'));
        await flush();
        vi.spyOn(store, 'publishRendered').mockRejectedValueOnce(
            new Error('Publish refused'),
        );
        const applying = markingTarget(component)!.onApply(
            'ST',
            new AbortController().signal,
        );
        const outside = document.createElement('button');
        document.body.append(outside);
        outside.focus();
        await expect(applying).rejects.toThrow('Publish refused');
        expect(document.activeElement).toBe(outside);
        expect(textarea.value).toBe(before);
        const clock = vi
            .spyOn(performance, 'now')
            .mockReturnValue(performance.now() + 1000);
        try {
            textarea.focus();
            textareaEditor(textarea).setSelectionRange(2, 2);
            document.dispatchEvent(new Event('selectionchange'));
            await flush();
            expect(
                document.querySelector('.inline-editor-input'),
            ).not.toBeNull();
        } finally {
            clock.mockRestore();
            outside.remove();
        }
    });

    it('keeps a newer apply owned when the older publication disposer finishes', async () => {
        const { textarea, component } = await mount();
        const before = textarea.value;
        textarea.focus();
        textareaEditor(textarea).setSelectionRange(2, 2);
        document.dispatchEvent(new Event('selectionchange'));
        await flush();
        const older = markingEntry(component)!.prepareApply();
        expect(older).toBeTypeOf('function');
        textarea.focus();
        const second = textarea.value.indexOf('(DC)') + 2;
        textareaEditor(textarea).setSelectionRange(second, second);
        press(textareaEditor(textarea), 'Enter', { ctrlKey: true });
        await flush();
        expect(document.querySelector('.inline-editor-input')).not.toBeNull();
        const newer = markingEntry(component)!.prepareApply();
        const clock = vi
            .spyOn(performance, 'now')
            .mockReturnValue(performance.now() + 1000);
        try {
            if (typeof older === 'function') older();
            textarea.focus();
            textareaEditor(textarea).setSelectionRange(2, 2);
            document.dispatchEvent(new Event('selectionchange'));
            await flush();
            expect(document.querySelector('.inline-editor-input')).toBeNull();
            if (typeof newer === 'function') newer();
            document.dispatchEvent(new Event('selectionchange'));
            await flush();
            expect(
                document.querySelector('.inline-editor-input'),
            ).not.toBeNull();
            expect(textarea.value).toBe(before);
        } finally {
            if (typeof newer === 'function') newer();
            clock.mockRestore();
        }
    });

    it.each(['owned', 'outside', 'escape', 'repeat', 'new-session'] as const)(
        'keeps the actual Tools focus handoff through delayed Favorite apply (%s)',
        async (exit) => {
            let delayed = false;
            const deliveries: (() => void)[] = [];
            const releases: Array<() => Promise<void>> = [];
            const publishedIds: string[] = [];
            const { textarea, component, store } = await mount(
                undefined,
                undefined,
                {
                    favorites: {
                        load: () => [{ marking: 'ST', label: 'Students' }],
                    },
                    store: (context) => {
                        const bound = new VanillaEzClassifyStore({
                            buckets: contextStoreBuckets(context),
                        });
                        const subscribe = bound.subscribe.bind(bound);
                        vi.spyOn(bound, 'subscribe').mockImplementation(
                            (id, listener, source) =>
                                subscribe(
                                    id,
                                    (state) => {
                                        const delivery = () =>
                                            listener(structuredClone(state));
                                        if (delayed) deliveries.push(delivery);
                                        else delivery();
                                    },
                                    source,
                                ),
                        );
                        const get = bound.get.bind(bound);
                        vi.spyOn(bound, 'get').mockImplementation((id) =>
                            structuredClone(get(id)),
                        );
                        const publish = bound.publishRendered.bind(bound);
                        vi.spyOn(bound, 'publishRendered').mockImplementation(
                            (...args) => {
                                publishedIds.push(args[0]);
                                return new Promise<void>((resolve, reject) => {
                                    let running: Promise<void> | undefined;
                                    releases.push(
                                        () =>
                                            (running ??= Promise.resolve()
                                                .then(() => publish(...args))
                                                .then(resolve, (error) => {
                                                    reject(error);
                                                    throw error;
                                                })),
                                    );
                                });
                            },
                        );
                        return bound;
                    },
                },
            );
            const ids = store.getEntryIds!('document')!;
            const before = textarea.value;
            const sibling = structuredClone(store.get(ids[1]!));
            textarea.focus();
            textareaEditor(textarea).setSelectionRange(2, 2);
            document.dispatchEvent(new Event('selectionchange'));
            await flush();
            const brand = document.querySelector<HTMLButtonElement>(
                '.ez-status-mark--tools',
            )!;
            brand.click();
            await flush();
            document
                .querySelector<HTMLElement>(
                    '[role="tab"][aria-label="Favorites"]',
                )!
                .click();
            await flush();
            const favorite = document.querySelector<HTMLElement>(
                '[data-favorite-marking="ST"]',
            )!;
            expect(favorite).not.toBeNull();
            const selector = document.querySelector<HTMLButtonElement>(
                '.ez-marking-tools__target',
            )!;
            expect(selector).not.toBeNull();
            favorite.focus();
            delayed = true;
            const outside = document.createElement('button');
            document.body.append(outside);
            const clock = vi
                .spyOn(performance, 'now')
                .mockReturnValue(performance.now() + 1000);
            try {
                favorite.click();
                expect(selector.getAttribute('aria-disabled')).toBe('true');
                selector.click();
                expect(selector.getAttribute('aria-expanded')).toBe('false');
                expect(releases).toHaveLength(1);
                expect(publishedIds).toEqual([ids[0]]);
                expect(favorite.isConnected).toBe(true);
                expect(document.activeElement).toBe(favorite);
                if (exit === 'repeat') {
                    favorite.click();
                    expect(releases).toHaveLength(2);
                    expect(publishedIds).toEqual([ids[0], ids[0]]);
                }
                await component.applyEntryStates(
                    ids.map((entryId) => ({
                        entryId,
                        state: store.get(entryId),
                    })),
                );
                expect(favorite.isConnected).toBe(true);
                expect(document.activeElement).toBe(favorite);
                if (exit === 'outside') outside.focus();
                else if (exit === 'escape') press(favorite, 'Escape');
                else if (exit === 'new-session') {
                    press(favorite, 'Escape');
                    textarea.focus();
                    textareaEditor(textarea).setSelectionRange(
                        textarea.value.length,
                        textarea.value.length,
                    );
                    document.dispatchEvent(new Event('selectionchange'));
                    brand.click();
                    await flush();
                    document
                        .querySelector<HTMLElement>(
                            '[role="tab"][aria-label="Favorites"]',
                        )!
                        .click();
                    await flush();
                    const insertion = document.querySelector<HTMLElement>(
                        '[data-favorite-marking="ST"]',
                    )!;
                    insertion.focus();
                    insertion.click();
                    expect(publishedIds).toEqual([ids[0]]);
                    expect(releases).toHaveLength(1);
                }
                await flush();
                const focusAfterApply =
                    exit === 'outside'
                        ? outside
                        : exit === 'escape'
                          ? brand
                          : textareaEditor(textarea);
                expect(
                    document.querySelector('.inline-editor-input'),
                ).toBeNull();
                expect(store.get(ids[0]!).rendered).not.toBe('STUDENTS');
                for (const release of releases) await release();
                await flush();
                await flush();
                expect(document.activeElement).toBe(focusAfterApply);
                expect(textarea.value).toBe(
                    '(ST) First body.\n(DC) Second body.  ' +
                        (exit === 'new-session' ? '\n(ST)' : ''),
                );
                expect(store.get(ids[0]!).assertions).toContainEqual({
                    ...student,
                    source: 'parse',
                });
                expect(store.get(ids[1]!)).toEqual(sibling);
                const expectedIds = component.getEntryIds();
                expect(expectedIds.slice(0, 2)).toEqual(ids);
                expect(expectedIds).toHaveLength(
                    exit === 'new-session' ? 3 : 2,
                );
                expect(store.getEntryIds!('document')).toEqual(expectedIds);
                expect(deliveries.length).toBeGreaterThan(0);
                for (const delivery of deliveries.splice(0)) delivery();
                await flush();
                document.dispatchEvent(new Event('selectionchange'));
                await flush();
                expect(
                    document.querySelector('.inline-editor-input'),
                ).toBeNull();
                expect(textarea.value).not.toBe(before);
                expect(document.activeElement).toBe(focusAfterApply);
            } finally {
                delayed = false;
                for (const release of releases)
                    await release().catch(() => undefined);
                for (const delivery of deliveries.splice(0)) delivery();
                clock.mockRestore();
                outside.remove();
            }
        },
    );

    it.each([false, true])(
        'does not reopen a discarded caret editor while a Favorite entry projection is pending (overlap=%s)',
        async (overlap) => {
            const { textarea, component, store } = await mount();
            const ids = store.getEntryIds!('document')!;
            const captured: Assertion = {
                categoryId: 'marked_by',
                conceptId: 'MARKED_BY_TEXT',
                value: 'Office | A :: B',
                confidence: 'certain',
                source: 'user',
            };
            await store.publishAssertions(
                ids[1]!,
                [...store.get(ids[1]!).assertions, captured],
                undefined,
                { categories: ['marked_by'] },
            );
            await flush();
            const sibling = structuredClone(store.get(ids[1]!));
            const original = textarea.value;
            textarea.focus();
            textareaEditor(textarea).setSelectionRange(2, 2);
            document.dispatchEvent(new Event('selectionchange'));
            await flush();
            expect(
                document.querySelector('.inline-editor-input'),
            ).not.toBeNull();
            const source = ui!.engine;
            const render = source.render.bind(source);
            const releases: (() => void)[] = [];
            let holding = true;
            vi.spyOn(source, 'render').mockImplementation(((
                ...args: Parameters<typeof render>
            ) => {
                const result = Reflect.apply(render, source, args);
                if (
                    holding &&
                    args[1] ===
                        source.getSchemeMeta().defaultPartRenderFormat &&
                    args[0].some((fact) => fact.conceptId === 'STUDENTS')
                )
                    return new Promise((resolve) => {
                        releases.push(() => resolve(result));
                    });
                return result;
            }) as typeof render);
            let clock: ReturnType<typeof vi.spyOn> | undefined;
            try {
                const applying = Promise.resolve(
                    markingTarget(component)!.onApply(
                        'ST',
                        new AbortController().signal,
                    ),
                );
                await flush();
                expect(releases).toHaveLength(1);
                expect(store.get(ids[0]!).assertions).toContainEqual({
                    ...student,
                    source: 'parse',
                });
                expect(textarea.value).toBe(original);
                let newer: Promise<boolean> | undefined;
                if (overlap) {
                    newer = component.applyEntryStates(
                        ids.map((entryId) => ({
                            entryId,
                            state: store.get(entryId),
                        })),
                    );
                    await flush();
                    expect(releases).toHaveLength(2);
                    releases[0]!();
                    await flush();
                }
                clock = vi
                    .spyOn(performance, 'now')
                    .mockReturnValue(performance.now() + 1000);
                textarea.focus();
                textareaEditor(textarea).setSelectionRange(2, 2);
                document.dispatchEvent(new Event('selectionchange'));
                await flush();
                const reopened = document.querySelector('.inline-editor-input');
                const focusWhilePending = document.activeElement;
                holding = false;
                for (const release of releases) release();
                if (newer) await newer;
                await applying;
                await flush();
                await flush();
                expect(reopened).toBeNull();
                expect(focusWhilePending).toBe(textareaEditor(textarea));
                expect(textarea.value).toBe(
                    '(ST) First body.\n(DC) Second body.  ',
                );
                expect(component.getEntryIds()).toEqual(ids);
                expect(store.getEntryIds!('document')).toEqual(ids);
                expect(store.get(ids[1]!)).toEqual(sibling);
                expect(store.get(ids[0]!).assertions).toContainEqual({
                    ...student,
                    source: 'parse',
                });
                document.dispatchEvent(new Event('selectionchange'));
                await flush();
                expect(document.activeElement).toBe(textareaEditor(textarea));
                expect(
                    document.querySelector('.inline-editor-input'),
                ).toBeNull();
            } finally {
                for (const release of releases) release();
                clock?.mockRestore();
            }
        },
    );

    it('releases automatic caret entry after a store projection fails without reclaiming outside focus', async () => {
        const { textarea, component, store } = await mount();
        const ids = store.getEntryIds!('document')!;
        const source = ui!.engine;
        const render = source.render.bind(source);
        let reject!: (error: Error) => void;
        vi.spyOn(source, 'render').mockImplementation(((
            ...args: Parameters<typeof render>
        ) => {
            if (
                args[1] === source.getSchemeMeta().defaultPartRenderFormat &&
                args[0].some((fact) => fact.conceptId === 'STUDENTS')
            )
                return new Promise((_resolve, fail) => {
                    reject = fail;
                });
            return Reflect.apply(render, source, args);
        }) as typeof render);
        const errors: unknown[] = [];
        textarea.addEventListener('ezclassify:entry-error', (event) =>
            errors.push(event),
        );
        await store.publishAssertions(ids[0]!, [student]);
        await flush();
        const outside = document.createElement('button');
        document.body.append(outside);
        outside.focus();
        reject(new Error('Rendering unavailable'));
        await flush();
        expect(document.activeElement).toBe(outside);
        expect(errors).toHaveLength(1);
        expect(component.getEntryIds()).toEqual(ids);
        textarea.focus();
        textareaEditor(textarea).setSelectionRange(2, 2);
        document.dispatchEvent(new Event('selectionchange'));
        await flush();
        expect(document.activeElement).toBe(
            document.querySelector('.inline-editor-input'),
        );
        outside.remove();
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
                vi.spyOn(engine, 'process').mockImplementation((async (
                    ...args: Parameters<typeof original>
                ) => {
                    const result = await original(...args);
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
    async function render(
        root: HTMLElement,
        refuse?: (method: string, args: unknown[]) => boolean,
    ) {
        ui = new EzClassifyUI(
            asContext(overTheWire(await loadMultiScopeRegression(), refuse)),
            {
                root,
            },
        );
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
        await render(root);
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
        await render(root);
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
        await render(root, (method, args) => {
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
