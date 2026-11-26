/**
 * `useEzClassifyCheckFailed(id)` follows one field's own check state: the
 * attribute and `ezclassify:check-change` event its host carries.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { defineComponent, h, nextTick } from 'vue';
import { mount, type VueWrapper } from '@vue/test-utils';
import { useEzClassifyCheckFailed } from './useEzClassifyCheckFailed';

let wrapper: VueWrapper | null = null;

afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
    document.body.replaceChildren();
});

describe('useEzClassifyCheckFailed', () => {
    it('is true while its own field reports a failed check, and not for another field', async () => {
        const mine = document.createElement('input');
        mine.id = 'mine';
        const other = document.createElement('input');
        other.id = 'other';
        document.body.append(mine, other);
        const Probe = defineComponent({
            setup() {
                const failed = useEzClassifyCheckFailed('mine');
                return () => h('p', String(failed.value));
            },
        });
        wrapper = mount(Probe, { attachTo: document.body });
        const report = (host: HTMLElement, failed: boolean) =>
            host.dispatchEvent(
                new CustomEvent('ezclassify:check-change', {
                    bubbles: true,
                    detail: { failed },
                }),
            );
        expect(wrapper.text()).toBe('false');
        report(other, true);
        await nextTick();
        expect(wrapper.text()).toBe('false');
        report(mine, true);
        await nextTick();
        expect(wrapper.text()).toBe('true');
        report(mine, false);
        await nextTick();
        expect(wrapper.text()).toBe('false');
    });
});
