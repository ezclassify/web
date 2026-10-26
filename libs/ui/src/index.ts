/**
 * `@ezclassify/ui`: the framework-agnostic browser component library for
 * EzClassify. It drives the engine-compatible adapter the host supplies
 * (usually `@ezclassify/rest-client`) and renders marking UIs (autocompleters,
 * facet pickers, banners, cards, marked text) that bind to a marking through
 * `data-ezclassify-*` attributes.
 *
 * The exports below are the package's public contract:
 *
 * - {@link EzClassifyUI}, the runtime that scans the DOM, wires bound views to the
 *   store, and drives the engine.
 * - The component classes (AssertionCard, CategorySelector, MarkedTextArea, …),
 *   vanilla custom-element-style primitives the framework adapters wrap.
 * - The store contract ({@link EzClassifyStore}) plus its reference
 *   {@link VanillaEzClassifyStore} and shared {@link BaseEzClassifyStore}, the
 *   binding-layer state container framework adapters implement.
 * - Binding, theming, serialization, and i18n helpers.
 *
 * Adapter-internal primitives (the abstract component base, raw CSS strings,
 * color constants) are deliberately NOT re-exported here so they can change
 * without breaking the published surface. `public-surface.spec.ts` pins both
 * halves of that boundary.
 */
export { EzClassifyUI } from './ezclassify-ui';
export {
    getDefaultStyles,
    injectDefaultStyles,
    EZ_CSS_VARIABLES,
} from './styles';
export {
    captureFormState,
    restoreFormState,
    exportFormState,
    importFormState,
} from './serialization';
export type { FormState } from './serialization';
export { THEMES, applyTheme } from './themes';
export type { EzTheme } from './themes';
export { initComparison, compareRenderings } from './comparison';
export type { ComparisonResult } from './comparison';
export { createComponentLocator } from './component-locator';
export type {
    ComponentLocator,
    ComponentLocatorOptions,
} from './component-locator';
export {
    contextSignature,
    isEngineContext,
    sameSignature,
} from './engine-signature';
export type { EngineArg } from './engine-signature';
export * from './render-colors';
export * from './token-tree';
export { AssertionCard } from './components';
export type { AssertionCardOptions } from './components';
export { TagInput } from './components';
export type { TagInputOptions } from './components';
export { DualPane } from './components';
export { CategoryChecklist } from './components';
export type { CategoryChecklistOptions } from './components';
export { CategorySelector } from './components';
export type { CategorySelectorOptions } from './components';
export { SingleSelect } from './components';
export { StatusBanner } from './components';
export type { StatusBannerOptions, StatusBannerColors } from './components';
export { Handbook } from './components';
export type { HandbookOptions } from './components';
export { Guidebook } from './components';
export type { GuidebookOptions } from './components';
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
export { GuideChecklist } from './components';
export type { GuideChecklistOptions } from './components';
export { DecisionFlow } from './components';
export { HiddenAssertionField } from './components';
export { EzClassifyText } from './components';
export type { EzClassifyTextOptions } from './components';
export { MarkedTextArea } from './components';
export type { MarkedTextAreaOptions, MarkedSegment } from './components';
export { MarkedInput } from './components';
export type { MarkedInputOptions } from './components';
export { MarkingField } from './components';
export type { MarkingFieldOptions } from './components';
export type { FavoriteEntry, FavoritesConfig } from './components';
export { EquivalencyMap } from './components';
export type { EquivalencyEntry } from './components';
export { defaultLocale, setLocale, resetLocale, t } from './i18n';
export type { ContributionDescriptor } from './forms/rollup';
export { buildCategoryColorMap } from './color-resolver';
export { registerContext, unregisterContext } from './context-binding';
export {
    assembleWithConcept,
    findUnambiguousMatch,
    groupSuggestionsWithDepth,
    getConceptDepth,
} from './marking-utils';
export type {
    UnambiguousMatch,
    GroupedSuggestionItem,
    SuggestionGroup,
} from './marking-utils';
export {
    VanillaEzClassifyStore,
    EMPTY_EZCLASSIFY_STATE,
    EMPTY_FACET_STATE,
    facetStateEqual,
} from './store/ezclassify-store';
export type {
    EzClassifyStore,
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
export {
    bindEzClassifyToObject,
    createDocBinding,
    readDocPath,
    writeDocPath,
    writeDocPathImmutable,
    normalize,
} from './bind-ezclassify-to-object';
export type {
    BindMarkingsHandle,
    DocBindingOptions,
    MarkingBindingConfig,
    MarkingBindingMode,
    MarkingBindingValue,
    MarkingDiffEntry,
    MarkingsToObjectConfig,
    NormalizedEntry,
    ReactiveDoc,
} from './bind-ezclassify-to-object';
export type { Assertion } from '@ezclassify/types';
// Re-exported, not re-implemented. The framework integrations declare
// `@ezclassify/ui` as their only EzClassify peer, and every one of them has to
// tell a composed context from a bare scheme adapter before handing an engine
// to the store. Routing that one runtime symbol through here keeps
// `@ezclassify/types` out of their dependency surface instead of leaving three
// packages with an undeclared runtime import.
export { isContextAdapter } from '@ezclassify/types';
export type {
    ContextAdapter,
    ContextSchemeEngineAdapter,
    RemoteContextSchemeEngineAdapter,
    SchemeEngineAdapter,
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
