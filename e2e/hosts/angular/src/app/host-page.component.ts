/**
 * The Angular integration host's page.
 *
 * One authoring loop, end to end, and deliberately the same page as the React
 * host: an author types in a marking field, the field asks the server for
 * suggestions, the author commits concepts, and a banner shows what the server
 * made of them. Every step is a round trip, and nothing on this page evaluates
 * a scheme.
 *
 * The integration is one directive plus attributes on ordinary HTML.
 * `provideEzClassify` named the engine in `main.ts`; `ezClassify` marks the
 * host whose subtree gets enhanced.
 */

import {
    ChangeDetectionStrategy,
    Component,
    inject,
    signal,
} from '@angular/core';
import { EzClassifyDirective } from '@ezclassify/angular';
import { HOST_RUNTIME } from './host-runtime';

@Component({
    selector: 'app-host-page',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [EzClassifyDirective],
    styleUrl: './host-page.component.css',
    template: `
        <main class="page">
            <h1>Angular integration host</h1>
            <p class="composition" data-testid="composition">
                {{ composition() }}
            </p>

            <div ezClassify>
                <!-- The document's marking. The field writes it, the banner reads it. -->
                <input
                    id="document-marking"
                    type="hidden"
                    data-ezclassify-rendered />

                <div
                    class="banner-slot"
                    data-testid="marking-banner"
                    data-ezclassify-controller="banner"
                    data-ezclassify-source="document-marking"
                    data-ezclassify-banner-show-current-data
                    data-ezclassify-banner-current-label="Marking"></div>

                <label class="field-label" for="marking-editor"
                    >Document marking</label
                >
                <input
                    id="marking-editor"
                    type="text"
                    data-testid="marking-editor"
                    data-ezclassify-controller="marking"
                    data-ezclassify-bound-to="document-marking" />
            </div>
        </main>
    `,
})
export class HostPageComponent {
    private readonly runtime = inject(HOST_RUNTIME);

    /**
     * What the runtime says this application is bound to.
     *
     * Worth showing on the page rather than hiding in a console line: the
     * version an author's markings were made under is the first thing anyone
     * reviewing the document later needs, and here it is the runtime's answer
     * rather than a constant compiled into the bundle.
     */
    readonly composition = signal('');

    constructor() {
        void this.runtime.describeContext().then((description) => {
            this.composition.set(
                `${description.id}@${description.version} · scheme ${description.scheme.id}@${description.scheme.resolvedVersion}`,
            );
        });
    }
}
