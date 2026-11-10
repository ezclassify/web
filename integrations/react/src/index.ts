/**
 * React marking controls for a connected EzClassify Context.
 *
 * Name the Context once with `<EzClassifyProvider context={client}>`, then put
 * each document in an `<EzClassify>` root. Everything inside a root is declared
 * with `data-ezclassify-*` attributes; hooks read and write its state where
 * code needs to. The application owns the Context and destroys it at
 * application or session teardown; unmounting a root leaves it available.
 *
 * The package README has a complete example.
 */

export { EzClassifyProvider } from './EzClassifyProvider';
export type { EzClassifyProviderProps } from './EzClassifyProvider';
export type { EzClassifyOptions } from './ezclassify-options';
export { EzClassify, useEzClassifyUI } from './EzClassify';
export type { EzClassifyProps } from './EzClassify';
export { ReactEzClassifyStore } from './react-ezclassify-store';
export type { ReactEzClassifyStoreOptions } from './react-ezclassify-store';
export {
    useEzClassify,
    useEzClassifyAssertions,
    useEzClassifyStore,
} from './useEzClassify';
export type { SetRendered, SetAssertions } from './useEzClassify';
export { useEzClassifyFacet } from './useEzClassifyFacet';
export type { UseEzClassifyFacetReturn } from './useEzClassifyFacet';
export { useEzClassifyObject } from './useEzClassifyObject';
export type { UseEzClassifyObjectResult } from './useEzClassifyObject';
export { useEzClassifyRollup } from './useEzClassifyRollup';
export type { EzClassifyBucket } from './useEzClassifyRollup';
export { ContextReference, ContextReferenceTab } from './ContextReference';
export type {
    ContextReferenceProps,
    ContextReferenceTabProps,
} from './ContextReference';
