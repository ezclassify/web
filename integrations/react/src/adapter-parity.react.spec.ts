/**
 * Adapter parity gate, `ReactEzClassifyStore`. Runs the shared cross-framework
 * lossless-transport contract (see `@ezclassify/ui/adapter-parity-suite`)
 * against the React store, so a scope/capture-value regression in the React
 * path fails here regardless of the per-adapter unit specs.
 */

import { runAdapterParitySuite } from '@ezclassify/ui/adapter-parity-suite';
import { ReactEzClassifyStore } from './react-ezclassify-store';

runAdapterParitySuite({
    name: 'React',
    createStore: (engine) => new ReactEzClassifyStore(engine),
});
