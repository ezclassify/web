/**
 * `@ezclassify/ui`: the framework-agnostic browser component library for
 * EzClassify. It drives the engine-compatible adapter the host supplies
 * (usually `@ezclassify/rest-client`) and renders marking UIs (autocompleters,
 * facet pickers, banners, marked text) that bind to a marking through
 * `data-ezclassify-*` attributes.
 *
 * The exports below are the package's public contract:
 *
 * - {@link EzClassifyUI}, the runtime that scans the DOM, wires bound views to the
 *   store, and drives the engine.
 * - The five component classes hosts mount directly (TagInput, Handbook,
 *   ContextReference, MarkedTextArea, MarkedInput). Every other control mounts
 *   through its `data-ezclassify-controller` attribute.
 * - The store contract ({@link EzClassifyStore}) plus its reference
 *   {@link VanillaEzClassifyStore} and shared {@link BaseEzClassifyStore}, the
 *   binding-layer state container framework adapters implement.
 * - Binding, theming, and i18n helpers.
 *
 * Adapter-internal primitives (the abstract component base, raw CSS strings,
 * color constants) are deliberately NOT re-exported here so they can change
 * without breaking the published surface. `public-surface.spec.ts` pins both
 * halves of that boundary.
 */
export { EzClassifyUI } from './ezclassify-ui';
export type { ControllerName } from './element-scanner';
export { isUnverified, watchUnverified } from './unverified';
export type { UnverifiedChangeDetail } from './unverified';
export type { EzClassifyAttributes } from './added-attributes';
export {
    getDefaultStyles,
    injectDefaultStyles,
    EZ_CSS_VARIABLES,
} from './styles';
export { THEMES, applyTheme } from './themes';
export type { EzTheme } from './themes';
export { contextSignature, sameSignature } from './engine-signature';
export * from './render-colors';
export * from './token-tree';
export { TagInput } from './components';
export type { TagInputOptions } from './components';
export { Handbook } from './components';
export type { HandbookOptions } from './components';
export { ContextReference } from './components';
export type { ContextReferenceOptions } from './components';
export {
    contextReferenceHostAttributes,
    contextReferenceTabAttributes,
} from './components';
export type {
    ContextReferenceProps,
    ContextReferenceTabProps,
    ContextReferenceHostBinding,
    ContextReferencePlacement,
    ContextReferenceOffsets,
} from './components';
export { MarkedTextArea } from './components';
export type { MarkedTextAreaOptions, MarkedSegment } from './components';
export { MarkedInput } from './components';
export type { MarkedInputOptions } from './components';
export type {
    FavoriteEntry,
    FavoritesConfig,
    FavoritesContext,
} from './components';
export { defaultLocale, setLocale, resetLocale, t } from './i18n';
export { buildCategoryColorMap } from './color-resolver';
export { bucketKey, bucketParts, contextStoreBuckets } from './context-binding';
export type {
    BucketKey,
    EzClassifyContextMap,
    EzClassifyContexts,
} from './context-binding';
export type { RollupEventDetail, RollupBucketDetail } from './forms/rollup';
export {
    VanillaEzClassifyStore,
    EMPTY_EZCLASSIFY_AGGREGATE,
    EMPTY_EZCLASSIFY_STATE,
    SOLE_BUCKET,
    EMPTY_FACET_STATE,
    facetStateEqual,
} from './store/ezclassify-store';
export type {
    EzClassifyAggregate,
    EzClassifyStore,
    EzClassifyStoreBuckets,
    MarkingEntriesStore,
    EzClassifyStoreAggregateResult,
    EzClassifyStoreEngine,
    EzClassifyStoreProcessResult,
    EzClassifyState,
    FacetState,
    PublishSource,
} from './store/ezclassify-store';
export { BaseEzClassifyStore } from './store/base-ezclassify-store';
export { reportPublishFailure } from './store/publish-failure';
export type { ReactiveCell } from './store/base-ezclassify-store';
export type { Assertion } from '@ezclassify/types';
// Re-exported, not re-implemented. The framework integrations declare
// `@ezclassify/ui` as their only EzClassify peer, and each checks that what a
// host provides is a Context before it initializes. Routing that one runtime
// symbol through here keeps `@ezclassify/types` out of their dependency
// surface instead of leaving three packages with an undeclared runtime import.
export { isContextAdapter } from '@ezclassify/types';
export type {
    ContextAdapter,
    ContextSchemeEngineAdapter,
    RemoteContextSchemeEngineAdapter,
} from '@ezclassify/types';
export {
    createEzClassifyFacetBinding,
    publishFacetSelection,
    selectedConceptIds,
} from './facet-binding';
export { mergeProvisionOptions } from './provision-options';
export type { EzClassifyPresentationOptions } from './provision-options';
export type {
    EzClassifyFacetBinding,
    EzClassifyFacetSelection,
    EzClassifyFacetSelectionInput,
    EzClassifyFacetSnapshot,
} from './facet-binding';
