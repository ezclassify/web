/**
 * Adapter parity gate, vanilla `EzClassifyStore`. Runs the shared
 * cross-framework lossless-transport contract (see `adapter-parity-suite.ts`)
 * against the reference `VanillaEzClassifyStore`. The React, Vue, and Angular
 * specs run the identical suite against their own stores.
 */

import { runAdapterParitySuite } from '@ezclassify/ui/adapter-parity-suite';
import { VanillaEzClassifyStore } from './ezclassify-store';

runAdapterParitySuite({
    name: 'Vanilla',
    createStore: (engine) => new VanillaEzClassifyStore(engine),
});
