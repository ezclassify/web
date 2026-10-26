/**
 * Regression coverage for a rejected publish in the Vue bindings.
 *
 * `publishRendered` and `publishAssertions` reject on any engine failure, which
 * over a REST client includes a transient 5xx and a dropped connection. The
 * composables' setters return void, so the promise has to be handled where it
 * is created; without that the rejection escapes as an unhandled rejection, and
 * a Node or SSR host that treats those as fatal goes down over a failed edit.
 */
import { describe, it, expect } from 'vitest';
import { defineComponent, h, provide } from 'vue';
import { mount } from '@vue/test-utils';
import type { Assertion } from '@ezclassify/types';
import {
    VueRefStoreKey,
    useEzClassify,
    useEzClassifyAssertions,
} from './index';
import { VueRefStore } from './composables/vue-ref-store';
import type {
    EzClassifyStoreEngine,
    EzClassifyStoreProcessResult,
} from '@ezclassify/ui';

/** An engine whose every process call fails the way a dropped request does. */
function failingEngine(): EzClassifyStoreEngine {
    return {
        process: () =>
            Promise.reject(
                new Error('gateway timeout'),
            ) as unknown as EzClassifyStoreProcessResult,
        render: () => '',
        aggregate: () => ({
            rendered: '',
            assertions: [],
            valid: true,
            errors: [],
        }),
        aggregateAssertions: () => ({
            rendered: '',
            assertions: [],
            valid: true,
            errors: [],
        }),
        getSchemeMeta: () => ({ scopes: [] }),
        listCategories: () => [],
    };
}

async function flush(): Promise<void> {
    for (let i = 0; i < 5; i++) await Promise.resolve();
}

/**
 * Mount a component that publishes once through the composable under test and
 * collect what escaped.
 *
 * @param publish - Writes through the composable's setter
 * @returns Rejections that reached the global handler, and console.error calls
 */
async function publishAndWatch(
    publish: (store: VueRefStore) => void,
): Promise<{ unhandled: unknown[]; errors: string }> {
    const store = new VueRefStore(failingEngine());
    const unhandled: unknown[] = [];
    const onUnhandled = (event: PromiseRejectionEvent) =>
        unhandled.push(event.reason);
    window.addEventListener('unhandledrejection', onUnhandled);
    const errors: unknown[][] = [];
    const originalError = console.error;
    console.error = (...args: unknown[]) => errors.push(args);

    // provide() reaches descendants, not the providing component itself, so
    // the composable runs one level down, the way a host application wires it.
    const Child = defineComponent({
        setup() {
            publish(store);
            return () => h('div');
        },
    });
    const Host = defineComponent({
        setup() {
            provide(VueRefStoreKey, store);
            return () => h(Child);
        },
    });

    try {
        mount(Host);
        await flush();
    } finally {
        console.error = originalError;
        window.removeEventListener('unhandledrejection', onUnhandled);
    }
    return { unhandled, errors: JSON.stringify(errors) };
}

describe('Vue bindings: a failed publish', () => {
    it('is reported by useEzClassify instead of escaping', async () => {
        const { unhandled, errors } = await publishAndWatch(() => {
            const marking = useEzClassify('doc');
            marking.value = 'tier:secret';
        });

        expect(unhandled).toEqual([]);
        expect(errors).toContain('publishing marking');
    });

    it('is reported by useEzClassifyAssertions instead of escaping', async () => {
        const { unhandled, errors } = await publishAndWatch(() => {
            const assertions = useEzClassifyAssertions('doc');
            assertions.value = [
                { categoryId: 'tier', conceptId: 'secret' } as Assertion,
            ];
        });

        expect(unhandled).toEqual([]);
        expect(errors).toContain('publishing marking');
    });
});
