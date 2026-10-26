/**
 * Bootstrap the Angular integration host.
 *
 * The runtime connection is resolved BEFORE the application starts.
 * `provideEzClassify` takes a concrete engine, and an Angular application that
 * is bound to a published composition has nothing useful to render until it
 * knows which one; asking every component to guard against a half-connected
 * root would be carrying that uncertainty through the whole tree for the sake
 * of a few hundred milliseconds at startup.
 *
 * A failure to reach the runtime is a different application, not a state inside
 * this one, so it bootstraps a different root component.
 */

import { provideZonelessChangeDetection } from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';
import { provideEzClassify } from '@ezclassify/angular';
import { HostPageComponent } from './app/host-page.component';
import {
    RUNTIME_FAILURE,
    RuntimeUnavailableComponent,
} from './app/runtime-unavailable.component';
import { HOST_RUNTIME } from './app/host-runtime';
import { connectHost } from '../../session';

/**
 * Connect, then bootstrap whichever application that connection produced.
 *
 * A function rather than top-level await: Angular's browser targets reach back
 * to browsers that do not support it, and the build refuses the module
 * outright.
 *
 * @returns Resolves once an application is running.
 */
async function start(): Promise<void> {
    try {
        const client = await connectHost();
        await bootstrapApplication(HostPageComponent, {
            providers: [
                provideZonelessChangeDetection(),
                provideEzClassify({ engine: client }),
                { provide: HOST_RUNTIME, useValue: client },
            ],
        });
    } catch (failure) {
        const message =
            failure instanceof Error ? failure.message : String(failure);
        await bootstrapApplication(RuntimeUnavailableComponent, {
            providers: [
                provideZonelessChangeDetection(),
                { provide: RUNTIME_FAILURE, useValue: message },
            ],
        });
    }
}

void start();
