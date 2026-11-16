/**
 * The configuration `createEzClassify` installs and every `<EzClassify>` root
 * reads. Internal to this package: an application configures it only through
 * `createEzClassify`.
 */

import { inject, type InjectionKey } from 'vue';
import type {
    EzClassifyPresentationOptions,
    EzClassifyUI,
} from '@ezclassify/ui';
import type { VueRefStore } from './composables/vue-ref-store';

/** The first argument `EzClassifyUI` takes: a Context, or `{ contexts }`. */
export type UIContextInput = ConstructorParameters<typeof EzClassifyUI>[0];

/**
 * What the plugin hands every `<EzClassify>` root. Internal: the application
 * configures it only through `createEzClassify`.
 */
export interface EzClassifyConfig {
    /** The Context input each root's `EzClassifyUI` is constructed with. */
    readonly contexts: UIContextInput;
    /** Presentation options forwarded to each root's `EzClassifyUI`. */
    readonly presentation: EzClassifyPresentationOptions;
    /** Build the store a root owns when the host passed none. */
    createStore(): VueRefStore;
}

export const EzClassifyConfigKey: InjectionKey<EzClassifyConfig> =
    Symbol('EzClassifyConfig');

/**
 * The plugin's configuration, for `<EzClassify>`.
 *
 * @throws When the application did not install `createEzClassify`.
 */
export function injectEzClassifyConfig(): EzClassifyConfig {
    const config = inject(EzClassifyConfigKey, null);
    if (!config) {
        throw new Error(
            '[ezclassify/vue] <EzClassify> needs app.use(createEzClassify({ context })) first',
        );
    }
    return config;
}
