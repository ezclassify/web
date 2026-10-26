import { assert, dom, host, props, check } from './runtime-dom-common.mjs';
const { createApp, h, reactive, nextTick, version } = await import('vue');
const { ContextReference, ContextReferenceTab } =
    await import('@ezclassify/vue');
const state = reactive({ ...props, label: 'Custom' });
const app = createApp({
    render() {
        return h(ContextReference, state, {
            default: () =>
                h(
                    ContextReferenceTab,
                    { id: 'custom', label: state.label, icon: 'tag', order: 2 },
                    { default: () => h('span', 'Slot body') },
                ),
        });
    },
});
app.mount(host);
await nextTick();
check('Custom');
state.label = 'Updated';
state.placement = 'right';
state.open = false;
await nextTick();
check('Updated', 'right', false);
app.unmount();
assert.equal(host.children.length, 0);
dom.window.close();
console.log(
    JSON.stringify({
        framework: 'vue',
        version,
        publicESMImport: true,
        propsAndTypedSlotDOM: true,
        reactiveUpdate: true,
        unmount: true,
        engineOrNetworkFlow: 'Notclaimed',
    }),
);
