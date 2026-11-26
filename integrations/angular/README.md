# @ezclassify/angular

Angular component library for security markings and sensitivity labels: validate, combine portion marks into an overall marking, show the banner. Rules come from your EzClassify runtime: IC Classification and Control Markings (CAPCO), Controlled Unclassified Information (CUI), Traffic Light Protocol (TLP) 2.0, Common Vulnerability Scoring System (CVSS), or schemes you write yourself. This package needs a running EzClassify runtime. The free developer runtime includes TLP 2.0, CVSS and demo subsets of CAPCO and CUI. The full CAPCO and CUI schemes are licensed content.

## Install

```bash
npm install @ezclassify/angular @ezclassify/ui @ezclassify/rest-client
```

Peers: `@angular/core`, `@angular/common`, and `@angular/forms` each support
`^20.3.34 || ^21.0.0 || ^22.0.0`; `rxjs` supports `>=7.0.0`. Keep Angular
packages on the same supported major. The library uses Angular 20 partial-Ivy output.

## Mark One Field

Provide the client once, at bootstrap:

```ts
bootstrapApplication(App, {
    providers: [provideEzClassify({ context: client })],
});
```

Put the `ezClassify` directive on each document and mark its fields with
attributes:

```html
<form ezClassify>
    <input name="marking" data-ezclassify-controller="marking" />
</form>
```

Each `ezClassify` host owns the store for the fields inside it, provides it to
its descendants, and releases it when Angular destroys the host.

## Mark a Document and Its Parts

`data-ezclassify-whole="document"` on the form says the form holds the
`document` marking and its parts. The field with `id="document"` is the whole.
Every other marked field inside the form is a part: the attachment
MarkingField, the summary TagInput, the title MarkedInput and each portion in
the body MarkedTextArea. A `source` banner shows the authored whole, and an
`aggregate` banner shows what the parts require. `connectContext` loads public
vocabulary and UI metadata before returning. Rule evaluation stays on the REST
deployment.

Start the free developer runtime first. It serves the public demo Contexts,
Cedar Valley (a fictional school district's teaching policy) among them, over
real HTTP, so the form works before you have a runtime of your own.
`EZCLASSIFY_DEMO_ALLOWED_ORIGINS` is your dev server's exact origin; `http://localhost:4200` is the Angular CLI default.

```bash
docker run --rm -p 3000:8080 \
  -e EZCLASSIFY_DEMO_ALLOWED_ORIGINS=http://localhost:4200 \
  ghcr.io/ezclassify/developer-runtime
```

The complete app is in [`examples/angular-example`](https://github.com/ezclassify/web/tree/main/examples/angular-example).
It uses the full `cedar-valley@1.0.0` Context, whose inline markings support its
title and body fields.

The server URL lives in the CLI's environment file, so pointing the app
somewhere else is a one-line change:

```ts
// src/environments/environment.ts
export const environment = {
    ezclassifyUrl: 'http://localhost:3000',
};
```

```ts
// src/main.ts
import { provideZonelessChangeDetection } from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';
import { provideEzClassify } from '@ezclassify/angular';
import { connectContext } from '@ezclassify/rest-client';
import { AppComponent } from './app.component';
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
            provideEzClassify({ context: client }),
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
import { EzClassifyDirective } from '@ezclassify/angular';
import { DocumentStateComponent } from './document-state.component';
@Component({
    selector: 'app-root',
    imports: [EzClassifyDirective, DocumentStateComponent],
    template: `
        <section ezClassify>
            <form data-ezclassify-whole="document">
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
                    value="PUBLIC"
                    data-ezclassify-controller="marking" />
                <label for="summary">Summary marking (TagInput)</label>
                <input
                    id="summary"
                    name="summaryMarking"
                    value="CONFIDENTIAL"
                    data-ezclassify-controller="tags" />
                <label for="title">Title (MarkedInput)</label>
                <input
                    id="title"
                    name="title"
                    type="text"
                    value="(PUBLIC) District report"
                    data-ezclassify-controller="marked-input" />
                <label for="body">Body (MarkedTextArea)</label>
                <textarea
                    id="body"
                    name="body"
                    data-ezclassify-controller="marked-textarea">
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
                <app-document-state />
            </form>
        </section>
    `,
})
export class AppComponent {}
```

The initial whole is INTERNAL while the summary part is CONFIDENTIAL. The
whole field shows the engine's coverage error and proposed fix. Editing a
part changes what the whole must cover without silently replacing its authored
value. MarkedInput enhances a text input for one logical line; MarkedTextArea
registers its individual portions beneath the whole.

### Try the capco-demo Context

This one uses the `capco-demo` Context on the free developer runtime (the start command is in the section above). Against that runtime the engine reads `SECRET//NOFORN` as a valid marking, and rolls the portion marks `S//NF`, `C` and `U` up to the overall marking `SECRET//NOFORN`, which is what the aggregate banner shows.

```ts
const client = await connectContext({
    baseUrl: 'http://localhost:3000',
    contextId: 'capco-demo',
    contextVersion: '1.0.0',
});
// provideEzClassify({ context: client }) at bootstrap, then:
```

```html
<section ezClassify>
    <form data-ezclassify-whole="document">
        <input
            id="document"
            name="document"
            value="SECRET//NOFORN"
            data-ezclassify-controller="marking" />
        <input
            name="part1"
            value="S//NF"
            data-ezclassify-controller="marking" />
        <input name="part2" value="C" data-ezclassify-controller="marking" />
        <input name="part3" value="U" data-ezclassify-controller="marking" />
        <div
            data-ezclassify-controller="banner"
            data-ezclassify-source="document"></div>
        <div
            data-ezclassify-controller="banner"
            data-ezclassify-aggregate="document"></div>
    </form>
</section>
```

### Read and Write the State in Code

The form needs no code. `DocumentStateComponent` shows how a component inside
the `ezClassify` host reads and writes the same store the controls use. It
injects the host's live store signal; template reads track its marking state,
and the button publishes to that same store:

```ts
// src/document-state.component.ts
import { Component, inject, signal } from '@angular/core';
import { EZCLASSIFY_STORE_SIGNAL } from '@ezclassify/angular';
@Component({
    selector: 'app-document-state',
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
export class DocumentStateComponent {
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

Try this form as written: focus each control, browse each
picker, open the marking popup in the title and body (Ctrl+Enter, or Cmd+Enter
on macOS), select **Set document to CONFIDENTIAL**, then change the title to
`(PUBLIC) District report card` and the body's first line to
`(CONFIDENTIAL) Planning notes.` The whole ends at CONFIDENTIAL and covers its
parts. The runtime applies the Context's real rules, so other values work too.

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

## Larger Pages

Folders, several Contexts, a crosswalk's second scheme, a part outside its
whole's container and a submitted page marking are all attributes. The
[`@ezclassify/ui` README](https://github.com/ezclassify/web/blob/main/libs/ui/README.md#larger-pages)
shows each one; the markup is the same in Angular.

For several Contexts, provide them all under keys you choose, and name the key
on each section with `data-ezclassify-context`:

```ts
provideEzClassify({ contexts: { district, records } });
```

A host that needs a store your application already owns, or options for one
document only, binds them with `[ezClassifyStore]` and `[ezClassifyOptions]`.

On a page whose markup you can't edit, a component inside the root marks up the
elements it finds through the runtime, as the
[pages you can't edit](https://github.com/ezclassify/web/blob/main/libs/ui/README.md#pages-you-cant-edit) section shows. `injectEzClassifyUI()` returns a signal that holds it
once the root has mounted:

```ts
private readonly ui = injectEzClassifyUI();
private readonly enhance = effect(() => {
    const summary = document.getElementById('summary');
    if (summary) this.ui()?.add(summary, 'marking');
});
```

## Load, Read, Write, and Save Markings

`seedAssertions(id, savedAssertions)` loads a document's marking baseline;
`publishRendered` and `publishAssertions` apply user/application edits on top.
Use `get(id)` for a snapshot and `subscribe(id, listener)` for committed changes;
subscriptions return an unsubscribe function. `getWholeRollup(wholeId)` and
`subscribeWholeRollup` read the parts only. Show a rolled-up state's `stale`
flag as unresolved after a failed refresh.

Persist structured assertions with your document, for example
`JSON.stringify(store.get('document').assertions)`. A display format may omit
alternate-scope categories or captured values. Save native title/body values
too, preserving their prose and inline markings. A marking that code seeds or
saves needs an `id` on its field. The store's `valid` and `errors` describe the
marking itself, not whole-versus-parts coverage. The whole MarkingField owns
that contextual comparison and displays its errors and proposed fixes.

## When a Result Is Unverified

A field that cannot complete the check of the text typed into it (the runtime is
unreachable, times out, or answers badly) keeps its last result, marks it as
unverified and says so itself, in its own message area. To react beside it,
`injectEzClassifyUnverified(id)` returns a signal that is true while the field with that DOM id is unverified. Call it from an injection context. The id may be a signal. Each field reports for itself, and a field that is
not enhanced yet reads false until it is.

```ts
readonly unverified = injectEzClassifyUnverified('summary');
```

## Presentation

Omit `format` to use the Context's whole and part defaults. A control may use
another Context-defined format through `data-ezclassify-format`. Options also
choose colors, tooltips and favorites. See the
[attribute reference](https://github.com/ezclassify/web/blob/main/libs/ui/docs/attributes.md) and
[binding model](https://github.com/ezclassify/web/blob/main/libs/ui/docs/binding-model.md) for the complete contracts.

## License

Apache-2.0.
