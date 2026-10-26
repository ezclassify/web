import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
const dom = new JSDOM('<!doctype html><div id="app"></div>', {
    url: 'https://consumer.example/',
    pretendToBeVisual: true,
});
for (const key of [
    'window',
    'document',
    'HTMLElement',
    'Element',
    'Node',
    'SVGElement',
    'MutationObserver',
    'CustomEvent',
    'Event',
])
    Object.defineProperty(globalThis, key, {
        value:
            key === 'window'
                ? dom.window
                : key === 'document'
                  ? dom.window.document
                  : dom.window[key],
        configurable: true,
    });
Object.defineProperty(globalThis, 'navigator', {
    value: dom.window.navigator,
    configurable: true,
});
const host = document.querySelector('#app');
const props = {
    placement: 'left',
    open: true,
    size: '24rem',
    offset: { top: '1rem' },
    tabs: ['custom'],
    theme: 'dark',
    colorScheme: 'dark',
    tabLabels: { custom: 'Custom' },
    tabIcons: { custom: 'tag' },
};
function check(label, placement = 'left', open = true) {
    const el = host.querySelector(
        '[data-ezclassify-controller="context-reference"]',
    );
    assert.ok(el);
    assert.equal(
        el.getAttribute('data-ezclassify-context-reference-placement'),
        placement,
    );
    assert.equal(
        el.hasAttribute('data-ezclassify-context-reference-open'),
        open,
    );
    assert.equal(
        el.getAttribute('data-ezclassify-context-reference-size'),
        '24rem',
    );
    assert.equal(
        el.style.getPropertyValue('--ez-context-ref-offset-top'),
        '1rem',
    );
    assert.equal(
        el.getAttribute('data-ezclassify-context-reference-tabs'),
        'custom',
    );
    assert.equal(el.getAttribute('data-color-scheme'), 'dark');
    const tab = el.querySelector('[data-ezclassify-tab]');
    assert.ok(tab);
    assert.equal(tab.getAttribute('data-ezclassify-tab-label'), label);
    assert.equal(tab.getAttribute('data-ezclassify-tab-id'), 'custom');
    assert.equal(tab.getAttribute('data-ezclassify-tab-icon'), 'tag');
    assert.equal(tab.getAttribute('data-ezclassify-tab-order'), '2');
    assert.equal(tab.textContent, 'Slot body');
}
export { assert, dom, host, props, check };
