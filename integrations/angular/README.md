# @ezclassify/angular

Angular marking controls backed by a shared EzClassify REST client.

## Install

```bash
npm install @ezclassify/angular @ezclassify/ui @ezclassify/rest-client
```

Peers: `@angular/core`, `@angular/common`, and `@angular/forms` each support
`^20.3.34 || ^21.0.0 || ^22.0.0`; `rxjs` supports `>=7.0.0`. Keep Angular
packages on the same supported major. The library uses Angular 20 partial-Ivy output.

## Mark a Document and Its Parts

This form connects one document marking to the parts inside it through one form
store. `connectContext` loads public vocabulary and UI metadata before
returning. Rule evaluation stays on the REST deployment.

Start the Cedar Valley replay server first. It answers recorded requests for
Cedar Valley, a fictional school district's teaching policy, over real HTTP, so
the form works before you have a runtime. `--cors-origin` is your dev server's
exact origin; `http://localhost:4200` is the Angular CLI default.

```bash
npx @ezclassify/conformance-server --scenario cedar-valley --port 4010 \
  --cors-origin http://localhost:4200
```

The complete app is in [`examples/angular-example`](https://github.com/ezclassify/web/tree/main/examples/angular-example).

Create one client during application startup and share it through Angular DI.
This complete form uses the full `cedar-valley@1.0.0` Context, whose inline
markings support its title/body fields.

```ts
// src/client-token.ts
import { InjectionToken } from '@angular/core';
import type { EzClassifyClient } from '@ezclassify/rest-client';
export const CLIENT = new InjectionToken<EzClassifyClient>('EzClassify client');
```

The server URL lives in the CLI's environment file, so pointing the app
somewhere else is a one-line change:

```ts
// src/environments/environment.ts
export const environment = {
    ezclassifyUrl: 'http://127.0.0.1:4010',
};
```

```ts
// src/main.ts
import { provideZonelessChangeDetection } from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';
import { connectContext } from '@ezclassify/rest-client';
import { AppComponent } from './app.component';
import { CLIENT } from './client-token';
import { environment } from './environments/environment';

async function start() {
    const client = await connectContext({
        baseUrl: environment.ezclassifyUrl,
        contextId: 'cedar-valley',
        contextVersion: '1.0.0',
    });
    const app = await bootstrapApplication(AppComponent, {
        providers: [
            provideZonelessChangeDetection(),
            { provide: CLIENT, useValue: client },
        ],
    });
    app.onDestroy(() => client.destroy());
}

void start().catch((error: unknown) => {
    const host = document.querySelector('app-root');
    if (host) {
        host.textContent =
            'Unable to start the document editor. Please try again.';
    }
    console.error(error);
});
```

The page contains `<app-root></app-root>`. Show startup failures through your
application's error UI. At application/session teardown, destroy the app and
then the shared client. This bootstrap uses zoneless change detection on all
supported Angular versions; retain your existing application's configuration
when adding the feature there.

```ts
// src/app.component.ts
import { Component } from '@angular/core';
import { DocumentEditorComponent } from './document-editor.component';
@Component({
    selector: 'app-root',
    imports: [DocumentEditorComponent],
    template: '<app-document-editor />',
})
export class AppComponent {}
```

The document's directive creates one `AngularSignalStore` for this form and
provides it to descendants. Removing the document destroys its scanner and
store, leaving the application client available to other features.

```ts
// src/document-editor.component.ts
import { Component, inject } from '@angular/core';
import { EzClassifyDirective } from '@ezclassify/angular';
import { CLIENT } from './client-token';
import { DocumentSummaryComponent } from './document-summary.component';
@Component({
    selector: 'app-document-editor',
    imports: [EzClassifyDirective, DocumentSummaryComponent],
    template: `
        <section [ezClassify]="client">
            <form id="document-form">
                <label for="document">Document marking</label>
                <input
                    id="document"
                    type="text"
                    name="documentMarking"
                    value="INTERNAL"
                    data-ezclassify-controller="marking" />

                <label for="attachment"
                    >Attachment marking (MarkingField)</label
                >
                <input
                    id="attachment"
                    name="attachmentMarking"
                    type="text"
                    data-ezclassify-controller="marking"
                    data-ezclassify-part-of="document"
                    value="PUBLIC" />
                <label for="summary">Summary marking (TagInput)</label>
                <input
                    id="summary"
                    name="summaryMarking"
                    value="CONFIDENTIAL"
                    data-ezclassify-controller="tags"
                    data-ezclassify-part-of="document" />
                <label for="title">Title (MarkedInput)</label>
                <input
                    id="title"
                    name="title"
                    type="text"
                    data-ezclassify-controller="marked-input"
                    data-ezclassify-part-of="document"
                    value="(PUBLIC) District report" />
                <label for="body">Body (MarkedTextArea)</label>
                <textarea
                    id="body"
                    name="body"
                    data-ezclassify-controller="marked-textarea"
                    data-ezclassify-part-of="document">
(INTERNAL) Planning notes.
(PUBLIC) Published background.</textarea>

                <p>Document preview</p>
                <div
                    data-ezclassify-controller="banner"
                    data-ezclassify-source="document"></div>
                <p>Computed parts</p>
                <div
                    data-ezclassify-controller="banner"
                    data-ezclassify-aggregate="document"></div>
                <app-document-summary />
            </form>
        </section>
    `,
})
export class DocumentEditorComponent {
    readonly client = inject(CLIENT);
}
```

The custom summary injects the directive's live store signal. Template reads
track its marking state; the button publishes to that same store.

```ts
// src/document-summary.component.ts
import { Component, inject, signal } from '@angular/core';
import { EZCLASSIFY_STORE_SIGNAL } from '@ezclassify/angular';
@Component({
    selector: 'app-document-summary',
    template: `
        @if (store(); as current) {
            <p>
                Authored document:
                {{ current.get('document').rendered || 'Not marked' }}
            </p>
            <p>
                Computed parts:
                {{
                    current.getWholeRollup('document').rendered ||
                        'No marked parts'
                }}
                {{
                    current.getWholeRollup('document').stale
                        ? ' (refresh failed)'
                        : ''
                }}
            </p>
            <button (click)="setDocument()" type="button">
                Set document to CONFIDENTIAL
            </button>
        }
        <p role="status">{{ error() }}</p>
    `,
})
export class DocumentSummaryComponent {
    readonly store = inject(EZCLASSIFY_STORE_SIGNAL);
    readonly error = signal('');
    setDocument() {
        const store = this.store();
        if (!store) return;
        void store
            .publishRendered('document', 'CONFIDENTIAL')
            .catch((error: unknown) => this.error.set(String(error)));
    }
}
```

The document MarkingField authors the whole. The other MarkingField, TagInput,
MarkedInput and the portions in MarkedTextArea are parts of that whole through
`data-ezclassify-part-of="document"`. A `source` banner reads the authored whole;
`aggregate="document"` reads only its computed parts. A bare `aggregate` reads
all markings in this store, including the whole itself: the page aggregate
answers a different question.

The initial whole is INTERNAL while the summary part is CONFIDENTIAL. The
whole field shows the engine's coverage error and proposed fix. Editing a
part changes what the whole must cover without silently replacing its authored
value. The custom button writes the same store as the whole field and preview.
MarkedInput enhances a text input for one logical line; MarkedTextArea registers
its individual portions beneath the whole.

The replay records this form used as written: focus each control, browse each
picker, open the marking popup in the title and body (Ctrl+Enter, or Cmd+Enter
on macOS), select **Set document to CONFIDENTIAL**, then change the title to
`(PUBLIC) District report card` and the body's first line to
`(CONFIDENTIAL) Planning notes.` The whole ends at CONFIDENTIAL and covers its
parts. Other values need your runtime.

### Switch to Your Runtime

When the form works, change the connection and nothing else. Set
`environment.ezclassifyUrl` to your runtime, name your provisioned Context, and
supply real credentials. `getAccessToken` and `getContextToken` are your
application's session helpers; a deployment that does not use Context tokens
leaves `contextToken` out.

```ts
const client = await connectContext({
    baseUrl: environment.ezclassifyUrl,
    contextId: 'cedar-valley',
    contextVersion: '1.0.0',
    contextToken: await getContextToken(),
    auth: { token: getAccessToken },
});
```

## Load, Read, Write, and Save Markings

`seedAssertions(id, savedAssertions)` loads a document's marking baseline;
`publishRendered` and `publishAssertions` apply user/application edits on top.
Use `get(id)` for a snapshot and `subscribe(id, listener)` for committed changes;
subscriptions return an unsubscribe function. `getWholeRollup(wholeId)` and
`subscribeWholeRollup` read the parts only; `getAggregate` and
`subscribeAggregate` read the page aggregate. Show a rolled-up state's `stale`
flag as unresolved after a failed refresh.

Persist structured assertions with your document, for example
`JSON.stringify(store.get('document').assertions)`. A display format may omit
alternate-scope categories or captured values. Save native title/body values
too, preserving their prose and inline markings. The store's `valid` and
`errors` describe the marking itself, not whole-versus-parts coverage. The
whole MarkingField owns that contextual comparison and displays its errors
and proposed fixes.

## Presentation

Omit `format` to use the Context's whole and part defaults. A control may use
another Context-defined format through `data-ezclassify-format`. Options also
choose colors, tooltips and favorites. See the
[attribute reference](https://github.com/ezclassify/web/blob/main/libs/ui/docs/attributes.md) and
[binding model](https://github.com/ezclassify/web/blob/main/libs/ui/docs/binding-model.md) for the complete contracts.

## License

Apache-2.0.
