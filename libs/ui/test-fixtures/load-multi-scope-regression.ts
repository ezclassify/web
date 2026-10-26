import { SchemeEngine } from '@ezclassify/engine';
import yaml from 'js-yaml';
import source from './multi-scope-regression.yaml?raw';

/**
 * Load the canonical multi-scope fixture for UI state and rendering
 * regressions.
 */
export function loadMultiScopeRegression(): SchemeEngine {
    return SchemeEngine.fromJSON(yaml.load(source) as never);
}
