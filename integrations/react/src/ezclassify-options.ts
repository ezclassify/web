import type { EzClassifyPresentationOptions } from '@ezclassify/ui';

/**
 * Presentation options `<EzClassifyProvider options>` applies to every
 * `<EzClassify>` root below it. They configure marking surfaces, not the
 * Context. Format ids come from the Context.
 *
 * The React name for the shared
 * {@link EzClassifyPresentationOptions | presentation-options} bag, under the
 * same name the Vue and Angular packages use.
 */
export type EzClassifyOptions = EzClassifyPresentationOptions;
