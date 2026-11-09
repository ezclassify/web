import { Context } from '@ezclassify/engine';
import yaml from 'js-yaml';
import { openOperations } from './context-doubles';
import source from './multi-scope-regression.yaml?raw';

/**
 * Load the canonical multi-scope fixture for UI state and rendering
 * regressions, as scheme operations a spec may replace or spy on.
 */
export function loadMultiScopeRegression(): Context['scheme'] {
    return openOperations(
        Context.fromComponents({ scheme: yaml.load(source) }).scheme,
    );
}
