/**
 * The connected REST client, as a first-class injectable.
 *
 * `provideEzClassify` already puts the client in the injector, but it puts it
 * there as an ENGINE: the adapter contract the UI binds to, deliberately narrow
 * enough that a component cannot tell a remote client from an embedded one. A
 * component that wants a client-only fact (which Context version the runtime
 * resolved this application to) is asking a different question, so it asks
 * through a different token instead of widening the engine's type back out.
 */

import { InjectionToken } from '@angular/core';
import type { EzClassifyClient } from '@ezclassify/rest-client';

/** The client this application connected with at bootstrap. */
export const HOST_RUNTIME = new InjectionToken<EzClassifyClient>(
    'HOST_RUNTIME',
);
