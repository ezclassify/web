import { assert, dom, host, props, check } from './runtime-dom-common.mjs';
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const React = await import('react');
const { createRoot } = await import('react-dom/client');
const { ContextReference, ContextReferenceTab } =
    await import('@ezclassify/react');
assert.equal(typeof React.useSyncExternalStore, 'function');
const root = createRoot(host);
function tree(label, p) {
    return React.createElement(
        ContextReference,
        p,
        React.createElement(
            ContextReferenceTab,
            { id: 'custom', label, icon: 'tag', order: 2 },
            React.createElement('span', null, 'Slot body'),
        ),
    );
}
await React.act(async () => root.render(tree('Custom', props)));
check('Custom');
await React.act(async () =>
    root.render(tree('Updated', { ...props, placement: 'right', open: false })),
);
check('Updated', 'right', false);
await React.act(async () => root.unmount());
assert.equal(host.children.length, 0);
dom.window.close();
console.log(
    JSON.stringify({
        framework: 'react',
        version: React.version,
        publicESMImport: true,
        nativeExternalStoreHookPresent: true,
        propsAndChildDOM: true,
        rerender: true,
        unmount: true,
        engineOrNetworkFlow: 'Notclaimed',
    }),
);
