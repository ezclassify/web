import type { Assertion, ContextSchemeEngineAdapter } from '@ezclassify/types';
import { isMarkingComposing } from './store/base-ezclassify-store';
import {
    assertWritesScopes,
    holdsPart,
    resolveFormatAttr,
    viewOutputOf,
} from './format-resolver';
import { renderViewRefused } from './render-refusal';
import {
    factsInScopes,
    factsOutsideScopes,
    parseScopeList,
    writesCategoryOf,
} from './scopes';
import type {
    EzClassifyState,
    EzClassifyStore,
} from './store/ezclassify-store';

export const DECISION_FLOW_COMBINE = 'data-ezclassify-decisionflow-combine';

export type NativeTextField = HTMLInputElement | HTMLTextAreaElement;

export function isNativeTextField(el: Element): el is NativeTextField {
    return (
        el instanceof HTMLTextAreaElement ||
        (el instanceof HTMLInputElement && el.type === 'text')
    );
}

/**
 * A grouped flow reads its native surfaces and projects one store commit to the
 * form.
 */
export class DecisionFlowForm {
    private readonly fields: Array<{
        native: NativeTextField;
        scope: string;
        format: string;
    }>;
    private readonly categories: ReturnType<
        ContextSchemeEngineAdapter['listCategories']
    >;
    private readonly meta: ReturnType<
        ContextSchemeEngineAdapter['getSchemeMeta']
    >;
    private readSequence = 0;
    private writeSequence = 0;
    private readonly dirty = new Set<NativeTextField>();
    private reading = false;
    private writing = false;
    private ready = false;
    private invalidField?: { native: NativeTextField; message: string };
    private readonly markingId: string;
    private unread = false;
    private disposed = false;
    private reflecting = false;
    private projection?: { state: EzClassifyState; done: Promise<void> };
    private cleanup?: () => void;

    constructor(
        readonly natives: readonly NativeTextField[],
        readonly whole: HTMLInputElement,
        private readonly engine: ContextSchemeEngineAdapter,
        private readonly store: EzClassifyStore,
    ) {
        this.markingId = whole.id;
        this.meta = engine.getSchemeMeta();
        this.categories = engine.listCategories();
        const scopes = new Set<string>();
        this.fields = natives.map((native) => {
            const listed = parseScopeList(
                native.getAttribute('data-ezclassify-scope'),
            );
            const scope = listed[0];
            if (
                listed.length !== 1 ||
                scopes.has(scope) ||
                !this.meta.scopes?.some(({ id }) => id === scope) ||
                native.form !== whole.form ||
                native.getAttribute('data-ezclassify-bound-to') !== whole.id
            )
                throw new Error(
                    'Use one native text field per DecisionFlow scope, each bound to the same hidden whole.',
                );
            scopes.add(scope);
            const format =
                resolveFormatAttr(native) ||
                viewOutputOf(this.meta, [scope], holdsPart(whole));
            assertWritesScopes(
                this.engine,
                this.categories,
                format,
                [scope],
                'DecisionFlow field',
            );
            return { native, scope, format };
        });
    }

    get scopes(): string[] {
        return this.fields.map(({ scope }) => scope);
    }

    connect(
        mount: HTMLElement,
        editPending: () => boolean,
        onCommit: (state: EzClassifyState) => void,
    ): void {
        const originalDisplays = this.natives.map(
            (native) => native.style.display,
        );
        const labels = new Map(
            this.natives.flatMap((native) =>
                Array.from(native.labels ?? [])
                    .filter(
                        (label) =>
                            !label.contains(native) && !label.contains(mount),
                    )
                    .map((label) => [label, label.hidden] as const),
            ),
        );
        const showNative = (show: boolean) => {
            mount.hidden = show;
            this.natives.forEach((native, index) => {
                native.style.display = show ? originalDisplays[index] : 'none';
            });
            for (const [label, hidden] of labels)
                label.hidden = !show || hidden;
        };
        showNative(true);
        const read = (event: Event) => {
            if (this.reflecting) return;
            const changed = this.fields.find(
                ({ native }) => native === event.target,
            );
            if (changed) void this.read([changed]);
        };
        const reset = (event: Event) => {
            queueMicrotask(() => {
                if (!event.defaultPrevented && !this.disposed)
                    void this.syncNative();
            });
        };
        const reveal = () => this.showNative(true);
        for (const { native } of this.fields) {
            native.addEventListener('input', read);
            native.addEventListener('invalid', reveal);
        }
        const submit = (event: Event) => {
            if (
                !this.ready ||
                editPending() ||
                this.reading ||
                this.writing ||
                isMarkingComposing(this.store, this.markingId)
            )
                event.preventDefault();
        };
        const form = this.whole.form;
        form?.addEventListener('reset', reset);
        form?.addEventListener('submit', submit, true);
        const unsubscribe = this.store.subscribe(this.markingId, (state) => {
            if (!this.reading && !this.unread) void this.reflect(state);
        });
        this.showNative = showNative;
        this.onCommit = onCommit;
        this.cleanup = () => {
            unsubscribe();
            for (const { native } of this.fields) {
                native.removeEventListener('input', read);
                native.removeEventListener('invalid', reveal);
            }
            form?.removeEventListener('reset', reset);
            form?.removeEventListener('submit', submit, true);
            this.clearInvalid();
            showNative(true);
            mount.remove();
        };
    }

    private showNative = (_show: boolean): void => {};
    private onCommit = (_state: EzClassifyState): void => {};

    seed(facets?: ReadonlyMap<string, Assertion[]>): Promise<void> {
        return this.read(this.fields, facets ?? new Map());
    }

    syncNative(): Promise<void> {
        return this.read(this.fields);
    }

    private clearInvalid(): void {
        const invalid = this.invalidField;
        if (invalid && invalid.native.validationMessage === invalid.message)
            invalid.native.setCustomValidity('');
        this.invalidField = undefined;
        this.whole.removeAttribute('data-ezclassify-invalid');
    }

    private reject(field: NativeTextField, message: string): void {
        this.clearInvalid();
        this.ready = false;
        if (!field.validity.customError) {
            field.setCustomValidity(message);
            this.invalidField = { native: field, message };
        }
        this.whole.setAttribute('data-ezclassify-invalid', '');
        this.showNative(true);
        if (this.whole.value) {
            this.whole.value = '';
            this.whole.dispatchEvent(new Event('input', { bubbles: true }));
        }
    }

    private async read(
        changed: typeof this.fields,
        initialFacets?: ReadonlyMap<string, Assertion[]>,
    ): Promise<void> {
        if (this.disposed) return;
        for (const { native } of changed) this.dirty.add(native);
        const pending = this.fields.filter(({ native }) =>
            this.dirty.has(native),
        );
        const sequence = ++this.readSequence;
        this.reading = true;
        ++this.writeSequence;
        this.writing = false;
        this.projection = undefined;
        const current = () => !this.disposed && sequence === this.readSequence;
        let fieldInError: NativeTextField | undefined;
        try {
            const states = await Promise.all(
                pending.map(async ({ native, scope, format }) => {
                    if (!native.value) return [];
                    const result = await this.engine.validate(native.value, {
                        surface: scope,
                        outputFormat: format,
                    });
                    if (
                        result.recognition?.status !== 'complete' ||
                        renderViewRefused(result)
                    ) {
                        fieldInError = native;
                        throw new Error(
                            'The runtime could not read this scoped marking.',
                        );
                    }
                    return factsInScopes(
                        result.assertions,
                        this.categories,
                        [scope],
                        this.meta,
                    );
                }),
            );
            if (!current()) return;
            const facts = states.flat();
            const covers = writesCategoryOf(
                pending.map(({ scope }) => scope),
                this.categories,
                this.meta,
            );
            const categoryIds = this.categories
                .map(({ id }) => id)
                .filter(covers);
            if (initialFacets) {
                // Scoped native text owns its categories. Retain any other
                // facts the existing whole can supply, plus opted-in native facets.
                const outside =
                    this.whole.value &&
                    this.meta.scopes?.some(
                        ({ id }) => !this.scopes.includes(id),
                    )
                        ? await this.engine.validate(this.whole.value)
                        : undefined;
                if (!current()) return;
                if (
                    outside &&
                    (outside.recognition?.status !== 'complete' ||
                        renderViewRefused(outside))
                )
                    throw new Error(
                        'The runtime could not read the hidden whole.',
                    );
                const baseline = factsOutsideScopes(
                    outside?.assertions ?? [],
                    facts,
                    this.categories,
                    this.scopes,
                    this.meta,
                )
                    .concat(facts)
                    .filter(({ categoryId }) => !initialFacets.has(categoryId));
                await this.store.seedAssertions(
                    this.markingId,
                    baseline.concat([...initialFacets.values()].flat()),
                );
            } else
                await this.store.publishAssertions(
                    this.markingId,
                    facts,
                    undefined,
                    { categories: categoryIds },
                );
            if (!current()) return;
            this.dirty.clear();
            this.unread = false;
            this.reading = false;
            await this.reflect(this.store.get(this.markingId));
        } catch {
            if (!current()) return;
            this.reading = false;
            this.unread = true;
            this.reject(
                fieldInError ?? pending[0].native,
                'The runtime could not read this scoped marking.',
            );
        }
    }

    private reflect(state: EzClassifyState): Promise<void> {
        if (this.projection?.state === state) return this.projection.done;
        const done = this.write(state);
        this.projection = { state, done };
        return done;
    }

    private async write(state: EzClassifyState): Promise<void> {
        const sequence = ++this.writeSequence;
        this.writing = true;
        const current = () => !this.disposed && sequence === this.writeSequence;
        const write = async (facts: Assertion[], format?: string) => {
            if (!facts.length) return '';
            const result = await this.engine.render(facts, format);
            if (renderViewRefused(result))
                throw new Error('The runtime could not write this marking.');
            return result.rendered;
        };
        try {
            if (
                renderViewRefused(state) ||
                ('recognition' in state &&
                    state.recognition?.status !== 'complete')
            )
                throw new Error('The underlying marking could not be read.');
            const values = await Promise.all([
                write(state.assertions),
                ...this.fields.map(({ scope, format }) =>
                    write(
                        factsInScopes(
                            state.assertions,
                            this.categories,
                            [scope],
                            this.meta,
                        ),
                        format,
                    ),
                ),
            ]);
            if (!current()) return;
            if (
                this.natives.some(
                    (native, index) =>
                        native instanceof HTMLInputElement &&
                        /[\r\n]/.test(values[index + 1]),
                )
            )
                throw new Error(
                    'Use a textarea for a DecisionFlow scope that renders multiple lines.',
                );
            const changed = [
                this.whole,
                ...this.fields.map(({ native }) => native),
            ].filter((native, i) => {
                if (native.value === values[i]) return false;
                native.value = values[i];
                return true;
            });
            this.clearInvalid();
            this.ready = true;
            this.writing = false;
            this.showNative(false);
            this.reflecting = true;
            try {
                for (const native of changed)
                    native.dispatchEvent(new Event('input', { bubbles: true }));
            } finally {
                this.reflecting = false;
            }
            if (current()) this.onCommit(state);
        } catch {
            if (!current()) return;
            this.writing = false;
            this.reject(
                this.natives[0],
                'The runtime could not write this marking.',
            );
        }
    }

    destroy(): void {
        this.disposed = true;
        this.cleanup?.();
    }
}
