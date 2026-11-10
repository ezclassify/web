/**
 * `createEzClassify`: the one call a Vue application makes to use EzClassify.
 *
 * ```ts
 * const client = await connectContext({
 *     baseUrl,
 *     contextId,
 *     contextVersion,
 * });
 * createApp(App)
 *     .use(createEzClassify({ context: client }))
 *     .mount('#app');
 * ```
 *
 * The plugin holds the connected Context (or several, by key) and the
 * presentation defaults, and registers `<EzClassify>` globally. Every marking
 * surface below an `<EzClassify>` root is then declared in markup. The plugin
 * never owns or destroys a Context; the application that connected it does.
 */

import type { App, Plugin } from 'vue';
import type {
    ContextAdapter,
    EzClassifyPresentationOptions,
} from '@ezclassify/ui';
import { VueRefStore } from './composables/vue-ref-store';
import {
    EzClassifyConfigKey,
    type EzClassifyConfig,
    type UIContextInput,
} from './config';
import { EzClassify } from './EzClassify';

/** The Contexts an application marks against: one, or several by key. */
export type EzClassifyContexts =
    | {
          /** The application's only Context. */
          context: ContextAdapter;
          contexts?: never;
      }
    | {
          /**
           * Several Contexts, each under the key `data-ezclassify-context`
           * names. Markup outside any `data-ezclassify-context` ancestor has no
           * Context and is reported as a host error; there is no implicit first
           * key.
           */
          contexts: Readonly<Record<string, ContextAdapter>>;
          context?: never;
      };

/** What `createEzClassify` takes: the Contexts plus presentation defaults. */
export type EzClassifyOptions = EzClassifyContexts &
    EzClassifyPresentationOptions;

/**
 * Create the plugin that configures EzClassify for a Vue application.
 *
 * @param options - `{ context }` for one Context or `{ contexts }` for several,
 *   plus presentation defaults (`format`, `colorMap`, `tooltipConceptProperty`,
 *   `favorites`) applied to every root.
 * @returns A plugin for `app.use()`.
 * @throws When neither or both of `context` and `contexts` are given, or
 *   `contexts` is empty.
 */
export function createEzClassify(options: EzClassifyOptions): Plugin {
    const config = resolveConfig(options);
    return {
        install(app: App) {
            app.provide(EzClassifyConfigKey, config);
            app.component('EzClassify', EzClassify);
        },
    };
}

function resolveConfig(options: EzClassifyOptions): EzClassifyConfig {
    const { context, contexts, ...presentation } = options ?? {};
    if ((context === undefined) === (contexts === undefined)) {
        throw new Error(
            '[ezclassify/vue] createEzClassify() takes exactly one of { context } or { contexts }',
        );
    }
    if (contexts !== undefined && Object.keys(contexts).length === 0) {
        throw new Error(
            '[ezclassify/vue] createEzClassify({ contexts }) needs at least one Context',
        );
    }
    const input = (
        context !== undefined ? context : { contexts }
    ) as UIContextInput;
    return {
        contexts: input,
        presentation,
        createStore: () => {
            if (context === undefined) {
                // The store addresses one Context's scheme today. A store over
                // several Contexts arrives with the bucket-keyed store.
                throw new Error(
                    '[ezclassify/vue] <EzClassify> over several Contexts needs a store that addresses each of them',
                );
            }
            return new VueRefStore(context.scheme, {
                format: presentation.format,
            });
        },
    };
}
