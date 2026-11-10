/**
 * Vue 3 marking controls for a connected EzClassify Context.
 *
 * Install the plugin once with the application's Context, then wrap each
 * document in `<EzClassify>`. Everything inside is declared with
 * `data-ezclassify-*` attributes:
 *
 * ```ts
 * createApp(App)
 *     .use(createEzClassify({ context: client }))
 *     .mount('#app');
 * ```
 *
 * ```vue
 * <EzClassify>
 *     <form>…</form>
 * </EzClassify>;
 * ```
 *
 * Components inside a root read and write marking state with
 * `useEzClassify(id)`, `useEzClassifyState(id)`, `useEzClassifyAssertions(id)`
 * and `useEzClassifyFacet(id, categoryId)`. See the package README.
 */

import { computed, type Ref, type WritableComputedRef } from 'vue';
import { reportPublishFailure } from '@ezclassify/ui';
import type { Assertion, EzClassifyState } from '@ezclassify/ui';
import { injectRootStore } from './composables/vue-ref-store';
import type { EzClassify } from './EzClassify';

/**
 * Two-way binding to a marking's rendered text, for `v-model`. Writes go
 * through the store, which parses them against the Context; the ref then shows
 * what the store committed.
 *
 * @param id - The marking id (the DOM id of its host).
 * @throws When called outside an `<EzClassify>` root.
 */
export function useEzClassify(id: string): WritableComputedRef<string> {
    const store = injectRootStore('useEzClassify(id)');
    // Stable token tied to this composable invocation. Publish writes carry it
    // so a store-level subscriber registered with the same token skips the
    // self-echo. The computed itself depends on the ref directly, so Vue's
    // reactivity handles the read side without an extra listener.
    const token = {};
    const stateRef = store.refFor(id);
    return computed<string>({
        get: () => stateRef.value.rendered,
        set: (next) => {
            store
                .publishRendered(id, next, { token })
                .catch((error: unknown) =>
                    reportPublishFailure('useEzClassify', id, error),
                );
        },
    });
}

/**
 * Assertion-side companion. Read or write the `Assertion[]` slice of the
 * marking, for tag-picker and checklist components that produce a list of
 * concept selections rather than a rendered string.
 *
 * @param id - The marking id.
 * @throws When called outside an `<EzClassify>` root.
 */
export function useEzClassifyAssertions(
    id: string,
): WritableComputedRef<Assertion[]> {
    const store = injectRootStore('useEzClassifyAssertions(id)');
    const token = {};
    const stateRef = store.refFor(id);
    return computed<Assertion[]>({
        get: () => stateRef.value.assertions,
        set: (next) => {
            store
                .publishAssertions(id, next, { token })
                .catch((error: unknown) =>
                    reportPublishFailure('useEzClassifyAssertions', id, error),
                );
        },
    });
}

/**
 * Read-only access to a marking's full state (rendered text, assertions,
 * validity, errors) for components that need more than the text.
 *
 * @param id - The marking id.
 * @throws When called outside an `<EzClassify>` root.
 */
export function useEzClassifyState(id: string): Readonly<Ref<EzClassifyState>> {
    return injectRootStore('useEzClassifyState(id)').refFor(id);
}

export { createEzClassify } from './plugin';
export type { EzClassifyContexts, EzClassifyOptions } from './plugin';
export { EzClassify, useEzClassifyUI } from './EzClassify';
export { bindEzClassifyToReactiveDoc } from './composables/bindEzClassifyToReactiveDoc';
export type { VueReactiveDoc } from './composables/bindEzClassifyToReactiveDoc';
export { useEzClassifyFacet } from './composables/useEzClassifyFacet';
export type { UseEzClassifyFacetReturn } from './composables/useEzClassifyFacet';
export { VueRefStore, VueRefStoreKey } from './composables/vue-ref-store';
export type { VueRefStoreOptions } from './composables/vue-ref-store';
export { ContextReference, ContextReferenceTab } from './ContextReference';

// `createEzClassify` registers `<EzClassify>` globally; this types it in
// templates that use it without importing it.
declare module 'vue' {
    export interface GlobalComponents {
        EzClassify: typeof EzClassify;
    }
}
