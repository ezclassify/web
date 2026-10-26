/**
 * What this application is when it cannot reach its runtime.
 *
 * Bootstrapped in place of the host page rather than rendered inside it. A page
 * whose runtime is unreachable cannot suggest, cannot process, and cannot show
 * a marking; presenting the controls anyway would invite an author to type into
 * a field that will silently keep nothing.
 */

import {
    ChangeDetectionStrategy,
    Component,
    InjectionToken,
    inject,
} from '@angular/core';

/** Why the connection failed, in the words the client used. */
export const RUNTIME_FAILURE = new InjectionToken<string>('RUNTIME_FAILURE');

@Component({
    // The same selector as the host page on purpose: the page's single
    // host element is whichever of the two this bootstrap chose, and only one
    // of them is ever in an application.
    selector: 'app-host-page',
    changeDetection: ChangeDetectionStrategy.OnPush,
    styleUrl: './host-page.component.css',
    template: `
        <main class="page">
            <h1>Angular integration host</h1>
            <p class="failure" data-testid="connection-error">{{ failure }}</p>
        </main>
    `,
})
export class RuntimeUnavailableComponent {
    readonly failure = inject(RUNTIME_FAILURE);
}
