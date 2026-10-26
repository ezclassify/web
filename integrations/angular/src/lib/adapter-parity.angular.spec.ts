/**
 * Adapter parity gate, `AngularSignalStore`. Runs the shared cross-framework
 * lossless-transport contract (see `@ezclassify/ui/adapter-parity-suite`)
 * against the Angular signal store. Runs under vitest.angular.config.ts.
 */

import { runAdapterParitySuite } from '@ezclassify/ui/adapter-parity-suite';
import { AngularSignalStore } from './angular-signal-store';

runAdapterParitySuite({
    name: 'Angular',
    createStore: (engine) => new AngularSignalStore(engine),
});
