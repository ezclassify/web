import type { EzClassifyClient } from '@ezclassify/rest-client';
import { connectDemoContext } from '../../../test-support/demo-runtime';
import { openOperations } from './context-doubles';
import source from './multi-scope-regression.yaml?raw';

/** One draft connection per spec file; every call opens a fresh view of it. */
let connection: Promise<EzClassifyClient> | undefined;

/**
 * Load the canonical multi-scope fixture for UI state and rendering
 * regressions, as scheme operations a spec may replace or spy on.
 *
 * The fixture goes to the demo runtime through its draft door, so its answers
 * are the runtime's, replayed from the spec file's recordings in the public
 * lane. Each call returns a new view, so a spy on one does not reach another.
 */
export async function loadMultiScopeRegression(): Promise<
    EzClassifyClient['scheme']
> {
    connection ??= connectDemoContext({ draft: { scheme: source } });
    return openOperations((await connection).scheme);
}
