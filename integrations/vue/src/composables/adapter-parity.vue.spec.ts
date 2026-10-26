/**
 * Adapter parity gate, `VueRefStore`. Runs the shared cross-framework
 * lossless-transport contract (see `@ezclassify/ui/adapter-parity-suite`)
 * against the Vue store.
 */

import { runAdapterParitySuite } from '@ezclassify/ui/adapter-parity-suite';
import { VueRefStore } from './vue-ref-store';

runAdapterParitySuite({
    name: 'Vue',
    createStore: (engine) => new VueRefStore(engine),
});
