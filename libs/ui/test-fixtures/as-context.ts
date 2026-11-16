/**
 * Hand EzClassifyUI the Context it takes, whatever a spec built.
 *
 * Specs about one component often build only a scheme view (a mock, or a real
 * connected client's `scheme`). EzClassifyUI takes a Context, so a bare view
 * goes in {@link schemeOnlyContext}; a Context passes through unchanged.
 */

import type { ContextAdapter } from '@ezclassify/types';
import { schemeOnlyContext } from './context-doubles';

/**
 * @param source - A Context, or a scheme view a spec built on its own
 * @returns The Context, or a scheme-only Context around the view
 */
export function asContext(source: unknown): ContextAdapter {
    const candidate = source as Partial<ContextAdapter> | null;
    return candidate &&
        typeof candidate === 'object' &&
        'scheme' in candidate &&
        typeof candidate.audit === 'function'
        ? (candidate as ContextAdapter)
        : schemeOnlyContext(source);
}
