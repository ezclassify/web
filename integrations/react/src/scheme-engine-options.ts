import type { EzClassifyPresentationOptions } from '@ezclassify/ui';

/**
 * UI presentation options forwarded to `EzClassifyUI` for a feature through
 * `useSchemeEngine(client, options)`. An optional provider supplies inherited
 * defaults, merged key by key. These options configure marking surfaces, not
 * the connected client or policy engine. Format IDs come from the Context.
 *
 * The React name for the shared
 * {@link EzClassifyPresentationOptions | presentation-options} bag. React has no
 * options the other adapters lack, so this is the shared shape under a name
 * that reads right at a React call site.
 *
 * Its own module so the provider and the hook can both name the shape without
 * importing each other.
 */
export type UseSchemeEngineOptions = EzClassifyPresentationOptions;
