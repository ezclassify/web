/**
 * Angular marking controls for a connected EzClassify REST client.
 *
 * Initialize one client at application startup and share it through Angular DI.
 * Each feature injects that same client and binds `[ezClassify]="client"` on
 * its container. The directive owns its local UI scanner and store; removing a
 * feature does not destroy the application-owned client.
 *
 * `provideEzClassify` additionally registers shared marking state and optional
 * presentation defaults. It is not needed merely to share a network client. See
 * the package README for initialization, injection, mounting, and teardown.
 */

export { provideEzClassify } from './lib/provide-ezclassify';
export {
    EZCLASSIFY_ENGINE,
    EZCLASSIFY_OPTIONS,
} from './lib/provide-ezclassify';
export type {
    EzClassifyEngine,
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
