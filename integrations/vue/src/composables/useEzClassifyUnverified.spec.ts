/**
 * `useEzClassifyUnverified(id)` follows one field's own state: the attribute
 * and `ezclassify:unverified-change` event its host carries. These drive a real
 * enhanced field through a failed and then a successful check.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h, nextTick, ref } from 'vue';
import { mount, type VueWrapper } from '@vue/test-utils';
import { createEzClassify, EzClassify } from '../index';
import { useEzClassifyUnverified } from './useEzClassifyUnverified';
import { createUnverifiableContext } from '../../../../libs/ui/test-fixtures/unverifiable-context';

const UNVERIFIED = 'data-ezclassify-unverified';
let wrapper: VueWrapper | null = null;

async function settle(): Promise<void> {
    for (let index = 0; index < 8; index++)
        await new Promise<void>((tick) => setTimeout(tick, 25));
    await nextTick();
}

function report(host: HTMLElement, unverified: boolean): void {
    host.toggleAttribute(UNVERIFIED, unverified);
    host.dispatchEvent(
        new CustomEvent('ezclassify:unverified-change', {
            bubbles: true,
            detail: { unverified },
        }),
    );
}

afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
    document.body.replaceChildren();
});

describe('useEzClassifyUnverified in a real field', () => {
    it('is true after a failed check, false again after the next one lands, and only for its own field', async () => {
        const controls = { down: false };
        const context = await createUnverifiableContext(controls);
        const Readout = defineComponent({
            props: { id: { type: String, required: true } },
            setup(props) {
                const unverified = useEzClassifyUnverified(() => props.id);
                return () =>
                    h(
                        'output',
                        { 'data-for': props.id },
                        String(unverified.value),
                    );
            },
        });
        const App = defineComponent({
            setup() {
                return () =>
                    h(EzClassify, null, {
                        default: () => [
                            h('input', {
                                'id': 'mine',
                                'data-ezclassify-controller': 'marking',
                            }),
                            h('input', {
                                'id': 'other',
                                'data-ezclassify-controller': 'marking',
                            }),
                            h(Readout, { id: 'mine' }),
                            h(Readout, { id: 'other' }),
                        ],
                    });
            },
        });
        wrapper = mount(App, {
            attachTo: document.body,
            global: {
                plugins: [createEzClassify({ context: context as never })],
            },
        });
        await settle();
        const read = (id: string) =>
            document.querySelector(`output[data-for="${id}"]`)!.textContent;
        const editor = document.querySelector<HTMLTextAreaElement>(
            '.marking-field-host',
        )!;
        const type = (text: string) => {
            editor.focus();
            editor.value = text;
            editor.dispatchEvent(new Event('input', { bubbles: true }));
        };
        expect(read('mine')).toBe('false');
        controls.down = true;
        type('sec');
        await settle();
        expect(document.getElementById('mine')!.hasAttribute(UNVERIFIED)).toBe(
            true,
        );
        expect(read('mine')).toBe('true');
        expect(read('other')).toBe('false');
        controls.down = false;
        type('secret zzz');
        await settle();
        expect(read('mine')).toBe('false');
    });
});

describe('useEzClassifyUnverified', () => {
    it('reads true when the field already is unverified, waits for one not enhanced yet, and follows an id that changes', async () => {
        const first = document.createElement('input');
        first.id = 'first';
        first.setAttribute(UNVERIFIED, '');
        const second = document.createElement('input');
        second.id = 'second';
        const id = ref('first');
        const Probe = defineComponent({
            setup() {
                const unverified = useEzClassifyUnverified(id);
                return () => h('p', String(unverified.value));
            },
        });
        document.body.append(first, second);
        wrapper = mount(Probe, { attachTo: document.body });
        expect(wrapper.text()).toBe('true');
        id.value = 'second';
        await nextTick();
        expect(wrapper.text()).toBe('false');
        report(second, true);
        await nextTick();
        expect(wrapper.text()).toBe('true');
        report(first, false);
        await nextTick();
        expect(wrapper.text()).toBe('true');
        id.value = 'late';
        await nextTick();
        expect(wrapper.text()).toBe('false');
    });

    it('stops listening on unmount', () => {
        const add = vi.spyOn(document, 'addEventListener');
        const remove = vi.spyOn(document, 'removeEventListener');
        wrapper = mount(
            defineComponent({
                setup() {
                    useEzClassifyUnverified('gone');
                    return () => h('p');
                },
            }),
        );
        const named = (spy: typeof add) =>
            spy.mock.calls.filter(
                ([type]) => type === 'ezclassify:unverified-change',
            ).length;
        expect(named(add)).toBeGreaterThan(0);
        wrapper.unmount();
        wrapper = null;
        expect(named(remove)).toBe(named(add));
    });
});
