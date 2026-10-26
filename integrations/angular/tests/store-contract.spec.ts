/**
 * Cross-framework EzClassifyStore contract spec.
 *
 * The per-adapter unit suites run in separate vitest invocations, so a shared
 * interface break could pass each of them. This spec runs the identical
 * assertion set against all three store implementations in a single file, so a
 * breaking change to any shared interface surface shows up immediately
 * regardless of which adapter is being exercised.
 *
 * Adapters under test:
 *
 * - ReactEzClassifyStore (plain-Map + external-store pattern)
 * - VueRefStore (Vue Ref-backed)
 * - AngularSignalStore (Angular WritableSignal-backed)
 *
 * Runs under vitest.angular.config.ts (zone.js in scope; all three
 * @ezclassify/* aliases resolve). Private lane.
 *
 * These suites are additive, they intentionally overlap with the per-adapter
 * specs. The goal is regression detection across all three at once, not
 * complete coverage of every adapter's own extension points.
 */

import {
    createPassThroughEngine,
    runEzClassifyStoreConformance,
    runEzClassifyStoreBudgetConformance,
    runEzClassifyStoreFacetConformance,
} from '@ezclassify/testing-utils';
import { ReactEzClassifyStore } from '@ezclassify/react';
import { VueRefStore } from '@ezclassify/vue';
import { AngularSignalStore } from '@ezclassify/angular';
import type { EzClassifyStoreEngine } from '@ezclassify/ui';

const passThrough = (): EzClassifyStoreEngine =>
    createPassThroughEngine() as EzClassifyStoreEngine;

// ---------------------------------------------------------------------------
// ReactEzClassifyStore
// ---------------------------------------------------------------------------

runEzClassifyStoreConformance(() => new ReactEzClassifyStore(passThrough()), {
    suiteName: 'cross-framework / ReactEzClassifyStore',
});

runEzClassifyStoreBudgetConformance(
    (engine) => new ReactEzClassifyStore(engine as EzClassifyStoreEngine),
    { suiteName: 'cross-framework / ReactEzClassifyStore' },
);

runEzClassifyStoreFacetConformance(
    () => new ReactEzClassifyStore(passThrough()),
    { suiteName: 'cross-framework / ReactEzClassifyStore' },
);

// ---------------------------------------------------------------------------
// VueRefStore
// ---------------------------------------------------------------------------

runEzClassifyStoreConformance(() => new VueRefStore(passThrough()), {
    suiteName: 'cross-framework / VueRefStore',
});

runEzClassifyStoreBudgetConformance(
    (engine) => new VueRefStore(engine as EzClassifyStoreEngine),
    {
        suiteName: 'cross-framework / VueRefStore',
    },
);

runEzClassifyStoreFacetConformance(() => new VueRefStore(passThrough()), {
    suiteName: 'cross-framework / VueRefStore',
});

// ---------------------------------------------------------------------------
// AngularSignalStore
// ---------------------------------------------------------------------------

runEzClassifyStoreConformance(() => new AngularSignalStore(passThrough()), {
    suiteName: 'cross-framework / AngularSignalStore',
});

runEzClassifyStoreBudgetConformance(
    (engine) => new AngularSignalStore(engine as EzClassifyStoreEngine),
    { suiteName: 'cross-framework / AngularSignalStore' },
);

runEzClassifyStoreFacetConformance(
    () => new AngularSignalStore(passThrough()),
    { suiteName: 'cross-framework / AngularSignalStore' },
);
