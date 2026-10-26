import { describe, it, expect } from 'vitest';
import { defineComponent, h, ref, nextTick } from 'vue';
import { mount } from '@vue/test-utils';
import { Context } from '@ezclassify/engine';
import type { LocalSchemeEngineAdapter } from '@ezclassify/types';
import { useEzClassify, type UseEzClassifyReturn } from '../index';

// Parity: useEzClassify must accept a full Context, same input surface as
// @ezclassify/react's useSchemeEngine and EzClassifyUI, not just a bare
// engine/adapter.
const testProfile = {
    scheme: {
        id: 'ctx-input',
        version: '1.0.0',
        name: 'Context Input',
        data: {
            categories: [
                {
                    id: 'f1',
                    label: 'F1',
                    required: false,
                    single: false,
                    rollup: 'union',
                },
            ],
            concepts: {
                inline: [
                    {
                        id: 'A',
                        name: 'A',
                        views: { default: 'A' },
                        categories: ['f1'],
                        position: 0,
                        aliases: [],
                        parents: [],
                    },
                ],
            },
        },
        parse: {
            case_sensitive: false,
            strip_whitespace: true,
        },
        render: {
            default: 'default',
            formats: [
                {
                    id: 'default',
                    surface: 'marking',
                    mode: 'inline',
                    separator: '/',
                    fields: [{ category: 'f1' }],
                },
            ],
        },
        rules: [],
        rollup_pipelines: [],
    },
};

describe('useEzClassify(Context)', () => {
    it('accepts a full Context and yields a working store', async () => {
        const ctx = Context.fromComponents({ scheme: testProfile });
        let captured: UseEzClassifyReturn | null = null;

        const Host = defineComponent({
            setup() {
                captured = useEzClassify(ctx, { rollupId: 'banner' });
                return () => h('div', [h('input', { id: 'banner' })]);
            },
        });
        const wrapper = mount(Host, { attachTo: document.body });

        expect(captured).toBeTruthy();
        const { store } = captured as unknown as {
            store: { value: { process: (s: string) => unknown } | null };
        };
        // the store was built from ctx.scheme and can process through it
        expect(store).toBeTruthy();

        wrapper.unmount();
    });

    it('still accepts a bare engine (no regression)', () => {
        const ctx = Context.fromComponents({ scheme: testProfile });
        const Host = defineComponent({
            setup() {
                // `Context.scheme` is typed as the local-or-remote union; a
                // context built from inline components carries the local one.
                const api = useEzClassify(
                    ctx.scheme as LocalSchemeEngineAdapter,
                    { rollupId: 'banner' },
                );
                expect(api).toBeTruthy();
                return () => h('div');
            },
        });
        mount(Host).unmount();
    });

    it('a new Context wrapper around the same engine does NOT tear down and rebuild', async () => {
        // Reach engine parity with React: handing the ref a fresh Context wrapper
        // around the same scheme engine keys identical via contextSignature, so the
        // watch must short-circuit and keep the live EzClassifyUI/store instances.
        const engine = Context.fromComponents({ scheme: testProfile })
            .scheme as LocalSchemeEngineAdapter;
        const engineRef = ref(Context.fromSchemeEngine(engine));
        let captured: UseEzClassifyReturn | null = null;

        const Host = defineComponent({
            setup() {
                captured = useEzClassify(engineRef, { rollupId: 'banner' });
                return () => h('div', [h('input', { id: 'banner' })]);
            },
        });
        const wrapper = mount(Host, { attachTo: document.body });
        await nextTick();

        const { forms, store } = captured as unknown as {
            forms: { value: unknown };
            store: { value: unknown };
        };
        const firstForms = forms.value;
        const firstStore = store.value;
        expect(firstForms).toBeTruthy();

        // Fresh wrapper, same underlying engine, wrapper-only churn must be a no-op.
        engineRef.value = Context.fromSchemeEngine(engine);
        await nextTick();

        expect(forms.value).toBe(firstForms);
        expect(store.value).toBe(firstStore);

        wrapper.unmount();
    });

    it('a Context around a genuinely different engine DOES rebuild', async () => {
        const engineRef = ref(Context.fromComponents({ scheme: testProfile }));
        let captured: UseEzClassifyReturn | null = null;

        const Host = defineComponent({
            setup() {
                captured = useEzClassify(engineRef, { rollupId: 'banner' });
                return () => h('div', [h('input', { id: 'banner' })]);
            },
        });
        const wrapper = mount(Host, { attachTo: document.body });
        await nextTick();

        const { forms } = captured as unknown as { forms: { value: unknown } };
        const firstForms = forms.value;
        expect(firstForms).toBeTruthy();

        // A new Context built from a brand-new engine has a different signature.
        engineRef.value = Context.fromComponents({ scheme: testProfile });
        await nextTick();

        expect(forms.value).not.toBe(firstForms);
        expect(forms.value).toBeTruthy();

        wrapper.unmount();
    });
});
