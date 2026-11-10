/**
 * Angular marking controls for a connected EzClassify Context.
 *
 * Name the Context once with `provideEzClassify({ context })` in the
 * application or route providers, then mark a root with a bare `ezClassify`
 * attribute: `<form ezClassify>`. Each root builds and owns its store. The
 * application owns the Context; removing a feature does not dispose of it. See
 * the package README for mounting, injection and teardown.
 */

export {
    provideEzClassify,
    EZCLASSIFY_CONTEXT,
    EZCLASSIFY_OPTIONS,
} from './lib/provide-ezclassify';
export type {
    EzClassifyOptions,
    EzClassifyProvision,
} from './lib/provide-ezclassify';
export { EzClassifyDirective } from './lib/ezclassify.directive';
export type { EzClassifyDirectiveOptions } from './lib/ezclassify.directive';
export { bindEzClassifyToSignal } from './lib/bind-ezclassify-to-signal';
export type { BindMarkingsToSignalOptions } from './lib/bind-ezclassify-to-signal';
export { injectEzClassifyFacet } from './lib/inject-ezclassify-facet';
export type { InjectEzClassifyFacetReturn } from './lib/inject-ezclassify-facet';
export {
    AngularSignalStore,
    EZCLASSIFY_STORE,
    EZCLASSIFY_STORE_SIGNAL,
} from './lib/angular-signal-store';
export type {
    AngularSignalStoreOptions,
    SignalBackedEzClassifyStore,
} from './lib/angular-signal-store';
export { EzMarkingLabelComponent } from './lib/ez-marking-label/ez-marking-label.component';
export { EzContextReferenceComponent } from './lib/context-reference/context-reference.component';
export { EzContextReferenceTabComponent } from './lib/context-reference/context-reference-tab.component';
